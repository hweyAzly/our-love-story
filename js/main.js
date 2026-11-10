// ============ 我们的时光 - 全站脚本 ============

// 在一起天数倒计时（首页）
// 修改这里即可自定义纪念日
const LOVE_START = "2024-02-14";

(function calcLoveDays() {
  const el = document.getElementById("love-days");
  if (!el) return;
  const start = new Date(LOVE_START + "T00:00:00");
  const now = new Date();
  const days = Math.floor((now - start) / (1000 * 60 * 60 * 24));
  el.textContent = days >= 0 ? days : 0;
})();

// ---------- 相册：点击放大 ----------
(function initLightbox() {
  const lightbox = document.getElementById("lightbox");
  if (!lightbox) return;
  const imgBox = document.getElementById("lightbox-img");
  const caption = document.getElementById("lightbox-caption");

  document.querySelectorAll(".photo").forEach((figure) => {
    figure.addEventListener("click", () => {
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

  lightbox.addEventListener("click", () => lightbox.classList.remove("show"));
})();

// ---------- 留言板（localStorage 本地保存） ----------
(function initMessages() {
  const form = document.getElementById("msg-form");
  if (!form) return;
  const list = document.getElementById("msg-list");
  const KEY = "love_messages";

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; }
    catch { return []; }
  }
  function save(arr) { localStorage.setItem(KEY, JSON.stringify(arr)); }

  function render() {
    const msgs = load();
    list.innerHTML = "";
    if (msgs.length === 0) {
      list.innerHTML =
        '<p style="text-align:center;color:var(--text-soft)">还没有留言，写下第一句吧 🌷</p>';
      return;
    }
    msgs.forEach((m, i) => {
      const div = document.createElement("div");
      div.className = "msg-item";
      div.innerHTML =
        '<div class="msg-head"><span class="msg-name"></span><span class="msg-time"></span></div>' +
        '<div class="msg-body"></div>' +
        '<button class="msg-del" title="删除">删除</button>';
      div.querySelector(".msg-name").textContent = m.name;
      div.querySelector(".msg-time").textContent = m.time;
      div.querySelector(".msg-body").textContent = m.text;
      div.querySelector(".msg-del").addEventListener("click", () => {
        const arr = load();
        arr.splice(i, 1);
        save(arr);
        render();
      });
      list.appendChild(div);
    });
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = document.getElementById("msg-name").value.trim();
    const text = document.getElementById("msg-text").value.trim();
    if (!name || !text) return;
    const arr = load();
    arr.unshift({
      name,
      text,
      time: new Date().toLocaleString("zh-CN", { hour12: false }),
    });
    save(arr);
    form.reset();
    render();
  });

  render();
})();
