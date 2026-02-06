// ClawGPT Memory - Per-message storage for better search
class MemoryStorage {
  constructor() {
    this.dbName = 'clawgpt-memory';
    this.dbVersion = 1;
    this.db = null;
  }

  async init() {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => {
        console.warn('MemoryStorage: IndexedDB not available');
        resolve(null);
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Messages store with indexes for search
        if (!db.objectStoreNames.contains('messages')) {
          const store = db.createObjectStore('messages', { keyPath: 'id' });
          store.createIndex('chatId', 'chatId', { unique: false });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('role', 'role', { unique: false });
          // Compound index for chat + order
          store.createIndex('chatOrder', ['chatId', 'order'], { unique: true });
        }

        // Search index for full-text search
        if (!db.objectStoreNames.contains('searchIndex')) {
          const searchStore = db.createObjectStore('searchIndex', { keyPath: 'term' });
          searchStore.createIndex('messageIds', 'messageIds', { unique: false, multiEntry: true });
        }

        // Sync state
        if (!db.objectStoreNames.contains('syncState')) {
          db.createObjectStore('syncState', { keyPath: 'key' });
        }
      };
    });
  }

  // Store a message and update search index
  async storeMessage(chatId, chatTitle, message, order) {
    await this.init();
    if (!this.db) return;

    const msgId = `${chatId}-${order}`;
    const doc = {
      id: msgId,
      chatId,
      chatTitle: chatTitle || 'Untitled',
      order,
      role: message.role,
      content: message.content || '',
      timestamp: message.timestamp || Date.now(),
      tokens: message.tokens || 0
    };

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['messages', 'searchIndex'], 'readwrite');
      const msgStore = tx.objectStore('messages');
      const searchStore = tx.objectStore('searchIndex');

      // Store the message
      msgStore.put(doc);

      // Update search index (simple term-based)
      const terms = this.extractTerms(doc.content);
      terms.forEach(term => {
        const getReq = searchStore.get(term);
        getReq.onsuccess = () => {
          const existing = getReq.result || { term, messageIds: [] };
          if (!existing.messageIds.includes(msgId)) {
            existing.messageIds.push(msgId);
            searchStore.put(existing);
          }
        };
      });

      tx.oncomplete = () => resolve(doc);
      tx.onerror = () => reject(tx.error);
    });
  }

  // Extract searchable terms from content
  extractTerms(content) {
    if (!content) return [];
    return content
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(term => term.length >= 3)
      .filter(term => !ClawGPT.STOP_WORDS.has(term));
  }

  // Search messages by terms
  async search(query, limit = 50) {
    await this.init();
    if (!this.db) return [];

    const terms = this.extractTerms(query);
    if (terms.length === 0) return [];

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['messages', 'searchIndex'], 'readonly');
      const msgStore = tx.objectStore('messages');
      const searchStore = tx.objectStore('searchIndex');

      // Find message IDs matching any term
      const matchingIds = new Map(); // msgId -> match count
      let termsProcessed = 0;

      terms.forEach(term => {
        const req = searchStore.get(term);
        req.onsuccess = () => {
          if (req.result && req.result.messageIds) {
            req.result.messageIds.forEach(id => {
              matchingIds.set(id, (matchingIds.get(id) || 0) + 1);
            });
          }
          termsProcessed++;

          if (termsProcessed === terms.length) {
            // Sort by match count, get top results
            const sortedIds = [...matchingIds.entries()]
              .sort((a, b) => b[1] - a[1])
              .slice(0, limit)
              .map(([id]) => id);

            // Fetch the actual messages
            const results = [];
            let fetched = 0;

            if (sortedIds.length === 0) {
              resolve([]);
              return;
            }

            sortedIds.forEach(id => {
              const msgReq = msgStore.get(id);
              msgReq.onsuccess = () => {
                if (msgReq.result) {
                  results.push({
                    ...msgReq.result,
                    matchScore: matchingIds.get(id)
                  });
                }
                fetched++;
                if (fetched === sortedIds.length) {
                  // Sort by match score then timestamp
                  results.sort((a, b) => {
                    if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
                    return b.timestamp - a.timestamp;
                  });
                  resolve(results);
                }
              };
            });
          }
        };
      });
    });
  }

  // Get all messages for a chat
  async getChatMessages(chatId) {
    await this.init();
    if (!this.db) return [];

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['messages'], 'readonly');
      const store = tx.objectStore('messages');
      const index = store.index('chatId');
      const req = index.getAll(chatId);

      req.onsuccess = () => {
        const messages = req.result || [];
        messages.sort((a, b) => a.order - b.order);
        resolve(messages);
      };
      req.onerror = () => reject(req.error);
    });
  }

  // Get message count
  async getMessageCount() {
    await this.init();
    if (!this.db) return 0;

    return new Promise((resolve) => {
      const tx = this.db.transaction(['messages'], 'readonly');
      const store = tx.objectStore('messages');
      const req = store.count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(0);
    });
  }

  // Sync all chats to memory storage
  async syncFromChats(chats) {
    if (!chats || typeof chats !== 'object') return 0;

    let synced = 0;
    for (const [chatId, chat] of Object.entries(chats)) {
      if (!chat.messages) continue;

      for (let i = 0; i < chat.messages.length; i++) {
        await this.storeMessage(chatId, chat.title, chat.messages[i], i);
        synced++;
      }
    }

    // Save sync timestamp
    await this.init();
    if (this.db) {
      const tx = this.db.transaction(['syncState'], 'readwrite');
      tx.objectStore('syncState').put({ key: 'lastSync', timestamp: Date.now() });
    }

    return synced;
  }

  // Get last sync timestamp
  async getLastSync() {
    await this.init();
    if (!this.db) return null;

    return new Promise((resolve) => {
      const tx = this.db.transaction(['syncState'], 'readonly');
      const req = tx.objectStore('syncState').get('lastSync');
      req.onsuccess = () => resolve(req.result?.timestamp || null);
      req.onerror = () => resolve(null);
    });
  }
}

