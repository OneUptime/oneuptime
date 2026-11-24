import { translationKey } from "../Translator";
import { CloudProvider } from "./CloudPlatform";
import {
  CLOUD_RESOURCE_ENVIRONMENTS,
  CloudResourceEnvironment,
  isCloudResourceEnvironment,
} from "./CloudResourceEnvironment";
import {
  CLOUD_SAVINGS_ACTION_GROUPS,
  CloudSavingsActionGroup,
  CloudSavingsActionKind,
  CloudSavingsActionUndo,
  getCloudSavingsActionGroup,
  isCloudSavingsActionGroup,
} from "./CloudSavingsAction";

/*
 * AI RULES FOR SAVINGS (#11010): WHAT ONEUPTIME AI DOES WITH A SAVING IT
 * COULD ACT ON, AND WHAT IT MAY DO WITHOUT ASKING.
 *
 * An AI rule (AutoRemediationRule) whose trigger is a cloud saving says,
 * for the savings it matches - by the kind of change, the resource's
 * environment and its cloud - one of three things:
 *
 *   - Off: nothing on its own ("never touch production" is a rule for
 *     Production that is Off). A person can still press Apply.
 *   - Suggest: proposed to an owner of the resource, who approves or
 *     dismisses it on its card.
 *   - Without asking: made, up to the rule's monthly limit, and proposed
 *     above it: "stop idle non-production resources without asking, under
 *     $500 a month".
 *
 * With no such rule, every saving OneUptime could act on is proposed and
 * nothing is made: propose only, out of the box. Where rules disagree the
 * careful answer wins - Off over Suggest over Without asking - and the
 * smallest limit.
 *
 * Whatever a rule says, a change is made without asking only when:
 *
 *   - its resource is known not to be production: production, and a
 *     resource whose environment nothing says, always wait for a person;
 *   - it can be undone - a deleted disk only after its final snapshot, so
 *     a released address or a deleted snapshot or image always asks;
 *   - fewer than CLOUD_SAVINGS_AI_CHANGES_WITHOUT_ASKING_PER_HOUR changes
 *     were made without asking in the project in the hour before: the
 *     circuit breaker proposes the rest.
 *
 * Pure, so the server, the Dashboard's rule form and the docs tests read
 * it alike.
 */

/*
 * The answers a rule gives. Stored on AI rules and sent by the API and
 * Terraform: a wire contract, the same words as every AI rule's.
 */
export enum CloudSavingsAiAutonomy {
  Off = "Off",
  Suggest = "Suggest",
  WithoutAsking = "WithoutAsking",
}

export const CLOUD_SAVINGS_AI_AUTONOMIES: ReadonlyArray<CloudSavingsAiAutonomy> =
  [
    CloudSavingsAiAutonomy.Off,
    CloudSavingsAiAutonomy.Suggest,
    CloudSavingsAiAutonomy.WithoutAsking,
  ];

export function isCloudSavingsAiAutonomy(
  value: unknown,
): value is CloudSavingsAiAutonomy {
  return (
    typeof value === "string" &&
    (CLOUD_SAVINGS_AI_AUTONOMIES as ReadonlyArray<string>).includes(value)
  );
}

export const CLOUD_SAVINGS_AI_AUTONOMY_LABELS: Readonly<
  Record<CloudSavingsAiAutonomy, string>
> = {
  [CloudSavingsAiAutonomy.Off]: translationKey("Off"),
  [CloudSavingsAiAutonomy.Suggest]: translationKey("Propose to the owner"),
  [CloudSavingsAiAutonomy.WithoutAsking]: translationKey("Act without asking"),
};

// The AI rule columns a savings rule is written in (AutoRemediationRule).
export const CLOUD_SAVINGS_AI_AUTONOMY_COLUMN: string = "cloudSavingAutonomy";
export const CLOUD_SAVINGS_AI_MONTHLY_LIMIT_COLUMN: string =
  "cloudSavingMonthlyLimit";

/*
 * What a savings rule matches on: each a JSON column of the rule, empty for
 * any. Read by doesCloudSavingsAiRuleMatch, and held to the savings
 * trigger by AiRuleCriteria.
 */
export const CLOUD_SAVINGS_AI_RULE_CRITERIA_FIELDS: ReadonlyArray<string> = [
  "cloudSavingActionGroups",
  "cloudSavingEnvironments",
  "cloudSavingProviders",
];

// Every column a savings rule holds: only a savings rule may write one.
export const CLOUD_SAVINGS_AI_RULE_COLUMNS: ReadonlyArray<string> = [
  CLOUD_SAVINGS_AI_AUTONOMY_COLUMN,
  CLOUD_SAVINGS_AI_MONTHLY_LIMIT_COLUMN,
  ...CLOUD_SAVINGS_AI_RULE_CRITERIA_FIELDS,
];

// What a new rule says when a create leaves it out: propose, non-production, a stop.
export const CLOUD_SAVINGS_AI_RULE_DEFAULT_AUTONOMY: CloudSavingsAiAutonomy =
  CloudSavingsAiAutonomy.Suggest;

// The monthly limit a new rule's form starts from, in the saving's currency.
export const CLOUD_SAVINGS_AI_DEFAULT_MONTHLY_LIMIT: number = 500;

// The most a limit may be: a number a person means, not a typo of zeros.
export const CLOUD_SAVINGS_AI_MAX_MONTHLY_LIMIT: number = 10000000;

/*
 * The changes OneUptime AI makes without asking in one project in an hour,
 * at most: the rest are proposed (the circuit breaker). A schedule's stops
 * are not counted: a person set them.
 */
export const CLOUD_SAVINGS_AI_CHANGES_WITHOUT_ASKING_PER_HOUR: number = 10;

/*
 * The savings a project's rules are read for in a day, at most: a read that
 * finds thousands at once never runs the project's proposals dry.
 */
export const CLOUD_SAVINGS_AI_SAVINGS_PER_PROJECT_PER_DAY: number = 200;

// What the decision reads off a savings rule.
export interface CloudSavingsAiRuleFacts {
  _id?: unknown;
  name?: unknown;
  cloudSavingAutonomy?: unknown;
  cloudSavingActionGroups?: unknown;
  cloudSavingEnvironments?: unknown;
  cloudSavingProviders?: unknown;
  cloudSavingMonthlyLimit?: unknown;
}

// What the decision reads off a saving OneUptime could act on.
export interface CloudSavingsAiSaving {
  provider: CloudProvider | string;
  kind: CloudSavingsActionKind;
  environment: CloudResourceEnvironment | string;
  monthlySavings: number;
  undo: CloudSavingsActionUndo;
}

function readList(value: unknown): Array<string> {
  return Array.isArray(value)
    ? value.filter((item: unknown): item is string => {
        return typeof item === "string";
      })
    : [];
}

// A rule's answer: its column's, or the default for a value no build wrote.
export function getCloudSavingsAiRuleAutonomy(
  rule: CloudSavingsAiRuleFacts,
): CloudSavingsAiAutonomy {
  return isCloudSavingsAiAutonomy(rule.cloudSavingAutonomy)
    ? rule.cloudSavingAutonomy
    : CLOUD_SAVINGS_AI_RULE_DEFAULT_AUTONOMY;
}

// A rule's monthly limit: a number, or null for none.
export function getCloudSavingsAiRuleLimit(
  rule: CloudSavingsAiRuleFacts,
): number | null {
  const value: number =
    typeof rule.cloudSavingMonthlyLimit === "number"
      ? rule.cloudSavingMonthlyLimit
      : typeof rule.cloudSavingMonthlyLimit === "string" &&
          rule.cloudSavingMonthlyLimit.trim() !== ""
        ? Number(rule.cloudSavingMonthlyLimit)
        : Number.NaN;

  return Number.isFinite(value) && value >= 0 ? value : null;
}

/*
 * The changes a rule covers, by group. A rule that names none covers every
 * group; a change in no group (one that cannot be undone) is covered only
 * by a rule that names none - to propose it, never to make it.
 */
export function getCloudSavingsAiRuleGroups(
  rule: CloudSavingsAiRuleFacts,
): Array<CloudSavingsActionGroup> {
  return readList(rule.cloudSavingActionGroups).filter(
    isCloudSavingsActionGroup,
  );
}

export function doesCloudSavingsAiRuleMatch(
  rule: CloudSavingsAiRuleFacts,
  saving: CloudSavingsAiSaving,
): boolean {
  const providers: Array<string> = readList(rule.cloudSavingProviders).map(
    (provider: string): string => {
      return provider.toLowerCase();
    },
  );

  if (
    providers.length > 0 &&
    !providers.includes(String(saving.provider).toLowerCase())
  ) {
    return false;
  }

  const environments: Array<string> = readList(rule.cloudSavingEnvironments);

  if (
    environments.length > 0 &&
    !environments.includes(String(saving.environment))
  ) {
    return false;
  }

  const groups: Array<CloudSavingsActionGroup> =
    getCloudSavingsAiRuleGroups(rule);

  if (groups.length === 0) {
    return true;
  }

  const group: CloudSavingsActionGroup | null = getCloudSavingsActionGroup(
    saving.kind,
  );

  return group !== null && groups.includes(group);
}

/*
 * Why a saving is proposed rather than made, or nothing is done. Stored on
 * the decision a timeline line says: a wire contract.
 */
export enum CloudSavingsAiReason {
  // No savings rule: propose only, out of the box.
  Defaults = "Defaults",
  // The project has savings rules, and none matches this saving.
  NoMatchingRule = "NoMatchingRule",
  // A matching rule says Off.
  RuleSaysOff = "RuleSaysOff",
  // A matching rule says Suggest.
  RuleSaysSuggest = "RuleSaysSuggest",
  // Production: a person always approves.
  Production = "Production",
  // Nothing says the resource is not production: a person approves.
  EnvironmentNotKnown = "EnvironmentNotKnown",
  // The change cannot be undone: a person approves.
  CannotBeUndone = "CannotBeUndone",
  // The saving is worth more a month than the rule's limit.
  OverLimit = "OverLimit",
  // Enough changes were made without asking this hour.
  CircuitBreaker = "CircuitBreaker",
  // Made without asking, as a rule allows.
  RuleAllows = "RuleAllows",
}

export const CLOUD_SAVINGS_AI_REASON_SENTENCES: Readonly<
  Record<CloudSavingsAiReason, string>
> = {
  [CloudSavingsAiReason.Defaults]: translationKey(
    "Proposed: with no AI rule for savings, OneUptime AI only proposes.",
  ),
  [CloudSavingsAiReason.NoMatchingRule]: translationKey(
    "Not proposed: no AI rule for savings covers it.",
  ),
  [CloudSavingsAiReason.RuleSaysOff]: translationKey(
    "Not proposed: an AI rule for savings says to leave it.",
  ),
  [CloudSavingsAiReason.RuleSaysSuggest]: translationKey(
    "Proposed, as an AI rule for savings says.",
  ),
  [CloudSavingsAiReason.Production]: translationKey(
    "Proposed: the resource is production, so a person always approves.",
  ),
  [CloudSavingsAiReason.EnvironmentNotKnown]: translationKey(
    "Proposed: nothing says the resource is not production, so a person approves.",
  ),
  [CloudSavingsAiReason.CannotBeUndone]: translationKey(
    "Proposed: the change cannot be undone, so a person approves.",
  ),
  [CloudSavingsAiReason.OverLimit]: translationKey(
    "Proposed: it saves more a month than the AI rule's limit.",
  ),
  [CloudSavingsAiReason.CircuitBreaker]: translationKey(
    "Proposed: OneUptime AI already made enough changes on its own this hour.",
  ),
  [CloudSavingsAiReason.RuleAllows]: translationKey(
    "Made without asking, as an AI rule for savings allows.",
  ),
};

export interface CloudSavingsAiDecision {
  // What is done: nothing, a proposal, or the change itself.
  autonomy: CloudSavingsAiAutonomy;
  reason: CloudSavingsAiReason;
  // No savings rule is set up: the project's defaults decided.
  fromDefaults: boolean;
  // The rule that decided it, when one did.
  ruleId?: string | undefined;
  ruleName?: string | undefined;
}

function nameOf(rule: CloudSavingsAiRuleFacts): string {
  return typeof rule.name === "string" ? rule.name : "";
}

function decidedBy(
  autonomy: CloudSavingsAiAutonomy,
  reason: CloudSavingsAiReason,
  rule: CloudSavingsAiRuleFacts | undefined,
): CloudSavingsAiDecision {
  return {
    autonomy,
    reason,
    fromDefaults: false,
    ...(rule && rule._id ? { ruleId: String(rule._id) } : {}),
    ...(rule ? { ruleName: nameOf(rule) } : {}),
  };
}

/*
 * What OneUptime AI does with a saving, from the project's savings rules
 * (enabled ones, every one of them), the saving, and how many changes it
 * made without asking in the last hour.
 */
export function decideCloudSavingsAi(data: {
  rules: Array<CloudSavingsAiRuleFacts>;
  saving: CloudSavingsAiSaving;
  changesWithoutAskingThisHour: number;
}): CloudSavingsAiDecision {
  if (data.rules.length === 0) {
    return {
      autonomy: CloudSavingsAiAutonomy.Suggest,
      reason: CloudSavingsAiReason.Defaults,
      fromDefaults: true,
    };
  }

  // In name order, so the rule a line names is the same every time.
  const matching: Array<CloudSavingsAiRuleFacts> = data.rules
    .filter((rule: CloudSavingsAiRuleFacts): boolean => {
      return doesCloudSavingsAiRuleMatch(rule, data.saving);
    })
    .sort((a: CloudSavingsAiRuleFacts, b: CloudSavingsAiRuleFacts): number => {
      return nameOf(a).localeCompare(nameOf(b));
    });

  if (matching.length === 0) {
    return {
      autonomy: CloudSavingsAiAutonomy.Off,
      reason: CloudSavingsAiReason.NoMatchingRule,
      fromDefaults: false,
    };
  }

  const answer: (
    autonomy: CloudSavingsAiAutonomy,
  ) => CloudSavingsAiRuleFacts | undefined = (
    autonomy: CloudSavingsAiAutonomy,
  ): CloudSavingsAiRuleFacts | undefined => {
    return matching.find((rule: CloudSavingsAiRuleFacts): boolean => {
      return getCloudSavingsAiRuleAutonomy(rule) === autonomy;
    });
  };

  const off: CloudSavingsAiRuleFacts | undefined = answer(
    CloudSavingsAiAutonomy.Off,
  );

  if (off) {
    return decidedBy(
      CloudSavingsAiAutonomy.Off,
      CloudSavingsAiReason.RuleSaysOff,
      off,
    );
  }

  const suggest: CloudSavingsAiRuleFacts | undefined = answer(
    CloudSavingsAiAutonomy.Suggest,
  );

  if (suggest) {
    return decidedBy(
      CloudSavingsAiAutonomy.Suggest,
      CloudSavingsAiReason.RuleSaysSuggest,
      suggest,
    );
  }

  // Every matching rule says Without asking: the first by name decides.
  const rule: CloudSavingsAiRuleFacts = matching[0]!;
  const ask: (reason: CloudSavingsAiReason) => CloudSavingsAiDecision = (
    reason: CloudSavingsAiReason,
  ): CloudSavingsAiDecision => {
    return decidedBy(CloudSavingsAiAutonomy.Suggest, reason, rule);
  };

  if (data.saving.environment === CloudResourceEnvironment.Production) {
    return ask(CloudSavingsAiReason.Production);
  }

  if (data.saving.environment !== CloudResourceEnvironment.NonProduction) {
    return ask(CloudSavingsAiReason.EnvironmentNotKnown);
  }

  if (
    data.saving.undo === CloudSavingsActionUndo.Never ||
    getCloudSavingsActionGroup(data.saving.kind) === null
  ) {
    return ask(CloudSavingsAiReason.CannotBeUndone);
  }

  /*
   * The smallest limit of the rules that would make it. A rule with none
   * holds to the default: nothing is made without asking, unbounded.
   */
  const limit: number = Math.min(
    ...matching.map((matched: CloudSavingsAiRuleFacts): number => {
      return (
        getCloudSavingsAiRuleLimit(matched) ??
        CLOUD_SAVINGS_AI_DEFAULT_MONTHLY_LIMIT
      );
    }),
  );

  if (data.saving.monthlySavings > limit) {
    return ask(CloudSavingsAiReason.OverLimit);
  }

  if (
    data.changesWithoutAskingThisHour >=
    CLOUD_SAVINGS_AI_CHANGES_WITHOUT_ASKING_PER_HOUR
  ) {
    return ask(CloudSavingsAiReason.CircuitBreaker);
  }

  return decidedBy(
    CloudSavingsAiAutonomy.WithoutAsking,
    CloudSavingsAiReason.RuleAllows,
    rule,
  );
}

/*
 * Why a savings rule cannot be saved like this, or null when it can.
 * `values` is what the write says, over the rule as stored (an update) or
 * the defaults (a create).
 */
export const CLOUD_SAVINGS_AI_RULE_NEVER_ACTS_MESSAGE: string =
  "A rule that acts without asking must cover non-production resources: OneUptime AI never changes production, or a resource whose environment is not known, without a person.";

export function getCloudSavingsAiRuleProblem(
  values: CloudSavingsAiRuleFacts,
): string | null {
  const autonomy: unknown = values.cloudSavingAutonomy;

  if (
    autonomy !== undefined &&
    autonomy !== null &&
    !isCloudSavingsAiAutonomy(autonomy)
  ) {
    return `Cloud Saving: Autonomy must be one of ${CLOUD_SAVINGS_AI_AUTONOMIES.join(
      ", ",
    )}.`;
  }

  const lists: Array<[string, unknown, (value: unknown) => boolean]> = [
    [
      "Cloud Saving: Changes",
      values.cloudSavingActionGroups,
      isCloudSavingsActionGroup,
    ],
    [
      "Cloud Saving: Environments",
      values.cloudSavingEnvironments,
      isCloudResourceEnvironment,
    ],
    [
      "Cloud Saving: Clouds",
      values.cloudSavingProviders,
      (value: unknown): boolean => {
        return (Object.values(CloudProvider) as Array<unknown>).includes(value);
      },
    ],
  ];

  for (const [title, value, isKnown] of lists) {
    if (value === undefined || value === null) {
      continue;
    }

    if (!Array.isArray(value) || value.length > 20 || !value.every(isKnown)) {
      return `${title} must be a list of: ${
        title === "Cloud Saving: Changes"
          ? CLOUD_SAVINGS_ACTION_GROUPS.join(", ")
          : title === "Cloud Saving: Environments"
            ? CLOUD_RESOURCE_ENVIRONMENTS.join(", ")
            : Object.values(CloudProvider).join(", ")
      }.`;
    }
  }

  const limit: unknown = values.cloudSavingMonthlyLimit;

  if (limit !== undefined && limit !== null && limit !== "") {
    const amount: number = Number(limit);

    if (
      !Number.isFinite(amount) ||
      amount < 0 ||
      amount > CLOUD_SAVINGS_AI_MAX_MONTHLY_LIMIT
    ) {
      return `Cloud Saving: Monthly Limit must be a number from 0 to ${CLOUD_SAVINGS_AI_MAX_MONTHLY_LIMIT}.`;
    }
  }

  const environments: Array<string> = readList(values.cloudSavingEnvironments);

  if (
    getCloudSavingsAiRuleAutonomy(values) ===
      CloudSavingsAiAutonomy.WithoutAsking &&
    environments.length > 0 &&
    !environments.includes(CloudResourceEnvironment.NonProduction)
  ) {
    return CLOUD_SAVINGS_AI_RULE_NEVER_ACTS_MESSAGE;
  }

  return null;
}
