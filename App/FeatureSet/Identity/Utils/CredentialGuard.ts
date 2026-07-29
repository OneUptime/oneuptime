import BadDataException from "Common/Types/Exception/BadDataException";

/*
 * Guards for identifiers that unauthenticated identity routes use as query predicates.
 *
 * Why this exists:
 *
 * Unauthenticated routes build their lookup from `BaseModel.fromJSON(req.body["data"], T)`.
 * `fromJSON` accepts `undefined` without complaining -- `JSONFunctions.deserialize(undefined)`
 * returns `{}` because `for...in` over `undefined` is a spec no-op -- so it hands back a bare
 * model whose every field is `undefined`.
 *
 * Nothing downstream rejects that. `QueryUtil.serializeQuery` has no `undefined` handling, and
 * TypeORM defaults `invalidWhereValuesBehavior.undefined` to "ignore", which silently DROPS the
 * predicate instead of matching nothing. Combined with `_findBy`'s default sort
 * (`createdAt: Descending`, limit 1), `findOneBy({ token: undefined })` stops meaning
 * "the row with this token" and starts meaning "the newest row in the table".
 *
 * On an authentication route that is an auth bypass: an empty request body matches somebody
 * else's credential row. So every credential or identifier that reaches a WHERE clause on an
 * unauthenticated route must be proven present *before* the query runs.
 */
export default class CredentialGuard {
  /**
   * True when the value can be safely used as a query predicate.
   *
   * Rejects `undefined` and `null` (dropped by TypeORM), and empty/whitespace-only strings.
   * Domain types used as predicates here (Email, ObjectID, HashedString) all carry a custom
   * `toString()`, so an "empty" instance -- e.g. `new HashedString("")`, which `hashValue()`
   * leaves unhashed -- is rejected too.
   */
  public static isPresent(value: unknown): boolean {
    if (value === undefined || value === null) {
      return false;
    }

    if (typeof value === "string") {
      return value.trim().length > 0;
    }

    if (typeof value === "object") {
      const toStringImpl: unknown = (value as { toString?: unknown }).toString;

      const hasCustomToString: boolean =
        typeof toStringImpl === "function" &&
        toStringImpl !== Object.prototype.toString;

      if (hasCustomToString) {
        return String(value).trim().length > 0;
      }

      // A plain object carries no stringifiable identity, but it is still a value.
      return true;
    }

    return true;
  }

  /**
   * Throws BadDataException unless the value is usable as a query predicate.
   *
   * `fieldLabel` is echoed to the caller, so keep it to the field's public name -- never
   * interpolate the value itself, which would turn the guard into an oracle.
   */
  public static assertPresent(value: unknown, fieldLabel: string): void {
    if (!this.isPresent(value)) {
      throw new BadDataException(`${fieldLabel} is required.`);
    }
  }

  /**
   * Asserts every entry is present. Reports the first missing field so the error stays
   * deterministic regardless of which combination the caller omitted.
   */
  public static assertAllPresent(
    fields: Array<{ value: unknown; label: string }>,
  ): void {
    for (const field of fields) {
      this.assertPresent(field.value, field.label);
    }
  }
}
