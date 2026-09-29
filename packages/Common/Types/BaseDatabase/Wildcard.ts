import BadDataException from "../Exception/BadDataException";
import { JSONObject, ObjectType } from "../JSON";
import QueryOperator from "./QueryOperator";
import { toLikePattern } from "./WildcardPattern";

/**
 * "matches any of these globs" — `api-*`, `*.internal`, `svc-?`.
 *
 * The payload is an ARRAY of globs so that one operator covers both a single
 * pattern (`@k:a*`) and an any-of list that mixes patterns with literals
 * (`@k:(a* OR bravo)`). `Query<T>` has no OR node and is not getting one, so
 * folding the disjunction into the operator is what makes an OR over one key
 * expressible at all.
 *
 * The globs are stored exactly as the user typed them, escapes intact: the
 * LIKE pattern is derived at compile time by `toLikePattern`, so the client
 * never has to know which database it is talking to and a filter that
 * round-trips through a saved view or a URL stays readable.
 */
export default class Wildcard<T extends string> extends QueryOperator<T> {
  private _values: Array<T> = [];

  public get values(): Array<T> {
    return this._values;
  }

  public set values(v: Array<T>) {
    this._values = v;
  }

  /** The first glob. Convenience for the overwhelmingly common single case. */
  public get value(): T {
    return (this._values[0] ?? "") as T;
  }

  public constructor(value: T | Array<T>) {
    super();
    this.values = Array.isArray(value) ? value : [value];
  }

  /**
   * The canonical DSL rendering, so that a value which slips into a
   * string-coercing code path degrades to something a human can read rather
   * than to `[object Object]`.
   */
  public override toString(): T {
    if (this._values.length === 1) {
      return (this._values[0] ?? "") as T;
    }

    return `(${this._values.join(" OR ")})` as T;
  }

  /** The globs compiled to LIKE/ILIKE patterns, in order. */
  public toPatterns(): Array<string> {
    return this._values.map((glob: T) => {
      return toLikePattern(glob?.toString() || "");
    });
  }

  public override toJSON(): JSONObject {
    return {
      _type: ObjectType.Wildcard,
      value: (this as Wildcard<T>).values.map((glob: T) => {
        return glob?.toString() || "";
      }),
    };
  }

  public static override fromJSON<T extends string>(
    json: JSONObject,
  ): Wildcard<T> {
    if (json["_type"] === ObjectType.Wildcard) {
      const value: unknown = json["value"];

      if (Array.isArray(value)) {
        return new Wildcard<T>(
          value.map((entry: unknown) => {
            return String(entry ?? "") as T;
          }),
        );
      }

      return new Wildcard<T>((value as T) || ("" as T));
    }

    throw new BadDataException("Invalid JSON: " + JSON.stringify(json));
  }
}
