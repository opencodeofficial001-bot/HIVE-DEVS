/* =============================================
   HIVE DEVS — script.js
   Auth via Firebase REST API + Realtime Database
   ============================================= */

'use strict';

/* ─── CONFIG ─────────────────────────────────── */
const FB_DB   = 'https://hive-14e4f-default-rtdb.firebaseio.com';
const FB_KEY  = 'AIzaSyDemoKeyPlaceholder'; // não usada no Realtime DB anônimo
// Firebase Auth REST (usamos Identity Toolkit via REST)
const FB_AUTH = 'https://identitytoolkit.googleapis.com/v1/accounts';
// IMPORTANTE: para usar Firebase Auth REST é necessário uma Web API Key.
// Como a URL do DB foi fornecida, usaremos o Realtime Database sem Auth SDK,
// armazenando credenciais hasheadas (bcrypt não disponível sem lib, então SHA-256 via Web Crypto).
// Fluxo: registro → salva user no DB → login → valida no DB → sessão via localStorage.

/* ─── HELPERS ─────────────────────────────────── */
async function sha256(str) {
  const buf  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function sanitizeKey(str) {
  // Firebase keys não podem ter . # $ / [ ]
  return str.replace(/[.#$\[\]\/]/g, '_');
}

async function dbGet(path) {
  const res = await fetch(`${FB_DB}/${path}.json`);
  if (!res.ok) throw new Error('DB read error');
  return res.json();
}

async function dbSet(path, data) {
  const res = await fetch(`${FB_DB}/${path}.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error('DB write error');
  return res.json();
}

async function dbPatch(path, data) {
  const res = await fetch(`${FB_DB}/${path}.json`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error('DB patch error');
  return res.json();
}

/* ─── SESSION ─────────────────────────────────── */
const SESSION_KEY = 'hivedevs_session';

function saveSession(user) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(user));
}
function loadSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; }
}
function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

/* ─── YEAR ─────────────────────────────────── */
document.getElementById('year').textContent = new Date().getFullYear();

/* ─── TOAST ─────────────────────────────────── */
const toastEl = document.getElementById('toast');
let toastTimer;
function showToast(msg, type = '') {
  clearTimeout(toastTimer);
  toastEl.textContent = msg;
  toastEl.className   = `toast show ${type}`;
  toastTimer = setTimeout(() => { toastEl.className = 'toast'; }, 3500);
}

/* ─── MODAL SYSTEM ─────────────────────────────── */
function openModal(id) {
  document.getElementById(id).classList.add('active');
  document.body.style.overflow = 'hidden';
}
function closeModal(id) {
  document.getElementById(id).classList.remove('active');
  document.body.style.overflow = '';
}

document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.dataset.close));
});
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeModal(overlay.id);
  });
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.active').forEach(m => closeModal(m.id));
  }
});

/* ─── AUTH TAB SWITCH ─────────────────────────── */
document.querySelectorAll('.auth-tab').forEach(tab => {
  tab.addEventListener('click', () => switchAuthTab(tab.dataset.tab));
});
document.querySelectorAll('.link-btn').forEach(btn => {
  btn.addEventListener('click', () => switchAuthTab(btn.dataset.tab));
});
function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.getElementById('panel-login').classList.toggle('hidden', tab !== 'login');
  document.getElementById('panel-register').classList.toggle('hidden', tab !== 'register');
  clearErrors();
}
function clearErrors() {
  document.querySelectorAll('.auth-error').forEach(e => { e.textContent = ''; e.classList.remove('show'); });
}
function showError(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.classList.add('show');
}

/* ─── NAVBAR ─────────────────────────────────── */
const navbar    = document.getElementById('navbar');
const hamburger = document.getElementById('hamburger');
const navLinks  = document.getElementById('navLinks');

window.addEventListener('scroll', () => navbar.classList.toggle('scrolled', window.scrollY > 40));
hamburger.addEventListener('click', () => navLinks.classList.toggle('open'));
navLinks.querySelectorAll('a').forEach(a => a.addEventListener('click', () => navLinks.classList.remove('open')));

/* ─── OPEN MODALS ─────────────────────────────── */
document.getElementById('btn-about').addEventListener('click',      () => openModal('modal-about'));
document.getElementById('btn-nav-login').addEventListener('click',  () => openModal('modal-auth'));
document.getElementById('btn-hero-join').addEventListener('click',  () => {
  openModal('modal-auth');
  switchAuthTab('register');
});

/* ─── REGISTER ─────────────────────────────────── */
document.getElementById('btn-do-register').addEventListener('click', async () => {
  const username = document.getElementById('reg-username').value.trim();
  const email    = document.getElementById('reg-email').value.trim().toLowerCase();
  const pass     = document.getElementById('reg-pass').value;

  clearErrors();

  if (!username) return showError('reg-error', '// usuário não pode ser vazio');
  if (username.length < 3) return showError('reg-error', '// usuário precisa ter 3+ caracteres');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showError('reg-error', '// email inválido');
  if (pass.length < 6) return showError('reg-error', '// senha precisa ter 6+ caracteres');

  const btn = document.getElementById('btn-do-register');
  const txt = document.getElementById('reg-btn-txt');
  btn.disabled = true;
  txt.textContent = 'Criando conta...';

  try {
    const emailKey = sanitizeKey(email);

    // Verificar se email já existe
    const existing = await dbGet(`users/${emailKey}`);
    if (existing) {
      showError('reg-error', '// email já cadastrado');
      btn.disabled = false; txt.textContent = 'Criar conta';
      return;
    }

    // Verificar username único
    const allUsers = await dbGet('users');
    if (allUsers) {
      const taken = Object.values(allUsers).some(u => u.username && u.username.toLowerCase() === username.toLowerCase());
      if (taken) {
        showError('reg-error', '// usuário já está em uso');
        btn.disabled = false; txt.textContent = 'Criar conta';
        return;
      }
    }

    const passHash = await sha256(pass + email); // email como salt
    const since    = new Date().toLocaleDateString('pt-BR', { year:'numeric', month:'long', day:'numeric' });
    const uid      = 'uid_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);

    const userData = { uid, username, email, passHash, since, createdAt: Date.now() };
    await dbSet(`users/${emailKey}`, userData);

    // Atualizar contador de devs
    const count = await dbGet('devCount');
    await dbSet('devCount', (count || 0) + 1);

    // Login automático
    const session = { uid, username, email, since };
    saveSession(session);
    closeModal('modal-auth');
    updateNavUser(session);
    loadDevCount();
    showToast(`✓ Bem-vindo à colmeia, ${username}!`, 'success');
    clearRegForm();
  } catch (err) {
    console.error(err);
    showError('reg-error', '// erro ao criar conta. Tente novamente.');
  }

  btn.disabled = false;
  txt.textContent = 'Criar conta';
});

/* ─── LOGIN ─────────────────────────────────────── */
document.getElementById('btn-do-login').addEventListener('click', async () => {
  const email = document.getElementById('login-email').value.trim().toLowerCase();
  const pass  = document.getElementById('login-pass').value;

  clearErrors();

  if (!email) return showError('login-error', '// email não pode ser vazio');
  if (!pass)  return showError('login-error', '// senha não pode ser vazia');

  const btn = document.getElementById('btn-do-login');
  const txt = document.getElementById('login-btn-txt');
  btn.disabled = true;
  txt.textContent = 'Verificando...';

  try {
    const emailKey = sanitizeKey(email);
    const userData = await dbGet(`users/${emailKey}`);

    if (!userData) {
      showError('login-error', '// email não encontrado');
      btn.disabled = false; txt.textContent = 'Entrar na colmeia';
      return;
    }

    const passHash = await sha256(pass + email);
    if (passHash !== userData.passHash) {
      showError('login-error', '// senha incorreta');
      btn.disabled = false; txt.textContent = 'Entrar na colmeia';
      return;
    }

    const session = { uid: userData.uid, username: userData.username, email: userData.email, since: userData.since };
    saveSession(session);
    closeModal('modal-auth');
    updateNavUser(session);
    showToast(`✓ Olá, ${userData.username}! Bem-vindo de volta.`, 'success');
    clearLoginForm();
  } catch (err) {
    console.error(err);
    showError('login-error', '// erro ao conectar. Tente novamente.');
  }

  btn.disabled = false;
  txt.textContent = 'Entrar na colmeia';
});

/* Enter key nos inputs */
['login-email','login-pass'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-do-login').click();
  });
});
['reg-username','reg-email','reg-pass'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-do-register').click();
  });
});

function clearLoginForm() {
  document.getElementById('login-email').value = '';
  document.getElementById('login-pass').value = '';
}
function clearRegForm() {
  document.getElementById('reg-username').value = '';
  document.getElementById('reg-email').value = '';
  document.getElementById('reg-pass').value = '';
}

/* ─── LOGOUT ─────────────────────────────────────── */
document.getElementById('btn-logout').addEventListener('click', () => {
  clearSession();
  closeModal('modal-profile');
  resetNavToGuest();
  showToast('Você saiu da conta.', '');
});

/* ─── NAV USER STATE ─────────────────────────────── */
function updateNavUser(session) {
  const area = document.getElementById('nav-auth-area');
  const initials = session.username.slice(0, 2).toUpperCase();

  area.innerHTML = `
    <button class="nav-user-btn" id="btn-nav-profile">
      <span class="nav-user-hex">
        <svg viewBox="0 0 40 35" xmlns="http://www.w3.org/2000/svg" width="32" height="28">
          <polygon points="20,2 38,12 38,23 20,33 2,23 2,12" fill="rgba(255,214,0,0.1)" stroke="#FFD600" stroke-width="1.5"/>
          <text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" fill="#FFD600" font-family="Orbitron" font-size="10" font-weight="900">${initials}</text>
        </svg>
      </span>
      <span class="nav-username">${session.username}</span>
    </button>`;

  document.getElementById('btn-nav-profile').addEventListener('click', () => {
    openProfileModal(session);
  });
}

function resetNavToGuest() {
  const area = document.getElementById('nav-auth-area');
  area.innerHTML = `<button class="nav-cta-btn" id="btn-nav-login">Entrar</button>`;
  document.getElementById('btn-nav-login').addEventListener('click', () => openModal('modal-auth'));
}

function openProfileModal(session) {
  const initials = session.username.slice(0, 2).toUpperCase();
  document.getElementById('profile-initials').textContent = initials;
  document.getElementById('profile-username').textContent = session.username;
  document.getElementById('profile-email').textContent    = session.email;
  document.getElementById('profile-since').textContent    = session.since;
  openModal('modal-profile');
}

/* ─── DEV COUNT (Realtime Database) ─────────────── */
async function loadDevCount() {
  try {
    const count = await dbGet('devCount');
    const el    = document.getElementById('stat-devs');
    const val   = count || 0;
    el.setAttribute('data-target', val);
    animateCounter(el, val, 1200);
  } catch (e) {
    document.getElementById('stat-devs').textContent = '–';
  }
}

/* ─── COUNTER ANIMATION ─────────────────────────── */
function animateCounter(el, target, duration = 1500) {
  let start = null;
  const step = (ts) => {
    if (!start) start = ts;
    const p = Math.min((ts - start) / duration, 1);
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.floor(e * target);
    if (p < 1) requestAnimationFrame(step);
    else el.textContent = target;
  };
  requestAnimationFrame(step);
}

// Counters for static stats (projetos, tecnologias)
let countersStarted = false;
const staticCounters = document.querySelectorAll('.stat-num[data-target]');
const statsObserver  = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting && !countersStarted) {
      countersStarted = true;
      staticCounters.forEach(el => animateCounter(el, parseInt(el.dataset.target), 1500));
    }
  });
}, { threshold: 0.4 });
if (staticCounters.length) statsObserver.observe(staticCounters[0].closest('.hero-stats'));

/* ─── SCROLL REVEAL ─────────────────────────────── */
const animCards   = document.querySelectorAll('[data-anim]');
const cardObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const idx = Array.from(animCards).indexOf(entry.target);
      setTimeout(() => entry.target.classList.add('visible'), idx * 110);
      cardObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.1 });
animCards.forEach(c => cardObserver.observe(c));

/* ─── CANVAS PARTICLES ─────────────────────────── */
(function () {
  const canvas = document.getElementById('bg-canvas');
  const ctx    = canvas.getContext('2d');
  let W, H, particles = [];
  const Y = 'rgba(255,214,0,';

  function resize() { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; }
  window.addEventListener('resize', () => { resize(); init(); });
  resize();

  function init() {
    particles = [];
    const n = Math.floor((W * H) / 18000);
    for (let i = 0; i < n; i++) {
      particles.push({ x: Math.random()*W, y: Math.random()*H, r: Math.random()*1.3+0.3, vx:(Math.random()-.5)*.22, vy:(Math.random()-.5)*.22, a: Math.random()*.35+.1 });
    }
  }
  init();

  function draw() {
    ctx.clearRect(0, 0, W, H);
    for (let i = 0; i < particles.length; i++) {
      for (let j = i+1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x, dy = particles[i].y - particles[j].y;
        const d  = Math.sqrt(dx*dx + dy*dy);
        if (d < 140) {
          ctx.beginPath(); ctx.moveTo(particles[i].x, particles[i].y); ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = `${Y}${(1-d/140)*.1})`; ctx.lineWidth = .5; ctx.stroke();
        }
      }
    }
    particles.forEach(p => {
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
      ctx.fillStyle = `${Y}${p.a})`; ctx.fill();
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0) p.x = W; if (p.x > W) p.x = 0;
      if (p.y < 0) p.y = H; if (p.y > H) p.y = 0;
    });
    requestAnimationFrame(draw);
  }
  draw();
})();

/* ─── HEX CLUSTER ─────────────────────────────── */
(function () {
  const cluster = document.getElementById('hexCluster');
  if (!cluster) return;
  const hexes = [
    {cx:55,cy:30,s:100,o:.7,f:true, d:0},
    {cx:72,cy:20,s:70, o:.5,f:false,d:.1},
    {cx:40,cy:45,s:65, o:.35,f:false,d:.2},
    {cx:65,cy:55,s:85, o:.55,f:true, d:.3},
    {cx:80,cy:40,s:55, o:.4,f:false,d:.15},
    {cx:50,cy:65,s:60, o:.3,f:false,d:.4},
    {cx:78,cy:65,s:75, o:.45,f:true, d:.25},
    {cx:38,cy:25,s:50, o:.25,f:false,d:.5},
    {cx:88,cy:52,s:45, o:.3,f:false,d:.35},
    {cx:60,cy:78,s:55, o:.3,f:false,d:.45},
  ];

  const style = document.createElement('style');
  style.textContent = `
    @keyframes hexAppear { from{opacity:0;transform:translate(-50%,-50%) scale(.7)} to{opacity:1;transform:translate(-50%,-50%) scale(1)} }
    @keyframes hexFloat  { 0%,100%{transform:translate(-50%,-50%) translateY(0)} 50%{transform:translate(-50%,-50%) translateY(-9px)} }
  `;
  document.head.appendChild(style);

  hexes.forEach((h, i) => {
    const ht = Math.round(h.s * .866);
    const div = document.createElement('div');
    div.className = 'hex-cell';
    div.style.cssText = `left:${h.cx}%;top:${h.cy}%;width:${h.s}px;height:${ht}px;transform:translate(-50%,-50%);opacity:0;animation:hexAppear 1s ${h.d+.5}s ease forwards;`;
    div.innerHTML = `<svg viewBox="0 0 60 52" xmlns="http://www.w3.org/2000/svg" width="${h.s}" height="${ht}">
      <polygon points="30,2 58,17 58,35 30,50 2,35 2,17" fill="${h.f?'rgba(255,214,0,0.07)':'rgba(255,214,0,0.02)'}" stroke="rgba(255,214,0,${h.o})" stroke-width="${h.f?2:1.5}"/>
    </svg>`;
    cluster.appendChild(div);
  });

  setTimeout(() => {
    cluster.querySelectorAll('.hex-cell').forEach((el, i) => {
      el.style.animation = `hexFloat ${3.5 + (i%4)*.7}s ${(i%3)*.5}s ease-in-out infinite`;
      el.style.opacity   = '1';
    });
  }, 2200);
})();

/* ─── SMOOTH SCROLL ─────────────────────────────── */
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const target = document.querySelector(a.getAttribute('href'));
    if (target) { e.preventDefault(); target.scrollIntoView({ behavior:'smooth', block:'start' }); }
  });
});

/* ─── INIT: Restore session + Load dev count ─────── */
(function init() {
  const session = loadSession();
  if (session) updateNavUser(session);
  loadDevCount();
})();