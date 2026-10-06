# 将 OneUptime 连接到 Microsoft Teams

### 连接 OneUptime 到 Microsoft Teams 的步骤

1. **在 OneUptime 上创建账号**

   - 访问 [OneUptime.com](https://oneuptime.com) 并创建账号。
   - 创建账号后，创建一个新项目。

2. **将 Microsoft Teams 连接到 OneUptime 项目**

   - 在您的 OneUptime 项目中，导航至 **项目设置** > **Microsoft Teams**。
   - 按照提示将您的 Microsoft Teams 账号与 OneUptime 项目连接。

3. **配置事件通知**

   - 连接 Microsoft Teams 账号后，前往 **事件页面** > **Microsoft Teams**。
   - 添加规则以将事件通知发送到 Microsoft Teams。例如，您可以创建一条规则，当创建事件时向 Teams 频道发布消息。

4. **配置告警和计划维护通知**
   - 类似的规则也可以应用于告警和计划维护，方法是导航到各自的页面并配置所需规则。

## 测试规则

规则所在行的 **测试规则** 会把这条规则的一条测试消息发到它指定的频道，让你看到消息送达。如果规则会为每个事件创建频道，测试也会创建一个，并邀请规则中的人员加入。

和 **项目设置** > **Workspace** > **Microsoft Teams** 中频道旁边的 **发送测试** 一样，它需要创建通知规则的权限：**Project Owner**、**Project Admin**、**Project Member**、**Settings Admin**、**Settings Member**，或自定义角色中的 **Create Workspace Notification Rule**。只能查看规则的人（例如 **Viewer**）会被告知没有发送测试通知的权限。在 OneUptime Cloud 上，测试规则和添加规则一样需要 **Growth** 套餐。

## 自托管部署的网络访问

有关出站连接、入站回调和私有部署的说明，请参阅[Microsoft Teams 集成](/docs/self-hosted/microsoft-teams-integration)中的网络访问部分。
