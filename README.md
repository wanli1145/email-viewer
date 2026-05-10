# Outlook OAuth2 IMAP 内部测试工具

当前版本：v1.0

本项目是一个本地 Web 端测试工具，用于读取管理员预置的 Outlook OAuth2 凭证。

它不包含 OAuth Redirect、授权页面、本地回调或 Web Server 授权交换逻辑。浏览器只负责展示账号列表和邮件内容；refresh token、access token、SQLite 与 IMAP XOAUTH2 都只在本地 Node 后端处理。

## 启动

```bash
npm run runoutlook
```

默认地址：

```text
http://127.0.0.1:1111
```

如果 1111 被占用：

```bash
PORT=3001 npm start
```

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

也可以通过环境变量指定数据库：

```bash
OAUTH_IMAP_DB=/path/to/oauth_imap_credentials.sqlite3 npm start
```

## 邮件读取

点击左侧账号后，后端会执行：

1. 使用 `client_id` 和 `refresh_token` 请求 Microsoft token endpoint。
2. 使用 `AUTHENTICATE XOAUTH2` 登录 `outlook.office365.com:993`。
3. 选择当前文件夹，统计未读数量，并抓取最近 3 封邮件。
4. 在右侧展示邮件摘要和正文预览。

页面顶部的“批量刷新全部”会按账号列表顺序依次刷新所有账号。每个账号会在左侧列表里显示当前进度、未读数量、最近 3 封邮件摘要；失败账号会保留失败原因，方便快速定位异常凭证或邮箱。

如果 Microsoft token endpoint 在刷新 access token 时返回了新的 `refresh_token`，后端会立即写回 SQLite，避免继续使用旧 refresh token 导致后续失效。若接口返回 `invalid_grant` 等失效信号，页面会把该账号标为异常并提示重新导入最新 refresh token。

可选环境变量：

```bash
MS_TENANT_ID=common
MS_TOKEN_SCOPE="https://outlook.office.com/IMAP.AccessAsUser.All offline_access"
MS_IMAP_HOST=outlook.office365.com
MS_IMAP_PORT=993
MS_TOKEN_KEEPALIVE_INTERVAL_MS=21600000
MS_TOKEN_KEEPALIVE_START_DELAY_MS=30000
```

`MS_TOKEN_KEEPALIVE_INTERVAL_MS` 默认 6 小时。服务会定时刷新本地 SQLite 中的 refresh token；如果 Microsoft 返回了新的 refresh token，会自动写回数据库。
