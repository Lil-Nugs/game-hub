// Shared nav + meta loader for planning pages
async function initPlanning({ page }) {
  const navEl = document.getElementById('planning-nav');
  if (navEl) {
    navEl.innerHTML = `
      <a class="nav-brand" href="../../index.html">🎮 <span>Game Hub</span></a>
      <div class="nav-links">
        <a class="nav-link ${page === 'overview' ? 'active' : ''}" href="index.html">📋 Planning</a>
      </div>
      <div class="nav-meta" id="nav-meta"></div>
    `;
  }

  let meta = null;
  try {
    const res = await fetch('../../data/planning/meta.json');
    meta = await res.json();
  } catch (_) {}

  const metaEl = document.getElementById('nav-meta');
  if (metaEl && meta) {
    metaEl.textContent = `Updated ${meta.lastUpdated} · ${meta.planningOwner}`;
  }

  return meta;
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
