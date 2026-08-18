# 資源與群組

資源是狀態頁上的一列——一個監測器（或監測器群組），有訪客能理解的名稱、目前狀態，並可選擇顯示正常運作時間數字與歷史圖表。群組是容納多個資源的區段，讓一個有四十個監測器的頁面讀起來像「API」、「Web app」和「Data pipeline」，而不是一份沒完沒了的清單。

您在同一個畫面上建立這兩者。開啟一個狀態頁，在側邊選單中選擇 **Resources**（在未啟用監測器群組的專案中，此項目顯示為 **Monitors**）。群組過去有自己的獨立頁面；現在不再是這樣了，舊的 `/groups` 網址只會重新導向到這裡。

把這部分做對，狀態頁其餘的部分就只是裝飾。訪客是從這些列來判斷「是我的問題還是他們的問題？」，所以請用客戶談論您產品的方式來命名——用 **Checkout API**，而不是 `prod-checkout-lb-healthcheck-us-east-1`。

## Resources 畫面

畫面分成兩部分。左側是列出頁面上每個群組的導覽器；右側是您所選群組的內容。

- **群組導覽器（左側）**——群組的樹狀結構，上方有搜尋框（**Search groups...**），下方有即時計數，例如 `3 groups · 12 resources`。當頁面的群組數超過可顯示範圍時，會出現 **Show N more of M** 按鈕以顯示其餘群組。
- **Top of page**——導覽器中的第一列。它容納不屬於任何群組的資源，其工具提示準確說明了這代表什麼：訪客會先看到這些內容，排在所有群組之上。如果頁面完全沒有群組，右側面板則會標示為 **All resources**。
- **資源面板（右側）**——以您選擇的群組為標題。其標頭包含 **Edit Group**、主要的 **Add Monitor** 按鈕，以及 **More actions** 溢出選單。

卡片標頭本身有兩個按鈕：**New Group**，以及一個三點溢出選單，內含 **Import groups from CSV** 和 **Refresh**。

卡片的描述文字會隨頁面的結構而變化。當有群組時，描述會說明這就是訪客看到的全部內容，並提示您在左側選擇一個群組來編輯其內容。若尚未有任何群組，則會提示您建立一個群組，以將較長的頁面拆分成多個區段。

**空白狀態會告訴您該怎麼做。** 空的群組會顯示 **No monitors here yet**，並附上 **Add Monitor**、**Add Multiple**，以及——僅在狀態頁完全沒有群組時——**Create a Group**。搜尋不到結果時會顯示 **No resources match your search**。空的導覽器會說明群組可將較長的狀態頁拆分成區段，且群組可以巢狀化。

## 新增監測器

選擇您要放入資源的群組（若要新增未分組的列，選擇 **Top of page**），然後點按 **Add Monitor**。彈出視窗標題為 **Add a monitor to {group}**，分為兩個步驟：**Monitor Details** 和 **Advanced**。

在 **Monitor Details** 中：

- **Monitor**——您專案中監測器的下拉選單，預留文字為 **Select Monitor**。必填。
- **Display Name**——必填。這是訪客閱讀的文字，與監測器自身的名稱分開儲存，因此您可以在此重新命名而不影響監測本身。
- **Description**——選填的 markdown 文字，顯示在該列下方。適合用一句話說明該服務實際的功能。

如果您的專案已啟用監測器群組，下拉選單下方會有一個連結顯示 **Add a Monitor Group instead.**——點按它，**Monitor** 下拉選單會替換為 **Monitor Group** 下拉選單（**Select Monitor Group**）。該連結接著會變為 **Add a Monitor instead.**，讓您可以切換回去。當您希望頁面上的一列代表多項合併在一起的檢查時，就使用監測器群組。

### 一次新增多個

**Add Multiple**（在 **More actions** 選單中也稱為 **Add multiple monitors**）會開啟 **Add Multiple Monitors**。它有相同的兩個步驟，但第一步是 **Monitors** 多選欄位，而不是單一下拉選單，並且您在 **Advanced** 中選擇的顯示選項會套用到您選取的每個監測器。這是為新頁面快速建立內容最快的方式。

## 資源的顯示選項

**Advanced** 步驟在單一新增表單和批次新增彈出視窗中是一樣的。這裡的所有內容都是逐一資源設定的——同一個群組中的兩列可以有不同的設定。

| 欄位                                                       | 用途                                                                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **Tooltip** (`displayTooltip`)                              | 顯示在狀態頁該資源旁的額外文字。用於說明範圍：「美國與歐盟客戶」。                  |
| **Show Current Resource Status** (`showCurrentStatus`)      | 預設開啟。在該列旁顯示即時狀態——正常運作中、效能下降、離線。                       |
| **Show Uptime %** (`showUptimePercent`)                     | 預設關閉。在資源旁顯示正常運作時間百分比。                                          |
| **Select Uptime Precision** (`uptimePercentPrecision`)      | 僅在 **Show Uptime %** 開啟時出現。必填，預設為一位小數。                            |
| **Show Status History Chart** (`showStatusHistoryChart`)    | 預設開啟。顯示該資源逐日的正常運作時間歷史長條圖。                                  |

第一步中的 **Display Name** (`displayName`) 和 **Description** (`displayDescription`) 也只影響顯示——它們絕不會改變監測器本身。

## 正常運作時間百分比與歷史圖表

**Show Uptime %** 和 **Show Status History Chart** 都取決於另一個位置的設定。它們涵蓋的時間範圍是 **Status Pages → your page → Advanced → Advanced Settings** 下 **Uptime History Settings** 卡片中的 **Show Uptime History (in days)**。它接受 1 到 90 天，預設為 90。

所以順序是：先逐一資源開啟這些切換開關，再為整個頁面設定一次時間範圍。

**精確度是個判斷取捨。** **Select Uptime Precision** 下拉選單提供 `99% (No Decimal)`、`99.9% (One Decimal)`、`99.99% (Two Decimal)` 和 `99.999% (Three Decimal)`。更多小數位看起來更精確，但也會招來關於第三位小數的爭論；如果您公布的 SLA 是三個九，就配合它，不要超過。

群組有自己的一份相同切換開關——見下文——因此群組可以顯示彙總百分比，同時讓群組內個別監測器保持安靜，或反過來也行。

歷史圖表長條的顏色，以及哪些監測器狀態算作「down」，是在 **Overview Page** 品牌畫面上設定的，詳見 [狀態頁品牌與網域](/docs/status-pages/branding-and-domains)。

## 群組

點按 **New Group** 開啟 **Create New Status Page Group**。此表單有三個步驟：**Group Details**、**Layout** 和 **Advanced**。

**Group Details**：

- **Group Name** (`name`)——必填。這是訪客看到的區段標題。
- **Group Description** (`description`)——選填的 markdown 文字，顯示在標題下方。
- **Parent Group** (`parentStatusPageGroupId`)——選填。保留為 **No parent group (top level)** 可讓群組維持在最上層。
- **Expand on Status Page by Default** (`isExpandedByDefault`)——該區段對訪客而言預設是展開還是收合。

**Advanced** 會鏡射資源層級的切換開關，但在群組層級：

- **Show Current Group Status** (`showCurrentStatus`)——預設開啟。在群組標題旁顯示狀態。
- **Show Uptime %** (`showUptimePercent`)——預設關閉，開啟後會出現 **Select Uptime Precision**。

編輯的運作方式相同：面板標頭的 **Edit Group**，或導覽器該列選單中的 **Edit group**，都會開啟 **Edit Status Page Group**，並附有 **Save Changes** 按鈕。

面板標頭會以標籤形式顯示目前開啟的設定——**Grid**、**Collapsed by default**、**Uptime %**——讓您不必開啟表單就能看出群組的設定方式。

### 管理群組

導覽器每一列的選單包含 **Edit group**、**Move up**、**Move down**、**Show ID** 和 **Delete group**。面板的 **More actions** 溢出選單則有較完整的對應項目——**Edit this group**、**Add a sub group**、**Move group up**、**Move group down**、**Show group ID**、**Refresh** 和 **Delete this group**。未輸入名稱就儲存的群組會顯示為 **Untitled group**，這是提醒您原本應該輸入些什麼的好徵兆。

## 巢狀群組

群組可以巢狀化：在子群組上設定 **Parent Group**，或使用導覽器的 **Add a sub group inside this group** 動作。表單本身的說明文字描述了它設計用來支援的結構——類似 Corporate Units › Region › Market——並指出每個層級都會顯示其下所有內容的彙總狀態與正常運作時間。

當群組有子群組時，資源面板會顯示一排 **Sub groups** 標籤，直接連結到每個子群組，讓您不必回到導覽器就能瀏覽整個階層。

巢狀結構在大型頁面上才能發揮價值：例如一家在產品之下劃分區域的主機代管商，或是在事業單位之下劃分市場的零售商。若頁面只有十二個監測器，單一的扁平層級會更友善。

## List 版面配置 vs Grid 版面配置

**Layout** 步驟設定該群組的 **View Mode** (`viewMode`)，它會改變群組公開呈現的方式。

| 如果您想要……                                             | 選擇                    |
| ---------------------------------------------------------- | ----------------------- |
| 顯示一份純粹的垂直服務清單，每列一項                        | **List**（預設）        |
| 以矩陣方式顯示同一服務在多個地區或租戶之間的狀態            | **Grid**                |

選擇 **Grid** 後，會出現另外四個欄位：

- **Row Axis Label**——列維度的名稱，預留文字為 `Service`。
- **Row Axis Values**——列本身，以 **Add Row** 逐一新增（預留文字為 `e.g. Auth`）。
- **Column Axis Label**——欄維度，預留文字為 `Region`。
- **Column Axis Values**——以 **Add Column** 新增（預留文字為 `e.g. US-East`）。

Grid 群組中的每個監測器接著會被放入一個儲存格，因此批次新增彈出視窗會連同監測器一起要求您指定列與欄，並使用您自訂的軸標籤。

**在新增監測器之前先設定好軸。** 沒有列或欄的 Grid 群組會顯示黃色提示，說明在軸建立之前沒有地方可以放置監測器，並附有 **Set up the grid** 按鈕——在您完成設定之前，**Add Monitor** 按鈕會被收回。

## 排序訪客看到的內容

順序是明確設定的，而非依字母排序，且可在三個地方設定：

- **群組內的資源**——拖曳一列。面板上會提示：**Drag a row to change the order visitors see**。
- **群組彼此之間**——導覽器該列選單中的 **Move up** / **Move down**，或面板溢出選單中的 **Move group up** / **Move group down**。
- **未分組的資源**——它們位於 **Top of page**，且永遠顯示在所有群組之上，所以請把大家最先查看的那項放在這裡。

**有兩種情況下無法拖曳排序。** 使用 **Search in {group}...** 篩選面板會停用重新排序功能——面板會提示 `N of M shown · drag to reorder is off while filtering`，因此請先清除搜尋。而 Grid 群組永遠不支援拖曳排序，因為其位置是由列軸與欄軸決定的。

把最常被詢問的服務放在最上方。在停機期間造訪頁面的訪客，通常在看完第一個畫面後就不會再往下看了。

## 從 CSV 匯入群組

手動建立深層階層很繁瑣。卡片標頭的三點溢出選單中有 **Import groups from CSV**，會開啟 **Import Groups from CSV** 彈出視窗。

流程是：**Download CSV Template** 取得 `status-page-groups-template.csv`，填寫內容，**Choose CSV File**，然後 **Preview Import** 以在寫入之前檢查將建立的內容。結果會分為 **Groups Imported** 和 **Some Groups Could Not Be Imported** 兩部分，因此有問題的資料列不會悄悄消失。

只有 `name` 是必填欄位。可接受的欄位如下：

| 欄位                     | 設定內容                                             |
| ------------------------ | ------------------------------------------------------ |
| `name`                   | 群組名稱。必填。                                        |
| `parentName`             | 此群組所巢狀嵌入的群組名稱。                             |
| `description`            | 群組描述。                                              |
| `isExpandedByDefault`    | 該區段對訪客而言是否預設展開。                           |
| `showCurrentStatus`      | 群組標題旁是否顯示狀態。                                 |
| `showUptimePercent`      | 群組旁是否顯示正常運作時間百分比。                       |
| `uptimePercentPrecision` | 該百分比使用幾位小數。                                   |
| `viewMode`               | `List` 或 `Grid`。                                       |
| `rowAxisLabel`           | Grid 群組的列維度名稱。                                  |
| `rowAxisValues`          | Grid 群組的列數值。                                      |
| `columnAxisLabel`        | Grid 群組的欄維度名稱。                                  |
| `columnAxisValues`       | Grid 群組的欄數值。                                      |

匯入只會建立群組，不會建立資源——之後請使用 **Add Monitor** 或 **Add Multiple** 新增監測器。

## 接下來可以閱讀

- [狀態頁概觀](/docs/status-pages/index)——什麼是狀態頁，以及各部分如何組合在一起。
- [狀態頁品牌與網域](/docs/status-pages/branding-and-domains)——標誌、favicon、圖表顏色，以及將頁面放到您自己的網域上。
- [訂閱者與公告](/docs/status-pages/subscribers)——這些資源變更時會通知誰。
- [公開 API](/docs/status-pages/public-api)——以程式化方式讀取狀態頁資料。
- [事件狀態與嚴重程度](/docs/incidents/states-and-severities)——什麼會讓事件在頁面上出現，以及消失。
