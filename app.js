import {categories, products} from './data/catalog.js';
import {promotions, dishOfDayIds} from './data/promotions.js';
import {normalizeCart, addItem, updateLine, calculateTotals, formatRub, validateCheckout, normalizeSelections, getLinePrice, getLineDescription} from './lib/order.js';

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const byId = new Map(products.map(product => [product.id, product]));
const paths = {
  pin:'<path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  heart:'<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  bag:'<path d="M5 7h14l1 14H4L5 7Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',
  'arrow-up':'<path d="M12 20V4m-6 6 6-6 6 6"/>',
  chevron:'<path d="m7 10 5 5 5-5"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  minus:'<path d="M5 12h14"/>',
  search:'<circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/>',
  truck:'<path d="M2 5h12v12H2zM14 9h4l4 5v3h-8"/><path d="M18 9v5h4"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
  bowl:'<path d="M3 12h18c0 5-4 9-9 9s-9-4-9-9ZM7 21h10M6 7c-2-3 3-2 1-5m5 5c-2-3 3-2 1-5m5 5c-2-3 3-2 1-5"/>',
  sort:'<path d="M4 6h16M7 12h10M10 18h4"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.5"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  spark:'<path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5L12 2Z"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  gift:'<path d="M3 8h18v4H3zM5 12v9h14v-9M12 8v13"/><path d="M12 8H8a3 3 0 1 1 3-3l1 3Zm0 0h4a3 3 0 1 0-3-3l-1 3Z"/>',
  menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
  'arrow-up-right':'<path d="M6 18 18 6M6 6h12v12"/>',
  phone:'<path d="M7 3H4a1 1 0 0 0-1 1c0 9.4 7.6 17 17 17a1 1 0 0 0 1-1v-3l-5-2-2 2a15 15 0 0 1-7-7l2-2-2-5Z"/>',
  tag:'<path d="M20 13 11 22 2 13V3h10l8 8a1.4 1.4 0 0 1 0 2Z"/><circle cx="7" cy="8" r="1.2"/>',
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.bowl}</svg>`;
function fillIcons(scope = document) { $$('[data-icon]', scope).forEach(element => { element.innerHTML = icon(element.dataset.icon); }); }
function readStorage(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function store(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* The interface remains usable when browser storage is unavailable. */ } }
const savedFavorites = readStorage('chavan:favorites:v1', []);
const state = {
  cart: normalizeCart(readStorage('chavan:cart:v1', []), products),
  favorites: new Set(Array.isArray(savedFavorites) ? savedFavorites.filter(id => byId.has(id)) : []),
  category: 'cuduski', search: '', sort: 'recommended', limit: 12,
  mode: 'delivery', address: '', promoCode: '', promoError: '',
  product: null, productQuantity: 1, selections: {}, checkout: null,
};
const categoryPriority = ['cuduski','xinkal-1','mangal','darginskie-pirogi','kavkazskie-bliuda-1','salaty-1','supy-1','goriacie-bliuda','xolodnye-zakuski-1','zavtraki-1','deserty-1','detskoe','garniry','sousy-1'];
const categoryRank = id => categoryPriority.includes(id) ? categoryPriority.indexOf(id) : categoryPriority.length;
const displayCategories = [
  ...[...categories].sort((a,b) => categoryRank(a.id)-categoryRank(b.id)).map(c => ({...c,name:c.id === 'cuduski'?'Чуду':c.name})),
  {id:'all',name:'Всё меню'},
  {id:'offers',name:'Блюда со скидкой',icon:'tag'},
  {id:'favorites',name:'Избранное',icon:'heart'},
];
const normalizeSearch = value => value.toLocaleLowerCase('ru').replaceAll('ё','е').trim();
let toastTimer;
function toast(message) { clearTimeout(toastTimer); $('#toast').textContent=message; $('#toast').classList.add('visible'); toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),3200); }
function totals() { return calculateTotals(state.cart, products, {mode:state.mode,promoCode:state.promoCode}); }
function productCount(id) { return state.cart.filter(line=>line.id===id).reduce((total,line)=>total+line.quantity,0); }

function categoryCount(id) {
  if(id==='all')return products.length;
  if(id==='offers')return products.filter(product=>product.oldPrice>product.price).length;
  if(id==='favorites')return state.favorites.size;
  return products.filter(product=>product.category===id).length;
}
function categoryMarkup(category,action='category') {
  return `<button class="category" data-action="${action}" data-category="${category.id}" aria-pressed="${!state.search&&state.category===category.id}"><span class="category-name">${category.icon?icon(category.icon):''}${escape(category.name)}</span><span class="category-count">${categoryCount(category.id)}</span></button>`;
}
function renderCategories() {
  const focused=document.activeElement?.closest('#categories [data-category]')?.dataset.category;
  $('#categories').innerHTML=displayCategories.map(category=>categoryMarkup(category)).join('');
  $('#mobile-category-label').textContent=state.search?'Поиск по меню':displayCategories.find(category=>category.id===state.category)?.name||'Категории';
  $$('.menu-total').forEach(element=>element.textContent=`${products.length} ${plural(products.length,'блюдо','блюда','блюд')}`);
  if(focused)$$('#categories [data-category]').find(button=>button.dataset.category===focused)?.focus({preventScroll:true});
}
function showCategories() {
  showModal(`<div class="modal-simple"><h2 id="modal-title">Категории меню</h2><div class="category-picker">${displayCategories.map(category=>categoryMarkup(category,'choose-category')).join('')}</div></div>`,'categories');
}
function scrollMenu() {
  $('#menu').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
}
function filteredProducts() {
  let items;
  if(state.search) {
    const query=normalizeSearch(state.search);
    items=products.filter(p=>normalizeSearch(`${p.name} ${p.description} ${categories.find(c=>c.id===p.category)?.name||''}`).includes(query));
  } else if(state.category==='favorites') items=products.filter(p=>state.favorites.has(p.id));
  else if(state.category==='offers') items=products.filter(p=>p.oldPrice>p.price);
  else if(state.category==='all') items=[...products];
  else items=products.filter(p=>p.category===state.category);
  if(state.sort==='price-asc') items.sort((a,b)=>a.price-b.price);
  if(state.sort==='price-desc') items.sort((a,b)=>b.price-a.price);
  if(state.sort==='name') items.sort((a,b)=>a.name.localeCompare(b.name,'ru'));
  return items;
}
function quantityControl(line, compact=false) {
  return `<div class="quantity-control${compact?' compact':''}"><button data-action="line-minus" data-key="${escape(line.key)}" aria-label="Уменьшить количество: ${escape(byId.get(line.id)?.name)}">${icon('minus')}</button><span aria-label="Количество">${line.quantity}</span><button data-action="line-plus" data-key="${escape(line.key)}" aria-label="Увеличить количество: ${escape(byId.get(line.id)?.name)}" ${line.quantity>=99?'disabled':''}>${icon('plus')}</button></div>`;
}
function productCard(product,placement='catalog') {
  const daily=placement==='daily';
  const line=!product.modifiers?.length&&state.cart.find(item=>item.id===product.id);
  const categoryName=categories.find(category=>category.id===product.category)?.name;
  const savings=product.oldPrice>product.price?product.oldPrice-product.price:0;
  const discount=savings?Math.round(savings/product.oldPrice*100):0;
  const metadata=[product.weight?`${product.weight} г`:'',daily?'':categoryName].filter(Boolean).map(escape).join(' <span aria-hidden="true">·</span> ');
  const description=typeof product.description==='string'?product.description.trim():'';
  return `<article class="product-card${daily?' daily-card':''}" data-product="${product.id}" data-placement="${placement}"><div class="product-visual"><button class="product-image-button" data-action="product" data-id="${product.id}" aria-label="Подробнее: ${escape(product.name)}"><img src="${escape(product.image)}" alt="${escape(product.name)}" width="500" height="500" loading="${daily?'eager':'lazy'}" decoding="async"></button>${savings?`<span class="product-badge">−${daily?formatRub(savings):`${discount}%`}</span>`:''}<button class="favorite-button" data-action="favorite" data-id="${product.id}" aria-label="${state.favorites.has(product.id)?'Убрать из избранного':'В избранное'}: ${escape(product.name)}" aria-pressed="${state.favorites.has(product.id)}">${icon('heart')}</button></div><div class="product-details"><button class="product-heading" data-action="product" data-id="${product.id}"><h4>${escape(product.name)}</h4></button>${metadata?`<div class="product-weight">${metadata}</div>`:''}${!daily&&description?`<p class="product-description">${escape(description)}</p>`:''}<div class="product-price-row"><div><span class="price">${formatRub(product.price)}</span>${savings?`<span class="old-price">${formatRub(product.oldPrice)}</span>`:''}</div>${line?quantityControl(line):`<button class="add-button" data-action="add" data-id="${product.id}" aria-label="${product.modifiers?.length?'Выбрать добавки':'Добавить'}: ${escape(product.name)}" ${product.available?'':'disabled'}>${icon('plus')}${daily?'<span>Добавить</span>':''}</button>`}</div></div></article>`;
}
function renderDaily() {
  const dailyProducts=dishOfDayIds.map(id=>byId.get(id)).filter(Boolean);
  $('#daily-grid').innerHTML=dailyProducts.map(product=>productCard(product,'daily')).join('');
  $('#daily-max-saving').textContent=formatRub(Math.max(0,...dailyProducts.map(product=>(product.oldPrice||product.price)-product.price)));
}
function renderPromotion() {
  const promotion=promotions.find(item=>item.id==='kinza-cola-gift');
  if(!promotion)return;
  $('#promotion-banner').innerHTML=`<article class="promotion-card"><div class="promotion-copy"><div class="promotion-kicker">${icon('gift')}АКЦИЯ РЕСТОРАНА</div><h3>${escape(promotion.title)}</h3><p>При заказе от <strong>5 000 ₽</strong></p><div class="promotion-meta"><span>${icon('truck')}Доставка</span><span>${icon('bag')}Самовывоз</span></div><button class="text-button" data-action="promotion-details" data-promotion="${promotion.id}">Условия акции${icon('arrow')}</button></div><div class="promotion-image"><img src="${escape(promotion.image)}" alt="Акция ресторана: два напитка Kinza Cola в подарок при заказе от 5 000 ₽" width="900" height="500" decoding="async"></div></article>`;
}
function showPromotion(id) {
  const promotion=promotions.find(item=>item.id===id);
  if(!promotion)return;
  const included=(promotion.productIds||[]).map(productId=>byId.get(productId)).filter(Boolean);
  showModal(`<div class="modal-simple"><h2 id="modal-title">${escape(promotion.title)}</h2><p class="modal-intro">${escape(promotion.description)}</p><ul class="promotion-conditions">${promotion.conditions.map(condition=>`<li>${escape(condition)}</li>`).join('')}</ul>${included.length?`<div class="promotion-products">${included.map(product=>`<button class="promotion-product" data-action="product" data-id="${product.id}"><img src="${escape(product.image)}" alt="" width="72" height="72"><span>${escape(product.name)}</span><strong>${formatRub(product.price)}</strong>${icon('arrow')}</button>`).join('')}</div>`:''}${id==='kinza-cola-gift'?`<div class="note-box promotion-gift-note">${icon('gift')}<span>Подарок — 2 напитка Kinza Cola. Они не входят в список оплачиваемых блюд. В демоверсии подарок не добавляется в корзину и заказ не отправляется.</span></div>`:''}<a class="text-link" href="${escape(promotion.sourceUrl)}" target="_blank" rel="noopener">Акция на сайте ресторана${icon('arrow-up-right')}</a></div>`,'promotion');
}
function renderCatalog() {
  const items=filteredProducts();
  const category=displayCategories.find(item=>item.id===state.category);
  $('#daily').hidden=!!state.search;
  $('#promotions').hidden=!!state.search;
  $('#catalog-title').textContent=state.search?'Результаты поиска':category?.name||'Меню';
  $('#catalog-description').textContent=state.search?`По запросу «${state.search}»: ${items.length}`:`${items.length} ${plural(items.length,'блюдо','блюда','блюд')} в меню`;
  $('#results-status').textContent=`Найдено блюд: ${items.length}`;
  $('#product-grid').innerHTML=items.length?items.slice(0,state.limit).map(product=>productCard(product)).join(''):`<div class="empty-results">${icon(state.category==='favorites'?'heart':'search')}<h4>${state.category==='favorites'&&!state.search?'В избранном пока нет блюд':'Ничего не найдено'}</h4><p>${state.category==='favorites'&&!state.search?'Нажмите на сердечко на карточке блюда.':'Попробуйте другое название или откройте всё меню.'}</p><button class="button secondary" data-action="reset-menu">Всё меню ${icon('arrow')}</button></div>`;
  $('#catalog-bottom').innerHTML=items.length>state.limit?`<button class="button" data-action="load-more">Показать ещё ${Math.min(12,items.length-state.limit)} ${plural(Math.min(12,items.length-state.limit),'блюдо','блюда','блюд')} ${icon('chevron')}</button>`:'';
  updateFavorites();
}
function plural(count,one,few,many){ const n=Math.abs(count)%100;return n>10&&n<20?many:n%10===1?one:n%10>=2&&n%10<=4?few:many; }
function updateFavorites() {
  $('#favorite-count').textContent=state.favorites.size;
  $('#favorite-count').hidden=!state.favorites.size;
  $('.favorite-header').setAttribute('aria-label',`Избранные блюда: ${state.favorites.size}`);
  $$('[data-action="favorite"]').forEach(button=>{
    const on=state.favorites.has(button.dataset.id);button.setAttribute('aria-pressed',on);button.setAttribute('aria-label',`${on?'Убрать из избранного':'В избранное'}: ${byId.get(button.dataset.id)?.name}`);
  });
}
function renderCart() {
  const summary=totals();
  $('#header-cart-count').textContent=summary.count;
  $('#cart-item-badge').textContent=summary.count;
  $('#header-address').textContent=state.mode==='pickup'?'Самовывоз · Мосфильмовская, 53':state.address||'Указать адрес';
  $('#mobile-cart').hidden=summary.count===0;
  $('#mobile-cart-text').textContent=`Ваш заказ · ${summary.count} ${plural(summary.count,'блюдо','блюда','блюд')}`;
  $('#mobile-cart-total').textContent=formatRub(summary.total);
  $$('#cart-panel [data-action="mode"]').forEach(button=>button.setAttribute('aria-pressed',button.dataset.mode===state.mode));
  if(!state.cart.length){
    $('#cart-content').innerHTML=`<div class="cart-empty"><div class="empty-illustration">${icon('bowl')}</div><h4>Ваша корзина пока пуста</h4><p>Выберите блюда в меню.</p></div><div class="cart-help">${icon('info')}<span>Состав и стоимость заказа появятся здесь.</span></div>`;
    return;
  }
  $('#cart-content').innerHTML=`<button class="cart-address" data-action="address">${icon('pin')}<span>${state.mode==='pickup'?'Самовывоз: Мосфильмовская, 53':escape(state.address||'Укажите адрес доставки')}</span>${icon('chevron')}</button><div class="cart-lines">${state.cart.map(line=>{const product=byId.get(line.id);return `<div class="cart-line"><img src="${escape(product.image)}" alt="" width="45" height="45"><div><button class="cart-line-name" data-action="product" data-id="${product.id}">${escape(product.name)}</button>${getLineDescription(line,products)?`<p class="cart-line-modifiers">${escape(getLineDescription(line,products))}</p>`:''}<div class="cart-line-controls">${quantityControl(line,true)}<strong>${formatRub(getLinePrice(line,products)*line.quantity)}</strong></div></div></div>`;}).join('')}</div><button class="cart-clear" data-action="clear-cart">Очистить корзину</button><form class="promo-form" id="promo-form"><label class="sr-only" for="promo">Промокод</label><input id="promo" placeholder="Промокод" value="${escape(state.promoCode)}" maxlength="30" autocomplete="off"><button type="submit">Применить</button></form>${state.promoError?`<p class="promo-error" role="status">${escape(state.promoError)}</p>`:''}<div class="cart-totals">${totalsMarkup(summary)}</div><button class="button full cart-checkout" data-action="checkout">Перейти к оформлению ${icon('arrow')}</button><p class="cart-disclaimer">Демо новой версии · заказ не отправляется</p>`;
}
function totalsMarkup(summary){return `<div class="total-row"><span>Стоимость блюд</span><strong>${formatRub(summary.subtotal)}</strong></div>${summary.discount?`<div class="total-row discount"><span>Скидка</span><strong>−${formatRub(summary.discount)}</strong></div>`:''}<div class="total-row"><span>${state.mode==='pickup'?'Самовывоз':'Доставка'}</span><strong>${summary.requiresDeliveryQuote?'Уточняется':summary.deliveryFee===0?'Бесплатно':formatRub(summary.deliveryFee)}</strong></div><div class="total-row grand"><span>${summary.requiresDeliveryQuote?'Итого за блюда':'Итого'}</span><strong>${formatRub(summary.total)}</strong></div>`;}
function rememberControl() {
  const active=document.activeElement;
  return active?.dataset?.action?{...active.dataset,product:active.closest('[data-product]')?.dataset.product,placement:active.closest('[data-placement]')?.dataset.placement,inCart:!!active.closest('#cart-panel'),inModal:!!active.closest('#modal')}:null;
}
function restoreControl(saved) {
  if(!saved)return;
  const sameRegion=element=>(!saved.placement||element.closest('[data-placement]')?.dataset.placement===saved.placement)&&!!element.closest('#cart-panel')===saved.inCart&&!!element.closest('#modal')===saved.inModal;
  let candidate=$$('[data-action]').find(element=>element.dataset.action===saved.action&&(!saved.product||element.closest('[data-product]')?.dataset.product===saved.product)&&['key','id','group','item','category'].every(key=>!saved[key]||element.dataset[key]===saved[key])&&sameRegion(element)&&!element.disabled);
  if(!candidate&&saved.group)candidate=$$('[data-group]').find(element=>element.dataset.group===saved.group&&element.dataset.item===saved.item&&!element.disabled);
  if(!candidate&&saved.product)candidate=$$('[data-product]').find(element=>element.dataset.product===saved.product&&sameRegion(element))?.querySelector('.quantity-control button:last-child,.add-button,.product-heading');
  if(!candidate&&saved.inCart)candidate=$('.cart-line button,#cart-panel [data-action="mode"]');
  if(!candidate&&saved.product&&!saved.inModal)candidate=$('#catalog-title');
  candidate?.focus({preventScroll:true});
}
function persistCart() {
  const focused=rememberControl();
  store('chavan:cart:v1',state.cart);
  renderCart();renderDaily();renderCatalog();restoreControl(focused);
}
function selectCategory(id,scroll=true) {
  if(!displayCategories.some(category=>category.id===id))return;
  state.category=id;state.search='';state.limit=12;$('#search').value='';
  renderCategories();renderCatalog();
  if(scroll)scrollMenu();
}
let cartReturnFocus;
let cartInertRegions=[];
function openCart() {
  if(matchMedia('(min-width:1280px)').matches){scrollMenu();if(!matchMedia('(prefers-reduced-motion: reduce)').matches)$('#cart-panel').animate([{boxShadow:'0 0 0 0 #23552d00'},{boxShadow:'0 0 0 5px #23552d33'},{boxShadow:'0 0 0 0 #23552d00'}],{duration:700});return;}
  cartReturnFocus=document.activeElement;
  const panel=$('#cart-panel');
  panel.classList.add('open');panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');
  $('#cart-scrim').hidden=false;document.body.classList.add('cart-is-open');
  cartInertRegions=$$('.header,.menu-sidebar,.page-heading,.page-tools,.promotions-section,.daily-section,.catalog,.menu-heading-row,.restaurant-info,.questions,.footer').filter(element=>!element.inert&&!element.contains(panel));
  cartInertRegions.forEach(element=>element.inert=true);
  $('.cart-close').focus();
}
function closeCart() {
  const panel=$('#cart-panel');const wasOpen=panel.classList.contains('open');
  panel.classList.remove('open');panel.removeAttribute('role');panel.removeAttribute('aria-modal');
  $('#cart-scrim').hidden=true;document.body.classList.remove('cart-is-open');
  cartInertRegions.forEach(element=>element.inert=false);cartInertRegions=[];
  if(wasOpen&&cartReturnFocus?.isConnected)cartReturnFocus.focus();
}
const modal=$('#modal');let modalReturnFocus,modalReturnControl;
function showModal(html,type='simple'){if(!modal.open)modalReturnControl=rememberControl();modalReturnFocus=modal.open?modalReturnFocus:document.activeElement;$('#modal-content').innerHTML=html;modal.dataset.type=type;if(!modal.open)modal.showModal();modal.scrollTop=0;}
function closeModal(){modal.close();state.product=null;state.checkout=null;$('#modal-content').replaceChildren();if(modalReturnFocus?.isConnected)modalReturnFocus.focus();else restoreControl(modalReturnControl);}
function showProduct(id){const product=byId.get(id);if(!product)return;state.product=product;state.productQuantity=1;state.selections=normalizeSelections(product,{});renderProductModal();}
function renderProductModal(){
  const product=state.product;const nutrition=product.nutrition;
  const html=`<div class="modal-product"><div class="modal-product-photo"><img src="${escape(product.image)}" alt="${escape(product.name)}" width="500" height="500"><button class="favorite-button" data-action="favorite" data-id="${product.id}" aria-pressed="${state.favorites.has(product.id)}" aria-label="В избранное: ${escape(product.name)}">${icon('heart')}</button></div><div class="modal-product-info"><h2 id="modal-title">${escape(product.name)}</h2><div class="modal-weight">${product.weight} г · ${escape(categories.find(c=>c.id===product.category)?.name)}</div><p class="modal-description">${escape(product.description||'Описание блюда можно уточнить у ресторана по телефону +7 (926) 355-55-50.')}</p>${nutrition?`<div class="nutrition"><div><strong>${nutrition.calories??'—'}</strong><small>ккал</small></div><div><strong>${nutrition.protein??'—'} г</strong><small>белки</small></div><div><strong>${nutrition.fat??'—'} г</strong><small>жиры</small></div><div><strong>${nutrition.carbohydrates??'—'} г</strong><small>углеводы</small></div></div><p class="nutrition-note">Пищевая ценность на 100 г · по данным ресторана</p>`:''}<div id="modifiers">${modifierMarkup(product)}</div><p class="allergen-note">Есть аллергия? Уточните полный состав у ресторана до заказа.</p><div class="modal-add"><div class="quantity-control"><button data-action="product-minus" aria-label="Уменьшить количество" ${state.productQuantity===1?'disabled':''}>${icon('minus')}</button><span id="product-quantity">${state.productQuantity}</span><button data-action="product-plus" aria-label="Увеличить количество">${icon('plus')}</button></div><button class="button" data-action="product-add" ${product.available?'':'disabled'}>В корзину · <span id="product-total">${formatRub(getLinePrice({id:product.id,modifiers:state.selections},products)*state.productQuantity)}</span></button></div></div></div>`;
  showModal(html,'product');updateFavorites();
}
function modifierMarkup(product){return(product.modifiers||[]).map(group=>`<fieldset class="modifier-group"><legend>${escape(group.name)}<small>${group.max===1?'Выберите один':`До ${group.max} добавок`}</small></legend>${group.items.map(item=>{const qty=state.selections[group.id]?.[item.id]||0;return group.max===1?`<label class="modifier-option"><input type="radio" name="modifier-${group.id}" data-group="${group.id}" value="${item.id}" ${qty?'checked':''}><span>${escape(item.name)}</span><small>${item.price?`+${formatRub(item.price)}`:'0 ₽'}</small></label>`:`<div class="modifier-option"><span>${escape(item.name)}</span><small>+${formatRub(item.price)}</small><div class="modifier-quantity"><button data-action="modifier-minus" data-group="${group.id}" data-item="${item.id}" aria-label="Убрать добавку: ${escape(item.name)}" ${qty?'':'disabled'}>${icon('minus')}</button><output>${qty}</output><button data-action="modifier-plus" data-group="${group.id}" data-item="${item.id}" aria-label="Добавить: ${escape(item.name)}" ${Object.values(state.selections[group.id]||{}).reduce((a,b)=>a+b,0)>=group.max?'disabled':''}>${icon('plus')}</button></div></div>`;}).join('')}</fieldset>`).join('');}
function updateProductTotals(){
  $('#product-quantity').textContent=state.productQuantity;
  $('[data-action="product-minus"]').disabled=state.productQuantity===1;
  $('[data-action="product-plus"]').disabled=state.productQuantity===99;
  $('#product-total').textContent=formatRub(getLinePrice({id:state.product.id,modifiers:state.selections},products)*state.productQuantity);
}
function showAddress(){
  showModal(`<div class="modal-simple"><h2 id="modal-title">Где встретимся?</h2><p class="modal-intro">Привезём любимые блюда к вам или подготовим заказ, чтобы вы забрали его по пути.</p><div class="fulfillment-switch"><button data-action="address-mode" data-mode="delivery" aria-pressed="${state.mode==='delivery'}">${icon('truck')} Доставка</button><button data-action="address-mode" data-mode="pickup" aria-pressed="${state.mode==='pickup'}">${icon('bag')} Самовывоз</button></div><form id="address-form">${state.mode==='delivery'?`<label class="field"><span>Адрес в Москве</span><input name="address" id="delivery-address" placeholder="Улица, дом, корпус" value="${escape(state.address)}" autocomplete="street-address" required minlength="5" maxlength="250"><span class="field-hint">Зону, стоимость и время доставки подтвердит ресторан. В демоверсии адрес не проверяется по карте.</span></label>`:`<div class="note-box">${icon('pin')}<div><strong>Москва, Мосфильмовская, 53</strong><br>Время приготовления и получения согласовывается с рестораном.</div></div>`}<button class="button full" type="submit">${state.mode==='delivery'?'Сохранить адрес':'Выбрать самовывоз'} ${icon('arrow')}</button></form></div>`,'address');
}
function deliveryInfo(){showModal(`<div class="modal-simple"><h2 id="modal-title">К вам домой.<br>Или с собой.</h2><p class="modal-intro">Вкусный стол начинается с любимых блюд. Выберите удобный способ получения.</p><div class="info-grid"><div class="info-card">${icon('truck')}<h3>Доставка по Москве</h3><p>Зона, время и стоимость зависят от адреса. Точные условия подтвердит ресторан.</p></div><div class="info-card">${icon('bag')}<h3>Самовывоз</h3><p>Заберите заказ по адресу: Москва, Мосфильмовская, 53. Уточните время готовности по телефону.</p></div></div><div class="note-box">${icon('info')}<span>Это демонстрационная версия нового сайта. Для настоящего заказа перейдите на действующий сайт или позвоните в ресторан.</span></div><div class="form-buttons"><a class="button" href="tel:+79263555550">Позвонить в ресторан</a><a class="button secondary" href="https://chavan-chudu.ru/delivery" target="_blank" rel="noopener">Условия доставки ${icon('arrow')}</a></div></div>`,'info');}
function checkoutField(name,label,placeholder,type='text',extra=''){
  const value=state.checkout?.[name]||'';
  return `<label class="field"><span>${label}</span><input name="${name}" id="checkout-${name}" type="${type}" placeholder="${placeholder}" value="${escape(value)}" ${extra} aria-describedby="error-${name}"><span class="field-error" id="error-${name}"></span></label>`;
}
function startCheckout(){if(!state.cart.length)return;closeCart();state.checkout={name:'',phone:'',address:state.address,mode:state.mode,comment:'',consent:false};renderCheckout();}
function renderCheckout(){showModal(`<div class="modal-simple"><h2 id="modal-title">Оформление заказа</h2><div class="checkout-steps"><span class="active">1. Контакты и получение</span>${icon('arrow')}<span>2. Проверка заказа</span></div><div class="note-box demo">${icon('info')}<span><strong>Попробуйте новое оформление.</strong> Это демоверсия: заказ не отправится в ресторан, оплата не производится. Можно использовать вымышленные данные.</span></div><form id="checkout-form" novalidate><div class="field-grid">${checkoutField('name','Как к вам обращаться','Ваше имя','text','autocomplete="given-name" maxlength="80" required')}${checkoutField('phone','Номер телефона','+7 (999) 123-45-67','tel','autocomplete="tel" inputmode="tel" maxlength="25" required')}</div>${state.mode==='delivery'?checkoutField('address','Адрес доставки','Москва, улица, дом, квартира','text','autocomplete="street-address" maxlength="250" required'):`<div class="note-box">${icon('pin')}<span><strong>Самовывоз</strong><br>Москва, Мосфильмовская, 53. Время получения согласовывается с рестораном.</span></div>`}<label class="field"><span>Комментарий к заказу <span class="field-hint" style="display:inline">· необязательно</span></span><textarea name="comment" placeholder="Например, сколько нужно приборов" maxlength="500">${escape(state.checkout?.comment||'')}</textarea></label>${state.mode==='delivery'?`<div class="note-box">${icon('truck')}<span>Стоимость доставки и время приезда уточняются после проверки адреса. В итог ниже включены только блюда.</span></div>`:''}<label class="checkbox-label"><input type="checkbox" name="consent" ${state.checkout?.consent?'checked':''} aria-describedby="error-consent"><span>Я понимаю, что это проверка интерфейса: настоящий заказ не создаётся и данные остаются только в открытой вкладке.</span></label><p class="field-error" id="error-consent"></p><div class="cart-totals">${totalsMarkup(totals())}</div><button type="submit" class="button full">Проверить заказ ${icon('arrow')}</button></form></div>`,'checkout');}
function showReview(){
  const checkout=state.checkout;
  showModal(`<div class="modal-simple"><h2 id="modal-title">Всё ли верно?</h2><div class="checkout-steps"><span>1. Контакты и получение</span>${icon('arrow')}<span class="active">2. Проверка заказа</span></div><div class="checkout-review-list">${state.cart.map(line=>`<div class="review-row"><span>${escape(byId.get(line.id).name)} × ${line.quantity}${getLineDescription(line,products)?`<small>${escape(getLineDescription(line,products))}</small>`:''}</span><strong>${formatRub(getLinePrice(line,products)*line.quantity)}</strong></div>`).join('')}</div><div class="review-details"><strong>${escape(checkout.name)}</strong> · ${escape(checkout.phone)}<br>${state.mode==='delivery'?`Доставка: ${escape(checkout.address)}`:'Самовывоз: Москва, Мосфильмовская, 53'}${checkout.comment?`<br>Комментарий: ${escape(checkout.comment)}`:''}</div>${totalsMarkup(totals())}<div class="note-box demo">${icon('info')}<span>Это последний шаг демонстрации. Ресторан не получит заказ, оплачивать ничего не нужно.</span></div><div class="form-buttons"><button class="button secondary" data-action="edit-checkout">Изменить данные</button><button class="button" data-action="complete-demo">Завершить демозаказ ${icon('check')}</button></div></div>`,'review');
}
function completeDemo(){
  const count=totals().count;state.checkout=null;state.address='';renderCart();
  showModal(`<div class="modal-simple success"><div class="success-mark">${icon('check')}</div><h2 id="modal-title">Всё получилось!</h2><p>Вы собрали ${count} ${plural(count,'блюдо','блюда','блюд')} и прошли оформление.<br><strong>Это демозаказ — он не отправлен в ресторан.</strong><br>Корзина сохранена, а введённые контакты удалены из формы.</p><p>Уже захотелось попробовать? Настоящий заказ можно оформить на действующем сайте.</p><a class="button full" href="https://chavan-chudu.ru/" target="_blank" rel="noopener">На сайт ресторана ${icon('arrow')}</a><button class="text-link" data-action="close-modal">Продолжить знакомство с меню</button></div>`,'success');
}
function clearCart(){showModal(`<div class="modal-simple"><h2 id="modal-title">Очистить корзину?</h2><p class="modal-intro">Все выбранные блюда и добавки будут удалены. Избранное останется на месте.</p><div class="form-buttons"><button class="button secondary" data-action="close-modal">Оставить блюда</button><button class="button" data-action="confirm-clear">Очистить</button></div></div>`,'clear');}

document.addEventListener('click',event=>{
  const sectionLink=event.target.closest('a[href="#daily"],a[href="#promotions"]');
  if(sectionLink){
    const search=$('#search');
    clearTimeout(searchTimer);
    if(state.search||search.value){
      state.search='';state.limit=12;search.value='';renderCategories();renderCatalog();
    }
    return;
  }
  const button=event.target.closest('[data-action]');if(!button||button.disabled)return;
  const {action,id,key,mode,category,group,item}=button.dataset;
  switch(action){
    case 'category':selectCategory(category);break;
    case 'open-categories':showCategories();break;
    case 'choose-category':closeModal();selectCategory(category);$('#catalog-title').focus({preventScroll:true});break;
    case 'promotion-details':showPromotion(button.dataset.promotion);break;
    case 'reset-menu':selectCategory('all');break;
    case 'offers':selectCategory('offers');break;
    case 'favorites':selectCategory('favorites');break;
    case 'load-more':{const before=state.limit;state.limit+=12;renderCatalog();const first=$$('.product-heading',$('#product-grid'))[before];first?.focus({preventScroll:true});break;}
    case 'favorite':{const focused=rememberControl();if(state.favorites.has(id))state.favorites.delete(id);else state.favorites.add(id);store('chavan:favorites:v1',[...state.favorites]);renderCategories();if(state.category==='favorites')renderCatalog();else updateFavorites();restoreControl(focused);toast(state.favorites.has(id)?'Блюдо сохранено в избранном':'Блюдо убрано из избранного');break;}
    case 'product':showProduct(id);break;
    case 'add':{const product=byId.get(id);if(product.modifiers?.length)showProduct(id);else {state.cart=addItem(state.cart,id,1,products);persistCart();toast(`${product.name} — в корзине`);}break;}
    case 'line-minus':case 'line-plus':{const delta=action==='line-plus'?1:-1;state.cart=updateLine(state.cart,key,delta,products);persistCart();break;}
    case 'cart':openCart();break;
    case 'close-cart':closeCart();break;
    case 'mode':state.mode=mode;renderCart();break;
    case 'address':showAddress();break;
    case 'address-mode':{const input=$('#delivery-address');if(input)state.address=input.value.trim();state.mode=mode;renderCart();showAddress();break;}
    case 'delivery-info':deliveryInfo();break;
    case 'close-modal':closeModal();break;
    case 'product-minus':state.productQuantity=Math.max(1,state.productQuantity-1);updateProductTotals();break;
    case 'product-plus':state.productQuantity=Math.min(99,state.productQuantity+1);updateProductTotals();break;
    case 'modifier-minus':case 'modifier-plus':{const focused=rememberControl();const selectedGroup=state.selections[group]||{};const newCount=Math.max(0,(selectedGroup[item]||0)+(action==='modifier-plus'?1:-1));state.selections=normalizeSelections(state.product,{...state.selections,[group]:{...selectedGroup,[item]:newCount}});$('#modifiers').innerHTML=modifierMarkup(state.product);updateProductTotals();restoreControl(focused);break;}
    case 'product-add':{const name=state.product.name;state.cart=addItem(state.cart,state.product.id,state.productQuantity,products,state.selections);persistCart();closeModal();toast(`${name} — в корзине`);break;}
    case 'checkout':startCheckout();break;
    case 'edit-checkout':renderCheckout();break;
    case 'complete-demo':completeDemo();break;
    case 'clear-cart':clearCart();break;
    case 'confirm-clear':state.cart=[];state.promoCode='';state.promoError='';persistCart();closeModal();toast('Корзина очищена');break;
  }
});
document.addEventListener('change',event=>{
  if(event.target.matches('input[data-group]')){const {group}=event.target.dataset;state.selections=normalizeSelections(state.product,{...state.selections,[group]:{[event.target.value]:1}});updateProductTotals();}
  if(event.target.id==='sort'){state.sort=event.target.value;renderCatalog();}
});
document.addEventListener('submit',event=>{
  const form=event.target;
  if(form.id==='search-form'){event.preventDefault();clearTimeout(searchTimer);renderCategories();renderCatalog();scrollMenu();return;}
  if(form.id==='address-form'){event.preventDefault();if(state.mode==='delivery')state.address=new FormData(form).get('address').trim();renderCart();closeModal();toast(state.mode==='delivery'?'Адрес сохранён для этой вкладки':'Выбран самовывоз');}
  if(form.id==='promo-form'){event.preventDefault();state.promoCode=$('#promo').value.trim().toUpperCase();state.promoError=state.promoCode?'В демоверсии промокоды не активны. Скидки из меню уже учтены.':'Введите промокод';renderCart();$('#promo')?.focus();}
  if(form.id==='checkout-form'){
    event.preventDefault();const values=new FormData(form);state.checkout={name:values.get('name').trim(),phone:values.get('phone').trim(),address:state.mode==='delivery'?values.get('address').trim():'',mode:state.mode,comment:values.get('comment').trim(),consent:values.has('consent')};
    const errors=validateCheckout(state.checkout);$$('.field-error',form).forEach(el=>el.textContent='');$$('input',form).forEach(el=>el.removeAttribute('aria-invalid'));
    Object.entries(errors).forEach(([field,message])=>{const output=$(`#error-${field}`);if(output)output.textContent=message;const input=$(`[name="${field}"]`,form);input?.setAttribute('aria-invalid','true');});
    if(Object.keys(errors).length){$('[aria-invalid=true]',form)?.focus();return;}showReview();
  }
});
let searchTimer;
$('#search').addEventListener('input',event=>{state.search=event.target.value.trim();state.limit=12;clearTimeout(searchTimer);searchTimer=setTimeout(()=>{renderCategories();renderCatalog();},120);});
$('#cart-scrim').addEventListener('click',closeCart);
modal.addEventListener('click',event=>{if(event.target===modal){const rect=modal.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeModal();}});
modal.addEventListener('cancel',event=>{event.preventDefault();closeModal();});
document.addEventListener('keydown',event=>{
  if(event.key==='/'&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)&&!modal.open&&!$('#cart-panel').classList.contains('open')){event.preventDefault();$('#search').focus();$('.page-tools').scrollIntoView({block:'start'});}
  if(event.key==='Escape'&&!modal.open)closeCart();
  if(event.key==='Tab'&&$('#cart-panel').classList.contains('open')&&!modal.open){const focusable=$$('button:not([disabled]),a[href],input:not([disabled]),select',$('#cart-panel')).filter(el=>el.offsetParent!==null);const first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
});
matchMedia('(min-width:1280px)').addEventListener('change',event=>{if(event.matches)closeCart();});
window.addEventListener('storage',event=>{
  if(event.key==='chavan:cart:v1'){
    const focused=rememberControl();state.cart=normalizeCart(readStorage(event.key,[]),products);renderCart();renderDaily();renderCatalog();restoreControl(focused);
    if(modal.open&&['checkout','review'].includes(modal.dataset.type)){closeModal();toast('Корзина изменилась в другой вкладке. Проверьте её перед оформлением.');}
  }
  if(event.key==='chavan:favorites:v1'){
    const focused=rememberControl();const next=readStorage(event.key,[]);state.favorites=new Set(Array.isArray(next)?next.filter(id=>byId.has(id)):[]);renderCategories();renderDaily();renderCatalog();restoreControl(focused);
  }
});
$('#year').textContent=new Date().getFullYear();
fillIcons();renderCategories();renderPromotion();renderDaily();renderCatalog();renderCart();
