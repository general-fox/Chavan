import {categories, products} from './data/catalog.js';
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
  category: 'recommended', search: '', sort: 'recommended', limit: 12,
  mode: 'delivery', address: '', promoCode: '', promoError: '',
  product: null, productQuantity: 1, selections: {}, checkout: null,
};
const featuredIds = ['11519', '11530', '11525', '11529', '11524', '11504', '11485', '11520', ...products.filter(p => ['mangal','darginskie-pirogi','kavkazskie-bliuda-1'].includes(p.category)).slice(0,6).map(p => p.id)];
const categoryPriority = ['cuduski','xinkal-1','mangal','darginskie-pirogi','kavkazskie-bliuda-1','salaty-1','supy-1','goriacie-bliuda','xolodnye-zakuski-1','zavtraki-1','deserty-1','detskoe','garniry','sousy-1'];
const displayCategories = [
  {id:'recommended',name:'Рекомендуем',icon:'spark'},
  {id:'all',name:'Всё меню'},
  ...[...categories].sort((a,b) => categoryPriority.indexOf(a.id)-categoryPriority.indexOf(b.id)).map(c => ({...c,name:c.id === 'cuduski'?'Чуду':c.name})),
  {id:'offers',name:'Акции',icon:'tag'},
  {id:'favorites',name:'Избранное',icon:'heart'},
];
const normalizeSearch = value => value.toLocaleLowerCase('ru').replaceAll('ё','е').trim();
let toastTimer;
function toast(message) { clearTimeout(toastTimer); $('#toast').textContent=message; $('#toast').classList.add('visible'); toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),3200); }
function totals() { return calculateTotals(state.cart, products, {mode:state.mode,promoCode:state.promoCode}); }
function productCount(id) { return state.cart.filter(line=>line.id===id).reduce((total,line)=>total+line.quantity,0); }

function renderCategories() {
  $('#categories').innerHTML=displayCategories.map(category=>`<button class="category" data-action="category" data-category="${category.id}" aria-pressed="${state.category===category.id}">${category.icon?icon(category.icon):''}${escape(category.name)}</button>`).join('');
}
function filteredProducts() {
  let items;
  if(state.search) {
    const query=normalizeSearch(state.search);
    items=products.filter(p=>normalizeSearch(`${p.name} ${p.description} ${categories.find(c=>c.id===p.category)?.name||''}`).includes(query));
  } else if(state.category==='recommended') items=featuredIds.map(id=>byId.get(id)).filter(Boolean);
  else if(state.category==='favorites') items=products.filter(p=>state.favorites.has(p.id));
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
function productCard(product) {
  const line = !product.modifiers?.length && state.cart.find(item=>item.id===product.id);
  const categoryName=categories.find(c=>c.id===product.category)?.name;
  const discount=product.oldPrice?Math.round((1-product.price/product.oldPrice)*100):0;
  return `<article class="product-card" data-product="${product.id}"><div class="product-visual"><button class="product-image-button" data-action="product" data-id="${product.id}" aria-label="Подробнее: ${escape(product.name)}"><img src="${escape(product.image)}" alt="${escape(product.name)}" width="500" height="500" loading="lazy" decoding="async"></button>${discount?`<span class="product-badge">−${discount}%</span>`:''}<button class="favorite-button" data-action="favorite" data-id="${product.id}" aria-label="${state.favorites.has(product.id)?'Убрать из избранного':'В избранное'}: ${escape(product.name)}" aria-pressed="${state.favorites.has(product.id)}">${icon('heart')}</button></div><div class="product-details"><button class="product-heading" data-action="product" data-id="${product.id}"><h4>${escape(product.name)}</h4></button><div class="product-weight">${product.weight?`${product.weight} г`:'Вес уточняется'} <span aria-hidden="true">·</span> ${escape(categoryName)}</div><p class="product-description">${escape(product.description || 'Подробнее о блюде — в карточке меню.')}</p><div class="product-price-row"><div><span class="price">${formatRub(product.price)}</span>${product.oldPrice?`<span class="old-price">${formatRub(product.oldPrice)}</span>`:''}</div>${line?quantityControl(line):`<button class="add-button" data-action="add" data-id="${product.id}" aria-label="${product.modifiers?.length?'Выбрать добавки':'Добавить'}: ${escape(product.name)}" ${product.available?'':'disabled'}>${icon('plus')}</button>`}</div></div></article>`;
}
function renderCatalog() {
  const items=filteredProducts();
  const category=displayCategories.find(c=>c.id===state.category);
  $('#catalog-title').textContent=state.search?'Результаты поиска':state.category==='recommended'?'Знакомство с Дагестаном':category?.name||'Меню';
  $('#catalog-description').textContent=state.search?`По запросу «${state.search}»: ${items.length}`:state.category==='recommended'?'Начните с наших фирменных блюд':state.category==='offers'?'Любимые блюда по приятной цене':`${items.length} ${plural(items.length,'блюдо','блюда','блюд')} в меню`;
  $('#results-status').textContent=`Найдено блюд: ${items.length}`;
  $('#product-grid').innerHTML=items.length?items.slice(0,state.limit).map(productCard).join(''):`<div class="empty-results">${icon(state.category==='favorites'?'heart':'search')}<h4>${state.category==='favorites'&&!state.search?'Сохраните то, что любите':'Пока ничего не нашли'}</h4><p>${state.category==='favorites'&&!state.search?'Нажмите на сердечко рядом с блюдом — оно появится здесь.':'Попробуйте другое название или загляните во всё меню.'}</p><button class="button secondary" data-action="reset-menu">Посмотреть меню ${icon('arrow')}</button></div>`;
  $('#catalog-bottom').innerHTML=items.length>state.limit?`<button class="button" data-action="load-more">Показать ещё ${Math.min(12,items.length-state.limit)} ${plural(Math.min(12,items.length-state.limit),'блюдо','блюда','блюд')} ${icon('chevron')}</button>`:state.category==='recommended'&&!state.search?`<button class="button" data-action="reset-menu">Всё меню · ${products.length} ${plural(products.length,'блюдо','блюда','блюд')} ${icon('arrow')}</button>`:'';
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
    $('#cart-content').innerHTML=`<div class="cart-empty"><div class="empty-illustration">${icon('bowl')}</div><h4>Здесь будет<br>ваш вкусный заказ</h4><p>Выберите что-нибудь по душе.<br>А мы соберём всё в одну корзину.</p></div><div class="cart-help">${icon('info')}<span>Добавляйте блюда, чтобы увидеть<br>состав и стоимость заказа.</span></div>`;
    return;
  }
  $('#cart-content').innerHTML=`<button class="cart-address" data-action="address">${icon('pin')}<span>${state.mode==='pickup'?'Самовывоз: Мосфильмовская, 53':escape(state.address||'Укажите адрес доставки')}</span>${icon('chevron')}</button><div class="cart-lines">${state.cart.map(line=>{const product=byId.get(line.id);return `<div class="cart-line"><img src="${escape(product.image)}" alt="" width="45" height="45"><div><button class="cart-line-name" data-action="product" data-id="${product.id}">${escape(product.name)}</button>${getLineDescription(line,products)?`<p class="cart-line-modifiers">${escape(getLineDescription(line,products))}</p>`:''}<div class="cart-line-controls">${quantityControl(line,true)}<strong>${formatRub(getLinePrice(line,products)*line.quantity)}</strong></div></div></div>`;}).join('')}</div><button class="cart-clear" data-action="clear-cart">Очистить корзину</button><form class="promo-form" id="promo-form"><label class="sr-only" for="promo">Промокод</label><input id="promo" placeholder="Промокод" value="${escape(state.promoCode)}" maxlength="30" autocomplete="off"><button type="submit">Применить</button></form>${state.promoError?`<p class="promo-error" role="status">${escape(state.promoError)}</p>`:''}<div class="cart-totals">${totalsMarkup(summary)}</div><button class="button full cart-checkout" data-action="checkout">Перейти к оформлению ${icon('arrow')}</button><p class="cart-disclaimer">Демо новой версии · заказ не отправляется</p>`;
}
function totalsMarkup(summary){return `<div class="total-row"><span>Стоимость блюд</span><strong>${formatRub(summary.subtotal)}</strong></div>${summary.discount?`<div class="total-row discount"><span>Скидка</span><strong>−${formatRub(summary.discount)}</strong></div>`:''}<div class="total-row"><span>${state.mode==='pickup'?'Самовывоз':'Доставка'}</span><strong>${summary.requiresDeliveryQuote?'Уточняется':summary.deliveryFee===0?'Бесплатно':formatRub(summary.deliveryFee)}</strong></div><div class="total-row grand"><span>${summary.requiresDeliveryQuote?'Итого за блюда':'Итого'}</span><strong>${formatRub(summary.total)}</strong></div>`;}
function rememberControl(){const active=document.activeElement;return active?.dataset?.action?{...active.dataset,product:active.closest('[data-product]')?.dataset.product,inCart:!!active.closest('#cart-panel')}:null;}
function restoreControl(saved){if(!saved)return;let candidate=$$('[data-action]').find(el=>el.dataset.action===saved.action&&(!saved.product||el.closest('[data-product]')?.dataset.product===saved.product)&&(!saved.key||el.dataset.key===saved.key)&&(!saved.id||el.dataset.id===saved.id)&&(!saved.group||el.dataset.group===saved.group)&&(!saved.item||el.dataset.item===saved.item)&&!!el.closest('#cart-panel')===saved.inCart&&!el.disabled);if(!candidate&&saved.group)candidate=$$('[data-group]').find(el=>el.dataset.group===saved.group&&el.dataset.item===saved.item&&!el.disabled);if(!candidate&&saved.product)candidate=$$('[data-product]').find(el=>el.dataset.product===saved.product)?.querySelector('.quantity-control button:last-child,.add-button,.product-heading');if(!candidate&&saved.inCart)candidate=$('.cart-line button,#cart-panel [data-action="mode"]');candidate?.focus({preventScroll:true});}
function persistCart(){const focused=rememberControl();store('chavan:cart:v1',state.cart);renderCart();renderCatalog();restoreControl(focused);}
function selectCategory(id,scroll=true){state.category=id;state.search='';state.limit=12;$('#search').value='';renderCategories();renderCatalog();if(scroll)$('#menu').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});}
function openCart(){
  if(matchMedia('(min-width:960px)').matches){$('#menu').scrollIntoView({behavior:'smooth',block:'start'});$('#cart-panel').animate([{boxShadow:'0 0 0 0 #82966a00'},{boxShadow:'0 0 0 5px #82966a55'},{boxShadow:'0 0 0 0 #82966a00'}],{duration:700});return;}
  cartReturnFocus=document.activeElement;$('#cart-panel').classList.add('open');$('#cart-panel').setAttribute('role','dialog');$('#cart-panel').setAttribute('aria-modal','true');$('#cart-scrim').hidden=false;document.body.classList.add('cart-is-open');$('main > .hero').inert=true;$('.catalog').inert=true;$('.menu-heading-row').inert=true;$('.category-bar').inert=true;$('.header').inert=true;$('.about').inert=true;$('.questions').inert=true;$('.footer').inert=true;$('.cart-close').focus();
}
let cartReturnFocus;
function closeCart(){const wasOpen=$('#cart-panel').classList.contains('open');$('#cart-panel').classList.remove('open');$('#cart-panel').removeAttribute('role');$('#cart-panel').removeAttribute('aria-modal');$('#cart-scrim').hidden=true;document.body.classList.remove('cart-is-open');$$('[inert]').forEach(el=>el.inert=false);if(wasOpen&&cartReturnFocus?.isConnected)cartReturnFocus.focus();}
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
  const button=event.target.closest('[data-action]');if(!button||button.disabled)return;
  const {action,id,key,mode,category,group,item}=button.dataset;
  switch(action){
    case 'category':selectCategory(category,false);break;
    case 'reset-menu':selectCategory('all');break;
    case 'offers':selectCategory('offers');break;
    case 'favorites':selectCategory('favorites');break;
    case 'load-more':{const before=state.limit;state.limit+=12;renderCatalog();const first=$$('.product-heading')[before];first?.focus({preventScroll:true});break;}
    case 'scroll-categories':$('#categories').scrollBy({left:280,behavior:'smooth'});break;
    case 'favorite':{if(state.favorites.has(id))state.favorites.delete(id);else state.favorites.add(id);store('chavan:favorites:v1',[...state.favorites]);if(state.category==='favorites')renderCatalog();else updateFavorites();toast(state.favorites.has(id)?'Блюдо сохранено в избранном':'Блюдо убрано из избранного');break;}
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
  if(form.id==='search-form'){event.preventDefault();return;}
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
$('#search').addEventListener('input',event=>{state.search=event.target.value;state.limit=12;clearTimeout(searchTimer);searchTimer=setTimeout(renderCatalog,120);});
$('#cart-scrim').addEventListener('click',closeCart);
modal.addEventListener('click',event=>{if(event.target===modal){const rect=modal.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeModal();}});
modal.addEventListener('cancel',event=>{event.preventDefault();closeModal();});
document.addEventListener('keydown',event=>{
  if(event.key==='/'&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)&&!modal.open&&!$('#cart-panel').classList.contains('open')){event.preventDefault();$('#search').focus();$('#menu').scrollIntoView({block:'start'});}
  if(event.key==='Escape'&&!modal.open)closeCart();
  if(event.key==='Tab'&&$('#cart-panel').classList.contains('open')&&!modal.open){const focusable=$$('button:not([disabled]),a[href],input:not([disabled]),select',$('#cart-panel')).filter(el=>el.offsetParent!==null);const first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
});
matchMedia('(min-width:960px)').addEventListener('change',event=>{if(event.matches)closeCart();});
window.addEventListener('storage',event=>{if(event.key==='chavan:cart:v1'){state.cart=normalizeCart(readStorage(event.key,[]),products);renderCart();renderCatalog();if(modal.open&&['checkout','review'].includes(modal.dataset.type)){closeModal();toast('Корзина изменилась в другой вкладке. Проверьте её перед оформлением.');}}if(event.key==='chavan:favorites:v1'){const next=readStorage(event.key,[]);state.favorites=new Set(Array.isArray(next)?next.filter(id=>byId.has(id)):[]);renderCatalog();}});
$('#year').textContent=new Date().getFullYear();
fillIcons();renderCategories();renderCatalog();renderCart();
