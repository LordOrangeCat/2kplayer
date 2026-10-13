const DB_NAME = '2kplayer-v011-preview-library';
const DB_VERSION = 1;
let dbPromise;

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Database request failed.'));
  });
}

export function openDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(new Error('This browser does not support local library storage.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('tracks')) {
        const tracks = db.createObjectStore('tracks', { keyPath: 'id' });
        tracks.createIndex('title', 'title', { unique: false });
        tracks.createIndex('artist', 'artist', { unique: false });
        tracks.createIndex('album', 'album', { unique: false });
        tracks.createIndex('favorite', 'favorite', { unique: false });
      }
      if (!db.objectStoreNames.contains('playlists')) db.createObjectStore('playlists', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); dbPromise = undefined; };
      resolve(db);
    };
    request.onerror = () => reject(request.error || new Error('Could not open local library storage.'));
    request.onblocked = () => reject(new Error('Another 2kPlayer window is blocking a storage update. Close older windows and try again.'));
  }).catch(error => {
    dbPromise = undefined;
    throw error;
  });
  return dbPromise;
}

async function storeRequest(storeName, mode, action) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    try { result = action(store); } catch (error) { reject(error); return; }
    tx.oncomplete = async () => {
      try { resolve(result && typeof result.then === 'function' ? await result : result); }
      catch (error) { reject(error); }
    };
    tx.onerror = () => reject(tx.error || new Error('Storage operation failed.'));
    tx.onabort = () => reject(tx.error || new Error('Storage operation was cancelled.'));
  });
}

export async function getAllTracks() {
  const db = await openDatabase();
  const tx = db.transaction('tracks', 'readonly');
  return requestResult(tx.objectStore('tracks').getAll());
}
export async function getTrack(id) {
  const db = await openDatabase();
  const tx = db.transaction('tracks', 'readonly');
  return requestResult(tx.objectStore('tracks').get(id));
}
export async function saveTrack(track) {
  return storeRequest('tracks', 'readwrite', store => store.put(track));
}
export async function saveTracks(tracks) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('tracks', 'readwrite');
    const store = tx.objectStore('tracks');
    for (const track of tracks) store.put(track);
    tx.oncomplete = () => resolve(tracks.length);
    tx.onerror = () => reject(tx.error || new Error('Could not save imported tracks.'));
    tx.onabort = () => reject(tx.error || new Error('Import was cancelled, possibly due to storage limits.'));
  });
}
export async function deleteTrack(id) {
  return storeRequest('tracks', 'readwrite', store => store.delete(id));
}
export async function getPlaylists() {
  const db = await openDatabase();
  return requestResult(db.transaction('playlists', 'readonly').objectStore('playlists').getAll());
}
export async function savePlaylist(playlist) {
  return storeRequest('playlists', 'readwrite', store => store.put(playlist));
}
export async function deletePlaylist(id) {
  return storeRequest('playlists', 'readwrite', store => store.delete(id));
}
export async function getSetting(key) {
  const db = await openDatabase();
  const row = await requestResult(db.transaction('settings', 'readonly').objectStore('settings').get(key));
  return row?.value;
}
export async function setSetting(key, value) {
  return storeRequest('settings', 'readwrite', store => store.put({ key, value }));
}
export async function getAllSettings() {
  const db = await openDatabase();
  return requestResult(db.transaction('settings', 'readonly').objectStore('settings').getAll());
}

export function estimateStorage() {
  if (!navigator.storage?.estimate) return Promise.resolve(null);
  return navigator.storage.estimate().catch(() => null);
}

export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return false;
  try { return await navigator.storage.persist(); } catch { return false; }
}
