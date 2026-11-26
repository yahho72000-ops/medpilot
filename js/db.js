// iPhone の中のデータベース（IndexedDB）を使うための薄い部品

const DB_VERSION = 1;

export function openDB(name) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      if (!db.objectStoreNames.contains('patients')) db.createObjectStore('patients', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function request(db, store, mode, make) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = make(tx.objectStore(store));
    let result;
    if (req) req.onsuccess = () => { result = req.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const get = (db, store, key) => request(db, store, 'readonly', (s) => s.get(key));
export const getAll = (db, store) => request(db, store, 'readonly', (s) => s.getAll());
export const put = (db, store, value, key) =>
  request(db, store, 'readwrite', (s) => (key === undefined ? s.put(value) : s.put(value, key)));
export const del = (db, store, key) => request(db, store, 'readwrite', (s) => s.delete(key));
export const clear = (db, store) => request(db, store, 'readwrite', (s) => s.clear());

export function deleteDB(name) {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}
