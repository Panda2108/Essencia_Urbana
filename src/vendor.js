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
  const history=ref([]),historyFilter=ref('all'),historyMore=ref(false),historyCursor=ref(null),historyLoading=ref(false);
  async function loadHistory(append=false){
   if(historyLoading.value)return;historyLoading.value=true;error.value='';
   try{const cursor=append?historyCursor.value:null;const response=await rpc('get_vendor_history',{p_before:cursor?.before||null,p_before_id:cursor?.id||null,p_filter:historyFilter.value});history.value=append?[...history.value,...response.orders]:response.orders;historyMore.value=response.has_more;historyCursor.value={before:response.next_before,id:response.next_id};}catch(e){error.value=e.message||'No pudimos cargar el historial.';}finally{historyLoading.value=false;}
  }
  watch(tab,value=>{if(value==='history')loadHistory();});
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
   lastUpdate.value=new Date().toLocaleTimeString('es-PE');error.value='';
  }
  async function reload(){if(busy.value)return;loading.value=true;try{await load();}catch(e){error.value=e.message||'No pudimos cargar tu negocio. Intenta actualizar.';}finally{loading.value=false;}}
  async function action(fn,success){if(busy.value)return;busy.value=true;error.value='';message.value='';try{await fn();await load();emit('updated');message.value=success;return true;}catch(e){error.value=e.message||'No pudimos guardar el cambio. Vuelve a intentarlo.';return false;}finally{busy.value=false;}}
  const products=computed(()=> (data.value?.products||[]).filter(p=>p.name.toLowerCase().includes(search.value.toLowerCase())&&(filter.value==='all'||filter.value==='out'&&p.stock===0||filter.value==='low'&&p.stock>0&&p.stock<=5)));
  const orders=computed(()=>(data.value?.orders||[]).filter(o=>o.status!=='cancelled'&&o.stage!=='entregado').filter(o=>orderFilter.value==='all'||o.status===orderFilter.value));
  async function adjust(p,direction){
   const n=Number(p.units);if(!Number.isInteger(n)||n<1)return error.value='Indica una cantidad entera mayor que cero.';
   const delta=n*direction,reason=p.reason.trim();if(!reason)return error.value='Escribe el motivo del movimiento.';
   if(direction<0&&n>p.stock)return error.value='No puedes retirar más unidades que las disponibles.';
   if(!p.request||p.request.delta!==delta||p.request.reason!==reason)p.request={id:crypto.randomUUID(),delta,reason};
   await action(()=>rpc('vendor_adjust_stock',{p_product_id:p.id,p_delta:delta,p_reason:reason,p_request_id:p.request.id}),direction>0?'Reposición guardada. El mercado ya muestra el nuevo stock.':'Retiro de stock guardado.');
  }
  async function price(p){const n=Number(p.newPrice);if(!Number.isFinite(n)||n<=0)return error.value='El precio debe ser mayor que cero.';await action(()=>rpc('vendor_update_price',{p_product_id:p.id,p_price:n,p_expected_price:Number(p.price)}),'Precio actualizado. Los pedidos anteriores conservan su precio.');}
  async function setStage(order,stage){await action(()=>rpc('vendor_set_order_stage',{p_order_id:order.id,p_stage:stage}),'Estado de preparación actualizado.');}
  onMounted(async()=>{await reload();if(tab.value==='history')await loadHistory();});
  return{data,loading,busy,error,message,tab,search,filter,orderFilter,lastUpdate,draft,photo,photoPreview,photoInput,categories,history,historyFilter,historyMore,historyLoading,loadHistory,selectPhoto,createProduct,nextStage,stageDone,products,orders,reload,adjust,price,setStage,money,date,stages};
 },template
};
