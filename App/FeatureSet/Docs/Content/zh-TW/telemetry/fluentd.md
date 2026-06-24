# 使用 Fluentd 將遙測資料傳送到 OneUptime

## 概觀

您可以使用 [Fluentd](https://www.fluentd.org/) 外掛程式從您的應用程式與服務收集日誌及遙測資料。此外掛程式會將遙測資料傳送到 OneUptime HTTP Source。您可以使用 fluentd 的 http 輸出外掛程式，將遙測資料傳送到 OneUptime HTTP Source。此外掛程式可在此處找到：https://docs.fluentd.org/output/http

## 開始使用

Fluentd 支援數百種資料來源，您可以將這些來源中的任何日誌擷取到 OneUptime。一些熱門的來源包括：

- Docker
- Syslog
- Apache
- Nginx
- MySQL
- PostgreSQL
- MongoDB
- NodeJS
- Ruby
- Python
- Java
- PHP
- Go
- Rust

以及更多其他來源。

您可以在[此處](https://www.fluentd.org/datasources)找到支援來源的完整清單

## 先決條件

- **步驟 1：在您的系統上安裝 Fluentd** - 您可以依照[此處](https://docs.fluentd.org/installation)提供的說明安裝 Fluentd
- **步驟 2：註冊 OneUptime 帳號** - 您可以在[此處](https://oneuptime.com)註冊免費帳號。請注意，雖然帳號是免費的，但日誌擷取是付費功能。您可以在[此處](https://oneuptime.com/pricing)找到關於定價的更多詳細資訊。
- **步驟 3：建立 OneUptime 專案** - 擁有帳號後，您可以從 OneUptime 儀表板建立專案。如果您在建立專案時需要任何協助或有任何疑問，請透過 support@oneuptime.com 與我們聯絡
- **步驟 4：建立遙測擷取權杖** - 建立 OneUptime 帳號後，您可以建立遙測擷取權杖，以從您的應用程式擷取日誌、指標與追蹤。

註冊 OneUptime 並建立專案後。點擊導覽列中的「More」，然後點擊「Project Settings」。

在 Telemetry Ingestion Key 頁面上，點擊「Create Ingestion Key」以建立權杖。

![Create Service](/docs/static/images/TelemetryIngestionKeys.png)

建立權杖後，點擊「View」以檢視該權杖。

![View Service](/docs/static/images/TelemetryIngestionKeyView.png)

## 設定

您可以使用下列設定將遙測資料傳送到 OneUptime HTTP Source。您可以將此設定加入 fluentd 設定檔。該設定檔通常位於 `/etc/fluentd/fluent.conf` 或 `/etc/td-agent/td-agent.conf`。

您需要將 `YOUR_SERVICE_TOKEN` 替換為您在上一步建立的權杖。您也需要將 `YOUR_SERVICE_NAME` 替換為您的服務名稱。服務名稱可以是您喜歡的任何名稱。如果該服務在 OneUptime 中不存在，系統將自動建立它。

```yaml
# Match all patterns
<match **>
@type http

endpoint https://oneuptime.com/fluentd/logs
open_timeout 2

headers {"x-oneuptime-token":"YOUR_SERVICE_TOKEN", "x-oneuptime-service-name":"YOUR_SERVICE_NAME"}

content_type application/json
json_array true

<format>
@type json
</format>
<buffer>
flush_interval 10s
</buffer>
</match>
```

完整設定檔的範例如下所示：

```yaml
####
## Source descriptions:
##

## built-in TCP input
## @see https://docs.fluentd.org/input/forward
<source>
@type forward
port 24224
bind 0.0.0.0
</source>

<match **>
@type http

endpoint https://oneuptime.com/fluentd/logs
open_timeout 2

headers {"x-oneuptime-token":"YOUR_SERVICE_TOKEN", "x-oneuptime-service-name":"YOUR_SERVICE_NAME"}

content_type application/json
json_array true

<format>
@type json
</format>
<buffer>
flush_interval 10s
</buffer>
</match>
```

**如果您自行託管 OneUptime**：如果您自行託管 OneUptime，您可以將 `endpoint_url` 替換為您的 OneUptime 執行個體的 URL。`http(s)://YOUR_ONEUPTIME_HOST/fluentd/logs`

## 使用方式

將設定加入 fluentd 設定檔後，您可以重新啟動 fluentd 服務。服務重新啟動後，遙測資料將被傳送到 OneUptime HTTP Source。您現在可以開始在 OneUptime 儀表板中看到遙測資料。如果您有任何疑問或在設定上需要協助，請透過 support@oneuptime.com 與我們聯絡
