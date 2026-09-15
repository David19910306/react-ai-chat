# react-ai-chat

react + node + express 的 AI 聊天应用，前端 SSE 流式展示，后端对接 DeepSeek（OpenAI 兼容接口）。

## 项目结构

```
├── client/            # React 19 + Vite + TypeScript + antd + Tailwind
└── server/            # Express 5 + MySQL + OpenAI SDK
```

## 快速开始

### 1. 安装依赖

```bash
pnpm install        # 根目录（或分别到 client/、server/ 下执行）
```

### 2. 配置服务端环境变量

```bash
cp server/.env.example server/.env.development
```

编辑 `server/.env.development`，填入：
- `DB_USER` / `DB_PASSWORD` / `DB_NAME`：你的 MySQL 配置
- `JWT_SECRET`：随机密钥，可用 `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` 生成
- `OPENAI_API_KEY`：你的 DeepSeek / OpenAI 密钥

> ⚠️ `.env*` 文件不入库（已在 `.gitignore` 中忽略），请勿提交任何真实密钥。

### 3. 启动

```bash
pnpm dev           # 同时启动前后端（前端 http://localhost:5173）
# 或分别启动：
pnpm dev:server    # 后端 http://localhost:3000
pnpm dev:client    # 前端
```

访问 `http://localhost:5173`，注册账号后即可对话。

## 脚本

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 同时启动前后端 |
| `pnpm build` | 构建前端 |
| `pnpm typecheck` | 服务端 TS 类型检查 |
| `pnpm lint` | 前端 ESLint |

## 主要功能

- 用户注册 / 登录（JWT 鉴权，密码 scrypt 加盐哈希）
- SSE 流式聊天（前端流式渲染 Markdown）
- 历史对话（TODO）
