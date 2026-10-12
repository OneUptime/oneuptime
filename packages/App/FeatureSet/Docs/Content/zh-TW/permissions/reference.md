# 權限參考

OneUptime 可以授予的所有角色和權限，依照儀表板中權限選擇器的方式分組。使用本頁查找要授予團隊、API 金鑰或 Terraform 資源的確切名稱或鍵。

這些表格會在頁面提供時根據 OneUptime 原始碼產生：與儀表板、API 和 Terraform 提供者使用的是同一份清單，因此一律與您執行的版本一致。若要了解權限如何組合在一起（團隊、範圍、擁有者和封鎖），請先閱讀 [使用者、團隊與權限](/docs/permissions/index)。

## 如何閱讀這些表格

每個角色和權限都有一列，包含以下欄位：

- **角色** 或 **權限**：儀表板中顯示的名稱。
- **權限鍵**：在 [API](/docs/api-reference/api-reference)、[CLI](/docs/cli/index) 和 [Terraform 提供者](/docs/terraform/index) 中使用的值。
- **範圍**（僅角色）：`全部、擁有或標籤` 表示授予該角色時由您選擇其作用範圍。`僅限整個專案` 表示該角色一律作用於整個專案。
- **依標籤限制**（僅權限）：`是` 表示該權限的授予可以限定為帶有特定標籤的資源。
- **說明**：該角色或權限允許執行的操作。

> [!TIP]
> 優先選擇角色。OneUptime 新增功能時，角色會保持正確，而個別權限的清單需要手動保持更新。

## 角色

共 {{PERMISSION_ROLE_COUNT}} 個角色。其中 Project Owner、Project Admin、Project Member 和 Viewer 這四個角色作用於整個專案。其餘每個角色都在 Admin、Member 或 Viewer 層級涵蓋一個產品領域，例如事件或監測器。團隊的 **權限** 頁面和 API 金鑰頁面上的 **新增角色** 提供的就是這些角色。

{{PERMISSION_ROLE_TABLES}}

## 細部權限

{{PERMISSION_GROUP_COUNT}} 個群組中的 {{PERMISSION_TOTAL_COUNT}} 項個別功能。當角色的範圍超出所需時，為團隊或 API 金鑰提供的 **新增權限** 列出的就是這些權限。

{{PERMISSION_GRANULAR_TABLES}}

## 後續步驟

:::cards
- [使用者、團隊與權限](/docs/permissions/index): 團隊、範圍、擁有者和封鎖如何決定一個人能做什麼。
- [API 參考](/docs/api-reference/api-reference): 將權限鍵用於 API 金鑰。
- [Terraform 提供者](/docs/terraform/index): 以程式碼方式管理團隊及其權限。
:::
