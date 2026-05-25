# 傳入請求入口

自定義探針可以選擇運行一個**入站 HTTP 監聽器**，接受來自私有網絡內部的 `heartbeat` 和 `incoming-request` 調用，並將其轉發到 OneUptime。這使得**沒有出站互聯網訪問**的服務仍然可以通過向本地網絡上的探針（而非直接向 `oneuptime.com`）發送請求，向[傳入請求監控器](/docs/monitor/incoming-request-monitor)報告。

## 概述

當設置 `PROBE_INGRESS_PORT` 時，探針會在該端口上綁定一個額外的 HTTP 監聽器。監聽器接受與公共 OneUptime 端點相同的 `secretkey` URL 路徑：

- `POST /heartbeat/:secretkey`
- `GET /heartbeat/:secretkey`
- `POST /incoming-request/:secretkey`
- `GET /incoming-request/:secretkey`

然後探針將請求代理到您的 OneUptime 實例，保留方法、正文和請求頭（減去逐跳頭，如 `Host`、`Connection`、`Content-Length` 等）。探針自動附加 `OneUptime-Probe-Id` 頭，以便將請求歸屬到轉發探針。

監聽器運行在**專用端口**上，與探針的內部狀態/指標端點分離，因此您可以將其暴露給私有網絡而不暴露其他任何內容。

## 何時使用此功能

在以下情況下使用入口監聽器：

- 您的服務運行在沒有出站 HTTPS 訪問的隔離網絡段中
- 您需要將所有監控流量保持在 VPC/內部網絡中
- 您希望只有一個出口點（探針）被允許訪問 OneUptime
- 您已經部署了[自定義探針](/docs/probe/custom-probe)，並希望將其重用於入站心跳

如果您的服務已經可以直接訪問 `https://oneuptime.com`（或您的自託管 URL），您**不需要**此功能——直接從服務調用心跳 URL 即可。

## 啓用入口監聽器

將 `PROBE_INGRESS_PORT` 設置爲您希望監聽器綁定的端口。任何大於 `0` 的值都會啓用監聽器；將其保留未設置（或 `0`）將禁用它。

### Docker

```bash
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e PROBE_INGRESS_PORT=3875 \
  -d oneuptime/probe:release
```

如果您不使用 `--network host`，請顯式發佈入口端口：

```bash
docker run --name oneuptime-probe \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e PROBE_INGRESS_PORT=3875 \
  -p 3875:3875 \
  -d oneuptime/probe:release
```

### Docker Compose

```yaml
version: "3"

services:
  oneuptime-probe:
    image: oneuptime/probe:release
    container_name: oneuptime-probe
    environment:
      - PROBE_KEY=<probe-key>
      - PROBE_ID=<probe-id>
      - ONEUPTIME_URL=https://oneuptime.com
      - PROBE_INGRESS_PORT=3875
    ports:
      - "3875:3875"
    restart: always
```

### Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oneuptime-probe
spec:
  selector:
    matchLabels:
      app: oneuptime-probe
  template:
    metadata:
      labels:
        app: oneuptime-probe
    spec:
      containers:
        - name: oneuptime-probe
          image: oneuptime/probe:release
          env:
            - name: PROBE_KEY
              value: "<probe-key>"
            - name: PROBE_ID
              value: "<probe-id>"
            - name: ONEUPTIME_URL
              value: "https://oneuptime.com"
            - name: PROBE_INGRESS_PORT
              value: "3875"
          ports:
            - name: ingress
              containerPort: 3875
---
apiVersion: v1
kind: Service
metadata:
  name: oneuptime-probe-ingress
spec:
  selector:
    app: oneuptime-probe
  ports:
    - name: ingress
      port: 3875
      targetPort: 3875
  type: ClusterIP
```

內部服務可以將心跳發送到 `http://oneuptime-probe-ingress.<namespace>.svc.cluster.local:3875/heartbeat/<secret-key>`。

## 向探針發送請求

將公共心跳 URL：

```
https://oneuptime.com/heartbeat/<secret-key>
```

替換爲探針的入口 URL：

```
http://<probe-host>:<PROBE_INGRESS_PORT>/heartbeat/<secret-key>
```

路徑、方法、正文和頭信息與原來相同，因此任何現有的客戶端代碼只需更改基礎 URL。

### 示例

```bash
# GET 心跳
curl http://probe.internal:3875/heartbeat/YOUR_SECRET_KEY

# 帶 JSON 正文的 POST 心跳
curl -X POST http://probe.internal:3875/heartbeat/YOUR_SECRET_KEY \
  -H "Content-Type: application/json" \
  -d '{"status": "healthy", "version": "1.2.3"}'

# Cron 作業
*/5 * * * * curl -s http://probe.internal:3875/heartbeat/YOUR_SECRET_KEY > /dev/null
```

## 轉發行爲

- **同步響應，異步轉發。** 探針立即以 `200` 確認入站請求，並在後臺轉發到 OneUptime。您的服務無需等待轉發完成。
- **頭信息被保留。** 除逐跳頭（`Host`、`Connection`、`Content-Length`、`Transfer-Encoding`、`Keep-Alive`、`Proxy-Authenticate`、`Proxy-Authorization`、`TE`、`Trailer`、`Upgrade`）外，所有頭信息都會被傳遞。探針添加 `OneUptime-Probe-Id` 頭以標識自己。
- **正文被保留。** 接受最多 **50 MB** 的 JSON、URL 編碼和原始 `application/octet-stream` 負載。
- **帶退避的重試。** 如果轉發失敗，探針最多重試 `PROBE_INGRESS_FORWARD_RETRY_LIMIT` 次，採用指數退避（2秒、4秒、8秒，最多15秒）。
- **代理感知。** 如果探針本身配置了 `HTTP_PROXY_URL` / `HTTPS_PROXY_URL`，轉發的請求將通過代理發送。

## 環境變量

| 變量 | 默認值 | 描述 |
|------|--------|------|
| `PROBE_INGRESS_PORT` | _未設置_（禁用） | 入站監聽器綁定的端口。任何值 `> 0` 都啓用入口。 |
| `PROBE_INGRESS_FORWARD_TIMEOUT_MS` | `10000` | 每次向 OneUptime 轉發嘗試的超時時間（毫秒）。最小值爲 `1000`。 |
| `PROBE_INGRESS_FORWARD_RETRY_LIMIT` | `3` | 探針放棄轉發前的重試次數。設置爲 `0` 以禁用重試。 |

標準探針變量（`PROBE_KEY`、`PROBE_ID`、`ONEUPTIME_URL`、代理變量）均適用——完整列表請參見[自定義探針](/docs/probe/custom-probe)。

## 安全注意事項

- **端點根據設計是未認證的** — URL 路徑中的密鑰*就是*認證憑據，就像公共 `oneuptime.com` 端點一樣。請將密鑰視爲憑據。
- **僅綁定到私有接口。** 入口監聽器不應從公共互聯網訪問。使用網絡策略、防火牆規則或 `ClusterIP` 服務來限制訪問。
- **如果需要傳輸中加密，請使用 HTTPS 終止。** 探針的監聽器使用純 HTTP。如果入站連接需要 TLS，請將其放在內部負載均衡器/入口控制器後面。從探針到 OneUptime 的轉發路段始終使用 HTTPS（假設 `ONEUPTIME_URL` 是 `https://`）。
- **資源限制。** 監聽器接受最多 50 MB 的請求體。如果您需要更嚴格的限制，請在前面放置反向代理。

## 故障排查

- **探針啓動時日誌顯示 `Probe ingress listener started on port <port>`** — 確認監聽器已啓動。如果您沒有看到此行，則 `PROBE_INGRESS_PORT` 未設置、爲 `0` 或無效。
- **`Probe ingress: failed to forward to <url> after N attempts`** — 探針無法訪問 OneUptime。檢查探針的出站連接、代理設置和 `ONEUPTIME_URL` 的值。
- **`Probe ingress: probe ID not available, forwarding without it`** — 探針尚未註冊。轉發仍然成功；心跳只是不會歸屬到探針。
- **心跳出現在 OneUptime 中但不是通過探針** — 確認您的服務正在訪問 `http://<probe-host>:<port>/...` 而非公共 URL。錯誤配置的 DNS 或 `/etc/hosts` 條目是常見原因。

## 相關內容

- [自定義探針](/docs/probe/custom-probe)
- [傳入請求監控器](/docs/monitor/incoming-request-monitor)
