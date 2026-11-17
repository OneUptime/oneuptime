/*
 * A JSON value cut to fit a size, in bytes of its JSON text.
 *
 * measure() says how big a value's JSON is without writing it, and stops
 * counting once it is past the limit it was asked about: the work it does is
 * bounded by that limit, however big the value is. fit() keeps what fits and
 * says whether it left anything out:
 *
 *   - an object keeps its smallest fields whole first, so a check's dates,
 *     ids and statuses survive beside a field that does not fit, and the
 *     fields that do not fit share what is left, each cut in turn;
 *   - an array keeps its first items, and the first that does not fit is
 *     cut to what is left, when that is worth keeping;
 *   - a string is cut at its end, when strings may be cut;
 *   - anything else - a number, a date, a typed value OneUptime wrote
 *     ({"_type": ..., "value": ...}) - is kept whole or left out.
 *
 * What is kept is the value's own: nothing is copied that fits whole, and
 * nothing handed in is changed.
 */

export interface JsonBudgetOptions {
  /*
   * Whether a string may be cut. Off for a value that has not been redacted
   * yet: a secret cut in half may no longer look like one to the rules that
   * mask it. Such a string is kept whole, past the budget if it must be.
   */
  cutStrings: boolean;
}

export interface JsonBudgetResult {
  // What fits; undefined when nothing does.
  value: unknown;
  // Something was left out or cut.
  isTrimmed: boolean;
}

/*
 * Below this, the item or field that does not fit is left out rather than
 * cut to a few bytes of itself.
 */
export const MIN_PARTIAL_BUDGET_IN_BYTES: number = 64;

interface FieldSize {
  key: string;
  keyBytes: number;
  size: number;
}

export default class JsonBudget {
  /*
   * The size of the value's JSON text in bytes when it is at most `limit`;
   * otherwise any number above `limit`. A value JSON leaves out - undefined,
   * a function - measures 0.
   */
  public static measure(value: unknown, limit: number): number {
    if (value === null) {
      return 4;
    }

    switch (typeof value) {
      case "string":
        // A character is a byte at least.
        if (value.length + 2 > limit) {
          return limit + 1;
        }

        return Buffer.byteLength(JSON.stringify(value), "utf8");
      case "number":
        return Number.isFinite(value) ? String(value).length : 4;
      case "boolean":
        return value ? 4 : 5;
      case "bigint":
        return String(value).length;
      case "object":
        break;
      default:
        return 0;
    }

    if (Array.isArray(value)) {
      let size: number = 2;

      for (let i: number = 0; i < value.length; i++) {
        const item: unknown = value[i];

        size +=
          (i > 0 ? 1 : 0) +
          (JsonBudget.isLeftOut(item)
            ? 4
            : JsonBudget.measure(item, limit - size));

        if (size > limit) {
          return size;
        }
      }

      return size;
    }

    const toJSON: unknown = (value as { toJSON?: unknown }).toJSON;

    if (typeof toJSON === "function") {
      return JsonBudget.measure((toJSON as () => unknown).call(value), limit);
    }

    const source: Record<string, unknown> = value as Record<string, unknown>;
    let size: number = 2;
    let isFirst: boolean = true;

    for (const key of Object.keys(source)) {
      const child: unknown = source[key];

      if (JsonBudget.isLeftOut(child)) {
        continue;
      }

      size +=
        (isFirst ? 0 : 1) +
        JsonBudget.keyBytes(key) +
        1 +
        JsonBudget.measure(child, limit - size);
      isFirst = false;

      if (size > limit) {
        return size;
      }
    }

    return size;
  }

  // The value, cut to `budget` bytes of JSON.
  public static fit(
    value: unknown,
    budget: number,
    options: JsonBudgetOptions,
  ): JsonBudgetResult {
    const room: number = Math.max(0, Math.floor(budget));

    if (JsonBudget.measure(value, room) <= room) {
      return { value: value, isTrimmed: false };
    }

    if (typeof value === "string") {
      if (!options.cutStrings) {
        return { value: value, isTrimmed: false };
      }

      return { value: JsonBudget.cutString(value, room), isTrimmed: true };
    }

    if (Array.isArray(value)) {
      return JsonBudget.fitArray(value, room, options);
    }

    if (JsonBudget.isPlainObject(value) && !JsonBudget.isTypedValue(value)) {
      return JsonBudget.fitObject(
        value as Record<string, unknown>,
        room,
        options,
      );
    }

    // A number, a date, a typed value: whole or not at all.
    return { value: undefined, isTrimmed: true };
  }

  private static fitArray(
    value: Array<unknown>,
    budget: number,
    options: JsonBudgetOptions,
  ): JsonBudgetResult {
    if (budget < 2) {
      return { value: undefined, isTrimmed: true };
    }

    const result: Array<unknown> = [];
    let used: number = 2;

    for (const rawItem of value) {
      const item: unknown = JsonBudget.isLeftOut(rawItem) ? null : rawItem;
      const separator: number = result.length > 0 ? 1 : 0;
      const remaining: number = budget - used - separator;
      const size: number = JsonBudget.measure(item, remaining);

      if (size <= remaining) {
        result.push(item);
        used += separator + size;
        continue;
      }

      if (remaining >= MIN_PARTIAL_BUDGET_IN_BYTES) {
        const partial: JsonBudgetResult = JsonBudget.fit(
          item,
          remaining,
          options,
        );

        if (partial.value !== undefined) {
          result.push(partial.value);
        }
      }

      return { value: result, isTrimmed: true };
    }

    return { value: result, isTrimmed: false };
  }

  private static fitObject(
    value: Record<string, unknown>,
    budget: number,
    options: JsonBudgetOptions,
  ): JsonBudgetResult {
    if (budget < 2) {
      return { value: undefined, isTrimmed: true };
    }

    const keys: Array<string> = Object.keys(value).filter((key: string) => {
      return !JsonBudget.isLeftOut(value[key]);
    });

    const sizes: Array<FieldSize> = keys.map((key: string): FieldSize => {
      return {
        key: key,
        keyBytes: JsonBudget.keyBytes(key),
        size: JsonBudget.measure(value[key], budget),
      };
    });

    // The smallest first: they are what a reader needs to make sense of it.
    sizes.sort((a: FieldSize, b: FieldSize): number => {
      return a.keyBytes + a.size - (b.keyBytes + b.size);
    });

    const kept: Map<string, unknown> = new Map<string, unknown>();
    const tooBig: Array<FieldSize> = [];
    let used: number = 2;

    for (const field of sizes) {
      const cost: number =
        (kept.size > 0 ? 1 : 0) + field.keyBytes + 1 + field.size;

      if (used + cost <= budget) {
        kept.set(field.key, value[field.key]);
        used += cost;
      } else {
        tooBig.push(field);
      }
    }

    // The fields that did not fit share what is left, each cut in turn.
    for (let i: number = 0; i < tooBig.length; i++) {
      const field: FieldSize = tooBig[i]!;
      const share: number = Math.floor((budget - used) / (tooBig.length - i));
      const overhead: number = (kept.size > 0 ? 1 : 0) + field.keyBytes + 1;
      const valueBudget: number = share - overhead;

      if (valueBudget < MIN_PARTIAL_BUDGET_IN_BYTES) {
        continue;
      }

      const partial: JsonBudgetResult = JsonBudget.fit(
        value[field.key],
        valueBudget,
        options,
      );

      if (partial.value === undefined) {
        continue;
      }

      kept.set(field.key, partial.value);
      used +=
        overhead + JsonBudget.measure(partial.value, Number.MAX_SAFE_INTEGER);
    }

    const result: Record<string, unknown> = {};

    for (const key of keys) {
      if (kept.has(key)) {
        result[key] = kept.get(key);
      }
    }

    return { value: result, isTrimmed: true };
  }

  // The head of a string whose JSON fits the budget.
  private static cutString(value: string, budget: number): string | undefined {
    if (budget < 2) {
      return undefined;
    }

    let length: number = Math.min(value.length, budget - 2);

    while (length > 0) {
      // Never half of a character written as two.
      const last: number = value.charCodeAt(length - 1);
      const end: number =
        last >= 0xd800 && last <= 0xdbff ? length - 1 : length;
      const head: string = value.slice(0, end);
      const size: number = Buffer.byteLength(JSON.stringify(head), "utf8");

      if (size <= budget) {
        return head;
      }

      // Escapes and wide characters: shrink by what it is over, at least one.
      length = Math.min(end - 1, Math.floor((end * budget) / size));
    }

    return "";
  }

  private static keyBytes(key: string): number {
    return Buffer.byteLength(JSON.stringify(key), "utf8");
  }

  // What JSON leaves out of an object (and writes as null in an array).
  private static isLeftOut(value: unknown): boolean {
    return (
      value === undefined ||
      typeof value === "function" ||
      typeof value === "symbol"
    );
  }

  private static isPlainObject(value: unknown): boolean {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }

    const prototype: unknown = Object.getPrototypeOf(value);

    return prototype === Object.prototype || prototype === null;
  }

  // A value JSONFunctions.serialize wrote: {"_type": "...", "value": ...}.
  private static isTypedValue(value: unknown): boolean {
    const envelope: Record<string, unknown> = value as Record<string, unknown>;

    return (
      typeof envelope["_type"] === "string" &&
      Object.prototype.hasOwnProperty.call(envelope, "value")
    );
  }
}
