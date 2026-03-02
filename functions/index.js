const admin = require('firebase-admin');
const functions = require('firebase-functions');
const Busboy = require('busboy');
const cors = require('cors');
const crypto = require('crypto');

admin.initializeApp();

const DEFAULT_ALLOWED_ORIGINS = [
  'https://www.edwardsarpong.com',
  'https://edwardsarpong.com',
  'http://localhost:5000',
  'http://127.0.0.1:5000'
];

function getAllowedOrigins() {
  const configured = functions.config().security && functions.config().security.allowed_origins;
  if (!configured) {
    return new Set(DEFAULT_ALLOWED_ORIGINS);
  }

  return new Set(
    String(configured)
      .split(',')
      .map(origin => origin.trim())
      .filter(Boolean)
  );
}

const allowedOrigins = getAllowedOrigins();

const corsHandler = cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error('Origin not allowed by CORS'));
  }
});

const MAX_FILES = 3;
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 8;
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf'
]);

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) {
    return forwarded.split(',')[0].trim();
  }

  if (Array.isArray(forwarded) && forwarded.length) {
    return String(forwarded[0]).split(',')[0].trim();
  }

  return req.ip || '';
}

function hashIdentifier(value) {
  return crypto.createHash('sha256').update(String(value || 'unknown')).digest('hex').slice(0, 32);
}

async function isRateLimited(req, routeKey, maxRequests = RATE_LIMIT_MAX_REQUESTS, windowMs = RATE_LIMIT_WINDOW_MS) {
  const ip = getClientIp(req);
  const bucketId = `${routeKey}_${hashIdentifier(ip)}`;
  const bucketRef = admin.firestore().collection('rate_limits').doc(bucketId);
  const now = Date.now();

  const result = await admin.firestore().runTransaction(async (tx) => {
    const snapshot = await tx.get(bucketRef);

    if (!snapshot.exists) {
      tx.set(bucketRef, {
        route: routeKey,
        count: 1,
        windowStartMs: now,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return { limited: false };
    }

    const data = snapshot.data() || {};
    const windowStartMs = Number(data.windowStartMs || 0);
    const currentCount = Number(data.count || 0);

    if (now - windowStartMs >= windowMs) {
      tx.set(bucketRef, {
        route: routeKey,
        count: 1,
        windowStartMs: now,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      return { limited: false };
    }

    if (currentCount >= maxRequests) {
      tx.set(bucketRef, {
        route: routeKey,
        count: currentCount,
        windowStartMs,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      return { limited: true };
    }

    tx.set(bucketRef, {
      route: routeKey,
      count: currentCount + 1,
      windowStartMs,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return { limited: false };
  });

  return result.limited;
}

function getTurnstileSecret() {
  const security = functions.config().security || {};
  return sanitizeString(security.turnstile_secret);
}

async function verifyTurnstileToken(req, token) {
  const secret = getTurnstileSecret();
  if (!secret) return true;
  if (!token) return false;

  const params = new URLSearchParams();
  params.set('secret', secret);
  params.set('response', token);
  params.set('remoteip', getClientIp(req));

  try {
    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    const data = await response.json();
    return data && data.success === true;
  } catch (error) {
    console.error('Turnstile verification failed:', error);
    return false;
  }
}

function sanitizeString(value) {
  if (!value) return '';
  return String(value).trim();
}

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const busboy = Busboy({
      headers: req.headers,
      limits: { files: MAX_FILES, fileSize: MAX_FILE_SIZE_BYTES }
    });

    const fields = {};
    const files = [];

    busboy.on('field', (fieldname, value) => {
      fields[fieldname] = value;
    });

    busboy.on('file', (fieldname, file, info) => {
      if (!info || !info.filename) {
        file.resume();
        return;
      }

      const chunks = [];
      file.on('data', (data) => {
        chunks.push(data);
      });

      file.on('limit', () => {
        file.resume();
      });

      file.on('end', () => {
        const buffer = Buffer.concat(chunks);
        files.push({
          fieldname,
          filename: info.filename,
          mimeType: info.mimeType,
          buffer,
          size: buffer.length
        });
      });
    });

    busboy.on('finish', () => resolve({ fields, files }));
    busboy.on('error', reject);

    busboy.end(req.rawBody);
  });
}

function buildLead(fields) {
  return {
    name: sanitizeString(fields.name),
    phone: sanitizeString(fields.phone),
    email: sanitizeString(fields.email),
    service: sanitizeString(fields.service),
    message: sanitizeString(fields.message),
    location: sanitizeString(fields.location),
    budget: sanitizeString(fields.budget),
    timeline: sanitizeString(fields.timeline),
    referral: sanitizeString(fields.referral),
    company: sanitizeString(fields.company),
    consent: fields.consent === 'on' || fields.consent === 'true',
    pageUrl: sanitizeString(fields.pageUrl),
    pageTitle: sanitizeString(fields.pageTitle),
    source: sanitizeString(fields.source) || 'website',
    status: 'New',
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  };
}

function validateLead(lead) {
  if (!lead.name) return 'Name is required.';
  if (!lead.phone) return 'Phone is required.';
  if (!lead.message) return 'Message is required.';
  if (!lead.consent) return 'Consent is required.';
  return null;
}

function sanitizeNumber(value) {
  const numberValue = Number(value);
  if (Number.isNaN(numberValue)) return 0;
  return numberValue;
}

function parseJsonField(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

function buildOrder(payload) {
  const customer = payload.customer || {};
  const items = Array.isArray(payload.items) ? payload.items : [];
  const orderItems = items.map((item) => ({
    id: sanitizeString(item.id),
    name: sanitizeString(item.name),
    priceGhs: sanitizeNumber(item.priceGhs),
    quantity: Math.max(1, Math.floor(sanitizeNumber(item.quantity))),
    selectedVariants: (item.selectedVariants && typeof item.selectedVariants === 'object') ? item.selectedVariants : null
  }));

  const subtotalGhs = orderItems.reduce((sum, item) => sum + item.priceGhs * item.quantity, 0);

  return {
    customer: {
      name: sanitizeString(customer.name),
      phone: sanitizeString(customer.phone),
      email: sanitizeString(customer.email),
      city: sanitizeString(customer.city),
      address: sanitizeString(customer.address)
    },
    items: orderItems,
    subtotalGhs,
    currencyDisplay: sanitizeString(payload.currencyDisplay) || 'GHS',
    paymentMethod: sanitizeString(payload.paymentMethod),
    paystackRef: sanitizeString(payload.paystackRef) || null,
    note: sanitizeString(payload.note),
    pageUrl: sanitizeString(payload.pageUrl),
    source: sanitizeString(payload.source) || 'website',
    status: 'New',
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  };
}

function validateOrder(order) {
  if (!order.customer.name) return 'Customer name is required.';
  if (!order.customer.phone) return 'Customer phone is required.';
  if (!order.items.length) return 'Order must include items.';
  if (!order.paymentMethod) return 'Payment method is required.';
  return null;
}

exports.submitLead = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async (corsError) => {
    if (corsError) {
      res.status(403).json({ error: 'Origin not allowed.' });
      return;
    }

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    try {
      const limited = await isRateLimited(req, 'submitLead');
      if (limited) {
        res.status(429).json({ error: 'Too many requests. Please try again later.' });
        return;
      }

      const contentType = req.headers['content-type'] || '';
      let fields = {};
      let files = [];

      if (contentType.includes('multipart/form-data')) {
        const parsed = await parseMultipart(req);
        fields = parsed.fields;
        files = parsed.files;
      } else {
        fields = req.body || {};
      }

      const turnstileToken = sanitizeString(fields['cf-turnstile-response'] || fields.turnstileToken);
      const turnstilePassed = await verifyTurnstileToken(req, turnstileToken);
      if (!turnstilePassed) {
        res.status(400).json({ error: 'Captcha verification failed.' });
        return;
      }

      const lead = buildLead(fields);
      const validationError = validateLead(lead);
      if (validationError) {
        res.status(400).json({ error: validationError });
        return;
      }

      if (files.length > MAX_FILES) {
        res.status(400).json({ error: 'Too many files uploaded.' });
        return;
      }

      const invalidFile = files.find(file => !ALLOWED_MIME_TYPES.has(file.mimeType));
      if (invalidFile) {
        res.status(400).json({ error: 'Unsupported file type.' });
        return;
      }

      const oversizeFile = files.find(file => file.size > MAX_FILE_SIZE_BYTES);
      if (oversizeFile) {
        res.status(413).json({ error: 'File too large.' });
        return;
      }

      const leadRef = await admin.firestore().collection('leads').add(lead);

      const attachments = [];
      if (files.length) {
        const bucket = admin.storage().bucket();
        const uploads = files.map(async (file) => {
          const safeName = file.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
          const storagePath = `lead-uploads/${leadRef.id}/${Date.now()}-${safeName}`;
          const storageFile = bucket.file(storagePath);

          await storageFile.save(file.buffer, {
            metadata: {
              contentType: file.mimeType
            }
          });

          attachments.push({
            originalName: file.filename,
            contentType: file.mimeType,
            size: file.size,
            storagePath
          });
        });

        await Promise.all(uploads);
        await leadRef.update({ attachments });
      }

      await admin.firestore().collection('mail').add({
        to: ['info@edwardsarpong.com'],
        message: {
          subject: `New Lead: ${lead.name} (${lead.service || 'General'})`,
          text: `${lead.name} submitted a new lead.\n\nPhone: ${lead.phone}\nEmail: ${lead.email || 'N/A'}\nService: ${lead.service || 'N/A'}\nLocation: ${lead.location || 'N/A'}\nBudget: ${lead.budget || 'N/A'}\nTimeline: ${lead.timeline || 'N/A'}\nReferral: ${lead.referral || 'N/A'}\nCompany: ${lead.company || 'N/A'}\nMessage: ${lead.message}\nPage: ${lead.pageUrl || 'N/A'}`
        }
      });

      res.status(200).json({ success: true, id: leadRef.id });
    } catch (error) {
      console.error('Lead submission failed:', error);
      res.status(500).json({ error: 'Lead submission failed.' });
    }
  });
});

exports.submitOrder = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async (corsError) => {
    if (corsError) {
      res.status(403).json({ error: 'Origin not allowed.' });
      return;
    }

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    try {
      const limited = await isRateLimited(req, 'submitOrder');
      if (limited) {
        res.status(429).json({ error: 'Too many requests. Please try again later.' });
        return;
      }

      const contentType = req.headers['content-type'] || '';
      let payload = {};
      let files = [];

      if (contentType.includes('multipart/form-data')) {
        const parsed = await parseMultipart(req);
        files = parsed.files;
        payload = {
          ...parsed.fields,
          customer: parseJsonField(parsed.fields.customer, {}),
          items: parseJsonField(parsed.fields.items, [])
        };
      } else {
        payload = req.body || {};
      }

      const turnstileToken = sanitizeString(payload['cf-turnstile-response'] || payload.turnstileToken);
      const turnstilePassed = await verifyTurnstileToken(req, turnstileToken);
      if (!turnstilePassed) {
        res.status(400).json({ error: 'Captcha verification failed.' });
        return;
      }

      const settingsDoc = await admin.firestore().collection('settings').doc('payments').get();
      const paymentSettings = settingsDoc.exists ? settingsDoc.data() : {};
      const proofRequired = paymentSettings.proofRequired === true;

      const order = buildOrder(payload);
      const validationError = validateOrder(order);
      if (validationError) {
        res.status(400).json({ error: validationError });
        return;
      }

      if (files.length > 1) {
        res.status(400).json({ error: 'Only one proof file is allowed.' });
        return;
      }

      if (proofRequired && files.length === 0) {
        res.status(400).json({ error: 'Proof of payment is required.' });
        return;
      }

      const invalidFile = files.find(file => !ALLOWED_MIME_TYPES.has(file.mimeType));
      if (invalidFile) {
        res.status(400).json({ error: 'Unsupported file type.' });
        return;
      }

      const oversizeFile = files.find(file => file.size > MAX_FILE_SIZE_BYTES);
      if (oversizeFile) {
        res.status(413).json({ error: 'File too large.' });
        return;
      }

      const orderRef = await admin.firestore().collection('orders').add(order);

      const proofFiles = [];
      if (files.length) {
        const bucket = admin.storage().bucket();
        const uploads = files.map(async (file) => {
          const safeName = file.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
          const storagePath = `order-uploads/${orderRef.id}/${Date.now()}-${safeName}`;
          const storageFile = bucket.file(storagePath);

          await storageFile.save(file.buffer, {
            metadata: {
              contentType: file.mimeType
            }
          });

          proofFiles.push({
            originalName: file.filename,
            contentType: file.mimeType,
            size: file.size,
            storagePath
          });
        });

        await Promise.all(uploads);
        await orderRef.update({ proofFiles });
      }

      const itemLines = order.items.map(item => `${item.name} x${item.quantity} - GHS ${item.priceGhs}`).join('\n');

      await admin.firestore().collection('mail').add({
        to: ['info@edwardsarpong.com'],
        message: {
          subject: `New Order: ${order.customer.name} (GHS ${order.subtotalGhs})`,
          text: `New order received.\n\nCustomer: ${order.customer.name}\nPhone: ${order.customer.phone}\nEmail: ${order.customer.email || 'N/A'}\nPayment: ${order.paymentMethod}\nDisplay Currency: ${order.currencyDisplay}\nSubtotal (GHS): ${order.subtotalGhs}\nItems:\n${itemLines}\nNotes: ${order.note || 'N/A'}\nProof files: ${proofFiles.length}\nPage: ${order.pageUrl || 'N/A'}`
        }
      });

      // Send confirmation email to customer if email was provided
      if (order.customer.email) {
        const itemHtmlRows = order.items.map(item =>
          `<tr><td style="padding:8px 0;border-bottom:1px solid #eee">${item.name}</td><td style="padding:8px 0;border-bottom:1px solid #eee;text-align:center">x${item.quantity}</td><td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right">GHS ${(item.priceGhs * item.quantity).toLocaleString()}</td></tr>`
        ).join('');

        await admin.firestore().collection('mail').add({
          to: [order.customer.email],
          message: {
            subject: `Your Order is Confirmed – Edward Sarpong Enterprise`,
            html: `
              <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1b1814">
                <h2 style="border-bottom:2px solid #d9a441;padding-bottom:12px">Order Confirmed ✓</h2>
                <p>Hi <strong>${order.customer.name}</strong>, thank you for your order!</p>
                <p>We've received it and will be in touch shortly. Your Order ID is:</p>
                <p style="font-size:22px;font-weight:700;letter-spacing:1px;background:#f6f1ea;padding:14px 20px;border-radius:10px;display:inline-block">${orderRef.id}</p>
                <p style="color:#666;font-size:13px">Save this ID to <a href="https://edwardsarpong.com/track.html?id=${orderRef.id}">track your order</a> at any time.</p>
                <h3>Order Summary</h3>
                <table style="width:100%;border-collapse:collapse">
                  <thead><tr style="border-bottom:2px solid #1b1814">
                    <th style="text-align:left;padding:6px 0">Item</th>
                    <th style="text-align:center;padding:6px 0">Qty</th>
                    <th style="text-align:right;padding:6px 0">Price</th>
                  </tr></thead>
                  <tbody>${itemHtmlRows}</tbody>
                  <tfoot><tr>
                    <td colspan="2" style="padding-top:12px;font-weight:700">Total (GHS)</td>
                    <td style="padding-top:12px;font-weight:700;text-align:right">GHS ${order.subtotalGhs.toLocaleString()}</td>
                  </tr></tfoot>
                </table>
                <hr style="margin:24px 0;border:none;border-top:1px solid #eee">
                <p><strong>Payment:</strong> ${order.paymentMethod}</p>
                <p><strong>Delivery to:</strong> ${order.customer.city || 'N/A'} – ${order.customer.address || 'N/A'}</p>
                <p style="color:#666;font-size:13px">Questions? Reply to this email or call us. We're based in Kumasi and typically respond within a few hours.</p>
                <p style="margin-top:24px">— The Edward Sarpong Enterprise Team</p>
              </div>
            `
          }
        });
      }

      res.status(200).json({ success: true, id: orderRef.id });
    } catch (error) {
      console.error('Order submission failed:', error);
      res.status(500).json({ error: 'Order submission failed.' });
    }
  });
});
