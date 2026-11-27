import {
  ASKS_IN_EVERY_MODE_REFUSAL_PREFIX,
  CHANGE_DATA_SECURITY_ISSUE_TOOL_NAME,
  DECIDE_DATA_SECURITY_PROPOSAL_TOOL_NAME,
  JUDGE_DATA_SECURITY_FINDING_TOOL_NAME,
  RESPOND_ON_DATA_STORE_TOOL_NAME,
  SAVE_DATA_SECURITY_RULE_TOOL_NAME,
  SCRUB_DATA_SECURITY_FINDING_TOOL_NAME,
  SET_DATA_STORE_OWNERS_TOOL_NAME,
} from "./AIDataSecurityActions";
import { AI_DATA_SECURITY_ACTION_ASKS_BECAUSE } from "./AIDataSecurityActionWords";
import { doesLabelSayProduction } from "../Cloud/CloudResourceEnvironment";
import { toStoredBoolean } from "../Database/BooleanColumnValue";
import DataSecurityIssueStatus from "../DataSecurity/DataSecurityIssueStatus";
import { isExcludedAlready } from "../DataSecurity/DataSecurityScanTuning";
import { JSONObject } from "../JSON";
import {
  getSecurityPlaybookAction,
  SecurityPlaybookActionType,
} from "../SecurityPlaybook/SecurityPlaybookAction";
import {
  parseSecurityPlaybookSteps,
  SecurityPlaybookStep,
} from "../SecurityPlaybook/SecurityPlaybookStep";

/*
 * WHAT ONEUPTIME ASKS A PERSON BEFORE IN EVERY MODE, AS THE RECORDS IT
 * WRITES (#11177).
 *
 * Ask AI asks a person on a card before some changes in every mode,
 * Auto-run included (#10378): Accept Risk, Not an Issue, Not Sensitive, a
 * store's owners, a rule saved, a proposal decided, a response on a store,
 * a scrub something reads, and a Confirm in a project that pages someone
 * for a Critical issue. OneUptime AI asks before others whatever its rules
 * say: a data type turned off and a place left out of a store's scans
 * (DataSecurityAi's ChangesWhatScansLookFor), and a containment step of a
 * security playbook waits for a person's approval in its run. Text an
 * attacker can write - a store's name, an issue's evidence, an attribute's
 * key - could talk a model into any of them. The MCP server cannot show a
 * card, so its Data Security tools refuse the actions
 * (Server/Utils/AI/Toolbox/DataSecurityActionRunner).
 *
 * Most of them are a plain write of a record: an issue's status, a
 * finding's switch, a store's owner, a rule, a setting's list, a
 * playbook's steps. The MCP server also offers a create, update and delete
 * tool for every record it lists, and they write the very columns the
 * buttons write. So this is the one list of those changes as writes -
 * which record, which kind of write, and which of the values it writes,
 * against what the record holds now, make the change:
 *
 *   - Ask AI's actions decide from it whether a call asks in every mode
 *     (ObservabilityTool.asksInEveryMode), by the write the call would make;
 *   - the MCP server reads every write it sends against it, and refuses
 *     one that makes such a change with the same sentence and the same page
 *     as its Data Security tools (App/FeatureSet/MCP/Tools/AlwaysAskWrites).
 *
 * A change added here is asked about in Ask AI and refused on the MCP
 * server together, and the MCP server's guard (Tests/AlwaysAskGuard) fails
 * on a change that asks in every mode and is not here. Writing any other
 * field of the same records keeps working: Assign and Reopen, a finding
 * made sensitive again, a rule renamed, a data type turned back on, a step
 * that waits for approval.
 *
 * Not every change here is Data Security's. A label whose name says
 * production holds every cloud resource it is on back from what nobody
 * approves - an off-hours schedule's stop, an AI rule's change made
 * without asking (#11347) - and renaming it to a name that does not, or
 * deleting it, lets every one of them go at once. Text an attacker writes
 * could talk an agent into that too, so it is held here like the rest.
 *
 * React- and server-free.
 */

// The kinds of write a change is made by, as the record's API route takes them.
export enum AlwaysAskWrite {
  Create = "create",
  Update = "update",
  Delete = "delete",
}

export const ALL_ALWAYS_ASK_WRITES: ReadonlyArray<AlwaysAskWrite> = [
  AlwaysAskWrite.Create,
  AlwaysAskWrite.Update,
  AlwaysAskWrite.Delete,
];

/*
 * A change that asks only in some projects or for some records: what the
 * card reads before it says why it asks. Where that cannot be read, it
 * asks, as Ask AI's card does.
 */
export enum AlwaysAskCondition {
  // The project's Data Security raises an alert or declares an incident for a Critical issue.
  CriticalIssuesPage = "CriticalIssuesPage",
  // A monitor, dashboard, saved view, recording rule, SLO or Security Events reads what it hides.
  SomethingReadsWhatItHides = "SomethingReadsWhatItHides",
}

/*
 * The page in OneUptime where the person makes the change, with its own
 * button or with Ask AI there - the page Ask AI's card opens, and the one
 * a refusal names.
 */
export enum AlwaysAskPage {
  // An issue's page, by the issue's id.
  DataSecurityIssue = "DataSecurityIssue",
  // The findings of a store, by the finding's store.
  DataStoreFindings = "DataStoreFindings",
  // A store's Owners page, by the store.
  DataStoreOwners = "DataStoreOwners",
  // A store's Settings page, where what its scans leave out is kept.
  DataStoreSettings = "DataStoreSettings",
  // Data Security > Settings, for each kind of rule.
  ResidencyRules = "ResidencyRules",
  OwnerRules = "OwnerRules",
  LabelRules = "LabelRules",
  // Data Security > Settings > Data Types, where a data type is turned off.
  DataTypes = "DataTypes",
  // Data Security > AI, where OneUptime AI's proposals wait.
  DataSecurityAi = "DataSecurityAi",
  // A store's page, by the store.
  DataStore = "DataStore",
  // A security playbook's page, by the playbook; the playbooks for a new one.
  SecurityPlaybook = "SecurityPlaybook",
  // Project Settings > Labels, where a label is renamed or deleted.
  Labels = "Labels",
}

// One record's writes that make a change.
export interface AlwaysAskRecordWrite {
  // The record, by its table's name.
  tableName: string;
  writes: ReadonlyArray<AlwaysAskWrite>;
  /*
   * The columns whose values make it, when only some do: a write that
   * names none of them is the person's ordinary edit. Left out, every such
   * write makes the change. A delete names no column - it takes them all -
   * so it is judged by what the record holds (comparesWith) instead.
   */
  columns?: ReadonlyArray<string> | undefined;
  /*
   * The record's columns as they are now that the write is compared with:
   * a list it adds to, steps it changes. Read as the caller before the
   * write is sent; nothing for a create.
   */
  comparesWith?: ReadonlyArray<string> | undefined;
  /*
   * Whether a write makes the change: its columns, read as the record's
   * route reads them - each switch, date and number turned into what the
   * database stores - and, for a record that compares, the record as it is
   * now: {} for a create, null when it could not be read, which is never
   * taken to mean the write is safe. Asked only when `columns` names one
   * the write has.
   */
  makesIt?:
    | ((written: JSONObject, stored: JSONObject | null) => boolean)
    | undefined;
  // The write, in words: what an agent reading the record's fields is told.
  written: string;
  page: AlwaysAskPage;
}

export interface AlwaysAskChange {
  // What a person calls it.
  name: string;
  /*
   * The Ask AI action that makes it behind a card that asks in every mode.
   * Left out for a change no action of Ask AI's makes: a playbook's step
   * run with nobody's approval.
   */
  action?: string | undefined;
  /*
   * Every call of the action makes it: a store's owners, a rule saved. An
   * action that makes it only for some calls - change_data_security_issue
   * accepts a risk, and also reopens and assigns - asks by the write each
   * call makes (writeAlwaysAsks).
   */
  madeByEveryCall: boolean;
  // Who is asked, and where, in words.
  card: string;
  // The product whose page the person makes it on, as a refusal names it.
  product: string;
  /*
   * The writes of OneUptime's records that make it. None for a change made
   * outside OneUptime, such as a response through a store's cloud
   * connection: no record's write can make it.
   */
  records: ReadonlyArray<AlwaysAskRecordWrite>;
  // Asked only where this holds; left out, it always asks.
  onlyWhen?: AlwaysAskCondition | undefined;
  // Why it asks, in English: the card's own sentence where there is a card.
  asksBecause: string;
  /*
   * For a change made outside OneUptime: where it is made, and why no
   * record's write can make it.
   */
  madeOutsideOneUptime?: string | undefined;
}

const DATA_SECURITY_PRODUCT: string = "Data Security";

// The card of each of Ask AI's Data Security actions.
const ASK_AI_CARD: string =
  "Ask AI's approval card, in every mode, Auto-run included";

// OneUptime AI's proposal, which a person approves in Data Security > AI.
const PROPOSAL_CARD: string =
  "OneUptime AI's proposal, which a person approves in Data Security > AI, whatever OneUptime AI's rules say";

// A text value as its record keeps it, for comparing: trimmed, in one case.
function readText(value: unknown): string | null {
  return typeof value === "string" ? value.trim().toLowerCase() : null;
}

// Whether a write sets an issue's status to this one, however it is cased.
function setsIssueStatus(
  data: JSONObject,
  status: DataSecurityIssueStatus,
): boolean {
  return readText(data["status"]) === status.toLowerCase();
}

// Whether a write turns this switch on, as Postgres reads the value.
function turnsOn(data: JSONObject, column: string): boolean {
  return toStoredBoolean(data[column]) === true;
}

// The records whose writes Ask AI's own actions make, by their tables' names.
export const DATA_SECURITY_ISSUE_TABLE_NAME: string = "DataSecurityIssue";
export const DATA_STORE_FINDING_TABLE_NAME: string = "DataStoreFinding";

const DATA_SECURITY_ISSUE: string = DATA_SECURITY_ISSUE_TABLE_NAME;
const DATA_STORE_FINDING: string = DATA_STORE_FINDING_TABLE_NAME;
const DATA_SECURITY_RESIDENCY_RULE: string = "DataSecurityResidencyRule";

// What a residency rule says: the data it covers, whose, and where it may live.
export const RESIDENCY_RULE_TERMS: ReadonlyArray<string> = [
  "dataCategories",
  "subjectCountries",
  "allowedRegions",
  "isEnabled",
];

// The stores an owner or a label rule matches.
const STORE_MATCH_TERMS: ReadonlyArray<string> = [
  "matchLabels",
  "nameRegexPattern",
  "descriptionRegexPattern",
  "cloudTagPattern",
];

// What an owner rule says: the stores it matches, their owners, and whether they are told.
export const OWNER_RULE_TERMS: ReadonlyArray<string> = [
  ...STORE_MATCH_TERMS,
  "ownerUsers",
  "ownerTeams",
  "notifyOwners",
  "isEnabled",
];

// What a label rule says: the stores it matches and the labels they get.
export const LABEL_RULE_TERMS: ReadonlyArray<string> = [
  ...STORE_MATCH_TERMS,
  "labelsToAdd",
  "isEnabled",
];

/*
 * Whether an update of a rule saves it anew: it writes what the rule says.
 * Turned off, a rule matches and breaks no store, so only turning one on
 * saves it; its name and description say nothing a store is held to.
 */
function savesRuleTerms(
  terms: ReadonlyArray<string>,
): (written: JSONObject) => boolean {
  return (written: JSONObject): boolean => {
    return terms.some((column: string): boolean => {
      if (written[column] === undefined) {
        return false;
      }

      return column === "isEnabled" ? turnsOn(written, column) : true;
    });
  };
}

/*
 * Whether a write puts an entry in a list of the record that the record
 * does not hold yet - a data type turned off, a place left out of a
 * store's scans - by the list's own way of telling its entries apart.
 * Taking entries off, or writing the list as it is, adds none. A value
 * that is not a list, or a record that could not be read, cannot be
 * judged, so it is taken to add one.
 */
function addsToList(
  column: string,
  isHeld: (stored: unknown, entry: string) => boolean,
): (written: JSONObject, stored: JSONObject | null) => boolean {
  return (written: JSONObject, stored: JSONObject | null): boolean => {
    const value: unknown = written[column];

    if (value === undefined || value === null) {
      return false;
    }

    if (!Array.isArray(value)) {
      return true;
    }

    if (value.length === 0) {
      return false;
    }

    if (stored === null) {
      return true;
    }

    return value.some((entry: unknown): boolean => {
      return typeof entry !== "string" || !isHeld(stored[column], entry);
    });
  };
}

// A data type is one of the ids the setting holds.
function holdsDataType(stored: unknown, entry: string): boolean {
  return (
    Array.isArray(stored) &&
    stored.some((held: unknown): boolean => {
      return typeof held === "string" && held.trim() === entry.trim();
    })
  );
}

/*
 * A playbook's step that waits for a person's approval in its run unless
 * someone turns that off: a containment step (SecurityPlaybookAction's
 * isDisruptive - a user suspended, a host isolated, an address blocked),
 * and a response on a data store through its cloud connection, the change
 * respond_on_data_store asks a person about in every mode.
 */
export const RESPONSE_ON_A_STORE_STEPS: ReadonlyArray<SecurityPlaybookActionType> =
  [
    SecurityPlaybookActionType.BlockDataStorePublicAccess,
    SecurityPlaybookActionType.RevokeDataStoreSharing,
  ];

export function isStepGuardedByApproval(
  step: Pick<SecurityPlaybookStep, "action">,
): boolean {
  return (
    Boolean(getSecurityPlaybookAction(step.action)?.isDisruptive) ||
    RESPONSE_ON_A_STORE_STEPS.includes(step.action)
  );
}

/*
 * Whether a label's write lets go of the cloud resources its name holds
 * back (#11347): a rename of a label whose name says production
 * ("Production", "prod", "env: live") to one that does not, or its delete.
 * A rename that still says production ("Production" to "prod") holds them
 * as before, and one to a production name holds more; a label never says
 * non-production to what nobody approves, so a rename to "dev" lets
 * nothing go. A label that could not be read is taken to say production.
 */
function letsGoOfProduction(
  written: JSONObject,
  stored: JSONObject | null,
): boolean {
  if (written["name"] !== undefined && doesLabelSayProduction(written["name"])) {
    return false;
  }

  return stored === null || doesLabelSayProduction(stored["name"]);
}

export const LABEL_TABLE_NAME: string = "Label";

// When and whether a playbook runs: what puts its steps to work on more cases.
export const PLAYBOOK_REACH_COLUMNS: ReadonlyArray<string> = [
  "trigger",
  "minimumSecurityCasePriority",
  "minimumSecurityCasePriorityId",
  "detectionSource",
  "detectionRuleIds",
  "isEnabled",
];

// A playbook's steps as its service reads them; null for steps it would refuse.
function readSteps(value: unknown): Array<SecurityPlaybookStep> | null {
  try {
    return parseSecurityPlaybookSteps(value);
  } catch {
    return null;
  }
}

// A guarded step that runs with nobody's approval.
function runsUnapproved(step: SecurityPlaybookStep): boolean {
  return isStepGuardedByApproval(step) && !step.requiresApproval;
}

/*
 * Whether a playbook's write lets a guarded step run with nobody's
 * approval where it did not before: a step of one, new or changed, saved
 * without approval - only a person in OneUptime turns that off, and a
 * step the record holds so already stays as they left it - or, on a
 * playbook with such a step, a change to when or whether it runs, which
 * puts that step to work on cases its author did not choose. Steps the
 * playbook's service would refuse are its to refuse.
 */
function letsAGuardedStepRunUnapproved(
  written: JSONObject,
  stored: JSONObject | null,
): boolean {
  const storedSteps: Array<SecurityPlaybookStep> | null =
    stored === null ? null : readSteps(stored["steps"]);
  let steps: Array<SecurityPlaybookStep> | null = storedSteps;

  if (written["steps"] !== undefined && written["steps"] !== null) {
    const writtenSteps: Array<SecurityPlaybookStep> | null = readSteps(
      written["steps"],
    );

    if (writtenSteps === null) {
      return false;
    }

    for (const step of writtenSteps) {
      if (!runsUnapproved(step)) {
        continue;
      }

      const keptAsItWas: boolean = Boolean(
        storedSteps?.some((held: SecurityPlaybookStep): boolean => {
          return (
            held.id === step.id &&
            held.action === step.action &&
            runsUnapproved(held) &&
            JSON.stringify(held.config) === JSON.stringify(step.config)
          );
        }),
      );

      if (!keptAsItWas) {
        return true;
      }
    }

    steps = writtenSteps;
  }

  const changesReach: boolean = PLAYBOOK_REACH_COLUMNS.some(
    (column: string): boolean => {
      if (written[column] === undefined) {
        return false;
      }

      // Turned off, a playbook runs nothing.
      return column === "isEnabled" ? turnsOn(written, column) : true;
    },
  );

  if (!changesReach) {
    return false;
  }

  return steps === null || steps.some(runsUnapproved);
}

export const ALWAYS_ASK_CHANGES: ReadonlyArray<AlwaysAskChange> = [
  {
    name: "Accept Risk",
    action: CHANGE_DATA_SECURITY_ISSUE_TOOL_NAME,
    madeByEveryCall: false,
    card: ASK_AI_CARD,
    product: DATA_SECURITY_PRODUCT,
    records: [
      {
        tableName: DATA_SECURITY_ISSUE,
        writes: [AlwaysAskWrite.Update],
        columns: ["status"],
        makesIt: (written: JSONObject): boolean => {
          return setsIssueStatus(written, DataSecurityIssueStatus.Accepted);
        },
        written: 'an update that sets status to "Accepted"',
        page: AlwaysAskPage.DataSecurityIssue,
      },
    ],
    asksBecause: AI_DATA_SECURITY_ACTION_ASKS_BECAUSE.acceptRisk,
  },
  {
    name: "Not an Issue",
    action: CHANGE_DATA_SECURITY_ISSUE_TOOL_NAME,
    madeByEveryCall: false,
    card: ASK_AI_CARD,
    product: DATA_SECURITY_PRODUCT,
    records: [
      {
        tableName: DATA_SECURITY_ISSUE,
        writes: [AlwaysAskWrite.Update],
        columns: ["status"],
        makesIt: (written: JSONObject): boolean => {
          return setsIssueStatus(written, DataSecurityIssueStatus.NotAnIssue);
        },
        written: 'an update that sets status to "Not an issue"',
        page: AlwaysAskPage.DataSecurityIssue,
      },
    ],
    asksBecause: AI_DATA_SECURITY_ACTION_ASKS_BECAUSE.notAnIssue,
  },
  {
    name: "Not Sensitive",
    action: JUDGE_DATA_SECURITY_FINDING_TOOL_NAME,
    madeByEveryCall: false,
    card: ASK_AI_CARD,
    product: DATA_SECURITY_PRODUCT,
    records: [
      {
        tableName: DATA_STORE_FINDING,
        writes: [AlwaysAskWrite.Update],
        columns: ["isSuppressed"],
        makesIt: (written: JSONObject): boolean => {
          return turnsOn(written, "isSuppressed");
        },
        written: "an update that turns isSuppressed on",
        page: AlwaysAskPage.DataStoreFindings,
      },
    ],
    asksBecause: AI_DATA_SECURITY_ACTION_ASKS_BECAUSE.notSensitive,
  },
  {
    name: "Confirm, in a project that pages someone for a Critical issue",
    action: JUDGE_DATA_SECURITY_FINDING_TOOL_NAME,
    madeByEveryCall: false,
    card: ASK_AI_CARD,
    product: DATA_SECURITY_PRODUCT,
    records: [
      {
        tableName: DATA_STORE_FINDING,
        writes: [AlwaysAskWrite.Update],
        columns: ["isConfirmed"],
        makesIt: (written: JSONObject): boolean => {
          return turnsOn(written, "isConfirmed");
        },
        written:
          "an update that turns isConfirmed on, where the project's Data Security raises an alert or declares an incident for a Critical issue",
        page: AlwaysAskPage.DataStoreFindings,
      },
    ],
    onlyWhen: AlwaysAskCondition.CriticalIssuesPage,
    asksBecause: AI_DATA_SECURITY_ACTION_ASKS_BECAUSE.confirmCanPage,
  },
  {
    name: "A store's owners",
    action: SET_DATA_STORE_OWNERS_TOOL_NAME,
    madeByEveryCall: true,
    card: ASK_AI_CARD,
    product: DATA_SECURITY_PRODUCT,
    records: [
      {
        tableName: "DataStoreOwnerUser",
        writes: ALL_ALWAYS_ASK_WRITES,
        written: "any create, update or delete",
        page: AlwaysAskPage.DataStoreOwners,
      },
      {
        tableName: "DataStoreOwnerTeam",
        writes: ALL_ALWAYS_ASK_WRITES,
        written: "any create, update or delete",
        page: AlwaysAskPage.DataStoreOwners,
      },
    ],
    asksBecause: AI_DATA_SECURITY_ACTION_ASKS_BECAUSE.owners,
  },
  {
    /*
     * A rule saved: one made, or what one says changed - which is saving
     * the rule it then is. Its name and description, or turning it off,
     * change no store it matches or breaks.
     */
    name: "A rule saved",
    action: SAVE_DATA_SECURITY_RULE_TOOL_NAME,
    madeByEveryCall: true,
    card: ASK_AI_CARD,
    product: DATA_SECURITY_PRODUCT,
    records: [
      {
        tableName: DATA_SECURITY_RESIDENCY_RULE,
        writes: [AlwaysAskWrite.Create],
        written: "a create",
        page: AlwaysAskPage.ResidencyRules,
      },
      {
        tableName: DATA_SECURITY_RESIDENCY_RULE,
        writes: [AlwaysAskWrite.Update],
        columns: RESIDENCY_RULE_TERMS,
        makesIt: savesRuleTerms(RESIDENCY_RULE_TERMS),
        written:
          "an update of dataCategories, subjectCountries or allowedRegions, or one that turns isEnabled on",
        page: AlwaysAskPage.ResidencyRules,
      },
      {
        tableName: "DataStoreOwnerRule",
        writes: [AlwaysAskWrite.Create],
        written: "a create",
        page: AlwaysAskPage.OwnerRules,
      },
      {
        tableName: "DataStoreOwnerRule",
        writes: [AlwaysAskWrite.Update],
        columns: OWNER_RULE_TERMS,
        makesIt: savesRuleTerms(OWNER_RULE_TERMS),
        written:
          "an update of the stores it matches, its owners or notifyOwners, or one that turns isEnabled on",
        page: AlwaysAskPage.OwnerRules,
      },
      {
        tableName: "DataStoreLabelRule",
        writes: [AlwaysAskWrite.Create],
        written: "a create",
        page: AlwaysAskPage.LabelRules,
      },
      {
        tableName: "DataStoreLabelRule",
        writes: [AlwaysAskWrite.Update],
        columns: LABEL_RULE_TERMS,
        makesIt: savesRuleTerms(LABEL_RULE_TERMS),
        written:
          "an update of the stores it matches or labelsToAdd, or one that turns isEnabled on",
        page: AlwaysAskPage.LabelRules,
      },
    ],
    asksBecause: AI_DATA_SECURITY_ACTION_ASKS_BECAUSE.rule,
  },
  {
    name: "A proposal decided",
    action: DECIDE_DATA_SECURITY_PROPOSAL_TOOL_NAME,
    madeByEveryCall: true,
    card: ASK_AI_CARD,
    product: DATA_SECURITY_PRODUCT,
    records: [
      {
        tableName: "DataSecurityAiProposal",
        writes: ALL_ALWAYS_ASK_WRITES,
        written: "any create, update or delete",
        page: AlwaysAskPage.DataSecurityAi,
      },
    ],
    asksBecause: AI_DATA_SECURITY_ACTION_ASKS_BECAUSE.proposal,
  },
  {
    /*
     * What approving a Turn Off Data Type proposal writes
     * (Server/Utils/AI/DataSecurity/Actions/ScanTuningActions): the
     * setting's list of data types no scan looks for, one longer.
     */
    name: "A data type turned off",
    action: DECIDE_DATA_SECURITY_PROPOSAL_TOOL_NAME,
    madeByEveryCall: false,
    card: PROPOSAL_CARD,
    product: DATA_SECURITY_PRODUCT,
    records: [
      {
        tableName: "DataSecuritySetting",
        writes: [AlwaysAskWrite.Create, AlwaysAskWrite.Update],
        columns: ["disabledDataTypeIds"],
        comparesWith: ["disabledDataTypeIds"],
        makesIt: addsToList("disabledDataTypeIds", holdsDataType),
        written:
          "a write of disabledDataTypeIds that adds a data type the setting does not turn off yet",
        page: AlwaysAskPage.DataTypes,
      },
    ],
    asksBecause:
      "Asks first in every mode: a scan that stops looking for a data type misses the real data that comes later.",
  },
  {
    /*
     * What approving an Add Scan Exclusion proposal writes: the store's
     * list of places its scans leave out, one longer.
     */
    name: "A place left out of a store's scans",
    action: DECIDE_DATA_SECURITY_PROPOSAL_TOOL_NAME,
    madeByEveryCall: false,
    card: PROPOSAL_CARD,
    product: DATA_SECURITY_PRODUCT,
    records: [
      {
        tableName: "DataStore",
        writes: [AlwaysAskWrite.Create, AlwaysAskWrite.Update],
        columns: ["scanExclusions"],
        comparesWith: ["scanExclusions"],
        makesIt: addsToList("scanExclusions", isExcludedAlready),
        written:
          "a write of scanExclusions that adds a place the store's scans do not leave out yet",
        page: AlwaysAskPage.DataStoreSettings,
      },
    ],
    asksBecause:
      "Asks first in every mode: a scan that leaves a place out misses the real data that comes later.",
  },
  {
    name: "A scrub something reads",
    action: SCRUB_DATA_SECURITY_FINDING_TOOL_NAME,
    madeByEveryCall: true,
    card: ASK_AI_CARD,
    product: DATA_SECURITY_PRODUCT,
    records: [
      {
        tableName: "LogScrubRule",
        writes: [AlwaysAskWrite.Create, AlwaysAskWrite.Update],
        written:
          "a create or an update, since what reads what it hides is not checked here",
        page: AlwaysAskPage.DataStoreFindings,
      },
      {
        tableName: "TraceScrubRule",
        writes: [AlwaysAskWrite.Create, AlwaysAskWrite.Update],
        written:
          "a create or an update, since what reads what it hides is not checked here",
        page: AlwaysAskPage.DataStoreFindings,
      },
    ],
    onlyWhen: AlwaysAskCondition.SomethingReadsWhatItHides,
    asksBecause: AI_DATA_SECURITY_ACTION_ASKS_BECAUSE.scrubIsRead,
  },
  {
    name: "A response on a store",
    action: RESPOND_ON_DATA_STORE_TOOL_NAME,
    madeByEveryCall: true,
    card: ASK_AI_CARD,
    product: DATA_SECURITY_PRODUCT,
    records: [],
    asksBecause: AI_DATA_SECURITY_ACTION_ASKS_BECAUSE.respond,
    madeOutsideOneUptime:
      "It changes the store's settings in its cloud, through the store's cloud connection: no write of a OneUptime record makes it. A playbook's step can, and is held to its approval (below).",
  },
  {
    /*
     * A containment step - a user suspended, a host isolated, an address
     * blocked - waits for a person's approval in the playbook's run, and
     * only a Security Admin, in OneUptime, lets one run without it
     * (SecurityPlaybookService); a response on a store's cloud waits too
     * unless its author turned that off. An agent saving such a step with
     * nobody's approval, or putting a playbook that has one to work on
     * more cases, makes the change the approval stands for.
     */
    name: "A playbook's containment or store response run with nobody's approval",
    madeByEveryCall: false,
    card: "the step's approval in the playbook's run, which only a person in OneUptime turns off",
    product: "Security Events",
    records: [
      {
        tableName: "SecurityPlaybook",
        writes: [AlwaysAskWrite.Create, AlwaysAskWrite.Update],
        columns: ["steps", ...PLAYBOOK_REACH_COLUMNS],
        comparesWith: ["steps"],
        makesIt: letsAGuardedStepRunUnapproved,
        written:
          "a write of steps that saves a containment step, or a response on a data store, without requiresApproval where the playbook did not hold it so, or a change of trigger, minimum priority, detection source or rules, or turning isEnabled on, for a playbook with such a step",
        page: AlwaysAskPage.SecurityPlaybook,
      },
    ],
    asksBecause:
      "Asks first in every mode: a containment step, or a response on a data store, waits for a person's approval in the playbook's run unless a person turns that off in OneUptime.",
  },
  {
    /*
     * A label whose name says production holds every cloud resource it is
     * on back from an off-hours schedule's stop and an AI rule's change
     * made without asking, whatever the resource's tags and account say
     * (#11347). Renamed to a name that does not say production, or
     * deleted, it lets every one of them go at once, with no resource in
     * sight: a person does that on Project Settings > Labels. Ask AI has
     * no action that renames or deletes a label.
     */
    name: "A label that says production renamed or deleted",
    madeByEveryCall: false,
    card: "the person's own edit, on Project Settings > Labels",
    product: "Project Settings",
    records: [
      {
        tableName: LABEL_TABLE_NAME,
        writes: [AlwaysAskWrite.Update],
        columns: ["name"],
        comparesWith: ["name"],
        makesIt: letsGoOfProduction,
        written:
          'an update of name, of a label whose name says production (such as "Production", "prod" or "env: live"), to a name that does not',
        page: AlwaysAskPage.Labels,
      },
      {
        tableName: LABEL_TABLE_NAME,
        writes: [AlwaysAskWrite.Delete],
        columns: ["name"],
        comparesWith: ["name"],
        makesIt: letsGoOfProduction,
        written: "a delete of a label whose name says production",
        page: AlwaysAskPage.Labels,
      },
    ],
    asksBecause:
      "Asks first in every mode: a label whose name says production holds the cloud resources it is on back from off-hours schedules and from AI rules that act without asking.",
  },
];

// The Ask AI actions that ask in every mode for at least one change.
export const ALWAYS_ASK_ACTIONS: ReadonlyArray<string> = Array.from(
  new Set(
    ALWAYS_ASK_CHANGES.map((change: AlwaysAskChange): string | undefined => {
      return change.action;
    }).filter((action: string | undefined): action is string => {
      return Boolean(action);
    }),
  ),
);

// A change a write makes, and which of its record's writes it is.
export interface AlwaysAskWriteFound {
  change: AlwaysAskChange;
  record: AlwaysAskRecordWrite;
}

/*
 * Every change a write of a record makes that asks a person in every mode:
 * none for an ordinary write, and more than one for a write that makes
 * several - a finding confirmed and marked not sensitive at once. Those
 * that ask wherever they are made come first, so a change that asks only
 * where something holds never stands in front of one that always asks.
 * `data` is the write's columns as its route reads them
 * (Server/Utils/Database/CrudRouteWrites); a delete has none, so a record
 * write that names its columns is judged for a delete by what the record
 * holds. `stored` is the record as it is now, for a change that compares
 * the write with it (comparesWith): a create holds nothing, and an update
 * or a delete whose record was not read is judged as if it could make the
 * change. A change that asks only where something holds (onlyWhen) is
 * found here too: the caller reads whether it holds.
 */
export function findAlwaysAskChanges(data: {
  tableName: string;
  write: AlwaysAskWrite;
  data: JSONObject | undefined;
  stored?: JSONObject | null | undefined;
}): Array<AlwaysAskWriteFound> {
  const columns: JSONObject = data.data || {};
  const stored: JSONObject | null =
    data.write === AlwaysAskWrite.Create ? {} : data.stored || null;
  const found: Array<AlwaysAskWriteFound> = [];

  for (const change of ALWAYS_ASK_CHANGES) {
    for (const record of change.records) {
      if (
        record.tableName !== data.tableName ||
        !record.writes.includes(data.write)
      ) {
        continue;
      }

      // A delete takes every column: what makes it is what the record holds.
      if (
        record.columns &&
        data.write !== AlwaysAskWrite.Delete &&
        !record.columns.some((column: string): boolean => {
          return columns[column] !== undefined;
        })
      ) {
        continue;
      }

      if (record.makesIt && !record.makesIt(columns, stored)) {
        continue;
      }

      found.push({ change, record });
    }
  }

  // Stable: the list's order among those that ask alike.
  return [
    ...found.filter((each: AlwaysAskWriteFound): boolean => {
      return !each.change.onlyWhen;
    }),
    ...found.filter((each: AlwaysAskWriteFound): boolean => {
      return Boolean(each.change.onlyWhen);
    }),
  ];
}

// The first change a write makes that asks a person (findAlwaysAskChanges), or null.
export function findAlwaysAskChange(data: {
  tableName: string;
  write: AlwaysAskWrite;
  data: JSONObject | undefined;
  stored?: JSONObject | null | undefined;
}): AlwaysAskWriteFound | null {
  return findAlwaysAskChanges(data)[0] || null;
}

/*
 * Whether a write asks a person in every mode wherever it is made: a
 * change that asks only where something holds is left to what its card
 * reads (Ask AI's prepare, the MCP server's read of the project).
 */
export function writeAlwaysAsks(data: {
  tableName: string;
  write: AlwaysAskWrite;
  data: JSONObject | undefined;
  stored?: JSONObject | null | undefined;
}): boolean {
  return findAlwaysAskChanges(data).some(
    (found: AlwaysAskWriteFound): boolean => {
      return !found.change.onlyWhen;
    },
  );
}

/*
 * Whether an action asks in every mode whatever it is called with: every
 * call of it makes a change that asks wherever it is made - a store's
 * owners, a rule saved. A scrub, which asks only where something reads
 * what it hides, is left to its card; an action whose call decides -
 * Accept Risk asks, Reopen does not - asks by the write the call makes
 * (writeAlwaysAsks).
 */
export function actionAlwaysAsks(action: string): boolean {
  return ALWAYS_ASK_CHANGES.some((change: AlwaysAskChange): boolean => {
    return (
      change.action === action && change.madeByEveryCall && !change.onlyWhen
    );
  });
}

// The changes on one record's table: what its tools refuse, for the docs and the describe tool.
export function getAlwaysAskChangesOfTable(
  tableName: string,
): Array<AlwaysAskWriteFound> {
  const found: Array<AlwaysAskWriteFound> = [];

  for (const change of ALWAYS_ASK_CHANGES) {
    for (const record of change.records) {
      if (record.tableName === tableName) {
        found.push({ change, record });
      }
    }
  }

  return found;
}

/*
 * Whether a project's Data Security pages someone for a Critical issue -
 * an alert raised or an incident declared - so that confirming a finding,
 * which can open one, could wake them (CriticalIssuesPage).
 */
export function doCriticalIssuesPage(
  setting:
    | {
        raiseAlertsForCriticalIssues?: boolean | undefined | null;
        declareIncidentsForCriticalIssues?: boolean | undefined | null;
      }
    | null
    | undefined,
): boolean {
  return Boolean(
    toStoredBoolean(setting?.raiseAlertsForCriticalIssues) === true ||
      toStoredBoolean(setting?.declareIncidentsForCriticalIssues) === true,
  );
}

/*
 * Why a change that asks in every mode is refused where nobody can be
 * asked, and where to make it: the card's reason, then the page. Its
 * opening is ASKS_IN_EVERY_MODE_REFUSAL_PREFIX, which the MCP server reads
 * to tell its agent not to retry, nor to make the change another way. The
 * Data Security tools are refused in it (DataSecurityActionRunner), and so
 * is a record's write that makes the same change (AlwaysAskWrites).
 */
export function getAsksInEveryModeRefusal(data: {
  action: string;
  reason: string | undefined;
  pageUrl: string | null;
  // Whose button the person presses where no page is known: Data Security's, unless said.
  product?: string | undefined;
  /*
   * Whether an action of Ask AI's makes the change behind its card: left
   * out, one does. A change none makes - a playbook's step run with
   * nobody's approval, a label renamed - is made with the page's own
   * controls, and the refusal sends the person to those alone.
   */
  byAskAi?: boolean | undefined;
}): string {
  const reason: string = data.reason ? ` ${data.reason}` : "";
  const product: string = data.product || DATA_SECURITY_PRODUCT;
  // "Data Security's", and "Security Events'", "Project Settings'".
  const owned: string = product.endsWith("s") ? `${product}'` : `${product}'s`;
  const byAskAi: boolean = data.byAskAi !== false;
  let where: string;

  if (data.pageUrl) {
    where = byAskAi
      ? ` Do it in OneUptime, on ${data.pageUrl}, with the page's own button or with Ask AI there, which shows the change on a card for the person to approve.`
      : ` Do it in OneUptime, on ${data.pageUrl}, with the page's own controls: the person makes it there.`;
  } else {
    where = byAskAi
      ? ` Do it in OneUptime, with ${owned} own button or with Ask AI, which shows the change on a card for the person to approve.`
      : ` Do it in OneUptime, with ${owned} own controls: the person makes it there.`;
  }

  return `${ASKS_IN_EVERY_MODE_REFUSAL_PREFIX}${reason} An MCP client shows no card OneUptime can wait on, so ${data.action} is not run here.${where}`;
}
