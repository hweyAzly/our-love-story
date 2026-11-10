# 我们的时光 · 情侣生活展示网页

一个纯静态的多页面情侣网站，无需任何构建工具，直接托管到 GitHub Pages 即可上线。

## 页面结构

| 文件 | 页面 | 说明 |
|------|------|------|
| `index.html` | 首页 | 在一起天数计时 + 各页面快捷入口 |
| `gallery.html` | 相册 | 照片墙，点击可放大 |
| `timeline.html` | 时间线 | 恋爱大事记 |
| `messages.html` | 留言板 | 写留言（保存在浏览器 localStorage） |
| `about.html` | 关于我们 | 两个人的小档案 |

## 如何修改成你们自己的内容

1. **纪念日**：打开 `js/main.js`，修改第一行的 `LOVE_START = "2024-02-14"`。
2. **照片**：把照片放进 `images/` 文件夹，然后打开 `gallery.html`，把每个
   `<figure>` 里的 `.photo-placeholder` 占位块换成：
   ```html
   <img src="images/xxx.jpg" alt="说明">
   ```
3. **时间线事件**：打开 `timeline.html`，复制一个 `.tl-item` 块修改日期和文字。
4. **个人资料**：打开 `about.html` 直接改文字。

## 本地预览

直接双击 `index.html` 即可；或在本目录运行：

```bash
python -m http.server 8000
# 然后浏览器访问 http://localhost:8000
```

## 部署到 GitHub Pages（自定义域名）

1. 在 `CNAME` 文件里填入你的域名（不带 `http://`）。
2. 推送到 GitHub 后，进入仓库 **Settings → Pages**，
   Source 选择 `main` 分支 / `(root)` 目录，保存。
3. 到域名服务商的 DNS 管理里，添加两条记录：
   - **A 记录**（根域名 `@`）→ `185.199.108.153`、`185.199.109.153`、
     `185.199.110.153`、`185.199.111.153`（四条都要加）
   - **CNAME 记录**（子域名如 `love`）→ `你的GitHub用户名.github.io`
4. 等待 DNS 生效（几分钟到几小时），GitHub 会自动签发 HTTPS 证书。
