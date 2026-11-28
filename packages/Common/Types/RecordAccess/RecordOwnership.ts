import { JSONObject } from "../JSON";
import { RecordOwners } from "../LabelAccess/LabelAccess";
import ObjectID from "../ObjectID";

/*
 * WHO OWNS THE RECORDS ON SCREEN, AS THE SERVER'S OWN OWNED SCOPE READS IT
 * (#11436).
 *
 * A role scoped to Owned - or a grant limited to labels with one scoped to
 * Owned beside it - reaches only the records the person, or the team the
 * grant is given to, owns. The Dashboard's locks are worked out by the rule
 * the server refuses by (Types/LabelAccess/LabelAccess), from the reader's
 * permission snapshot; who owns a record is the one thing the snapshot
 * cannot tell, so a monitor's, a service's, a dashboard's and a status
 * page's Edit and Delete were offered to someone who does not own it, and
 * refused after the click.
 *
 * So a page asks the server once for the records it shows - a record's
 * page for its record, a list for the rows on screen - POST
 * /<record>/record-ownership { ids } - and the server answers from the
 * lookups its Owned scope narrows every write by (Server/Types/Database
 * /Permissions/OwnedScopePermission.getOwnersOf):
 *
 *   - for each record the reader may read (no other is answered at all):
 *     whether the reader owns it themselves, and which of the teams their
 *     grants scoped to Owned are given on own it - never their other teams,
 *     nor anyone else's;
 *   - the tables whose rows take their owners from the kind's records, and
 *     the operations on each the Owned scope narrows - the kind itself, its
 *     owner tables and every part that takes its owners from it (a
 *     monitor's probes), so the same answer locks a part's Add and Remove
 *     (#11435). Where the scope narrows nothing, a grant scoped to Owned
 *     reaches every record, and nothing is locked by who owns it.
 *
 * Shared by the server, which answers, and the Dashboard, which locks what
 * the rule refuses, so the two cannot drift apart. The server keeps the
 * last word on every write whatever a page offers.
 */

// The operations the Owned scope may narrow on a table.
export type RecordOwnershipOperation = "create" | "read" | "update" | "delete";

const OPERATIONS: ReadonlyArray<RecordOwnershipOperation> = [
  "create",
  "read",
  "update",
  "delete",
];

export interface RecordOwnershipTable {
  // "Monitor", "MonitorOwnerUser", "MonitorProbe".
  tableName: string;
  // The column a row names the record by: "_id" for the kind itself.
  key: string;
  // The operations on it the record's owners decide.
  operations: Array<RecordOwnershipOperation>;
}

export interface RecordOwnershipResult {
  // The kind's own table: "Monitor".
  tableName: string;
  // The kind's own table first, then the tables that take their owners from it.
  tables: Array<RecordOwnershipTable>;
  // By record id, in lower case: only the records the reader may read.
  records: Record<string, RecordOwners>;
}

const readIdList: (value: unknown) => Array<string> | null = (
  value: unknown,
): Array<string> | null => {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    return null;
  }

  const ids: Array<string> = [];

  for (const id of value) {
    if (typeof id !== "string") {
      return null;
    }

    const text: string = id.trim().toLowerCase();

    if (text && ObjectID.isValidUUID(text) && !ids.includes(text)) {
      ids.push(text);
    }
  }

  return ids;
};

export default class RecordOwnership {
  // Each kind's route, under its own API: POST /monitor/record-ownership.
  public static readonly routePath: string = "/record-ownership";

  // The most records one ask names: a list's page is never longer.
  public static readonly MAX_RECORDS: number = 200;

  /*
   * The ids a request names, as the server reads them: each a valid id,
   * once, in lower case, at most MAX_RECORDS of them. Null when the body
   * names none in the shape it takes - `{ ids: [...] }`.
   */
  public static readRequestIds(body: unknown): Array<string> | null {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return null;
    }

    const ids: Array<string> | null = readIdList(
      (body as JSONObject)["ids"],
    );

    if (!ids) {
      return null;
    }

    return ids.slice(0, RecordOwnership.MAX_RECORDS);
  }

  // The table the answer says the owners decide on, by name; null when none.
  public static getTable(
    result: RecordOwnershipResult | null | undefined,
    tableName: string | null | undefined,
  ): RecordOwnershipTable | null {
    if (!result || !tableName) {
      return null;
    }

    return (
      result.tables.find((table: RecordOwnershipTable): boolean => {
        return table.tableName === tableName;
      }) || null
    );
  }

  // Who owns one record, as the answer says; null when it says nothing of it.
  public static getOwners(
    result: RecordOwnershipResult | null | undefined,
    recordId: string | null | undefined,
  ): RecordOwners | null {
    if (!result || !recordId) {
      return null;
    }

    return result.records[recordId.toString().toLowerCase()] || null;
  }

  public static toJSON(result: RecordOwnershipResult): JSONObject {
    const records: JSONObject = {};

    for (const [recordId, owners] of Object.entries(result.records)) {
      records[recordId] = {
        isOwnedByCaller: owners.isOwnedByCaller,
        teamIds: (owners.teamIds || []).map((teamId: unknown): string => {
          return String(teamId).toLowerCase();
        }),
      };
    }

    return {
      tableName: result.tableName,
      tables: result.tables.map((table: RecordOwnershipTable): JSONObject => {
        return {
          tableName: table.tableName,
          key: table.key,
          operations: [...table.operations],
        };
      }),
      records: records,
    };
  }

  /*
   * The server's answer as the Dashboard receives it, or null when it cannot
   * be read: a table, an operation or a record in a shape it does not know.
   * Null locks nothing more than the reader's own permissions and the
   * records' labels do - the server still holds every write to the rule -
   * where reading a broken answer as owned or not would say what nobody
   * worked out.
   */
  public static fromJSON(json: unknown): RecordOwnershipResult | null {
    if (!json || typeof json !== "object" || Array.isArray(json)) {
      return null;
    }

    const value: JSONObject = json as JSONObject;
    const tableName: unknown = value["tableName"];
    const tables: unknown = value["tables"];
    const records: unknown = value["records"];

    if (
      typeof tableName !== "string" ||
      !tableName ||
      !Array.isArray(tables) ||
      !records ||
      typeof records !== "object" ||
      Array.isArray(records)
    ) {
      return null;
    }

    const result: RecordOwnershipResult = {
      tableName: tableName,
      tables: [],
      records: {},
    };

    for (const table of tables) {
      if (!table || typeof table !== "object" || Array.isArray(table)) {
        return null;
      }

      const name: unknown = (table as JSONObject)["tableName"];
      const key: unknown = (table as JSONObject)["key"];
      const operations: unknown = (table as JSONObject)["operations"];

      if (
        typeof name !== "string" ||
        !name ||
        typeof key !== "string" ||
        !key ||
        !Array.isArray(operations) ||
        operations.some((operation: unknown): boolean => {
          return (
            typeof operation !== "string" ||
            !OPERATIONS.includes(operation as RecordOwnershipOperation)
          );
        })
      ) {
        return null;
      }

      result.tables.push({
        tableName: name,
        key: key,
        operations: Array.from(
          new Set<RecordOwnershipOperation>(
            operations as Array<RecordOwnershipOperation>,
          ),
        ),
      });
    }

    for (const [recordId, owners] of Object.entries(records as JSONObject)) {
      if (!owners || typeof owners !== "object" || Array.isArray(owners)) {
        return null;
      }

      const isOwnedByCaller: unknown = (owners as JSONObject)[
        "isOwnedByCaller"
      ];
      const teamIds: Array<string> | null = readIdList(
        (owners as JSONObject)["teamIds"],
      );
      const id: string = recordId.trim().toLowerCase();

      if (typeof isOwnedByCaller !== "boolean" || !teamIds || !id) {
        return null;
      }

      result.records[id] = {
        isOwnedByCaller: isOwnedByCaller,
        teamIds: teamIds,
      };
    }

    return result;
  }
}
