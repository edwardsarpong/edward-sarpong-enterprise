const statusOptions = ['New', 'Contacted', 'Quoted', 'Closed'];
const orderStatusOptions = ['New', 'Confirmed', 'In Production', 'Ready', 'Completed', 'Cancelled'];

const authCard = document.getElementById('authCard');
const crmApp = document.getElementById('crmApp');
const leadList = document.getElementById('leadList');
const leadDetail = document.getElementById('leadDetail');
const leadCount = document.getElementById('leadCount');
const orderList = document.getElementById('orderList');
const orderDetail = document.getElementById('orderDetail');
const orderCount = document.getElementById('orderCount');
const productList = document.getElementById('productList');
const productCount = document.getElementById('productCount');
const productForm = document.getElementById('productForm');
const productMessage = document.getElementById('productMessage');
const productIdInput = document.getElementById('productId');
const productClearButton = document.getElementById('productClear');
const productDeleteButton = document.getElementById('productDelete');
const settingsForm = document.getElementById('settingsForm');
const settingsMessage = document.getElementById('settingsMessage');
const settingsMomoProvider = document.getElementById('settingsMomoProvider');
const settingsMomoNumber = document.getElementById('settingsMomoNumber');
const settingsMomoName = document.getElementById('settingsMomoName');
const settingsBankName = document.getElementById('settingsBankName');
const settingsBankAccount = document.getElementById('settingsBankAccount');
const settingsBankAccountName = document.getElementById('settingsBankAccountName');
const settingsProofRequired = document.getElementById('settingsProofRequired');
const tabButtons = document.querySelectorAll('.tab');
const tabPanels = document.querySelectorAll('.tab-panel');
const authError = document.getElementById('authError');
const topbarActions = document.getElementById('topbarActions');
const exportCsvButton = document.getElementById('exportCsv');
const signOutButton = document.getElementById('signOut');

let auth = null;
let db = null;
let storage = null;
let configReady = true;

if (!window.firebaseConfig || !window.firebaseConfig.apiKey || window.firebaseConfig.apiKey === 'YOUR_API_KEY') {
  authError.hidden = false;
  authError.textContent = 'Missing Firebase config. Update public/crm/config.js with your Firebase web app settings.';
  configReady = false;
}

if (configReady) {
  firebase.initializeApp(window.firebaseConfig);
  auth = firebase.auth();
  db = firebase.firestore();
  storage = firebase.storage();
}

let activeLeadId = null;
let unsubscribeLeads = null;
let activeOrderId = null;
let unsubscribeOrders = null;
let activeProductId = null;
let unsubscribeProducts = null;
let unsubscribeSettings = null;

function handleTabChange(targetTab) {
  tabButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === targetTab);
  });
  tabPanels.forEach((panel) => {
    panel.classList.toggle('active', panel.id === `${targetTab}Panel`);
  });
}

tabButtons.forEach((button) => {
  button.addEventListener('click', () => handleTabChange(button.dataset.tab));
});

function showAuthError(message) {
  authError.hidden = false;
  authError.textContent = message;
}

function clearAuthError() {
  authError.hidden = true;
  authError.textContent = '';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => {
    if (char === '&') return '&amp;';
    if (char === '<') return '&lt;';
    if (char === '>') return '&gt;';
    if (char === '"') return '&quot;';
    return '&#39;';
  });
}

function safeText(value, fallback = '') {
  const escaped = escapeHtml(value);
  return escaped || fallback;
}

function renderLeadItem(lead) {
  const item = document.createElement('div');
  item.className = 'lead-item';
  item.dataset.id = lead.id;
  item.innerHTML = `
    <strong>${safeText(lead.name, 'Unknown')}</strong>
    <div>${safeText(lead.service, 'General inquiry')}</div>
    <div class="meta">${safeText(lead.phone, 'No phone')} · ${safeText(lead.status, 'New')}</div>
  `;
  item.addEventListener('click', () => selectLead(lead.id));
  return item;
}

function renderOrderItem(order) {
  const item = document.createElement('div');
  item.className = 'lead-item';
  item.dataset.id = order.id;
  item.innerHTML = `
    <strong>${safeText(order.customer?.name, 'Unknown')}</strong>
    <div>GHS ${Number(order.subtotalGhs || 0).toLocaleString()}</div>
    <div class="meta">${safeText(order.paymentMethod, 'Payment pending')} · ${safeText(order.status, 'New')}</div>
  `;
  item.addEventListener('click', () => selectOrder(order.id));
  return item;
}

function renderProductItem(product) {
  const item = document.createElement('div');
  item.className = 'lead-item';
  item.dataset.id = product.id;
  item.innerHTML = `
    <strong>${safeText(product.name, 'Untitled')}</strong>
    <div>${safeText(product.category, 'Uncategorized')}</div>
    <div class="meta">GHS ${Number(product.priceGhs || 0).toLocaleString()} · ${product.active === false ? 'Hidden' : 'Active'}</div>
  `;
  item.addEventListener('click', () => selectProduct(product.id));
  return item;
}

function renderLeadDetail(lead, notes) {
  if (!lead) {
    leadDetail.innerHTML = '<div class="empty">Select a lead to view details.</div>';
    return;
  }

  const createdAt = lead.createdAt && lead.createdAt.toDate ? lead.createdAt.toDate() : null;
  const createdLabel = createdAt ? createdAt.toLocaleString() : 'Pending';

  const leadName = safeText(lead.name, 'Lead');
  const leadPhone = safeText(lead.phone, 'N/A');
  const leadEmail = safeText(lead.email, 'N/A');
  const leadService = safeText(lead.service, 'N/A');
  const leadCompany = safeText(lead.company, 'N/A');
  const leadLocation = safeText(lead.location, 'N/A');
  const leadBudget = safeText(lead.budget, 'N/A');
  const leadTimeline = safeText(lead.timeline, 'N/A');
  const leadReferral = safeText(lead.referral, 'N/A');
  const leadMessage = safeText(lead.message);
  const leadPageUrl = safeText(lead.pageUrl);

  const attachmentsHtml = (lead.attachments || []).map((file, index) => {
    const storagePath = safeText(file.storagePath);
    const originalName = safeText(file.originalName, 'Attachment');
    return `<div><a href="#" data-storage="${storagePath}" data-index="${index}" class="attachment-link">${originalName}</a></div>`;
  }).join('');

  const notesHtml = notes.map((note) => {
    const noteDate = note.createdAt && note.createdAt.toDate ? note.createdAt.toDate().toLocaleString() : '';
    return `<div class="note-item"><div>${safeText(note.text)}</div><div class="muted">${safeText(note.createdBy, 'Unknown')} · ${safeText(noteDate)}</div></div>`;
  }).join('');

  leadDetail.innerHTML = `
    <div class="lead-detail">
      <div>
        <h2>${leadName}</h2>
        <div class="muted">Created ${safeText(createdLabel, 'Pending')}</div>
      </div>
      <div class="detail-grid">
        <div><strong>Phone</strong><br>${leadPhone}</div>
        <div><strong>Email</strong><br>${leadEmail}</div>
        <div><strong>Service</strong><br>${leadService}</div>
        <div><strong>Company</strong><br>${leadCompany}</div>
        <div><strong>Location</strong><br>${leadLocation}</div>
        <div><strong>Budget</strong><br>${leadBudget}</div>
        <div><strong>Timeline</strong><br>${leadTimeline}</div>
        <div><strong>Referral</strong><br>${leadReferral}</div>
      </div>
      <div>
        <strong>Message</strong>
        <p>${leadMessage}</p>
        <p class="muted">${leadPageUrl}</p>
      </div>
      <div class="detail-actions">
        <label>
          Status
          <select id="leadStatus">
            ${statusOptions.map(option => `<option value="${option}">${option}</option>`).join('')}
          </select>
        </label>
      </div>
      <div>
        <strong>Attachments</strong>
        <div class="muted">${attachmentsHtml || 'No files uploaded.'}</div>
      </div>
      <div class="notes">
        <strong>Notes</strong>
        <div id="notesList">${notesHtml || '<div class="muted">No notes yet.</div>'}</div>
        <textarea id="newNote" rows="3" placeholder="Add a note..."></textarea>
        <button class="btn" id="saveNote">Add note</button>
      </div>
    </div>
  `;

  const statusSelect = leadDetail.querySelector('#leadStatus');
  statusSelect.value = lead.status || 'New';
  statusSelect.addEventListener('change', () => updateStatus(lead.id, statusSelect.value));

  const saveNoteButton = leadDetail.querySelector('#saveNote');
  saveNoteButton.addEventListener('click', () => addNote(lead.id));

  const attachments = leadDetail.querySelectorAll('.attachment-link');
  attachments.forEach((link) => {
    link.addEventListener('click', async (event) => {
      event.preventDefault();
      const storagePath = link.dataset.storage;
      const url = await storage.ref(storagePath).getDownloadURL();
      window.open(url, '_blank');
    });
  });
}

function renderOrderDetail(order, notes) {
  if (!order) {
    orderDetail.innerHTML = '<div class="empty">Select an order to view details.</div>';
    return;
  }

  const createdAt = order.createdAt && order.createdAt.toDate ? order.createdAt.toDate() : null;
  const createdLabel = createdAt ? createdAt.toLocaleString() : 'Pending';

  const orderName = safeText(order.customer?.name, 'Order');
  const orderPhone = safeText(order.customer?.phone, 'N/A');
  const orderEmail = safeText(order.customer?.email, 'N/A');
  const orderCity = safeText(order.customer?.city, 'N/A');
  const orderAddress = safeText(order.customer?.address, 'N/A');
  const orderPaymentMethod = safeText(order.paymentMethod, 'N/A');
  const orderCurrency = safeText(order.currencyDisplay, 'GHS');
  const orderNote = safeText(order.note);
  const orderPageUrl = safeText(order.pageUrl);

  const itemsHtml = (order.items || []).map((item) => {
    return `
      <div class="order-item-row">
        <span>${safeText(item.name)} x${Math.max(1, Number(item.quantity) || 1)}</span>
        <strong>GHS ${Number(item.priceGhs || 0).toLocaleString()}</strong>
      </div>
    `;
  }).join('');

  const proofHtml = (order.proofFiles || []).map((file, index) => {
    const storagePath = safeText(file.storagePath);
    const originalName = safeText(file.originalName, 'Proof file');
    return `<div><a href="#" data-storage="${storagePath}" data-index="${index}" class="order-attachment">${originalName}</a></div>`;
  }).join('');

  const notesHtml = notes.map((note) => {
    const noteDate = note.createdAt && note.createdAt.toDate ? note.createdAt.toDate().toLocaleString() : '';
    return `<div class="note-item"><div>${safeText(note.text)}</div><div class="muted">${safeText(note.createdBy, 'Unknown')} · ${safeText(noteDate)}</div></div>`;
  }).join('');

  orderDetail.innerHTML = `
    <div class="lead-detail">
      <div>
        <h2>${orderName}</h2>
        <div class="muted">Created ${safeText(createdLabel, 'Pending')}</div>
      </div>
      <div class="detail-grid">
        <div><strong>Phone</strong><br>${orderPhone}</div>
        <div><strong>Email</strong><br>${orderEmail}</div>
        <div><strong>City</strong><br>${orderCity}</div>
        <div><strong>Address</strong><br>${orderAddress}</div>
        <div><strong>Payment</strong><br>${orderPaymentMethod}</div>
        <div><strong>Display Currency</strong><br>${orderCurrency}</div>
      </div>
      <div>
        <strong>Items</strong>
        <div class="order-items">${itemsHtml || '<div class="muted">No items.</div>'}</div>
        <div class="muted" style="margin-top: 8px;">Subtotal: GHS ${Number(order.subtotalGhs || 0).toLocaleString()}</div>
      </div>
      <div>
        <strong>Proof of payment</strong>
        <div class="muted">${proofHtml || 'No proof uploaded.'}</div>
      </div>
      <div>
        <strong>Notes</strong>
        <p>${orderNote}</p>
        <p class="muted">${orderPageUrl}</p>
      </div>
      <div class="detail-actions">
        <label>
          Status
          <select id="orderStatus">
            ${orderStatusOptions.map(option => `<option value="${option}">${option}</option>`).join('')}
          </select>
        </label>
      </div>
      <div class="notes">
        <strong>Order Notes</strong>
        <div id="orderNotesList">${notesHtml || '<div class="muted">No notes yet.</div>'}</div>
        <textarea id="newOrderNote" rows="3" placeholder="Add a note..."></textarea>
        <button class="btn" id="saveOrderNote">Add note</button>
      </div>
    </div>
  `;

  const statusSelect = orderDetail.querySelector('#orderStatus');
  statusSelect.value = order.status || 'New';
  statusSelect.addEventListener('change', () => updateOrderStatus(order.id, statusSelect.value));

  const saveNoteButton = orderDetail.querySelector('#saveOrderNote');
  saveNoteButton.addEventListener('click', () => addOrderNote(order.id));

  const attachments = orderDetail.querySelectorAll('.order-attachment');
  attachments.forEach((link) => {
    link.addEventListener('click', async (event) => {
      event.preventDefault();
      const storagePath = link.dataset.storage;
      const url = await storage.ref(storagePath).getDownloadURL();
      window.open(url, '_blank');
    });
  });
}

async function selectLead(leadId) {
  activeLeadId = leadId;
  const leadDoc = await db.collection('leads').doc(leadId).get();
  const notesSnapshot = await db.collection('leads').doc(leadId).collection('notes').orderBy('createdAt', 'desc').get();

  const notes = notesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  renderLeadDetail({ id: leadDoc.id, ...leadDoc.data() }, notes);

  document.querySelectorAll('.lead-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.id === leadId);
  });
}

async function selectOrder(orderId) {
  activeOrderId = orderId;
  const orderDoc = await db.collection('orders').doc(orderId).get();
  const notesSnapshot = await db.collection('orders').doc(orderId).collection('notes').orderBy('createdAt', 'desc').get();

  const notes = notesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  renderOrderDetail({ id: orderDoc.id, ...orderDoc.data() }, notes);

  document.querySelectorAll('#orderList .lead-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.id === orderId);
  });
}

async function selectProduct(productId) {
  activeProductId = productId;
  const productDoc = await db.collection('products').doc(productId).get();
  const product = { id: productDoc.id, ...productDoc.data() };

  productIdInput.value = product.id;
  document.getElementById('productName').value = product.name || '';
  document.getElementById('productCategory').value = product.category || '';
  document.getElementById('productPrice').value = product.priceGhs || 0;
  document.getElementById('productLeadTime').value = product.leadTime || '';
  document.getElementById('productImage').value = product.image || '';
  document.getElementById('productDescription').value = product.description || '';
  document.getElementById('productActive').checked = product.active !== false;

  document.querySelectorAll('#productList .lead-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.id === productId);
  });
}

function resetProductForm() {
  activeProductId = null;
  productIdInput.value = '';
  productForm.reset();
  document.getElementById('productActive').checked = true;
  productMessage.hidden = true;
}

async function saveProduct(event) {
  event.preventDefault();
  productMessage.hidden = true;

  const payload = {
    name: document.getElementById('productName').value.trim(),
    category: document.getElementById('productCategory').value.trim(),
    priceGhs: Number(document.getElementById('productPrice').value || 0),
    leadTime: document.getElementById('productLeadTime').value.trim(),
    image: document.getElementById('productImage').value.trim(),
    description: document.getElementById('productDescription').value.trim(),
    active: document.getElementById('productActive').checked,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  if (!payload.name || !payload.category || !payload.priceGhs || !payload.leadTime || !payload.image || !payload.description) {
    productMessage.hidden = false;
    productMessage.style.background = 'rgba(255, 59, 48, 0.1)';
    productMessage.textContent = 'Please complete all fields.';
    return;
  }

  try {
    if (activeProductId) {
      await db.collection('products').doc(activeProductId).update(payload);
    } else {
      await db.collection('products').add({
        ...payload,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }

    productMessage.hidden = false;
    productMessage.style.background = 'rgba(76, 175, 80, 0.15)';
    productMessage.textContent = 'Product saved successfully.';
    resetProductForm();
  } catch (error) {
    console.error(error);
    productMessage.hidden = false;
    productMessage.style.background = 'rgba(255, 59, 48, 0.1)';
    productMessage.textContent = 'Unable to save product.';
  }
}

async function deleteProduct() {
  if (!activeProductId) return;
  const confirmed = window.confirm('Delete this product?');
  if (!confirmed) return;

  try {
    await db.collection('products').doc(activeProductId).delete();
    resetProductForm();
  } catch (error) {
    console.error(error);
    productMessage.hidden = false;
    productMessage.style.background = 'rgba(255, 59, 48, 0.1)';
    productMessage.textContent = 'Unable to delete product.';
  }
}

function fillSettingsForm(data) {
  settingsMomoProvider.value = data?.momoProvider || 'MTN Mobile Money';
  settingsMomoNumber.value = data?.momoNumber || '';
  settingsMomoName.value = data?.momoName || 'Edward Sarpong Enterprise';
  settingsBankName.value = data?.bankName || '';
  settingsBankAccount.value = data?.bankAccountNumber || '';
  settingsBankAccountName.value = data?.bankAccountName || 'Edward Sarpong Enterprise';
  settingsProofRequired.checked = data?.proofRequired === true;
}

async function saveSettings(event) {
  event.preventDefault();
  settingsMessage.hidden = true;

  const payload = {
    momoProvider: settingsMomoProvider.value.trim(),
    momoNumber: settingsMomoNumber.value.trim(),
    momoName: settingsMomoName.value.trim(),
    bankName: settingsBankName.value.trim(),
    bankAccountNumber: settingsBankAccount.value.trim(),
    bankAccountName: settingsBankAccountName.value.trim(),
    proofRequired: settingsProofRequired.checked,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  if (!payload.momoProvider || !payload.momoNumber || !payload.momoName || !payload.bankName || !payload.bankAccountNumber || !payload.bankAccountName) {
    settingsMessage.hidden = false;
    settingsMessage.style.background = 'rgba(255, 59, 48, 0.1)';
    settingsMessage.textContent = 'Please complete all payment fields.';
    return;
  }

  try {
    await db.collection('settings').doc('payments').set(payload, { merge: true });
    settingsMessage.hidden = false;
    settingsMessage.style.background = 'rgba(76, 175, 80, 0.15)';
    settingsMessage.textContent = 'Settings saved.';
  } catch (error) {
    console.error(error);
    settingsMessage.hidden = false;
    settingsMessage.style.background = 'rgba(255, 59, 48, 0.1)';
    settingsMessage.textContent = 'Unable to save settings.';
  }
}

async function updateStatus(leadId, status) {
  await db.collection('leads').doc(leadId).update({ status });
}

async function updateOrderStatus(orderId, status) {
  await db.collection('orders').doc(orderId).update({ status });
}

async function addNote(leadId) {
  const noteInput = document.getElementById('newNote');
  const text = noteInput.value.trim();
  if (!text) return;

  await db.collection('leads').doc(leadId).collection('notes').add({
    text,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    createdBy: auth.currentUser ? auth.currentUser.email || auth.currentUser.uid : 'Unknown'
  });

  noteInput.value = '';
  await selectLead(leadId);
}

async function addOrderNote(orderId) {
  const noteInput = document.getElementById('newOrderNote');
  const text = noteInput.value.trim();
  if (!text) return;

  await db.collection('orders').doc(orderId).collection('notes').add({
    text,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    createdBy: auth.currentUser ? auth.currentUser.email || auth.currentUser.uid : 'Unknown'
  });

  noteInput.value = '';
  await selectOrder(orderId);
}

function renderLeads(snapshot) {
  leadList.innerHTML = '';
  const leads = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  leadCount.textContent = String(leads.length);

  leads.forEach((lead) => {
    leadList.appendChild(renderLeadItem(lead));
  });

  if (leads.length && !activeLeadId) {
    selectLead(leads[0].id);
  }
}

function renderOrders(snapshot) {
  orderList.innerHTML = '';
  const orders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  orderCount.textContent = String(orders.length);

  orders.forEach((order) => {
    orderList.appendChild(renderOrderItem(order));
  });

  if (orders.length && !activeOrderId) {
    selectOrder(orders[0].id);
  }
}

function renderProducts(snapshot) {
  productList.innerHTML = '';
  const productsSnapshot = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  productCount.textContent = String(productsSnapshot.length);

  productsSnapshot.forEach((product) => {
    productList.appendChild(renderProductItem(product));
  });
}

function startLeadListener() {
  if (unsubscribeLeads) unsubscribeLeads();
  unsubscribeLeads = db.collection('leads').orderBy('createdAt', 'desc').limit(200)
    .onSnapshot(renderLeads, (error) => console.error(error));
}

function startOrderListener() {
  if (unsubscribeOrders) unsubscribeOrders();
  unsubscribeOrders = db.collection('orders').orderBy('createdAt', 'desc').limit(200)
    .onSnapshot(renderOrders, (error) => console.error(error));
}

function startProductListener() {
  if (unsubscribeProducts) unsubscribeProducts();
  unsubscribeProducts = db.collection('products').orderBy('name')
    .onSnapshot(renderProducts, (error) => console.error(error));
}

function startSettingsListener() {
  if (unsubscribeSettings) unsubscribeSettings();
  unsubscribeSettings = db.collection('settings').doc('payments')
    .onSnapshot((doc) => fillSettingsForm(doc.data() || {}), (error) => console.error(error));
}

function downloadCsv(rows) {
  const csvContent = rows.map(row => row.map(field => `"${String(field || '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

async function exportCsv() {
  const snapshot = await db.collection('leads').orderBy('createdAt', 'desc').get();
  const headers = ['Name', 'Phone', 'Email', 'Service', 'Status', 'Location', 'Budget', 'Timeline', 'Referral', 'Company', 'Message', 'Page URL', 'Created At'];
  const rows = [headers];
  snapshot.docs.forEach((doc) => {
    const lead = doc.data();
    const createdAt = lead.createdAt && lead.createdAt.toDate ? lead.createdAt.toDate().toISOString() : '';
    rows.push([
      lead.name,
      lead.phone,
      lead.email,
      lead.service,
      lead.status,
      lead.location,
      lead.budget,
      lead.timeline,
      lead.referral,
      lead.company,
      lead.message,
      lead.pageUrl,
      createdAt
    ]);
  });

  downloadCsv(rows);
}

if (configReady) {
  exportCsvButton.addEventListener('click', exportCsv);

  signOutButton.addEventListener('click', () => auth.signOut());

  const loginForm = document.getElementById('emailLogin');
  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearAuthError();
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value.trim();

    try {
      await auth.signInWithEmailAndPassword(email, password);
    } catch (error) {
      showAuthError(error.message);
    }
  });

  const googleLogin = document.getElementById('googleLogin');
  googleLogin.addEventListener('click', async () => {
    clearAuthError();
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      await auth.signInWithPopup(provider);
    } catch (error) {
      showAuthError(error.message);
    }
  });

  const resetView = () => {
    authCard.hidden = false;
    crmApp.hidden = true;
    topbarActions.hidden = true;
    leadList.innerHTML = '';
    leadDetail.innerHTML = '<div class="empty">Select a lead to view details.</div>';
    orderList.innerHTML = '';
    orderDetail.innerHTML = '<div class="empty">Select an order to view details.</div>';
    productList.innerHTML = '';
    resetProductForm();
    settingsMessage.hidden = true;
  };

  productForm.addEventListener('submit', saveProduct);
  productClearButton.addEventListener('click', resetProductForm);
  productDeleteButton.addEventListener('click', deleteProduct);
  settingsForm.addEventListener('submit', saveSettings);

  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      resetView();
      return;
    }

    try {
      const userDoc = await db.collection('crm_users').doc(user.uid).get();
      if (!userDoc.exists) {
        showAuthError('Access pending. Ask an admin to add your account in CRM access.');
        await auth.signOut();
        resetView();
        return;
      }

      authCard.hidden = true;
      crmApp.hidden = false;
      topbarActions.hidden = false;
      startLeadListener();
      startOrderListener();
      startProductListener();
      startSettingsListener();
    } catch (error) {
      console.error(error);
      showAuthError('Unable to verify access. Please try again.');
      resetView();
    }
  });
}
