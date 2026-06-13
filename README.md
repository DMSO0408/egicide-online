# Egicide Online

双人网页联机版 Egicide。游戏服务运行在本机，通过房间码联机；需要异地游玩时，用 Cloudflare Tunnel 把本机 `localhost:3000` 临时暴露出去。

## 启动

```powershell
cd C:\Users\Thinkpad\Desktop\博一上\其他\egicide
npm run build
npm start
```

本机打开：

```text
http://localhost:3000
```

## 临时公网联机

另开一个终端运行：

```powershell
cloudflared tunnel --url http://127.0.0.1:3000
```

复制终端里生成的 `https://*.trycloudflare.com` 链接发给朋友。你和朋友都用这个链接进入网页，一个人创建房间，另一个人输入房间码加入。

如果终端提示找不到 `cloudflared`，关闭当前终端重新打开，或者先执行：

```powershell
$env:Path = [Environment]::GetEnvironmentVariable('Path','User') + ';' + [Environment]::GetEnvironmentVariable('Path','Machine')
```

## 开发命令

```powershell
npm test
npm run build
```

## 当前限制

- 只支持 2 人。
- 房间保存在本机内存里，关闭服务后会消失。
- 没有账号系统，使用浏览器本地 session 恢复玩家身份。
- Cloudflare Tunnel 的临时链接通常每次启动都会变化。

## Render 公网部署

这个项目已包含 `render.yaml`，可以作为 Render Web Service 部署。

推荐流程：

1. 把本目录推送到 GitHub。
2. 打开 Render Dashboard，选择 New > Web Service。
3. 连接 GitHub 仓库，Render 会读取 `render.yaml`。
4. 使用默认配置创建服务。
5. 部署完成后，访问 Render 给出的 `https://*.onrender.com` 地址。

配置等价于：

```text
Build Command: npm ci && npm run build
Start Command: npm start
Health Check Path: /healthz
```

注意：当前房间状态保存在单个 Node 进程内存里。Render 服务重启、重新部署或免费实例休眠后，正在进行的房间会丢失。第一版应保持单实例运行，不要横向扩容。
