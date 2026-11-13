import { createApp, ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue/dist/vue.esm-bundler.js';
import { db, configured, result, catalogue, accountData, customerPhases, checkoutSettings, rpc } from './api.js';
import { previewProducts } from './catalogue.js';
import template from './app.html?raw';
import VendorPanel from './vendor.js';
import './style.css';
export const money = value => new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(Number(value || 0));
const date = value => new Date(value).toLocaleString('es-PE', { dateStyle: 'medium', timeStyle: 'short' });
const statusLabel = { pending: 'Por pagar', completed: 'Pago confirmado', cancelled: 'Cancelado' };
const phaseLabels={nuevo:'Recibido',preparando:'En proceso',listo:'Listo para entregar',entregado:'Entregado'};
const phaseReached=(stage,key)=>Object.keys(phaseLabels).indexOf(key)<=Object.keys(phaseLabels).indexOf(stage);
const paymentLabel = { pagoefectivo: 'PagoEfectivo', billetera: 'Yape / Plin', tarjeta: 'Tarjeta' };
const iconPaths = {
 cart:'M3 3h2l2.4 11.4a2 2 0 0 0 2 1.6H18a2 2 0 0 0 2-1.6L21 7H6 M10 20h.01 M18 20h.01',
 mic:'M12 15a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v7a3 3 0 0 0 3 3 M5 11v1a7 7 0 0 0 14 0v-1 M12 19v3 M8 22h8',
 user:'M20 21v-2a7 7 0 0 0-14 0v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
 search:'m21 21-5-5 M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14',
 bag:'M5 7h14l1 14H4L5 7Z M9 8V5a3 3 0 0 1 6 0v3',
};
const Icon = {props:['name'], setup(){return {iconPaths};}, template:'<svg class="ui-icon" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="iconPaths[name]"/></svg>'};
createApp({
 components:{Icon,VendorPanel},
 setup() {
 const vendor=ref(null);
 const user=ref(null),products=ref([]),cart=ref([]),orders=ref([]),reviews=ref([]);
 const emptyProfile=()=>({name:'',phone:'',address:'',points:0});
 const defaults=()=>({dark:false,font_size:'normal',voice_reader:false});
 const profile=ref(emptyProfile()),preferences=ref(defaults());
 const entryParams=new URLSearchParams(window.location.search);
 const businessEntry=entryParams.get('panel')==='negocio';
 const vendorInitialTab=['inventory','add','offers','orders','history','activity','prices'].includes(entryParams.get('tab'))?entryParams.get('tab'):'inventory';
 const stallId=ref(entryParams.get('negocio') || '');
 const stalls=computed(()=>[...new Map(products.value.flatMap(p=>p.puestos).map(s=>[s.id,s])).values()]);
 const activeStall=computed(()=>stalls.value.find(s=>s.id===stallId.value));
 const stallUrl=id=>{const url=new URL(window.location.href);url.search='';url.searchParams.set('negocio',id);url.hash='';return url.pathname+url.search;};
 const view=ref('tienda'),category=ref('TODOS'),search=ref(''),sort=ref('recommended');
 const busy=ref(false),loading=ref(true),loadError=ref(''),cartOpen=ref(false),menuOpen=ref(false);
 const modal=ref(null),selected=ref(null),selectedStall=ref(''),selectedOrder=ref(null),addingOrder=ref(null);
 const authMode=ref('login'),authName=ref(''),email=ref(''),password=ref(''),authMessage=ref('');
 const deliveryRate=ref(null);
 const delivery=ref('recoger'),usePoints=ref(false),paymentMethod=ref('billetera');
 const support=ref(''),reviewRating=ref(5),reviewComment=ref(''),toast=ref(null),listening=ref(false);
 let toastTimer,subscription,recognition,previousFocus,orderPoll,phaseRefreshing=false;
 const notify=(message,error=false)=>{clearTimeout(toastTimer);toast.value={message,error};toastTimer=setTimeout(()=>toast.value=null,error?12000:5000);};
 const errorText=e=>{const s=e?.message||'No se pudo completar la operación.';if(/Invalid login credentials/i.test(s))return 'Correo o contraseña incorrectos.';if(/Email not confirmed/i.test(s))return 'Confirma tu correo antes de iniciar sesión.';if(/Failed to fetch|NetworkError/i.test(s))return 'No se pudo conectar. Revisa tu conexión y vuelve a intentar.';return s;};
 async function refresh(){
 const id=user.value?.id;
 const [data,account,settings]=await Promise.all([catalogue(),id?accountData(id):null,checkoutSettings()]);
 if(id!==user.value?.id)return;
 products.value=data||[];deliveryRate.value=settings?.delivery_fee==null?null:Number(settings.delivery_fee);
 if(account){vendor.value=account.vendor;profile.value=account.profile;preferences.value=account.preferences;cart.value=account.cart;orders.value=account.orders;reviews.value=account.reviews;}
 loadError.value='';
 }
 async function refreshPhases(){
  if(!user.value||phaseRefreshing)return;phaseRefreshing=true;const id=user.value.id;
  try{const phases=await customerPhases();if(user.value?.id===id)orders.value=orders.value.map(o=>({...o,progress:phases.filter(p=>p.order_id===o.id)}));}finally{phaseRefreshing=false;}
 }
 async function refreshOrders(){await action(refresh);}
 async function load(){loading.value=true;try{
 if(!configured){products.value=previewProducts.map(p=>({...p,img:'/'+p.img}));return;}
 const session=await result(db.auth.getSession());user.value=session.session?.user||null;await refresh();if(vendor.value)view.value='negocio';else if(businessEntry&&!user.value)modal.value='auth';else if(businessEntry)notify('Esta cuenta no tiene acceso a un negocio. Inicia sesión con el correo del proveedor.',true);
 }catch(e){loadError.value=errorText(e);}finally{loading.value=false;}}
 async function action(fn,success){if(busy.value)return false;busy.value=true;try{await fn();if(success)notify(success);return true;}catch(e){notify(errorText(e),true);return false;}finally{busy.value=false;}}
 const requireUser=()=>{if(!configured){notify('Las compras aún no están disponibles. Inténtalo más tarde.',true);return false;}if(!user.value){modal.value='auth';authMessage.value='';return false;}return true;};
 const categories=computed(()=>['TODOS',...new Set(products.value.map(p=>p.category))]);
 const minPrice=p=>{const available=p.puestos.filter(s=>s.stock>0);return Math.min(...(available.length?available:p.puestos).map(s=>Number(s.precio)));};
 const maxPrice=p=>Math.max(...p.puestos.map(s=>Number(s.precio_regular??s.precio)));
 const stock=p=>p.puestos.reduce((n,s)=>n+Number(s.stock),0);
 const cheapest=p=>[...p.puestos].filter(s=>s.stock>0).sort((a,b)=>a.precio-b.precio)[0];
 const purchasable=s=>s?.oferta_id?Math.min(Number(s.stock),Number(s.unidades_oferta)):Number(s?.stock||0);
 const referencePrice=p=>{const s=cheapest(p);return s?.oferta_id?Number(s.precio_regular):maxPrice(p);};
 const promoUnits=p=>p.puestos.filter(s=>s.oferta_id).reduce((n,s)=>n+Number(s.unidades_oferta||0),0);
 const cartQuantity=(pid,sid)=>cart.value.find(i=>i.product_id===pid&&i.stall_id===sid)?.quantity||0;
 const cartItems=computed(()=>cart.value.map(i=>{const p=products.value.find(p=>p.id===i.product_id),s=p?.puestos.find(s=>s.id===i.stall_id);return {...i,product:p,stall:s,priceChanged:!!s&&Number(s.precio)!==Number(i.expected_price)};}));
 const cartCount=computed(()=>cart.value.reduce((n,i)=>n+i.quantity,0));
 const subtotal=computed(()=>cart.value.reduce((n,i)=>n+Number(i.expected_price)*i.quantity,0));
 const discount=computed(()=>usePoints.value&&profile.value.points>=500&&subtotal.value>=10?10:0);
 const deliveryCost=computed(()=>delivery.value==='delivery'?Number(deliveryRate.value||0):0);
 const cartTotal=computed(()=>subtotal.value-discount.value+deliveryCost.value);
 const savings=computed(()=>cartItems.value.reduce((n,i)=>n+(i.product?Math.max(maxPrice(i.product)-i.expected_price,0)*i.quantity:0),0));
 const visibleOrders=computed(()=>orders.value.filter(o=>!o.archived_at));
 const pendingOrders=computed(()=>orders.value.filter(o=>o.status==='pending'));
 const frequentCounts=computed(()=>{const c={};orders.value.filter(o=>o.status==='completed').forEach(o=>o.order_items.forEach(i=>c[i.product_id]=(c[i.product_id]||0)+i.quantity));return c;});
 const filtered=computed(()=>{let list=products.value.filter(p=>!stallId.value||p.puestos.some(s=>s.id===stallId.value)).map(p=>stallId.value?{...p,puestos:p.puestos.filter(s=>s.id===stallId.value)}:p).filter(p=>p.name.toLocaleLowerCase('es').includes(search.value.toLocaleLowerCase('es'))&&(category.value==='TODOS'||p.category===category.value));if(view.value==='ofertas')list=list.filter(p=>p.offer).map(p=>({...p,puestos:p.puestos.filter(s=>s.oferta_id&&s.unidades_oferta>0)})).filter(p=>p.puestos.length);if(view.value==='frecuentes')list=list.filter(p=>frequentCounts.value[p.id]).sort((a,b)=>frequentCounts.value[b.id]-frequentCounts.value[a.id]);if(sort.value==='asc')list=[...list].sort((a,b)=>minPrice(a)-minPrice(b));if(sort.value==='desc')list=[...list].sort((a,b)=>minPrice(b)-minPrice(a));if(sort.value==='name')list=[...list].sort((a,b)=>a.name.localeCompare(b.name));return list;});
 const title=computed(()=>stallId.value?(activeStall.value?.nombre || 'Negocio no encontrado'):({tienda:'Tu mercado de siempre.',ofertas:'Buenos precios, cerca de ti.',comparar:'Compara y elige mejor.',frecuentes:'Lo que siempre vuelve a casa.'}[view.value]));
 const productReviews=computed(()=>reviews.value.filter(r=>r.product_id===selected.value?.id));
 const rating=p=>{const r=reviews.value.filter(r=>r.product_id===p.id);return r.length?(r.reduce((s,r)=>s+r.rating,0)/r.length).toFixed(1):null;};
 const canReview=computed(()=>orders.value.some(o=>o.status==='completed'&&o.order_items.some(i=>i.product_id===selected.value?.id)));
 function navigate(v){if(stallId.value){stallId.value='';const url=new URL(window.location.href);url.searchParams.delete('negocio');history.replaceState(null,'',url.pathname+url.search+url.hash);}view.value=v;category.value='TODOS';search.value='';menuOpen.value=false;addingOrder.value=null;}
 function compare(p){p=products.value.find(item=>item.id===p.id)||p;selected.value=p;selectedStall.value=cheapest(p)?.id||p.puestos[0].id;modal.value='compare';}
 function speak(text){if(!preferences.value.voice_reader||!('speechSynthesis'in window))return;speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.lang='es-PE';speechSynthesis.speak(u);}
 async function add(p,sid){if(!requireUser())return;const s=p.puestos.find(s=>s.id===sid)||cheapest(p);if(!s||s.stock<1)return notify('No hay stock disponible.',true);await action(async()=>{
 if(addingOrder.value){const o=orders.value.find(o=>o.id===addingOrder.value),i=o?.order_items.find(i=>i.product_id===p.id&&i.stall_id===s.id);await rpc('edit_order_item',{p_order_id:addingOrder.value,p_product_id:p.id,p_stall_id:s.id,p_quantity:(i?.quantity||0)+1});}
 else{const quantity=cartQuantity(p.id,s.id)+1;if(quantity>purchasable(s))throw new Error(s.oferta_id?'Ya agregaste todas las unidades disponibles de esta oferta.':'Ya agregaste todo el stock disponible de este puesto.');await result(db.from('cart_items').upsert({user_id:user.value.id,product_id:p.id,stall_id:s.id,quantity,expected_price:Number(s.precio)}));}
 modal.value=null;await refresh();if(!addingOrder.value)cartOpen.value=true;speak(p.name+' agregado.');},addingOrder.value?'Producto agregado al pedido.':undefined);}
 async function quantity(item,delta){await action(async()=>{const n=item.quantity+delta;if(n>purchasable(item.stall)&&delta>0)throw new Error(item.stall?.oferta_id?'No quedan más unidades de oferta.':'No hay más stock disponible.');const q=n<=0?db.from('cart_items').delete():db.from('cart_items').update({quantity:n});await result(q.eq('user_id',user.value.id).eq('product_id',item.product_id).eq('stall_id',item.stall_id));await refresh();});}
 async function remove(i){await quantity(i,-i.quantity);}
 async function checkout(){if(!requireUser()||!cartCount.value)return;if(delivery.value==='delivery'&&deliveryRate.value===null)return notify('El envío a domicilio no está disponible. Elige recojo en el mercado.',true);await action(async()=>{let request=sessionStorage.getItem('eu_checkout_request');if(!request){request=crypto.randomUUID();sessionStorage.setItem('eu_checkout_request',request);}await rpc('create_order',{p_request_id:request,p_delivery:delivery.value,p_use_points:discount.value>0,p_expected_delivery_fee:deliveryCost.value});sessionStorage.removeItem('eu_checkout_request');usePoints.value=false;cartOpen.value=false;view.value='pedidos';await refresh();},'Pedido guardado. Puedes editarlo, pagarlo o cancelarlo.');}
 function openPay(o){selectedOrder.value=o;modal.value='payment';}
 async function pay(){await action(async()=>{const id=selectedOrder.value.id;await rpc('confirm_demo_payment',{p_order_id:id,p_method:paymentMethod.value});await refresh();const completed=orders.value.find(o=>o.id===id);if(completed)openReceipt(completed);else modal.value=null;},'Pago confirmado. Sigue la preparación en Mis pedidos.');}
 function openReceipt(order){selectedOrder.value=order;modal.value='receipt';}
 function downloadReceipt(){
  const order=selectedOrder.value;if(!order)return;
  const text=['ESENCIA URBANA','COMPROBANTE DE DEMOSTRACIÓN — SIN VALOR TRIBUTARIO','Pedido: '+order.id,'Fecha: '+date(order.created_at),'',...order.order_items.map(i=>i.name+' | '+i.stall_name+' | '+i.quantity+' × '+money(i.price)+' = '+money(i.quantity*i.price)),'','Subtotal: '+money(order.subtotal),'Descuento: '+money(order.discount),'Envío: '+money(order.delivery_fee),'Total: '+money(order.total),'Método: '+(paymentLabel[order.payments[0]?.method]||'Demostración'),'Entrega: '+(order.delivery==='recoger'?'Retiro en el mercado':order.delivery_address),'','No se realizó ningún cobro real.'].join('\n');
  const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='Esencia-Urbana-'+order.id.slice(0,8)+'.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 function askCancel(o){selectedOrder.value=o;modal.value='cancel';}
 async function cancel(){await action(async()=>{await rpc('cancel_order',{p_order_id:selectedOrder.value.id});modal.value=null;if(addingOrder.value===selectedOrder.value.id)addingOrder.value=null;await refresh();},'Pedido cancelado. Stock y puntos canjeados devueltos.');}
 async function edit(o,i,d){await action(async()=>{await rpc('edit_order_item',{p_order_id:o.id,p_product_id:i.product_id,p_stall_id:i.stall_id,p_quantity:Math.max(0,i.quantity+d)});await refresh();});}
 function addToOrder(o){addingOrder.value=o.id;view.value='tienda';category.value='TODOS';search.value='';}
 async function archive(){await action(async()=>{await rpc('archive_history');modal.value=null;await refresh();},'Historial ocultado. Los registros siguen guardados.');}
 async function authenticate(){if(!configured)return;authMessage.value='';await action(async()=>{if(authMode.value==='register'){const d=await result(db.auth.signUp({email:email.value.trim(),password:password.value,options:{data:{name:authName.value.trim()},emailRedirectTo:window.location.origin}}));if(!d.session){authMessage.value='Cuenta creada. Confirma el registro desde tu correo antes de iniciar sesión.';password.value='';return;}user.value=d.user;}else{const d=await result(db.auth.signInWithPassword({email:email.value.trim(),password:password.value}));user.value=d.user;}password.value='';modal.value=null;await refresh();if(vendor.value)navigate('negocio');});}
 function clearAccount(){vendor.value=null;user.value=null;cart.value=[];orders.value=[];reviews.value=[];profile.value=emptyProfile();preferences.value=defaults();addingOrder.value=null;usePoints.value=false;sessionStorage.removeItem('eu_checkout_request');}
 async function logout(){await action(async()=>{await result(db.auth.signOut());clearAccount();modal.value=null;cartOpen.value=false;view.value='tienda';await refresh();});}
 async function saveProfile(){await action(async()=>{await result(db.from('profiles').update({name:profile.value.name.trim(),phone:profile.value.phone.trim(),address:profile.value.address.trim()}).eq('id',user.value.id));await refresh();},'Tus datos fueron guardados.');}
 async function saveSettings(){if(!requireUser())return;await action(async()=>{await result(db.from('preferences').update({dark:preferences.value.dark,font_size:preferences.value.font_size,voice_reader:preferences.value.voice_reader}).eq('user_id',user.value.id));},'Preferencias guardadas.');}
 async function sendSupport(){if(!requireUser())return;await action(async()=>{await result(db.from('support_messages').insert({user_id:user.value.id,message:support.value.trim()}));support.value='';modal.value=null;},'Tu mensaje quedó registrado para el equipo de soporte.');}
 function openReviews(p){if(!requireUser())return;selected.value=p;const r=reviews.value.find(r=>r.product_id===p.id&&r.user_id===user.value.id);reviewRating.value=r?.rating||5;reviewComment.value=r?.comment||'';modal.value='reviews';}
 async function saveReview(){await action(async()=>{await result(db.from('reviews').upsert({user_id:user.value.id,product_id:selected.value.id,rating:Number(reviewRating.value),comment:reviewComment.value.trim()}));await refresh();},'Reseña guardada.');}
 function voiceSearch(){const R=window.SpeechRecognition||window.webkitSpeechRecognition;if(!R)return notify('Tu navegador no admite dictado. Usa el buscador de texto.',true);if(listening.value){recognition?.stop();return;}recognition=new R();recognition.lang='es-PE';recognition.onstart=()=>listening.value=true;recognition.onend=()=>listening.value=false;recognition.onerror=()=>{listening.value=false;notify('Comprueba el permiso del micrófono en el navegador.',true);};recognition.onresult=e=>{const heard=e.results[0][0].transcript.trim().replace(/[.,!?¿¡]+$/g,'');const plain=heard.toLowerCase();if(/^(abrir|ver) carrito/.test(plain))cartOpen.value=true;else if(/^cerrar carrito/.test(plain))cartOpen.value=false;else if(/^(ir a )?(mis )?pedidos$/.test(plain))navigate('pedidos');else if(/^(ir a )?ofertas$/.test(plain))navigate('ofertas');else{view.value='tienda';category.value='TODOS';search.value=heard.replace(/^(buscar|busca)\s+/i,'');}notify('Escuché: '+heard);};recognition.start();}
 watch(preferences,p=>{document.documentElement.dataset.theme=p.dark?'dark':'light';document.documentElement.dataset.font=p.font_size;},{deep:true,immediate:true});
 watch(modal,async v=>{if(v){previousFocus=document.activeElement;await nextTick();document.querySelector('.dialog input, .dialog button')?.focus();}else previousFocus?.focus?.();});
 watch(cartOpen,async v=>{if(v){previousFocus=document.activeElement;await nextTick();document.querySelector('.cart-panel button')?.focus();}else if(!modal.value)previousFocus?.focus?.();});
 const keyHandler=e=>{if(e.key==='Escape'&&!busy.value){modal.value=null;cartOpen.value=false;}const root=modal.value?document.querySelector('.dialog'):cartOpen.value?document.querySelector('.cart-panel'):null;if(e.key==='Tab'&&root){const f=[...root.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea,select,a[href]')].filter(el=>el.offsetParent!==null),first=f[0],last=f.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}};
 onMounted(async()=>{document.addEventListener('keydown',keyHandler);orderPoll=setInterval(()=>{if(user.value&&view.value==='pedidos'&&!busy.value)refreshPhases().catch(()=>{});},15000);await load();if(db)subscription=db.auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_OUT')clearAccount();else if(event==='SIGNED_IN'&&session?.user?.id!==user.value?.id){user.value=session.user;setTimeout(()=>refresh().catch(e=>notify(errorText(e),true)),0);}}).data.subscription;});
 onUnmounted(()=>{document.removeEventListener('keydown',keyHandler);subscription?.unsubscribe();clearInterval(orderPoll);clearTimeout(toastTimer);recognition?.abort();});
 return {purchasable,referencePrice,promoUnits,vendorInitialTab,deliveryRate,deliveryCost,cartTotal,phaseLabels,phaseReached,refreshOrders,vendor,refresh,stallId,stalls,activeStall,stallUrl,configured,user,products,cart,orders,reviews,profile,preferences,view,category,search,sort,busy,loading,loadError,cartOpen,menuOpen,modal,selected,selectedStall,selectedOrder,addingOrder,authMode,authName,email,password,authMessage,delivery,usePoints,paymentMethod,support,reviewRating,reviewComment,toast,listening,money,date,statusLabel,paymentLabel,categories,minPrice,maxPrice,stock,cheapest,cartQuantity,cartItems,cartCount,subtotal,discount,savings,visibleOrders,pendingOrders,filtered,title,productReviews,rating,canReview,navigate,compare,speak,add,quantity,remove,checkout,openPay,pay,openReceipt,downloadReceipt,askCancel,cancel,edit,addToOrder,archive,authenticate,logout,saveProfile,saveSettings,sendSupport,openReviews,saveReview,voiceSearch,load,notify,requireUser};
 },template
}).mount('#app');
