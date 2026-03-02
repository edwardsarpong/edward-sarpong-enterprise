// Order tracking page logic
// Fetches order from Firestore by document ID (shared in order confirmation)

const STATUS_STEPS = [
  { key: 'New',          label: 'Order Received',    desc: 'Your order has been received and is being reviewed.' },
  { key: 'Confirmed',    label: 'Order Confirmed',   desc: 'Payment confirmed and production scheduled.' },
  { key: 'In Progress',  label: 'In Production',     desc: 'Your item is being crafted by our team.' },
  { key: 'Ready',        label: 'Ready for Delivery', desc: 'Your order is complete and awaiting dispatch.' },
  { key: 'Delivered',    label: 'Delivered',          desc: 'Your order has been delivered. Enjoy!' }
];

const firebaseConfig = window.firebaseShopConfig;
let db = null;

if (typeof firebase !== 'undefined' && firebaseConfig && firebaseConfig.apiKey && firebaseConfig.apiKey !== 'YOUR_API_KEY') {
  firebase.initializeApp(firebaseConfig);
  db = firebase.firestore();
}

function getStepIndex(status) {
  return STATUS_STEPS.findIndex(s => s.key === status);
}

function renderTimeline(status) {
  const activeIdx = Math.max(0, getStepIndex(status));
  return STATUS_STEPS.map((step, i) => {
    const isDone = i < activeIdx;
    const isActive = i === activeIdx;
    const dotClass = isDone ? 'done' : isActive ? 'active' : '';
    const icon = isDone ? '✓' : isActive ? '●' : String(i + 1);
    return `
      <div class="timeline-step">
        <div class="step-dot ${dotClass}">${icon}</div>
        <div class="step-body">
          <strong>${step.label}</strong>
          <span>${isActive || isDone ? step.desc : ''}</span>
        </div>
      </div>
    `;
  }).join('');
}

function formatGhs(amount) {
  return new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS', maximumFractionDigits: 0 }).format(amount);
}

function renderOrder(id, order) {
  const createdAt = order.createdAt?.toDate ? order.createdAt.toDate().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : 'N/A';
  const itemsHtml = (order.items || []).map(item => `
    <div class="order-item-row">
      <div style="flex:1">
        <strong>${item.name}</strong>
        <div class="muted">Qty: ${item.quantity} · ${formatGhs(item.priceGhs)} each</div>
        ${item.selectedVariants ? `<div class="muted">${Object.entries(item.selectedVariants).map(([k,v]) => `${k}: ${v}`).join(' · ')}</div>` : ''}
      </div>
      <strong>${formatGhs(item.priceGhs * item.quantity)}</strong>
    </div>
  `).join('');

  document.getElementById('orderResult').innerHTML = `
    <div class="track-card" style="margin-top:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <div>
          <strong style="font-size:17px">Order #${id.slice(-8).toUpperCase()}</strong>
          <div class="muted">Placed ${createdAt}</div>
        </div>
        <span class="stock-badge ${order.status === 'Delivered' ? 'badge-in-stock' : 'badge-order'}" style="position:static">
          ${order.status || 'New'}
        </span>
      </div>

      <div class="status-timeline" style="margin-top:24px">
        ${renderTimeline(order.status || 'New')}
      </div>
    </div>

    <div class="track-card" style="margin-top:16px">
      <strong style="font-size:16px">Items ordered</strong>
      <div class="order-items-list">${itemsHtml}</div>
      <div style="display:flex;justify-content:flex-end;padding-top:12px;border-top:1px solid var(--border);margin-top:12px">
        <strong style="font-size:17px">Total: ${formatGhs(order.subtotalGhs || 0)}</strong>
      </div>
    </div>

    <div class="track-card" style="margin-top:16px">
      <strong style="font-size:16px">Delivery details</strong>
      <dl class="order-detail-grid" style="margin-top:12px">
        <dt>Name</dt><dd>${order.customer?.name || 'N/A'}</dd>
        <dt>Phone</dt><dd>${order.customer?.phone || 'N/A'}</dd>
        <dt>City</dt><dd>${order.customer?.city || 'N/A'}</dd>
        <dt>Address</dt><dd>${order.customer?.address || 'N/A'}</dd>
        <dt>Payment</dt><dd>${order.paymentMethod || 'N/A'}</dd>
      </dl>
    </div>

    <p class="muted" style="margin-top:20px;font-size:13px;text-align:center">
      Questions? Call or WhatsApp us — we're happy to help.
    </p>
  `;
  document.getElementById('orderResult').hidden = false;
}

function showMessage(text, isError) {
  const el = document.getElementById('trackMessage');
  el.textContent = text;
  el.className = isError ? 'err-msg' : 'ok-msg';
  el.style.display = 'block';
}

async function trackOrder(orderId) {
  const trimmed = orderId.trim();
  if (!trimmed) { showMessage('Please enter your Order ID.', true); return; }

  if (!db) {
    showMessage('Order lookup is unavailable (Firebase not configured). Please contact us directly.', true);
    return;
  }

  showMessage('Looking up your order…', false);
  document.getElementById('orderResult').hidden = true;

  try {
    const doc = await db.collection('orders').doc(trimmed).get();
    if (!doc.exists) {
      showMessage('Order not found. Please check your Order ID and try again.', true);
      return;
    }
    document.getElementById('trackMessage').style.display = 'none';
    renderOrder(doc.id, doc.data());
  } catch (err) {
    showMessage('Unable to fetch order. Please try again.', true);
    console.error('Track order error:', err);
  }
}

document.getElementById('trackBtn').addEventListener('click', () => {
  trackOrder(document.getElementById('orderIdInput').value);
});

document.getElementById('orderIdInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') trackOrder(e.target.value);
});

// Auto-load from URL param ?id=ORDERID
const urlId = new URLSearchParams(window.location.search).get('id');
if (urlId) {
  document.getElementById('orderIdInput').value = urlId;
  trackOrder(urlId);
}
