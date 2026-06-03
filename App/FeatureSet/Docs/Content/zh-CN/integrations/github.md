# GitHub 集成

每当创建 OneUptime 事件时，自动创建一个 [GitHub](https://github.com) issue——让工程跟进工作在拥有受影响服务的仓库中得到追踪。

此集成为**出站**模式：OneUptime 调用 [GitHub REST API](https://docs.github.com/en/rest/issues/issues)。它使用带有 **Incident → On Create** 触发器和 **API 组件**的 OneUptime **[工作流](/docs/workflows/index)**。

> **寻找更深层的 GitHub 连接？** OneUptime 还有一个原生 **GitHub App** 集成，用于连接代码仓库（供 AI 代理和代码功能使用）。该集成通过环境变量配置，而不是工作流——参见 [GitHub 集成（自托管）](/docs/self-hosted/github-integration)。本页专门介绍*从事件创建 issue*。

```text
OneUptime Incident → On Create  ──►  API component (POST /repos/{owner}/{repo}/issues)  ──►  GitHub issue
```

## 前提条件

- 一个你想要提交 issue 的 GitHub 仓库。
- 一个可以创建 issue 的令牌：
  - **细粒度 PAT**，作用域限定到该仓库，具备 **Issues: Read and write** 权限，或
  - 具有 `repo` 范围的**经典 PAT**。

  在 [github.com/settings/tokens](https://github.com/settings/tokens) 创建。
- 一个可以创建工作流的 OneUptime 项目。

## 步骤 1——存储令牌

1. 前往 **Workflows → Global Variables → Create**。
2. 命名为 `GITHUB_TOKEN`，粘贴令牌，并开启 **Is Secret**。

## 步骤 2——构建工作流

1. 打开 **Workflows → Create Workflow**，命名为 `Incidents → GitHub Issues`，并打开 **Builder**。
2. 添加 **Incident** 触发器，设置为 **On Create**。重命名为 `Incident`。
3. 添加连接到触发器的 **API** 模块：
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

4. **保存**，启用，并创建一个测试事件。工作流日志中出现 `201 Created` 表示 issue 已创建；响应体包含其 `number` 和 `html_url`。

## 提示

- **GitHub Enterprise Server**：使用 `https://your-host/api/v3/repos/{owner}/{repo}/issues`。
- **指派人 / 里程碑**：在正文中添加 `"assignees": ["octocat"]` 或 `"milestone": 3`。
- **链接回事件**：读取 `{{CreateIssue.response-body.html_url}}`，并用 **Update Incident** 模块将其存储到事件上。

## 故障排查

- **`401`**——令牌错误或已过期。细粒度令牌必须明确授予仓库和 **Issues** 权限。
- **`403` / 速率限制**——包含 `User-Agent` 头部（GitHub 会拒绝没有该头部的请求），并检查是否超出速率限制。
- **`404`**——`owner/repo` 路径错误，或令牌无法访问私有仓库。
- **`422`**——引用不存在的标签是没问题的（GitHub 会创建引用的标签），但格式错误的正文不行——检查你的 JSON。

## 接下来读什么

- [集成概览](/docs/integrations/index)——模式和认证速查表。
- [GitLab](/docs/integrations/gitlab)——适用于 GitLab 的相同思路。
- [GitHub 集成（自托管）](/docs/self-hosted/github-integration)——原生 GitHub App 连接。
