import DatabaseProperty from "../../../Types/Database/DatabaseProperty";

/*
 * A record's ID as text, whatever shape it arrives in.
 *
 * The same ID reaches the UI in three shapes:
 *
 *   - a string, on a database (Postgres) model, whose `_id` column is text;
 *   - an ObjectID, on an analytics (ClickHouse) row - a span, an LLM call, a
 *     log, an exception, a profile. AnalyticsBaseModel turns every ObjectID
 *     column it reads, `_id` included, into an ObjectID;
 *   - `{ _type: "ObjectID", value }`, the JSON an API response carries.
 *
 * Code that shows an ID must not assume the first. An ObjectID handed to
 * React as a child is "Objects are not valid as a React child" (minified
 * React error #31), and that is what "Show ID" on AI / LLM > Overview threw
 * (issue #4615): a table shared by both kinds of model cast the row's `_id`
 * to a string, which on a span it is not.
 *
 * Anything that holds no ID - nothing, an empty string, an object with no
 * text value, a list - is "", which callers read as "no ID".
 *
 * React-free, so the rule can be read and tested on its own. The details
 * card's ID line (Detail/DetailRecordId.ts) and the Show ID dialog
 * (RecordIdModal.tsx) both read IDs through it.
 */
export const getRecordIdText: (value: unknown) => string = (
  value: unknown,
): string => {
  if (value === null || value === undefined) {
    return "";
  }

  if (value instanceof DatabaseProperty) {
    return value.toString().trim();
  }

  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    /*
     * The JSON shape, and an ObjectID from another copy of this module (a
     * second bundle's class fails instanceof, but it still has a `value`).
     */
    const inner: unknown = (value as { value?: unknown }).value;

    if (typeof inner === "string") {
      return inner.trim();
    }
  }

  return "";
};

// Whether a value holds an ID at all: the rows "Show ID" is offered on.
export const hasRecordId: (value: unknown) => boolean = (
  value: unknown,
): boolean => {
  return getRecordIdText(value) !== "";
};
