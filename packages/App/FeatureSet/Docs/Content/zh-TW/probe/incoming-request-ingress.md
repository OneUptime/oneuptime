# 傳入請求入口（Incoming Request Ingress）

自訂探針（Custom Probe）可以選擇性地執行一個**傳入 HTTP 監聽器**，接受來自您私有網路內部的 `heartbeat` 與 `incoming-request` 呼叫，並將它們轉發到 OneUptime。這讓**沒有對外網際網路存取能力**的服務，仍然可以透過將請求傳送到本地網路上的探針（而非直接傳送到 `oneuptime.com`），向[傳入請求監控（Incoming Request Monitor）](/docs/monitor/incoming-request-monitor)回報。

## 概觀

當設定了 `PROBE_INGRESS_PORT` 時，探針會在該連接埠上額外綁定一個 HTTP 監聽器。此監聽器接受與公開 OneUptime 端點相同的 `secretkey` URL 路徑：

- `POST /heartbeat/:secretkey`
- `GET /heartbeat/:secretkey`
- `POST /incoming-request/:secretkey`
- `GET /incoming-request/:secretkey`

接著探針會將請求代理（proxy）到您的 OneUptime 執行個體，保留方法、主體（body）與請求標頭（不含逐跳標頭，例如 `Host`、`Connection`、`Content-Length` 等）。探針會自動附加一個 `OneUptime-Probe-Id` 標頭，讓該請求歸屬於進行轉發的探針。

此監聽器執行於一個**專用連接埠**，與探針內部的狀態／指標端點分開，因此您可以將它公開給私有網路，而不必公開任何其他內容。

## 何時使用此功能

在下列情況下使用入口監聽器：

- 您的服務執行於沒有對外 HTTPS 存取能力的隔離網路區段中
- 您需要將所有監控流量保持在 VPC／地端（on-prem）網路內
- 您希望有單一的出口點——也就是探針——被允許連線到 OneUptime
- 您已經部署了[自訂探針（Custom Probe）](/docs/probe/custom-probe)，並想重複使用它來處理傳入的心跳（heartbeat）

如果您的服務已經可以直接連線到 `https://oneuptime.com`（或您的自架 URL），那麼您**不**需要此功能——直接從服務呼叫心跳 URL 即可。

## 啟用入口監聽器

將 `PROBE_INGRESS_PORT` 設定為您希望監聽器綁定的連接埠。任何大於 `0` 的值都會啟用監聽器；未設定（或設為 `0`）則會停用它。

### Docker

```bash
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e PROBE_INGRESS_PORT=3875 \
  -d oneuptime/probe:release
```

如果您沒有使用 `--network host`，請明確發佈入口連接埠：

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

接著內部服務可以將心跳傳送到 `http://oneuptime-probe-ingress.<namespace>.svc.cluster.local:3875/heartbeat/<secret-key>`。

## 將請求傳送到探針

將公開的心跳 URL：

```
https://oneuptime.com/heartbeat/<secret-key>
```

替換為探針的入口 URL：

```
http://<probe-host>:<PROBE_INGRESS_PORT>/heartbeat/<secret-key>
```

路徑、方法、主體與標頭在其他方面完全相同，因此任何既有的用戶端程式碼只需變更基底 URL 即可。

### 範例

```bash
# GET heartbeat
curl http://probe.internal:3875/heartbeat/YOUR_SECRET_KEY

# POST heartbeat with JSON body
curl -X POST http://probe.internal:3875/heartbeat/YOUR_SECRET_KEY \
  -H "Content-Type: application/json" \
  -d '{"status": "healthy", "version": "1.2.3"}'

# Cron job
*/5 * * * * curl -s http://probe.internal:3875/heartbeat/YOUR_SECRET_KEY > /dev/null
```

## 轉發行為

- **同步回應，非同步轉發。** 探針會立即以 `200` 確認傳入的請求，並在背景轉發到 OneUptime。您的服務不必等待轉發完成。
- **標頭會被保留。** 除了逐跳標頭（`Host`、`Connection`、`Content-Length`、`Transfer-Encoding`、`Keep-Alive`、`Proxy-Authenticate`、`Proxy-Authorization`、`TE`、`Trailer`、`Upgrade`）之外的所有標頭都會被傳遞。探針會新增一個 `OneUptime-Probe-Id` 標頭來標識自己。
- **主體會被保留。** 接受 JSON、URL 編碼，以及最大 **50 MB** 的原始 `application/octet-stream` 酬載（payload）。
- **具退避機制的重試。** 如果轉發失敗，探針會以指數退避（2s、4s、8s，上限為 15s）重試最多 `PROBE_INGRESS_FORWARD_RETRY_LIMIT` 次。
- **支援代理（Proxy-aware）。** 如果探針本身設定了 `HTTP_PROXY_URL` ／ `HTTPS_PROXY_URL`，轉發的請求將會經由該代理。

## 環境變數

| 變數                                | 預設值           | 說明                                                           |
| ----------------------------------- | ---------------- | -------------------------------------------------------------- |
| `PROBE_INGRESS_PORT`                | _未設定_（停用） | 傳入監聽器綁定的連接埠。任何 `> 0` 的值都會啟用入口。          |
| `PROBE_INGRESS_FORWARD_TIMEOUT_MS`  | `10000`          | 每次向 OneUptime 轉發嘗試的逾時時間（毫秒）。最小值為 `1000`。 |
| `PROBE_INGRESS_FORWARD_RETRY_LIMIT` | `3`              | 探針放棄某次轉發前的重試次數。設為 `0` 以停用重試。            |

標準的探針變數（`PROBE_KEY`、`PROBE_ID`、`ONEUPTIME_URL`、代理變數）全部適用——完整清單請參閱[自訂探針（Custom Probes）](/docs/probe/custom-probe)。

## 安全考量

- **此端點在設計上即為未驗證（unauthenticated）的** ——URL 路徑中的密鑰*就是*驗證方式，正如它在公開的 `oneuptime.com` 端點上一樣。請將密鑰視為一項憑證。
- **僅綁定到私有介面。** 入口監聽器不應從公開網際網路存取。請使用網路原則（network policy）、防火牆規則或 `ClusterIP` 服務來限制存取。
- **如果您需要傳輸過程中的加密，請使用 HTTPS 終止（termination）。** 探針的監聽器使用純 HTTP。如果您需要在傳入跳轉上使用 TLS，請將它置於內部負載平衡器／入口控制器（ingress controller）之後。從探針 → OneUptime 的轉發環節一律使用 HTTPS（前提是 `ONEUPTIME_URL` 為 `https://`）。
- **資源限制。** 此監聽器接受最大 50 MB 的請求主體。如果您需要更嚴格的上限，請在前方放置反向代理（reverse proxy）。

## 疑難排解

- **探針在啟動時記錄 `Probe ingress listener started on port <port>`** ——確認監聽器已啟動。如果您沒有看到這一行，表示 `PROBE_INGRESS_PORT` 未設定、為 `0` 或無效。
- **`Probe ingress: failed to forward to <url> after N attempts`** ——探針無法連線到 OneUptime。請檢查探針的對外連線能力、代理設定，以及 `ONEUPTIME_URL` 的值。
- **`Probe ingress: probe ID not available, forwarding without it`** ——探針尚未註冊。轉發仍會成功；只是該心跳不會歸屬於某個探針。
- **心跳出現在 OneUptime 中，但並非透過探針** ——請確認您的服務連線的是 `http://<probe-host>:<port>/...` 而非公開 URL。通常的原因是 DNS 或 `/etc/hosts` 項目設定錯誤。

## 相關內容

- [自訂探針（Custom Probes）](/docs/probe/custom-probe)
- [傳入請求監控（Incoming Request Monitor）](/docs/monitor/incoming-request-monitor)
