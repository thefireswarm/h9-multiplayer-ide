/**
 * H9 Multiplayer & Offline Simulation Testbench
 * Spawns automated collaborator peers directly in the browser to demonstrate
 * 4+ simultaneous users, live cursors, CRDT merging, and individual undo.
 */

window.H9Simulation = (function() {
  const collab = window.H9CollabManager;
  let activeBots = [];
  let simulationInterval = null;
  let isRunning = false;

  const BOT_CONFIGS = [
    { name: 'Alex (Lead Dev)', color: '#e53935', avatar: 'AL' },
    { name: 'Sam (Backend)', color: '#43a047', avatar: 'SA' },
    { name: 'Elena (QA)', color: '#8e24aa', avatar: 'EL' },
    { name: 'Jordan (Mobile)', color: '#fb8c00', avatar: 'JO' }
  ];

  class SimulationEngine {
    constructor() {
      this.btnSpawn = document.getElementById('btn-spawn-bots');
    }

    toggleBots() {
      if (isRunning) {
        this.stopBots();
      } else {
        this.startBots();
      }
    }

    startBots() {
      if (isRunning) return;
      isRunning = true;
      if (this.btnSpawn) {
        this.btnSpawn.innerHTML = '<span>⏹️</span><span>Stop Bots Demo</span>';
        this.btnSpawn.classList.add('btn-danger-outline');
      }

      window.H9App.showToast('🚀 Spawned 4 collaborative bots! Watching live cursors & concurrent edits...', 'success');

      // Initialize bots with simulated awareness and typing
      activeBots = BOT_CONFIGS.map((cfg, idx) => {
        const botClientId = 900000 + idx;
        return {
          id: botClientId,
          name: cfg.name,
          color: cfg.color,
          avatar: cfg.avatar,
          line: 5 + (idx * 4),
          col: 1,
          targetFile: window.H9Editor.activeFileId || 'src/index.js',
          origin: { client: botClientId, user: cfg.name },
          offlineTimer: 0,
          isOffline: false
        };
      });

      // Simulation loop: moves cursors, types code, demonstrates offline reconnection
      let step = 0;
      simulationInterval = setInterval(() => {
        step++;
        const activeFileId = window.H9Editor.activeFileId;
        if (!activeFileId) return;

        const ytext = collab.getFileText(activeFileId);

        activeBots.forEach((bot, idx) => {
          // Occasionally simulate a bot disconnecting and reconnecting
          if (step % 25 === (idx * 5)) {
            bot.isOffline = !bot.isOffline;
            if (bot.isOffline) {
              window.H9App.showToast(`📡 [Demo] ${bot.name} disconnected (Offline mode)...`, 'warning');
            } else {
              window.H9App.showToast(`🟢 [Demo] ${bot.name} reconnected & synced conflict-free!`, 'success');
            }
          }

          if (bot.isOffline) return;

          // Move cursor
          bot.line = Math.max(1, (bot.line + (Math.random() > 0.5 ? 1 : -1)) % 25 + 1);
          bot.col = Math.floor(Math.random() * 20) + 1;

          // Update simulated awareness state
          if (collab.wsProvider && collab.wsProvider.awareness) {
            const states = collab.wsProvider.awareness.getStates();
            states.set(bot.id, {
              user: { name: bot.name, color: bot.color, avatar: bot.avatar },
              cursor: {
                fileId: activeFileId,
                position: { lineNumber: bot.line, column: bot.col },
                selection: {
                  startLineNumber: bot.line,
                  startColumn: bot.col,
                  endLineNumber: bot.line,
                  endColumn: bot.col + (Math.random() > 0.7 ? 4 : 0)
                }
              }
            });
          }

          // Occasionally insert collaborative comments into the document
          if (step % 8 === idx && ytext.length > 0) {
            collab.ydoc.transact(() => {
              const snippets = [
                `\n// [${bot.name}]: Verified algorithm efficiency at ${new Date().toLocaleTimeString()}`,
                `\n// [${bot.name}]: CRDT merge verification successful.`,
                `\n// [${bot.name}]: Live test ping from simulated collaborator.`
              ];
              const snippet = snippets[Math.floor(Math.random() * snippets.length)];
              const insertPos = Math.min(ytext.length, bot.line * 20);
              ytext.insert(insertPos, snippet);
            }, bot.origin);
          }
        });

        // Trigger peer update
        collab.notifyPeers();
      }, 1200);
    }

    stopBots() {
      if (!isRunning) return;
      isRunning = false;
      clearInterval(simulationInterval);

      if (this.btnSpawn) {
        this.btnSpawn.innerHTML = '<span>🤖</span><span>Multiplayer Demo</span>';
        this.btnSpawn.classList.remove('btn-danger-outline');
      }

      // Clear bots from awareness
      if (collab.wsProvider && collab.wsProvider.awareness) {
        const states = collab.wsProvider.awareness.getStates();
        activeBots.forEach(bot => {
          states.delete(bot.id);
        });
        collab.notifyPeers();
      }

      activeBots = [];
      window.H9App.showToast('Collaborator bots stopped.', 'info');
    }
  }

  return new SimulationEngine();
})();
