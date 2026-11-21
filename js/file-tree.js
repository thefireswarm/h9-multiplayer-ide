/**
 * H9 Code Editor - File Explorer & Multi-Tab Workspace Manager
 * Synchronizes file and folder trees via Y.Map CRDT and manages active tabs.
 */

window.H9FileTree = (function() {
  const collab = window.H9CollabManager;
  const { JSZip } = window.H9Collab;

  class FileTreeManager {
    constructor() {
      this.fileTreeMap = collab.ydoc.getMap('fileTree');
      this.folderTreeMap = collab.ydoc.getMap('folderTree');

      this.openTabs = []; // list of fileIds
      this.activeFileId = null;

      this.container = document.getElementById('file-tree-container');
      this.tabsContainer = document.getElementById('editor-tabs');

      this.init();
    }

    init() {
      // Observe CRDT changes to file and folder trees
      this.fileTreeMap.observe(() => {
        this.renderTree();
        this.renderTabs();
      });

      this.folderTreeMap.observe(() => {
        this.renderTree();
      });

      // Initial render once IndexedDB or WS syncs
      collab.ydoc.on('load', () => {
        this.renderTree();
      });

      // Render on startup
      setTimeout(() => {
        this.renderTree();
        // Open default file if any exists
        const files = Array.from(this.fileTreeMap.values());
        if (files.length > 0 && this.openTabs.length === 0) {
          const defaultFile = files.find(f => f.name === 'index.js') || files[0];
          this.openFile(defaultFile.id);
        }
      }, 300);
    }

    getFileIcon(fileName) {
      const ext = fileName.split('.').pop().toLowerCase();
      switch (ext) {
        case 'js':
        case 'jsx':
          return '<span class="icon-js">JS</span>';
        case 'ts':
        case 'tsx':
          return '<span class="icon-ts">TS</span>';
        case 'py':
          return '<span class="icon-py">PY</span>';
        case 'html':
        case 'htm':
          return '<span class="icon-html">&lt;&gt;</span>';
        case 'css':
        case 'scss':
          return '<span class="icon-css">#</span>';
        case 'json':
          return '<span class="icon-json">{}</span>';
        case 'md':
        case 'markdown':
          return '<span class="icon-md">MD</span>';
        default:
          return '<span style="color: #999;">📄</span>';
      }
    }

    renderTree() {
      if (!this.container) return;
      this.container.innerHTML = '';

      const folders = Array.from(this.folderTreeMap.values());
      const files = Array.from(this.fileTreeMap.values());

      if (files.length === 0 && folders.length === 0) {
        this.container.innerHTML = `
          <div style="padding: 16px; color: var(--text-muted); font-size: 11.5px; text-align: center;">
            No files in workspace.<br>
            <button class="btn btn-action" id="btn-seed-empty" style="margin-top: 8px;">Seed Sample Project</button>
          </div>
        `;
        const btnSeed = document.getElementById('btn-seed-empty');
        if (btnSeed) {
          btnSeed.addEventListener('click', () => this.seedStarterFiles());
        }
        return;
      }

      // Root container
      const rootDiv = document.createElement('div');

      // Render root folders first
      folders.filter(f => !f.parentId).forEach(folder => {
        const folderElem = this.createFolderElement(folder, folders, files);
        rootDiv.appendChild(folderElem);
      });

      // Render root files
      files.filter(f => !f.folderId).forEach(file => {
        const fileElem = this.createFileElement(file);
        rootDiv.appendChild(fileElem);
      });

      this.container.appendChild(rootDiv);
    }

    createFolderElement(folder, allFolders, allFiles) {
      const folderDiv = document.createElement('div');
      folderDiv.className = 'tree-folder';

      const header = document.createElement('div');
      header.className = 'tree-node';
      header.innerHTML = `
        <span class="node-icon icon-folder">📁</span>
        <span class="node-name">${folder.name}</span>
        <div class="node-actions">
          <button class="icon-btn action-del-folder" title="Delete folder">✕</button>
        </div>
      `;

      const childrenDiv = document.createElement('div');
      childrenDiv.className = 'tree-children';

      header.addEventListener('click', e => {
        if (e.target.closest('.action-del-folder')) {
          this.deleteFolder(folder.id);
          return;
        }
        childrenDiv.style.display = childrenDiv.style.display === 'none' ? 'block' : 'none';
      });

      // Sub-folders
      allFolders.filter(f => f.parentId === folder.id).forEach(sub => {
        childrenDiv.appendChild(this.createFolderElement(sub, allFolders, allFiles));
      });

      // Sub-files
      allFiles.filter(f => f.folderId === folder.id).forEach(file => {
        childrenDiv.appendChild(this.createFileElement(file));
      });

      folderDiv.appendChild(header);
      folderDiv.appendChild(childrenDiv);
      return folderDiv;
    }

    createFileElement(file) {
      const node = document.createElement('div');
      node.className = `tree-node ${this.activeFileId === file.id ? 'active' : ''}`;
      node.innerHTML = `
        <span class="node-icon">${this.getFileIcon(file.name)}</span>
        <span class="node-name" title="${file.path}">${file.name}</span>
        <div class="node-actions">
          <button class="icon-btn action-del-file" title="Delete file">✕</button>
        </div>
      `;

      node.addEventListener('click', e => {
        if (e.target.closest('.action-del-file')) {
          e.stopPropagation();
          this.deleteFile(file.id);
          return;
        }
        this.openFile(file.id);
      });

      return node;
    }

    openFile(fileId) {
      const file = this.fileTreeMap.get(fileId);
      if (!file) return;

      this.activeFileId = fileId;
      if (!this.openTabs.includes(fileId)) {
        this.openTabs.push(fileId);
      }

      this.renderTabs();
      this.renderTree();

      // Open in Monaco Editor
      if (window.H9Editor) {
        window.H9Editor.openFile(fileId, file.path);
      }

      // Update breadcrumb
      const bc = document.getElementById('nav-breadcrumb-file');
      if (bc) bc.textContent = file.path;
    }

    closeTab(fileId) {
      const idx = this.openTabs.indexOf(fileId);
      if (idx === -1) return;

      this.openTabs.splice(idx, 1);

      if (this.activeFileId === fileId) {
        if (this.openTabs.length > 0) {
          const nextTab = this.openTabs[Math.max(0, idx - 1)];
          this.openFile(nextTab);
        } else {
          this.activeFileId = null;
          if (window.H9Editor && window.H9Editor.editor) {
            window.H9Editor.editor.setValue('// No files currently open. Select a file from the explorer.');
          }
        }
      }

      this.renderTabs();
    }

    renderTabs() {
      if (!this.tabsContainer) return;

      // Keep action buttons intact
      const actions = this.tabsContainer.querySelector('.tabs-actions');

      // Clear existing tabs
      const oldTabs = this.tabsContainer.querySelectorAll('.tab');
      oldTabs.forEach(t => t.remove());

      this.openTabs.forEach(fileId => {
        const file = this.fileTreeMap.get(fileId);
        if (!file) return;

        const tab = document.createElement('div');
        tab.className = `tab ${this.activeFileId === fileId ? 'active' : ''}`;
        tab.innerHTML = `
          <span>${this.getFileIcon(file.name)}</span>
          <span>${file.name}</span>
          <span class="tab-dirty"></span>
          <span class="tab-close" title="Close Tab">✕</span>
        `;

        tab.addEventListener('click', e => {
          if (e.target.classList.contains('tab-close')) {
            e.stopPropagation();
            this.closeTab(fileId);
            return;
          }
          this.openFile(fileId);
        });

        if (actions) {
          this.tabsContainer.insertBefore(tab, actions);
        } else {
          this.tabsContainer.appendChild(tab);
        }
      });
    }

    createFile(fileName, folderId = null, initialContent = '') {
      if (!fileName || !fileName.trim()) return;
      fileName = fileName.trim();

      const folder = folderId ? this.folderTreeMap.get(folderId) : null;
      const filePath = folder ? `${folder.path}/${fileName}` : fileName;
      const fileId = filePath;

      collab.ydoc.transact(() => {
        this.fileTreeMap.set(fileId, {
          id: fileId,
          name: fileName,
          path: filePath,
          type: 'file',
          language: window.H9Editor ? window.H9Editor.getLanguageForPath(fileName) : 'plaintext',
          folderId: folderId,
          createdAt: Date.now(),
          updatedAt: Date.now()
        });

        const ytext = collab.getFileText(fileId);
        if (ytext.length === 0 && initialContent) {
          ytext.insert(0, initialContent);
        }
      }, collab.localOrigin);

      this.openFile(fileId);
      window.H9App.showToast(`File created: ${filePath}`, 'success');
    }

    createFolder(folderName, parentId = null) {
      if (!folderName || !folderName.trim()) return;
      folderName = folderName.trim();

      const parent = parentId ? this.folderTreeMap.get(parentId) : null;
      const folderPath = parent ? `${parent.path}/${folderName}` : folderName;
      const folderId = folderPath;

      collab.ydoc.transact(() => {
        this.folderTreeMap.set(folderId, {
          id: folderId,
          name: folderName,
          path: folderPath,
          type: 'folder',
          parentId: parentId
        });
      }, collab.localOrigin);

      window.H9App.showToast(`Folder created: ${folderPath}`, 'success');
    }

    deleteFile(fileId) {
      const file = this.fileTreeMap.get(fileId);
      if (!file) return;

      if (!confirm(`Are you sure you want to delete ${file.name}?`)) return;

      collab.ydoc.transact(() => {
        this.fileTreeMap.delete(fileId);
      }, collab.localOrigin);

      this.closeTab(fileId);
      window.H9App.showToast(`File deleted: ${file.name}`, 'info');
    }

    deleteFolder(folderId) {
      const folder = this.folderTreeMap.get(folderId);
      if (!folder) return;

      if (!confirm(`Delete folder ${folder.name} and all its contents?`)) return;

      collab.ydoc.transact(() => {
        // Delete all child files
        this.fileTreeMap.forEach((file, fileId) => {
          if (file.path.startsWith(folder.path + '/') || file.folderId === folderId) {
            this.fileTreeMap.delete(fileId);
            this.closeTab(fileId);
          }
        });

        // Delete subfolders
        this.folderTreeMap.forEach((f, fId) => {
          if (f.path.startsWith(folder.path + '/') || f.parentId === folderId) {
            this.folderTreeMap.delete(fId);
          }
        });

        this.folderTreeMap.delete(folderId);
      }, collab.localOrigin);

      window.H9App.showToast(`Folder deleted: ${folder.name}`, 'info');
    }

    async exportZip() {
      const zip = new JSZip();
      const files = Array.from(this.fileTreeMap.values());

      if (files.length === 0) {
        window.H9App.showToast('Workspace is empty, nothing to export.', 'warning');
        return;
      }

      files.forEach(file => {
        const ytext = collab.getFileText(file.id);
        zip.file(file.path, ytext.toString());
      });

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `h9-project-${collab.roomName}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      window.H9App.showToast('Project exported as ZIP successfully!', 'success');
    }

    seedStarterFiles() {
      collab.ydoc.transact(() => {
        this.folderTreeMap.set('src', { id: 'src', name: 'src', path: 'src', type: 'folder', parentId: null });
        
        this.createFile('index.js', 'src', '// Collaborative JS\nconsole.log("H9 IDE Ready!");\n');
        this.createFile('index.html', null, '<!DOCTYPE html>\n<html><body><h1>H9 Demo</h1></body></html>\n');
        this.createFile('README.md', null, '# H9 Project\nCollaborative offline code editor.\n');
      }, collab.localOrigin);
    }
  }

  return new FileTreeManager();
})();
