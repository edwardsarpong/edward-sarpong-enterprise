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
  momo: {
    provider: 'MTN Mobile Money',
    number: 'ADD_MOMO_NUMBER',
    name: 'Edward Sarpong Enterprise'
  },
  bank: {
    bankName: 'ADD_BANK_NAME',
    accountName: 'Edward Sarpong Enterprise',
    accountNumber: 'ADD_ACCOUNT_NUMBER'
  },
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

function formatMoney(amount, currency) {
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency,
    maximumFractionDigits: 0
  });
  return formatter.format(amount);
}

function getDisplayPrice(priceGhs, currency) {
  const rate = rates[currency] || 1;
  return priceGhs * rate;
}

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
  if (nextQuantity <= 0) {
    removeFromCart(productId);
    return;
  }

  item.quantity = nextQuantity;
  saveCart();
  updateCartDisplay();
}

function updateCartDisplay() {
  updateCartBadge();
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
            <div class="muted">GHS ${Number(item.priceGhs).toLocaleString()}</div>
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
    cartSubtotal.textContent = 'GHS 0';
    if (cartSavings) cartSavings.textContent = 'GHS 0';
    if (cartItemCount) cartItemCount.textContent = '0 items';
    return;
  }

  const currency = currencySelect.value;
  let subtotalGhs = 0;
  let savingsGhs = 0;

  cartItems.innerHTML = '<div class="cart-seller">Seller: Edward Sarpong Enterprise <span>Ships from Kumasi</span></div>';

  cartItems.innerHTML = '';
  cart.forEach((item) => {
    const product = findProduct(item.id);
    const image = item.image || product?.image || 'https://images.unsplash.com/photo-1484154218962-a197022b5858?auto=format&fit=crop&w=300&q=80';
    const leadTime = item.leadTime || product?.leadTime || 'Made to order';
    const discount = Number(item.discountGhs || 0);
    subtotalGhs += item.priceGhs * item.quantity;
    savingsGhs += discount * item.quantity;
    const display = getDisplayPrice(item.priceGhs * item.quantity, currency);
    const row = document.createElement('div');
    row.className = 'cart-item';
    row.innerHTML = `
      <img class="cart-item-thumb" src="${image}" alt="${item.name}" loading="lazy">
      <div class="cart-item-info">
        <strong>${item.name}</strong>
        <div class="muted">Delivery estimate: ${leadTime}</div>
        <div class="muted">GHS ${Number(item.priceGhs).toLocaleString()} each</div>
        <div class="muted">Savings: GHS ${discount.toLocaleString()}</div>
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

  cartSubtotal.textContent = `GHS ${subtotalGhs.toLocaleString()}`;
  if (cartSavings) cartSavings.textContent = `GHS ${savingsGhs.toLocaleString()}`;
  if (cartItemCount) cartItemCount.textContent = `${cart.reduce((sum, item) => sum + item.quantity, 0)} items`;
}

function addToCart(product) {
  const existing = cart.find(item => item.id === product.id);
  if (existing) {
    existing.quantity += 1;
  } else {
    cart.push({
      id: product.id,
      name: product.name,
      priceGhs: product.priceGhs,
      image: product.image,
      leadTime: product.leadTime,
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
  if (existing) {
    existing.quantity += item.quantity;
  } else {
    cart.push(item);
  }
  saveCart();
  updateCartDisplay();
}

function renderProducts() {
  const currency = currencySelect.value;
  productGrid.innerHTML = '';

  products.forEach((product) => {
    const card = document.createElement('div');
    card.className = 'product-card';
    const displayPrice = getDisplayPrice(product.priceGhs, currency);

    card.innerHTML = `
      <img src="${product.image}" alt="${product.name}" loading="lazy">
      <div class="product-content">
        <div class="product-meta">
          <span>${product.category}</span>
          <span>${product.leadTime}</span>
        </div>
        <div>
          <strong>${product.name}</strong>
          <p>${product.description}</p>
        </div>
        <div class="product-price">${formatMoney(displayPrice, currency)}</div>
        <button class="btn" type="button">Add to cart</button>
      </div>
    `;

    card.querySelector('button').addEventListener('click', () => addToCart(product));
    productGrid.appendChild(card);
  });
}

async function loadRates() {
  const currency = currencySelect.value;
  if (currency === 'GHS') {
    rateNote.textContent = 'Payments are collected in GHS.';
    return;
  }

  try {
    const response = await fetch('https://api.exchangerate.host/latest?base=GHS');
    const data = await response.json();
    rates = { ...rates, ...data.rates };
    rateNote.textContent = 'Rates update automatically.';
  } catch (error) {
    rateNote.textContent = 'Using cached rates. Payments are collected in GHS.';
  }
}

async function loadProducts() {
  if (configReady) {
    const snapshot = await db.collection('products').orderBy('name').get();
    products = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(product => product.active !== false);
  } else {
    const response = await fetch(productsUrl);
    products = await response.json();
  }
  renderProducts();
  updateCartDisplay();
}

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
  if (!configReady) {
    if (paymentDetailsContainer) {
      paymentDetailsContainer.innerHTML = getPaymentInstructionsHtml();
    }
    return;
  }

  try {
    const doc = await db.collection('settings').doc('payments').get();
    if (doc.exists) {
      const data = doc.data();
      paymentDetails = {
        momo: {
          provider: data.momoProvider || defaultPaymentDetails.momo.provider,
          number: data.momoNumber || defaultPaymentDetails.momo.number,
          name: data.momoName || defaultPaymentDetails.momo.name
        },
        bank: {
          bankName: data.bankName || defaultPaymentDetails.bank.bankName,
          accountName: data.bankAccountName || defaultPaymentDetails.bank.accountName,
          accountNumber: data.bankAccountNumber || defaultPaymentDetails.bank.accountNumber
        },
        proofRequired: data.proofRequired === true
      };
    }
  } catch (error) {
    paymentDetails = { ...defaultPaymentDetails };
  }

  if (paymentDetailsContainer) {
    paymentDetailsContainer.innerHTML = getPaymentInstructionsHtml();
  }
}

currencySelect.addEventListener('change', async () => {
  await loadRates();
  renderProducts();
  updateCartDisplay();
});

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

  const payload = {
    customer: {
      name: document.getElementById('buyerName').value.trim(),
      phone: document.getElementById('buyerPhone').value.trim(),
      email: document.getElementById('buyerEmail').value.trim(),
      city: document.getElementById('buyerCity').value.trim(),
      address: document.getElementById('buyerAddress').value.trim()
    },
    items: cart,
    currencyDisplay: currencySelect.value,
    paymentMethod: document.getElementById('paymentMethod').value,
    note: document.getElementById('buyerNote').value.trim(),
    pageUrl: window.location.href,
    source: 'website'
  };

  const formData = new FormData();
  formData.append('customer', JSON.stringify(payload.customer));
  formData.append('items', JSON.stringify(payload.items));
  formData.append('currencyDisplay', payload.currencyDisplay);
  formData.append('paymentMethod', payload.paymentMethod);
  formData.append('note', payload.note);
  formData.append('pageUrl', payload.pageUrl);
  formData.append('source', payload.source);

  if (paymentProofInput && paymentProofInput.files.length) {
    formData.append('proof', paymentProofInput.files[0]);
  }

  try {
    const response = await fetch(orderEndpoint, {
      method: 'POST',
      headers: {
        'Accept': 'application/json'
      },
      body: formData
    });

    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error || 'Order failed');
    }

    cart = [];
    saveCart();
    updateCartDisplay();
    checkoutForm.reset();
    orderMessage.hidden = false;
    orderMessage.style.background = 'rgba(76, 175, 80, 0.15)';
    orderMessage.innerHTML = 'Order received. Please use the payment instructions below.' + getPaymentInstructionsHtml();
  } catch (error) {
    orderMessage.hidden = false;
    orderMessage.style.background = 'rgba(255, 59, 48, 0.1)';
    orderMessage.textContent = error.message || 'Unable to submit order. Please try again.';
  }
});

loadPaymentSettings().then(() => loadRates().then(loadProducts));

if (cartToggle) {
  cartToggle.addEventListener('click', () => toggleCartDrawer(true));
}

if (cartClose) {
  cartClose.addEventListener('click', () => toggleCartDrawer(false));
}

if (cartOverlay) {
  cartOverlay.addEventListener('click', () => toggleCartDrawer(false));
}
