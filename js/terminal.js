/**
 * H9 Interactive Terminal Emulator
 * Provides command line control of workspace, execution, and multiplayer diagnostics.
 */

window.H9Terminal = (function() {
  class TerminalEmulator {
    constructor() {
      this.historyEl = document.getElementById('terminal-history');
      this.inputEl = document.getElementById('terminal-cmd-input');
      this.history = [];
      this.historyIndex = -1;

      this.init();
    }

    init() {
      if (!this.inputEl) return;

      this.writeLine('H9 Code Editor Terminal [Version 2.0.0-hackathon]');
      this.writeLine('Type "help" to list available commands.\n', 'term-info');

      this.inputEl.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          const cmd = this.inputEl.value.trim();
          this.inputEl.value = '';
          if (cmd) {
            this.history.push(cmd);
            this.historyIndex = this.history.length;
            this.executeCommand(cmd);
          }
        } else if (e.key === 'ArrowUp') {
          if (this.history.length > 0 && this.historyIndex > 0) {
            this.historyIndex--;
            this.inputEl.value = this.history[this.historyIndex];
          }
        } else if (e.key === 'ArrowDown') {
          if (this.historyIndex < this.history.length - 1) {
            this.historyIndex++;
            this.inputEl.value = this.history[this.historyIndex];
          } else {
            this.historyIndex = this.history.length;
            this.inputEl.value = '';
          }
        }
      });
    }

    writeLine(text, className = '') {
      if (!this.historyEl) return;
      const div = document.createElement('div');
      div.className = `terminal-line ${className}`;
      div.textContent = text;
      this.historyEl.appendChild(div);
      this.historyEl.scrollTop = this.historyEl.scrollHeight;
    }

    clear() {
      if (this.historyEl) {
        this.historyEl.innerHTML = '';
      }
    }

    executeCommand(cmd) {
      this.writeLine(`h9@workspace:~$ ${cmd}`, 'term-cmd');
      const parts = cmd.split(' ');
      const action = parts[0].toLowerCase();
      const args = parts.slice(1);

      switch (action) {
        case 'help':
          this.writeLine('Available Commands:');
          this.writeLine('  run            - Execute the currently open file in sandbox');
          this.writeLine('  ls             - List files and folders in workspace');
          this.writeLine('  cat <file>     - Print the contents of a file');
          this.writeLine('  status         - Show real-time sync, CRDT & offline metrics');
          this.writeLine('  users          - Display active collaborators in this room');
          this.writeLine('  offline        - Toggle simulated offline mode');
          this.writeLine('  export         - Download workspace as ZIP');
          this.writeLine('  theme <name>   - Switch theme (vs-dark, vs, hc-black)');
          this.writeLine('  clear          - Clear terminal output');
          this.writeLine('  help           - Show this help list');
          break;

        case 'clear':
        case 'cls':
          this.clear();
          break;

        case 'run':
          if (window.H9Runner) {
            window.H9Runner.runActiveFile();
            this.writeLine('Dispatched run command to execution sandbox.', 'term-success');
          }
          break;

        case 'ls': {
          const files = Array.from(window.H9CollabManager.ydoc.getMap('fileTree').values());
          const folders = Array.from(window.H9CollabManager.ydoc.getMap('folderTree').values());
          this.writeLine('Directories:');
          folders.forEach(f => this.writeLine(`  📁 ${f.path}`, 'term-info'));
          this.writeLine('Files:');
          files.forEach(f => this.writeLine(`  📄 ${f.path} (${f.language})`));
          break;
        }

        case 'cat': {
          if (!args[0]) {
            this.writeLine('Usage: cat <filename>', 'term-warn');
            return;
          }
          const target = args[0];
          const ytext = window.H9CollabManager.getFileText(target);
          if (ytext.length === 0) {
            this.writeLine(`File '${target}' not found or empty.`, 'term-warn');
          } else {
            this.writeLine(ytext.toString());
          }
          break;
        }

        case 'status': {
          const s = window.H9CollabManager.getSyncStatus();
          const peers = window.H9CollabManager.getPeers();
          this.writeLine(`--- H9 Workspace Diagnostics ---`, 'term-info');
          this.writeLine(`Room: ${window.H9CollabManager.roomName}`);
          this.writeLine(`Status: ${s.label}`);
          this.writeLine(`Active Peers: ${peers.length}`);
          this.writeLine(`IndexedDB: Active (Automatic offline persistence)`);
          this.writeLine(`CRDT Engine: Yjs state vector replication`);
          break;
        }

        case 'users': {
          const peers = window.H9CollabManager.getPeers();
          this.writeLine(`Connected Collaborators (${peers.length}):`, 'term-info');
          peers.forEach(p => {
            const selfTag = p.isSelf ? ' (You)' : '';
            this.writeLine(`  ● ${p.name}${selfTag} - Color: ${p.color}`);
          });
          break;
        }

        case 'offline': {
          const isOffline = window.H9CollabManager.toggleSimulatedOffline();
          this.writeLine(`Offline simulation is now: ${isOffline ? 'ON (Disconnected)' : 'OFF (Reconnected)'}`, isOffline ? 'term-warn' : 'term-success');
          break;
        }

        case 'export':
          if (window.H9FileTree) {
            window.H9FileTree.exportZip();
          }
          break;

        case 'theme':
          if (args[0] && window.H9Editor) {
            window.H9Editor.setSettings({ theme: args[0] });
            this.writeLine(`Theme switched to ${args[0]}`, 'term-success');
          } else {
            this.writeLine('Usage: theme <vs-dark | vs | hc-black>', 'term-warn');
          }
          break;

        default:
          this.writeLine(`Command not found: ${action}. Type 'help' for commands.`, 'term-err');
      }
    }
  }

  return new TerminalEmulator();
})();
