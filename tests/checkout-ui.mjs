import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import { previewProducts } from '../src/catalogue.js';
import { randomUUID } from 'node:crypto';
// Servicio de prueba aislado: replica los formatos PostgREST sin usar cuentas reales.
const userId='11111111-1111-4111-8111-111111111111';
const user={id:userId,aud:'authenticated',role:'authenticated',email:'presentacion@example.test',app_metadata:{provider:'email',providers:['email']},user_metadata:{name:'Presentación'},created_at:new Date().toISOString()};
const token=[{alg:'HS256',typ:'JWT'},{sub:userId,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600}].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.')+'.test';
const state={profile:{id:userId,name:'Presentación',phone:'',address:'',points:0},preferences:{user_id:userId,dark:false,font_size:'normal',voice_reader:false},cart:[],orders:[],reviews:[],support:[]};
const products=structuredClone(previewProducts).map(p=>({...p,img:'/'+p.img}));
let failCheckout=false;let phaseState='nuevo';
const server=await createServer({define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify('https://checkout-test.supabase.co'),'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY':JSON.stringify('sb_publishable_only_for_isolated_browser_tests')},server:{host:'127.0.0.1',port:0}});await server.listen();
const base=server.resolvedUrls.local[0];
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({acceptDownloads:true});
const errors=[];
await context.route('https://*.supabase.co/**',async route=>{
 const request=route.request(),url=new URL(request.url()),path=url.pathname,method=request.method();
 let body={};try{body=request.postDataJSON()||{};}catch{}
 const reply=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 const filter=name=>url.searchParams.get(name)?.replace(/^eq\./,'');
 if(path==='/auth/v1/token')return reply({access_token:token,refresh_token:'test-refresh-token',expires_in:3600,token_type:'bearer',user});
 if(path==='/auth/v1/user')return reply(user);
 if(path==='/auth/v1/logout')return reply({});
 if(path.endsWith('/rpc/get_customer_order_phases'))return reply(state.orders.filter(o=>o.status==='completed').flatMap(o=>[...new Set(o.order_items.map(i=>i.stall_id))].map(sid=>({order_id:o.id,stall_id:sid,stall_name:o.order_items.find(i=>i.stall_id===sid).stall_name,stage:phaseState,updated_at:o.created_at,events:[]}))));
 if(path.endsWith('/rpc/get_catalog'))return reply(products);
 if(path.endsWith('/rpc/create_order')){
  if(failCheckout){failCheckout=false;return reply({message:'Stock insuficiente. Actualiza tu carrito',code:'P0001'},409);}
  const prior=state.orders.find(o=>o.request_id===body.p_request_id);if(prior)return reply(prior.id);
  if(!state.cart.length)return reply({message:'Tu carrito está vacío'},409);
  if(body.p_delivery==='delivery'&&!state.profile.address)return reply({message:'Guarda tu dirección en Mi cuenta'},409);
  const order={id:randomUUID(),request_id:body.p_request_id,user_id:userId,status:'pending',created_at:new Date().toISOString(),delivery:body.p_delivery,delivery_address:state.profile.address,archived_at:null,payments:null,discount:body.p_use_points?10:0};
  order.order_items=state.cart.map(i=>{const p=products.find(p=>p.id===i.product_id),s=p.puestos.find(s=>s.id===i.stall_id);s.stock-=i.quantity;return {...i,name:p.name,image:p.img,stall_name:s.nombre,price:s.precio,reference_price:Math.max(...p.puestos.map(s=>s.precio))};});
  order.subtotal=order.order_items.reduce((n,i)=>n+i.quantity*i.price,0);order.total=order.subtotal-order.discount;
  order.savings=order.order_items.reduce((n,i)=>n+(i.reference_price-i.price)*i.quantity,0);
  if(body.p_use_points)state.profile.points-=500;
  state.orders.unshift(order);state.cart=[];return reply(order.id);
 }
 if(path.endsWith('/rpc/edit_order_item')){
  const o=state.orders.find(o=>o.id===body.p_order_id),p=products.find(p=>p.id===body.p_product_id),s=p.puestos.find(s=>s.id===body.p_stall_id);
  const item=o.order_items.find(i=>i.product_id===p.id&&i.stall_id===s.id);const old=item?.quantity||0;
  if(body.p_quantity===0&&o.order_items.length===1)return reply({message:'Cancela el pedido para quitar su último artículo'},409);
  if(body.p_quantity-old>s.stock)return reply({message:'Stock insuficiente'},409);
  s.stock-=body.p_quantity-old;
  if(!body.p_quantity)o.order_items=o.order_items.filter(i=>i!==item);
  else if(item)item.quantity=body.p_quantity;
  else o.order_items.push({product_id:p.id,stall_id:s.id,quantity:body.p_quantity,name:p.name,image:p.img,stall_name:s.nombre,price:s.precio,reference_price:s.precio});
  o.subtotal=o.order_items.reduce((n,i)=>n+i.quantity*i.price,0);o.total=o.subtotal-o.discount;return reply(null);
 }
 if(path.endsWith('/rpc/confirm_demo_payment')){
  const o=state.orders.find(o=>o.id===body.p_order_id);
  if(o.status!=='completed'){o.status='completed';o.payments={order_id:o.id,method:body.p_method,status:'simulated',amount:o.total};state.profile.points+=Math.round(o.total*0.4);}
  return reply(null);
 }
 if(path.endsWith('/rpc/cancel_order')){
  const o=state.orders.find(o=>o.id===body.p_order_id);
  if(o.status==='pending'){o.status='cancelled';o.order_items.forEach(i=>products.find(p=>p.id===i.product_id).puestos.find(s=>s.id===i.stall_id).stock+=i.quantity);if(o.discount)state.profile.points+=500;}return reply(null);
 }
 if(path.endsWith('/rpc/archive_history')){state.orders.filter(o=>o.status!=='pending').forEach(o=>o.archived_at=new Date().toISOString());return reply(null);}
 const table=path.split('/').at(-1);
 if(table==='stall_members')return reply(null);
 if(table==='profiles'){if(method==='PATCH')Object.assign(state.profile,body);return reply(state.profile);}
 if(table==='preferences'){if(method==='PATCH')Object.assign(state.preferences,body);return reply(state.preferences);}
 if(table==='orders')return reply(state.orders);
 if(table==='reviews'){if(method==='POST')state.reviews.push({...body,created_at:new Date().toISOString()});return reply(state.reviews);}
 if(table==='support_messages'){if(method==='POST')state.support.push(body);return reply(state.support);}
 if(table==='cart_items'){
  if(method==='POST'){const old=state.cart.find(i=>i.product_id===body.product_id&&i.stall_id===body.stall_id);if(old)Object.assign(old,body);else state.cart.push(body);}
  if(method==='PATCH'||method==='DELETE'){const match=i=>String(i.product_id)===filter('product_id')&&i.stall_id===filter('stall_id');if(method==='DELETE')state.cart=state.cart.filter(i=>!match(i));else Object.assign(state.cart.find(match),body);}
  return reply(method==='GET'?state.cart:null);
 }
 return reply({message:'Endpoint de prueba no previsto: '+path},500);
});
try{
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);await page.waitForSelector('.product-card');
 await page.locator('.account-button').click();await page.locator('input[type=email]').fill(user.email);await page.locator('input[type=password]').fill('TestPassword-123');await page.locator('.dialog form button').click();await page.locator('.dialog').waitFor({state:'hidden'});
 await page.locator('.product-card .add-button').first().click();await page.locator('.cart-panel').waitFor();
 failCheckout=true;await page.getByRole('button',{name:'Crear pedido',exact:false}).click();await page.locator('.toast.error').waitFor();assert.equal(state.cart.length,1);assert.equal(state.orders.length,0);assert.equal(await page.locator('.cart-line').count(),1);
 await page.getByRole('button',{name:'Crear pedido',exact:false}).click();await page.locator('.order-card').waitFor();assert.equal(await page.locator('.order-card .status').innerText(),'Por pagar');assert.equal(state.orders[0].payments,null);console.log('PASS: error de stock recuperable y pedido pendiente sin pago no dejan pantalla en blanco.');
 await page.locator('.order-card .quantity button').last().click();await page.waitForFunction(()=>document.querySelector('.order-card .quantity span')?.textContent==='2');
 await page.getByRole('button',{name:'Ver opciones de pago'}).click();await page.getByRole('button',{name:'Confirmar pago de demostración'}).click();await page.getByRole('heading',{name:'¡Tu pago está confirmado!'}).waitFor();
 await page.screenshot({path:'qa/compra-completada.png',fullPage:true});
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Descargar comprobante'}).click();assert.ok((await download).suggestedFilename().endsWith('.txt'));await page.getByRole('button',{name:'Seguir mi pedido',exact:false}).click();assert.equal(await page.locator('.order-card .status').innerText(),'Pago confirmado');assert.ok(state.profile.points>0);console.log('PASS: editar cantidades, pagar, ganar puntos y descargar comprobante.');
 assert.equal(await page.locator('.customer-phases').count(),1);phaseState='preparando';await page.getByRole('button',{name:'Actualizar pedidos',exact:false}).click();await page.locator('.customer-phases h3').filter({hasText:'En proceso'}).waitFor();phaseState='listo';await page.getByRole('button',{name:'Actualizar pedidos',exact:false}).click();await page.locator('.customer-phases h3').filter({hasText:'Listo para entregar'}).waitFor();console.log('PASS: fases del negocio visibles y actualizables por el cliente.');
 await page.reload();await page.waitForSelector('.account-button');await page.getByRole('button',{name:'Mis pedidos',exact:true}).click();await page.locator('.order-card').waitFor();assert.equal(await page.locator('.order-card .status').innerText(),'Pago confirmado');await page.getByRole('button',{name:'Ver comprobante'}).click();await page.locator('.receipt-success').waitFor();await page.keyboard.press('Escape');console.log('PASS: sesión e historial recuperados después de recargar, pago uno-a-uno legible.');
 await page.getByRole('button',{name:'Esencia Urbana, inicio'}).click();await page.locator('.product-card .add-button').first().click();await page.getByRole('button',{name:'Crear pedido',exact:false}).click();await page.locator('.order-card').first().waitFor();await page.getByRole('button',{name:'Cancelar pedido',exact:true}).first().click();await page.locator('.dialog').waitFor();await page.locator('.dialog').getByRole('button',{name:'Cancelar pedido',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.order-card .status')?.textContent==='Cancelado');console.log('PASS: segundo pedido y cancelación sin afectar compra completada.');
 await page.getByRole('button',{name:'Qué bueno verte',exact:false}).click();await page.locator('input[autocomplete=name]').fill('Cliente de presentación');await page.locator('textarea[autocomplete="street-address"]').fill('Av. Mercado 123, Lima');await page.getByRole('button',{name:'Guardar mis datos'}).click();await page.getByRole('status').filter({hasText:'Tus datos fueron guardados'}).waitFor();
 await page.getByRole('button',{name:'Esencia Urbana, inicio'}).click();await page.locator('.product-card .add-button').first().click();await page.locator('.cart-panel input[value=delivery]').check();await page.getByRole('button',{name:'Crear pedido',exact:false}).click();await page.waitForFunction(()=>document.querySelector('.order-card')?.textContent.includes('Av. Mercado 123'));console.log('PASS: perfil guardado y compra con dirección de entrega.');
 await page.getByRole('button',{name:'Agregar productos',exact:true}).click();await page.locator('.product-card .add-button').nth(1).click();await page.getByRole('status').filter({hasText:'Producto agregado al pedido'}).waitFor();await page.getByRole('button',{name:'Terminar edición',exact:false}).click();assert.equal(await page.locator('.order-card').first().locator('.order-line').count(),2);await page.locator('.order-card').first().locator('.order-line').nth(1).locator('.quantity button').first().click();await page.waitForFunction(()=>document.querySelector('.order-card')?.querySelectorAll('.order-line').length===1);console.log('PASS: agregar y quitar productos de un pedido pendiente.');
 await page.getByRole('button',{name:'Mis frecuentes',exact:true}).click();await page.waitForSelector('.product-card');assert.equal(await page.locator('.product-card').count(),1);await page.locator('.rating').first().click();await page.locator('.dialog textarea').fill('Buena compra de presentación');await page.getByRole('button',{name:'Guardar reseña',exact:true}).click();await page.getByRole('status').filter({hasText:'Reseña guardada'}).waitFor();assert.equal(state.reviews.length,1);await page.keyboard.press('Escape');console.log('PASS: frecuentes derivados del historial y reseña de un producto comprado.');
 await page.getByRole('button',{name:'Accesibilidad',exact:true}).click();await page.getByText('Modo oscuro',{exact:true}).click();await page.getByRole('button',{name:'Guardar preferencias en mi cuenta'}).click();await page.getByRole('status').filter({hasText:'Preferencias guardadas'}).waitFor();assert.equal(state.preferences.dark,true);
 await page.getByRole('button',{name:'¿Te ayudamos?',exact:false}).click();await page.locator('.dialog textarea').fill('Consulta de prueba de presentación');await page.getByRole('button',{name:'Enviar mensaje'}).click();await page.locator('.dialog').waitFor({state:'hidden'});assert.equal(state.support.length,1);
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'qa/compra-movil.png',fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);console.log('PASS: preferencias, soporte, móvil y cero errores JavaScript.');
}finally{await context.close();await browser.close();await server.close();}
