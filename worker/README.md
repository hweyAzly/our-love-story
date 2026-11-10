# 后台 Worker 部署说明

这套后台的作用：**在服务端校验密码，用服务端保存的 GitHub Token 提交内容**。
浏览器端永远拿不到 Token，所以管理入口可以安全地挂在公网。

## 一、准备一个专用 Token（不要用之前那个全权限 Token）

1. 打开 https://github.com/settings/personal-access-tokens → **Generate new token**
2. Repository access → 选 **Only select repositories** → 只勾 `our-love-story`
3. Permissions → **Contents: Read and write**（其余保持 No access）
4. 生成后记下 `github_pat_...` 开头的值

## 二、部署 Worker（Cloudflare 网页版，无需命令行）

1. 注册/登录 https://dash.cloudflare.com
2. 左侧 **Compute (Workers & Pages)** → **Create** → **Workers** → **Start with Hello World!**
3. 名称填 `love-admin` → Deploy
4. 点 **Edit code**，把本目录 `worker.js` 的全部内容粘贴覆盖，右上角 **Deploy**
5. 进入该 Worker → **Settings** → **Variables and Secrets**，逐个添加：

| 名称 | 类型 | 值 |
|---|---|---|
| `GITHUB_TOKEN` | Secret | 第一步生成的 `github_pat_...` |
| `PASSWORD` | Secret | 你的管理密码 |
| `SECRET` | Secret | 随机 32 位字符串（随便敲，用于签名登录令牌） |
| `REPO` | Text | `hweyAzly/our-love-story` |
| `BRANCH` | Text | `main` |
| `ALLOWED_ORIGINS` | Text | `https://hwey.qd.je,https://hweyazly.github.io` |

6. 保存后重新 Deploy 一次，记下 Worker 地址，形如
   `https://love-admin.你的子域.workers.dev`

## 三、把地址填回静态站

打开 `js/config.js`，改成：

```js
window.SITE_CONFIG = { adminApi: "https://love-admin.你的子域.workers.dev" };
```

提交推送后，站点留言板就会走 Worker 写入仓库。

## 四、使用

- 后台地址：`https://love-admin.xxx.workers.dev`（输入密码登录）
- 可改：纪念日、时间线、照片（自动压缩）、留言
- 点「保存并发布」→ 提交到 GitHub → 30–60 秒后 hwey.qd.je 自动更新
- 登录状态 12 小时过期

## 注意事项

- 图片经浏览器 canvas 压缩到长边 1600px、JPEG 质量 ≤0.82，实测约 150–400KB，
  远低于 GitHub Contents API 1MB 的读写可靠区间。
- GitHub Pages 站点总量上限 1GB，照片累积过多需换图床。
- Worker 免费额度：每天 10 万次请求，个人站完全够用。
