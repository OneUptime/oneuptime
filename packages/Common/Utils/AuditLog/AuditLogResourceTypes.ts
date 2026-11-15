import EqualTo from "../../Types/BaseDatabase/EqualTo";
import Includes from "../../Types/BaseDatabase/Includes";
import IncludesNone from "../../Types/BaseDatabase/IncludesNone";
import NotEqual from "../../Types/BaseDatabase/NotEqual";
import { getSingularNameSpellings } from "../ModelApiName";

/*
 * WHICH ENTRIES A RESOURCE TYPE FINDS, BY EITHER OF ITS NAMES (#7580).
 *
 * The audit log stores an entry's resource type under the singular name
 * the model keeps outside its screens (Common/Utils/ModelApiName): every
 * entry about an On-Call Schedule, last year's and today's, is stored as
 * "On-Call Policy Schedule", and every one about an Ingestion Key as
 * "Telemetry Ingestion Key". The pages show the type by the name on screen.
 * So a read that names a type - the Resource Type filter, a resource's own
 * Audit Logs page, the API's filter - may name it either way, and finds
 * the entries stored under either: the kept name, as the recorder writes
 * it, and the name on screen, should any entry carry that.
 *
 * withAuditLogResourceTypeSpellings rewrites a query so, and
 * AuditLogService reads every list, count, chart and existence check
 * through it. A type nobody renamed reads exactly as it always did. A text
 * search on the stored name ("contains", "starts with") is left as it is:
 * it reads the stored words.
 */

// The query keys that hold a resource type.
export const AUDIT_LOG_RESOURCE_TYPE_KEYS: ReadonlyArray<string> = [
  "resourceType",
  "rootResourceType",
];

// Every name a resource type's entries can be stored under, the kept one first.
export function getAuditLogResourceTypeSpellings(type: string): Array<string> {
  return getSingularNameSpellings(type);
}

// Every name of the types in a list, each once, in the order given.
function spellingsOfAll(values: ReadonlyArray<unknown>): Array<unknown> {
  const spellings: Array<unknown> = [];

  for (const value of values) {
    const names: Array<unknown> =
      typeof value === "string"
        ? getAuditLogResourceTypeSpellings(value)
        : [value];

    for (const name of names) {
      if (!spellings.includes(name)) {
        spellings.push(name);
      }
    }
  }

  return spellings;
}

/*
 * A resource type's condition, matching every name the type goes by: a
 * type is any of them, and "not" a type is none of them. A condition on a
 * type with one name, or one that is no equality, is handed back as it is.
 */
export function toAuditLogResourceTypeCondition(value: unknown): unknown {
  if (typeof value === "string") {
    const spellings: Array<string> = getAuditLogResourceTypeSpellings(value);

    return spellings.length > 1 ? new Includes(spellings) : value;
  }

  if (value instanceof EqualTo && typeof value.value === "string") {
    const spellings: Array<string> = getAuditLogResourceTypeSpellings(
      value.value,
    );

    return spellings.length > 1 ? new Includes(spellings) : value;
  }

  if (value instanceof NotEqual && typeof value.value === "string") {
    const spellings: Array<string> = getAuditLogResourceTypeSpellings(
      value.value,
    );

    return spellings.length > 1 ? new IncludesNone(spellings) : value;
  }

  if (value instanceof Includes) {
    const spellings: Array<unknown> = spellingsOfAll(value.values);

    return spellings.length > value.values.length
      ? new Includes(spellings as Array<string>)
      : value;
  }

  if (value instanceof IncludesNone) {
    const spellings: Array<unknown> = spellingsOfAll(value.values);

    return spellings.length > value.values.length
      ? new IncludesNone(spellings as Array<string>)
      : value;
  }

  return value;
}

/*
 * The query, with each resource type it names matching every name the type
 * goes by. A new query: the one given is left as it was.
 */
export function withAuditLogResourceTypeSpellings<TQuery>(
  query: TQuery,
): TQuery {
  if (!query || typeof query !== "object") {
    return query;
  }

  const rewritten: Record<string, unknown> = {
    ...(query as Record<string, unknown>),
  };

  for (const key of AUDIT_LOG_RESOURCE_TYPE_KEYS) {
    if (rewritten[key] !== undefined && rewritten[key] !== null) {
      rewritten[key] = toAuditLogResourceTypeCondition(rewritten[key]);
    }
  }

  return rewritten as TQuery;
}
