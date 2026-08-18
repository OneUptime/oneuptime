# 资源与分组

资源是状态页上的一行——一个监视器（或一个监视器组），拥有一个访客能看懂的名称、一个当前状态，以及可选的正常运行时间数字和历史图表。分组是容纳资源的区块，因此一个有四十个监视器的页面读起来会是“API”“Web app”和“Data pipeline”，而不是一份没有尽头的列表。

您在同一个界面上构建这两者。打开一个状态页，在侧边菜单中选择 **Resources**（在未启用监视器组的项目上，该项显示为 **Monitors**）。分组以前有自己的页面；现在不再有了，旧的 `/groups` URL 会直接重定向到这里。

把这部分做对，状态页的其余部分就只是装饰了。访客正是从这些行来判断“是我这边的问题，还是他们那边的问题？”，所以要用客户谈论您产品时的说法来命名它们——用 **Checkout API**，而不是 `prod-checkout-lb-healthcheck-us-east-1`。

## Resources 界面

界面分为两部分。左侧是一个导航器，列出页面上的每一个分组；右侧是您所选分组的内容。

- **分组导航器（左侧）**——一棵分组树，上方有一个搜索框（**Search groups...**），下方有一个实时计数，例如 `3 groups · 12 resources`。当一个页面的分组多到放不下时，会出现一个 **Show N more of M** 按钮来展开其余分组。
- **Top of page**——导航器中的第一行。它容纳不属于任何分组的资源，其工具提示准确说明了这一点的含义：访客会最先看到这些资源，排在所有分组之上。如果页面根本没有任何分组，右侧面板则会标题为 **All resources**。
- **资源面板（右侧）**——以您所选的分组命名。其标题栏带有 **Edit Group**、主要操作按钮 **Add Monitor**，以及一个 **More actions** 溢出菜单。

卡片标题栏本身还有两个按钮：**New Group**，以及一个三点溢出菜单，里面有 **Import groups from CSV** 和 **Refresh**。

卡片的说明文字会随页面的形态而变化。如果已有分组，它会说明这就是访客看到的一切，并提示在左侧选择一个分组来编辑其中的内容。如果还没有任何分组，它会提示您创建一个分组，把较长的页面拆分成区块。

**空状态会告诉您该做什么。** 一个空分组会显示 **No monitors here yet**，以及 **Add Monitor**、**Add Multiple**——只有在整个状态页都没有任何分组时，才会额外出现 **Create a Group**。没有匹配结果的搜索会显示 **No resources match your search**。一个空导航器会说明分组可以把较长的状态页拆分成区块，并且可以嵌套。

## 添加一个监视器

选择您希望资源落入的分组（或选择 **Top of page** 以添加一个不属于任何分组的行），然后点击 **Add Monitor**。弹窗标题为 **Add a monitor to {group}**，分为两个步骤：**Monitor Details** 和 **Advanced**。

在 **Monitor Details** 中：

- **Monitor**——您项目中监视器的下拉列表，占位符为 **Select Monitor**。必填。
- **Display Name**——必填。这是访客读到的文字，它与监视器自身的名称分开存储，因此您可以在这里重命名，而不影响监控本身。
- **Description**——可选的 markdown 文本，显示在该行下方。适合用一句话说明这个服务实际做什么。

如果您的项目启用了监视器组，下拉列表下方会有一个链接，写着 **Add a Monitor Group instead.**——点击它，**Monitor** 下拉列表会替换为 **Monitor Group** 下拉列表（**Select Monitor Group**）。此时链接会变为 **Add a Monitor instead.**，方便您切回去。当您希望页面上的一行代表多个检查项汇总在一起时，请使用监视器组。

### 一次添加多个

**Add Multiple**（在 **More actions** 菜单中也叫 **Add multiple monitors**）会打开 **Add Multiple Monitors**。它有同样的两个步骤，但第一步是一个 **Monitors** 多选框，而不是单一下拉列表，并且您在 **Advanced** 中选择的显示选项会应用到所选的每一个监视器上。这是为新页面快速填充内容的最快方式。

## 资源上的显示选项

**Advanced** 步骤在单个添加表单和批量弹窗中是一样的。这里的一切都是按资源设置的——同一个分组中的两行可以配置得完全不同。

| 字段                                                    | 作用                                                                                            |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Tooltip**（`displayTooltip`）                           | 在状态页上该资源旁边显示的额外文字。可用于说明适用范围，如“美国和欧盟客户”。 |
| **Show Current Resource Status**（`showCurrentStatus`）   | 默认开启。在该行旁显示实时状态——正常、降级、离线。           |
| **Show Uptime %**（`showUptimePercent`）                  | 默认关闭。在该资源旁显示正常运行时间百分比。                                                    |
| **Select Uptime Precision**（`uptimePercentPrecision`）   | 只有在 **Show Uptime %** 打开后才会出现。必填，默认保留一位小数。                                                |
| **Show Status History Chart**（`showStatusHistoryChart`） | 默认开启。为该资源显示逐日的正常运行时间历史条形图。                     |

第一步中的 **Display Name**（`displayName`）和 **Description**（`displayDescription`）也同样只影响显示——它们不会改变监视器本身。

## 正常运行时间百分比与历史图表

**Show Uptime %** 和 **Show Status History Chart** 都依赖于一个位于别处的设置。它们覆盖的时间窗口是 **Status Pages → your page → Advanced → Advanced Settings** 中 **Uptime History Settings** 卡片下的 **Show Uptime History (in days)**。它接受 1 到 90 天，默认 90 天。

因此顺序是：先按资源打开这些开关，再为整个页面设置一次窗口长度。

**精度是一个需要权衡的判断。** **Select Uptime Precision** 下拉列表提供 `99% (No Decimal)`、`99.9% (One Decimal)`、`99.99% (Two Decimal)` 和 `99.999% (Three Decimal)`。小数位越多看起来越精确，也越容易引来关于第三位小数的争论；如果您公布的 SLA 是三个九，那就匹配这个精度，不要更多。

分组有自己独立的这些开关副本——见下文——因此一个分组可以显示汇总的百分比，同时其内部各个监视器保持安静，或者反过来也可以。

历史图表条形的颜色，以及哪些监视器状态计为“宕机”，是在 **Overview Page** 品牌界面设置的，详见 [状态页品牌与域名](/docs/status-pages/branding-and-domains)。

## 分组

点击 **New Group** 打开 **Create New Status Page Group**。表单分为三个步骤：**Group Details**、**Layout** 和 **Advanced**。

**Group Details**：

- **Group Name**（`name`）——必填。这是访客看到的区块标题。
- **Group Description**（`description`）——可选的 markdown 文本，显示在标题下方。
- **Parent Group**（`parentStatusPageGroupId`）——可选。保留默认的 **No parent group (top level)** 以让分组停留在顶层。
- **Expand on Status Page by Default**（`isExpandedByDefault`）——该区块对访客默认是展开还是折叠。

**Advanced** 镜像了分组级别的资源开关：

- **Show Current Group Status**（`showCurrentStatus`）——默认开启。在分组标题旁显示一个状态。
- **Show Uptime %**（`showUptimePercent`）——默认关闭，打开后会出现 **Select Uptime Precision**。

编辑方式相同：点击面板标题栏中的 **Edit Group**，或导航器行菜单中的 **Edit group**，都会打开 **Edit Status Page Group**，其中有一个 **Save Changes** 按钮。

面板标题栏会用小标签显示当前打开的设置——**Grid**、**Collapsed by default**、**Uptime %**——因此您无需打开表单就能看到一个分组是如何配置的。

### 管理一个分组

导航器中每一行的菜单包含 **Edit group**、**Move up**、**Move down**、**Show ID** 和 **Delete group**。面板的 **More actions** 溢出菜单提供更完整的对应项——**Edit this group**、**Add a sub group**、**Move group up**、**Move group down**、**Show group ID**、**Refresh** 和 **Delete this group**。一个保存时未填写名称的分组会渲染为 **Untitled group**，这是提醒您本来打算输入点什么的好信号。

## 嵌套分组

分组是可以嵌套的：在子分组上设置 **Parent Group**，或使用导航器中的 **Add a sub group inside this group** 操作。表单自带的帮助文字描述了它所支持的结构——类似 Corporate Units › Region › Market——并说明每一层都会显示其下所有内容汇总后的状态和正常运行时间。

当一个分组有子分组时，资源面板会显示一行 **Sub groups** 标签，直接链接到每个子分组，因此您可以在层级之间穿梭，而无需返回导航器。

嵌套在大型页面上才真正有价值：比如一个托管服务商在产品下面套着区域，或者一个零售商在业务单元下面套着市场。在一个只有十二个监视器的页面上，单层扁平结构更友好。

## 列表布局与网格布局

**Layout** 步骤为分组设置 **View Mode**（`viewMode`），它会改变该分组在公开页面上的渲染方式。

| 如果您想要……                                                     | 选择                   |
| ------------------------------------------------------------------- | ---------------------- |
| 显示一份纯粹的纵向服务列表，每行一个                 | **List**（默认） |
| 把同一个服务在多个区域或多个租户下以矩阵形式展示 | **Grid**               |

选择 **Grid** 后，会出现另外四个字段：

- **Row Axis Label**——行维度的名称，占位符 `Service`。
- **Row Axis Values**——行本身，通过 **Add Row** 逐个添加（占位符 `e.g. Auth`）。
- **Column Axis Label**——列维度，占位符 `Region`。
- **Column Axis Values**——通过 **Add Column** 添加（占位符 `e.g. US-East`）。

网格分组中的每个监视器随后会被放入一个单元格，因此批量弹窗会连同监视器一起询问行和列，使用您自己设定的轴标签。

**先设置好坐标轴，再添加监视器。** 一个没有行或列的网格分组会显示一条琥珀色提示，说明在坐标轴存在之前没有地方可以放置监视器，并附带一个 **Set up the grid** 按钮——在您完成设置之前，**Add Monitor** 按钮会被撤下。

## 排列访客看到的顺序

顺序是显式设置的，而不是按字母排序，共有三处可以设置：

- **分组内的资源**——拖动某一行。面板上写明了这一点：**Drag a row to change the order visitors see**。
- **分组之间的相对顺序**——导航器行菜单中的 **Move up** / **Move down**，或面板溢出菜单中的 **Move group up** / **Move group down**。
- **未分组的资源**——它们位于 **Top of page**，并且始终渲染在所有分组之上，因此把大家最常查询的那一项放在这里。

**有两种情况下拖动是被关闭的。** 用 **Search in {group}...** 框筛选面板会禁用重新排序——面板会提示 `N of M shown · drag to reorder is off while filtering`，因此请先清空搜索。而网格分组永远不支持拖动排序，因为位置是由行列坐标轴决定的。

把最常被问到的服务放在最上面。在故障期间来到页面的访客，通常在第一屏之后就不再往下看了。

## 从 CSV 导入分组

手动搭建一个层级很深的结构很繁琐。卡片标题栏中的三点溢出菜单里有 **Import groups from CSV**，会打开 **Import Groups from CSV** 弹窗。

流程是：点击 **Download CSV Template** 获取 `status-page-groups-template.csv`，填写好，**Choose CSV File**，然后 **Preview Import** 以在写入任何内容之前先查看将要创建的内容。结果会分为 **Groups Imported** 和 **Some Groups Could Not Be Imported** 两部分，因此一行有问题的数据不会悄无声息地消失。

只有 `name` 是必填的。接受的列如下：

| 列                   | 设置的内容                                         |
| ------------------------ | ----------------------------------------------------- |
| `name`                   | 分组名称。必填。                            |
| `parentName`             | 该分组要嵌套进去的父分组名称。         |
| `description`            | 分组描述。                                   |
| `isExpandedByDefault`    | 该区块对访客默认是否展开。        |
| `showCurrentStatus`      | 是否在分组标题旁显示状态。     |
| `showUptimePercent`      | 是否在分组旁显示正常运行时间百分比。 |
| `uptimePercentPrecision` | 该百分比使用多少位小数。    |
| `viewMode`               | `List` 或 `Grid`。                                    |
| `rowAxisLabel`           | 网格分组的行维度名称。                 |
| `rowAxisValues`          | 网格分组的行值。                        |
| `columnAxisLabel`        | 网格分组的列维度名称。              |
| `columnAxisValues`       | 网格分组的列值。                     |

导入只会创建分组，不会创建资源——之后请用 **Add Monitor** 或 **Add Multiple** 添加监视器。

## 接下来读什么

- [状态页概览](/docs/status-pages/index)——什么是状态页，各部分如何配合。
- [状态页品牌与域名](/docs/status-pages/branding-and-domains)——logo、favicon、图表颜色，以及把页面绑定到您自己的域名。
- [订阅者与公告](/docs/status-pages/subscribers)——当这些资源发生变化时，谁会收到通知。
- [公共 API](/docs/status-pages/public-api)——以编程方式读取状态页数据。
- [事件状态与严重级别](/docs/incidents/states-and-severities)——什么会让一个事件出现在页面上，又会让它从页面上消失。
