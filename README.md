# Outlook OAuth2 IMAP 内部测试工具

当前版本：v2.1.0

本项目是一个本地桌面测试工具，用于读取管理员预置的 Outlook / Hotmail OAuth2 凭证。

它不包含 OAuth Redirect、授权页面、本地回调或 Web Server 授权交换逻辑。界面只负责展示账号列表和邮件内容；refresh token、access token、SQLite 与 IMAP XOAUTH2 都只在本地 Node 后端处理。

## 启动

### 桌面 App

开发模式：

```bash
npm run app:dev
```

打包 macOS App：

```bash
npm run app:pack
```

生成 dmg：

```bash
npm run app:dist
```

桌面 App 会自动启动本地后端，并使用系统分配的空闲端口。SQLite 默认保存到系统应用数据目录；首次启动时，如果项目目录下已有 `data/oauth_imap_credentials.sqlite3`，会自动复制一份到 App 数据目录。

### 网页调试模式

```bash
runoutlook
```

默认地址：

```text
http://127.0.0.1:1111
```

如果 1111 被占用，`runoutlook` 会自动尝试 1112、1113，直到 1125，并在终端输出实际地址。

## 外部工具调用

本地后端提供稳定的 JSON API，方便脚本、自动化工具或 AI 工具调用。默认只监听本机地址，不需要 API Key。

机器可读接口说明：

```bash
curl http://127.0.0.1:1111/api/v1/openapi.json
```

服务状态：

```bash
curl http://127.0.0.1:1111/api/v1/health
```

账号列表与最近 token 保活结果：

```bash
curl http://127.0.0.1:1111/api/v1/accounts
```

读取某个账号的文件夹：

```bash
curl http://127.0.0.1:1111/api/v1/accounts/<account_id>/folders
```

读取某个账号最近邮件摘要：

```bash
curl -X POST http://127.0.0.1:1111/api/v1/accounts/<account_id>/messages \
  -H 'content-type: application/json' \
  -d '{"folder":"INBOX"}'
```

等待并提取验证码：

```bash
curl -X POST http://127.0.0.1:1111/api/v1/accounts/<account_id>/code \
  -H 'content-type: application/json' \
  -d '{"folder":"INBOX","wait":true,"timeoutMs":60000,"type":"numeric"}'
```

读取邮件时，每封邮件会额外返回 `codes` 字段，支持数字验证码、字母数字验证码和验证链接。

立即运行 refresh token 保活：

```bash
curl -X POST http://127.0.0.1:1111/api/v1/token-keepalive/run
```

导入凭证：

```bash
curl -X POST http://127.0.0.1:1111/api/v1/import \
  -H 'content-type: application/json' \
  -d '{"credentials":"email----标识----client_id----refresh_token"}'
```

批量删除账号（账号 ID 可从账号列表接口获取）：

```bash
curl -X POST http://127.0.0.1:1111/api/v1/accounts/batch-delete \
  -H 'content-type: application/json' \
  -d '{"ids":["<account_id_1>","<account_id_2>"]}'
```

推荐调用流程：先请求 `/api/v1/health` 确认服务可用，再请求 `/api/v1/accounts` 获取账号 ID，随后按账号调用 `/folders`、`/messages` 或 token 保活接口。

## CSV 格式

在页面右侧粘贴带表头的 CSV：

```csv
email,client_id,refresh_token
user@example.com,xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx,0.A...
```

点击“写入 SQLite”后，数据会保存到：

```text
data/oauth_imap_credentials.sqlite3
```

桌面 App 模式下，首次启动会把该文件复制到 App 数据目录，后续读写 App 数据目录中的数据库。

也可以通过环境变量指定数据库：

```bash
OAUTH_IMAP_DB=/path/to/oauth_imap_credentials.sqlite3 npm start
```

## 邮件读取

点击左侧账号后，后端会执行：

1. 使用 `client_id` 和 `refresh_token` 请求 Microsoft token endpoint。
2. 使用 `AUTHENTICATE XOAUTH2` 登录 Microsoft IMAP，默认依次尝试 `outlook.office365.com:993` 和 `imap-mail.outlook.com:993`。
3. 选择当前文件夹，统计未读数量，并抓取最近 3 封邮件。
4. 在右侧展示邮件摘要、正文预览，并自动提取验证码/验证链接。

页面顶部的“批量刷新全部”会按账号列表顺序依次刷新所有账号。每个账号会在左侧列表里显示当前进度、未读数量、最近 3 封邮件摘要；失败账号会保留失败原因，方便快速定位异常凭证或邮箱。

批量删除账号时，在左侧账号列表勾选一个或多个账号，再点击列表上方的“删除”并确认。删除会同时清理对应的网站标记，且不可撤销。

若只想清理失活邮箱，先点击左侧列表上方的“检测失活”。系统只会把 refresh token 明确失效、账号已禁用或账号不存在的邮箱计入“失活”数量；网络超时、IMAP 读取失败、限流和权限不足不会进入自动删除名单。确认结果后点击“删除失活”即可一次删除这些账号，此操作不可撤销。

如果 Microsoft token endpoint 在刷新 access token 时返回了新的 `refresh_token`，后端会立即写回 SQLite，避免继续使用旧 refresh token 导致后续失效。若接口返回 `invalid_grant` 等失效信号，页面会把该账号标为异常并提示重新导入最新 refresh token。

可选环境变量：

```bash
MS_TENANT_ID=common
MS_TOKEN_SCOPE="https://outlook.office.com/IMAP.AccessAsUser.All offline_access"
MS_IMAP_HOST=outlook.office365.com
MS_IMAP_HOSTS=outlook.office365.com,imap-mail.outlook.com
MS_IMAP_PORT=993
MS_TOKEN_KEEPALIVE_INTERVAL_MS=21600000
MS_TOKEN_KEEPALIVE_START_DELAY_MS=30000
```

`hotmail.com`、`live.com`、`msn.com`、`outlook.com` 等 Microsoft 消费邮箱使用同一套导入格式；如果主 IMAP 入口失败，后端会自动尝试备用入口。设置 `MS_IMAP_HOSTS` 可覆盖自动尝试列表。

`MS_TOKEN_KEEPALIVE_INTERVAL_MS` 默认 6 小时。服务会定时刷新本地 SQLite 中的 refresh token；如果 Microsoft 返回了新的 refresh token，会自动写回数据库。
