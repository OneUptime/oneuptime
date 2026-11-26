import BadDataException from "../Exception/BadDataException";
import {
  CLOUD_COST_TAG_KEY_MAX_LENGTH,
  CLOUD_COST_TAG_VALUE_MAX_LENGTH,
} from "./CloudCost";

/*
 * THE RULES A COST GROUP SORTS SPEND BY.
 *
 * A cost group ("Payments") holds rules, and a cost falls into the group
 * when ANY of its rules matches it. A rule matches when ALL of its
 * conditions do, and a condition compares one thing a cost carries with the
 * values it names, matching ANY of them:
 *
 *   Payments
 *     rule 1: Tag team is payments
 *     rule 2: Account is 1234-5678
 *     rule 3: Owner team is Payments
 *
 * A cost view holds its groups in order, and every cost falls into the
 * FIRST group that matches it, so nothing is counted twice; what no group
 * matches is the view's unallocated spend.
 *
 * What a condition can read:
 *
 *   - what the cloud's billing says of the cost: its account, cloud,
 *     service, Region, resource and tags (CloudCost);
 *   - what OneUptime knows of the resource it is billed to: its owner teams
 *     and its labels (and the account's labels), its App Platforms
 *     environment and app;
 *   - for a Kubernetes cluster's cost split across its namespaces, the
 *     cluster and the namespace - whose labels are read as the part's tags.
 *
 * A resource owned by several teams is split evenly between them: a cost
 * of a resource with N owner teams is N parts, each carrying one owner team
 * and 1/N of the cost, and each part is sorted on its own. A rule that does
 * not ask about owners (a tag, an account) still takes every part, so the
 * whole cost.
 *
 * Text is compared without regard to case, and a condition's values are
 * trimmed: "Payments" and "payments" are one team. A tag's key is matched
 * as written, as each cloud keeps a key ("Team" and "team" are two tags).
 *
 * React-free and the same on both sides: the server compiles these rules
 * into one ClickHouse read (CloudCostAllocationQuery), and this file's
 * matcher sorts what is not in ClickHouse - custom line items - and is what
 * the tests hold that read to.
 */

export enum CloudCostRuleField {
  // A connected account (CloudAccount), by its ID in OneUptime.
  Account = "account",
  // The cloud: aws, azure or gcp.
  Provider = "provider",
  Service = "service",
  Region = "region",
  // The resource the cost is billed to, as its cloud names it.
  Resource = "resource",
  // One tag's value; the condition names the tag's key.
  Tag = "tag",
  // The teams that own the resource in OneUptime (Team IDs).
  OwnerTeam = "ownerTeam",
  // The labels of the resource, or of its account, in OneUptime (Label IDs).
  Label = "label",
  // An App Platforms environment (its CloudResource ID).
  Environment = "environment",
  // An App Platforms app (CloudApp ID).
  App = "app",
  // A Kubernetes cluster whose nodes the cost is for (KubernetesCluster ID).
  KubernetesCluster = "kubernetesCluster",
  // The namespace of a Kubernetes cluster a part of the cost is for.
  KubernetesNamespace = "kubernetesNamespace",
}

export enum CloudCostRuleOperator {
  // One of the values.
  Is = "is",
  // None of the values.
  IsNot = "isNot",
  // Holds one of the values.
  Contains = "contains",
  // Holds none of the values.
  DoesNotContain = "doesNotContain",
  StartsWith = "startsWith",
  EndsWith = "endsWith",
  // A tag the cost carries, with a value (no values asked).
  Exists = "exists",
  // A tag the cost does not carry, or carries empty (no values asked).
  DoesNotExist = "doesNotExist",
}

export interface CloudCostRuleCondition {
  field: CloudCostRuleField;
  operator: CloudCostRuleOperator;
  // The tag's key, for a condition on a tag.
  key?: string | undefined;
  // What the condition compares with: any one of them matches.
  values: Array<string>;
}

export interface CloudCostRule {
  // Every condition must match.
  conditions: Array<CloudCostRuleCondition>;
}

export const CLOUD_COST_MAX_RULES_PER_GROUP: number = 25;
export const CLOUD_COST_MAX_CONDITIONS_PER_RULE: number = 20;
export const CLOUD_COST_MAX_VALUES_PER_CONDITION: number = 200;
export const CLOUD_COST_RULE_VALUE_MAX_LENGTH: number = 1024;

// The fields whose values are records' IDs, picked rather than typed.
export const CLOUD_COST_ID_FIELDS: ReadonlyArray<CloudCostRuleField> = [
  CloudCostRuleField.Account,
  CloudCostRuleField.OwnerTeam,
  CloudCostRuleField.Label,
  CloudCostRuleField.Environment,
  CloudCostRuleField.App,
  CloudCostRuleField.KubernetesCluster,
];

const TEXT_OPERATORS: ReadonlyArray<CloudCostRuleOperator> = [
  CloudCostRuleOperator.Is,
  CloudCostRuleOperator.IsNot,
  CloudCostRuleOperator.Contains,
  CloudCostRuleOperator.DoesNotContain,
  CloudCostRuleOperator.StartsWith,
  CloudCostRuleOperator.EndsWith,
];

const CHOICE_OPERATORS: ReadonlyArray<CloudCostRuleOperator> = [
  CloudCostRuleOperator.Is,
  CloudCostRuleOperator.IsNot,
];

// The operators each field takes, the one a new condition starts on first.
export const CLOUD_COST_FIELD_OPERATORS: Readonly<
  Record<CloudCostRuleField, ReadonlyArray<CloudCostRuleOperator>>
> = {
  [CloudCostRuleField.Account]: CHOICE_OPERATORS,
  [CloudCostRuleField.Provider]: CHOICE_OPERATORS,
  [CloudCostRuleField.Service]: TEXT_OPERATORS,
  [CloudCostRuleField.Region]: TEXT_OPERATORS,
  [CloudCostRuleField.Resource]: TEXT_OPERATORS,
  [CloudCostRuleField.Tag]: [
    ...TEXT_OPERATORS,
    CloudCostRuleOperator.Exists,
    CloudCostRuleOperator.DoesNotExist,
  ],
  [CloudCostRuleField.OwnerTeam]: CHOICE_OPERATORS,
  [CloudCostRuleField.Label]: CHOICE_OPERATORS,
  [CloudCostRuleField.Environment]: CHOICE_OPERATORS,
  [CloudCostRuleField.App]: CHOICE_OPERATORS,
  [CloudCostRuleField.KubernetesCluster]: CHOICE_OPERATORS,
  [CloudCostRuleField.KubernetesNamespace]: TEXT_OPERATORS,
};

// Operators that ask for no values.
export const CLOUD_COST_VALUELESS_OPERATORS: ReadonlyArray<CloudCostRuleOperator> =
  [CloudCostRuleOperator.Exists, CloudCostRuleOperator.DoesNotExist];

// Operators that match what holds NONE of their values.
export const CLOUD_COST_NEGATED_OPERATORS: ReadonlyArray<CloudCostRuleOperator> =
  [
    CloudCostRuleOperator.IsNot,
    CloudCostRuleOperator.DoesNotContain,
    CloudCostRuleOperator.DoesNotExist,
  ];

/*
 * The fields an empty value means something for: a cost no Region is
 * given for (a global service), and one no resource is billed for.
 */
const FIELDS_TAKING_EMPTY_VALUE: ReadonlyArray<CloudCostRuleField> = [
  CloudCostRuleField.Region,
  CloudCostRuleField.Resource,
];

export function isCloudCostRuleField(
  value: unknown,
): value is CloudCostRuleField {
  return (
    typeof value === "string" &&
    (Object.values(CloudCostRuleField) as Array<string>).includes(value)
  );
}

export function isCloudCostRuleOperator(
  value: unknown,
): value is CloudCostRuleOperator {
  return (
    typeof value === "string" &&
    (Object.values(CloudCostRuleOperator) as Array<string>).includes(value)
  );
}

export function isCloudCostIdField(field: CloudCostRuleField): boolean {
  return CLOUD_COST_ID_FIELDS.includes(field);
}

/*
 * What the rules of a group say is wrong with them, as a sentence, or null.
 * The server refuses a group whose rules have a problem with the same
 * sentence (readCloudCostRules), so the form and the API agree.
 */
export function getCloudCostRulesProblem(value: unknown): string | null {
  try {
    readCloudCostRules(value);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/*
 * A group's rules as they are kept: each condition's field, operator and
 * tag key checked, its values trimmed, as text, without repeats - and
 * refused, with what to fix, when they cannot be read. An empty list is a
 * group that matches nothing yet (a group being set up, or a shared group
 * whose costs come from line items alone).
 */
export function readCloudCostRules(value: unknown): Array<CloudCostRule> {
  if (value === null || value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new BadDataException(
      "A cost group's rules must be a list. Send each rule as an object with its conditions.",
    );
  }

  if (value.length > CLOUD_COST_MAX_RULES_PER_GROUP) {
    throw new BadDataException(
      `A cost group can have at most ${CLOUD_COST_MAX_RULES_PER_GROUP} rules. Combine some of them, or split the group in two.`,
    );
  }

  return value.map((rule: unknown, ruleIndex: number): CloudCostRule => {
    const ruleNumber: number = ruleIndex + 1;

    if (!isRecord(rule) || !Array.isArray(rule["conditions"])) {
      throw new BadDataException(
        `Rule ${ruleNumber} must be an object with a list of conditions.`,
      );
    }

    const conditions: Array<unknown> = rule["conditions"] as Array<unknown>;

    if (conditions.length === 0) {
      throw new BadDataException(
        `Rule ${ruleNumber} has no conditions. Add a condition, or remove the rule.`,
      );
    }

    if (conditions.length > CLOUD_COST_MAX_CONDITIONS_PER_RULE) {
      throw new BadDataException(
        `Rule ${ruleNumber} can have at most ${CLOUD_COST_MAX_CONDITIONS_PER_RULE} conditions.`,
      );
    }

    return {
      conditions: conditions.map(
        (
          condition: unknown,
          conditionIndex: number,
        ): CloudCostRuleCondition => {
          return readCloudCostCondition(condition, {
            ruleNumber,
            conditionNumber: conditionIndex + 1,
          });
        },
      ),
    };
  });
}

function readCloudCostCondition(
  condition: unknown,
  where: { ruleNumber: number; conditionNumber: number },
): CloudCostRuleCondition {
  const prefix: string = `Rule ${where.ruleNumber}, condition ${where.conditionNumber}`;

  if (!isRecord(condition)) {
    throw new BadDataException(
      `${prefix} must be an object with a field, an operator and values.`,
    );
  }

  const field: unknown = condition["field"];

  if (!isCloudCostRuleField(field)) {
    throw new BadDataException(
      `${prefix} has no field OneUptime knows. Use one of: ${Object.values(
        CloudCostRuleField,
      ).join(", ")}.`,
    );
  }

  const operator: unknown = condition["operator"];

  if (
    !isCloudCostRuleOperator(operator) ||
    !CLOUD_COST_FIELD_OPERATORS[field].includes(operator)
  ) {
    throw new BadDataException(
      `${prefix} cannot use that operator on ${field}. Use one of: ${CLOUD_COST_FIELD_OPERATORS[
        field
      ].join(", ")}.`,
    );
  }

  let key: string | undefined = undefined;

  if (field === CloudCostRuleField.Tag) {
    key = typeof condition["key"] === "string" ? condition["key"].trim() : "";

    if (!key) {
      throw new BadDataException(`${prefix} needs the tag's key.`);
    }

    if (key.length > CLOUD_COST_TAG_KEY_MAX_LENGTH) {
      throw new BadDataException(
        `${prefix}: a tag's key is at most ${CLOUD_COST_TAG_KEY_MAX_LENGTH} characters.`,
      );
    }
  }

  const rawValues: unknown = condition["values"];
  const isValueless: boolean =
    CLOUD_COST_VALUELESS_OPERATORS.includes(operator);

  if (isValueless) {
    return { field, operator, ...(key ? { key } : {}), values: [] };
  }

  if (!Array.isArray(rawValues) || rawValues.length === 0) {
    throw new BadDataException(`${prefix} needs at least one value.`);
  }

  if (rawValues.length > CLOUD_COST_MAX_VALUES_PER_CONDITION) {
    throw new BadDataException(
      `${prefix} can have at most ${CLOUD_COST_MAX_VALUES_PER_CONDITION} values.`,
    );
  }

  const maxLength: number =
    field === CloudCostRuleField.Tag
      ? CLOUD_COST_TAG_VALUE_MAX_LENGTH
      : CLOUD_COST_RULE_VALUE_MAX_LENGTH;
  const values: Array<string> = [];

  for (const rawValue of rawValues) {
    if (
      typeof rawValue !== "string" &&
      typeof rawValue !== "number" &&
      typeof rawValue !== "boolean"
    ) {
      throw new BadDataException(`${prefix} has a value that is not text.`);
    }

    const text: string = String(rawValue).trim();

    if (!text && !FIELDS_TAKING_EMPTY_VALUE.includes(field)) {
      throw new BadDataException(`${prefix} has an empty value.`);
    }

    if (text.length > maxLength) {
      throw new BadDataException(
        `${prefix} has a value longer than ${maxLength} characters.`,
      );
    }

    if (isCloudCostIdField(field) && !isIdText(text)) {
      throw new BadDataException(
        `${prefix} has a value that is not an ID. Pick the ${field} from the list.`,
      );
    }

    if (
      field === CloudCostRuleField.Provider &&
      !["aws", "azure", "gcp"].includes(text.toLowerCase())
    ) {
      throw new BadDataException(`${prefix}: the cloud is aws, azure or gcp.`);
    }

    const kept: string = isCloudCostIdField(field)
      ? text.toLowerCase()
      : field === CloudCostRuleField.Provider
        ? text.toLowerCase()
        : text;

    if (
      !values.some((existing: string): boolean => {
        return existing.toLowerCase() === kept.toLowerCase();
      })
    ) {
      values.push(kept);
    }
  }

  return { field, operator, ...(key ? { key } : {}), values };
}

// A record's ID as OneUptime writes one: a UUID.
const ID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isIdText(text: string): boolean {
  return ID_PATTERN.test(text);
}

/*
 * ---------------------------------------------------------------------------
 * Matching
 * ---------------------------------------------------------------------------
 */

/*
 * What a cost carries that a rule can read. The resource's owner teams are
 * all of them: the matcher splits the cost between them.
 */
export interface CloudCostFacts {
  // The CloudAccount's ID in OneUptime.
  cloudAccountId: string;
  provider: string;
  service: string;
  region: string;
  resourceId: string;
  tags: Record<string, string>;
  ownerTeamIds?: Array<string> | undefined;
  // The resource's labels and its account's.
  labelIds?: Array<string> | undefined;
  environmentIds?: Array<string> | undefined;
  appIds?: Array<string> | undefined;
  kubernetesClusterId?: string | undefined;
  kubernetesNamespace?: string | undefined;
}

// One part of a cost as it is sorted: the owner team it carries, if any.
export interface CloudCostPartFacts extends CloudCostFacts {
  // The one owner team this part is for: "" for a resource with none.
  ownerTeamId: string;
}

function lower(value: string | undefined | null): string {
  return (value || "").toLowerCase();
}

// The text a field reads of a cost, in lower case; null for a set field.
function readText(
  facts: CloudCostPartFacts,
  condition: CloudCostRuleCondition,
): string {
  switch (condition.field) {
    case CloudCostRuleField.Account:
      return lower(facts.cloudAccountId);
    case CloudCostRuleField.Provider:
      return lower(facts.provider);
    case CloudCostRuleField.Service:
      return lower(facts.service);
    case CloudCostRuleField.Region:
      return lower(facts.region);
    case CloudCostRuleField.Resource:
      return lower(facts.resourceId);
    case CloudCostRuleField.Tag:
      return lower(facts.tags[condition.key || ""]);
    case CloudCostRuleField.OwnerTeam:
      return lower(facts.ownerTeamId);
    case CloudCostRuleField.KubernetesCluster:
      return lower(facts.kubernetesClusterId);
    case CloudCostRuleField.KubernetesNamespace:
      return lower(facts.kubernetesNamespace);
    default:
      return "";
  }
}

// The set a field reads of a cost: labels, environments, apps.
function readSet(
  facts: CloudCostPartFacts,
  field: CloudCostRuleField,
): Array<string> | null {
  switch (field) {
    case CloudCostRuleField.Label:
      return (facts.labelIds || []).map(lower);
    case CloudCostRuleField.Environment:
      return (facts.environmentIds || []).map(lower);
    case CloudCostRuleField.App:
      return (facts.appIds || []).map(lower);
    default:
      return null;
  }
}

// Whether a text holds one of the values, by the operator's kind of match.
function textMatchesAny(
  text: string,
  values: Array<string>,
  operator: CloudCostRuleOperator,
): boolean {
  return values.some((value: string): boolean => {
    const asked: string = lower(value);

    switch (operator) {
      case CloudCostRuleOperator.Is:
      case CloudCostRuleOperator.IsNot:
        return text === asked;
      case CloudCostRuleOperator.Contains:
      case CloudCostRuleOperator.DoesNotContain:
        return text.includes(asked);
      case CloudCostRuleOperator.StartsWith:
        return text.startsWith(asked);
      case CloudCostRuleOperator.EndsWith:
        return text.endsWith(asked);
      default:
        return false;
    }
  });
}

export function matchesCloudCostCondition(
  facts: CloudCostPartFacts,
  condition: CloudCostRuleCondition,
): boolean {
  const isNegated: boolean = CLOUD_COST_NEGATED_OPERATORS.includes(
    condition.operator,
  );

  if (
    condition.operator === CloudCostRuleOperator.Exists ||
    condition.operator === CloudCostRuleOperator.DoesNotExist
  ) {
    const hasValue: boolean = lower(facts.tags[condition.key || ""]) !== "";
    return isNegated ? !hasValue : hasValue;
  }

  const set: Array<string> | null = readSet(facts, condition.field);

  if (set) {
    const asked: Array<string> = condition.values.map(lower);
    const holdsOne: boolean = set.some((item: string): boolean => {
      return asked.includes(item);
    });
    return isNegated ? !holdsOne : holdsOne;
  }

  const holdsOne: boolean = textMatchesAny(
    readText(facts, condition),
    condition.values,
    condition.operator,
  );

  return isNegated ? !holdsOne : holdsOne;
}

export function matchesCloudCostRule(
  facts: CloudCostPartFacts,
  rule: CloudCostRule,
): boolean {
  return (
    rule.conditions.length > 0 &&
    rule.conditions.every((condition: CloudCostRuleCondition): boolean => {
      return matchesCloudCostCondition(facts, condition);
    })
  );
}

export function matchesCloudCostRules(
  facts: CloudCostPartFacts,
  rules: Array<CloudCostRule>,
): boolean {
  return rules.some((rule: CloudCostRule): boolean => {
    return matchesCloudCostRule(facts, rule);
  });
}

// Where a part of a cost went: a group's place in the view, or -1 for none.
export interface CloudCostPartPlacement {
  groupIndex: number;
  // The part's share of the cost: 1, or 1/N of a resource with N owner teams.
  share: number;
  ownerTeamId: string;
}

/*
 * Where a cost goes in a view: the first group whose rules match it, part by
 * part - a resource owned by several teams split evenly between them. The
 * shares always add up to 1, so nothing is counted twice and nothing is
 * lost: a part no group matches is unallocated (groupIndex -1).
 */
export function placeCloudCost(data: {
  groups: Array<{ rules: Array<CloudCostRule> }>;
  facts: CloudCostFacts;
}): Array<CloudCostPartPlacement> {
  const owners: Array<string> = Array.from(
    new Set(
      (data.facts.ownerTeamIds || [])
        .map((id: string): string => {
          return lower(id).trim();
        })
        .filter((id: string): boolean => {
          return id.length > 0;
        }),
    ),
  );
  const parts: Array<string> = owners.length > 0 ? owners : [""];

  return parts.map((ownerTeamId: string): CloudCostPartPlacement => {
    const part: CloudCostPartFacts = { ...data.facts, ownerTeamId };
    const groupIndex: number = data.groups.findIndex(
      (group: { rules: Array<CloudCostRule> }): boolean => {
        return matchesCloudCostRules(part, group.rules);
      },
    );

    return { groupIndex, share: 1 / parts.length, ownerTeamId };
  });
}

// Whether any group of a view asks about owner teams: only then is a cost split.
export function rulesAskAboutOwners(
  groups: Array<{ rules: Array<CloudCostRule> }>,
): boolean {
  return groups.some((group: { rules: Array<CloudCostRule> }): boolean => {
    return group.rules.some((rule: CloudCostRule): boolean => {
      return rule.conditions.some(
        (condition: CloudCostRuleCondition): boolean => {
          return condition.field === CloudCostRuleField.OwnerTeam;
        },
      );
    });
  });
}

// The fields a view's rules read, so a read loads only what they need.
export function getCloudCostRuleFields(
  groups: Array<{ rules: Array<CloudCostRule> }>,
): Set<CloudCostRuleField> {
  const fields: Set<CloudCostRuleField> = new Set();

  for (const group of groups) {
    for (const rule of group.rules) {
      for (const condition of rule.conditions) {
        fields.add(condition.field);
      }
    }
  }

  return fields;
}

// The IDs a view's rules name for one field: the teams, labels, apps...
export function getCloudCostRuleIds(
  groups: Array<{ rules: Array<CloudCostRule> }>,
  field: CloudCostRuleField,
): Array<string> {
  const ids: Set<string> = new Set();

  for (const group of groups) {
    for (const rule of group.rules) {
      for (const condition of rule.conditions) {
        if (condition.field === field) {
          for (const value of condition.values) {
            ids.add(lower(value));
          }
        }
      }
    }
  }

  return Array.from(ids);
}

/*
 * ---------------------------------------------------------------------------
 * Rules an earlier group already takes
 * ---------------------------------------------------------------------------
 *
 * The first group that matches a cost takes it, so a rule every cost of
 * which an earlier rule already matches can never take anything. That is
 * found from the rules alone: an earlier rule COVERS a later one when each
 * of the earlier rule's conditions holds for everything the later rule
 * matches - the later rule asks the same of the same field, or narrower:
 *
 *   earlier: Service is EC2, S3        later: Service is EC2 and Region is eu-west-1
 *   earlier: Tag team exists           later: Tag team is payments
 *   earlier: Service contains amazon   later: Service is Amazon S3
 *
 * It errs on the side of saying nothing: a later rule is called covered
 * only when that follows from the conditions as written.
 */

function conditionImplies(
  narrower: CloudCostRuleCondition,
  wider: CloudCostRuleCondition,
): boolean {
  if (narrower.field !== wider.field) {
    return false;
  }

  if (
    narrower.field === CloudCostRuleField.Tag &&
    (narrower.key || "") !== (wider.key || "")
  ) {
    return false;
  }

  const narrowerValues: Array<string> = narrower.values.map(lower);
  const widerValues: Array<string> = wider.values.map(lower);

  switch (wider.operator) {
    case CloudCostRuleOperator.Exists:
      // Any non-empty value the narrower one asks for carries the tag.
      return (
        narrower.operator === CloudCostRuleOperator.Exists ||
        ((narrower.operator === CloudCostRuleOperator.Is ||
          narrower.operator === CloudCostRuleOperator.Contains ||
          narrower.operator === CloudCostRuleOperator.StartsWith ||
          narrower.operator === CloudCostRuleOperator.EndsWith) &&
          narrowerValues.every((value: string): boolean => {
            return value !== "";
          }))
      );
    case CloudCostRuleOperator.DoesNotExist:
      return (
        narrower.operator === CloudCostRuleOperator.DoesNotExist ||
        (narrower.operator === CloudCostRuleOperator.Is &&
          narrowerValues.every((value: string): boolean => {
            return value === "";
          }))
      );
    case CloudCostRuleOperator.Is:
      // Everything the narrower matches is one of the wider's values.
      return (
        narrower.operator === CloudCostRuleOperator.Is &&
        narrowerValues.every((value: string): boolean => {
          return widerValues.includes(value);
        })
      );
    case CloudCostRuleOperator.IsNot:
      // The narrower excludes at least what the wider excludes.
      return (
        (narrower.operator === CloudCostRuleOperator.IsNot &&
          widerValues.every((value: string): boolean => {
            return narrowerValues.includes(value);
          })) ||
        (narrower.operator === CloudCostRuleOperator.Is &&
          narrowerValues.every((value: string): boolean => {
            return !widerValues.includes(value);
          }))
      );
    case CloudCostRuleOperator.Contains:
    case CloudCostRuleOperator.StartsWith:
    case CloudCostRuleOperator.EndsWith: {
      const holds: (text: string) => boolean = (text: string): boolean => {
        return widerValues.some((value: string): boolean => {
          return wider.operator === CloudCostRuleOperator.Contains
            ? text.includes(value)
            : wider.operator === CloudCostRuleOperator.StartsWith
              ? text.startsWith(value)
              : text.endsWith(value);
        });
      };

      if (narrower.operator === CloudCostRuleOperator.Is) {
        return narrowerValues.every(holds);
      }

      // A narrower text test of the same kind, each of whose values holds the wider's.
      if (narrower.operator === wider.operator) {
        return narrowerValues.every(holds);
      }

      // "Starts with" or "ends with" a text that contains the wider's.
      if (
        wider.operator === CloudCostRuleOperator.Contains &&
        (narrower.operator === CloudCostRuleOperator.StartsWith ||
          narrower.operator === CloudCostRuleOperator.EndsWith)
      ) {
        return narrowerValues.every(holds);
      }

      return false;
    }
    case CloudCostRuleOperator.DoesNotContain:
      return (
        narrower.operator === CloudCostRuleOperator.DoesNotContain &&
        widerValues.every((value: string): boolean => {
          return narrowerValues.some((asked: string): boolean => {
            return asked.includes(value);
          });
        })
      );
    default:
      return false;
  }
}

// Whether every cost the later rule matches, the earlier one matches too.
export function ruleCovers(
  earlier: CloudCostRule,
  later: CloudCostRule,
): boolean {
  if (earlier.conditions.length === 0) {
    return false;
  }

  return earlier.conditions.every((wider: CloudCostRuleCondition): boolean => {
    return later.conditions.some(
      (narrower: CloudCostRuleCondition): boolean => {
        return conditionImplies(narrower, wider);
      },
    );
  });
}

export interface CloudCostGroupShadow {
  // The group none of whose rules can ever take a cost.
  groupIndex: number;
  // The earlier group whose rules take everything its first rule would.
  coveredByGroupIndex: number;
}

/*
 * The groups whose every rule an earlier group's rule already covers: they
 * can never take a cost, wherever it comes from. The editor warns about
 * them, naming the earlier group.
 */
export function findCloudCostGroupsThatNeverMatch(
  groups: Array<{ rules: Array<CloudCostRule> }>,
): Array<CloudCostGroupShadow> {
  const shadows: Array<CloudCostGroupShadow> = [];

  groups.forEach(
    (group: { rules: Array<CloudCostRule> }, groupIndex: number): void => {
      if (group.rules.length === 0) {
        return;
      }

      let firstCover: number = -1;

      const everyRuleCovered: boolean = group.rules.every(
        (rule: CloudCostRule): boolean => {
          for (let earlier: number = 0; earlier < groupIndex; earlier++) {
            if (
              groups[earlier]!.rules.some((earlierRule: CloudCostRule) => {
                return ruleCovers(earlierRule, rule);
              })
            ) {
              if (firstCover < 0) {
                firstCover = earlier;
              }
              return true;
            }
          }

          return false;
        },
      );

      if (everyRuleCovered && firstCover >= 0) {
        shadows.push({ groupIndex, coveredByGroupIndex: firstCover });
      }
    },
  );

  return shadows;
}

/*
 * A rule made from one thing the unallocated spend is made of - a service,
 * an account, a tag's value, an owner team - as Unallocated's "Add rule"
 * starts one.
 */
export function makeCloudCostRule(data: {
  field: CloudCostRuleField;
  value: string;
  key?: string | undefined;
}): CloudCostRule {
  return {
    conditions: [
      {
        field: data.field,
        operator: CloudCostRuleOperator.Is,
        ...(data.field === CloudCostRuleField.Tag ? { key: data.key } : {}),
        values: [data.value],
      },
    ],
  };
}
