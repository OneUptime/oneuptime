# GitLab 整合

當 OneUptime 建立事件時，自動開立一個 [GitLab](https://gitlab.com) 議題（issue）——讓工程後續處理落在擁有受影響服務的專案中。

此整合為**對外（outbound）**：OneUptime 呼叫 [GitLab REST API](https://docs.gitlab.com/ee/api/issues.html)。它使用一個 OneUptime **[Workflow](/docs/workflows/index)**，搭配 **Incident → On Create** 觸發器與一個 **API 元件**。在 GitLab.com 與自行託管（self-managed）的 GitLab 上運作方式相同。

```text
OneUptime Incident → On Create  ──►  API component (POST /projects/{id}/issues)  ──►  GitLab issue
```

## 先決條件

- 一個 GitLab 專案及其 **Project ID**（顯示於專案總覽頁面、專案名稱下方）。
- 一個可建立議題的存取權杖——具備 `api` 範圍（scope）的 **Project**、**Group** 或 **Personal Access Token**：**Settings → Access Tokens**。
- 一個你可以建立工作流程的 OneUptime 專案。

## 步驟 1 — 儲存權杖

1. 前往 **Workflows → Global Variables → Create**。
2. 將其命名為 `GITLAB_TOKEN`、貼上權杖，並開啟 **Is Secret**。

## 步驟 2 — 建立工作流程

1. 開啟 **Workflows → Create Workflow**，將其命名為 `Incidents → GitLab Issues`，然後開啟 **Builder**。
2. 新增一個設定為 **On Create** 的 **Incident** 觸發器。將其重新命名為 `Incident`。
3. 新增一個連接到觸發器的 **API** 區塊：

   - **Method**：`POST`
   - **URL**：`https://gitlab.com/api/v4/projects/12345678/issues` _（將 `12345678` 替換為你的 Project ID；若為自行託管，請使用你自己的主機）_
   - **Headers**：

     ```text
     PRIVATE-TOKEN: {{variable.GITLAB_TOKEN}}
     Content-Type: application/json
     ```

   - **Body**：

     ```json
     {
       "title": "OneUptime incident: {{Incident.title}}",
       "description": "{{Incident.description}}\n\nFiled automatically from OneUptime.",
       "labels": "incident,oneuptime"
     }
     ```

4. **儲存**、啟用，並建立一個測試事件。工作流程記錄中出現 `201 Created` 即表示議題已建立；回應主體（response body）包含其 `iid` 與 `web_url`。

## 提示

- **自行託管的 GitLab**：將 `https://gitlab.com` 替換為你的執行個體 URL；`/api/v4/...` 路徑維持不變。
- **使用專案路徑而非 ID**：你可以將路徑進行 URL 編碼——例如 `group%2Fproject`——以取代數字 ID。
- **指派人 / 到期日**：在主體中加入 `"assignee_ids": [42]` 或 `"due_date": "2026-01-31"`。
- **回連**：讀取 `{{CreateIssue.response-body.web_url}}`，並透過 **Update Incident** 區塊將其儲存於事件上。

## 疑難排解

- **`401`** — 權杖無效或已過期，或缺少 `api` 範圍。
- **`404`** — Project ID 錯誤，或權杖無法存取私有專案。
- **`400`** — 缺少必填欄位或欄位格式不正確；`title` 為必填。

## 接下來閱讀

- [整合總覽](/docs/integrations/index) — 模式與驗證速查表。
- [GitHub](/docs/integrations/github) — 適用於 GitHub 的相同概念。
- [API 元件](/docs/workflows/components#api) — 讀取回應主體。
