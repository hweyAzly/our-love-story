/**
 * 我们的时光 · 后台 Worker
 * ------------------------------------------------------------
 * 作用：在服务端校验密码，用服务端保存的 GitHub Token 提交内容到仓库。
 *      浏览器端永远拿不到 Token，因此可以安全地把管理入口挂在公网。
 *
 * 需要的环境变量（Cloudflare → Settings → Variables and Secrets）：
 *   GITHUB_TOKEN   必填  细粒度 PAT，仅授权 our-love-story，权限 Contents: Read and write
 *   PASSWORD       必填  管理密码
 *   SECRET         必填  随机字符串（用于签名登录令牌），随便敲 32 位
 *   REPO           必填  hweyAzly/our-love-story
 *   BRANCH         选填  main
 *   ALLOWED_ORIGINS 选填 逗号分隔，默认 https://hwey.qd.je,https://hweyazly.github.io
 */

const API = "https://api.github.com";
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 登录有效期 12 小时
const MAX_IMAGE_BYTES = 1_200_000;

/* ---------------- 登录限流（基于 IP，内存实现） ----------------
 * 规则：同一 IP 密码错误 5 次后，从最后一次失败起 10 分钟内禁止再试。
 * 注意：这是每个 PoP（数据中心）内每个 Worker 实例的内存计数，属"尽力而为"——
 * 实例重启或请求落到不同 PoP 时计数会重新开始。对个人站足够；
 * 若要全局强一致，需改用 Durable Objects 或 Cloudflare WAF 规则。
 */
const RL_MAX_FAILURES = 5;
const RL_WINDOW_MS = 10 * 60 * 1000;
const loginAttempts = new Map(); // ip -> { count, resetAt }

function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
}

function pruneRateMap() {
  const now = Date.now();
  for (const [k, v] of loginAttempts) {
    if (v.resetAt <= now) loginAttempts.delete(k);
  }
}

function rateBlocked(ip) {
  pruneRateMap();
  const s = loginAttempts.get(ip);
  if (s && s.resetAt > Date.now() && s.count >= RL_MAX_FAILURES) {
    return Math.ceil((s.resetAt - Date.now()) / 1000); // 剩余秒数
  }
  return 0;
}

function rateFail(ip) {
  const s = loginAttempts.get(ip);
  const now = Date.now();
  if (s && s.resetAt > now) s.count += 1;
  else loginAttempts.set(ip, { count: 1, resetAt: now + RL_WINDOW_MS });
}

function rateClear(ip) {
  loginAttempts.delete(ip);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request.headers.get("Origin"), env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      if (url.pathname === "/" || url.pathname === "/admin") {
        return new Response(ADMIN_HTML, {
          headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
        });
      }

      if (url.pathname === "/api/login" && request.method === "POST") {
        const ip = clientIp(request);
        const waitSec = rateBlocked(ip);
        if (waitSec > 0) {
          return json(
            { ok: false, error: "失败次数过多，请 " + Math.ceil(waitSec / 60) + " 分钟后再试" },
            429,
            Object.assign({ "Retry-After": String(waitSec) }, cors)
          );
        }
        const body = await request.json();
        if (!body.password || !(await sameSecret(body.password, env.PASSWORD, env.SECRET))) {
          rateFail(ip);
          const left = Math.max(0, RL_MAX_FAILURES - (loginAttempts.get(ip) || { count: 0 }).count);
          return json({ ok: false, error: "密码错误（还可尝试 " + left + " 次）" }, 401, cors);
        }
        rateClear(ip);
        const exp = Date.now() + TOKEN_TTL_MS;
        return json({ ok: true, token: exp + "." + (await sign(String(exp), env.SECRET)) }, 200, cors);
      }

      if (url.pathname === "/api/data" && request.method === "GET") {
        const f = await ghGet(env, "data/site.json");
        return json({ ok: true, data: f ? JSON.parse(f.text) : null, sha: f ? f.sha : null }, 200, cors);
      }

      if (url.pathname === "/api/save" && request.method === "POST") {
        const body = await request.json();
        if (!(await verifyToken(body.token, env.SECRET))) {
          return json({ ok: false, error: "登录已过期，请重新登录" }, 401, cors);
        }
        const cur = await ghGet(env, "data/site.json");
        const text = JSON.stringify(body.data, null, 2) + "\n";
        await ghPut(env, "data/site.json", text, body.message || "content: 更新站点内容", cur ? cur.sha : null);
        return json({ ok: true }, 200, cors);
      }

      if (url.pathname === "/api/upload" && request.method === "POST") {
        const body = await request.json();
        if (!(await verifyToken(body.token, env.SECRET))) {
          return json({ ok: false, error: "登录已过期，请重新登录" }, 401, cors);
        }
        const b64 = String(body.dataUrl || "").replace(/^data:[^;]+;base64,/, "");
        if (!b64) return json({ ok: false, error: "图片内容为空" }, 400, cors);
        const bytes = Math.floor((b64.length * 3) / 4);
        if (bytes > MAX_IMAGE_BYTES) {
          return json({ ok: false, error: "图片超过 1.2MB，请先压缩" }, 400, cors);
        }
        const ext = (String(body.name || "").match(/\.(jpe?g|png|webp|gif)$/i) || [".jpg"])[0].toLowerCase();
        const safe = String(body.name || "photo").replace(/\.[^.]+$/, "").replace(/[^\w\u4e00-\u9fa5-]/g, "").slice(0, 24) || "photo";
        const path = "images/" + Date.now() + "-" + safe + ext;
        await ghPutBinary(env, path, b64, "content: 新增图片 " + path);
        return json({ ok: true, path: path }, 200, cors);
      }

      if (url.pathname === "/api/message" && request.method === "POST") {
        const ip = clientIp(request);
        const waitSec = rateBlocked(ip);
        if (waitSec > 0) {
          return json(
            { ok: false, error: "失败次数过多，请 " + Math.ceil(waitSec / 60) + " 分钟后再试" },
            429,
            Object.assign({ "Retry-After": String(waitSec) }, cors)
          );
        }
        const body = await request.json();
        if (!body.password || !(await sameSecret(body.password, env.PASSWORD, env.SECRET))) {
          rateFail(ip);
          return json({ ok: false, error: "密码错误" }, 401, cors);
        }
        rateClear(ip);
        const name = String(body.name || "").trim().slice(0, 20);
        const text = String(body.text || "").trim().slice(0, 300);
        if (!name || !text) return json({ ok: false, error: "名字和内容都不能为空" }, 400, cors);

        const cur = await ghGet(env, "data/site.json");
        if (!cur) return json({ ok: false, error: "找不到 data/site.json" }, 500, cors);
        const data = JSON.parse(cur.text);
        data.messages = Array.isArray(data.messages) ? data.messages : [];
        data.messages.unshift({
          name: name,
          text: text,
          time: new Date().toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" }),
        });
        data.updated_at = new Date().toISOString();
        await ghPut(env, "data/site.json", JSON.stringify(data, null, 2) + "\n", "content: 新留言 by " + name, cur.sha);
        return json({ ok: true, messages: data.messages }, 200, cors);
      }

      return json({ ok: false, error: "接口不存在" }, 404, cors);
    } catch (err) {
      return json({ ok: false, error: String((err && err.message) || err) }, 500, cors);
    }
  },
};

/* ---------------- CORS ---------------- */
function corsHeaders(origin, env) {
  const allow = (env.ALLOWED_ORIGINS || "https://hwey.qd.je,https://hweyazly.github.io")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const ok = origin && allow.includes(origin) ? origin : allow[0] || "*";
  return {
    "Access-Control-Allow-Origin": ok,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, headers || {}),
  });
}

/* ---------------- 加密与签名 ---------------- */
const enc = (s) => new TextEncoder().encode(s);

async function hmacB64(payload, secret) {
  const key = await crypto.subtle.importKey("raw", enc(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc(payload));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

const sign = (payload, secret) => hmacB64(payload, secret);

async function sameSecret(input, expected, secret) {
  if (!expected) return false;
  const a = await hmacB64("cmp:" + input, secret || "salt");
  const b = await hmacB64("cmp:" + expected, secret || "salt");
  return a === b;
}

async function verifyToken(token, secret) {
  if (!token || typeof token !== "string" || !token.includes(".")) return false;
  const i = token.indexOf(".");
  const exp = token.slice(0, i);
  const sig = token.slice(i + 1);
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  return sig === (await sign(exp, secret));
}

/* ---------------- GitHub 读写 ---------------- */
function ghHeaders(env) {
  return {
    Authorization: "Bearer " + env.GITHUB_TOKEN,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "love-site-worker",
  };
}

function b64encodeUtf8(str) {
  const bytes = enc(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64decodeUtf8(b64) {
  const bin = atob(String(b64).replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function ghGet(env, path) {
  const ref = env.BRANCH || "main";
  const res = await fetch(`${API}/repos/${env.REPO}/contents/${path}?ref=${ref}`, { headers: ghHeaders(env) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("读取仓库失败 HTTP " + res.status);
  const j = await res.json();
  return { sha: j.sha, text: b64decodeUtf8(j.content) };
}

async function ghPut(env, path, text, message, sha) {
  const body = {
    message: message,
    content: b64encodeUtf8(text),
    branch: env.BRANCH || "main",
  };
  if (sha) body.sha = sha;
  const res = await fetch(`${API}/repos/${env.REPO}/contents/${path}`, {
    method: "PUT",
    headers: Object.assign({ "Content-Type": "application/json" }, ghHeaders(env)),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("提交失败 HTTP " + res.status + " " + (await res.text()).slice(0, 160));
  return res.json();
}

async function ghPutBinary(env, path, b64, message) {
  const res = await fetch(`${API}/repos/${env.REPO}/contents/${path}`, {
    method: "PUT",
    headers: Object.assign({ "Content-Type": "application/json" }, ghHeaders(env)),
    body: JSON.stringify({ message: message, content: b64, branch: env.BRANCH || "main" }),
  });
  if (!res.ok) throw new Error("上传失败 HTTP " + res.status + " " + (await res.text()).slice(0, 160));
  return res.json();
}

/* ---------------- 后台页面 ---------------- */
const ADMIN_HTML = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>后台 · 我们的时光</title>
<style>
:root{--p:#e5647e;--pd:#c74a63;--bg:#fff8f9;--t:#3d2b31;--s:#8a6b74}
*{box-sizing:border-box}
body{margin:0;font-family:"PingFang SC","Microsoft YaHei",sans-serif;background:var(--bg);color:var(--t);line-height:1.6}
header{background:#fff;padding:14px 20px;display:flex;justify-content:space-between;align-items:center;box-shadow:0 2px 10px rgba(229,100,126,.1);position:sticky;top:0;z-index:5}
h1{font-size:18px;margin:0;color:var(--pd)}
.wrap{max-width:900px;margin:0 auto;padding:20px}
.card{background:#fff;border-radius:14px;padding:18px;margin-bottom:18px;box-shadow:0 6px 18px rgba(229,100,126,.1)}
h2{font-size:16px;margin:0 0 12px;color:var(--pd)}
label{display:block;font-size:13px;color:var(--s);margin:8px 0 4px}
input,textarea,select{width:100%;padding:9px 12px;border:2px solid #fdeef1;border-radius:9px;font:inherit;font-size:14px;outline:none}
input:focus,textarea:focus{border-color:var(--p)}
button{padding:9px 18px;border:none;border-radius:999px;background:var(--p);color:#fff;font:inherit;font-size:14px;cursor:pointer}
button.ghost{background:transparent;color:var(--p);border:2px solid var(--p)}
button.mini{padding:4px 12px;font-size:12px;background:#f4c6d0;color:#7a2f41}
button:disabled{opacity:.55;cursor:default}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end}
.row>div{flex:1;min-width:150px}
.item{border:1px solid #fdeef1;border-radius:10px;padding:12px;margin-bottom:10px;position:relative}
.del{position:absolute;right:10px;top:10px}
.hint{font-size:12px;color:var(--s);margin-top:6px}
.hidden{display:none}
#toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);background:#3d2b31;color:#fff;padding:10px 20px;border-radius:999px;font-size:14px;opacity:0;transition:.25s;pointer-events:none}
#toast.on{opacity:1}
.thumbs{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px}
.thumb{border-radius:8px;overflow:hidden;background:#fdeef1;font-size:11px;text-align:center}
.thumb img{width:100%;height:90px;object-fit:cover;display:block}
</style></head><body>
<header><h1>❤ 我们的时光 · 后台</h1><div id="who"></div></header>
<div class="wrap">

  <div class="card" id="login-card">
    <h2>登录</h2>
    <label>管理密码</label>
    <input type="password" id="pwd" placeholder="输入密码后回车">
    <div class="row" style="margin-top:12px"><button id="btn-login">登录</button></div>
    <p class="hint">密码在 Cloudflare 服务端校验，不会写进网页源码。</p>
  </div>

  <div id="panel" class="hidden">
    <div class="card">
      <h2>基本信息</h2>
      <label>在一起纪念日（YYYY-MM-DD）</label>
      <input id="love_start">
    </div>

    <div class="card">
      <h2>时间线</h2>
      <div id="tl-list"></div>
      <button class="ghost mini" id="add-tl">+ 添加一条</button>
    </div>

    <div class="card">
      <h2>照片</h2>
      <div class="row">
        <div><label>选择图片（自动压缩到 1600px / 1.2MB 内）</label><input type="file" id="file" accept="image/*" multiple></div>
        <div><label>说明文字</label><input id="cap" placeholder="例如：第一次一起看海 🌊"></div>
        <div style="flex:0"><button id="btn-up">上传</button></div>
      </div>
      <div class="thumbs" id="ph-list" style="margin-top:14px"></div>
    </div>

    <div class="card">
      <h2>留言</h2>
      <div id="msg-list"></div>
    </div>

    <div class="card" style="position:sticky;bottom:0">
      <div class="row">
        <div style="flex:0"><button id="btn-save">保存并发布</button></div>
        <div style="flex:0"><button class="ghost" id="btn-out">退出登录</button></div>
      </div>
      <p class="hint">保存后会提交到 GitHub，Pages 约 30–60 秒自动更新。</p>
    </div>
  </div>
</div>
<div id="toast"></div>

<script>
var TOKEN = localStorage.getItem("love_token") || "";
var DATA = null, SHA = null;

function $(id){return document.getElementById(id)}
function toast(m){var t=$("toast");t.textContent=m;t.classList.add("on");setTimeout(function(){t.classList.remove("on")},2600)}
function api(p,body){
  return fetch(p,{method:body?"POST":"GET",headers:{"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined})
    .then(function(r){return r.json()});
}
function el(tag,cls,txt){var e=document.createElement(tag);if(cls)e.className=cls;if(txt!=null)e.textContent=txt;return e}

function showPanel(on){
  $("panel").classList.toggle("hidden",!on);
  $("login-card").classList.toggle("hidden",on);
  $("who").textContent = on ? "已登录" : "";
}

function loadData(){
  return api("/api/data").then(function(r){
    if(!r.ok) throw new Error(r.error||"读取失败");
    DATA = r.data || {love_start:"2024-02-14",timeline:[],photos:[],messages:[]};
    SHA = r.sha;
    render();
  });
}

function render(){
  $("love_start").value = DATA.love_start || "";
  var tl = $("tl-list"); tl.innerHTML="";
  (DATA.timeline||[]).forEach(function(it,i){
    var box = el("div","item");
    var row = el("div","row");
    var d1 = el("div"); d1.appendChild(el("label",null,"日期")); var i1=el("input"); i1.value=it.date||""; i1.oninput=function(){it.date=i1.value}; d1.appendChild(i1); row.appendChild(d1);
    var d2 = el("div"); d2.appendChild(el("label",null,"标题")); var i2=el("input"); i2.value=it.title||""; i2.oninput=function(){it.title=i2.value}; d2.appendChild(i2); row.appendChild(d2);
    box.appendChild(row);
    var d3 = el("div"); d3.appendChild(el("label",null,"内容")); var t3=el("textarea"); t3.rows=2; t3.value=it.text||""; t3.oninput=function(){it.text=t3.value}; d3.appendChild(t3); box.appendChild(d3);
    var b = el("button","mini del","删除"); b.onclick=function(){DATA.timeline.splice(i,1);render()}; box.appendChild(b);
    tl.appendChild(box);
  });

  var ph = $("ph-list"); ph.innerHTML="";
  (DATA.photos||[]).forEach(function(p,i){
    var box = el("div","thumb");
    if(p.src){var img=el("img");img.src=p.src;box.appendChild(img)}else{var ph2=el("div",null,p.emoji||"📷");ph2.style.height="90px";ph2.style.display="flex";ph2.style.alignItems="center";ph2.style.justifyContent="center";ph2.style.fontSize="26px";box.appendChild(ph2)}
    box.appendChild(el("div",null,p.caption||""));
    var b = el("button","mini","删"); b.style.margin="4px"; b.onclick=function(){DATA.photos.splice(i,1);render()}; box.appendChild(b);
    ph.appendChild(box);
  });

  var ml = $("msg-list"); ml.innerHTML="";
  if(!(DATA.messages||[]).length) ml.appendChild(el("p","hint","暂无留言"));
  (DATA.messages||[]).forEach(function(m,i){
    var box = el("div","item");
    box.appendChild(el("div","hint",(m.name||"")+" · "+(m.time||"")));
    box.appendChild(el("div",null,m.text||""));
    var b = el("button","mini del","删除"); b.onclick=function(){DATA.messages.splice(i,1);render()}; box.appendChild(b);
    ml.appendChild(box);
  });
}

function compress(file){
  return new Promise(function(resolve,reject){
    var img = new Image();
    img.onload = function(){
      var max = 1600, w = img.width, h = img.height;
      if(w>max||h>max){ var s = Math.min(max/w,max/h); w=Math.round(w*s); h=Math.round(h*s); }
      var cv = document.createElement("canvas"); cv.width=w; cv.height=h;
      cv.getContext("2d").drawImage(img,0,0,w,h);
      var q = 0.82, url = cv.toDataURL("image/jpeg",q);
      while(url.length*0.75 > 1100000 && q > 0.4){ q -= 0.1; url = cv.toDataURL("image/jpeg",q); }
      resolve(url);
    };
    img.onerror = function(){reject(new Error("图片读取失败"))};
    img.src = URL.createObjectURL(file);
  });
}

$("btn-login").onclick = function(){
  var p = $("pwd").value;
  if(!p) return toast("请输入密码");
  api("/api/login",{password:p}).then(function(r){
    if(!r.ok) return toast(r.error||"登录失败");
    TOKEN = r.token; localStorage.setItem("love_token",TOKEN);
    showPanel(true); loadData().then(function(){toast("登录成功")}).catch(function(e){toast(e.message)});
  });
};
$("pwd").addEventListener("keydown",function(e){if(e.key==="Enter")$("btn-login").click()});

$("add-tl").onclick = function(){
  DATA.timeline = DATA.timeline || [];
  DATA.timeline.push({date:new Date().toISOString().slice(0,10),title:"新的日子",text:""});
  render();
};

$("btn-up").onclick = async function(){
  var f = $("file").files[0];
  if(!f) return toast("请先选择图片");
  var btn = $("btn-up"); btn.disabled=true; btn.textContent="处理中…";
  try{
    var dataUrl = await compress(f);
    var r = await api("/api/upload",{token:TOKEN,name:f.name,dataUrl:dataUrl});
    if(!r.ok) throw new Error(r.error||"上传失败");
    DATA.photos = DATA.photos || [];
    DATA.photos.unshift({src:r.path,caption:$("cap").value||"",emoji:"📷"});
    $("file").value=""; $("cap").value="";
    render(); toast("图片已提交，保存后生效");
  }catch(e){ toast(e.message) }
  finally{ btn.disabled=false; btn.textContent="上传" }
};

$("btn-save").onclick = function(){
  var btn = $("btn-save"); btn.disabled=true; btn.textContent="提交中…";
  DATA.updated_at = new Date().toISOString();
  api("/api/save",{token:TOKEN,data:DATA}).then(function(r){
    if(!r.ok) throw new Error(r.error||"保存失败");
    toast("已提交，30–60 秒后线上更新");
  }).catch(function(e){ toast(e.message) })
  .finally(function(){ btn.disabled=false; btn.textContent="保存并发布" });
};

$("btn-out").onclick = function(){ localStorage.removeItem("love_token"); TOKEN=""; showPanel(false); };

if(TOKEN){ showPanel(true); loadData().catch(function(){ localStorage.removeItem("love_token"); TOKEN=""; showPanel(false); }); }
else { showPanel(false); }
</script>
</body></html>`;
