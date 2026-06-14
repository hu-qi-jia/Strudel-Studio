const DB_NAME = 'agent-conversations';
const STORE_NAME = 'conversations';
const ATTACHMENT_STORE = 'attachments'; // v2：上传附件的二进制 blob 存储
const DB_VERSION = 2;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      // v1：会话存储
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'projectId' });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      // v2：附件 blob 存储（幂等：已存在则跳过，兼容从 v1 升级的老用户）
      if (!db.objectStoreNames.contains(ATTACHMENT_STORE)) {
        db.createObjectStore(ATTACHMENT_STORE, { keyPath: 'handleId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
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

// ─── 附件 blob 存储（v2 store）──────────────────────────────
// rec = { handleId, data: ArrayBuffer, mime, name, size, createdAt }
export async function saveAttachment(rec) {
  const db = await openDB();
  const tx = db.transaction(ATTACHMENT_STORE, 'readwrite');
  tx.objectStore(ATTACHMENT_STORE).put(rec);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadAttachment(handleId) {
  const db = await openDB();
  const tx = db.transaction(ATTACHMENT_STORE, 'readonly');
  const request = tx.objectStore(ATTACHMENT_STORE).get(handleId);
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteAttachment(handleId) {
  const db = await openDB();
  const tx = db.transaction(ATTACHMENT_STORE, 'readwrite');
  tx.objectStore(ATTACHMENT_STORE).delete(handleId);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
