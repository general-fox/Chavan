import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_POLICY, normalizeCart, addItem, updateLine, normalizeSelections, getLinePrice, getLineDescription, calculateTotals, validateCheckout, formatRub } from '../lib/order.js';

const products = [
  { id: 'meat', price: 550 },
  { id: 'cheese', price: 430 },
  { id: 'special', price: 999 },
  { id: 'unavailable', price: 600, available: false },
  { id: 'broken', price: 'unknown' },
];

test('corrupt stored values and removed or unavailable products do not enter the cart', () => {
  for (const raw of [null, undefined, false, '', '{}', {}]) assert.deepEqual(normalizeCart(raw, products), []);
  const cart = [null, {}, { id: 'deleted', quantity: 1 }, { id: 'unavailable', quantity: 1 }, { id: 'broken', quantity: 1 }, { id: 'meat', quantity: 2 }];
  assert.deepEqual(normalizeCart(cart, products), [{ id: 'meat', quantity: 2, key: 'meat' }]);
});

test('normalization truncates fractions, merges duplicates, caps quantities, and ignores invalid values', () => {
  assert.deepEqual(normalizeCart([
    { id: 'meat', quantity: 1.9 },
    { id: 'meat', quantity: '2' },
    { id: 'cheese', quantity: 150 },
    { id: 'special', quantity: -5 },
    { id: 'special', quantity: Infinity },
    { id: 'special', quantity: true },
    { id: 'special', quantity: 'abc' },
  ], products), [{ id: 'meat', quantity: 3, key: 'meat' }, { id: 'cheese', quantity: 99, key: 'cheese' }]);
});

test('adding and removing items is bounded and does not mutate the stored cart', () => {
  const cart = Object.freeze([Object.freeze({ id: 'meat', quantity: 2 })]);
  assert.deepEqual(addItem(cart, 'meat', 1, products), [{ id: 'meat', quantity: 3, key: 'meat' }]);
  assert.deepEqual(addItem(cart, 'meat', -2, products), []);
  assert.deepEqual(addItem(cart, 'meat', -100, products), []);
  assert.deepEqual(addItem(cart, 'cheese', 200, products), [{ id: 'meat', quantity: 2, key: 'meat' }, { id: 'cheese', quantity: 99, key: 'cheese' }]);
  assert.deepEqual(addItem(cart, 'unavailable', 1, products), normalizeCart(cart, products));
  assert.deepEqual(addItem(cart, 'unknown', 1, products), normalizeCart(cart, products));
  assert.deepEqual(addItem(cart, 'meat', Infinity, products), normalizeCart(cart, products));
  assert.deepEqual(cart, [{ id: 'meat', quantity: 2 }]);
});

test('default delivery price is explicitly unknown and no unconfirmed promotion is active', () => {
  const result = calculateTotals([{ id: 'meat', quantity: 2 }], products, { mode: 'delivery', promoCode: 'CHUDU10' });
  assert.equal(DEFAULT_POLICY.deliveryFee, null);
  assert.equal(result.subtotal, 1100);
  assert.equal(result.total, 1100);
  assert.equal(result.count, 2);
  assert.equal(result.deliveryFee, null);
  assert.equal(result.requiresDeliveryQuote, true);
  assert.equal(result.freeDeliveryRemaining, null);
  assert.equal(result.discount, 0);
  assert.equal(result.promoApplied, null);
  assert.ok(result.promoError);
});

test('pickup has no delivery fee or quote requirement', () => {
  const result = calculateTotals([{ id: 'cheese', quantity: 2 }], products, { mode: 'pickup' });
  assert.equal(result.total, 860);
  assert.equal(result.deliveryFee, 0);
  assert.equal(result.requiresDeliveryQuote, false);
  assert.equal(result.freeDeliveryRemaining, 0);
});

test('an explicitly configured delivery policy calculates fee and threshold', () => {
  const policy = { deliveryFee: 300, freeDeliveryFrom: 1000 };
  const below = calculateTotals([{ id: 'meat', quantity: 1 }], products, { mode: 'delivery' }, policy);
  assert.equal(below.total, 850);
  assert.equal(below.freeDeliveryRemaining, 450);
  assert.equal(below.requiresDeliveryQuote, false);
  const above = calculateTotals([{ id: 'meat', quantity: 2 }], products, { mode: 'delivery' }, policy);
  assert.equal(above.total, 1100);
  assert.equal(above.deliveryFee, 0);
  assert.equal(above.freeDeliveryRemaining, 0);
});

test('explicit promotions round to whole rubles and delivery threshold uses the discounted goods total', () => {
  const policy = { deliveryFee: 300, freeDeliveryFrom: 950, promotions: { TEST10: { percent: 10 } } };
  const result = calculateTotals([{ id: 'special', quantity: 1 }], products, { mode: 'delivery', promoCode: ' test10 ' }, policy);
  assert.equal(result.subtotal, 999);
  assert.equal(result.discount, 100);
  assert.equal(result.total, 1199);
  assert.equal(result.freeDeliveryRemaining, 51);
  assert.equal(result.promoApplied, 'TEST10');
  assert.equal(result.promoError, '');
});

test('invalid promotion rates and unmet promotion minimums never reduce the total', () => {
  for (const promotion of [{ percent: -10 }, { percent: 101 }, { percent: NaN }, { percent: 10, minSubtotal: 2000 }]) {
    const result = calculateTotals([{ id: 'meat', quantity: 1 }], products, { mode: 'pickup', promoCode: 'TEST' }, { promotions: { TEST: promotion } });
    assert.equal(result.discount, 0);
    assert.equal(result.total, 550);
    assert.ok(result.promoError);
  }
});

test('empty or entirely stale carts have no goods or discount totals', () => {
  const result = calculateTotals([{ id: 'deleted', quantity: 10 }], products, { mode: 'pickup' });
  assert.equal(result.subtotal, 0);
  assert.equal(result.total, 0);
  assert.equal(result.count, 0);
});

const checkout = { name: 'Анна', phone: '+7 (999) 123-45-67', address: 'ул. Ленина, 10', mode: 'delivery', consent: true };

test('valid Russian phone formats and complete delivery details pass validation', () => {
  for (const phone of ['+7 (999) 123-45-67', '8 999 123 45 67', '9991234567', '+7 495 123-45-67']) {
    assert.deepEqual(validateCheckout({ ...checkout, phone }), {});
  }
});

test('invalid phones and incomplete checkout return field-specific errors', () => {
  for (const phone of ['', '123', '+1 999 123 45 67', '899912345678', 'abc89991234567', '1999123456']) {
    assert.ok(validateCheckout({ ...checkout, phone }).phone);
  }
  const errors = validateCheckout({ name: ' А ', phone: '', address: 'дом', mode: 'delivery', consent: false });
  assert.deepEqual(Object.keys(errors).sort(), ['address', 'consent', 'name', 'phone']);
  assert.ok(validateCheckout({ ...checkout, mode: 'unknown' }).mode);
});

test('pickup does not require a delivery address and consent must be explicit', () => {
  assert.deepEqual(validateCheckout({ ...checkout, mode: 'pickup', address: '' }), {});
  assert.ok(validateCheckout({ ...checkout, consent: 'true' }).consent);
  assert.doesNotThrow(() => validateCheckout(null));
});

test('currency formatting uses rubles and unknown prices remain visibly unknown', () => {
  assert.match(formatRub(1234), /1\s234\s₽/u);
  assert.match(formatRub(999.6), /1\s000\s₽/u);
  assert.equal(formatRub(null), '—');
  assert.equal(formatRub(NaN), '—');
});

const configuredProduct = {
  id: 'dish', price: 750,
  modifiers: [
    { id: 'bread', min: 1, max: 1, items: [
      { id: 'flatbread', name: 'Лепёшка', price: 60 },
      { id: 'none', name: 'Без хлеба', price: 0 },
      { id: 'sold-out', name: 'Недоступный хлеб', price: 50, available: false },
    ] },
    { id: 'extras', min: 0, max: 15, items: [
      { id: 'beef', name: 'Говядина', price: 450 },
      { id: 'broth', name: 'Бульон', price: 150 },
    ] },
  ],
};
const configurableCatalog = [configuredProduct];

test('required modifiers default to the free choice, optional groups stay empty', () => {
  const selections = normalizeSelections(configuredProduct);
  assert.deepEqual(selections, { bread: { none: 1 } });
  const [line] = addItem([], 'dish', 1, configurableCatalog);
  assert.deepEqual(line.modifiers, selections);
  assert.equal(getLinePrice(line, configurableCatalog), 750);
  assert.equal(getLineDescription(line, configurableCatalog), '');
});

test('unknown groups, removed options, unavailable options, and stored prices cannot alter a price', () => {
  const [line] = normalizeCart([{
    id: 'dish', quantity: 1, key: 'forged', price: 1,
    modifiers: { bread: { unknown: 1, 'sold-out': 1 }, extras: { beef: 2, invalid: 1 }, fake: { free: 99 } },
  }], configurableCatalog);
  assert.deepEqual(line.modifiers, { bread: { none: 1 }, extras: { beef: 2 } });
  assert.notEqual(line.key, 'forged');
  assert.equal(getLinePrice(line, configurableCatalog), 1650);
  assert.equal(getLineDescription(line, configurableCatalog), 'Говядина ×2');
});

test('modifier quantities are integers and respect the total group maximum', () => {
  const selections = normalizeSelections(configuredProduct, {
    bread: { flatbread: 3, none: 1 }, extras: { beef: 2.9, broth: 999 },
  });
  assert.deepEqual(selections, { bread: { flatbread: 1 }, extras: { beef: 2, broth: 13 } });
  assert.deepEqual(normalizeSelections(configuredProduct, {
    bread: { flatbread: -1 }, extras: { beef: Infinity, broth: true },
  }), { bread: { none: 1 } });
});

test('different configurations form distinct lines while equivalent configuration order merges', () => {
  let cart = addItem([], 'dish', 1, configurableCatalog);
  cart = addItem(cart, 'dish', 2, configurableCatalog, { bread: { flatbread: 1 }, extras: { beef: 2, broth: 1 } });
  cart = addItem(cart, 'dish', 1, configurableCatalog, { extras: { broth: 1, beef: 2 }, bread: { flatbread: 1 } });
  assert.equal(cart.length, 2);
  assert.equal(cart[0].quantity, 1);
  assert.equal(cart[1].quantity, 3);
  assert.notEqual(cart[0].key, cart[1].key);
  assert.equal(getLinePrice(cart[1], configurableCatalog), 1860);
  assert.equal(getLineDescription(cart[1], configurableCatalog), 'Лепёшка, Говядина ×2, Бульон');
  const totals = calculateTotals(cart, configurableCatalog, { mode: 'pickup' });
  assert.equal(totals.total, 750 + 1860 * 3);
  assert.equal(totals.count, 4);
});

test('updateLine increments or removes the exact configuration without changing siblings', () => {
  const original = addItem(addItem([], 'dish', 1, configurableCatalog), 'dish', 1, configurableCatalog, { bread: { flatbread: 1 } });
  const key = original[1].key;
  const increased = updateLine(original, key, 2, configurableCatalog);
  assert.equal(increased[0].quantity, 1);
  assert.equal(increased[1].quantity, 3);
  assert.equal(original[1].quantity, 1);
  assert.deepEqual(updateLine(increased, key, -3, configurableCatalog), [original[0]]);
  assert.deepEqual(updateLine(original, 'unknown-key', 5, configurableCatalog), original);
});

test('impossible required selection fails safely and never auto-adds a paid option', () => {
  const product = { id: 'required-paid', price: 100, modifiers: [{ id: 'required', min: 1, max: 1, items: [{ id: 'paid', name: 'Добавка', price: 50 }] }] };
  assert.throws(() => normalizeSelections(product), RangeError);
  assert.deepEqual(normalizeCart([{ id: product.id, quantity: 1 }], [product]), []);
  assert.deepEqual(addItem([], product.id, 1, [product]), []);
  const [line] = addItem([], product.id, 1, [product], { required: { paid: 1 } });
  assert.equal(getLinePrice(line, [product]), 150);
});

test('catalog changes revalidate each stored configuration instead of trusting its key', () => {
  const oldCart = addItem([], 'dish', 1, configurableCatalog, { bread: { flatbread: 1 } });
  const updated = { ...configuredProduct, modifiers: [{ ...configuredProduct.modifiers[0], items: [{ id: 'none', name: 'Без хлеба', price: 0 }] }] };
  const [line] = normalizeCart(oldCart, [updated]);
  assert.deepEqual(line.modifiers, { bread: { none: 1 } });
  assert.equal(getLinePrice(line, [updated]), 750);
  assert.notEqual(line.key, oldCart[0].key);
});
