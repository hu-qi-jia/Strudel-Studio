const DB_NAME = 'agent-conversations';
const STORE_NAME = 'conversations';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'projectId' });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function getProjectId() {
  if (typeof window === 'undefined') return 'default';
  const hash = window.location.hash || '#default';
  const path = window.location.pathname || '/';
  return `${path}${hash}`;
}

export async function saveMessages(projectId, messages) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put({
      projectId,
      messages: JSON.parse(JSON.stringify(messages)),
      updatedAt: Date.now(),
    });
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn('[agent] Failed to save messages:', e);
  }
}

export async function loadMessages(projectId) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(projectId);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result?.messages || []);
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.warn('[agent] Failed to load messages:', e);
    return [];
  }
}

export async function clearMessages(projectId) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(projectId);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn('[agent] Failed to clear messages:', e);
  }
}
