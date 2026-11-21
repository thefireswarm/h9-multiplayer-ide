/**
 * H9 Code Editor - Real-time Collaboration Engine
 * Powered by Yjs, y-websocket, y-indexeddb, and Awareness Protocols.
 */

window.H9CollabManager = (function() {
  const { Y, WebsocketProvider, WebrtcProvider, IndexeddbPersistence } = window.H9Collab;

  // Generate or retrieve persistent user profile
  const STORAGE_KEY_USER = 'h9_user_profile';
  const STORAGE_KEY_SNAPSHOTS = 'h9_local_snapshots';

  const DEFAULT_COLORS = [
    '#007acc', '#e53935', '#43a047', '#fb8c00', 
    '#8e24aa', '#00acc1', '#3949ab', '#d81b60'
  ];

  function getStoredUser() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_USER);
      if (stored) return JSON.parse(stored);
    } catch (e) {}

    const randomColor = DEFAULT_COLORS[Math.floor(Math.random() * DEFAULT_COLORS.length)];
    const randomId = Math.floor(100 + Math.random() * 900);
    const names = ['Dev', 'Coder', 'Hacker', 'Alex', 'Sam', 'Jordan', 'Taylor', 'Morgan'];
    const randomName = `${names[Math.floor(Math.random() * names.length)]} #${randomId}`;

    const user = {
      name: randomName,
      color: randomColor,
      avatar: randomName.substring(0, 2).toUpperCase()
    };
    try {
      localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(user));
    } catch (e) {}
    return user;
  }

  class CollabManager {
    constructor() {
      this.ydoc = new Y.Doc();
      this.roomName = this.detectRoomName();
      this.currentUser = getStoredUser();
      this.localOrigin = { client: this.ydoc.clientID, user: this.currentUser.name };

      this.wsProvider = null;
      this.webrtcProvider = null;
      this.indexeddbProvider = null;
      this.isSimulatedOffline = false;
      this.isOnline = navigator.onLine;
      this.syncedWithServer = false;
      this.syncedWithIndexedDb = false;

      this.undoManagers = new Map(); // fileId -> Y.UndoManager
      this.remoteCursors = new Map(); // clientId -> decorationIds
      this.peerChangeListeners = new Set();
      this.statusChangeListeners = new Set();

      this.init();
    }

    detectRoomName() {
      const params = new URLSearchParams(window.location.search);
      const room = params.get('room');
      if (room && room.trim()) {
        return room.trim();
      }
      return 'h9-main-workspace';
    }

    init() {
      console.log(`[H9 Collab] Initializing room "${this.roomName}" with Client ID: ${this.ydoc.clientID}`);

      // 1. IndexedDB Offline Persistence
      try {
        this.indexeddbProvider = new IndexeddbPersistence(`h9-room-${this.roomName}`, this.ydoc);
        this.indexeddbProvider.on('synced', () => {
          this.syncedWithIndexedDb = true;
          console.log(`[H9 Collab] IndexedDB local state synced successfully.`);
          // If doc is empty after loading IndexedDB on static host (like Netlify), seed starter files
          const filesMap = this.ydoc.getMap('fileTree');
          if (filesMap.size === 0 && !this.isLocalhost()) {
            this.seedClientStarterProject();
          }
          this.notifyStatus();
        });
      } catch (err) {
        console.warn(`[H9 Collab] IndexedDB not available, fallback to memory:`, err);
      }

      // 2. Realtime Multiplayer Provider (WebSocket on localhost, WebRTC + WS on Netlify)
      this.connectNetworkProviders();

      // 3. Setup Browser Network Listeners
      window.addEventListener('online', () => {
        this.isOnline = true;
        console.log('[H9 Collab] Browser network back online.');
        if (!this.isSimulatedOffline) {
          if (this.wsProvider && !this.wsProvider.wsconnected) this.wsProvider.connect();
          if (this.webrtcProvider && !this.webrtcProvider.connected) this.webrtcProvider.connect();
        }
        this.notifyStatus();
      });

      window.addEventListener('offline', () => {
        this.isOnline = false;
        console.log('[H9 Collab] Browser network went offline.');
        this.notifyStatus();
      });
    }

    isLocalhost() {
      const h = window.location.hostname;
      return h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h === '';
    }

    connectNetworkProviders() {
      if (this.isLocalhost()) {
        // Local Node.js backend server
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host || 'localhost:3000';
        const wsUrl = `${protocol}//${host}/ws?room=${encodeURIComponent(this.roomName)}`;

        console.log(`[H9 Collab] Connecting to local WebSocket: ${wsUrl}`);
        this.wsProvider = new WebsocketProvider(wsUrl, this.roomName, this.ydoc, {
          connect: true
        });
      } else {
        // Hosted on Netlify / Cloud: Use WebRTC P2P + public Yjs signaling
        console.log(`[H9 Collab] Running on Netlify/Cloud. Enabling WebRTC P2P & public fallback.`);
        try {
          this.webrtcProvider = new WebrtcProvider(`h9-room-${this.roomName}`, this.ydoc, {
            signaling: [
              'wss://signaling.yjs.dev',
              'wss://y-webrtc-signaling-eu.herokuapp.com',
              'wss://y-webrtc-signaling-us.herokuapp.com'
            ]
          });
        } catch (e) {
          console.warn('[H9 Collab] WebRTC initialization:', e);
        }

        // Also connect to public Yjs websocket room as backup
        try {
          this.wsProvider = new WebsocketProvider('wss://demos.yjs.dev/ws', `h9-${this.roomName}`, this.ydoc, {
            connect: true
          });
        } catch (e) {
          console.warn('[H9 Collab] WS fallback:', e);
        }
      }

      // Bind awareness updates
      this.updateAwarenessUser();

      if (this.wsProvider) {
        this.wsProvider.on('status', event => {
          console.log(`[H9 Collab] WS Status: ${event.status}`);
          this.syncedWithServer = event.status === 'connected';
          this.notifyStatus();
        });

        this.wsProvider.on('sync', isSynced => {
          this.syncedWithServer = isSynced;
          this.notifyStatus();
        });

        this.wsProvider.awareness.on('change', () => {
          this.notifyPeers();
        });
      }

      if (this.webrtcProvider) {
        this.webrtcProvider.on('status', event => {
          if (event.connected) this.syncedWithServer = true;
          this.notifyStatus();
        });

        this.webrtcProvider.on('synced', event => {
          this.syncedWithServer = event.synced;
          this.notifyStatus();
        });

        this.webrtcProvider.awareness.on('change', () => {
          this.notifyPeers();
        });
      }
    }

    get awareness() {
      if (this.wsProvider && this.wsProvider.awareness) return this.wsProvider.awareness;
      if (this.webrtcProvider && this.webrtcProvider.awareness) return this.webrtcProvider.awareness;
      return null;
    }

    updateAwarenessUser() {
      const aw = this.awareness;
      if (!aw) return;
      aw.setLocalStateField('user', {
        name: this.currentUser.name,
        color: this.currentUser.color,
        avatar: this.currentUser.avatar,
        clientId: this.ydoc.clientID
      });
    }

    setCursorAwareness(fileId, position, selection) {
      const aw = this.awareness;
      if (!aw) return;
      aw.setLocalStateField('cursor', {
        fileId: fileId,
        position: position,
        selection: selection
      });
    }

    setUserProfile(name, color) {
      this.currentUser.name = name || this.currentUser.name;
      this.currentUser.color = color || this.currentUser.color;
      this.currentUser.avatar = this.currentUser.name.substring(0, 2).toUpperCase();

      try {
        localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(this.currentUser));
      } catch (e) {}

      this.updateAwarenessUser();
      this.notifyPeers();
    }

    // Toggle simulated offline mode
    toggleSimulatedOffline() {
      this.isSimulatedOffline = !this.isSimulatedOffline;
      if (this.isSimulatedOffline) {
        console.log('[H9 Collab] Simulated Offline Mode ENABLED.');
        if (this.wsProvider) this.wsProvider.disconnect();
        if (this.webrtcProvider) this.webrtcProvider.disconnect();
      } else {
        console.log('[H9 Collab] Simulated Offline Mode DISABLED. Reconnecting...');
        if (this.wsProvider) this.wsProvider.connect();
        if (this.webrtcProvider) this.webrtcProvider.connect();
      }
      this.notifyStatus();
      return this.isSimulatedOffline;
    }

    getSyncStatus() {
      if (this.isSimulatedOffline) {
        return {
          state: 'offline',
          label: 'Simulated Offline (Saved to IndexedDB)',
          pillClass: 'offline',
          barClass: 'offline'
        };
      }
      if (!this.isOnline) {
        return {
          state: 'offline',
          label: 'Offline (Saved to IndexedDB)',
          pillClass: 'offline',
          barClass: 'offline'
        };
      }
      const isConnected = (this.wsProvider && this.wsProvider.wsconnected) || (this.webrtcProvider && this.webrtcProvider.connected);
      if (isConnected || this.syncedWithServer) {
        return {
          state: 'online',
          label: 'Online — Synced',
          pillClass: 'online',
          barClass: 'online'
        };
      }
      return {
        state: 'syncing',
        label: 'Connecting & Syncing...',
        pillClass: 'syncing',
        barClass: 'syncing'
      };
    }

    onStatusChange(listener) {
      this.statusChangeListeners.add(listener);
    }

    notifyStatus() {
      const status = this.getSyncStatus();
      this.statusChangeListeners.forEach(fn => fn(status));
    }

    onPeersChange(listener) {
      this.peerChangeListeners.add(listener);
    }

    notifyPeers() {
      const peers = this.getPeers();
      this.peerChangeListeners.forEach(fn => fn(peers));
    }

    getPeers() {
      const aw = this.awareness;
      if (!aw) return [];
      const states = aw.getStates();
      const peers = [];

      states.forEach((state, clientId) => {
        if (state.user) {
          peers.push({
            clientId,
            isSelf: clientId === this.ydoc.clientID,
            name: state.user.name || 'Anonymous',
            color: state.user.color || '#007acc',
            avatar: state.user.avatar || 'DE',
            cursor: state.cursor || null
          });
        }
      });

      return peers;
    }

    getFileText(fileId) {
      return this.ydoc.getText(`file_content:${fileId}`);
    }

    getUndoManager(fileId) {
      let um = this.undoManagers.get(fileId);
      if (!um) {
        const ytext = this.getFileText(fileId);
        um = new Y.UndoManager(ytext, {
          trackedOrigins: new Set([this.localOrigin])
        });
        this.undoManagers.set(fileId, um);
      }
      return um;
    }

    seedClientStarterProject() {
      const fileTreeMap = this.ydoc.getMap('fileTree');
      const folderTreeMap = this.ydoc.getMap('folderTree');

      this.ydoc.transact(() => {
        folderTreeMap.set('src', { id: 'src', name: 'src', path: 'src', type: 'folder', parentId: null });

        fileTreeMap.set('README.md', {
          id: 'README.md', name: 'README.md', path: 'README.md', type: 'file', language: 'markdown', folderId: null
        });
        const mdText = this.getFileText('README.md');
        if (mdText.length === 0) {
          mdText.insert(0, '# 🚀 H9 Multiplayer Offline Code Editor\n\nLive on Netlify! Collaborative CRDT editor working offline with IndexedDB and WebRTC.\n');
        }

        fileTreeMap.set('src/index.js', {
          id: 'src/index.js', name: 'index.js', path: 'src/index.js', type: 'file', language: 'javascript', folderId: 'src'
        });
        const jsText = this.getFileText('src/index.js');
        if (jsText.length === 0) {
          jsText.insert(0, '// H9 Collaborative JavaScript\nconsole.log("Welcome to H9 IDE on Netlify!");\nconsole.log("Multiplayer real-time collaboration with offline IndexedDB persistence.");\n');
        }

        fileTreeMap.set('index.html', {
          id: 'index.html', name: 'index.html', path: 'index.html', type: 'file', language: 'html', folderId: null
        });
        const htmlText = this.getFileText('index.html');
        if (htmlText.length === 0) {
          htmlText.insert(0, '<!DOCTYPE html>\n<html><body><h1>H9 Netlify Live Preview</h1><p>Edit in Monaco and preview here!</p></body></html>\n');
        }
      }, 'client-seed');
    }

    saveSnapshot(name) {
      try {
        const snapshots = this.getSnapshots();
        const update = Y.encodeStateAsUpdate(this.ydoc);
        const base64 = btoa(String.fromCharCode.apply(null, update));

        const snapshot = {
          id: 'snap_' + Date.now(),
          name: name || `Snapshot ${new Date().toLocaleTimeString()}`,
          timestamp: Date.now(),
          update: base64
        };
        snapshots.unshift(snapshot);
        localStorage.setItem(STORAGE_KEY_SNAPSHOTS, JSON.stringify(snapshots.slice(0, 20)));
        return snapshot;
      } catch (err) {
        console.error('Failed to save snapshot:', err);
        return null;
      }
    }

    getSnapshots() {
      try {
        const data = localStorage.getItem(STORAGE_KEY_SNAPSHOTS);
        return data ? JSON.parse(data) : [];
      } catch (e) {
        return [];
      }
    }

    restoreSnapshot(snapshotId) {
      try {
        const snapshots = this.getSnapshots();
        const snap = snapshots.find(s => s.id === snapshotId);
        if (!snap) return false;

        const binary = Uint8Array.from(atob(snap.update), c => c.charCodeAt(0));
        Y.applyUpdate(this.ydoc, binary, this.localOrigin);
        return true;
      } catch (err) {
        console.error('Failed to restore snapshot:', err);
        return false;
      }
    }
  }

  return new CollabManager();
})();
