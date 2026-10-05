use adblock::lists::{FilterSet, ParseOptions};
use adblock::request::Request;
use adblock::Engine;
use serde::Serialize;
use std::collections::HashSet;
use wasm_bindgen::prelude::*;

#[derive(Serialize)]
struct CosmeticResult {
    hide_selectors: Vec<String>,
    exceptions: Vec<String>,
    generichide: bool,
}

#[wasm_bindgen]
pub struct SandfoxAdblockEngine {
    engine: Engine,
}

#[wasm_bindgen]
impl SandfoxAdblockEngine {
    #[wasm_bindgen(constructor)]
    pub fn new(filter_text: &str) -> SandfoxAdblockEngine {
        console_error_panic_hook::set_once();
        SandfoxAdblockEngine { engine: build_engine(filter_text) }
    }

    #[wasm_bindgen(js_name = shouldBlock)]
    pub fn should_block(
        &self,
        url: &str,
        source_url: &str,
        request_type: &str,
        method: &str,
    ) -> bool {
        let request = match Request::new(url, source_url, request_type, method) {
            Ok(request) => request,
            Err(_) => return false,
        };
        self.engine.check_network_request(&request).matched
    }

    #[wasm_bindgen(js_name = cosmetic)]
    pub fn cosmetic(&self, url: &str) -> String {
        let resources = self.engine.url_cosmetic_resources(url);
        let result = CosmeticResult {
            hide_selectors: resources.hide_selectors.into_iter().collect(),
            exceptions: resources.exceptions.into_iter().collect(),
            generichide: resources.generichide,
        };
        serde_json::to_string(&result).unwrap_or_else(|_| "{\"hide_selectors\":[],\"exceptions\":[],\"generichide\":false}".into())
    }

    #[wasm_bindgen(js_name = dynamicCosmetic)]
    pub fn dynamic_cosmetic(&self, classes: Vec<String>, ids: Vec<String>, exceptions: Vec<String>) -> String {
        let exception_set: HashSet<String> = exceptions.into_iter().collect();
        let selectors = self.engine.hidden_class_id_selectors(classes, ids, &exception_set);
        serde_json::to_string(&selectors).unwrap_or_else(|_| "[]".into())
    }

    #[wasm_bindgen(js_name = serialize)]
    pub fn serialize_engine(&self) -> Vec<u8> {
        self.engine.serialize()
    }

    #[wasm_bindgen(js_name = deserialize)]
    pub fn deserialize_engine(&mut self, data: &[u8]) -> bool {
        self.engine.deserialize(data).is_ok()
    }
}

fn build_engine(filter_text: &str) -> Engine {
    let mut filter_set = FilterSet::new(false);
    if !filter_text.is_empty() {
        let rules: Vec<String> = filter_text.lines().map(str::to_owned).collect();
        filter_set.add_filters(&rules, ParseOptions::default());
    }
    Engine::new_with_filter_set(filter_set)
}
