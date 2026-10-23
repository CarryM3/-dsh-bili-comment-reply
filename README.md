# DSH B站评论助手

面向 DSH Desktop 的本地插件。扫码登录B站，按关键词规则自动回复**指定本人稿件**下的**新一级评论**。不调用外部模型，不读取其他 B站插件的凭证。

**插件信息与设置界面统一为简体中文**，不随DSH界面语言切换为英文。当前版本：**1.1.0**。

仓库：https://github.com/CarryM3/-dsh-bili-comment-reply

## 使用

1. 插件安装并激活后，打开 **设置 → B站评论助手**。
2. 点击“扫码登录”，使用手机B站“我的 → 扫一扫”，在手机上确认账号。
3. 登录后**自动加载本人已发布投稿**，展示标题、封面和BV号；无需手填BV号。已有登录凭证时打开设置页也会尝试自动加载，失败会明确提示。
4. 勾选要回复的稿件，或点击“全选已加载稿件”。每页20条，点击“加载更多投稿”继续获取；后续加载的稿件**默认不勾选**。支持取消全部选择，单次最多加载或选择1000个稿件。
5. 添加关键词及回复规则；按顺序匹配第一条。不区分英文大小写。默认回复为空时，不回复未匹配的评论。回复可包含 `{user}`、`{title}`，用户内容仅作为文本处理。
6. 点击“保存所选稿件及规则”，再点击“预览回复（不发送）”检查。**加载、勾选、全选和保存均不会开启发送**。
7. 检查已保存范围和规则，勾选发送确认，再点击“确认开启所选稿件自动回复”。确认会绑定当前保存的精确稿件集合及规则；过期的界面确认不能启用后来修改的设置。运行中改变稿件选择会先暂停，保存后必须重新确认。
8. 点击“立即暂停”停止后续发送。已经交给B站的请求无法撤回。

## 范围及限制

- **规则模板版本，不是 AI 自由生成回复**。不支持楼中楼自动回复或历史评论补发。仅加载创作中心已发布投稿，不承诺获取草稿、审核中或已删除稿件；不会绕过B站接口限制。
- 每次开启从当前时刻重新开始监听；暂停或退出 DSH 期间的评论不会补发。
- 每轮最多检查10个所选稿件并轮转，单稿最多读最近3页一级评论，每页请求20条。所选稿件越多，轮转周期越长；高评论量场景可能漏掉两轮之间挤出扫描窗口的新评论。
- 有子回复时最多扫描10页判断本人是否已经回复；未扫描完则跳过，宁可少发。
- 每轮最多发送1条；默认轮询120秒、最小发送间隔60秒、北京时间每日最多尝试20条。可配置范围：轮询60–3600秒，间隔30–3600秒，每日1–100次。
- 每次开启和实际发送前校验账号/稿件归属。跳过作者本人评论和已有作者回复的线程。
- 发送前先持久化 `uncertain` 占位，成功后更新 `sent`。网络失败、请求超时、断电、落库失败均不会自动重试该评论，避免重复回复。取消也保留记录，计入尝试限额。
- 遇到登录失效、验证码、风控、网络或接口异常即暂停，不自动解验证码，不绕过平台限制。请在B站自行处理后再手动开启。
- 插件重载、DSH重启后自动发送默认关闭，需要用户重新授权开启。
- B站扫码得到的是网页登录 Cookie，不是官方 OAuth 开放平台授权。使用社区整理的网页接口，可能随时失效或受到平台限流，请遵守B站规则。

## 隐私与数据

- 登录 Cookie 只在 Host 中使用，通过 DSH `credentials` 服务保存到凭证引用 `DSH_BILI_COMMENT_REPLY_COOKIE`，不写源码、日志、工具输出或客户端响应。
- 如果该凭证引用由外部环境变量覆盖，DSH可能拒绝写入或退出操作；请移除环境覆盖后重试。
- 二维码在 Host 本地生成，无外部二维码服务。扫码成功响应的跳转URL及refresh_token不被跟踪或保存。
- 设置及发送记录使用 DSH `storageDomain`，域名为 `bili_comment_reply`。配置和发送去重跨重启保留，最近30条发送记录在界面展示。
- “退出登录”移除该插件保存的本地凭证，不代表撤销B站所有设备会话，也不删除历史去重记录；如需撤销网页登录，请使用B站设备管理。
- 评论仅在本机进行规则匹配；B站接口通信是完成操作所必需的。

## 安装及开发

1. 从仓库页面点击 **Code → Download ZIP**，下载并解压源代码；也可使用 Git：

```powershell
git clone https://github.com/CarryM3/-dsh-bili-comment-reply.git
```

2. 在 DSH 的插件管理中安装解压或克隆后的目录。Agent可调用以下工具（把路径替换为实际绝对路径）：

```json
{"action":"install_bundle","target":"C:/你的目录/-dsh-bili-comment-reply"}
```

插件不需要构建脚本；依赖由 DSH 插件管理器安装。安装完成后在 **设置 → B站评论助手** 操作。

卸载使用 DSH 插件管理器，只移除插件安装，不手动删除DSH配置。重新安装后自动回复默认关闭；本机已保存的设置和去重记录保留，避免重复回复。

不要手动编辑 DSH profile 的 package.json 或组合补丁。修改已经载入的插件 JavaScript 后需要**重启DSH**加载新模块；仅重新启用不保证清空 Node 模块缓存。

```powershell
pnpm install --ignore-scripts
pnpm run check
pnpm test
```

- `host.js`：Host入口，凭证、持久化、认证API入口及agent工具。
- `index.js`：开发测试入口转导出。
- `client.js`：原生设置插槽，无 iframe，无 DSH Client 私有包导入，使用主题token。
- `engine.js`：规则、所有权验证、发送闸门、限额及去重。
- `bili-api.js`：扫码、登录状态、稿件、评论及发送接口适配器，无损字符串ID。
- `*.test.js`：Node内置测试，模拟接口及存储，不进行真实发言。

Agent工具 `bili_creator_comments` 支持 `status/account/submissions/configure/preview/pause/logout`（`submissions`使用页码`page`，每页20条，仅加载不发送）；配置修改会暂停。扫码和开启只在用户设置界面提供。

## 验证状态

已进行模拟接口、安全边界、异步暂停竞态及插件Host/Client装配测试。未使用真实账号扫码或发送评论。

- 已确认DSH插件可激活，原生设置插槽可注册，真实agent工具的状态查询和配置保存成功。测试后恢复默认配置，自动发送关闭。
- 真实B站接口已验证二维码申请和“等待扫码”轮询；兼容 `account.bilibili.com` 新扫码入口及旧 `passport.bilibili.com` 入口，不输出授权参数或Cookie。
- 测试覆盖：本人稿件校验、规则匹配、去重、发送超时、每日限额、异步暂停竞态、配置保存并发保护、中文设置字典及元数据。
- **未使用真实账号完成扫码登录或发布评论**。真实账号流程需由用户自行验证；自动回复必须在设置界面明确开启。
- 界面实际布局和明暗主题需要在可认证的DSH浏览器页面验收；设置插槽注册和模拟组件测试不能替代真实视觉验收。

## 更新记录

### 1.1.0

- 自动加载本人已发布投稿，展示标题封面，支持分页、逐项勾选和全选已加载稿件，移除手填BV号界面。
- 加载和选择不启动发送；保存后必须独立确认当前稿件集合及回复规则。
- 最多选择1000个稿件，每轮最多检查10个并轮转；后续加载或新发布投稿不会自动加入回复范围。
- 增加真实React交互测试，覆盖自动加载、封面显示、全选范围、分页新增不选中、保存和发送分离、改变选择先暂停。
- 本人投稿接口适配使用创作中心已发布筛选；真实登录账号的投稿加载仍需在用户本机验收，不将模拟接口测试当成真实账号验证。

### 1.0.3

- 插件名称、说明、设置按钮、帮助文案、状态和接口错误统一为简体中文。
- DSH使用其他界面语言时，插件仍显示中文；时间按中文格式展示。
- 增加GitHub仓库信息及发布文件白名单，避免打包依赖目录、测试用例和本机凭证。

### 1.0.2

- 兼容B站迁移后的扫码入口，限制扫码URL为已知的HTTPS域名和路径。
- 配置落库期间禁止并发开启，非法配置同样先暂停自动发送。

## 接口依据

社区文档（非B站官方稳定API承诺）：
- https://github.com/bilibili-plugins/bilibili-api-collect/blob/master/docs/login/login_action/QR.md
- https://github.com/bilibili-plugins/bilibili-api-collect/blob/master/docs/comment/list.md
- https://github.com/bilibili-plugins/bilibili-api-collect/blob/master/docs/comment/action.md
- https://github.com/bilibili-plugins/bilibili-api-collect/blob/master/docs/login/login_info.md
- https://github.com/bilibili-plugins/bilibili-api-collect/blob/master/docs/video/info.md
- https://github.com/bilibili-plugins/bilibili-api-collect/blob/master/docs/creativecenter/videos.md
- https://github.com/lovegaoshi/NoxPlayer/issues/8
