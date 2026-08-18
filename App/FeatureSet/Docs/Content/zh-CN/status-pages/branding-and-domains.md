# 品牌与自定义域名

状态页是客户真正会去查看的那个 OneUptime 界面，因此它应该看起来属于你，并运行在你自己的域名上。这两点都在状态页侧边菜单的**品牌**部分配置，另外还有一项设置藏在**高级设置**里。

在开始之前你需要知道：品牌相关设置分散在七个独立的页面上，而且分布方式并不总是符合你的预期。徽标和封面图并不在**基本品牌**中——它们在**页眉**里。网站图标在**基本品牌**中。颜色在**概览页面**中。其余你可能认为属于"主题"的一切都归为自定义 CSS。

本页将依次介绍每个页面，然后带你完整走一遍将页面部署到 `status.yourcompany.com` 所需的先添加 CNAME、再签发 SSL 的流程。

## 每个品牌控件所在的位置

打开一个状态页，侧边菜单的**品牌**部分共有七个项目。下面是一份地图，让你不必再四处寻找。

| 页面                        | 你在这里设置的内容                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------- |
| **基本品牌**                | 页面标题、页面描述、搜索引擎索引、网站图标。                                            |
| **页眉**                    | 徽标、封面图、它们的替代文本，以及页眉链接栏。                                          |
| **页脚**                    | 版权信息行和页脚链接栏。                                                              |
| **概览页面**                | 概览描述、历史图表条形颜色、停机状态、总体正常运行时间百分比。                          |
| **HTML, CSS & JavaScript**  | 页眉 HTML、页脚 HTML、自定义 CSS、自定义 JavaScript。                                  |
| **自定义域名**              | 你自己的域名、CNAME 验证和 SSL。                                                      |
| **语言**                    | 默认语言以及页脚语言切换器中提供的语言。                                                |

## 基本品牌

**状态页 → 你的页面 → 品牌 → 基本品牌**（`{id}/branding`）包含三张卡片。

- **标题和描述** —— 卡片说明这也会用于 SEO。**编辑**会打开**页面标题**（占位符 `Please enter page title here.`）和**页面描述**。这是搜索引擎和链接预览显示的内容，所以要为客户而写，而不是为你的团队而写。
- **搜索引擎索引** —— 一个开关，**Allow Search Engines to Index this Status Page**，产品中将其描述为控制 Google 和 Bing 是否可以在搜索结果中列出该页面。默认开启。关闭后，页面会以 `noindex, nofollow` 提供服务。
- **网站图标** —— **Edit Favicon** 会打开**网站图标**图片上传。这就是浏览器标签页中的那个小图标。

使用场景：当页面仅供内部使用或仍在搭建中时。关闭 **Allow Search Engines to Index this Status Page**，以免一个尚未完成的页面开始为你的品牌名称获得排名。

## 页眉页面

**状态页 → 你的页面 → 品牌 → 页眉**（`{id}/header-style`）。尽管侧边菜单叫这个名字，你两项最重要的品牌资产其实就放在这里。

第一张卡片标题为 **Logo, Cover and Favicon**，带有一个 **Edit Images** 按钮：

- **Logo** —— 图片上传，占位符 `Upload logo`。
- **Logo Alt Text** —— 占位符 `Logo of My Company`。如果留空，会改用状态页标题。
- **Cover** —— 图片上传，占位符 `Upload cover image`。这是页眉后面的宽幅横幅图。
- **Cover Image Alt Text** —— 对封面图的同类设置。

下方是一张**页眉链接**表格（"Header Links for your status page"）。每条链接都有一个**标题**和一个**链接**（一个 URL，占位符 `https://link.com`），行可以通过拖拽重新排序。未配置任何链接时表格显示 "No status header link for this status page."。

适用场景：将访客引导回你的营销网站、文档或支持门户，而不必让他们去猜网址。

## 页脚页面

**状态页 → 你的页面 → 品牌 → 页脚**（`{id}/footer-style`）与**页眉**结构相同，也是一张卡片加一张表格。

- **版权信息** —— **Edit Copyright** 打开一个单一字段，**Copyright Info**，占位符为 `Acme, Inc.`。
- **页脚链接** —— 同样的**标题**加**链接**组合，可拖拽排序，为空时显示 "No status footer link for this status page."。

法律、隐私和条款链接应放在这里。页眉链接用于导航；页脚链接用于附属细则。

## 概览页面品牌

**状态页 → 你的页面 → 品牌 → 概览页面**（`{id}/overview-page-branding`）是唯一可以配置颜色的页面，它也决定了图表上"down"意味着什么。

- **概览页面** —— **Edit Branding** 打开一个 Markdown 字段，**Overview Page Description.**，会渲染在资源列表上方。用它写一句上下文说明：这个页面涵盖什么，以及去哪里获取支持。
- **历史图表条形颜色规则** —— 一张有序、可拖拽排序的规则表。每条规则都有 **When uptime % is greater than or equal to** 和 **Then, use this bar color**；表格列名为 `When Uptime Percent >=` 和 `Then, Bar Color is`。顺序很重要，请按你希望被评估的顺序排列。
- **停机监视器状态** —— **Edit Statuses** 打开一个多选框，说明为 "These monitor statuses are considered as down"。这决定了例如"降级"状态是否会被计入该页面的正常运行时间之外。
- **默认条形颜色** —— **Edit Default Bar Color** 打开**默认条形颜色**选择器，即没有规则匹配时使用的颜色。
- **总体正常运行时间百分比** —— **Edit Settings** 打开**显示总体正常运行时间百分比**开关和一个**选择正常运行时间精度**下拉菜单，默认值为两位小数（`99.99% (Two Decimal)`）。

**图表覆盖多少天并不在这里设置。**那是**状态页 → 你的页面 → 高级 → 高级设置**（`{id}/settings`）上的**显示正常运行时间历史记录（天数）**，有效范围为 1 到 90。

## 自定义 HTML、CSS 和 JavaScript

**状态页 → 你的页面 → 品牌 → HTML, CSS & JavaScript**（`{id}/custom-code`）有四张可独立编辑的卡片，分别对应状态页上的 `headerHTML`、`footerHTML`、`customCSS` 和 `customJavaScript` 字段：

- **页眉 HTML** —— 占位符 `Insert Custom HTML here.`，注入到页面页眉中。
- **页脚 HTML** —— 同上，用于页脚。
- **自定义 CSS** —— 占位符 `Insert Custom CSS here.`
- **自定义 JavaScript** —— 占位符 `Insert Custom JavaScript here.`

**这里没有主题选择器。**OneUptime 状态页没有主题或品牌色设置：任何地方唯一内置的颜色控件就是**默认条形颜色**以及**概览页面**页面上的历史图表条形颜色规则。字体、背景色、强调色以及布局调整全部要通过这里的**自定义 CSS**实现。如果你一直在寻找一个"品牌色"字段，答案就是：没有这个字段，这个输入框就是它的替代方案。

> 自定义 JavaScript 会在访客的浏览器中运行，而这个页面正是人们在担心某项服务出问题时才会打开的。请保持代码精简，尽量自行托管资源，并在依赖它之前先测试。

## 语言设置

**状态页 → 你的页面 → 品牌 → 语言**（`{id}/languages`）有两张卡片，都与访客在页脚看到的语言切换器有关。

- **默认语言** —— **Edit Default Language** 打开一个下拉菜单，按本地语言名和英文名列出每种受支持的语言（`Deutsch (German)`）。卡片说明这是首次访问的访客看到的语言；访客始终可以从页脚切换。默认值为英语。
- **已启用的语言** —— **Edit Enabled Languages** 打开一个多选框，占位符 `All languages`。留空则提供所有受支持的语言。选择几种后，页脚切换器就只会列出这几种。

OneUptime 内置十六种语言：英语、德语、法语、西班牙语、意大利语、葡萄牙语、荷兰语、丹麦语、挪威语、瑞典语、俄语、日语、韩语、中文（简体）、中文（繁体）和印地语。

## 自定义域名

默认情况下，状态页可以通过其**概览**页面上显示的预览网址访问。要将其部署到你自己的主机名下，请前往**状态页 → 你的页面 → 品牌 → 自定义域名**（`{id}/domains`）。

该卡片标题为**自定义域名**，其描述直接说明了要求：为使其生效，需要将你的安装实例的状态页 CNAME 记录添加为这些域名的 CNAME。未配置任何内容时表格显示 "No custom domains found."。表格有两列，**域名**和**状态**，并可按**域名**、**CNAME Valid** 和 **SSL Provisioned** 筛选。

### 开始之前

有两个前提条件，跳过其中任何一个通常就是无法正常工作的原因：

- **父域名必须已经通过验证。** **域名**下拉菜单只列出项目设置中已验证的域名——该字段自身的帮助文本会指引你先到**更多 → 项目设置 → 自定义域名**添加一个。
- **安装实例必须已配置状态页 CNAME 记录。** 在自托管部署中，这是 Docker Compose 中的 `STATUS_PAGE_CNAME_RECORD` 环境变量，或 Helm `values.yaml` 中的 `statusPage.cnameRecord`。如果没有配置，**Add CNAME** 和 **Order Free SSL** 两个弹窗都会显示 "Custom Domains not enabled for this OneUptime installation" 消息，而不是操作说明。

### 添加域名

点击**创建状态页域名**。弹窗（**Create New Status Page Domain**）分两步：

**Basic**

- **子域名** —— 仅指标签部分，占位符 `status (leave blank for root)`。只需输入 `status`，而不是完整主机名。留空或输入 `@` 则使用根域名/顶级域名。
- **域名** —— 已验证域名的下拉菜单，占位符 `Select domain`。

**More**

- **上传自定义证书** —— 一个开关，默认关闭。保持关闭，OneUptime 会为你申请一份免费证书。打开后，你会看到**证书**和**证书私钥**字段，用于填入你自己的 PEM 材料。

## 验证 CNAME

在域名尚未验证时，该行会显示一个 **Add CNAME** 操作。点击后会打开一个标题为 **Add CNAME** 的弹窗，其中给出了你需要粘贴到 DNS 提供商处的确切内容：

- **记录类型** —— `CNAME`
- **名称** —— 你刚创建的完整域名，例如 `status.yourcompany.com`
- **内容** —— 你的安装实例的状态页 CNAME 记录

弹窗提示，一旦记录生效，自动验证最长可能需要 24 小时。你无需一直等待：弹窗的提交按钮是**验证 CNAME**，可以按需检查该记录。

先创建 DNS 记录，再点击**验证 CNAME**。在记录尚未存在时点击只会失败。

## 申请 SSL 证书

一旦 CNAME 验证通过——并且前提是你没有上传自己的证书——该行会出现 **Order Free SSL** 操作。它的弹窗，**Order Free SSL Certificate for this Status Page**，说明 OneUptime 使用 LetsEncrypt，整个过程安全且免费，下单后大约需要几个小时完成签发。提交按钮是**订购免费 SSL**。

**不同页面给出的时间说法并不一致**，所以不要太在意任何一个具体数字：下单弹窗说是三小时，**状态**列说是一小时，自定义证书说是三十分钟。可以把它们都理解为"今天晚些时候再来看看"，如果到那时仍无进展，请联系支持团队。

一旦签发完成，续期是自动的，你无需做任何持续性的操作。

## 解读域名状态列

**状态**列本质上是整个配置状态机浓缩在一个单元格里。每条消息要么告诉你下一步该做什么，要么告诉你已经完成了。

| 状态列显示的内容                                       | 含义                                                                     |
| ------------------------------------------------------- | -------------------------------------------------------------------------- |
| Action Required: Please add your CNAME record.          | CNAME 尚未验证。添加记录，然后点击**验证 CNAME**。                          |
| Action Required: Please order SSL certificate.          | CNAME 已验证，但尚未申请证书。点击**订购免费 SSL**。                        |
| No action is required, allow 30 minutes to provision.   | 你上传了自定义证书，正在安装中。                                            |
| No action is required, this will be provisioned soon.   | 免费证书已下单，正在签发中。如果一直没有生效，请联系支持团队。                |
| Certificate Provisioned. No action required.             | 已完成。OneUptime 会自动续期证书。                                          |

如果某一行长时间停留在 "Action Required: Please add your CNAME record."，即便你早已创建了 DNS 记录，请检查记录的名称是否为完整域名，以及其内容是否与你的安装实例的 CNAME 记录完全一致。

## Powered by OneUptime

"Powered by OneUptime" 这行字并不是品牌部分的设置项。它位于**状态页 → 你的页面 → 高级 → 高级设置**（`{id}/settings`）的 **Powered By OneUptime Branding** 卡片中，是一个单一开关：**Hide Powered By OneUptime Branding**。**Edit Settings** 会打开它，与该页面上的其他所有卡片一样。

## 延伸阅读

- [状态页概览](/docs/status-pages/index) —— 状态页是什么，以及各部分如何配合运作。
- [状态页资源与分组](/docs/status-pages/resources-and-groups) —— 选择访客实际能在页面上看到什么。
- [订阅者与公告](/docs/status-pages/subscribers) —— 电子邮件、短信、Slack 和 Webhook 订阅者，以及公告功能。
- [公共 API](/docs/status-pages/public-api) —— 以编程方式读取状态页数据。
- [事件状态与严重级别](/docs/incidents/states-and-severities) —— 什么决定事件在页面上出现和消失。
