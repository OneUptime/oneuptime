# 权限参考

OneUptime 可以授予的所有角色和权限，按照仪表板中权限选择器的方式分组。使用本页查找要授予团队、API 密钥或 Terraform 资源的确切名称或键。

这些表格在页面提供时根据 OneUptime 源代码生成：与仪表板、API 和 Terraform 提供程序使用的是同一份列表，因此始终与您运行的版本一致。要了解权限如何组合在一起（团队、范围、所有者和阻止），请先阅读 [用户、团队与权限](/docs/permissions/index)。

## 如何阅读这些表格

每个角色和权限都有一行，包含以下列：

- **角色** 或 **权限**：仪表板中显示的名称。
- **权限键**：在 [API](/docs/api-reference/api-reference)、[CLI](/docs/cli/index) 和 [Terraform 提供程序](/docs/terraform/index) 中使用的值。
- **范围**（仅角色）：`全部、拥有或标签` 表示授予该角色时由您选择其作用范围。`仅限整个项目` 表示该角色始终作用于整个项目。
- **按标签限制**（仅权限）：`是` 表示该权限的授予可以限定为带有特定标签的资源。
- **说明**：该角色或权限允许执行的操作。

> [!TIP]
> 优先选择角色。OneUptime 增加新功能时，角色会保持正确，而单个权限的列表需要手动保持更新。

## 角色

共 {{PERMISSION_ROLE_COUNT}} 个角色。其中 Project Owner、Project Admin、Project Member 和 Viewer 这四个角色作用于整个项目。其余每个角色都在 Admin、Member 或 Viewer 级别覆盖一个产品领域，例如事件或监视器。团队的 **权限** 页面和 API 密钥页面上的 **添加角色** 提供的就是这些角色。

{{PERMISSION_ROLE_TABLES}}

## 细粒度权限

{{PERMISSION_GROUP_COUNT}} 个分组中的 {{PERMISSION_TOTAL_COUNT}} 项单独功能。当角色的范围超出所需时，为团队或 API 密钥提供的 **添加权限** 列出的就是这些权限。

{{PERMISSION_GRANULAR_TABLES}}

## 后续步骤

:::cards
- [用户、团队与权限](/docs/permissions/index): 团队、范围、所有者和阻止如何决定一个人能做什么。
- [API 参考](/docs/api-reference/api-reference): 将权限键用于 API 密钥。
- [Terraform 提供程序](/docs/terraform/index): 以代码方式管理团队及其权限。
:::
