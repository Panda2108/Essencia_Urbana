// PostgREST representa las relaciones uno-a-uno como objeto o null.
// Las pantallas trabajan con listas consistentes, también cuando aún no hay pago.
export function normalizeAccount(data = {}) {
  const list = value => Array.isArray(value) ? value : value ? [value] : [];
  return {
    profile: { name: '', phone: '', address: '', points: 0, ...data.profile },
    preferences: { dark: false, font_size: 'normal', voice_reader: false, ...data.preferences },
    cart: list(data.cart),
    orders: list(data.orders).map(order => ({
      ...order,
      order_items: list(order.order_items),
      payments: list(order.payments),
    })),
    reviews: list(data.reviews),
  };
}
