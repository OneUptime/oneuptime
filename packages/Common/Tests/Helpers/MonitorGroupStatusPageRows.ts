import MonitorGroupResource from "../../Models/DatabaseModels/MonitorGroupResource";
import StatusPageGroup from "../../Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "../../Models/DatabaseModels/StatusPageResource";
import MonitorGroupResourceService from "../../Server/Services/MonitorGroupResourceService";
import StatusPageResourceService from "../../Server/Services/StatusPageResourceService";
import Dictionary from "../../Types/Dictionary";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import { jest } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * Rows for the one lookup from monitors to status page resources,
 * StatusPageResourceService.findByMonitors, so a test can run the real
 * lookup - monitor groups and all - without Postgres.
 *
 * Only the two repositories it reads are faked: the status page resources,
 * and the monitor group memberships (MonitorGroupResource). Each answers the
 * query the real service built, applying every condition in it, and throws
 * on a condition or a column it does not know, so a test cannot pass
 * because the fake ignored a narrowing. skip and take are honoured, in _id
 * order, so a read that pages through every row (findAllBy) sees each once.
 */

// A status page resource: one monitor, or one monitor group, on one page.
export interface StatusPageResourceRow {
  _id: string;
  statusPageId: string;
  displayName: string;
  monitorId?: string | undefined;
  monitorGroupId?: string | undefined;
  // The status page group (the heading on the page) it is listed under.
  statusPageGroupId?: string | undefined;
  statusPageGroupName?: string | undefined;
}

// A monitor's membership of a monitor group.
export interface MonitorGroupMembershipRow {
  _id: string;
  monitorGroupId: string;
  monitorId: string;
}

// Every query each repository was asked, in order.
export interface AskedQueries {
  statusPageResources: Array<Dictionary<unknown>>;
  monitorGroupMemberships: Array<Dictionary<unknown>>;
}

// The SQL QueryHelper.any/in writes, for a column called "col".
const RAW_IN_LIST: RegExp = /^\(col IN \(:\.\.\.\w+\)\)$/;

/*
 * Whether a query condition admits `value`. Understands exactly the shapes
 * QueryHelper writes for these reads - a plain id, and the Raw IN list of
 * QueryHelper.any (or its always-false TRUE = FALSE) - and throws on
 * anything else.
 */
function conditionAdmits(condition: unknown, value: string | undefined): boolean {
  if (typeof condition === "string" || condition instanceof ObjectID) {
    return (
      value !== undefined &&
      condition.toString().toLowerCase() === value.toLowerCase()
    );
  }

  if (condition instanceof FindOperator && condition.type === "raw") {
    const operator: FindOperator<unknown> = condition as FindOperator<unknown>;
    const sql: string = operator.getSql ? operator.getSql("col") : "";

    if (sql === "TRUE = FALSE") {
      return false;
    }

    if (!RAW_IN_LIST.test(sql)) {
      throw new Error(`Unexpected raw condition in test fake: ${sql}`);
    }

    if (value === undefined) {
      return false;
    }

    return Object.values(operator.objectLiteralParameters || {})
      .flat()
      .map((item: unknown): string => {
        return String(item).toLowerCase();
      })
      .includes(value.toLowerCase());
  }

  throw new Error(
    `Unexpected query condition in test fake: ${JSON.stringify(condition)}`,
  );
}

function rowMatches(
  where: Dictionary<unknown>,
  row: Dictionary<string | undefined>,
  knownColumns: Array<string>,
): boolean {
  for (const key of Object.keys(where)) {
    if (!knownColumns.includes(key)) {
      throw new Error(`Unexpected query key in test fake: ${key}`);
    }

    if (!conditionAdmits(where[key], row[key])) {
      return false;
    }
  }

  return true;
}

function page<T extends { _id: string }>(
  rows: Array<T>,
  options: JSONObject,
): Array<T> {
  const skip: number = Number(options["skip"]) || 0;
  const take: number = Number(options["take"]) || rows.length;

  return [...rows]
    .sort((a: T, b: T): number => {
      return a._id.localeCompare(b._id);
    })
    .slice(skip, skip + take);
}

function toStatusPageResource(row: StatusPageResourceRow): StatusPageResource {
  const resource: StatusPageResource = new StatusPageResource();
  resource._id = row._id;
  resource.statusPageId = new ObjectID(row.statusPageId);
  resource.displayName = row.displayName;

  if (row.monitorId) {
    resource.monitorId = new ObjectID(row.monitorId);
  }

  if (row.monitorGroupId) {
    resource.monitorGroupId = new ObjectID(row.monitorGroupId);
  }

  if (row.statusPageGroupId) {
    resource.statusPageGroupId = new ObjectID(row.statusPageGroupId);

    const group: StatusPageGroup = new StatusPageGroup();
    group._id = row.statusPageGroupId;
    group.name = row.statusPageGroupName || "";
    resource.statusPageGroup = group;
  }

  return resource;
}

function toMonitorGroupResource(
  row: MonitorGroupMembershipRow,
): MonitorGroupResource {
  const membership: MonitorGroupResource = new MonitorGroupResource();
  membership._id = row._id;
  membership.monitorGroupId = new ObjectID(row.monitorGroupId);
  membership.monitorId = new ObjectID(row.monitorId);
  return membership;
}

/*
 * Answers StatusPageResourceService's and MonitorGroupResourceService's reads
 * from these rows for the rest of the test (restore with
 * jest.restoreAllMocks). Returns the queries each was asked.
 */
export function useMonitorGroupStatusPageRows(data: {
  resources: Array<StatusPageResourceRow>;
  memberships: Array<MonitorGroupMembershipRow>;
}): AskedQueries {
  const asked: AskedQueries = {
    statusPageResources: [],
    monitorGroupMemberships: [],
  };

  jest.spyOn(StatusPageResourceService, "getRepository").mockReturnValue({
    find: async (options: JSONObject): Promise<Array<StatusPageResource>> => {
      const where: Dictionary<unknown> = (options["where"] ||
        {}) as Dictionary<unknown>;

      asked.statusPageResources.push(where);

      return page(
        data.resources.filter((row: StatusPageResourceRow): boolean => {
          return rowMatches(
            where,
            row as unknown as Dictionary<string | undefined>,
            ["_id", "statusPageId", "monitorId", "monitorGroupId"],
          );
        }),
        options,
      ).map(toStatusPageResource);
    },
  } as never);

  jest.spyOn(MonitorGroupResourceService, "getRepository").mockReturnValue({
    find: async (options: JSONObject): Promise<Array<MonitorGroupResource>> => {
      const where: Dictionary<unknown> = (options["where"] ||
        {}) as Dictionary<unknown>;

      asked.monitorGroupMemberships.push(where);

      return page(
        data.memberships.filter((row: MonitorGroupMembershipRow): boolean => {
          return rowMatches(
            where,
            row as unknown as Dictionary<string | undefined>,
            ["_id", "monitorGroupId", "monitorId"],
          );
        }),
        options,
      ).map(toMonitorGroupResource);
    },
  } as never);

  return asked;
}
