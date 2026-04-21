/* ============================================================
   CharacterVerse — Auth & Cloud Sync  (Supabase v2)
   Provides: Google + Twitter OAuth, per-user cloud storage
   Depends on: Supabase CDN + supabase-config.js loaded first
============================================================ */

let _sb   = null;
let _user = null;   // exposed as window.cvUser

// ── Lazy-init Supabase client ─────────────────────────────────
function _sbClient(){
  if(_sb) return _sb;
  if(!window.supabase || SUPABASE_URL === 'YOUR_SUPABASE_URL') return null;
  _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: { persistSession: true, detectSessionInUrl: true, flowType: 'implicit' }
  });
  return _sb;
}

// ── Init — call once on every page ───────────────────────────
async function initAuth(){
  const sb = _sbClient();
  if(!sb) return;   // Supabase not configured yet

  try {
    const { data:{ session } } = await sb.auth.getSession();
    if(session){
      _user = session.user;
      window.cvUser = _user;
      await _onSignIn(false);   // false = silent (no toast on page load)
    }

    sb.auth.onAuthStateChange(async (event, session) => {
      if(event === 'SIGNED_IN' && session && session.user.id !== _user?.id){
        _user = session.user;
        window.cvUser = _user;
        await _onSignIn(true);
      } else if(event === 'SIGNED_OUT'){
        _user = null;
        window.cvUser = null;
      }
      _renderAuthUI();
    });
  } catch(e){ console.warn('[auth] init error', e); }

  _renderAuthUI();
}

async function _onSignIn(showToast){
  await Promise.allSettled([ pullCharsFromCloud(), pullConvsMetaFromCloud() ]);
  // Re-render cards/chars if we're on the home page
  if(typeof renderMyChars === 'function') renderMyChars();
  if(typeof renderCards   === 'function') renderCards();
  _renderAuthUI();
  if(showToast){
    const name = _user.user_metadata?.full_name?.split(' ')[0] || 'there';
    _authToast(`Hey ${name}! ☁ Chats synced across devices.`);
  }
}

// ── OAuth sign-in ─────────────────────────────────────────────
async function signInWithGoogle(){
  const sb = _sbClient(); if(!sb) return;
  await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname }
  });
}
async function signInWithTwitter(){
  const sb = _sbClient(); if(!sb) return;
  await sb.auth.signInWithOAuth({
    provider: 'twitter',
    options: { redirectTo: window.location.origin + window.location.pathname }
  });
}
async function signOut(){
  const sb = _sbClient(); if(!sb) return;
  await sb.auth.signOut();
  _user = null; window.cvUser = null;
  _renderAuthUI();
  _authToast('Signed out.');
}

// ── Character sync ────────────────────────────────────────────
async function pushCharsToCloud(){
  const sb = _sbClient(); if(!sb || !_user) return;
  try {
    const data = JSON.parse(localStorage.getItem('characterverse_custom_chars') || '[]');
    await sb.from('cv_characters').upsert({ user_id: _user.id, data, updated_at: new Date().toISOString() });
  } catch(e){ console.warn('[auth] pushChars', e); }
}
async function pullCharsFromCloud(){
  const sb = _sbClient(); if(!sb || !_user) return;
  try {
    const { data } = await sb.from('cv_characters').select('data').eq('user_id', _user.id).maybeSingle();
    if(data?.data) localStorage.setItem('characterverse_custom_chars', JSON.stringify(data.data));
  } catch(e){ console.warn('[auth] pullChars', e); }
}
// Exposed on window so characters.js can call it without importing
window.pushCharsToCloud = pushCharsToCloud;

// ── Conversation sync ─────────────────────────────────────────
async function pushConvsToCloud(charId){
  const sb = _sbClient(); if(!sb || !_user || !charId) return;
  try {
    const raw = localStorage.getItem('cv_convs_' + charId);
    if(!raw) return;
    await sb.from('cv_conversations').upsert({
      user_id: _user.id, char_id: charId, data: raw,
      updated_at: new Date().toISOString()
    });
  } catch(e){ console.warn('[auth] pushConvs', e); }
}
async function pullConvsMetaFromCloud(){
  // On login: pull all conversation data — only fills in what's missing locally
  const sb = _sbClient(); if(!sb || !_user) return;
  try {
    const { data } = await sb.from('cv_conversations').select('char_id,data').eq('user_id', _user.id);
    if(!data) return;
    for(const row of data){
      const key = 'cv_convs_' + row.char_id;
      if(!localStorage.getItem(key)) localStorage.setItem(key, row.data);
    }
  } catch(e){ console.warn('[auth] pullConvsMeta', e); }
}
async function pullConvsForChar(charId){
  const sb = _sbClient(); if(!sb || !_user) return;
  try {
    const { data } = await sb.from('cv_conversations').select('data')
      .eq('user_id', _user.id).eq('char_id', charId).maybeSingle();
    if(data?.data) localStorage.setItem('cv_convs_' + charId, data.data);
  } catch(e){ console.warn('[auth] pullConvsForChar', e); }
}
// Exposed on window so chat.js can call it
window.pushConvsToCloud  = pushConvsToCloud;
window.pullConvsForChar  = pullConvsForChar;

// ── Login modal (created dynamically — works on any page) ─────
function openLoginModal(){
  if(document.getElementById('cv-login-modal')) return;
  const ov = document.createElement('div');
  ov.id = 'cv-login-modal';
  ov.style.cssText = [
    'position:fixed;inset:0;z-index:99990',
    'display:flex;align-items:center;justify-content:center',
    'background:rgba(5,5,20,.92);backdrop-filter:blur(12px)',
    'font-family:Inter,sans-serif',
  ].join(';');
  ov.innerHTML = `
    <div style="
      background:linear-gradient(135deg,rgba(28,20,60,.98),rgba(10,8,30,.99));
      border:1px solid rgba(139,92,246,.35);border-radius:22px;
      padding:2.4rem 2rem 2rem;width:min(92vw,380px);
      box-shadow:0 0 80px rgba(120,80,255,.2),0 20px 60px rgba(0,0,0,.6);
      text-align:center;position:relative;
    ">
      <button onclick="closeLoginModal()" style="
        position:absolute;top:.9rem;right:.9rem;background:none;border:none;
        color:rgba(255,255,255,.4);font-size:1.2rem;cursor:pointer;line-height:1
      ">✕</button>

      <div style="font-size:2.4rem;margin-bottom:.6rem">🌌</div>
      <h2 style="margin:0 0 .4rem;color:#e0d8ff;font-size:1.25rem;font-weight:700">Sign in to CharacterVerse</h2>
      <p style="margin:0 0 1.8rem;color:#6b6490;font-size:.83rem;line-height:1.55">
        Your custom characters &amp; chats sync across all your devices.
      </p>

      <button onclick="signInWithGoogle()" style="
        width:100%;padding:.78rem 1rem;margin-bottom:.65rem;
        background:#fff;border:1px solid #ddd;border-radius:12px;
        color:#1f1f1f;font-size:.93rem;font-weight:600;cursor:pointer;
        display:flex;align-items:center;justify-content:center;gap:.7rem;
        transition:box-shadow .2s;
      " onmouseover="this.style.boxShadow='0 4px 16px rgba(0,0,0,.25)'"
         onmouseout="this.style.boxShadow='none'">
        <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.2l6.7-6.7C35.8 2.5 30.2 0 24 0 14.8 0 7 5.4 3 13.3l7.8 6C12.8 13.5 17.9 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17z"/><path fill="#FBBC05" d="M10.8 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7L2.5 13.3A24 24 0 0 0 0 24c0 3.9.9 7.5 2.5 10.8l8.3-6.1z"/><path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.5l-7.5-5.8c-2 1.4-4.6 2.3-7.7 2.3-6.1 0-11.3-4.1-13.2-9.7l-7.8 6C7 42.6 14.8 48 24 48z"/><path fill="none" d="M0 0h48v48H0z"/></svg>
        Continue with Google
      </button>

      <button onclick="signInWithTwitter()" style="
        width:100%;padding:.78rem 1rem;
        background:#000;border:1px solid rgba(255,255,255,.15);border-radius:12px;
        color:#fff;font-size:.93rem;font-weight:600;cursor:pointer;
        display:flex;align-items:center;justify-content:center;gap:.7rem;
        transition:opacity .2s;
      " onmouseover="this.style.opacity='.85'" onmouseout="this.style.opacity='1'">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.737-8.835L1.254 2.25H8.08l4.253 5.622 5.91-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
        Continue with X (Twitter)
      </button>

      <p style="margin-top:1.2rem;color:#3d3960;font-size:.77rem">
        <a href="#" onclick="closeLoginModal()" style="color:#5b56a0;text-decoration:underline">Continue without signing in</a>
        &nbsp;·&nbsp;Chats stay on this device only
      </p>
    </div>`;

  ov.addEventListener('click', e => { if(e.target === ov) closeLoginModal(); });
  document.body.appendChild(ov);
}

function closeLoginModal(){
  document.getElementById('cv-login-modal')?.remove();
}

// ── Navbar UI ─────────────────────────────────────────────────
function _renderAuthUI(){
  const loginBtn  = document.getElementById('auth-login-btn');
  const userMenu  = document.getElementById('auth-user-menu');
  if(!loginBtn && !userMenu) return;

  const sb = _sbClient();
  if(!sb){
    // Supabase not configured — hide login button entirely
    if(loginBtn) loginBtn.style.display = 'none';
    return;
  }

  if(_user){
    if(loginBtn) loginBtn.style.display = 'none';
    if(userMenu){
      userMenu.style.display = 'flex';
      const pic  = _user.user_metadata?.avatar_url;
      const name = _user.user_metadata?.full_name || _user.email || 'User';
      userMenu.innerHTML = pic
        ? `<img src="${pic}" alt="${name[0]}" title="${name}"
             style="width:30px;height:30px;border-radius:50%;cursor:pointer;border:2px solid rgba(139,92,246,.7)"
             onclick="toggleUserDropdown()">`
        : `<div title="${name}" onclick="toggleUserDropdown()"
             style="width:30px;height:30px;border-radius:50%;
               background:linear-gradient(135deg,#7c3aed,#06b6d4);
               display:flex;align-items:center;justify-content:center;
               cursor:pointer;font-weight:700;font-size:.82rem;color:#fff;
               border:2px solid rgba(139,92,246,.5)">
             ${(name[0]||'U').toUpperCase()}</div>`;
    }
  } else {
    if(loginBtn) loginBtn.style.display = '';
    if(userMenu){ userMenu.style.display = 'none'; userMenu.innerHTML = ''; }
  }
}

function toggleUserDropdown(){
  const existing = document.getElementById('cv-user-drop');
  if(existing){ existing.remove(); return; }

  const name  = _user?.user_metadata?.full_name || _user?.email || 'User';
  const drop  = document.createElement('div');
  drop.id = 'cv-user-drop';

  const anchor = document.getElementById('auth-user-menu');
  const rect   = anchor?.getBoundingClientRect();
  drop.style.cssText = [
    `position:fixed;top:${(rect?.bottom || 60) + 6}px;right:1rem;z-index:9500`,
    'background:rgba(18,12,48,.97);border:1px solid rgba(139,92,246,.35)',
    'border-radius:14px;padding:.7rem;min-width:190px',
    'box-shadow:0 8px 32px rgba(0,0,0,.6);font-family:Inter,sans-serif',
  ].join(';');
  drop.innerHTML = `
    <div style="color:rgba(255,255,255,.45);font-size:.76rem;padding:.15rem .45rem .6rem;
      border-bottom:1px solid rgba(255,255,255,.08);margin-bottom:.5rem;
      overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${name}</div>
    <button onclick="signOut()" style="
      width:100%;padding:.48rem .6rem;border-radius:8px;cursor:pointer;
      background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.25);
      color:#f87171;font-size:.82rem;text-align:left">
      Sign Out
    </button>`;

  document.body.appendChild(drop);
  setTimeout(() => {
    document.addEventListener('click', function h(e){
      if(!drop.contains(e.target) && !anchor?.contains(e.target)){
        drop.remove(); document.removeEventListener('click', h);
      }
    });
  }, 50);
}

// ── Toast helper ──────────────────────────────────────────────
function _authToast(msg){
  const t = document.getElementById('toast');
  if(!t) return;
  t.textContent = msg;
  t.className = 'toast show';
  clearTimeout(window._authToastT);
  window._authToastT = setTimeout(() => t.className = 'toast', 3500);
}
