import { normalizeAccount } from './data.js';
import { createClient } from '@supabase/supabase-js';
const url = import.meta.env.VITE_SUPABASE_URL || '';
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || '';
export const configured = /^https:\/\/[^/]+\.supabase\.co$/.test(url) && key.length > 30 && !url.includes('TU-PROYECTO');
export const db = configured ? createClient(url, key) : null;
export async function result(query) { const { data, error } = await query; if (error) throw error; return data; }
export const catalogue = () => result(db.rpc('get_catalog'));
export const rpc = (name, args) => result(db.rpc(name, args));
export async function accountData(id) {
 const [profile, preferences, cart, orders, reviews] = await Promise.all([
 result(db.from('profiles').select('*').eq('id', id).single()),
 result(db.from('preferences').select('*').eq('user_id', id).single()),
 result(db.from('cart_items').select('*').eq('user_id', id).order('product_id')),
 result(db.from('orders').select('*,order_items(*),payments(*)').eq('user_id', id).order('created_at', { ascending: false })),
 result(db.from('reviews').select('*').order('created_at', { ascending: false }))]);
 return normalizeAccount({ profile, preferences, cart, orders, reviews });
}
