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

/*
 * What each kept singular name is called on screen now. The audit log stores
 * an entry's resource type by the kept name, and its pages show the type
 * through getScreenSingularName, so an entry about an Ingestion Key says
 * Ingestion Key, as last year's entries about it now do too. Plain words, so
 * the Dashboard reads them without loading the models; ModelApiNames.test.ts
 * holds them to every model's own names.
 */
const SCREEN_SINGULAR_NAMES: Readonly<Record<string, string>> = {
  // #6817 part 1: On-Call.
  "On-Call Policy Schedule": "On-Call Schedule",
  "User's On-Call Duty Escalation Rule": "Escalation Rule User",
  "Team On-Call Duty Escalation Rule": "Escalation Rule Team",
  "Schedule's On-Call Duty Escalation Rule": "Escalation Rule Schedule",
  "On-Call Duty Execution Log": "On-Call Policy Execution Log",
  "On-Call Duty Execution Log Timeline":
    "On-Call Policy Execution Log Timeline",
  "On Call Duty Policy Feed": "On-Call Policy Feed",
  "On Call Time Log": "On-Call Time Log",
  "OnCallDutyPolicy User Owner": "On-Call Policy User Owner",
  "OnCallDutyPolicy Team Owner": "On-Call Policy Team Owner",
  // #6817 part 2: Ingestion Keys.
  "Telemetry Ingestion Key": "Ingestion Key",
  "Telemetry Ingestion Key Refusal": "Ingestion Key Refusal",
  // #6817 part 3: maintenance events.
  "Scheduled Maintenance Event": "Maintenance Event",
  "Scheduled Event Internal Note": "Maintenance Event Internal Note",
  "Scheduled Event Public Note": "Maintenance Event Public Note",
};

// The kept singular names this table knows, for its test.
export const KEPT_SINGULAR_NAMES: ReadonlyArray<string> = Object.keys(
  SCREEN_SINGULAR_NAMES,
);

// What a singular name the API keeps is called on screen; any other is itself.
export function getScreenSingularName(apiSingularName: string): string {
  return SCREEN_SINGULAR_NAMES[apiSingularName] || apiSingularName;
}
