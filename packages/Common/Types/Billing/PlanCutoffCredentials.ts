/*
 * Credentials that stop working below their plan.
 *
 * On OneUptime Cloud (billing on) a project's API keys work only while the
 * project is on the plan that sells API keys (Growth), and its SCIM
 * connections - the project's own and its status pages' - only while it is
 * on the plan that sells SCIM (Scale). Below it, every request made with one
 * of the project's API keys, and every SCIM request for one of its
 * connections, is refused with 402 when it authenticates
 * (Server/Utils/Billing/PlanCutoffCredentialAccess), whatever route or tool
 * it was for: the REST API and everything built on it - the CRUD routes,
 * Terraform, the CLI, the MCP server's API-key mode - and the SCIM
 * endpoints.
 *
 * Nothing is deleted or switched off. The keys and connections stay as they
 * were - readable, deletable (Types/Billing/PlanGatedTable) - and work again,
 * as they are, the moment the project is back on the plan: no new keys, no
 * new setup in the identity provider.
 *
 * Only these three. Telemetry ingestion keys, probe keys, agent keys and the
 * instance's master API key are not API keys of a project, and are not
 * affected; neither are people, whether they sign in to the dashboard or
 * connect an MCP client by signing in. Self-hosted installs (billing off)
 * have no plans, so nothing here applies to them.
 *
 * Kept free of models and of the server, so the server, the Dashboard and the
 * tests read the same tables and the same words.
 */

// The tables whose records stop working below their plan.
export enum PlanCutoffCredential {
  ApiKey = "ApiKey",
  ProjectSCIM = "ProjectSCIM",
  StatusPageSCIM = "StatusPageSCIM",
}

export const PLAN_CUTOFF_CREDENTIAL_TABLES: ReadonlyArray<string> = [
  PlanCutoffCredential.ApiKey,
  PlanCutoffCredential.ProjectSCIM,
  PlanCutoffCredential.StatusPageSCIM,
];

// Whether the records of this table stop working below the table's plan.
export const isPlanCutoffCredentialTable: (
  tableName: string | undefined | null,
) => boolean = (tableName: string | undefined | null): boolean => {
  return Boolean(tableName) && PLAN_CUTOFF_CREDENTIAL_TABLES.includes(tableName!);
};

/*
 * What a request made with an API key of a project below the plan is told
 * (402): what the keys need, that they stopped, that they are kept, and the
 * one thing to do.
 */
export const getApiKeysStoppedMessage: (planName: string) => string = (
  planName: string,
): string => {
  return `API keys need the ${planName} plan. This project's plan does not include them, so its API keys stopped working. The keys are kept: upgrade the project to ${planName} in Project Settings > Billing and they work again.`;
};

/*
 * What an identity provider is told (402, in the SCIM error format) when it
 * calls one of the SCIM connections of a project below the plan.
 */
export const getScimStoppedMessage: (planName: string) => string = (
  planName: string,
): string => {
  return `SCIM provisioning needs the ${planName} plan. This project's plan does not include it, so its SCIM connections stopped working. The connections are kept: upgrade the project to ${planName} in Project Settings > Billing and they work again.`;
};

// The message for one of the tables, by name.
export const getPlanCutoffMessage: (
  credential: PlanCutoffCredential,
  planName: string,
) => string = (credential: PlanCutoffCredential, planName: string): string => {
  if (credential === PlanCutoffCredential.ApiKey) {
    return getApiKeysStoppedMessage(planName);
  }

  return getScimStoppedMessage(planName);
};
