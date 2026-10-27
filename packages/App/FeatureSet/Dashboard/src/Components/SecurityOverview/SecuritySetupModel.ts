import PageMap from "../../Utils/PageMap";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import {
  TURN_ON_RECOMMENDED_ACTIONS,
  TURN_ON_RECOMMENDED_PARTS,
  TURN_ON_RECOMMENDED_REASONS,
  TurnOnRecommendedAction,
  TurnOnRecommendedPart,
  TurnOnRecommendedProblem,
  TurnOnRecommendedReason,
  TurnOnRecommendedResult,
} from "Common/Types/SecurityEvent/TurnOnRecommended";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * How Security is set up in a project, as the Overview draws it: the
 * pipeline from sources to playbooks, and the steps of "Get started".
 *
 * The figures come from POST /security-case/setup/status
 * (Server/Utils/SecurityEvent/SecuritySetup.ts), read with the person's own
 * permissions. React-free, so the steps and stages are pinned in a plain
 * test.
 */

export interface SecuritySetupStatus {
  connections: number;
  logsSourceEnabled: boolean;
  // The kinds of your OneUptime data beside logs that are read.
  telemetrySourcesEnabled: number;
  eventsLast24Hours: number;
  lastEventAt: Date | null;
  enabledRules: number;
  recommendedRules: number;
  recommendedRulesOn: number;
  threatIntelFeeds: number;
  openCases: number;
  enabledPlaybooks: number;
  destinations: number;
}

export type { TurnOnRecommendedProblem, TurnOnRecommendedResult };

export interface SecuritySetupTestResult {
  eventsSent: number;
  caseId: string | null;
  caseNumber: string | null;
  ruleAdded: boolean;
}

function readNumber(value: JSONValue | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

function readDate(value: JSONValue | undefined): Date | null {
  if (typeof value !== "string" || !value) {
    return null;
  }

  const date: Date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function readText(value: JSONValue | undefined): string | null {
  return typeof value === "string" && value ? value : null;
}

export function parseSecuritySetupStatus(
  body: JSONObject,
): SecuritySetupStatus {
  return {
    connections: readNumber(body["connections"]),
    logsSourceEnabled: body["logsSourceEnabled"] === true,
    telemetrySourcesEnabled: readNumber(body["telemetrySourcesEnabled"]),
    eventsLast24Hours: readNumber(body["eventsLast24Hours"]),
    lastEventAt: readDate(body["lastEventAt"]),
    enabledRules: readNumber(body["enabledRules"]),
    recommendedRules: readNumber(body["recommendedRules"]),
    recommendedRulesOn: readNumber(body["recommendedRulesOn"]),
    threatIntelFeeds: readNumber(body["threatIntelFeeds"]),
    openCases: readNumber(body["openCases"]),
    enabledPlaybooks: readNumber(body["enabledPlaybooks"]),
    destinations: readNumber(body["destinations"]),
  };
}

function readEnum<T extends string>(
  value: JSONValue | undefined,
  values: ReadonlyArray<T>,
): T | null {
  return typeof value === "string" && values.includes(value as T)
    ? (value as T)
    : null;
}

/*
 * One thing Turn on recommended could not do, read defensively: a reason
 * the Dashboard does not know reads as a failure on OneUptime's side, an
 * action it does not know as adding, and an entry with no part it knows is
 * left out.
 */
function readProblem(value: JSONValue): TurnOnRecommendedProblem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const body: JSONObject = value as JSONObject;
  const part: TurnOnRecommendedPart | null = readEnum(
    body["part"],
    TURN_ON_RECOMMENDED_PARTS,
  );

  if (!part) {
    return null;
  }

  return {
    part,
    action:
      readEnum(body["action"], TURN_ON_RECOMMENDED_ACTIONS) ||
      TurnOnRecommendedAction.Add,
    name: readText(body["name"]) || "",
    reason:
      readEnum(body["reason"], TURN_ON_RECOMMENDED_REASONS) ||
      TurnOnRecommendedReason.Failed,
    detail: readText(body["detail"]) || "",
  };
}

export function parseTurnOnRecommendedResult(
  body: JSONObject,
): TurnOnRecommendedResult {
  const problems: JSONValue | undefined = body["problems"];

  return {
    rulesAdded: readNumber(body["rulesAdded"]),
    rulesTurnedOn: readNumber(body["rulesTurnedOn"]),
    logsTurnedOn: body["logsTurnedOn"] === true,
    telemetrySourcesTurnedOn: readNumber(body["telemetrySourcesTurnedOn"]),
    playbookAdded: body["playbookAdded"] === true,
    playbookTurnedOn: body["playbookTurnedOn"] === true,
    problems: Array.isArray(problems)
      ? problems
          .map((item: JSONValue): TurnOnRecommendedProblem | null => {
            return readProblem(item);
          })
          .filter(
            (
              item: TurnOnRecommendedProblem | null,
            ): item is TurnOnRecommendedProblem => {
              return item !== null;
            },
          )
      : [],
  };
}

// Whether the click turned on anything at all (beside what was already on).
export function didTurnOnAnything(result: TurnOnRecommendedResult): boolean {
  return (
    result.rulesAdded + result.rulesTurnedOn > 0 ||
    result.logsTurnedOn ||
    result.telemetrySourcesTurnedOn > 0 ||
    result.playbookAdded ||
    result.playbookTurnedOn
  );
}

/*
 * WHAT TURN ON RECOMMENDED COULD NOT DO, IN THE PRODUCT'S WORDS.
 *
 * Each problem reads as what it is about - the rule or playbook by the name
 * lists show, or the switch by its name - and why, in a sentence about the
 * role, the plan, the record OneUptime would not save, or a failure on its
 * side. A plan's or a refused record's own sentence comes from the server.
 * The words are translation keys; the card and the Rule Library translate
 * them (SecurityTurnOnProblems).
 */
export const TURN_ON_RECOMMENDED_LOGS_SUBJECT: string = translationKey(
  "Find security events in your logs",
);

export const TURN_ON_RECOMMENDED_RULES_SUBJECT: string = translationKey(
  "The recommended detection rules",
);

export const TURN_ON_RECOMMENDED_TELEMETRY_SUBJECT: string = translationKey(
  "Find security events in your OneUptime data",
);

export const TURN_ON_RECOMMENDED_PLAYBOOK_SUBJECT: string =
  translationKey("Enrich New Cases");

export interface TurnOnRecommendedProblemWords {
  // What it is about: a name as written (data), or a translation key.
  subject: string;
  isSubjectTranslated: boolean;
  // Why, as a translation template and its values.
  reason: string;
  values: { [key: string]: string };
}

const REASON_WORDS: Record<
  TurnOnRecommendedReason,
  Record<TurnOnRecommendedAction, string>
> = {
  [TurnOnRecommendedReason.NotAllowed]: {
    [TurnOnRecommendedAction.Add]: translationKey("Your role cannot add it."),
    [TurnOnRecommendedAction.TurnOn]: translationKey(
      "It is turned off, and your role cannot turn it back on.",
    ),
    [TurnOnRecommendedAction.Check]: translationKey(
      "Your role cannot read what the project already has, so nothing was added.",
    ),
  },
  [TurnOnRecommendedReason.Plan]: {
    [TurnOnRecommendedAction.Add]: translationKey(
      "Your plan does not include it.",
    ),
    [TurnOnRecommendedAction.TurnOn]: translationKey(
      "Your plan does not include it.",
    ),
    [TurnOnRecommendedAction.Check]: translationKey(
      "Your plan does not include it.",
    ),
  },
  [TurnOnRecommendedReason.Refused]: {
    [TurnOnRecommendedAction.Add]: translationKey(
      "OneUptime could not save it.",
    ),
    [TurnOnRecommendedAction.TurnOn]: translationKey(
      "OneUptime could not save it.",
    ),
    [TurnOnRecommendedAction.Check]: translationKey(
      "OneUptime could not save it.",
    ),
  },
  [TurnOnRecommendedReason.Failed]: {
    [TurnOnRecommendedAction.Add]: translationKey(
      "Something went wrong while adding it.",
    ),
    [TurnOnRecommendedAction.TurnOn]: translationKey(
      "Something went wrong while turning it back on.",
    ),
    [TurnOnRecommendedAction.Check]: translationKey(
      "Something went wrong while reading what the project already has, so nothing was added.",
    ),
  },
};

const REFUSED_WITH_DETAIL: string = translationKey(
  "OneUptime could not save it: {{detail}}",
);

function getProblemSubject(problem: TurnOnRecommendedProblem): {
  subject: string;
  isSubjectTranslated: boolean;
} {
  if (problem.part === TurnOnRecommendedPart.Logs) {
    return {
      subject: TURN_ON_RECOMMENDED_LOGS_SUBJECT,
      isSubjectTranslated: true,
    };
  }

  // Said as one switch: the kind is the server's to log, not the reader's to parse.
  if (problem.part === TurnOnRecommendedPart.TelemetrySources) {
    return {
      subject: TURN_ON_RECOMMENDED_TELEMETRY_SUBJECT,
      isSubjectTranslated: true,
    };
  }

  if (problem.name) {
    return { subject: problem.name, isSubjectTranslated: false };
  }

  return {
    subject:
      problem.part === TurnOnRecommendedPart.Playbook
        ? TURN_ON_RECOMMENDED_PLAYBOOK_SUBJECT
        : TURN_ON_RECOMMENDED_RULES_SUBJECT,
    isSubjectTranslated: true,
  };
}

export function getTurnOnRecommendedProblemWords(
  problem: TurnOnRecommendedProblem,
): TurnOnRecommendedProblemWords {
  const subject: { subject: string; isSubjectTranslated: boolean } =
    getProblemSubject(problem);

  // A plan's own sentence says which plan, and how to get it.
  if (problem.reason === TurnOnRecommendedReason.Plan && problem.detail) {
    return { ...subject, reason: problem.detail, values: {} };
  }

  if (problem.reason === TurnOnRecommendedReason.Refused && problem.detail) {
    return {
      ...subject,
      reason: REFUSED_WITH_DETAIL,
      values: { detail: problem.detail },
    };
  }

  return {
    ...subject,
    reason: REASON_WORDS[problem.reason][problem.action],
    values: {},
  };
}

/*
 * Why the Dashboard could not add a rule itself (the Rule Library's Add
 * buttons), read from the API's answer the way the server reads its own
 * exceptions (SecuritySetup.describeTurnOnRecommendedFailure): the role
 * (401, 403, or 422 - a permission refused), the plan (402), a record
 * refused (400, with its sentence), or anything else - a server or network
 * failure, whose message is not the reader's to read.
 */
export function describeAddFailure(error: unknown): {
  reason: TurnOnRecommendedReason;
  detail: string;
} {
  const status: number | null =
    error instanceof HTTPErrorResponse ? error.statusCode : null;
  const message: string =
    error instanceof HTTPErrorResponse || error instanceof Error
      ? error.message || ""
      : "";

  if (status === 401 || status === 403 || status === 422) {
    return { reason: TurnOnRecommendedReason.NotAllowed, detail: "" };
  }

  if (status === 402) {
    return { reason: TurnOnRecommendedReason.Plan, detail: message };
  }

  if (status === 400) {
    return { reason: TurnOnRecommendedReason.Refused, detail: message };
  }

  return { reason: TurnOnRecommendedReason.Failed, detail: "" };
}

/*
 * The product's own sentence for a call that failed on OneUptime's side, or
 * never got an answer: the server's message there - a database's, a
 * proxy's, a URL with "Network error" - is not the reader's to read, and is
 * not in the reader's language either.
 */
export const SETUP_CALL_FAILED: string = translationKey(
  "Something went wrong. Try again in a moment.",
);

// The answers whose sentence the server writes for people: the role, the plan, a request refused.
const STATUSES_WORDED_FOR_PEOPLE: ReadonlyArray<number> = [
  400, 401, 402, 403, 422,
];

function readStatusCode(error: unknown): number | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const statusCode: unknown = (error as { statusCode?: unknown }).statusCode;

  return typeof statusCode === "number" ? statusCode : null;
}

/*
 * Why a setup call failed as a whole - Turn on recommended, the test attack,
 * the Rule Library's Add Recommended Rules - for the box that says so. A
 * refusal the server words for people (the role, the plan, a request it
 * would not take) is said as the server says it, as describeAddFailure
 * reads a rule's. Anything else - a failure on OneUptime's side, a gateway,
 * a request that never got an answer - is SETUP_CALL_FAILED.
 */
export function describeSetupCallFailure(error: unknown): string {
  const status: number | null = readStatusCode(error);
  const message: string =
    error instanceof HTTPErrorResponse || error instanceof Error
      ? error.message || ""
      : "";

  if (
    status !== null &&
    STATUSES_WORDED_FOR_PEOPLE.includes(status) &&
    message.trim()
  ) {
    return message;
  }

  return SETUP_CALL_FAILED;
}

export function parseSetupTestResult(
  body: JSONObject,
): SecuritySetupTestResult {
  return {
    eventsSent: readNumber(body["eventsSent"]),
    caseId: readText(body["caseId"]),
    caseNumber: readText(body["caseNumber"]),
    ruleAdded: body["ruleAdded"] === true,
  };
}

export enum SecuritySetupStepKey {
  Sources = "sources",
  Detections = "detections",
  Responses = "responses",
  Test = "test",
}

export interface SecuritySetupStep {
  key: SecuritySetupStepKey;
  title: string;
  description: string;
  icon: IconProp;
  isDone: boolean;
  // Where the step is done by hand, for whoever wants more than one click.
  page: PageMap;
  linkText: string;
}

export function hasSecuritySources(status: SecuritySetupStatus): boolean {
  return (
    status.connections > 0 ||
    status.logsSourceEnabled ||
    status.telemetrySourcesEnabled > 0
  );
}

/*
 * Set up: something feeds Security, something finds threats in it and
 * something responds. "Get started" shows until then.
 */
export function isSecuritySetUp(status: SecuritySetupStatus): boolean {
  return (
    hasSecuritySources(status) &&
    status.enabledRules > 0 &&
    status.enabledPlaybooks > 0
  );
}

/*
 * The steps of "Get started", in the order they pay off: data to look at,
 * rules that find threats in it, a playbook that responds, and seeing a
 * case open. The test is done once a case is open.
 */
export function getSecuritySetupSteps(
  status: SecuritySetupStatus,
): Array<SecuritySetupStep> {
  return [
    {
      key: SecuritySetupStepKey.Sources,
      title: translationKey("Choose what to watch"),
      description: translationKey(
        "Look for security events in the logs you already send OneUptime, or connect Okta, CrowdStrike, Google SecOps and more.",
      ),
      icon: IconProp.Link,
      isDone: hasSecuritySources(status),
      page: PageMap.SECURITY_EVENTS_CONNECTIONS,
      linkText: translationKey("Connections"),
    },
    {
      key: SecuritySetupStepKey.Detections,
      title: translationKey("Turn on detections"),
      description: translationKey(
        "Ready-made rules for brute force, password spraying, shells in pods, web attacks, AWS changes and more. Each match opens a case.",
      ),
      icon: IconProp.ShieldCheck,
      isDone: status.enabledRules > 0,
      page: PageMap.SECURITY_EVENTS_RULE_LIBRARY,
      linkText: translationKey("Rule Library"),
    },
    {
      key: SecuritySetupStepKey.Responses,
      title: translationKey("Respond automatically"),
      description: translationKey(
        "A playbook checks every new case against threat intel, looks up what its users, hosts and addresses did, and leaves a triage checklist.",
      ),
      icon: IconProp.Bolt,
      isDone: status.enabledPlaybooks > 0,
      page: PageMap.SECURITY_PLAYBOOKS,
      linkText: translationKey("Playbooks"),
    },
    {
      key: SecuritySetupStepKey.Test,
      title: translationKey("See it work"),
      description: translationKey(
        "Send a harmless simulated attack - a dozen failed sign-ins from one address - and watch a case open. Nobody is paged.",
      ),
      icon: IconProp.Beaker,
      isDone: status.openCases > 0,
      page: PageMap.SECURITY_CASES,
      linkText: translationKey("Security Cases"),
    },
  ];
}

export enum SecurityPipelineStageKey {
  Sources = "sources",
  Detections = "detections",
  Cases = "cases",
  Playbooks = "playbooks",
}

export interface SecurityPipelineStage {
  key: SecurityPipelineStageKey;
  title: string;
  icon: IconProp;
  page: PageMap;
  // Whether this stage is set up; a stage that is not says what to do.
  isReady: boolean;
  // Something here needs a person (open cases).
  needsAttention: boolean;
}

/*
 * The pipeline the Overview draws across its top: where events come from,
 * what finds threats in them, what needs a person, what responds. Each
 * stage links to its page; the figures under each are the component's to
 * word (plural forms).
 */
export function getSecurityPipelineStages(
  status: SecuritySetupStatus,
): Array<SecurityPipelineStage> {
  return [
    {
      key: SecurityPipelineStageKey.Sources,
      title: translationKey("Sources"),
      icon: IconProp.Link,
      page: PageMap.SECURITY_EVENTS_CONNECTIONS,
      isReady: hasSecuritySources(status),
      needsAttention: false,
    },
    {
      key: SecurityPipelineStageKey.Detections,
      title: translationKey("Detections"),
      icon: IconProp.ShieldCheck,
      page: PageMap.SECURITY_EVENTS_DETECTION_RULES,
      isReady: status.enabledRules > 0,
      needsAttention: false,
    },
    {
      key: SecurityPipelineStageKey.Cases,
      title: translationKey("Security Cases"),
      icon: IconProp.ShieldExclamation,
      page: PageMap.SECURITY_CASES,
      isReady: true,
      needsAttention: status.openCases > 0,
    },
    {
      key: SecurityPipelineStageKey.Playbooks,
      title: translationKey("Playbooks"),
      icon: IconProp.Bolt,
      page: PageMap.SECURITY_PLAYBOOKS,
      isReady: status.enabledPlaybooks > 0,
      needsAttention: false,
    },
  ];
}

// How many sources feed Security: each connection, your logs, and each kind of your other OneUptime data.
export function countSecuritySources(status: SecuritySetupStatus): number {
  return (
    status.connections +
    (status.logsSourceEnabled ? 1 : 0) +
    status.telemetrySourcesEnabled
  );
}
