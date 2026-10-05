import AIRunService from "../../../../../Server/Services/AIRunService";
import AlertService from "../../../../../Server/Services/AlertService";
import AutoRemediationSuggestionService from "../../../../../Server/Services/AutoRemediationSuggestionService";
import IncidentService from "../../../../../Server/Services/IncidentService";
import MonitorService from "../../../../../Server/Services/MonitorService";
import RunnerJobService from "../../../../../Server/Services/RunnerJobService";
import ServiceService from "../../../../../Server/Services/ServiceService";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import PositiveNumber from "../../../../../Types/PositiveNumber";
import { jest } from "@jest/globals";

/*
 * An in-memory stand-in for the tables the incident and alert AI activity
 * readers read - incidents, alerts, AI runs, auto-remediation suggestions,
 * Runner jobs, monitors and services - behind the services' own findBy (and
 * the incidents' and alerts' countBy), so the readers run unchanged.
 *
 * It answers the query shapes the readers build: plain equality, and the
 * QueryHelper operators they use (notNull, isNull, lessThan,
 * greaterThanEqualTo, any), read off each operator's own SQL. Sorting is by
 * createdAt, newest first, and limit is honoured.
 *
 * Who may read what is the access below: root reads everything; a caller's
 * read of a table their role may not read throws NotAuthorizedException, the
 * way the permission layer does, and a caller's read of incidents, alerts,
 * monitors or services only returns the ones they may read (labels, private
 * incidents).
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
  monitors: Array<FakeRow>;
  services: Array<FakeRow>;
}

export interface FakeAccess {
  canReadIncidents: boolean;
  canReadAlerts: boolean;
  canReadSuggestions: boolean;
  canReadJobs: boolean;
  canReadMonitors: boolean;
  canReadServices: boolean;
  // The rows a caller may read; every one when left out.
  readableIncidentIds?: Set<string> | undefined;
  readableAlertIds?: Set<string> | undefined;
  readableMonitorIds?: Set<string> | undefined;
  readableServiceIds?: Set<string> | undefined;
}

export type FakeTableName = keyof FakeTables;

export interface FakeCall {
  table: FakeTableName;
  method: "findBy" | "countBy";
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
    return matchesFilter(row[key], query[key]);
  });
}

// A row as a service returns it: id as an ObjectID, everything else as stored.
function toModel(row: FakeRow): Record<string, unknown> {
  return { ...row, id: new ObjectID(row._id) };
}

// A related row (a monitor or a service on an incident) as a relation select returns it.
export function related(id: string): Record<string, unknown> {
  return { _id: id, id: new ObjectID(id) };
}

export interface FakeStore {
  tables: FakeTables;
  access: FakeAccess;
  calls: Array<FakeCall>;
  callsTo: (
    table: FakeTableName,
    method?: "findBy" | "countBy",
  ) => Array<FakeCall>;
}

export function emptyTables(): FakeTables {
  return {
    incidents: [],
    alerts: [],
    runs: [],
    suggestions: [],
    jobs: [],
    monitors: [],
    services: [],
  };
}

export function fullAccess(): FakeAccess {
  return {
    canReadIncidents: true,
    canReadAlerts: true,
    canReadSuggestions: true,
    canReadJobs: true,
    canReadMonitors: true,
    canReadServices: true,
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
    callsTo: (
      table: FakeTableName,
      method: "findBy" | "countBy" = "findBy",
    ): Array<FakeCall> => {
      return store.calls.filter((call: FakeCall): boolean => {
        return call.table === table && call.method === method;
      });
    },
  };

  const permitted: (
    table: FakeTableName,
    props: DatabaseCommonInteractionProps,
  ) => Array<FakeRow> = (
    table: FakeTableName,
    props: DatabaseCommonInteractionProps,
  ): Array<FakeRow> => {
    if (props?.isRoot) {
      return store.tables[table];
    }

    const allowed: Record<FakeTableName, boolean> = {
      incidents: store.access.canReadIncidents,
      alerts: store.access.canReadAlerts,
      runs: false,
      suggestions: store.access.canReadSuggestions,
      jobs: store.access.canReadJobs,
      monitors: store.access.canReadMonitors,
      services: store.access.canReadServices,
    };

    if (!allowed[table]) {
      throw new NotAuthorizedException(
        `You do not have permission to read ${table}.`,
      );
    }

    const readable: Partial<Record<FakeTableName, Set<string> | undefined>> = {
      incidents: store.access.readableIncidentIds,
      alerts: store.access.readableAlertIds,
      monitors: store.access.readableMonitorIds,
      services: store.access.readableServiceIds,
    };

    const ids: Set<string> | undefined = readable[table];

    return store.tables[table].filter((row: FakeRow): boolean => {
      return !ids || ids.has(row._id);
    });
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
        method: "findBy",
        query: findBy.query,
        select: findBy.select,
        limit: findBy.limit,
        props: findBy.props,
      });

      return permitted(table, findBy.props)
        .filter((row: FakeRow): boolean => {
          return matches(row, findBy.query);
        })
        .sort((a: FakeRow, b: FakeRow): number => {
          return b.createdAt.getTime() - a.createdAt.getTime();
        })
        .slice(0, findBy.limit || undefined)
        .map(toModel);
    };
  };

  const count: (
    table: FakeTableName,
  ) => (args: unknown) => Promise<PositiveNumber> = (table: FakeTableName) => {
    return async (args: unknown): Promise<PositiveNumber> => {
      const countBy: {
        query: Record<string, unknown>;
        props: DatabaseCommonInteractionProps;
      } = args as {
        query: Record<string, unknown>;
        props: DatabaseCommonInteractionProps;
      };

      store.calls.push({
        table,
        method: "countBy",
        query: countBy.query,
        select: {},
        limit: 0,
        props: countBy.props,
      });

      return new PositiveNumber(
        permitted(table, countBy.props).filter((row: FakeRow): boolean => {
          return matches(row, countBy.query);
        }).length,
      );
    };
  };

  jest
    .spyOn(IncidentService, "findBy")
    .mockImplementation(find("incidents") as never);
  jest
    .spyOn(IncidentService, "countBy")
    .mockImplementation(count("incidents") as never);
  jest
    .spyOn(AlertService, "findBy")
    .mockImplementation(find("alerts") as never);
  jest
    .spyOn(AlertService, "countBy")
    .mockImplementation(count("alerts") as never);
  jest.spyOn(AIRunService, "findBy").mockImplementation(find("runs") as never);
  jest
    .spyOn(AutoRemediationSuggestionService, "findBy")
    .mockImplementation(find("suggestions") as never);
  jest
    .spyOn(RunnerJobService, "findBy")
    .mockImplementation(find("jobs") as never);
  jest
    .spyOn(MonitorService, "findBy")
    .mockImplementation(find("monitors") as never);
  jest
    .spyOn(ServiceService, "findBy")
    .mockImplementation(find("services") as never);

  return store;
}

// A UUID that reads as its number, so a failing assertion says which row.
export function uuid(group: number, index: number): string {
  return `${String(group).padStart(8, "0")}-0000-4000-8000-${String(index).padStart(12, "0")}`;
}
