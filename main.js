// びりびりボタン（Pavlok発火）— Deno Deploy 版（Googleログイン不要）
// 運営: /?admin=kmotto  配信者: /?s=部屋ID&k=秘密キー  リスナー: /?s=部屋ID
const kv = await Deno.openKv();
const ADMIN_KEY = "kiko-e127e902";

const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
const norm = (s) => String(s || "").trim().replace(/^@/, "").toLowerCase();
const rid = (n) => crypto.randomUUID().replace(/-/g, "").slice(0, n);
const ck = (key) => key === ADMIN_KEY;

const getRooms = async () => (await kv.get(["rooms"])).value || [];
const setRooms = async (v) => { await kv.set(["rooms"], v); };
const akeyOf = async (sid) => { const r = (await getRooms()).find((x) => x.sid === sid); return r ? r.akey : ""; };
const getRoster = async (sid) => (await kv.get(["room", sid, "roster"])).value || [];
const setRoster = async (sid, v) => { await kv.set(["room", sid, "roster"], v); };
const getState = async (sid) => (await kv.get(["room", sid, "state"])).value || "OFF";
const getStrength = async (sid) => (await kv.get(["room", sid, "strength"])).value || 50;
const getToken = async (sid) => (await kv.get(["room", sid, "token"])).value || "";
const getLog = async (sid) => { const o = (await kv.get(["room", sid, "log"])).value || { date: "", counts: {} }; return o.date === today() ? o : { date: today(), counts: {} }; };
const setLog = async (sid, v) => { await kv.set(["room", sid, "log"], v); };
const getHistory = async (sid) => (await kv.get(["room", sid, "history"])).value || [];
async function addHistory(sid, id) {
  const now = Date.now();
  const cutoff = now - 31 * 24 * 60 * 60 * 1000;
  let h = (await getHistory(sid)).filter((e) => e && e.ts >= cutoff);
  h.push({ id, ts: now });
  if (h.length > 3000) h = h.slice(h.length - 3000);
  await kv.set(["room", sid, "history"], h);
}

async function zap(sid) {
  const token = await getToken(sid), strength = await getStrength(sid);
  try {
    await fetch("https://api.pavlok.com/api/v5/stimulus/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
      body: JSON.stringify({ stimulus: { stimulusType: "zap", stimulusValue: strength } }),
    });
  } catch (_) { /* ignore */ }
}

async function fire(sid, rawId) {
  if (!sid) return { ok: false, msg: "URLが正しくありません" };
  const id = norm(rawId);
  if (!id) return { ok: false, msg: "IDを入力してください" };
  if (await getState(sid) !== "ON") return { ok: false, msg: "今は受付していません" };
  const entry = (await getRoster(sid)).find((x) => norm(x.id) === id);
  if (!entry) return { ok: false, msg: "スパファン名簿にないIDです" };
  const limit = entry.limit || 1;
  const log = await getLog(sid);
  const used = log.counts[id] || 0;
  if (used >= limit) return { ok: false, msg: `今日はもう上限です（${limit}回）` };
  await zap(sid);
  log.counts[id] = used + 1;
  await setLog(sid, log);
  await addHistory(sid, id);
  return { ok: true, msg: `びりびり発動！（今日 ${used + 1}/${limit}）` };
}

async function mData(key, origin) {
  if (!ck(key)) return { ok: false };
  const rooms = await getRooms(), out = [];
  for (const r of rooms) out.push({ sid: r.sid, name: r.name, adminUrl: `${origin}/?s=${r.sid}&k=${r.akey}`, state: await getState(r.sid), hasToken: !!(await getToken(r.sid)) });
  return { ok: true, rooms: out };
}
async function mAdd(key, name, origin) { if (!ck(key)) return { ok: false }; const nm = String(name || "").trim(); if (nm) { const rooms = await getRooms(); rooms.push({ sid: rid(8), name: nm, akey: rid(10) }); await setRooms(rooms); } return await mData(key, origin); }
async function mRemove(key, sid, origin) { if (!ck(key)) return { ok: false }; await setRooms((await getRooms()).filter((r) => r.sid !== sid)); for (const s of ["roster", "state", "token", "strength", "log"]) await kv.delete(["room", sid, s]); return await mData(key, origin); }

const sAuth = async (sid, k) => sid && k && k === (await akeyOf(sid));
async function sData(sid, k, origin) {
  if (!(await sAuth(sid, k))) return { ok: false };
  return { ok: true, listenerUrl: `${origin}/?s=${sid}`, adminUrl: `${origin}/?s=${sid}&k=${k}`, state: await getState(sid), roster: await getRoster(sid), counts: (await getLog(sid)).counts, strength: await getStrength(sid), hasToken: !!(await getToken(sid)) };
}
async function sSetState(sid, k, on) { if (!(await sAuth(sid, k))) return { ok: false }; await kv.set(["room", sid, "state"], on ? "ON" : "OFF"); return { ok: true, state: await getState(sid) }; }
async function sSetStrength(sid, k, v) { if (!(await sAuth(sid, k))) return { ok: false }; let n = parseInt(v, 10); if (!n || n < 1) n = 1; if (n > 100) n = 100; await kv.set(["room", sid, "strength"], n); return { ok: true, strength: n }; }
async function sSetToken(sid, k, t) { if (!(await sAuth(sid, k))) return { ok: false }; const tok = String(t || "").trim().replace(/^Bearer\s+/i, ""); if (tok) await kv.set(["room", sid, "token"], tok); return { ok: true, hasToken: !!(await getToken(sid)) }; }
async function sAdd(sid, k, rawId, limit) { if (!(await sAuth(sid, k))) return { ok: false, roster: await getRoster(sid) }; const id = norm(rawId); if (!id) return { ok: false, roster: await getRoster(sid) }; let lim = parseInt(limit, 10); if (!lim || lim < 1) lim = 1; const r = await getRoster(sid); const hit = r.find((x) => norm(x.id) === id); if (hit) hit.limit = lim; else r.push({ id, limit: lim }); await setRoster(sid, r); return { ok: true, roster: r }; }
async function sRemove(sid, k, rawId) { if (!(await sAuth(sid, k))) return { ok: false, roster: await getRoster(sid) }; const id = norm(rawId); const r = (await getRoster(sid)).filter((x) => norm(x.id) !== id); await setRoster(sid, r); return { ok: true, roster: r }; }
async function sClearToday(sid, k) { if (!(await sAuth(sid, k))) return { ok: false }; await setLog(sid, { date: today(), counts: {} }); return { ok: true }; }
async function sHistory(sid, k) { if (!(await sAuth(sid, k))) return { ok: false }; return { ok: true, history: await getHistory(sid) }; }
async function sRename(sid, k, oldRaw, newRaw) {
  if (!(await sAuth(sid, k))) return { ok: false, roster: await getRoster(sid) };
  const oldId = norm(oldRaw), newId = norm(newRaw);
  if (!newId) return { ok: false, roster: await getRoster(sid) };
  const r = await getRoster(sid);
  const idx = r.findIndex((x) => norm(x.id) === oldId);
  if (idx < 0) return { ok: false, roster: r };
  if (oldId !== newId && r.some((x) => norm(x.id) === newId)) return { ok: false, roster: r, msg: "そのIDは既に名簿にあります" };
  r[idx].id = newId;
  await setRoster(sid, r);
  if (oldId !== newId) {
    const log = await getLog(sid);
    if (log.counts[oldId] != null) { log.counts[newId] = log.counts[oldId]; delete log.counts[oldId]; await setLog(sid, log); }
    const h = await getHistory(sid); let changed = false;
    for (const e of h) { if (e && norm(e.id) === oldId) { e.id = newId; changed = true; } }
    if (changed) await kv.set(["room", sid, "history"], h);
  }
  return { ok: true, roster: r };
}

async function api(fn, args, origin) {
  const a = args || [];
  switch (fn) {
    case "fire": return await fire(a[0], a[1]);
    case "mData": return await mData(a[0], origin);
    case "mAdd": return await mAdd(a[0], a[1], origin);
    case "mRemove": return await mRemove(a[0], a[1], origin);
    case "sData": return await sData(a[0], a[1], origin);
    case "sSetState": return await sSetState(a[0], a[1], a[2]);
    case "sSetStrength": return await sSetStrength(a[0], a[1], a[2]);
    case "sSetToken": return await sSetToken(a[0], a[1], a[2]);
    case "sAdd": case "sSetLimit": return await sAdd(a[0], a[1], a[2], a[3]);
    case "sRemove": return await sRemove(a[0], a[1], a[2]);
    case "sClearToday": return await sClearToday(a[0], a[1]);
    case "sHistory": return await sHistory(a[0], a[1]);
    case "sRename": return await sRename(a[0], a[1], a[2], a[3]);
    default: return { ok: false };
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const origin = url.origin;
  if (req.method === "POST" && url.pathname === "/api") {
    try { const { fn, args } = await req.json(); return Response.json(await api(fn, args, origin)); }
    catch (_) { return Response.json({ ok: false }); }
  }
  const admin = url.searchParams.get("admin") || "";
  const sid = url.searchParams.get("s") || "";
  const k = url.searchParams.get("k") || "";
  let html;
  if (admin === ADMIN_KEY && !sid) html = MASTER_HTML;
  else if (sid && k && k === (await akeyOf(sid))) html = STREAMER_HTML.replaceAll("__SID__", sid).replaceAll("__K__", k);
  else html = USER_HTML.replaceAll("__SID__", sid);
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
});

// ===== リスナー画面 =====
const USER_HTML = `
<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body{margin:0;font-family:system-ui,sans-serif;background:#1a1e26;color:#eef1f6;display:flex;align-items:center;justify-content:center;min-height:100vh}
  .card{width:90%;max-width:360px;text-align:center;padding:32px 24px}
  h1{font-size:22px;margin:0 0 24px}
  input{width:100%;box-sizing:border-box;padding:14px;font-size:16px;border:1px solid #333a47;border-radius:10px;margin-bottom:16px;text-align:center;background:#232936;color:#eef1f6}
  input::placeholder{color:#7f8899}
  .idbox{display:flex;align-items:center;box-sizing:border-box;border:1px solid #333a47;border-radius:10px;margin-bottom:16px;background:#232936;overflow:hidden}
  .idbox .at{color:#fff;font-weight:bold;font-size:16px;padding-left:16px}
  .idbox input{border:none;margin:0;border-radius:0;text-align:left;padding-left:4px;background:transparent;flex:1;min-width:0}
  .idbox input:focus{outline:none}
  button{width:100%;padding:16px;font-size:18px;font-weight:bold;border:none;border-radius:12px;color:#fff;cursor:pointer;background:linear-gradient(90deg,#2563eb,#3b82f6)}
  button:disabled{opacity:.5}
  .msg{margin-top:20px;font-size:16px;min-height:24px}
  .ok{color:#60a5fa}.ng{color:#ef4444}
</style></head><body>
  <div class="card">
    <h1>⚡ びりびりボタン</h1>
    <div class="idbox"><span class="at">@</span><input id="tid" type="text" placeholder="TikTokのID" autocomplete="off"></div>
    <button id="btn" onclick="go()">びりびりさせる</button>
    <div id="msg" class="msg"></div>
  </div>
<script>
  var SID='__SID__';
  async function call(fn,args){ try{ const r=await fetch('/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({fn,args})}); return await r.json(); }catch(e){ return {ok:false,msg:'通信エラー。もう一度お試しください'}; } }
  window.onload=function(){ var el=document.getElementById('tid'); try{ var s=localStorage.getItem('biribiri_id'); if(s){ el.value=String(s).replace(/^@/,''); } }catch(e){} };
  async function go(){
    var id=document.getElementById('tid').value.trim().replace(/^@/,''),btn=document.getElementById('btn'),msg=document.getElementById('msg');
    if(!SID){msg.textContent='URLが正しくありません';msg.className='msg ng';return;}
    if(!id){msg.textContent='IDを入力してください';msg.className='msg ng';return;}
    try{ localStorage.setItem('biribiri_id', id); }catch(e){}
    btn.disabled=true; msg.textContent='送信中...'; msg.className='msg';
    var r=await call('fire',[SID,id]);
    msg.textContent=r.msg; msg.className='msg '+(r.ok?'ok':'ng'); btn.disabled=false;
  }
</script></body></html>`;

// ===== 運営（マスター）画面 =====
const MASTER_HTML = `
<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root{--bg:#1a1e26;--card:#232936;--line:#333a47;--muted:#8a93a3;--ng:#ef4444}
  body{margin:0;font-family:system-ui,sans-serif;background:var(--bg);color:#eef1f6;padding:20px}
  .wrap{max-width:520px;margin:0 auto}
  h1{font-size:20px;margin:0 0 16px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;margin-bottom:14px}
  .sub{color:var(--muted);font-size:13px;margin:0 0 10px}
  .row{display:flex;gap:8px;align-items:center}
  input{padding:12px;font-size:15px;border:1px solid var(--line);border-radius:9px;box-sizing:border-box;background:#2a3140;color:#eef1f6;flex:1}
  input::placeholder{color:var(--muted)}
  .btn{padding:12px 16px;font-size:15px;font-weight:700;border:none;border-radius:9px;cursor:pointer;background:linear-gradient(90deg,#2563eb,#3b82f6);color:#fff;flex:none}
  .stname{font-size:16px;font-weight:800;display:flex;justify-content:space-between;align-items:center}
  .dot{font-size:12px;color:var(--muted)}
  .u{display:flex;gap:8px;align-items:center;margin-top:10px}
  .u span{font-size:12px;color:var(--muted);width:52px;flex:none}
  .u input{font-size:12px;padding:8px}
  .cp{padding:8px 12px;font-size:13px;font-weight:700;border:none;border-radius:8px;cursor:pointer;background:#3b82f6;color:#fff;flex:none}
  .del{background:var(--ng);color:#fff;border:none;border-radius:7px;padding:6px 12px;font-size:13px;cursor:pointer;margin-top:10px}
  .msg{color:#60a5fa;font-size:12px;min-height:16px;margin-top:6px}
</style></head><body><div class="wrap">
  <h1>⚡ Kmotto びりびり 運営</h1>
  <div class="card">
    <p class="sub">配信者を追加</p>
    <div class="row"><input id="newname" type="text" placeholder="配信者の名前"><button class="btn" onclick="addRoom()">追加</button></div>
    <div class="sub" style="margin:10px 0 0">追加すると管理用URLが発行されます。本人にだけ渡してください。リスナーに配るURLは、本人が自分の管理画面から取得します。</div>
  </div>
  <div id="rooms"></div>
</div>
<script>
  var KEY='kiko-e127e902';
  async function call(fn,args){ const r=await fetch('/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({fn,args})}); return await r.json(); }
  window.onload=async function(){ paint(await call('mData',[KEY])); };
  async function addRoom(){ var v=document.getElementById('newname').value; if(!v.trim())return; var r=await call('mAdd',[KEY,v]); if(r&&r.ok){document.getElementById('newname').value='';paint(r);} }
  function copy(v,el){ if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(v).then(function(){flash(el);});}else{flash(el);} }
  function flash(el){ el.textContent='コピーしました'; setTimeout(function(){el.textContent='';},1500); }
  function paint(r){
    if(!r||!r.ok)return;
    var box=document.getElementById('rooms'); box.innerHTML='';
    if(!r.rooms.length){ box.innerHTML='<div class="card"><span class="sub">まだ配信者がいません。上から追加してください。</span></div>'; return; }
    r.rooms.forEach(function(room){
      var c=document.createElement('div'); c.className='card';
      var head=document.createElement('div'); head.className='stname';
      var nm=document.createElement('span'); nm.textContent=room.name;
      var right=document.createElement('span'); right.className='dot'; right.textContent=(room.state==='ON'?'受付中':'停止中')+(room.hasToken?'':'・鍵未設定');
      head.appendChild(nm); head.appendChild(right);
      var row=document.createElement('div'); row.className='u';
      var lb=document.createElement('span'); lb.textContent='管理用';
      var inp=document.createElement('input'); inp.type='text'; inp.readOnly=true; inp.value=room.adminUrl;
      var cp=document.createElement('button'); cp.className='cp'; cp.textContent='コピー';
      var msg=document.createElement('div'); msg.className='msg';
      cp.onclick=function(){ inp.select(); copy(room.adminUrl, msg); };
      row.appendChild(lb); row.appendChild(inp); row.appendChild(cp);
      var del=document.createElement('button'); del.className='del'; del.textContent='削除';
      del.onclick=async function(){ if(confirm(room.name+' を削除しますか？')) paint(await call('mRemove',[KEY,room.sid])); };
      c.appendChild(head); c.appendChild(row); c.appendChild(msg); c.appendChild(del);
      box.appendChild(c);
    });
  }
</script></body></html>`;

// ===== 配信者 管理画面 =====
const STREAMER_HTML = `
<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<style>
  :root{--bg:#1a1e26;--card:#232936;--line:#333a47;--muted:#8a93a3;--ng:#ef4444}
  body{margin:0;font-family:system-ui,sans-serif;background:var(--bg);color:#eef1f6;padding:20px}
  .wrap{max-width:460px;margin:0 auto}
  h1{font-size:20px;margin:0 0 16px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;margin-bottom:14px}
  .status{text-align:center;font-size:26px;font-weight:800;margin-bottom:14px}
  .toggle{width:100%;padding:20px;font-size:19px;font-weight:800;border:none;border-radius:14px;cursor:pointer;color:#fff}
  .toggle.on{background:linear-gradient(90deg,#2563eb,#3b82f6)}
  .toggle.off{background:var(--ng)}
  .sub{color:var(--muted);font-size:13px;margin:0 0 10px}
  .muted2{color:var(--muted);font-size:12px;white-space:nowrap}
  .row{display:flex;gap:8px;align-items:center}
  input{padding:12px;font-size:15px;border:1px solid var(--line);border-radius:9px;box-sizing:border-box;background:#2a3140;color:#eef1f6}
  input::placeholder{color:var(--muted)}
  input[type=range]{padding:0;border:none;background:transparent;accent-color:#3b82f6;width:100%}
  .idin{flex:1}
  .idbox{display:flex;align-items:center;border:1px solid var(--line);border-radius:9px;background:#2a3140;overflow:hidden}
  .idbox .at{color:#fff;font-weight:bold;font-size:15px;padding-left:12px}
  .idbox input{border:none;background:transparent;padding-left:4px;flex:1;min-width:0}
  .idbox input:focus{outline:none}
  .limin{width:58px;text-align:center;flex:none}
  .strval{font-weight:800;color:#60a5fa}
  .add{padding:12px 16px;font-size:15px;font-weight:700;border:none;border-radius:9px;cursor:pointer;background:linear-gradient(90deg,#2563eb,#3b82f6);color:#fff;flex:none}
  .list{list-style:none;padding:0;margin:12px 0 0}
  .list li{display:flex;align-items:center;gap:8px;padding:10px 0;border-bottom:1px solid var(--line)}
  .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}
  .del{background:var(--ng);color:#fff;border:none;border-radius:7px;padding:6px 12px;font-size:13px;cursor:pointer;flex:none}
  .clear{width:100%;padding:12px;font-size:15px;font-weight:700;border:none;border-radius:9px;cursor:pointer;background:var(--ng);color:#fff;margin-top:4px}
</style></head><body><div class="wrap">
  <h1>⚡ びりびり 管理</h1>
  <div class="card"><div id="status" class="status">…</div><button id="toggle" class="toggle" onclick="toggle()">…</button></div>
  <div class="card">
    <p class="sub">電気の強さ：<span id="stv" class="strval">50</span> / 100</p>
    <input id="strength" type="range" min="1" max="100" value="50">
    <p class="sub" style="margin:16px 0 6px">Pavlokトークン <span id="tokState" class="muted2"></span></p>
    <div class="row"><input id="token" class="idin" type="password" placeholder="トークンを貼って保存"><button class="add" onclick="saveToken()">保存</button></div>
  </div>
  <div class="card">
    <p class="sub">リスナーに配るURL（受付中に押せます）</p>
    <input id="shareUrl" type="text" readonly value="" style="width:100%">
    <button class="add" style="width:100%;margin-top:8px" onclick="copyUrl()">URLをコピー</button>
    <div id="copyMsg" class="sub" style="margin:8px 0 0;text-align:center"></div>
  </div>
  <div class="card">
    <p class="sub">スパファン名簿（<span id="rc">0</span>人）／人ごとに1日の回数を設定</p>
    <div class="row"><div class="idbox idin"><span class="at">@</span><input id="newid" type="text" placeholder="TikTokのID"></div><input id="newlim" class="limin" type="number" min="1" value="1"><button class="add" onclick="addM()">追加</button></div>
    <ul id="list" class="list"></ul>
  </div>
  <div class="card">
    <p class="sub">今日びりびりを使った人：<span id="uc">0</span>人</p>
    <button class="clear" onclick="clearT()">今日の記録をリセット</button>
  </div>
  <div class="card">
    <p class="sub">履歴（過去1ヶ月・日本時間）<span id="hc" class="muted2"></span></p>
    <div class="row" style="gap:8px;margin-bottom:10px">
      <button class="add" style="flex:1" onclick="reloadAll()">🔄 最新に更新</button>
      <button class="add" style="flex:1;background:#334155" onclick="dlCsv()">CSVで保存</button>
    </div>
    <ul id="hist" class="list" style="max-height:260px;overflow:auto"></ul>
  </div>
  <div class="card">
    <p class="sub">スマホで管理する（カメラでQRを読み取り）</p>
    <div id="qr" style="display:flex;justify-content:center;background:#fff;padding:12px;border-radius:10px"></div>
    <button class="add" style="width:100%;margin-top:12px" onclick="copyAdminUrl()">管理URLをコピー</button>
    <div id="admMsg" class="sub" style="margin:8px 0 0;text-align:center"></div>
  </div>
</div>
<script>
  var SID='__SID__', K='__K__', STATE='OFF', ADMURL='', ROSTER=[], COUNTS={}, STRENGTH=50, HASTOKEN=false, HISTORY=[];
  async function call(fn,args){ try{ const r=await fetch('/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({fn,args})}); return await r.json(); }catch(e){ return {ok:false}; } }
  function run(fn,extra,cb){ call(fn,[SID,K].concat(extra||[])).then(function(r){ if(cb)cb(r); }); }
  function nrm(s){ return String(s||'').trim().replace(/^@/,'').toLowerCase(); }
  window.onload=async function(){
    var s=document.getElementById('strength');
    s.oninput=function(){ document.getElementById('stv').textContent=this.value; };
    s.onchange=function(){ run('sSetStrength',[this.value],function(r){ if(r&&r.ok)STRENGTH=r.strength; }); };
    paint(await call('sData',[SID,K]));
    loadHistory();
  };
  async function loadHistory(){ var r=await call('sHistory',[SID,K]); if(r&&r.ok){ HISTORY=r.history||[]; drawHistory(); } }
  function reloadAll(){ call('sData',[SID,K]).then(function(r){ paint(r); }); loadHistory(); }
  function fmtTs(ts){ try{ return new Date(ts).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}); }catch(e){ return ''; } }
  function drawHistory(){
    document.getElementById('hc').textContent='（'+HISTORY.length+'件）';
    var ul=document.getElementById('hist'); ul.innerHTML='';
    var arr=HISTORY.slice().reverse();
    if(!arr.length){ ul.innerHTML='<li><span class="muted2">まだ記録はありません</span></li>'; return; }
    arr.forEach(function(e){
      var li=document.createElement('li');
      var nm=document.createElement('span'); nm.className='nm'; nm.textContent='@'+e.id;
      var tm=document.createElement('span'); tm.className='muted2'; tm.textContent=fmtTs(e.ts);
      li.appendChild(nm); li.appendChild(tm); ul.appendChild(li);
    });
  }
  function dlCsv(){
    var rows=[['日時(JST)','TikTokID']];
    HISTORY.slice().reverse().forEach(function(e){ rows.push([fmtTs(e.ts),'@'+e.id]); });
    var csv=rows.map(function(r){ return r.map(function(c){ return '"'+String(c).replace(/"/g,'""')+'"'; }).join(','); }).join('\\n');
    var blob=new Blob(['\\ufeff'+csv],{type:'text/csv;charset=utf-8'});
    var url=URL.createObjectURL(blob); var a=document.createElement('a'); a.href=url; a.download='biribiri_log.csv'; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function(){URL.revokeObjectURL(url);},1000);
  }
  function paint(r){
    if(!r||!r.ok)return;
    STATE=r.state; ROSTER=r.roster||[]; COUNTS=r.counts||{}; STRENGTH=r.strength||50; HASTOKEN=!!r.hasToken;
    document.getElementById('shareUrl').value=r.listenerUrl||'';
    ADMURL=r.adminUrl||'';
    drawConfig(); drawQR(); drawStatus(); drawRoster(); drawUsed();
  }
  function drawConfig(){
    document.getElementById('strength').value=STRENGTH; document.getElementById('stv').textContent=STRENGTH;
    var t=document.getElementById('tokState'); t.textContent=HASTOKEN?'（設定済み）':'（未設定）'; t.style.color=HASTOKEN?'#60a5fa':'#ef4444';
  }
  function saveToken(){ var t=document.getElementById('token').value; if(!t.trim())return; run('sSetToken',[t],function(r){ if(r&&r.ok){document.getElementById('token').value='';HASTOKEN=r.hasToken;drawConfig();} }); }
  function drawStatus(){
    var s=document.getElementById('status'), b=document.getElementById('toggle');
    if(STATE==='ON'){ s.textContent='🟢 受付中'; s.style.color='#60a5fa'; b.textContent='受付を停止する'; b.className='toggle off'; }
    else{ s.textContent='🔴 停止中'; s.style.color='#ef4444'; b.textContent='受付を開始する'; b.className='toggle on'; }
  }
  function toggle(){ run('sSetState',[STATE!=='ON'],function(r){ if(r&&r.ok){STATE=r.state;drawStatus();} }); }
  function drawUsed(){ document.getElementById('uc').textContent=Object.keys(COUNTS).length; }
  function drawRoster(){
    document.getElementById('rc').textContent=ROSTER.length;
    var ul=document.getElementById('list'); ul.innerHTML='';
    ROSTER.forEach(function(m){
      var used=COUNTS[nrm(m.id)]||0;
      var li=document.createElement('li');
      var nm=document.createElement('span'); nm.className='nm'; nm.textContent='@'+m.id;
      var lim=document.createElement('input'); lim.type='number'; lim.min='1'; lim.value=m.limit; lim.className='limin';
      lim.onchange=function(){ run('sSetLimit',[m.id,lim.value],function(r){ if(r&&r.ok)ROSTER=r.roster; }); };
      var unit=document.createElement('span'); unit.className='muted2'; unit.textContent='回/日';
      var use=document.createElement('span'); use.className='muted2'; use.textContent='今日'+used;
      var edit=document.createElement('button'); edit.textContent='✏️'; edit.className='del'; edit.style.background='#475569';
      edit.onclick=function(){ startEdit(li, m); };
      var del=document.createElement('button'); del.textContent='削除'; del.className='del';
      del.onclick=function(){ run('sRemove',[m.id],function(r){ if(r&&r.ok){ROSTER=r.roster;drawRoster();} }); };
      li.appendChild(nm); li.appendChild(lim); li.appendChild(unit); li.appendChild(use); li.appendChild(edit); li.appendChild(del);
      ul.appendChild(li);
    });
  }
  function startEdit(li, m){
    li.innerHTML='';
    var box=document.createElement('div'); box.className='idbox'; box.style.flex='1';
    var at=document.createElement('span'); at.className='at'; at.textContent='@';
    var inp=document.createElement('input'); inp.type='text'; inp.value=m.id;
    box.appendChild(at); box.appendChild(inp);
    var ok=document.createElement('button'); ok.textContent='保存'; ok.className='add';
    ok.onclick=function(){ var nv=inp.value; if(!nv.trim())return; run('sRename',[m.id,nv],function(r){ if(r&&r.ok){ROSTER=r.roster;drawRoster();loadHistory();}else{alert((r&&r.msg)||'変更できませんでした');drawRoster();} }); };
    var cancel=document.createElement('button'); cancel.textContent='✕'; cancel.className='del';
    cancel.onclick=function(){ drawRoster(); };
    li.appendChild(box); li.appendChild(ok); li.appendChild(cancel);
    inp.focus();
  }
  function addM(){ var v=document.getElementById('newid').value; if(!v.trim())return; var lim=document.getElementById('newlim').value||1; run('sAdd',[v,lim],function(r){ if(r&&r.ok){document.getElementById('newid').value='';document.getElementById('newlim').value=1;ROSTER=r.roster;drawRoster();} }); }
  function clearT(){ run('sClearToday',[],function(r){ if(r&&r.ok){COUNTS={};drawUsed();drawRoster();} }); }
  function drawQR(){ if(window.QRCode&&ADMURL){ var q=document.getElementById('qr'); q.innerHTML=''; new QRCode(q,{text:ADMURL,width:180,height:180,colorDark:'#111',colorLight:'#fff'}); } }
  function copyUrl(){
    var inp=document.getElementById('shareUrl'); inp.select(); inp.setSelectionRange(0,99999);
    var done=function(m){ var e=document.getElementById('copyMsg'); e.style.color='#60a5fa'; e.textContent=m; setTimeout(function(){e.textContent='';},2000); };
    try{ if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(inp.value).then(function(){done('コピーしました');},function(){done('コピーしました');});}else{done('長押しでコピー');} }catch(e){ done('長押しでコピー'); }
  }
  function copyAdminUrl(){
    var done=function(m){ var e=document.getElementById('admMsg'); e.style.color='#60a5fa'; e.textContent=m; setTimeout(function(){e.textContent='';},2000); };
    if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(ADMURL).then(function(){done('コピーしました');},function(){done('QRを使ってください');}); }else{ done('QRを使ってください'); }
  }
</script></body></html>`;
