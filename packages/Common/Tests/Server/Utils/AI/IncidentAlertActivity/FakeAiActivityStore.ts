import AIRunService from "../../../../../Server/Services/AIRunService";
import AlertService from "../../../../../Server/Services/AlertService";
import AutoRemediationSuggestionService from "../../../../../Server/Services/AutoRemediationSuggestionService";
import IncidentService from "../../../../../Server/Services/IncidentService";
import RunnerJobService from "../../../../../Server/Services/RunnerJobService";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import { jest } from "@jest/globals";

/*
 * An in-memory stand-in for the five tables the incident and alert AI
 * activity readers read - incidents, alerts, AI runs, auto-remediation
 * suggestions and Runner jobs - behind the services' own findBy, so the
 * readers run unchanged.
 *
 * It answers the query shapes the readers build: plain equality, and the
 * QueryHelper operators they use (notNull, isNull, lessThan,
 * greaterThanEqualTo, any), read off each operator's own SQL. Sorting is by
 * createdAt, newest first, and limit is honoured.
 *
 * Who may read what is the access below: root reads everything; a caller's
 * read of a table their role may not read throws NotAuthorizedException, the
 * way the permission layer does, and a caller's read of incidents or alerts
 * only returns the ones they may read (labels, private incidents).
 */

export type FakeRow = Record<string, unknown> & {
  _id: string;
  createdAt: Date;
};

export interface FakeTables {
  incidents: Array<FakeRow>;
  alerts: Array<FakeRow>;
  runs: Array<FakeRow>;
  suggestions: Array<FakeRow>;
  jobs: Array<FakeRow>;
}

export interface FakeAccess {
  canReadIncidents: boolean;
  canReadAlerts: boolean;
  canReadSuggestions: boolean;
  canReadJobs: boolean;
  // The incidents and alerts a caller may read; every one when left out.
  readableIncidentIds?: Set<string> | undefined;
  readableAlertIds?: Set<string> | undefined;
}

export type FakeTableName = keyof FakeTables;

export interface FakeCall {
  table: FakeTableName;
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  limit: number;
  props: DatabaseCommonInteractionProps;
}

interface Operator {
  getSql?: (alias: string) => string;
  objectLiteralParameters?: Record<string, unknown>;
}

function isOperator(value: unknown): value is Operator {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as Operator).getSql === "function"
  );
}

function toComparable(value: unknown): unknown {
  if (value instanceof ObjectID) {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  return value;
}

function firstParameter(operator: Operator): unknown {
  return Object.values(operator.objectLiteralParameters || {})[0];
}

export function matchesFilter(value: unknown, filter: unknown): boolean {
  if (!isOperator(filter)) {
    return toComparable(value) === toComparable(filter);
  }

  const sql: string = filter.getSql!("column");

  if (sql.includes("TRUE = FALSE")) {
    return false;
  }

  if (sql.includes("IS NOT NULL")) {
    return value !== null && value !== undefined;
  }

  if (sql.includes("IS NULL")) {
    return value === null || value === undefined;
  }

  if (sql.includes(" IN (")) {
    const values: Array<string> = (
      (firstParameter(filter) as Array<unknown>) || []
    ).map((item: unknown): string => {
      return String(item);
    });
    return (
      value !== null && value !== undefined && values.includes(String(value))
    );
  }

  const bound: unknown = toComparable(firstParameter(filter));
  const comparable: unknown = toComparable(value);

  if (typeof comparable !== "number" || typeof bound !== "number") {
    return false;
  }

  if (sql.includes(" >= ")) {
    return comparable >= bound;
  }

  if (sql.includes(" <= ")) {
    return comparable <= bound;
  }

  if (sql.includes(" < ")) {
    return comparable < bound;
  }

  if (sql.includes(" > ")) {
    return comparable > bound;
  }

  throw new Error(`The fake store does not know the operator ${sql}.`);
}

function matches(row: FakeRow, query: Record<string, unknown>): boolean {
  return Object.keys(query).every((key: string): boolean => {
    const column: string = key === "_id" ? "_id" : key;
    return matchesFilter(row[column], query[key]);
  });
}

// A row as a service returns it: id as an ObjectID, everything else as stored.
function toModel(row: FakeRow): Record<string, unknown> {
  return { ...row, id: new ObjectID(row._id) };
}

export interface FakeStore {
  tables: FakeTables;
  access: FakeAccess;
  calls: Array<FakeCall>;
  callsTo: (table: FakeTableName) => Array<FakeCall>;
}

export function emptyTables(): FakeTables {
  return { incidents: [], alerts: [], runs: [], suggestions: [], jobs: [] };
}

export function fullAccess(): FakeAccess {
  return {
    canReadIncidents: true,
    canReadAlerts: true,
    canReadSuggestions: true,
    canReadJobs: true,
  };
}

export function installFakeStore(
  tables: FakeTables,
  access: FakeAccess = fullAccess(),
): FakeStore {
  const store: FakeStore = {
    tables,
    access,
    calls: [],
    callsTo: (table: FakeTableName): Array<FakeCall> => {
      return store.calls.filter((call: FakeCall): boolean => {
        return call.table === table;
      });
    },
  };

  const find: (
    table: FakeTableName,
  ) => (args: unknown) => Promise<Array<unknown>> = (table: FakeTableName) => {
    return async (args: unknown): Promise<Array<unknown>> => {
      const findBy: {
        query: Record<string, unknown>;
        select: Record<string, unknown>;
        limit: number;
        props: DatabaseCommonInteractionProps;
      } = args as {
        query: Record<string, unknown>;
        select: Record<string, unknown>;
        limit: number;
        props: DatabaseCommonInteractionProps;
      };

      store.calls.push({
        table,
        query: findBy.query,
        select: findBy.select,
        limit: findBy.limit,
        props: findBy.props,
      });

      const isRoot: boolean = Boolean(findBy.props?.isRoot);

      if (!isRoot) {
        const allowed: boolean =
          table === "incidents"
            ? store.access.canReadIncidents
            : table === "alerts"
              ? store.access.canReadAlerts
              : table === "suggestions"
                ? store.access.canReadSuggestions
                : table === "jobs"
                  ? store.access.canReadJobs
                  : false;

        if (!allowed) {
          throw new NotAuthorizedException(
            `You do not have permission to read ${table}.`,
          );
        }
      }

      const readable: Set<string> | undefined = isRoot
        ? undefined
        : table === "incidents"
          ? store.access.readableIncidentIds
          : table === "alerts"
            ? store.access.readableAlertIds
            : undefined;

      return store.tables[table]
        .filter((row: FakeRow): boolean => {
          return (
            matches(row, findBy.query) && (!readable || readable.has(row._id))
          );
        })
        .sort((a: FakeRow, b: FakeRow): number => {
          return b.createdAt.getTime() - a.createdAt.getTime();
        })
        .slice(0, findBy.limit || undefined)
        .map(toModel);
    };
  };

  jest
    .spyOn(IncidentService, "findBy")
    .mockImplementation(find("incidents") as never);
  jest
    .spyOn(AlertService, "findBy")
    .mockImplementation(find("alerts") as never);
  jest.spyOn(AIRunService, "findBy").mockImplementation(find("runs") as never);
  jest
    .spyOn(AutoRemediationSuggestionService, "findBy")
    .mockImplementation(find("suggestions") as never);
  jest
    .spyOn(RunnerJobService, "findBy")
    .mockImplementation(find("jobs") as never);

  return store;
}

// A UUID that reads as its number, so a failing assertion says which row.
export function uuid(group: number, index: number): string {
  return `${String(group).padStart(8, "0")}-0000-4000-8000-${String(index).padStart(12, "0")}`;
}
