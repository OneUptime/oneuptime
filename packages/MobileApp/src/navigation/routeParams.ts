/*
 * Navigation params are plain, serialisable data by contract, so two routes
 * open the same screen exactly when their names and their params' data
 * match - whatever object identity the params happen to have.
 */

function isEmpty(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0)
  );
}

/** Data equality for navigation params. An absent params object equals an empty one. */
export function areParamsEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (isEmpty(left) && isEmpty(right)) {
    return true;
  }
  if (
    typeof left !== "object" ||
    typeof right !== "object" ||
    left === null ||
    right === null
  ) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) {
      return false;
    }
    return (
      left.length === right.length &&
      left.every((value: unknown, index: number): boolean => {
        return areParamsEqual(value, right[index]);
      })
    );
  }
  const leftRecord: Record<string, unknown> = left as Record<string, unknown>;
  const rightRecord: Record<string, unknown> = right as Record<
    string,
    unknown
  >;
  const keys: Set<string> = new Set([
    ...Object.keys(leftRecord),
    ...Object.keys(rightRecord),
  ]);
  for (const key of keys) {
    if (!areParamsEqual(leftRecord[key], rightRecord[key])) {
      return false;
    }
  }
  return true;
}

/**
 * Whether a route's params contain every key of `expected` with the same
 * data. A list row names the record it opens; the open screen may carry
 * more than that.
 */
export function paramsInclude(params: unknown, expected: object): boolean {
  const actual: Record<string, unknown> =
    typeof params === "object" && params !== null
      ? (params as Record<string, unknown>)
      : {};
  return Object.entries(expected as Record<string, unknown>).every(
    ([key, value]: [string, unknown]): boolean => {
      return areParamsEqual(actual[key], value);
    },
  );
}
