# 監控密鑰

您可以使用密鑰來儲存想在監控檢查中使用的敏感資訊。密鑰會經過加密並安全地儲存。

### 新增密鑰

若要新增密鑰，請前往 OneUptime Dashboard -> 監測 -> 設定 -> 密鑰 -> Create Monitor Secret。

![Create Secret](/docs/static/images/CreateMonitorSecret.png)

為密鑰設定名稱和值，然後在**存取**步驟中選擇哪些監測器可以使用它。在此範例中，我們新增了一個 `ApiKey` 密鑰。

**請注意**：密鑰會經過加密並安全地儲存。儲存後密鑰值不會再次顯示——表格中不會，編輯表單中不會，透過 API 也不會。若您遺失該值，必須從原始來源重新取得並再次設定。若要輪換密鑰，請使用該列上的 **更新密鑰值** 按鈕；不需要刪除後重新建立。

### 選擇哪些監測器可以使用密鑰

每個密鑰都有以下三種存取選項之一：

- **所有監測器**：專案中的每個監測器都可以使用該密鑰，包括您之後建立的監測器。適用於許多監測器共用的憑證。
- **特定監測器**：只有您選擇的監測器可以使用該密鑰。這是預設選項，在這些選項推出之前建立的密鑰也以此方式運作。
- **帶標籤的監測器**：至少帶有您所選標籤之一的監測器可以使用該密鑰。為監測器加上其中一個標籤即可讓它取得存取權；移除該標籤後，監測器會在下次執行時失去存取權。

您可以隨時透過密鑰所在列的**編輯**變更選項。只會保留所選選項的清單：切換到**所有監測器**會清空密鑰的監測器清單和標籤清單；在**特定監測器**和**帶標籤的監測器**之間切換會清空您切換離開的那份清單。

密鑰絕不會提供給其他專案中的監測器。

任何能夠編輯可使用某個密鑰之監測器的人，都可以把該密鑰傳送到該監測器連線的任何位址。對於**所有監測器**，這包括專案中所有能夠建立或編輯監測器的人。對於**帶標籤的監測器**，還包括所有能夠為監測器加上其中一個標籤的人。

在 API 中，存取選項是 `monitorAccess` 欄位：`All Monitors`、`Specific Monitors` 或 `Monitors With Labels`。`monitors` 和 `labels` 欄位保存相應的清單。建立時未提供 `monitorAccess` 的密鑰會使用 `Specific Monitors`。

### 使用密鑰

您可以在以下監控類型中使用密鑰：

- API（在請求標頭、請求主體及 URL 中）
- Website、IP、Port、Ping、SSL Certificate（在 URL 中）
- Synthetic Monitor、Custom Code Monitor（在程式碼中）
- SNMP Monitor（在 community string、SNMPv3 auth key 及 priv key 中）

![Using Secret](/docs/static/images/UsingMonitorSecret.png)

若要使用密鑰，請在您想要使用密鑰的欄位中加入 `{{monitorSecrets.SECRET_NAME}}`。例如，在此範例中，我們在 Requets Header 欄位中加入了 `{{monitorSecrets.ApiKey}}`。

密鑰會在 Synthetic 或 Custom Code 監控腳本執行前，於探測器（probe）上注入，因此像 `{{monitorSecrets.ApiKey}}` 這樣的參考會在執行中的腳本內解析為已解密的值。

如果監測器參照了它無權使用的密鑰，該參照會保持原樣，不會被替換為值。

在儲存之前測試監測器時，只會填入**所有監測器**可用的密鑰，因為新監測器不在任何清單中，也還沒有標籤。儲存監測器後，測試會使用該監測器可以使用的所有密鑰。
