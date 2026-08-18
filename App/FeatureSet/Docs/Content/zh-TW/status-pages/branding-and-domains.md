# 品牌與自訂網域

狀態頁是您的客戶真正會查看的唯一 OneUptime 介面，因此它應該看起來屬於您，並架設在您自己的網域上。這兩件事都可以在狀態頁側邊選單的 **Branding** 區段中設定，另外還有一項設定藏在 **Advanced Settings** 裡。

在您開始之前該知道的一件事：品牌設定分散在七個不同的畫面中，而且分法不一定符合您的直覺猜測。標誌和封面圖片不在 **Essential Branding**——它們在 **Header**。favicon 在 **Essential Branding**。顏色在 **Overview Page**。其他您可能認為屬於「主題設定」的內容，全都是 Custom CSS。

本頁會逐一介紹每個畫面，然後帶您走過將頁面架設在 `status.yourcompany.com` 的完整 CNAME 到 SSL 流程。

## 每個品牌控制項的位置

開啟一個狀態頁，側邊選單的 **Branding** 區段有七個項目。以下是對照表，讓您不必再到處找。

| 頁面                        | 您在那裡設定的內容                                                                          |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| **Essential Branding**      | 頁面標題、頁面描述、搜尋引擎索引、favicon。                                                    |
| **Header**                  | 標誌、封面圖片、它們的替代文字，以及頁首連結列。                                                |
| **Footer**                  | 著作權文字與頁尾連結列。                                                                        |
| **Overview Page**           | 概覽描述、歷史圖表長條顏色、停機狀態、整體正常運作時間百分比。                                  |
| **HTML, CSS & JavaScript**  | 頁首 HTML、頁尾 HTML、自訂 CSS、自訂 JavaScript。                                               |
| **Custom Domains**          | 您自己的網域、CNAME 驗證與 SSL。                                                                |
| **Languages**                | 預設語言，以及頁尾語言切換器所提供的語言。                                                       |

## Essential branding

**Status Pages → your page → Branding → Essential Branding**（`{id}/branding`）包含三張卡片。

- **Title and Description**——卡片說明這也會用於 SEO。**Edit** 會開啟 **Page Title**（預留文字 `Please enter page title here.`）和 **Page Description**。這是搜尋引擎和連結預覽所顯示的內容，因此請以客戶的角度撰寫，而不是為您的團隊撰寫。
- **Search Engine Indexing**——單一切換開關 **Allow Search Engines to Index this Status Page**，產品中將其描述為控制 Google 和 Bing 是否可以在搜尋結果中列出此頁面。預設為開啟。關閉後，頁面會改以 `noindex, nofollow` 提供。
- **Favicon**——**Edit Favicon** 會開啟 **Favicon** 圖片上傳。這是瀏覽器分頁中顯示的小圖示。

使用時機：頁面僅供內部使用或仍在設定中。將 **Allow Search Engines to Index this Status Page** 關閉，以免一個尚未完成的頁面開始針對您的品牌名稱被搜尋引擎排名。

## Header 畫面

**Status Pages → your page → Branding → Header**（`{id}/header-style`）。儘管側邊選單的名稱如此，這裡其實是您兩項最重要的品牌資產所在之處。

第一張卡片標題為 **Logo, Cover and Favicon**，附有 **Edit Images** 按鈕：

- **Logo**——圖片上傳，預留文字 `Upload logo`。
- **Logo Alt Text**——預留文字 `Logo of My Company`。若留空，則會改用狀態頁標題。
- **Cover**——圖片上傳，預留文字 `Upload cover image`。這是頁首後方的寬幅橫幅。
- **Cover Image Alt Text**——封面圖片的相同概念。

其下方是 **Header Links** 表格（「Header Links for your status page」）。每個連結都有一個 **Title** 和一個 **Link**（網址，預留文字 `https://link.com`），各列可透過拖曳重新排序。若尚未設定任何連結，表格會顯示「No status header link for this status page.」。

適用情境：讓訪客回到您的行銷網站、文件或支援入口，而不必自行猜測網址。

## Footer 畫面

**Status Pages → your page → Branding → Footer**（`{id}/footer-style`）的結構與 **Header** 相同，同樣是一張卡片加一個表格。

- **Copyright Info**——**Edit Copyright** 會開啟單一欄位 **Copyright Info**，預留文字為 `Acme, Inc.`。
- **Footer Links**——同樣的 **Title** 加 **Link** 配對，可拖曳排序，空白訊息為「No status footer link for this status page.」。

法律、隱私權和條款連結應放在這裡。頁首連結用於導覽；頁尾連結則用於細則。

## Overview page branding

**Status Pages → your page → Branding → Overview Page**（`{id}/overview-page-branding`）是唯一可以設定顏色的畫面，它也決定了圖表上「down」的定義。

- **Overview Page**——**Edit Branding** 會開啟一個 markdown 欄位 **Overview Page Description.**，會顯示在資源清單上方。用它來提供簡短的背景說明：此頁面涵蓋什麼，以及去哪裡尋求支援。
- **Rules for Bar Colors of History Chart**——一份有順序、可拖曳排序的規則表格。每條規則都有 **When uptime % is greater than or equal to** 和 **Then, use this bar color**；表格欄位顯示為 `When Uptime Percent >=` 和 `Then, Bar Color is`。順序很重要，請依照您希望的評估方式排列。
- **Downtime Monitor Statuses**——**Edit Statuses** 會開啟一個多選欄位，說明為「These monitor statuses are considered as down」。您可以藉此決定，例如效能下降狀態是否會計入此頁面的正常運作時間扣分。
- **Default Bar Color of the History Chart**——**Edit Default Bar Color** 會開啟 **Default Bar Color** 顏色選擇器，也就是沒有規則符合時所使用的顏色。
- **Overall Uptime Percent**——**Edit Settings** 會開啟 **Show Overall Uptime Percent** 切換開關和 **Select Uptime Precision** 下拉選單，預設為兩位小數（`99.99% (Two Decimal)`）。

**圖表涵蓋的天數不是在這裡設定的。** 那是 **Status Pages → your page → Advanced → Advanced Settings**（`{id}/settings`）中的 **Show Uptime History (in days)**，範圍是 1 到 90。

## 自訂 HTML、CSS 和 JavaScript

**Status Pages → your page → Branding → HTML, CSS & JavaScript**（`{id}/custom-code`）有四張可獨立編輯的卡片，對應狀態頁上的 `headerHTML`、`footerHTML`、`customCSS` 和 `customJavaScript` 欄位：

- **Header HTML**——預留文字 `Insert Custom HTML here.`，會注入頁面的頁首。
- **Footer HTML**——相同，用於頁尾。
- **Custom CSS**——預留文字 `Insert Custom CSS here.`
- **Custom JavaScript**——預留文字 `Insert Custom JavaScript here.`

**這裡沒有主題選擇器。** OneUptime 狀態頁沒有主題或品牌顏色設定：整個系統中內建的顏色控制項只有 **Overview Page** 畫面上的 **Default Bar Color** 和歷史圖表長條顏色規則。字型、背景顏色、強調色和版面配置調整全都要透過這裡的 **Custom CSS** 來完成。如果您一直在尋找「品牌顏色」欄位，答案就是——沒有這種欄位，這個文字框就是您的逃生出口。

> 自訂 JavaScript 會在訪客的瀏覽器中執行，而且是在人們正因為擔心系統故障而載入頁面的時候。請盡量精簡，盡可能自行架設而非依賴外部資源，並在依賴它之前先測試過。

## Language settings

**Status Pages → your page → Branding → Languages**（`{id}/languages`）有兩張卡片，兩者都與訪客在頁尾看到的語言切換器有關。

- **Default Language**——**Edit Default Language** 會開啟一個下拉選單，以各語言的原生名稱和英文名稱列出每種支援的語言（`Deutsch (German)`）。卡片說明這是首次造訪的訪客所看到的語言；訪客隨時可以從頁尾切換。預設為英文。
- **Enabled Languages**——**Edit Enabled Languages** 會開啟一個多選欄位，預留文字為 `All languages`。留空的話，會提供所有支援的語言。選擇幾種語言後，頁尾切換器就只會列出那幾種。

OneUptime 內建十六種語言：英文、德文、法文、西班牙文、義大利文、葡萄牙文、荷蘭文、丹麥文、挪威文、瑞典文、俄文、日文、韓文、中文（簡體）、中文（繁體）和印地文。

## Custom domains

預設情況下，狀態頁可透過其 **Overview** 畫面上顯示的預覽網址存取。若要將它架設在您自己的主機名稱上，請前往 **Status Pages → your page → Branding → Custom Domains**（`{id}/domains`）。

該卡片標題為 **Custom Domains**，其描述直接說明了需求：將您安裝環境的狀態頁 CNAME 記錄，加入為這些網域的 CNAME，才能運作。若尚未設定任何內容，表格會顯示「No custom domains found.」。表格有兩個欄位，**Domain** 和 **Status**，並可依 **Domain**、**CNAME Valid** 和 **SSL Provisioned** 篩選。

### 開始之前

有兩項先決條件，跳過其中任何一項通常就是這功能無法運作的原因：

- **父網域必須已經通過驗證。** **Domain** 下拉選單只會列出專案設定中已驗證的網域——欄位本身的說明文字會指引您前往 **More → Project Settings → Custom Domains** 先新增一個。
- **安裝環境必須已設定狀態頁 CNAME 記錄。** 在自架部署中，這是 Docker Compose 中的 `STATUS_PAGE_CNAME_RECORD` 環境變數，或 Helm `values.yaml` 中的 `statusPage.cnameRecord`。若未設定，**Add CNAME** 和 **Order Free SSL** 彈出視窗都會顯示「Custom Domains not enabled for this OneUptime installation」訊息，而不是操作說明。

### 新增網域

點按 **Create Status Page Domain**。彈出視窗（**Create New Status Page Domain**）有兩個步驟：

**Basic**

- **Subdomain**——僅為標籤，預留文字 `status (leave blank for root)`。只需輸入 `status`，而不是整個主機名稱。留空或輸入 `@` 即可使用根網域/apex 網域。
- **Domain**——已驗證網域的下拉選單，預留文字 `Select domain`。

**More**

- **Upload Custom Certificate**——切換開關，預設關閉。保持關閉，OneUptime 會為您訂購免費憑證。開啟後，您會看到 **Certificate** 和 **Certificate Private Key** 欄位，可填入您自己的 PEM 內容。

## 驗證 CNAME

在網域尚未驗證期間，該列會顯示 **Add CNAME** 動作。它會開啟標題為 **Add CNAME** 的彈出視窗，準確告訴您該貼到您的 DNS 供應商那裡的內容：

- **Record Type**——`CNAME`
- **Name**——您剛建立的完整網域，例如 `status.yourcompany.com`
- **Content**——您安裝環境的狀態頁 CNAME 記錄

彈出視窗會提示，一旦記錄設定完成，自動驗證最長可能需要 24 小時。您不必等待：彈出視窗的提交按鈕是 **Verify CNAME**，可以隨時檢查該記錄。

先建立 DNS 記錄，再點按 **Verify CNAME**。在記錄存在之前點按只會失敗。

## 訂購 SSL 憑證

一旦 CNAME 通過驗證——且僅限您未上傳自己的憑證時——該列會出現 **Order Free SSL** 動作。其彈出視窗 **Order Free SSL Certificate for this Status Page** 會說明 OneUptime 使用 LetsEncrypt，流程是安全且免費的，訂購後的佈建作業需要幾個小時。提交按鈕是 **Order Free SSL**。

**不同畫面上標示的時間並不一致**，因此不要對任何單一數字太過認真：訂購彈出視窗上寫的是三小時，**Status** 欄位寫的是一小時，而自訂憑證則寫三十分鐘。都把它們當成「今天稍後再回來看」就好，如果到那時仍沒有動靜，請聯絡支援團隊。

一旦佈建完成，續約是自動進行的。您不需要做任何週期性的操作。

## 判讀網域的 Status 欄位

**Status** 欄位就是整個設定狀態機的濃縮呈現。每則訊息都會告訴您接下來該做什麼，或是您已經完成了。

| Status 欄位顯示的內容                                    | 代表的意義                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------------ |
| Action Required: Please add your CNAME record.            | CNAME 尚未驗證。新增記錄，然後點按 **Verify CNAME**。                    |
| Action Required: Please order SSL certificate.             | CNAME 已驗證，但尚未訂購憑證。點按 **Order Free SSL**。                  |
| No action is required, allow 30 minutes to provision.     | 您上傳了自訂憑證，正在安裝中。                                           |
| No action is required, this will be provisioned soon.     | 免費憑證已訂購並在處理中。若一直沒有結果，請聯絡支援團隊。               |
| Certificate Provisioned. No action required.               | 完成。OneUptime 會自動續約憑證。                                         |

如果某一列在您建立 DNS 項目很久之後，仍然顯示「Action Required: Please add your CNAME record.」，請確認記錄的名稱是完整網域，且其內容與您安裝環境的 CNAME 記錄完全相符。

## Powered by OneUptime

「Powered by OneUptime」這行字並非 Branding 區段的設定。它位於 **Status Pages → your page → Advanced → Advanced Settings**（`{id}/settings`）中的 **Powered By OneUptime Branding** 卡片，是單一切換開關：**Hide Powered By OneUptime Branding**。**Edit Settings** 可以開啟它，就跟該頁面上其他每張卡片一樣。

## 接下來可以閱讀

- [狀態頁概觀](/docs/status-pages/index)——什麼是狀態頁，以及各部分如何組合在一起。
- [狀態頁資源與群組](/docs/status-pages/resources-and-groups)——選擇訪客實際會在頁面上看到的內容。
- [訂閱者與公告](/docs/status-pages/subscribers)——電子郵件、簡訊、Slack 和 webhook 訂閱者，以及公告。
- [公開 API](/docs/status-pages/public-api)——以程式化方式讀取狀態頁資料。
- [事件狀態與嚴重程度](/docs/incidents/states-and-severities)——什麼會讓事件在頁面上出現，以及消失。
