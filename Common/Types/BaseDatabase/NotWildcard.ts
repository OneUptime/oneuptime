import BadDataException from "../Exception/BadDataException";
import { JSONObject, ObjectType } from "../JSON";
import QueryOperator from "./QueryOperator";
import { toLikePattern } from "./WildcardPattern";

/**
 * "matches none of these globs" — the negation of {@link Wildcard}, produced
 * by `-@key:value*` in the telemetry search bar.
 *
 * It is a class of its own rather than a flag because every compiler in the
 * codebase dispatches on operator identity, and because the negated form is
 * not simply `NOT <positive form>` at the edges: on a nullable scalar the
 * predicate has to let NULL through, and on a map sub-key it has to let rows
 * that lack the key entirely through — the same asymmetry `NotContains`
 * carries.
 */
export default class NotWildcard<T extends string> extends QueryOperator<T> {
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
      _type: ObjectType.NotWildcard,
      value: (this as NotWildcard<T>).values.map((glob: T) => {
        return glob?.toString() || "";
      }),
    };
  }

  public static override fromJSON<T extends string>(
    json: JSONObject,
  ): NotWildcard<T> {
    if (json["_type"] === ObjectType.NotWildcard) {
      const value: unknown = json["value"];

      if (Array.isArray(value)) {
        return new NotWildcard<T>(
          value.map((entry: unknown) => {
            return String(entry ?? "") as T;
          }),
        );
      }

      return new NotWildcard<T>((value as T) || ("" as T));
    }

    throw new BadDataException("Invalid JSON: " + JSON.stringify(json));
  }
}
