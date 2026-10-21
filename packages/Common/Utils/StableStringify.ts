type StableStringifyFunction = (value: unknown) => string;

/*
 * JSON with object keys sorted at every depth, and a key whose value is
 * undefined left out, as JSON.stringify leaves it out.
 *
 * jsonb hands keys back in its own order, not the order they were written,
 * so a value read back from Postgres must not look different from the same
 * value as a request body carried it. Use this wherever such a value is
 * compared or hashed: the identity of an SLO rule's criteria, the key a
 * criteria filter's match history is kept under.
 */
const stableStringify: StableStringifyFunction = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value
      .map((item: unknown): string => {
        return stableStringify(item);
      })
      .join(",")}]`;
  }

  if (value !== null && typeof value === "object") {
    const record: Record<string, unknown> = value as Record<string, unknown>;

    return `{${Object.keys(record)
      .filter((key: string): boolean => {
        return record[key] !== undefined;
      })
      .sort()
      .map((key: string): string => {
        return `${JSON.stringify(key)}:${stableStringify(record[key])}`;
      })
      .join(",")}}`;
  }

  return JSON.stringify(value === undefined ? null : value);
};

export default stableStringify;
