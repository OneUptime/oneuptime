# GitHub 集成

要將 GitHub 與您的自託管 OneUptime 實例集成，您需要創建一個 GitHub App 並配置所需的環境變量。這允許 OneUptime 連接到您的 GitHub 代碼倉庫進行代碼庫管理。

## 前提條件

- 具有組織管理員訪問權限的 GitHub 賬號（用於組織代碼倉庫）或個人賬號訪問權限
- 訪問您的 OneUptime 服務器配置

## 設置說明

### 第一步：創建 GitHub App

1. 前往 GitHub 並導航到您的組織或個人設置：
   - **對於組織：** 前往 `https://github.com/organizations/YOUR_ORG/settings/apps`
   - **對於個人賬號：** 前往 `https://github.com/settings/apps`

2. 點擊 **"New GitHub App"**

3. 填寫註冊表單：
   - **GitHub App 名稱：** OneUptime（或任何唯一名稱） - **保存此名稱，您將需要它作爲 `GITHUB_APP_NAME` 環境變量**
   - **主頁 URL：** `https://your-oneuptime-domain.com`
   - **回調 URL：** `https://your-oneuptime-domain.com/api/github/auth/callback`
   - **設置 URL：** `https://your-oneuptime-domain.com/api/github/auth/callback` - **重要提示：這是 GitHub 在用戶安裝應用後重定向用戶的 URL。必須設置此 URL，重定向才能正常工作。**
   - **更新時重定向：** 選中此選項，以在用戶更新應用安裝後重定向用戶
   - **Webhook URL：** `https://your-oneuptime-domain.com/api/github/webhook`
   - **Webhook 密鑰：** 生成一個安全的隨機字符串（稍後保存）

### 第二步：配置應用權限

在"權限與事件"部分，配置以下權限：

**代碼倉庫權限：**

| 權限 | 訪問級別 | 用途 |
|------|---------|------|
| Contents | 讀寫 | 讀取倉庫文件，推送分支（AI Agent 必需） |
| Pull requests | 讀寫 | 創建和管理 Pull Request |
| Issues | 讀寫 | 讀取 Issue 並發表評論 |
| Commit statuses | 讀取 | 檢查構建/CI 狀態 |
| Actions | 讀取 | 讀取 GitHub Actions 工作流運行和日誌 |
| Metadata | 讀取 | 基本倉庫元數據（必需） |

**組織權限（與組織一起使用時）：**

| 權限 | 訪問級別 | 用途 |
|------|---------|------|
| Members | 讀取 | 列出組織成員 |

**賬號權限：**

| 權限 | 訪問級別 | 用途 |
|------|---------|------|
| Email addresses | 讀取 | 讀取用戶電郵以發送通知 |

### 第三步：訂閱 Webhook 事件

OneUptime 接收實時更新的事件，訂閱以下 Webhook 事件：

- **Pull request** - 當 PR 被打開、關閉或合併時接收通知
- **Push** - 當代碼被推送時接收通知
- **Workflow run** - 接收 CI/CD 狀態更新

### 第四步：設置安裝訪問權限

在"此 GitHub App 可以安裝在哪裏？"下，選擇：
- **僅限此賬號** - 用於私有/內部使用
- **任何賬號** - 如果您希望其他人安裝您的應用

### 第五步：創建 GitHub App

1. 點擊 **"Create GitHub App"**
2. 您將被重定向到應用的設置頁面
3. 記錄以下值：
   - **App ID** - 在應用設置頁面頂部找到
   - **Client ID** - 在"關於"部分找到

### 第六步：生成客戶端密鑰

1. 在您的 GitHub App 設置中，滾動到"Client secrets"
2. 點擊 **"Generate a new client secret"**
3. 立即複製密鑰——之後將無法再次查看

### 第七步：生成私鑰

1. 向下滾動到"Private keys"部分
2. 點擊 **"Generate a private key"**
3. 將自動下載一個 `.pem` 文件
4. 安全保存此文件——它用於以 GitHub App 身份進行認證

### 第八步：配置 OneUptime 環境變量

#### Docker Compose

如果您使用 Docker Compose，請將這些環境變量添加到您的 `config.env` 文件中：

```bash
# GitHub App 配置
GITHUB_APP_ID=YOUR_APP_ID
GITHUB_APP_NAME=YOUR_APP_NAME  # 您的 GitHub App 的確切名稱（例如"OneUptime"）
GITHUB_APP_CLIENT_ID=YOUR_CLIENT_ID
GITHUB_APP_CLIENT_SECRET=YOUR_CLIENT_SECRET
GITHUB_APP_PRIVATE_KEY="<BASE64_ENCODED_PRIVATE_KEY_CONTENT>"
GITHUB_APP_WEBHOOK_SECRET=YOUR_WEBHOOK_SECRET
```

**注意：** 對於私鑰，如果您的環境不支持多行字符串，請將其編碼爲 base64 並粘貼時不帶換行符。

#### Kubernetes with Helm

如果您使用 Kubernetes with Helm，請將這些添加到您的 `values.yaml` 文件中：

```yaml
gitHubApp:
  id: "YOUR_APP_ID"
  name: "YOUR_APP_NAME"  # 您的 GitHub App 的確切名稱
  clientId: "YOUR_CLIENT_ID"
  clientSecret: "YOUR_CLIENT_SECRET"
  privateKey: "<BASE64_ENCODED_PRIVATE_KEY_CONTENT>"
  webhookSecret: "YOUR_WEBHOOK_SECRET"
```

**重要提示：** 添加這些環境變量後重啓您的 OneUptime 服務器以使其生效。

### 第九步：安裝 GitHub App

1. 前往您的 GitHub App 公共頁面：`https://github.com/apps/YOUR_APP_NAME`
2. 點擊 **"Install"** 或 **"Configure"**
3. 選擇您要安裝應用的組織或賬號
4. 選擇應用可以訪問哪些代碼倉庫：
   - **所有代碼倉庫** - 訪問所有當前和未來的代碼倉庫
   - **僅選定的代碼倉庫** - 選擇特定的代碼倉庫
5. 點擊 **"Install"**

### 第十步：在 OneUptime 中連接代碼倉庫

1. 登錄您的 OneUptime 控制台
2. 導航至 **更多** > **代碼倉庫**
3. 點擊 **"創建代碼倉庫"** 或使用 GitHub App 安裝流程
4. 如果從 GitHub 重定向，安裝 ID 將自動捕獲
5. 從列表中選擇您要連接的代碼倉庫
6. 點擊 **"連接"** 將代碼倉庫鏈接到您的 OneUptime 項目

## 環境變量參考

| 變量 | 描述 | 是否必填 |
|------|------|---------|
| `GITHUB_APP_ID` | 來自您 GitHub App 設置的 App ID | 是 |
| `GITHUB_APP_NAME` | 您的 GitHub App 的確切名稱（用於安裝 URL） | 是 |
| `GITHUB_APP_CLIENT_ID` | 來自您 GitHub App 設置的 Client ID | 是 |
| `GITHUB_APP_CLIENT_SECRET` | 您生成的客戶端密鑰 | 是 |
| `GITHUB_APP_PRIVATE_KEY` | 私鑰（.pem 文件）的內容 | 是 |
| `GITHUB_APP_WEBHOOK_SECRET` | 用於驗證 Webhook 負載的 Webhook 密鑰 | 否（但推薦） |

## 故障排查

### 常見問題

**安裝 GitHub App 後未重定向回 OneUptime：**
- 確保在 GitHub App 設置中將 **Setup URL** 配置爲：`https://your-oneuptime-domain.com/api/github/auth/callback`
- 前往您的 GitHub App 設置 > "安裝後"部分，驗證 Setup URL 是否正確設置
- 還應勾選"更新時重定向"選項
- 注意：Setup URL 與 Callback URL 不同——兩者都應指向相同的 `/api/github/auth/callback` 端點

**"GitHub App is not configured"錯誤：**
- 確保設置了 `GITHUB_APP_CLIENT_ID` 環境變量
- 設置環境變量後重啓 OneUptime 服務器

**"Invalid webhook signature"錯誤：**
- 驗證您的 `GITHUB_APP_WEBHOOK_SECRET` 與 GitHub 中配置的密鑰是否匹配
- 確保 Webhook URL 正確且可從互聯網訪問

**"Failed to get installation access token"錯誤：**
- 驗證您的 `GITHUB_APP_PRIVATE_KEY` 格式是否正確
- 檢查私鑰是否包含 BEGIN/END 標記
- 確保 App ID 正確

**安裝後看不到代碼倉庫：**
- 驗證 GitHub App 是否有權訪問您要連接的代碼倉庫
- 檢查 GitHub 中的安裝權限（設置 > 應用程序 > 已安裝的 GitHub 應用）

**未收到 Webhook 事件：**
- 確保您的 Webhook URL 可公開訪問
- 在應用設置中檢查 GitHub App Webhook 傳送日誌
- 驗證 Webhook 密鑰是否正確配置

### 檢查 Webhook 傳送記錄

1. 前往您的 GitHub App 設置
2. 點擊側邊欄中的"Advanced"
3. 查看"Recent Deliveries"以查看 Webhook 嘗試和響應

## 安全最佳實踐

1. **定期輪換密鑰** - 定期生成新的客戶端密鑰和私鑰
2. **使用 Webhook 密鑰** - 始終配置 Webhook 密鑰以驗證負載真實性
3. **限制代碼倉庫訪問** - 僅授予需要連接的代碼倉庫的訪問權限
4. **監控 Webhook 傳送** - 定期檢查失敗的傳送或可疑活動
5. **安全保存私鑰** - 切勿將私鑰提交到版本控制系統

## 支持

如果您在 GitHub 集成方面遇到問題，請：

1. 查看上方的故障排查部分
2. 查看 OneUptime 日誌以獲取詳細錯誤消息
3. 通過 [hello@oneuptime.com](mailto:hello@oneuptime.com) 聯繫我們

我們歡迎您的反饋以改進此集成！
