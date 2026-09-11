import FilterCondition from "../../Types/Filter/FilterCondition";
import ObjectID from "../../Types/ObjectID";
import RuleCriteria, {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaFilter,
  RuleCriteriaOperator,
  RuleCriteriaValue,
} from "../../Types/Rules/RuleCriteria";
import RulePatternMatchUtil from "./RulePatternMatchUtil";

export const RULE_CRITERIA_MAX_FILTERS: number = 50;
export const RULE_CRITERIA_MAX_STRING_LENGTH: number = 500;
export const RULE_CRITERIA_MAX_RELATION_VALUES: number = 100;

const RULE_CRITERIA_OPERATORS: ReadonlySet<RuleCriteriaOperator> = new Set(
  Object.values(RuleCriteriaOperator),
);

const RELATION_OPERATORS: ReadonlySet<RuleCriteriaOperator> = new Set([
  RuleCriteriaOperator.HasAnyOf,
  RuleCriteriaOperator.HasAllOf,
  RuleCriteriaOperator.HasNoneOf,
]);

const NEGATED_OPERATORS: ReadonlySet<RuleCriteriaOperator> = new Set([
  RuleCriteriaOperator.NotEquals,
  RuleCriteriaOperator.DoesNotContain,
  RuleCriteriaOperator.DoesNotMatchPattern,
  RuleCriteriaOperator.HasNoneOf,
]);

const RULE_CRITERIA_KEYS: ReadonlySet<string> = new Set([
  "schemaVersion",
  "filterCondition",
  "filters",
]);

const RULE_CRITERIA_FILTER_KEYS: ReadonlySet<string> = new Set([
  "field",
  "operator",
  "value",
]);

interface RuleCriteriaCarrier {
  criteria?: unknown;
}

export interface RuleCriteriaMatchOptions {
  criteria: unknown;
  emptyResult: boolean;
  matchesFilter: (filter: RuleCriteriaFilter) => Promise<boolean> | boolean;
}

export interface RuleCriteriaMatchSyncOptions {
  criteria: unknown;
  emptyResult: boolean;
  matchesFilter: (filter: RuleCriteriaFilter) => boolean;
}

export interface MatchesWithLegacyOptions<
  RuleType extends RuleCriteriaCarrier,
  CorrelationCandidateType = never,
> {
  rule: RuleType;
  legacyFields: ReadonlyArray<Extract<keyof RuleType, string>>;
  emptyResult: boolean;
  matchesLegacyRule: (rule: RuleType) => Promise<boolean> | boolean;
  correlation?: LegacyFilterCorrelation<RuleType, CorrelationCandidateType>;
}

export interface LegacyFilterCorrelation<
  RuleType extends RuleCriteriaCarrier,
  CorrelationCandidateType,
> {
  fields: ReadonlyArray<Extract<keyof RuleType, string>>;
  getCandidates: () =>
    | Promise<ReadonlyArray<CorrelationCandidateType>>
    | ReadonlyArray<CorrelationCandidateType>;
  matchesLegacyRuleForCandidate: (
    rule: RuleType,
    candidate: CorrelationCandidateType,
  ) => Promise<boolean> | boolean;
}

export interface MatchesWithLegacySyncOptions<
  RuleType extends RuleCriteriaCarrier,
> {
  rule: RuleType;
  legacyFields: ReadonlyArray<Extract<keyof RuleType, string>>;
  emptyResult: boolean;
  matchesLegacyRule: (rule: RuleType) => boolean;
}

interface LegacyTextValue {
  pattern: string;
  negate: boolean;
}

interface IdBearingStub {
  _id: string;
  id: ObjectID;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactlyKeys(
  value: Record<string, unknown>,
  expectedKeys: ReadonlySet<string>,
): boolean {
  const actualKeys: Array<string> = Object.keys(value);

  return (
    actualKeys.length === expectedKeys.size &&
    actualKeys.every((key: string): boolean => {
      return expectedKeys.has(key);
    })
  );
}

export function isRuleCriteriaOperator(
  value: unknown,
): value is RuleCriteriaOperator {
  return (
    typeof value === "string" &&
    RULE_CRITERIA_OPERATORS.has(value as RuleCriteriaOperator)
  );
}

export function isRuleCriteriaValue(
  value: unknown,
): value is RuleCriteriaValue {
  if (typeof value === "string") {
    return (
      value.trim().length > 0 && value.length <= RULE_CRITERIA_MAX_STRING_LENGTH
    );
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (typeof value === "boolean") {
    return true;
  }

  if (Array.isArray(value)) {
    return (
      value.length > 0 &&
      value.length <= RULE_CRITERIA_MAX_RELATION_VALUES &&
      value.every((item: unknown): item is string => {
        return (
          typeof item === "string" &&
          item.trim().length > 0 &&
          item.length <= RULE_CRITERIA_MAX_STRING_LENGTH
        );
      })
    );
  }

  return false;
}

export function getRuleCriteriaFilterValidationError(
  value: unknown,
): string | null {
  if (!isRecord(value)) {
    return "A rule criteria filter must be an object.";
  }

  if (typeof value["field"] !== "string") {
    return "A rule criteria filter field must be a string.";
  }

  if (value["field"].trim().length === 0) {
    return "A rule criteria filter field cannot be blank.";
  }

  if (value["field"].length > RULE_CRITERIA_MAX_STRING_LENGTH) {
    return `A rule criteria filter field cannot exceed ${RULE_CRITERIA_MAX_STRING_LENGTH} characters.`;
  }

  if (!isRuleCriteriaOperator(value["operator"])) {
    return "A rule criteria filter has an unsupported operator.";
  }

  if (
    Array.isArray(value["value"]) &&
    value["value"].length > RULE_CRITERIA_MAX_RELATION_VALUES
  ) {
    return `A rule criteria relation value cannot contain more than ${RULE_CRITERIA_MAX_RELATION_VALUES} items.`;
  }

  if (!isRuleCriteriaValue(value["value"])) {
    return `A rule criteria filter value must be a finite number, a boolean, a non-blank string no longer than ${RULE_CRITERIA_MAX_STRING_LENGTH} characters, or a non-empty array of such strings.`;
  }

  const operator: RuleCriteriaOperator = value["operator"];
  const isRelationOperator: boolean = RELATION_OPERATORS.has(operator);
  const isArrayValue: boolean = Array.isArray(value["value"]);

  if (isRelationOperator && !isArrayValue) {
    return "A relation rule criteria operator requires an array of string IDs.";
  }

  if (!isRelationOperator && isArrayValue) {
    return "A text rule criteria operator requires a scalar value.";
  }

  if (
    (operator === RuleCriteriaOperator.MatchesPattern ||
      operator === RuleCriteriaOperator.DoesNotMatchPattern) &&
    (typeof value["value"] !== "string" ||
      !RulePatternMatchUtil.isSupportedPattern(value["value"]))
  ) {
    return "A pattern rule criteria operator requires a valid regular expression or wildcard pattern.";
  }

  if (!hasExactlyKeys(value, RULE_CRITERIA_FILTER_KEYS)) {
    return "A rule criteria filter may only contain field, operator, and value.";
  }

  return null;
}

export function getRuleCriteriaValidationError(value: unknown): string | null {
  if (!isRecord(value)) {
    return "Rule criteria must be an object.";
  }

  if (value["schemaVersion"] !== RULE_CRITERIA_SCHEMA_VERSION) {
    return `Rule criteria schemaVersion must be ${RULE_CRITERIA_SCHEMA_VERSION}.`;
  }

  if (
    value["filterCondition"] !== FilterCondition.All &&
    value["filterCondition"] !== FilterCondition.Any
  ) {
    return "Rule criteria filterCondition must be All or Any.";
  }

  if (!Array.isArray(value["filters"])) {
    return "Rule criteria filters must be an array.";
  }

  if (value["filters"].length > RULE_CRITERIA_MAX_FILTERS) {
    return `Rule criteria cannot contain more than ${RULE_CRITERIA_MAX_FILTERS} filters.`;
  }

  if (!hasExactlyKeys(value, RULE_CRITERIA_KEYS)) {
    return "Rule criteria may only contain schemaVersion, filterCondition, and filters.";
  }

  for (let index: number = 0; index < value["filters"].length; index++) {
    const validationError: string | null = getRuleCriteriaFilterValidationError(
      value["filters"][index],
    );

    if (validationError) {
      return `Rule criteria filter ${index + 1}: ${validationError}`;
    }
  }

  return null;
}

export function isValidRuleCriteria(value: unknown): value is RuleCriteria {
  return getRuleCriteriaValidationError(value) === null;
}

/**
 * Evaluates validated conditions sequentially so All/Any can short-circuit.
 * A configured but malformed payload fails closed. Callers choose the meaning
 * of a valid, configured empty filter list through emptyResult.
 */
export class RuleCriteriaMatcher {
  public static async matches(
    options: RuleCriteriaMatchOptions,
  ): Promise<boolean> {
    if (!isValidRuleCriteria(options.criteria)) {
      return false;
    }

    if (options.criteria.filters.length === 0) {
      return options.emptyResult;
    }

    if (options.criteria.filterCondition === FilterCondition.All) {
      for (const filter of options.criteria.filters) {
        if (!(await options.matchesFilter(filter))) {
          return false;
        }
      }

      return true;
    }

    for (const filter of options.criteria.filters) {
      if (await options.matchesFilter(filter)) {
        return true;
      }
    }

    return false;
  }

  public static matchesSync(options: RuleCriteriaMatchSyncOptions): boolean {
    if (!isValidRuleCriteria(options.criteria)) {
      return false;
    }

    if (options.criteria.filters.length === 0) {
      return options.emptyResult;
    }

    if (options.criteria.filterCondition === FilterCondition.All) {
      for (const filter of options.criteria.filters) {
        if (!options.matchesFilter(filter)) {
          return false;
        }
      }

      return true;
    }

    for (const filter of options.criteria.filters) {
      if (options.matchesFilter(filter)) {
        return true;
      }
    }

    return false;
  }

  public static async matchesWithLegacy<
    RuleType extends RuleCriteriaCarrier,
    CorrelationCandidateType = never,
  >(
    options: MatchesWithLegacyOptions<RuleType, CorrelationCandidateType>,
  ): Promise<boolean> {
    if (options.rule.criteria === undefined || options.rule.criteria === null) {
      return await options.matchesLegacyRule(options.rule);
    }

    if (!isValidRuleCriteria(options.rule.criteria)) {
      return false;
    }

    if (
      options.correlation &&
      options.rule.criteria.filters.some((filter: RuleCriteriaFilter) => {
        return RuleCriteriaMatcher.isCorrelatedField({
          correlation: options.correlation!,
          filter: filter,
        });
      })
    ) {
      return await RuleCriteriaMatcher.matchesWithCorrelation({
        ...options,
        criteria: options.rule.criteria,
        correlation: options.correlation,
      });
    }

    return await RuleCriteriaMatcher.matches({
      criteria: options.rule.criteria,
      emptyResult: options.emptyResult,
      matchesFilter: async (filter: RuleCriteriaFilter): Promise<boolean> => {
        return await RuleCriteriaMatcher.matchesLegacyFilter({
          ...options,
          filter: filter,
        });
      },
    });
  }

  private static async matchesWithCorrelation<
    RuleType extends RuleCriteriaCarrier,
    CorrelationCandidateType,
  >(
    options: MatchesWithLegacyOptions<RuleType, CorrelationCandidateType> & {
      criteria: RuleCriteria;
      correlation: LegacyFilterCorrelation<RuleType, CorrelationCandidateType>;
    },
  ): Promise<boolean> {
    if (options.criteria.filters.length === 0) {
      return options.emptyResult;
    }

    let candidatesPromise:
      | Promise<ReadonlyArray<CorrelationCandidateType>>
      | undefined;
    const getCandidates: () => Promise<
      ReadonlyArray<CorrelationCandidateType>
    > = async (): Promise<ReadonlyArray<CorrelationCandidateType>> => {
      if (!candidatesPromise) {
        candidatesPromise = Promise.resolve(
          options.correlation.getCandidates(),
        );
      }

      return await candidatesPromise;
    };

    if (options.criteria.filterCondition === FilterCondition.Any) {
      for (const filter of options.criteria.filters) {
        const isPositiveCorrelatedFilter: boolean =
          RuleCriteriaMatcher.isCorrelatedField({
            correlation: options.correlation,
            filter: filter,
          }) && !NEGATED_OPERATORS.has(filter.operator);

        if (isPositiveCorrelatedFilter) {
          if (
            await RuleCriteriaMatcher.matchesCorrelatedFilterAgainstAnyCandidate(
              {
                ...options,
                filter: filter,
                candidates: await getCandidates(),
              },
            )
          ) {
            return true;
          }

          continue;
        }

        /*
         * Negation over a related collection is global: it means that no
         * candidate matches the positive form, not that one candidate does
         * not match it. Non-correlated filters are global as well.
         */
        if (
          await RuleCriteriaMatcher.matchesLegacyFilter({
            ...options,
            filter: filter,
          })
        ) {
          return true;
        }
      }

      return false;
    }

    return await RuleCriteriaMatcher.matchesAllWithCorrelation({
      ...options,
      getCandidates: getCandidates,
    });
  }

  private static async matchesAllWithCorrelation<
    RuleType extends RuleCriteriaCarrier,
    CorrelationCandidateType,
  >(
    options: MatchesWithLegacyOptions<RuleType, CorrelationCandidateType> & {
      criteria: RuleCriteria;
      correlation: LegacyFilterCorrelation<RuleType, CorrelationCandidateType>;
      getCandidates: () => Promise<ReadonlyArray<CorrelationCandidateType>>;
    },
  ): Promise<boolean> {
    const positiveCorrelatedFilters: Array<RuleCriteriaFilter> = [];

    for (const filter of options.criteria.filters) {
      if (
        RuleCriteriaMatcher.isCorrelatedField({
          correlation: options.correlation,
          filter: filter,
        }) &&
        !NEGATED_OPERATORS.has(filter.operator)
      ) {
        positiveCorrelatedFilters.push(filter);
        continue;
      }

      /*
       * Keep negative correlated filters global. Evaluating a negated filter
       * per candidate would incorrectly turn "none match" into "one does not
       * match" whenever a collection contains mixed candidates.
       */
      if (
        !(await RuleCriteriaMatcher.matchesLegacyFilter({
          ...options,
          filter: filter,
        }))
      ) {
        return false;
      }
    }

    if (positiveCorrelatedFilters.length === 0) {
      return true;
    }

    const candidates: ReadonlyArray<CorrelationCandidateType> =
      await options.getCandidates();

    for (const candidate of candidates) {
      let candidateMatchesAll: boolean = true;

      for (const filter of positiveCorrelatedFilters) {
        if (
          !(await RuleCriteriaMatcher.matchesLegacyFilter({
            ...options,
            filter: filter,
            matchesLegacyRule: async (rule: RuleType): Promise<boolean> => {
              return await options.correlation.matchesLegacyRuleForCandidate(
                rule,
                candidate,
              );
            },
          }))
        ) {
          candidateMatchesAll = false;
          break;
        }
      }

      if (candidateMatchesAll) {
        return true;
      }
    }

    return false;
  }

  private static async matchesCorrelatedFilterAgainstAnyCandidate<
    RuleType extends RuleCriteriaCarrier,
    CorrelationCandidateType,
  >(
    options: MatchesWithLegacyOptions<RuleType, CorrelationCandidateType> & {
      correlation: LegacyFilterCorrelation<RuleType, CorrelationCandidateType>;
      filter: RuleCriteriaFilter;
      candidates: ReadonlyArray<CorrelationCandidateType>;
    },
  ): Promise<boolean> {
    for (const candidate of options.candidates) {
      if (
        await RuleCriteriaMatcher.matchesLegacyFilter({
          ...options,
          matchesLegacyRule: async (rule: RuleType): Promise<boolean> => {
            return await options.correlation.matchesLegacyRuleForCandidate(
              rule,
              candidate,
            );
          },
        })
      ) {
        return true;
      }
    }

    return false;
  }

  private static isCorrelatedField<
    RuleType extends RuleCriteriaCarrier,
    CorrelationCandidateType,
  >(options: {
    correlation: LegacyFilterCorrelation<RuleType, CorrelationCandidateType>;
    filter: RuleCriteriaFilter;
  }): boolean {
    return options.correlation.fields.some((field: string): boolean => {
      return field === options.filter.field;
    });
  }

  public static matchesWithLegacySync<RuleType extends RuleCriteriaCarrier>(
    options: MatchesWithLegacySyncOptions<RuleType>,
  ): boolean {
    if (options.rule.criteria === undefined || options.rule.criteria === null) {
      return options.matchesLegacyRule(options.rule);
    }

    return RuleCriteriaMatcher.matchesSync({
      criteria: options.rule.criteria,
      emptyResult: options.emptyResult,
      matchesFilter: (filter: RuleCriteriaFilter): boolean => {
        return RuleCriteriaMatcher.matchesLegacyFilterSync({
          ...options,
          filter: filter,
        });
      },
    });
  }

  private static async matchesLegacyFilter<
    RuleType extends RuleCriteriaCarrier,
    CorrelationCandidateType = never,
  >(
    options: MatchesWithLegacyOptions<RuleType, CorrelationCandidateType> & {
      filter: RuleCriteriaFilter;
    },
  ): Promise<boolean> {
    try {
      if (!RuleCriteriaMatcher.isAllowedLegacyField(options)) {
        return false;
      }

      if (RELATION_OPERATORS.has(options.filter.operator)) {
        return await RuleCriteriaMatcher.matchesLegacyRelationFilter(options);
      }

      const textValue: LegacyTextValue = RuleCriteriaMatcher.toLegacyTextValue(
        options.filter,
      );
      const rule: RuleType = RuleCriteriaMatcher.cloneRuleForFilter({
        ...options,
        value: textValue.pattern,
      });
      const result: boolean = await options.matchesLegacyRule(rule);

      return textValue.negate ? !result : result;
    } catch {
      return false;
    }
  }

  private static matchesLegacyFilterSync<RuleType extends RuleCriteriaCarrier>(
    options: MatchesWithLegacySyncOptions<RuleType> & {
      filter: RuleCriteriaFilter;
    },
  ): boolean {
    try {
      if (!RuleCriteriaMatcher.isAllowedLegacyField(options)) {
        return false;
      }

      if (RELATION_OPERATORS.has(options.filter.operator)) {
        return RuleCriteriaMatcher.matchesLegacyRelationFilterSync(options);
      }

      const textValue: LegacyTextValue = RuleCriteriaMatcher.toLegacyTextValue(
        options.filter,
      );
      const rule: RuleType = RuleCriteriaMatcher.cloneRuleForFilter({
        ...options,
        value: textValue.pattern,
      });
      const result: boolean = options.matchesLegacyRule(rule);

      return textValue.negate ? !result : result;
    } catch {
      return false;
    }
  }

  private static async matchesLegacyRelationFilter<
    RuleType extends RuleCriteriaCarrier,
    CorrelationCandidateType = never,
  >(
    options: MatchesWithLegacyOptions<RuleType, CorrelationCandidateType> & {
      filter: RuleCriteriaFilter;
    },
  ): Promise<boolean> {
    const values: Array<string> = options.filter.value as Array<string>;

    if (options.filter.operator === RuleCriteriaOperator.HasAnyOf) {
      if (values.length === 0) {
        return false;
      }

      return await options.matchesLegacyRule(
        RuleCriteriaMatcher.cloneRuleForFilter({
          ...options,
          value: values.map(RuleCriteriaMatcher.toIdBearingStub),
        }),
      );
    }

    for (const value of values) {
      const matches: boolean = await options.matchesLegacyRule(
        RuleCriteriaMatcher.cloneRuleForFilter({
          ...options,
          value: [RuleCriteriaMatcher.toIdBearingStub(value)],
        }),
      );

      if (
        options.filter.operator === RuleCriteriaOperator.HasAllOf &&
        !matches
      ) {
        return false;
      }

      if (
        options.filter.operator === RuleCriteriaOperator.HasNoneOf &&
        matches
      ) {
        return false;
      }
    }

    return true;
  }

  private static matchesLegacyRelationFilterSync<
    RuleType extends RuleCriteriaCarrier,
  >(
    options: MatchesWithLegacySyncOptions<RuleType> & {
      filter: RuleCriteriaFilter;
    },
  ): boolean {
    const values: Array<string> = options.filter.value as Array<string>;

    if (options.filter.operator === RuleCriteriaOperator.HasAnyOf) {
      if (values.length === 0) {
        return false;
      }

      return options.matchesLegacyRule(
        RuleCriteriaMatcher.cloneRuleForFilter({
          ...options,
          value: values.map(RuleCriteriaMatcher.toIdBearingStub),
        }),
      );
    }

    for (const value of values) {
      const matches: boolean = options.matchesLegacyRule(
        RuleCriteriaMatcher.cloneRuleForFilter({
          ...options,
          value: [RuleCriteriaMatcher.toIdBearingStub(value)],
        }),
      );

      if (
        options.filter.operator === RuleCriteriaOperator.HasAllOf &&
        !matches
      ) {
        return false;
      }

      if (
        options.filter.operator === RuleCriteriaOperator.HasNoneOf &&
        matches
      ) {
        return false;
      }
    }

    return true;
  }

  private static cloneRuleForFilter<
    RuleType extends RuleCriteriaCarrier,
  >(options: {
    rule: RuleType;
    legacyFields: ReadonlyArray<Extract<keyof RuleType, string>>;
    filter: RuleCriteriaFilter;
    value: unknown;
  }): RuleType {
    const clone: RuleType = Object.assign(
      Object.create(
        Object.getPrototypeOf(options.rule) as Record<string, unknown> | null,
      ) as Record<string, unknown>,
      options.rule,
    ) as RuleType;
    const mutableClone: Record<string, unknown> = clone as unknown as Record<
      string,
      unknown
    >;

    for (const field of options.legacyFields) {
      mutableClone[field] = undefined;
    }

    mutableClone["criteria"] = undefined;
    mutableClone[options.filter.field] = options.value;

    return clone;
  }

  private static isAllowedLegacyField<
    RuleType extends RuleCriteriaCarrier,
  >(options: {
    legacyFields: ReadonlyArray<Extract<keyof RuleType, string>>;
    filter: RuleCriteriaFilter;
  }): boolean {
    return options.legacyFields.some((field: string): boolean => {
      return field === options.filter.field;
    });
  }

  private static toLegacyTextValue(
    filter: RuleCriteriaFilter,
  ): LegacyTextValue {
    const value: string = String(filter.value);

    switch (filter.operator) {
      case RuleCriteriaOperator.Equals:
        return {
          pattern: `^${RuleCriteriaMatcher.escapeRegex(value)}$`,
          negate: false,
        };
      case RuleCriteriaOperator.NotEquals:
        return {
          pattern: `^${RuleCriteriaMatcher.escapeRegex(value)}$`,
          negate: true,
        };
      case RuleCriteriaOperator.Contains:
        return {
          pattern: RuleCriteriaMatcher.escapeRegex(value),
          negate: false,
        };
      case RuleCriteriaOperator.DoesNotContain:
        return {
          pattern: RuleCriteriaMatcher.escapeRegex(value),
          negate: true,
        };
      case RuleCriteriaOperator.StartsWith:
        return {
          pattern: `^${RuleCriteriaMatcher.escapeRegex(value)}`,
          negate: false,
        };
      case RuleCriteriaOperator.EndsWith:
        return {
          pattern: `${RuleCriteriaMatcher.escapeRegex(value)}$`,
          negate: false,
        };
      case RuleCriteriaOperator.MatchesPattern:
        return {
          pattern: RuleCriteriaMatcher.toLegacyPattern(value),
          negate: false,
        };
      case RuleCriteriaOperator.DoesNotMatchPattern:
        return {
          pattern: RuleCriteriaMatcher.toLegacyPattern(value),
          negate: true,
        };
      default:
        return { pattern: "(?!)", negate: false };
    }
  }

  private static escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private static toLegacyPattern(value: string): string {
    if (RulePatternMatchUtil.isValidRegex(value)) {
      return value;
    }

    if (value.includes("*")) {
      return RuleCriteriaMatcher.toSafeLegacyGlobPattern(value);
    }

    throw new Error("Unsupported rule criteria pattern.");
  }

  /**
   * Converts a wildcard into a regex for legacy engines that compile patterns
   * directly. Each wildcard-delimited literal is consumed atomically via a
   * lookahead/backreference pair. This preserves full-string glob semantics
   * without constructing chains of ambiguous `.*` expressions that can cause
   * catastrophic regex backtracking. Unbounded runs use `{0,}` instead of `*`
   * so legacy matchers that add a glob fallback do not reinterpret this safe
   * generated regex as another wildcard supplied by the user.
   */
  private static toSafeLegacyGlobPattern(value: string): string {
    const hasLeadingWildcard: boolean = value.startsWith("*");
    const hasTrailingWildcard: boolean = value.endsWith("*");
    const literals: Array<string> = value
      .split("*")
      .filter((literal: string): boolean => {
        return literal.length > 0;
      });

    if (literals.length === 0) {
      return "^[\\s\\S]{0,}$";
    }

    let pattern: string = "^";
    let literalIndex: number = 0;

    if (!hasLeadingWildcard) {
      pattern += RuleCriteriaMatcher.escapeRegex(literals[0] || "");
      literalIndex = 1;
    }

    const suffixIndex: number = hasTrailingWildcard
      ? literals.length
      : literals.length - 1;

    for (; literalIndex < suffixIndex; literalIndex++) {
      const groupName: string = `ruleGlob${literalIndex}`;
      pattern += `(?=(?<${groupName}>[\\s\\S]{0,}?${RuleCriteriaMatcher.escapeRegex(
        literals[literalIndex] || "",
      )}))\\k<${groupName}>`;
    }

    if (!hasTrailingWildcard) {
      const groupName: string = `ruleGlobSuffix${literalIndex}`;
      pattern += `(?=(?<${groupName}>[\\s\\S]{0,}${RuleCriteriaMatcher.escapeRegex(
        literals[literals.length - 1] || "",
      )}$))\\k<${groupName}>`;
    } else {
      pattern += "[\\s\\S]{0,}$";
    }

    return pattern;
  }

  private static toIdBearingStub(value: string): IdBearingStub {
    return {
      _id: value,
      id: new ObjectID(value),
    };
  }
}

export default RuleCriteriaMatcher;
