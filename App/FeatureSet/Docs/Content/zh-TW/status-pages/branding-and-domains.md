# 品牌與自訂網域

狀態頁面是 OneUptime 裡唯一一個你的客戶真的會去看的介面，所以它應該看起來像你的東西，也應該住在你自己的網域上。這兩件事都在狀態頁面側邊選單的 **品牌** 區塊裡設定，另外還有一個設定藏在 **進階設定** 中。

開始之前先知道一件事：品牌設定分散在七個不同的畫面上，而且分法未必是你猜得到的那樣。標誌和封面圖片不在 **基本品牌**，它們在 **頁首**。favicon 在 **基本品牌**。顏色在 **概覽頁面**。其他你可能會歸類為「佈景主題」的東西，一律靠自訂 CSS。

本頁逐一走過每個畫面，然後帶你完成從 CNAME 到 SSL 的完整流程，把頁面掛到 `status.yourcompany.com` 上。

## 各項品牌控制項放在哪裡

開啟一個狀態頁面，側邊選單的 **品牌** 區塊有七個項目。這是地圖，省得你到處找。

| 頁面                         | 你在那裡設定什麼                                                                 |
| ---------------------------- | -------------------------------------------------------------------------------- |
| **基本品牌**                 | 頁面標題、頁面描述、搜尋引擎索引、favicon。                                      |
| **頁首**                     | 標誌、封面圖片、兩者的替代文字，以及頁首連結列。                                 |
| **頁尾**                     | 著作權文字與頁尾連結列。                                                         |
| **概覽頁面**                 | 概覽描述、歷史圖表長條顏色、停機狀態、整體正常運作時間百分比。                   |
| **HTML、CSS 與 JavaScript**  | 標頭 HTML、頁尾 HTML、自訂 CSS、自訂 JavaScript。                                |
| **自訂網域**                 | 你自己的網域、CNAME 驗證與 SSL。                                                 |
| **語言**                     | 預設語言，以及頁尾切換器提供的語言。                                             |

## 基本品牌

**狀態頁面 → 你的頁面 → 品牌 → 基本品牌**（`{id}/branding`）上有三張卡片。

- **標題與描述** —— 卡片註明這也會用於 SEO。**編輯** 會開啟 **頁面標題**（佔位文字 `Please enter page title here.`）與 **頁面描述**。這是搜尋引擎和連結預覽會顯示的內容，所以請寫給客戶看，不是寫給你的團隊看。
- **Search Engine Indexing** —— 單一開關 **Allow Search Engines to Index this Status Page**，產品裡把它描述為控制 Google 和 Bing 是否可以把這個頁面列進搜尋結果。預設是開啟的。關掉它，頁面就會改以 `noindex, nofollow` 提供。
- **Favicon** —— **Edit Favicon** 會開啟 **Favicon** 圖片上傳。這就是瀏覽器分頁上那個小圖示。

適用時機：頁面只給內部用，或還在建置中。把 **Allow Search Engines to Index this Status Page** 關掉，免得一個做到一半的頁面開始用你的品牌名排上搜尋結果。

## 頁首畫面

**狀態頁面 → 你的頁面 → 品牌 → 頁首**（`{id}/header-style`）。別被側邊選單的名稱騙了，你最重要的兩項品牌資產就放在這裡。

第一張卡片標題是 **標誌、封面與網站圖示**，配上一個 **Edit Images** 按鈕：

- **標誌** —— 圖片上傳，佔位文字 `Upload logo`。
- **Logo Alt Text** —— 佔位文字 `Logo of My Company`。留空的話，會改用狀態頁面標題。
- **封面** —— 圖片上傳，佔位文字 `Upload cover image`。這是頁首後方那條寬幅橫幅。
- **Cover Image Alt Text** —— 封面圖片的同一套做法。

底下是一個 **標頭連結** 表格（「Header Links for your status page」）。每個連結有一個 **標題** 和一個 **連結**（網址，佔位文字 `https://link.com`），資料列可以用拖曳重新排序。什麼都沒設定時，表格會顯示「No status header link for this status page.」

適合用來：把訪客導回你的行銷網站、文件或支援入口，不必讓他們自己猜網址。

## 頁尾畫面

**狀態頁面 → 你的頁面 → 品牌 → 頁尾**（`{id}/footer-style`）和 **頁首** 是同一個形狀，一張卡片加一個表格。

- **著作權資訊** —— **Edit Copyright** 會開啟單一欄位 **著作權資訊**，佔位文字為 `Acme, Inc.`。
- **頁尾連結** —— 同樣是 **標題** 加 **連結** 的組合，可拖曳排序，空白訊息為「No status footer link for this status page.」

法律、隱私與服務條款連結該放在這裡。頁首連結是給人導覽用的，頁尾連結是放小字的。

## 概覽頁面品牌

**狀態頁面 → 你的頁面 → 品牌 → 概覽頁面**（`{id}/overview-page-branding`）是唯一能設定顏色的畫面，它同時也決定圖表上的「停機」是什麼意思。

- **概覽頁面** —— **Edit Branding** 會開啟一個 Markdown 欄位 **概覽頁面描述。**，內容會呈現在資源清單上方。用它寫一句話交代脈絡：這個頁面涵蓋什麼，以及要找支援該去哪裡。
- **Rules for Bar Colors of History Chart** —— 一個可拖曳排序的規則表格。每條規則有 **當正常運作時間百分比大於或等於** 與 **然後,使用此長條顏色**；表格欄位標題則是 `When Uptime Percent >=` 和 `Then, Bar Color is`。順序有意義，所以請按照你希望的評估順序排列。
- **停機監測器狀態** —— **Edit Statuses** 會開啟一個多選欄位，說明文字是「These monitor statuses are considered as down」。你就是用這裡決定，比方說效能下降狀態要不要在這個頁面上算進停機。
- **歷史圖表的預設長條顏色** —— **Edit Default Bar Color** 會開啟 **預設長條顏色** 選色器，也就是沒有規則命中時使用的顏色。
- **整體正常運作時間百分比** —— **Edit Settings** 會開啟 **顯示整體正常運作時間百分比** 開關，以及一個 **選擇運作時間精確度** 下拉選單，預設為兩位小數（`99.99% (Two Decimal)`）。

**圖表涵蓋幾天不是在這裡設定的。** 那是 **狀態頁面 → 你的頁面 → 進階 → 進階設定**（`{id}/settings`）上的 **顯示正常運作時間歷史記錄（天數）**，有效範圍是 1 到 90。

## 自訂 HTML、CSS 與 JavaScript

**狀態頁面 → 你的頁面 → 品牌 → HTML、CSS 與 JavaScript**（`{id}/custom-code`）有四張可以各自獨立編輯的卡片，背後是狀態頁面上的 `headerHTML`、`footerHTML`、`customCSS` 與 `customJavaScript` 欄：

- **標頭 HTML** —— 佔位文字 `Insert Custom HTML here.`，會注入頁面標頭。
- **頁尾 HTML** —— 同上，只是換成頁尾。
- **自訂 CSS** —— 佔位文字 `Insert Custom CSS here.`
- **自訂 JavaScript** —— 佔位文字 `Insert Custom JavaScript here.`

**沒有佈景主題選擇器。** OneUptime 狀態頁面沒有佈景主題或品牌色設定：全部內建的顏色控制項就只有 **概覽頁面** 畫面上的 **預設長條顏色** 和歷史圖表長條顏色規則。字型、背景色、強調色與版面微調，一律走這裡的 **自訂 CSS**。如果你一直在找「品牌色」欄位，答案就是——沒有這個欄位，這個框就是你的逃生門。

> 自訂 JavaScript 會在訪客的瀏覽器裡執行，而且那個頁面正是人們擔心有東西壞掉時才會打開的。請保持精簡、盡量自行代管，並在你依賴它之前先測試過。

## 語言設定

**狀態頁面 → 你的頁面 → 品牌 → 語言**（`{id}/languages`）有兩張卡片，兩張都跟訪客在頁尾看到的語言切換器有關。

- **預設語言** —— **Edit Default Language** 會開啟一個下拉選單，以母語名稱加英文名稱列出每一種支援的語言（`Deutsch (German)`）。卡片把它描述為首次來訪的訪客看到的語言；訪客隨時可以從頁尾切換。預設是英文。
- **已啟用的語言** —— **Edit Enabled Languages** 會開啟一個多選欄位，佔位文字為 `All languages`。留空就提供所有支援的語言。選幾種的話，頁尾切換器就只列出那幾種。

OneUptime 內建十六種語言：英文、德文、法文、西班牙文、義大利文、葡萄牙文、荷蘭文、丹麥文、挪威文、瑞典文、俄文、日文、韓文、簡體中文、繁體中文與印地文。

## 自訂網域

預設情況下，狀態頁面透過它 **概覽** 畫面上顯示的預覽網址就能連上。想把它放到你自己的主機名稱上，請前往 **狀態頁面 → 你的頁面 → 品牌 → 自訂網域**（`{id}/domains`）。

卡片標題是 **自訂網域**，它的描述把要求講得很直接：請把你這套安裝的狀態頁面 CNAME 記錄，設定為這些網域的 CNAME，這件事才會成立。什麼都還沒設定時，表格會顯示「No custom domains found.」表格有兩欄，**網域** 與 **狀態**，並提供 **網域**、**CNAME 有效** 與 **SSL 已佈建** 三個篩選條件。

### 開始之前

有兩個前提，而漏掉其中任何一個，通常就是這件事跑不起來的原因：

- **上層網域必須已經通過驗證。** **網域** 下拉選單只列出專案設定裡已驗證的網域——欄位本身的說明文字會指引你先到 **更多 → 專案設定 → 自訂網域** 新增一個。
- **這套安裝必須設定好狀態頁面 CNAME 記錄。** 在自架部署上，那是 Docker Compose 裡的 `STATUS_PAGE_CNAME_RECORD` 環境變數，或 Helm `values.yaml` 裡的 `statusPage.cnameRecord`。少了它，**新增 CNAME** 與 **訂購免費 SSL** 兩個對話框都不會給你操作步驟，而是顯示一則「Custom Domains not enabled for this OneUptime installation」訊息。

### 加入網域

點擊 **Create Status Page Domain**。這個對話框（**Create New Status Page Domain**）有兩個步驟：

**基礎**

- **子網域** —— 只填標籤本身，佔位文字為 `status (leave blank for root)`。只輸入 `status`，不要輸入整個主機名稱。留空或輸入 `@` 就使用根網域／頂點網域。
- **網域** —— 已驗證網域的下拉選單，佔位文字為 `Select domain`。

**更多**

- **上傳自訂憑證** —— 一個開關，預設關閉。保持關閉，OneUptime 會幫你申請一張免費憑證。打開它，你會得到 **憑證** 與 **憑證私密金鑰** 兩個欄位，用來填入你自己的 PEM 材料。

## 驗證 CNAME

網域尚未驗證時，該列會顯示一個 **新增 CNAME** 動作。它會開啟一個標題為 **新增 CNAME** 的對話框，給你要貼進 DNS 服務商的完整內容：

- **記錄類型** —— `CNAME`
- **名稱** —— 你剛剛建立的完整網域，例如 `status.yourcompany.com`
- **內容** —— 你這套安裝的狀態頁面 CNAME 記錄

對話框註明，記錄就位之後，自動驗證最多可能需要 24 小時。你不必乾等：對話框的送出按鈕是 **驗證 CNAME**，它會立刻檢查記錄。

先建立 DNS 記錄，再點 **驗證 CNAME**。記錄還不存在就點下去，只會失敗而已。

## 申請 SSL 憑證

CNAME 驗證通過之後——而且只有在你沒有上傳自己的憑證時——該列會出現 **訂購免費 SSL** 動作。它的對話框 **Order Free SSL Certificate for this Status Page** 會說明 OneUptime 使用 LetsEncrypt、這個過程既安全又免費，而且下單之後需要數小時才會佈建完成。送出按鈕是 **訂購免費 SSL**。

**各個畫面標示的時間彼此不一致**，所以任何單一數字都別看得太重：訂購對話框說三小時，**狀態** 欄說一小時，自訂憑證則說三十分鐘。把它們一律當成「今天稍晚再回來看」，如果到時候還是沒動靜，就聯絡支援。

佈建完成之後，續期是自動的。沒有任何需要你定期處理的事。

## 讀懂網域的狀態欄

**狀態** 欄就是整個設定流程的狀態機濃縮成一格。每一則訊息不是告訴你下一步該做什麼，就是告訴你已經完成了。

| 狀態欄顯示的內容                                      | 代表什麼意思                                                                      |
| ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| Action Required: Please add your CNAME record.        | CNAME 還沒通過驗證。加上記錄，然後按 **驗證 CNAME**。                             |
| Action Required: Please order SSL certificate.        | CNAME 已驗證，但還沒申請憑證。點 **訂購免費 SSL**。                               |
| No action is required, allow 30 minutes to provision. | 你上傳了自訂憑證，正在安裝中。                                                    |
| No action is required, this will be provisioned soon. | 免費憑證已下單，正在處理中。如果一直沒下文，請聯絡支援。                          |
| Certificate Provisioned. No action required.          | 完成了。OneUptime 會自動續期這張憑證。                                            |

如果你早就建好 DNS 記錄，某一列卻長時間停在「Action Required: Please add your CNAME record.」，請檢查記錄的名稱是不是完整網域，以及它的內容是否與你這套安裝的 CNAME 記錄完全一致。

## Powered by OneUptime

「Powered by OneUptime」這行字並不是品牌區塊裡的設定。它住在 **狀態頁面 → 你的頁面 → 進階 → 進階設定**（`{id}/settings`）的 **Powered By OneUptime 品牌標示** 卡片裡，是單一開關：**隱藏「Powered By OneUptime」品牌標示**。和那個頁面上的其他卡片一樣，用 **Edit Settings** 打開它。

## 接下來可以閱讀

- [狀態頁概觀](/docs/status-pages/index) —— 狀態頁面是什麼，以及各個環節怎麼組合起來。
- [狀態頁資源與群組](/docs/status-pages/resources-and-groups) —— 挑選訪客實際會在頁面上看到的內容。
- [訂閱者與公告](/docs/status-pages/subscribers) —— 電子郵件、SMS、Slack 與 Webhook 訂閱者，以及公告。
- [公開 API](/docs/status-pages/public-api) —— 以程式方式讀取狀態頁面資料。
- [事件狀態與嚴重程度](/docs/incidents/states-and-severities) —— 什麼讓事件出現在頁面上，又是什麼讓它消失。
