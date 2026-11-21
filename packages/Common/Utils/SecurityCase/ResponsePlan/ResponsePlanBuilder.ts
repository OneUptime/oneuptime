import { parseInvestigationReport } from "../../AI/InvestigationReport";
import {
  getRequestOutcomeSummary,
  RequestOutcomeSummary,
  RequestOutcomeSummaryKind,
} from "../RequestOutcomeSummary";
import {
  CaseClaimedClientAddress,
  getCaseClaimedClientAddress,
  getCaseClaimedOnlyAddresses,
} from "../CaseClaimedClientAddress";
import {
  SecurityAddressScope,
  canonicalAddress,
  getSecurityAddressScope,
} from "../SecurityConnectionMatch";
import { isSecurityCaseTriageDecisionLine } from "../../../Server/Utils/AI/Security/SecurityCaseTriageDecision";
import {
  ResponseEventsLink,
  ResponseLinkKind,
  ResponseTracesLink,
} from "../../../Types/SecurityCase/SecurityCaseResponseLink";
import {
  SecurityCaseMatchedDetectionJson,
  SecurityCaseMatchedEventJson,
  SecurityCaseMatchesJson,
  getDetectionEntity,
  getOpeningMatchedDetection,
} from "../../../Types/SecurityCase/SecurityCaseMatches";
import SecurityCaseStage, {
  SECURITY_CASE_STAGES,
} from "../../../Types/SecurityCase/SecurityCaseStage";
import SecurityCaseStepCheckState, {
  isStepCheckDone,
} from "../../../Types/SecurityCase/SecurityCaseStepCheckState";
import SecurityDetectionSource from "../../../Types/SecurityCase/SecurityDetectionSource";
import {
  SecurityEntity,
  SecurityEntityType,
} from "../../../Types/SecurityCase/SecurityEntity";
import { getDetectionExceptionEntity } from "../../../Types/SecurityEvent/DetectionRuleException";
import {
  DetectionRuleResponsePhase,
  DetectionRuleResponseStep,
  getDetectionRuleResponseStepKey,
} from "../../../Types/SecurityEvent/DetectionRuleResponseSteps";
import { SECURITY_REQUEST_ATTRIBUTES } from "../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import { SecurityPlaybookActionType } from "../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import SecurityPlaybookRunStatus from "../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import {
  HiddenClientAddress,
  getCaseHiddenClientAddress,
} from "../../SecurityEvent/ScrubbedAddress";
import {
  RESPONSE_STEP_KINDS,
  getResponseStepKey,
  hashText,
} from "./ResponsePlanKeys";
import {
  getDetectionEventsLink,
  getRequestTracesLink,
} from "./ResponsePlanLinks";
import {
  RESPONSE_PHASES,
  ResponseAction,
  ResponseActionKind,
  ResponseAddressBlock,
  ResponseAddressBlocking,
  ResponsePhase,
  ResponsePlan,
  ResponsePlaybook,
  ResponsePlaybookRunState,
  ResponseStep,
  ResponseStepCheck,
  ResponseStepCompletion,
  ResponseTask,
  ResponseText,
} from "./ResponsePlanTypes";
import {
  SecurityBlockValue,
  findCoveringSecurityBlock,
  readSecurityBlockValue,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
import {
  OneStepRunRead,
  readOneStepRun,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookOneStepRun";
import {
  ACTION_ADD_EXCEPTION,
  ACTION_ASSIGN_TO_ME,
  ACTION_BLOCK_FOR_A_DAY,
  ACTION_CLOSE_CASE,
  ACTION_DECLARE_INCIDENT,
  ACTION_MARK_CONTAINED,
  ACTION_OPEN_EVENTS,
  ACTION_OPEN_SCRUB_RULES,
  ACTION_OPEN_TRACES,
  ACTION_RUN_PLAYBOOK,
  ADDRESS_HIDDEN_FROM_CASE,
  ADDRESS_HIDDEN_FROM_CASE_BY_RULE,
  CLAIMED_ADDRESS_NOT_VERIFIED,
  CLAIMED_NOT_VERIFIED,
  REQUESTS_ALL_TURNED_AWAY,
  REQUESTS_GOT_THROUGH,
  STEP_AI_PLAYBOOK,
  STEP_BLOCK_AT_DESTINATIONS,
  STEP_BLOCK_DOMAIN,
  STEP_BLOCK_FAILED,
  STEP_BLOCK_PUBLIC_IP,
  STEP_BLOCK_RUNNING,
  STEP_BLOCK_WAITING,
  STEP_CLOSE,
  STEP_CONTAIN_HOST,
  STEP_CONTAIN_HOST_PLAYBOOK,
  STEP_CONTAIN_USER,
  STEP_CONTAIN_USER_PLAYBOOK,
  STEP_DECLARE_INCIDENT,
  STEP_FALSE_POSITIVE,
  STEP_FALSE_POSITIVE_VALUE,
  STEP_FIND_HIDDEN_ADDRESS,
  STEP_FIX_ACCOUNT_CHANGES,
  STEP_FIX_BRUTE_FORCE,
  STEP_FIX_C2,
  STEP_FIX_CREDENTIALS,
  STEP_FIX_CREDENTIALS_VALUE,
  STEP_FIX_DATA,
  STEP_FIX_DEFENSES,
  STEP_FIX_DISCOVERY,
  STEP_FIX_EXECUTION,
  STEP_FIX_GENERAL,
  STEP_FIX_IMPACT,
  STEP_FIX_LATERAL,
  STEP_FIX_PERSISTENCE,
  STEP_FIX_PRIVILEGE,
  STEP_FIX_PUBLIC_APP,
  STEP_FIX_PUBLIC_APP_ROUTE,
  STEP_ISOLATE_PRIVATE_IP,
  STEP_MARK_CONTAINED,
  STEP_QUARANTINE_FILE,
  STEP_REQUESTS_THROUGH,
  STEP_REQUESTS_TURNED_AWAY,
  STEP_REQUESTS_UNKNOWN,
  STEP_RUN_FAILED,
  STEP_RUN_RUNNING,
  STEP_RUN_WAITING,
  STEP_TAKE,
} from "./ResponsePlanWords";

/*
 * A CASE'S RESPONSE PLAN: what to do about it now, most urgent first
 * (#9557). One builder for every reader of it (#10340): the Dashboard's card
 * draws it, the server checks its steps itself, and OneUptime AI and the
 * mobile app read the same plan. React-free and routes-free - a step's link
 * is a descriptor each reader opens its own way - so every rule of it is
 * pinned in a plain test.
 *
 *   Confirm   take the case; find out how far its requests got (from the
 *             events its detection matched); rule out a false positive -
 *             with what the rule's own YAML says it also fires on, and an
 *             exception one click away;
 *   Contain   for each thing the case is about, what stops it doing harm:
 *             block an address, suspend an account, cut a host off the
 *             network - through one of the project's playbooks when one
 *             does it, by hand where OneUptime cannot (there is no
 *             firewall OneUptime blocks an address in); run the playbook
 *             OneUptime AI suggests; declare an incident; mark the case
 *             Contained;
 *   Fix       what let it happen, from the ATT&CK tactics and techniques
 *             its detections map to: the route the requests went to, the
 *             accounts a brute force went after, what an attacker set to
 *             run again;
 *   Close     close the case with a verdict.
 *
 * OneUptime AI's triage adds its own suggested next steps, in its words.
 *
 * The rules behind the case's detections add their own (#9621): the steps
 * their authors wrote, in their words, first in the part of the plan each
 * goes under - after taking the case, which comes first whatever the case
 * is. A rule that says how to fix what let it happen is followed: its Fix
 * steps take the place of the general ones the tactics give.
 *
 * A step is done when the case says so - assigned, an incident declared, a
 * playbook run, contained, closed - or when somebody ticks it off, which
 * makes it one of the case's tasks, keyed by the step (a task's
 * responseStepKey), so the plan knows it again in any language. A step
 * OneUptime checked itself and verified - or found not needed - is done by
 * that check (SecurityCaseStepCheck): a tick is a promise, a check is what
 * OneUptime sees.
 */

// The most things the Contain steps are about.
export const RESPONSE_MAX_CONTAIN_ENTITIES: number = 4;

// The most Fix steps the tactics give, beside a public app's.
export const RESPONSE_MAX_FIX_STEPS: number = 2;

// The most of OneUptime AI's suggested steps, and the longest of them.
export const RESPONSE_MAX_AI_STEPS: number = 5;
export const RESPONSE_AI_STEP_MAX_LENGTH: number = 300;

// The most of the rules' own steps a plan shows, the opening rule's first.
export const RESPONSE_MAX_RULE_STEPS: number = 10;

// The playbook actions that contain an account, and a host.
export const USER_CONTAINMENT_ACTIONS: ReadonlyArray<string> = [
  SecurityPlaybookActionType.SuspendOktaUser,
  SecurityPlaybookActionType.EndOktaSessions,
  SecurityPlaybookActionType.DisableEntraIdUser,
  SecurityPlaybookActionType.SignOutEntraIdUser,
  SecurityPlaybookActionType.SuspendGoogleWorkspaceUser,
  SecurityPlaybookActionType.SignOutGoogleWorkspaceUser,
];

export const HOST_CONTAINMENT_ACTIONS: ReadonlyArray<string> = [
  SecurityPlaybookActionType.ContainCrowdStrikeHost,
  SecurityPlaybookActionType.IsolateDefenderDevice,
];

export interface ResponsePlanInput {
  // The case's entities, the most telling first.
  entities: Array<SecurityEntity>;
  // ATT&CK ids its detections map to: TA0001, T1190, T1110.001.
  mitreTactics: Array<string>;
  mitreTechniques: Array<string>;
  isAssigned: boolean;
  hasIncident: boolean;
  stage: SecurityCaseStage;
  // The project has a status that contains a case.
  hasContainedStatus: boolean;
  matches: SecurityCaseMatchesJson | null;
  // The project's playbooks that are on.
  playbooks: Array<ResponsePlaybook>;
  // The playbooks a run of which succeeded on the case, by id.
  ranPlaybookIds: Array<string>;
  /*
   * Where the case's latest run of each other playbook stands, by id:
   * waiting for approval, still running, or failed (readPlaybookRuns).
   */
  playbookRunStates?: Record<string, ResponsePlaybookRunState> | undefined;
  tasks: Array<ResponseTask>;
  ai: {
    suggestedPlaybookId?: string | undefined;
    report?: string | undefined;
  } | null;
  // What OneUptime found when it checked the case's steps itself, by step.
  checks?: Array<ResponseStepCheck> | undefined;
  /*
   * Where the project's blocklist is enforced and what it holds of the
   * case's addresses (#10342): the block step offers Block, names where it
   * holds, and is done by the case once a destination enforces it. Left
   * out, the step is one done outside OneUptime.
   */
  addressBlocking?: ResponseAddressBlocking | undefined;
}

// ---------- OneUptime AI's suggested steps ----------

const CITATIONS: RegExp = /\[(?:C\d{1,3})(?:\s*,\s*C\d{1,3})*\]/g;
const LIST_MARKER: RegExp = /^\s*(?:[-*+]|\d{1,2}[.)])\s+/;

// A line of the report as plain words: no list marker, citation, emphasis or link markup.
export function toPlainStepText(line: string): string {
  const text: string = line
    .replace(LIST_MARKER, "")
    .replace(CITATIONS, "")
    // [words](address) reads as its words.
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|__|`/g, "")
    .replace(/\s+/g, " ")
    // A citation taken out leaves no space before the stop that followed it.
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();

  return text.length > RESPONSE_AI_STEP_MAX_LENGTH
    ? `${text.slice(0, RESPONSE_AI_STEP_MAX_LENGTH - 1)}…`
    : text;
}

/*
 * The steps OneUptime AI's triage suggests, in its own words: the items of
 * its report's Suggested next steps, each once - at most
 * RESPONSE_MAX_AI_STEPS. A section written as a paragraph is one step.
 */
export function readAiSuggestedSteps(
  report: string | undefined,
): Array<string> {
  if (!report || !report.trim()) {
    return [];
  }

  const nextSteps: string | undefined =
    parseInvestigationReport(report).nextSteps;

  if (!nextSteps) {
    return [];
  }

  const lines: Array<string> = nextSteps.split("\n");
  const isList: boolean = lines.some((line: string): boolean => {
    return LIST_MARKER.test(line);
  });
  const items: Array<string> = [];

  if (isList) {
    for (const line of lines) {
      if (LIST_MARKER.test(line)) {
        items.push(line);
      } else if (line.trim() && items.length > 0) {
        // A list item's line that runs on.
        items[items.length - 1] = `${items[items.length - 1]} ${line.trim()}`;
      }
    }
  } else {
    items.push(nextSteps);
  }

  const steps: Array<string> = [];

  for (const item of items) {
    const text: string = toPlainStepText(item);

    /*
     * The triage's own decision lines - "Verdict:", "Priority:",
     * "Playbook:" - are read where the server reads them
     * (SecurityCaseTriageDecision), never a step.
     */
    if (isSecurityCaseTriageDecisionLine(text)) {
      continue;
    }

    if (
      text &&
      !steps.some((step: string): boolean => {
        return step.toLowerCase() === text.toLowerCase();
      })
    ) {
      steps.push(text);
    }

    if (steps.length >= RESPONSE_MAX_AI_STEPS) {
      break;
    }
  }

  return steps;
}

// ---------- The rules' own steps ----------

/*
 * The steps the rules behind the case's detections carry (#9621): the rule
 * of the detection that opened the case first, then the others', each step
 * once (a library step two rules share is one step), at most
 * RESPONSE_MAX_RULE_STEPS. None for a detection whose rule the reader may
 * not read.
 */
export function getRuleResponseSteps(
  matches: SecurityCaseMatchesJson | null,
): Array<DetectionRuleResponseStep> {
  if (!matches) {
    return [];
  }

  const opening: SecurityCaseMatchedDetectionJson | null =
    getOpeningMatchedDetection(matches);
  const steps: Array<DetectionRuleResponseStep> = [];
  const seen: Set<string> = new Set<string>();

  for (const detection of [
    ...(opening ? [opening] : []),
    ...matches.detections.filter(
      (candidate: SecurityCaseMatchedDetectionJson): boolean => {
        return candidate !== opening;
      },
    ),
  ]) {
    for (const step of detection.rule?.responseSteps || []) {
      if (seen.has(step.id) || steps.length >= RESPONSE_MAX_RULE_STEPS) {
        continue;
      }

      seen.add(step.id);
      steps.push(step);
    }
  }

  return steps;
}

// ---------- What the case is about ----------

/*
 * The things the Contain steps are about: the entity the opening detection
 * is about first, then the case's own, each once (whatever its case), only
 * the kinds a step acts on, at most RESPONSE_MAX_CONTAIN_ENTITIES.
 */
export function getContainEntities(data: {
  opening: SecurityCaseMatchedDetectionJson | null;
  entities: Array<SecurityEntity>;
}): Array<SecurityEntity> {
  const containable: ReadonlyArray<SecurityEntityType> = [
    SecurityEntityType.IpAddress,
    SecurityEntityType.User,
    SecurityEntityType.Host,
    SecurityEntityType.Domain,
    SecurityEntityType.FileHash,
  ];
  const picked: Array<SecurityEntity> = [];
  const seen: Set<string> = new Set<string>();
  const first: SecurityEntity | null = data.opening
    ? getDetectionEntity(data.opening)
    : null;

  for (const entity of [...(first ? [first] : []), ...data.entities]) {
    const value: string = (entity.value || "").trim();
    const key: string = value.toLowerCase();

    if (
      !value ||
      seen.has(key) ||
      !containable.includes(entity.type) ||
      (entity.type === SecurityEntityType.IpAddress &&
        getSecurityAddressScope(value) === SecurityAddressScope.Local)
    ) {
      continue;
    }

    seen.add(key);
    picked.push({ type: entity.type, value });

    if (picked.length >= RESPONSE_MAX_CONTAIN_ENTITIES) {
      break;
    }
  }

  return picked;
}

// The first of the playbooks that does one of these actions: the one OneUptime AI suggested, if it does.
export function findPlaybookDoing(data: {
  playbooks: Array<ResponsePlaybook>;
  actions: ReadonlyArray<string>;
  preferredId?: string | undefined;
}): ResponsePlaybook | null {
  const doing: Array<ResponsePlaybook> = data.playbooks.filter(
    (playbook: ResponsePlaybook): boolean => {
      return playbook.actions.some((action: string): boolean => {
        return data.actions.includes(action);
      });
    },
  );

  return (
    doing.find((playbook: ResponsePlaybook): boolean => {
      return playbook.id === data.preferredId;
    }) ||
    doing[0] ||
    null
  );
}

/*
 * The path the matched requests went to, the one most of them went to:
 * their route, else their address without its query.
 */
export function getRequestedRoute(
  events: ReadonlyArray<SecurityCaseMatchedEventJson>,
): string {
  const counts: Map<string, number> = new Map();

  for (const event of events) {
    const route: string = (
      event.attributes[SECURITY_REQUEST_ATTRIBUTES.route] || ""
    ).trim();
    const address: string = (
      event.attributes[SECURITY_REQUEST_ATTRIBUTES.url] || ""
    ).trim();
    let path: string = route || address;

    if (!path) {
      continue;
    }

    // An address's path, without its scheme, host or query.
    const schemeEnd: number = path.indexOf("://");

    if (schemeEnd !== -1) {
      const pathStart: number = path.indexOf("/", schemeEnd + 3);
      path = pathStart === -1 ? "/" : path.slice(pathStart);
    }

    const queryStart: number = path.search(/[?#]/);

    if (queryStart !== -1) {
      path = path.slice(0, queryStart);
    }

    if (path) {
      counts.set(path, (counts.get(path) || 0) + 1);
    }
  }

  let best: string = "";
  let bestCount: number = 0;

  for (const [path, count] of counts.entries()) {
    if (count > bestCount) {
      best = path;
      bestCount = count;
    }
  }

  return best.length > 200 ? `${best.slice(0, 199)}…` : best;
}

// ---------- Fix steps, from what the attack was ----------

interface FixRule {
  key: string;
  // Any of these ATT&CK ids: a tactic, a technique (and its sub-techniques).
  ids: ReadonlyArray<string>;
  text: (entities: Array<SecurityEntity>) => ResponseText;
}

function userOf(entities: Array<SecurityEntity>): string {
  return (
    entities.find((entity: SecurityEntity): boolean => {
      return entity.type === SecurityEntityType.User;
    })?.value || ""
  );
}

// In the order they matter: what does the most harm first.
const FIX_RULES: ReadonlyArray<FixRule> = [
  {
    key: "fix:impact",
    ids: ["TA0040", "T1485", "T1486", "T1490", "T1496"],
    text: (): ResponseText => {
      return { template: STEP_FIX_IMPACT, values: {} };
    },
  },
  {
    key: "fix:data",
    ids: ["TA0010", "TA0009", "T1530", "T1537", "T1567", "T1048"],
    text: (): ResponseText => {
      return { template: STEP_FIX_DATA, values: {} };
    },
  },
  {
    key: "fix:c2",
    ids: ["TA0011", "T1095", "T1105"],
    text: (): ResponseText => {
      return { template: STEP_FIX_C2, values: {} };
    },
  },
  {
    key: "fix:execution",
    ids: ["TA0002", "T1059", "T1053", "T1569", "T1204", "T1609", "T1610"],
    text: (): ResponseText => {
      return { template: STEP_FIX_EXECUTION, values: {} };
    },
  },
  {
    key: "fix:account-changes",
    ids: ["T1098", "T1136", "T1556"],
    text: (): ResponseText => {
      return { template: STEP_FIX_ACCOUNT_CHANGES, values: {} };
    },
  },
  {
    key: "fix:persistence",
    ids: ["TA0003", "T1543", "T1547"],
    text: (): ResponseText => {
      return { template: STEP_FIX_PERSISTENCE, values: {} };
    },
  },
  {
    key: "fix:privilege",
    ids: ["TA0004", "T1548", "T1611"],
    text: (): ResponseText => {
      return { template: STEP_FIX_PRIVILEGE, values: {} };
    },
  },
  {
    key: "fix:brute-force",
    ids: ["T1110", "T1621"],
    text: (): ResponseText => {
      return { template: STEP_FIX_BRUTE_FORCE, values: {} };
    },
  },
  {
    key: "fix:credentials",
    ids: ["TA0006", "T1078", "T1003", "T1552", "T1528"],
    text: (entities: Array<SecurityEntity>): ResponseText => {
      const user: string = userOf(entities);

      return user
        ? { template: STEP_FIX_CREDENTIALS_VALUE, values: { value: user } }
        : { template: STEP_FIX_CREDENTIALS, values: {} };
    },
  },
  {
    key: "fix:defenses",
    ids: ["TA0112", "TA0005", "T1562", "T1685", "T1070"],
    text: (): ResponseText => {
      return { template: STEP_FIX_DEFENSES, values: {} };
    },
  },
  {
    key: "fix:lateral",
    ids: ["TA0008"],
    text: (): ResponseText => {
      return { template: STEP_FIX_LATERAL, values: {} };
    },
  },
  {
    key: "fix:discovery",
    ids: ["TA0007", "TA0043", "T1046", "T1018"],
    text: (): ResponseText => {
      return { template: STEP_FIX_DISCOVERY, values: {} };
    },
  },
];

// Whether the case's ATT&CK ids hold one of these: a technique counts its sub-techniques.
function holdsAttackId(
  caseIds: ReadonlyArray<string>,
  ids: ReadonlyArray<string>,
): boolean {
  return caseIds.some((caseId: string): boolean => {
    const id: string = caseId.trim().toUpperCase();

    return ids.some((wanted: string): boolean => {
      return id === wanted || id.startsWith(`${wanted}.`);
    });
  });
}

// ---------- The plan ----------

// A step as the plan adds it, before what the case and its tasks say of it.
interface StepToAdd {
  key: string;
  phase: ResponsePhase;
  text: ResponseText;
  aiText?: string | undefined;
  ruleText?: string | undefined;
  detail?: ResponseText | undefined;
  isDetailWarning?: boolean | undefined;
  quotes?: Array<string> | undefined;
  isOutsideOneUptime?: boolean | undefined;
  copyValue?: string | undefined;
  action?: ResponseAction | undefined;
  addressBlock?: ResponseAddressBlock | undefined;
  isBlockHelpShown?: boolean | undefined;
  // The case says it is done: it is assigned, contained, a playbook ran.
  isDoneByCase?: boolean | undefined;
  /*
   * Only the case can say it is done - who has it, whether it is contained
   * or closed, whether an incident was declared - so nobody ticks it off.
   * Every other step is ticked off by hand too: a host can be cut off
   * without the playbook.
   */
  isOnlyDoneByCase?: boolean | undefined;
}

function hasReached(
  stage: SecurityCaseStage,
  wanted: SecurityCaseStage,
): boolean {
  return (
    SECURITY_CASE_STAGES.indexOf(stage) >= SECURITY_CASE_STAGES.indexOf(wanted)
  );
}

// The action that opens a link: none without one.
function openAction(
  title: string,
  link: ResponseTracesLink | ResponseEventsLink | null,
): ResponseAction | undefined {
  return link ? { kind: ResponseActionKind.OpenRoute, title, link } : undefined;
}

/*
 * The steps that contain the threat: the plan's Contain steps but Mark as
 * Contained itself, and Declare Incident - which is for when customers are
 * affected, not every case, so it never holds containment up.
 */
export function getContainmentSteps(
  steps: ReadonlyArray<ResponseStep>,
): Array<ResponseStep> {
  return steps.filter((step: ResponseStep): boolean => {
    return (
      step.phase === ResponsePhase.Contain &&
      step.key !== getResponseStepKey(RESPONSE_STEP_KINDS.markContained) &&
      step.key !== getResponseStepKey(RESPONSE_STEP_KINDS.incident)
    );
  });
}

/*
 * The block step of a public address, where the plan knows the project's
 * blocklist (#10342):
 *
 *   - a block on the Blocklist holds the address: the step draws it, with
 *     where it is enforced and a Lift, and is done by the case once a
 *     destination enforces it - never while nothing does;
 *   - a destination enforces the blocklist: the step names where the block
 *     would hold, and blocks the address in one click - Block for 24 Hours,
 *     with the rest beside it - unless a block of it from the case is
 *     waiting for approval or running;
 *   - nothing does: the step is to block it where the address reaches the
 *     app, with how to connect what would let OneUptime do it, and how to
 *     do it by hand. Never "Outside OneUptime": OneUptime can do it once
 *     a destination is connected.
 */
export function getBlockAddressStep(data: {
  value: string;
  blocking: ResponseAddressBlocking;
}): StepToAdd {
  const key: string = getResponseStepKey(RESPONSE_STEP_KINDS.blockIp, data.value);
  const address: string = canonicalAddress(data.value) || data.value.trim();
  const read: SecurityBlockValue | null = readSecurityBlockValue(address);
  const block: ResponseAddressBlock | null = read
    ? findCoveringSecurityBlock(read, data.blocking.blocks)
    : null;
  const destinations: Array<string> = data.blocking.destinations;
  const text: ResponseText =
    destinations.length > 0
      ? {
          template: STEP_BLOCK_AT_DESTINATIONS,
          values: { value: data.value },
          lists: { destinations },
        }
      : { template: STEP_BLOCK_PUBLIC_IP, values: { value: data.value } };

  if (block) {
    return {
      key,
      phase: ResponsePhase.Contain,
      text,
      addressBlock: block,
      // Done once a destination holds it: a block nothing enforces blocks nothing.
      isDoneByCase: block.enforcedAt.length > 0,
    };
  }

  if (destinations.length === 0) {
    return {
      key,
      phase: ResponsePhase.Contain,
      text,
      copyValue: data.value,
      isBlockHelpShown: true,
    };
  }

  const runState: ResponsePlaybookRunState | undefined =
    data.blocking.runStates?.[address];

  return {
    key,
    phase: ResponsePhase.Contain,
    text,
    ...(runState === ResponsePlaybookRunState.Waiting
      ? { detail: { template: STEP_BLOCK_WAITING, values: {} } }
      : runState === ResponsePlaybookRunState.Running
        ? { detail: { template: STEP_BLOCK_RUNNING, values: {} } }
        : runState === ResponsePlaybookRunState.Failed
          ? {
              detail: { template: STEP_BLOCK_FAILED, values: {} },
              isDetailWarning: true,
            }
          : {}),
    action:
      runState === ResponsePlaybookRunState.Waiting ||
      runState === ResponsePlaybookRunState.Running
        ? undefined
        : {
            kind: ResponseActionKind.BlockAddress,
            title: ACTION_BLOCK_FOR_A_DAY,
            entity: { type: SecurityEntityType.IpAddress, value: address },
          },
  };
}

/*
 * Where each one-step block of an address from the case stands (#10342),
 * by address, newest first: waiting for approval, still running, or
 * failed. A block that was made is on the Blocklist, which says the rest;
 * a cancelled or rejected one leaves the address as if never asked.
 */
export function readAddressBlockRuns(
  runs: Array<{
    securityPlaybookId?: unknown;
    status: string;
    steps?: unknown;
    stepResults?: unknown;
  }>,
): Record<string, ResponsePlaybookRunState> {
  const states: Record<string, ResponsePlaybookRunState> = {};
  // The addresses whose newest run is read: an older run of one says nothing.
  const seen: Set<string> = new Set<string>();

  for (const run of runs) {
    const read: OneStepRunRead | null = readOneStepRun(run);

    if (!read || read.action !== SecurityPlaybookActionType.BlockAddress) {
      continue;
    }

    for (const value of read.values) {
      const address: string | null = canonicalAddress(value);

      if (!address || seen.has(address)) {
        continue;
      }

      seen.add(address);

      switch (run.status) {
        case SecurityPlaybookRunStatus.WaitingForApproval:
          states[address] = ResponsePlaybookRunState.Waiting;
          break;
        case SecurityPlaybookRunStatus.Queued:
        case SecurityPlaybookRunStatus.Running:
          states[address] = ResponsePlaybookRunState.Running;
          break;
        case SecurityPlaybookRunStatus.Failed:
          states[address] = ResponsePlaybookRunState.Failed;
          break;
        default:
          // Done, cancelled or rejected: the Blocklist says the rest.
          break;
      }
    }
  }

  return states;
}

export function buildResponsePlan(input: ResponsePlanInput): ResponsePlan {
  const steps: Array<ResponseStep> = [];
  const tasksByKey: Map<string, ResponseTask> = new Map();
  const checksByKey: Map<string, ResponseStepCheck> = new Map();

  for (const task of input.tasks) {
    const key: string = task.responseStepKey.trim();

    // A key ticked twice reads as done when either task is.
    if (key && (!tasksByKey.has(key) || task.isDone)) {
      tasksByKey.set(key, task);
    }
  }

  for (const check of input.checks || []) {
    const key: string = check.stepKey.trim();

    if (key) {
      checksByKey.set(key, check);
    }
  }

  const isClosed: boolean = input.stage === SecurityCaseStage.Closed;
  const opening: SecurityCaseMatchedDetectionJson | null = input.matches
    ? getOpeningMatchedDetection(input.matches)
    : null;
  const ran: Set<string> = new Set(input.ranPlaybookIds);
  const runStates: Record<string, ResponsePlaybookRunState> =
    input.playbookRunStates || {};

  /*
   * A playbook's step is done once a run of it succeeded on the case. A run
   * still going says so, with no second Run Playbook beside it; a failed
   * one says so, and the step can be run again.
   */
  const playbookRun: (playbookId: string) => {
    isDone: boolean;
    canRun: boolean;
    detail?: ResponseText | undefined;
    isDetailWarning?: boolean | undefined;
  } = (playbookId: string) => {
    if (ran.has(playbookId)) {
      return { isDone: true, canRun: false };
    }

    switch (runStates[playbookId]) {
      case ResponsePlaybookRunState.Waiting:
        return {
          isDone: false,
          canRun: false,
          detail: { template: STEP_RUN_WAITING, values: {} },
        };
      case ResponsePlaybookRunState.Running:
        return {
          isDone: false,
          canRun: false,
          detail: { template: STEP_RUN_RUNNING, values: {} },
        };
      case ResponsePlaybookRunState.Failed:
        return {
          isDone: false,
          canRun: true,
          detail: { template: STEP_RUN_FAILED, values: {} },
          isDetailWarning: true,
        };
      default:
        return { isDone: false, canRun: true };
    }
  };
  const playbooksById: Map<string, ResponsePlaybook> = new Map(
    input.playbooks.map(
      (playbook: ResponsePlaybook): [string, ResponsePlaybook] => {
        return [playbook.id, playbook];
      },
    ),
  );

  const add: (step: StepToAdd) => void = (step: StepToAdd): void => {
    if (
      steps.some((existing: ResponseStep): boolean => {
        return existing.key === step.key;
      })
    ) {
      return;
    }

    const task: ResponseTask | undefined = step.isOnlyDoneByCase
      ? undefined
      : tasksByKey.get(step.key);
    const check: ResponseStepCheck | undefined = checksByKey.get(step.key);
    const isDoneByCase: boolean = step.isDoneByCase === true;
    const isTaskDone: boolean = Boolean(task?.isDone);
    const isCheckedByOneUptime: boolean = isStepCheckDone(check?.state);
    const completion: ResponseStepCompletion =
      isDoneByCase || step.isOnlyDoneByCase
        ? ResponseStepCompletion.ByCase
        : ResponseStepCompletion.ByTask;

    steps.push({
      key: step.key,
      phase: step.phase,
      text: step.text,
      aiText: step.aiText,
      ruleText: step.ruleText,
      detail: step.detail,
      isDetailWarning: step.isDetailWarning,
      quotes: step.quotes || [],
      isOutsideOneUptime: step.isOutsideOneUptime === true,
      copyValue: step.copyValue,
      ...(step.addressBlock ? { addressBlock: step.addressBlock } : {}),
      ...(step.isBlockHelpShown ? { isBlockHelpShown: true } : {}),
      /*
       * A closed case is done with: nothing more to press. Nor is a step the
       * case did, or one OneUptime verified - but one it found not needed
       * keeps its button: anyone can still declare an incident.
       */
      action:
        isClosed ||
        isDoneByCase ||
        check?.state === SecurityCaseStepCheckState.Verified
          ? undefined
          : step.action,
      completion,
      isDone: isDoneByCase || isTaskDone || isCheckedByOneUptime,
      taskId: task?.id,
      doneByName: task?.isDone ? task.doneByName : undefined,
      doneAt: task?.isDone ? task.doneAt : undefined,
      check,
      isCheckedByOneUptime,
    });
  };

  // The rules' own steps, each added first in its part of the plan.
  const ruleSteps: Array<DetectionRuleResponseStep> = getRuleResponseSteps(
    input.matches,
  );
  const addRuleSteps: (
    phase: DetectionRuleResponsePhase,
    planPhase: ResponsePhase,
  ) => number = (
    phase: DetectionRuleResponsePhase,
    planPhase: ResponsePhase,
  ): number => {
    let added: number = 0;

    for (const step of ruleSteps) {
      if (step.phase !== phase) {
        continue;
      }

      add({
        key: getDetectionRuleResponseStepKey(step.id),
        phase: planPhase,
        text: { template: "", values: {} },
        ruleText: step.text,
      });
      added++;
    }

    return added;
  };

  // ----- Confirm -----

  add({
    key: getResponseStepKey(RESPONSE_STEP_KINDS.take),
    phase: ResponsePhase.Confirm,
    text: { template: STEP_TAKE, values: {} },
    action: { kind: ResponseActionKind.AssignToMe, title: ACTION_ASSIGN_TO_ME },
    isDoneByCase: input.isAssigned || isClosed,
    isOnlyDoneByCase: true,
  });

  addRuleSteps(DetectionRuleResponsePhase.Confirm, ResponsePhase.Confirm);

  if (opening) {
    const outcomes: RequestOutcomeSummary = getRequestOutcomeSummary(
      opening.outcomes,
    );
    const hasTraces: boolean = opening.events.some(
      (event: SecurityCaseMatchedEventJson): boolean => {
        return Boolean(event.traceId.trim());
      },
    );

    if (outcomes.kind === RequestOutcomeSummaryKind.SomeGotThrough) {
      add({
        key: getResponseStepKey(RESPONSE_STEP_KINDS.requests),
        phase: ResponsePhase.Confirm,
        text: { template: STEP_REQUESTS_THROUGH, values: {} },
        detail: {
          template: REQUESTS_GOT_THROUGH,
          values: {},
          numbers: { through: outcomes.through },
          count: outcomes.followed,
        },
        isDetailWarning: true,
        action: openAction(
          ACTION_OPEN_TRACES,
          getRequestTracesLink({ detection: opening, onlyThrough: true }),
        ),
      });
    } else if (
      outcomes.kind === RequestOutcomeSummaryKind.AllTurnedAway &&
      opening.groupValue.trim()
    ) {
      add({
        key: getResponseStepKey(RESPONSE_STEP_KINDS.requests),
        phase: ResponsePhase.Confirm,
        text: {
          template: STEP_REQUESTS_TURNED_AWAY,
          values: { value: opening.groupValue.trim() },
        },
        detail: {
          template: REQUESTS_ALL_TURNED_AWAY,
          values: {},
          count: outcomes.followed,
        },
        action: openAction(ACTION_OPEN_EVENTS, getDetectionEventsLink(opening)),
      });
    } else if (hasTraces) {
      add({
        key: getResponseStepKey(RESPONSE_STEP_KINDS.requests),
        phase: ResponsePhase.Confirm,
        text: { template: STEP_REQUESTS_UNKNOWN, values: {} },
        action: openAction(
          ACTION_OPEN_TRACES,
          getRequestTracesLink({ detection: opening, onlyThrough: false }),
        ),
      });
    }

    // Only a rule's detection takes an exception.
    if (
      opening.source === SecurityDetectionSource.DetectionRule &&
      opening.rule
    ) {
      const entity: SecurityEntity | null = getDetectionExceptionEntity({
        groupValue: opening.groupValue,
        entities: getContainEntities({ opening, entities: input.entities }),
      });

      add({
        key: getResponseStepKey(
          RESPONSE_STEP_KINDS.falsePositive,
          opening.rule.id,
        ),
        phase: ResponsePhase.Confirm,
        text: entity
          ? {
              template: STEP_FALSE_POSITIVE_VALUE,
              values: { value: entity.value },
            }
          : { template: STEP_FALSE_POSITIVE, values: {} },
        quotes: opening.rule.falsePositives,
        action: {
          kind: ResponseActionKind.AddRuleException,
          title: ACTION_ADD_EXCEPTION,
          detectionRuleId: opening.rule.id,
          entity: entity || undefined,
        },
      });
    }
  }

  // ----- Contain -----

  addRuleSteps(DetectionRuleResponsePhase.Contain, ResponsePhase.Contain);

  const aiPlaybook: ResponsePlaybook | null = input.ai?.suggestedPlaybookId
    ? playbooksById.get(input.ai.suggestedPlaybookId) || null
    : null;
  const usedPlaybookIds: Set<string> = new Set<string>();

  /*
   * Never an address the case's requests only claimed (#10416): whoever
   * sent them wrote it - X-Forwarded-For, client.address - and blocking it
   * could block a customer, a payment provider or a crawler. The scans
   * never make one an entity; this holds whatever else names it.
   */
  const claimedOnly: Set<string> = getCaseClaimedOnlyAddresses(input.matches);
  const containEntities: Array<SecurityEntity> = getContainEntities({
    opening,
    entities: input.entities,
  }).filter((entity: SecurityEntity): boolean => {
    if (entity.type !== SecurityEntityType.IpAddress) {
      return true;
    }

    const address: string | null = canonicalAddress(entity.value);

    return !address || !claimedOnly.has(address);
  });

  for (const entity of containEntities) {
    switch (entity.type) {
      case SecurityEntityType.IpAddress: {
        const isPublic: boolean =
          getSecurityAddressScope(entity.value) === SecurityAddressScope.Public;

        if (isPublic && input.addressBlocking) {
          add(
            getBlockAddressStep({
              value: entity.value,
              blocking: input.addressBlocking,
            }),
          );
          break;
        }

        add({
          key: getResponseStepKey(
            isPublic ? RESPONSE_STEP_KINDS.blockIp : RESPONSE_STEP_KINDS.findIp,
            entity.value,
          ),
          phase: ResponsePhase.Contain,
          text: {
            template: isPublic ? STEP_BLOCK_PUBLIC_IP : STEP_ISOLATE_PRIVATE_IP,
            values: { value: entity.value },
          },
          isOutsideOneUptime: true,
          copyValue: entity.value,
        });
        break;
      }

      case SecurityEntityType.User:
      case SecurityEntityType.Host: {
        const isUser: boolean = entity.type === SecurityEntityType.User;
        const playbook: ResponsePlaybook | null = findPlaybookDoing({
          playbooks: input.playbooks,
          actions: isUser ? USER_CONTAINMENT_ACTIONS : HOST_CONTAINMENT_ACTIONS,
          preferredId: input.ai?.suggestedPlaybookId,
        });
        const key: string = getResponseStepKey(
          isUser ? RESPONSE_STEP_KINDS.user : RESPONSE_STEP_KINDS.host,
          entity.value,
        );

        if (playbook) {
          usedPlaybookIds.add(playbook.id);
          const run: ReturnType<typeof playbookRun> = playbookRun(playbook.id);

          add({
            key,
            phase: ResponsePhase.Contain,
            text: {
              template: isUser
                ? STEP_CONTAIN_USER_PLAYBOOK
                : STEP_CONTAIN_HOST_PLAYBOOK,
              values: { value: entity.value, playbook: playbook.name },
            },
            detail: run.detail,
            isDetailWarning: run.isDetailWarning,
            action: run.canRun
              ? {
                  kind: ResponseActionKind.RunPlaybook,
                  title: ACTION_RUN_PLAYBOOK,
                  playbookId: playbook.id,
                }
              : undefined,
            isDoneByCase: run.isDone,
          });
        } else {
          add({
            key,
            phase: ResponsePhase.Contain,
            text: {
              template: isUser ? STEP_CONTAIN_USER : STEP_CONTAIN_HOST,
              values: { value: entity.value },
            },
            isOutsideOneUptime: true,
            copyValue: entity.value,
          });
        }
        break;
      }

      case SecurityEntityType.Domain:
        add({
          key: getResponseStepKey(
            RESPONSE_STEP_KINDS.blockDomain,
            entity.value,
          ),
          phase: ResponsePhase.Contain,
          text: {
            template: STEP_BLOCK_DOMAIN,
            values: { value: entity.value },
          },
          isOutsideOneUptime: true,
          copyValue: entity.value,
        });
        break;

      case SecurityEntityType.FileHash:
        add({
          key: getResponseStepKey(
            RESPONSE_STEP_KINDS.quarantineFile,
            entity.value,
          ),
          phase: ResponsePhase.Contain,
          text: {
            template: STEP_QUARANTINE_FILE,
            values: { value: entity.value },
          },
          isOutsideOneUptime: true,
          copyValue: entity.value,
        });
        break;

      default:
        break;
    }
  }

  /*
   * Where the plan would say to block the address, a case whose every
   * event had its address hidden by a scrub rule says so (#10397): there is
   * no address to block here, so the step is to find it where the request
   * came in, and the line under it says which rule hid it. Once the address
   * vault names the address behind a Hash rule's token (#10395), its events
   * name it, and the plan says to block it as it does any other. No check
   * of OneUptime's reads it: a person finds the address.
   */
  const hiddenAddress: HiddenClientAddress | null = containEntities.some(
    (entity: SecurityEntity): boolean => {
      return entity.type === SecurityEntityType.IpAddress;
    },
  )
    ? null
    : getCaseHiddenClientAddress(input.matches);

  if (hiddenAddress) {
    add({
      key: getResponseStepKey(RESPONSE_STEP_KINDS.hiddenAddress),
      phase: ResponsePhase.Contain,
      text: { template: STEP_FIND_HIDDEN_ADDRESS, values: {} },
      detail: hiddenAddress.ruleName
        ? {
            template: ADDRESS_HIDDEN_FROM_CASE_BY_RULE,
            values: { rule: hiddenAddress.ruleName },
          }
        : { template: ADDRESS_HIDDEN_FROM_CASE, values: {} },
      isDetailWarning: true,
      isOutsideOneUptime: true,
      action: hiddenAddress.signal
        ? {
            kind: ResponseActionKind.OpenRoute,
            title: ACTION_OPEN_SCRUB_RULES,
            link: {
              kind: ResponseLinkKind.OpenScrubRules,
              signal: hiddenAddress.signal,
            },
          }
        : undefined,
    });
  }

  /*
   * Where the plan would say to block the address, a case whose requests
   * only claimed one says so (#10416): the address is the sender's to
   * write, so the step is to find the real one where the requests came in,
   * and the line under it names the claim as claimed, not verified. Never
   * a step to block it, and no check of OneUptime's reads it.
   */
  const claimedAddress: CaseClaimedClientAddress | null =
    hiddenAddress ||
    containEntities.some((entity: SecurityEntity): boolean => {
      return entity.type === SecurityEntityType.IpAddress;
    })
      ? null
      : getCaseClaimedClientAddress(input.matches);

  if (claimedAddress) {
    add({
      key: getResponseStepKey(RESPONSE_STEP_KINDS.claimedAddress),
      phase: ResponsePhase.Contain,
      text: { template: STEP_FIND_HIDDEN_ADDRESS, values: {} },
      detail: claimedAddress.address
        ? {
            template: CLAIMED_ADDRESS_NOT_VERIFIED,
            values: { address: claimedAddress.address },
          }
        : { template: CLAIMED_NOT_VERIFIED, values: {} },
      isDetailWarning: true,
      isOutsideOneUptime: true,
    });
  }

  /*
   * The playbook OneUptime AI suggests, unless a step above runs it: with
   * the containment steps when it contains, else with the checks.
   */
  if (aiPlaybook && !usedPlaybookIds.has(aiPlaybook.id)) {
    const contains: boolean = aiPlaybook.actions.some(
      (action: string): boolean => {
        return (
          USER_CONTAINMENT_ACTIONS.includes(action) ||
          HOST_CONTAINMENT_ACTIONS.includes(action)
        );
      },
    );

    const run: ReturnType<typeof playbookRun> = playbookRun(aiPlaybook.id);

    add({
      key: getResponseStepKey(RESPONSE_STEP_KINDS.playbook, aiPlaybook.id),
      phase: contains ? ResponsePhase.Contain : ResponsePhase.Confirm,
      text: {
        template: STEP_AI_PLAYBOOK,
        values: { playbook: aiPlaybook.name },
      },
      detail: run.detail,
      isDetailWarning: run.isDetailWarning,
      action: run.canRun
        ? {
            kind: ResponseActionKind.RunPlaybook,
            title: ACTION_RUN_PLAYBOOK,
            playbookId: aiPlaybook.id,
          }
        : undefined,
      isDoneByCase: run.isDone,
    });
  }

  add({
    key: getResponseStepKey(RESPONSE_STEP_KINDS.incident),
    phase: ResponsePhase.Contain,
    text: { template: STEP_DECLARE_INCIDENT, values: {} },
    action: {
      kind: ResponseActionKind.DeclareIncident,
      title: ACTION_DECLARE_INCIDENT,
    },
    isDoneByCase: input.hasIncident,
    isOnlyDoneByCase: true,
  });

  if (input.hasContainedStatus) {
    add({
      key: getResponseStepKey(RESPONSE_STEP_KINDS.markContained),
      phase: ResponsePhase.Contain,
      text: { template: STEP_MARK_CONTAINED, values: {} },
      action: {
        kind: ResponseActionKind.MarkContained,
        title: ACTION_MARK_CONTAINED,
      },
      isDoneByCase: hasReached(input.stage, SecurityCaseStage.Contained),
      isOnlyDoneByCase: true,
    });
  }

  // ----- Fix -----

  /*
   * A rule that says how to fix what let it happen is followed: its steps
   * take the place of the general ones.
   */
  const ruleFixes: number = addRuleSteps(
    DetectionRuleResponsePhase.Fix,
    ResponsePhase.Fix,
  );

  const attackIds: Array<string> = [
    ...input.mitreTactics,
    ...input.mitreTechniques,
  ];
  const requestedRoute: string = opening
    ? getRequestedRoute(opening.events)
    : "";

  if (
    ruleFixes === 0 &&
    (holdsAttackId(attackIds, ["T1190"]) ||
      (holdsAttackId(attackIds, ["TA0001"]) && Boolean(requestedRoute)))
  ) {
    add({
      key: getResponseStepKey("fix:public-app"),
      phase: ResponsePhase.Fix,
      text: requestedRoute
        ? {
            template: STEP_FIX_PUBLIC_APP_ROUTE,
            values: { route: requestedRoute },
          }
        : { template: STEP_FIX_PUBLIC_APP, values: {} },
    });
  }

  let tacticFixes: number = 0;

  for (const rule of FIX_RULES) {
    if (ruleFixes > 0 || tacticFixes >= RESPONSE_MAX_FIX_STEPS) {
      break;
    }

    if (holdsAttackId(attackIds, rule.ids)) {
      add({
        key: getResponseStepKey(rule.key),
        phase: ResponsePhase.Fix,
        text: rule.text(input.entities),
      });
      tacticFixes++;
    }
  }

  if (
    !steps.some((step: ResponseStep): boolean => {
      return step.phase === ResponsePhase.Fix;
    })
  ) {
    add({
      key: getResponseStepKey("fix:general"),
      phase: ResponsePhase.Fix,
      text: { template: STEP_FIX_GENERAL, values: {} },
    });
  }

  // ----- OneUptime AI's own -----

  for (const suggestion of readAiSuggestedSteps(input.ai?.report)) {
    add({
      key: getResponseStepKey(
        RESPONSE_STEP_KINDS.ai,
        hashText(suggestion.toLowerCase()),
      ),
      phase: ResponsePhase.Fix,
      text: { template: "", values: {} },
      aiText: suggestion,
    });
  }

  // ----- Close -----

  add({
    key: getResponseStepKey(RESPONSE_STEP_KINDS.close),
    phase: ResponsePhase.Close,
    text: { template: STEP_CLOSE, values: {} },
    action: { kind: ResponseActionKind.CloseCase, title: ACTION_CLOSE_CASE },
    isDoneByCase: isClosed,
    isOnlyDoneByCase: true,
  });

  // In the order a response goes in, each phase's steps as they were added.
  const ordered: Array<ResponseStep> = RESPONSE_PHASES.flatMap(
    (phase: ResponsePhase): Array<ResponseStep> => {
      return steps.filter((step: ResponseStep): boolean => {
        return step.phase === phase;
      });
    },
  );

  const containSteps: Array<ResponseStep> = getContainmentSteps(ordered);
  const isContained: boolean = hasReached(
    input.stage,
    SecurityCaseStage.Contained,
  );

  return {
    steps: ordered,
    done: ordered.filter((step: ResponseStep): boolean => {
      return step.isDone;
    }).length,
    total: ordered.length,
    checked: ordered.filter((step: ResponseStep): boolean => {
      return step.isCheckedByOneUptime;
    }).length,
    isReadyToMarkContained:
      input.hasContainedStatus &&
      !isContained &&
      containSteps.length > 0 &&
      containSteps.every((step: ResponseStep): boolean => {
        return step.isDone;
      }),
    isContainmentVerified:
      containSteps.length > 0 &&
      containSteps.every((step: ResponseStep): boolean => {
        return step.isCheckedByOneUptime;
      }),
    regressedStepKeys: ordered
      .filter((step: ResponseStep): boolean => {
        return step.check?.state === SecurityCaseStepCheckState.Regressed;
      })
      .map((step: ResponseStep): string => {
        return step.key;
      }),
  };
}

/*
 * The case's playbook runs, newest first, as the plan reads them: the
 * playbooks a run of which succeeded, and where the latest run of each
 * other one stands. A cancelled run leaves its playbook as if it never ran.
 */
export function readPlaybookRuns(
  runs: Array<{ playbookId: string; status: string }>,
): {
  ranPlaybookIds: Array<string>;
  playbookRunStates: Record<string, ResponsePlaybookRunState>;
} {
  const ran: Set<string> = new Set<string>();
  const latest: Map<string, string> = new Map<string, string>();

  for (const run of runs) {
    if (!run.playbookId) {
      continue;
    }

    if (run.status === SecurityPlaybookRunStatus.Succeeded) {
      ran.add(run.playbookId);
    }

    if (!latest.has(run.playbookId)) {
      latest.set(run.playbookId, run.status);
    }
  }

  const playbookRunStates: Record<string, ResponsePlaybookRunState> = {};

  for (const [playbookId, status] of latest) {
    if (ran.has(playbookId)) {
      continue;
    }

    switch (status) {
      case SecurityPlaybookRunStatus.WaitingForApproval:
        playbookRunStates[playbookId] = ResponsePlaybookRunState.Waiting;
        break;
      case SecurityPlaybookRunStatus.Queued:
      case SecurityPlaybookRunStatus.Running:
        playbookRunStates[playbookId] = ResponsePlaybookRunState.Running;
        break;
      case SecurityPlaybookRunStatus.Failed:
        playbookRunStates[playbookId] = ResponsePlaybookRunState.Failed;
        break;
      default:
        break;
    }
  }

  return { ranPlaybookIds: Array.from(ran), playbookRunStates };
}

// The steps OneUptime AI suggests, and the rest: drawn apart.
export function isAiStep(step: Pick<ResponseStep, "aiText">): boolean {
  return Boolean(step.aiText);
}
