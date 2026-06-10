# SNMP 監視器

SNMP（Simple Network Management Protocol，簡易網路管理協定）監控可讓您透過查詢 SNMP OID（物件識別碼）來監控交換器、路由器、防火牆以及其他網路基礎設施等網路裝置。

## 概觀

SNMP 監視器使用 OID 向網路裝置查詢特定的管理資訊。這讓您能夠：

- 監控裝置可用性與健康狀態
- 追蹤介面統計資料（流量、錯誤、狀態）
- 監控系統指標（CPU、記憶體、執行時間）
- 檢查特定廠商的自訂 OID
- 根據 OID 值設定警示

## 建立 SNMP 監視器

1. 前往 OneUptime 儀表板中的 **Monitors**
2. 點選 **Create Monitor**
3. 選擇 **SNMP** 作為監視器類型
4. 依照下方說明設定 SNMP 選項

## 設定選項

### 基本設定

| 欄位 | 說明 | 必填 |
|-------|-------------|----------|
| SNMP Version | 協定版本：v1、v2c 或 v3 | 是 |
| Hostname/IP | SNMP 裝置的主機名稱或 IP 位址 | 是 |
| Port | SNMP 連接埠（預設：161） | 是 |

### 驗證

#### SNMP v1/v2c

對於 SNMP v1 與 v2c，您只需要提供 community string：

| 欄位 | 說明 | 必填 |
|-------|-------------|----------|
| Community String | SNMP community string（例如："public"） | 是 |

#### SNMP v3

SNMPv3 透過驗證與加密提供更強化的安全性：

| 欄位 | 說明 | 必填 |
|-------|-------------|----------|
| Security Level | noAuthNoPriv、authNoPriv 或 authPriv | 是 |
| Username | SNMPv3 使用者名稱 | 是 |
| Auth Protocol | MD5、SHA、SHA256 或 SHA512 | 若為 authNoPriv 或 authPriv |
| Auth Key | 驗證密碼 | 若為 authNoPriv 或 authPriv |
| Priv Protocol | DES、AES 或 AES256 | 若為 authPriv |
| Priv Key | 隱私/加密密碼 | 若為 authPriv |

### 要監控的 OID

新增您想從裝置查詢的 OID。對於每個 OID，您可以指定：

| 欄位 | 說明 | 必填 |
|-------|-------------|----------|
| OID | 數字 OID（例如：1.3.6.1.2.1.1.1.0） | 是 |
| Name | OID 的易記名稱（例如：sysDescr） | 否 |
| Description | 此 OID 所代表內容的說明 | 否 |

### 常見 OID 範本

OneUptime 為常用的監控 OID 提供範本：

#### System MIB

| OID | Name | Description |
|-----|------|-------------|
| 1.3.6.1.2.1.1.1.0 | sysDescr | 系統說明 |
| 1.3.6.1.2.1.1.3.0 | sysUpTime | 系統執行時間（以 tick 為單位） |
| 1.3.6.1.2.1.1.5.0 | sysName | 系統名稱 |
| 1.3.6.1.2.1.1.6.0 | sysLocation | 系統位置 |
| 1.3.6.1.2.1.1.4.0 | sysContact | 系統聯絡人 |

#### Interface MIB

| OID | Name | Description |
|-----|------|-------------|
| 1.3.6.1.2.1.2.1.0 | ifNumber | 網路介面數量 |
| 1.3.6.1.2.1.2.2.1.8.X | ifOperStatus | 介面運作狀態（X = 介面索引） |
| 1.3.6.1.2.1.2.2.1.10.X | ifInOctets | 輸入位元組數（X = 介面索引） |
| 1.3.6.1.2.1.2.2.1.16.X | ifOutOctets | 輸出位元組數（X = 介面索引） |

#### Host Resources MIB

| OID | Name | Description |
|-----|------|-------------|
| 1.3.6.1.2.1.25.1.1.0 | hrSystemUptime | 主機系統執行時間 |
| 1.3.6.1.2.1.25.1.5.0 | hrSystemNumUsers | 使用者數量 |
| 1.3.6.1.2.1.25.1.6.0 | hrSystemProcesses | 執行中的程序數量 |
| 1.3.6.1.2.1.25.3.3.1.2.X | hrProcessorLoad | CPU 負載（X = 處理器索引） |

### 進階設定

| 欄位 | 說明 | 預設值 |
|-------|-------------|---------|
| Timeout | 等待回應的時間（毫秒） | 5000 |
| Retries | 失敗時的重試次數 | 3 |

## 監控條件

您可以設定條件來檢查 SNMP 回應並觸發警示或事件。

### 可用的檢查類型

| 檢查類型 | 說明 |
|------------|-------------|
| SNMP Device Is Online | 檢查裝置是否回應 SNMP 查詢 |
| SNMP Response Time | 檢查查詢回應時間（以毫秒為單位） |
| SNMP OID Value | 檢查特定 OID 所傳回的值 |
| SNMP OID Exists | 檢查 OID 是否傳回值（非 null） |

### 範例條件

#### 檢查裝置是否上線
- **Check On**：SNMP Device Is Online
- **Filter Type**：True

#### 當回應時間超過閾值時發出警示
- **Check On**：SNMP Response Time (in ms)
- **Filter Type**：Greater Than
- **Value**：1000

#### 檢查介面狀態
- **Check On**：SNMP OID Value
- **OID**：1.3.6.1.2.1.2.2.1.8.1
- **Filter Type**：Equal To
- **Value**：1（1 = up，2 = down）

#### 檢查 CPU 負載閾值
- **Check On**：SNMP OID Value
- **OID**：1.3.6.1.2.1.25.3.3.1.2.1
- **Filter Type**：Greater Than
- **Value**：80

## 使用監視器密鑰

為了安全起見，您可以將 community string 與 SNMPv3 憑證等敏感資訊儲存為密鑰。

### 新增密鑰

1. 前往 **Project Settings** -> **Monitor Secrets** -> **Create Monitor Secret**
2. 新增您的密鑰（例如：community string 或 SNMPv3 密碼）
3. 選擇應可存取此密鑰的 SNMP 監視器

### 在 SNMP 設定中使用密鑰

在任何敏感欄位中使用 `{{monitorSecrets.SECRET_NAME}}` 語法：

- **Community String**：`{{monitorSecrets.SnmpCommunity}}`
- **SNMPv3 Auth Key**：`{{monitorSecrets.SnmpAuthKey}}`
- **SNMPv3 Priv Key**：`{{monitorSecrets.SnmpPrivKey}}`

## 警示的範本變數

建立事件或警示範本時，您可以使用下列變數：

| 變數 | 說明 |
|----------|-------------|
| `{{isOnline}}` | 裝置是否上線（true/false） |
| `{{responseTimeInMs}}` | 查詢回應時間（以毫秒為單位） |
| `{{failureCause}}` | 查詢失敗時的錯誤訊息 |
| `{{oidResponses}}` | OID 回應物件的陣列 |
| `{{OID_NAME}}` | 以名稱指定的特定 OID 值（例如：`{{sysUpTime}}`） |

## 疑難排解

### 常見問題

#### 裝置未回應
- 確認裝置 IP/主機名稱正確
- 檢查裝置上是否已啟用 SNMP
- 確認防火牆規則允許 UDP 連接埠 161
- 確認 community string 正確

#### 驗證失敗（v3）
- 確認使用者名稱、auth protocol 與 auth key
- 確保安全層級與裝置設定相符
- 檢查 authPriv 層級的 priv protocol 與金鑰是否正確

#### 找不到 OID
- 確認您的裝置支援該 OID
- 檢查該 OID 是否需要載入特定的 MIB
- 嘗試使用 snmpget/snmpwalk 工具直接查詢該 OID

### 測試 SNMP 連線

在設定監控之前，您可以使用命令列工具測試 SNMP 連線：

```bash
# SNMP v2c
snmpget -v2c -c public 192.168.1.1 1.3.6.1.2.1.1.1.0

# SNMP v3 (authPriv)
snmpget -v3 -u username -l authPriv -a SHA -A authpassword -x AES -X privpassword 192.168.1.1 1.3.6.1.2.1.1.1.0
```

## 最佳實務

1. **盡可能使用 SNMPv3** - 它提供驗證與加密以獲得更佳的安全性
2. **將憑證儲存為密鑰** - 切勿將 community string 或密碼寫死在程式碼中
3. **僅監控必要的 OID** - 只查詢您需要的內容以減少網路負擔
4. **設定適當的逾時時間** - 網路裝置的回應時間可能各不相同
5. **使用具描述性的 OID 名稱** - 讓警示訊息更容易理解
6. **部署前先測試** - 在建立監視器之前先驗證 SNMP 連線
