# 自架部署指南

從上到下照著這個頁面操作，就能從一台空的伺服器走到你自己的 OneUptime：它在 HTTPS 上執行，已經寄給你一封測試郵件，並且能向你傳送告警。每一步都以如何確認它已生效作結，細節則連結到更長的頁面。

:::cards
- [安裝 OneUptime](#安裝-oneuptime): 在一台伺服器上用 Docker Compose，或在 Kubernetes 上用 Helm chart。
- [完成伺服器設定](#完成伺服器設定): 先是電子郵件，然後是簡訊和電話，每一項都附測試。
- [檢查你的安裝](#檢查你的安裝): 一個指令，指出哪裡有問題。
- [快速開始](/docs/introduction/quickstart): 你的第一個監控器、第一個值班政策和第一個狀態頁面。
:::

## 你需要什麼

- **一台伺服器。** 用 Docker Compose 試用 OneUptime，需要一台有 8 GB 記憶體、4 個核心和 20 GB 磁碟的 Linux 伺服器；團隊使用則需要 16 GB、8 個核心和 400 GB：請參閱[規模與容量規劃](/docs/installation/sizing)。用 Helm chart 則需要一個 Kubernetes 叢集。
- **一個網域名稱**，大家用它開啟 OneUptime，例如 `oneuptime.example.com`，並有一筆指向伺服器的 DNS `A` 記錄。你可以先用伺服器的 IP 位址開始，但 Let's Encrypt 的憑證需要網域名稱。
- **連接埠 80 和 443**，可從網際網路連線，用於 HTTPS。
- **一種寄送電子郵件的方式**：一台郵件伺服器，例如公司自己的、Microsoft 365 或 Google Workspace，或是 Amazon SES、SendGrid、Mailgun、Postmark 或 Resend 的帳號。
- **一個 Twilio 帳號**，用來透過簡訊和電話接收告警。電子郵件和推播通知不需要它。

**已生效的標誌：** `dig +short oneuptime.example.com` 輸出伺服器的 IP 位址。

## 安裝 OneUptime

:::tabs
@tab Docker Compose
在全新的 Ubuntu、Debian 或以 RHEL 為基礎的伺服器上，一個指令就能裝好缺少的 Docker、Git 和 Node.js，把 OneUptime 複製到 `oneuptime` 資料夾，詢問大家將使用的位址，並啟動它：

```bash
curl -fsSL https://oneuptime.com/install.sh | bash
```

要手動完成同樣的事，在裝好 Docker、Git 和 Node.js 後執行：

```bash
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime
cp config.example.env config.env
```

開啟 `config.env`，把它的第一項設定 `HOST` 設為你的網域名稱或 IP 位址，不要加上 `http://`。這是你唯一必須修改的設定：電子郵件、簡訊和電話在 Admin Dashboard 中設定，而 `ADVANCED` 以下的一切維持原樣就能運作。然後啟動 OneUptime：

```bash
npm start
```

**已生效的標誌：** `npm start` 以 **OneUptime is up!** 和要開啟的位址結束。第一次啟動需要幾分鐘，因為 Docker 要下載映像檔。如果 `npm start` 在此之前停下，它會說明需要修改什麼。[Docker Compose](/docs/installation/docker-compose) 中有全部細節。
@tab Kubernetes
建立一個 `values.yaml`，寫上你的網域名稱或 IP 位址，不要加上 `http://`：

```yaml title="values.yaml"
host: oneuptime.example.com
```

chart 把資料存放在叢集的預設儲存類別上。如果 `kubectl get storageclass` 沒有把任何一個標示為 `(default)`，就用其中一個的名稱加入 `global.storageClass`。然後安裝 chart：

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime -f values.yaml
```

**已生效的標誌：** `kubectl get pods` 顯示每個 Pod 都是 `Running`，而且 `helm install` 輸出的位址能開啟 OneUptime。[chart 的安裝指南](https://github.com/OneUptime/oneuptime/blob/main/HelmChart/Public/oneuptime/docs/installation.md)中有全部細節。
:::

## 開啟 HTTPS

網域名稱指向伺服器後，讓 OneUptime 從 Let's Encrypt 取得免費憑證。憑證也由它自己續期。

:::tabs
@tab Docker Compose
在 `config.env` 中設定這些值，然後再次執行 `npm start`：

```ini title="config.env"
HOST=oneuptime.example.com
PROVISION_SSL=true
HTTP_PROTOCOL=https
```

已經在用反向代理，例如 Caddy、Nginx 或負載平衡器？維持 `PROVISION_SSL=false`，設定 `HTTP_PROTOCOL=https` 和 `TRUSTED_PROXY_HOPS=2`，並參閱[使用你自己的反向代理](/docs/installation/docker-compose#使用你自己的反向代理)。
@tab Kubernetes
在 `values.yaml` 中設定這些值，然後套用它們：

```yaml title="values.yaml"
host: oneuptime.example.com
httpProtocol: https
ssl:
  provision: true
```

```bash
helm upgrade my-oneuptime oneuptime/oneuptime -f values.yaml
```

如果想改在你自己的 Ingress 控制器上終止 TLS，就讓 `ssl.provision` 保持關閉，只設定 `httpProtocol: https`。
:::

**已生效的標誌：** `https://oneuptime.example.com` 開啟時沒有憑證警告。第一張憑證通常幾分鐘內就會到位。在 `localhost` 上試用 OneUptime？跳過這一步：憑證需要網域名稱。

## 建立管理員帳號

開啟你的位址，例如 `https://oneuptime.example.com`，然後註冊。新伺服器上的第一個帳號會成為它的主要管理員，可以在 `/admin` 開啟 Admin Dashboard。

**已生效的標誌：** `/admin` 開啟 Admin Dashboard。在電子郵件、HTTPS 或關於註冊的選擇還沒完成時，它會開在 **完成此伺服器的設定** 上。

## 完成伺服器設定

Admin Dashboard 的 **伺服器設定** 頁面位於 `/admin/setup`，依重要程度列出新伺服器需要的東西。電子郵件、HTTPS 和誰可以註冊是必要的。簡訊和電話、一個全域探針、備份和更新檢查是建議的。每一項都有一個按鈕，開啟設定它的地方，而 `npm start` 最後會輸出這個頁面的位址。

:::steps
### 設定電子郵件

點擊 **設定電子郵件**。它會開啟 **設定 > 通知 > 電子郵件**，在那裡填寫你的郵件伺服器（大多使用連接埠 `587`）或電子郵件服務商，以及寄件位址。儲存後，點擊 **寄送測試郵件**，寄一封給自己。

**已生效的標誌：** 郵件送達，而且清單把電子郵件標示為已完成。測試失敗時，它會顯示郵件伺服器的回應：請參閱 [SMTP](/docs/emails/smtp#疑難排解)。

### 選擇誰可以註冊

任何能開啟你的位址的人都可以註冊。等團隊的帳號都建立好後，在 **設定 > 驗證** 中關閉 **允許註冊**：你邀請到專案裡的人仍然可以加入。要保持開放註冊，點擊 **保持開放註冊**。

**已生效的標誌：** 清單把註冊標示為已完成。

### 設定簡訊和電話，或只用電子郵件和推播

要透過簡訊和電話接收告警，點擊 **設定簡訊和電話**，並在 **設定 > 通知 > 電話和簡訊** 中加入你的 Twilio 帳號：[Twilio 整合](/docs/self-hosted/twilio-integration)說明了每個值在哪裡找。然後點擊 **傳送測試簡訊** 和 **撥打測試電話**。如果想改用你自己的閘道傳送，請參閱[簡訊與電話閘道](/docs/self-hosted/sms-and-call-gateway)。如果電子郵件和推播通知就夠了，點擊 **只用電子郵件和推播**。

**已生效的標誌：** 簡訊送達、電話響起，或者清單顯示了你的選擇。
:::

[開啟 HTTPS](#開啟-https) 生效後，HTTPS 一項就完成了，而每個建議項目都會說明要做什麼。

## 檢查你的安裝

:::tabs
@tab Docker Compose
在 `oneuptime` 資料夾中執行 doctor：

```bash
npm run doctor
```

它會檢查每個容器、`config.env`、`HOST` 能否連到這台伺服器、憑證和剩餘磁碟，並詢問 OneUptime 它看到的自身狀態，例如電子郵件和探針。每個問題都附帶修正方法：請參閱[檢查你的安裝](/docs/installation/docker-compose#檢查你的安裝)。
@tab Kubernetes
依 [chart 的疑難排解指南](https://github.com/OneUptime/oneuptime/blob/main/HelmChart/Public/oneuptime/docs/troubleshooting.md#run-it)中的步驟，針對你的叢集執行 chart 的診斷指令碼。它只讀取，最後依嚴重程度列出它發現的問題摘要。
:::

**已生效的標誌：** doctor 以 **Everything looks right.** 結束，並以 `0` 結束執行。有需要修正的問題時以 `1` 結束，無法執行檢查時以 `2` 結束。在 Kubernetes 上，摘要中沒有任何 `CRITICAL` 發現。

## 監控些什麼並接收告警

現在你的伺服器可以寄送電子郵件並向大家傳送告警了。[快速開始](/docs/introduction/quickstart)在產品中繼續：一個監控你網站的監控器，一個在網站停擺時向你告警的值班政策，以及一個狀態頁面，大約十五分鐘完成。它的最後一部分會宣告一次測試事件，讓你看到告警送達。

## 疑難排解

:::details npm start 停止並提示 HOST 還不是一個位址
`config.env` 中的 `HOST` 仍然是一個預留位置，例如 `<your-address>`。把它設為你的網域名稱或 IP 位址，不要加上 `http://`，然後再次執行 `npm start`。
:::

:::details 測試郵件失敗
按鈕下方的訊息就是郵件伺服器的回應。檢查主機名稱、連接埠、使用者名稱和密碼，以及郵件伺服器是否允許你從寄件位址寄送。請參閱 [SMTP](/docs/emails/smtp#疑難排解)。
:::

:::details 瀏覽器對憑證發出警告
Let's Encrypt 需要能從網際網路連線的連接埠 80 和 443，以及指向這台伺服器的網域名稱。等幾分鐘，然後執行 `npm run doctor`：它會檢查憑證並說明哪裡有問題。
:::

## 後續步驟

:::cards
- [快速開始](/docs/introduction/quickstart): 十五分鐘內建好一個監控器、一個值班政策和一個狀態頁面。
- [Docker Compose](/docs/installation/docker-compose): 你自己的代理、備份、更新和正式環境清單。
- [升級](/docs/installation/upgrading): 升級到新版本，一次只升一個主要版本。
- [架構](/docs/self-hosted/architecture): OneUptime 的各部分如何協同運作。
:::
