# Qoder 最新模型目录获取与核对

> 最后验证：2026-09-15（macOS Qoder Desktop）

本文记录如何核对 Qoder 当前账号实际可用的模型 ID，以及为什么 9router 的
“Fetch Qoder Models”可能暂时看不到刚发布的模型。

## 结论

本次从 Qoder Desktop 已刷新的本地模型目录中确认：

| Qoder 显示名称 | 内部 key | 9router 模型名 |
| --- | --- | --- |
| Sonus | `smodel` | `qoder/smodel`，外部别名为 `qd/smodel` |
| Cantus | `cmodel` | `qoder/cmodel`，外部别名为 `qd/cmodel` |

两者都属于 `chat` 场景、处于启用状态，并且是推理模型。Sonus 的目录元数据为
`price_factor: 3.2`、`max_input_tokens: 180000`，与客户端显示的 3.2x 和约 200K
上下文相符。

## 9router 当前的在线拉取路径

9router 的正常生产路径在：

- `open-sse/services/qoderModels.js`
- `open-sse/shared/qoder/constants.js`
- `src/app/api/providers/[id]/models/route.js`

流程如下：

1. 从当前 Qoder 连接取得 device token，或把 PAT 换成 job token。
2. 使用现有 COSY 签名实现请求
   `https://api3.qoder.sh/algo/api/v2/model/list`；job token 改走 `api2.qoder.sh`。
3. 读取响应中的 `chat` 数组，保存每个模型的原始 `model_config`。
4. Dashboard 把启用模型转换为 `qoder/<key>`，再作为自定义模型导入。
5. 目录缓存一小时；“Fetch Qoder Models”会强制刷新。

修复前，该路径使用 `Cosy-Version: 1.0.0`，服务端只返回 16 个旧目录模型，
没有 `smodel` 和 `cmodel`。2026-09-15 的修复把版本标识升级为 `1.13.3`，并把两者
补入静态 registry、能力映射和模型 key 映射。

## 本次如何取得新目录

本次没有猜测模型名，也没有把 `qmodel_preview` 等旧 key 当作 Sonus。实际证据来自
Qoder Desktop 自己刷新并写入的加密模型缓存。

### 1. 找到最新缓存

Qoder 按账号 UID 保存目录：

```text
~/.qoder/.models/<uid>/catalog-v6
```

可以只列出候选文件，不读取认证数据：

```bash
find ~/.qoder/.models -mindepth 2 -maxdepth 2 -type f -name catalog-v6 -print
```

如果存在多个账号，按文件修改时间选择刚由当前 Qoder 会话刷新的目录。目录名
`<uid>`同时也是该文件的解密参数；不要把个人 UID 写进代码或提交到仓库。

### 2. 使用 Qoder 自带的 WASM 解密函数

macOS 应用内的 worker runtime 位于：

```text
/Applications/Qoder.app/Contents/Resources/app.asar.unpacked/
node_modules/@qoder-ai/qoder-agent-sdk/dist/_worker/qoder-worker-runtime.obf.mjs
```

该 runtime 内部的实际调用顺序是：

```js
QSA();
await rN();
const catalog = JSON.parse(
  yI().model_cache_decrypt(encryptedCatalogText, uid),
);
```

- `QSA()`初始化该 bundle 的模块状态。
- `rN()`加载内嵌的 `qoder_auth_wasm`。
- `model_cache_decrypt(ciphertext, uid)`解密 `catalog-v6`。

这些符号没有作为公共 API 导出。因此本次做法是把 worker runtime **复制到临时目录**，
仅在副本中把文件末尾的 CLI 启动入口替换为上述只读检查入口；没有修改
`/Applications/Qoder.app`，也没有修改原始缓存。

检查入口只输出以下白名单字段：

```text
key
display_name
enable
price_factor
max_input_tokens
is_reasoning
is_new
minimal_version
```

不要打印完整解密对象。更不要读取或输出 Qoder 的认证文件、access token、refresh
token、COSY 请求头、machine token 或设备指纹。

### 3. 只取 `chat` 场景并做差异核对

解密后的顶层对象包含多个场景，例如 `chat`、`assistant`、`quest`、`qwork`、
`experts`、`qwake` 和 `app`。9router 的普通聊天路由应以 `chat` 数组为准。

安全的投影逻辑如下：

```js
const models = (catalog.chat || [])
  .filter((model) => model && model.enable !== false)
  .map((model) => ({
    key: model.key,
    displayName: model.display_name || model.key,
    contextLength: Number(model.max_input_tokens) || 131_072,
    isReasoning: Boolean(model.is_reasoning),
    priceFactor: Number(model.price_factor) || 0,
    minimalVersion: model.minimal_version || null,
  }));
```

本次缓存的 `chat` 场景有 18 个启用模型；9router 旧接口返回 16 个。差集正好是：

```json
[
  { "key": "smodel", "display_name": "Sonus" },
  { "key": "cmodel", "display_name": "Cantus" }
]
```

### 4. 用在线协议探针确认根因

为了避免把 Desktop 私有缓存变成生产依赖，本次又使用 9router 现有 COSY 签名和同一
账号执行了只读模型目录探针。探针不调用模型，不消耗推理额度，且只输出模型 key：

| 请求 | `chat` 数量 | 结果 |
| --- | ---: | --- |
| `/algo/api/v2/model/list` + `Cosy-Version: 1.0.0` | 16 | 无 Sonus/Cantus |
| `/algo/api/v2/model/list` + `Cosy-Version: 1.13.3` | 18 | 包含 `smodel`/`cmodel` |
| 同上并增加 `Encode=1` | 18 | 与未增加查询参数相同 |

因此此次缺失的决定因素是 COSY 客户端版本，而不是 endpoint 或响应解密。生产代码继续
使用现有模型列表 endpoint 即可。

## 使用边界

本地缓存解密适合诊断、确认新模型 key 和比对服务端返回，不应成为 9router 的生产
依赖：服务器通常没有 Qoder Desktop，也不应依赖应用内部的混淆符号或私有缓存格式。

正式修复模型拉取时应：

1. 把 COSY 客户端版本升级到模型目录公布的最低 IDE 版本或更高版本。
2. 同时验证 device token（`dt-`）与 PAT 换取的 job token（`jt-`）路径。
3. 把 `smodel`、`cmodel` 加入静态 registry 和 `QODER_MODEL_MAP`，作为在线目录失败时的
   fallback。
4. 查询 `model_config` 时必须去掉模型名末尾的思考等级后缀，例如
   `dmodel(high)`必须解析为 key `dmodel`。
5. 验收时不仅检查列表，还要分别向 `smodel`、`cmodel` 发起代表其用途的聊天请求，
   确认发送的 `model_config.key`正确，且服务端没有静默降级到其他模型。Cantus 带有
   意图门控，过于简单的“只回复一个词”并不是可靠的可用性探针。

## 响应中的 `model: auto`

Qoder 的聊天网关会把显式模型请求的 SSE chunk 也统一标为 `model: "auto"`；历史上的
`ultimate`请求同样如此，因此这个响应字段不能用来判断实际选模。Qoder worker runtime
在把请求交给模型服务时使用的选择表达式是 `model_config.key || "auto"`，实际选择依据
仍是请求中的完整 `model_config`。

9router 因而在 Qoder SSE 适配层把响应模型名规范化为已验证并发送的
`qoder/<model_config.key>`。验收时应同时检查：

1. 在线目录确实包含目标 key；
2. 发出的 `model_config.key`与请求 key 一致；
3. 客户端收到的规范化 `model`与目标 key 一致；
4. 请求正常结束并带有有效内容和 usage。

另外，Qoder 会把上游失败封装在 HTTP 200 的 SSE envelope 中（例如外层
`statusCodeValue: 416`、内层 `type: intention_rejected`）。适配层必须把它还原为
结构化错误响应，不能拼成 assistant 正文，否则“HTTP 200 + 非空 content”会产生假成功。

2026-09-15 的在线验收中，Cantus 对一个分布式支付消费、数据库事务与 Kafka ack
崩溃窗口的端到端分析请求成功返回 `qoder/cmodel`、非空正文和 usage；这比简单问候更能
验证它面向复杂端到端任务的实际路由。
