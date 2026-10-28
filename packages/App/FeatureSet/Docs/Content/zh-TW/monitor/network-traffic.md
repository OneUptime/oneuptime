# 網路流量（NetFlow、IPFIX 和 sFlow）

路由器、防火牆和交換器可以將經過它們的流量描述為**流記錄**：誰和誰通訊、使用哪種協定和連接埠、經過哪些介面、傳輸了多少位元組。將這些匯出傳送到 OneUptime 探測器，**流量**頁面就會顯示你的流量去向：在任意時間範圍內最繁忙的位址、對話、應用程式和介面。

流量頁面出現在三個地方：

- **網路** -> **流量**：整個網路，在一個頁面上顯示所有裝置的流，以及所有尚未成為裝置卻在傳送流的位址。
- 站點的**流量**頁面：該站點的裝置。
- 裝置的**流量**分頁：這一台裝置及其介面。在裝置的探測器上執行的封包擷取列在流的下方，供你需要封包本身時使用。

Cisco Meraki 環境也可以在不匯出任何資料的情況下讀取：連接 Meraki 儀表板後，流量頁面會依 Meraki 的回報顯示其設備的上行鏈路、應用程式和用戶端。請參閱[不用 NetFlow 的 Cisco Meraki](#不用-netflow-的-cisco-meraki)。

## 流量頁面顯示什麼

- 時間範圍內的四個數字：**流量**（位元組）、**平均**和**峰值**速率，以及**流**（裝置傳送的流記錄數）。
- **流量隨時間的變化**，單位為位元每秒。在圖表上拖曳可放大某一時段；按兩下圖表或使用**重設縮放**即可返回。
- **主要來源位址**和**主要目的位址**：傳送和接收最多的十個位址。
- **主要應用程式**：依協定和服務連接埠統計的流量，以該連接埠上通常執行的服務命名（HTTPS 即 TCP 連接埠 443）。
- 裝置頁面上的**主要介面**：每個介面進入和流出的流量，以及來自裝置 SNMP 巡檢的名稱和速率。站點和網路頁面上則是**主要裝置**。
- **主要對話**：最繁忙的十對位址，可顯示為從傳送方到接收方的圖示，也可顯示為清單。

按一下任一列——位址、應用程式、介面、裝置或圖示中的色帶——整個頁面都會縮小到該流量。頁面上方的標籤說明目前縮小到什麼；按一下標籤上的 x 即可恢復。**尋找名稱或 IP 位址**可將頁面縮小到傳往或來自某個位址的流量：輸入位址或名稱的一部分，有多個相符時從中選擇。時間範圍和篩選條件儲存在頁面位址中，因此連結開啟的是完全相同的檢視。

OneUptime 知道名稱的位址會以名稱顯示，位址顯示在旁邊。請參閱[用名稱代替位址](#用名稱代替位址)。

## 流如何到達這裡

每個探測器都會執行一個流收集器。它監聽三個 UDP 連接埠，每個連接埠都能讀取所有格式：

| 連接埠   | 通常用於                    |
| -------- | --------------------------- |
| UDP 2055 | NetFlow v5, NetFlow v9      |
| UDP 4739 | IPFIX                       |
| UDP 6343 | sFlow v5                    |

探測器會解碼記錄，將取樣的計數依取樣率乘回，每隔幾秒彙總同一對話的記錄，然後傳送到 OneUptime。每筆記錄依其裝置傳送時所用的位址對應到裝置（對於 sFlow，是資料包中的代理位址）：

1. 探測器輪詢的裝置中，主機名稱就是該位址（或解析為該位址）的裝置，或在其**設定**頁面的**其他位址**中列出該位址的裝置；
2. 在你自己的（自訂）探測器上，專案中主機名稱為該位址或其他位址中包含該位址的任何裝置；
3. 否則，在你自己的探測器上，這些流會保留在網路的流量頁面的**流的傳送方**下，直到你指明它們屬於哪台裝置。全域探測器會捨棄它們。

流會保留 30 天，一個頁面最多顯示 31 天。

## 設定方法

1. **使用位於裝置網路中的探測器。** 流是裝置傳送的 UDP 資料包，因此需要一個裝置能到達的[自訂探測器](/docs/probe/custom-probe)。位於公用網際網路上的全域探測器收不到它們。
2. **讓資料包到達探測器。** 允許從裝置到探測器的 UDP 2055、4739 和 6343。依照自訂探測器頁面所示以主機網路（`--network host`）啟動的 Docker 探測器可以直接接收；不使用主機網路時，請用 `-p 2055:2055/udp -p 4739:4739/udp -p 6343:6343/udp` 發布這些連接埠。
3. **在裝置上開啟流匯出**，並傳送到探測器的 IP 位址。常見裝置的指令見下文。在第一筆流到達之前，裝置自己的**流量**分頁也會顯示包含探測器連接埠的相同步驟。
4. **檢查裝置的位址。** 記錄依裝置傳送時所用的位址對應。如果裝置從不是其主機名稱的迴路位址或管理介面傳送，請將該位址加入裝置的**其他位址**。

收集器預設為開啟。其設定是探測器上的環境變數：

| 變數                                | 作用                                                                | 預設值  |
| ----------------------------------- | ------------------------------------------------------------------- | ------- |
| PROBE_NETFLOW_RECEIVER_ENABLED      | 設為 `false` 可關閉流收集器                                         | true    |
| PROBE_NETFLOW_RECEIVER_PORT         | NetFlow 連接埠；設為 `0` 則不再監聽該連接埠                         | 2055    |
| PROBE_IPFIX_RECEIVER_PORT           | IPFIX 連接埠；設為 `0` 則不再監聽該連接埠                           | 4739    |
| PROBE_SFLOW_RECEIVER_PORT           | sFlow 連接埠；設為 `0` 則不再監聽該連接埠                           | 6343    |
| PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE | 所有裝置和連接埠合計每分鐘接受的資料包數                            | 6000    |

每分鐘這 6000 個資料包由所有向探測器匯出的裝置共用。裝置有數百台時，請調高 `PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE`，或把裝置分散到多個探測器上：超出限制的資料包會被丟棄，探測器的記錄會顯示丟棄了多少（請參閱[疑難排解](#疑難排解)）。Meraki 環境完全不需要匯出：請參閱[不用 NetFlow 的 Cisco Meraki](#不用-netflow-的-cisco-meraki)。

### Cisco IOS XE（Flexible NetFlow）

將 IPFIX 匯出到 UDP 4739。在每個要查看流量的介面上加上最後一行：在流量進入每個介面時測量，每段對話只會計算一次。

```text
flow exporter ONEUPTIME
 destination <probe-address>
 source Loopback0
 transport udp 4739
 export-protocol ipfix
 template data timeout 60
 option interface-table
 option sampler-table
!
flow monitor ONEUPTIME
 exporter ONEUPTIME
 cache timeout active 60
 record netflow ipv4 original-input
!
interface GigabitEthernet0/0/0
 ip flow monitor ONEUPTIME input
```

### Cisco IOS（NetFlow v9）

將 NetFlow v9 匯出到 UDP 2055。

```text
ip flow-export version 9
ip flow-export destination <probe-address> 2055
ip flow-export source Loopback0
ip flow-export template timeout-rate 1
ip flow-cache timeout active 1
!
interface GigabitEthernet0/0
 ip flow ingress
```

### Arista EOS（sFlow）

將 sFlow 匯出到 UDP 6343。sFlow 每 N 個封包取樣 1 個（此處為 16384），流量頁面會將樣本乘回，因此數字是估計值。

```text
sflow sample 16384
sflow destination <probe-address> 6343
sflow source-interface Loopback0
sflow run
```

### Cisco Meraki MX 和 Z

MX 設備和 Z 系列遠端工作閘道從 Meraki 儀表板匯出 NetFlow v9：

1. 開啟 **Network-wide** > **General**，找到 **Reporting**。
2. 將 **NetFlow traffic reporting** 設為 **Enabled: send NetFlow traffic statistics**。
3. 將探測器的 IP 位址填入 **NetFlow collector IP**，將 `2055` 填入 **NetFlow collector port**，然後儲存。

MX 或 Z 只能看到經過它的流量。交換器在 VLAN 內部轉送的流量不會到達它，因此不在匯出資料中。

要讀取每個站點而不逐台設定 MX，請改為連接 Meraki 儀表板：請參閱[不用 NetFlow 的 Cisco Meraki](#不用-netflow-的-cisco-meraki)。它的流量沒有對話，所以兩者可以很好地互補。

### Juniper（內嵌 J-Flow）

從 MX 路由器將 IPFIX 匯出到 UDP 4739；請使用承載你要取樣之介面的 FPC。

```text
set services flow-monitoring version-ipfix template ONEUPTIME ipv4-template
set services flow-monitoring version-ipfix template ONEUPTIME flow-active-timeout 60
set services flow-monitoring version-ipfix template ONEUPTIME template-refresh-rate seconds 60
set chassis fpc 0 sampling-instance ONEUPTIME
set forwarding-options sampling instance ONEUPTIME input rate 1
set forwarding-options sampling instance ONEUPTIME family inet output flow-server <probe-address> port 4739
set forwarding-options sampling instance ONEUPTIME family inet output flow-server <probe-address> version-ipfix template ONEUPTIME
set forwarding-options sampling instance ONEUPTIME family inet output inline-jflow source-address <device-address>
set interfaces ge-0/0/0 unit 0 family inet sampling input
```

### Fortinet FortiGate

將 NetFlow v9 匯出到 UDP 2055。在 FortiOS 7.2 及更新版本中，收集器是 `config system netflow` 內 `config collectors` 下的一個項目。

```text
config system netflow
    set collector-ip <probe-address>
    set collector-port 2055
    set template-tx-timeout 60
end
config system interface
    edit "port1"
        set netflow-sampler both
    next
end
```

### Palo Alto Networks

1. 在 **Device** > **Server Profiles** > **NetFlow** 下，新增一個包含探測器 IP 位址和連接埠 `2055` 的設定檔，並將 **Active Timeout** 設為 1 分鐘。
2. 在 **Network** > **介面** 下，開啟每個要查看流量的介面，在 **Advanced** 分頁中將該設定檔選為其 **NetFlow Profile**。
3. 提交（commit）。

### MikroTik RouterOS 7

```text
/ip traffic-flow set enabled=yes interfaces=all active-flow-timeout=1m
/ip traffic-flow target add dst-address=<probe-address> port=2055 version=9
```

### pfSense 和 Linux 主機

在 pfSense 上，安裝 **softflowd** 套件，然後在 **Services** > **softflowd** 下選擇介面，填入探測器的 IP 位址和連接埠 `2055`，並選擇 NetFlow 版本 9。在 Linux 主機上，在要查看流量的介面上執行 softflowd：

```bash
softflowd -i eth0 -n <probe-address>:2055 -v 9 -t maxlife=60
```

### 其他裝置

將 NetFlow v5、NetFlow v9 或 IPFIX 傳送到探測器 IP 位址的 UDP 2055（或 4739），或將 sFlow v5 傳送到 UDP 6343。將裝置的作用中流逾時設為 60 秒；對於 NetFlow v9 和 IPFIX，每 60 秒傳送一次範本。[網路廠商指南](/docs/monitor/network-vendor-guides)介紹了 Sophos 和 Extreme Networks。

## 不用 NetFlow 的 Cisco Meraki

Meraki 環境還有第二種方式，既不用在裝置上設定，中間也不需要探測器：OneUptime 透過 Meraki 儀表板 API 讀取組織的流量。它適合數百乃至數千個站點，在這種規模下，替每台 MX 設定 NetFlow 才是難處。

在 **網路** -> **流量** 中選擇 **連線 Meraki**：

1. **API 金鑰。** 在 Meraki 儀表板的 **Organization** > **API & Webhooks** > **API keys and access** 中建立一個。唯讀管理員的金鑰就夠了。OneUptime 會加密儲存它，不再顯示，並且只把它傳送到該金鑰所在區域的 Meraki 儀表板 API。如果你不是在 dashboard.meraki.com 登入 Meraki，請在 **更多欄位** 中選擇 **儀表板區域**：加拿大、中國、印度或美國 FedRAMP 儀表板。
2. **組織。** 開啟這一步時會測試金鑰：列出它能讀取的組織；對你選擇的組織，對話方塊會在儲存之前統計一次讀取將涵蓋的網路以及 MX 和 Z 設備的數量。

第一次讀取會在一分鐘內開始，並取回最近一天的資料。此後，流量頁面的頁首會有一個 **Flows** | **Meraki** 切換：有流記錄的頁面像以前一樣開啟流記錄，只有 Meraki 流量的頁面開啟 Meraki。

| 頁面上 | Meraki 回報的內容 | 讀取頻率 |
| --- | --- | --- |
| 四個數字、圖表、**主要網路** 和 **上行鏈路** | 每台 MX 和 Z 設備的上行鏈路用量（wan1、wan2、cellular），整個組織一次呼叫 | 預設每 5 分鐘，最長每小時一次，以五分鐘為一個時段 |
| **主要應用程式** 和 **主要目的位址** | 每個網路的流量分析 | 每兩小時：Meraki 以兩小時或更長時間彙總 |
| **主要用戶端** | 每個網路的用戶端及其用量 | 每兩小時，與應用程式一起讀取 |

點按某個網路會把頁面範圍縮小到該網路，並列出它的上行鏈路。如果 OneUptime 中有裝置的序號或 MAC 位址與某台 Meraki 設備相同，這台設備的流量就歸屬於該裝置，並且也會顯示在該裝置及其站點的流量頁面上。不是 OneUptime 裝置的 Meraki 設備，其流量顯示在網路頁面上。

Meraki 給每個組織每秒 10 個 API 請求，由所有讀取該組織的應用程式共用。OneUptime 最多使用其中 3 個，在 Meraki 要求時放慢速度，並在 900 個請求或 6 分鐘後停止一次讀取；下一次讀取會在一分鐘後繼續。對於一個有 1200 個網路的組織，其上行鏈路每個時段一次呼叫讀完，各網路的應用程式和用戶端則分幾次讀取完成。

連線列在網路流量頁面底部的 **Meraki** 下，每個都顯示其狀態以及上次讀取涵蓋的內容。每個連線都有一個用於下一步的按鈕：**立即讀取** 會立即讀取它，**開啟** 會重新開啟已關閉的連線，**更新 API 金鑰** 會取代被 Meraki 拒絕的金鑰，並在儲存前測試新金鑰。其選單中有 **編輯**（名稱、讀取上行鏈路的頻率、新金鑰）、**關閉** 和 **刪除**。讀取失敗時，會在那裡和流量上方說明原因：金鑰被拒絕、金鑰無法讀取該組織、Meraki 要求 OneUptime 放慢速度，或網路的流量分析已關閉。在流量上方，**檢視** 會帶你前往該連線。只有專案擁有者和管理員可以連線 Meraki，以及變更或讀取連線。

Meraki 儀表板 API 只回報總量，從不回報誰和誰通訊，所以 Meraki 一側沒有對話。要查看對話，請同時從 MX 設備傳送 NetFlow（[Cisco Meraki MX 和 Z](#cisco-meraki-mx-和-z)）：這樣頁面兩者都有，用切換即可來回查看。

## 尚未成為裝置的位址

流可能在傳送它們的裝置新增到 OneUptime 之前就已到達。在你自己的探測器上，這些流會被保留，網路的流量頁面會在**流的傳送方**下列出它們的位址，並標示為**尚未成為裝置**：

- **新增為裝置**會開啟新增裝置畫面，並預先填好位址和探測器。已經到達的流保留在網路頁面上；新的流歸入該裝置。
- **這是我的裝置之一**會將該位址加入某台裝置的**其他位址**：當你已新增的裝置從另一個位址（例如迴路位址）傳送時使用。從下一分鐘起，它的流歸入該裝置。

位於同一個 NAT 位址後面的多台裝置共用該位址，因此它們的流會歸入擁有該位址的那一台裝置。

## 用名稱代替位址

流量頁面在任何列出位址的地方——主要清單、**主要對話** 的兩種檢視、標籤、**尋找**——只要 OneUptime 知道該位址的名稱，就會先顯示名稱，再在旁邊顯示位址：例如 `10.18.167.35` 上方顯示 `mumbai-fs01`。沒有任何名稱的位址會照原樣顯示。被截短的名稱在滑鼠指標下會完整顯示。

名稱來自以下來源中第一個為該位址命名的來源：

| 順序 | 名稱來自哪裡 | 為位址命名的是什麼 |
| ---- | ------------ | ------------------ |
| 1 | **位址名稱** | 有人在 **網路** -> **設定** -> **位址名稱** 中為此位址取的名稱 |
| 2 | 網路裝置 | 以此位址輪詢的裝置，或在 **其他位址** 中列出此位址的裝置 |
| 3 | 主機 | 其代理程式回報此位址的主機 |
| 4 | 雲端資源 | 你的雲端帳戶為其列出此位址的雲端資源 |
| 5 | Kubernetes | 擁有此位址的節點，其次是 Pod（位於其節點本身網路上的 Pod 使用節點的位址） |
| 6 | DNS | 接收這些流的探測器查到的該位址的反向 DNS 名稱 |

記錄只為其存在期間的流量命名：在時間範圍之後才首次出現的主機，或在時間範圍之前就消失的 Pod，都不會為該時間範圍的流量命名。有人為子網路取的名稱（例如 `10.18.167.0/24` 是「孟買辦公室」）會顯示在子網路內每個位址的旁邊，而不會取代位址本身的名稱；命名的子網路重疊時，顯示範圍最窄的那一個。

### 單一位址

按一下某個位址或尋找它，頁面就會縮小到該位址，並在數字上方顯示一張卡片，說明它是誰：名稱、名稱的來源、附有複製按鈕的位址，以及它所在的命名子網路。卡片提供下一步：

- **開啟主機**、**開啟裝置** 或 **開啟雲端資源**：名稱屬於該記錄時。請在那裡變更名稱。
- **為此位址命名**：沒有任何名稱或只有 DNS 名稱時。位址已經填好；把它擴大為子網路（例如 `10.18.167.0/24`），即可改為替整個子網路命名。
- **在設定中編輯**：名稱是位址名稱時。會開啟 **位址名稱**，在那裡變更名稱。

**為此位址命名** 需要能夠新增網路裝置的權限，**在設定中編輯** 需要能夠變更網路裝置的權限。能夠讀取網路裝置的人都能看到這些名稱。

### 位址名稱

**網路** -> **設定** -> **位址名稱** 列出人們為其他來源都未命名的位址和子網路取的名稱：合作夥伴的 VPN 閘道、某個 SaaS 端點、訪客 Wi-Fi。**建立位址名稱** 需要填寫名稱，以及一個 IP 位址（`10.0.0.5`、`2001:db8::5`）或一個子網路（`10.18.167.0/24`）。子網路儲存為其第一個位址和前置長度，因此 `10.18.167.35/24` 會儲存為 `10.18.167.0/24`。每個位址或子網路只有一個名稱。

### 來自探測器的 DNS 名稱

DNS 名稱由接收這些流的探測器使用其主機的解析器來查詢：在你的網路內部，私有位址也有名稱。只有當名稱本身的 A 或 AAAA 記錄指回該位址時，探測器才會保留這個名稱，因此過時或偽造的反向記錄不會成為名稱；探測器主機 hosts 檔案中的名稱會照原樣使用。探測器把名稱隨流一起傳送，名稱也隨流一起儲存：每個時間範圍顯示的都是其位址當時的名稱。

查詢從不拖慢流的傳送。流量最大的位址最先查詢，每分鐘最多 300 個，同時最多 8 個；名稱保留一小時，沒有名稱的位址保留 30 分鐘，失敗的查詢在 5 分鐘後重試。迴路、鏈路本機、多點傳送和廣播位址從不查詢。代管版 OneUptime 由所有帳戶共用的全域探測器只查詢公用位址；你自己的探測器，以及你自己安裝的 OneUptime 的探測器，也會查詢私有位址。

| 變數                                | 作用                                                                | 預設值  |
| ----------------------------------- | ------------------------------------------------------------------- | ------- |
| PROBE_FLOW_NAME_LOOKUP_ENABLED      | 設為 `false` 可停止在 DNS 中查詢流的位址                             | true    |
| PROBE_FLOW_NAME_LOOKUPS_PER_MINUTE  | 每分鐘查詢的位址數；`0` 會停止查詢                                   | 300     |
| PROBE_FLOW_NAME_DNS_SERVERS         | 代替主機解析器查詢的 DNS 伺服器，例如 `10.0.0.53, 10.0.0.54:5353`    | 無      |

## 如何解讀這些數字

- **取樣。** 取樣的裝置（sFlow 一律取樣，NetFlow 或 IPFIX 可以取樣）每 N 個封包回報 1 個。探測器會將計數乘以 N，因此頁面顯示的是估計值，並在四個數字下方註明。流量大時很準確，只有少量封包時較為粗略。
- **重複計算。** 經過兩台匯出裝置的流量會被兩台裝置都回報。裝置頁面只計算一次；站點或網路頁面會為每台回報它的裝置各計算一次。
- **應用程式。** 應用程式是指協定和服務連接埠，以該連接埠上通常執行的服務命名。這不是深度封包檢測：連接埠 9443 上的 HTTPS 顯示為 TCP 連接埠 9443。用戶端的暫時連接埠會被忽略，因此連到一台伺服器的一千個瀏覽器連線只算一個應用程式。
- **峰值**是圖表中最繁忙時段的速率，因此時間範圍越短、時段越短，峰值越尖銳。**平均**是整個時間範圍內的位元組數。
- **時間。** 流計入它開始的時段。長時間下載會被回報為多筆流，執行的每一分鐘一筆，因此裝置的作用中逾時應設為 60 秒。

## 不包含的內容

- **以流為基礎的警示。** 目前還沒有以流為基礎的監視器。要對繁忙的連結發出警示，請使用讀取 SNMP 的[網路裝置監視器](/docs/monitor/network-device-monitor)中的介面使用率警示。
- **連接埠以外的應用程式名稱。** 沒有深度封包檢測，也不讀取 Cisco NBAR 的應用程式名稱。
- **來自 Meraki 儀表板 API 的對話。** 它只回報總量，不回報誰和誰通訊：要查看對話，請同時從 MX 設備傳送 NetFlow。
- 流量的**異常偵測**。
- **來自流記錄的介面名稱。** 介面名稱和速率來自裝置的 SNMP 巡檢；未巡檢的裝置顯示介面編號。

## 疑難排解

如果流量頁面仍然顯示設定步驟：

- **探測器收到任何資料了嗎？** 網路的流量頁面會在**流的傳送方**下列出過去一小時內傳送過流的所有位址。如果裝置在那裡顯示為**尚未成為裝置**，表示它從不是其主機名稱的位址傳送：請將該位址加入它的**其他位址**。
- **防火牆和 Docker。** 允許從裝置到探測器的 UDP 2055、4739 和 6343；如果探測器在 Docker 中執行，請發布這些連接埠。
- **探測器記錄。** 探測器每分鐘記錄一次無法讀取的內容：不支援格式的資料包（NetFlow v1、v6、v7 或 v8，或版本 5 之前的 sFlow）、格式錯誤的資料包、等待範本的資料，以及超出 `PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE` 而被捨棄的資料包。
- **範本。** NetFlow v9 和 IPFIX 以範本的形式傳送其記錄的結構。探測器會將先於範本到達的資料最多保留 10 分鐘；請讓裝置每 60 秒傳送一次範本，以便頁面在一分鐘內顯示資料。
- **全域探測器。** 由全域探測器輪詢的裝置無法從私人網路向其傳送流。請在裝置所在網路中執行自訂探測器，並在裝置設定中選擇它。

如果某個位址沒有顯示名稱：

- **為它取個名稱。** 按一下該位址，然後在數字上方的卡片中按一下 **為此位址命名**。
- **它的 DNS 名稱。** 名稱本身的 A 或 AAAA 記錄必須指回該位址；只有反向記錄是不夠的。新增到 DNS 中的名稱會用於之後到達的流。
- **探測器的解析器。** 如果探測器的主機看不到你的內部 DNS，請把 `PROBE_FLOW_NAME_DNS_SERVERS` 設為一個保存你的反向區域的 DNS 伺服器。

如果某個 Meraki 連線顯示無法讀取：

- **金鑰被拒絕。** 從 Meraki 儀表板重新複製金鑰，並檢查 **儀表板區域**：一個金鑰只能讀取建立它的那個儀表板。在連線上用 **更新 API 金鑰** 貼上新金鑰。
- **金鑰無法讀取該組織。** 在 **Organization** > **API & Webhooks** 中為該組織開啟 API 存取，或使用其某位管理員的金鑰。
- **部分網路沒有應用程式。** 這些網路的流量分析已關閉：在 **Network-wide** > **General** > **Traffic analysis** 中開啟。
- **Meraki 要求 OneUptime 放慢速度。** 其他應用程式正在使用該組織的 API 配額。OneUptime 會放慢讀取並繼續。
- **這個 OneUptime 無法連到 API。** 允許從 OneUptime 的伺服器到 `api.meraki.com` 或你所在區域的 API 主機的 HTTPS（連接埠 443）。
