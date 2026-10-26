# 網路事件（syslog 和 SNMP trap）

路由器、防火牆、交換器和存取點會在各自的 syslog 中說明自己發生了什麼：鏈路中斷、通道中斷、防火牆發生容錯移轉、有人登入。每家廠商的說法各不相同。將它們的 syslog 傳送到 OneUptime 探測器，**事件**頁面就會用同樣的措辭顯示發生了什麼，不論裝置出自哪家廠商，並在再次發生時向你發出警示。

事件頁面出現在兩個地方：

- **網路** -> **事件**：整個網路，在一個頁面上顯示所有裝置的事件，以及所有尚未成為裝置卻在傳送 syslog 的位址。
- 裝置的**事件**分頁：這一台裝置回報的內容。

## 事件頁面顯示什麼

- 時間範圍內的事件，最新的在前。每一列說明發生了什麼、在哪台裝置上、涉及什麼（介面、通道、閘道），以及裝置自己的原話。
- **問題**、**恢復**和**資訊**，各自附有時間範圍內的數量。按一下其中一個即可只看這一類。
- **所有事件**選擇器，以及網路頁面上的 **All devices** 選擇器，可進一步縮小清單。時間範圍和篩選條件儲存在頁面位址中，因此連結開啟的是完全相同的檢視。
- 按一下某個事件即可開啟它：何時發生、涉及什麼、裝置傳送的原始訊息，以及 OneUptime 從中讀出的每個屬性。
- **建立警示**提供大多數網路都需要的警示，**為此事件建立警示**則為你開啟的事件建立一個警示。請參閱[警示](#警示)。

事件就是日誌。事件頁面上的所有內容也都可以在**日誌**中搜尋、繪製圖表和設定警示：事件是屬性 `event.domain` 為 `network` 的日誌，發生了什麼記錄在 `event.name` 中。

## OneUptime 讀取什麼

任何產品的 RFC 3164 和 RFC 5424 格式 syslog 以及 Common Event Format（CEF）都可以讀取。此外，OneUptime 還了解下列產品寫入的內容：

| 廠商 | 產品 | 讀取的事件 | 屬性 |
| --- | --- | --- | --- |
| Cisco | IOS, IOS XE, NX-OS, ASA | 介面、裝置、高可用性、VPN、路由、硬體、交換、登入 | `cisco.*` |
| Sophos | Sophos Firewall (SFOS, XG, XGS) | 介面、裝置、高可用性、VPN、WAN、登入 | `sophos.*` |
| Fortinet | FortiGate (FortiOS) | 介面、裝置、高可用性、VPN、WAN、硬體、登入 | `fortigate.*` |
| Extreme Networks | ExtremeXOS, Switch Engine | 介面、裝置、高可用性、路由、硬體、交換、登入 | `extreme.*` |
| Extreme Networks | Fabric Engine, VOSS | 介面、路由 | `extreme.*` |
| HPE Aruba Networking | AOS-CX | 介面、硬體 | `aruba.*` |
| HPE Aruba Networking | AOS-Switch (ArubaOS-Switch, ProCurve) | 介面 | `aruba.*` |
| MikroTik | RouterOS | 介面、裝置、登入 | `mikrotik.*` |
| Cambium Networks | Enterprise Wi-Fi (cnPilot, XV, XE, XH) | 裝置、VPN、Wi-Fi | `cambium.*` |
| Ubiquiti | UniFi Network | 裝置、WAN、交換、登入、Wi-Fi | `cef.*` |
| 任意 | 以 Linux 為基礎的裝置（kernel、hostapd、OpenSSH、Dropbear） | 介面、登入、Wi-Fi | - |

採用上述某種格式的訊息，其自身欄位會以最後一欄中的前置詞儲存為屬性，因此 Sophos 防火牆上的 `con_name="HQ-Branch1"` 就是屬性 `sophos.con_name`。來自其他任何產品的 CEF 訊息，其標頭和擴充欄位儲存在 `cef.*` 下。OneUptime 無法歸類的訊息仍會在讀取 syslog 標頭後儲存為日誌；你可以自己為它的事件命名，請參閱[你自己的事件](#你自己的事件)。

標準 SNMP Trap 會被讀取為同樣的事件：`linkDown` 和 `linkUp` 成為**介面中斷**和**介面連通**，`coldStart` 和 `warmStart` 成為**裝置已重新啟動**。

## 事件

OneUptime 辨識的每則訊息都會以下列名稱之一儲存在 `event.name` 中，不論裝置出自哪家廠商：

| 事件 | `event.name` | 類型 | 涉及 |
| --- | --- | --- | --- |
| 介面中斷 | `interface.down` | 問題 | `network.interface.name` |
| 介面連通 | `interface.up` | 恢復 | `network.interface.name` |
| 連接埠被交換器關閉 | `interface.error_disabled` | 問題 | `network.interface.name` |
| 裝置已重新啟動 | `device.reboot` | 問題 | - |
| 設定已變更 | `device.config_change` | 資訊 | `user.name` |
| 裝置離線 | `device.offline` | 問題 | - |
| 裝置上線 | `device.online` | 恢復 | - |
| 容錯移轉 | `ha.failover` | 問題 | `ha.role` |
| 高可用性狀態已變化 | `ha.state_change` | 資訊 | `ha.role` |
| 高可用性對端中斷 | `ha.peer_down` | 問題 | `ha.peer` |
| 高可用性對端恢復 | `ha.peer_up` | 恢復 | `ha.peer` |
| VPN 通道中斷 | `vpn.tunnel_down` | 問題 | `vpn.tunnel.name` |
| VPN 通道連通 | `vpn.tunnel_up` | 恢復 | `vpn.tunnel.name` |
| 路由鄰居中斷 | `routing.neighbor_down` | 問題 | `network.peer.address` |
| 路由鄰居恢復 | `routing.neighbor_up` | 恢復 | `network.peer.address` |
| 閘道中斷 | `gateway.down` | 問題 | `network.gateway.name` |
| 閘道恢復 | `gateway.up` | 恢復 | `network.gateway.name` |
| WAN 容錯移轉 | `wan.failover` | 問題 | `network.gateway.name` |
| SD-WAN 鏈路低於其 SLA | `sdwan.sla_not_met` | 問題 | `network.gateway.name` |
| SD-WAN 鏈路恢復到 SLA 之內 | `sdwan.sla_met` | 恢復 | `network.gateway.name` |
| 風扇故障 | `hardware.fan_failed` | 問題 | `hw.name` |
| 風扇恢復運作 | `hardware.fan_ok` | 恢復 | `hw.name` |
| 電源供應器故障 | `hardware.power_supply_failed` | 問題 | `hw.name` |
| 電源供應器恢復運作 | `hardware.power_supply_ok` | 恢復 | `hw.name` |
| 溫度過高 | `hardware.temperature_high` | 問題 | - |
| 偵測到迴圈 | `loop.detected` | 問題 | `network.interface.name` |
| 擴展樹拓撲變化 | `stp.topology_change` | 資訊 | - |
| PoE 故障 | `poe.fault` | 問題 | `network.interface.name` |
| 登入失敗 | `auth.login_failed` | 問題 | `user.name` |
| 已登入 | `auth.login_success` | 資訊 | `user.name` |
| Wi-Fi 用戶端已連線 | `wireless.client_connected` | 資訊 | `client.mac` |
| Wi-Fi 用戶端已中斷連線 | `wireless.client_disconnected` | 資訊 | `client.mac` |

最後一欄是說明事件涉及什麼的屬性。並非每個產品都會回報每種事件：交換器沒有 VPN 通道，而產品的 syslog 能說明的內容也有限。

每個事件還帶有：

| 屬性 | 內容 |
| --- | --- |
| `event.domain` | `network`，每個網路事件都有 |
| `event.kind` | `problem`、`recovery` 或 `info` |
| `event.category` | `interface`、`device`、`ha`、`vpn`、`routing`、`wan`、`hardware`、`switching`、`security` 或 `wireless`（上表中的事件） |
| `event.device` | 哪台裝置：它在 OneUptime 中的名稱，否則是它自報的名稱，否則是它的位址 |
| `event.message` | 裝置說了什麼，即它自己的原話 |
| `syslog.vendor`、`syslog.parser` | 訊息是依誰的格式讀取的 |

## 事件如何到達這裡

每個探測器都在連接埠 5140 上透過 UDP 和 TCP 接聽 syslog。透過 TCP 時，一則訊息是一行，或者依 RFC 6587 所述在前面帶有長度。探測器每隔幾秒將收到的內容轉送給 OneUptime，OneUptime 再依訊息的來源位址將每則訊息對應到裝置：

1. 探測器輪詢的裝置中，主機名稱就是該位址（或解析為該位址）的裝置，或在其**設定**頁面的**其他位址**中列出該位址的裝置；
2. 在你自己的（自訂）探測器上，專案中具有該位址的任何裝置，或者主機名稱與訊息所帶主機名稱相同的裝置（僅當恰好有一台裝置使用該名稱時）；
3. 否則，在你自己的探測器上，訊息會保留在網路的事件頁面的**正在傳送 syslog，尚未成為裝置**下，直到你指明它屬於哪台裝置。全域探測器會捨棄它。

來自未知位址、沒有 syslog 優先順序且不是事件的行會被視為雜訊並捨棄。

控制器代表它所管理的裝置發言：UniFi 主控台會回報其存取點和交換器的情況。當一台裝置傳來的訊息透過 MAC 位址、序號、位址或控制器為其取的名稱指明另一台裝置時，事件歸屬於那台裝置，日誌則在 `syslog.relay.name` 中保留轉送它的控制器的名稱。

日誌依探測器收到它的時間儲存。被積壓過的訊息（其自身時間戳記採用帶時區的 RFC 5424 格式，且早於 5 分鐘前）保留裝置的時間，最多可回溯 7 天。其他任何與探測器時鐘相差超過 5 分鐘的時間戳記都不予採信：日誌依收到的時間儲存，裝置的時間保留在 `syslog.deviceTime` 中。

你透過 HTTPS 傳送到 [syslog 端點](/docs/telemetry/syslog)的 syslog 由相同的剖析器讀取。在那裡，當訊息採用網路廠商自己的格式，或透過 MAC 位址、序號、位址或主機名稱指明你的某台網路裝置時，它就成為網路事件；伺服器的 `sshd` 行仍是一般日誌。

## 設定方法

1. **使用位於裝置網路中的探測器。** syslog 由你的裝置傳送，因此需要一個裝置能到達的[自訂探測器](/docs/probe/custom-probe)。位於公用網際網路上的全域探測器收不到它。
2. **讓 syslog 到達探測器。** 允許從裝置到探測器的連接埠 5140（UDP 或 TCP）。依照自訂探測器頁面所示以主機網路（`--network host`）啟動的 Docker 探測器可以直接接收；不使用主機網路時，請用 `-p 5140:5140/udp -p 5140:5140/tcp` 發布該連接埠。對於只能傳送到連接埠 514 的裝置，請用 `-p 514:5140/udp` 發布，或在使用主機網路的探測器上設定 `PROBE_SYSLOG_RECEIVER_PORT=514`。
3. **將探測器設為裝置的 syslog 伺服器。** 常見裝置的指令見下文。在第一則訊息到達之前，**事件**頁面會顯示相同的步驟，之後會自動變成清單。
4. **檢查裝置的位址。** 訊息依裝置傳送時所用的位址對應。如果裝置從不是其主機名稱的迴路位址或管理介面傳送，請將該位址加入裝置的**其他位址**。

syslog 接收器預設為開啟。其設定是探測器上的環境變數：

| 變數 | 作用 | 預設值 |
| --- | --- | --- |
| `PROBE_SYSLOG_RECEIVER_ENABLED` | 設為 `false` 可關閉 syslog 接收器 | `true` |
| `PROBE_SYSLOG_RECEIVER_PORT` | UDP 和 TCP 使用的連接埠 | `5140` |
| `PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE` | 所有裝置合計每分鐘轉送的訊息數 | `600` |

超過限制後，探測器仍會轉送它讀取為網路事件的訊息，最多再轉送同樣多的數量，這樣大量例行的行就不會擠掉那則說明鏈路中斷的訊息。早於此功能的探測器只有在以 `PROBE_SYSLOG_RECEIVER_ENABLED=true` 啟動時才會接聽，而且只透過 UDP：請更新它。

### Cisco IOS、IOS XE 和 NX-OS

```text
logging host <probe-address> transport udp port 5140
logging trap informational
service timestamps log datetime msec
```

第二行傳送資訊層級及更嚴重的訊息：鏈路變化、重新啟動和登入都在其中。在 NX-OS 上，這一行是 `logging server <probe-address> 6 port 5140 use-vrf management`。

### Sophos Firewall

1. 在防火牆的 Web 管理介面中開啟 **System services** > **Log settings**，並在 **Syslog servers** 下選擇 **Add**。
2. 輸入探測器的 IP 位址和連接埠 `5140`，並將嚴重層級設為 **Information**。防火牆提供的兩種日誌格式都可以讀取。
3. 回到 **Log settings**，為要傳送的日誌勾選新伺服器：至少勾選系統事件，以及用於 SLA 變化的 **SD-WAN**。防火牆的流量日誌數量很多，除非你需要，否則不要勾選。

### Fortinet FortiGate

```text
config log syslogd setting
    set status enable
    set server "<probe-address>"
    set port 5140
    set mode udp
    set format default
end
```

FortiGate 傳送其日誌設定所選擇的內容。事件日誌包含通道、鏈路和容錯移轉；流量日誌數量很多，除非你需要，否則不要啟用。

### Extreme Networks

```text
configure syslog add <probe-address>:5140 vr VR-Default local7
enable log target syslog <probe-address>:5140 vr VR-Default local7
enable syslog
```

將 `VR-Default` 改為可到達探測器的虛擬路由器。

### HPE Aruba

```text
logging <probe-address> udp 5140 severity info
```

在 AOS-CX 上，如果透過管理連接埠到達探測器，請在該行中加上 `vrf mgmt`。在 AOS-Switch 上，這一行是 `logging <probe-address> udp 5140`。

### MikroTik RouterOS

```text
/system logging action set remote remote=<probe-address> remote-port=5140
/system logging add topics=info action=remote
/system logging add topics=warning action=remote
/system logging add topics=error action=remote
/system logging add topics=critical action=remote
```

第一行將路由器內建的遠端動作指向探測器；其餘各行選擇它傳送什麼。遠端日誌格式保持不變。

### Ubiquiti UniFi

1. 在 UniFi Network 中開啟 **Integration** > **System Logging / SIEM**，並選擇 **SIEM Server** 作為目的地。
2. 輸入探測器的 IP 位址和連接埠 `5140`，並選擇要匯出的日誌類別。

主控台會回報它所管理的存取點和交換器的情況。如果裝置帶著 MAC 位址登記在 OneUptime 中，事件會出現在該裝置自己的頁面上，否則出現在主控台的頁面上。

### Cambium Networks

1. 在 cnMaestro 或存取點的 Web 介面中開啟系統設定，找到 syslog 伺服器。
2. 將探測器的 IP 位址填為 syslog 伺服器，在表單要求連接埠的地方填寫連接埠 `5140`，並將 syslog 嚴重層級設為 **Info**。

如果沒有可設定的連接埠，存取點會傳送到連接埠 514：請依[設定方法](#設定方法)的第 2 步將探測器的連接埠發布到該連接埠。

### 其他裝置

在裝置上新增遠端 syslog 伺服器：探測器的 IP 位址、連接埠 5140、透過 UDP 或 TCP，傳送資訊層級及更嚴重的訊息。OneUptime 不了解其格式的裝置，其訊息仍會被儲存，你可以自己為它的事件命名。

## 警示

事件頁面上的**建立警示**列出大多數網路都需要的警示。每個警示都會開啟已填好的**建立監測器**，你可以在儲存前修改任何內容：

| 警示 | 何時通知你 | 每個警示對應 | 何時關閉 |
| --- | --- | --- | --- |
| VPN 通道中斷 | `vpn.tunnel_down` | 裝置和通道 | 該通道的 `vpn.tunnel_up` |
| 防火牆或交換器發生容錯移轉 | `ha.failover` | 裝置 | 5 分鐘內沒有再次發生 |
| WAN 鏈路中斷 | `gateway.down` | 裝置和閘道 | 該閘道的 `gateway.up` |
| 路由鄰居中斷 | `routing.neighbor_down` | 裝置和鄰居 | 該鄰居的 `routing.neighbor_up` |
| 裝置重新啟動 | `device.reboot` | 裝置 | 5 分鐘內沒有再次發生 |
| 硬體故障 | 風扇、電源供應器或溫度 | 裝置和元件 | 同一元件被回報恢復正常 |
| 介面中斷 | `interface.down` | 裝置和介面 | 該介面的 `interface.up` |
| 有人反覆登入失敗 | 超過 10 次 `auth.login_failed`，發生在 5 分鐘內 | 裝置 | 連續 5 分鐘不超過 10 次 |

每個警示都是一個[日誌監控](/docs/monitor/logs-monitor)，統計最近 5 分鐘內的事件，並設定了 **Group by Attributes**，使每條通道、每個閘道或介面都有自己的警示，同時將**依屬性解決**設為說明問題已結束的事件。這樣的警示會一直保持開啟，直到同一裝置、同一通道的該事件到達，無論需要多久；請參閱[由日誌解決](/docs/monitor/logs-monitor#由日誌解決)。OneUptime 不讀取任何說明溫度恢復正常的事件，因此溫度警示會一直開啟，直到你將其解決。

從裝置的**事件**分頁建立的監測器只監測該裝置。對於其他任何事件，請在事件頁面上開啟其中一個，然後按一下**為此事件建立警示**。要把警示傳送到某處，或呼叫某人，請像對其他監測器一樣，為該監測器新增待命策略或工作流程。

## 尚未成為裝置的位址

syslog 可能在傳送它的裝置被新增到 OneUptime 之前到達。在你自己的探測器上，它會被保留，其事件以裝置自報的名稱顯示在網路的事件頁面上，其位址列在**正在傳送 syslog，尚未成為裝置**下：

- **新增為裝置**會開啟 **新增裝置**，並已填好位址和探測器。已經到達的訊息留在網路的頁面上；新訊息歸屬於該裝置。
- **這是我的裝置之一**會將該位址加入某台裝置的**其他位址**：當你已新增的裝置從另一個位址（例如迴路位址）傳送時使用。從下一分鐘起，它的訊息歸屬於那台裝置。

位於同一個 NAT 位址後面的多台裝置共用該位址，因此它們的訊息會歸屬於擁有該位址的那一台裝置，除非訊息指明了自己的裝置。

## 你自己的事件

對於 OneUptime 不了解其格式的裝置，或它不讀取的事件，需要使用[日誌管道](/docs/telemetry/log-pipelines)：

1. 建立一個管道，使其篩選條件符合該裝置的日誌，例如 `attributes.networkDevice.name = 'rack-ups'`。
2. 新增 **Grok Parser** 或 **Key=Value Parser**，從訊息中擷取你需要的欄位。
3. 新增**類別處理器**，將**目標屬性**設為 `event.name`，並為每種事件新增一條規則。像上面的事件那樣為每條規則命名，使用小寫字母並以點或底線分隔：`ups.on_battery`。

帶有這種名稱的網路裝置日誌會成為網路事件：它會出現在事件頁面上，**為此事件建立警示**也對它有效。要說明它涉及什麼，請新增**屬性重新對應器**，將你的欄位複製到事件表中的某個屬性，例如 `hw.name`。除非你的管道將 `event.kind` 設為 `problem` 或 `recovery`，否則事件會列在**資訊**下。以內建事件命名的規則（例如 `interface.down`）會產生該內建事件，並帶有它的類型和警示。

管道屬於它所在的專案。要在另一個專案中使用，請在那裡用相同的處理器建立它。

## 不包含的內容

- **透過 TLS 的 syslog**（RFC 5425）。探測器接收明文的 UDP 和 TCP；請將裝置與探測器之間的路徑保持在你信任的網路內。
- **在專案之間共用剖析器。** 管道目前還不能匯出和匯入。
- **來自四種標準 Trap 之外的 SNMP Trap 的事件。** 廠商自有的 Trap 會儲存為日誌，可使用 **SNMP Trap Received (Trap OID)** 條件在[網路設備監控](/docs/monitor/network-device-monitor)中對其設定警示。
- **Cambium cnMatrix 交換器、Aruba 行動控制器和 CEF 模式下的 FortiGate。** 它們的訊息會被儲存並可搜尋；目前還不會從中讀取事件。
- **即時追蹤。** 事件頁面顯示的是開啟時已到達的內容；請使用頁面的重新整理按鈕，或使用**日誌**的即時追蹤。

## 疑難排解

如果事件頁面仍然顯示設定步驟：

- **探測器收到任何資料了嗎？** 網路的事件頁面會在**正在傳送 syslog，尚未成為裝置**下列出時間範圍內傳送過 syslog 的所有位址。如果裝置在那裡，表示它從不是其主機名稱的位址傳送：請將該位址加入它的**其他位址**。
- **防火牆和 Docker。** 允許從裝置到探測器的連接埠 5140；如果探測器在 Docker 中執行，請發布該連接埠。許多裝置在未另行指定時會傳送到連接埠 514。
- **探測器的日誌。** 探測器在啟動時會記錄它接聽的連接埠，或記錄它無法開啟該連接埠。當它因超過 `PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE` 而捨棄訊息時，會每分鐘記錄一次捨棄的數量。
- **全域探測器。** 由全域探測器輪詢的裝置無法從私人網路向其傳送 syslog。請在裝置所在網路中執行自訂探測器，並在裝置設定中選擇它。
- **訊息到達了，但沒有事件。** 頁面會說明這一點，每則訊息都在裝置的**日誌**分頁上。請檢查裝置是否傳送資訊層級的訊息而不僅僅是錯誤，以及產品是否屬於 [OneUptime 讀取什麼](#oneuptime-讀取什麼)中列出的產品；否則，請在日誌管道中為它的事件命名。
