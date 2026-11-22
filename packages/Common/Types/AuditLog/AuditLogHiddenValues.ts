import { JSONObject, JSONValue } from "../JSON";

/*
 * WHAT AN AUDIT LOG ENTRY SAYS IN PLACE OF WHAT ITS READER MAY NOT READ
 * (#10642).
 *
 * An entry is held, as it is read, to what its reader may read of the
 * record it is about (Server/Utils/AuditLog/AuditLogReadAccess). What they
 * may not read is kept as having changed, and shown as hidden:
 *
 *   - a field they may not read on the record is still named, so the entry
 *     says it changed, who changed it and when; its values read
 *     AUDIT_LOG_HIDDEN_VALUE, the lines that described it are left out, and
 *     the change says so (valueHidden: true) - the dashboard writes "Value
 *     hidden" there, in the reader's language;
 *   - a record they may not read at all has every field so, and its name
 *     reads AUDIT_LOG_HIDDEN_VALUE too: the dashboard writes "Name hidden".
 *
 * A secret is another thing: nobody reads its value through the audit log,
 * so it is recorded as AUDIT_LOG_REDACTED_VALUE (AuditLogRedaction), and a
 * reader who may not read the field sees it hidden like any other.
 */

export const AUDIT_LOG_HIDDEN_VALUE: string = "[HIDDEN]";

// The key a change's hidden values are said by.
export const AUDIT_LOG_VALUE_HIDDEN_KEY: string = "valueHidden";

/*
 * A change as its reader is handed it when they may not read its field:
 * the field, and each value it recorded as AUDIT_LOG_HIDDEN_VALUE - an
 * update's before and after, a created or deleted record's one value -
 * with no lines describing it.
 */
export function hideAuditLogChange(change: JSONObject): JSONObject {
  const hidden: JSONObject = {
    field: (change["field"] as JSONValue) ?? null,
    [AUDIT_LOG_VALUE_HIDDEN_KEY]: true,
  };

  for (const key of ["oldValue", "newValue"]) {
    if (Object.prototype.hasOwnProperty.call(change, key)) {
      hidden[key] = AUDIT_LOG_HIDDEN_VALUE;
    }
  }

  return hidden;
}

// Whether a change's values were kept from its reader.
export function isAuditLogChangeHidden(change: unknown): boolean {
  return Boolean(
    change &&
      typeof change === "object" &&
      !Array.isArray(change) &&
      (change as JSONObject)[AUDIT_LOG_VALUE_HIDDEN_KEY] === true,
  );
}

// Whether an entry's name was kept from its reader.
export function isAuditLogNameHidden(name: unknown): boolean {
  return name === AUDIT_LOG_HIDDEN_VALUE;
}
