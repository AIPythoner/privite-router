# Privite Router

基于 Render 免费套餐的反向代理，前端 UI 动态管理路径前缀 → 后端服务器的转发规则，**隐藏源站 IP**。

- 路径前缀路由（Render 免费版不支持通配符子域名）
- 管理 UI（HTTP Basic Auth 保护）
- HTTP / HTTPS / WebSocket 转发
- MySQL 持久化（规则修改即时生效，重启/迁移不丢）
- 自 ping 保活 + `/healthz` 端点

## 架构

```
浏览器/客户端
    │  https://your-app.onrender.com/app1/xxx
    ▼
Render Web Service (本项目)
    │  根据路径前缀 → 查路由表
    ▼
真实源站  http://192.0.2.10:8317/xxx
```

## 登录与密码

- 默认用户名：`admin`
- 默认密码：`rP3nL9Kx2mQwT7`（硬编码在 `src/auth.js`，**首次登录后请立即修改**）
- 环境变量 `ADMIN_PASSWORD` 可覆盖默认密码
- 通过 UI 修改的密码会写入 MySQL `settings` 表（或内存模式的 Map），**优先级最高**，会覆盖 env 与默认

访问 `/__admin/` 会自动跳到登录页。登录后右上角有「修改密码」「退出」按钮。

Session 在服务重启后失效（需重新登录），但密码本身只要是 MySQL 模式就持久化。

## 运行模式

- **MySQL 模式**（推荐）：配齐 4 个 `MYSQL_*` 环境变量，规则持久化
- **内存模式**（降级）：缺任意一个 `MYSQL_*`，自动走内存缓存，服务重启后规则丢失。管理 UI 顶部会显示黄色提示条

两种模式代码路径一样，可以随时补上环境变量后重启升级。

## MySQL 准备

在你的源站 MySQL 上执行（服务会自动建表，用户只需有库权限）：

```sql
CREATE DATABASE IF NOT EXISTS router_admin DEFAULT CHARSET utf8mb4;
CREATE USER 'router_admin'@'%' IDENTIFIED BY '一个强密码';
GRANT ALL PRIVILEGES ON router_admin.* TO 'router_admin'@'%';
FLUSH PRIVILEGES;
```

确认 MySQL：
1. `bind-address = 0.0.0.0`（或注释掉）监听公网
2. 防火墙放行 3306
3. 强密码（Render 出口 IP 不固定，必须全网授权）

## 本地运行

```bash
cp .env.example .env    # 填好 MySQL 和 ADMIN_PASSWORD
npm install
npm start
# 打开 http://localhost:3000/__admin/ 登录
```

## 部署到 Render

### 方式 A：Blueprint（推荐）
1. 把本仓库推到 GitHub
2. Render Dashboard → **New +** → **Blueprint** → 选这个仓库
3. `render.yaml` 已配置好，只需填入带 `sync: false` 的敏感变量：
   - `MYSQL_HOST` / `MYSQL_USER` / `MYSQL_PASSWORD` / `MYSQL_DATABASE`
   - `ADMIN_PASSWORD`
   - `SELF_URL`（部署后第一次填，值为 Render 给你的域名，如 `https://your-app.onrender.com`）

### 方式 B：手动
1. New **Web Service** → 连接 GitHub 仓库
2. Environment: `Node`，Build: `npm install`，Start: `npm start`
3. Health Check Path: `/healthz`
4. Environment Variables：
   | Key | Value |
   |---|---|
   | `MYSQL_HOST` | `192.0.2.10` |
   | `MYSQL_PORT` | `3306` |
   | `MYSQL_USER` | `router_admin` |
   | `MYSQL_PASSWORD` | `强密码` |
   | `MYSQL_DATABASE` | `router_admin` |
   | `ADMIN_USER` | `admin` |
   | `ADMIN_PASSWORD` | `管理页强密码` |
   | `SELF_URL` | `https://你的子域.onrender.com` |

### 部署完成后
- 打开 `https://你的子域.onrender.com/__admin/`，用 `ADMIN_USER / ADMIN_PASSWORD` 登录
- 新增一条规则，例如：
  - 路径前缀：`/app1`
  - 目标：`http://192.0.2.10:8317`
  - 勾选「剥离前缀」「启用」
- 访问 `https://你的子域.onrender.com/app1/任意路径` 即转发到源站

## 保活

Render 免费版 15 分钟无请求就休眠。三层保障：

1. **内置自 ping**：服务内部每 10 分钟（`KEEPALIVE_INTERVAL_MS`）GET 一次 `SELF_URL/healthz`
2. **外部监控（强烈推荐）**：用 [UptimeRobot](https://uptimerobot.com/) 免费监控 `https://你的子域.onrender.com/healthz`，5 分钟一次
3. 直接业务流量本身也算活动

内置自 ping 在服务刚刚被唤醒后有效，但如果已经被关停，得靠外部监控唤醒。两者配合最稳。

> 免费套餐每月 750 实例小时 ≈ 31 天 24×7，一个常驻服务在额度内。

## 安全注意

- **不要**把 `.env` 提交到仓库（已在 `.gitignore`）
- `ADMIN_PASSWORD` 用长随机串，避免暴力破解
- 管理页仅 HTTP Basic Auth，建议只从 HTTPS 访问（Render 默认强制 HTTPS）
- MySQL 账号只给最小库权限，别用 root
- 代理本身不做鉴权，**公网可访问**，源站自身的鉴权/限流仍要保留

## 字段含义

| 字段 | 说明 |
|---|---|
| `path_prefix` | 匹配请求路径的前缀（/app1）。最长前缀优先 |
| `target` | 源站 URL（`http://ip:port` 或 `https://host`） |
| `strip_prefix` | `/app1/foo` 转发时是否去掉 `/app1` 只发 `/foo` |
| `preserve_host` | 是否保留浏览器的 Host 头（某些按域名分流的后端需要） |
| `enabled` | 禁用时不会被匹配到（不用删也能临时停用） |
| `note` | 备注 |

保留前缀：`/__admin`（管理页）、`/healthz`（健康检查）不能用作业务前缀。

## 故障排查

| 现象 | 检查 |
|---|---|
| 访问管理页一直弹密码 | `ADMIN_PASSWORD` 是否配置；密码有没有拷贝到空格 |
| `502 Bad Gateway` | 源站可达性：管理页「测试」按钮，或直接 curl target |
| `ECONNREFUSED` | 源站端口未开 / 源站防火墙挡住 Render 出口 |
| `ETIMEDOUT` | 源站在内网 / MySQL 用户没授权 `%` |
| 管理页改完没生效 | 浏览器强刷；看 Render 日志是否有 `[db] connected ...` |
| 休眠后首次请求慢 | 免费版冷启动正常，保活配好就不再出现 |
