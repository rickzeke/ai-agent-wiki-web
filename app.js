/* ========================================
   知库 - AI Agent 知识维基
   Application Logic (Vanilla JS)
   ======================================== */

// ----- Configuration -----
const CONFIG = {
  STORAGE_KEY: 'aiknowledge_notes',
  SETTINGS_KEY: 'aiknowledge_settings',
  THEME_KEY: 'aiknowledge_theme',
  AUTOSAVE_DELAY: 1000,
  MAX_PREVIEW_LENGTH: 200,
};

// ----- UUID Generator -----
function uuid() {
  return 'xxxx-xxxx-xxxx-xxxx'.replace(/x/g, () =>
    Math.floor(Math.random() * 16).toString(16)
  );
}

// ----- Utility -----
function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ----- Toast -----
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  toast.innerHTML = `<span>${icons[type] || icons.info}</span> ${message}`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ========================
//  NOTES STORE (localStorage)
// ========================
class NotesStore {
  constructor() {
    this.notes = [];
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
      this.notes = raw ? JSON.parse(raw) : [];
    } catch {
      this.notes = [];
    }
  }

  save() {
    localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(this.notes));
  }

  getAll() {
    return [...this.notes].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getFiltered(statusFilter) {
    let result = this.getAll();
    if (statusFilter === 'draft') result = result.filter(n => n.status === 'draft');
    if (statusFilter === 'published') result = result.filter(n => n.status === 'published');
    return result;
  }

  getById(id) {
    return this.notes.find(n => n.id === id) || null;
  }

  getByTitle(title) {
    return this.notes.find(n => n.title.toLowerCase() === title.toLowerCase()) || null;
  }

  getByFolder(folder) {
    return this.notes.filter(n => n.folder === folder);
  }

  create(title = '未命名笔记', folder = '', content = '', status = 'draft') {
    const note = {
      id: uuid(),
      title,
      content,
      tags: [],
      folder,
      status,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.notes.push(note);
    this.save();
    return note;
  }

  update(id, updates) {
    const idx = this.notes.findIndex(n => n.id === id);
    if (idx === -1) return null;
    this.notes[idx] = { ...this.notes[idx], ...updates, updatedAt: Date.now() };
    this.save();
    return this.notes[idx];
  }

  delete(id) {
    const idx = this.notes.findIndex(n => n.id === id);
    if (idx === -1) return false;
    this.notes.splice(idx, 1);
    this.save();
    return true;
  }

  search(query) {
    const q = query.toLowerCase();
    return this.notes.filter(n =>
      n.title.toLowerCase().includes(q) ||
      n.content.toLowerCase().includes(q) ||
      n.tags.some(t => t.toLowerCase().includes(q))
    );
  }

  getFolders() {
    const set = new Set();
    this.notes.forEach(n => {
      if (n.folder) set.add(n.folder);
    });
    return [...set].sort();
  }

  getFolderTree() {
    const tree = { name: 'root', folders: {}, notes: [] };
    this.notes.forEach(n => {
      if (!n.folder) {
        tree.notes.push(n);
        return;
      }
      const parts = n.folder.split('/').filter(Boolean);
      let current = tree;
      parts.forEach(part => {
        if (!current.folders[part]) {
          current.folders[part] = { name: part, folders: {}, notes: [] };
        }
        current = current.folders[part];
      });
      current.notes.push(n);
    });
    return tree;
  }

  getStats() {
    const total = this.notes.length;
    const drafts = this.notes.filter(n => n.status === 'draft').length;
    const published = this.notes.filter(n => n.status === 'published').length;
    const totalSize = new Blob([JSON.stringify(this.notes)]).size;
    return { total, drafts, published, totalSize };
  }
}

// ========================
//  WIKILINKS ENGINE
// ========================
class WikilinksEngine {
  // Parse [[title]] patterns from markdown text
  static parse(text) {
    if (!text) return [];
    const regex = /\[\[([^\]]+)\]\]/g;
    const links = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
      links.push({
        raw: match[0],
        title: match[1].trim(),
        index: match.index,
      });
    }
    return links;
  }

  // Get all notes that link TO a given note (backlinks)
  static getBacklinks(store, noteId) {
    const targetNote = store.getById(noteId);
    if (!targetNote) return [];
    return store.notes.filter(n => {
      if (n.id === noteId) return false;
      const links = WikilinksEngine.parse(n.content);
      return links.some(l => l.title.toLowerCase() === targetNote.title.toLowerCase());
    }).map(n => ({
      id: n.id,
      title: n.title,
      folder: n.folder,
      status: n.status,
    }));
  }

  // Get notes that ARE linked FROM the given note
  static getOutlinks(store, noteId) {
    const note = store.getById(noteId);
    if (!note) return [];
    const parsed = WikilinksEngine.parse(note.content);
    const outlinks = [];
    const seen = new Set();

    parsed.forEach(link => {
      const target = store.getByTitle(link.title);
      if (target && !seen.has(target.id)) {
        seen.add(target.id);
        outlinks.push({
          id: target.id,
          title: target.title,
          folder: target.folder,
          status: target.status,
        });
      }
    });

    return outlinks;
  }

  // Render markdown with wikilinks highlighted
  static renderMarkdown(text, store, currentNoteId) {
    if (!text) return '';

    // Replace [[links]] with HTML spans
    let processed = text.replace(/\[\[([^\]]+)\]\]/g, (match, title) => {
      const target = store.getByTitle(title.trim());
      const cls = target ? 'wikilink' : 'wikilink broken';
      const id = target ? target.id : '';
      return `<span class="${cls}" data-note-id="${id}" data-note-title="${escapeHTML(title.trim())}" title="点击跳转到: ${escapeHTML(title.trim())}">📎 ${escapeHTML(title.trim())}</span>`;
    });

    // Render markdown
    if (typeof marked !== 'undefined') {
      marked.setOptions({
        breaks: true,
        gfm: true,
      });
      return marked.parse(processed);
    }

    return processed.replace(/\n/g, '<br>');
  }
}

// ========================
//  AI ENGINE (Rule-based Demo)
// ========================
class AIEngine {
  // Tag suggestion rules
  static TAG_RULES = [
    { keywords: ['javascript', 'js', 'typescript', 'ts', 'node', 'react', 'vue', 'angular', '前端', 'frontend'], tag: '前端开发' },
    { keywords: ['python', 'django', 'flask', 'fastapi', '后端', 'backend', 'api'], tag: '后端开发' },
    { keywords: ['ai', '机器学习', '深度学习', 'ml', 'deep learning', 'gpt', 'llm', '大模型', 'agent', '智能体'], tag: '人工智能' },
    { keywords: ['docker', 'kubernetes', 'k8s', 'ci/cd', '部署', 'deploy', 'devops', '运维'], tag: 'DevOps' },
    { keywords: ['数据库', 'database', 'sql', 'mysql', 'postgres', 'mongodb', 'redis'], tag: '数据库' },
    { keywords: ['设计', 'design', 'ui', 'ux', 'css', '样式', 'figma'], tag: '设计' },
    { keywords: ['产品', 'product', '需求', 'prd', '用户', 'user', '体验'], tag: '产品' },
    { keywords: ['笔记', 'note', '日记', 'diary', '想法', '思考', '随笔'], tag: '随笔' },
    { keywords: ['读书', '阅读', 'book', '书籍', '读后感', '书评'], tag: '阅读' },
    { keywords: ['项目', 'project', '管理', 'management', '进度', '规划', '计划', 'todo'], tag: '项目管理' },
    { keywords: ['学习', 'learn', '教程', 'tutorial', '课程', 'course', '入门'], tag: '学习笔记' },
    { keywords: ['会议', 'meeting', '周报', '日报', '复盘', '总结'], tag: '会议记录' },
    { keywords: ['架构', 'architecture', '系统', 'system', '微服务', 'microservice'], tag: '系统架构' },
    { keywords: ['安全', 'security', '加密', 'encrypt', 'auth', '认证', '漏洞'], tag: '安全' },
    { keywords: ['测试', 'test', 'testing', '单元测试', 'e2e', '集成测试'], tag: '测试' },
  ];

  static suggestTags(title, content) {
    const text = `${title} ${content}`.toLowerCase();
    const suggestions = [];

    this.TAG_RULES.forEach(rule => {
      const matchCount = rule.keywords.filter(kw => text.includes(kw.toLowerCase())).length;
      if (matchCount >= 2) {
        suggestions.push({ tag: rule.tag, confidence: Math.min(0.9, 0.5 + matchCount * 0.15) });
      } else if (matchCount === 1 && text.length > 50) {
        suggestions.push({ tag: rule.tag, confidence: 0.5 });
      }
    });

    // Deduplicate and sort by confidence
    const seen = new Set();
    return suggestions
      .filter(s => {
        if (seen.has(s.tag)) return false;
        seen.add(s.tag);
        return true;
      })
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5);
  }

  static suggestRelated(store, noteId) {
    const note = store.getById(noteId);
    if (!note) return [];

    const noteText = `${note.title} ${note.content} ${note.tags.join(' ')}`.toLowerCase();
    const words = new Set(noteText.split(/\s+/).filter(w => w.length > 2));

    const scored = store.notes
      .filter(n => n.id !== noteId)
      .map(n => {
        const nText = `${n.title} ${n.content} ${n.tags.join(' ')}`.toLowerCase();
        let score = 0;
        words.forEach(w => {
          if (nText.includes(w)) score += 1;
        });
        // Bonus for shared tags
        note.tags.forEach(t => {
          if (n.tags.includes(t)) score += 5;
        });
        // Bonus for same folder
        if (n.folder === note.folder) score += 3;
        return { note: n, score };
      })
      .filter(r => r.score > 2)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(r => r.note);

    return scored;
  }

  static suggestArchive(store, noteId) {
    const note = store.getById(noteId);
    if (!note || note.status !== 'published') return null;

    const daysSinceUpdate = (Date.now() - note.updatedAt) / (1000 * 60 * 60 * 24);
    if (daysSinceUpdate > 90) {
      return { reason: '超过90天未更新', action: '建议归档或删除' };
    }
    if (daysSinceUpdate > 60) {
      return { reason: '超过60天未更新', action: '可以考虑整理或回顾' };
    }
    return null;
  }
}

// ========================
//  KNOWLEDGE GRAPH (Canvas)
// ========================
class KnowledgeGraph {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.nodes = [];
    this.edges = [];
    this.width = 0;
    this.height = 0;
    this.animationId = null;
    this.dragging = null;
    this.offsetX = 0;
    this.offsetY = 0;
    this.scale = 1;
  }

  build(store) {
    const published = store.notes.filter(n => n.status === 'published');
    const drafts = store.notes.filter(n => n.status === 'draft');

    const allNotes = [...published, ...drafts];
    if (allNotes.length === 0) return;

    // Layout nodes in a circle
    const cx = this.width / 2;
    const cy = this.height / 2;
    const radius = Math.min(cx, cy) * 0.7;

    this.nodes = allNotes.map((note, i) => {
      const angle = (i / allNotes.length) * Math.PI * 2 - Math.PI / 2;
      return {
        id: note.id,
        title: note.title,
        status: note.status,
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
        radius: note.status === 'published' ? 30 : 22,
      };
    });

    // Build edges from wikilinks
    this.edges = [];
    this.nodes.forEach(node => {
      const outlinks = WikilinksEngine.getOutlinks(store, node.id);
      outlinks.forEach(link => {
        const targetNode = this.nodes.find(n => n.id === link.id);
        if (targetNode) {
          const edgeKey = [node.id, targetNode.id].sort().join('-');
          if (!this.edges.find(e => e.key === edgeKey)) {
            this.edges.push({
              key: edgeKey,
              from: node.id,
              to: targetNode.id,
              fromTitle: node.title,
              toTitle: targetNode.title,
            });
          }
        }
      });
    });

    this.simulate();
    this.startAnimation();
  }

  simulate() {
    // Simple force-directed simulation (a few iterations)
    const iterations = 50;
    for (let iter = 0; iter < iterations; iter++) {
      // Repulsion between all nodes
      for (let i = 0; i < this.nodes.length; i++) {
        for (let j = i + 1; j < this.nodes.length; j++) {
          const a = this.nodes[i];
          const b = this.nodes[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
          const force = 200 / (dist * dist);
          const fx = dx / dist * force;
          const fy = dy / dist * force;
          a.vx -= fx;
          a.vy -= fy;
          b.vx += fx;
          b.vy += fy;
        }
      }

      // Attraction along edges
      this.edges.forEach(edge => {
        const a = this.nodes.find(n => n.id === edge.from);
        const b = this.nodes.find(n => n.id === edge.to);
        if (!a || !b) return;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const force = (dist - 80) * 0.005;
        const fx = dx / dist * force;
        const fy = dy / dist * force;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      });

      // Center gravity
      this.nodes.forEach(node => {
        const dx = this.width / 2 - node.x;
        const dy = this.height / 2 - node.y;
        node.vx += dx * 0.001;
        node.vy += dy * 0.001;
      });

      // Apply velocity
      this.nodes.forEach(node => {
        node.x += node.vx * 0.5;
        node.y += node.vy * 0.5;
        node.vx *= 0.9;
        node.vy *= 0.9;

        // Boundary
        node.x = Math.max(60, Math.min(this.width - 60, node.x));
        node.y = Math.max(60, Math.min(this.height - 60, node.y));
      });
    }
  }

  startAnimation() {
    if (this.animationId) cancelAnimationFrame(this.animationId);
    this.draw();
  }

  draw() {
    const { ctx, canvas, nodes, edges } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Get theme colors
    const isDark = document.getElementById('app').dataset.theme === 'dark';
    const bgColor = isDark ? '#0f1017' : '#f8f9fc';
    const textColor = isDark ? '#e4e7f0' : '#1a1d2e';
    const edgeColor = isDark ? '#3d3e5c' : '#d4d6e0';
    const accentColor = isDark ? '#818cf8' : '#6366f1';
    const draftColor = '#f59e0b';

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw edges
    edges.forEach(edge => {
      const from = nodes.find(n => n.id === edge.from);
      const to = nodes.find(n => n.id === edge.to);
      if (!from || !to) return;

      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.strokeStyle = edgeColor;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    });

    // Draw nodes
    nodes.forEach(node => {
      const isPublished = node.status === 'published';
      const color = isPublished ? accentColor : draftColor;

      // Shadow
      ctx.shadowColor = 'rgba(0,0,0,0.15)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 2;

      // Circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      ctx.shadowColor = 'transparent';

      // Border
      ctx.strokeStyle = isDark ? '#222438' : '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Label
      const label = node.title.length > 8 ? node.title.slice(0, 8) + '…' : node.title;
      ctx.fillStyle = textColor;
      ctx.font = '11px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, node.x, node.y + node.radius + 16);
    });

    this.animationId = requestAnimationFrame(() => this.draw());
  }

  stopAnimation() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  resize() {
    const container = this.canvas.parentElement;
    this.width = container.clientWidth;
    this.height = container.clientHeight;
    this.canvas.width = this.width * window.devicePixelRatio;
    this.canvas.height = this.height * window.devicePixelRatio;
    this.canvas.style.width = this.width + 'px';
    this.canvas.style.height = this.height + 'px';
    this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  }

  getNodeAt(x, y) {
    return this.nodes.find(n => {
      const dx = n.x - x;
      const dy = n.y - y;
      return Math.sqrt(dx * dx + dy * dy) < n.radius + 5;
    });
  }
}

// ========================
//  MAIN APPLICATION
// ========================
class App {
  constructor() {
    this.store = new NotesStore();
    this.currentNoteId = null;
    this.currentView = 'edit'; // edit | split | preview
    this.statusFilter = 'all';
    this.graph = null;
    this.autosaveTimer = null;
    this.isDirty = false;

    this.init();
  }

  init() {
    this.bindElements();
    this.bindEvents();
    this.loadTheme();
    this.renderFileTree();
    this.updateStats();
    this.showEmptyState();
  }

  // ----- Element Bindings -----
  bindElements() {
    this.el = {
      app: document.getElementById('app'),
      sidebar: document.getElementById('sidebar'),
      sidebarToggle: document.getElementById('sidebar-toggle'),
      fileTree: document.getElementById('file-tree'),
      statusFilter: document.getElementById('status-filter'),
      searchInput: document.getElementById('search-input'),
      searchClear: document.getElementById('search-clear'),
      noteCount: document.getElementById('note-count'),
      themeToggle: document.getElementById('theme-toggle'),
      btnGraph: document.getElementById('btn-graph'),
      btnNewNote: document.getElementById('btn-new-note'),
      btnNewFolder: document.getElementById('btn-new-folder'),
      emptyState: document.getElementById('empty-state'),
      editorView: document.getElementById('editor-view'),
      noteTitle: document.getElementById('note-title'),
      noteFolderBreadcrumb: document.getElementById('note-folder-breadcrumb'),
      noteStatusBadge: document.getElementById('note-status-badge'),
      editorTextarea: document.getElementById('editor-textarea'),
      previewContent: document.getElementById('preview-content'),
      editorBody: document.getElementById('editor-body'),
      editorPane: document.getElementById('editor-pane'),
      previewPane: document.getElementById('preview-pane'),
      btnSave: document.getElementById('btn-save'),
      btnPromote: document.getElementById('btn-promote'),
      btnDemote: document.getElementById('btn-demote'),
      btnMore: document.getElementById('btn-more'),
      wordCount: document.getElementById('word-count'),
      lastSaved: document.getElementById('last-saved'),
      tagsList: document.getElementById('tags-list'),
      aiTagsSuggestion: document.getElementById('ai-tags-suggestion'),
      suggestedTags: document.getElementById('suggested-tags'),
      backlinksList: document.getElementById('backlinks-list'),
      relatedNotes: document.getElementById('related-notes'),
      noteMeta: document.getElementById('note-meta'),
      btnAddTag: document.getElementById('btn-add-tag'),
      graphModal: document.getElementById('graph-modal'),
      graphCanvas: document.getElementById('graph-canvas'),
      graphStats: document.getElementById('graph-stats'),
      btnGraphClose: document.getElementById('btn-graph-close'),
      dialogOverlay: document.getElementById('dialog-overlay'),
      dialogTitle: document.getElementById('dialog-title'),
      dialogInputName: document.getElementById('dialog-input-name'),
      dialogSelectFolder: document.getElementById('dialog-select-folder'),
      dialogFolderGroup: document.getElementById('dialog-folder-group'),
      dialogTypeGroup: document.getElementById('dialog-type-group'),
      dialogConfirm: document.getElementById('dialog-confirm'),
      emptyNewNote: document.getElementById('empty-new-note'),
      emptyImport: document.getElementById('empty-import'),
      importFileInput: document.getElementById('import-file-input'),
      storageUsed: document.getElementById('storage-used'),
    };
  }

  // ----- Event Bindings -----
  bindEvents() {
    // Theme
    this.el.themeToggle.addEventListener('click', () => this.toggleTheme());

    // Sidebar
    this.el.sidebarToggle.addEventListener('click', () => this.toggleSidebar());
    this.el.statusFilter.addEventListener('change', (e) => {
      this.statusFilter = e.target.value;
      this.renderFileTree();
    });
    this.el.btnNewNote.addEventListener('click', () => this.showNewItemDialog('note'));
    this.el.btnNewFolder.addEventListener('click', () => this.showNewItemDialog('folder'));

    // Search
    this.el.searchInput.addEventListener('input', (e) => {
      this.el.searchClear.style.display = e.target.value ? 'block' : 'none';
      this.handleSearch(e.target.value);
    });
    this.el.searchClear.addEventListener('click', () => {
      this.el.searchInput.value = '';
      this.el.searchClear.style.display = 'none';
      this.renderFileTree();
    });

    // Editor
    this.el.noteTitle.addEventListener('input', () => this.markDirty());
    this.el.editorTextarea.addEventListener('input', () => this.markDirty());
    this.el.btnSave.addEventListener('click', () => this.saveCurrentNote());

    // View toggle
    document.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', (e) => this.setView(e.target.dataset.view));
    });

    // Draft workflow
    this.el.btnPromote.addEventListener('click', () => this.promoteNote());
    this.el.btnDemote.addEventListener('click', () => this.demoteNote());

    // More actions
    this.el.btnMore.addEventListener('click', () => this.showNoteActions());

    // Tags
    this.el.btnAddTag.addEventListener('click', () => this.addTag());
    this.el.tagsList.addEventListener('click', (e) => {
      if (e.target.classList.contains('tag-remove')) {
        const tag = e.target.dataset.tag;
        this.removeTag(tag);
      }
    });
    this.el.suggestedTags.addEventListener('click', (e) => {
      if (e.target.classList.contains('suggested-tag')) {
        this.addSuggestedTag(e.target.textContent.trim());
      }
    });

    // Graph
    this.el.btnGraph.addEventListener('click', () => this.openGraph());
    this.el.btnGraphClose.addEventListener('click', () => this.closeGraph());
    this.el.graphModal.querySelector('.modal-overlay').addEventListener('click', () => this.closeGraph());

    // Dialog
    this.el.dialogOverlay.addEventListener('click', (e) => {
      if (e.target === this.el.dialogOverlay) this.closeDialog();
    });
    document.querySelectorAll('.dialog-close, .dialog-cancel').forEach(btn => {
      btn.addEventListener('click', () => this.closeDialog());
    });
    this.el.dialogConfirm.addEventListener('click', () => this.confirmDialog());

    // Empty state
    this.el.emptyNewNote.addEventListener('click', () => this.showNewItemDialog('note'));
    this.el.emptyImport.addEventListener('click', () => this.el.importFileInput.click());
    this.el.importFileInput.addEventListener('change', (e) => this.handleImport(e));

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        this.saveCurrentNote();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        this.showNewItemDialog('note');
      }
      if (e.key === 'Escape') {
        if (this.el.graphModal.style.display !== 'none') this.closeGraph();
        if (this.el.dialogOverlay.style.display !== 'none') this.closeDialog();
      }
    });

    // Resize
    window.addEventListener('resize', () => {
      if (this.graph) this.graph.resize();
    });

    // Preview wikilink clicks
    this.el.previewContent.addEventListener('click', (e) => {
      const link = e.target.closest('.wikilink');
      if (!link) return;
      const noteId = link.dataset.noteId;
      if (noteId) {
        this.openNote(noteId);
      } else {
        // Broken link - offer to create
        const title = link.dataset.noteTitle;
        if (confirm(`笔记 "${title}" 不存在。要创建它吗？`)) {
          const note = this.store.create(title, '', '', 'draft');
          this.openNote(note.id);
          this.showEmptyState(false);
          showToast(`已创建笔记: ${title}`, 'success');
        }
      }
    });

    // Graph modal resize
    const graphResizeObserver = new ResizeObserver(() => {
      if (this.graph && this.el.graphModal.style.display !== 'none') {
        this.graph.resize();
        this.graph.build(this.store);
      }
    });
    if (this.el.graphCanvas.parentElement) {
      graphResizeObserver.observe(this.el.graphCanvas.parentElement);
    }
  }

  // ----- Theme -----
  loadTheme() {
    const saved = localStorage.getItem(CONFIG.THEME_KEY) || 'light';
    this.el.app.dataset.theme = saved;
    this.updateThemeIcon(saved);
  }

  toggleTheme() {
    const current = this.el.app.dataset.theme;
    const next = current === 'light' ? 'dark' : 'light';
    this.el.app.dataset.theme = next;
    localStorage.setItem(CONFIG.THEME_KEY, next);
    this.updateThemeIcon(next);
    showToast(`已切换到${next === 'dark' ? '深色' : '浅色'}主题`, 'info');
  }

  updateThemeIcon(theme) {
    this.el.themeToggle.textContent = theme === 'dark' ? '☀️' : '🌙';
    this.el.themeToggle.title = theme === 'dark' ? '切换浅色主题' : '切换深色主题';
  }

  // ----- Sidebar -----
  toggleSidebar() {
    this.el.sidebar.classList.toggle('open');
  }

  // ----- File Tree -----
  renderFileTree(filteredNotes = null) {
    const container = this.el.fileTree;
    container.innerHTML = '';

    const notes = filteredNotes || this.store.getFiltered(this.statusFilter);

    if (notes.length === 0 && this.store.notes.length === 0) {
      container.innerHTML = `
        <div class="tree-empty">
          <p>📂 还没有笔记</p>
          <p style="font-size:0.75rem;margin-top:4px;">点击 📝 创建第一篇笔记</p>
        </div>`;
      return;
    }

    if (notes.length === 0) {
      container.innerHTML = `<div class="tree-empty">没有符合条件的笔记</div>`;
      return;
    }

    const tree = this.store.getFolderTree();

    // Sort: folders first, then notes
    const sortedFolders = Object.entries(tree.folders).sort(([a], [b]) => a.localeCompare(b));

    // Root notes (no folder) - filter by status
    const rootNotes = tree.notes.filter(n => {
      if (this.statusFilter === 'draft') return n.status === 'draft';
      if (this.statusFilter === 'published') return n.status === 'published';
      return true;
    });

    const renderNode = (name, children, notes, depth = 0) => {
      const folderDiv = document.createElement('div');
      folderDiv.className = 'tree-folder';
      folderDiv.style.paddingLeft = `${10 + depth * 16}px`;
      folderDiv.innerHTML = `
        <span class="tree-icon">📁</span>
        <span class="tree-name">${escapeHTML(name)}</span>
        <div class="tree-actions">
          <button class="icon-btn" data-action="rename-folder" data-path="${escapeHTML(name)}" title="重命名">✏️</button>
          <button class="icon-btn" data-action="delete-folder" data-path="${escapeHTML(name)}" title="删除">🗑️</button>
        </div>`;
      folderDiv.addEventListener('click', (e) => {
        if (e.target.closest('.tree-actions')) return;
        const childContainer = folderDiv.querySelector('.folder-children');
        if (childContainer) {
          childContainer.style.display = childContainer.style.display === 'none' ? 'block' : 'none';
        }
      });
      container.appendChild(folderDiv);

      const childContainer = document.createElement('div');
      childContainer.className = 'folder-children';
      folderDiv.appendChild(childContainer);

      // Render sub-folders
      Object.entries(children || {}).sort(([a], [b]) => a.localeCompare(b)).forEach(([childName, childData]) => {
        const childDiv = document.createElement('div');
        renderFolderRecursive(childDiv, childName, childData, depth + 1);
        childContainer.appendChild(childDiv);
      });

      // Render notes
      notes.forEach(note => this.renderNoteItem(note, childContainer, depth + 1));
    };

    const renderFolderRecursive = (parentEl, name, data, depth) => {
      const folderDiv = document.createElement('div');
      folderDiv.className = 'tree-folder';
      folderDiv.style.paddingLeft = `${10 + depth * 16}px`;
      folderDiv.innerHTML = `
        <span class="tree-icon">📁</span>
        <span class="tree-name">${escapeHTML(name)}</span>
        <div class="tree-actions">
          <button class="icon-btn" data-action="rename-folder" data-path="${escapeHTML(name)}" title="重命名">✏️</button>
          <button class="icon-btn" data-action="delete-folder" data-path="${escapeHTML(name)}" title="删除">🗑️</button>
        </div>`;
      folderDiv.addEventListener('click', (e) => {
        if (e.target.closest('.tree-actions')) return;
        const cc = folderDiv.querySelector('.folder-children');
        if (cc) cc.style.display = cc.style.display === 'none' ? 'block' : 'none';
      });

      const childContainer = document.createElement('div');
      childContainer.className = 'folder-children';
      folderDiv.appendChild(childContainer);

      Object.entries(data.folders || {}).sort(([a], [b]) => a.localeCompare(b)).forEach(([cn, cd]) => {
        const cdDiv = document.createElement('div');
        renderFolderRecursive(cdDiv, cn, cd, depth + 1);
        childContainer.appendChild(cdDiv);
      });

      data.notes.forEach(n => this.renderNoteItem(n, childContainer, depth + 1));

      parentEl.appendChild(folderDiv);
    };

    // Render root notes
    rootNotes.sort((a, b) => b.updatedAt - a.updatedAt).forEach(note => {
      this.renderNoteItem(note, container, 0);
    });

    // Render folders (recursive)
    sortedFolders.forEach(([name, data]) => {
      renderNode(name, data.folders, data.notes, 0);
    });

    // Delegate actions
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      e.stopPropagation();
      const action = btn.dataset.action;
      const path = btn.dataset.path || '';
      const noteId = btn.dataset.noteId || '';

      if (action === 'delete-note') {
        if (confirm('确定删除此笔记？此操作不可撤销。')) {
          this.deleteNote(noteId);
        }
      }
      if (action === 'rename-folder') {
        const newName = prompt('新文件夹名:', path);
        if (newName && newName !== path) {
          this.renameFolder(path, newName);
        }
      }
      if (action === 'delete-folder') {
        const notesInFolder = this.store.getByFolder(path);
        if (notesInFolder.length > 0) {
          if (!confirm(`文件夹 "${path}" 中有 ${notesInFolder.length} 个笔记。删除文件夹会同时删除这些笔记。确定继续？`)) return;
        }
        this.deleteFolder(path);
      }
    });
  }

  renderNoteItem(note, container, depth) {
    const div = document.createElement('div');
    div.className = 'tree-note' + (note.status === 'draft' ? ' draft-note' : '');
    if (note.id === this.currentNoteId) div.classList.add('active');
    div.style.paddingLeft = `${10 + depth * 16}px`;

    const icon = note.status === 'draft' ? '📝' : '📄';
    const statusLabel = note.status === 'draft' ? '草稿' : '';

    div.innerHTML = `
      <span class="tree-icon">${icon}</span>
      <span class="tree-name">${escapeHTML(note.title)}</span>
      <span class="tree-status">${statusLabel}</span>
      <div class="tree-actions">
        <button class="icon-btn" data-action="delete-note" data-note-id="${note.id}" title="删除">🗑️</button>
      </div>`;
    div.addEventListener('click', (e) => {
      if (e.target.closest('.tree-actions')) return;
      this.openNote(note.id);
    });
    container.appendChild(div);
  }

  // ----- Note CRUD -----
  openNote(id) {
    const note = this.store.getById(id);
    if (!note) return;

    // Save current before switching
    if (this.currentNoteId && this.currentNoteId !== id && this.isDirty) {
      this.saveCurrentNote(true);
    }

    this.currentNoteId = id;
    this.isDirty = false;

    this.showEmptyState(false);
    this.el.editorView.style.display = 'flex';
    this.el.noteTitle.value = note.title;
    this.el.editorTextarea.value = note.content;
    this.el.noteFolderBreadcrumb.textContent = note.folder || '根目录';

    // Status badge
    this.el.noteStatusBadge.textContent = note.status === 'draft' ? '草稿' : '已发布';
    this.el.noteStatusBadge.className = `status-badge ${note.status}`;

    // Promote/demote buttons
    this.el.btnPromote.style.display = note.status === 'draft' ? 'inline-flex' : 'none';
    this.el.btnDemote.style.display = note.status === 'published' ? 'inline-flex' : 'none';

    // Set view
    this.setView(this.currentView);

    // Update panels
    this.updateTagsPanel(note);
    this.updateBacklinksPanel(note);
    this.updateRelatedPanel(note);
    this.updateMetaPanel(note);
    this.updateAI(note);
    this.updatePreview();
    this.updateWordCount();

    // Render file tree to highlight active
    this.renderFileTree();

    this.el.lastSaved.textContent = `已保存 ${this.formatTime(note.updatedAt)}`;
  }

  saveCurrentNote(silent = false) {
    if (!this.currentNoteId) return;

    const title = this.el.noteTitle.value.trim() || '未命名笔记';
    const content = this.el.editorTextarea.value;

    this.store.update(this.currentNoteId, { title, content });
    this.isDirty = false;

    if (!silent) showToast('笔记已保存', 'success');

    this.el.lastSaved.textContent = `已保存 ${this.formatTime(Date.now())}`;
    this.updateWordCount();
    this.updatePreview();
    this.renderFileTree();
    this.updateStats();

    // Re-update panels
    const note = this.store.getById(this.currentNoteId);
    if (note) {
      this.updateTagsPanel(note);
      this.updateBacklinksPanel(note);
      this.updateRelatedPanel(note);
      this.updateAI(note);
    }
  }

  deleteNote(id) {
    const note = this.store.getById(id);
    this.store.delete(id);
    showToast(`已删除: ${note?.title || id}`, 'warning');

    if (this.currentNoteId === id) {
      this.currentNoteId = null;
      this.showEmptyState(true);
      this.el.editorView.style.display = 'none';
      this.clearRightPanel();
    }

    this.renderFileTree();
    this.updateStats();
  }

  markDirty() {
    if (!this.currentNoteId) return;
    this.isDirty = true;
    this.el.lastSaved.textContent = '未保存';

    // Autosave
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => {
      if (this.isDirty) this.saveCurrentNote(true);
    }, CONFIG.AUTOSAVE_DELAY);
  }

  // ----- Draft Workflow -----
  promoteNote() {
    if (!this.currentNoteId) return;
    this.store.update(this.currentNoteId, { status: 'published' });
    this.openNote(this.currentNoteId);
    showToast('笔记已提升为正式笔记 🎉', 'success');
  }

  demoteNote() {
    if (!this.currentNoteId) return;
    this.store.update(this.currentNoteId, { status: 'draft' });
    this.openNote(this.currentNoteId);
    showToast('笔记已降为草稿', 'warning');
  }

  // ----- View Toggle -----
  setView(view) {
    this.currentView = view;

    document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.view-btn[data-view="${view}"]`)?.classList.add('active');

    const body = this.el.editorBody;
    body.classList.remove('split', 'preview');

    if (view === 'split') {
      body.classList.add('split');
      this.el.previewPane.style.display = 'flex';
    } else if (view === 'preview') {
      body.classList.add('preview');
      this.el.previewPane.style.display = 'flex';
    } else {
      this.el.previewPane.style.display = 'none';
    }

    this.updatePreview();
  }

  updatePreview() {
    if (!this.currentNoteId) return;
    const note = this.store.getById(this.currentNoteId);
    if (!note) return;

    const html = WikilinksEngine.renderMarkdown(this.el.editorTextarea.value, this.store, note.id);
    this.el.previewContent.innerHTML = html;
  }

  // ----- Tags -----
  updateTagsPanel(note) {
    const container = this.el.tagsList;
    if (!note.tags || note.tags.length === 0) {
      container.innerHTML = '<span class="tag-placeholder">暂无标签</span>';
    } else {
      container.innerHTML = note.tags.map(t =>
        `<span class="tag">${escapeHTML(t)}<span class="tag-remove" data-tag="${escapeHTML(t)}">×</span></span>`
      ).join('');
    }
  }

  addTag() {
    if (!this.currentNoteId) return;
    const tag = prompt('输入新标签:');
    if (!tag || !tag.trim()) return;

    const note = this.store.getById(this.currentNoteId);
    if (!note) return;

    const trimmed = tag.trim();
    if (note.tags.includes(trimmed)) {
      showToast('标签已存在', 'warning');
      return;
    }

    note.tags.push(trimmed);
    this.store.update(this.currentNoteId, { tags: note.tags });
    this.updateTagsPanel(note);
    this.updateAI(note);
    this.updateRelatedPanel(note);
    showToast(`已添加标签: ${trimmed}`, 'success');
  }

  removeTag(tag) {
    if (!this.currentNoteId) return;
    const note = this.store.getById(this.currentNoteId);
    if (!note) return;

    note.tags = note.tags.filter(t => t !== tag);
    this.store.update(this.currentNoteId, { tags: note.tags });
    this.updateTagsPanel(note);
    this.updateAI(note);
    showToast(`已移除标签: ${tag}`, 'info');
  }

  addSuggestedTag(tag) {
    if (!this.currentNoteId) return;
    const note = this.store.getById(this.currentNoteId);
    if (!note) return;

    if (note.tags.includes(tag)) {
      showToast('标签已存在', 'warning');
      return;
    }

    note.tags.push(tag);
    this.store.update(this.currentNoteId, { tags: note.tags });
    this.updateTagsPanel(note);
    this.updateAI(note);
    showToast(`已添加标签: ${tag} 🤖`, 'success');
  }

  // ----- AI Suggestions -----
  updateAI(note) {
    if (!note) return;

    // Tag suggestions
    const suggestions = AIEngine.suggestTags(note.title, note.content);
    const existingTags = new Set(note.tags);

    const newSuggestions = suggestions.filter(s => !existingTags.has(s.tag));

    if (newSuggestions.length > 0) {
      this.el.aiTagsSuggestion.style.display = 'block';
      this.el.suggestedTags.innerHTML = newSuggestions.map(s =>
        `<span class="suggested-tag" title="置信度: ${Math.round(s.confidence * 100)}%">${escapeHTML(s.tag)}</span>`
      ).join('');
    } else {
      this.el.aiTagsSuggestion.style.display = 'none';
    }

    // Archive suggestion
    const archiveSuggestion = AIEngine.suggestArchive(this.store, note.id);
    if (archiveSuggestion) {
      const existing = this.el.aiTagsSuggestion.querySelector('.archive-hint');
      if (!existing) {
        const hint = document.createElement('div');
        hint.className = 'archive-hint';
        hint.style.cssText = 'margin-top:8px;font-size:0.7rem;color:var(--warning);';
        hint.innerHTML = `⚠️ ${archiveSuggestion.reason}: ${archiveSuggestion.action}`;
        this.el.aiTagsSuggestion.appendChild(hint);
      }
    }
  }

  updateBacklinksPanel(note) {
    if (!note) return;
    const backlinks = WikilinksEngine.getBacklinks(this.store, note.id);

    if (backlinks.length === 0) {
      this.el.backlinksList.innerHTML = '<span class="placeholder-text">暂无反向链接</span>';
      return;
    }

    this.el.backlinksList.innerHTML = backlinks.map(bl => `
      <div class="backlink-item" data-note-id="${bl.id}">
        <span>${bl.status === 'draft' ? '📝' : '📄'}</span>
        <span>${escapeHTML(bl.title)}</span>
        ${bl.folder ? `<span style="font-size:0.7rem;color:var(--text-muted)">${escapeHTML(bl.folder)}</span>` : ''}
      </div>
    `).join('');

    this.el.backlinksList.querySelectorAll('.backlink-item').forEach(item => {
      item.addEventListener('click', () => this.openNote(item.dataset.noteId));
    });
  }

  updateRelatedPanel(note) {
    if (!note) return;
    const related = AIEngine.suggestRelated(this.store, note.id);

    if (related.length === 0) {
      this.el.relatedNotes.innerHTML = '<span class="placeholder-text">暂无关联建议</span>';
      return;
    }

    this.el.relatedNotes.innerHTML = related.map(r => `
      <div class="related-item" data-note-id="${r.id}">
        <span>${r.status === 'draft' ? '📝' : '📄'}</span>
        <span>${escapeHTML(r.title)}</span>
        <span style="font-size:0.7rem;margin-left:auto;color:var(--text-muted);">${(r.tags || []).slice(0, 2).join(', ')}</span>
      </div>
    `).join('');

    this.el.relatedNotes.querySelectorAll('.related-item').forEach(item => {
      item.addEventListener('click', () => this.openNote(item.dataset.noteId));
    });
  }

  updateMetaPanel(note) {
    if (!note) {
      this.el.noteMeta.innerHTML = '<span class="placeholder-text">选择笔记查看信息</span>';
      return;
    }

    const outlinks = WikilinksEngine.getOutlinks(this.store, note.id);
    const backlinks = WikilinksEngine.getBacklinks(this.store, note.id);

    this.el.noteMeta.innerHTML = `
      <div><strong>📅 创建:</strong> ${this.formatTime(note.createdAt)}</div>
      <div><strong>🔄 更新:</strong> ${this.formatTime(note.updatedAt)}</div>
      <div><strong>📊 状态:</strong> ${note.status === 'draft' ? '草稿' : '已发布'}</div>
      <div><strong>🔗 外链:</strong> ${outlinks.length} 条</div>
      <div><strong>🔙 反链:</strong> ${backlinks.length} 条</div>
      <div><strong>🏷️ 标签:</strong> ${note.tags.length || 0} 个</div>
      <div><strong>📝 字数:</strong> ${note.content.length} 字</div>
      ${note.folder ? `<div><strong>📁 路径:</strong> ${escapeHTML(note.folder)}</div>` : ''}
    `;
  }

  clearRightPanel() {
    this.el.tagsList.innerHTML = '<span class="tag-placeholder">暂无标签</span>';
    this.el.aiTagsSuggestion.style.display = 'none';
    this.el.backlinksList.innerHTML = '<span class="placeholder-text">暂无反向链接</span>';
    this.el.relatedNotes.innerHTML = '<span class="placeholder-text">暂无关联建议</span>';
    this.el.noteMeta.innerHTML = '<span class="placeholder-text">选择笔记查看信息</span>';
  }

  // ----- Knowledge Graph -----
  openGraph() {
    if (this.store.notes.length === 0) {
      showToast('还没有笔记，请先创建笔记', 'warning');
      return;
    }

    this.el.graphModal.style.display = 'flex';

    requestAnimationFrame(() => {
      this.graph = new KnowledgeGraph(this.el.graphCanvas);
      this.graph.resize();
      this.graph.build(this.store);

      const stats = this.store.getStats();
      this.el.graphStats.textContent = `${stats.published} 已发布 · ${stats.drafts} 草稿 · ${this.graph.edges.length} 链接`;

      // Click handler for graph nodes
      this.el.graphCanvas.addEventListener('click', (e) => {
        if (!this.graph) return;
        const rect = this.el.graphCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const node = this.graph.getNodeAt(x, y);
        if (node) {
          this.closeGraph();
          this.openNote(node.id);
        }
      });
    });
  }

  closeGraph() {
    this.el.graphModal.style.display = 'none';
    if (this.graph) {
      this.graph.stopAnimation();
      this.graph = null;
    }
  }

  // ----- Dialog -----
  showNewItemDialog(type = 'note') {
    this.dialogMode = type;
    this.el.dialogTitle.textContent = type === 'note' ? '📝 新建笔记' : '📂 新建文件夹';

    this.el.dialogTypeGroup.style.display = 'block';
    const radioNote = this.el.dialogTypeGroup.querySelector('input[value="note"]');
    const radioFolder = this.el.dialogTypeGroup.querySelector('input[value="folder"]');
    if (type === 'note') {
      radioNote.checked = true;
      this.el.dialogFolderGroup.style.display = 'block';
    } else {
      radioFolder.checked = true;
      this.el.dialogFolderGroup.style.display = 'none';
    }

    // Listen to radio changes
    const onRadioChange = () => {
      this.dialogMode = radioNote.checked ? 'note' : 'folder';
      this.el.dialogFolderGroup.style.display = this.dialogMode === 'note' ? 'block' : 'none';
    };
    radioNote.removeEventListener('change', onRadioChange);
    radioFolder.removeEventListener('change', onRadioChange);
    radioNote.addEventListener('change', onRadioChange);
    radioFolder.addEventListener('change', onRadioChange);

    // Populate folder select
    const folders = this.store.getFolders();
    this.el.dialogSelectFolder.innerHTML = '<option value="">根目录</option>' +
      folders.map(f => `<option value="${escapeHTML(f)}">${escapeHTML(f)}</option>`).join('');

    this.el.dialogInputName.value = '';
    this.el.dialogOverlay.style.display = 'flex';
    this.el.dialogInputName.focus();
  }

  closeDialog() {
    this.el.dialogOverlay.style.display = 'none';
  }

  confirmDialog() {
    const name = this.el.dialogInputName.value.trim();
    if (!name) {
      showToast('请输入名称', 'warning');
      return;
    }

    if (this.dialogMode === 'folder') {
      // Create a placeholder note to represent the folder
      // (Folders are virtual - they exist when notes are in them)
      const folderPath = this.el.dialogSelectFolder.value
        ? this.el.dialogSelectFolder.value + '/' + name
        : name;

      // Create an empty note in this folder to establish it
      this.store.create('📁 ' + name, folderPath, '', 'draft');
      showToast(`已创建文件夹: ${name}`, 'success');
      this.closeDialog();
      this.renderFileTree();
      this.updateStats();
      return;
    }

    // Create note
    const folder = this.el.dialogSelectFolder.value;
    const note = this.store.create(name, folder, '', 'draft');
    this.closeDialog();
    this.openNote(note.id);
    showToast(`已创建笔记: ${name}`, 'success');
  }

  showNoteActions() {
    if (!this.currentNoteId) return;
    const note = this.store.getById(this.currentNoteId);
    if (!note) return;

    const action = prompt(
      `笔记操作:\n\n1. 导出 Markdown\n2. 复制内容\n3. 删除笔记\n\n输入数字选择:`
    );

    if (action === '1') {
      this.exportNote();
    } else if (action === '2') {
      navigator.clipboard.writeText(note.content).then(() => {
        showToast('内容已复制到剪贴板', 'success');
      });
    } else if (action === '3') {
      if (confirm(`确定删除笔记 "${note.title}"？`)) {
        this.deleteNote(note.id);
      }
    }
  }

  exportNote() {
    if (!this.currentNoteId) return;
    const note = this.store.getById(this.currentNoteId);
    if (!note) return;

    const markdown = `# ${note.title}

> 状态: ${note.status === 'draft' ? '草稿' : '已发布'}
> 标签: ${note.tags.join(', ') || '无'}
> 创建: ${this.formatTime(note.createdAt)}
> 更新: ${this.formatTime(note.updatedAt)}

---

${note.content}
`;

    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${note.title.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_')}.md`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('笔记已导出', 'success');
  }

  // ----- Import -----
  handleImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target.result;
      const title = file.name.replace(/\.(md|markdown)$/, '');
      const note = this.store.create(title, '', content, 'draft');
      this.openNote(note.id);
      showToast(`已导入: ${title}`, 'success');
    };
    reader.readAsText(file);
    event.target.value = '';
  }

  // ----- Search -----
  handleSearch(query) {
    if (!query.trim()) {
      this.renderFileTree();
      return;
    }

    const results = this.store.search(query);
    this.renderFileTree(results);

    if (results.length === 0) {
      this.el.fileTree.innerHTML = `<div class="tree-empty">未找到匹配 " ${escapeHTML(query)} " 的笔记</div>`;
    }
  }

  // ----- Folder Operations -----
  renameFolder(oldPath, newName) {
    const notes = this.store.getByFolder(oldPath);
    if (notes.length === 0) return;

    // Get parent path
    const parts = oldPath.split('/');
    parts.pop();
    const parentPath = parts.join('/');
    const newPath = parentPath ? parentPath + '/' + newName : newName;

    notes.forEach(note => {
      this.store.update(note.id, { folder: newPath });
    });

    // Also update sub-folders
    this.store.notes.forEach(note => {
      if (note.folder && note.folder.startsWith(oldPath + '/')) {
        const newFolder = newPath + note.folder.slice(oldPath.length);
        this.store.update(note.id, { folder: newFolder });
      }
    });

    this.renderFileTree();
    if (this.currentNoteId) {
      this.openNote(this.currentNoteId);
    }
    showToast(`文件夹已重命名: ${oldPath} → ${newPath}`, 'success');
  }

  deleteFolder(path) {
    // Delete all notes in folder
    const toDelete = this.store.notes.filter(n =>
      n.folder === path || n.folder.startsWith(path + '/')
    );

    const deletedCurrent = toDelete.some(n => n.id === this.currentNoteId);
    toDelete.forEach(n => this.store.delete(n.id));

    if (deletedCurrent) {
      this.currentNoteId = null;
      this.showEmptyState(true);
      this.el.editorView.style.display = 'none';
      this.clearRightPanel();
    }

    this.renderFileTree();
    this.updateStats();
    showToast(`已删除文件夹: ${path}`, 'warning');
  }

  // ----- State Management -----
  showEmptyState(show = true) {
    this.el.emptyState.style.display = show ? 'flex' : 'none';
    this.el.editorView.style.display = show ? 'none' : 'flex';
  }

  updateStats() {
    const stats = this.store.getStats();
    this.el.noteCount.textContent = `${stats.total} 条笔记`;

    // Storage info
    const kb = (stats.totalSize / 1024).toFixed(1);
    this.el.storageUsed.textContent = `${kb}KB`;
  }

  updateWordCount() {
    const text = this.el.editorTextarea.value;
    const chars = text.length;
    const lines = text.split('\n').length;
    this.el.wordCount.textContent = `${chars} 字 · ${lines} 行`;
  }

  formatTime(ts) {
    if (!ts) return '未知';
    const d = new Date(ts);
    const now = new Date();
    const diff = now - d;
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (mins < 1) return '刚刚';
    if (mins < 60) return `${mins} 分钟前`;
    if (hours < 24) return `${hours} 小时前`;
    if (days < 7) return `${days} 天前`;

    const Y = d.getFullYear();
    const M = String(d.getMonth() + 1).padStart(2, '0');
    const D = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${Y}-${M}-${D} ${h}:${m}`;
  }
}

// ========================
//  BOOTSTRAP
// ========================
document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();

  // Mark init time
  console.log('📚 知库 - AI Agent 知识维基 已启动');
  console.log(`   笔记数量: ${window.app.store.notes.length}`);
  console.log('   快捷键: Ctrl+S 保存 | Ctrl+N 新建 | Esc 关闭弹窗');
});
