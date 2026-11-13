import {test as nodeTest,before,after} from 'node:test';
import {readFile} from 'node:fs/promises';import {randomUUID} from 'node:crypto';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';
const paths=[process.env.SUPABASE_SQL_PATH,process.env.SUPABASE_VENDOR_SQL_PATH,process.env.SUPABASE_PRODUCTS_SQL_PATH];
const test=(name,fn)=>nodeTest(name,{skip:paths.some(p=>!p)?'Se necesitan los tres SQL externos para validar fotos y fases':false},fn);
let db,vendors,prefix,imagePath,newId,orderId;const C='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',D='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const scalar=async(sql,args=[])=>(await db.query(sql,args)).rows[0]?.v;
const role=async id=>db.exec(`reset role;select set_config('request.jwt.claim.sub','${id}',false);set role authenticated;`);
before(async()=>{
 if(paths.some(p=>!p))return;db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb);alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated;grant select on storage.objects to anon,authenticated;grant insert,delete on storage.objects to authenticated;`);
 await db.exec(await readFile(paths[0],'utf8'));const v=await readFile(paths[1],'utf8');vendors=[...v.matchAll(/stall_members\(user_id,stall_id\) values\('([^']+)','([^']+)'\)/g)].map(m=>({id:m[1],stall:m[2]}));
 for(const id of [C,D,...vendors.map(v=>v.id)])await db.query('insert into auth.users(id) values($1)',[id]);await db.exec(v);
 const migration=await readFile(paths[2],'utf8');prefix=migration.match(/https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/public\/product-images\//)[0];await db.exec(migration);imagePath=vendors[0].id+'/'+randomUUID()+'.png';
});
after(async()=>{if(db)await db.close();});
test('la subida de fotos exige proveedor y su carpeta propia',async()=>{
 await role(C);await assert.rejects(db.query("insert into storage.objects(bucket_id,name,metadata) values('product-images',$1,$2)",[C+'/'+randomUUID()+'.png',{mimetype:'image/png'}]),/row-level security/);
 await role(vendors[1].id);await assert.rejects(db.query("insert into storage.objects(bucket_id,name,metadata) values('product-images',$1,$2)",[imagePath,{mimetype:'image/png'}]),/row-level security/);
 await role(vendors[0].id);await db.query("insert into storage.objects(bucket_id,name,metadata) values('product-images',$1,$2)",[imagePath,{mimetype:'image/png'}]);
});
test('alta de producto con foto guarda nombre, categoría, precio y stock solo del negocio',async()=>{
 const ref=randomUUID();await role(vendors[0].id);newId=await scalar('select public.vendor_create_product($1,$2,7.5,12,$3,$4) v',['Producto con foto','ALIMENTOS BÁSICOS',prefix+imagePath,ref]);
 assert.ok(newId>=1000);assert.equal(await scalar('select stock v from public.inventory where product_id=$1',[newId]),12);assert.equal(Number(await scalar('select price v from public.inventory where product_id=$1',[newId])),7.5);
 assert.equal(await scalar('select stall_id v from public.inventory where product_id=$1',[newId]),'p1');
 const again=await scalar('select public.vendor_create_product($1,$2,7.5,12,$3,$4) v',['Producto con foto','ALIMENTOS BÁSICOS',prefix+imagePath,ref]);assert.equal(again,newId);
 assert.equal(await scalar('select count(*)::int v from public.products'),18);
 await db.exec('reset role;set role anon');const catalogue=await scalar('select public.get_catalog() v');const p=catalogue.find(p=>p.id===newId);assert.equal(p.img,prefix+imagePath);assert.equal(p.puestos.length,1);
});
test('no se pueden usar fotos ajenas, enlaces externos, precios negativos o archivos inexistentes',async()=>{
 await role(vendors[1].id);await assert.rejects(db.query('select public.vendor_create_product($1,$2,5,1,$3,$4)',['Producto ajeno','ALIMENTOS BÁSICOS',prefix+imagePath,randomUUID()]),/no pertenece/);
 await role(vendors[0].id);await assert.rejects(db.query('select public.vendor_create_product($1,$2,5,1,$3,$4)',['Producto externo','ALIMENTOS BÁSICOS','https://example.test/photo.png',randomUUID()]),/Sube una foto/);
 await assert.rejects(db.query('select public.vendor_create_product($1,$2,-5,1,$3,$4)',['Producto negativo','ALIMENTOS BÁSICOS',prefix+imagePath,randomUUID()]),/precio/);
 await assert.rejects(db.query('select public.vendor_create_product($1,$2,5,1,$3,$4)',['Producto sin foto','ALIMENTOS BÁSICOS',prefix+vendors[0].id+'/'+randomUUID()+'.png',randomUUID()]),/todavía no está disponible/);
});
test('las fotos publicadas no se borran por la política de limpieza de borradores',async()=>{
 await role(vendors[0].id);const deleted=await db.query('delete from storage.objects where name=$1 returning id',[imagePath]);assert.equal(deleted.rows.length,0);
});
test('el proveedor no puede saltar directamente a entregado o listo',async()=>{
 await role(C);await db.query("insert into public.cart_items values($1,1,'p1',1,4.2),($1,1,'p2',1,4.5)",[C]);orderId=await scalar("select public.create_order($1,'recoger',false) v",[randomUUID()]);await db.query("select public.confirm_demo_payment($1,'billetera')",[orderId]);
 await role(vendors[0].id);await assert.rejects(db.query("select public.vendor_set_order_stage($1,'entregado')",[orderId]),/siguiente fase/);await assert.rejects(db.query("select public.vendor_set_order_stage($1,'listo')",[orderId]),/siguiente fase/);
 await db.query("select public.vendor_set_order_stage($1,'preparando')",[orderId]);await db.query("select public.vendor_set_order_stage($1,'preparando')",[orderId]);
});
test('el cliente ve cada negocio y sus fases; otro cliente no las ve',async()=>{
 await role(C);const phases=await scalar('select public.get_customer_order_phases() v');assert.equal(phases.length,2);assert.equal(phases.find(p=>p.stall_id==='p1').stage,'preparando');assert.equal(phases.find(p=>p.stall_id==='p2').stage,'nuevo');assert.equal(phases.find(p=>p.stall_id==='p1').events.length,1);
 await role(D);assert.deepEqual(await scalar('select public.get_customer_order_phases() v'),[]);
});
test('entrega secuencial se archiva en el historial solo de ese negocio',async()=>{
 await role(vendors[0].id);await db.query("select public.vendor_set_order_stage($1,'listo')",[orderId]);await db.query("select public.vendor_set_order_stage($1,'entregado')",[orderId]);await assert.rejects(db.query("select public.vendor_set_order_stage($1,'preparando')",[orderId]),/siguiente fase/);
 let history=await scalar('select public.get_vendor_history() v');assert.equal(history.orders.length,1);assert.equal(history.orders[0].id,orderId);assert.equal(history.orders[0].stage,'entregado');assert.equal(history.orders[0].items.length,1);
 await role(vendors[1].id);history=await scalar('select public.get_vendor_history() v');assert.equal(history.orders.length,0);
 await role(C);const phases=await scalar('select public.get_customer_order_phases() v');assert.equal(phases.find(p=>p.stall_id==='p1').stage,'entregado');assert.equal(phases.find(p=>p.stall_id==='p1').events.length,3);
});
test('historial paginado conserva registros con la misma fecha sin duplicar ni omitir',async()=>{
 await db.exec('reset role');
 for(let n=0;n<25;n++){const id=randomUUID();await db.query("insert into public.orders(id,user_id,request_id,status,delivery,subtotal,total) values($1,$2,$3,'cancelled','recoger',4.2,4.2)",[id,C,randomUUID()]);await db.query("insert into public.order_items values($1,1,'p1','Arroz','/imagenes/arroz.jpg','Puesto La Esperanza',1,4.2,4.5)",[id]);}
 await role(vendors[0].id);const first=await scalar("select public.get_vendor_history(null,null,'cancelled') v");assert.equal(first.orders.length,20);assert.equal(first.has_more,true);
 const next=await scalar("select public.get_vendor_history($1,$2,'cancelled') v",[first.next_before,first.next_id]);assert.equal(next.orders.length,5);assert.equal(next.has_more,false);assert.equal(new Set([...first.orders,...next.orders].map(o=>o.id)).size,25);
});
test('las nuevas funciones no dan permisos administrativos al cliente',async()=>{
 await role(C);await assert.rejects(db.exec('select public.get_vendor_history()'),/no autorizado/);
 await assert.rejects(db.exec('select * from public.product_creation_requests'),/permission denied/);
 await assert.rejects(db.exec('select * from public.order_phase_events'),/permission denied/);
});
