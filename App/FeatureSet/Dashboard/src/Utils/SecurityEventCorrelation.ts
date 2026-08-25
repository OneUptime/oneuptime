import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import Query from "Common/Types/BaseDatabase/Query";
import EqualTo from "Common/Types/BaseDatabase/EqualTo";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import IncludesAll from "Common/Types/BaseDatabase/IncludesAll";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import NotContains from "Common/Types/BaseDatabase/NotContains";
import NotEqual from "Common/Types/BaseDatabase/NotEqual";
import Search from "Common/Types/BaseDatabase/Search";
import StartsWith from "Common/Types/BaseDatabase/StartsWith";
import EndsWith from "Common/Types/BaseDatabase/EndsWith";
import ObjectID from "Common/Types/ObjectID";
import OcsfSeverity from "Common/Types/SecurityEvent/OcsfSeverity";
import {
  OcsfEventClasses,
  OcsfEventClassProps,
} from "Common/Types/SecurityEvent/OcsfEventClass";

/*
 * The correlation filter model behind Security Events → Correlate: rows of
 * field + operator + value chained with a single AND/OR connector, compiled
 * into one or more server-side Query<SecurityEvent> objects.
 *
 * The analytics query API is a flat map — every key ANDs with every other
 * key, one operator per column, no OR between columns. That shapes the
 * compilation strategy:
 *
 *  - "All conditions" (AND) compiles to ONE query. Conditions on different
 *    columns land on different keys. Conditions on the SAME column merge
 *    where an equivalent single operator exists (two observable equalities →
 *    IncludesAll/hasAll; several "is not" → IncludesNone) and are rejected
 *    with a friendly error where none does, instead of silently returning
 *    wrong results.
 *
 *  - "Any condition" (OR) compiles to one query PER condition; the caller
 *    runs them in parallel and unions the result sets by event id. Equality
 *    conditions on the same field collapse into a single Includes (hasAny /
 *    IN) query first, since that IS an OR.
 *
 * Everything here is pure so the whole contract is unit-testable without a
 * component render.
 */

export enum CorrelationFieldKey {
  Observable = "observable",
  PrincipalUser = "principalUser",
  PrincipalHost = "principalHost",
  PrincipalIp = "principalIp",
  TargetUser = "targetUser",
  TargetHost = "targetHost",
  TargetIp = "targetIp",
  EventClass = "className",
  Severity = "severityName",
  Message = "message",
  RuleName = "ruleName",
  Vendor = "vendorName",
}

export enum CorrelationOperator {
  Equals = "equals",
  NotEquals = "not-equals",
  Contains = "contains",
  NotContains = "not-contains",
  StartsWith = "starts-with",
  EndsWith = "ends-with",
}

export type CorrelationConnector = "and" | "or";

export interface CorrelationCondition {
  field: CorrelationFieldKey;
  operator: CorrelationOperator;
  value: string;
}

export interface CorrelationFilter {
  conditions: Array<CorrelationCondition>;
  connector: CorrelationConnector;
}

export interface CorrelationFieldDefinition {
  key: CorrelationFieldKey;
  label: string;
  // The SecurityEvent column this field filters on.
  columnKey: string;
  isArrayColumn: boolean;
  operators: Array<CorrelationOperator>;
  // Fixed value vocabulary — render a dropdown instead of a text input.
  valueOptions?: Array<string> | undefined;
  /*
   * Known values worth suggesting, but free text stays allowed (event
   * classes outside the curated OCSF table keep their source-derived
   * names, so a strict dropdown would make them unreachable).
   */
  valueSuggestions?: Array<string> | undefined;
  placeholder?: string | undefined;
}

const ALL_TEXT_OPERATORS: Array<CorrelationOperator> = [
  CorrelationOperator.Equals,
  CorrelationOperator.NotEquals,
  CorrelationOperator.Contains,
  CorrelationOperator.NotContains,
  CorrelationOperator.StartsWith,
  CorrelationOperator.EndsWith,
];

export const CorrelationFieldDefinitions: Array<CorrelationFieldDefinition> = [
  {
    key: CorrelationFieldKey.Observable,
    label: "Observable",
    columnKey: "observables",
    isArrayColumn: true,
    operators: ALL_TEXT_OPERATORS,
    placeholder: "hostname, user, or IP address",
  },
  {
    key: CorrelationFieldKey.PrincipalUser,
    label: "Principal User",
    columnKey: "principalUser",
    isArrayColumn: false,
    operators: ALL_TEXT_OPERATORS,
    placeholder: "alice@example.com",
  },
  {
    key: CorrelationFieldKey.PrincipalHost,
    label: "Principal Host",
    columnKey: "principalHost",
    isArrayColumn: false,
    operators: ALL_TEXT_OPERATORS,
    placeholder: "wb-ubuntu-03",
  },
  {
    key: CorrelationFieldKey.PrincipalIp,
    label: "Principal IP",
    columnKey: "principalIp",
    isArrayColumn: false,
    operators: ALL_TEXT_OPERATORS,
    placeholder: "192.168.1.20",
  },
  {
    key: CorrelationFieldKey.TargetUser,
    label: "Target User",
    columnKey: "targetUser",
    isArrayColumn: false,
    operators: ALL_TEXT_OPERATORS,
    placeholder: "svc-backup",
  },
  {
    key: CorrelationFieldKey.TargetHost,
    label: "Target Host",
    columnKey: "targetHost",
    isArrayColumn: false,
    operators: ALL_TEXT_OPERATORS,
    placeholder: "db-primary",
  },
  {
    key: CorrelationFieldKey.TargetIp,
    label: "Target IP",
    columnKey: "targetIp",
    isArrayColumn: false,
    operators: ALL_TEXT_OPERATORS,
    placeholder: "10.0.0.5",
  },
  {
    key: CorrelationFieldKey.EventClass,
    label: "Event Class",
    columnKey: "className",
    isArrayColumn: false,
    operators: [
      CorrelationOperator.Equals,
      CorrelationOperator.NotEquals,
      CorrelationOperator.Contains,
    ],
    valueSuggestions: OcsfEventClasses.map(
      (eventClass: OcsfEventClassProps) => {
        return eventClass.name;
      },
    ),
    placeholder: "Authentication",
  },
  {
    key: CorrelationFieldKey.Severity,
    label: "Severity",
    columnKey: "severityName",
    isArrayColumn: false,
    operators: [CorrelationOperator.Equals, CorrelationOperator.NotEquals],
    valueOptions: Object.values(OcsfSeverity),
    placeholder: "High",
  },
  {
    key: CorrelationFieldKey.Message,
    label: "Message",
    columnKey: "message",
    isArrayColumn: false,
    operators: [
      CorrelationOperator.Contains,
      CorrelationOperator.NotContains,
      CorrelationOperator.StartsWith,
      CorrelationOperator.EndsWith,
    ],
    placeholder: "failed password",
  },
  {
    key: CorrelationFieldKey.RuleName,
    label: "Rule Name",
    columnKey: "ruleName",
    isArrayColumn: false,
    operators: [
      CorrelationOperator.Equals,
      CorrelationOperator.NotEquals,
      CorrelationOperator.Contains,
    ],
    placeholder: "Brute force detected",
  },
  {
    key: CorrelationFieldKey.Vendor,
    label: "Vendor",
    columnKey: "vendorName",
    isArrayColumn: false,
    operators: [
      CorrelationOperator.Equals,
      CorrelationOperator.NotEquals,
      CorrelationOperator.Contains,
    ],
    placeholder: "CrowdStrike",
  },
];

export function getCorrelationFieldDefinition(
  key: CorrelationFieldKey,
): CorrelationFieldDefinition {
  const definition: CorrelationFieldDefinition | undefined =
    CorrelationFieldDefinitions.find(
      (fieldDefinition: CorrelationFieldDefinition) => {
        return fieldDefinition.key === key;
      },
    );

  if (!definition) {
    throw new Error(`Unknown correlation field: ${key}`);
  }

  return definition;
}

export const CorrelationOperatorLabels: Record<CorrelationOperator, string> = {
  [CorrelationOperator.Equals]: "is",
  [CorrelationOperator.NotEquals]: "is not",
  [CorrelationOperator.Contains]: "contains",
  [CorrelationOperator.NotContains]: "does not contain",
  [CorrelationOperator.StartsWith]: "starts with",
  [CorrelationOperator.EndsWith]: "ends with",
};

export function describeCorrelationCondition(
  condition: CorrelationCondition,
): string {
  const definition: CorrelationFieldDefinition = getCorrelationFieldDefinition(
    condition.field,
  );
  return `${definition.label} ${
    CorrelationOperatorLabels[condition.operator]
  } "${condition.value}"`;
}

export function describeCorrelationFilter(filter: CorrelationFilter): string {
  const connectorWord: string = filter.connector === "or" ? " OR " : " AND ";
  return filter.conditions
    .map((condition: CorrelationCondition) => {
      return describeCorrelationCondition(condition);
    })
    .join(connectorWord);
}

export interface CompiledCorrelationQueries {
  queries: Array<Query<SecurityEvent>>;
  // Human-friendly reason compilation failed; queries is empty when set.
  error: string | null;
}

export interface CorrelationQueryOptions {
  projectId: ObjectID;
  startDate: Date;
  endDate: Date;
}

type ConditionValue =
  | string
  | EqualTo<string>
  | Includes
  | IncludesAll
  | IncludesNone
  | NotEqual<string>
  | Search<string>
  | NotContains<string>
  | StartsWith<string>
  | EndsWith<string>;

function operatorValueForScalarColumn(
  condition: CorrelationCondition,
): ConditionValue {
  switch (condition.operator) {
    case CorrelationOperator.Equals:
      return condition.value;
    case CorrelationOperator.NotEquals:
      return new NotEqual<string>(condition.value);
    case CorrelationOperator.Contains:
      return new Search<string>(condition.value);
    case CorrelationOperator.NotContains:
      return new NotContains<string>(condition.value);
    case CorrelationOperator.StartsWith:
      return new StartsWith<string>(condition.value);
    case CorrelationOperator.EndsWith:
      return new EndsWith<string>(condition.value);
    default:
      throw new Error(`Unknown correlation operator: ${condition.operator}`);
  }
}

function operatorValueForArrayColumn(
  condition: CorrelationCondition,
): ConditionValue {
  switch (condition.operator) {
    case CorrelationOperator.Equals:
      // hasAny(col, [v]) — the row's array mentions this exact value.
      return new Includes([condition.value]);
    case CorrelationOperator.NotEquals:
      return new IncludesNone([condition.value]);
    default:
      /*
       * Contains / NotContains / StartsWith / EndsWith compile to
       * (NOT) arrayExists ILIKE on the server — the operator wrappers are
       * the same as for scalars.
       */
      return operatorValueForScalarColumn(condition);
  }
}

function baseQuery(options: CorrelationQueryOptions): Query<SecurityEvent> {
  return {
    projectId: options.projectId,
    time: new InBetween<Date>(options.startDate, options.endDate),
  } as Query<SecurityEvent>;
}

function normalizeConditions(
  conditions: Array<CorrelationCondition>,
): Array<CorrelationCondition> | { error: string } {
  const normalized: Array<CorrelationCondition> = [];
  const seen: Set<string> = new Set<string>();

  for (const condition of conditions) {
    const value: string = (condition.value || "").trim();

    if (!value) {
      const definition: CorrelationFieldDefinition =
        getCorrelationFieldDefinition(condition.field);
      return {
        error: `The "${definition.label}" condition needs a value.`,
      };
    }

    // Identical rows are redundant under both AND and OR — drop them.
    const dedupeKey: string = `${condition.field} ${condition.operator} ${value}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);

    normalized.push({
      field: condition.field,
      operator: condition.operator,
      value: value,
    });
  }

  return normalized;
}

function compileAndFilter(
  conditions: Array<CorrelationCondition>,
  options: CorrelationQueryOptions,
): CompiledCorrelationQueries {
  const query: Query<SecurityEvent> = baseQuery(options);

  // Group by target column — the flat query map has one slot per column.
  const conditionsByColumn: Map<string, Array<CorrelationCondition>> = new Map<
    string,
    Array<CorrelationCondition>
  >();

  for (const condition of conditions) {
    const definition: CorrelationFieldDefinition =
      getCorrelationFieldDefinition(condition.field);
    const existing: Array<CorrelationCondition> =
      conditionsByColumn.get(definition.columnKey) || [];
    existing.push(condition);
    conditionsByColumn.set(definition.columnKey, existing);
  }

  for (const [columnKey, columnConditions] of conditionsByColumn) {
    const definition: CorrelationFieldDefinition =
      getCorrelationFieldDefinition(columnConditions[0]!.field);

    if (columnConditions.length === 1) {
      const condition: CorrelationCondition = columnConditions[0]!;
      (query as Record<string, ConditionValue>)[columnKey] =
        definition.isArrayColumn
          ? operatorValueForArrayColumn(condition)
          : operatorValueForScalarColumn(condition);
      continue;
    }

    const equalsValues: Array<string> = columnConditions
      .filter((condition: CorrelationCondition) => {
        return condition.operator === CorrelationOperator.Equals;
      })
      .map((condition: CorrelationCondition) => {
        return condition.value;
      });
    const notEqualsValues: Array<string> = columnConditions
      .filter((condition: CorrelationCondition) => {
        return condition.operator === CorrelationOperator.NotEquals;
      })
      .map((condition: CorrelationCondition) => {
        return condition.value;
      });
    const otherConditions: Array<CorrelationCondition> =
      columnConditions.filter((condition: CorrelationCondition) => {
        return (
          condition.operator !== CorrelationOperator.Equals &&
          condition.operator !== CorrelationOperator.NotEquals
        );
      });

    if (!definition.isArrayColumn && equalsValues.length > 1) {
      /*
       * A scalar can't equal two different values at once. (Identical
       * duplicates were already removed, so reaching here means the values
       * differ.)
       */
      return {
        queries: [],
        error: `"All conditions" with two different "${definition.label} is ..." values can never match. Switch the connector to "Any condition" to search for either value.`,
      };
    }

    /*
     * Everything else merges into per-operator predicates on this column.
     * Where more than one predicate remains, the query carries an ARRAY of
     * operators under the key — the statement generator ANDs them (e.g.
     * "mentions X AND does not mention Y" → hasAll + NOT hasAny).
     */
    const operatorValues: Array<ConditionValue> = [];

    if (equalsValues.length > 0) {
      if (definition.isArrayColumn) {
        operatorValues.push(
          equalsValues.length > 1
            ? new IncludesAll(equalsValues)
            : new Includes([equalsValues[0] as string]),
        );
      } else {
        operatorValues.push(new EqualTo<string>(equalsValues[0] as string));
      }
    }

    if (notEqualsValues.length > 0) {
      if (definition.isArrayColumn || notEqualsValues.length > 1) {
        operatorValues.push(new IncludesNone(notEqualsValues));
      } else {
        operatorValues.push(new NotEqual<string>(notEqualsValues[0] as string));
      }
    }

    for (const otherCondition of otherConditions) {
      operatorValues.push(operatorValueForScalarColumn(otherCondition));
    }

    (query as Record<string, ConditionValue | Array<ConditionValue>>)[
      columnKey
    ] =
      operatorValues.length === 1
        ? (operatorValues[0] as ConditionValue)
        : operatorValues;
  }

  return { queries: [query], error: null };
}

function compileOrFilter(
  conditions: Array<CorrelationCondition>,
  options: CorrelationQueryOptions,
): CompiledCorrelationQueries {
  const queries: Array<Query<SecurityEvent>> = [];

  /*
   * Equality conditions on the same field collapse into one Includes query —
   * hasAny / IN already IS an OR across values, and one round-trip beats N.
   */
  const equalsValuesByField: Map<CorrelationFieldKey, Array<string>> = new Map<
    CorrelationFieldKey,
    Array<string>
  >();
  const standaloneConditions: Array<CorrelationCondition> = [];

  for (const condition of conditions) {
    if (condition.operator === CorrelationOperator.Equals) {
      const existing: Array<string> =
        equalsValuesByField.get(condition.field) || [];
      existing.push(condition.value);
      equalsValuesByField.set(condition.field, existing);
    } else {
      standaloneConditions.push(condition);
    }
  }

  for (const [fieldKey, values] of equalsValuesByField) {
    const definition: CorrelationFieldDefinition =
      getCorrelationFieldDefinition(fieldKey);
    const query: Query<SecurityEvent> = baseQuery(options);
    (query as Record<string, ConditionValue>)[definition.columnKey] =
      new Includes(values);
    queries.push(query);
  }

  for (const condition of standaloneConditions) {
    const definition: CorrelationFieldDefinition =
      getCorrelationFieldDefinition(condition.field);
    const query: Query<SecurityEvent> = baseQuery(options);
    (query as Record<string, ConditionValue>)[definition.columnKey] =
      definition.isArrayColumn
        ? operatorValueForArrayColumn(condition)
        : operatorValueForScalarColumn(condition);
    queries.push(query);
  }

  return { queries, error: null };
}

export function compileCorrelationFilter(
  filter: CorrelationFilter,
  options: CorrelationQueryOptions,
): CompiledCorrelationQueries {
  const normalized: Array<CorrelationCondition> | { error: string } =
    normalizeConditions(filter.conditions);

  if (!Array.isArray(normalized)) {
    return { queries: [], error: normalized.error };
  }

  if (normalized.length === 0) {
    return { queries: [], error: null };
  }

  if (filter.connector === "or") {
    return compileOrFilter(normalized, options);
  }

  return compileAndFilter(normalized, options);
}

/*
 * The observable values the filter pins with equality. The graph excludes
 * these from the co-occurring layer (they would trivially co-occur with
 * everything matched) and uses them for the center label.
 */
export function getEqualityObservables(
  filter: CorrelationFilter,
): Array<string> {
  return filter.conditions
    .filter((condition: CorrelationCondition) => {
      return (
        condition.field === CorrelationFieldKey.Observable &&
        condition.operator === CorrelationOperator.Equals &&
        Boolean(condition.value.trim())
      );
    })
    .map((condition: CorrelationCondition) => {
      return condition.value.trim();
    });
}

/*
 * URL round-trip. The filter serializes into a single `q` query-string
 * param as compact JSON tuples: {"v":1,"j":"and","c":[["field","op","value"],...]}.
 * Parsing is tolerant — unknown fields/operators and malformed rows are
 * dropped, malformed JSON yields null — so a stale or hand-edited link
 * degrades to "no filter" instead of a crash.
 */

interface SerializedCorrelationFilter {
  v: number;
  j: CorrelationConnector;
  c: Array<[string, string, string]>;
}

export function serializeCorrelationFilter(filter: CorrelationFilter): string {
  const serialized: SerializedCorrelationFilter = {
    v: 1,
    j: filter.connector,
    c: filter.conditions.map(
      (condition: CorrelationCondition): [string, string, string] => {
        return [condition.field, condition.operator, condition.value];
      },
    ),
  };

  return JSON.stringify(serialized);
}

export function parseCorrelationFilter(
  raw: string | null,
): CorrelationFilter | null {
  if (!raw) {
    return null;
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const candidate: Partial<SerializedCorrelationFilter> =
    parsed as Partial<SerializedCorrelationFilter>;

  const connector: CorrelationConnector = candidate.j === "or" ? "or" : "and";

  const validFieldKeys: Set<string> = new Set<string>(
    CorrelationFieldDefinitions.map(
      (definition: CorrelationFieldDefinition) => {
        return definition.key as string;
      },
    ),
  );
  const validOperators: Set<string> = new Set<string>(
    Object.values(CorrelationOperator),
  );

  const conditions: Array<CorrelationCondition> = [];

  for (const row of candidate.c || []) {
    if (!Array.isArray(row) || row.length < 3) {
      continue;
    }

    const [field, operator, value] = row as [unknown, unknown, unknown];

    if (
      typeof field !== "string" ||
      typeof operator !== "string" ||
      typeof value !== "string" ||
      !validFieldKeys.has(field) ||
      !validOperators.has(operator) ||
      !value.trim()
    ) {
      continue;
    }

    const fieldKey: CorrelationFieldKey = field as CorrelationFieldKey;
    const operatorKey: CorrelationOperator = operator as CorrelationOperator;

    // The operator must actually be offered for that field.
    if (
      !getCorrelationFieldDefinition(fieldKey).operators.includes(operatorKey)
    ) {
      continue;
    }

    conditions.push({
      field: fieldKey,
      operator: operatorKey,
      value: value.trim(),
    });
  }

  if (conditions.length === 0) {
    return null;
  }

  return { conditions, connector };
}
