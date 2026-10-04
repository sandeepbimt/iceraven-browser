use adblock::{Engine, FilterSet};
use adblock::request::Request;
use jni::objects::{JByteArray, JClass, JString};
use jni::sys::{jboolean, jbyteArray, jstring};
use jni::JNIEnv;
use std::sync::{Mutex, OnceLock};
use std::collections::HashMap;

static ENGINES: OnceLock<Mutex<HashMap<String, Engine>>> = OnceLock::new();
fn engines() -> &'static Mutex<HashMap<String, Engine>> { ENGINES.get_or_init(|| Mutex::new(HashMap::new())) }
fn s(env:&mut JNIEnv, v:JString)->Result<String,()>{env.get_string(&v).map(|v|v.to_string_lossy().into_owned()).map_err(|_|())}
fn host(url:&str)->String{url.split_once("://").and_then(|(_,r)|r.split('/').next()).unwrap_or("").split('@').last().unwrap_or("").split(':').next().unwrap_or("").trim_start_matches("www.").to_ascii_lowercase()}
fn get_engine<'a>(m:&'a HashMap<String,Engine>, h:&str)->Option<&'a Engine>{let mut x=h;loop{if let Some(e)=m.get(x){return Some(e)};match x.find('.') {Some(i)=>x=&x[i+1..],None=>break}};m.get("")}

#[no_mangle]
pub extern "system" fn Java_org_mozilla_fenix_components_nativeprotecction_BraveAdblockNative_build(mut e:JNIEnv,_:JClass,host:JString,lists:JString)->jboolean{let h=match s(&mut e,host){Ok(v)=>v.trim_start_matches("www.").to_ascii_lowercase(),Err(_)=>return 0};let raw=match s(&mut e,lists){Ok(v)=>v,Err(_)=>return 0};let ls:Vec<String>=match serde_json::from_str(&raw){Ok(v)=>v,Err(_)=>return 0};let mut set=FilterSet::new(false);for x in ls{set.add_filter_list(x,Default::default())};let eng=Engine::new_with_filter_set(set);match engines().lock(){Ok(mut m)=>{m.insert(h,eng);3},Err(_)=>0}}

#[no_mangle]
pub extern "system" fn Java_org
mozilla_fenix_components_nativeprotection_BraveAdblockNative_hasGlobal(_:&mut JNIEnv,_:JClass)->jboolean{match engines().lock(){Ok(m)=>if m.contains_key(""){1}else{0},Err(_)=>0}}

#[no_mangle]
pub extern "system" fn Java_org
mozilla_fenix_components_nativeprotection_BraveAdblockNative_load(mut e:JNIEnv,_:JClass,host:JString,data:JByteArray)->jboolean{let h=match s(&mut e,host){Ok(v)=>v,Err(_)=>return 0};let b=match e.convert_byte_array(data){Ok(v)=>v,Err(_)=>return 0};let mut x=Engine::default();if x.deserialize(&b).is_err(){return 0};match engines().lock(){Ok(mut m)=>{m.insert(h,x);},Err(_)=>0}}

#[no_mangle]
pub extern "system" fn Java_org_mozilla_fenix_components_nativeprotection_BraveAdblockNative_serialize(mut e:JNIEnv,_:JClass,host:JString)->jbyteArray{let h=match s(&mut e,host){Ok(v)=>v,Err(_)=>return std::ptr::null_mut()};let m=match engines().lock(){Ok(v)=>v,Err(_)=>return std::ptr::null_mut()};let Some(x)=m.get(&h)else{return std::ptr::null_mut()};match e.byte_array_from_slice(&x.serialize()){Ok(v)=>v.into_raw(),Err(_)=>std::ptr::null_mut()}}

#[no_mangle]
pub extern "system" fn Java_org_mozilla_fenix_components_nativeprotection_BraveAdblockNative_check(mut e:JNIEnv,_:JClass,url:JString,source:JString,typ:JString)->jboolean{let u=match s(&mut e,url){Ok(v)=>v,Err(_)=>return 0};let src=match s(&mut e,source){Ok(v)=>v,Err(_)=>return 0};let t=match s(&mut e,typ){Ok(v)=>v,Err(_)=>return 0};let meth=match s(&mut e,method){Ok(v)=>v,Err(_)=>return 0};let m=match engines().lock(){Ok(v)=>v,Err(_)=>return 0};let Some(x)=get_engine(&m,&host(&src))else{return 0};let Ok(r)=Request::new(&u,&src,&t,&meth)else{return 0};if x.check_network_request(&r).should_block(){1}else{0}}

#[no_mangle]
pub extern "system" fn Java_org_mozilla_fenix_components_nativeprotecction_cosmetic(mut e:JNIEnv,_:JClass,url:JString)->jstring{let u=match s(&mut e,url){Ok(v)=>v,Err(_)=>return std::ptr::null_mut()};let m=match engines().lock(){Ok(v)=>v,Err(_)=>return std::ptr::null_mut()};let Some(x)=get_engine(&m,&host(&u))else{return std::ptr::null_mut()};let out=match serde_json::to_string(&x.url_cosmetic_resources(&u)){Ok(v)=>v,Err(_)=>return std::ptr::null_mut()};match e.new_string(out){Ok(v)=>v.into_raw(),Err(_)=>std::ptr::null_mut()}}

#[no_mangle]
pub extern "system" fn Java_org_mozilla_fenix_components_nativeprotection_BraveAdblockNative_dynamic(mut e:JNIEnv,_:JClass,classes:JString,ids:JString,exceptions:JString)->jstring{let cs:Vec<String>=s(&mut e,classes).ok().and_then(|v|serde_json::from_str(&v).ok()).unwrap_or_default();let ids:Vec<String>=s(&mut e,ids).ok().and_then(|v|serde_json::from_str(&v).ok()).unwrap_or_default();let ex:std::collections::HashSet<String>=s(&mut e,exceptions).ok().and_then(|v|serde_json::from_str(&v).ok()).unwrap_or_default();let m=match engines().lock(){Ok(v)=>v,Err(_)=>return std::ptr::null_mut()};let Some(x)=m.get("")else{return std::ptr::null_mut()};let out=match serde_json::to_string(&x.hidden_class_id_selectors(cs,ids,&ex)){Ok(v)=>v,Err(_)=>return std::ptr::null_mut()};match e.new_string(out){Ok(v)=>v.into_raw(),Err(_)=>std::ptr::null_mut()}}
