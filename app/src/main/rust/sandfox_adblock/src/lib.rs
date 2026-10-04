use adblock::request::Request;
use adblock::{Engine, FilterSet};
use jni::objects::{JByteArray, JClass, JString};
use jni::sys::{jboolean, jbyteArray, jstring};
use jni::JNIEnv;
use serde_json::json;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

static ENGINES: OnceLock<Mutex<HashMap<String, Engine>>> = OnceLock::new();
fn engines() -> &'static Mutex<HashMap<String, Engine>> { ENGINES.get_or_init(|| Mutex::new(HashMap::new())) }
fn string(env: &mut JNIEnv, value: JString) -> Result<String, ()> { env.get_string(&value).map(|v| v.to_string_lossy().into_owned()).map_err(|_| ()) }
fn host(url: &str) -> String { url.split_once("://").and_then(|(_,r)|r.split('/').next()).unwrap_or("").split('@').next_back().unwrap_or("").split(':').next().unwrap_or("").trim_start_matches("www.").to_ascii_lowercase() }
fn engine_for<'a>(map: &'a HashMap<String, Engine>, source: &str) -> Option<&'a Engine> {
    let mut current=host(source);
    loop {
        if let Some(e)=map.get(&current) { return Some(e); }
        match current.find('.') { Some(i)=>current=current[i+1..].to_string(), None=>break }
    }
    map.get("")
}

#[no_mangle]
pub extern "system" fn Java_org_mozilla_fenix_components_nativeprotection_BraveAdblockNative_build(mut env: JNIEnv,_class:JClass,host:JString,rules:JString)->jboolean {
    let h=match string(&mut env,host){Ok(v)=>v.trim_start_matches("www.").to_ascii_lowercase(),Err(_)=>return 0};
    let raw=match string(&mut env,rules){Ok(v)=>v,Err(_)=>return 0};
    let mut filters=FilterSet::new(false);
    filters.add_filter_list(raw,Default::default());
    let engine=Engine::new_with_filter_set(filters);
    match engines().lock(){Ok(mut m)=>{m.insert(h,engine);1},Err(_)=>0}
}

#[no_mangle]
pub extern "system" fn Java_org_mozilla_fenix_components_nativeprotection_BraveAdblockNative_load(mut env:JNIEnv,_class:JClass,host:JString,data:JByteArray)->jboolean {
    let h=match string(&mut env,host){Ok(v)=>v,Err(_)=>return 0};
    let b=match env.convert_byte_array(data){Ok(v)=>v,Err(_)=>return 0};
    let mut engine=Engine::default();
    if engine.deserialize(&b).is_err(){return 0}
    match engines().lock(){Ok(mut m)=>{m.insert(h,engine);1},Err(_)=>0}
}

#[no_mangle]
pub extern "system" fn Java_org_mozilla_fenix_components_nativeprotection_BraveAdblockNative_serialize(mut env:JNIEnv,_class:JClass,host:JString)->jbyteArray {
    let h=match string(&mut env,host){Ok(v)=>v,Err(_)=>return std::ptr::null_mut()};
    let m=match engines().lock(){Ok(v)=>v,Err(_)=>return std::ptr::null_mut()};
    let Some(e)=m.get(&h)else{return std::ptr::null_mut()};
    match env.byte_array_from_slice(&e.serialize()){Ok(v)=>v.into_raw(),Err(_)=>std::ptr::null_mut()}
}

#[no_mangle]
pub extern "system" fn Java_org_mozilla_fenix_components_nativeprotection_BraveAdblockNative_check(mut env:JNIEnv,_class:JClass,url:JString,source:JString,request_type:JString,method:JString)->jstring {
    let u=match string(&mut env,url){Ok(v)=>v,Err(_)=>return std::ptr::null_mut()};
    let s=match string(&mut env,source){Ok(v)=>v,Err(_)=>return std::ptr::null_mut()};
    let t=match string(&mut env,request_type){Ok(v)=>v,Err(_)=>return std::ptr::null_mut()};
    let meth=match string(&mut env,method){Ok(v)=>v,Err(_)=>return std::ptr::null_mut()};
    let m=match engines().lock(){Ok(v)=>v,Err(_)=>return std::ptr::null_mut()};
    let Some(e)=engine_for(&m,&s)else{return std::ptr::null_mut()};
    let Ok(r)=Request::new(&u,&s,&t,&meth)else{return std::ptr::null_mut()};
    let result=e.check_network_request(&r);
    match env.new_string(json!({"matched":result.should_block(),"important":result.important,"redirect":result.redirect,"rewritten_url":result.rewritten_url,"exception":result.exception.is_some()}).to_string()){Ok(v)=>v.into_raw(),Err(_)=>std::ptr::null_mut()}
}

#[no_mangle]
pub extern "system" fn Java_org_mozilla_fenix_components_nativeprotection_BraveAdblockNative_cosmetic(mut env:JNIEnv,_class:JClass,url:JString)->jstring {
    let u=match string(&mut env,url){Ok(v)=>v,Err(_)=>return std::ptr::null_mut()};
    let m=match engines().lock(){Ok(v)=>v,Err(_)=>return std::ptr::null_mut()};
    let Some(e)=engine_for(&m,&u)else{return std::ptr::null_mut()};
    match serde_json::to_string(&e.url_cosmetic_resources(&u)){Ok(v)=>match env.new_string(v){Ok(s)=>s.into_raw(),Err(_)=>std::ptr::null_mut()},Err(_)=>std::ptr::null_mut()}
}

#[no_mangle]
pub extern "system" fn Java_org_mozilla_fenix_components_nativeprotection_BraveAdblockNative_dynamic(mut env:JNIEnv,_class:JClass,url:JString,classes:JString,ids:JString,exceptions:JString)->jstring {
    let u=match string(&mut env,url){Ok(v)=>v,Err(_)=>return std::ptr::null_mut()};
    let cs:Vec<String>=string(&mut env,classes).ok().and_then(|v|serde_json::from_str(&v).ok()).unwrap_or_default();
    let is:Vec<String>=string(&mut env,ids).ok().and_then(|v|serde_json::from_str(&v).ok()).unwrap_or_default();
    let ex:std::collections::HashSet<String>=string(&mut env,exceptions).ok().and_then(|v|serde_json::from_str(&v).ok()).unwrap_or_default();
    let m=match engines().lock(){Ok(v)=>v,Err(_)=>return std::ptr::null_mut()};
    let Some(e)=engine_for(&m,&u)else{return std::ptr::null_mut()};
    match serde_json::to_string(&e.hidden_class_id_selectors(cs,is,&ex)){Ok(v)=>match env.new_string(v){Ok(s)=>s.into_raw(),Err(_)=>std::ptr::null_mut()},Err(_)=>std::ptr::null_mut()}
}
