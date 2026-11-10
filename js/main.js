// ============ 我们的时光 - 全站脚本 ============
// 内容来源：data/site.json（由后台 Worker 提交后自动更新）
// 无网络/文件缺失时，保留 HTML 里的静态示例内容

const DEFAULT_LOVE_START = "2024-02-14";
const ADMIN_API = (window.SITE_CONFIG && window.SITE_CONFIG.adminApi) || "";

/* ---------------- 数据加载 ---------------- */
async function loadSiteData() {
  try {
    const res = await fetch("data/site.json?t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

/* ---------------- 在一起天数 ---------------- */
function renderCounter(start) {
  const el = document.getElementById("love-days");
  if (!el) return;
  const s = new Date((start || DEFAULT_LOVE_START) + "T00:00:00");
  const days = Math.floor((Date.now() - s.getTime()) / 86400000);
  el.textContent = days >= 0 ? days : 0;
}

/* ---------------- 时间线 ---------------- */
function renderTimeline(list) {
  const box = document.getElementById("timeline-list");
  if (!box || !Array.isArray(list) || list.length === 0) return;
  box.innerHTML = "";
  list.forEach(function (it) {
    const div = document.createElement("div");
    div.className = "tl-item";
    const d = document.createElement("div");
    d.className = "tl-date";
    d.textContent = it.date || "";
    const card = document.createElement("div");
    card.className = "tl-card";
    const h3 = document.createElement("h3");
    h3.textContent = it.title || "";
    const p = document.createElement("p");
    p.textContent = it.text || "";
    card.appendChild(h3);
    card.appendChild(p);
    div.appendChild(d);
    div.appendChild(card);
    box.appendChild(div);
  });
}

/* ---------------- 相册 ---------------- */
function renderGallery(list) {
  const box = document.getElementById("gallery-grid");
  if (!box || !Array.isArray(list) || list.length === 0) return;
  box.innerHTML = "";
  list.forEach(function (it, i) {
    const fig = document.createElement("figure");
    fig.className = "photo";
    fig.dataset.caption = it.caption || "";
    if (it.src) {
      const img = document.createElement("img");
      img.src = it.src;
      img.alt = it.caption || "";
      img.loading = "lazy";
      fig.appendChild(img);
    } else {
      const ph = document.createElement("div");
      ph.className = "photo-placeholder " + (it.tone || "ph-" + ((i % 6) + 1));
      ph.textContent = it.emoji || "📷";
      fig.appendChild(ph);
    }
    const cap = document.createElement("figcaption");
    cap.textContent = it.caption || "";
    fig.appendChild(cap);
    box.appendChild(fig);
  });
}

/* ---------------- 留言板 ---------------- */
function localMessages() {
  try { return JSON.parse(localStorage.getItem("love_messages") || "[]"); }
  catch (e) { return []; }
}

function renderMessages(list) {
  const box = document.getElementById("msg-list");
  if (!box) return;
  const msgs = Array.isArray(list) ? list.slice() : [];
  if (msgs.length === 0) {
    box.innerHTML =
      '<p style="text-align:center;color:var(--text-soft)">还没有留言，写下第一句吧 🌷</p>';
    return;
  }
  box.innerHTML = "";
  msgs.forEach(function (m) {
    const div = document.createElement("div");
    div.className = "msg-item";
    const head = document.createElement("div");
    head.className = "msg-head";
    const name = document.createElement("span");
    name.className = "msg-name";
    name.textContent = m.name || "";
    const time = document.createElement("span");
    time.className = "msg-time";
    time.textContent = m.time || "";
    head.appendChild(name);
    head.appendChild(time);
    const body = document.createElement("div");
    body.className = "msg-body";
    body.textContent = m.text || "";
    div.appendChild(head);
    div.appendChild(body);
    if (!ADMIN_API) {
      const del = document.createElement("button");
      del.className = "msg-del";
      del.textContent = "删除";
      del.addEventListener("click", function () {
        const arr = localMessages().filter(function (x) {
          return !(x.time === m.time && x.text === m.text);
        });
        localStorage.setItem("love_messages", JSON.stringify(arr));
        renderMessages(arr);
      });
      div.appendChild(del);
    }
    box.appendChild(div);
  });
}

/* ---------------- 相册灯箱 ---------------- */
function initLightbox() {
  const lightbox = document.getElementById("lightbox");
  if (!lightbox) return;
  const imgBox = document.getElementById("lightbox-img");
  const caption = document.getElementById("lightbox-caption");
  document.querySelectorAll(".photo").forEach(function (figure) {
    if (figure.dataset.bound) return;
    figure.dataset.bound = "1";
    figure.addEventListener("click", function () {
      const img = figure.querySelector("img");
      const ph = figure.querySelector(".photo-placeholder");
      imgBox.innerHTML = "";
      if (img) {
        const clone = document.createElement("img");
        clone.src = img.src;
        imgBox.appendChild(clone);
      } else if (ph) {
        const clone = ph.cloneNode(true);
        clone.style.aspectRatio = "auto";
        imgBox.appendChild(clone);
      }
      caption.textContent = figure.dataset.caption || "";
      lightbox.classList.add("show");
    });
  });
}

/* ---------------- 留言提交 ---------------- */
function initMessageForm() {
  const form = document.getElementById("msg-form");
  if (!form) return;
  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    const nameEl = document.getElementById("msg-name");
    const textEl = document.getElementById("msg-text");
    const btn = form.querySelector('button[type="submit"]');
    const name = nameEl.value.trim();
    const text = textEl.value.trim();
    if (!name || !text) return;

    // 未配置后台：只存本机浏览器
    if (!ADMIN_API) {
      const arr = localMessages();
      arr.unshift({ name: name, text: text, time: new Date().toLocaleString("zh-CN", { hour12: false }) });
      localStorage.setItem("love_messages", JSON.stringify(arr));
      form.reset();
      renderMessages(arr);
      return;
    }

    const pwd = prompt("这条留言会提交到网站，请输入密码：");
    if (!pwd) return;
    btn.disabled = true;
    btn.textContent = "提交中…";
    try {
      const res = await fetch(ADMIN_API + "/api/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name, text: text, password: pwd })
      });
      const out = await res.json();
      if (!out.ok) throw new Error(out.error || "提交失败");
      form.reset();
      renderMessages(out.messages || []);
      alert("留言已保存，约 30–60 秒后所有人可见。");
    } catch (err) {
      alert("提交失败：" + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "留下这句话";
    }
  });
}

/* ---------------- 启动 ---------------- */
(async function boot() {
  const data = await loadSiteData();
  if (data) {
    window.SITE_DATA = data;
    renderCounter(data.love_start);
    renderTimeline(data.timeline);
    renderGallery(data.photos);
    if (document.getElementById("msg-list")) {
      const remote = Array.isArray(data.messages) ? data.messages : [];
      renderMessages(remote.length ? remote : localMessages());
    }
  } else {
    renderCounter(DEFAULT_LOVE_START);
    if (document.getElementById("msg-list")) renderMessages(localMessages());
  }
  initLightbox();
  initMessageForm();
})();
