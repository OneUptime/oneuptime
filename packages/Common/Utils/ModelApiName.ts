/*
 * THE NAME A MODEL KEEPS OUTSIDE ITS SCREENS.
 *
 * A model's singularName and pluralName are words people read: list titles,
 * empty states, buttons, the API reference. They are also, without anyone
 * deciding it, names other things call or store the model by:
 *
 *   - the OpenAPI spec tags every endpoint with the singular name, and the
 *     Terraform provider names its resource after the tag
 *     (oneuptime_on_call_policy_schedule);
 *   - the CLI names its command after it (oneuptime on-call-policy-schedule);
 *   - the MCP server names its tools after both (list_on_call_duty_policies);
 *   - the audit log stores the singular name as each entry's resource type.
 *
 * So renaming a thing on screen (#6817: one name per thing) must not rename
 * it there: a Terraform configuration, a script, an agent's allowed tools
 * and last year's audit entries all keep working. A renamed model says what
 * it was called in @TableMetadata's apiSingularName and apiPluralName (both,
 * when its singular name changed: ModelApiNames.test.ts), and everything
 * above reads its names through these two functions.
 */

export interface ModelNames {
  tableName?: string | null | undefined;
  singularName?: string | null | undefined;
  pluralName?: string | null | undefined;
  apiSingularName?: string | null | undefined;
  apiPluralName?: string | null | undefined;
}

// The singular name the API, Terraform, the CLI, MCP and the audit log use.
export function getApiSingularName(model: ModelNames): string {
  return model.apiSingularName || model.singularName || model.tableName || "";
}

/*
 * The plural name the MCP server's list and count tools use. A model with no
 * plural gets its singular name with an "s", as the tools always gave it.
 */
export function getApiPluralName(model: ModelNames): string {
  return (
    model.apiPluralName || model.pluralName || `${getApiSingularName(model)}s`
  );
}
