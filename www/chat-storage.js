// IndexedDB wrapper for chat storage
class ChatStorage {
  constructor() {
    this.dbName = 'clawgpt';
    this.dbVersion = 1;
    this.storeName = 'chats';
    this.db = null;
  }

  async init() {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => {
        console.warn('IndexedDB not available, falling back to localStorage');
        this.useFallback = true;
        resolve(null);
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'id' });
        }
      };
    });
  }

  async loadAll() {
    // Migrate from localStorage if needed
    const legacyData = localStorage.getItem('clawgpt-chats');

    if (this.useFallback) {
      return legacyData ? JSON.parse(legacyData) : {};
    }

    await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAll();

      request.onsuccess = () => {
        const chats = {};
        request.result.forEach(chat => {
          chats[chat.id] = chat;
        });

        // If IndexedDB is empty but localStorage has data, migrate it
        if (Object.keys(chats).length === 0 && legacyData) {
          const legacy = JSON.parse(legacyData);
          this.saveAll(legacy).then(() => {
            // Clear localStorage after successful migration
            localStorage.removeItem('clawgpt-chats');
            console.log('Migrated chats from localStorage to IndexedDB');
          });
          resolve(legacy);
        } else {
          resolve(chats);
        }
      };

      request.onerror = () => {
        console.error('Failed to load chats from IndexedDB');
        resolve(legacyData ? JSON.parse(legacyData) : {});
      };
    });
  }

  async saveAll(chats) {
    if (this.useFallback) {
      localStorage.setItem('clawgpt-chats', JSON.stringify(chats));
      return;
    }

    await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);

      // Clear and re-add all (simple approach)
      store.clear();

      Object.values(chats).forEach(chat => {
        store.put(chat);
      });

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => {
        console.error('Failed to save chats to IndexedDB, using localStorage fallback');
        localStorage.setItem('clawgpt-chats', JSON.stringify(chats));
        resolve();
      };
    });
  }

  async saveOne(chat) {
    if (this.useFallback) {
      const all = JSON.parse(localStorage.getItem('clawgpt-chats') || '{}');
      all[chat.id] = chat;
      localStorage.setItem('clawgpt-chats', JSON.stringify(all));
      return;
    }

    await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      store.put(chat);
      transaction.oncomplete = () => resolve();
      transaction.onerror = (e) => {
        console.error('Failed to save chat:', e);
        this.checkStorageQuota();
        reject(transaction.error);
      };
    });
  }

  async checkStorageQuota() {
    if (navigator.storage && navigator.storage.estimate) {
      try {
        const estimate = await navigator.storage.estimate();
        const usedMB = Math.round((estimate.usage || 0) / 1024 / 1024);
        const quotaMB = Math.round((estimate.quota || 0) / 1024 / 1024);
        const usedPercent = quotaMB > 0 ? Math.round((usedMB / quotaMB) * 100) : 0;
        if (usedPercent > 90) {
          console.warn(`Storage nearly full: ${usedMB}MB / ${quotaMB}MB (${usedPercent}%)`);
          showErrorBanner(`Storage nearly full (${usedPercent}%). Consider deleting old chats.`, true);
        }
      } catch (e) {
        // Silently ignore quota check failures
      }
    }
  }

  async deleteOne(chatId) {
    if (this.useFallback) {
      const all = JSON.parse(localStorage.getItem('clawgpt-chats') || '{}');
      delete all[chatId];
      localStorage.setItem('clawgpt-chats', JSON.stringify(all));
      return;
    }

    await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      store.delete(chatId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }
}

