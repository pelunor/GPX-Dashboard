// Parsed activities are kept in this browser's IndexedDB so the dashboard
// survives a reload. It never leaves the device; "Clear data" wipes it.

const DB_NAME = 'activity-dashboard';
const STORE = 'activities';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const result = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(result?.result); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
  });
}

export const getAll = () => run('readonly', (s) => s.getAll());
export const putAll = (acts) => run('readwrite', (s) => { for (const a of acts) s.put(a); });
export const clearAll = () => run('readwrite', (s) => s.clear());
