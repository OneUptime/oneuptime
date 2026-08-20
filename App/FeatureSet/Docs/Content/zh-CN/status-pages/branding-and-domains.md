# 品牌与自定义域名

状态页是你的客户真正会去看的那一个 OneUptime 界面，所以它应该看起来像是你家的，也应该住在你自己的域名上。这两件事都在状态页侧边菜单的 **品牌** 区块里配置，另外还有一个设置藏在 **高级设置** 里。

动手之前先知道一件事：品牌相关的配置被拆到了七个不同的界面上，而且拆分的位置未必是你猜的那样。徽标和封面图不在 **基本品牌** 上——它们在 **页眉** 上。网站图标在 **基本品牌** 上。颜色在 **概览页面** 上。其余你可能会归为"主题"的一切，都得靠自定义 CSS。

本页逐个走一遍这些界面，然后带你完整走一遍"先 CNAME 后 SSL"的流程，把页面放到 `status.yourcompany.com` 上。

## 每个品牌控件都在哪里

打开一个状态页，侧边菜单的 **品牌** 区块里有七个条目。这份地图能让你不用再瞎找。

| 页面                       | 你在那里设置什么                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| **基本品牌**               | 页面标题、页面描述、搜索引擎收录、网站图标。                                               |
| **页眉**                   | 徽标、封面图、它们的替代文字，以及页眉链接栏。                                             |
| **页脚**                   | 版权信息行和页脚链接栏。                                                                   |
| **概览页面**               | 概览描述、历史图表条形颜色、停机状态、总体正常运行时间百分比。                             |
| **HTML、CSS 和 JavaScript** | 页眉 HTML、页脚 HTML、自定义 CSS、自定义 JavaScript。                                     |
| **自定义域名**             | 你自己的域名、CNAME 验证和 SSL。                                                           |
| **语言**                   | 默认语言，以及页脚切换器里提供的语言。                                                     |

## 基本品牌

**状态页面 → 你的页面 → 品牌 → 基本品牌**（`{id}/branding`）有三张卡片。

- **标题和描述**——卡片会提示这同时也用于 SEO。**编辑** 会打开 **页面标题**（占位符 `Please enter page title here.`）和 **页面描述**。这是搜索引擎和链接预览显示的内容，所以写给客户看，别写给你的团队看。
- **Search Engine Indexing**——只有一个开关 **Allow Search Engines to Index this Status Page**，产品里描述它控制的是 Google 和 Bing 是否可以把这个页面列进搜索结果。默认开启。关掉之后，页面会带着 `noindex, nofollow` 提供。
- **网站图标**——**Edit Favicon** 会打开 **网站图标** 图片上传。这就是浏览器标签页上那个小图标。

什么时候用它：页面只对内、或者还在搭建中。关掉 **Allow Search Engines to Index this Status Page**，免得一个半成品页面开始占据你品牌名的搜索排名。

## 页眉界面

**状态页面 → 你的页面 → 品牌 → 页眉**（`{id}/header-style`）。尽管侧边菜单叫这个名字，你最重要的两个品牌素材其实在这里。

第一张卡片标题是 **徽标、封面和网站图标**，配一个 **Edit Images** 按钮：

- **徽标**——图片上传，占位符 `Upload logo`。
- **Logo Alt Text**——占位符 `Logo of My Company`。留空的话会改用状态页标题。
- **封面**——图片上传，占位符 `Upload cover image`。这是页眉背后那条宽幅横幅。
- **Cover Image Alt Text**——封面图的同款设置。

下面是一张 **页眉链接** 表（"Header Links for your status page"）。每条链接有一个 **标题** 和一个 **链接**（URL，占位符 `https://link.com`），行的顺序靠拖动调整。一条都没配时，表格显示 "No status header link for this status page."。

适合用来：把访客带回你的营销站、文档或支持门户，而不用让他们自己猜网址。

## 页脚界面

**状态页面 → 你的页面 → 品牌 → 页脚**（`{id}/footer-style`）和 **页眉** 是同一个形状，一张卡片加一张表。

- **版权信息**——**Edit Copyright** 打开单个字段 **版权信息**，占位符 `Acme, Inc.`。
- **页脚链接**——同样的 **标题** 加 **链接** 组合，可拖动排序，空表提示为 "No status footer link for this status page."。

法务、隐私和条款链接属于这里。页眉链接管导航，页脚链接管细则。

## 概览页面品牌

**状态页面 → 你的页面 → 品牌 → 概览页面**（`{id}/overview-page-branding`）是唯一一个能配颜色的界面，它同时还决定图表上"故障"意味着什么。

- **概览页面**——**Edit Branding** 打开一个 Markdown 字段 **概览页面描述。**，它会渲染在资源列表上方。用它写一句背景说明：这个页面覆盖什么，以及要找支持该去哪里。
- **Rules for Bar Colors of History Chart**——一张有序、可拖动排序的规则表。每条规则有 **当正常运行时间百分比大于或等于** 和 **则，使用此条形颜色**；表格列头写的是 `When Uptime Percent >=` 和 `Then, Bar Color is`。顺序有意义，所以按你希望的求值次序排好。
- **停机监视器状态**——**Edit Statuses** 打开一个多选，描述为"这些监视器状态被视为停机"。你就是在这里决定，比如说，性能下降状态是否要在这个页面上计入停机。
- **Default Bar Color of the History Chart**——**Edit Default Bar Color** 打开 **默认条形颜色** 选择器，也就是没有任何规则命中时使用的颜色。
- **总体正常运行时间百分比**——**Edit Settings** 打开 **显示总体正常运行时间百分比** 开关和一个 **选择正常运行时间精度** 下拉框，后者默认两位小数（`99.99% (Two Decimal)`）。

**图表覆盖多少天不在这里设。** 那是 **状态页面 → 你的页面 → 高级 → 高级设置**（`{id}/settings`）上的 **显示正常运行时间历史记录（天数）**，有效范围 1 到 90。

## 自定义 HTML、CSS 和 JavaScript

**状态页面 → 你的页面 → 品牌 → HTML、CSS 和 JavaScript**（`{id}/custom-code`）有四张可以各自独立编辑的卡片，背后是状态页上的 `headerHTML`、`footerHTML`、`customCSS` 和 `customJavaScript` 列：

> 启用的自定义 HTML、CSS 和 JavaScript 只会在已验证的自定义域名上提供。默认 `/status-page/:id` URL 与已登录的 OneUptime 区域共用同一源，因此会禁用这些自定义内容。

- **页眉 HTML**——占位符 `Insert Custom HTML here.`，注入到页面头部。
- **页脚 HTML**——同上，用于页脚。
- **自定义 CSS**——占位符 `Insert Custom CSS here.`
- **自定义 JavaScript**——占位符 `Insert Custom JavaScript here.`

**没有主题选择器。** OneUptime 状态页没有任何主题或品牌色设置：产品内置的颜色控件只有 **概览页面** 界面上的 **默认条形颜色** 和历史图表条形颜色规则。字体、背景色、强调色和布局微调全都走这里的 **自定义 CSS**。如果你一直在找一个"品牌色"字段，这就是答案——没有这么个字段，而这个输入框就是那个逃生口。

> 自定义 JavaScript 会在访客的浏览器里运行，而人们打开这个页面的时刻，恰恰是他们担心什么东西坏了的时候。所以让它小一点，尽量自己托管，并且在真正依赖它之前先测过。

## 语言设置

**状态页面 → 你的页面 → 品牌 → 语言**（`{id}/languages`）有两张卡片，两张都是关于访客在页脚拿到的那个语言切换器。

- **默认语言**——**Edit Default Language** 打开一个下拉框，按母语名称和英文名称列出每一种支持的语言（`Deutsch (German)`）。卡片把它描述为首次到访的访客看到的语言；访客随时可以从页脚切换。默认是英语。
- **已启用的语言**——**Edit Enabled Languages** 打开一个多选，占位符 `All languages`。留空则提供全部支持的语言。挑几种，页脚切换器就只列这几种。

OneUptime 自带十六种语言：英语、德语、法语、西班牙语、意大利语、葡萄牙语、荷兰语、丹麦语、挪威语、瑞典语、俄语、日语、韩语、简体中文、繁体中文和印地语。

## 自定义域名

默认情况下，状态页通过它 **概览** 界面上显示的预览 URL 访问。要把它放到你自己的主机名上，前往 **状态页面 → 你的页面 → 品牌 → 自定义域名**（`{id}/domains`）。

卡片标题是 **自定义域名**，它的描述把要求讲得很直接：把你这套安装的状态页 CNAME 记录添加为这些域名的 CNAME，这件事才能成。什么都没配时，表格显示 "No custom domains found."。表格有两列，**域名** 和 **状态**，可按 **域名**、**CNAME 有效** 和 **SSL 已预配** 过滤。

### 动手之前

有两个前提，漏掉任何一个都是这事儿不成的常见原因：

- **父域名必须已经验证过。** **域名** 下拉框只列出项目设置里已验证的域名——字段自带的帮助文字会指引你先去 **更多 → 项目设置 → 自定义域名** 添加一个。
- **这套安装必须配置了状态页 CNAME 记录。** 在自托管部署上，这就是 Docker Compose 里的 `STATUS_PAGE_CNAME_RECORD` 环境变量，或者 Helm `values.yaml` 里的 `statusPage.cnameRecord`。没有它，**添加 CNAME** 和 **订购免费 SSL** 两个弹窗都会显示 "Custom Domains not enabled for this OneUptime installation"，而不是操作说明。

### 添加域名

点击 **Create Status Page Domain**。弹窗（**Create New Status Page Domain**）有两步：

**基础**

- **子域名**——只填标签部分，占位符 `status (leave blank for root)`。只输入 `status`，不要输入整个主机名。留空或输入 `@` 表示使用根域名／顶级域名。
- **域名**——已验证域名的下拉框，占位符 `选择域名`。

**更多**

- **上传自定义证书**——一个开关，默认关闭。保持关闭，OneUptime 会替你申请一张免费证书。打开它，你会得到 **证书** 和 **证书私钥** 两个字段，用来填你自己的 PEM 材料。

## 验证 CNAME

域名还未验证时，那一行会显示 **添加 CNAME** 操作。它会打开一个标题为 **添加 CNAME** 的弹窗，给出你需要粘进 DNS 服务商的全部内容：

- **记录类型**——`CNAME`
- **名称**——你刚创建的完整域名，例如 `status.yourcompany.com`
- **内容**——你这套安装的状态页 CNAME 记录

弹窗会提示，记录到位之后，自动验证最长可能需要 24 小时。你不必干等：弹窗的提交按钮是 **验证 CNAME**，它会按需立刻检查这条记录。

先创建 DNS 记录，再点 **验证 CNAME**。记录还不存在就点，只会失败。

## 订购 SSL 证书

CNAME 验证通过之后——并且只有在你没有上传自己的证书时——那一行会出现 **订购免费 SSL** 操作。它的弹窗 **Order Free SSL Certificate for this Status Page** 会说明 OneUptime 使用 LetsEncrypt、这个过程既安全又免费，以及下单之后预配需要几个小时。提交按钮是 **订购免费 SSL**。

**几个界面给出的时长互相打架**，所以别太当真任何一个数字：订购弹窗说三小时，**状态** 列说一小时，自定义证书说三十分钟。把它们统统理解为"今天晚点再回来看"，如果到那时还没动静就联系支持。

预配完成之后，续期是自动的。你没有任何需要周期性去做的事。

## 读懂域名的状态列

**状态** 列就是整个配置状态机浓缩在一个单元格里。每条消息要么告诉你下一步做什么，要么告诉你已经完事了。

| 状态列显示的内容                                      | 它的含义                                                                          |
| ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| Action Required: Please add your CNAME record.        | CNAME 还没验证通过。添加记录，然后 **验证 CNAME**。                               |
| Action Required: Please order SSL certificate.        | CNAME 已验证，但还没有订购证书。点击 **订购免费 SSL**。                           |
| No action is required, allow 30 minutes to provision. | 你上传了自定义证书，正在安装中。                                                  |
| No action is required, this will be provisioned soon. | 免费证书已下单，正在路上。如果一直没到，联系支持。                                |
| Certificate Provisioned. No action required.          | 搞定。OneUptime 会自动续期证书。                                                  |

如果你已经建好了 DNS 记录，某一行却长时间停在 "Action Required: Please add your CNAME record."，请检查记录的名称是不是完整域名，以及它的内容是否与你这套安装的 CNAME 记录完全一致。

## 由 OneUptime 提供支持

"由 OneUptime 提供"这一行不是品牌区块里的设置。它在 **状态页面 → 你的页面 → 高级 → 高级设置**（`{id}/settings`）的 **由 OneUptime 提供支持的品牌标识** 卡片里，是一个开关：**隐藏“由 OneUptime 提供支持”品牌标识**。和那个页面上的其他卡片一样，**Edit Settings** 打开它。

## 接下来读什么

- [状态页概览](/docs/status-pages/index) —— 状态页是什么，各部分如何拼合在一起。
- [状态页资源与分组](/docs/status-pages/resources-and-groups) —— 选择访客真正看到的内容。
- [订阅者与公告](/docs/status-pages/subscribers) —— 电子邮件、SMS、Slack 和 Webhook 订阅者，以及公告。
- [公共 API](/docs/status-pages/public-api) —— 以编程方式读取状态页数据。
- [事件状态与严重级别](/docs/incidents/states-and-severities) —— 什么会让一个事件出现在页面上又消失。
