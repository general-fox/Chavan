// Public promotions verified on 2026-10-26; details: ../docs/PROMOTIONS.md.
// Keep gift products separate from billable catalog items.
export const dishOfDayIds = ['11485', '11504', '11519', '11529'];

export const promotions = [
  {
    id: 'kinza-cola-gift',
    title: '2 напитка Kinza Cola в подарок',
    description: 'При заказе от 5 000 ₽ — два напитка Kinza Cola в подарок.',
    conditions: [
      'Сумма заказа от 5 000 ₽.',
      'При заказе самовывозом или доставкой.',
      'На всех точках.'
    ],
    productIds: [],
    sourceUrl: 'https://chavan-chudu.ru/actions/92',
    image: './assets/promotions/kinza-cola.webp'
  },
  {
    id: 'dishes-of-the-day',
    title: 'Блюда дня по специальной цене',
    description: 'Завтрак горца, буррата с томатами, ассорти чуду и ассорти хинкал «Чабан».',
    conditions: [
      'Специальные цены указаны в карточках блюд.'
    ],
    productIds: [...dishOfDayIds],
    sourceUrl: 'https://chavan-chudu.ru/'
  }
];
