# 監控密鑰

您可以使用密鑰來儲存想在監控檢查中使用的敏感資訊。密鑰會經過加密並安全地儲存。

### 新增密鑰

若要新增密鑰，請前往 OneUptime Dashboard -> Project Settings -> Monitor Secrets -> Create Monitor Secret。

![Create Secret](/docs/static/images/CreateMonitorSecret.png)

您可以選擇哪些監控器可以存取此密鑰。在此範例中，我們新增了 `ApiKey` 密鑰，並選擇了可以存取它的監控器。

**請注意**：密鑰會經過加密並安全地儲存。如果您遺失了密鑰，您將需要建立一個新的密鑰。密鑰儲存後，您無法檢視或更新它。

### 使用密鑰

您可以在以下監控類型中使用密鑰：

- API（在請求標頭、請求主體及 URL 中）
- Website、IP、Port、Ping、SSL Certificate（在 URL 中）
- Synthetic Monitor、Custom Code Monitor（在程式碼中）
- SNMP Monitor（在 community string、SNMPv3 auth key 及 priv key 中）

![Using Secret](/docs/static/images/UsingMonitorSecret.png)

若要使用密鑰，請在您想要使用密鑰的欄位中加入 `{{monitorSecrets.SECRET_NAME}}`。例如，在此範例中，我們在 Requets Header 欄位中加入了 `{{monitorSecrets.ApiKey}}`。

密鑰會在 Synthetic 或 Custom Code 監控腳本執行前，於探測器（probe）上注入，因此像 `{{monitorSecrets.ApiKey}}` 這樣的參考會在執行中的腳本內解析為已解密的值。

### 監控密鑰權限

您可以選擇哪些監控器可以存取此密鑰。您也可以隨時更新權限。因此，如果您想要新增一個監控器來存取此密鑰，您可以透過更新權限來達成。
