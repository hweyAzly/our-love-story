# 我们的时光 · 情侣生活展示网页

静态多页面站点，托管于 GitHub Pages；内容由 `data/site.json` 驱动，通过 Cloudflare Worker 后台在线编辑（服务端校验密码，GitHub Token 不暴露给浏览器）。

线上地址：**https://hwey.qd.je/**

## 目录结构

```
index.html / gallery.html / timeline.html / messages.html / about.html   页面
css/style.css          全站样式
js/main.js             读取 data/site.json 并渲染 + 灯箱 + 留言提交
js/config.js           后台 Worker 地址配置（部署 Worker 后填写）
data/site.json         全部内容：纪念日、时间线、照片列表、留言
images/                上传的照片（由后台自动写入）
worker/worker.js       后台：登录、保存、上传图片、提交留言
worker/wrangler.toml   Worker 配置
worker/README.md       Worker 部署步骤
```

## 内容如何更新

**方式一：后台（推荐）**
部署 `worker/` 后，打开 Worker 地址 → 输入密码 → 改内容/传图 → 「保存并发布」，
提交到 GitHub 后 30–60 秒自动上线。

**方式二：直接改 `data/site.json`**
用 GitHub 网页编辑该文件并提交，同样会自动上线。

## 本地预览

```bash
python -m http.server 8000
# 浏览器打开 http://localhost:8000
```

注意：必须用本地服务器打开，直接双击 `index.html` 时浏览器会以 `file://` 协议
拦截 `fetch("data/site.json")`，页面会退回到 HTML 内嵌的静态示例内容。

## 数据结构（data/site.json）

```json
{
  "love_start": "2024-02-14",
  "timeline": [{ "date": "2024-02-14", "title": "在一起啦", "text": "……" }],
  "photos":   [{ "src": "images/xxx.jpg", "caption": "说明", "emoji": "🌊", "tone": "ph-1" }],
  "messages": [{ "name": "hwey", "text": "……", "time": "2026-11-10 17:30:00" }]
}
```

- `photos[].src` 留空则显示彩色占位块（emoji + tone 控制外观）。
- `messages` 由留言板或后台写入，最新的在最前。

## 部署与域名

- GitHub Pages：仓库 Settings → Pages → Source 选 `main` / `(root)`
- 自定义域名：`CNAME` 文件内容为 `hwey.qd.je`；DNS 用 4 条 A + 4 条 AAAA
  指向 GitHub Pages（DigitalPlat 面板不允许根节点 CNAME）
- 后台部署：见 `worker/README.md`

## 已知限制

- GitHub Pages 不执行服务端代码，因此登录校验必须由 Worker 完成；**不要把密码写进前端 JS**。
- GitHub Contents API 单文件可靠读写上限约 1MB，照片由浏览器压缩后再上传。
- Pages 站点总量 1GB、构建软限 10 次/小时。
