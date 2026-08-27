import BadDataException from "../../../Types/Exception/BadDataException";
import Includes from "../../../Types/BaseDatabase/Includes";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import { ObjectType } from "../../../Types/JSON";
import { toLikePattern } from "../../../Types/BaseDatabase/WildcardPattern";
import { SQL, Statement, escapeIlikePattern } from "./Statement";

/*
 * Attribute predicates for the hand-written aggregation builders (log /
 * trace / metric / exception histograms, facets, analytics and exports).
 *
 * The *list* query for every signal is compiled by StatementGenerator from a
 * `Query<Model>`; these endpoints receive the same filters as JSON instead,
 * so an operator arrives as the serialized `{_type, value}` shape that every
 * QueryOperator's `toJSON()` emits. This module is the single place that
 * turns one of those back into SQL, so a filter cannot mean one thing in the
 * list and another in the chart beside it — which is exactly what happened
 * while each aggregation service carried its own partial copy.
 *
 * Predicates use the case-insensitive `arrayExists((k, v) -> lowerUTF8(k) =
 * lowerUTF8(?) ...)` form over `mapKeys`/`mapValues` rather than a direct
 * `attributes['k']` subscript: these keys are typed by a person, so
 * `requestId` and `requestid` have to be the same filter. StatementGenerator
 * makes the same choice for its user-typed operators (see the comment above
 * its map branch).
 *
 * The map column is `attributes` on every model routed through here.
 */

/** A serialized QueryOperator off the wire: `{_type: "Search", value: "web"}`. */
export interface SerializedAttributeOperator {
  _type: string;
  value?: unknown;
}

export interface AppendAttributeOperatorFilterOptions {
  /** The statement being built. The predicate is appended, prefixed with `AND`. */
  statement: Statement;
  /** Attribute key as typed by the user. Callers MUST validate it first. */
  attributeKey: string;
  /** The serialized operator. */
  operator: Record<string, unknown>;
}

type MatchesFunction = (predicate: Statement) => Statement;
type RequirePrimitiveFunction = (
  value: unknown,
) => string | number | boolean | null;
type TextValueFunction = () => string;
type LikeFunction = (pattern: string) => Statement;
type NumericFunction = (comparison: string) => Statement;
type MembershipValuesFunction = () => Array<string>;
type HasNonEmptyValueFunction = () => Statement;

export type AppendAttributeOperatorFilterFunction = (
  options: AppendAttributeOperatorFilterOptions,
) => void;

/**
 * Compile one serialized attribute operator into a predicate and append it.
 *
 * Throws BadDataException (a 400, not a 500) for an operator this builder
 * cannot honour or a value it cannot bind — refusing is the only answer that
 * keeps the chart and the list agreeing.
 */
export const appendAttributeOperatorFilter: AppendAttributeOperatorFilterFunction =
  (options: AppendAttributeOperatorFilterOptions): void => {
    const { statement, attributeKey, operator } = options;

    const operatorType: unknown = operator["_type"];
    const rawValue: unknown = operator["value"];

    // `<key> matches case-insensitively AND <predicate>` over the map pairs.
    const matches: MatchesFunction = (predicate: Statement): Statement => {
      return SQL`arrayExists((k, v) -> lowerUTF8(k) = lowerUTF8(${{
        type: TableColumnType.Text,
        value: attributeKey,
      }}) AND `
        .append(predicate)
        .append(SQL`, mapKeys(attributes), mapValues(attributes))`);
    };

    /*
     * `value` is unvalidated JSON off the wire. `String()` and `Number()` do
     * not merely produce a bad result on an object — ToPrimitive THROWS a
     * TypeError when the object shadows toString/valueOf with non-callables
     * (`{"toString": 1}`), and that escapes the BadDataException the default
     * branch raises, answering with a 500 instead of a 400. Narrow to
     * primitives first so every rejection goes out the same door.
     */
    const requirePrimitive: RequirePrimitiveFunction = (
      value: unknown,
    ): string | number | boolean | null => {
      if (value === undefined || value === null) {
        return null;
      }

      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        return value;
      }

      throw new BadDataException(
        `Invalid value in the attribute filter for "${attributeKey}"`,
      );
    };

    const textValue: TextValueFunction = (): string => {
      const primitive: string | number | boolean | null =
        requirePrimitive(rawValue);

      return primitive === null ? "" : String(primitive);
    };

    const like: LikeFunction = (pattern: string): Statement => {
      return SQL`v ILIKE ${{
        type: TableColumnType.Text,
        value: pattern,
      }}`;
    };

    /*
     * Map values are stored as text; toFloat64OrNull yields NULL for
     * non-numeric values (including the empty default for a missing key),
     * which compares false against any threshold and drops those rows.
     */
    const numeric: NumericFunction = (comparison: string): Statement => {
      const primitive: string | number | boolean | null =
        requirePrimitive(rawValue);
      const threshold: number = Number(primitive);

      /*
       * Reject rather than bind. `Number(null)` is 0, so a filter with no
       * value would silently become "> 0", and a non-numeric one binds as the
       * literal `nan`, which ClickHouse cannot parse — a 500 where the user
       * should get a 400 naming the filter.
       */
      if (
        primitive === null ||
        primitive === "" ||
        !Number.isFinite(threshold)
      ) {
        throw new BadDataException(
          `The attribute filter for "${attributeKey}" needs a numeric value`,
        );
      }

      /*
       * Decimal (ClickHouse Double), not Number (Int32): the left-hand side is
       * a Float64 and thresholds are free text, so `> 1.5` bound as Int32 is a
       * parse error at the database rather than a comparison.
       *
       * The comparison itself is appended as raw SQL — an interpolation in the
       * SQL tag becomes a bound Identifier, which is not what `>` is. Every
       * caller passes a literal from the switch below, never user input.
       */
      return SQL`toFloat64OrNull(v) `.append(comparison).append(
        SQL` ${{
          type: TableColumnType.Decimal,
          value: threshold,
        }}`,
      );
    };

    /*
     * A Wildcard payload is an array of globs (a single glob is an array of
     * one), and the wire shape is whatever JSON arrived — accept both so a
     * client that sends the scalar form still works.
     */
    const globPatterns: MembershipValuesFunction = (): Array<string> => {
      const globs: Array<unknown> = Array.isArray(rawValue)
        ? rawValue
        : [rawValue];

      return globs
        .map((entry: unknown) => {
          const primitive: string | number | boolean | null =
            requirePrimitive(entry);

          return primitive === null ? "" : String(primitive);
        })
        .filter((glob: string) => {
          return glob.length > 0;
        })
        .map((glob: string) => {
          return toLikePattern(glob);
        });
    };

    const membershipValues: MembershipValuesFunction = (): Array<string> => {
      return Array.isArray(rawValue)
        ? rawValue.map((entry: unknown) => {
            const primitive: string | number | boolean | null =
              requirePrimitive(entry);

            return primitive === null ? "" : String(primitive);
          })
        : [];
    };

    /*
     * "the key is present with a non-empty value".
     *
     * A ClickHouse Map subscript returns the value type's default for a
     * missing key, so the list query's `attributes['k']` reads as '' for a row
     * that has no such attribute at all. That makes an EMPTY comparison value
     * mean something different from every other value, in both directions:
     * `attributes['k'] = ''` matches rows that lack the key, and
     * `attributes['k'] != ''` drops them. Naively negating the existence test
     * gets both backwards — an "is not equal to <blank>" filter counted every
     * row in the project while the list beside it counted only the handful
     * that carried the attribute.
     */
    const hasNonEmptyValue: HasNonEmptyValueFunction = (): Statement => {
      return matches(SQL`v != ''`);
    };

    switch (operatorType) {
      case ObjectType.EqualTo:
        if (textValue() === "") {
          // `attributes['k'] = ''` — missing or empty. Same set as "is empty".
          statement.append(SQL` AND NOT `.append(hasNonEmptyValue()));
          return;
        }

        statement.append(
          SQL` AND `.append(
            matches(
              SQL`v = ${{
                type: TableColumnType.Text,
                value: textValue(),
              }}`,
            ),
          ),
        );
        return;

      case ObjectType.NotEqual:
        if (textValue() === "") {
          /*
           * `attributes['k'] != ''` — present AND non-empty. Same set as
           * "is not empty"; see hasNonEmptyValue above for why blank is
           * special.
           */
          statement.append(SQL` AND `.append(hasNonEmptyValue()));
          return;
        }

        /*
         * Negating the whole existence test is what makes rows that lack the
         * attribute pass, matching the map-subscript form's semantics (a
         * missing key reads as '' and so is != a non-empty value).
         */
        statement.append(
          SQL` AND NOT `.append(
            matches(
              SQL`v = ${{
                type: TableColumnType.Text,
                value: textValue(),
              }}`,
            ),
          ),
        );
        return;

      /*
       * Every ILIKE pattern below escapes the user's `%` and `_` so they match
       * literally. Without it a value like `100%` or `req_id` silently widens
       * the match here while the list query (which escapes centrally, in
       * Statement.serializseValue) matches it literally — the chart and the
       * table disagreeing on the same filter.
       */
      case ObjectType.Search:
        statement.append(
          SQL` AND `.append(
            matches(like(`%${escapeIlikePattern(textValue())}%`)),
          ),
        );
        return;

      case ObjectType.NotContains:
        statement.append(
          SQL` AND NOT `.append(
            matches(like(`%${escapeIlikePattern(textValue())}%`)),
          ),
        );
        return;

      case ObjectType.StartsWith:
        statement.append(
          SQL` AND `.append(
            matches(like(`${escapeIlikePattern(textValue())}%`)),
          ),
        );
        return;

      case ObjectType.EndsWith:
        statement.append(
          SQL` AND `.append(
            matches(like(`%${escapeIlikePattern(textValue())}`)),
          ),
        );
        return;

      /*
       * Globs, one ILIKE per glob OR-ed together so an any-of list can mix
       * patterns with literals. `toLikePattern` decides which `%`/`_` are
       * wildcards and which are literal characters the user typed, so
       * escaping on top of it would escape the wildcards it just produced.
       *
       * The negated form is NOT arrayExists, so a row that does not carry the
       * attribute passes — it trivially fails to match the glob.
       */
      case ObjectType.Wildcard:
      case ObjectType.NotWildcard: {
        const patterns: Array<string> = globPatterns();

        // An empty pattern list constrains nothing — the "All" reading.
        if (patterns.length === 0) {
          return;
        }

        const disjunction: Statement = SQL`(`;

        patterns.forEach((pattern: string, index: number) => {
          if (index > 0) {
            disjunction.append(SQL` OR `);
          }

          disjunction.append(like(pattern));
        });

        disjunction.append(SQL`)`);

        statement.append(
          (operatorType === ObjectType.Wildcard ? SQL` AND ` : SQL` AND NOT `)
            .append(matches(disjunction)),
        );
        return;
      }

      case ObjectType.GreaterThan:
        statement.append(SQL` AND `.append(matches(numeric(">"))));
        return;

      case ObjectType.GreaterThanOrEqual:
        statement.append(SQL` AND `.append(matches(numeric(">="))));
        return;

      case ObjectType.LessThan:
        statement.append(SQL` AND `.append(matches(numeric("<"))));
        return;

      case ObjectType.LessThanOrEqual:
        statement.append(SQL` AND `.append(matches(numeric("<="))));
        return;

      case ObjectType.IsNull:
        // "is empty" — no non-empty value stored under that key.
        statement.append(SQL` AND NOT `.append(hasNonEmptyValue()));
        return;

      case ObjectType.NotNull:
        statement.append(SQL` AND `.append(hasNonEmptyValue()));
        return;

      case ObjectType.Includes:
      case ObjectType.IncludesNone: {
        const values: Array<string> = membershipValues();

        /*
         * An empty membership list means "All", not "nothing" — skipping the
         * predicate matches how StatementGenerator and the form treat it, and
         * avoids emitting `IN ()`.
         */
        if (values.length === 0) {
          return;
        }

        const membership: Statement = matches(
          SQL`v IN (${{
            type: TableColumnType.Text,
            value: new Includes(values),
          }})`,
        );

        statement.append(
          (operatorType === ObjectType.Includes
            ? SQL` AND `
            : SQL` AND NOT `
          ).append(membership),
        );
        return;
      }

      default:
        /*
         * An unrecognized shape is a filter this builder cannot honour.
         * Refuse it rather than binding an object as text and quietly
         * returning counts that disagree with the list.
         */
        throw new BadDataException(
          `Unsupported attribute filter for "${attributeKey}"`,
        );
    }
  };

export default appendAttributeOperatorFilter;
