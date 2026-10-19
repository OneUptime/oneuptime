import PageMap from "../../Utils/PageMap";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject, JSONValue } from "Common/Types/JSON";
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

export interface TurnOnRecommendedResult {
  rulesAdded: number;
  rulesTurnedOn: number;
  logsTurnedOn: boolean;
  playbookAdded: boolean;
  playbookTurnedOn: boolean;
}

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

export function parseTurnOnRecommendedResult(
  body: JSONObject,
): TurnOnRecommendedResult {
  return {
    rulesAdded: readNumber(body["rulesAdded"]),
    rulesTurnedOn: readNumber(body["rulesTurnedOn"]),
    logsTurnedOn: body["logsTurnedOn"] === true,
    playbookAdded: body["playbookAdded"] === true,
    playbookTurnedOn: body["playbookTurnedOn"] === true,
  };
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
  return status.connections > 0 || status.logsSourceEnabled;
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

// How many sources feed Security: each connection, and your logs.
export function countSecuritySources(status: SecuritySetupStatus): number {
  return status.connections + (status.logsSourceEnabled ? 1 : 0);
}
