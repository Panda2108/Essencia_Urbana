import {ref,computed,onMounted,onUnmounted,watch} from 'vue/dist/vue.esm-bundler.js';
import {rpc,db,result} from './api.js';
import template from './vendor.html?raw';
import './vendor.css';
const money=v=>new Intl.NumberFormat('es-PE',{style:'currency',currency:'PEN'}).format(Number(v||0));
const date=v=>new Date(v).toLocaleString('es-PE',{dateStyle:'short',timeStyle:'short'});
const stages={nuevo:'Recibido',preparando:'En proceso',listo:'Listo para entregar',entregado:'Entregado'};
export default {
 props:['membership','catalogue','initialTab'],emits:['updated'],
 setup(props,{emit}){
  const data=ref(null),loading=ref(true),busy=ref(false),error=ref(''),message=ref(''),tab=ref(props.initialTab||'inventory'),search=ref(''),filter=ref('all'),orderFilter=ref('all'),lastUpdate=ref('');
  const draft=ref({name:'',category:'',price:1,stock:0}),photo=ref(null),photoPreview=ref(''),photoInput=ref(null);
  let uploadedPhoto=null,creationRequest=null;
  const categories=computed(()=>[...new Set((props.catalogue||[]).map(p=>p.category))]);
  const offerPolicy=ref(null),offerAuthorized=ref(false),offerStep=ref('edit'),offerPreview=ref(null),priceHistory=ref([]),priceHistoryLoading=ref(false);
  const offers=ref([]),offersLoading=ref(false),offerName=ref(''),offerEnd=ref(''),offerRows=ref([]);let offerRequest=null;
  const history=ref([]),historyFilter=ref('all'),historyMore=ref(false),historyCursor=ref(null),historyLoading=ref(false);
  async function loadHistory(append=false){
   if(historyLoading.value)return;historyLoading.value=true;error.value='';
   try{const cursor=append?historyCursor.value:null;const response=await rpc('get_vendor_history',{p_before:cursor?.before||null,p_before_id:cursor?.id||null,p_filter:historyFilter.value});history.value=append?[...history.value,...response.orders]:response.orders;historyMore.value=response.has_more;historyCursor.value={before:response.next_before,id:response.next_id};}catch(e){error.value=e.message||'No pudimos cargar el historial.';}finally{historyLoading.value=false;}
  }
  watch(tab,value=>{if(value==='history')loadHistory();if(value==='offers')loadOffers().catch(e=>error.value=e.message);if(value==='prices')loadPriceHistory();});
  watch(historyFilter,()=>{if(tab.value==='history')loadHistory();});
  async function selectPhoto(event){
   error.value='';const file=event.target.files?.[0];if(!file)return;
   if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5242880){error.value='Elige una foto JPG, PNG o WebP de hasta 5 MB.';event.target.value='';return;}
   try{const image=await createImageBitmap(file);image.close();}catch{error.value='No pudimos leer esta imagen. Prueba con otra foto.';event.target.value='';return;}
   if(photoPreview.value)URL.revokeObjectURL(photoPreview.value);photo.value=file;photoPreview.value=URL.createObjectURL(file);uploadedPhoto=null;creationRequest=null;
  }
  async function createProduct(){
   if(!photo.value){error.value='Carga una foto del producto.';return;}
   const name=draft.value.name.trim(),price=Number(draft.value.price),stock=Number(draft.value.stock);
   if(name.length<3||!draft.value.category||price<=0||!Number.isInteger(stock)||stock<0){error.value='Completa nombre, categoría, precio y stock válidos.';return;}
   const saved=await action(async()=>{
    if(!uploadedPhoto){const session=await result(db.auth.getUser());const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[photo.value.type];const path=session.user.id+'/'+crypto.randomUUID()+'.'+ext;await result(db.storage.from('product-images').upload(path,photo.value,{contentType:photo.value.type,cacheControl:'3600',upsert:false}));uploadedPhoto=db.storage.from('product-images').getPublicUrl(path).data.publicUrl;}
    const payload={p_name:name,p_category:draft.value.category,p_price:price,p_stock:stock,p_image_url:uploadedPhoto};const signature=JSON.stringify(payload);if(!creationRequest||creationRequest.signature!==signature)creationRequest={id:crypto.randomUUID(),signature};
    await rpc('vendor_create_product',{...payload,p_request_id:creationRequest.id});
   },'Producto creado. Ya está disponible en tu negocio y en el mercado.');
   if(saved){draft.value={name:'',category:'',price:1,stock:0};photo.value=null;if(photoPreview.value)URL.revokeObjectURL(photoPreview.value);photoPreview.value='';if(photoInput.value)photoInput.value.value='';uploadedPhoto=null;creationRequest=null;tab.value='inventory';}
  }
  const nextStage=order=>Object.keys(stages)[Object.keys(stages).indexOf(order.stage)+1];
  const stageDone=(current,key)=>Object.keys(stages).indexOf(key)<=Object.keys(stages).indexOf(current);
  onUnmounted(()=>{if(photoPreview.value)URL.revokeObjectURL(photoPreview.value);});
  async function load(){
   const result=await rpc('get_vendor_dashboard');
   data.value={...result,products:(result.products||[]).map(p=>({...p,units:1,newPrice:Number(p.price),reason:'Reposición de mercadería'})),orders:result.orders||[],events:result.events||[]};
   const previous=new Map(offerRows.value.map(row=>[row.product_id,row]));offerRows.value=data.value.products.map(p=>({...previous.get(p.id),product_id:p.id,name:p.name,image:p.image,stock:p.stock,regular:Number(p.price),selected:!!previous.get(p.id)?.selected,quantity:previous.get(p.id)?.quantity||1,discount:previous.get(p.id)?.discount||10}));
   if(tab.value==='offers')await loadOffers();if(tab.value==='prices')await loadPriceHistory();
   lastUpdate.value=new Date().toLocaleTimeString('es-PE');error.value='';
  }
  async function reload(){if(busy.value)return;loading.value=true;try{await load();}catch(e){error.value=e.message||'No pudimos cargar tu negocio. Intenta actualizar.';}finally{loading.value=false;}}
  async function action(fn,success){if(busy.value)return;busy.value=true;error.value='';message.value='';try{await fn();await load();emit('updated');message.value=success;return true;}catch(e){error.value=e.message||'No pudimos guardar el cambio. Vuelve a intentarlo.';return false;}finally{busy.value=false;}}
  const products=computed(()=> (data.value?.products||[]).filter(p=>p.name.toLowerCase().includes(search.value.toLowerCase())&&(filter.value==='all'||filter.value==='out'&&p.stock===0||filter.value==='low'&&p.stock>0&&p.stock<=5)));
  const orders=computed(()=>(data.value?.orders||[]).filter(o=>o.status!=='cancelled'&&o.stage!=='entregado').filter(o=>orderFilter.value==='all'||o.status===orderFilter.value));
  async function loadOffers(){offersLoading.value=true;try{const [list,policy]=await Promise.all([rpc('get_vendor_offers'),rpc('get_promotion_policy')]);offers.value=list||[];offerPolicy.value=policy;}finally{offersLoading.value=false;}}
  async function loadPriceHistory(){priceHistoryLoading.value=true;try{priceHistory.value=await rpc('get_vendor_price_history')||[];}catch(e){error.value=e.message;}finally{priceHistoryLoading.value=false;}}
  const minOfferPrice=row=>offerPolicy.value?Math.ceil(Math.round(row.regular*100)*(1-Number(offerPolicy.value.max_discount_percent)/100)-1e-8)/100:row.regular;
  const auditLabels={regular_price_change:'Precio regular actualizado',promotion_requested:'Promoción solicitada',promotion_published:'Promoción autorizada y publicada',promotion_approved:'Promoción aprobada',promotion_rejected:'Promoción rechazada',promotion_paused:'Promoción pausada',promotion_resumed:'Promoción reactivada',promotion_exhausted:'Unidades promocionales agotadas',promotion_units_restored:'Unidades de oferta recuperadas'};
  const selectedOffers=computed(()=>offerRows.value.filter(row=>row.selected));
  const expired=offer=>!!offer.ends_at&&new Date(offer.ends_at)<=new Date();
  const alreadyOffered=id=>offers.value.some(offer=>offer.active&&!expired(offer)&&offer.items.some(item=>item.product_id===id));
  const offerStatus=offer=>offer.authorization_status==='pending'?'Pendiente de autorización':offer.authorization_status==='rejected'?'Rechazada':expired(offer)?'Finalizada':!offer.active?'Pausada':offer.items.every(i=>i.remaining===0)?'Unidades agotadas':'Activa';
  const discountedPrice=row=>Number((row.regular*(1-Number(row.discount||0)/100)).toFixed(2));
  function previewOffer(){
   error.value='';
   if(!offerPolicy.value){error.value='No pudimos cargar las reglas de promoción. Actualiza el panel.';return;}
   if(offerName.value.trim().length<3||!selectedOffers.value.length){error.value='Pon un nombre y selecciona al menos un producto.';return;}
   if(selectedOffers.value.some(row=>!Number.isInteger(Number(row.quantity))||Number(row.quantity)<1||Number(row.quantity)>row.stock||Number(row.discount)<=0||Number(row.discount)>=100||discountedPrice(row)<=0||discountedPrice(row)>=row.regular)){error.value='Revisa las cantidades y descuentos. El precio final debe ser mayor que cero y menor al regular, y no puedes superar el stock disponible.';return;}
   const ends=offerEnd.value?new Date(offerEnd.value):null;if(ends&&ends<=new Date()){error.value='La finalización de la oferta debe estar en el futuro.';return;}
   offerPreview.value={name:offerName.value.trim(),ends_at:ends?.toISOString()||null,items:selectedOffers.value.map(row=>({...row,quantity:Number(row.quantity),discount:Number(row.discount),price:discountedPrice(row)}))};offerAuthorized.value=true;offerStep.value='preview';
  }
  function editOffer(){offerStep.value='edit';offerAuthorized.value=false;}
  async function createOffer(){
   if(!offerPolicy.value||!offerAuthorized.value){error.value='Confirma la autorización de la promoción antes de continuar.';return;}
   if(!offerPreview.value||offerStep.value!=='preview'){error.value='Previsualiza primero tu oferta.';return;}
   const preview=offerPreview.value;const payload={p_name:preview.name,p_items:preview.items.map(row=>({product_id:row.product_id,quantity:row.quantity,price:row.price})),p_ends_at:preview.ends_at};const signature=JSON.stringify(payload);if(!offerRequest||offerRequest.signature!==signature)offerRequest={id:crypto.randomUUID(),signature};
   const saved=await action(()=>rpc('vendor_create_offer',{...payload,p_request_id:offerRequest.id,p_authorized:true}),offerPolicy.value.requires_approval?'Oferta enviada para autorización. Aún no se publica a los clientes.':'Oferta publicada. Los clientes ya pueden ver los precios promocionales.');
   if(saved){offerStep.value='edit';offerPreview.value=null;offerAuthorized.value=false;offerName.value='';offerEnd.value='';offerRows.value.forEach(row=>row.selected=false);offerRequest=null;}
  }
  async function toggleOffer(offer){await action(()=>rpc('vendor_set_offer_active',{p_offer_id:offer.id,p_active:!offer.active}),offer.active?'Oferta pausada. Se mantienen los pedidos que ya estaban reservados.':'Oferta reactivada.');}
  async function adjust(p,direction){
   const n=Number(p.units);if(!Number.isInteger(n)||n<1)return error.value='Indica una cantidad entera mayor que cero.';
   const delta=n*direction,reason=p.reason.trim();if(!reason)return error.value='Escribe el motivo del movimiento.';
   if(direction<0&&n>p.stock)return error.value='No puedes retirar más unidades que las disponibles.';
   if(!p.request||p.request.delta!==delta||p.request.reason!==reason)p.request={id:crypto.randomUUID(),delta,reason};
   await action(()=>rpc('vendor_adjust_stock',{p_product_id:p.id,p_delta:delta,p_reason:reason,p_request_id:p.request.id}),direction>0?'Reposición guardada. El mercado ya muestra el nuevo stock.':'Retiro de stock guardado.');
  }
  async function price(p){const n=Number(p.newPrice);if(!Number.isFinite(n)||n<=0)return error.value='El precio debe ser mayor que cero.';await action(()=>rpc('vendor_update_price',{p_product_id:p.id,p_price:n,p_expected_price:Number(p.price)}),'Precio actualizado. Los pedidos anteriores conservan su precio.');}
  async function setStage(order,stage){await action(()=>rpc('vendor_set_order_stage',{p_order_id:order.id,p_stage:stage}),'Estado de preparación actualizado.');}
  onMounted(async()=>{await reload();if(tab.value==='history')await loadHistory();if(tab.value==='prices')await loadPriceHistory();});
  return{offerStep,offerPreview,discountedPrice,previewOffer,editOffer,offerPolicy,offerAuthorized,minOfferPrice,priceHistory,priceHistoryLoading,auditLabels,offers,offersLoading,offerName,offerEnd,offerRows,selectedOffers,expired,alreadyOffered,offerStatus,createOffer,toggleOffer,data,loading,busy,error,message,tab,search,filter,orderFilter,lastUpdate,draft,photo,photoPreview,photoInput,categories,history,historyFilter,historyMore,historyLoading,loadHistory,selectPhoto,createProduct,nextStage,stageDone,products,orders,reload,adjust,price,setStage,money,date,stages};
 },template
};
