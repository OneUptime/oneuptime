# 權限參考

OneUptime 能夠授予的所有權限，分組方式與儀表板中的權限選擇器完全一致。

本頁在請求時由 OneUptime 原始碼產生，使用的正是儀表板、API 與 Terraform 供應器所依據的同一份清單。它不會與產品脫節，並且反映你正在執行的版本。

如果你想了解各部分如何搭配——團隊、範圍、擁有者、封鎖——請先閱讀[使用者、團隊與權限](/docs/permissions/index)。

**權限鍵**欄的值用於 [API](/docs/api-reference/api-reference)、[CLI](/docs/cli/index) 與 [Terraform 供應器](/docs/terraform/index)。標題則是你在儀表板中看到的名稱。

## 角色

共 {{PERMISSION_ROLE_COUNT}} 個角色，每個角色以 Admin、Member 或 Viewer 三個層級打包一個產品領域。為團隊新增權限時，**角色**選擇器提供的就是這些。

**範圍**欄表示授予該角色時能否收窄。`全部、擁有或標籤`表示可以選擇；`僅限整個專案`表示該角色一律作用於整個專案。

{{PERMISSION_ROLE_TABLES}}

## 細部權限

分布於 {{PERMISSION_GROUP_COUNT}} 個群組中的 {{PERMISSION_TOTAL_COUNT}} 項單獨能力。**細部**選擇器提供的就是這些，指派給 API 金鑰的也是這些。

**依標籤限制**欄表示這項權限的授予能否限定在帶有特定標籤的資源上。

{{PERMISSION_GRANULAR_TABLES}}
