/**
 * H9 Code Editor - Main Application Controller
 * Orchestrates sidebar, panel resizing, modals, keyboard shortcuts, and presence UI.
 */

window.H9App = (function() {
  const collab = window.H9CollabManager;

  class AppController {
    constructor() {
      this.activeSidebarView = 'explorer';
      this.activeBottomPanel = 'terminal';
      this.isPanelOpen = true;

      this.init();
    }

    init() {
      console.log('[H9 App] Bootstrapping application UI...');

      this.setupTopNav();
      this.setupActivityBar();
      this.setupSidebarResizing();
      this.setupPanelResizing();
      this.setupBottomPanel();
      this.setupModals();
      this.setupGlobalSearch();
      this.setupCollabPresenceUI();
      this.setupShortcuts();
      this.registerServiceWorker();

      // Listen to collab status changes
      collab.onStatusChange(status => {
        this.updateSyncUI(status);
      });

      // Initial status update
      this.updateSyncUI(collab.getSyncStatus());
    }

    setupTopNav() {
      // Room title
      const roomBadge = document.getElementById('nav-room-name');
      const sbRoom = document.getElementById('sb-room-name');
      if (roomBadge) roomBadge.textContent = collab.roomName;
      if (sbRoom) sbRoom.textContent = collab.roomName;

      // Run code button
      const btnRun = document.getElementById('btn-run-code');
      if (btnRun) {
        btnRun.addEventListener('click', () => {
          if (window.H9Runner) window.H9Runner.runActiveFile();
        });
      }

      // Offline toggle button
      const btnOffline = document.getElementById('btn-toggle-offline');
      if (btnOffline) {
        btnOffline.addEventListener('click', () => {
          const isOffline = collab.toggleSimulatedOffline();
          const label = document.getElementById('btn-offline-label');
          const icon = document.getElementById('btn-offline-icon');
          if (isOffline) {
            btnOffline.classList.add('btn-danger-outline');
            if (label) label.textContent = 'Go Online';
            if (icon) icon.textContent = '🟢';
            this.showToast('Simulated offline mode ENABLED. Local edits saved to IndexedDB.', 'warning');
          } else {
            btnOffline.classList.remove('btn-danger-outline');
            if (label) label.textContent = 'Simulate Offline';
            if (icon) icon.textContent = '⚡';
            this.showToast('Reconnected! Synced offline changes conflict-free.', 'success');
          }
        });
      }

      // Spawn bots button
      const btnBots = document.getElementById('btn-spawn-bots');
      if (btnBots) {
        btnBots.addEventListener('click', () => {
          if (window.H9Simulation) window.H9Simulation.toggleBots();
        });
      }

      // Open new peer tab button
      const btnPeerTab = document.getElementById('btn-open-peer-tab');
      if (btnPeerTab) {
        btnPeerTab.addEventListener('click', () => {
          const url = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(collab.roomName)}`;
          window.open(url, '_blank');
          this.showToast('Opened new collaborator tab connected to this room.', 'info');
        });
      }

      // Share button
      const btnShare = document.getElementById('btn-share-room');
      if (btnShare) {
        btnShare.addEventListener('click', () => {
          this.openShareModal();
        });
      }

      // Settings button
      const btnSettings = document.getElementById('btn-open-settings');
      if (btnSettings) {
        btnSettings.addEventListener('click', () => {
          this.openModal('modal-settings');
        });
      }

      // Sync status pill click -> switch to debug panel
      const syncPill = document.getElementById('sync-status-pill');
      if (syncPill) {
        syncPill.addEventListener('click', () => {
          this.switchBottomPanel('crdt-debug');
        });
      }
    }

    setupActivityBar() {
      const items = document.querySelectorAll('.activity-item[data-view]');
      items.forEach(item => {
        item.addEventListener('click', () => {
          const view = item.getAttribute('data-view');
          this.switchSidebarView(view);
        });
      });

      const btnSettings = document.getElementById('activity-settings-btn');
      if (btnSettings) {
        btnSettings.addEventListener('click', () => {
          this.openModal('modal-settings');
        });
      }
    }

    switchSidebarView(viewName) {
      this.activeSidebarView = viewName;

      // Update activity icons
      document.querySelectorAll('.activity-item[data-view]').forEach(el => {
        el.classList.toggle('active', el.getAttribute('data-view') === viewName);
      });

      // Update sidebar views
      document.querySelectorAll('.sidebar-view').forEach(view => {
        view.classList.toggle('active', view.id === `view-sidebar-${viewName}`);
      });
    }

    setupSidebarResizing() {
      const resizer = document.getElementById('sidebar-resizer');
      const sidebar = document.getElementById('sidebar');
      if (!resizer || !sidebar) return;

      let isResizing = false;
      resizer.addEventListener('mousedown', e => {
        isResizing = true;
        resizer.classList.add('resizing');
        document.body.style.cursor = 'col-resize';
      });

      document.addEventListener('mousemove', e => {
        if (!isResizing) return;
        const width = e.clientX - 48; // minus activity bar width
        if (width >= 160 && width <= 500) {
          sidebar.style.width = `${width}px`;
        }
      });

      document.addEventListener('mouseup', () => {
        if (isResizing) {
          isResizing = false;
          resizer.classList.remove('resizing');
          document.body.style.cursor = 'default';
        }
      });
    }

    setupPanelResizing() {
      const resizer = document.getElementById('panel-resizer');
      const panel = document.getElementById('bottom-panel');
      if (!resizer || !panel) return;

      let isResizing = false;
      resizer.addEventListener('mousedown', () => {
        isResizing = true;
        resizer.classList.add('resizing');
        document.body.style.cursor = 'row-resize';
      });

      document.addEventListener('mousemove', e => {
        if (!isResizing) return;
        const height = window.innerHeight - e.clientY - 22; // minus status bar
        if (height >= 100 && height <= window.innerHeight * 0.8) {
          panel.style.height = `${height}px`;
        }
      });

      document.addEventListener('mouseup', () => {
        if (isResizing) {
          isResizing = false;
          resizer.classList.remove('resizing');
          document.body.style.cursor = 'default';
        }
      });
    }

    setupBottomPanel() {
      const tabs = document.querySelectorAll('.panel-tab[data-panel]');
      tabs.forEach(tab => {
        tab.addEventListener('click', () => {
          const panel = tab.getAttribute('data-panel');
          this.switchBottomPanel(panel);
        });
      });

      // Clear panel button
      const btnClear = document.getElementById('btn-clear-panel');
      if (btnClear) {
        btnClear.addEventListener('click', () => {
          if (this.activeBottomPanel === 'terminal' && window.H9Terminal) {
            window.H9Terminal.clear();
          } else if (this.activeBottomPanel === 'output' && window.H9Runner) {
            window.H9Runner.clearOutput();
          }
        });
      }

      // Toggle panel close/open
      const btnClose = document.getElementById('btn-close-panel');
      const btnToggle = document.getElementById('btn-toggle-panel');
      const toggleFn = () => {
        const panel = document.getElementById('bottom-panel');
        if (!panel) return;
        this.isPanelOpen = !this.isPanelOpen;
        panel.style.display = this.isPanelOpen ? 'flex' : 'none';
      };

      if (btnClose) btnClose.addEventListener('click', toggleFn);
      if (btnToggle) btnToggle.addEventListener('click', toggleFn);

      // Maximize panel button
      const btnMax = document.getElementById('btn-toggle-panel-size');
      if (btnMax) {
        btnMax.addEventListener('click', () => {
          const panel = document.getElementById('bottom-panel');
          if (!panel) return;
          if (panel.style.height === '70vh') {
            panel.style.height = '220px';
          } else {
            panel.style.height = '70vh';
          }
        });
      }
    }

    switchBottomPanel(panelName) {
      this.activeBottomPanel = panelName;
      const panel = document.getElementById('bottom-panel');
      if (panel) panel.style.display = 'flex';
      this.isPanelOpen = true;

      document.querySelectorAll('.panel-tab[data-panel]').forEach(tab => {
        tab.classList.toggle('active', tab.getAttribute('data-panel') === panelName);
      });

      document.querySelectorAll('.panel-view').forEach(view => {
        view.classList.toggle('active', view.id === `view-${panelName}`);
      });

      if (panelName === 'preview' && window.H9Runner) {
        window.H9Runner.updateLivePreview();
      }
    }

    setupModals() {
      // Close modal backdrop
      document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
        backdrop.addEventListener('click', e => {
          if (e.target === backdrop || e.target.closest('.modal-close')) {
            backdrop.classList.remove('active');
          }
        });
      });

      // New File / Folder prompt
      const btnNewFile = document.getElementById('btn-new-file');
      const btnNewFolder = document.getElementById('btn-new-folder');
      const btnConfirmPrompt = document.getElementById('btn-prompt-confirm');
      const promptInput = document.getElementById('modal-prompt-input');

      let promptAction = null;

      if (btnNewFile) {
        btnNewFile.addEventListener('click', () => {
          document.getElementById('modal-prompt-title').textContent = 'New File';
          document.getElementById('modal-prompt-label').textContent = 'File Name';
          promptInput.value = '';
          promptAction = name => window.H9FileTree.createFile(name);
          this.openModal('modal-prompt');
          setTimeout(() => promptInput.focus(), 100);
        });
      }

      if (btnNewFolder) {
        btnNewFolder.addEventListener('click', () => {
          document.getElementById('modal-prompt-title').textContent = 'New Folder';
          document.getElementById('modal-prompt-label').textContent = 'Folder Name';
          promptInput.value = '';
          promptAction = name => window.H9FileTree.createFolder(name);
          this.openModal('modal-prompt');
          setTimeout(() => promptInput.focus(), 100);
        });
      }

      if (btnConfirmPrompt) {
        btnConfirmPrompt.addEventListener('click', () => {
          const val = promptInput.value.trim();
          if (val && promptAction) {
            promptAction(val);
            this.closeModal('modal-prompt');
          }
        });
      }

      promptInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          btnConfirmPrompt.click();
        }
      });

      // Export ZIP button
      const btnExport = document.getElementById('btn-export-zip');
      if (btnExport) {
        btnExport.addEventListener('click', () => {
          if (window.H9FileTree) window.H9FileTree.exportZip();
        });
      }

      // Settings Save
      const btnSaveSettings = document.getElementById('btn-save-settings');
      if (btnSaveSettings) {
        btnSaveSettings.addEventListener('click', () => {
          const theme = document.getElementById('settings-theme').value;
          const fontSize = document.getElementById('settings-font-size').value;
          const tabSize = document.getElementById('settings-tab-size').value;
          const minimap = document.getElementById('settings-minimap').value;
          const wordWrap = document.getElementById('settings-word-wrap').value;

          if (window.H9Editor) {
            window.H9Editor.setSettings({ theme, fontSize, tabSize, minimap, wordWrap });
          }
          this.showToast('Editor settings saved.', 'success');
        });
      }

      // Copy share link button
      const btnCopy = document.getElementById('btn-copy-share-link');
      if (btnCopy) {
        btnCopy.addEventListener('click', () => {
          const input = document.getElementById('share-link-input');
          input.select();
          navigator.clipboard.writeText(input.value);
          this.showToast('Room link copied to clipboard!', 'success');
        });
      }

      // Split editor toggle -> live preview
      const btnSplit = document.getElementById('btn-split-editor');
      if (btnSplit) {
        btnSplit.addEventListener('click', () => {
          this.switchBottomPanel('preview');
        });
      }
    }

    openShareModal() {
      const input = document.getElementById('share-link-input');
      const roomInput = document.getElementById('share-room-input');
      const fullUrl = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(collab.roomName)}`;

      if (input) input.value = fullUrl;
      if (roomInput) roomInput.value = collab.roomName;

      this.openModal('modal-share');
    }

    openModal(modalId) {
      const modal = document.getElementById(modalId);
      if (modal) modal.classList.add('active');
    }

    closeModal(modalId) {
      const modal = document.getElementById(modalId);
      if (modal) modal.classList.remove('active');
    }

    setupGlobalSearch() {
      const input = document.getElementById('global-search-input');
      const resultsContainer = document.getElementById('search-results-container');
      if (!input || !resultsContainer) return;

      input.addEventListener('input', () => {
        const query = input.value.trim().toLowerCase();
        if (!query) {
          resultsContainer.innerHTML = '<div style="padding: 12px; color: var(--text-muted); font-size: 11px;">Type keyword to search in all files.</div>';
          return;
        }

        resultsContainer.innerHTML = '';
        const fileTreeMap = collab.ydoc.getMap('fileTree');
        let totalMatches = 0;

        fileTreeMap.forEach((file, fileId) => {
          const text = collab.getFileText(fileId).toString();
          const lines = text.split('\n');

          lines.forEach((line, lineIdx) => {
            if (line.toLowerCase().includes(query)) {
              totalMatches++;
              const item = document.createElement('div');
              item.className = 'search-item';
              item.innerHTML = `
                <div class="search-item-file">${file.path}:${lineIdx + 1}</div>
                <div class="search-item-match">${this.escapeHtml(line.trim())}</div>
              `;
              item.addEventListener('click', () => {
                window.H9FileTree.openFile(fileId);
                setTimeout(() => {
                  if (window.H9Editor.editor) {
                    window.H9Editor.editor.revealLineInCenter(lineIdx + 1);
                    window.H9Editor.editor.setPosition({ lineNumber: lineIdx + 1, column: 1 });
                  }
                }, 100);
              });
              resultsContainer.appendChild(item);
            }
          });
        });

        if (totalMatches === 0) {
          resultsContainer.innerHTML = '<div style="padding: 12px; color: var(--text-muted); font-size: 11px;">No matches found.</div>';
        }
      });
    }

    setupCollabPresenceUI() {
      // User name and color inputs in sidebar
      const nameInput = document.getElementById('user-name-input');
      const colorPicker = document.getElementById('user-color-picker');

      if (nameInput) {
        nameInput.value = collab.currentUser.name;
        nameInput.addEventListener('change', () => {
          collab.setUserProfile(nameInput.value.trim(), null);
        });
      }

      if (colorPicker) {
        colorPicker.value = collab.currentUser.color;
        colorPicker.addEventListener('change', () => {
          collab.setUserProfile(null, colorPicker.value);
        });
      }

      // Individual Undo Test buttons
      const btnUndo = document.getElementById('btn-test-undo');
      const btnRedo = document.getElementById('btn-test-redo');
      if (btnUndo) {
        btnUndo.addEventListener('click', () => window.H9Editor.undo());
      }
      if (btnRedo) {
        btnRedo.addEventListener('click', () => window.H9Editor.redo());
      }

      // Listen for peer changes to update active avatars and peer list
      collab.onPeersChange(peers => {
        this.renderPeerAvatars(peers);
        this.renderPeerList(peers);
      });
    }

    renderPeerAvatars(peers) {
      const container = document.getElementById('nav-avatars');
      if (!container) return;
      container.innerHTML = '';

      peers.forEach(peer => {
        const av = document.createElement('div');
        av.className = `avatar ${peer.isSelf ? 'self' : ''}`;
        av.style.backgroundColor = peer.color;
        av.textContent = peer.avatar;
        av.title = `${peer.name} ${peer.isSelf ? '(You)' : ''} - Color: ${peer.color}`;

        av.addEventListener('click', () => {
          this.switchSidebarView('collab');
        });

        container.appendChild(av);
      });

      // Update peer counter badges
      const peerBadge = document.getElementById('activity-peer-count');
      const sbPeers = document.getElementById('sb-peers-count');
      const debugPeers = document.getElementById('debug-peers-count');

      const countText = `${peers.length} ${peers.length === 1 ? 'User' : 'Users'}`;
      if (peerBadge) peerBadge.textContent = peers.length;
      if (sbPeers) sbPeers.textContent = countText;
      if (debugPeers) debugPeers.textContent = peers.length;
    }

    renderPeerList(peers) {
      const container = document.getElementById('collab-peers-list');
      const header = document.getElementById('collab-peers-header');
      if (!container) return;

      if (header) header.textContent = `Active Collaborators (${peers.length})`;
      container.innerHTML = '';

      peers.forEach(peer => {
        const card = document.createElement('div');
        card.className = 'peer-card';
        const activeFile = peer.cursor ? peer.cursor.fileId : 'Viewing workspace';

        card.innerHTML = `
          <div class="peer-avatar" style="background-color: ${peer.color};">
            ${peer.avatar}
          </div>
          <div class="peer-info">
            <div class="peer-name">
              <span>${peer.name}</span>
              ${peer.isSelf ? '<span style="font-size: 10px; color: #58a6ff;">(You)</span>' : ''}
            </div>
            <div class="peer-file">${activeFile}</div>
          </div>
        `;
        container.appendChild(card);
      });
    }

    updateSyncUI(status) {
      const pill = document.getElementById('sync-status-pill');
      const text = document.getElementById('sync-status-text');
      const statusBar = document.getElementById('status-bar');
      const sbText = document.getElementById('sb-sync-text');

      if (pill) {
        pill.className = `sync-pill ${status.pillClass}`;
      }
      if (text) {
        text.textContent = status.label;
      }
      if (statusBar) {
        statusBar.className = status.barClass;
      }
      if (sbText) {
        sbText.textContent = status.state === 'online' ? 'Synced' : 'Offline (Saved locally)';
      }

      // Update debug table
      const debugRoom = document.getElementById('debug-room-name');
      const debugClient = document.getElementById('debug-client-id');
      const debugState = document.getElementById('debug-ws-state');

      if (debugRoom) debugRoom.textContent = collab.roomName;
      if (debugClient) debugClient.textContent = collab.ydoc.clientID;
      if (debugState) debugState.textContent = status.state.toUpperCase();
    }

    setupShortcuts() {
      window.addEventListener('keydown', e => {
        // Ctrl+P or Cmd+P: Quick open / Focus search
        if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
          e.preventDefault();
          this.switchSidebarView('search');
          const searchInput = document.getElementById('global-search-input');
          if (searchInput) searchInput.focus();
        }

        // Ctrl+` or Cmd+`: Toggle Bottom Terminal
        if ((e.ctrlKey || e.metaKey) && e.key === '`') {
          e.preventDefault();
          const btnToggle = document.getElementById('btn-toggle-panel');
          if (btnToggle) btnToggle.click();
        }
      });
    }

    showToast(message, type = 'info') {
      const container = document.getElementById('toast-container');
      if (!container) return;

      const toast = document.createElement('div');
      toast.className = `toast toast-${type}`;
      toast.innerHTML = `
        <span style="font-size: 14px;">${type === 'success' ? '✔' : type === 'warning' ? '⚡' : 'ℹ'}</span>
        <span>${message}</span>
      `;

      container.appendChild(toast);
      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        setTimeout(() => toast.remove(), 200);
      }, 3500);
    }

    escapeHtml(str) {
      return str.replace(/[&<>'"]/g, tag => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
      }[tag] || tag));
    }

    registerServiceWorker() {
      if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
        navigator.serviceWorker.register('sw.js')
          .then(() => console.log('[H9 App] Offline Service Worker registered.'))
          .catch(err => console.warn('[H9 App] Service Worker registration failed:', err));
      }
    }
  }

  return new AppController();
})();
