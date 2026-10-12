# 威胁情报(STIX/TAXII)

威胁情报源会把已知恶意的 IP 地址、域名、URL、电子邮件地址和文件哈希带进 OneUptime，并在你的 [安全事件](/docs/telemetry/security-events) 提到其中之一时告诉你。每个情报源订阅一个包含 STIX 2.1 指标的 TAXII 2.1 集合：可以是你自己的 MISP、OpenCTI 或 OpenTAXII 服务器，也可以是某个提供商的集合。OneUptime 自身不提供任何情报源内容：就像 Sigma 规则一样，集合由你自己提供。

:::cards
- [订阅情报源](#订阅情报源): TAXII 服务器、集合以及登录方式。
- [会摄取什么](#会摄取什么): OneUptime 保留的指标模式，以及保留多久。
- [如何找到匹配](#如何找到匹配): 事件到达时打标签，并每分钟比对一次。
- [威胁级别](#威胁级别): 指标的 confidence 如何变成严重程度。
:::

## 工作原理

```mermaid title="从 TAXII 集合到警报"
flowchart TB
    taxii["TAXII 2.1 集合"] -->|"按情报源的<br/>间隔轮询"| indicators["指标：IP、<br/>域名、URL、<br/>邮箱、哈希"]
    events["新的安全事件"] --> tag["到达时用<br/>threat.* 属性<br/>打标签"]
    indicators --> tag
    indicators --> match["每分钟与<br/>最近的事件比对"]
    match --> act["警报、可选的事件<br/>和检测结果"]
```

## 开始之前

- 一个发布 STIX 2.1 `indicator` 对象的 TAXII 2.1 服务器，以及要轮询的集合的 ID。情报源可以匿名登录，也可以使用 bearer 令牌或 HTTP 基本身份验证登录。
- 不支持要求 TLS 客户端证书（双向 TLS）的服务器，例如 CISA AIS。MITRE 的公共 ATT&CK 服务器发布的是技术和组织，而不是指标，所以指向它的情报源会一直为空。
- 一个可以创建情报源的角色：Project Owner、Project Admin、Security Admin 或 Security Member。Security Viewer 可以读取情报源和指标。请参阅 [角色](/docs/permissions/reference#角色)。

## 订阅情报源

:::steps
### 前往 Threat Intel

打开 **产品 → Security Events → Threat Intel** 。

### 创建情报源

点击 **创建Threat Intel Feed** ，填写它的四个步骤：**基本信息**、**TAXII Server**、**认证** 和 **匹配时** 。各字段见下表。

### 检查第一次轮询

一两分钟内，情报源所在行会显示 **Last Polled** ，**Last Poll Summary** 会说明这次轮询取回了什么。指标会出现在情报源下方的 **Indicators** 表中。
:::

| 字段 | 填写内容 |
| --- | --- |
| **TAXII API Root URL** | 服务器的 TAXII 2.1 API 根，例如 `https://taxii.example.com/api1/`。集合在它下面寻址。 |
| **Collection ID** | 发布指标的集合。 |
| **Poll Interval (Minutes)** | 获取新对象的频率：1 到 1440 分钟，默认 60。 |
| **Minimum Confidence** | STIX `confidence` 低于该值的指标会被跳过：0 到 100，设为 0 时全部保留。没有 confidence 的指标总能通过。 |
| **API Token** | bearer 令牌，用于要求令牌的集合。 |
| **Basic Auth Username** 和 **Basic Auth Password** | 用于使用 HTTP 基本身份验证的集合。公共集合请把两者和令牌都留空。 |
| **Create Alert on Match** | 默认打开：每个匹配的指标都会打开一个警报。 |
| **警报严重性** | 该情报源打开的每个警报的严重程度。留空时使用每个指标的威胁级别。 |
| **Create Incident on Match** | 默认关闭。事件会驱动值班升级、SLA 和状态页面，而对于指标匹配，通常警报就足够了。 |
| **事件严重性** | 与 **警报严重性** 相同，用于事件。 |
| **Write Detection Finding on Match** | 默认打开：每次匹配都会向事件流写入一个检测结果。 |

令牌和密码会被加密，保存后不会再显示。要更改它们，请在情报源所在行中选择 **Update Credentials** ，然后选择 **API Token (Bearer)**、**Basic Auth** 或 **Anonymous (clear stored credentials)** ：你的选择会替换情报源的登录方式，所以保存令牌会清除已保存的密码，反之亦然。

### 如何轮询情报源

每次轮询都通过 TAXII 的 `added_after` 游标请求自上次以来新增的对象，并最多读取 10 页、每页 500 个对象。因此大型集合会在多次轮询中完成同步：仍有剩余页面时，**Last Poll Summary** 会说明。要更快完成一次大的首次同步，请把 **Poll Interval (Minutes)** 调低，最低到 1，直到追上为止。

轮询使用用户代理 `OneUptime/<version> (+https://oneuptime.com)` 表明身份。如果提供商的防火墙返回 `403`，请让对方放行它：许多防火墙会拦截看起来像无名脚本的请求。

已停用的情报源既不会被轮询，也不会被比对。它已经拥有的指标会继续为新事件打标签，直到它们过期。

## 会摄取什么

OneUptime 保留模式为下列类型之一上的简单相等比较的 STIX `indicator` 对象：

| 类型 | 示例模式 |
| --- | --- |
| IPv4 地址（`ipv4-addr`） | `[ipv4-addr:value = '198.51.100.7']` |
| IPv6 地址（`ipv6-addr`） | `[ipv6-addr:value = '2001:db8::7']` |
| 域名（`domain-name`） | `[domain-name:value = 'evil.example']` |
| URL（`url`） | `[url:value = 'http://evil.example/payload']` |
| 电子邮件地址（`email-addr`） | `[email-addr:value = 'billing@evil.example']` |
| 文件哈希，SHA-256（`file-hash-sha256`） | `[file:hashes.'SHA-256' = 'e3b0…b855']` |
| 文件哈希，SHA-1（`file-hash-sha1`） | `[file:hashes.'SHA-1' = 'da39…0709']` |
| 文件哈希，MD5（`file-hash-md5`） | `[file:hashes.MD5 = 'd41d…427e']` |

用 `OR` 连接的比较，无论在同一个 `[...]` 内还是跨多个，都没有问题，每个值都会成为一个单独的指标：

```text
[domain-name:value = 'evil.example' OR domain-name:value = 'evil2.example']
[ipv4-addr:value = '198.51.100.7'] OR [url:value = 'http://evil.example/x']
```

任何其他模式，包括带 `AND`、`FOLLOWEDBY`、`NOT`、`LIKE`、`MATCHES`、`WITHIN` 之类时间限定符或其他对象类型的模式，都会被整体跳过，并在 **Last Poll Summary** 中计为不支持。只翻译 `AND` 模式的一部分，会比情报源作者的本意匹配到多得多的内容。

### 指标保持有效多久

- 指标从它的 `valid_from` 开始匹配，直到它的 `valid_until`。没有 `valid_until` 时，它从 `valid_from` 起保持有效 365 天，再次轮询也不会延长。
- 已撤销的指标，或被更新为过去的 `valid_until` 的指标，在更新被轮询到时立即停止匹配。提供商从更新后的模式中删除的值也是如此。
- 值以小写形式存储，匹配时不区分大小写。

**Indicators** 表按存储的样子列出指标，并显示 **状态** 为 **活动**、**已过期** 或 **Revoked** 。重新轮询的指标可能会暂时显示两次，已过期或已撤销的行会一直留在列表中，直到存储清理将其删除，最多在过期后约一个月。比对始终会检查有效期和撤销状态，所以这样的行永远不会匹配。

## 如何找到匹配

### 事件到达时打标签

每个传入的安全事件，无论来自摄取 API 还是某个连接，都会在存储之前与你的有效指标进行检查。当它的某个 observable（从事件中提取的 IP、主机、域名、哈希和用户）等于某个指标的值时，事件会被打上以下属性：

| 属性 | 值 |
| --- | --- |
| `threat.matched` | 在打过标签的事件上始终为 `"true"` |
| `threat.indicator_id` | STIX 指标的 ID |
| `threat.indicator_type` | 指标的类型，例如 `ipv4-addr` 或 `file-hash-sha256` |
| `threat.indicator_value` | 匹配到的值，小写 |
| `threat.feed` / `threat.feed_id` | 指标来自的情报源 |
| `threat.confidence` | 指标的 STIX confidence |
| `threat.match_count` | 事件的 observable 中有多少个与指标匹配 |

当多个指标与同一个事件匹配时，由 confidence 最高的那个填写这些值。它们是普通属性，所以你可以在 **事件** 中搜索它们，用它们过滤安全事件监视器，并在检测规则中使用它们：

```yaml title="threat-intel-logon.yml"
title: High-confidence indicator in a successful logon
level: critical
detection:
  selection:
    threat.matched: 'true'
    threat.confidence|gte: 80
    className: Authentication
    statusName: Success
  condition: selection
```

打标签只知道事件到达时已经存在的指标：事件之后永远不会被重新打标签。

### 每分钟比对一次

每分钟，每个已启用情报源的有效指标都会与事件时间晚于该情报源上次检查的事件进行比对。这样可以捕获在事件打标签之后才到达的情报。

- 第一次检查覆盖最近 15 分钟。发生中断后，下一次检查最多补上最近 24 小时。
- 每个时间窗口只检查一次。在其时间窗口检查完之后才到达的情报，只作用于之后的事件。
- 迟到的事件，即时间早于上次检查的事件，到达时仍会被打标签，但不会被比对。
- 每次检查每个情报源最多比对 100 个指标值：出现在最多事件中的那些。

### 匹配会带来什么

- 一个标题为 `[Threat Intel] <feed name> — <indicator value>` 的警报，在保持打开期间每个情报源和值只有一个。警报解决后，下一次匹配会打开一个新的。警报不会自动解决。
- 一个事件，仅在打开 **Create Incident on Match** 时创建，并以同样的方式去重。
- 一个 Threat Intel 检测结果，在打开 **Write Detection Finding on Match** 时写入：一个来自产品 `OneUptime Threat Intel` 的 `Detection Finding` 事件（OCSF 类别 2004），以指标的威胁级别作为严重程度，并带有以下属性：

| 属性 | 值 |
| --- | --- |
| `oneuptime.threat.feed_id` / `oneuptime.threat.feed_name` | 情报源 |
| `oneuptime.threat.indicator_id` | STIX 指标的 ID |
| `oneuptime.threat.indicator_type` / `oneuptime.threat.indicator_value` | 匹配到了什么 |
| `oneuptime.threat.confidence` | 指标的 confidence |
| `oneuptime.threat.match_count` | 这个检测结果背后有多少个事件 |

检测结果本身永远不会被比对，所以一次匹配不会引发另一次匹配。

## 威胁级别

指标没有 Sigma 级别：由它们的 STIX `confidence` 来设定威胁级别。

| 指标的 confidence | 威胁级别 |
| --- | --- |
| 90 到 100 | Critical |
| 70 到 89 | High |
| 40 到 69 | Medium |
| 1 到 39 | Low |
| 未评分（0 或缺失） | Medium |

未评分的指标按 Medium 计算：毕竟有人选择把它放进了情报源。威胁级别就是检测结果的严重程度，并按以下顺序从你项目的严重程度中为警报选择严重程度：

1. 情报源的 **警报严重性**（或 **事件严重性** ），如果已设置：它适用于该情报源的每次匹配。
2. 与威胁级别同名的严重程度，例如 High，不区分大小写。
3. 按等级：Critical 和 High 取用你最严重的严重程度，Medium 和 Low 取用最轻的。

威胁级别属于每个指标，而不属于情报源，所以同一个情报源可能在同一分钟内打开一个 Critical 警报和一个 Low 警报。**Minimum Confidence** 按同一个数字过滤：最小值设为 70 时只保留 High 和 Critical 指标，外加总能通过的未评分指标。

## 监视情报源的匹配

情报源所在行中的 **创建监视器** 操作会打开一个新的安全事件监视器，统计该情报源的检测结果：事件类别为 `Detection Finding`，按 `oneuptime.threat.feed_id` 中的情报源 ID 过滤（绝不用名称，因为重命名会改变名称），时间范围为最近一小时。可以用它发现突然激增的匹配，或一个原本活跃的情报源突然安静下来。

## 保留和计费

指标是配置，不是遥测数据，不按摄取的数据计费。匹配写入的检测结果是普通的安全事件，像其他事件一样计费和保留：请参阅 [安全事件](/docs/telemetry/security-events#保留和计费)。

## 故障排除

:::details 轮询后设置了 Last Error
`401` 或 `403`：凭据错误或缺失；请用 **Update Credentials** 替换。`403` 也可能是提供商的防火墙拦截了用户代理。`404`：请检查 **TAXII API Root URL** （通常以 `/api1/` 之类的路径结尾）和 **Collection ID** 。下一次轮询成功后，错误就会清除。
:::

:::details 情报源在轮询，但没有出现指标
请阅读 **Last Poll Summary** 。没有取回对象：集合为空，或没有发布指标。不支持的模式：提供商使用了本页列为会被跳过的模式特性。低于最低 confidence：请调低 **Minimum Confidence** 。已失效：提供商发送的指标已经被撤销或已经过期。
:::

:::details 有指标，但什么都没匹配
比对是把指标的值与事件的 observable 进行比较，而不是与每个字段比较：请在 **事件** 中打开一个你预期会匹配的事件，检查它的 observable 中是否包含该值。只有状态为 **活动** 的指标才会匹配。请检查情报源上的 **Last Match Error** 。
:::

:::details 匹配了，但没有打开警报
**Create Alert on Match** 已关闭，或者同一情报源和值的警报仍处于打开状态，之后的匹配都会并入其中。项目至少需要一个警报严重程度，情报源才能打开警报。
:::

## 后续步骤

:::cards
- [安全事件](/docs/telemetry/security-events): 发送事件、搜索它们并编写检测规则。
- [Google SecOps](/docs/integrations/google-secops): 导入 Chronicle 的检测和事件。
- [权限参考](/docs/permissions/reference): Security 角色以及每个角色能做什么。
:::
