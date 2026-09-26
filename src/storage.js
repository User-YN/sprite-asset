// ====================================================================
// IndexedDB 스토리지 — 스프라이트 이미지 blob 영속화
// blobToBase64 / base64ToBlob 은 백업·복원용 유틸
// ====================================================================

const DB_NAME = "DynamicSpritesDB";
const STORE_NAME = "sprites";
let db = null;

export function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = (e) => {
            const database = e.target.result;
            if (!database.objectStoreNames.contains(STORE_NAME)) {
                database.createObjectStore(STORE_NAME);
            }
        };
        req.onsuccess = (e) => { db = e.target.result; resolve(db); };
        req.onerror = (e) => reject(e.target.error);
    });
}

export async function saveImage(key, blob) {
    if (!db) await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const req = tx.objectStore(STORE_NAME).put(blob, key);
        req.onsuccess = () => resolve();
        req.onerror = (e) => reject(e.target.error);
    });
}

export async function loadImage(key) {
    if (!db) await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const req = tx.objectStore(STORE_NAME).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = (e) => reject(e.target.error);
    });
}

export async function deleteImage(key) {
    if (!db) await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const req = tx.objectStore(STORE_NAME).delete(key);
        req.onsuccess = () => resolve();
        req.onerror = (e) => reject(e.target.error);
    });
}

export function blobToBase64(blob) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
    });
}

export async function base64ToBlob(base64) {
    const res = await fetch(base64);
    return res.blob();
}
