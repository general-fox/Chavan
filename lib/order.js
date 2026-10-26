/** Order calculations are independent from the interface and never mutate input. */
export const DEFAULT_POLICY = Object.freeze({
  deliveryFee: null,
  freeDeliveryFrom: null,
  minimumOrder: 0,
  promotions: Object.freeze({}),
});

const MAX_QUANTITY = 99;
const rubles = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  maximumFractionDigits: 0,
});

function numeric(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function productMap(products) {
  const result = new Map();
  if (!Array.isArray(products)) return result;
  for (const product of products) {
    if (!product || product.id == null || product.available === false) continue;
    const price = numeric(product.price);
    const id = String(product.id);
    if (!id || price === null || price < 0) continue;
    result.set(id, { ...product, price: Math.round(price) });
  }
  return result;
}

function modifierGroups(product) {
  return Array.isArray(product?.modifiers) ? product.modifiers : [];
}

function modifierItems(group) {
  return (Array.isArray(group?.items) ? group.items : []).filter((item) =>
    item && item.id != null && item.available !== false && numeric(item.price) !== null && numeric(item.price) >= 0);
}

/**
 * Selections are { [groupId]: { [itemId]: quantity } }, with empty groups omitted.
 * Unknown options are removed, quantities truncated and group totals capped.
 * Required choices default only to a free option; no paid option is auto-added.
 */
export function normalizeSelections(product, raw = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const selections = [];
  for (const group of modifierGroups(product)) {
    if (!group || group.id == null) continue;
    const id = String(group.id);
    const minimum = Math.max(0, Math.floor(numeric(group.min) ?? 0));
    const maximum = Math.min(MAX_QUANTITY, Math.max(0, Math.floor(numeric(group.max) ?? MAX_QUANTITY)));
    if (minimum > maximum) throw new RangeError(`Invalid modifier limits: ${id}`);
    const available = modifierItems(group);
    const rawGroup = Object.hasOwn(source, id) && source[id] && typeof source[id] === 'object' && !Array.isArray(source[id]) ? source[id] : {};
    const chosen = new Map();
    let remaining = maximum;
    for (const option of available) {
      const optionId = String(option.id);
      const rawQuantity = Object.hasOwn(rawGroup, optionId) ? numeric(rawGroup[optionId]) : null;
      const quantity = Math.min(remaining, Math.max(0, Math.floor(rawQuantity ?? 0)));
      if (quantity > 0) {
        chosen.set(optionId, quantity);
        remaining -= quantity;
      }
    }
    const missing = minimum - (maximum - remaining);
    if (missing > 0) {
      const freeOptions = available.filter((option) => numeric(option.price) === 0);
      const fallback = freeOptions.find((option) => /^без(?:\s|$)/iu.test(option.name || '')) || freeOptions[0];
      if (!fallback) throw new RangeError(`Required modifier has no free default: ${id}`);
      const optionId = String(fallback.id);
      chosen.set(optionId, (chosen.get(optionId) || 0) + missing);
    }
    if (chosen.size) selections.push([id, Object.fromEntries(chosen)]);
  }
  return Object.fromEntries(selections);
}

function configurationKey(id, modifiers) {
  const parts = Object.entries(modifiers).sort(([a], [b]) => a.localeCompare(b)).flatMap(([groupId, choices]) =>
    Object.entries(choices).sort(([a], [b]) => a.localeCompare(b)).map(([itemId, quantity]) =>
      `${encodeURIComponent(groupId)}:${encodeURIComponent(itemId)}:${quantity}`));
  return parts.length ? `${encodeURIComponent(id)}|${parts.join('|')}` : id;
}

function unitPrice(product, modifiers) {
  let amount = Math.round(numeric(product.price) ?? 0);
  for (const group of modifierGroups(product)) {
    const choices = modifiers[String(group.id)] || {};
    for (const option of modifierItems(group)) amount += Math.round(numeric(option.price)) * (choices[String(option.id)] || 0);
  }
  return amount;
}

/** Price per one configured dish; stored prices are deliberately ignored. */
export function getLinePrice(line, products) {
  const product = productMap(products).get(String(line?.id));
  if (!product) return 0;
  try {
    return unitPrice(product, normalizeSelections(product, line?.modifiers));
  } catch {
    return 0;
  }
}

/** Human-readable paid additions, with counts per one configured dish. */
export function getLineDescription(line, products) {
  const product = productMap(products).get(String(line?.id));
  if (!product) return '';
  let modifiers;
  try {
    modifiers = normalizeSelections(product, line?.modifiers);
  } catch {
    return '';
  }
  const names = [];
  for (const group of modifierGroups(product)) {
    const choices = modifiers[String(group.id)] || {};
    for (const option of modifierItems(group)) {
      const quantity = choices[String(option.id)] || 0;
      if (quantity && numeric(option.price) > 0) names.push(`${option.name}${quantity > 1 ? ` ×${quantity}` : ''}`);
    }
  }
  return names.join(', ');
}

/** Discard stale products; merge identical configurations and cap each at 99. */
export function normalizeCart(raw, products) {
  if (!Array.isArray(raw)) return [];
  const catalog = productMap(products);
  const lines = new Map();
  for (const item of raw) {
    if (!item || item.id == null) continue;
    const id = String(item.id);
    const quantity = numeric(item.quantity);
    if (!catalog.has(id) || quantity === null || quantity < 1) continue;
    let modifiers;
    try {
      modifiers = normalizeSelections(catalog.get(id), item.modifiers);
    } catch {
      continue;
    }
    const key = configurationKey(id, modifiers);
    const line = { id, quantity: Math.min(MAX_QUANTITY, (lines.get(key)?.quantity || 0) + Math.floor(quantity)), key };
    if (Object.keys(modifiers).length) line.modifiers = modifiers;
    lines.set(key, line);
  }
  return Array.from(lines.values());
}

/** Add the requested configuration, or the safe default when selections are absent. */
export function addItem(cart, id, delta, products, selections) {
  const normalized = normalizeCart(cart, products);
  if (id == null || !productMap(products).has(String(id))) return normalized;
  const change = numeric(delta);
  if (change === null || Math.trunc(change) === 0) return normalized;
  const target = normalizeCart([{ id, quantity: 1, modifiers: selections }], products)[0];
  if (!target) return normalized;
  const existing = normalized.find((item) => item.key === target.key);
  if (existing) return updateLine(normalized, target.key, change, products);
  const quantity = Math.min(MAX_QUANTITY, Math.max(0, Math.trunc(change)));
  return quantity ? [...normalized, { ...target, quantity }] : normalized;
}

/** Adjust exactly one existing configuration by its opaque stable key. */
export function updateLine(cart, key, delta, products) {
  const normalized = normalizeCart(cart, products);
  const change = numeric(delta);
  if (change === null || Math.trunc(change) === 0) return normalized;
  const existing = normalized.find((item) => item.key === key);
  if (!existing) return normalized;
  const quantity = Math.min(MAX_QUANTITY, Math.max(0, (existing?.quantity || 0) + Math.trunc(change)));
  return normalized.flatMap((item) => item.key === key ? (quantity ? [{ ...item, quantity }] : []) : [item]);
}

/**
 * Products use { id, price, available? }. All amounts are whole rubles.
 * Policy promotions use { CODE: { percent: 10, minSubtotal?: 1000 } }.
 * A delivery threshold applies to the goods total after any discount.
 * Unknown delivery cost is null and is never silently represented as free.
 */
export function calculateTotals(cart, products, options = {}, policy = DEFAULT_POLICY) {
  const normalized = normalizeCart(cart, products);
  const catalog = productMap(products);
  const settings = { ...DEFAULT_POLICY, ...(policy || {}) };
  const mode = options?.mode === 'pickup' ? 'pickup' : 'delivery';
  const promoCode = typeof options?.promoCode === 'string' ? options.promoCode.trim().toUpperCase() : '';
  const subtotal = normalized.reduce((sum, item) => sum + unitPrice(catalog.get(item.id), item.modifiers || {}) * item.quantity, 0);
  const count = normalized.reduce((sum, item) => sum + item.quantity, 0);
  let discount = 0;
  let promoApplied = null;
  let promoError = '';

  if (promoCode) {
    const promotions = settings.promotions && typeof settings.promotions === 'object' ? settings.promotions : {};
    const promotion = Object.entries(promotions).find(([code]) => code.toUpperCase() === promoCode)?.[1];
    const percent = numeric(promotion?.percent);
    const minSubtotal = numeric(promotion?.minSubtotal) ?? 0;
    if (!promotion || percent === null || percent <= 0 || percent > 100 || minSubtotal < 0) {
      promoError = 'Промокод не найден или больше не действует.';
    } else if (subtotal < minSubtotal) {
      promoError = `Промокод действует при заказе от ${formatRub(minSubtotal)}.`;
    } else {
      discount = Math.min(subtotal, Math.round(subtotal * percent / 100));
      promoApplied = promoCode;
    }
  }

  const goodsTotal = subtotal - discount;
  const thresholdValue = numeric(settings.freeDeliveryFrom);
  const threshold = thresholdValue !== null && thresholdValue >= 0 ? Math.round(thresholdValue) : null;
  const feeValue = numeric(settings.deliveryFee);
  const configuredFee = feeValue !== null && feeValue >= 0 ? Math.round(feeValue) : null;
  const freeDeliveryRemaining = mode === 'pickup' ? 0 : threshold === null ? null : Math.max(0, threshold - goodsTotal);
  const deliveryFee = mode === 'pickup' || (threshold !== null && goodsTotal >= threshold) ? 0 : configuredFee;
  const requiresDeliveryQuote = deliveryFee === null;

  return {
    subtotal,
    discount,
    deliveryFee,
    total: goodsTotal + (deliveryFee ?? 0),
    count,
    freeDeliveryRemaining,
    promoApplied,
    promoError,
    requiresDeliveryQuote,
  };
}

export function validateCheckout(values = {}) {
  const input = values || {};
  const errors = {};
  if (typeof input.name !== 'string' || input.name.trim().length < 2) errors.name = 'Укажите имя — не менее двух букв.';
  const phone = typeof input.phone === 'string' ? input.phone.trim() : '';
  const digits = phone.replace(/\D/g, '');
  if (!/^\+?[\d\s().-]+$/.test(phone) || !(/^[78]\d{10}$/.test(digits) || /^9\d{9}$/.test(digits))) {
    errors.phone = 'Укажите российский номер телефона, например +7 999 123-45-67.';
  }
  if (input.mode !== 'delivery' && input.mode !== 'pickup') errors.mode = 'Выберите доставку или самовывоз.';
  if (input.mode === 'delivery' && (typeof input.address !== 'string' || input.address.trim().length < 5)) {
    errors.address = 'Укажите адрес доставки: улицу и номер дома.';
  }
  if (input.consent !== true) errors.consent = 'Подтвердите, что это демонстрационное оформление.';
  return errors;
}

export function formatRub(value) {
  const amount = numeric(value);
  return amount === null ? '—' : rubles.format(amount);
}
