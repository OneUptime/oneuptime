# GitLab 集成

每当创建 OneUptime 事件时，自动创建一个 [GitLab](https://gitlab.com) issue——让工程跟进工作落在拥有受影响服务的项目中。

此集成为**出站**模式：OneUptime 调用 [GitLab REST API](https://docs.gitlab.com/ee/api/issues.html)。它使用带有 **Incident → On Create** 触发器和 **API 组件**的 OneUptime **[工作流](/docs/workflows/index)**。在 GitLab.com 和自托管 GitLab 上的操作方式完全相同。

```text
OneUptime Incident → On Create  ──►  API component (POST /projects/{id}/issues)  ──►  GitLab issue
```

## 前提条件

- 一个 GitLab 项目及其**项目 ID**（显示在项目概览页面的项目名称下方）。
- 一个可以创建 issue 的访问令牌——具有 `api` 范围的**项目**、**群组**或**个人访问令牌**：**Settings → Access Tokens**。
- 一个可以创建工作流的 OneUptime 项目。

## 步骤 1——存储令牌

1. 前往 **Workflows → Global Variables → Create**。
2. 命名为 `GITLAB_TOKEN`，粘贴令牌，并开启 **Is Secret**。

## 步骤 2——构建工作流

1. 打开 **Workflows → Create Workflow**，命名为 `Incidents → GitLab Issues`，并打开 **Builder**。
2. 添加 **Incident** 触发器，设置为 **On Create**。重命名为 `Incident`。
3. 添加连接到触发器的 **API** 模块：
   - **Method**：`POST`
   - **URL**：`https://gitlab.com/api/v4/projects/12345678/issues`  *（将 `12345678` 替换为你的项目 ID；自托管实例请使用你自己的主机地址）*
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

4. **保存**，启用，并创建一个测试事件。工作流日志中出现 `201 Created` 表示 issue 已创建；响应体包含其 `iid` 和 `web_url`。

## 提示

- **自托管 GitLab**：将 `https://gitlab.com` 替换为你的实例 URL；`/api/v4/...` 路径保持不变。
- **使用路径代替 ID**：你可以使用 URL 编码的路径——例如 `group%2Fproject`——代替数字 ID。
- **指派人 / 截止日期**：在正文中添加 `"assignee_ids": [42]` 或 `"due_date": "2026-01-31"`。
- **链接回事件**：读取 `{{CreateIssue.response-body.web_url}}`，并用 **Update Incident** 模块将其存储到事件上。

## 故障排查

- **`401`**——令牌无效或已过期，或缺少 `api` 范围。
- **`404`**——项目 ID 错误，或令牌无法访问私有项目。
- **`400`**——某个必填字段缺失或格式错误；`title` 是必填字段。

## 接下来读什么

- [集成概览](/docs/integrations/index)——模式和认证速查表。
- [GitHub](/docs/integrations/github)——适用于 GitHub 的相同思路。
- [API 组件](/docs/workflows/components#api)——读取响应体。
