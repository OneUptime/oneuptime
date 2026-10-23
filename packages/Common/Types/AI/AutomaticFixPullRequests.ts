import AutoRemediationTriggerEntity from "../AutoRemediation/AutoRemediationTriggerEntity";
import {
  CodeRepositoryAllowance,
  EVERY_CODE_REPOSITORY,
  NO_CODE_REPOSITORY,
  getCodeRepositoryAllowance,
} from "../CodeRepository/CodeRepositoryAllowance";
import { getRulesLlmProviderId } from "./LlmProviderChoice";

/*
 * THE PULL REQUESTS OneUptime AI OPENS ON ITS OWN FOR AN INCIDENT OR AN
 * ALERT, and when it opens them - the one rule, read by the server's two
 * triggers and by the dashboard alike.
 *
 * Two kinds, each after an investigation ends:
 *
 *   - a fix, when the investigation is confident the cause is in the code;
 *   - missing telemetry, when the investigation ends inconclusive because
 *     the logs, traces or metrics it needed were not there.
 *
 * A pull request is one of the ways OneUptime AI fixes an incident, so it
 * belongs to fixing - "It should actually be a child of 'Fix new alerts
 * automatically'" - and to the auto remediation rules that say which
 * incidents are fixed, and how. The maintainer: "Both of these toggles
 * should be inside of Remediation Rule, inside of More, and they should be
 * checked by default ... If there are no rules, by the way, this should
 * happen by default." So a pull request opens on its own when all of these
 * hold:
 *
 *   - "Fix new incidents automatically" (or alerts) is on. A pull request
 *     changes no infrastructure and is never merged, but it is still
 *     OneUptime AI fixing on its own - it spends AI credits on a long agent
 *     run and opens a branch in the team's repository - and the switch is
 *     the one place a project says yes or no to that. Fixing starts off, so
 *     a new project opens none until it turns fixing on;
 *   - the project has no enabled auto remediation rule for the signal kind
 *     - every incident is fixed, the pull requests too - or a rule that
 *     matches the incident has the pull request's switch on (both start on,
 *     AutoRemediationRule.openCodeFixPullRequests and
 *     openTelemetryPullRequests). With rules, an incident no rule matches is
 *     not fixed, so no pull request opens for it either;
 *   - the rules could be read: a pull request is a fix, and a fix that
 *     cannot be checked against the rules that may have kept it out is not
 *     made.
 *
 * And it opens in one of the repositories those rules allow: the ones the
 * matching rules with the switch on name, or every connected repository
 * when one of them names none, or when there is no rule
 * (CodeRepositoryAllowance). OneUptime AI writes it with the LLM provider
 * those rules pick - the first of them by name that picks one - else the
 * project's default, else the global provider (Types/AI/LlmProviderChoice).
 *
 * Enable AI is checked first, by each trigger: with it off nothing opens.
 * "Open Fix PR from this analysis" on the investigation panel needs none of
 * this - a person asked for that pull request - and can open in any
 * connected repository.
 *
 * Pure, so the triggers, the rule form and the docs tests read it the same.
 */

// The switch of each kind of signal that turns fixing on.
export type AutomaticFixSwitchColumn =
  | "enableAutomaticIncidentRemediation"
  | "enableAutomaticAlertRemediation";

// An auto remediation rule's switch for each kind of pull request.
export type RemediationRulePullRequestColumn =
  | "openCodeFixPullRequests"
  | "openTelemetryPullRequests";

// The two kinds of pull request OneUptime AI opens on its own.
export enum AutomaticFixPullRequest {
  // A fix, when an investigation is confident the cause is in the code.
  CodeFix = "CodeFix",
  // Logs, traces or metrics, when an investigation ends without a cause.
  MissingTelemetry = "MissingTelemetry",
}

// In the order a rule's form draws their switches.
export const AUTOMATIC_FIX_PULL_REQUESTS: ReadonlyArray<AutomaticFixPullRequest> =
  [AutomaticFixPullRequest.CodeFix, AutomaticFixPullRequest.MissingTelemetry];

export const AUTOMATIC_FIX_SWITCH_COLUMNS: Record<
  AutoRemediationTriggerEntity,
  AutomaticFixSwitchColumn
> = {
  [AutoRemediationTriggerEntity.Incident]: "enableAutomaticIncidentRemediation",
  [AutoRemediationTriggerEntity.Alert]: "enableAutomaticAlertRemediation",
};

export const REMEDIATION_RULE_PULL_REQUEST_COLUMNS: Record<
  AutomaticFixPullRequest,
  RemediationRulePullRequestColumn
> = {
  [AutomaticFixPullRequest.CodeFix]: "openCodeFixPullRequests",
  [AutomaticFixPullRequest.MissingTelemetry]: "openTelemetryPullRequests",
};

// What a rule a new pull request switch starts as: on.
export const REMEDIATION_RULE_PULL_REQUEST_DEFAULT: boolean = true;

/*
 * The signal an investigation was about: an incident or an alert. Exactly
 * one must be given; anything else is no signal at all, so nothing opens.
 */
export const getAutomaticFixSignal: (subject: {
  incidentId?: unknown;
  alertId?: unknown;
}) => AutoRemediationTriggerEntity | null = (subject: {
  incidentId?: unknown;
  alertId?: unknown;
}): AutoRemediationTriggerEntity | null => {
  const hasIncident: boolean = Boolean(subject.incidentId);
  const hasAlert: boolean = Boolean(subject.alertId);

  if (hasIncident === hasAlert) {
    return null;
  }

  return hasIncident
    ? AutoRemediationTriggerEntity.Incident
    : AutoRemediationTriggerEntity.Alert;
};

// The fixing switches as a project row holds them; one not read is off.
export type AutomaticFixSwitchValues = Partial<
  Record<AutomaticFixSwitchColumn, boolean | null | undefined>
>;

// What the decision reads off an auto remediation rule that matched.
export interface RemediationRulePullRequestFacts {
  openCodeFixPullRequests?: boolean | null | undefined;
  openTelemetryPullRequests?: boolean | null | undefined;
  // The repositories the rule names: none is every connected repository.
  codeRepositories?: unknown;
  // The LLM provider the rule picks, and what orders rules that pick one.
  llmProviderId?: unknown;
  name?: unknown;
  _id?: unknown;
}

/*
 * The project's enabled auto remediation rules for the signal kind, as the
 * decision needs them: whether there are any, and the ones that match the
 * incident (or alert).
 */
export interface AutomaticFixPullRequestRules {
  rulesSetUp: boolean;
  matchingRules: Array<RemediationRulePullRequestFacts>;
}

// Why a pull request may not open on its own.
export enum AutomaticFixPullRequestBlocker {
  // Fix new incidents (or alerts) automatically is off.
  FixOff = "FixOff",
  // The auto remediation rules could not be read.
  RulesUnreadable = "RulesUnreadable",
  /*
   * The project has auto remediation rules for the signal kind and none
   * matches it: the incident (or alert) is not fixed at all.
   */
  NoMatchingRule = "NoMatchingRule",
  // Rules match it, and every one of them has this pull request's switch off.
  PullRequestOff = "PullRequestOff",
}

export interface AutomaticFixPullRequestDecision {
  // What stops the pull request, or null when it may open.
  blocker: AutomaticFixPullRequestBlocker | null;
  // The repositories it may open in (none while it is blocked).
  repositories: CodeRepositoryAllowance;
  /*
   * The LLM provider it is written with: the pick of the first rule that
   * opens it, by name, that picks one. "" for none - the project's
   * default, else the global provider - and while it is blocked.
   */
  llmProviderId: string;
}

/*
 * Whether a rule opens this kind of pull request. Strictly === true: both
 * columns are NOT NULL DEFAULT true, so a value that was not read (or a
 * legacy null) never opens a pull request.
 */
export function doesRuleOpenPullRequest(
  rule: RemediationRulePullRequestFacts,
  pullRequest: AutomaticFixPullRequest,
): boolean {
  return rule[REMEDIATION_RULE_PULL_REQUEST_COLUMNS[pullRequest]] === true;
}

/*
 * Whether this kind of pull request may open on its own for the signal, and
 * in which repositories - or the first thing that stops it: the fixing
 * switch, then the rules (see the module comment).
 */
export function decideAutomaticFixPullRequest(data: {
  project: AutomaticFixSwitchValues;
  signal: AutoRemediationTriggerEntity;
  pullRequest: AutomaticFixPullRequest;
  // Null when the rules could not be read.
  rules: AutomaticFixPullRequestRules | null;
}): AutomaticFixPullRequestDecision {
  const blocked: (
    blocker: AutomaticFixPullRequestBlocker,
  ) => AutomaticFixPullRequestDecision = (
    blocker: AutomaticFixPullRequestBlocker,
  ): AutomaticFixPullRequestDecision => {
    return { blocker, repositories: NO_CODE_REPOSITORY, llmProviderId: "" };
  };

  if (data.project[AUTOMATIC_FIX_SWITCH_COLUMNS[data.signal]] !== true) {
    return blocked(AutomaticFixPullRequestBlocker.FixOff);
  }

  if (!data.rules) {
    return blocked(AutomaticFixPullRequestBlocker.RulesUnreadable);
  }

  if (!data.rules.rulesSetUp) {
    return {
      blocker: null,
      repositories: EVERY_CODE_REPOSITORY,
      llmProviderId: "",
    };
  }

  if (data.rules.matchingRules.length === 0) {
    return blocked(AutomaticFixPullRequestBlocker.NoMatchingRule);
  }

  const openingRules: Array<RemediationRulePullRequestFacts> =
    data.rules.matchingRules.filter(
      (rule: RemediationRulePullRequestFacts): boolean => {
        return doesRuleOpenPullRequest(rule, data.pullRequest);
      },
    );

  if (openingRules.length === 0) {
    return blocked(AutomaticFixPullRequestBlocker.PullRequestOff);
  }

  return {
    blocker: null,
    repositories: getCodeRepositoryAllowance({
      rulesSetUp: true,
      matchingRules: openingRules,
    }),
    llmProviderId: getRulesLlmProviderId(openingRules),
  };
}

/*
 * The project column a server read needs before the rules: the signal's
 * fixing switch (a ProjectService select).
 */
export function getAutomaticFixSwitchSelect(
  signal: AutoRemediationTriggerEntity,
): Partial<Record<AutomaticFixSwitchColumn, true>> {
  return { [AUTOMATIC_FIX_SWITCH_COLUMNS[signal]]: true };
}

/*
 * The columns of a matching rule the decision reads (an
 * AutoRemediationRuleService select, beside the columns a rule is matched
 * on).
 */
export const REMEDIATION_RULE_PULL_REQUEST_SELECT: {
  openCodeFixPullRequests: true;
  openTelemetryPullRequests: true;
  codeRepositories: { _id: true };
  llmProviderId: true;
} = {
  openCodeFixPullRequests: true,
  openTelemetryPullRequests: true,
  codeRepositories: { _id: true },
  llmProviderId: true,
};

// Why a pull request did not open, in the words a debug log line ends with.
export function describeAutomaticFixPullRequestBlocker(data: {
  blocker: AutomaticFixPullRequestBlocker;
  signal: AutoRemediationTriggerEntity;
  pullRequest: AutomaticFixPullRequest;
}): string {
  const signal: string =
    data.signal === AutoRemediationTriggerEntity.Incident
      ? "incident"
      : "alert";
  const pullRequest: string =
    data.pullRequest === AutomaticFixPullRequest.CodeFix
      ? "fix pull requests"
      : "telemetry pull requests";

  switch (data.blocker) {
    case AutomaticFixPullRequestBlocker.FixOff:
      return `project has fixing new ${signal}s automatically off, and its ${pullRequest} open only while it is on`;
    case AutomaticFixPullRequestBlocker.RulesUnreadable:
      return `the AI rules could not be read, so no ${pullRequest} open`;
    case AutomaticFixPullRequestBlocker.NoMatchingRule:
      return `no AI rule that fixes matches this ${signal}, so it is not fixed`;
    case AutomaticFixPullRequestBlocker.PullRequestOff:
      return `the AI rules that match this ${signal} have ${pullRequest} off`;
    default: {
      const unhandled: never = data.blocker;
      return unhandled;
    }
  }
}
