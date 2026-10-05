import init, { SandfoxAdblockEngine } from "./wasm/sandfox_adblock_wasm.js";

const LIST_URLS = [
  "https://ublockorigin.github.io/uAssets/filters/filters.min.txt",
  "https://ublockorigin.github.io/uAssets/filters/badware.min.txt",
  "https://ublockorigin.github.io/uAssets/filters/privacy.min.txt",
  "https://ublockorigin.github.io/uAssets/filters/unbreak.min.txt",
  "https://ublockorigin.github.io/uAssets/thirdparties/easylist.txt",
  "https://ublockorigin.github.io/uAssets/thirdparties/easyprivacy.txt",
  "https://ublockorigin.github.io/uAssets/filters/annoyances.min.txt"
];

const DB_NAME = "sandfox-adblock-v1";
const DB_VERSION = 1;
const STORE = "engine";
let engine = null;
let ready = false;

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function dbPut(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function fetchFilters() {
  const responses = await Promise.allSettled(
    LIST_URLS.map(url => fetch(url, { cache: "no-store" }).then(r => {
      if (!r.ok) throw new Error("filter HTTP " + r.status);
      return r.text();
    }))
  );
  const lists = responses.filter(r => r.status === "fulfilled").map(r => r.value);
  if (!lists.length) throw new Error("No filter lists could be loaded");
  return lists.join("\n");
}

async function buildOrRestoreEngine() {
  const wasmReady = init("./wasm/sandfox_adblock_wasm_bg.wasm");
  const cachedReady = dbGet("dat");
  const [, cached] = await Promise.all([wasmReady, cachedReady]);
  if (cached instanceof ArrayBuffer && cached.byteLength > 0) {
    const candidate = new SandfoxAdblockEngine("");
    if (candidate.deserialize(new Uint8Array(cached))) {
      engine = candidate;
      ready = true;
      return;
    }
  }

  const filters = await fetchFilters();
  const candidate = new SandfoxAdblockEngine(filters);
  const dat = candidate.serialize();
  await dbPut("dat", dat.buffer.slice(dat.byteOffset, dat.byteOffset + dat.byteLength));
  engine = candidate;
  ready = true;
}

browser.webRequest.onBeforeRequest.addListener(
  details => {
    if (!ready || !engine) return {};
    return engine.shouldBlock(
      details.url,
      details.originUrl || details.documentUrl || details.url,
      details.type || "other",
      details.method || "GET"
    ) ? { cancel: true } : {};
  },
  { urls: ["<all_urls>"] },
  ["blocking"]
);

buildOrRestoreEngine().catch(error => console.error("Sandfox adblock initialization failed", error));

