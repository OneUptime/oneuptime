/*
 * WRITES THAT MAKE A CHANGE ONEUPTIME ASKS A PERSON BEFORE, AND WRITES OF
 * THE SAME RECORDS THAT DO NOT (#11177).
 *
 * For each record write of Common's list (Types/AI/AIAlwaysAskChanges)
 * that a generated tool can send: the tool's arguments that make the
 * change, and what the API holds before the call - the list a write adds
 * to, the setting that pages someone. The guard (AlwaysAskGuard) fails on
 * a record write a generated tool can send and that has none here, so a
 * change added to the list is tested through the tools the day it is.
 *
 * Beside them, the person's ordinary edits of the same records - Reopen,
 * Assign, a rule renamed, a data type turned back on - which must reach the
 * API as they always did.
 */

import { FakeOneUptimeApi, PROJECT_ID } from "./AlwaysAskHarness";
import { JSONObject } from "Common/Types/JSON";
import { SecurityPlaybookActionType } from "Common/Types/SecurityPlaybook/SecurityPlaybookAction";

export const ISSUE_ID: string = "11177000-0000-4000-8000-000000000011";
export const FINDING_ID: string = "11177000-0000-4000-8000-000000000012";
export const STORE_ID: string = "11177000-0000-4000-8000-000000000013";
export const RULE_ID: string = "11177000-0000-4000-8000-000000000014";
export const SETTING_ID: string = "11177000-0000-4000-8000-000000000015";
export const PLAYBOOK_ID: string = "11177000-0000-4000-8000-000000000016";
export const USER_ID: string = "11177000-0000-4000-8000-000000000017";
export const CONNECTION_ID: string = "11177000-0000-4000-8000-000000000018";

// A record's route, by its table: what the fake API holds a record under.
export type ApiPathOf = (tableName: string) => string;

export interface AlwaysAskFixture {
  // The generated tool's arguments that make the change.
  args: JSONObject;
  // What the API holds before the call.
  prepare?: ((api: FakeOneUptimeApi, apiPathOf: ApiPathOf) => void) | undefined;
}

export function fixtureKey(data: {
  change: string;
  tableName: string;
  write: string;
}): string {
  return `${data.change}|${data.tableName}|${data.write}`;
}

// A containment step: a user suspended through Okta.
export function suspendStep(
  id: string,
  requiresApproval: boolean | undefined,
): JSONObject {
  return {
    id,
    action: SecurityPlaybookActionType.SuspendOktaUser,
    config: { connectionId: CONNECTION_ID },
    ...(requiresApproval === undefined ? {} : { requiresApproval }),
  };
}

// A response on a store: its public access blocked through its cloud.
export function blockPublicAccessStep(
  id: string,
  requiresApproval: boolean | undefined,
): JSONObject {
  return {
    id,
    action: SecurityPlaybookActionType.BlockDataStorePublicAccess,
    config: {},
    ...(requiresApproval === undefined ? {} : { requiresApproval }),
  };
}

export const NOTE_STEP: JSONObject = {
  id: "note",
  action: SecurityPlaybookActionType.AddCaseNote,
  config: { note: "Look at the sign-ins first." },
};

// Where a Critical issue raises an alert: a Confirm there can page someone.
export function pagesForCriticalIssues(api: FakeOneUptimeApi): void {
  api.lists.set("/data-security-setting", [
    {
      _id: SETTING_ID,
      raiseAlertsForCriticalIssues: true,
      declareIncidentsForCriticalIssues: false,
    },
  ]);
}

export function pagesNobody(api: FakeOneUptimeApi): void {
  api.lists.set("/data-security-setting", [
    {
      _id: SETTING_ID,
      raiseAlertsForCriticalIssues: false,
      declareIncidentsForCriticalIssues: false,
    },
  ]);
}

export const MAKES_THE_CHANGE: Record<string, AlwaysAskFixture> = {
  [fixtureKey({
    change: "Accept Risk",
    tableName: "DataSecurityIssue",
    write: "update",
  })]: {
    args: {
      id: ISSUE_ID,
      status: "Accepted",
      acceptedReason: "A compensating control covers it.",
      acceptedUntil: "2027-01-31T23:59:59.999Z",
    },
  },
  [fixtureKey({
    change: "Not an Issue",
    tableName: "DataSecurityIssue",
    write: "update",
  })]: {
    args: {
      id: ISSUE_ID,
      status: "Not an issue",
      notAnIssueReason: "The bucket holds test fixtures.",
    },
  },
  [fixtureKey({
    change: "Not Sensitive",
    tableName: "DataStoreFinding",
    write: "update",
  })]: {
    args: {
      id: FINDING_ID,
      isSuppressed: true,
      suppressedReason: "Synthetic data.",
    },
  },
  [fixtureKey({
    change: "Confirm, in a project that pages someone for a Critical issue",
    tableName: "DataStoreFinding",
    write: "update",
  })]: {
    args: { id: FINDING_ID, isConfirmed: true },
    prepare: pagesForCriticalIssues,
  },
  [fixtureKey({
    change: "A rule saved",
    tableName: "DataSecurityResidencyRule",
    write: "create",
  })]: {
    args: {
      name: "EU personal data stays in the EU",
      dataCategories: ["Personal"],
      allowedRegions: ["eu-*"],
      isEnabled: true,
    },
  },
  [fixtureKey({
    change: "A rule saved",
    tableName: "DataSecurityResidencyRule",
    write: "update",
  })]: {
    args: { id: RULE_ID, allowedRegions: ["*"] },
  },
  [fixtureKey({
    change: "A data type turned off",
    tableName: "DataSecuritySetting",
    write: "create",
  })]: {
    args: { disabledDataTypeIds: ["credit-card"] },
  },
  [fixtureKey({
    change: "A data type turned off",
    tableName: "DataSecuritySetting",
    write: "update",
  })]: {
    args: { id: SETTING_ID, disabledDataTypeIds: ["email", "credit-card"] },
    prepare: (api: FakeOneUptimeApi, apiPathOf: ApiPathOf): void => {
      api.holds(apiPathOf("DataSecuritySetting"), SETTING_ID, {
        projectId: PROJECT_ID,
        disabledDataTypeIds: ["email"],
      });
    },
  },
  [fixtureKey({
    change: "A place left out of a store's scans",
    tableName: "DataStore",
    write: "create",
  })]: {
    args: {
      name: "Payments exports",
      kind: "Amazon S3",
      scanExclusions: ["exports/"],
    },
  },
  [fixtureKey({
    change: "A place left out of a store's scans",
    tableName: "DataStore",
    write: "update",
  })]: {
    args: { id: STORE_ID, scanExclusions: ["logs/", "exports/"] },
    prepare: (api: FakeOneUptimeApi, apiPathOf: ApiPathOf): void => {
      api.holds(apiPathOf("DataStore"), STORE_ID, {
        projectId: PROJECT_ID,
        scanExclusions: ["logs/"],
      });
    },
  },
  [fixtureKey({
    change:
      "A playbook's containment or store response run with nobody's approval",
    tableName: "SecurityPlaybook",
    write: "create",
  })]: {
    args: {
      name: "Contain a phished account",
      steps: [suspendStep("suspend", false)],
    },
  },
  [fixtureKey({
    change:
      "A playbook's containment or store response run with nobody's approval",
    tableName: "SecurityPlaybook",
    write: "update",
  })]: {
    args: {
      id: PLAYBOOK_ID,
      steps: [NOTE_STEP, blockPublicAccessStep("block", false)],
    },
    prepare: (api: FakeOneUptimeApi, apiPathOf: ApiPathOf): void => {
      api.holds(apiPathOf("SecurityPlaybook"), PLAYBOOK_ID, {
        projectId: PROJECT_ID,
        steps: [NOTE_STEP],
      });
    },
  },
};

export interface OrdinaryWrite {
  // What the person does, in words.
  label: string;
  tableName: string;
  operation: "create" | "update" | "delete";
  args: JSONObject;
  prepare?: ((api: FakeOneUptimeApi, apiPathOf: ApiPathOf) => void) | undefined;
}

/*
 * The person's own edits of the records the list holds writes of: each
 * reaches the API as it always did. A test fails on a record whose held
 * writes have no ordinary edit here, so holding a record never quietly
 * holds all of it.
 */
export const ORDINARY_WRITES: ReadonlyArray<OrdinaryWrite> = [
  {
    label: "Reopen an issue",
    tableName: "DataSecurityIssue",
    operation: "update",
    args: { id: ISSUE_ID, status: "Open" },
  },
  {
    label: "Mark an issue resolved",
    tableName: "DataSecurityIssue",
    operation: "update",
    args: { id: ISSUE_ID, status: "Resolved" },
  },
  {
    label: "Assign an issue",
    tableName: "DataSecurityIssue",
    operation: "update",
    args: { id: ISSUE_ID, assignedToUserId: USER_ID },
  },
  {
    label: "Unassign an issue",
    tableName: "DataSecurityIssue",
    operation: "update",
    args: { id: ISSUE_ID, assignedToUserId: null, assignedToTeamId: null },
  },
  {
    label: "Make a finding sensitive again",
    tableName: "DataStoreFinding",
    operation: "update",
    args: { id: FINDING_ID, isSuppressed: false, suppressedReason: "" },
  },
  {
    label: "Confirm a finding where a Critical issue pages nobody",
    tableName: "DataStoreFinding",
    operation: "update",
    args: { id: FINDING_ID, isConfirmed: true },
    prepare: pagesNobody,
  },
  {
    label: "Take a confirmation back",
    tableName: "DataStoreFinding",
    operation: "update",
    args: { id: FINDING_ID, isConfirmed: false },
  },
  {
    label: "Rename a residency rule",
    tableName: "DataSecurityResidencyRule",
    operation: "update",
    args: { id: RULE_ID, name: "EU personal data", description: "Why." },
  },
  {
    label: "Turn a residency rule off",
    tableName: "DataSecurityResidencyRule",
    operation: "update",
    args: { id: RULE_ID, isEnabled: false },
  },
  {
    label: "Delete a residency rule",
    tableName: "DataSecurityResidencyRule",
    operation: "delete",
    args: { id: RULE_ID },
  },
  {
    label: "Turn a data type back on",
    tableName: "DataSecuritySetting",
    operation: "update",
    args: { id: SETTING_ID, disabledDataTypeIds: ["email"] },
    prepare: (api: FakeOneUptimeApi, apiPathOf: ApiPathOf): void => {
      api.holds(apiPathOf("DataSecuritySetting"), SETTING_ID, {
        projectId: PROJECT_ID,
        disabledDataTypeIds: ["email", "iban"],
      });
    },
  },
  {
    label: "Keep masked samples",
    tableName: "DataSecuritySetting",
    operation: "update",
    args: { id: SETTING_ID, keepMaskedSamples: true },
  },
  {
    label: "Describe a store",
    tableName: "DataStore",
    operation: "update",
    args: { id: STORE_ID, description: "Card payments, EU." },
  },
  {
    label: "Have a store's scans read a place again",
    tableName: "DataStore",
    operation: "update",
    args: { id: STORE_ID, scanExclusions: ["logs/"] },
    prepare: (api: FakeOneUptimeApi, apiPathOf: ApiPathOf): void => {
      api.holds(apiPathOf("DataStore"), STORE_ID, {
        projectId: PROJECT_ID,
        scanExclusions: ["logs/", "tmp/"],
      });
    },
  },
  {
    label: "Add a store that leaves nothing out",
    tableName: "DataStore",
    operation: "create",
    args: { name: "Payments exports", kind: "Amazon S3" },
  },
  {
    label: "Rename a playbook",
    tableName: "SecurityPlaybook",
    operation: "update",
    args: { id: PLAYBOOK_ID, name: "Contain a phished account" },
  },
  {
    label: "Save a playbook whose containment waits for approval",
    tableName: "SecurityPlaybook",
    operation: "create",
    args: {
      name: "Contain a phished account",
      steps: [
        suspendStep("suspend", true),
        blockPublicAccessStep("block", true),
        NOTE_STEP,
      ],
    },
  },
  {
    label: "Turn a playbook off",
    tableName: "SecurityPlaybook",
    operation: "update",
    args: { id: PLAYBOOK_ID, isEnabled: false },
  },
  {
    label: "Change when a playbook whose steps all wait runs",
    tableName: "SecurityPlaybook",
    operation: "update",
    args: { id: PLAYBOOK_ID, isEnabled: true },
    prepare: (api: FakeOneUptimeApi, apiPathOf: ApiPathOf): void => {
      api.holds(apiPathOf("SecurityPlaybook"), PLAYBOOK_ID, {
        projectId: PROJECT_ID,
        steps: [suspendStep("suspend", true), NOTE_STEP],
      });
    },
  },
];
