/* ============================
   AGENTRY — Application Logic
   ============================ */

(function () {
  'use strict';

  // ==================== CONFIG ====================
  var API_BASE = 'https://api.agentry.com';

  // ==================== STATE ====================
  var AGENTS = window.AGENTS || []; // fallback to inline data if API fails
  var AGENTS_CACHE = []; // cache for panel data-index lookups (Brave-safe)
  let currentCategory = 'all';
  let searchQuery = '';
  let visibleCount = 12;
  let themeMode = null; // null = follow system

  // ==================== DOM REFS ====================
  const header = document.getElementById('header');
  const heroCanvas = document.getElementById('hero-canvas');
  const categoryContainer = document.getElementById('category-filters');
  const agentGrid = document.getElementById('agent-grid');
  const searchInput = document.getElementById('search-input');
  const showMoreWrapper = document.getElementById('show-more-wrapper');
  const showMoreBtn = document.getElementById('show-more-btn');
  const emptyState = document.getElementById('empty-state');
  const brokerForm = document.getElementById('broker-form');
  const formSuccess = document.getElementById('form-success');
  const themeToggle = document.querySelector('[data-theme-toggle]');
  const mobileMenuBtn = document.getElementById('mobile-menu-btn');
  const mobileNav = document.getElementById('mobile-nav');

  // ==================== THEME ====================
  function initTheme() {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    themeMode = prefersDark ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', themeMode);
    updateThemeIcon();
  }

  function toggleTheme() {
    themeMode = themeMode === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', themeMode);
    updateThemeIcon();
  }

  function updateThemeIcon() {
    if (!themeToggle) return;
    const isDark = themeMode === 'dark';
    themeToggle.setAttribute('aria-label', 'Switch to ' + (isDark ? 'light' : 'dark') + ' mode');
    themeToggle.innerHTML = isDark
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  }

  if (themeToggle) themeToggle.addEventListener('click', toggleTheme);
  initTheme();

  // ==================== MOBILE MENU ====================
  function closeMobileMenu() {
    mobileNav.classList.remove('active');
    document.body.style.overflow = '';
    mobileMenuBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h18M3 6h18M3 18h18"/></svg>';
    mobileMenuBtn.setAttribute('aria-label', 'Open menu');
  }
  window.closeMobileMenu = closeMobileMenu;

  if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener('click', function () {
      const isOpen = mobileNav.classList.toggle('active');
      document.body.style.overflow = isOpen ? 'hidden' : '';
      mobileMenuBtn.innerHTML = isOpen
        ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>'
        : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h18M3 6h18M3 18h18"/></svg>';
      mobileMenuBtn.setAttribute('aria-label', isOpen ? 'Close menu' : 'Open menu');
    });
  }

  // ==================== HEADER SCROLL ====================
  let lastScroll = 0;
  window.addEventListener('scroll', function () {
    const scrollY = window.scrollY;
    if (scrollY > 10) {
      header.classList.add('header--scrolled');
    } else {
      header.classList.remove('header--scrolled');
    }
    lastScroll = scrollY;
  }, { passive: true });

  // ==================== HERO CANVAS (DOT GRID) ====================
  function initHeroCanvas() {
    if (!heroCanvas) return;
    const ctx = heroCanvas.getContext('2d');
    let width, height, dots, animId;
    const DOT_SPACING = 40;
    const DOT_RADIUS = 1;
    const CONNECTION_DIST = 100;

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      const rect = heroCanvas.parentElement.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      heroCanvas.width = width * dpr;
      heroCanvas.height = height * dpr;
      heroCanvas.style.width = width + 'px';
      heroCanvas.style.height = height + 'px';
      ctx.scale(dpr, dpr);
      generateDots();
    }

    function generateDots() {
      dots = [];
      for (let x = 0; x < width + DOT_SPACING; x += DOT_SPACING) {
        for (let y = 0; y < height + DOT_SPACING; y += DOT_SPACING) {
          dots.push({
            x: x,
            y: y,
            ox: x,
            oy: y,
            vx: (Math.random() - 0.5) * 0.15,
            vy: (Math.random() - 0.5) * 0.15,
          });
        }
      }
    }

    let mouse = { x: -1000, y: -1000 };
    heroCanvas.parentElement.addEventListener('mousemove', function (e) {
      const rect = heroCanvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
    });
    heroCanvas.parentElement.addEventListener('mouseleave', function () {
      mouse.x = -1000;
      mouse.y = -1000;
    });

    function draw() {
      ctx.clearRect(0, 0, width, height);
      const isDark = themeMode === 'dark';
      const dotColor = isDark ? 'rgba(61, 187, 196, 0.25)' : 'rgba(255, 255, 255, 0.2)';
      const lineColor = isDark ? 'rgba(61, 187, 196, 0.08)' : 'rgba(255, 255, 255, 0.06)';
      const highlightColor = isDark ? 'rgba(61, 187, 196, 0.6)' : 'rgba(255, 255, 255, 0.5)';
      const highlightLine = isDark ? 'rgba(61, 187, 196, 0.2)' : 'rgba(255, 255, 255, 0.15)';

      // Update positions with gentle drift
      for (let i = 0; i < dots.length; i++) {
        const d = dots[i];
        d.x += d.vx;
        d.y += d.vy;

        // Gentle return to origin
        d.vx += (d.ox - d.x) * 0.002;
        d.vy += (d.oy - d.y) * 0.002;

        // Damping
        d.vx *= 0.99;
        d.vy *= 0.99;
      }

      // Draw connections
      ctx.lineWidth = 0.5;
      for (let i = 0; i < dots.length; i++) {
        for (let j = i + 1; j < dots.length; j++) {
          const dx = dots[i].x - dots[j].x;
          const dy = dots[i].y - dots[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < CONNECTION_DIST) {
            const mouseDistI = Math.sqrt((dots[i].x - mouse.x) ** 2 + (dots[i].y - mouse.y) ** 2);
            const mouseDistJ = Math.sqrt((dots[j].x - mouse.x) ** 2 + (dots[j].y - mouse.y) ** 2);
            const nearMouse = mouseDistI < 150 || mouseDistJ < 150;
            ctx.strokeStyle = nearMouse ? highlightLine : lineColor;
            ctx.beginPath();
            ctx.moveTo(dots[i].x, dots[i].y);
            ctx.lineTo(dots[j].x, dots[j].y);
            ctx.stroke();
          }
        }
      }

      // Draw dots
      for (let i = 0; i < dots.length; i++) {
        const d = dots[i];
        const mouseDist = Math.sqrt((d.x - mouse.x) ** 2 + (d.y - mouse.y) ** 2);
        const nearMouse = mouseDist < 150;
        const radius = nearMouse ? DOT_RADIUS * 2 : DOT_RADIUS;

        ctx.fillStyle = nearMouse ? highlightColor : dotColor;
        ctx.beginPath();
        ctx.arc(d.x, d.y, radius, 0, Math.PI * 2);
        ctx.fill();

        // Mouse repulsion
        if (mouseDist < 120 && mouseDist > 0) {
          const force = (120 - mouseDist) / 120 * 0.3;
          d.vx += (d.x - mouse.x) / mouseDist * force;
          d.vy += (d.y - mouse.y) / mouseDist * force;
        }
      }

      animId = requestAnimationFrame(draw);
    }

    resize();
    draw();
    window.addEventListener('resize', function () {
      cancelAnimationFrame(animId);
      resize();
      draw();
    });
  }

  initHeroCanvas();

  // ==================== CATEGORY FILTERS ====================
  function getCategories() {
    const cats = new Set();
    AGENTS.forEach(function (a) { cats.add(a.category); });
    return Array.from(cats).sort();
  }

  function buildCategoryPills() {
    const cats = getCategories();
    cats.forEach(function (cat) {
      const btn = document.createElement('button');
      btn.className = 'category-pill';
      btn.setAttribute('data-category', cat);
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', 'false');
      btn.textContent = cat;
      btn.addEventListener('click', function () {
        setCategory(cat);
      });
      categoryContainer.appendChild(btn);
    });

    // Bind "All" button
    categoryContainer.querySelector('[data-category="all"]').addEventListener('click', function () {
      setCategory('all');
    });
  }

  function setCategory(cat) {
    currentCategory = cat;
    visibleCount = 12;
    // Update active pill
    categoryContainer.querySelectorAll('.category-pill').forEach(function (pill) {
      const isActive = pill.getAttribute('data-category') === cat;
      pill.classList.toggle('active', isActive);
      pill.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    renderAgents();
  }

  // ==================== SEARCH ====================
  let searchTimeout;
  if (searchInput) {
    searchInput.addEventListener('input', function () {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(function () {
        searchQuery = searchInput.value.trim().toLowerCase();
        visibleCount = 12;
        renderAgents();
      }, 200);
    });
  }

  // ==================== RENDER AGENTS ====================
  function getFilteredAgents() {
    return AGENTS.filter(function (agent) {
      const matchCategory = currentCategory === 'all' || agent.category === currentCategory;
      const matchSearch = !searchQuery ||
        agent.name.toLowerCase().includes(searchQuery) ||
        agent.description.toLowerCase().includes(searchQuery) ||
        agent.category.toLowerCase().includes(searchQuery) ||
        (agent.key_features && agent.key_features.toLowerCase().includes(searchQuery));
      return matchCategory && matchSearch;
    });
  }

  // ==================== TRUST HELPERS ====================
  function getTrustTierIcon(tier) {
    if (tier === 'verified') return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="10"/></svg>';
    if (tier === 'basic') return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>';
    if (tier === 'suspicious') return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
  }

  function getTrustTierLabel(tier) {
    if (tier === 'verified') return 'Verified';
    if (tier === 'basic') return 'Basic';
    if (tier === 'suspicious') return 'Suspicious';
    return 'Unverified';
  }

  function getTrustBarClass(score) {
    if (score === null || score === undefined) return 'none';
    if (score >= 80) return 'high';
    if (score >= 50) return 'medium';
    return 'low';
  }

  function timeAgo(dateStr) {
    if (!dateStr) return '';
    var diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  }

  function createAgentCard(agent, i) {
    const features = agent.key_features ? agent.key_features.split(',').slice(0, 3).map(function (f) { return f.trim(); }) : [];
    const a2aClass = agent.a2a_support === 'Yes' ? 'agent-card__badge--yes' : 'agent-card__badge--unknown';
    const mcpClass = agent.mcp_support === 'Yes' ? 'agent-card__badge--yes' : 'agent-card__badge--unknown';
    const a2aLabel = agent.a2a_support === 'Yes' ? 'A2A' : agent.a2a_support === 'No' ? 'No A2A' : 'A2A ?';
    const mcpLabel = agent.mcp_support === 'Yes' ? 'MCP' : agent.mcp_support === 'No' ? 'No MCP' : 'MCP ?';

    // Trust data
    var tier = agent.trust_tier || 'unverified';
    var score = agent.trust_score;
    var hasScore = score !== null && score !== undefined;
    var scoreDisplay = hasScore ? Math.round(score) : '—';
    var barClass = getTrustBarClass(score);
    var barWidth = hasScore ? Math.max(4, score) : 0;
    var lastChecked = agent.last_card_check ? timeAgo(agent.last_card_check) : '';

    const card = document.createElement('div');
    card.className = 'agent-card';
    card.style.cursor = 'pointer';
    card.innerHTML =
      '<div class="agent-card__header">' +
        '<a href="' + escapeHtml(agent.url) + '" target="_blank" rel="noopener noreferrer" class="agent-card__name">' + escapeHtml(agent.name) + '</a>' +
        '<span class="agent-card__category">' + escapeHtml(agent.category) + '</span>' +
      '</div>' +
      '<p class="agent-card__desc">' + escapeHtml(agent.description) + '</p>' +
      '<div class="agent-card__trust">' +
        '<span class="agent-card__trust-tier agent-card__trust-tier--' + tier + '">' +
          getTrustTierIcon(tier) +
          getTrustTierLabel(tier) +
        '</span>' +
        (hasScore ? '<span class="agent-card__trust-score">' +
          scoreDisplay +
          '<span class="agent-card__trust-bar"><span class="agent-card__trust-bar-fill agent-card__trust-bar-fill--' + barClass + '" style="width:' + barWidth + '%"></span></span>' +
        '</span>' : '') +
      '</div>' +
      '<div class="agent-card__pricing">' +
        '<span class="agent-card__pricing-model">' + escapeHtml(agent.pricing_model) + '</span>' +
        '<span>&middot;</span>' +
        '<span>' + escapeHtml(agent.starting_price) + '</span>' +
      '</div>' +
      (features.length > 0
        ? '<div class="agent-card__features">' +
          features.map(function (f) { return '<span class="agent-card__feature-tag">' + escapeHtml(f) + '</span>'; }).join('') +
          '</div>'
        : '') +
      '<div class="agent-card__badges">' +
        '<span class="agent-card__badge ' + a2aClass + '">' +
          '<span class="agent-card__badge-dot"></span>' +
          a2aLabel +
        '</span>' +
        '<span class="agent-card__badge ' + mcpClass + '">' +
          '<span class="agent-card__badge-dot"></span>' +
          mcpLabel +
        '</span>' +
      '</div>' +
      '<div class="agent-card__security" id="card-security-' + escapeHtml(agent.id) + '"></div>' +
      (lastChecked ? '<div class="agent-card__checked">Checked ' + lastChecked + '</div>' : '');

    // Async-fetch security score for the card badge
    (function(agentId) {
      fetch('https://api.agentry.com/api/security/score/' + encodeURIComponent(agentId))
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
          if (!data || !data.score) return;
          var el = document.getElementById('card-security-' + agentId);
          if (!el) return;
          var cls = data.score >= 8 ? 'low' : data.score >= 5 ? 'moderate' : 'high';
          el.innerHTML = '<span class="security-badge security-badge--' + cls + '">' +
            '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>' +
            data.risk_level + ' ' + data.score.toFixed(1) +
          '</span>';
        })
        .catch(function() {});
    })(agent.id);
    card.setAttribute('data-agent-idx', String(i !== undefined ? i : -1));
    card.addEventListener('click', function(e) {
      // Don't trigger if they clicked the agent name link
      if (e.target.closest('a')) return;
      e.stopPropagation();
      var idx = parseInt(this.getAttribute('data-agent-idx'), 10);
      openAgentPanel(idx >= 0 && AGENTS_CACHE[idx] ? AGENTS_CACHE[idx] : agent);
    });
    return card;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderAgents() {
    const filtered = getFilteredAgents();
    const toShow = filtered.slice(0, visibleCount);

    agentGrid.innerHTML = '';

    if (filtered.length === 0 && (searchQuery || currentCategory !== 'all')) {
      emptyState.style.display = 'block';
      showMoreWrapper.style.display = 'none';
      return;
    }

    emptyState.style.display = 'none';

    AGENTS_CACHE = toShow;
    toShow.forEach(function (agent, i) {
      const card = createAgentCard(agent, i);
      card.style.transitionDelay = (i * 40) + 'ms';
      agentGrid.appendChild(card);
      // Trigger staggered reveal
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          card.classList.add('visible');
        });
      });
    });

    if (filtered.length > visibleCount) {
      showMoreWrapper.style.display = 'block';
      showMoreBtn.textContent = 'Show More (' + (filtered.length - visibleCount) + ' remaining)';
    } else {
      showMoreWrapper.style.display = 'none';
    }
  }

  if (showMoreBtn) {
    showMoreBtn.addEventListener('click', function () {
      visibleCount += 12;
      renderAgents();
    });
  }

  // ==================== FORM HANDLING (Netlify + API) ====================
  if (brokerForm) {
    // Set timestamp when form loads — bots submit instantly
    var tsField = document.getElementById('form-loaded-ts');
    if (tsField) tsField.value = Date.now().toString();

    brokerForm.addEventListener('submit', function (e) {
      e.preventDefault();

      // Anti-spam: reject if second honeypot is filled
      var hpField = brokerForm.querySelector('input[name="website_url"]');
      if (hpField && hpField.value) return;

      // Anti-spam: reject if submitted faster than 3 seconds
      var loadedAt = parseInt(tsField ? tsField.value : '0', 10);
      if (loadedAt && (Date.now() - loadedAt) < 3000) return;

      const formData = new FormData(brokerForm);

      // Build JSON payload for API
      var payload = {};
      formData.forEach(function (value, key) {
        if (key !== 'form-name' && key !== 'bot-field' && key !== 'website_url' && key !== '_form_loaded') payload[key] = value;
      });

      // Submit to both Netlify Forms and backend API in parallel
      var netlifyPromise = fetch('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(formData).toString()
      });

      var apiPromise = fetch(API_BASE + '/api/broker/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(function () { /* API failure is non-blocking */ });

      Promise.all([netlifyPromise, apiPromise])
        .then(function (results) {
          var netlifyOk = results[0] && results[0].ok;
          if (netlifyOk) {
            brokerForm.style.display = 'none';
            formSuccess.classList.add('active');
          } else {
            alert('Something went wrong. Please try again.');
          }
        })
        .catch(function () {
          alert('Network error. Please check your connection and try again.');
        });
    });
  }

  // ==================== LIST YOUR AGENT FORM ====================
  var listAgentForm = document.getElementById('list-agent-form');
  var listAgentSuccess = document.getElementById('list-agent-success');

  if (listAgentForm) {
    // Set timestamp for anti-spam
    var listTsField = document.getElementById('list-form-loaded-ts');
    if (listTsField) listTsField.value = Date.now().toString();

    listAgentForm.addEventListener('submit', function (e) {
      e.preventDefault();

      // Anti-spam: honeypot check
      var hpField = listAgentForm.querySelector('input[name="website_url"]');
      if (hpField && hpField.value) return;

      // Anti-spam: timing check
      var loadedAt = parseInt(listTsField ? listTsField.value : '0', 10);
      if (loadedAt && (Date.now() - loadedAt) < 3000) return;

      var submitBtn = listAgentForm.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting...';
      }

      // Build JSON payload from form fields
      var formData = new FormData(listAgentForm);
      var payload = {};
      formData.forEach(function (value, key) {
        if (key !== 'website_url' && key !== '_form_loaded') payload[key] = value;
      });

      fetch(API_BASE + '/api/agents/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
        .then(function (res) {
          if (!res.ok) return res.json().then(function (err) { throw new Error(err.detail || 'Submission failed'); });
          return res.json();
        })
        .then(function (data) {
          listAgentForm.style.display = 'none';
          if (listAgentSuccess) listAgentSuccess.style.display = 'block';
        })
        .catch(function (err) {
          alert('Error: ' + (err.message || 'Something went wrong. Please try again.'));
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit Agent for Review';
          }
        });
    });
  }

  // ==================== SCROLL REVEAL ====================
  function initScrollReveal() {
    const reveals = document.querySelectorAll('.reveal');
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
          }
        });
      }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

      reveals.forEach(function (el) { observer.observe(el); });
    } else {
      reveals.forEach(function (el) { el.classList.add('visible'); });
    }
  }

  // ==================== LOAD AGENTS FROM API ====================
  function loadAgentsFromAPI() {
    // Show loading state
    if (agentGrid) agentGrid.innerHTML = '<div class="loading-state" style="grid-column:1/-1;text-align:center;padding:3rem;"><p style="opacity:0.6;">Loading agents&hellip;</p></div>';

    fetch(API_BASE + '/api/agents?limit=500')
      .then(function (res) {
        if (!res.ok) throw new Error('API error');
        return res.json();
      })
      .then(function (data) {
        if (data.items && data.items.length > 0) {
          AGENTS = data.items;
        }
        initDirectory();
      })
      .catch(function () {
        // API unreachable — fall back to inline data
        console.warn('API unreachable, using embedded agent data.');
        AGENTS = window.AGENTS || [];
        initDirectory();
      });
  }

  function initDirectory() {
    buildCategoryPills();
    renderAgents();
    initScrollReveal();
  }

  // ==================== LOAD REGISTRY STATS ====================
  function loadRegistryStats() {
    fetch(API_BASE + '/api/registry/stats')
      .then(function (res) {
        if (!res.ok) throw new Error('Stats API error');
        return res.json();
      })
      .then(function (stats) {
        var statsEl = document.getElementById('registry-stats');
        if (statsEl) statsEl.style.display = '';
        var el;
        el = document.getElementById('stat-total');
        if (el) el.textContent = stats.total_agents || '0';
        el = document.getElementById('stat-checked');
        if (el) el.textContent = stats.agents_checked || '0';
        el = document.getElementById('stat-a2a');
        if (el) el.textContent = stats.agents_with_a2a_card || '0';
        el = document.getElementById('stat-avg-trust');
        if (el) el.textContent = stats.avg_trust_score !== null ? Math.round(stats.avg_trust_score) : '--';
      })
      .catch(function () {
        // Stats unavailable — hide the banner
        var statsEl = document.getElementById('registry-stats');
        if (statsEl) statsEl.style.display = 'none';
      });
  }

  // ==================== INIT ====================
  loadAgentsFromAPI();
  loadRegistryStats();


  // ==================== AGENT DETAIL PANEL ====================

  var panelOverlay = document.getElementById('agent-panel-overlay');
  var panelEl     = document.getElementById('agent-panel');
  var panelHeader = document.getElementById('agent-panel-header');
  var panelBody   = document.getElementById('agent-panel-body');
  var _panelAgent = null; // currently displayed agent

  function openAgentPanel(agent) {
    _panelAgent = agent;
    var tier     = agent.trust_tier || 'unverified';
    var score    = agent.trust_score;
    var hasScore = score !== null && score !== undefined;
    var barClass = (function(s) {
      if (!hasScore) return 'none';
      if (s >= 80) return 'high';
      if (s >= 50) return 'medium';
      return 'low';
    })(score);
    var barWidth = hasScore ? Math.max(4, Math.round(score)) : 0;

    // ---- Populate header ----
    panelHeader.innerHTML =
      '<div class="agent-panel__header-top">' +
        '<a href="' + escapeHtml(agent.url) + '" target="_blank" rel="noopener noreferrer" class="agent-panel__name" id="agent-panel-name">' + escapeHtml(agent.name) + '</a>' +
        '<button class="agent-panel__close" id="panel-close-btn" aria-label="Close panel">&times;</button>' +
      '</div>' +
      '<div class="agent-panel__meta">' +
        '<span class="agent-panel__category">' + escapeHtml(agent.category) + '</span>' +
        '<a href="' + escapeHtml(agent.url) + '" target="_blank" rel="noopener noreferrer" class="agent-panel__url-link">' +
          '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>' +
          escapeHtml(agent.url.replace(/^https?:\/\//, '')) +
        '</a>' +
      '</div>';

    document.getElementById('panel-close-btn').addEventListener('click', closeAgentPanel);

    // ---- Populate body ----

    // ═══════════════════════════════════════════
    // ZONE 1: ABOUT (who is this agent)
    // ═══════════════════════════════════════════
    var allFeatures = agent.key_features ? agent.key_features.split(',').map(function(f) { return f.trim(); }).filter(Boolean) : [];
    var allIntegrations = agent.integrations ? agent.integrations.split(',').map(function(i) { return i.trim(); }).filter(Boolean) : [];
    var nostrYes = !!(agent.identity_registered);

    var featuresHtml = allFeatures.length > 0
      ? '<div class="panel-tags">' + allFeatures.map(function(f) { return '<span class="panel-tag">' + escapeHtml(f) + '</span>'; }).join('') + '</div>'
      : '';
    var integrationsHtml = allIntegrations.length > 0
      ? '<div class="panel-tags" style="margin-top:var(--space-2)">' + allIntegrations.map(function(i) { return '<span class="panel-tag panel-tag--integration">' + escapeHtml(i) + '</span>'; }).join('') + '</div>'
      : '';

    // Protocol badges inline
    function protoBadge(label, yes) {
      return '<span class="panel-proto-badge panel-proto-badge--' + (yes ? 'yes' : 'no') + '">' + label + '</span>';
    }

    var zone1 =
      '<div class="panel-zone">' +
        '<p class="panel-desc">' + escapeHtml(agent.description) + '</p>' +
        '<div class="panel-pricing">' +
          '<span class="panel-pricing__model">' + escapeHtml(agent.pricing_model || 'Unknown') + '</span>' +
          '<span style="color:var(--color-text-faint)">&middot;</span>' +
          '<span class="panel-pricing__price">' + escapeHtml(agent.starting_price || '\u2014') + '</span>' +
        '</div>' +
        '<div class="panel-proto-badges">' +
          protoBadge('A2A', agent.a2a_support === 'Yes') +
          protoBadge('MCP', agent.mcp_support === 'Yes') +
          protoBadge('Nostr', nostrYes) +
        '</div>' +
        (featuresHtml ? '<div style="margin-top:var(--space-2)">' + featuresHtml + '</div>' : '') +
        (integrationsHtml || '') +
      '</div>';

    // ═══════════════════════════════════════════
    // ZONE 2: TRUST PROFILE (scores + identity + health)
    // ═══════════════════════════════════════════
    var lastChecked = agent.last_card_check ? timeAgo(agent.last_card_check) : 'Never';

    var zone2 =
      '<div class="panel-zone panel-zone--trust">' +
        '<div class="panel-zone__title">Trust Profile</div>' +

        // Row: trust score + security score (inline)
        '<div class="panel-trust-row">' +
          '<span class="agent-card__trust-tier agent-card__trust-tier--' + tier + '" style="white-space:nowrap">' +
            getTrustTierIcon(tier) +
            getTrustTierLabel(tier) +
          '</span>' +
          (hasScore
            ? '<div class="panel-trust-score-wrap">' +
                '<span style="font-weight:600;color:var(--color-text)">' + Math.round(score) + '</span>' +
                '<div class="panel-trust-bar"><div class="panel-trust-bar-fill panel-trust-bar-fill--' + barClass + '" style="width:' + barWidth + '%"></div></div>' +
              '</div>'
            : '<span style="font-size:var(--text-xs);color:var(--color-text-faint)">No score yet</span>') +
          '<span id="panel-security-inline" class="panel-security-inline"></span>' +
        '</div>' +

        // Identity one-liner (async-filled)
        '<div id="panel-identity-inline"></div>' +

        // Compact meta
        '<div class="panel-trust-meta">' +
          (agent.certification_tier ? '<span class="panel-trust-meta-item">Cert: ' + escapeHtml(agent.certification_tier) + '</span>' : '') +
          '<span class="panel-trust-meta-item">Checked: ' + lastChecked + '</span>' +
          '<button class="panel-trust-meta-link" id="panel-health-toggle">Test availability</button>' +
        '</div>' +

        // Expandable health check (hidden by default)
        '<div id="panel-health-expand" style="display:none">' +
          '<div class="panel-health-compact">' +
            '<button class="panel-health__btn" id="panel-health-btn">Check Now</button>' +
            '<div id="panel-health-results"></div>' +
          '</div>' +
        '</div>' +

        // Expandable identity claim (hidden, filled async)
        '<div id="panel-identity-section" style="display:none"></div>' +

      '</div>';

    // ═══════════════════════════════════════════
    // ZONE 3: CONNECT (MCP config + actions)
    // ═══════════════════════════════════════════
    var mcpConfigJson = JSON.stringify({
      mcpServers: {
        agentry: {
          url: 'https://api.agentry.com/mcp',
          transport: 'streamable-http'
        }
      }
    }, null, 2);

    var mcpConfigHighlighted = mcpConfigJson
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/("(?:mcpServers|agentry|url|transport)")(\s*:)/g, '<span class="json-key">$1</span>$2')
      .replace(/:\s*("[^"]*")/g, function(match, val) {
        return ': <span class="json-string">' + val + '</span>';
      })
      .replace(/([{}])/g, '<span class="json-brace">$1</span>');

    var isUnverified = (tier === 'unverified');

    var zone3 =
      '<div class="panel-zone panel-zone--connect">' +
        '<div class="panel-zone__title">Connect</div>' +
        '<div class="panel-mcp">' +
          '<div class="panel-mcp__header-row">' +
            '<div class="panel-mcp__title">MCP Config</div>' +
            '<div class="panel-mcp__subtitle">Paste into Claude Desktop or Cursor</div>' +
          '</div>' +
          '<div class="panel-mcp__code-wrap">' +
            '<pre class="panel-mcp__code">' + mcpConfigHighlighted + '</pre>' +
            '<button class="panel-mcp__copy-btn" id="panel-mcp-copy-btn">' +
              '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>' +
              '<span id="panel-mcp-copy-label">Copy</span>' +
            '</button>' +
          '</div>' +
        '</div>' +
        '<div class="panel-actions">' +
          '<a href="' + escapeHtml(agent.url) + '" target="_blank" rel="noopener noreferrer" class="btn btn--primary">Visit Agent</a>' +
          (isUnverified ? '<a href="#list-agent" class="btn btn--secondary" id="panel-claim-btn">Claim This Agent</a>' : '') +
        '</div>' +
      '</div>';

    panelBody.innerHTML = zone1 + zone2 + zone3;

    // Pre-fill the claim button URL if present
    var claimBtn = document.getElementById('panel-claim-btn');
    if (claimBtn) {
      claimBtn.addEventListener('click', function() {
        closeAgentPanel();
        // Pre-fill the list-agent form URL field if available
        var urlField = document.querySelector('#list-agent-form input[name="agent_url"]') ||
                       document.querySelector('#list-agent-form input[type="url"]');
        if (urlField) urlField.value = agent.url;
      });
    }

    // Wire health check toggle + button
    var healthToggle = document.getElementById('panel-health-toggle');
    var healthExpand = document.getElementById('panel-health-expand');
    if (healthToggle && healthExpand) {
      healthToggle.addEventListener('click', function() {
        healthExpand.style.display = healthExpand.style.display === 'none' ? 'block' : 'none';
      });
    }
    var healthBtn = document.getElementById('panel-health-btn');
    if (healthBtn) {
      healthBtn.addEventListener('click', function() {
        runHealthCheck(agent, healthBtn);
      });
    }

    // Wire MCP copy button
    var mcpCopyBtn = document.getElementById('panel-mcp-copy-btn');
    if (mcpCopyBtn) {
      mcpCopyBtn.addEventListener('click', function() {
        var label = document.getElementById('panel-mcp-copy-label');
        navigator.clipboard.writeText(mcpConfigJson).then(function() {
          mcpCopyBtn.classList.add('panel-mcp__copy-btn--copied');
          if (label) label.textContent = 'Copied!';
          setTimeout(function() {
            mcpCopyBtn.classList.remove('panel-mcp__copy-btn--copied');
            if (label) label.textContent = 'Copy';
          }, 2000);
        }).catch(function() {
          // Fallback for older browsers
          var textarea = document.createElement('textarea');
          textarea.value = mcpConfigJson;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.select();
          try {
            document.execCommand('copy');
            mcpCopyBtn.classList.add('panel-mcp__copy-btn--copied');
            if (label) label.textContent = 'Copied!';
            setTimeout(function() {
              mcpCopyBtn.classList.remove('panel-mcp__copy-btn--copied');
              if (label) label.textContent = 'Copy';
            }, 2000);
          } catch (e) { /* silent fail */ }
          document.body.removeChild(textarea);
        });
      });
    }

    // Fetch security score and display inline in the trust row
    (function(agentId) {
      var inlineEl = document.getElementById('panel-security-inline');
      if (!inlineEl) return;
      fetch('https://api.agentry.com/api/security/score/' + encodeURIComponent(agentId))
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
          if (!data || (!data.score && data.score !== 0)) return;
          var cls = data.score >= 8 ? 'low' : data.score >= 5 ? 'moderate' : 'high';
          inlineEl.innerHTML =
            '<span class="security-badge security-badge--' + cls + '" title="Security: ' + data.risk_level + '">' +
              '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>' +
              data.score.toFixed(1) +
            '</span>';
        })
        .catch(function() {});
    })(agent.id);

    // Fetch provisioning / identity status — inline one-liner + expandable claim
    (function(agentId) {
      var inlineIdEl = document.getElementById('panel-identity-inline');
      var identEl = document.getElementById('panel-identity-section');
      if (!inlineIdEl) return;

      fetch('https://api.agentry.com/api/provisioning/status/' + encodeURIComponent(agentId))
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
          if (!data || !data.provisioned) return;

          if (data.claimed) {
            // Claimed — compact one-liner
            inlineIdEl.innerHTML =
              '<div class="panel-identity-oneliner panel-identity-oneliner--claimed">' +
                '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>' +
                '<span class="panel-identity-oneliner__label">Nostr identity claimed</span>' +
                '<span class="panel-identity-oneliner__nip05">' + escapeHtml(data.nip05 || '') + '</span>' +
              '</div>';
            return;
          }

          // Provisioned but NOT claimed — inline one-liner with expandable claim
          inlineIdEl.innerHTML =
            '<div class="panel-identity-oneliner panel-identity-oneliner--unclaimed">' +
              '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>' +
              '<span class="panel-identity-oneliner__label">Nostr identity available</span>' +
              '<span class="panel-identity-oneliner__nip05">' + escapeHtml(data.nip05 || '') + '</span>' +
              '<button class="panel-identity-oneliner__claim-link" id="panel-identity-expand-btn">Claim</button>' +
            '</div>';

          // Build the expandable claim section
          if (identEl) {
            identEl.innerHTML =
              '<div class="panel-identity-expand">' +
                '<div class="panel-identity-expand__header">Claim Your Nostr Identity</div>' +
                '<div class="panel-identity__badges">' +
                  '<span class="panel-identity__badge" title="' + escapeHtml(data.npub || '') + '">' +
                    '<span class="panel-identity__badge-label">npub</span>' +
                    '<span class="panel-identity__badge-value">' + escapeHtml((data.npub || '').substring(0, 16)) + '&hellip;</span>' +
                  '</span>' +
                  (data.nip05 ? '<span class="panel-identity__badge">' +
                    '<span class="panel-identity__badge-label">NIP-05</span>' +
                    '<span class="panel-identity__badge-value">' + escapeHtml(data.nip05) + '</span>' +
                  '</span>' : '') +
                '</div>' +
                '<div class="panel-identity__instructions" id="panel-identity-instructions">' +
                  '<div class="panel-identity__step-loading">Loading claim instructions&hellip;</div>' +
                '</div>' +
              '</div>';
          }

          // Wire the expand button
          var expandBtn = document.getElementById('panel-identity-expand-btn');
          if (expandBtn && identEl) {
            expandBtn.addEventListener('click', function() {
              identEl.style.display = identEl.style.display === 'none' ? 'block' : 'none';
              if (identEl.style.display === 'block' && identEl.querySelector('.panel-identity__step-loading')) {
                // Fetch claim challenge on first expand
                loadClaimChallenge(agentId, data);
              }
            });
          }

          // loadClaimChallenge — called when user expands claim section
          function loadClaimChallenge(aid, identData) {
            var instructionsEl = document.getElementById('panel-identity-instructions');
            if (!instructionsEl) return;

              fetch('https://api.agentry.com/api/provisioning/claim-challenge/' + encodeURIComponent(aid))
                .then(function(r) { return r.ok ? r.json() : null; })
                .then(function(challenge) {
                  if (!challenge) {
                    instructionsEl.innerHTML = '<div class="panel-identity__error">Failed to load claim challenge. Please try again later.</div>';
                    return;
                  }

                  var challengeJson = JSON.stringify(challenge, null, 2);
                  var challengeJsonEscaped = challengeJson
                    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                    .replace(/("[^"]+")(\s*:)/g, '<span class="json-key">$1</span>$2')
                    .replace(/:\s*("[^"]*")/g, function(match, val) {
                      return ': <span class="json-string">' + val + '</span>';
                    })
                    .replace(/([{}\[\]])/g, '<span class="json-brace">$1</span>');

                  instructionsEl.innerHTML =
                    '<div class="panel-identity__steps">' +
                      '<div class="panel-identity__step">' +
                        '<span class="panel-identity__step-num">1</span>' +
                        '<span class="panel-identity__step-text">Host the following JSON at <code>your-domain.com/.well-known/agentry-claim.json</code></span>' +
                      '</div>' +
                      '<div class="panel-identity__code-wrap">' +
                        '<pre class="panel-identity__code">' + challengeJsonEscaped + '</pre>' +
                        '<button class="panel-identity__copy-btn" id="panel-identity-copy-challenge">' +
                          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>' +
                          '<span id="panel-identity-copy-challenge-label">Copy</span>' +
                        '</button>' +
                      '</div>' +
                      '<div class="panel-identity__step">' +
                        '<span class="panel-identity__step-num">2</span>' +
                        '<span class="panel-identity__step-text">Click &ldquo;Verify &amp; Claim&rdquo; once the file is hosted</span>' +
                      '</div>' +
                      '<button class="panel-identity__verify-btn" id="panel-identity-verify-btn">' +
                        'Verify &amp; Claim' +
                      '</button>' +
                      '<div id="panel-identity-result"></div>' +
                    '</div>';

                  // Wire copy button for challenge JSON
                  var copyChallengeBtn = document.getElementById('panel-identity-copy-challenge');
                  if (copyChallengeBtn) {
                    copyChallengeBtn.addEventListener('click', function() {
                      var label = document.getElementById('panel-identity-copy-challenge-label');
                      navigator.clipboard.writeText(challengeJson).then(function() {
                        copyChallengeBtn.classList.add('panel-identity__copy-btn--copied');
                        if (label) label.textContent = 'Copied!';
                        setTimeout(function() {
                          copyChallengeBtn.classList.remove('panel-identity__copy-btn--copied');
                          if (label) label.textContent = 'Copy';
                        }, 2000);
                      }).catch(function() {
                        var textarea = document.createElement('textarea');
                        textarea.value = challengeJson;
                        textarea.style.position = 'fixed';
                        textarea.style.opacity = '0';
                        document.body.appendChild(textarea);
                        textarea.select();
                        try {
                          document.execCommand('copy');
                          copyChallengeBtn.classList.add('panel-identity__copy-btn--copied');
                          if (label) label.textContent = 'Copied!';
                          setTimeout(function() {
                            copyChallengeBtn.classList.remove('panel-identity__copy-btn--copied');
                            if (label) label.textContent = 'Copy';
                          }, 2000);
                        } catch (e) { /* silent */ }
                        document.body.removeChild(textarea);
                      });
                    });
                  }

                  // Wire verify button
                  var verifyBtn = document.getElementById('panel-identity-verify-btn');
                  var resultEl = document.getElementById('panel-identity-result');
                  if (verifyBtn && resultEl) {
                    verifyBtn.addEventListener('click', function() {
                      verifyBtn.disabled = true;
                      verifyBtn.innerHTML = '<span class="panel-identity__spinner"></span> Verifying&hellip;';
                      resultEl.innerHTML = '';

                      fetch('https://api.agentry.com/api/provisioning/claim/' + encodeURIComponent(agentId), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' }
                      })
                        .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
                        .then(function(resp) {
                          if (resp.ok && resp.data) {
                            var nsec = resp.data.nsec || resp.data.private_key || '';
                            if (nsec) {
                              // Success — show private key warning
                              verifyBtn.style.display = 'none';
                              resultEl.innerHTML =
                                '<div class="panel-identity__warning">' +
                                  '<div class="panel-identity__warning-header">' +
                                    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' +
                                    '<span>Save this key securely &mdash; it will never be shown again</span>' +
                                  '</div>' +
                                  '<div class="panel-identity__nsec-wrap">' +
                                    '<code class="panel-identity__nsec">' + escapeHtml(nsec) + '</code>' +
                                    '<button class="panel-identity__copy-btn" id="panel-identity-copy-nsec">' +
                                      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>' +
                                      '<span id="panel-identity-copy-nsec-label">Copy</span>' +
                                    '</button>' +
                                  '</div>' +
                                '</div>';

                              // Wire nsec copy button
                              var copyNsecBtn = document.getElementById('panel-identity-copy-nsec');
                              if (copyNsecBtn) {
                                copyNsecBtn.addEventListener('click', function() {
                                  var lbl = document.getElementById('panel-identity-copy-nsec-label');
                                  navigator.clipboard.writeText(nsec).then(function() {
                                    copyNsecBtn.classList.add('panel-identity__copy-btn--copied');
                                    if (lbl) lbl.textContent = 'Copied!';
                                    setTimeout(function() {
                                      copyNsecBtn.classList.remove('panel-identity__copy-btn--copied');
                                      if (lbl) lbl.textContent = 'Copy';
                                    }, 2000);
                                  }).catch(function() {
                                    var ta = document.createElement('textarea');
                                    ta.value = nsec;
                                    ta.style.position = 'fixed';
                                    ta.style.opacity = '0';
                                    document.body.appendChild(ta);
                                    ta.select();
                                    try {
                                      document.execCommand('copy');
                                      copyNsecBtn.classList.add('panel-identity__copy-btn--copied');
                                      if (lbl) lbl.textContent = 'Copied!';
                                      setTimeout(function() {
                                        copyNsecBtn.classList.remove('panel-identity__copy-btn--copied');
                                        if (lbl) lbl.textContent = 'Copy';
                                      }, 2000);
                                    } catch (e) { /* silent */ }
                                    document.body.removeChild(ta);
                                  });
                                });
                              }

                              // After a short delay, replace entire section with claimed view
                              setTimeout(function() {
                                identEl.innerHTML =
                                  '<div class="panel-identity">' +
                                    '<div class="panel-identity__card panel-identity__card--claimed">' +
                                      '<div class="panel-identity__claimed-header">' +
                                        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>' +
                                        '<span>Identity Claimed</span>' +
                                      '</div>' +
                                      '<div class="panel-identity__badges">' +
                                        '<span class="panel-identity__badge" title="' + escapeHtml(data.npub || '') + '">' +
                                          '<span class="panel-identity__badge-label">npub</span>' +
                                          '<span class="panel-identity__badge-value">' + escapeHtml((data.npub || '').substring(0, 16)) + '&hellip;</span>' +
                                        '</span>' +
                                        (data.nip05 ? '<span class="panel-identity__badge">' +
                                          '<span class="panel-identity__badge-label">NIP-05</span>' +
                                          '<span class="panel-identity__badge-value">' + escapeHtml(data.nip05) + '</span>' +
                                        '</span>' : '') +
                                      '</div>' +
                                    '</div>' +
                                  '</div>';
                              }, 8000);
                            } else {
                              // Success but no key returned
                              verifyBtn.disabled = false;
                              verifyBtn.innerHTML = 'Verify &amp; Claim';
                              resultEl.innerHTML = '<div class="panel-identity__success">Identity claimed successfully.</div>';
                            }
                          } else {
                            // Failure
                            verifyBtn.disabled = false;
                            verifyBtn.innerHTML = 'Verify &amp; Claim';
                            var errMsg = (resp.data && (resp.data.detail || resp.data.error || resp.data.message)) || 'Verification failed. Ensure the challenge JSON is hosted at the correct URL.';
                            resultEl.innerHTML = '<div class="panel-identity__error">' + escapeHtml(errMsg) + '</div>';
                          }
                        })
                        .catch(function(err) {
                          verifyBtn.disabled = false;
                          verifyBtn.innerHTML = 'Verify &amp; Claim';
                          resultEl.innerHTML = '<div class="panel-identity__error">Network error. Please check your connection and try again.</div>';
                        });
                    });
                  }
                })
                .catch(function() {
                  instructionsEl.innerHTML = '<div class="panel-identity__error">Failed to load claim challenge. Please try again later.</div>';
                });
          } // end loadClaimChallenge
        })
        .catch(function() {});
    })(agent.id);

    // Open panel
    panelOverlay.classList.add('active');
    panelEl.classList.add('active');
    document.body.style.overflow = 'hidden';

    // Focus the close button for accessibility
    setTimeout(function() {
      var closeBtn = document.getElementById('panel-close-btn');
      if (closeBtn) closeBtn.focus();
    }, 50);
  }

  function closeAgentPanel() {
    panelOverlay.classList.remove('active');
    panelEl.classList.remove('active');
    document.body.style.overflow = '';
    _panelAgent = null;
  }

  // Close on overlay click
  if (panelOverlay) {
    panelOverlay.addEventListener('click', closeAgentPanel);
  }

  // Close on Escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && panelEl && panelEl.classList.contains('active')) {
      closeAgentPanel();
    }
  });

  // ==================== HEALTH CHECK ====================

  function runHealthCheck(agent, btn) {
    var resultsEl = document.getElementById('panel-health-results');
    if (!resultsEl || !btn) return;

    // Show loading state
    btn.disabled = true;
    btn.innerHTML = '<span class="panel-health__spinner"></span> Checking&hellip;';
    resultsEl.innerHTML = '';

    var startTime = Date.now();

    var discoverPromise = fetch(API_BASE + '/api/registry/discover/' + encodeURIComponent(agent.id), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Key': 'agentry-admin-2026'
      }
    }).then(function(r) {
      if (!r.ok) throw new Error('Discover API ' + r.status);
      return r.json();
    });

    var trustPromise = fetch(API_BASE + '/api/agents/' + encodeURIComponent(agent.id) + '/trust', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    }).then(function(r) {
      if (!r.ok) throw new Error('Trust API ' + r.status);
      return r.json();
    });

    Promise.allSettled([discoverPromise, trustPromise]).then(function(results) {
      var elapsed = Date.now() - startTime;
      var discoverResult = results[0];
      var trustResult    = results[1];

      btn.disabled = false;
      btn.innerHTML = 'Check Again';

      if (discoverResult.status === 'rejected' && trustResult.status === 'rejected') {
        resultsEl.innerHTML =
          '<div class="health-error">Could not reach the Agentry API. The agent may still be operational — try again later.</div>';
        return;
      }

      // Parse discover data
      var d = discoverResult.status === 'fulfilled' ? discoverResult.value : null;
      var t = trustResult.status    === 'fulfilled' ? trustResult.value    : null;

      // Response time
      var responseTimeMs = d && d.response_time_ms != null ? d.response_time_ms : elapsed;
      var timeClass = responseTimeMs < 500 ? 'health-time--fast' : (responseTimeMs < 2000 ? 'health-time--ok' : 'health-time--slow');

      // A2A card found
      var a2aFound    = d ? !!(d.a2a_card_found || d.card_found || (d.checks && d.checks.card_found)) : null;
      var schemaValid = d ? !!(d.schema_valid || (d.checks && d.checks.schema_valid)) : null;
      var hasProvider = d ? !!(d.has_provider || (d.checks && d.checks.has_provider) || (d.agent_card && d.agent_card.provider)) : null;
      var hasSkills   = d ? !!(d.has_skills   || (d.checks && d.checks.has_skills)   || (d.agent_card && d.agent_card.skills && d.agent_card.skills.length > 0)) : null;

      // Updated trust score
      var newScore = t ? (t.trust_score || t.score || null) : null;

      function statusIcon(val) {
        if (val === null) return '<span style="color:var(--color-text-faint)">—</span>';
        return val
          ? '<span class="health-check">&#10003; Yes</span>'
          : '<span class="health-cross">&#10007; No</span>';
      }

      var html = '<div class="health-results">';

      html +=
        '<div class="health-row">' +
          '<span class="health-row__label">A2A Card Found</span>' +
          '<span class="health-row__value">' + statusIcon(a2aFound) + '</span>' +
        '</div>';

      html +=
        '<div class="health-row">' +
          '<span class="health-row__label">Response Time</span>' +
          '<span class="health-row__value ' + timeClass + '">' + responseTimeMs + 'ms</span>' +
        '</div>';

      html +=
        '<div class="health-row">' +
          '<span class="health-row__label">Schema Valid</span>' +
          '<span class="health-row__value">' + statusIcon(schemaValid) + '</span>' +
        '</div>';

      html +=
        '<div class="health-row">' +
          '<span class="health-row__label">Provider Info</span>' +
          '<span class="health-row__value">' + statusIcon(hasProvider) + '</span>' +
        '</div>';

      html +=
        '<div class="health-row">' +
          '<span class="health-row__label">Skills Defined</span>' +
          '<span class="health-row__value">' + statusIcon(hasSkills) + '</span>' +
        '</div>';

      if (newScore !== null) {
        html +=
          '<div class="health-score-update">' +
            '<span class="health-score-update__label">Updated Trust Score</span>' +
            '<span class="health-score-update__value">' + Math.round(newScore) + ' / 100</span>' +
          '</div>';
      }

      html += '<div class="health-note">This check feeds into the agent\'s reputation score.</div>';
      html += '</div>';

      resultsEl.innerHTML = html;
    });
  }


})();
