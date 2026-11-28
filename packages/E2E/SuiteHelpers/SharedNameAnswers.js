/*
 * WHICH RECORDS OF A KIND SHARE A NAME, AS AN OFFLINE FIXTURE'S SERVER
 * ANSWERS IT (#11021).
 *
 * Every list of a kind a project can require unique names for - a kind
 * whose model marks its name @UniqueNameWhenRequired: a monitor, a cloud
 * budget, a Meraki connection, a security tool, a SIEM and the rest - asks
 * GET /shared-names/<Table> after each read of its rows, to mark the
 * records that share a name (Common/UI/Components/ModelTable/TwinMarks; the
 * shared list asks it, and so do the lists drawn by hand). The server
 * answers from the kind's records the reader may read
 * (Server/Utils/Database/RequiredUniqueNames.findTwinsOfKind): the ones
 * whose names read as one name (Types/Database/UniqueName's getNameKey:
 * case and spacing aside), the archived ones apart from the ones in
 * service, each group two records or more, with when each was made.
 *
 * A fixture answers it with answerSharedNames, beside the other routes it
 * models, handing it the records of each kind its pages list:
 *
 *   const twins = answerSharedNames({
 *     url,
 *     kinds: [{ modelType: CloudBudget, records: () => BUDGETS }],
 *   });
 *   if (twins) {
 *     return ok(twins);
 *   }
 *
 * `records` is the kind's records as the fixture keeps them now (a function,
 * so a record a spec made is counted), plain rows or models: each with its
 * _id, the column its model marks, and its createdAt and isArchived where it
 * has them. The answer is written by the server's own JSON writer
 * (toSharedNamesAnswerJSON). It is null for any other route, and for a kind
 * the fixture was not handed or whose model marks no name - which the
 * server refuses, and the Dashboard never asks - so the fixture records
 * that read as one it does not model.
 */
import {
  SHARED_NAMES_ROUTE,
  toSharedNamesAnswerJSON,
} from "Common/Types/Database/SharedNames";
import { getNameKey } from "Common/Types/Database/UniqueName";
import { getUniqueNameWhenRequiredColumn } from "Common/Types/Database/UniqueNameWhenRequired";
import { isArchivedValue } from "Common/Utils/ArchivableValues";

// An id as the answer writes it: in lower case.
function idOf(record) {
  const id = record._id || record.id;
  return id ? String(id).toLowerCase() : "";
}

// A date as the API writes one, or null.
function dateOf(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  return typeof value === "string" && value ? value : null;
}

/*
 * The answer to GET <url> - a URL, or text, absolute or a path - as JSON, or
 * null when <url> is not the route for a kind in `kinds`.
 */
export function answerSharedNames(data) {
  const url = new URL(String(data.url), "http://fixture.invalid");
  const route = url.pathname.replace(/^\/api(?=\/)/, "");
  const prefix = `${SHARED_NAMES_ROUTE}/`;

  if (!route.startsWith(prefix)) {
    return null;
  }

  const tableName = decodeURIComponent(route.slice(prefix.length));
  const kind = (data.kinds || []).find((entry) => {
    return new entry.modelType().tableName === tableName;
  });
  const column = kind ? getUniqueNameWhenRequiredColumn(kind.modelType) : null;

  if (!kind || !column) {
    return null;
  }

  const records =
    typeof kind.records === "function" ? kind.records() : kind.records;

  // Named and not deleted, by the name as it reads, as the server orders them.
  const named = (records || [])
    .filter((record) => {
      return (
        record &&
        !record.deletedAt &&
        typeof record[column] === "string" &&
        getNameKey(record[column]) !== "" &&
        idOf(record) !== ""
      );
    })
    .map((record) => {
      return {
        id: idOf(record),
        nameKey: getNameKey(record[column]),
        isArchived: isArchivedValue(record),
        createdAt: dateOf(record.createdAt),
      };
    })
    .sort((left, right) => {
      if (left.nameKey !== right.nameKey) {
        return left.nameKey < right.nameKey ? -1 : 1;
      }
      if (left.isArchived !== right.isArchived) {
        return left.isArchived ? 1 : -1;
      }
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    });

  // Records in service and archived ones are each another list's.
  const byName = new Map();
  for (const record of named) {
    const key = `${record.isArchived ? "archived" : "in-service"}\u0000${record.nameKey}`;
    byName.set(key, [...(byName.get(key) || []), record]);
  }

  const groups = [];
  const createdAt = {};
  for (const group of byName.values()) {
    // Two or more, or no mark.
    if (group.length < 2) {
      continue;
    }
    groups.push(
      group.map((record) => {
        return record.id;
      }),
    );
    for (const record of group) {
      if (record.createdAt) {
        createdAt[record.id] = record.createdAt;
      }
    }
  }

  return toSharedNamesAnswerJSON({ groups, createdAt });
}
