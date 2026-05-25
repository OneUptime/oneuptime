# 使用 Fluentd 向 OneUptime 發送遙測數據

## 概述

您可以使用 [Fluentd](https://www.fluentd.org/) 插件從您的應用程序和服務中收集日誌和遙測數據。該插件將遙測數據發送到 OneUptime HTTP 源。您可以使用 Fluentd 的 http 輸出插件將遙測數據發送到 OneUptime HTTP 源。該插件可在此處找到：https://docs.fluentd.org/output/http

## 入門

Fluentd 支持數百種數據源，您可以將來自任何數據源的日誌攝取到 OneUptime 中。一些常用數據源包括：

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

以及更多其他數據源。

您可以在[此處](https://www.fluentd.org/datasources)找到支持的數據源完整列表。

## 前提條件

- **第一步：在您的系統上安裝 Fluentd** - 您可以使用[此處](https://docs.fluentd.org/installation)提供的說明安裝 Fluentd
- **第二步：註冊 OneUptime 賬號** - 您可以在[此處](https://oneuptime.com)註冊免費賬號。請注意，雖然賬號是免費的，但日誌攝取是付費功能。您可以在[此處](https://oneuptime.com/pricing)找到有關定價的更多詳細信息。
- **第三步：創建 OneUptime 項目** - 擁有賬號後，您可以從 OneUptime 控制台創建項目。如果您在創建項目方面需要幫助或有任何問題，請通過 support@oneuptime.com 聯繫我們。
- **第四步：創建遙測攝取令牌** - 創建 OneUptime 賬號後，您可以創建遙測攝取令牌，用於從應用程序攝取日誌、指標和追蹤數據。

註冊 OneUptime 並創建項目後。點擊導航欄中的"更多"，然後點擊"項目設置"。

在遙測攝取密鑰頁面，點擊"創建攝取密鑰"以創建令牌。

![創建服務](/docs/static/images/TelemetryIngestionKeys.png)

創建令牌後，點擊"查看"以查看令牌。

![查看服務](/docs/static/images/TelemetryIngestionKeyView.png)


## 配置

您可以使用以下配置將遙測數據發送到 OneUptime HTTP 源。您可以將此配置添加到 Fluentd 配置文件中。配置文件通常位於 `/etc/fluentd/fluent.conf` 或 `/etc/td-agent/td-agent.conf`。

您需要將 `YOUR_SERVICE_TOKEN` 替換爲您在上一步創建的令牌。您還需要將 `YOUR_SERVICE_NAME` 替換爲您的服務名稱。服務名稱可以是您喜歡的任何名稱。如果該服務在 OneUptime 中不存在，它將自動創建。

```yaml
# 匹配所有模式
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


以下是完整配置文件的示例：

```yaml
####
## 數據源描述：
##

## 內置 TCP 輸入
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

**如果您是自託管 OneUptime**：如果您是自託管 OneUptime，可以將 `endpoint_url` 替換爲您的 OneUptime 實例的 URL。`http(s)://YOUR_ONEUPTIME_HOST/fluentd/logs`

## 使用

將配置添加到 Fluentd 配置文件後，您可以重啓 Fluentd 服務。服務重啓後，遙測數據將被髮送到 OneUptime HTTP 源。您現在可以在 OneUptime 控制台中看到遙測數據。如果您有任何問題或需要配置方面的幫助，請通過 support@oneuptime.com 聯繫我們。
