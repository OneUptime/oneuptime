import { JSONObject, ObjectType } from "../JSON";
import ObjectID from "../ObjectID";

/*
 * The id one entry of a list of ids in a create request's misc data names:
 * a string (what the dashboard sends), an ObjectID (what the API's
 * deserializer makes of { _type: "ObjectID" }), or that JSON itself when a
 * caller inside the server passes it on. Null for anything else, and for an
 * empty string.
 *
 * Shared by the readers of what a create form asks along with the record:
 * who a new on-call policy pages first (FirstResponders) and who takes turns
 * in a new on-call schedule (ScheduleFirstLayer).
 */
export const readMiscDataId: (entry: unknown) => string | null = (
  entry: unknown,
): string | null => {
  if (typeof entry === "string") {
    return entry.trim() || null;
  }

  if (entry instanceof ObjectID) {
    return entry.toString().trim() || null;
  }

  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    const record: JSONObject = entry as JSONObject;

    if (
      record["_type"] === ObjectType.ObjectID &&
      typeof record["value"] === "string"
    ) {
      return record["value"].trim() || null;
    }
  }

  return null;
};
