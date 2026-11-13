import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {previewProducts} from '../src/catalogue.js';
import assert from 'node:assert/strict';
const id='11111111-1111-4111-8111-111111111111',email='proveedor@example.test';
const user={id,email,aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{name:'Proveedor'},created_at:new Date().toISOString()};
const token=Buffer.from('{}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:id,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.test';
const catalogue=structuredClone(previewProducts).map(p=>({...p,img:'/'+p.img}));
const dashboard={stall:{id:'p1',name:'Puesto La Esperanza',seller:'Sra. Carmen'},stats:{sales:8.4,pending_orders:1,low_stock:1,out_of_stock:1},products:catalogue.slice(0,3).map((p,i)=>({id:p.id,name:p.name,image:p.img,category:p.category,price:p.puestos[0].precio,stock:[2,0,8][i]})),events:[],orders:[{id:'11111111-1111-4111-8111-111111111112',status:'completed',created_at:new Date().toISOString(),customer:'Cliente de prueba',phone:'',delivery:'recoger',stage:'nuevo',total:8.4,items:[{name:catalogue[0].name,quantity:2,price:4.2,image:catalogue[0].img}]},{id:'11111111-1111-4111-8111-111111111113',status:'pending',created_at:new Date().toISOString(),customer:'Cliente pendiente',phone:'',delivery:'delivery',address:'Mercado 123',stage:'nuevo',total:4.2,items:[{name:catalogue[0].name,quantity:1,price:4.2,image:catalogue[0].img}]}]};
const server=await createServer({define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify('https://vendor-test.supabase.co'),'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY':JSON.stringify('sb_publishable_isolated_vendor_ui_test')},server:{host:'127.0.0.1',port:0}});await server.listen();
const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('https://*.supabase.co/**',async route=>{
 const req=route.request(),path=new URL(req.url()).pathname;let body={};try{body=req.postDataJSON()||{};}catch{}
 const reply=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 if(path==='/auth/v1/token')return reply({access_token:token,refresh_token:'test-token',expires_in:3600,token_type:'bearer',user});
 if(path==='/auth/v1/user')return reply(user);
 if(path.endsWith('/rpc/get_catalog'))return reply(catalogue);
 if(path.endsWith('/rpc/get_vendor_dashboard'))return reply(dashboard);
 if(path.endsWith('/rpc/vendor_adjust_stock')){const p=dashboard.products.find(p=>p.id===body.p_product_id);if(p.stock+body.p_delta<0)return reply({message:'No puedes retirar más unidades que las disponibles'},409);dashboard.events.unshift({id:crypto.randomUUID(),product:p.name,kind:'stock',quantity:body.p_delta,before:p.stock,after:p.stock+body.p_delta,reason:body.p_reason,created_at:new Date().toISOString()});p.stock+=body.p_delta;return reply(null);}
 if(path.endsWith('/rpc/vendor_update_price')){const p=dashboard.products.find(p=>p.id===body.p_product_id);p.price=body.p_price;return reply(null);}
 if(path.endsWith('/rpc/vendor_set_order_stage')){dashboard.orders.find(o=>o.id===body.p_order_id).stage=body.p_stage;return reply(null);}
 if(path.endsWith('/profiles'))return reply({id,name:'Puesto La Esperanza',phone:'',address:'',points:0});
 if(path.endsWith('/preferences'))return reply({dark:false,font_size:'normal',voice_reader:false});
 if(path.endsWith('/stall_members'))return reply({stall_id:'p1'});
 if(['/cart_items','/orders','/reviews'].some(s=>path.endsWith(s)))return reply([]);
 return reply({message:'Endpoint de prueba no previsto'},500);
});
try{
 await page.goto(server.resolvedUrls.local[0]);await page.locator('.account-button').click();await page.locator('input[type=email]').fill(email);await page.locator('input[type=password]').fill('TestPassword123!');await page.locator('.dialog form button').click();await page.locator('.vendor-panel').waitFor();await page.locator('.vendor-product').first().waitFor();assert.equal(await page.locator('.vendor-product').count(),3);assert.equal(await page.getByRole('button',{name:'Mi negocio',exact:true}).count(),1);
 const row=()=>page.locator('.vendor-product').first();
 await row().locator('.vendor-stock-controls input[type=number]').fill('5');await row().getByRole('button',{name:'Reponer',exact:false}).click();await page.getByRole('status').filter({hasText:'Reposición guardada'}).waitFor();assert.equal(dashboard.products[0].stock,7);
 await row().locator('.vendor-stock-controls input[type=number]').fill('2');await row().locator('.vendor-stock-controls input[maxlength]').fill('Merma');await row().getByRole('button',{name:'Retirar',exact:false}).click();await page.getByRole('status').filter({hasText:'Retiro de stock guardado'}).waitFor();assert.equal(dashboard.products[0].stock,5);
 await row().locator('.vendor-stock-controls input[type=number]').fill('999');await row().getByRole('button',{name:'Retirar',exact:false}).click();await page.getByRole('alert').waitFor();assert.equal(dashboard.products[0].stock,5);
 await row().locator('.vendor-price input').fill('6.50');await row().getByRole('button',{name:'Guardar precio'}).click();await page.getByRole('status').filter({hasText:'Precio actualizado'}).waitFor();assert.equal(dashboard.products[0].price,6.5);console.log('PASS: inicio de sesión, panel, reposición, retiro, validación de stock y precio.');
 await page.getByRole('button',{name:'Movimientos',exact:true}).click();assert.equal(await page.locator('.vendor-event').count(),2);assert.ok((await page.locator('.vendor-event').first().innerText()).includes('Merma'));
 await page.getByRole('button',{name:'Pedidos del negocio',exact:true}).click();assert.equal(await page.locator('.order-card').count(),2);assert.equal(await page.locator('.vendor-progress').count(),1);await page.getByRole('button',{name:'Listo para entregar',exact:true}).click();await page.getByRole('status').filter({hasText:'Estado de preparación actualizado'}).waitFor();assert.equal(dashboard.orders[0].stage,'listo');console.log('PASS: historial de movimientos, pedidos pagados/pendientes y estado de preparación.');
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'qa/proveedores-movil.png',fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);console.log('PASS: panel móvil sin desbordamiento ni errores JavaScript.');
}finally{await browser.close();await server.close();}
