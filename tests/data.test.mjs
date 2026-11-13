import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAccount } from '../src/data.js';
test('Pedido pendiente sin pago: datos renderizables', () => {
 const account=normalizeAccount({orders:[{id:'pending',payments:null,order_items:null}]});
 assert.deepEqual(account.orders[0].payments,[]);
 assert.deepEqual(account.orders[0].order_items,[]);
});
test('Pago uno-a-uno de Supabase se conserva como lista para el historial', () => {
 const payment={method:'billetera',amount:10};
 assert.deepEqual(normalizeAccount({orders:[{payments:payment}]}).orders[0].payments,[payment]);
 assert.deepEqual(normalizeAccount({orders:[{payments:[payment]}]}).orders[0].payments,[payment]);
});
test('Cuenta sin relaciones conserva los estados vacíos válidos',()=>{
 const a=normalizeAccount({cart:null,orders:null,reviews:null});
 assert.deepEqual(a.cart,[]);assert.deepEqual(a.orders,[]);assert.deepEqual(a.reviews,[]);
 assert.equal(a.profile.points,0);assert.equal(a.preferences.dark,false);
});
