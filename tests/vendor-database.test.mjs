import {test as nodeTest,before,after} from 'node:test';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const basePath=process.env.SUPABASE_SQL_PATH,migrationPath=process.env.SUPABASE_VENDOR_SQL_PATH;
const test=(name,fn)=>nodeTest(name,{skip:!(basePath&&migrationPath)?'Define los archivos SQL externos para validar permisos de proveedores':false},fn);
let db,vendors,mixedOrder,otherOrder;
const customer='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const scalar=async(sql,args=[])=>(await db.query(sql,args)).rows[0]?.v;
async function role(id){await db.exec(`reset role;select set_config('request.jwt.claim.sub','${id}',false);set role authenticated;`);}
async function admin(sql){await db.exec('reset role');await db.exec(sql);}
before(async()=>{
 if(!basePath||!migrationPath)return;
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
 await db.exec(await readFile(basePath,'utf8'));
 const migration=await readFile(migrationPath,'utf8');vendors=[...migration.matchAll(/stall_members\(user_id,stall_id\) values\('([^']+)','([^']+)'\)/g)].map(m=>({id:m[1],stall:m[2]}));assert.equal(vendors.length,3);
 for(const id of [customer,other,...vendors.map(v=>v.id)])await db.query('insert into auth.users(id) values($1)',[id]);
 await db.exec(migration);
});
after(async()=>{if(db)await db.close();});
test('cada proveedor solo puede leer su propia membresía',async()=>{
 for(const v of vendors){await role(v.id);const rows=(await db.query('select * from public.stall_members')).rows;assert.equal(rows.length,1);assert.equal(rows[0].stall_id,v.stall);}
 await role(customer);assert.equal(await scalar('select count(*)::int v from public.stall_members'),0);
 await assert.rejects(db.query('insert into public.stall_members(user_id,stall_id) values($1,$2)',[customer,'p1']),/permission denied/);
});
test('clientes y usuarios anónimos no administran negocios',async()=>{
 await role(customer);await assert.rejects(db.query('select public.vendor_adjust_stock(1,1,$1,$2)',['Prueba',randomUUID()]),/autorizados/);
 await assert.rejects(db.exec('select public.get_vendor_dashboard()'),/no autorizado/);
 await db.exec('reset role;set role anon');await assert.rejects(db.exec('select public.get_vendor_dashboard()'),/permission denied/);
});
test('reposición afecta solo al puesto propio y crea historial',async()=>{
 await role(vendors[0].id);const id=randomUUID();await db.query('select public.vendor_adjust_stock(1,10,$1,$2)',['Reposición',id]);
 assert.equal(await scalar("select stock v from public.inventory where product_id=1 and stall_id='p1'"),16);
 assert.equal(await scalar("select stock v from public.inventory where product_id=1 and stall_id='p2'"),5);
 const dashboard=await scalar('select public.get_vendor_dashboard() v');assert.equal(dashboard.stall.id,'p1');assert.equal(dashboard.events.length,1);
 await db.query('select public.vendor_adjust_stock(1,10,$1,$2)',['Reposición',id]);assert.equal(await scalar("select stock v from public.inventory where product_id=1 and stall_id='p1'"),16);
 await assert.rejects(db.query('select public.vendor_adjust_stock(1,5,$1,$2)',['Reposición',id]),/ya utilizada/);
});
test('retiro, motivo obligatorio y límites impiden stock negativo',async()=>{
 await role(vendors[0].id);await db.query('select public.vendor_adjust_stock(1,-2,$1,$2)',['Merma',randomUUID()]);
 assert.equal(await scalar("select stock v from public.inventory where product_id=1 and stall_id='p1'"),14);
 await assert.rejects(db.query('select public.vendor_adjust_stock(1,-999,$1,$2)',['Merma',randomUUID()]),/más unidades/);
 await assert.rejects(db.query('select public.vendor_adjust_stock(1,1,$1,$2)',['',randomUUID()]),/motivo/);
 await assert.rejects(db.query('select public.vendor_adjust_stock(1,0,$1,$2)',['Prueba',randomUUID()]),/cantidad/);
});
test('precio propio validado y protegido contra sobrescritura concurrente',async()=>{
 await role(vendors[0].id);await db.exec('select public.vendor_update_price(1,4.3,4.2)');
 assert.equal(Number(await scalar("select price v from public.inventory where product_id=1 and stall_id='p1'")),4.3);
 assert.equal(Number(await scalar("select price v from public.inventory where product_id=1 and stall_id='p2'")),4.5);
 await assert.rejects(db.exec('select public.vendor_update_price(1,4.6,4.2)'),/Otro cambio/);
 await assert.rejects(db.exec('select public.vendor_update_price(1,-1,4.3)'),/Precio inválido/);
 await assert.rejects(db.exec('select public.vendor_update_price(1,4.333,4.3)'),/Precio inválido/);
 await assert.rejects(db.exec('update public.inventory set stock=500'),/permission denied/);
 await assert.rejects(db.exec('select * from public.inventory_events'),/permission denied/);
});
test('incorporar un producto crea existencias solo en el negocio propio',async()=>{
 await admin("insert into public.products values(999,1,'Producto nuevo','/imagenes/arroz.jpg',false)");
 await role(vendors[0].id);await db.exec('select public.vendor_link_product(999,5,8)');
 assert.equal(await scalar("select stock v from public.inventory where product_id=999 and stall_id='p1'"),8);
 assert.equal(await scalar('select count(*)::int v from public.inventory where product_id=999'),1);
 await role(vendors[1].id);await assert.rejects(db.query('select public.vendor_adjust_stock(999,1,$1,$2)',['Prueba',randomUUID()]),/no pertenece/);
});
test('pedidos mixtos muestran solo los artículos y totales del propio proveedor',async()=>{
 await role(customer);await db.query("insert into public.cart_items values($1,1,'p1',1,4.3),($1,1,'p2',2,4.5)",[customer]);mixedOrder=await scalar("select public.create_order($1,'recoger',false) v",[randomUUID()]);
 await role(other);await db.query("insert into public.cart_items values($1,3,'p3',1,9.5)",[other]);otherOrder=await scalar("select public.create_order($1,'recoger',false) v",[randomUUID()]);
 for(const v of vendors.slice(0,2)){await role(v.id);const d=await scalar('select public.get_vendor_dashboard() v');assert.equal(d.orders.length,1);assert.equal(d.orders[0].id,mixedOrder);assert.equal(d.orders[0].items.length,1);assert.equal(Number(d.orders[0].total),v.stall==='p1'?4.3:9);}
 await role(vendors[2].id);const d=await scalar('select public.get_vendor_dashboard() v');assert.equal(d.orders.length,1);assert.equal(d.orders[0].id,otherOrder);
});
test('preparación requiere pago y un pedido del negocio',async()=>{
 await role(vendors[0].id);await assert.rejects(db.query("select public.vendor_set_order_stage($1,'preparando')",[mixedOrder]),/pago confirmado/);
 await assert.rejects(db.query("select public.vendor_set_order_stage($1,'preparando')",[otherOrder]),/no pertenece/);
 await role(customer);await db.query("select public.confirm_demo_payment($1,'billetera')",[mixedOrder]);
 await role(vendors[0].id);await db.query("select public.vendor_set_order_stage($1,'preparando')",[mixedOrder]);await db.query("select public.vendor_set_order_stage($1,'listo')",[mixedOrder]);
 await assert.rejects(db.query("select public.vendor_set_order_stage($1,'nuevo')",[mixedOrder]),/retroceder/);
 const d=await scalar('select public.get_vendor_dashboard() v');assert.equal(d.orders[0].stage,'listo');assert.equal(Number(d.stats.sales),4.3);
 await role(vendors[1].id);const second=await scalar('select public.get_vendor_dashboard() v');assert.equal(second.orders[0].stage,'nuevo');
});
test('el cliente ve sus estados, otro cliente no; no puede modificarlos',async()=>{
 await role(customer);assert.equal(await scalar('select count(*)::int v from public.stall_order_progress'),1);
 await assert.rejects(db.query("select public.vendor_set_order_stage($1,'entregado')",[mixedOrder]),/no autorizado/);
 await role(other);assert.equal(await scalar('select count(*)::int v from public.stall_order_progress'),0);
});
test('deshabilitar membresía revoca acceso al panel y a los ajustes',async()=>{
 await admin(`update public.stall_members set enabled=false where user_id='${vendors[0].id}'`);await role(vendors[0].id);
 assert.equal(await scalar('select count(*)::int v from public.stall_members'),0);
 await assert.rejects(db.exec('select public.get_vendor_dashboard()'),/no autorizado/);
});
