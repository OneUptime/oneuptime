import BadDataException from "../../../Types/Exception/BadDataException";
import Dictionary from "../../../Types/Dictionary";
import EndsWith from "../../../Types/BaseDatabase/EndsWith";
import EqualTo from "../../../Types/BaseDatabase/EqualTo";
import EqualToOrNull from "../../../Types/BaseDatabase/EqualToOrNull";
import GreaterThan from "../../../Types/BaseDatabase/GreaterThan";
import GreaterThanOrEqual from "../../../Types/BaseDatabase/GreaterThanOrEqual";
import GreaterThanOrNull from "../../../Types/BaseDatabase/GreaterThanOrNull";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesAll from "../../../Types/BaseDatabase/IncludesAll";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import LessThan from "../../../Types/BaseDatabase/LessThan";
import LessThanOrEqual from "../../../Types/BaseDatabase/LessThanOrEqual";
import LessThanOrNull from "../../../Types/BaseDatabase/LessThanOrNull";
import NotContains from "../../../Types/BaseDatabase/NotContains";
import Wildcard from "../../../Types/BaseDatabase/Wildcard";
import NotWildcard from "../../../Types/BaseDatabase/NotWildcard";
import { toLikePattern } from "../../../Types/BaseDatabase/WildcardPattern";
import NotEqual from "../../../Types/BaseDatabase/NotEqual";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import Search from "../../../Types/BaseDatabase/Search";
import StartsWith from "../../../Types/BaseDatabase/StartsWith";
import ObjectID from "../../../Types/ObjectID";
import Text from "../../../Types/Text";
import { JSONObject, JSONValue } from "../../../Types/JSON";

/*
 * ---------------------------------------------------------------------------
 * Querying keys inside a jsonb column
 * ---------------------------------------------------------------------------
 *
 * `customFields` (and every other jsonb column) stores a flat object keyed by
 * the custom field definition's *name*, so "incidents whose Team is Payments"
 * means reaching inside the column for one key.
 *
 * Three properties of this module are load-bearing:
 *
 *  1. THE KEY IS A BOUND PARAMETER, never interpolated. A custom field's name
 *     is user-supplied text that arrives on the query from the browser, so
 *     splicing it into the SQL string — which is what this code used to do —
 *     let anyone who could name a key write SQL into the WHERE clause.
 *
 *  2. A VALUE MATCHES WHETHER IT IS STORED AS A SCALAR OR INSIDE AN ARRAY.
 *     A single-select dropdown stores `"Payments"`; the same field switched to
 *     multi-select stores `["Payments", "Billing"]`. Both have to answer yes to
 *     "Team is Payments", or a project that changed a field's type would find
 *     its old rows quietly missing from every filter.
 *
 *  3. A ROW MISSING THE KEY SATISFIES A NEGATIVE FILTER. "Team is not
 *     Payments" includes the incidents with no Team at all — which is what the
 *     equivalent ClickHouse attribute path already does (StatementGenerator),
 *     so the two read the same way in the product.
 *
 * Operators reuse the vocabulary the rest of the query layer already speaks
 * (Search, Includes, NotEqual, GreaterThan, IsNull, ...), so a filter built in
 * the browser serializes and reconstructs with no new wire format.
 *
 * Every predicate is composed from `JsonAccessor`, which is derived from the
 * column reference only at render time — parameters are bound once, up front,
 * so `toSql` can be called more than once without minting new placeholders.
 */

/**
 * The two ways to read one key out of a jsonb column. `->>` yields text, for
 * comparison; `->` yields jsonb, for array containment and type inspection.
 */
interface JsonAccessor {
  /** `col ->> 'key'` — the value as text. NULL when the key is absent. */
  asText: string;
  /** `col -> 'key'` — the value as jsonb. NULL when the key is absent. */
  asJson: string;
}

/** A WHERE fragment that still needs to be told which column it reads. */
type PredicateFragment = (accessor: JsonAccessor) => string;

export interface JSONColumnQuery {
  /**
   * Bound parameters for the emitted SQL. The names are opaque; nothing may
   * depend on them beyond handing them to TypeORM's `Raw`.
   */
  parameters: Dictionary<JSONValue>;
  /**
   * Render the WHERE fragment for an already-quoted column reference such as
   * `"Incident"."customFields"`.
   */
  toSql: (columnReference: string) => string;
}

export type ParameterNameGeneratorFunction = () => string;

/**
 * Matches an optionally-signed decimal with optional surrounding whitespace.
 * Guards the numeric cast: a jsonb value is arbitrary text, and
 * `CAST('abc' AS NUMERIC)` aborts the whole query rather than skipping a row.
 *
 * This is load-bearing rather than defensive. A Number custom field is stored
 * as whatever the text input produced — `"42"`, not `42` — so every numeric
 * comparison runs through a cast, on rows whose value may be anything at all.
 */
const NUMERIC_TEXT_REGEX: string = "^\\s*-?[0-9]+(\\.[0-9]+)?\\s*$";

/*
 * Sanity bounds on an incoming JSON query. Nothing the product builds comes
 * close to these — a project's custom fields are capped well below the key
 * limit and a facet selection below the value limit — so exceeding one means
 * a hand-built request, and answering it with a 400 is better than compiling
 * a megabyte of SQL.
 */
export const MAX_JSON_QUERY_KEYS: number = 50;
export const MAX_JSON_QUERY_VALUES_PER_KEY: number = 200;
export const MAX_JSON_QUERY_KEY_LENGTH: number = 500;

/**
 * Escape the characters Postgres' LIKE grammar reserves, so a custom field
 * value containing `%` filters for a literal `%` rather than for anything.
 *
 * `\` is LIKE's default escape character, so it has to be doubled first.
 */
export type EscapeLikePatternFunction = (value: string) => string;

export const escapeLikePattern: EscapeLikePatternFunction = (
  value: string,
): string => {
  return value.replace(/([\\%_])/g, "\\$1");
};

type IsScalarFunction = (value: unknown) => value is string | number | boolean;

const isScalar: IsScalarFunction = (
  value: unknown,
): value is string | number | boolean => {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
};

type ScalarValue = string | number | boolean;

type ToScalarFunction = (value: unknown) => ScalarValue;

/**
 * Reduce an operator's payload to something comparable against jsonb.
 * ObjectID and friends stringify; primitives keep their type so the
 * containment literal below is `[42]` rather than `["42"]`.
 */
const toScalar: ToScalarFunction = (value: unknown): ScalarValue => {
  if (isScalar(value)) {
    return value;
  }

  if (value instanceof ObjectID) {
    return value.toString();
  }

  /*
   * A Date only reaches here from a query built server-side: one that arrived
   * over HTTP has already been through JSON, which renders a Date as its ISO
   * string. Both paths must produce the same text, because the ordering
   * comparisons below are lexicographic and only ISO-8601 makes that
   * chronological. The `String(value)` fallback would yield
   * "Sun Aug 17 2026 00:00:00 GMT+0000", which sorts by weekday name.
   */
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
};

type ToScalarArrayFunction = (values: unknown) => Array<ScalarValue>;

const toScalarArray: ToScalarArrayFunction = (
  values: unknown,
): Array<ScalarValue> => {
  if (!Array.isArray(values)) {
    return [];
  }

  return values.map((value: unknown) => {
    return toScalar(value);
  });
};

type IsNumericValueFunction = (value: unknown) => boolean;

const isNumericValue: IsNumericValueFunction = (value: unknown): boolean => {
  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (typeof value === "string" && value.trim() !== "") {
    return Number.isFinite(Number(value));
  }

  return false;
};

/**
 * Builds one key's predicate. Every helper binds its parameters immediately
 * and returns a fragment that only needs the column reference, so the caller
 * owns a complete parameter bag before any SQL is rendered.
 */
class KeyPredicateBuilder {
  private parameters: Dictionary<JSONValue>;
  private generateParameterName: ParameterNameGeneratorFunction;
  private keyParameterName: string;

  public constructor(data: {
    parameters: Dictionary<JSONValue>;
    generateParameterName: ParameterNameGeneratorFunction;
    key: string;
  }) {
    this.parameters = data.parameters;
    this.generateParameterName = data.generateParameterName;
    this.keyParameterName = this.bind(data.key);
  }

  /** Register a value and return its `:name` placeholder. */
  private bind(value: JSONValue): string {
    const name: string = this.generateParameterName();
    this.parameters[name] = value;
    return `:${name}`;
  }

  /*
   * The key is cast explicitly because `->` / `->>` are overloaded on
   * (jsonb, text) and (jsonb, integer); an untyped bind parameter would leave
   * Postgres unable to choose and fail with "operator is not unique".
   */
  public accessorFor(columnReference: string): JsonAccessor {
    return {
      asText: `${columnReference} ->> CAST(${this.keyParameterName} AS TEXT)`,
      asJson: `${columnReference} -> CAST(${this.keyParameterName} AS TEXT)`,
    };
  }

  /**
   * "The value at this key is `value`" — true for a scalar that equals it and
   * for an array that contains it.
   */
  private equals(value: ScalarValue): PredicateFragment {
    const textParameter: string = this.bind(String(value));
    const jsonParameter: string = this.bind(JSON.stringify([value]));

    return (accessor: JsonAccessor): string => {
      return `(${accessor.asText} = CAST(${textParameter} AS TEXT) OR (jsonb_typeof(${accessor.asJson}) = 'array' AND ${accessor.asJson} @> CAST(${jsonParameter} AS JSONB)))`;
    };
  }

  private join(
    fragments: Array<PredicateFragment>,
    operator: "AND" | "OR",
  ): PredicateFragment {
    return (accessor: JsonAccessor): string => {
      return `(${fragments
        .map((fragment: PredicateFragment) => {
          return fragment(accessor);
        })
        .join(` ${operator} `)})`;
    };
  }

  private anyOf(values: Array<ScalarValue>): PredicateFragment {
    return this.join(
      values.map((value: ScalarValue) => {
        return this.equals(value);
      }),
      "OR",
    );
  }

  private allOf(values: Array<ScalarValue>): PredicateFragment {
    return this.join(
      values.map((value: ScalarValue) => {
        return this.equals(value);
      }),
      "AND",
    );
  }

  /**
   * `pattern` arrives with its wildcards already placed by the caller; the
   * needle inside it has been escaped, so only the caller's own `%` are live.
   *
   * An array-valued key is matched against its JSON text (`["a", "b"]`), which
   * is what makes "contains" work on a multi-select without a second branch.
   */
  private like(pattern: string): PredicateFragment {
    const parameter: string = this.bind(pattern);

    return (accessor: JsonAccessor): string => {
      return `(${accessor.asText} ILIKE ${parameter})`;
    };
  }

  /**
   * The value at this key as NUMERIC, or NULL when it does not look like a
   * number. A CASE rather than an AND guard because Postgres does not promise
   * to evaluate the guard first, and one stray cast error aborts the query
   * instead of skipping the row.
   */
  private numericExpression(accessor: JsonAccessor): string {
    return `(CASE WHEN ${accessor.asText} ~ '${NUMERIC_TEXT_REGEX}' THEN CAST(${accessor.asText} AS NUMERIC) ELSE NULL END)`;
  }

  private compareNumeric(operator: string, value: unknown): PredicateFragment {
    const parameter: string = this.bind(Number(toScalar(value)));

    return (accessor: JsonAccessor): string => {
      return `(${this.numericExpression(accessor)} ${operator} CAST(${parameter} AS NUMERIC))`;
    };
  }

  private compareText(operator: string, value: unknown): PredicateFragment {
    const parameter: string = this.bind(String(toScalar(value)));

    return (accessor: JsonAccessor): string => {
      return `(${accessor.asText} ${operator} CAST(${parameter} AS TEXT))`;
    };
  }

  /**
   * An ordering comparison against a value whose type we only learn at runtime.
   *
   * A jsonb key holds whatever the project put there, so `>` has two readings.
   * Numbers compare numerically — "10" must be greater than "9", which text
   * comparison gets backwards. Everything else compares as text, and the case
   * that matters is a date: custom field dates are stored as ISO-8601 strings,
   * and ISO-8601 is designed so that lexicographic order IS chronological
   * order, so `>=` over the raw text is already the right question.
   *
   * Routing dates through compareNumeric — which is what these operators used
   * to do unconditionally — was silently wrong rather than loudly wrong.
   * `Number("2026-08-17T00:00:00.000Z")` is NaN, so the bound parameter became
   * `CAST(NaN AS NUMERIC)`, and `numericExpression` independently returns NULL
   * for text that does not look like a number. The predicate was therefore
   * `NULL > NaN` on every row: no error, no rows, and a lit filter chip over an
   * empty table.
   *
   * InBetween has always branched this way; these four now agree with it.
   */
  private compareOrdered(operator: string, value: unknown): PredicateFragment {
    return isNumericValue(toScalar(value))
      ? this.compareNumeric(operator, value)
      : this.compareText(operator, value);
  }

  /**
   * "No value here" — the key is absent, explicitly JSON null, an empty
   * string, or an empty array. A multi-select cleared in the UI leaves `[]`
   * behind rather than dropping the key, and a user reading "is empty" on the
   * chip means all four.
   */
  private isEmpty(): PredicateFragment {
    return (accessor: JsonAccessor): string => {
      return `(${accessor.asJson} IS NULL OR jsonb_typeof(${accessor.asJson}) = 'null' OR ${accessor.asText} = '' OR (jsonb_typeof(${accessor.asJson}) = 'array' AND jsonb_array_length(${accessor.asJson}) = 0))`;
    };
  }

  /*
   * `IS NOT TRUE` rather than `NOT (...)`: a row missing the key compares to
   * NULL, and `NOT NULL` is NULL — which would exclude exactly the rows a
   * negative filter is asked about.
   */
  private negate(fragment: PredicateFragment): PredicateFragment {
    return (accessor: JsonAccessor): string => {
      return `(${fragment(accessor)} IS NOT TRUE)`;
    };
  }

  /**
   * A multi-value condition expands to one OR-ed predicate per value, so an
   * unbounded list is an unbounded query. Refuse rather than compile it: the
   * caller gets a 400 they can act on instead of a statement the database
   * spends a minute planning.
   */
  private assertValueCountWithinLimit(value: unknown): void {
    let count: number = 0;

    if (Array.isArray(value)) {
      count = value.length;
    } else if (
      value instanceof Includes ||
      value instanceof IncludesAll ||
      value instanceof IncludesNone
    ) {
      count = (value.values || []).length;
    }

    if (count > MAX_JSON_QUERY_VALUES_PER_KEY) {
      throw new BadDataException(
        `A JSON column filter cannot match against more than ${MAX_JSON_QUERY_VALUES_PER_KEY} values at once.`,
      );
    }
  }

  private containsJson(value: unknown): PredicateFragment {
    const parameter: string = this.bind(JSON.stringify(value));

    return (accessor: JsonAccessor): string => {
      return `(${accessor.asJson} @> CAST(${parameter} AS JSONB))`;
    };
  }

  /**
   * Build this key's predicate, or null when the condition constrains nothing
   * — an "is any of" with nothing selected. Dropping it is right: narrowing to
   * zero rows would hide the table behind a filter the user just cleared.
   */
  public build(value: unknown): PredicateFragment | null {
    this.assertValueCountWithinLimit(value);

    if (value instanceof IsNull) {
      return this.isEmpty();
    }

    if (value instanceof NotNull) {
      return this.negate(this.isEmpty());
    }

    if (value instanceof IncludesAll) {
      const values: Array<ScalarValue> = toScalarArray(value.values);
      return values.length === 0 ? null : this.allOf(values);
    }

    if (value instanceof IncludesNone) {
      const values: Array<ScalarValue> = toScalarArray(value.values);
      return values.length === 0 ? null : this.negate(this.anyOf(values));
    }

    if (value instanceof Includes) {
      const values: Array<ScalarValue> = toScalarArray(value.values);
      return values.length === 0 ? null : this.anyOf(values);
    }

    if (value instanceof NotEqual) {
      return this.negate(this.equals(toScalar(value.value)));
    }

    if (value instanceof EqualToOrNull) {
      return this.join(
        [this.equals(toScalar(value.value)), this.isEmpty()],
        "OR",
      );
    }

    if (value instanceof EqualTo) {
      return this.equals(toScalar(value.value));
    }

    if (value instanceof NotContains) {
      return this.negate(
        this.like(`%${escapeLikePattern(String(toScalar(value.value)))}%`),
      );
    }

    if (value instanceof StartsWith) {
      return this.like(`${escapeLikePattern(String(toScalar(value.value)))}%`);
    }

    if (value instanceof EndsWith) {
      return this.like(`%${escapeLikePattern(String(toScalar(value.value)))}`);
    }

    if (value instanceof Search) {
      return this.like(`%${escapeLikePattern(String(toScalar(value.value)))}%`);
    }

    /*
     * Glob matching. `toLikePattern` does the escaping itself — it is the one
     * pass that can tell a `%` the user typed from the `%` a `*` becomes — so
     * `escapeLikePattern` must NOT be applied on top of it.
     */
    if (value instanceof Wildcard) {
      return this.like(toLikePattern(String(toScalar(value.value))));
    }

    if (value instanceof NotWildcard) {
      return this.negate(
        this.like(toLikePattern(String(toScalar(value.value)))),
      );
    }

    if (value instanceof InBetween) {
      const start: unknown = value.startValue;
      const end: unknown = value.endValue;

      if (isNumericValue(start) && isNumericValue(end)) {
        return this.join(
          [this.compareNumeric(">=", start), this.compareNumeric("<=", end)],
          "AND",
        );
      }

      return this.join(
        [this.compareText(">=", start), this.compareText("<=", end)],
        "AND",
      );
    }

    if (value instanceof GreaterThanOrNull) {
      return this.join(
        [this.compareNumeric(">=", value.value), this.isEmpty()],
        "OR",
      );
    }

    if (value instanceof LessThanOrNull) {
      return this.join(
        [this.compareNumeric("<=", value.value), this.isEmpty()],
        "OR",
      );
    }

    if (value instanceof GreaterThanOrEqual) {
      return this.compareOrdered(">=", value.value);
    }

    if (value instanceof GreaterThan) {
      return this.compareOrdered(">", value.value);
    }

    if (value instanceof LessThanOrEqual) {
      return this.compareOrdered("<=", value.value);
    }

    if (value instanceof LessThan) {
      return this.compareOrdered("<", value.value);
    }

    /*
     * A bare array reads as "is any of" — the same meaning QueryUtil gives a
     * top-level array, which it wraps in an ANY.
     */
    if (Array.isArray(value)) {
      const values: Array<ScalarValue> = toScalarArray(value);
      return values.length === 0 ? null : this.anyOf(values);
    }

    if (isScalar(value)) {
      return this.equals(value);
    }

    if (value === null || value === undefined) {
      return this.isEmpty();
    }

    /*
     * Anything left is a nested object. Containment is the only sensible
     * reading, and a strict improvement on what this used to do — compare the
     * column's text against "[object Object]".
     */
    return this.containsJson(value);
  }
}

export type BuildJSONColumnQueryFunction = (data: {
  value: JSONObject | string;
  generateParameterName?: ParameterNameGeneratorFunction | undefined;
}) => JSONColumnQuery;

/**
 * Turn `{ Team: Includes(["Payments"]), Region: "us-east-1" }` into one
 * AND-joined WHERE fragment over a jsonb column, plus the parameters it binds.
 *
 * An empty object keeps its historical meaning — "this column holds nothing" —
 * because that is what a JSON filter with every row cleared has always sent.
 */
const buildJSONColumnQuery: BuildJSONColumnQueryFunction = (data: {
  value: JSONObject | string;
  generateParameterName?: ParameterNameGeneratorFunction | undefined;
}): JSONColumnQuery => {
  const generateParameterName: ParameterNameGeneratorFunction =
    data.generateParameterName ||
    ((): string => {
      return Text.generateRandomText(10);
    });

  let value: JSONObject = {};

  if (typeof data.value === "string") {
    try {
      value = JSON.parse(data.value) as JSONObject;
    } catch {
      /*
       * A JSON column query that is not parseable JSON cannot be turned into a
       * predicate. Falling back to the empty object below means "this column
       * holds nothing", which is at least a filter the caller can see the
       * effect of — as opposed to a 500.
       */
      value = {};
    }
  } else {
    value = data.value || {};
  }

  const parameters: Dictionary<JSONValue> = {};
  const fragments: Array<(columnReference: string) => string> = [];

  const keys: Array<string> = Object.keys(value || {});

  if (keys.length > MAX_JSON_QUERY_KEYS) {
    throw new BadDataException(
      `A JSON column filter cannot carry more than ${MAX_JSON_QUERY_KEYS} keys.`,
    );
  }

  for (const key of keys) {
    if (typeof key !== "string" || key.length === 0) {
      continue;
    }

    if (key.length > MAX_JSON_QUERY_KEY_LENGTH) {
      throw new BadDataException(
        `A JSON column filter key cannot be longer than ${MAX_JSON_QUERY_KEY_LENGTH} characters.`,
      );
    }

    const builder: KeyPredicateBuilder = new KeyPredicateBuilder({
      parameters: parameters,
      generateParameterName: generateParameterName,
      key: key,
    });

    const fragment: PredicateFragment | null = builder.build(
      (value as JSONObject)[key],
    );

    if (!fragment) {
      continue;
    }

    fragments.push((columnReference: string): string => {
      return fragment(builder.accessorFor(columnReference));
    });
  }

  return {
    parameters: parameters,
    toSql: (columnReference: string): string => {
      if (keys.length === 0) {
        /*
         * Historical meaning of `{}`, kept verbatim: the column itself is
         * empty. Changing it would silently retarget every saved filter that
         * has ever sent an empty JSON filter.
         */
        return `(${columnReference} IS NULL OR ${columnReference} = '{}')`;
      }

      if (fragments.length === 0) {
        /*
         * Every condition turned out to constrain nothing. Matching everything
         * is right; matching nothing would hide the whole table behind a
         * filter the user had cleared.
         */
        return "(1 = 1)";
      }

      return `(${fragments
        .map((fragment: (columnReference: string) => string) => {
          return fragment(columnReference);
        })
        .join(" AND ")})`;
    },
  };
};

export default buildJSONColumnQuery;
