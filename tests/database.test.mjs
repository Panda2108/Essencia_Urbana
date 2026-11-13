import { test as nodeTest, before, after } from 'node:test';
const schemaPath=process.env.SUPABASE_SQL_PATH;
const test=(name,fn)=>nodeTest(name,{skip:!schemaPath?'SQL externo: define SUPABASE_SQL_PATH para ejecutar estas pruebas':false},fn);
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
let db;
const A='11111111-1111-4111-8111-111111111111', B='22222222-2222-4222-8222-222222222222';
const request=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function role(id=A){await db.exec(`reset role; select set_config('request.jwt.claim.sub','${id}',false); set role authenticated;`);}
async function admin(sql){await db.exec('reset role');return db.query(sql);}
async function scalar(sql,args=[]){return (await db.query(sql,args)).rows[0]?.v;}
async function clearCart(){await role();await db.exec("delete from public.cart_items");}
async function add(pid,sid,qty,price){return db.query("insert into public.cart_items values($1,$2,$3,$4,$5)",[A,pid,sid,qty,price]);}
async function create(n,points=false){return scalar("select public.create_order($1, $2, $3) v",[request(n),'recoger',points]);}
before(async()=>{
 if(!schemaPath)return;
 db=new PGlite();
 await db.exec(`create role anon; create role authenticated; create schema auth;
 create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;`);
 await db.exec(await readFile(schemaPath,'utf8'));
 await db.query("insert into auth.users(id) values($1),($2)",[A,B]);
});
after(async()=>{if(db)await db.close();});
test('catálogo público: 17 productos, 3 puestos y perfiles privados',async()=>{
 await db.exec('reset role; set role anon');
 const cat=await scalar("select public.get_catalog() v");assert.equal(cat.length,17);assert.equal(cat[0].puestos.length,3);
 await assert.rejects(db.exec("select * from public.profiles"),/permission denied/);
 await assert.rejects(db.exec(`select public.create_order('${request(99)}','recoger',false)`),/permission denied/);
});
test('carrito y cuenta de otro usuario quedan aislados por RLS',async()=>{
 await role();assert.equal(await scalar("select count(*)::int v from public.profiles"),1);
 await assert.rejects(db.query("insert into public.cart_items values($1,1,'p1',1,4.2)",[B]),/row-level security/);
 await assert.rejects(db.exec("update public.profiles set points=50000"),/permission denied/);
});
test('reserva stock y recalcula precios SQL, reintentar no duplica',async()=>{
 await clearCart();await add(1,'p1',2,4.2);const id=await create(1);
 assert.ok(id);assert.equal(await scalar("select stock v from public.inventory where product_id=1 and stall_id='p1'"),4);
 assert.equal(Number(await scalar("select total v from public.orders where id=$1",[id])),8.4);
 assert.equal(await scalar("select count(*)::int v from public.cart_items"),0);
 assert.equal(await create(1),id);assert.equal(await scalar("select count(*)::int v from public.orders"),1);
});
test('stock insuficiente revierte toda la compra y conserva carrito',async()=>{
 await clearCart();await add(1,'p1',999,4.2);
 await assert.rejects(create(2),/Stock insuficiente/);
 assert.equal(await scalar("select count(*)::int v from public.cart_items"),1);
 assert.equal(await scalar("select stock v from public.inventory where product_id=1 and stall_id='p1'"),4);
});
test('precio manipulado se rechaza antes de reservar stock',async()=>{
 await clearCart();await add(1,'p1',1,0.01);await assert.rejects(create(3),/precio cambió/);
 assert.equal(await scalar("select stock v from public.inventory where product_id=1 and stall_id='p1'"),4);
});
test('editar pedido reserva/devuelve diferencia; cancelar devuelve stock una vez',async()=>{
 await clearCart();const id=await scalar("select id v from public.orders limit 1");
 await db.query("select public.edit_order_item($1,1,'p1',3)",[id]);
 assert.equal(await scalar("select stock v from public.inventory where product_id=1 and stall_id='p1'"),3);
 await db.query("select public.edit_order_item($1,1,'p1',1)",[id]);
 assert.equal(await scalar("select stock v from public.inventory where product_id=1 and stall_id='p1'"),5);
 await db.query("select public.cancel_order($1)",[id]);await db.query("select public.cancel_order($1)",[id]);
 assert.equal(await scalar("select stock v from public.inventory where product_id=1 and stall_id='p1'"),6);
});
test('un cliente no puede editar o pagar pedidos ajenos',async()=>{
 await role();const id=await scalar("select id v from public.orders limit 1");await role(B);
 assert.equal(await scalar("select count(*)::int v from public.orders"),0);
 await assert.rejects(db.query("select public.confirm_demo_payment($1,'tarjeta')",[id]),/Pedido no encontrado/);
 await assert.rejects(db.query("select public.edit_order_item($1,1,'p1',1)",[id]),/no está pendiente/);
});
test('pago de demostración es idempotente y puntos se calculan en SQL',async()=>{
 await clearCart();await add(3,'p1',2,9.9);const id=await create(4);
 await db.query("select public.confirm_demo_payment($1,'billetera')",[id]);
 await db.query("select public.confirm_demo_payment($1,'billetera')",[id]);
 assert.equal(await scalar("select points v from public.profiles where id=$1",[A]),8);
 assert.equal(await scalar("select count(*)::int v from public.payments where order_id=$1",[id]),1);
 await assert.rejects(db.query("select public.cancel_order($1)",[id]),/Solo se pueden cancelar/);
});
test('reseñas exigen compra completada; soporte queda privado',async()=>{
 await role();await assert.rejects(db.query("insert into public.reviews(user_id,product_id,rating,comment) values($1,1,5,'Excelente')",[A]),/row-level security/);
 await db.query("insert into public.reviews(user_id,product_id,rating,comment) values($1,3,5,'Excelente producto')",[A]);
 await db.query("insert into public.support_messages(user_id,message) values($1,'Necesito ayuda con un pedido')",[A]);
 await role(B);assert.equal(await scalar("select count(*)::int v from public.support_messages"),0);
});
test('canje de puntos y cancelación: reintegro exacto sin duplicados',async()=>{
 await admin(`update public.profiles set points=600 where id='${A}'`);await clearCart();await add(3,'p2',2,10.5);
 const id=await create(5,true);assert.equal(Number(await scalar("select total v from public.orders where id=$1",[id])),11);
 assert.equal(await scalar("select points v from public.profiles where id=$1",[A]),100);
 await db.query("select public.cancel_order($1)",[id]);await db.query("select public.cancel_order($1)",[id]);
 assert.equal(await scalar("select points v from public.profiles where id=$1",[A]),600);
});
test('canje inválido y entrega sin dirección no crean pedidos',async()=>{
 await clearCart();await add(1,'p1',1,4.2);await assert.rejects(create(6,true),/compra mínima/);
 await assert.rejects(scalar("select public.create_order($1,'delivery',false) v",[request(7)]),/dirección/);
});
test('archivar historial conserva pedidos y registros de pago',async()=>{
 await role();await db.exec("select public.archive_history()");
 assert.equal(await scalar("select count(*)::int v from public.orders where archived_at is null"),0);
 assert.equal(await scalar("select count(*)::int v from public.payments"),1);
});
