# GitHub 整合

當 OneUptime 事件被建立時，自動開立一個 [GitHub](https://github.com) issue — 讓工程後續處理在擁有受影響服務的儲存庫中被追蹤。

此整合為**對外（outbound）**：OneUptime 會呼叫 [GitHub REST API](https://docs.github.com/en/rest/issues/issues)。它使用 OneUptime 的 **[Workflow](/docs/workflows/index)**，搭配 **Incident → On Create** 觸發器與一個 **API component**。

> **想要更深層的 GitHub 連線嗎？** OneUptime 也有原生的 **GitHub App** 整合，用於連接程式碼儲存庫（供 AI agent 與程式碼功能使用）。那是透過環境變數設定，而非 workflows — 請參閱 [GitHub Integration (self-hosted)](/docs/self-hosted/github-integration)。本頁專門說明*從事件開立 issue*。

```text
OneUptime Incident → On Create  ──►  API component (POST /repos/{owner}/{repo}/issues)  ──►  GitHub issue
```

## 先決條件

- 一個你想要開立 issue 的 GitHub 儲存庫。
- 一個可以建立 issue 的權杖（token）：
  - 範圍限定於該儲存庫並具備 **Issues: Read and write** 的 **Fine-grained PAT**，或
  - 具備 `repo` scope 的 **classic PAT**。

  於 [github.com/settings/tokens](https://github.com/settings/tokens) 建立一個。
- 一個你可以建立 workflows 的 OneUptime 專案。

## 步驟 1 — 儲存權杖

1. 前往 **Workflows → Global Variables → Create**。
2. 將它命名為 `GITHUB_TOKEN`，貼上權杖，並開啟 **Is Secret**。

## 步驟 2 — 建立 workflow

1. 開啟 **Workflows → Create Workflow**，將它命名為 `Incidents → GitHub Issues`，並開啟 **Builder**。
2. 新增一個設定為 **On Create** 的 **Incident** 觸發器。將它重新命名為 `Incident`。
3. 新增一個連接到觸發器的 **API** 區塊：
   - **Method**：`POST`
   - **URL**：`https://api.github.com/repos/your-org/your-repo/issues`
   - **Headers**：

     ```text
     Authorization: Bearer {{variable.GITHUB_TOKEN}}
     Accept: application/vnd.github+json
     X-GitHub-Api-Version: 2022-11-28
     User-Agent: OneUptime
     ```

   - **Body**：

     ```json
     {
       "title": "OneUptime incident: {{Incident.title}}",
       "body": "{{Incident.description}}\n\nFiled automatically from OneUptime.",
       "labels": ["incident", "oneuptime"]
     }
     ```

4. **儲存**、啟用，並建立一個測試事件。workflow 記錄中出現 `201 Created` 即表示 issue 已建立；回應主體會包含其 `number` 與 `html_url`。

## 提示

- **GitHub Enterprise Server**：使用 `https://your-host/api/v3/repos/{owner}/{repo}/issues`。
- **指派對象（Assignees）/ 里程碑（milestone）**：在主體中加入 `"assignees": ["octocat"]` 或 `"milestone": 3`。
- **回連（Link back）**：讀取 `{{CreateIssue.response-body.html_url}}` 並以 **Update Incident** 區塊將它儲存在事件上。

## 疑難排解

- **`401`** — 權杖錯誤或已過期。Fine-grained 權杖必須明確授予該儲存庫與 **Issues** 權限。
- **`403` / 速率限制（rate limit）** — 加入 `User-Agent` 標頭（GitHub 會拒絕沒有此標頭的請求），並檢查你是否未被速率限制。
- **`404`** — `owner/repo` 路徑錯誤，或權杖無法看到私有儲存庫。
- **`422`** — 不存在的標籤是可以的（GitHub 會建立被引用的標籤），但格式錯誤的主體則不行 — 請檢查你的 JSON。

## 接下來該讀什麼

- [Integrations Overview](/docs/integrations/index) — 模式與驗證速查表。
- [GitLab](/docs/integrations/gitlab) — 適用於 GitLab 的相同概念。
- [GitHub Integration (self-hosted)](/docs/self-hosted/github-integration) — 原生的 GitHub App 連線。
