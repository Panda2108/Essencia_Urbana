import {ref,computed,onMounted} from 'vue/dist/vue.esm-bundler.js';
import {rpc} from './api.js';
import template from './vendor.html?raw';
import './vendor.css';
const money=v=>new Intl.NumberFormat('es-PE',{style:'currency',currency:'PEN'}).format(Number(v||0));
const date=v=>new Date(v).toLocaleString('es-PE',{dateStyle:'short',timeStyle:'short'});
const stages={nuevo:'Nuevo',preparando:'En preparación',listo:'Listo para entregar',entregado:'Entregado'};
export default {
 props:['membership','catalogue'],emits:['updated'],
 setup(props,{emit}){
  const data=ref(null),loading=ref(true),busy=ref(false),error=ref(''),message=ref(''),tab=ref('inventory'),search=ref(''),filter=ref('all'),orderFilter=ref('all'),lastUpdate=ref('');
  const newProduct=ref(''),newPrice=ref(1),newStock=ref(0);
  async function load(){
   const result=await rpc('get_vendor_dashboard');
   data.value={...result,products:(result.products||[]).map(p=>({...p,units:1,newPrice:Number(p.price),reason:'Reposición de mercadería'})),orders:result.orders||[],events:result.events||[]};
   lastUpdate.value=new Date().toLocaleTimeString('es-PE');error.value='';
  }
  async function reload(){if(busy.value)return;loading.value=true;try{await load();}catch(e){error.value=e.message||'No pudimos cargar tu negocio. Intenta actualizar.';}finally{loading.value=false;}}
  async function action(fn,success){if(busy.value)return;busy.value=true;error.value='';message.value='';try{await fn();await load();emit('updated');message.value=success;}catch(e){error.value=e.message||'No pudimos guardar el cambio. Vuelve a intentarlo.';}finally{busy.value=false;}}
  const products=computed(()=> (data.value?.products||[]).filter(p=>p.name.toLowerCase().includes(search.value.toLowerCase())&&(filter.value==='all'||filter.value==='out'&&p.stock===0||filter.value==='low'&&p.stock>0&&p.stock<=5)));
  const orders=computed(()=>(data.value?.orders||[]).filter(o=>orderFilter.value==='all'||o.status===orderFilter.value));
  const available=computed(()=>(props.catalogue||[]).filter(p=>!data.value?.products.some(i=>i.id===p.id)));
  async function adjust(p,direction){
   const n=Number(p.units);if(!Number.isInteger(n)||n<1)return error.value='Indica una cantidad entera mayor que cero.';
   const delta=n*direction,reason=p.reason.trim();if(!reason)return error.value='Escribe el motivo del movimiento.';
   if(direction<0&&n>p.stock)return error.value='No puedes retirar más unidades que las disponibles.';
   if(!p.request||p.request.delta!==delta||p.request.reason!==reason)p.request={id:crypto.randomUUID(),delta,reason};
   await action(()=>rpc('vendor_adjust_stock',{p_product_id:p.id,p_delta:delta,p_reason:reason,p_request_id:p.request.id}),direction>0?'Reposición guardada. El mercado ya muestra el nuevo stock.':'Retiro de stock guardado.');
  }
  async function price(p){const n=Number(p.newPrice);if(!Number.isFinite(n)||n<=0)return error.value='El precio debe ser mayor que cero.';await action(()=>rpc('vendor_update_price',{p_product_id:p.id,p_price:n,p_expected_price:Number(p.price)}),'Precio actualizado. Los pedidos anteriores conservan su precio.');}
  async function link(){if(!newProduct.value)return;await action(()=>rpc('vendor_link_product',{p_product_id:Number(newProduct.value),p_price:Number(newPrice.value),p_stock:Number(newStock.value)}),'Producto incorporado al negocio.');newProduct.value='';}
  async function setStage(order,stage){await action(()=>rpc('vendor_set_order_stage',{p_order_id:order.id,p_stage:stage}),'Estado de preparación actualizado.');}
  onMounted(reload);
  return{data,loading,busy,error,message,tab,search,filter,orderFilter,lastUpdate,newProduct,newPrice,newStock,products,orders,available,reload,adjust,price,link,setStage,money,date,stages};
 },template
};
