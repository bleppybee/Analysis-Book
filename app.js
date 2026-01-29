const STORAGE = "ecology_v3";
let db = JSON.parse(localStorage.getItem(STORAGE)) || { characters: [], dorms: [], units: [], others: [], characterFolders: [] };

// Ensure dorms, units, others, and characterFolders arrays exist (for old data)
if (!db.dorms) db.dorms = [];
if (!db.units) db.units = [];
if (!db.others) db.others = [];

// Migrate characterFolders to nested structure if needed
if (!db.characterFolders || db.characterFolders.length === 0 || typeof db.characterFolders[0] === 'string') {
  // Old flat structure - convert to nested
  const oldFolders = db.characterFolders || ["Unsorted"];
  db.characterFolders = oldFolders.map(name => ({
    name: name,
    children: []
  }));
}

// Ensure Unsorted folder exists
if (!db.characterFolders.some(f => f.name === "Unsorted")) {
  db.characterFolders.unshift({ name: "Unsorted", children: [] });
}

// Migrate existing characters to have folder and order properties
db.characters.forEach((char, idx) => {
  if (char.folder === undefined) char.folder = "Unsorted";
  if (char.order === undefined) char.order = idx;
});

let activeChar = null;
let currentDormId = null;
let pastedImages = [];
let draggedNoteId = null;
let draggedFolderName = null;
let editingNoteId = null;
let selectedRelationships = [];
const REACTIONS = ["😂", "💀", "✨", "🔥", "👀"];

let hasUnsavedChanges = false;
let lastSaved = localStorage.getItem('lastSaved') || null;

const save = () => {
  localStorage.setItem(STORAGE, JSON.stringify(db));
  hasUnsavedChanges = false;
  lastSaved = new Date().toISOString();
  localStorage.setItem('lastSaved', lastSaved);
  updateLastSavedDisplay();
  // UX feature: Unsaved/Saved indicator
  if (uxInitialized && !uxSuspendSaveBadge) {
    uxScheduleSaveBadgeUpdate();
  }
};
const uid = () => Math.random().toString(36).slice(2);

// UX feature: Unsaved/Saved indicator
let uxLastSavedHash = null;
let uxSaveBadgeTimer = null;
let uxInitialized = false;
let uxSuspendSaveBadge = false;
const uxStableStringify = (value) => {
  try {
    const seen = new WeakSet();
    const normalize = (val) => {
      if (val && typeof val === "object") {
        if (seen.has(val)) return null;
        seen.add(val);
        if (Array.isArray(val)) return val.map(normalize);
        const sorted = {};
        Object.keys(val).sort().forEach(key => {
          sorted[key] = normalize(val[key]);
        });
        return sorted;
      }
      return val;
    };
    return JSON.stringify(normalize(value));
  } catch (err) {
    return JSON.stringify(value);
  }
};
const uxSnapshot = () => uxStableStringify(db);
const uxUpdateSaveBadge = () => {
  if (!uxSavedBadge) return;
  const current = uxSnapshot();
  const isSaved = uxLastSavedHash !== null && current === uxLastSavedHash;
  uxSavedBadge.textContent = isSaved ? "🟢 Saved" : "🟡 Unsaved";
  uxSavedBadge.dataset.state = isSaved ? "saved" : "unsaved";
};
const uxScheduleSaveBadgeUpdate = () => {
  clearTimeout(uxSaveBadgeTimer);
  uxSaveBadgeTimer = setTimeout(uxUpdateSaveBadge, 150);
};
const uxMarkSaved = () => {
  uxLastSavedHash = uxSnapshot();
  uxUpdateSaveBadge();
};
const uxMarkChanged = () => {
  if (!uxInitialized || uxSuspendSaveBadge) return;
  uxScheduleSaveBadgeUpdate();
};

// UX feature: Recently Edited
let uxRecentTimer = null;
const uxTouchCharacter = (char) => {
  if (!char) return;
  char.updatedAt = new Date().toISOString();
  uxScheduleRecentRender();
};
const uxTouchNote = (note) => {
  if (!note) return;
  note.updatedAt = new Date().toISOString();
  uxScheduleRecentRender();
};
const uxScheduleRecentRender = () => {
  if (!uxInitialized) return;
  clearTimeout(uxRecentTimer);
  uxRecentTimer = setTimeout(renderRecentlyEdited, 80);
};
const uxFormatRelativeTime = (iso) => {
  if (!iso) return "just now";
  const deltaMs = Date.now() - new Date(iso).getTime();
  const seconds = Math.max(1, Math.floor(deltaMs / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return `${years}y ago`;
};
function renderRecentlyEdited() {
  if (!uxRecentList) return;
  const noteMap = new Map();
  const items = [];

  db.characters.forEach(char => {
    if (char.updatedAt) {
      items.push({
        type: "Character",
        name: char.name || "Untitled Character",
        updatedAt: char.updatedAt,
        charId: char.id
      });
    }

    (char.notes || []).forEach(note => {
      if (!note.updatedAt) return;
      const isStory = !note.chapter;
      const existing = noteMap.get(note.id);
      if (!existing || new Date(note.updatedAt) > new Date(existing.updatedAt)) {
        noteMap.set(note.id, {
          type: isStory ? "Story" : "Note",
          name: isStory ? note.story : `${note.story}${note.chapter ? " — " + note.chapter : ""}`.trim(),
          updatedAt: note.updatedAt,
          charId: char.id,
          noteId: note.id
        });
      }
    });
  });

  items.push(...noteMap.values());
  items.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  const top = items.slice(0, 10);
  if (!top.length) {
    uxRecentList.innerHTML = `<div class="ux-recent-meta">No recent edits yet.</div>`;
    return;
  }

  uxRecentList.innerHTML = "";
  top.forEach(item => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ux-recent-item";
    btn.dataset.type = item.type;
    btn.dataset.charId = item.charId;
    if (item.noteId) btn.dataset.noteId = item.noteId;
    btn.innerHTML = `
      <div>${item.name}</div>
      <div class="ux-recent-meta">${item.type} • ${uxFormatRelativeTime(item.updatedAt)}</div>
    `;
    uxRecentList.appendChild(btn);
  });
}

// UX feature: Start here empty state
const uxCountNotes = () => db.characters.reduce((sum, c) => sum + (c.notes ? c.notes.length : 0), 0);
function renderEmptyState() {
  if (!uxEmptyState) return;
  const isEmpty = db.characters.length === 0 && uxCountNotes() === 0;
  uxEmptyState.classList.toggle("hidden", !isEmpty);
}

// UX feature: Tags
const uxParseTags = (value) => value.split(",").map(t => t.trim()).filter(Boolean);
const uxUniqueTags = (tags) => {
  const seen = new Set();
  const result = [];
  tags.forEach(tag => {
    const key = tag.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(tag);
    }
  });
  return result;
};
const uxSetTagsInput = (inputEl, tags) => {
  inputEl.value = tags.join(", ");
};
const uxRenderTagPills = (listEl, tags) => {
  listEl.innerHTML = "";
  tags.forEach(tag => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ux-tag-pill";
    btn.dataset.tag = tag;
    btn.setAttribute("aria-label", `Remove tag ${tag}`);
    btn.textContent = `#${tag} ×`;
    listEl.appendChild(btn);
  });
};
const uxSyncTagPills = (inputEl, listEl) => {
  if (!inputEl || !listEl) return;
  const tags = uxUniqueTags(uxParseTags(inputEl.value));
  uxSetTagsInput(inputEl, tags);
  uxRenderTagPills(listEl, tags);
};
const uxCollectAllTags = () => {
  const tags = new Set();
  db.characters.forEach(char => {
    (char.notes || []).forEach(note => {
      (note.tags || []).forEach(tag => tags.add(tag));
    });
  });
  return Array.from(tags).sort((a, b) => a.localeCompare(b));
};
const uxUpdateTagSuggestions = () => {
  const list = document.getElementById("uxTagSuggestions");
  if (!list) return;
  const tags = uxCollectAllTags();
  list.innerHTML = tags.map(tag => `<option value="${tag}"></option>`).join("");
};
const uxAddTagFromInput = (inputEl, listEl, tagInputEl) => {
  if (!inputEl || !listEl || !tagInputEl) return;
  const value = tagInputEl.value.trim();
  if (!value) return;
  const tags = uxUniqueTags(uxParseTags(inputEl.value).concat([value]));
  uxSetTagsInput(inputEl, tags);
  tagInputEl.value = "";
  uxSyncTagPills(inputEl, listEl);
  uxUpdateTagSuggestions();
  uxMarkChanged();
};
const uxRemoveTag = (inputEl, listEl, tag) => {
  if (!inputEl || !listEl) return;
  const tags = uxParseTags(inputEl.value).filter(t => t.toLowerCase() !== tag.toLowerCase());
  uxSetTagsInput(inputEl, tags);
  uxSyncTagPills(inputEl, listEl);
  uxUpdateTagSuggestions();
  uxMarkChanged();
};

/* ---------- SAVE/LOAD/METADATA ---------- */
function openProjectMenu() {
  document.getElementById('projectMenuBackdrop').style.display = 'block';
  document.getElementById('projectMenu').style.display = 'block';
}

function closeProjectMenu() {
  document.getElementById('projectMenuBackdrop').style.display = 'none';
  document.getElementById('projectMenu').style.display = 'none';
}

function newProject() {
  if (!confirm('Start a new project?\n\nThis will clear all current data. Make sure you have saved your work first!')) {
    return;
  }
  
  // Reset to empty database
  db = {
    characters: [],
    dorms: [],
    units: [],
    others: [],
    folders: []
  };
  
  save();
  activeChar = null;
  
  // Reset all UI
  renderCharacters();
  document.getElementById('charPanel').style.display = 'none';
  document.getElementById('textMessagesPanel').style.display = 'none';
  document.getElementById('galleryPanel').style.display = 'none';
  document.getElementById('relationshipsPanel').classList.remove('panel-open');
  document.getElementById('relationshipBackdrop').classList.remove('open');
  document.getElementById('metadataSidebar').classList.remove('open');
  
  // Clear all form fields
  document.getElementById('storyName').value = '';
  document.getElementById('chapterName').value = '';
  document.getElementById('noteText').value = '';
  document.getElementById('noteSummary').value = '';
  document.getElementById('noteTags').value = '';
  document.getElementById('newFolderName').value = '';
  document.getElementById('searchNotes').value = '';
  document.getElementById('searchResults').innerHTML = '';
  uxSyncTagPills(noteTags, uxTagList);
  
  closeProjectMenu();
  showToast('New project started! Begin creating your characters.');
}

function exportAllData() {
  const dataStr = JSON.stringify(db, null, 2);
  const dataBlob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(dataBlob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `character-ecology-${new Date().toISOString().split('T')[0]}.json`;
  link.click();
  URL.revokeObjectURL(url);
  closeProjectMenu();
  showToast('Project exported successfully!');
  uxMarkSaved();
}

function saveData() {
  const dataStr = JSON.stringify(db, null, 2);
  const dataBlob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(dataBlob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `character-ecology-${new Date().toISOString().split('T')[0]}.json`;
  link.click();
  URL.revokeObjectURL(url);
  uxMarkSaved();
}

function loadData() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const loaded = JSON.parse(event.target.result);
        if (loaded.characters) {
          db = loaded;
          if (!db.dorms) db.dorms = [];
          if (!db.units) db.units = [];
          if (!db.others) db.others = [];
          uxSuspendSaveBadge = true;
          save();
          uxSuspendSaveBadge = false;
          renderCharacters();
          if (db.characters.length > 0) {
            selectCharacter(db.characters[0].id);
          }
          closeProjectMenu();
          showToast('Data loaded successfully!');
          uxMarkSaved();
        }
      } catch (err) {
        showToast('Error loading file: ' + err.message);
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

function toggleMetadata() {
  const sidebar = document.getElementById('metadataSidebar');
  sidebar.classList.toggle('open');
}

function toggleMetadataPin() {
  const sidebar = document.getElementById('metadataSidebar');
  const pinBtn = document.getElementById('metadataPinBtn');
  sidebar.classList.toggle('pinned');
  pinBtn.classList.toggle('pinned');
  if (sidebar.classList.contains('pinned')) {
    sidebar.classList.remove('expanded');
    // Pin at current position
    const rect = sidebar.getBoundingClientRect();
    sidebar.style.left = rect.left + 'px';
    sidebar.style.top = rect.top + 'px';
    sidebar.style.position = 'fixed';
  } else {
    // Unpin but keep current position
    sidebar.style.position = 'fixed';
    sidebar.style.bottom = 'auto';
    // Don't reset left/top to avoid jumping
  }
}

function toggleMetadataPopOut() {
  const sidebar = document.getElementById('metadataSidebar');
  sidebar.classList.toggle('popped-out');
  if (sidebar.classList.contains('popped-out')) {
    sidebar.classList.remove('pinned');
    sidebar.style.position = 'absolute';
    sidebar.style.left = '20px';
    sidebar.style.top = '20px';
    sidebar.style.bottom = 'auto';
  } else {
    sidebar.style.position = '';
    sidebar.style.left = '';
    sidebar.style.top = '';
    sidebar.style.bottom = '';
  }
}

// Drag functionality for metadata sidebar
let isDraggingMetadata = false;
let dragStartX = 0;
let dragStartY = 0;
let initialLeft = 0;
let initialTop = 0;

document.getElementById('metadataSidebar').addEventListener('mousedown', (e) => {
  if (e.target.closest('.metadata-sidebar-controls') || e.target.closest('.metadata-sidebar-resize-handle') || e.target.closest('.metadata-sidebar-width-resize-handle') || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  const sidebar = document.getElementById('metadataSidebar');
  if (sidebar.classList.contains('pinned')) return;
  isDraggingMetadata = true;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  const rect = sidebar.getBoundingClientRect();
  initialLeft = rect.left;
  initialTop = rect.top;
  e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
  if (!isDraggingMetadata) return;
  const sidebar = document.getElementById('metadataSidebar');
  const deltaX = e.clientX - dragStartX;
  const deltaY = e.clientY - dragStartY;
  sidebar.style.left = (initialLeft + deltaX) + 'px';
  sidebar.style.top = (initialTop + deltaY) + 'px';
  sidebar.style.bottom = 'auto';
});

document.addEventListener('mouseup', () => {
  isDraggingMetadata = false;
});

// Width resizing for metadata sidebar
let isResizingWidth = false;
let resizeWidthStartX = 0;
let resizeWidthStartWidth = 0;

document.getElementById('metadataSidebar').addEventListener('mousedown', (e) => {
  if (e.target.id === 'metadataResizeHandle') {
    const sidebar = document.getElementById('metadataSidebar');
    if (sidebar.classList.contains('pinned')) return;
    isResizingWidth = true;
    resizeWidthStartX = e.clientX;
    resizeWidthStartWidth = sidebar.offsetWidth;
    e.preventDefault();
  }
});

document.addEventListener('mousemove', (e) => {
  if (!isResizingWidth) return;
  const sidebar = document.getElementById('metadataSidebar');
  const deltaX = e.clientX - resizeWidthStartX;
  const newWidth = resizeWidthStartWidth + deltaX;
  if (newWidth >= 200 && newWidth <= 600) {
    sidebar.style.width = newWidth + 'px';
  }
});

document.addEventListener('mouseup', () => {
  isResizingWidth = false;
});

/* ---------- DARK MODE ---------- */
function toggleDarkMode() {
  const body = document.body;
  const isDark = body.classList.contains('dark-mode');
  const button = document.querySelector('button[onclick="toggleDarkMode()"]');

  if (isDark) {
    body.classList.remove('dark-mode');
    button.innerHTML = '🌙 Dark Mode';
    localStorage.setItem('darkMode', 'false');
  } else {
    body.classList.add('dark-mode');
    button.innerHTML = '☀️ Light Mode';
    localStorage.setItem('darkMode', 'true');
  }
}

// Restore dark mode on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    const darkMode = localStorage.getItem('darkMode') === 'true';
    const button = document.querySelector('button[onclick="toggleDarkMode()"]');
    if (darkMode) {
      document.body.classList.add('dark-mode');
      if (button) button.innerHTML = '☀️ Light Mode';
    }
  });
} else {
  const darkMode = localStorage.getItem('darkMode') === 'true';
  const button = document.querySelector('button[onclick="toggleDarkMode()"]');
  if (darkMode) {
    document.body.classList.add('dark-mode');
    if (button) button.innerHTML = '☀️ Light Mode';
  }
}

/* ---------- TOOLBAR VISIBILITY ---------- */
function toggleToolbar() {
  const toolbar = document.getElementById('topToolbar');
  const toggleBtn = document.getElementById('toolbarToggleBtn');

  const isHidden = toolbar.style.display === 'none';

  if (isHidden) {
    toolbar.style.display = 'flex';
    toggleBtn.style.display = 'none';
    localStorage.setItem('toolbarVisible', 'true');
  } else {
    toolbar.style.display = 'none';
    toggleBtn.style.display = 'block';
    localStorage.setItem('toolbarVisible', 'false');
  }
}

// Restore toolbar visibility on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    const toolbarVisible = localStorage.getItem('toolbarVisible') !== 'false';
    const toolbar = document.getElementById('topToolbar');
    const toggleBtn = document.getElementById('toolbarToggleBtn');
    
    if (!toolbarVisible) {
      toolbar.style.display = 'none';
      toggleBtn.style.display = 'block';
    }
  });
} else {
  const toolbarVisible = localStorage.getItem('toolbarVisible') !== 'false';
  const toolbar = document.getElementById('topToolbar');
  const toggleBtn = document.getElementById('toolbarToggleBtn');
  
  if (!toolbarVisible) {
    toolbar.style.display = 'none';
    toggleBtn.style.display = 'block';
  }
}

/* ---------- METADATA SIDEBAR RESIZING ---------- */
let isResizingMetadata = false;
const metadataResizeHandle = document.getElementById('metadataResizeHandle');
const metadataSidebar = document.getElementById('metadataSidebar');

if (metadataResizeHandle) {
  metadataResizeHandle.addEventListener('mousedown', (e) => {
    if (metadataSidebar.classList.contains('pinned')) return;
    isResizingMetadata = true;
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizingMetadata) return;

    const newHeight = window.innerHeight - e.clientY;
    if (newHeight >= 150 && newHeight <= 800) {
      metadataSidebar.style.height = newHeight + 'px';
      localStorage.setItem('metadataSidebarHeight', newHeight);
    }
  });

  document.addEventListener('mouseup', () => {
    isResizingMetadata = false;
  });

  // Restore saved height on load
  const savedHeight = localStorage.getItem('metadataSidebarHeight');
  if (savedHeight) {
    metadataSidebar.style.height = savedHeight + 'px';
  }
}

// Width resizing for metadata sidebar right handle
let isResizingSidebarWidth = false;
let resizeSidebarWidthStartX = 0;
let resizeSidebarWidthStartWidth = 0;

document.addEventListener('mousedown', (e) => {
  if (e.target.classList.contains('metadata-sidebar-width-resize-handle')) {
    const sidebar = document.getElementById('metadataSidebar');
    if (sidebar.classList.contains('pinned')) return;
    isResizingSidebarWidth = true;
    resizeSidebarWidthStartX = e.clientX;
    resizeSidebarWidthStartWidth = sidebar.offsetWidth;
    e.preventDefault();
  }
});

document.addEventListener('mousemove', (e) => {
  if (!isResizingSidebarWidth) return;
  const sidebar = document.getElementById('metadataSidebar');
  const deltaX = e.clientX - resizeSidebarWidthStartX;
  const newWidth = resizeSidebarWidthStartWidth + deltaX;
  if (newWidth >= 200 && newWidth <= 600) {
    sidebar.style.width = newWidth + 'px';
  }
});

document.addEventListener('mouseup', () => {
  isResizingSidebarWidth = false;
});

/* ---------- PANEL RESIZING ---------- */
let currentResizingPanel = null;
let resizeStartX = 0;
let resizeStartWidth = 0;

function updateGridLayout() {
  const panels = Array.from(document.querySelectorAll('body > .panel'))
    .filter(panel => getComputedStyle(panel).display !== 'none');
  let gridTemplate = '';

  panels.forEach((p, idx) => {
    if (idx === 0) {
      // First panel (character list) - use actual rendered width
      const width = p.offsetWidth + 'px';
      gridTemplate += width;
    } else {
      // Other panels - use flexible 1fr for expansion
      gridTemplate += ' 1fr';
    }
  });

  if (gridTemplate) {
    document.body.style.gridTemplateColumns = gridTemplate;
    localStorage.setItem('gridTemplateColumns', gridTemplate);
  }
}

function resetLayout() {
  if (!confirm('Reset all panel sizes to default?')) return;
  
  // Clear all saved widths
  localStorage.removeItem('gridTemplateColumns');
  document.querySelectorAll('.panel').forEach((panel, idx) => {
    const panelId = panel.id || 'panel-' + idx;
    localStorage.removeItem('panelWidth-' + panelId);
    panel.style.width = '';
  });
  
  // Reset grid to default
  document.body.style.gridTemplateColumns = '300px 1fr 1fr';
  
  // Reinitialize
  location.reload();
}

function initializePanelResize() {
  // Get all panels and add resize handles
  const panels = document.querySelectorAll('.panel');
  
  panels.forEach((panel, idx) => {
    // Skip expanded panels and metadata sidebar
    if (panel.id === 'metadataSidebar' || panel.classList.contains('expanded')) return;
    
    // Create resize handle
    const handle = document.createElement('div');
    handle.className = 'panel-resize-handle';
    panel.appendChild(handle);
    
    // Add resize listeners
    handle.addEventListener('mousedown', (e) => {
      currentResizingPanel = panel;
      resizeStartX = e.clientX;
      resizeStartWidth = panel.offsetWidth;
      e.preventDefault();
    });
  });
  
  // Global mouse move listener for resizing
  document.addEventListener('mousemove', (e) => {
    if (!currentResizingPanel) return;
    
    const diff = e.clientX - resizeStartX;
    const newWidth = resizeStartWidth + diff;
    
    // Set minimum and maximum widths
    if (newWidth >= 200 && newWidth <= 800) {
      currentResizingPanel.style.width = newWidth + 'px';
      
      // Update grid layout in real-time
      updateGridLayout();
      
      // Save panel width to localStorage
      const panelId = currentResizingPanel.id || 'panel-' + Array.from(document.querySelectorAll('.panel')).indexOf(currentResizingPanel);
      localStorage.setItem('panelWidth-' + panelId, newWidth);
    }
  });

  document.addEventListener('mouseup', () => {
    currentResizingPanel = null;
  });
  
  // Restore saved widths and grid layout
  const savedGridLayout = localStorage.getItem('gridTemplateColumns');
  if (savedGridLayout) {
    document.body.style.gridTemplateColumns = savedGridLayout;
  }
  
  // Only set explicit width on left panel to allow middle/right to expand with 1fr
  const leftPanel = panels[0];
  if (leftPanel) {
    const panelId = leftPanel.id || 'panel-0';
    const savedWidth = localStorage.getItem('panelWidth-' + panelId);
    if (savedWidth) {
      leftPanel.style.width = savedWidth + 'px';
    }
  }

  if (typeof updateGridLayout === "function") {
    updateGridLayout();
  }
}

// Initialize panel resizing when document is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializePanelResize);
} else {
  initializePanelResize();
}

function updateMetadataFields() {
  const c = current();
  if (!c) return;
  document.getElementById('charAge').value = c.age || '';
  document.getElementById('charBirthday').value = c.birthday || '';
  const heightRow = document.getElementById('charHeight')?.closest('.metadata-sidebar-item');
  if (c.hideHeight) {
    if (heightRow) heightRow.style.display = 'none';
    if (restoreHeightMetric) restoreHeightMetric.style.display = '';
  } else {
    if (heightRow) heightRow.style.display = '';
    document.getElementById('charHeight').value = c.height || '';
    if (restoreHeightMetric) restoreHeightMetric.style.display = 'none';
  }
  updateMyDormsList();
  updateMyUnitsList();
  updateMyOthersList();
  renderCustomMetadata();
}

// UX feature: Custom metadata fields
function renderCustomMetadata() {
  if (!customMetadataList) return;
  const c = current();
  if (!c) return;
  if (!c.customMetadata) c.customMetadata = [];

  customMetadataList.innerHTML = "";
  if (c.customMetadata.length === 0) {
    customMetadataList.innerHTML = '<div style="font-size: 11px; color: #999;">No custom fields yet</div>';
    return;
  }

  c.customMetadata.forEach((entry, idx) => {
    const row = document.createElement("div");
    row.style.cssText = "display: grid; grid-template-columns: 1fr 1fr auto; gap: 6px; align-items: center;";
    row.innerHTML = `
      <input data-meta-field="key" data-meta-index="${idx}" value="${entry.key || ""}" placeholder="Label" />
      <input data-meta-field="value" data-meta-index="${idx}" value="${entry.value || ""}" placeholder="Value" />
      <button class="ux-meta-delete" data-meta-index="${idx}" style="width: auto; padding: 4px 8px; margin: 0; font-size: 11px; background: rgba(255,100,130,.15); border-color: rgba(255,100,130,.3); color: #d75a8f;">✕</button>
    `;
    customMetadataList.appendChild(row);
  });
}

// UX feature: Quick notes
function ensureQuickNotes() {
  if (!db.quickNotes) {
    db.quickNotes = { text: "", tags: [], images: [] };
  }
  if (db.quickNotes.text === undefined) db.quickNotes.text = "";
  if (!Array.isArray(db.quickNotes.tags)) db.quickNotes.tags = [];
  if (!Array.isArray(db.quickNotes.images)) db.quickNotes.images = [];
}

function syncQuickNotesUI() {
  if (!quickNotesPanel) return;
  const isOpen = quickNotesPanel.classList.contains("open");
  document.body.classList.toggle("quick-notes-open", isOpen);
  if (quickNotesToggle) quickNotesToggle.classList.toggle("active", isOpen);
  if (typeof updateGridLayout === "function") {
    updateGridLayout();
  }
  quickNotesWasOpen = isOpen;
}

function renderQuickNotes() {
  if (!quickNotesPanel) return;
  ensureQuickNotes();
  quickNotesText.value = db.quickNotes.text || "";
  quickNotesTags.value = (db.quickNotes.tags || []).join(", ");
  syncQuickNotesUI();
  quickNotesImages.innerHTML = "";
  (db.quickNotes.images || []).forEach((src, idx) => {
    const wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.flexDirection = "column";
    wrap.style.gap = "4px";
    const img = document.createElement("img");
    img.src = src;
    const btn = document.createElement("button");
    btn.className = "note-btn-small ux-quick-notes-remove";
    btn.type = "button";
    btn.dataset.idx = idx;
    btn.textContent = "Remove";
    wrap.appendChild(img);
    wrap.appendChild(btn);
    quickNotesImages.appendChild(wrap);
  });
}

function setQuickNotesOpen(open) {
  if (!quickNotesPanel) return;
  ensureQuickNotes();
  const nextOpen = !activeChar ? true : !!open;
  quickNotesPanel.classList.toggle("open", nextOpen);
  syncQuickNotesUI();
  if (nextOpen) renderQuickNotes();
}


function updateMyDormsList() {
  const c = current();
  if (!c) return;
  
  const list = document.getElementById('myDormsList');
  const myDorms = db.dorms.filter(d => d.memberIds.includes(c.id));
  
  if (myDorms.length === 0) {
    list.innerHTML = '<span style="color: #999; font-size: 11px;">No dorms yet</span>';
    return;
  }
  
  list.innerHTML = myDorms.map(dorm => `
    <div style="background: rgba(100, 180, 155, .1); padding: 6px 8px; border-radius: 4px; margin-bottom: 4px; cursor: pointer; font-size: 11px;" onclick="openDormDetail('${dorm.id}')">
      <strong>${dorm.name}</strong> (${dorm.memberIds.length} members)
    </div>
  `).join('');
}

document.getElementById('charAge').addEventListener('input', (e) => {
  const c = current();
  if (c) { c.age = e.target.value; uxTouchCharacter(c); markUnsaved(); save(); }
});
document.getElementById('charBirthday').addEventListener('input', (e) => {
  const c = current();
  if (c) { c.birthday = e.target.value; uxTouchCharacter(c); markUnsaved(); save(); }
});
document.getElementById('charHeight').addEventListener('input', (e) => {
  const c = current();
  if (c) { c.height = e.target.value; uxTouchCharacter(c); markUnsaved(); save(); }
});

/* ---------- DORM FUNCTIONS ---------- */
let currentEditingDormId = null;
let selectedDormMembers = [];
let dormCreationImage = null;

function openDormCreationModal() {
  currentEditingDormId = null;
  selectedDormMembers = [];
  dormCreationImage = null;
  document.getElementById('dormNameInput').value = '';
  document.getElementById('dormDescInput').value = '';
  document.getElementById('dormMembersSelector').innerHTML = '';
  document.getElementById('dormCreationImagePreview').innerHTML = '';
  document.getElementById('dormDeleteImageBtn').style.display = 'none';
  document.getElementById('dormCreationBackdrop').style.display = 'block';
  document.getElementById('dormCreationModal').style.display = 'block';
  updateDormMemberSuggestions();
}

function closeDormCreationModal() {
  document.getElementById('dormCreationBackdrop').style.display = 'none';
  document.getElementById('dormCreationModal').style.display = 'none';
  selectedDormMembers = [];
  dormCreationImage = null;
}

function updateDormMemberSuggestions() {
  const search = document.getElementById('dormMemberSearch').value.toLowerCase();
  const suggestions = document.getElementById('dormMemberSuggestions');
  
  const available = db.characters.filter(ch => 
    !selectedDormMembers.includes(ch.id) && 
    ch.name.toLowerCase().includes(search)
  );
  
  suggestions.innerHTML = available.map(ch => `
    <div style="padding: 6px 8px; background: #f9f9f9; border-radius: 4px; margin-bottom: 4px; cursor: pointer; font-size: 11px;" onclick="addDormMember('${ch.id}', '${ch.name}')">
      ${ch.name}
    </div>
  `).join('');
}

function addDormMember(memberId, memberName) {
  if (selectedDormMembers.length >= 8) {
    showToast('Maximum 8 members per dorm');
    return;
  }
  selectedDormMembers.push(memberId);
  
  const selector = document.getElementById('dormMembersSelector');
  const tag = document.createElement('div');
  tag.style.cssText = 'display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; background: rgba(100, 180, 155, .2); border: 1px solid rgba(100, 180, 155, .4); border-radius: 4px; font-size: 11px;';
  tag.innerHTML = `${memberName} <span style="cursor: pointer; font-weight: bold;" onclick="removeDormMember('${memberId}')">✕</span>`;
  selector.appendChild(tag);
  
  document.getElementById('dormMemberSearch').value = '';
  updateDormMemberSuggestions();
}

function removeDormMember(memberId) {
  selectedDormMembers = selectedDormMembers.filter(id => id !== memberId);
  updateDormMemberSuggestions();
  
  const selector = document.getElementById('dormMembersSelector');
  selector.innerHTML = '';
  selectedDormMembers.forEach(id => {
    const ch = db.characters.find(c => c.id === id);
    if (!ch) return;
    const tag = document.createElement('div');
    tag.style.cssText = 'display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; background: rgba(100, 180, 155, .2); border: 1px solid rgba(100, 180, 155, .4); border-radius: 4px; font-size: 11px;';
    tag.innerHTML = `${ch.name} <span style="cursor: pointer; font-weight: bold;" onclick="removeDormMember('${id}')">✕</span>`;
    selector.appendChild(tag);
  });
}

document.getElementById('dormCreationImageInput')?.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (event) => {
    dormCreationImage = event.target.result;
    const preview = document.getElementById('dormCreationImagePreview');
    preview.innerHTML = `<img src="${dormCreationImage}" style="max-width: 100%; max-height: 150px; border-radius: 8px; border: 1px solid #ffe0d0;" />`;
    document.getElementById('dormDeleteImageBtn').style.display = 'inline-block';
  };
  reader.readAsDataURL(file);
});

function deleteDormCreationImage() {
  dormCreationImage = null;
  document.getElementById('dormCreationImagePreview').innerHTML = '';
  document.getElementById('dormDeleteImageBtn').style.display = 'none';
  document.getElementById('dormCreationImageInput').value = '';
}

function saveDormCreation() {
  const name = document.getElementById('dormNameInput').value.trim();
  const desc = document.getElementById('dormDescInput').value.trim();
  
  if (!name) {
    showToast('Please enter a dorm name');
    return;
  }
  
  if (selectedDormMembers.length === 0) {
    showToast('Please select at least one member');
    return;
  }
  
  const newDorm = {
    id: uid(),
    name: name,
    memberIds: [...selectedDormMembers],
    description: desc,
    image: dormCreationImage || ''
  };
  
  db.dorms.push(newDorm);
  save();
  closeDormCreationModal();
  updateMetadataFields();
  renderAllDormsInSearch();

  showToast('Dorm "' + name + '" has been created!');
}

document.getElementById('dormMemberSearch')?.addEventListener('input', updateDormMemberSuggestions);

// Attach Save Dorm button listener
(function() {
  const saveDormBtn = document.querySelector('button[onclick="saveDormCreation()"]');
  if (saveDormBtn) {
    saveDormBtn.addEventListener('click', (e) => {
      e.preventDefault();
      saveDormCreation();
    });
  }
})();

function openDormSearchPanel() {
  document.getElementById('dormSearchBackdrop').style.display = 'block';
  document.getElementById('dormSearchPanel').style.display = 'block';
  renderAllDormsInSearch();
  updateDormSearchMemberFilter();
}

function closeDormSearchPanel() {
  document.getElementById('dormSearchBackdrop').style.display = 'none';
  document.getElementById('dormSearchPanel').style.display = 'none';
}

let selectedSearchMembers = [];

function updateDormSearchMemberFilter() {
  const selector = document.getElementById('dormSearchMembersSelector');
  selector.innerHTML = '';
  
  db.characters.forEach(ch => {
    const isSelected = selectedSearchMembers.includes(ch.id);
    const btn = document.createElement('button');
    btn.textContent = ch.name;
    btn.style.cssText = `padding: 4px 8px; border-radius: 4px; font-size: 11px; cursor: pointer; ${isSelected ? 'background: rgba(100, 180, 155, .3); border: 1px solid rgba(100, 180, 155, .5);' : 'background: rgba(100, 180, 155, .1); border: 1px solid rgba(100, 180, 155, .3);'}`;
    btn.onclick = () => {
      if (isSelected) {
        selectedSearchMembers = selectedSearchMembers.filter(id => id !== ch.id);
      } else {
        selectedSearchMembers.push(ch.id);
      }
      updateDormSearchMemberFilter();
      renderAllDormsInSearch();
    };
    selector.appendChild(btn);
  });
}

function renderAllDormsInSearch() {
  const resultsDiv = document.getElementById('dormSearchResults');
  
  let dorms = db.dorms;
  
  // Filter by selected members if any
  if (selectedSearchMembers.length > 0) {
    dorms = dorms.filter(dorm => 
      selectedSearchMembers.every(memberId => dorm.memberIds.includes(memberId))
    );
  }
  
  if (dorms.length === 0) {
    resultsDiv.innerHTML = '<span style="color: #999; font-size: 12px;">No dorms match the filter</span>';
    return;
  }
  
  resultsDiv.innerHTML = dorms.map(dorm => {
    const members = dorm.memberIds.map(id => {
      const ch = db.characters.find(ch => ch.id === id);
      return ch ? ch.name : 'Unknown';
    }).join(', ');
    
    return `
      <div style="background: rgba(215, 90, 143, .08); padding: 12px; border-radius: 8px; border: 1px solid #ffe0d0; cursor: pointer;" onclick="openDormDetail('${dorm.id}')">
        <strong>${dorm.name}</strong>
        <div style="font-size: 11px; color: #666; margin-top: 4px;">Members: ${members}</div>
        ${dorm.description ? `<div style="font-size: 11px; margin-top: 6px; color: #555;">${dorm.description.substring(0, 100)}${dorm.description.length > 100 ? '...' : ''}</div>` : ''}
      </div>
    `;
  }).join('');
}

function openDormDetail(dormId) {
  const dorm = db.dorms.find(d => d.id === dormId);
  if (!dorm) return;
  
  currentEditingDormId = dormId;
  selectedDormMembers = [...dorm.memberIds];
  dormCreationImage = dorm.image || null;
  
  document.getElementById('dormDetailTitle').textContent = dorm.name;
  document.getElementById('dormDetailNameInput').value = dorm.name;
  document.getElementById('dormDetailDescInput').value = dorm.description;
  document.getElementById('dormDetailMembersSelector').innerHTML = '';
  document.getElementById('dormDetailMemberSearch').value = '';
  
  // Render selected members as tags
  selectedDormMembers.forEach(memberId => {
    const ch = db.characters.find(c => c.id === memberId);
    if (!ch) return;
    const tag = document.createElement('div');
    tag.style.cssText = 'display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; background: rgba(100, 180, 155, .2); border: 1px solid rgba(100, 180, 155, .4); border-radius: 4px; font-size: 11px;';
    tag.innerHTML = `${ch.name} <span style="cursor: pointer; font-weight: bold;" onclick="removeDormDetailMember('${memberId}')">✕</span>`;
    document.getElementById('dormDetailMembersSelector').appendChild(tag);
  });
  
  // Show image if it exists
  if (dormCreationImage) {
    const preview = document.getElementById('dormDetailImagePreview');
    preview.innerHTML = `<img src="${dormCreationImage}" style="max-width: 100%; max-height: 150px; border-radius: 8px; border: 1px solid #ffe0d0;" />`;
    document.getElementById('dormDetailDeleteImageBtn').style.display = 'inline-block';
  } else {
    document.getElementById('dormDetailImagePreview').innerHTML = '';
    document.getElementById('dormDetailDeleteImageBtn').style.display = 'none';
  }
  
  document.getElementById('dormDetailBackdrop').style.display = 'block';
  document.getElementById('dormDetailPanel').style.display = 'block';
  
  updateDormDetailMemberSuggestions();
}

function closeDormDetail() {
  document.getElementById('dormDetailBackdrop').style.display = 'none';
  document.getElementById('dormDetailPanel').style.display = 'none';
  currentEditingDormId = null;
  selectedDormMembers = [];
  dormCreationImage = null;
}

function updateDormDetailMemberSuggestions() {
  const search = document.getElementById('dormDetailMemberSearch').value.toLowerCase();
  const suggestions = document.getElementById('dormDetailMemberSuggestions');
  
  const available = db.characters.filter(ch => 
    !selectedDormMembers.includes(ch.id) && 
    ch.name.toLowerCase().includes(search)
  );
  
  suggestions.innerHTML = available.map(ch => `
    <div style="padding: 6px 8px; background: #f9f9f9; border-radius: 4px; margin-bottom: 4px; cursor: pointer; font-size: 11px;" onclick="addDormDetailMember('${ch.id}', '${ch.name}')">
      ${ch.name}
    </div>
  `).join('');
}

function addDormDetailMember(memberId, memberName) {
  if (selectedDormMembers.length >= 8) {
    showToast('Maximum 8 members per dorm');
    return;
  }
  selectedDormMembers.push(memberId);
  
  const selector = document.getElementById('dormDetailMembersSelector');
  const tag = document.createElement('div');
  tag.style.cssText = 'display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; background: rgba(100, 180, 155, .2); border: 1px solid rgba(100, 180, 155, .4); border-radius: 4px; font-size: 11px;';
  tag.innerHTML = `${memberName} <span style="cursor: pointer; font-weight: bold;" onclick="removeDormDetailMember('${memberId}')">✕</span>`;
  selector.appendChild(tag);
  
  document.getElementById('dormDetailMemberSearch').value = '';
  updateDormDetailMemberSuggestions();
}

function removeDormDetailMember(memberId) {
  selectedDormMembers = selectedDormMembers.filter(id => id !== memberId);
  updateDormDetailMemberSuggestions();
  
  const selector = document.getElementById('dormDetailMembersSelector');
  selector.innerHTML = '';
  selectedDormMembers.forEach(id => {
    const ch = db.characters.find(c => c.id === id);
    if (!ch) return;
    const tag = document.createElement('div');
    tag.style.cssText = 'display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; background: rgba(100, 180, 155, .2); border: 1px solid rgba(100, 180, 155, .4); border-radius: 4px; font-size: 11px;';
    tag.innerHTML = `${ch.name} <span style="cursor: pointer; font-weight: bold;" onclick="removeDormDetailMember('${id}')">✕</span>`;
    selector.appendChild(tag);
  });
}

document.getElementById('dormDetailImageInput')?.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (event) => {
    dormCreationImage = event.target.result;
    const preview = document.getElementById('dormDetailImagePreview');
    preview.innerHTML = `<img src="${dormCreationImage}" style="max-width: 100%; max-height: 150px; border-radius: 8px; border: 1px solid #ffe0d0;" />`;
    document.getElementById('dormDetailDeleteImageBtn').style.display = 'inline-block';
  };
  reader.readAsDataURL(file);
});

function deleteDormDetailImage() {
  dormCreationImage = null;
  document.getElementById('dormDetailImagePreview').innerHTML = '';
  document.getElementById('dormDetailDeleteImageBtn').style.display = 'none';
  document.getElementById('dormDetailImageInput').value = '';
}

function saveDormDetail() {
  const name = document.getElementById('dormDetailNameInput').value.trim();
  const desc = document.getElementById('dormDetailDescInput').value.trim();
  
  if (!name) {
    showToast('Please enter a dorm name');
    return;
  }
  
  if (selectedDormMembers.length === 0) {
    showToast('Please select at least one member');
    return;
  }
  
  const dorm = db.dorms.find(d => d.id === currentEditingDormId);
  if (!dorm) return;
  
  dorm.name = name;
  dorm.memberIds = [...selectedDormMembers];
  dorm.description = desc;
  dorm.image = dormCreationImage || '';
  
  save();
  closeDormDetail();
  updateMetadataFields();
  renderAllDormsInSearch();
  
  showToast('Dorm updated successfully!');
}

function deleteDorm() {
  db.dorms = db.dorms.filter(d => d.id !== currentEditingDormId);
  save();
  closeDormDetail();
  updateMetadataFields();
  renderAllDormsInSearch();
  showToast('Dorm deleted successfully!');
}



document.getElementById('confirmDeleteDorm').onclick = () => {
  db.dorms = db.dorms.filter(d => d.id !== currentEditingDormId);
  save();
  closeDormDetail();
  updateMetadataFields();
  renderAllDormsInSearch();
  closeDormDeleteModal();
  showToast('Dorm deleted successfully!');
};

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.getElementById('toastContainer').appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 3000);
}

document.getElementById('dormDetailMemberSearch')?.addEventListener('input', updateDormDetailMemberSuggestions);

// Inline dorm creation functions
function toggleDormCreationForm() {
  const form = document.getElementById('dormCreationForm');
  if (form.style.display === 'none') {
    form.style.display = 'block';
    // Reset form
    document.getElementById('dormNameInputInline').value = '';
    document.getElementById('dormDescInputInline').value = '';
    document.getElementById('dormMembersSelectorInline').innerHTML = '';
    document.getElementById('dormMemberSearchInline').value = '';
    document.getElementById('dormMemberSuggestionsInline').innerHTML = '';
    document.getElementById('dormCreationMessage').style.display = 'none';
    selectedDormMembers = [];
  } else {
    form.style.display = 'none';
  }
}

function updateDormMemberSuggestionsInline() {
  const search = document.getElementById('dormMemberSearchInline').value.toLowerCase();
  const suggestions = document.getElementById('dormMemberSuggestionsInline');

  const available = db.characters.filter(ch =>
    !selectedDormMembers.includes(ch.id) &&
    ch.name.toLowerCase().includes(search)
  );

  suggestions.innerHTML = available.map(ch => `
    <div style="padding: 6px 8px; background: #f9f9f9; border-radius: 4px; margin-bottom: 4px; cursor: pointer; font-size: 11px;" onclick="addDormMemberInline('${ch.id}', '${ch.name}')">
      ${ch.name}
    </div>
  `).join('');
}

function addDormMemberInline(memberId, memberName) {
  if (selectedDormMembers.length >= 8) {
    document.getElementById('dormCreationMessage').textContent = 'Maximum 8 members per dorm';
    document.getElementById('dormCreationMessage').style.display = 'block';
    document.getElementById('dormCreationMessage').style.color = 'red';
    return;
  }
  selectedDormMembers.push(memberId);

  const selector = document.getElementById('dormMembersSelectorInline');
  const tag = document.createElement('div');
  tag.style.cssText = 'display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; background: rgba(100, 180, 155, .2); border: 1px solid rgba(100, 180, 155, .4); border-radius: 4px; font-size: 11px;';
  tag.innerHTML = `${memberName} <span style="cursor: pointer; font-weight: bold;" onclick="removeDormMemberInline('${memberId}')">✕</span>`;
  selector.appendChild(tag);

  document.getElementById('dormMemberSearchInline').value = '';
  updateDormMemberSuggestionsInline();
}

function removeDormMemberInline(memberId) {
  selectedDormMembers = selectedDormMembers.filter(id => id !== memberId);
  updateDormMemberSuggestionsInline();

  const selector = document.getElementById('dormMembersSelectorInline');
  selector.innerHTML = '';
  selectedDormMembers.forEach(id => {
    const ch = db.characters.find(c => c.id === id);
    if (!ch) return;
    const tag = document.createElement('div');
    tag.style.cssText = 'display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; background: rgba(100, 180, 155, .2); border: 1px solid rgba(100, 180, 155, .4); border-radius: 4px; font-size: 11px;';
    tag.innerHTML = `${ch.name} <span style="cursor: pointer; font-weight: bold;" onclick="removeDormMemberInline('${id}')">✕</span>`;
    selector.appendChild(tag);
  });
}

function saveDormCreationInline() {
  const name = document.getElementById('dormNameInputInline').value.trim();
  const desc = document.getElementById('dormDescInputInline').value.trim();

  if (!name) {
    document.getElementById('dormCreationMessage').textContent = 'Please enter a dorm name';
    document.getElementById('dormCreationMessage').style.display = 'block';
    document.getElementById('dormCreationMessage').style.color = 'red';
    return;
  }

  if (selectedDormMembers.length === 0) {
    document.getElementById('dormCreationMessage').textContent = 'Please select at least one member';
    document.getElementById('dormCreationMessage').style.display = 'block';
    document.getElementById('dormCreationMessage').style.color = 'red';
    return;
  }

  const newDorm = {
    id: uid(),
    name: name,
    memberIds: [...selectedDormMembers],
    description: desc,
    image: ''
  };

  db.dorms.push(newDorm);
  save();
  updateMetadataFields();
  renderAllDormsInSearch();

  document.getElementById('dormCreationMessage').textContent = 'Dorm "' + name + '" has been created!';
  document.getElementById('dormCreationMessage').style.display = 'block';
  document.getElementById('dormCreationMessage').style.color = 'green';

  // Hide form after 2 seconds
  setTimeout(() => {
    toggleDormCreationForm();
  }, 2000);
}

document.getElementById('dormMemberSearchInline')?.addEventListener('input', updateDormMemberSuggestionsInline);

/* ---------- UNIT FUNCTIONS ---------- */
let currentEditingUnitId = null;
let selectedUnitMembers = [];
let unitCreationImage = null;
let selectedUnitSearchMembers = [];

function openUnitCreationModal() {
  currentEditingUnitId = null;
  selectedUnitMembers = [];
  unitCreationImage = null;
  document.getElementById('unitNameInput').value = '';
  document.getElementById('unitDescInput').value = '';
  document.getElementById('unitMembersSelector').innerHTML = '';
  document.getElementById('unitCreationImagePreview').innerHTML = '';
  document.getElementById('unitDeleteImageBtn').style.display = 'none';
  document.getElementById('unitCreationBackdrop').style.display = 'block';
  document.getElementById('unitCreationModal').style.display = 'block';
  updateUnitMemberSuggestions();
}

function closeUnitCreationModal() {
  document.getElementById('unitCreationBackdrop').style.display = 'none';
  document.getElementById('unitCreationModal').style.display = 'none';
  selectedUnitMembers = [];
  unitCreationImage = null;
}

function updateUnitMemberSuggestions() {
  const search = document.getElementById('unitMemberSearch').value.toLowerCase();
  const suggestions = document.getElementById('unitMemberSuggestions');
  
  const available = db.characters.filter(c => 
    !selectedUnitMembers.includes(c.id) && 
    selectedUnitMembers.length < 8 &&
    (c.name.toLowerCase().includes(search) || search === '')
  );
  
  suggestions.innerHTML = available.map(c => 
    `<div style="padding: 6px; cursor: pointer; border-radius: 3px; background: rgba(180, 150, 255, .1);" onclick="addUnitMember('${c.id}')">${c.name}</div>`
  ).join('');
}

function addUnitMember(charId) {
  if (!selectedUnitMembers.includes(charId) && selectedUnitMembers.length < 8) {
    selectedUnitMembers.push(charId);
    document.getElementById('unitMemberSearch').value = '';
    updateUnitMemberDisplay();
    updateUnitMemberSuggestions();
  }
}

function removeUnitMember(charId) {
  selectedUnitMembers = selectedUnitMembers.filter(id => id !== charId);
  updateUnitMemberDisplay();
  updateUnitMemberSuggestions();
}

function updateUnitMemberDisplay() {
  const selector = document.getElementById('unitMembersSelector');
  selector.innerHTML = selectedUnitMembers.map(charId => {
    const c = db.characters.find(ch => ch.id === charId);
    return `<span style="display: inline-block; background: rgba(180, 150, 255, .2); padding: 4px 8px; border-radius: 3px; font-size: 11px;">${c.name} <span onclick="removeUnitMember('${charId}')" style="cursor: pointer; margin-left: 4px;">✕</span></span>`;
  }).join('');
}

function saveUnitCreation() {
  const name = document.getElementById('unitNameInput').value.trim();
  if (!name || selectedUnitMembers.length === 0) {
    showToast('Unit name and at least one member required');
    return;
  }
  
  if (!db.units) db.units = [];
  
  const unit = {
    id: uid(),
    name: name,
    memberIds: [...selectedUnitMembers],
    description: document.getElementById('unitDescInput').value,
    image: unitCreationImage || null
  };
  
  db.units.push(unit);
  save();
  closeUnitCreationModal();
  updateMetadataFields();
  renderAllUnitsInSearch();
  showToast('Unit created!');
}

function deleteUnitCreationImage() {
  unitCreationImage = null;
  document.getElementById('unitCreationImagePreview').innerHTML = '';
  document.getElementById('unitDeleteImageBtn').style.display = 'none';
}

function openUnitSearchPanel() {
  selectedUnitSearchMembers = [];
  document.getElementById('unitSearchMembersSelector').innerHTML = '';
  document.getElementById('unitSearchBackdrop').style.display = 'block';
  document.getElementById('unitSearchPanel').style.display = 'block';
  renderAllUnitsInSearch();
}

function closeUnitSearchPanel() {
  document.getElementById('unitSearchBackdrop').style.display = 'none';
  document.getElementById('unitSearchPanel').style.display = 'none';
  selectedUnitSearchMembers = [];
}

function updateUnitSearchMemberFilter() {
  const selector = document.getElementById('unitSearchMembersSelector');
  selector.innerHTML = '';
  
  db.characters.forEach(c => {
    const btn = document.createElement('span');
    btn.textContent = c.name;
    btn.style.cssText = `display: inline-block; padding: 4px 8px; border-radius: 3px; font-size: 11px; cursor: pointer; background: ${selectedUnitSearchMembers.includes(c.id) ? 'rgba(180, 150, 255, .3)' : 'rgba(180, 150, 255, .1)'}; margin: 2px;`;
    btn.onclick = () => toggleUnitSearchMember(c.id);
    selector.appendChild(btn);
  });
  
  renderAllUnitsInSearch();
}

function toggleUnitSearchMember(charId) {
  if (selectedUnitSearchMembers.includes(charId)) {
    selectedUnitSearchMembers = selectedUnitSearchMembers.filter(id => id !== charId);
  } else {
    selectedUnitSearchMembers.push(charId);
  }
  updateUnitSearchMemberFilter();
}

function renderAllUnitsInSearch() {
  const results = document.getElementById('unitSearchResults');
  
  let filtered = db.units || [];
  if (selectedUnitSearchMembers.length > 0) {
    filtered = filtered.filter(unit => 
      selectedUnitSearchMembers.every(charId => unit.memberIds.includes(charId))
    );
  }
  
  if (filtered.length === 0) {
    results.innerHTML = '<p style="color: #999; padding: 20px; text-align: center;">No units found</p>';
    return;
  }
  
  results.innerHTML = filtered.map(unit => `
    <div style="background: rgba(180, 150, 255, .1); padding: 12px; border-radius: 6px; cursor: pointer; border-left: 3px solid rgba(180, 150, 255, .4);" onclick="openUnitDetail('${unit.id}')">
      <strong>${unit.name}</strong>
      <div style="font-size: 11px; color: #999; margin-top: 4px;">${unit.memberIds.length} members</div>
    </div>
  `).join('');
}

function openUnitDetail(unitId) {
  const unit = (db.units || []).find(u => u.id === unitId);
  if (!unit) return;
  
  currentEditingUnitId = unitId;
  selectedUnitMembers = [...unit.memberIds];
  
  document.getElementById('unitDetailTitle').textContent = unit.name;
  document.getElementById('unitDetailNameInput').value = unit.name;
  document.getElementById('unitDetailDescInput').value = unit.description || '';
  
  updateUnitDetailMemberDisplay();
  
  if (unit.image) {
    document.getElementById('unitDetailImagePreview').innerHTML = `<img src="${unit.image}" style="max-width: 100%; border-radius: 6px;">`;
    document.getElementById('unitDetailDeleteImageBtn').style.display = 'block';
  } else {
    document.getElementById('unitDetailImagePreview').innerHTML = '';
    document.getElementById('unitDetailDeleteImageBtn').style.display = 'none';
  }
  
  document.getElementById('unitDetailBackdrop').style.display = 'block';
  document.getElementById('unitDetailPanel').style.display = 'block';
  updateUnitDetailMemberSuggestions();
}

function closeUnitDetail() {
  document.getElementById('unitDetailBackdrop').style.display = 'none';
  document.getElementById('unitDetailPanel').style.display = 'none';
  currentEditingUnitId = null;
  selectedUnitMembers = [];
}

function updateUnitDetailMemberDisplay() {
  const selector = document.getElementById('unitDetailMembersSelector');
  selector.innerHTML = selectedUnitMembers.map(charId => {
    const c = db.characters.find(ch => ch.id === charId);
    return `<span style="display: inline-block; background: rgba(180, 150, 255, .2); padding: 4px 8px; border-radius: 3px; font-size: 11px;">${c.name} <span onclick="removeUnitDetailMember('${charId}')" style="cursor: pointer; margin-left: 4px;">✕</span></span>`;
  }).join('');
}

function updateUnitDetailMemberSuggestions() {
  const search = document.getElementById('unitDetailMemberSearch').value.toLowerCase();
  const suggestions = document.getElementById('unitDetailMemberSuggestions');
  
  const available = db.characters.filter(c => 
    !selectedUnitMembers.includes(c.id) && 
    selectedUnitMembers.length < 8 &&
    (c.name.toLowerCase().includes(search) || search === '')
  );
  
  suggestions.innerHTML = available.map(c => 
    `<div style="padding: 6px; cursor: pointer; border-radius: 3px; background: rgba(180, 150, 255, .1);" onclick="addUnitDetailMember('${c.id}')">${c.name}</div>`
  ).join('');
}

function addUnitDetailMember(charId) {
  if (!selectedUnitMembers.includes(charId) && selectedUnitMembers.length < 8) {
    selectedUnitMembers.push(charId);
    document.getElementById('unitDetailMemberSearch').value = '';
    updateUnitDetailMemberDisplay();
    updateUnitDetailMemberSuggestions();
  }
}

function removeUnitDetailMember(charId) {
  selectedUnitMembers = selectedUnitMembers.filter(id => id !== charId);
  updateUnitDetailMemberDisplay();
  updateUnitDetailMemberSuggestions();
}

function saveUnitDetail() {
  const unit = (db.units || []).find(u => u.id === currentEditingUnitId);
  if (!unit) return;

  const name = document.getElementById('unitDetailNameInput').value.trim();
  if (!name || selectedUnitMembers.length === 0) {
    showToast('Unit name and at least one member required');
    return;
  }
  
  unit.name = name;
  unit.memberIds = [...selectedUnitMembers];
  unit.description = document.getElementById('unitDetailDescInput').value;
  
  save();
  closeUnitDetail();
  updateMetadataFields();
  renderAllUnitsInSearch();
  showToast('Unit updated!');
}

function deleteUnit() {
  if (!confirm('Delete this unit? This cannot be undone.')) return;

  db.units = (db.units || []).filter(u => u.id !== currentEditingUnitId);
  save();
  closeUnitDetail();
  updateMetadataFields();
  renderAllUnitsInSearch();
  showToast('Unit deleted!');
}

function deleteUnitDetailImage() {
  const unit = (db.units || []).find(u => u.id === currentEditingUnitId);
  if (!unit) return;
  unit.image = null;
  save();
  document.getElementById('unitDetailImagePreview').innerHTML = '';
  document.getElementById('unitDetailDeleteImageBtn').style.display = 'none';
}

function updateMyUnitsList() {
  const c = current();
  if (!c) return;
  
  const list = document.getElementById('myUnitsList');
  const myUnits = (db.units || []).filter(u => u.memberIds.includes(c.id));
  
  if (myUnits.length === 0) {
    list.innerHTML = '<span style="color: #999; font-size: 11px;">No units yet</span>';
    return;
  }
  
  list.innerHTML = myUnits.map(unit => `
    <div style="background: rgba(180, 150, 255, .1); padding: 6px 8px; border-radius: 4px; margin-bottom: 4px; cursor: pointer; font-size: 11px;" onclick="openUnitDetail('${unit.id}')">
      <strong>${unit.name}</strong> (${unit.memberIds.length} members)
    </div>
  `).join('');
}

document.getElementById('unitMemberSearch')?.addEventListener('input', updateUnitMemberSuggestions);
document.getElementById('unitCreationImageInput')?.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    unitCreationImage = ev.target.result;
    document.getElementById('unitCreationImagePreview').innerHTML = `<img src="${unitCreationImage}" style="max-width: 100%; border-radius: 6px;">`;
    document.getElementById('unitDeleteImageBtn').style.display = 'block';
  };
  reader.readAsDataURL(file);
});
document.getElementById('unitDetailImageInput')?.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const unit = (db.units || []).find(u => u.id === currentEditingUnitId);
    if (unit) {
      unit.image = ev.target.result;
      document.getElementById('unitDetailImagePreview').innerHTML = `<img src="${unit.image}" style="max-width: 100%; border-radius: 6px;">`;
      document.getElementById('unitDetailDeleteImageBtn').style.display = 'block';
      save();
    }
  };
  reader.readAsDataURL(file);
});
document.getElementById('unitDetailMemberSearch')?.addEventListener('input', updateUnitDetailMemberSuggestions);

/* ---------- OTHER FUNCTIONS ---------- */
let currentEditingOtherId = null;
let selectedOtherMembers = [];
let otherCreationImage = null;
let selectedOtherSearchMembers = [];

function openOtherCreationModal() {
  currentEditingOtherId = null;
  selectedOtherMembers = [];
  otherCreationImage = null;
  document.getElementById('otherNameInput').value = '';
  document.getElementById('otherDescInput').value = '';
  document.getElementById('otherMembersSelector').innerHTML = '';
  document.getElementById('otherCreationImagePreview').innerHTML = '';
  document.getElementById('otherDeleteImageBtn').style.display = 'none';
  document.getElementById('otherCreationBackdrop').style.display = 'block';
  document.getElementById('otherCreationModal').style.display = 'block';
  updateOtherMemberSuggestions();
}

function closeOtherCreationModal() {
  document.getElementById('otherCreationBackdrop').style.display = 'none';
  document.getElementById('otherCreationModal').style.display = 'none';
  selectedOtherMembers = [];
  otherCreationImage = null;
}

function updateOtherMemberSuggestions() {
  const search = document.getElementById('otherMemberSearch').value.toLowerCase();
  const suggestions = document.getElementById('otherMemberSuggestions');
  
  const available = db.characters.filter(c => 
    !selectedOtherMembers.includes(c.id) && 
    selectedOtherMembers.length < 8 &&
    (c.name.toLowerCase().includes(search) || search === '')
  );
  
  suggestions.innerHTML = available.map(c => 
    `<div style="padding: 6px; cursor: pointer; border-radius: 3px; background: rgba(255, 180, 150, .1);" onclick="addOtherMember('${c.id}')">${c.name}</div>`
  ).join('');
}

function addOtherMember(charId) {
  if (!selectedOtherMembers.includes(charId) && selectedOtherMembers.length < 8) {
    selectedOtherMembers.push(charId);
    document.getElementById('otherMemberSearch').value = '';
    updateOtherMemberDisplay();
    updateOtherMemberSuggestions();
  }
}

function removeOtherMember(charId) {
  selectedOtherMembers = selectedOtherMembers.filter(id => id !== charId);
  updateOtherMemberDisplay();
  updateOtherMemberSuggestions();
}

function updateOtherMemberDisplay() {
  const selector = document.getElementById('otherMembersSelector');
  selector.innerHTML = selectedOtherMembers.map(charId => {
    const c = db.characters.find(ch => ch.id === charId);
    return `<span style="display: inline-block; background: rgba(255, 180, 150, .2); padding: 4px 8px; border-radius: 3px; font-size: 11px;">${c.name} <span onclick="removeOtherMember('${charId}')" style="cursor: pointer; margin-left: 4px;">✕</span></span>`;
  }).join('');
}

function saveOtherCreation() {
  const name = document.getElementById('otherNameInput').value.trim();
  if (!name || selectedOtherMembers.length === 0) {
    showToast('Other name and at least one member required');
    return;
  }
  
  if (!db.others) db.others = [];
  
  const other = {
    id: uid(),
    name: name,
    memberIds: [...selectedOtherMembers],
    description: document.getElementById('otherDescInput').value,
    image: otherCreationImage || null
  };
  
  db.others.push(other);
  save();
  closeOtherCreationModal();
  updateMetadataFields();
  renderAllOthersInSearch();
  showToast('Other created!');
}

function deleteOtherCreationImage() {
  otherCreationImage = null;
  document.getElementById('otherCreationImagePreview').innerHTML = '';
  document.getElementById('otherDeleteImageBtn').style.display = 'none';
}

function openOtherSearchPanel() {
  selectedOtherSearchMembers = [];
  document.getElementById('otherSearchMembersSelector').innerHTML = '';
  document.getElementById('otherSearchBackdrop').style.display = 'block';
  document.getElementById('otherSearchPanel').style.display = 'block';
  renderAllOthersInSearch();
}

function closeOtherSearchPanel() {
  document.getElementById('otherSearchBackdrop').style.display = 'none';
  document.getElementById('otherSearchPanel').style.display = 'none';
  selectedOtherSearchMembers = [];
}

function updateOtherSearchMemberFilter() {
  const selector = document.getElementById('otherSearchMembersSelector');
  selector.innerHTML = '';
  
  db.characters.forEach(c => {
    const btn = document.createElement('span');
    btn.textContent = c.name;
    btn.style.cssText = `display: inline-block; padding: 4px 8px; border-radius: 3px; font-size: 11px; cursor: pointer; background: ${selectedOtherSearchMembers.includes(c.id) ? 'rgba(255, 180, 150, .3)' : 'rgba(255, 180, 150, .1)'}; margin: 2px;`;
    btn.onclick = () => toggleOtherSearchMember(c.id);
    selector.appendChild(btn);
  });
  
  renderAllOthersInSearch();
}

function toggleOtherSearchMember(charId) {
  if (selectedOtherSearchMembers.includes(charId)) {
    selectedOtherSearchMembers = selectedOtherSearchMembers.filter(id => id !== charId);
  } else {
    selectedOtherSearchMembers.push(charId);
  }
  updateOtherSearchMemberFilter();
}

function renderAllOthersInSearch() {
  const results = document.getElementById('otherSearchResults');
  
  let filtered = db.others || [];
  if (selectedOtherSearchMembers.length > 0) {
    filtered = filtered.filter(other => 
      selectedOtherSearchMembers.every(charId => other.memberIds.includes(charId))
    );
  }
  
  if (filtered.length === 0) {
    results.innerHTML = '<p style="color: #999; padding: 20px; text-align: center;">No others found</p>';
    return;
  }
  
  results.innerHTML = filtered.map(other => `
    <div style="background: rgba(255, 180, 150, .1); padding: 12px; border-radius: 6px; cursor: pointer; border-left: 3px solid rgba(255, 180, 150, .4);" onclick="openOtherDetail('${other.id}')">
      <strong>${other.name}</strong>
      <div style="font-size: 11px; color: #999; margin-top: 4px;">${other.memberIds.length} members</div>
    </div>
  `).join('');
}

function openOtherDetail(otherId) {
  const other = (db.others || []).find(o => o.id === otherId);
  if (!other) return;
  
  currentEditingOtherId = otherId;
  selectedOtherMembers = [...other.memberIds];
  
  document.getElementById('otherDetailTitle').textContent = other.name;
  document.getElementById('otherDetailNameInput').value = other.name;
  document.getElementById('otherDetailDescInput').value = other.description || '';
  
  updateOtherDetailMemberDisplay();
  
  if (other.image) {
    document.getElementById('otherDetailImagePreview').innerHTML = `<img src="${other.image}" style="max-width: 100%; border-radius: 6px;">`;
    document.getElementById('otherDetailDeleteImageBtn').style.display = 'block';
  } else {
    document.getElementById('otherDetailImagePreview').innerHTML = '';
    document.getElementById('otherDetailDeleteImageBtn').style.display = 'none';
  }
  
  document.getElementById('otherDetailBackdrop').style.display = 'block';
  document.getElementById('otherDetailPanel').style.display = 'block';
  updateOtherDetailMemberSuggestions();
}

function closeOtherDetail() {
  document.getElementById('otherDetailBackdrop').style.display = 'none';
  document.getElementById('otherDetailPanel').style.display = 'none';
  currentEditingOtherId = null;
  selectedOtherMembers = [];
}

function updateOtherDetailMemberDisplay() {
  const selector = document.getElementById('otherDetailMembersSelector');
  selector.innerHTML = selectedOtherMembers.map(charId => {
    const c = db.characters.find(ch => ch.id === charId);
    return `<span style="display: inline-block; background: rgba(255, 180, 150, .2); padding: 4px 8px; border-radius: 3px; font-size: 11px;">${c.name} <span onclick="removeOtherDetailMember('${charId}')" style="cursor: pointer; margin-left: 4px;">✕</span></span>`;
  }).join('');
}

function updateOtherDetailMemberSuggestions() {
  const search = document.getElementById('otherDetailMemberSearch').value.toLowerCase();
  const suggestions = document.getElementById('otherDetailMemberSuggestions');
  
  const available = db.characters.filter(c => 
    !selectedOtherMembers.includes(c.id) && 
    selectedOtherMembers.length < 8 &&
    (c.name.toLowerCase().includes(search) || search === '')
  );
  
  suggestions.innerHTML = available.map(c => 
    `<div style="padding: 6px; cursor: pointer; border-radius: 3px; background: rgba(255, 180, 150, .1);" onclick="addOtherDetailMember('${c.id}')">${c.name}</div>`
  ).join('');
}

function addOtherDetailMember(charId) {
  if (!selectedOtherMembers.includes(charId) && selectedOtherMembers.length < 8) {
    selectedOtherMembers.push(charId);
    document.getElementById('otherDetailMemberSearch').value = '';
    updateOtherDetailMemberDisplay();
    updateOtherDetailMemberSuggestions();
  }
}

function removeOtherDetailMember(charId) {
  selectedOtherMembers = selectedOtherMembers.filter(id => id !== charId);
  updateOtherDetailMemberDisplay();
  updateOtherDetailMemberSuggestions();
}

function saveOtherDetail() {
  const other = (db.others || []).find(o => o.id === currentEditingOtherId);
  if (!other) return;

  const name = document.getElementById('otherDetailNameInput').value.trim();
  if (!name || selectedOtherMembers.length === 0) {
    showToast('Other name and at least one member required');
    return;
  }
  
  other.name = name;
  other.memberIds = [...selectedOtherMembers];
  other.description = document.getElementById('otherDetailDescInput').value;
  
  save();
  closeOtherDetail();
  updateMetadataFields();
  renderAllOthersInSearch();
  showToast('Other updated!');
}

function deleteOther() {
  if (!confirm('Delete this other? This cannot be undone.')) return;

  db.others = (db.others || []).filter(o => o.id !== currentEditingOtherId);
  save();
  closeOtherDetail();
  updateMetadataFields();
  renderAllOthersInSearch();
  showToast('Other deleted!');
}

function deleteOtherDetailImage() {
  const other = (db.others || []).find(o => o.id === currentEditingOtherId);
  if (!other) return;
  other.image = null;
  save();
  document.getElementById('otherDetailImagePreview').innerHTML = '';
  document.getElementById('otherDetailDeleteImageBtn').style.display = 'none';
}

function updateMyOthersList() {
  const c = current();
  if (!c) return;
  
  const list = document.getElementById('myOthersList');
  const myOthers = (db.others || []).filter(o => o.memberIds.includes(c.id));
  
  if (myOthers.length === 0) {
    list.innerHTML = '<span style="color: #999; font-size: 11px;">No others yet</span>';
    return;
  }
  
  list.innerHTML = myOthers.map(other => `
    <div style="background: rgba(255, 180, 150, .1); padding: 6px 8px; border-radius: 4px; margin-bottom: 4px; cursor: pointer; font-size: 11px;" onclick="openOtherDetail('${other.id}')">
      <strong>${other.name}</strong> (${other.memberIds.length} members)
    </div>
  `).join('');
}

document.getElementById('otherMemberSearch')?.addEventListener('input', updateOtherMemberSuggestions);
document.getElementById('otherCreationImageInput')?.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    otherCreationImage = ev.target.result;
    document.getElementById('otherCreationImagePreview').innerHTML = `<img src="${otherCreationImage}" style="max-width: 100%; border-radius: 6px;">`;
    document.getElementById('otherDeleteImageBtn').style.display = 'block';
  };
  reader.readAsDataURL(file);
});
document.getElementById('otherDetailImageInput')?.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const other = (db.others || []).find(o => o.id === currentEditingOtherId);
    if (other) {
      other.image = ev.target.result;
      document.getElementById('otherDetailImagePreview').innerHTML = `<img src="${other.image}" style="max-width: 100%; border-radius: 6px;">`;
      document.getElementById('otherDetailDeleteImageBtn').style.display = 'block';
      save();
    }
  };
  reader.readAsDataURL(file);
});
document.getElementById('otherDetailMemberSearch')?.addEventListener('input', updateOtherDetailMemberSuggestions);

document.getElementById('familyCharacterName').addEventListener('input', updateFamilyCharacterSuggestions);

// Initialize with default characters if empty
function initializeDefaults() {
  if (db.characters.length === 0) {
    db.characters.push({
      id: uid(),
      name: "Character 1",
      role: "Protagonist",
      desc: "The main character of our story. Brave, determined, and full of secrets.",
      folders: ["Unsorted", "Main Story", "Relationship Notes"],
      notes: [
        {
          id: uid(),
          story: "Main Story",
          chapter: "Chapter 1",
          text: "First meeting with Character 2. There's something mysterious about them.",
          images: [],
          tags: ["Character 2"],
          folder: "Relationship Notes",
          order: 0,
          reactions: {}
        },
        {
          id: uid(),
          story: "Main Story",
          chapter: "Chapter 3",
          text: "Growing closer to Character 2. What are they hiding?",
          images: [],
          tags: ["Character 2"],
          folder: "Relationship Notes",
          order: 1,
          reactions: {}
        }
      ],
      messages: []
    });
    
    db.characters.push({
      id: uid(),
      name: "Character 2",
      role: "Mysterious Ally",
      desc: "An enigmatic figure with a hidden past. Character 1 feels drawn to them.",
      folders: ["Unsorted", "Main Story", "Relationship Notes"],
      notes: [
        {
          id: uid(),
          story: "Main Story",
          chapter: "Chapter 1",
          text: "I meet Character 1 today. They seem different from the others.",
          images: [],
          tags: ["Character 1"],
          folder: "Relationship Notes",
          order: 0,
          reactions: {}
        },
        {
          id: uid(),
          story: "Main Story",
          chapter: "Chapter 3",
          text: "Character 1 is getting too close. I should be careful.",
          images: [],
          tags: ["Character 1"],
          folder: "Relationship Notes",
          order: 1,
          reactions: {}
        }
      ],
      messages: []
    });
    
    save();
  }
}

// DOM Elements
const characterList = document.getElementById("characterList");
const foldersEl = document.getElementById("folders");
const charPanel = document.getElementById("charPanel");
const charTitle = document.getElementById("charTitle");
const charName = document.getElementById("charName");
const charRole = document.getElementById("charRole");
const charDesc = document.getElementById("charDesc");
const storyName = document.getElementById("storyName");
const chapterName = document.getElementById("chapterName");
const noteText = document.getElementById("noteText");
const noteSummary = document.getElementById("noteSummary");
const noteTags = document.getElementById("noteTags");
const notesPanel = document.getElementById("notesPanel");
const characterTagsList = document.getElementById("characterTagsList");
const imageInput = document.getElementById("imageInput");
const addCharacter = document.getElementById("addCharacter");
const addNote = document.getElementById("addNote");
const addFolder = document.getElementById("addFolder");
const newFolderName = document.getElementById("newFolderName");
const viewTextMessages = document.getElementById("viewTextMessages");
const textMessagesPanel = document.getElementById("textMessagesPanel");
const galleryPanel = document.getElementById("galleryPanel");
const relationshipsPanel = document.getElementById("relationshipsPanel");
const messagesContainer = document.getElementById("messagesContainer");
const textMessageInput = document.getElementById("textMessageInput");
const sendTextMessage = document.getElementById("sendTextMessage");
const backToNotes = document.getElementById("backToNotes");
const backToNotesGallery = document.getElementById("backToNotesGallery");
const viewRelationships = document.getElementById("viewRelationships");
const backToCharFromRelations = document.getElementById("backToCharFromRelations");
const relationshipCharSelector = document.getElementById("relationshipCharSelector");
const relationshipNotes = document.getElementById("relationshipNotes");
const searchNotes = document.getElementById("searchNotes");
const searchResults = document.getElementById("searchResults");
const exportPDF = document.getElementById("exportPDF");
const relationshipSearch = document.getElementById("relationshipSearch");
const noteModal = document.getElementById("noteModal");
const modalNoteSummary = document.getElementById("modalNoteSummary");
const modalNoteTags = document.getElementById("modalNoteTags");
const imageLightbox = document.getElementById("imageLightbox");
const uxTagInput = document.getElementById("uxTagInput");
const uxTagAddBtn = document.getElementById("uxTagAddBtn");
const uxTagList = document.getElementById("uxTagList");
const uxModalTagInput = document.getElementById("uxModalTagInput");
const uxModalTagAddBtn = document.getElementById("uxModalTagAddBtn");
const uxModalTagList = document.getElementById("uxModalTagList");
const uxEmptyState = document.getElementById("uxEmptyState");
const uxEmptyAddCharacter = document.getElementById("uxEmptyAddCharacter");
const uxEmptyAddStory = document.getElementById("uxEmptyAddStory");
const uxRecentList = document.getElementById("uxRecentList");
const uxSavedBadge = document.getElementById("uxSavedBadge");
const customMetadataList = document.getElementById("customMetadataList");
const customMetaKey = document.getElementById("customMetaKey");
const customMetaValue = document.getElementById("customMetaValue");
const addCustomMeta = document.getElementById("addCustomMeta");
const removeHeightMetric = document.getElementById("removeHeightMetric");
const restoreHeightMetric = document.getElementById("restoreHeightMetric");
const quickNotesToggle = document.getElementById("quickNotesToggle");
const quickNotesPanel = document.getElementById("quickNotesPanel");
const quickNotesText = document.getElementById("quickNotesText");
const quickNotesTags = document.getElementById("quickNotesTags");
const quickNotesImageInput = document.getElementById("quickNotesImageInput");
const quickNotesImages = document.getElementById("quickNotesImages");
const quickNotesClose = document.getElementById("quickNotesClose");
const quickNotesToNote = document.getElementById("quickNotesToNote");
let quickNotesWasOpen = false;
let quickNotesAutoOpen = false;

function handleQuickNotesPaste(e) {
  const items = Array.from(e.clipboardData?.items || []);
  const itemImages = items.filter(item => item.type && item.type.startsWith("image/"));
  const fileImages = Array.from(e.clipboardData?.files || []).filter(file => file.type && file.type.startsWith("image/"));
  const images = itemImages.length ? itemImages : fileImages;
  if (!images.length) return false;
  e.preventDefault();
  images.forEach(item => {
    const file = item.getAsFile ? item.getAsFile() : item;
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      ensureQuickNotes();
      db.quickNotes.images.push(ev.target.result);
      save();
      renderQuickNotes();
    };
    reader.readAsDataURL(file);
  });
  return true;
}

// UX feature: Custom metadata fields (listeners)
if (addCustomMeta) {
  addCustomMeta.addEventListener("click", () => {
    const c = current();
    if (!c) return;
    const key = (customMetaKey.value || "").trim();
    const value = (customMetaValue.value || "").trim();
    if (!key && !value) {
      showToast("Enter a label or value to add a custom field.");
      return;
    }
    if (!c.customMetadata) c.customMetadata = [];
    c.customMetadata.push({ key, value });
    customMetaKey.value = "";
    customMetaValue.value = "";
    uxTouchCharacter(c);
    save();
    renderCustomMetadata();
  });
}

if (customMetadataList) {
  customMetadataList.addEventListener("input", (e) => {
    const field = e.target.dataset.metaField;
    const idx = parseInt(e.target.dataset.metaIndex, 10);
    if (!field || Number.isNaN(idx)) return;
    const c = current();
    if (!c || !c.customMetadata || !c.customMetadata[idx]) return;
    c.customMetadata[idx][field] = e.target.value;
    uxTouchCharacter(c);
    save();
  });
  customMetadataList.addEventListener("click", (e) => {
    const btn = e.target.closest(".ux-meta-delete");
    if (!btn) return;
    const idx = parseInt(btn.dataset.metaIndex, 10);
    const c = current();
    if (!c || !c.customMetadata || Number.isNaN(idx)) return;
    c.customMetadata.splice(idx, 1);
    uxTouchCharacter(c);
    save();
    renderCustomMetadata();
  });
}

if (removeHeightMetric) {
  removeHeightMetric.addEventListener("click", () => {
    const c = current();
    if (!c) return;
    c.hideHeight = true;
    save();
    updateMetadataFields();
  });
}

if (restoreHeightMetric) {
  restoreHeightMetric.addEventListener("click", () => {
    const c = current();
    if (!c) return;
    c.hideHeight = false;
    save();
    updateMetadataFields();
  });
}

if (quickNotesToggle) {
  quickNotesToggle.addEventListener("click", () => {
    ensureQuickNotes();
    if (!activeChar) {
      setQuickNotesOpen(true);
      return;
    }
    const isOpen = quickNotesPanel.classList.contains("open");
    setQuickNotesOpen(!isOpen);
  });
}
if (quickNotesClose) {
  quickNotesClose.addEventListener("click", () => {
    if (!activeChar) {
      setQuickNotesOpen(true);
      return;
    }
    setQuickNotesOpen(false);
  });
}
if (quickNotesText) {
  quickNotesText.addEventListener("input", () => {
    ensureQuickNotes();
    db.quickNotes.text = quickNotesText.value;
    save();
  });
  quickNotesText.addEventListener("paste", (e) => {
    handleQuickNotesPaste(e);
  });
}
if (quickNotesTags) {
  quickNotesTags.addEventListener("input", () => {
    ensureQuickNotes();
    db.quickNotes.tags = uxParseTags(quickNotesTags.value);
    save();
  });
}
if (quickNotesImageInput) {
  quickNotesImageInput.addEventListener("change", (e) => {
    const files = Array.from(e.target.files || []);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        ensureQuickNotes();
        db.quickNotes.images.push(ev.target.result);
        save();
        renderQuickNotes();
      };
      reader.readAsDataURL(file);
    });
    quickNotesImageInput.value = "";
  });
}
if (quickNotesImages) {
  quickNotesImages.addEventListener("click", (e) => {
    const btn = e.target.closest(".ux-quick-notes-remove");
    if (!btn) return;
    const idx = parseInt(btn.dataset.idx, 10);
    ensureQuickNotes();
    if (Number.isNaN(idx)) return;
    db.quickNotes.images.splice(idx, 1);
    save();
    renderQuickNotes();
  });
}
if (quickNotesToNote) {
  quickNotesToNote.addEventListener("click", () => {
    const c = current();
    ensureQuickNotes();
    const text = (db.quickNotes.text || "").trim();
    const tags = [...(db.quickNotes.tags || [])];
    const images = db.quickNotes.images || [];
    if (!text && images.length === 0) {
      showToast("Quick notes are empty.");
      return;
    }
    if (c) {
      const hasCurrent = tags.some(tag => tag.toLowerCase() === c.name.toLowerCase());
      if (!hasCurrent) tags.push(c.name);
    }
    const uniqueTags = [];
    const tagSet = new Set();
    tags.forEach(tag => {
      const cleaned = (tag || "").trim();
      if (!cleaned) return;
      const key = cleaned.toLowerCase();
      if (tagSet.has(key)) return;
      tagSet.add(key);
      uniqueTags.push(cleaned);
    });
    const taggedChars = uniqueTags
      .map(tag => db.characters.find(ch => ch.name.toLowerCase() === tag.toLowerCase()))
      .filter(Boolean);
    if (!c && taggedChars.length === 0) {
      showToast("Select a character or add at least one tag.");
      return;
    }
    const note = {
      id: uid(),
      story: "Quick Notes",
      chapter: "",
      text: text,
      summaryText: "",
      images: images,
      tags: uniqueTags,
      folder: "Unsorted",
      order: c ? nextOrder("Unsorted", c) : 0,
      reactions: {},
      updatedAt: new Date().toISOString()
    };
    const targetChars = [];
    if (c) targetChars.push(c);
    taggedChars.forEach(ch => {
      if (!targetChars.some(existing => existing.id === ch.id)) {
        targetChars.push(ch);
      }
    });
    targetChars.forEach((targetChar) => {
      if (!targetChar.notes) targetChar.notes = [];
      const exists = targetChar.notes.some(n => n.id === note.id);
      if (!exists) {
        targetChar.notes.push({
          ...note,
          folder: "Unsorted",
          order: nextOrder("Unsorted", targetChar)
        });
      }
    });
    if (c) {
      uxTouchNote(note);
    }
    db.quickNotes.text = "";
    db.quickNotes.tags = [];
    db.quickNotes.images = [];
    save();
    renderQuickNotes();
    if (c) renderFolders();
    if (!c && taggedChars.length > 0) {
      showToast(`Quick note added to ${taggedChars.length} character(s).`);
    } else {
      showToast("Quick note added.");
    }
  });
}

// UX feature: Start here empty state
if (uxEmptyAddCharacter) {
  uxEmptyAddCharacter.addEventListener("click", () => {
    addCharacter.click();
  });
}
if (uxEmptyAddStory) {
  uxEmptyAddStory.addEventListener("click", () => {
    if (!activeChar) {
      addCharacter.click();
      return;
    }
    if (storyName.value || noteText.value) {
      addNote.click();
      return;
    }
    storyName.focus();
  });
}

// UX feature: Tags
if (uxTagAddBtn && uxTagInput) {
  uxTagAddBtn.addEventListener("click", () => uxAddTagFromInput(noteTags, uxTagList, uxTagInput));
}
if (uxTagInput) {
  uxTagInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      uxAddTagFromInput(noteTags, uxTagList, uxTagInput);
    }
  });
}
if (uxTagList) {
  uxTagList.addEventListener("click", (e) => {
    const btn = e.target.closest(".ux-tag-pill");
    if (!btn) return;
    uxRemoveTag(noteTags, uxTagList, btn.dataset.tag);
  });
}
if (noteTags) {
  noteTags.addEventListener("input", () => {
    uxSyncTagPills(noteTags, uxTagList);
    uxUpdateTagSuggestions();
  });
}

if (uxModalTagAddBtn && uxModalTagInput) {
  uxModalTagAddBtn.addEventListener("click", () => uxAddTagFromInput(modalNoteTags, uxModalTagList, uxModalTagInput));
}
if (uxModalTagInput) {
  uxModalTagInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      uxAddTagFromInput(modalNoteTags, uxModalTagList, uxModalTagInput);
    }
  });
}
if (uxModalTagList) {
  uxModalTagList.addEventListener("click", (e) => {
    const btn = e.target.closest(".ux-tag-pill");
    if (!btn) return;
    uxRemoveTag(modalNoteTags, uxModalTagList, btn.dataset.tag);
  });
}
if (modalNoteTags) {
  modalNoteTags.addEventListener("input", () => {
    uxSyncTagPills(modalNoteTags, uxModalTagList);
    uxUpdateTagSuggestions();
  });
}

if (notesPanel) {
  notesPanel.addEventListener("input", (e) => {
    if (["storyName", "chapterName", "noteText", "noteSummary", "noteTags"].includes(e.target.id)) {
      uxMarkChanged();
    }
  });
}

if (noteModal) {
  noteModal.addEventListener("input", (e) => {
    if (["modalStoryName", "modalChapterName", "modalNoteText", "modalNoteSummary", "modalNoteTags"].includes(e.target.id)) {
      uxMarkChanged();
    }
  });
}

// UX feature: Help buttons
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".ux-help-btn");
  if (!btn) return;
  const helpKey = btn.dataset.help;
  const helpMap = {
    characters: "Create characters, organize them into folders, and click a character to edit details.",
    characterDetails: "Edit name, role, and description. Use Metadata for age/birthday/height, dorms, units, and more.",
    notes: "Add story notes, tags, and images. Organize notes into folders and search by text.",
    textMessages: "Simulate chat messages for the current character. Enter text and send.",
    gallery: "Browse all images attached to this character's notes.",
    relationships: "Select characters to view shared notes, add appellations, and search interactions.",
    family: "Track family members and relationship notes for the current character.",
    metadata: "Quick character metadata: age, birthday, height, dorms, units, others, and custom fields."
  };
  showToast(helpMap[helpKey] || "Help info not available for this section.");
});

// UX feature: Recently Edited navigation
if (uxRecentList) {
  uxRecentList.addEventListener("click", (e) => {
    const btn = e.target.closest(".ux-recent-item");
    if (!btn) return;
    const charId = btn.dataset.charId;
    const noteId = btn.dataset.noteId;
    if (!charId) return;
    selectCharacter(charId);
    if (noteId) {
      setTimeout(() => openNoteModal(noteId), 100);
    }
  });
}

/* ---------- CHARACTER LIST ---------- */
function countCharactersInFolder(path) {
  if (!path) return 0;
  return db.characters.filter(c => c.folder === path).length;
}

function countAllCharactersInFolder(path) {
  if (!path) return 0;
  return db.characters.filter(c => c.folder === path || c.folder.startsWith(path + "/")).length;
}

function renderCharacterFoldersManager() {
  const manager = document.getElementById("characterFoldersManager");
  manager.innerHTML = "";
  manager.ondragover = (e) => e.preventDefault();
  manager.ondrop = (e) => {
    e.preventDefault();
    const draggedPath = e.dataTransfer.getData("folderPath");
    if (!draggedPath) return;
    moveFolderToRoot(draggedPath);
    save();
    renderCharacters();
  };

  function renderFolder(folder, path, level = 0) {
    const hasChildren = folder.children && folder.children.length > 0;
    const totalChars = hasChildren ? countAllCharactersInFolder(path) : countCharactersInFolder(path);
    const isCollapsed = localStorage.getItem(`folder-manager-collapsed-${path}`) === "true";

    const span = document.createElement("span");
    span.style.cssText = `display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; background: rgba(215, 90, 143, .15); border: 1px solid rgba(215, 90, 143, .25); border-radius: 4px; font-size: 12px; margin-right: 4px; margin-bottom: 4px; cursor: grab; transition: all 0.2s; margin-left: ${level * 20}px;`;
    span.dataset.path = path;
    span.draggable = true;

    // Add expand/collapse indicator if has children
    if (hasChildren) {
      const toggleIcon = document.createElement("span");
      toggleIcon.style.cssText = "display: inline-block; width: 12px; text-align: center; font-size: 10px; transition: transform .2s; cursor: pointer;";
      toggleIcon.textContent = "▼";
      if (isCollapsed) {
        toggleIcon.style.transform = "rotate(-90deg)";
      }
      toggleIcon.onclick = (e) => {
        e.stopPropagation();
        const newCollapsed = !isCollapsed;
        localStorage.setItem(`folder-manager-collapsed-${path}`, newCollapsed);
        renderCharacters();
      };
      span.appendChild(toggleIcon);
    }

    // Add subfolder button (moved to left side)
    const addSubBtn = document.createElement("span");
    addSubBtn.textContent = "+";
    addSubBtn.style.cssText = "cursor: pointer; font-weight: bold; margin-right: 4px; color: #4cb58c; font-size: 12px;";
    addSubBtn.title = "Add subfolder";
    addSubBtn.onclick = (e) => {
      e.stopPropagation();
      openAddSubfolderModal(path);
    };
    span.appendChild(addSubBtn);

    const nameEl = document.createElement("span");
    nameEl.textContent = folder.name;
    nameEl.style.userSelect = "none";
    span.appendChild(nameEl);

    // Show total character count
    const count = document.createElement("span");
    count.style.cssText = "font-size: 10px; color: #999; margin-left: 4px;";
    count.textContent = `(${totalChars})`;
    span.appendChild(count);

    // Drag handlers
    span.ondragstart = (e) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("folderPath", path);
      span.style.opacity = "0.5";
    };

    span.ondragend = () => {
      span.style.opacity = "1";
    };

    span.ondragover = (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      span.style.opacity = "0.7";
      span.style.background = "rgba(215, 90, 143, .35)";
    };

    span.ondragleave = () => {
      span.style.opacity = "1";
      span.style.background = "rgba(215, 90, 143, .15)";
    };

    span.ondrop = (e) => {
      e.preventDefault();
      e.stopPropagation();
      span.style.opacity = "1";
      span.style.background = "rgba(215, 90, 143, .15)";

      const draggedPath = e.dataTransfer.getData("folderPath");
      const targetPath = path;

      // Can't drop into self or descendants
      if (draggedPath === targetPath || targetPath.startsWith(draggedPath + "/")) return;

      const draggedFolder = findFolderByPath(draggedPath);
      const targetFolder = findFolderByPath(targetPath);
      if (!draggedFolder || !targetFolder) return;

      const draggedParentPath = getParentPath(draggedPath);
      const targetParentPath = getParentPath(targetPath);

      if (draggedParentPath === targetParentPath) {
        const siblings = getChildrenArray(draggedParentPath);
        if (!siblings) return;
        const fromIdx = siblings.findIndex(f => f.name === draggedFolder.name);
        const toIdx = siblings.findIndex(f => f.name === targetFolder.name);
        if (fromIdx === -1 || toIdx === -1) return;
        siblings.splice(fromIdx, 1);
        siblings.splice(toIdx, 0, draggedFolder);
      } else {
        const oldParent = getChildrenArray(draggedParentPath);
        if (oldParent) {
          const idx = oldParent.findIndex(f => f.name === draggedFolder.name);
          if (idx !== -1) oldParent.splice(idx, 1);
        }
        if (!targetFolder.children) targetFolder.children = [];
        targetFolder.children.push(draggedFolder);

        const newBasePath = targetPath + "/" + draggedFolder.name;
        updateCharacterFolderPaths(draggedPath, newBasePath);
      }

      save();
      renderCharacters();
    };

    if (folder.name !== 'Unsorted') {
      const deleteBtn = document.createElement("span");
      deleteBtn.textContent = "✕";
      deleteBtn.style.cssText = "cursor: pointer; font-weight: bold; margin-left: 2px;";
      deleteBtn.onclick = (e) => {
        e.stopPropagation();
        deleteCharacterFolder(path);
      };
      span.appendChild(deleteBtn);
    }

    manager.appendChild(span);

    // Render children if not collapsed
    if (hasChildren && !isCollapsed) {
      folder.children.forEach((child) => {
        renderFolder(child, path ? `${path}/${child.name}` : child.name, level + 1);
      });
    }
  }

  db.characterFolders.forEach((folder) => {
    renderFolder(folder, folder.name, 0);
  });
}

function findFolderByPath(path) {
  if (!path) return null;
  const parts = path.split("/");
  let current = db.characterFolders;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const folder = current.find(f => f.name === part);
    if (!folder) return null;
    if (i === parts.length - 1) return folder;
    current = folder.children || [];
  }
  return null;
}

function getParentPath(path) {
  if (!path) return "";
  const parts = path.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
}

function getChildrenArray(parentPath) {
  if (!parentPath) return db.characterFolders;
  const parent = findFolderByPath(parentPath);
  if (!parent) return null;
  if (!parent.children) parent.children = [];
  return parent.children;
}

function updateCharacterFolderPaths(oldBase, newBase) {
  db.characters.forEach(char => {
    if (char.folder === oldBase) {
      char.folder = newBase;
    } else if (char.folder.startsWith(oldBase + "/")) {
      char.folder = newBase + char.folder.substring(oldBase.length);
    }
  });
}

function moveFolderToRoot(draggedPath) {
  if (!draggedPath) return;
  const draggedFolder = findFolderByPath(draggedPath);
  if (!draggedFolder) return;
  const parentPath = getParentPath(draggedPath);
  if (!parentPath) return;
  const siblings = getChildrenArray(parentPath);
  if (!siblings) return;
  const idx = siblings.findIndex(f => f.name === draggedFolder.name);
  if (idx !== -1) siblings.splice(idx, 1);
  const newName = ensureUniqueRootName(draggedFolder.name);
  const oldBase = draggedPath;
  draggedFolder.name = newName;
  db.characterFolders.push(draggedFolder);
  updateCharacterFolderPaths(oldBase, newName);
}

function moveCharacterFolderByPath(draggedPath, targetPath) {
  if (!draggedPath || !targetPath) return;
  if (draggedPath === targetPath || targetPath.startsWith(draggedPath + "/")) return;
  const draggedFolder = findFolderByPath(draggedPath);
  const targetFolder = findFolderByPath(targetPath);
  if (!draggedFolder || !targetFolder) return;
  const draggedParentPath = getParentPath(draggedPath);
  const targetParentPath = getParentPath(targetPath);
  if (draggedParentPath === targetParentPath) {
    const siblings = getChildrenArray(draggedParentPath);
    if (!siblings) return;
    const fromIdx = siblings.findIndex(f => f.name === draggedFolder.name);
    const toIdx = siblings.findIndex(f => f.name === targetFolder.name);
    if (fromIdx === -1 || toIdx === -1) return;
    siblings.splice(fromIdx, 1);
    siblings.splice(toIdx, 0, draggedFolder);
  } else {
    const oldParent = getChildrenArray(draggedParentPath);
    if (oldParent) {
      const idx = oldParent.findIndex(f => f.name === draggedFolder.name);
      if (idx !== -1) oldParent.splice(idx, 1);
    }
    if (!targetFolder.children) targetFolder.children = [];
    targetFolder.children.push(draggedFolder);
    const newBasePath = targetPath + "/" + draggedFolder.name;
    updateCharacterFolderPaths(draggedPath, newBasePath);
  }
}

function removeFolderByPath(path) {
  if (!path) return;
  const parts = path.split("/");
  if (parts.length === 1) {
    // root level
    db.characterFolders = db.characterFolders.filter(f => f.name !== parts[0]);
    return;
  }
  const parentPath = parts.slice(0, -1).join("/");
  const parent = findFolderByPath(parentPath);
  if (parent && parent.children) {
    parent.children = parent.children.filter(f => f.name !== parts[parts.length - 1]);
  }
  
  // Clean up any empty parent folders
  cleanupEmptyFolders(parentPath);
}

// Helper: Remove empty parent folders recursively
function cleanupEmptyFolders(path) {
  if (!path) return;
  const folder = findFolderByPath(path);
  if (folder && (!folder.children || folder.children.length === 0)) {
    removeFolderByPath(path);
  }
}

// UX feature: Move subfolders to Unsorted on delete
function ensureUniqueChildName(parent, baseName) {
  let name = baseName;
  let i = 2;
  while (parent.children && parent.children.some(child => child.name === name)) {
    name = `${baseName} (${i++})`;
  }
  return name;
}

function ensureUniqueRootName(baseName) {
  let name = baseName;
  let i = 2;
  while (db.characterFolders.some(f => f.name === name)) {
    name = `${baseName} (${i++})`;
  }
  return name;
}

function moveSubfoldersToUnsorted(path) {
  const folder = findFolderByPath(path);
  const unsorted = findFolderByPath("Unsorted");
  if (!folder || !unsorted) return;
  if (!unsorted.children) unsorted.children = [];

  const children = folder.children || [];
  children.forEach(child => {
    const oldChildPath = `${path}/${child.name}`;
    const newName = ensureUniqueChildName(unsorted, child.name);
    const newChildPath = `Unsorted/${newName}`;
    child.name = newName;
    unsorted.children.push(child);
    db.characters.forEach(c => {
      if (c.folder === oldChildPath || c.folder.startsWith(oldChildPath + "/")) {
        c.folder = newChildPath + c.folder.substring(oldChildPath.length);
      }
    });
  });

  db.characters.forEach(c => {
    if (c.folder === path) {
      c.folder = "Unsorted";
    }
  });

  removeFolderByPath(path);
}

// Helper: Flatten nested folder structure into path-based lookup


function renderCharacters() {
  characterList.innerHTML = "";
  renderCharacterFoldersManager();
  characterList.ondragover = (e) => {
    const folderPath = e.dataTransfer.getData("folderPath");
    if (folderPath) e.preventDefault();
  };
  characterList.ondrop = (e) => {
    const folderPath = e.dataTransfer.getData("folderPath");
    if (!folderPath) return;
    e.preventDefault();
    moveFolderToRoot(folderPath);
    save();
    renderCharacters();
  };

  // Get search term
  const searchTerm = (document.getElementById("charSearchInput")?.value || "").toLowerCase();

  // Ensure characterFolders exists and is in proper format
  if (!db.characterFolders || typeof db.characterFolders[0] === 'string') {
    // Old format - convert
    const oldFolders = db.characterFolders || ["Unsorted"];
    db.characterFolders = oldFolders.map(name => ({
      name: name,
      children: []
    }));
    if (!db.characterFolders.some(f => f.name === "Unsorted")) {
      db.characterFolders.unshift({ name: "Unsorted", children: [] });
    }
  }

  if (searchTerm) {
    const results = db.characters
      .filter(c => (c.name || "").toLowerCase().includes(searchTerm))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    const header = document.createElement("div");
    header.className = "character-search-header";
    header.textContent = `Search results (${results.length})`;
    characterList.appendChild(header);

    if (results.length === 0) {
      const emptyMsg = document.createElement("div");
      emptyMsg.className = "character-search-empty";
      emptyMsg.textContent = "No characters found.";
      characterList.appendChild(emptyMsg);
    } else {
      const resultsList = document.createElement("div");
      resultsList.className = "character-search-results";

      results.forEach(c => {
        const div = document.createElement("div");
        div.className = "item character-search-item" + (c.id === activeChar ? " active" : "");
        div.draggable = true;
        div.dataset.charId = c.id;
        div.dataset.folder = c.folder || "Unsorted";

        const nameEl = document.createElement("div");
        nameEl.textContent = c.name;
        const pathEl = document.createElement("div");
        pathEl.className = "character-search-path";
        pathEl.textContent = (c.folder || "Unsorted").replaceAll("/", " › ");

        div.appendChild(nameEl);
        div.appendChild(pathEl);

        div.ondragstart = (e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("charId", c.id);
          e.dataTransfer.setData("fromFolder", c.folder || "Unsorted");
        };

        div.onclick = () => {
          if (c.id === activeChar) {
            clearCharacterSelection();
          } else {
            selectCharacter(c.id);
          }
        };

        resultsList.appendChild(div);
      });

      characterList.appendChild(resultsList);
    }

    updateCharacterTagsList();
    renderEmptyState();
    renderRecentlyEdited();
    renderQuickNotes();
    return;
  }

  // Group characters by folder path
  const grouped = {};
  function collectFolderPaths(folders, prefix = "") {
    folders.forEach(folder => {
      const path = prefix ? `${prefix}/${folder.name}` : folder.name;
      grouped[path] = [];
      if (folder.children && folder.children.length > 0) {
        collectFolderPaths(folder.children, path);
      }
    });
  }
  collectFolderPaths(db.characterFolders);

  db.characters.forEach(c => {
    const folderName = c.folder || "Unsorted";
    if (!grouped[folderName]) grouped[folderName] = [];
    grouped[folderName].push(c);
  });

  // Sort characters in each folder
  Object.keys(grouped).forEach(folder => {
    grouped[folder].sort((a, b) => (a.order || 0) - (b.order || 0));
  });

  // Recursive function to render folder structure
  function renderFolderStructure(folders, level = 0, prefix = "", container = characterList) {
    folders.forEach(folder => {
      const folderPath = prefix ? `${prefix}/${folder.name}` : folder.name;
      const characters = grouped[folderPath] || [];
      const totalChars = countCharactersInFolder(folderPath);

      // Skip empty folders when searching (unless they have subfolders)
      const hasSubfolders = folder.children && folder.children.length > 0;
      if (searchTerm && totalChars === 0 && !hasSubfolders) return;

      const folderEl = document.createElement("div");
      folderEl.className = "folder";
      folderEl.dataset.folder = folderPath;
      folderEl.style.marginLeft = `${level * 20}px`;

      const header = document.createElement("h4");
      header.style.cssText = "margin: 12px 0 8px 0; font-size: 14px; cursor: pointer; display: flex; justify-content: flex-start; align-items: center; gap: 8px; user-select: none;";
      header.draggable = folder.name !== "Unsorted";

      // Add expand/collapse indicator
      const toggleIcon = document.createElement("span");
      toggleIcon.style.cssText = "display: inline-block; width: 16px; text-align: center; font-size: 12px; transition: transform .2s;";
      toggleIcon.textContent = (hasSubfolders || characters.length > 0) ? "▼" : "○";
      header.appendChild(toggleIcon);

      const titleEl = document.createElement("span");
      titleEl.textContent = folder.name;
      if (totalChars > 0) {
        const count = document.createElement("span");
        count.style.cssText = "font-size: 10px; color: #999; margin-left: 4px;";
        count.textContent = `(${totalChars})`;
        titleEl.appendChild(count);
      }
      titleEl.style.flex = "1";
      header.appendChild(titleEl);

      // Check collapsed state
      let isCollapsed = localStorage.getItem(`folder-collapsed-${folderPath}`) === "true";

      // Update toggle icon on click
      header.onclick = () => {
        isCollapsed = !isCollapsed;
        localStorage.setItem(`folder-collapsed-${folderPath}`, isCollapsed);
        renderCharacters();
      };

      if (isCollapsed) {
        toggleIcon.style.transform = "rotate(-90deg)";
      }

      // Add drag-over and drop handlers to header
      header.ondragstart = (e) => {
        if (!header.draggable) return;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("folderPath", folderPath);
        header.style.opacity = "0.6";
      };
      header.ondragend = () => {
        header.style.opacity = "1";
      };
      header.ondragover = (e) => e.preventDefault();
      header.ondrop = (e) => {
        e.preventDefault();
        const draggedFolderPath = e.dataTransfer.getData("folderPath");
        if (draggedFolderPath) {
          moveCharacterFolderByPath(draggedFolderPath, folderPath);
          save();
          renderCharacters();
          return;
        }
        const draggedCharId = e.dataTransfer.getData("charId");
        if (draggedCharId) {
          moveCharacterToFolder(draggedCharId, folderPath);
        }
      };

      folderEl.appendChild(header);

      const contentDiv = document.createElement("div");
      if (isCollapsed) {
        contentDiv.style.display = "none";
      }

      // Render characters in this folder
      const charList = document.createElement("div");
      charList.className = "folder-notes";
      charList.style.cssText = "display: flex; flex-direction: column; gap: 6px;";

      // Add drag-over and drop handlers to folder container
      charList.ondragover = (e) => e.preventDefault();
      charList.ondrop = (e) => {
        e.preventDefault();
        const draggedCharId = e.dataTransfer.getData("charId");
        moveCharacterToFolder(draggedCharId, folderPath);
      };

      characters
        .filter(c => !searchTerm || c.name.toLowerCase().includes(searchTerm))
        .forEach((c, idx) => {
          const div = document.createElement("div");
          div.className = "item" + (c.id === activeChar ? " active" : "");
          div.textContent = c.name;
          div.draggable = true;
          div.dataset.charId = c.id;
          div.dataset.folder = folderPath;
          div.dataset.order = idx;

          div.ondragstart = (e) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("charId", c.id);
            e.dataTransfer.setData("fromFolder", folderPath);
          };

          div.ondragover = (e) => e.preventDefault();

          div.ondrop = (e) => {
            e.preventDefault();
            const draggedCharId = e.dataTransfer.getData("charId");
            if (draggedCharId !== c.id) {
              reorderCharacters(draggedCharId, c.id, folderPath);
            }
          };

          div.onclick = () => {
            if (c.id === activeChar) {
              clearCharacterSelection();
            } else {
              selectCharacter(c.id);
            }
          };
          charList.appendChild(div);
        });

      if (characters.length === 0 && !searchTerm) {
        const emptyMsg = document.createElement("div");
        emptyMsg.style.cssText = "font-size: 12px; color: #999; padding: 8px; text-align: center;";
        emptyMsg.textContent = "No characters in this folder";
        emptyMsg.ondragover = (e) => e.preventDefault();
        emptyMsg.ondrop = (e) => {
          e.preventDefault();
          const draggedCharId = e.dataTransfer.getData("charId");
          moveCharacterToFolder(draggedCharId, folderPath);
        };
        charList.appendChild(emptyMsg);
      }

      contentDiv.appendChild(charList);

      // Render subfolders recursively inside contentDiv
      if (hasSubfolders) {
        renderFolderStructure(folder.children, level + 1, folderPath, contentDiv);
      }

      folderEl.appendChild(contentDiv);
      container.appendChild(folderEl);
    });
  }

  // Start rendering from root level
  renderFolderStructure(db.characterFolders);

  updateCharacterTagsList();
  renderEmptyState();
  renderRecentlyEdited();
  renderQuickNotes();
}

function clearCharacterSearch() {
  document.getElementById("charSearchInput").value = "";
  renderCharacters();
}



// Helper: Create a subfolder within a parent folder
function createSubfolderInParent(parentPath, subfolderName) {
  if (!parentPath) {
    // Create at root level
    db.characterFolders.push({ name: subfolderName, children: [] });
  } else {
    // Find parent and add to its children
    const parts = parentPath.split("/");
    let currentLevel = db.characterFolders;
    
    for (let part of parts) {
      const folder = currentLevel.find(f => f.name === part);
      if (!folder) return false;
      currentLevel = folder.children || [];
    }
    
    // Add to the last level (parent's children)
    const parentFolder = currentLevel[currentLevel.length - 1];
    if (!parentFolder) {
      // Parent wasn't found correctly, try different approach
      const parent = findFolderByPath(parentPath);
      if (!parent) return false;
      if (!parent.children) parent.children = [];
      parent.children.push({ name: subfolderName, children: [] });
    } else {
      parentFolder.children = parentFolder.children || [];
      parentFolder.children.push({ name: subfolderName, children: [] });
    }
  }
  return true;
}

function createCharacterFolder() {
  const name = document.getElementById("newCharFolderName").value.trim();
  if (!name) {
    showToast("Please enter a folder name");
    return;
  }

  // Check if folder already exists
  if (db.characterFolders.some(f => f.name === name)) {
    showToast("Folder already exists");
    return;
  }
  
  // Add to root level
  db.characterFolders.push({ name: name, children: [] });
  document.getElementById("newCharFolderName").value = "";
  save();
  renderCharacters();
}

function deleteCharacterFolder(path) {
  if (path === "Unsorted") {
    showToast("Cannot delete the Unsorted folder");
    return;
  }

  openFolderDeleteModal(path);
}

function openFolderDeleteModal(path) {
  const totalChars = countAllCharactersInFolder(path);
  const folder = findFolderByPath(path);
  const hasSubfolders = !!(folder && folder.children && folder.children.length);
  let modalHtml = `<div class="modal-content">
    <span class="modal-close" id="folderDeleteModalCloseBtn">&times;</span>
    <h2>Delete Folder "${path.split('/').pop()}"</h2>
    <p>Are you sure you want to delete the folder "${path}"?</p>`;
  if (totalChars > 0 || hasSubfolders) {
    modalHtml += `<p>This folder contains ${totalChars} character(s). What would you like to do with them?</p>
      <div style="display: flex; gap: 10px; margin-top: 20px;">
        <button id="folderDeleteMoveBtn" style="flex: 1;">Move to Unsorted</button>
        <button id="folderDeleteMoveSubBtn" style="flex: 1; background: rgba(125, 211, 252, .12); border-color: rgba(125, 211, 252, .30); color: #2b8fba;">Move Subfolders + Characters</button>
        <button id="folderDeleteDeleteBtn" style="flex: 1; background: rgba(255, 100, 130, .15); border-color: rgba(255, 100, 130, .30); color: #d75a8f;">Delete All Characters</button>
        <button id="folderDeleteCancelBtn" style="flex: 1;">Cancel</button>
      </div>`;
  } else {
    modalHtml += `<div style="display: flex; gap: 10px; margin-top: 20px;">
        <button id="folderDeleteConfirmBtn" style="flex: 1; background: rgba(255, 100, 130, .15); border-color: rgba(255, 100, 130, .30); color: #d75a8f;">Delete Folder</button>
        <button id="folderDeleteCancelBtn" style="flex: 1;">Cancel</button>
      </div>`;
  }
  modalHtml += `</div>`;
  const modal = document.getElementById('folderDeleteModal');
  modal.innerHTML = modalHtml;
  modal.style.display = 'flex';
  setTimeout(() => modal.classList.add('open'), 0);

  // Attach event listeners
  document.getElementById('folderDeleteModalCloseBtn').onclick = closeFolderDeleteModal;
  if (totalChars > 0 || hasSubfolders) {
    document.getElementById('folderDeleteMoveBtn').onclick = () => {
      db.characters.forEach(c => {
        if (c.folder === path || c.folder.startsWith(path + "/")) {
          c.folder = "Unsorted";
        }
      });
      removeFolderByPath(path);
      save();
      closeFolderDeleteModal();
      setTimeout(renderCharacters, 10);
    };
    document.getElementById('folderDeleteMoveSubBtn').onclick = () => {
      moveSubfoldersToUnsorted(path);
      save();
      closeFolderDeleteModal();
      setTimeout(renderCharacters, 10);
    };
    document.getElementById('folderDeleteDeleteBtn').onclick = () => {
      db.characters = db.characters.filter(c => !(c.folder === path || c.folder.startsWith(path + "/")));
      removeFolderByPath(path);
      save();
      closeFolderDeleteModal();
      setTimeout(renderCharacters, 10);
    };
    document.getElementById('folderDeleteCancelBtn').onclick = closeFolderDeleteModal;
  } else {
    document.getElementById('folderDeleteConfirmBtn').onclick = () => {
      removeFolderByPath(path);
      save();
      closeFolderDeleteModal();
      setTimeout(renderCharacters, 10);
    };
    document.getElementById('folderDeleteCancelBtn').onclick = closeFolderDeleteModal;
  }
}

function closeFolderDeleteModal() {
  const modal = document.getElementById('folderDeleteModal');
  modal.classList.remove('open');
  modal.style.display = 'none';
  modal.innerHTML = '';
}

function moveCharacterToFolder(charId, newFolder) {
  const char = db.characters.find(c => c.id === charId);
  if (char) {
    char.folder = newFolder;
    save();
    renderCharacters();
  }
}

function reorderCharacters(draggedCharId, targetCharId, folder) {
  const draggedChar = db.characters.find(c => c.id === draggedCharId);
  const targetChar = db.characters.find(c => c.id === targetCharId);
  
  if (!draggedChar || !targetChar) return;
  
  // Move to target folder if different
  if (draggedChar.folder !== folder) {
    draggedChar.folder = folder;
  }
  
  // Swap order
  const temp = draggedChar.order;
  draggedChar.order = targetChar.order;
  targetChar.order = temp;
  
  save();
  renderCharacters();
}

function selectCharacter(id) {
  activeChar = id;
  const c = current();
  applySelectionView();
  charPanel.style.display = "flex";
  textMessagesPanel.style.display = "none";
  galleryPanel.style.display = "none";
  relationshipsPanel.style.display = "none";
  charTitle.textContent = c.name;
  charName.value = c.name;
  charRole.value = c.role || "";
  charDesc.value = c.desc || "";
  searchResults.innerHTML = "";
  searchNotes.value = "";
  // Close metadata sidebar when selecting a character (unless pinned)
  const sidebar = document.getElementById('metadataSidebar');
  if (!sidebar.classList.contains('pinned')) {
    sidebar.classList.remove('open');
  }
  updateMetadataFields();
  renderFolders();
  renderTextMessages();
  renderCharacters();
}

function clearNotesPanel() {
  if (searchResults) searchResults.innerHTML = "";
  if (searchNotes) searchNotes.value = "";
  if (storyName) storyName.value = "";
  if (chapterName) chapterName.value = "";
  if (noteText) noteText.value = "";
  if (noteSummary) noteSummary.value = "";
  if (noteTags) noteTags.value = "";
  if (typeof uxSyncTagPills === "function" && noteTags && uxTagList) {
    uxSyncTagPills(noteTags, uxTagList);
  }
  if (typeof renderPastedImages === "function") {
    pastedImages = [];
    renderPastedImages();
  }
  if (foldersEl) {
    foldersEl.innerHTML = "<div style=\"color: #999; padding: 8px; text-align: center;\">Select a character to view notes.</div>";
  }
}

function applySelectionView() {
  if (!notesPanel || !quickNotesPanel) return;
  if (!activeChar) {
    notesPanel.style.display = "none";
    quickNotesAutoOpen = true;
    setQuickNotesOpen(true);
  } else {
    notesPanel.style.display = "block";
    if (quickNotesAutoOpen) {
      quickNotesAutoOpen = false;
      setQuickNotesOpen(false);
    }
  }
  if (typeof updateGridLayout === "function") {
    updateGridLayout();
  }
}

function clearCharacterSelection() {
  activeChar = null;
  document.getElementById('charPanel').style.display = 'none';
  document.getElementById('textMessagesPanel').style.display = 'none';
  document.getElementById('galleryPanel').style.display = 'none';
  document.getElementById('relationshipsPanel').classList.remove('panel-open');
  document.getElementById('relationshipBackdrop').classList.remove('open');
  document.getElementById('metadataSidebar').classList.remove('open');
  clearNotesPanel();
  applySelectionView();
  renderCharacters();
  updateBreadcrumb();
  updatePanelDimming();
}

addCharacter.onclick = () => {
  // Auto-increment duplicate names
  let baseName = "New Character";
  let name = baseName;
  let i = 1;
  while (db.characters.some(c => c.name === name)) {
    name = `${baseName} (${i++})`;
  }
  const c = {
    id: uid(),
    name: name,
    role: "",
    desc: "",
    folder: "Unsorted",
    order: db.characters.length,
    folders: ["Unsorted"],
    notes: [],
    messages: [],
    updatedAt: new Date().toISOString()
  };
  db.characters.push(c);
  uxTouchCharacter(c);
  activeChar = c.id;
  save();
  renderCharacters();
  selectCharacter(c.id);
};

document.getElementById("addCharFolder").onclick = createCharacterFolder;

document.getElementById("clearSelection").onclick = clearCharacterSelection;

document.getElementById("charSearchInput").addEventListener("input", (e) => {
  renderCharacters();
});

document.getElementById("charSearchInput").addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    renderCharacters();
  }
});

let characterToDelete = null;
let currentSubfolderParent = null;

function openCharacterDeleteModal(charId) {
  const c = db.characters.find(ch => ch.id === charId);
  if (!c) return;
  characterToDelete = c;
  document.getElementById('deleteConfirmInput').value = '';
  document.getElementById('characterDeleteModal').classList.add('open');
}

function closeCharacterDeleteModal() {
  document.getElementById('characterDeleteModal').classList.remove('open');
  characterToDelete = null;
}

function openAddSubfolderModal(parentPath) {
  currentSubfolderParent = parentPath;
  document.getElementById('subfolderNameInput').value = '';
  document.getElementById('addSubfolderModal').classList.add('open');
}

function closeAddSubfolderModal() {
  document.getElementById('addSubfolderModal').classList.remove('open');
  currentSubfolderParent = null;
}

document.getElementById('confirmAddSubfolder').onclick = () => {
  const subName = document.getElementById('subfolderNameInput').value.trim();
  if (!subName) {
    showToast('Please enter a subfolder name');
    return;
  }

  const folder = findFolderByPath(currentSubfolderParent);
  if (!folder) return;

  if (!folder.children) folder.children = [];
  folder.children.push({ name: subName, children: [] });
  save();
  closeAddSubfolderModal();
  renderCharacters();
};

document.getElementById('confirmDeleteCharacter').onclick = () => {
  const input = document.getElementById('deleteConfirmInput').value.trim();
  if (input !== 'delete') {
    showToast('Please type "delete" in all lowercase to confirm.');
    return;
  }

  const c = characterToDelete;
  if (!c) return;

  // Remove character from dorms
  if (c.dormId) {
    const dorm = db.dorms.find(d => d.id === c.dormId);
    if (dorm) {
      dorm.memberIds = dorm.memberIds.filter(id => id !== c.id);
      if (dorm.memberIds.length === 0) {
        db.dorms = db.dorms.filter(d => d.id !== dorm.id);
      }
    }
  }

  // Remove character from db
  db.characters = db.characters.filter(ch => ch.id !== c.id);

  // Remove references from other characters' notes and tags
  db.characters.forEach(ch => {
    ch.notes.forEach(note => {
      if (note.tags) {
        note.tags = note.tags.filter(tag => tag !== c.name);
      }
    });
  });

  // Remove from tags in all notes (including orphaned notes)
  db.characters.forEach(ch => {
    ch.notes.forEach(note => {
      if (note.tags) {
        note.tags = note.tags.filter(tag => tag !== c.name);
      }
    });
  });

  save();
  closeCharacterDeleteModal();
  activeChar = db.characters[0]?.id || null;
  renderCharacters();
  if (activeChar) {
    selectCharacter(activeChar);
  } else {
    charPanel.style.display = "none";
  }
};

document.getElementById("deleteCharacter").onclick = () => openCharacterDeleteModal(activeChar);

function current() {
  return db.characters.find(c => c.id === activeChar);
}

function updateCharacterTagsList() {
  const tagsList = db.characters;
  characterTagsList.innerHTML = tagsList.map(c =>
    `<span style="display: inline-flex; align-items: center; background: rgba(180,140,255,.15); padding: 3px 8px; border-radius: 3px; margin-right: 4px; font-size: 11px;">
      <span style="cursor: pointer;" onclick="addCharacterTag('${c.name}')">${c.name}</span>
      <span style="cursor: pointer; margin-left: 4px; color: #d75a8f;" onclick="openCharacterDeleteModal('${c.id}')" title="Delete character">🗑️</span>
    </span>`
  ).join("");
}

function addCharacterTag(charName) {
  const current = noteTags.value.trim();
  const tags = current ? current.split(",").map(t => t.trim()) : [];
  if (!tags.includes(charName)) {
    tags.push(charName);
    noteTags.value = tags.join(", ");
    uxSyncTagPills(noteTags, uxTagList);
    uxUpdateTagSuggestions();
    uxMarkChanged();
  }
}

/* ---------- FOLDERS + NOTES ---------- */
function renderFolders() {
  const c = current();
  if (!c) return;
  foldersEl.innerHTML = "";

  c.folders.forEach(folderName => {
    const folder = document.createElement("div");
    folder.className = "folder";
    folder.dataset.folder = folderName;

    const header = document.createElement("h4");
    header.className = "ux-folder-header";
    const headerText = document.createElement("span");
    headerText.textContent = folderName;
    headerText.style.flex = "1";
    headerText.style.cursor = "pointer";
    headerText.onclick = () => folder.classList.toggle("collapsed");

    const deleteBtn = document.createElement("span");
    deleteBtn.className = "folder-delete";
    deleteBtn.textContent = "✕";
    deleteBtn.onclick = () => deleteFolder(folderName);

    header.appendChild(headerText);
    if (folderName !== "Unsorted") header.appendChild(deleteBtn);
    header.draggable = folderName !== "Unsorted";
    header.ondragstart = () => {
      if (folderName === "Unsorted") return;
      draggedFolderName = folderName;
      header.style.opacity = "0.6";
    };
    header.ondragend = () => {
      draggedFolderName = null;
      header.style.opacity = "1";
    };
    header.ondragover = (e) => e.preventDefault();
    header.ondrop = (e) => {
      e.preventDefault();
      if (draggedFolderName && draggedFolderName !== folderName) {
        reorderNoteFolders(draggedFolderName, folderName);
        return;
      }
      moveNoteToFolder(folderName);
    };

    const notesWrap = document.createElement("div");
    notesWrap.className = "folder-notes";
    notesWrap.ondragover = e => e.preventDefault();
    notesWrap.ondrop = () => moveNoteToFolder(folderName);

    const notes = c.notes
      .filter(n => n.folder === folderName)
      .sort((a,b) => a.order - b.order);

    notes.forEach(note => {
      const div = document.createElement("div");
      div.className = "note";
      div.draggable = true;
      div.dataset.noteId = note.id;

      let html = `<strong>${note.story} — ${note.chapter}</strong>`;
      html += `<div>${note.text}</div>`;
      
      if (note.tags && note.tags.length) {
        html += `<div class="note-tags">${note.tags.map(t => `<span class="note-tag">${t}</span>`).join("")}</div>`;
      }

      if (note.reactions && Object.keys(note.reactions).length) {
        html += `<div class="note-reactions">`;
        Object.entries(note.reactions).forEach(([emoji, count]) => {
          if (count > 0) html += `<div class="note-reaction">${emoji} ${count}</div>`;
        });
        html += `</div>`;
      }

      div.innerHTML = html;

      note.images.forEach(img => {
        const i = document.createElement("img");
        i.src = img;
        i.onclick = (e) => {
          e.stopPropagation();
          openLightbox(img);
        };
        div.appendChild(i);
      });

      div.style.cursor = "pointer";
      
      const actionDiv = document.createElement("div");
      actionDiv.className = "note-actions";
      actionDiv.innerHTML = `<button class="note-btn-small" onclick="openNoteModal('${note.id}')">Edit</button><button class="note-btn-small" onclick="deleteNoteDirectly('${note.id}')" style="background: rgba(255, 100, 130, .12); border-color: rgba(255, 100, 130, .25);">Delete</button>`;
      div.appendChild(actionDiv);

      div.ondragstart = () => {
        draggedNoteId = note.id;
        div.classList.add("dragging");
      };

      div.ondragend = () => {
        draggedNoteId = null;
        div.classList.remove("dragging");
      };

      div.ondragover = e => e.preventDefault();
      div.ondrop = () => reorderNote(note.id, folderName);

      notesWrap.appendChild(div);
    });

    folder.appendChild(header);
    folder.appendChild(notesWrap);
    foldersEl.appendChild(folder);
  });

  uxUpdateTagSuggestions();
  renderEmptyState();
  renderRecentlyEdited();
}

function deleteFolder(folderName) {
  const c = current();
  if (!c || folderName === "Unsorted") return;
  if (!confirm(`Delete folder "${folderName}"? Notes will move to Unsorted.`)) return;
  
  c.notes.filter(n => n.folder === folderName).forEach(n => {
    n.folder = "Unsorted";
    n.order = nextOrder("Unsorted");
  });
  
  c.folders = c.folders.filter(f => f !== folderName);
  save();
  renderFolders();
}

// UX feature: Drag/rearrange note folders
function reorderNoteFolders(draggedFolder, targetFolder) {
  const c = current();
  if (!c) return;
  if (draggedFolder === targetFolder || draggedFolder === "Unsorted") return;

  const folders = c.folders.filter(f => f !== "Unsorted");
  const fromIdx = folders.indexOf(draggedFolder);
  if (fromIdx === -1) return;

  let toIdx = 0;
  if (targetFolder !== "Unsorted") {
    toIdx = folders.indexOf(targetFolder);
    if (toIdx === -1) return;
  }

  folders.splice(fromIdx, 1);
  folders.splice(toIdx, 0, draggedFolder);
  c.folders = ["Unsorted", ...folders];
  save();
  renderFolders();
}

function deleteNoteDirectly(noteId) {
  if (!confirm("Delete this note?")) return;
  const c = current();
  c.notes = c.notes.filter(n => n.id !== noteId);
  save();
  renderFolders();
}

function moveNoteToFolder(folderName) {
  const c = current();
  const note = c.notes.find(n => n.id === draggedNoteId);
  if (!note) return;

  note.folder = folderName;
  note.order = nextOrder(folderName);
  save();
  renderFolders();
}

function reorderNote(targetNoteId, folderName) {
  const c = current();
  const dragged = c.notes.find(n => n.id === draggedNoteId);
  const target = c.notes.find(n => n.id === targetNoteId);
  if (!dragged || !target) return;

  if (dragged.folder !== folderName) {
    dragged.folder = folderName;
  }

  const notes = c.notes
    .filter(n => n.folder === folderName && n.id !== dragged.id)
    .sort((a,b) => a.order - b.order);

  const newList = [];
  notes.forEach(n => {
    if (n.id === target.id) newList.push(dragged);
    newList.push(n);
  });

  newList.forEach((n, i) => n.order = i);
  save();
  renderFolders();
}

function nextOrder(folderName, forChar = null) {
  const c = forChar || current();
  if (!c || !c.notes) return 0;
  const notes = c.notes.filter(n => n.folder === folderName);
  return notes.length;
}

/* ---------- ADD NOTE ---------- */
addNote.onclick = () => {
  const c = current();
  if (!c) return;

  const tags = noteTags.value.split(",").map(t => t.trim()).filter(Boolean);
  
  const note = {
    id: uid(),
    story: storyName.value || "Unsorted",
    chapter: chapterName.value || "",
    text: noteText.value,
    summaryText: noteSummary.value || "",
    images: pastedImages,
    tags: tags,
    folder: "Unsorted",
    order: nextOrder("Unsorted"),
    reactions: {},
    updatedAt: new Date().toISOString()
  };

  c.notes.push(note);
  uxTouchNote(note);

  // Add note to tagged characters
  tags.forEach(tag => {
    const taggedChar = db.characters.find(ch => ch.name.toLowerCase() === tag.toLowerCase());
    if (taggedChar && taggedChar.id !== c.id) {
      if (!taggedChar.notes) taggedChar.notes = [];
      const exists = taggedChar.notes.some(n => n.id === note.id);
      if (!exists) {
        taggedChar.notes.push({...note, folder: "Unsorted", order: nextOrder("Unsorted", taggedChar)});
      }
    }
  });

  storyName.value = "";
  chapterName.value = "";
  noteText.value = "";
  noteSummary.value = "";
  noteTags.value = "";
  pastedImages = [];
  renderPastedImages();
  imageInput.value = "";
  uxSyncTagPills(noteTags, uxTagList);
  save();
  renderFolders();
};

addFolder.onclick = () => {
  const c = current();
  if (!c) return;
  const name = newFolderName.value.trim();
  if (!name || c.folders.includes(name)) {
    showToast("Invalid or duplicate folder name");
    return;
  }
  c.folders.push(name);
  newFolderName.value = "";
  save();
  renderFolders();
};

/* ---------- NOTE MODAL ---------- */
function openNoteModal(noteId) {
  const c = current();
  const note = c.notes.find(n => n.id === noteId);
  if (!note) return;

  editingNoteId = noteId;
  document.getElementById("modalTitle").textContent = `Edit: ${note.story} — ${note.chapter}`;
  document.getElementById("modalStoryName").value = note.story;
  document.getElementById("modalChapterName").value = note.chapter;
  document.getElementById("modalNoteText").value = note.text;
  modalNoteSummary.value = note.summaryText || "";
  document.getElementById("modalNoteTags").value = (note.tags || []).join(", ");
  uxSyncTagPills(modalNoteTags, uxModalTagList);
  uxUpdateTagSuggestions();

  const reactionsBtn = document.getElementById("reactionButtons");
  reactionsBtn.innerHTML = REACTIONS.map(emoji => 
    `<button class="emoji-btn ${note.reactions?.[emoji] > 0 ? "selected" : ""}" onclick="toggleReaction('${emoji}')">${emoji} ${note.reactions?.[emoji] || ""}</button>`
  ).join("");

  const imagesDiv = document.getElementById("modalImages");
  imagesDiv.innerHTML = "";
  
  const label = document.createElement("strong");
  label.textContent = `Images (${note.images.length}):`;
  imagesDiv.appendChild(label);
  
  // Add file input for uploading new images
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.multiple = true;
  fileInput.style.cssText = "margin: 8px 0; width: 100%;";
  fileInput.onchange = (e) => {
    const files = Array.from(e.target.files);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = ev => {
        note.images.push(ev.target.result);
        uxTouchNote(note);
        save();
        openNoteModal(editingNoteId); // Re-render modal
      };
      reader.readAsDataURL(file);
    });
  };
  imagesDiv.appendChild(fileInput);
  
  if (note.images.length > 0) {
    const grid = document.createElement("div");
    grid.className = "images-grid";
    note.images.forEach((img, i) => {
      const container = document.createElement("div");
      container.style.position = "relative";
      
      const imgEl = document.createElement("img");
      imgEl.src = img;
      imgEl.onclick = () => openLightbox(img);
      container.appendChild(imgEl);
      
      const removeBtn = document.createElement("button");
      removeBtn.textContent = "✕";
      removeBtn.style.cssText = "position: absolute; top: 2px; right: 2px; background: rgba(0,0,0,.6); color: #fff; border: none; width: 20px; height: 20px; border-radius: 50%; cursor: pointer; font-size: 12px; display: flex; align-items: center; justify-content: center;";
      removeBtn.onclick = (e) => {
        e.stopPropagation();
        removeImage(i);
      };
      container.appendChild(removeBtn);
      
      grid.appendChild(container);
    });
    imagesDiv.appendChild(grid);
  }

  noteModal.classList.add("open");
}

function closeNoteModal() {
  editingNoteId = null;
  noteModal.classList.remove("open");
}

function toggleReaction(emoji) {
  const c = current();
  const note = c.notes.find(n => n.id === editingNoteId);
  if (!note) return;

  if (!note.reactions) note.reactions = {};
  note.reactions[emoji] = (note.reactions[emoji] || 0) + 1;
  uxTouchNote(note);
  
  const btn = event.target;
  btn.classList.toggle("selected");
  
  // Update the button text
  const newText = `${emoji} ${note.reactions[emoji]}`;
  btn.innerHTML = newText;
  
  save();
}

function removeImage(idx) {
  if (!confirm('Remove this image from the note?')) return;
  const c = current();
  const note = c.notes.find(n => n.id === editingNoteId);
  if (!note) return;
  note.images.splice(idx, 1);
  uxTouchNote(note);
  save();
  openNoteModal(editingNoteId); // Refresh modal
}

document.getElementById("saveNoteModal").onclick = () => {
  const c = current();
  const note = c.notes.find(n => n.id === editingNoteId);
  if (!note) return;

  const oldTags = [...note.tags];
  note.story = document.getElementById("modalStoryName").value;
  note.chapter = document.getElementById("modalChapterName").value;
  note.text = document.getElementById("modalNoteText").value;
  note.summaryText = modalNoteSummary.value || "";
  note.tags = document.getElementById("modalNoteTags").value.split(",").map(t => t.trim()).filter(Boolean);
  uxTouchNote(note);

  // Sync this note to all tagged characters
  // For each tag (character name), find that character and update their version of this note
  note.tags.forEach(tagName => {
    const taggedChar = db.characters.find(ch => ch.name === tagName);
    if (taggedChar) {
      const taggedNote = taggedChar.notes.find(n => n.id === note.id);
      if (taggedNote) {
        // Update the note for the tagged character
        taggedNote.story = note.story;
        taggedNote.chapter = note.chapter;
        taggedNote.text = note.text;
        taggedNote.summaryText = note.summaryText;
        taggedNote.tags = note.tags;
        taggedNote.updatedAt = note.updatedAt;
      }
    }
  });
  
  // Also remove this note from characters that were previously tagged but no longer are
  oldTags.forEach(oldTag => {
    if (!note.tags.includes(oldTag)) {
      const untaggedChar = db.characters.find(ch => ch.name === oldTag);
      if (untaggedChar) {
        const untaggedNote = untaggedChar.notes.find(n => n.id === note.id);
        if (untaggedNote) {
          // Remove this note from the untagged character
          untaggedChar.notes = untaggedChar.notes.filter(n => n.id !== note.id);
        }
      }
    }
  });

  save();
  closeNoteModal();
  renderFolders();
};

document.getElementById("deleteNoteModal").onclick = () => {
  if (!confirm("Delete this note?")) return;
  const c = current();
  c.notes = c.notes.filter(n => n.id !== editingNoteId);
  save();
  closeNoteModal();
  renderFolders();
};

/* ---------- IMAGE LIGHTBOX ---------- */
function openLightbox(imageSrc) {
  document.getElementById("lightboxImage").src = imageSrc;
  imageLightbox.classList.add("open");
}

function closeLightbox() {
  imageLightbox.classList.remove("open");
}

imageLightbox.onclick = (e) => {
  if (e.target === imageLightbox) closeLightbox();
};

/* ---------- IMAGE PASTE ---------- */
function renderPastedImages() {
  const preview = document.getElementById("pastedImagesPreview");
  if (pastedImages.length === 0) {
    preview.innerHTML = "";
    return;
  }
  preview.innerHTML = "";
  pastedImages.forEach((img, i) => {
    const container = document.createElement("div");
    container.className = "pasted-image-item";
    const imgEl = document.createElement("img");
    imgEl.src = img;
    container.appendChild(imgEl);
    const removeBtn = document.createElement("button");
    removeBtn.className = "pasted-image-remove";
    removeBtn.innerHTML = "✕";
    removeBtn.onclick = () => {
      pastedImages.splice(i, 1);
      renderPastedImages();
    };
    container.appendChild(removeBtn);
    preview.appendChild(container);
  });
}

noteText.addEventListener("paste", e => {
  [...e.clipboardData.items].forEach(item => {
    if (item.type.startsWith("image/")) {
      const file = item.getAsFile();
      const reader = new FileReader();
      reader.onload = ev => {
        pastedImages.push(ev.target.result);
        renderPastedImages();
      };
      reader.readAsDataURL(file);
    }
  });
});

imageInput.onchange = () => {
  const file = imageInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    pastedImages.push(ev.target.result);
    renderPastedImages();
  };
  reader.readAsDataURL(file);
};

/* ---------- CHARACTER DETAILS ---------- */
charName.oninput = () => {
  const c = current();
  if (c) {
    c.name = charName.value;
    uxTouchCharacter(c);
    markUnsaved();
    save();
    renderCharacters();
  }
};
charRole.oninput = () => {
  const c = current();
  if (c) {
    c.role = charRole.value;
    uxTouchCharacter(c);
    markUnsaved();
    save();
  }
};
charDesc.oninput = () => {
  const c = current();
  if (c) {
    c.desc = charDesc.value;
    uxTouchCharacter(c);
    markUnsaved();
    save();
  }
};

/* ---------- TEXT MESSAGES ---------- */
viewTextMessages.onclick = () => {
  charPanel.style.display = "none";
  textMessagesPanel.style.display = "flex";
  galleryPanel.style.display = "none";
};

backToNotes.onclick = () => {
  charPanel.style.display = "flex";
  textMessagesPanel.style.display = "none";
  galleryPanel.style.display = "none";
};

function renderTextMessages() {
  const c = current();
  if (!c) return;
  messagesContainer.innerHTML = "";
  (c.messages || []).forEach(msg => {
    const div = document.createElement("div");
    div.className = `message ${msg.isUser ? "user" : "other"}`;
    div.innerHTML = `
      <div>
        <div class="message-bubble">${msg.text}</div>
        <div class="message-time">${new Date(msg.timestamp).toLocaleTimeString()}</div>
      </div>
    `;
    messagesContainer.appendChild(div);
  });
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
};

sendTextMessage.onclick = () => {
  const c = current();
  if (!c || !textMessageInput.value.trim()) return;

  c.messages = c.messages || [];
  c.messages.push({
    text: textMessageInput.value,
    isUser: true,
    timestamp: new Date().toISOString()
  });

  textMessageInput.value = "";
  save();
  renderTextMessages();
};

textMessageInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendTextMessage.click();
  }
});

/* ---------- SEARCH ---------- */
searchNotes.addEventListener("input", (e) => {
  const query = e.target.value.toLowerCase();
  if (!query) {
    searchResults.innerHTML = "";
    return;
  }
  
  const c = current();
  if (!c) return;
  
  const results = [];
  const seen = new Set();
  c.notes.forEach(n => {
    if (seen.has(n.id)) return;
    const reactionEmojis = n.reactions
      ? Object.keys(n.reactions).filter(e => n.reactions[e] > 0).join(" ")
      : "";
    if (
      (n.text || "").toLowerCase().includes(query) ||
      (n.story || "").toLowerCase().includes(query) ||
      (n.chapter || "").toLowerCase().includes(query) ||
      (n.summaryText || "").toLowerCase().includes(query) ||
      reactionEmojis.toLowerCase().includes(query)
    ) {
      results.push(n);
      seen.add(n.id);
    }
  });
  
  searchResults.innerHTML = results.length ? 
    `<strong>${results.length} result(s) found:</strong>` : 
    "<p>No results found</p>";
  
  results.forEach(note => {
    const div = document.createElement("div");
    div.className = "search-result";
    div.style.padding = "12px";
    div.style.background = "#f0f7ff";
    div.style.borderRadius = "8px";
    div.style.borderLeft = "4px solid #2b8fba";
    div.style.cursor = "pointer";
    div.onclick = () => openNoteModal(note.id);
    div.innerHTML = `<strong>${note.story} — ${note.chapter}</strong><br><small>${note.text.substring(0, 80)}...</small>`;
    searchResults.appendChild(div);
  });
});

function clearSearch() {
  searchNotes.value = "";
  searchResults.innerHTML = "";
}

/* ---------- RELATIONSHIPS ---------- */
function openRelationshipsPanel() {
  relationshipsPanel.classList.add("panel-open");
  document.getElementById("relationshipBackdrop").classList.add("open");
  selectedRelationships = [];
  renderRelationshipSelectors();
}

function closeRelationshipsPanel() {
  relationshipsPanel.classList.remove("panel-open");
  document.getElementById("relationshipBackdrop").classList.remove("open");
  selectedRelationships = [];
  updateAppellationSection();
  renderRelationshipNotes();
}

viewRelationships.onclick = () => {
  openRelationshipsPanel();
};

/* ---------- FAMILY RELATIONSHIPS ---------- */
function openFamilyPanel() {
  document.getElementById('familyPanel').classList.add('panel-open');
  document.getElementById('familyBackdrop').classList.add('open');
  renderFamilyMembers();
}

function closeFamilyPanel() {
  document.getElementById('familyPanel').classList.remove('panel-open');
  document.getElementById('familyBackdrop').classList.remove('open');
}

document.getElementById('viewFamily').onclick = () => {
  openFamilyPanel();
};

function renderFamilyMembers() {
  const c = current();
  if (!c) return;
  if (!c.family) c.family = {};
  
  const list = document.getElementById('familyMembersList');
  list.innerHTML = '';
  
  Object.entries(c.family).forEach(([relId, relData]) => {
    const relChar = db.characters.find(ch => ch.id === relId);
    if (!relChar) return;
    
    const item = document.createElement('div');
    item.style.cssText = 'margin: 12px 0; padding: 12px; background: #fff; border: 1.5px solid #ffe0d0; border-radius: 8px;';
    
    const title = document.createElement('div');
    title.style.cssText = 'font-weight: 600; color: #d75a8f; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;';
    title.innerHTML = `<span>${relData.type} - ${relChar.name}</span>`;
    
    const removeBtn = document.createElement('button');
    removeBtn.textContent = '✕';
    removeBtn.style.cssText = 'width: auto; padding: 4px 8px; margin: 0; font-size: 12px; background: rgba(255,100,130,.15); border-color: rgba(255,100,130,.3); color: #d75a8f;';
    removeBtn.onclick = () => {
      delete c.family[relId];
      if (relChar.family && relChar.family[c.id]) {
        delete relChar.family[c.id];
      }
      save();
      renderFamilyMembers();
    };
    
    title.appendChild(removeBtn);
    item.appendChild(title);
    
    const noteLabel = document.createElement('label');
    noteLabel.style.cssText = 'font-size: 12px; color: #999; display: block; margin-bottom: 4px;';
    noteLabel.textContent = 'Relationship note:';
    item.appendChild(noteLabel);
    
    const noteInput = document.createElement('textarea');
    const reciprocalNote = relChar.family && relChar.family[c.id] ? relChar.family[c.id].note : '';
    const sharedNote = relData.note || reciprocalNote || '';
    noteInput.value = sharedNote;
    noteInput.style.cssText = 'width: 100%; min-height: 60px; padding: 8px; font-size: 12px; border: 1px solid #ffe0d0; border-radius: 4px; font-family: inherit;';
    noteInput.oninput = () => {
      c.family[relId].note = noteInput.value;
      if (!relChar.family) relChar.family = {};
      if (!relChar.family[c.id]) {
        relChar.family[c.id] = { type: relData.type || "Family", note: "" };
      }
      relChar.family[c.id].note = noteInput.value;
      save();
    };
    item.appendChild(noteInput);
    
    list.appendChild(item);
  });
}

function addFamilyMember() {
  const c = current();
  if (!c) return;
  if (!c.family) c.family = {};

  const relType = document.getElementById('familyRelationType').value.trim();
  const charName = document.getElementById('familyCharacterName').value.trim();
  const messageDiv = document.getElementById('familyMessage');

  messageDiv.innerHTML = '';

  if (!relType) {
    messageDiv.innerHTML = 'Please enter a relationship type (e.g., Mother, Brother)';
    return;
  }

  if (!charName) {
    messageDiv.innerHTML = 'Please enter a character name';
    return;
  }

  // Find the target character
  const targetChar = db.characters.find(ch => ch.name.toLowerCase() === charName.toLowerCase());
  if (!targetChar) {
    messageDiv.innerHTML = 'Character not found. Please select from the suggestions or ensure the character exists.';
    return;
  }

  if (targetChar.id === c.id) {
    messageDiv.innerHTML = 'Cannot add yourself as a family member';
    return;
  }

  c.family[targetChar.id] = {
    type: relType,
    note: '',
    createdAt: new Date().toISOString()
  };
  if (!targetChar.family) targetChar.family = {};
  if (!targetChar.family[c.id]) {
    targetChar.family[c.id] = {
      type: relType,
      note: '',
      createdAt: new Date().toISOString()
    };
  }

  document.getElementById('familyRelationType').value = '';
  document.getElementById('familyCharacterName').value = '';
  document.getElementById('familyCharacterSuggestions').innerHTML = '';
  messageDiv.innerHTML = '';
  save();
  renderFamilyMembers();
}

function updateFamilyCharacterSuggestions() {
  const input = document.getElementById('familyCharacterName');
  const suggestionsDiv = document.getElementById('familyCharacterSuggestions');
  const query = input.value.toLowerCase().trim();

  if (!query) {
    suggestionsDiv.innerHTML = '';
    return;
  }

  const c = current();
  const availableChars = db.characters.filter(ch =>
    ch.id !== (c ? c.id : null) &&
    ch.name.toLowerCase().includes(query)
  );

  if (availableChars.length === 0) {
    suggestionsDiv.innerHTML = '<div style="padding: 8px; color: #999; font-size: 12px;">No characters found</div>';
    return;
  }

  suggestionsDiv.innerHTML = availableChars.map(ch => `
    <div style="padding: 8px; cursor: pointer; border-radius: 4px; background: rgba(215, 90, 143, .08); margin-bottom: 2px; font-size: 12px;" onclick="selectFamilyCharacter('${ch.name}')">
      ${ch.name}
    </div>
  `).join('');
}

function selectFamilyCharacter(name) {
  document.getElementById('familyCharacterName').value = name;
  document.getElementById('familyCharacterSuggestions').innerHTML = '';
}

function renderRelationshipSelectors() {
  relationshipCharSelector.innerHTML = "";
  db.characters.forEach(c => {
    if (c.id === activeChar) return; // Don't include self
    const btn = document.createElement("button");
    btn.className = "char-select-btn";
    btn.textContent = c.name;
    btn.onclick = () => {
      if (selectedRelationships.includes(c.id)) {
        selectedRelationships = selectedRelationships.filter(id => id !== c.id);
        btn.classList.remove("selected");
      } else {
        selectedRelationships.push(c.id);
        btn.classList.add("selected");
      }
      updateAppellationSection();
      renderRelationshipNotes();
    };
    relationshipCharSelector.appendChild(btn);
  });
}

function updateAppellationSection() {
  const appellationSection = document.getElementById("appellationSection");
  const appellationLabel = document.getElementById("appellationLabel");
  const appellationFrom = document.getElementById("appellationFrom");
  const appellationTo = document.getElementById("appellationTo");
  
  if (selectedRelationships.length !== 1) {
    appellationSection.style.display = "none";
    return;
  }
  
  appellationSection.style.display = "block";
  const otherChar = db.characters.find(c => c.id === selectedRelationships[0]);
  const currentChar = current();
  
  appellationLabel.textContent = `${currentChar.name} ↔ ${otherChar.name}`;
  
  // Initialize appellation data if it doesn't exist
  if (!currentChar.appellations) currentChar.appellations = {};
  if (!otherChar.appellations) otherChar.appellations = {};
  if (!currentChar.appellations[otherChar.id] && otherChar.appellations[currentChar.id]) {
    const mirrored = otherChar.appellations[currentChar.id];
    currentChar.appellations[otherChar.id] = { from: mirrored.to || "", to: mirrored.from || "" };
  }
  if (!currentChar.appellations[otherChar.id]) {
    currentChar.appellations[otherChar.id] = { from: "", to: "" };
  }
  if (!otherChar.appellations[currentChar.id]) {
    otherChar.appellations[currentChar.id] = { from: "", to: "" };
  }
  
  const appellation = currentChar.appellations[otherChar.id];
  appellationFrom.value = appellation.from || "";
  appellationTo.value = appellation.to || "";
  
  appellationFrom.oninput = () => {
    currentChar.appellations[otherChar.id].from = appellationFrom.value;
    otherChar.appellations[currentChar.id].to = appellationFrom.value;
    save();
  };
  appellationTo.oninput = () => {
    currentChar.appellations[otherChar.id].to = appellationTo.value;
    otherChar.appellations[currentChar.id].from = appellationTo.value;
    save();
  };
}

function renderRelationshipNotes() {
  const c = current();
  if (!c || selectedRelationships.length === 0) {
    relationshipNotes.innerHTML = "<p style='color: #999; padding: 20px; text-align: center;'>Select characters to view shared interactions</p>";
    return;
  }

  const query = relationshipSearch.value.toLowerCase();

  // Get selected character names
  const selectedNames = selectedRelationships.map(id =>
    db.characters.find(x => x.id === id)?.name
  ).filter(Boolean);

  const requiresAllSelected = (note) => {
    const tags = note.tags || [];
    return selectedNames.every(name => tags.includes(name));
  };

  // 1. Notes from current character that mention all selected characters
  const ownNotes = c.notes.filter(note => {
    if (!requiresAllSelected(note)) return false;
    if (!query) return true;
    return note.text.toLowerCase().includes(query) ||
           note.story.toLowerCase().includes(query);
  });

  // 2. Notes from selected characters that mention current character
  const otherNotes = [];
  selectedRelationships.forEach(selectedId => {
    const selectedChar = db.characters.find(ch => ch.id === selectedId);
    if (!selectedChar) return;

    selectedChar.notes.forEach(note => {
      // Must mention current character
      if (!note.tags.includes(c.name)) return;
      if (!requiresAllSelected(note)) return;

      // Apply search filter
      if (query && !note.text.toLowerCase().includes(query) &&
          !note.story.toLowerCase().includes(query)) return;

      otherNotes.push({
        ...note,
        fromCharacter: selectedChar.name,
        fromCharacterId: selectedChar.id
      });
    });
  });

  const allNotes = [];
  const seen = new Set();
  [...ownNotes, ...otherNotes].forEach(note => {
    if (seen.has(note.id)) return;
    seen.add(note.id);
    allNotes.push(note);
  });

  if (allNotes.length === 0) {
    relationshipNotes.innerHTML = "<p style='color: #999; padding: 20px; text-align: center;'>No shared interactions found</p>";
    return;
  }

  relationshipNotes.innerHTML = `<strong>Shared Interactions (${allNotes.length}):</strong>`;
  allNotes.forEach(note => {
    const div = document.createElement("div");
    div.className = "note";
    div.style.marginTop = "12px";
    div.style.cursor = "pointer";
    const noteFromOther = note.fromCharacter;
    const sourceText = noteFromOther ? ` <span style="font-size: 11px; color: #999;">(from ${noteFromOther})</span>` : '';

    div.onclick = () => {
      if (noteFromOther) {
        // Switch to other character's view
        const otherChar = db.characters.find(ch => ch.id === note.fromCharacterId);
        if (otherChar) {
          selectCharacter(otherChar.id);
          // Find and open the note
          setTimeout(() => openNoteModal(note.id), 100);
        }
      } else {
        openNoteModal(note.id);
      }
    };

    div.innerHTML = `
      <strong>${note.story} — ${note.chapter}${sourceText}</strong>
      <div>${note.text}</div>
      ${note.tags.length ? `<div class="note-tags">${note.tags.map(t => `<span class="note-tag">${t}</span>`).join("")}</div>` : ""}
    `;
    relationshipNotes.appendChild(div);
  });
}

relationshipSearch.addEventListener("input", renderRelationshipNotes);

function clearRelationshipSearch() {
  relationshipSearch.value = "";
  renderRelationshipNotes();
}

/* ---------- PDF EXPORT ---------- */
exportPDF.onclick = () => {
  const c = current();
  if (!c) return;
  
  // Create dialog for selecting relationship notes
  const dialog = document.createElement("div");
  dialog.style.cssText = "position: fixed; inset: 0; background: rgba(0,0,0,.4); z-index: 2000; display: flex; align-items: center; justify-content: center; padding: 20px;";
  
  const content = document.createElement("div");
  content.style.cssText = "background: #fff5f0; border: 2px solid rgba(215, 90, 143, .30); border-radius: 14px; padding: 28px; max-width: 450px; width: 100%;";
  
  const title = document.createElement("h3");
  title.textContent = "Export Notes";
  title.style.cssText = "color: #d75a8f; margin: 0 0 20px 0;";
  content.appendChild(title);
  
  const desc = document.createElement("p");
  desc.textContent = "Include relationship notes from:";
  desc.style.cssText = "color: #2d2d2d; margin: 0 0 12px 0; font-size: 16px;";
  content.appendChild(desc);
  
  const checkboxContainer = document.createElement("div");
  checkboxContainer.style.cssText = "margin: 16px 0; max-height: 200px; overflow-y: auto;";
  
  const selectedRels = new Set();
  
  db.characters.forEach(char => {
    if (char.id === c.id) return;
    
    const label = document.createElement("label");
    label.style.cssText = "display: flex; align-items: center; padding: 8px; cursor: pointer; border-radius: 6px; margin: 4px 0; transition: all .15s;";
    label.onmouseover = () => label.style.background = "rgba(215, 90, 143, .08)";
    label.onmouseout = () => label.style.background = "transparent";
    
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.style.cssText = "margin-right: 10px; cursor: pointer; width: 18px; height: 18px;";
    checkbox.onchange = (e) => {
      if (e.target.checked) selectedRels.add(char.id);
      else selectedRels.delete(char.id);
    };
    
    const labelText = document.createElement("span");
    labelText.textContent = char.name;
    labelText.style.cssText = "font-size: 15px;";
    
    label.appendChild(checkbox);
    label.appendChild(labelText);
    checkboxContainer.appendChild(label);
  });
  
  content.appendChild(checkboxContainer);
  
  const buttonContainer = document.createElement("div");
  buttonContainer.style.cssText = "display: flex; gap: 10px; margin-top: 20px;";
  
  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Cancel";
  cancelBtn.style.cssText = "flex: 1; padding: 12px; background: rgba(200, 200, 200, .2); border: 1px solid #ccc; border-radius: 8px; cursor: pointer; font-size: 15px;";
  cancelBtn.onclick = () => dialog.remove();
  
  const exportBtn = document.createElement("button");
  exportBtn.textContent = "Export PDF";
  exportBtn.style.cssText = "flex: 1; padding: 12px; background: rgba(215, 90, 143, .2); border: 1.5px solid rgba(215, 90, 143, .5); border-radius: 8px; cursor: pointer; font-size: 15px; color: #d75a8f; font-weight: 600;";
  exportBtn.onclick = () => {
    generatePDF(c, selectedRels);
    dialog.remove();
  };
  
  buttonContainer.appendChild(cancelBtn);
  buttonContainer.appendChild(exportBtn);
  content.appendChild(buttonContainer);
  
  dialog.appendChild(content);
  document.body.appendChild(dialog);
};

function generatePDF(c, selectedRelationshipIds) {
  const content = document.createElement("div");
  content.style.padding = "20px";
  content.style.fontFamily = "Arial, sans-serif";
  content.style.color = "#333";
  
  const title = document.createElement("h1");
  title.textContent = c.name;
  content.appendChild(title);
  
  const meta = document.createElement("p");
  meta.innerHTML = `<strong>Role:</strong> ${c.role}<br><strong>Description:</strong> ${c.desc}`;
  content.appendChild(meta);
  
  const notesTitle = document.createElement("h2");
  notesTitle.textContent = "Notes";
  notesTitle.style.marginTop = "20px";
  content.appendChild(notesTitle);
  
  c.notes.forEach(note => {
    const noteDiv = document.createElement("div");
    noteDiv.style.marginBottom = "20px";
    noteDiv.style.borderLeft = "3px solid #d75a8f";
    noteDiv.style.paddingLeft = "15px";
    
    const noteTitle = document.createElement("h3");
    noteTitle.textContent = `${note.story} — ${note.chapter}`;
    noteTitle.style.margin = "0 0 10px 0";
    noteDiv.appendChild(noteTitle);
    
    const noteContent = document.createElement("p");
    noteContent.textContent = note.text;
    noteContent.style.margin = "0";
    noteDiv.appendChild(noteContent);
    
    content.appendChild(noteDiv);
  });
  
  // Add relationship notes if selected
  if (selectedRelationshipIds.size > 0) {
    const relTitle = document.createElement("h2");
    relTitle.textContent = "Relationship Notes";
    relTitle.style.marginTop = "30px";
    relTitle.style.borderTop = "2px solid #d75a8f";
    relTitle.style.paddingTop = "20px";
    content.appendChild(relTitle);
    
    selectedRelationshipIds.forEach(charId => {
      const relChar = db.characters.find(ch => ch.id === charId);
      if (!relChar) return;
      
      const relSection = document.createElement("div");
      relSection.style.marginTop = "20px";
      relSection.style.padding = "15px";
      relSection.style.background = "#f9f9f9";
      relSection.style.borderRadius = "8px";
      
      const relTitle = document.createElement("h3");
      relTitle.textContent = `With ${relChar.name}`;
      relTitle.style.margin = "0 0 15px 0";
      relTitle.style.color = "#d75a8f";
      relSection.appendChild(relTitle);
      
      const relNotes = c.notes.filter(note => note.tags && note.tags.includes(relChar.name));
      
      if (relNotes.length === 0) {
        const noNotes = document.createElement("p");
        noNotes.textContent = "No notes with this character";
        noNotes.style.color = "#999";
        noNotes.style.margin = "0";
        relSection.appendChild(noNotes);
      } else {
        relNotes.forEach(note => {
          const noteDiv = document.createElement("div");
          noteDiv.style.marginBottom = "15px";
          noteDiv.style.paddingBottom = "15px";
          noteDiv.style.borderBottom = "1px solid #eee";
          
          const noteTitle = document.createElement("p");
          noteTitle.innerHTML = `<strong>${note.story} — ${note.chapter}</strong>`;
          noteTitle.style.margin = "0 0 8px 0";
          noteDiv.appendChild(noteTitle);
          
          const noteText = document.createElement("p");
          noteText.textContent = note.text;
          noteText.style.margin = "0";
          noteDiv.appendChild(noteText);
          
          relSection.appendChild(noteDiv);
        });
      }
      
      content.appendChild(relSection);
    });
  }
  
  const element = document.createElement("div");
  element.innerHTML = content.innerHTML;
  
  const opt = {
    margin: 10,
    filename: `${c.name}_notes.pdf`,
    image: { type: "jpeg", quality: 0.98 },
    html2canvas: { scale: 2 },
    jsPDF: { orientation: "portrait", unit: "mm", format: "a4" }
  };
  
  html2pdf().set(opt).from(element).save();
}

/* ---------- EXPAND PANELS ---------- */
function togglePanelExpand(panelOrId) {
  const panel = typeof panelOrId === "string" ? document.getElementById(panelOrId) : panelOrId;
  panel.classList.toggle("expanded");
}

/* ---------- GALLERY ---------- */
viewGallery.onclick = () => {
  charPanel.style.display = "none";
  textMessagesPanel.style.display = "none";
  galleryPanel.style.display = "flex";
  renderGallery();
};

backToNotesGallery.onclick = () => {
  charPanel.style.display = "flex";
  galleryPanel.style.display = "none";
};

function renderGallery() {
  const c = current();
  if (!c) return;
  
  const galleryContent = document.getElementById("galleryContent");
  
  // Collect all images with their note info
  const allImages = [];
  c.notes.forEach(note => {
    note.images.forEach(img => {
      allImages.push({
        src: img,
        story: note.story,
        chapter: note.chapter,
        noteId: note.id
      });
    });
  });

  if (allImages.length === 0) {
    galleryContent.innerHTML = "<p style='color: #b7b3da; text-align: center; padding: 40px 20px; font-size: 16px;'>No images yet. Add some notes with images!</p>";
    return;
  }

  let html = `<div class="gallery-grid">`;
  allImages.forEach(item => {
    html += `
      <div class="gallery-item" onclick="openLightbox('${item.src}')">
        <img src="${item.src}" alt="${item.story}">
        <div class="gallery-item-label">${item.story}${item.chapter ? ' — ' + item.chapter : ''}</div>
      </div>
    `;
  });
  html += `</div>`;
  galleryContent.innerHTML = html;
}

function updateLastSavedDisplay() {
  const display = document.getElementById('lastSavedDisplay');
  if (lastSaved) {
    const date = new Date(lastSaved);
    display.textContent = `Last saved: ${date.toLocaleString()}`;
  } else {
    display.textContent = 'Not saved yet';
  }
}

function updateBreadcrumb() {
  const breadcrumb = document.getElementById('breadcrumb');
  breadcrumb.innerHTML = '';

  if (!activeChar) return;

  // Always show "Characters"
  const charactersItem = document.createElement('span');
  charactersItem.className = 'breadcrumb-item';
  charactersItem.textContent = 'Characters';
  charactersItem.onclick = () => {
    clearCharacterSelection();
  };
  breadcrumb.appendChild(charactersItem);

  if (activeChar) {
    const c = current();
    if (c) {
      // Separator
      const sep1 = document.createElement('span');
      sep1.className = 'breadcrumb-separator';
      sep1.textContent = ' → ';
      breadcrumb.appendChild(sep1);

      // Character name
      const charItem = document.createElement('span');
      charItem.className = 'breadcrumb-item';
      charItem.textContent = c.name;
      charItem.onclick = () => selectCharacter(activeChar);
      breadcrumb.appendChild(charItem);

      // Check current view
      const charPanel = document.getElementById('charPanel');
      const textMessagesPanel = document.getElementById('textMessagesPanel');
      const galleryPanel = document.getElementById('galleryPanel');
      const relationshipsPanel = document.getElementById('relationshipsPanel');

      if (textMessagesPanel.style.display === 'flex') {
        const sep2 = document.createElement('span');
        sep2.className = 'breadcrumb-separator';
        sep2.textContent = ' → ';
        breadcrumb.appendChild(sep2);

        const messagesItem = document.createElement('span');
        messagesItem.className = 'breadcrumb-item';
        messagesItem.textContent = 'Text Messages';
        breadcrumb.appendChild(messagesItem);
      } else if (galleryPanel.style.display === 'flex') {
        const sep2 = document.createElement('span');
        sep2.className = 'breadcrumb-separator';
        sep2.textContent = ' → ';
        breadcrumb.appendChild(sep2);

        const galleryItem = document.createElement('span');
        galleryItem.className = 'breadcrumb-item';
        galleryItem.textContent = 'Image Gallery';
        breadcrumb.appendChild(galleryItem);
      } else if (relationshipsPanel.classList.contains('panel-open')) {
        const sep2 = document.createElement('span');
        sep2.className = 'breadcrumb-separator';
        sep2.textContent = ' → ';
        breadcrumb.appendChild(sep2);

        const relationshipsItem = document.createElement('span');
        relationshipsItem.className = 'breadcrumb-item';
        relationshipsItem.textContent = 'Relationships';
        breadcrumb.appendChild(relationshipsItem);
      }
    }
  }
}

function updatePanelDimming() {
  const panels = document.querySelectorAll('.panel');
  panels.forEach(panel => {
    panel.classList.remove('dimmed');
  });
}

function exportBackup() {
  const dataStr = JSON.stringify(db, null, 2);
  const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
  const exportFileDefaultName = `character_ecology_backup_${new Date().toISOString().split('T')[0]}.json`;
  const linkElement = document.createElement('a');
  linkElement.setAttribute('href', dataUri);
  linkElement.setAttribute('download', exportFileDefaultName);
  linkElement.click();
  uxMarkSaved();
}

function importBackup() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = e => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const importedData = JSON.parse(e.target.result);
          db = importedData;
          uxSuspendSaveBadge = true;
          save();
          uxSuspendSaveBadge = false;
          renderCharacters();
          showToast('Backup imported successfully!');
          uxMarkSaved();
        } catch (error) {
          showToast('Error importing backup: Invalid JSON file.');
        }
      };
      reader.readAsText(file);
    }
  };
  input.click();
}

// Warn before refresh/close if unsaved changes
window.addEventListener('beforeunload', function (e) {
  if (hasUnsavedChanges) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// Mark as unsaved when changes are made
function markUnsaved() {
  hasUnsavedChanges = true;
  uxMarkChanged();
}

// Call on load
updateLastSavedDisplay();

initializeDefaults();
renderCharacters();
save();
// UX feature: Initial UI sync
uxSyncTagPills(noteTags, uxTagList);
uxUpdateTagSuggestions();
uxMarkSaved();
uxInitialized = true;
renderEmptyState();
renderRecentlyEdited();
applySelectionView();

// METADATA EDIT MODAL FUNCTIONS
function openMetadataEditModal() {
  const modal = document.getElementById('metadataEditModal');
  const ageInput = document.getElementById('metadataAge');
  const birthdayInput = document.getElementById('metadataBirthday');
  const heightInput = document.getElementById('metadataHeight');
  const heightLabel = document.querySelector('label[for="metadataHeight"]');

  if (activeChar && db.characters.find(c => c.id === activeChar)) {
    const char = db.characters.find(c => c.id === activeChar);
    ageInput.value = char.age || '';
    birthdayInput.value = char.birthday || '';
    heightInput.value = char.height || '';
    if (char.hideHeight) {
      heightInput.style.display = "none";
      if (heightLabel) heightLabel.style.display = "none";
    } else {
      heightInput.style.display = "";
      if (heightLabel) heightLabel.style.display = "";
    }
  }

  modal.classList.add('open');
}

function saveMetadataEdit() {
  const ageInput = document.getElementById('metadataAge');
  const birthdayInput = document.getElementById('metadataBirthday');
  const heightInput = document.getElementById('metadataHeight');

  if (activeChar && db.characters.find(c => c.id === activeChar)) {
    const char = db.characters.find(c => c.id === activeChar);
    char.age = ageInput.value;
    char.birthday = birthdayInput.value;
    char.height = heightInput.value;
    uxTouchCharacter(char);
    save();
    updateMetadataFields();
    renderCharacters();
  }

  closeMetadataEditModal();
}

function closeMetadataEditModal() {
  document.getElementById('metadataEditModal').classList.remove('open');
}

// LEFT RESIZE FOR METADATA SIDEBAR
let isResizingLeft = false;
let startXLeft, startWidthLeft;

document.addEventListener('mousedown', (e) => {
  if (e.target.classList.contains('metadata-sidebar-left-width-resize-handle')) {
    isResizingLeft = true;
    startXLeft = e.clientX;
    startWidthLeft = document.getElementById('metadataPanel').offsetWidth;
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  }
});

document.addEventListener('mousemove', (e) => {
  if (isResizingLeft) {
    const dx = startXLeft - e.clientX;
    const newWidth = startWidthLeft + dx;
    if (newWidth > 200 && newWidth < window.innerWidth / 2) {
      document.getElementById('metadataPanel').style.width = newWidth + 'px';
    }
  }
});

document.addEventListener('mouseup', () => {
  if (isResizingLeft) {
    isResizingLeft = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }
});

// UX feature: Self test
window.__uxSelfTest = () => {
  const results = [];
  const record = (step, pass, detail = "") => {
    results.push({ step, pass: !!pass, detail });
  };

  const loadSampleData = () => {
    const sampleCharId = uid();
    const sampleNoteId = uid();
    db = {
      characters: [
        {
          id: sampleCharId,
          name: "Sample Character",
          role: "",
          desc: "",
          folder: "Unsorted",
          order: 0,
          folders: ["Unsorted"],
          notes: [
            {
              id: sampleNoteId,
              story: "Sample Story",
              chapter: "",
              text: "Sample note text.",
              summaryText: "",
              images: [],
              tags: [],
              folder: "Unsorted",
              order: 0,
              reactions: {},
              updatedAt: new Date().toISOString()
            }
          ],
          messages: [],
          updatedAt: new Date().toISOString()
        }
      ],
      dorms: [],
      units: [],
      others: [],
      characterFolders: [{ name: "Unsorted", children: [] }]
    };
    uxSuspendSaveBadge = true;
    save();
    uxSuspendSaveBadge = false;
    renderCharacters();
    selectCharacter(sampleCharId);
    uxMarkSaved();
  };

  const hadData = db.characters.length > 0 || uxCountNotes() > 0;
  let sampleLoaded = false;
  if (hadData) {
    const ok = confirm("Load sample data for UX self-test? This will overwrite current project.");
    if (ok) {
      loadSampleData();
      sampleLoaded = true;
      record("Load sample data", true, "Overwrote existing data after confirmation.");
    } else {
      record("Load sample data", false, "User declined overwrite.");
    }
  } else {
    loadSampleData();
    sampleLoaded = true;
    record("Load sample data", true, "Loaded sample data.");
  }

  const active = current();
  if (!active) {
    record("Add tag", false, "No active character available.");
    record("Mark unsaved/saved", false, "No active character available.");
    record("Recently edited ordering", false, "No active character available.");
    console.table(results);
    return results;
  }

  // Step 2: Add tag via existing flow
  storyName.value = "Arc Test";
  chapterName.value = "";
  noteText.value = "Testing tags.";
  uxTagInput.value = "timeline";
  uxAddTagFromInput(noteTags, uxTagList, uxTagInput);
  addNote.click();
  const addedNote = active.notes.find(n => (n.tags || []).includes("timeline"));
  record("Add tag", !!addedNote, addedNote ? "Tag added to note." : "Tag not found on note.");

  // Step 3: Mark unsaved/saved
  uxMarkChanged();
  uxUpdateSaveBadge();
  const unsavedOk = uxSavedBadge && uxSavedBadge.dataset.state === "unsaved";
  uxMarkSaved();
  const savedOk = uxSavedBadge && uxSavedBadge.dataset.state === "saved";
  record("Mark unsaved/saved", unsavedOk && savedOk, `Unsaved: ${unsavedOk}, Saved: ${savedOk}`);

  // Step 4: Recently edited ordering
  const noteA = {
    id: uid(),
    story: "Order A",
    chapter: "",
    text: "Older note.",
    summaryText: "",
    images: [],
    tags: [],
    folder: "Unsorted",
    order: active.notes.length,
    reactions: {},
    updatedAt: new Date(Date.now() - 60000).toISOString()
  };
  const noteB = {
    id: uid(),
    story: "Order B",
    chapter: "",
    text: "Newer note.",
    summaryText: "",
    images: [],
    tags: [],
    folder: "Unsorted",
    order: active.notes.length + 1,
    reactions: {},
    updatedAt: new Date().toISOString()
  };
  active.notes.push(noteA, noteB);
  save();
  renderFolders();
  renderRecentlyEdited();
  const firstRecent = uxRecentList.querySelector(".ux-recent-item");
  const orderOk = firstRecent && firstRecent.textContent.includes("Order B");
  record("Recently edited ordering", !!orderOk, orderOk ? "Newest item is first." : "Ordering did not match.");

  console.table(results);
  return results;
};
