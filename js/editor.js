/**
 * H9 Code Editor - Monaco Editor Integration & CRDT Binding
 * Handles editor lifecycle, multiple models, individual undo, and collaborator cursor rendering.
 */

window.H9Editor = (function() {
  const collab = window.H9CollabManager;

  class EditorManager {
    constructor() {
      this.editor = null;
      this.monaco = null;
      this.models = new Map(); // fileId -> { model, binding, ytext, undoManager }
      this.activeFileId = null;
      this.decorations = new Map(); // clientId -> decorationIds[]
      this.isBindingApplying = false;

      this.theme = 'vs-dark';
      this.fontSize = 14;
      this.tabSize = 2;
      this.minimap = true;
      this.wordWrap = 'on';

      this.initPromise = this.initMonaco();
    }

    initMonaco() {
      return new Promise((resolve, reject) => {
        if (!window.require) {
          console.error('[H9 Editor] Monaco loader.js not loaded!');
          return reject(new Error('Monaco loader not found'));
        }

        window.require.config({ paths: { vs: 'vendor/vs' } });
        window.require(['vs/editor/editor.main'], () => {
          this.monaco = window.monaco;
          this.createEditorInstance();
          resolve(this.monaco);
        }, reject);
      });
    }

    createEditorInstance() {
      const container = document.getElementById('monaco-container');
      if (!container) return;

      this.editor = this.monaco.editor.create(container, {
        value: '// Welcome to H9 Code Editor\n',
        language: 'javascript',
        theme: this.theme,
        fontSize: this.fontSize,
        tabSize: this.tabSize,
        automaticLayout: true,
        wordWrap: this.wordWrap,
        minimap: { enabled: this.minimap },
        scrollBeyondLastLine: false,
        renderWhitespace: 'selection',
        fontFamily: "'Cascadia Code', Consolas, 'Courier New', monospace",
        cursorBlinking: 'smooth',
        cursorSmoothCaretAnimation: 'on',
        bracketPairColorization: { enabled: true }
      });

      // Track cursor position for status bar & peer awareness
      this.editor.onDidChangeCursorPosition(e => {
        const pos = e.position;
        const sbPos = document.getElementById('sb-cursor-pos');
        if (sbPos) {
          sbPos.textContent = `Ln ${pos.lineNumber}, Col ${pos.column}`;
        }
        if (this.activeFileId) {
          const sel = this.editor.getSelection();
          collab.setCursorAwareness(this.activeFileId, pos, sel);
        }
      });

      // Hook custom undo/redo commands to H9 Individual UndoManager!
      this.editor.addCommand(this.monaco.KeyMod.CtrlCmd | this.monaco.KeyCode.KeyZ, () => {
        this.undo();
      });

      this.editor.addCommand(this.monaco.KeyMod.CtrlCmd | this.monaco.KeyCode.KeyY, () => {
        this.redo();
      });

      this.editor.addCommand(this.monaco.KeyMod.CtrlCmd | this.monaco.KeyMod.Shift | this.monaco.KeyCode.KeyZ, () => {
        this.redo();
      });

      // Run code shortcut: Ctrl+Enter
      this.editor.addCommand(this.monaco.KeyMod.CtrlCmd | this.monaco.KeyCode.Enter, () => {
        const btnRun = document.getElementById('btn-run-code');
        if (btnRun) btnRun.click();
      });

      // Save shortcut: Ctrl+S
      this.editor.addCommand(this.monaco.KeyMod.CtrlCmd | this.monaco.KeyCode.KeyS, () => {
        window.H9App.showToast('Changes automatically saved locally and synced with CRDT room.', 'success');
      });

      // Listen for peer awareness changes to update remote collaborator cursors
      collab.onPeersChange(peers => {
        this.renderRemoteCursors(peers);
      });

      console.log('[H9 Editor] Monaco Editor initialized successfully.');
    }

    getLanguageForPath(filePath) {
      if (!filePath) return 'plaintext';
      const ext = filePath.split('.').pop().toLowerCase();
      const map = {
        js: 'javascript',
        jsx: 'javascript',
        ts: 'typescript',
        tsx: 'typescript',
        py: 'python',
        html: 'html',
        htm: 'html',
        css: 'css',
        json: 'json',
        md: 'markdown',
        markdown: 'markdown',
        txt: 'plaintext',
        sql: 'sql',
        cpp: 'cpp',
        c: 'c',
        java: 'java',
        xml: 'xml',
        yaml: 'yaml',
        yml: 'yaml'
      };
      return map[ext] || 'plaintext';
    }

    /**
     * Open or switch to a file model
     */
    async openFile(fileId, filePath) {
      await this.initPromise;
      if (!fileId) return;

      this.activeFileId = fileId;
      let record = this.models.get(fileId);

      if (!record) {
        const ytext = collab.getFileText(fileId);
        const language = this.getLanguageForPath(filePath || fileId);
        const model = this.monaco.editor.createModel(ytext.toString(), language);

        // Individual UndoManager for this file
        const undoManager = collab.getUndoManager(fileId);

        // Bind Monaco Model <--> Y.Text CRDT
        this.bindModelToYText(model, ytext, fileId);

        record = { model, ytext, undoManager, filePath };
        this.models.set(fileId, record);
      }

      this.editor.setModel(record.model);

      // Update status bar language
      const lang = this.getLanguageForPath(filePath || fileId);
      const sbLang = document.getElementById('sb-language');
      if (sbLang) {
        sbLang.textContent = lang.toUpperCase();
      }

      // Update awareness for this file
      const pos = this.editor.getPosition();
      const sel = this.editor.getSelection();
      collab.setCursorAwareness(fileId, pos, sel);

      // Re-render cursors for active file
      this.renderRemoteCursors(collab.getPeers());
    }

    /**
     * Bidirectional Binding between Monaco Model and Y.Text
     * CRITICAL H9 IMPLEMENTATION:
     * - Uses localOrigin for local edits.
     * - Disables looping while applying remote updates.
     */
    bindModelToYText(model, ytext, fileId) {
      let isLocalEdit = false;

      // 1. Monaco -> Y.Text
      model.onDidChangeContent(event => {
        if (this.isBindingApplying) return;

        isLocalEdit = true;
        collab.ydoc.transact(() => {
          // Sort changes in reverse order to preserve offsets
          const changes = event.changes.slice().sort((a, b) => b.rangeOffset - a.rangeOffset);
          for (const change of changes) {
            if (change.rangeLength > 0) {
              ytext.delete(change.rangeOffset, change.rangeLength);
            }
            if (change.text.length > 0) {
              ytext.insert(change.rangeOffset, change.text);
            }
          }
        }, collab.localOrigin);
        isLocalEdit = false;

        // Trigger live preview update if html/css/js
        if (window.H9Runner) {
          window.H9Runner.scheduleLivePreview();
        }
      });

      // 2. Y.Text -> Monaco Model (Remote collaborator edits)
      ytext.observe(event => {
        // If the change came from our local editor, ignore (Monaco already has it)
        if (event.transaction.origin === collab.localOrigin || isLocalEdit) {
          return;
        }

        this.isBindingApplying = true;
        try {
          const delta = event.delta;
          let index = 0;

          model.pushEditOperations([], delta.map(op => {
            if (op.retain !== undefined) {
              index += op.retain;
              return null;
            }
            if (op.delete !== undefined) {
              const startPos = model.getPositionAt(index);
              const endPos = model.getPositionAt(index + op.delete);
              const range = new this.monaco.Range(startPos.lineNumber, startPos.column, endPos.lineNumber, endPos.column);
              return { range, text: '' };
            }
            if (op.insert !== undefined) {
              const pos = model.getPositionAt(index);
              const range = new this.monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column);
              const text = typeof op.insert === 'string' ? op.insert : '';
              index += text.length;
              return { range, text, forceMoveMarkers: true };
            }
            return null;
          }).filter(Boolean), () => null);
        } finally {
          this.isBindingApplying = false;
        }

        // Trigger live preview
        if (window.H9Runner) {
          window.H9Runner.scheduleLivePreview();
        }
      });
    }

    /**
     * Individual Undo
     */
    undo() {
      if (!this.activeFileId) return;
      const record = this.models.get(this.activeFileId);
      if (record && record.undoManager) {
        record.undoManager.undo();
        window.H9App.showToast('Individual Undo applied (Collaborator code untouched)', 'info');
      }
    }

    /**
     * Individual Redo
     */
    redo() {
      if (!this.activeFileId) return;
      const record = this.models.get(this.activeFileId);
      if (record && record.undoManager) {
        record.undoManager.redo();
        window.H9App.showToast('Individual Redo applied', 'info');
      }
    }

    /**
     * Render live cursors and selection ranges for remote peers
     */
    renderRemoteCursors(peers) {
      if (!this.editor || !this.monaco || !this.activeFileId) return;

      const activePeers = peers.filter(p => !p.isSelf && p.cursor && p.cursor.fileId === this.activeFileId);
      const currentClientIds = new Set(activePeers.map(p => p.clientId));

      // Remove decorations for peers who left or switched file
      this.decorations.forEach((decoIds, clientId) => {
        if (!currentClientIds.has(clientId)) {
          this.editor.deltaDecorations(decoIds, []);
          this.decorations.delete(clientId);
        }
      });

      // Inject / update decorations for active peers
      activePeers.forEach(peer => {
        const { position, selection } = peer.cursor;
        if (!position) return;

        const styleId = `peer-style-${peer.clientId}`;
        let styleTag = document.getElementById(styleId);
        if (!styleTag) {
          styleTag = document.createElement('style');
          styleTag.id = styleId;
          document.head.appendChild(styleTag);
        }

        // Generate custom CSS class for this collaborator's cursor & tag
        const classNameCursor = `yRemoteCursor-${peer.clientId}`;
        const classNameSelection = `yRemoteSelection-${peer.clientId}`;

        styleTag.textContent = `
          .${classNameCursor} {
            border-left: 2px solid ${peer.color} !important;
            position: absolute;
            pointer-events: none;
          }
          .${classNameCursor}::after {
            content: "${peer.name.replace(/"/g, '')}";
            position: absolute;
            top: -18px;
            left: -2px;
            background-color: ${peer.color};
            color: #ffffff;
            font-size: 10px;
            font-weight: 700;
            padding: 1px 5px;
            border-radius: 3px 3px 3px 0;
            white-space: nowrap;
            pointer-events: none;
            box-shadow: 0 2px 4px rgba(0,0,0,0.5);
            z-index: 1000;
          }
          .${classNameSelection} {
            background-color: ${peer.color}33 !important;
          }
        `;

        const newDecorations = [];

        // 1. Cursor line & tag decoration
        newDecorations.push({
          range: new this.monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column),
          options: {
            className: classNameCursor,
            beforeContentClassName: undefined,
            isWholeLine: false,
            stickiness: this.monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
          }
        });

        // 2. Selection range highlight if range is selected
        if (selection && (selection.startLineNumber !== selection.endLineNumber || selection.startColumn !== selection.endColumn)) {
          newDecorations.push({
            range: new this.monaco.Range(
              selection.startLineNumber,
              selection.startColumn,
              selection.endLineNumber,
              selection.endColumn
            ),
            options: {
              className: classNameSelection,
              isWholeLine: false
            }
          });
        }

        const oldDecos = this.decorations.get(peer.clientId) || [];
        const applied = this.editor.deltaDecorations(oldDecos, newDecorations);
        this.decorations.set(peer.clientId, applied);
      });
    }

    getActiveContent() {
      if (!this.editor) return '';
      return this.editor.getValue();
    }

    getActiveLanguage() {
      if (!this.activeFileId) return 'javascript';
      return this.getLanguageForPath(this.activeFileId);
    }

    setSettings(settings) {
      if (settings.theme) {
        this.theme = settings.theme;
        this.monaco.editor.setTheme(this.theme);
      }
      if (settings.fontSize) {
        this.fontSize = parseInt(settings.fontSize, 10);
        this.editor.updateOptions({ fontSize: this.fontSize });
      }
      if (settings.tabSize) {
        this.tabSize = parseInt(settings.tabSize, 10);
        this.editor.updateOptions({ tabSize: this.tabSize });
      }
      if (settings.minimap !== undefined) {
        this.minimap = settings.minimap === true || settings.minimap === 'true';
        this.editor.updateOptions({ minimap: { enabled: this.minimap } });
      }
      if (settings.wordWrap) {
        this.wordWrap = settings.wordWrap;
        this.editor.updateOptions({ wordWrap: this.wordWrap });
      }
    }
  }

  return new EditorManager();
})();
