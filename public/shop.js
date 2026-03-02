const productsUrl = 'data/products.json';
const orderEndpoint = 'https://us-central1-edward-sarpong-official.cloudfunctions.net/submitOrder';
const currencySelect = document.getElementById('currency');
const rateNote = document.getElementById('rateNote');
const productGrid = document.getElementById('productGrid');
const cartItems = document.getElementById('cartItems');
const cartSubtotal = document.getElementById('cartSubtotal');
const cartSavings = document.getElementById('cartSavings');
const cartItemCount = document.getElementById('cartItemCount');
const savedItems = document.getElementById('savedItems');
const checkoutForm = document.getElementById('checkoutForm');
const orderMessage = document.getElementById('orderMessage');
const paymentProofInput = document.getElementById('paymentProof');
const paymentDetailsContainer = document.getElementById('paymentDetails');
const cartToggle = document.getElementById('cartToggle');
const cartDrawer = document.getElementById('cartDrawer');
const cartOverlay = document.getElementById('cartOverlay');
const cartClose = document.getElementById('cartClose');
const cartBadge = document.getElementById('cartBadge');

const defaultPaymentDetails = {
  momo: { provider: 'MTN Mobile Money', number: 'ADD_MOMO_NUMBER', name: 'Edward Sarpong Enterprise' },
  bank: { bankName: 'ADD_BANK_NAME', accountName: 'Edward Sarpong Enterprise', accountNumber: 'ADD_ACCOUNT_NUMBER' },
  proofRequired: false
};

let paymentDetails = { ...defaultPaymentDetails };

const firebaseConfig = window.firebaseShopConfig;
let db = null;
let configReady = false;

if (typeof firebase !== 'undefined' && firebaseConfig && firebaseConfig.apiKey && firebaseConfig.apiKey !== 'YOUR_API_KEY') {
  firebase.initializeApp(firebaseConfig);
  db = firebase.firestore();
  configReady = true;
}

let products = [];
let cart = JSON.parse(localStorage.getItem('eseCart') || '[]');
let saved = JSON.parse(localStorage.getItem('eseSaved') || '[]');
let rates = { GHS: 1 };

// Filter state
let activeCategory = 'All';
let searchQuery = '';
let sortOrder = 'featured';
let inStockOnly = false;

// Modal state
let modalActiveProduct = null;
let modalSelectedVariants = {};
let modalPriceAddon = 0;

// ─── Formatting helpers ────────────────────────────────────────────────────────

function formatMoney(amount, currency) {
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency', currency: currency, maximumFractionDigits: 0
  });
  return formatter.format(amount);
}

function getDisplayPrice(priceGhs, currency) {
  const rate = rates[currency] || 1;
  return priceGhs * rate;
}

function renderStars(rating) {
  const n = Math.round(rating * 2) / 2;
  let s = '';
  for (let i = 1; i <= 5; i++) {
    if (i <= n) s += '★';
    else if (i - 0.5 <= n) s += '½';
    else s += '☆';
  }
  return s;
}

function stockBadgeClass(stock) {
  if (stock === 'In Stock') return 'badge-in-stock';
  if (stock === 'Limited Stock') return 'badge-limited';
  if (stock === 'Out of Stock') return 'badge-out-of-stock';
  return 'badge-order';
}

function parseVariantAddon(optionText) {
  const match = String(optionText).match(/\+GHS(\d+)/);
  return match ? Number(match[1]) : 0;
}

// ─── Cart helpers ──────────────────────────────────────────────────────────────

function saveCart() {
  localStorage.setItem('eseCart', JSON.stringify(cart));
  localStorage.setItem('eseSaved', JSON.stringify(saved));
}

function updateCartBadge() {
  if (!cartBadge) return;
  const total = cart.reduce((sum, item) => sum + item.quantity, 0);
  cartBadge.textContent = String(total);
}

function toggleCartDrawer(isOpen) {
  if (!cartDrawer || !cartOverlay || !cartToggle) return;
  cartDrawer.classList.toggle('open', isOpen);
  cartDrawer.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
  cartOverlay.hidden = !isOpen;
  cartToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
}

function findProduct(productId) {
  return products.find(product => product.id === productId);
}

function updateQuantity(productId, delta) {
  const item = cart.find(entry => entry.id === productId);
  if (!item) return;
  const nextQuantity = item.quantity + delta;
  if (nextQuantity <= 0) { removeFromCart(productId); return; }
  item.quantity = nextQuantity;
  saveCart();
  updateCartDisplay();
}

function updateCartDisplay() {
  updateCartBadge();
  const currency = currencySelect.value;

  if (savedItems) {
    if (!saved.length) {
      savedItems.innerHTML = '<div class="muted">No saved items.</div>';
    } else {
      savedItems.innerHTML = '';
      saved.forEach((item) => {
        const product = findProduct(item.id);
        const image = item.image || product?.image || 'https://images.unsplash.com/photo-1484154218962-a197022b5858?auto=format&fit=crop&w=300&q=80';
        const row = document.createElement('div');
        row.className = 'saved-item';
        row.innerHTML = `
          <img src="${image}" alt="${item.name}" loading="lazy">
          <div>
            <strong>${item.name}</strong>
            <div class="muted">${formatMoney(getDisplayPrice(item.priceGhs, currency), currency)}</div>
          </div>
          <button class="btn" type="button" data-action="restore" data-id="${item.id}">Move to cart</button>
        `;
        row.querySelector('button').addEventListener('click', () => restoreFromSaved(item.id));
        savedItems.appendChild(row);
      });
    }
  }

  if (!cart.length) {
    cartItems.innerHTML = '<div class="muted">Your cart is empty.</div>';
    cartSubtotal.textContent = formatMoney(0, currency);
    if (cartSavings) cartSavings.textContent = formatMoney(0, currency);
    if (cartItemCount) cartItemCount.textContent = '0 items';
    return;
  }

  let subtotalGhs = 0;
  let savingsGhs = 0;

  cartItems.innerHTML = '';
  cart.forEach((item) => {
    const product = findProduct(item.id);
    const image = item.image || product?.image || 'https://images.unsplash.com/photo-1484154218962-a197022b5858?auto=format&fit=crop&w=300&q=80';
    const leadTime = item.leadTime || product?.leadTime || 'Made to order';
    const discount = Number(item.discountGhs || 0);
    subtotalGhs += item.priceGhs * item.quantity;
    savingsGhs += discount * item.quantity;
    const display = getDisplayPrice(item.priceGhs * item.quantity, currency);

    const variantText = item.selectedVariants
      ? Object.entries(item.selectedVariants).map(([k, v]) => `${k}: ${v}`).join(' · ')
      : '';

    const row = document.createElement('div');
    row.className = 'cart-item';
    row.innerHTML = `
      <img class="cart-item-thumb" src="${image}" alt="${item.name}" loading="lazy">
      <div class="cart-item-info">
        <strong>${item.name}</strong>
        ${variantText ? `<div class="muted variant-summary">${variantText}</div>` : ''}
        <div class="muted">Delivery estimate: ${leadTime}</div>
        <div class="muted">${formatMoney(getDisplayPrice(item.priceGhs, currency), currency)} each</div>
        ${discount > 0 ? `<div class="muted">Savings: ${formatMoney(getDisplayPrice(discount, currency), currency)}</div>` : ''}
      </div>
      <div class="cart-item-actions">
        <div class="qty-controls">
          <button type="button" data-action="decrease" data-id="${item.id}">-</button>
          <span>${item.quantity}</span>
          <button type="button" data-action="increase" data-id="${item.id}">+</button>
        </div>
        <div class="cart-item-total">${formatMoney(display, currency)}</div>
        <div class="cart-item-links">
          <button data-id="${item.id}" data-action="remove" class="link-button" type="button">Remove</button>
          <button data-id="${item.id}" data-action="save" class="link-button" type="button">Save for later</button>
        </div>
      </div>
    `;
    row.querySelectorAll('button').forEach((button) => {
      const action = button.dataset.action;
      if (!action) return;
      button.addEventListener('click', () => {
        if (action === 'increase') updateQuantity(item.id, 1);
        if (action === 'decrease') updateQuantity(item.id, -1);
        if (action === 'remove') removeFromCart(item.id);
        if (action === 'save') saveForLater(item.id);
      });
    });
    cartItems.appendChild(row);
  });

  cartSubtotal.textContent = formatMoney(getDisplayPrice(subtotalGhs, currency), currency);
  if (cartSavings) cartSavings.textContent = formatMoney(getDisplayPrice(savingsGhs, currency), currency);
  if (cartItemCount) cartItemCount.textContent = `${cart.reduce((sum, item) => sum + item.quantity, 0)} items`;
}

function addToCart(product, selectedVariants, variantAddon) {
  const effectivePriceGhs = product.priceGhs + (variantAddon || 0);
  const cartKey = selectedVariants
    ? `${product.id}::${JSON.stringify(selectedVariants)}`
    : product.id;

  const existing = cart.find(entry => entry.cartKey === cartKey);
  if (existing) {
    existing.quantity += 1;
  } else {
    cart.push({
      id: product.id,
      cartKey,
      name: product.name,
      priceGhs: effectivePriceGhs,
      discountGhs: product.discountGhs || 0,
      image: product.image,
      leadTime: product.leadTime,
      selectedVariants: selectedVariants || null,
      quantity: 1
    });
  }
  saveCart();
  updateCartDisplay();
}

function removeFromCart(productId) {
  cart = cart.filter(item => item.id !== productId);
  saveCart();
  updateCartDisplay();
}

function saveForLater(productId) {
  const item = cart.find(entry => entry.id === productId);
  if (!item) return;
  cart = cart.filter(entry => entry.id !== productId);
  saved.push(item);
  saveCart();
  updateCartDisplay();
}

function restoreFromSaved(productId) {
  const item = saved.find(entry => entry.id === productId);
  if (!item) return;
  saved = saved.filter(entry => entry.id !== productId);
  const existing = cart.find(entry => entry.id === productId);
  if (existing) { existing.quantity += item.quantity; } else { cart.push(item); }
  saveCart();
  updateCartDisplay();
}

// ─── Filter & search ───────────────────────────────────────────────────────────

function getFilteredProducts() {
  let list = [...products];
  if (activeCategory !== 'All') list = list.filter(p => p.category === activeCategory);
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.description || '').toLowerCase().includes(q) ||
      (p.category || '').toLowerCase().includes(q)
    );
  }
  if (inStockOnly) list = list.filter(p => p.stock === 'In Stock' || p.stock === 'Limited Stock');
  if (sortOrder === 'price-asc') list.sort((a, b) => a.priceGhs - b.priceGhs);
  if (sortOrder === 'price-desc') list.sort((a, b) => b.priceGhs - a.priceGhs);
  if (sortOrder === 'name-asc') list.sort((a, b) => a.name.localeCompare(b.name));
  return list;
}

function renderProducts() {
  const currency = currencySelect.value;
  const filtered = getFilteredProducts();
  productGrid.innerHTML = '';

  if (!filtered.length) {
    productGrid.innerHTML = '<div class="no-results">No products match your search.</div>';
    return;
  }

  filtered.forEach((product) => {
    const card = document.createElement('div');
    card.className = 'product-card';
    const displayPrice = getDisplayPrice(product.priceGhs, currency);
    const hasDiscount = product.discountGhs > 0;
    const stockHtml = product.stock
      ? `<span class="stock-badge ${stockBadgeClass(product.stock)}">${product.stock}</span>`
      : '';
    const starsHtml = product.rating
      ? `<span class="stars">${renderStars(product.rating)}</span>&nbsp;<span class="muted">(${product.reviews || 0})</span>`
      : '';

    card.innerHTML = `
      <div class="product-img-wrap">
        ${stockHtml}
        <img src="${product.image}" alt="${product.name}" loading="lazy">
      </div>
      <div class="product-content">
        <div class="product-meta">
          <span>${product.category}</span>
          <span>${product.leadTime}</span>
        </div>
        <strong class="product-name">${product.name}</strong>
        <p class="product-desc muted">${product.description}</p>
        <div class="product-rating">${starsHtml}</div>
        <div class="product-price-row">
          <span class="product-price">${formatMoney(displayPrice, currency)}</span>
          ${hasDiscount ? `<span class="product-old-price">${formatMoney(getDisplayPrice(product.priceGhs + product.discountGhs, currency), currency)}</span>` : ''}
        </div>
        <div class="product-actions">
          <button class="btn btn-outline" type="button" data-action="view">Details</button>
          <button class="btn" type="button" data-action="add">Add to Cart</button>
        </div>
      </div>
    `;
    card.querySelector('[data-action="view"]').addEventListener('click', () => showModal(product));
    card.querySelector('[data-action="add"]').addEventListener('click', () => addToCart(product));
    productGrid.appendChild(card);
  });
}

// ─── Product modal ─────────────────────────────────────────────────────────────

function showModal(product) {
  modalActiveProduct = product;
  modalSelectedVariants = {};
  modalPriceAddon = 0;

  const modal = document.getElementById('productModal');
  const currency = currencySelect.value;

  document.getElementById('modalName').textContent = product.name;
  document.getElementById('modalCategory').textContent = product.category;
  document.getElementById('modalDescription').textContent = product.description || '';
  document.getElementById('modalLeadTime').textContent = `Lead time: ${product.leadTime}`;

  const stockBadge = document.getElementById('modalStockBadge');
  stockBadge.textContent = product.stock || '';
  stockBadge.className = `stock-badge ${stockBadgeClass(product.stock || '')}`;

  document.getElementById('modalStars').textContent = product.rating ? renderStars(product.rating) : '';
  document.getElementById('modalReviews').textContent = product.reviews ? `${product.reviews} reviews` : '';

  // Gallery
  const mainImg = document.getElementById('modalMainImg');
  mainImg.src = product.image;
  mainImg.alt = product.name;
  const thumbs = document.getElementById('modalThumbs');
  thumbs.innerHTML = '';
  const allImages = product.images && product.images.length ? product.images : [product.image];
  allImages.forEach((src, i) => {
    const thumb = document.createElement('img');
    thumb.src = src;
    thumb.alt = `${product.name} photo ${i + 1}`;
    thumb.className = i === 0 ? 'modal-thumb active' : 'modal-thumb';
    thumb.addEventListener('click', () => {
      mainImg.src = src;
      thumbs.querySelectorAll('.modal-thumb').forEach(t => t.classList.remove('active'));
      thumb.classList.add('active');
    });
    thumbs.appendChild(thumb);
  });

  // Dimensions
  const dimEl = document.getElementById('modalDimensions');
  dimEl.innerHTML = product.dimensions ? `<strong>Dimensions:</strong> ${product.dimensions}` : '';

  // Materials
  const matEl = document.getElementById('modalMaterials');
  matEl.innerHTML = '';
  if (product.materials && product.materials.length) {
    matEl.innerHTML = '<strong>Materials:</strong>';
    product.materials.forEach(m => {
      const tag = document.createElement('span');
      tag.className = 'material-tag';
      tag.textContent = m;
      matEl.appendChild(tag);
    });
  }

  // Variants
  const variantEl = document.getElementById('modalVariants');
  variantEl.innerHTML = '';
  if (product.variants && product.variants.length) {
    product.variants.forEach(v => {
      modalSelectedVariants[v.label] = v.options[0];
      const group = document.createElement('div');
      group.className = 'variant-group';
      const labelEl = document.createElement('label');
      labelEl.textContent = v.label;
      const sel = document.createElement('select');
      sel.className = 'variant-select';
      v.options.forEach(opt => {
        const option = document.createElement('option');
        option.value = opt;
        option.textContent = opt;
        sel.appendChild(option);
      });
      sel.addEventListener('change', () => {
        modalSelectedVariants[v.label] = sel.value;
        updateModalPrice();
      });
      group.appendChild(labelEl);
      group.appendChild(sel);
      variantEl.appendChild(group);
    });
  }

  // Features
  const featEl = document.getElementById('modalFeatures');
  featEl.innerHTML = '';
  if (product.features && product.features.length) {
    featEl.innerHTML = '<ul class="feature-list">' + product.features.map(f => `<li>${f}</li>`).join('') + '</ul>';
  }

  updateModalPrice();
  modal.showModal();
}

function updateModalPrice() {
  if (!modalActiveProduct) return;
  const currency = currencySelect.value;
  let addon = 0;
  Object.values(modalSelectedVariants).forEach(opt => { addon += parseVariantAddon(opt); });
  modalPriceAddon = addon;
  const total = modalActiveProduct.priceGhs + addon;
  document.getElementById('modalPrice').textContent = formatMoney(getDisplayPrice(total, currency), currency);
  const hasDiscount = modalActiveProduct.discountGhs > 0;
  const oldEl = document.getElementById('modalOldPrice');
  if (hasDiscount && addon === 0) {
    oldEl.textContent = formatMoney(getDisplayPrice(modalActiveProduct.priceGhs + modalActiveProduct.discountGhs, currency), currency);
  } else {
    oldEl.textContent = '';
  }
}

// ─── Filter / search / modal event setup ──────────────────────────────────────

function setupListeners() {
  // Category pills
  document.querySelectorAll('#categoryPills .pill').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#categoryPills .pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeCategory = btn.dataset.category;
      renderProducts();
    });
  });

  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', () => { searchQuery = searchInput.value.trim(); renderProducts(); });
  }

  const sortEl = document.getElementById('sortSelect');
  if (sortEl) {
    sortEl.addEventListener('change', () => { sortOrder = sortEl.value; renderProducts(); });
  }

  const stockEl = document.getElementById('inStockOnly');
  if (stockEl) {
    stockEl.addEventListener('change', () => { inStockOnly = stockEl.checked; renderProducts(); });
  }

  // Modal
  const modal = document.getElementById('productModal');
  document.getElementById('modalClose')?.addEventListener('click', () => modal.close());
  modal?.addEventListener('click', e => { if (e.target === modal) modal.close(); });

  document.getElementById('modalAddToCart')?.addEventListener('click', () => {
    if (!modalActiveProduct) return;
    addToCart(modalActiveProduct, { ...modalSelectedVariants }, modalPriceAddon);
    document.getElementById('productModal').close();
    toggleCartDrawer(true);
  });
}

// ─── Checkout & Paystack ───────────────────────────────────────────────────────

function buildFormData() {
  const customer = {
    name: document.getElementById('buyerName').value.trim(),
    phone: document.getElementById('buyerPhone').value.trim(),
    email: document.getElementById('buyerEmail').value.trim(),
    city: document.getElementById('buyerCity').value.trim(),
    address: document.getElementById('buyerAddress').value.trim()
  };
  const formData = new FormData();
  formData.append('customer', JSON.stringify(customer));
  formData.append('items', JSON.stringify(cart));
  formData.append('currencyDisplay', currencySelect.value);
  formData.append('paymentMethod', document.getElementById('paymentMethod').value);
  formData.append('note', document.getElementById('buyerNote').value.trim());
  formData.append('pageUrl', window.location.href);
  formData.append('source', 'website');
  if (paymentProofInput && paymentProofInput.files.length) {
    formData.append('proof', paymentProofInput.files[0]);
  }
  return { formData, customer };
}

async function submitOrderData(formData, paystackRef) {
  if (paystackRef) formData.append('paystackRef', paystackRef);
  const response = await fetch(orderEndpoint, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    body: formData
  });
  const data = await response.json();
  if (!data.success) throw new Error(data.error || 'Order failed');
  return data;
}

function showOrderSuccess(orderId) {
  cart = [];
  saveCart();
  updateCartDisplay();
  checkoutForm.reset();
  orderMessage.hidden = false;
  orderMessage.style.background = 'rgba(76, 175, 80, 0.15)';
  orderMessage.innerHTML = `
    Order received! 
    <a href="track.html?id=${orderId}" style="font-weight:700;color:inherit">Track your order →</a>
    <br><br>${getPaymentInstructionsHtml()}
  `;
}

checkoutForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  orderMessage.hidden = true;

  if (!cart.length) {
    orderMessage.hidden = false;
    orderMessage.style.background = 'rgba(217, 164, 65, 0.15)';
    orderMessage.textContent = 'Add at least one product to your cart.';
    return;
  }

  if (!document.getElementById('orderConsent').checked) {
    orderMessage.hidden = false;
    orderMessage.style.background = 'rgba(255, 59, 48, 0.1)';
    orderMessage.textContent = 'Please confirm consent to proceed.';
    return;
  }

  if (paymentDetails.proofRequired && (!paymentProofInput || paymentProofInput.files.length === 0)) {
    orderMessage.hidden = false;
    orderMessage.style.background = 'rgba(255, 59, 48, 0.1)';
    orderMessage.textContent = 'Please upload proof of payment to proceed.';
    return;
  }

  const submitBtn = checkoutForm.querySelector('[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Processing…';

  const paymentMethod = document.getElementById('paymentMethod').value;

  if (paymentMethod === 'Card') {
    const { formData, customer } = buildFormData();
    const subtotalGhs = cart.reduce((sum, item) => sum + item.priceGhs * item.quantity, 0);
    const paystackKey = (window.shopConfig && window.shopConfig.paystackKey) || 'YOUR_PAYSTACK_PUBLIC_KEY';
    const email = customer.email || 'customer@edwardsarpong.com';

    if (typeof PaystackPop === 'undefined') {
      orderMessage.hidden = false;
      orderMessage.style.background = 'rgba(255, 59, 48, 0.1)';
      orderMessage.textContent = 'Card payment is unavailable. Please choose Mobile Money or Bank Transfer.';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Place Order';
      return;
    }

    const handler = PaystackPop.setup({
      key: paystackKey,
      email,
      amount: Math.round(subtotalGhs * 100),
      currency: 'GHS',
      ref: 'ESE-' + Date.now(),
      label: 'Edward Sarpong Enterprise',
      callback: async (response) => {
        try {
          const data = await submitOrderData(formData, response.reference);
          showOrderSuccess(data.id);
        } catch (err) {
          orderMessage.hidden = false;
          orderMessage.style.background = 'rgba(255, 59, 48, 0.1)';
          orderMessage.textContent = err.message || 'Unable to confirm order. Contact us with ref: ' + response.reference;
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Place Order';
        }
      },
      onClose: () => {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Place Order';
      }
    });
    handler.openIframe();
    return;
  }

  // Mobile Money / Bank Transfer
  try {
    const { formData } = buildFormData();
    const data = await submitOrderData(formData, null);
    showOrderSuccess(data.id);
  } catch (err) {
    orderMessage.hidden = false;
    orderMessage.style.background = 'rgba(255, 59, 48, 0.1)';
    orderMessage.textContent = err.message || 'Unable to submit order. Please try again.';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Place Order';
  }
});

// ─── Payment instructions ──────────────────────────────────────────────────────

function getPaymentInstructionsHtml() {
  const momo = paymentDetails.momo || {};
  const bank = paymentDetails.bank || {};
  return `
    <div class="payment-instructions">
      <strong>Payment instructions (GHS only)</strong>
      <div>Mobile Money (${momo.provider || 'Mobile Money'}): ${momo.number || 'Add number'} (${momo.name || 'Account name'})</div>
      <div>Bank Transfer (${bank.bankName || 'Bank'}): ${bank.accountNumber || 'Add account'} (${bank.accountName || 'Account name'})</div>
    </div>
  `;
}

async function loadPaymentSettings() {
  if (!configReady) { if (paymentDetailsContainer) paymentDetailsContainer.innerHTML = getPaymentInstructionsHtml(); return; }
  try {
    const doc = await db.collection('settings').doc('payments').get();
    if (doc.exists) {
      const d = doc.data();
      paymentDetails = {
        momo: { provider: d.momoProvider || defaultPaymentDetails.momo.provider, number: d.momoNumber || defaultPaymentDetails.momo.number, name: d.momoName || defaultPaymentDetails.momo.name },
        bank: { bankName: d.bankName || defaultPaymentDetails.bank.bankName, accountName: d.bankAccountName || defaultPaymentDetails.bank.accountName, accountNumber: d.bankAccountNumber || defaultPaymentDetails.bank.accountNumber },
        proofRequired: d.proofRequired === true
      };
    }
  } catch (_) { paymentDetails = { ...defaultPaymentDetails }; }
  if (paymentDetailsContainer) paymentDetailsContainer.innerHTML = getPaymentInstructionsHtml();
}

// ─── Exchange rates & currency detection ──────────────────────────────────────

async function autoDetectCurrency() {
  const cached = localStorage.getItem('eseDetectedCurrency');
  if (cached) return cached;
  try {
    const res = await fetch('https://ipapi.co/json/');
    const data = await res.json();
    const currency = data.currency;
    if (currency && /^[A-Z]{3}$/.test(currency)) {
      localStorage.setItem('eseDetectedCurrency', currency);
      return currency;
    }
  } catch (_) {}
  return 'GHS';
}

async function loadRates() {
  const currency = currencySelect.value;
  if (currency === 'GHS') { rateNote.textContent = 'Payments are collected in GHS.'; return; }
  try {
    const response = await fetch('https://open.er-api.com/v6/latest/GHS');
    const data = await response.json();
    if (data.result === 'success' && data.rates) rates = { ...rates, ...data.rates };
    rateNote.textContent = 'Live exchange rates. Payments are collected in GHS.';
  } catch (_) {
    rateNote.textContent = 'Using estimated rates. Payments are collected in GHS.';
  }
}

// ─── Product loading ───────────────────────────────────────────────────────────

async function loadProducts() {
  if (configReady) {
    const snapshot = await db.collection('products').orderBy('name').get();
    products = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(p => p.active !== false);
  } else {
    const response = await fetch(productsUrl);
    products = await response.json();
  }
  renderProducts();
  updateCartDisplay();
}

// ─── Cart drawer ───────────────────────────────────────────────────────────────

currencySelect.addEventListener('change', async () => {
  await loadRates();
  renderProducts();
  updateCartDisplay();
  if (modalActiveProduct) updateModalPrice();
});

if (cartToggle) cartToggle.addEventListener('click', () => toggleCartDrawer(true));
if (cartClose) cartClose.addEventListener('click', () => toggleCartDrawer(false));
if (cartOverlay) cartOverlay.addEventListener('click', () => toggleCartDrawer(false));

// ─── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  const detected = await autoDetectCurrency();
  if (!Array.from(currencySelect.options).some(o => o.value === detected)) {
    const opt = document.createElement('option');
    opt.value = detected;
    opt.textContent = detected;
    currencySelect.insertBefore(opt, currencySelect.firstChild);
  }
  currencySelect.value = detected;
  setupListeners();
  await loadPaymentSettings();
  await loadRates();
  await loadProducts();
}

init();
