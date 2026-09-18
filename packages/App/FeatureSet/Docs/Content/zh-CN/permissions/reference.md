# 权限参考

OneUptime 可以授予的全部权限，分组方式与仪表板中的权限选择器完全一致。

本页在请求时由 OneUptime 源代码生成，使用的正是仪表板、API 和 Terraform 提供程序所依据的同一份清单。它不会与产品脱节，并且反映你正在运行的版本。

如果你想了解各部分如何配合——团队、范围、所有者、阻止——请先阅读[用户、团队与权限](/docs/permissions/index)。

**权限键**列的值用于 [API](/docs/api-reference/api-reference)、[CLI](/docs/cli/index) 和 [Terraform 提供程序](/docs/terraform/index)。标题则是你在仪表板中看到的名称。

## 角色

共 {{PERMISSION_ROLE_COUNT}} 个角色，每个角色以 Admin、Member 或 Viewer 三个层级打包一个产品领域。为团队添加权限时，**角色**选择器提供的就是它们。

**范围**列表示授予该角色时能否收窄。`全部、拥有或标签`表示可以选择；`仅限整个项目`表示该角色始终作用于整个项目。

{{PERMISSION_ROLE_TABLES}}

## 细粒度权限

分布在 {{PERMISSION_GROUP_COUNT}} 个分组中的 {{PERMISSION_TOTAL_COUNT}} 项单独能力。**细粒度**选择器提供的就是它们，分配给 API 密钥的也是它们。

**按标签限制**列表示这项权限的授予能否被限定到带有特定标签的资源。

{{PERMISSION_GRANULAR_TABLES}}
