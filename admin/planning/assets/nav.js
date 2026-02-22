// Shared nav + meta loader for planning pages
// Call initPlanning({ page: 'overview' | 'roadmap' | 'decisions' | 'backlog' }) on DOMContentLoaded

const PAGES = [
  { id: 'overview',   label: '📋 Overview',   href: 'index.html' },
  { id: 'roadmap',    label: '🗺️ Roadmap',     href: 'roadmap.html' },
  { id: 'decisions',  label: '⚖️ Decisions',   href: 'decisions.html' },
  { id: 'backlog',    label: '🎯 Backlog',      href: 'human-backlog.html' },
];

async function initPlanning({ page }) {
  // Render nav
  const navEl = document.getElementById('planning-nav');
  if (navEl) {
    navEl.innerHTML = `
      <a class="nav-brand" href="../../index.html">🎮 <span>Game Hub</span></a>
      <div class="nav-links">
        ${PAGES.map(p => `<a class="nav-link ${p.id === page ? 'active' : ''}" href="${p.href}">${p.label}</a>`).join('')}
      </div>
      <div class="nav-meta" id="nav-meta">Loading…</div>
    `;
  }

  // Load meta
  let meta = null;
  try {
    const res = await fetch('../../data/planning/meta.json');
    meta = await res.json();
  } catch (_) {}

  const metaEl = document.getElementById('nav-meta');
  if (metaEl && meta) {
    metaEl.textContent = `Updated ${meta.lastUpdated} · ${meta.planningOwner}`;
  } else if (metaEl) {
    metaEl.textContent = '';
  }

  return meta;
}

// Escape HTML helper
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Badge helpers
function statusBadge(s) {
  const map = { active: 'active', planned: 'planned', idea: 'idea', parked: 'parked', done: 'done' };
  return `<span class="badge badge-${map[s] || 'parked'}">${esc(s)}</span>`;
}
function priorityBadge(p) {
  return `<span class="badge badge-${p}">${esc(p)}</span>`;
}
function horizonBadge(h) {
  const label = { short: 'Short-term', mid: 'Mid-term', long: 'Long-term' }[h] || h;
  return `<span class="badge badge-${h}">${esc(label)}</span>`;
}
function laneBadge(l) {
  const label = { now: 'Now', next: 'Next', later: 'Later' }[l] || l;
  return `<span class="badge badge-${l}">${esc(label)}</span>`;
}

// Filter UI builder
function buildFilters(containerId, options, allLabel, onFilter) {
  const el = document.getElementById(containerId);
  if (!el) return;
  let current = 'all';
  const render = () => {
    el.innerHTML = [{ value: 'all', label: allLabel }, ...options].map(o =>
      `<button class="filter-btn ${o.value === current ? 'active' : ''}" data-val="${esc(o.value)}">${esc(o.label)}</button>`
    ).join('');
    el.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        current = btn.dataset.val;
        render();
        onFilter(current);
      });
    });
  };
  render();
}
