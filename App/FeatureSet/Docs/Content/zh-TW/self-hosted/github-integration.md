# GitHub 整合

若要將 GitHub 與您自架的 OneUptime 執行個體整合，您需要建立一個 GitHub App 並設定所需的環境變數。這可讓 OneUptime 連線到您的 GitHub 儲存庫以進行程式碼儲存庫管理。

## 先決條件

- 具有組織管理員存取權的 GitHub 帳戶（用於組織儲存庫）或個人帳戶存取權
- 具有您 OneUptime 伺服器設定的存取權

## 設定說明

### 步驟 1：建立 GitHub App

1. 前往 GitHub 並導覽至您的組織或個人設定：

   - **針對組織：** 前往 `https://github.com/organizations/YOUR_ORG/settings/apps`
   - **針對個人帳戶：** 前往 `https://github.com/settings/apps`

2. 點選 **「New GitHub App」**

3. 填寫註冊表單：
   - **GitHub App name：** OneUptime（或任何唯一的名稱）- **請儲存此名稱，您將需要它來設定 `GITHUB_APP_NAME` 環境變數**
   - **Homepage URL：** `https://your-oneuptime-domain.com`
   - **Callback URL：** `https://your-oneuptime-domain.com/api/github/auth/callback`
   - **Setup URL：** `https://your-oneuptime-domain.com/api/github/auth/callback` - **重要：此 URL 是 GitHub 在使用者安裝 App 後重新導向使用者的位置。必須設定此項，重新導向才能運作。**
   - **Redirect on update：** 勾選此選項，以在使用者更新 App 安裝後重新導向使用者
   - **Webhook URL：** `https://your-oneuptime-domain.com/api/github/webhook`
   - **Webhook secret：** 產生一個安全的隨機字串（請儲存此項以供稍後使用）

### 步驟 2：設定 App 權限

在「Permissions & events」區段中，設定下列權限：

**儲存庫權限：**

| 權限            | 存取層級     | 用途                                      |
| --------------- | ------------ | ----------------------------------------- |
| Contents        | Read & Write | 讀取儲存庫檔案、推送分支（AI Agent 所需） |
| Pull requests   | Read & Write | 建立並管理拉取請求                        |
| Issues          | Read & Write | 讀取與回覆問題                            |
| Commit statuses | Read         | 檢查建置/CI 狀態                          |
| Actions         | Read         | 讀取 GitHub Actions 工作流程執行與記錄    |
| Metadata        | Read         | 基本儲存庫中繼資料（必要）                |

**組織權限（若搭配組織使用）：**

| 權限    | 存取層級 | 用途         |
| ------- | -------- | ------------ |
| Members | Read     | 列出組織成員 |

**帳戶權限：**

| 權限            | 存取層級 | 用途                         |
| --------------- | -------- | ---------------------------- |
| Email addresses | Read     | 讀取使用者電子郵件以進行通知 |

### 步驟 3：訂閱 Webhook 事件

為了讓 OneUptime 接收即時更新，請訂閱下列 Webhook 事件：

- **Pull request** - 在 PR 開啟、關閉或合併時接收通知
- **Push** - 在推送程式碼時接收通知
- **Workflow run** - 接收 CI/CD 狀態更新

### 步驟 4：設定安裝存取權

在「Where can this GitHub App be installed?」下，選擇：

- **Only on this account** - 用於私人/內部使用
- **Any account** - 若您希望其他人安裝您的 App

### 步驟 5：建立 GitHub App

1. 點選 **「Create GitHub App」**
2. 您將被重新導向至您 App 的設定頁面
3. 記下下列值：
   - **App ID** - 位於 App 設定頁面的頂部
   - **Client ID** - 位於「About」區段中

### 步驟 6：產生 Client Secret

1. 在您的 GitHub App 設定中，捲動至「Client secrets」
2. 點選 **「Generate a new client secret」**
3. 立即複製該 secret - 您將無法再次看到它

### 步驟 7：產生私密金鑰

1. 向下捲動至「Private keys」區段
2. 點選 **「Generate a private key」**
3. 系統將自動下載一個 `.pem` 檔案
4. 妥善保管此檔案 - 它用於以 GitHub App 身分進行驗證

### 步驟 8：設定 OneUptime 環境變數

#### Docker Compose

若您使用 Docker Compose，請將這些環境變數加入您的 `config.env` 檔案：

```bash
# GitHub App Configuration
GITHUB_APP_ID=YOUR_APP_ID
GITHUB_APP_NAME=YOUR_APP_NAME  # The exact name of your GitHub App (e.g., "OneUptime")
GITHUB_APP_CLIENT_ID=YOUR_CLIENT_ID
GITHUB_APP_CLIENT_SECRET=YOUR_CLIENT_SECRET
GITHUB_APP_PRIVATE_KEY="<BASE64_ENCODED_PRIVATE_KEY_CONTENT>"
GITHUB_APP_WEBHOOK_SECRET=YOUR_WEBHOOK_SECRET
```

**注意：** 若您的環境不支援多行字串，請將私密金鑰編碼為 base64 並在不含換行的情況下貼上。

#### 搭配 Helm 的 Kubernetes

若您使用搭配 Helm 的 Kubernetes，請將這些加入您的 `values.yaml` 檔案：

```yaml
gitHubApp:
  id: "YOUR_APP_ID"
  name: "YOUR_APP_NAME" # The exact name of your GitHub App
  clientId: "YOUR_CLIENT_ID"
  clientSecret: "YOUR_CLIENT_SECRET"
  privateKey: "<BASE64_ENCODED_PRIVATE_KEY_CONTENT>"
  webhookSecret: "YOUR_WEBHOOK_SECRET"
```

**重要：** 加入這些環境變數後，請重新啟動您的 OneUptime 伺服器，使其生效。

### 步驟 9：安裝 GitHub App

1. 前往您 GitHub App 的公開頁面：`https://github.com/apps/YOUR_APP_NAME`
2. 點選 **「Install」** 或 **「Configure」**
3. 選取您要安裝 App 的組織或帳戶
4. 選擇 App 可存取哪些儲存庫：
   - **All repositories** - 存取所有目前與未來的儲存庫
   - **Only select repositories** - 選擇特定的儲存庫
5. 點選 **「Install」**

### 步驟 10：在 OneUptime 中連接儲存庫

1. 登入您的 OneUptime 儀表板
2. 導覽至 **More** > **Code Repositories**
3. 點選 **「Create Repository」** 或使用 GitHub App 安裝流程
4. 若從 GitHub 重新導向而來，系統將自動擷取安裝 ID
5. 從清單中選取您要連接的儲存庫
6. 點選 **「Connect」** 以將儲存庫連結至您的 OneUptime 專案

## 環境變數參考

| 變數                        | 說明                                     | 必要             |
| --------------------------- | ---------------------------------------- | ---------------- |
| `GITHUB_APP_ID`             | 來自您 GitHub App 設定的 App ID          | 是               |
| `GITHUB_APP_NAME`           | 您 GitHub App 的確切名稱（用於安裝 URL） | 是               |
| `GITHUB_APP_CLIENT_ID`      | 來自您 GitHub App 設定的 Client ID       | 是               |
| `GITHUB_APP_CLIENT_SECRET`  | 您產生的 client secret                   | 是               |
| `GITHUB_APP_PRIVATE_KEY`    | 私密金鑰（.pem 檔案）的內容              | 是               |
| `GITHUB_APP_WEBHOOK_SECRET` | 用於驗證 webhook 酬載的 webhook secret   | 否（但建議設定） |

## 疑難排解

### 常見問題

**安裝 GitHub App 後未重新導向回 OneUptime：**

- 請確定您 GitHub App 設定中的 **Setup URL** 設定為：`https://your-oneuptime-domain.com/api/github/auth/callback`
- 前往您的 GitHub App 設定 >「Post installation」區段，並確認 Setup URL 設定正確
- 也應勾選「Redirect on update」選項
- 注意：Setup URL 與 Callback URL 不同 - 兩者都應指向相同的 `/api/github/auth/callback` 端點

**「GitHub App is not configured」錯誤：**

- 請確定已設定 `GITHUB_APP_CLIENT_ID` 環境變數
- 設定環境變數後，請重新啟動您的 OneUptime 伺服器

**「Invalid webhook signature」錯誤：**

- 請驗證您的 `GITHUB_APP_WEBHOOK_SECRET` 與 GitHub 中設定的 secret 相符
- 請確定 webhook URL 正確且可從網際網路存取

**「Failed to get installation access token」錯誤：**

- 請驗證您的 `GITHUB_APP_PRIVATE_KEY` 格式正確
- 請檢查私密金鑰是否包含 BEGIN/END 標記
- 請確定 App ID 正確

**安裝後看不到儲存庫：**

- 請驗證 GitHub App 是否具有您要連接的儲存庫的存取權
- 請檢查 GitHub 中的安裝權限（Settings > Applications > Installed GitHub Apps）

**未收到 Webhook 事件：**

- 請確定您的 webhook URL 可公開存取
- 請檢查您 App 設定中的 GitHub App webhook 傳遞記錄
- 請驗證 webhook secret 是否設定正確

### 檢查 Webhook 傳遞

1. 前往您的 GitHub App 設定
2. 點選側邊欄中的「Advanced」
3. 檢視「Recent Deliveries」以查看 webhook 嘗試與回應

## 安全性最佳做法

1. **定期輪換 secret** - 定期產生新的 client secret 與私密金鑰
2. **使用 webhook secret** - 務必設定 webhook secret 以驗證酬載的真實性
3. **限制儲存庫存取權** - 僅授予需要連接之儲存庫的存取權
4. **監控 webhook 傳遞** - 定期檢查失敗的傳遞或可疑活動
5. **妥善保管私密金鑰** - 切勿將私密金鑰提交至版本控制

## 支援

若您在 GitHub 整合方面遇到問題，請：

1. 查看上方的疑難排解區段
2. 檢閱 OneUptime 記錄以取得詳細的錯誤訊息
3. 透過 [hello@oneuptime.com](mailto:hello@oneuptime.com) 與我們聯絡

我們歡迎您提供意見回饋以改善此整合！
