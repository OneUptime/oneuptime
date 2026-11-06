/*
 * THE CLOUD AI AGENTS OF AN AWS ORGANIZATION: WHICH ACCOUNTS ARE COVERED.
 *
 * An AWS Organization one cloud connection reads (its management account's
 * role, and the same role in each member account) has a OneUptime cloud
 * account per AWS account. "Let AI fix problems" on any of them can set the
 * Cloud AI agent up in all of them at once (an organization's command:
 * Types/CloudConnection/CloudAiAgentSetupCommands, through a StackSet):
 *
 *   POST /resource-ai-access/organization            { resourceType, resourceId }
 *     The organization the account is in, if any: its management account
 *     and its accounts the caller may read, each with whether its agent is
 *     connected, offline or not there (CloudOrganizationView). For anyone
 *     who may read the account.
 *
 *   POST /resource-ai-access/organization-agent-keys { resourceType, resourceId }
 *     A new key for each account's agent - made as one account's is, and
 *     for the same people - for the organization's command to carry, with
 *     the accounts it made none for and why (CloudOrganizationKeys).
 *
 * Shared by the server and the dashboard: React-free and Node-free.
 */

export const RESOURCE_AI_ACCESS_ORGANIZATION_PATH: string =
  "/resource-ai-access/organization";
export const RESOURCE_AI_ACCESS_ORGANIZATION_KEYS_PATH: string =
  "/resource-ai-access/organization-agent-keys";

// The most accounts of an organization the view lists, and keys are made for.
export const CLOUD_ORGANIZATION_MAX_ACCOUNTS: number = 500;

// Where an account's agent is: connected now, connected once and silent since, or never.
export type CloudOrganizationAgentState = "connected" | "offline" | "none";

export const CLOUD_ORGANIZATION_AGENT_STATES: ReadonlyArray<CloudOrganizationAgentState> =
  ["connected", "offline", "none"];

export interface CloudOrganizationAccountView {
  // OneUptime's id of the cloud account.
  cloudAccountId: string;
  // The AWS account id.
  accountId: string;
  name: string;
  isManagementAccount: boolean;
  agent: CloudOrganizationAgentState;
  // ISO date of the agent's last word; null without an agent.
  lastSeenAt: string | null;
}

export interface CloudOrganizationView {
  isOrganization: boolean;
  managementAccountId: string | null;
  // The accounts the caller may read, the management account first, then by name.
  accounts: Array<CloudOrganizationAccountView>;
  // The organization has more accounts than the view lists.
  isTruncated: boolean;
}

export interface CloudOrganizationAccountKey {
  cloudAccountId: string;
  accountId: string;
  name: string;
  agentKey: string;
  worksUntilConnectedBy: string;
}

export interface CloudOrganizationSkippedAccount {
  cloudAccountId: string;
  accountId: string;
  name: string;
  // Why no key was made for it: the refusal one account's dialog would show.
  reason: string;
}

export interface CloudOrganizationKeys {
  managementAccountId: string;
  keys: Array<CloudOrganizationAccountKey>;
  skipped: Array<CloudOrganizationSkippedAccount>;
}

// The view of an account outside any organization.
export const NOT_AN_ORGANIZATION: CloudOrganizationView = {
  isOrganization: false,
  managementAccountId: null,
  accounts: [],
  isTruncated: false,
};

// The AWS account an IAM role ARN is in (arn:aws:iam::<12 digits>:role/...), or null.
export function getRoleArnAccountId(roleArn: unknown): string | null {
  if (typeof roleArn !== "string") {
    return null;
  }

  const parts: Array<string> = roleArn.split(":");
  const account: string = parts[4] || "";

  return parts[0] === "arn" &&
    parts[2] === "iam" &&
    isAwsAccountId(account) &&
    (parts[5] || "").startsWith("role/")
    ? account
    : null;
}

// An AWS account id: twelve digits.
export function isAwsAccountId(value: unknown): value is string {
  return typeof value === "string" && value.length === 12 && isDigits(value);
}

function isDigits(value: string): boolean {
  for (const character of value) {
    if (character < "0" || character > "9") {
      return false;
    }
  }

  return value.length > 0;
}

function readText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readArray(value: unknown): Array<unknown> {
  return Array.isArray(value) ? value : [];
}

/*
 * The view as the dashboard reads it off the wire: anything that is not one
 * reads as no organization, and a row of the wrong shape is left out.
 */
export function parseCloudOrganizationView(
  value: unknown,
): CloudOrganizationView {
  const object: Record<string, unknown> | null = readObject(value);

  if (!object || object["isOrganization"] !== true) {
    return NOT_AN_ORGANIZATION;
  }

  const accounts: Array<CloudOrganizationAccountView> = [];

  for (const raw of readArray(object["accounts"])) {
    const row: Record<string, unknown> | null = readObject(raw);
    const agent: unknown = row ? row["agent"] : undefined;

    if (
      !row ||
      !readText(row["cloudAccountId"]) ||
      !readText(row["accountId"]) ||
      !CLOUD_ORGANIZATION_AGENT_STATES.includes(
        agent as CloudOrganizationAgentState,
      )
    ) {
      continue;
    }

    accounts.push({
      cloudAccountId: readText(row["cloudAccountId"]),
      accountId: readText(row["accountId"]),
      name: readText(row["name"]) || readText(row["accountId"]),
      isManagementAccount: row["isManagementAccount"] === true,
      agent: agent as CloudOrganizationAgentState,
      lastSeenAt: readText(row["lastSeenAt"]) || null,
    });
  }

  return {
    isOrganization: true,
    managementAccountId: readText(object["managementAccountId"]) || null,
    accounts,
    isTruncated: object["isTruncated"] === true,
  };
}

// The keys as the dashboard reads them; null for an answer that is not one.
export function parseCloudOrganizationKeys(
  value: unknown,
): CloudOrganizationKeys | null {
  const object: Record<string, unknown> | null = readObject(value);
  const managementAccountId: string = object
    ? readText(object["managementAccountId"])
    : "";

  if (!object || !managementAccountId) {
    return null;
  }

  const keys: Array<CloudOrganizationAccountKey> = [];
  const skipped: Array<CloudOrganizationSkippedAccount> = [];

  for (const raw of readArray(object["keys"])) {
    const row: Record<string, unknown> | null = readObject(raw);

    if (
      row &&
      readText(row["cloudAccountId"]) &&
      readText(row["accountId"]) &&
      readText(row["agentKey"])
    ) {
      keys.push({
        cloudAccountId: readText(row["cloudAccountId"]),
        accountId: readText(row["accountId"]),
        name: readText(row["name"]) || readText(row["accountId"]),
        agentKey: readText(row["agentKey"]),
        worksUntilConnectedBy: readText(row["worksUntilConnectedBy"]),
      });
    }
  }

  for (const raw of readArray(object["skipped"])) {
    const row: Record<string, unknown> | null = readObject(raw);

    if (row && readText(row["cloudAccountId"]) && readText(row["accountId"])) {
      skipped.push({
        cloudAccountId: readText(row["cloudAccountId"]),
        accountId: readText(row["accountId"]),
        name: readText(row["name"]) || readText(row["accountId"]),
        reason: readText(row["reason"]),
      });
    }
  }

  return { managementAccountId, keys, skipped };
}

// How many of the view's accounts have an agent connected now.
export function countConnectedAccounts(view: CloudOrganizationView): number {
  return view.accounts.filter((account: CloudOrganizationAccountView) => {
    return account.agent === "connected";
  }).length;
}
