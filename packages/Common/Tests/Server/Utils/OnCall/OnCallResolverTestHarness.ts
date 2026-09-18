import { FindOperator } from "typeorm";
import { jest } from "@jest/globals";
import OnCallDutyPolicyScheduleService from "../../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyScheduleLayerService from "../../../../Server/Services/OnCallDutyPolicyScheduleLayerService";
import OnCallDutyPolicyScheduleLayerUserService from "../../../../Server/Services/OnCallDutyPolicyScheduleLayerUserService";
import OnCallDutyPolicyEscalationRuleScheduleService from "../../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyUserOverrideService from "../../../../Server/Services/OnCallDutyPolicyUserOverrideService";
import ProjectService from "../../../../Server/Services/ProjectService";
import UserService from "../../../../Server/Services/UserService";
import OneUptimeDate from "../../../../Types/Date";
import EventInterval from "../../../../Types/Events/EventInterval";
import Recurring from "../../../../Types/Events/Recurring";
import ObjectID from "../../../../Types/ObjectID";
import RestrictionTimes from "../../../../Types/OnCallDutyPolicy/RestrictionTimes";
import {
  noRestriction,
  rotation,
} from "../../../Types/OnCallDutyPolicy/CalendarFeedTestFixtures";

/*
 * An in-memory stand-in for the handful of tables the shift resolver and the
 * materializer read. Every service read (`findBy`, `findOneById`,
 * `findOneBy`) is spied and answered from these rows, with the query
 * interpreted just far enough to honour equality, IN, IS NULL, <= / >= and
 * "= x OR IS NULL" — the operators QueryHelper builds — so the REAL service
 * code runs end to end against the same fixture the tests inspect.
 *
 * Rows are plain objects shaped like the model instances the code reads:
 * `_id` for queries, `id` for the getter the services use, relations as
 * nested `{ id }` objects.
 */

export type FakeRow = Record<string, unknown>;

export interface FakeDb {
  schedules: Array<FakeRow>;
  layers: Array<FakeRow>;
  layerUsers: Array<FakeRow>;
  attachments: Array<FakeRow>;
  overrides: Array<FakeRow>;
  users: Array<FakeRow>;
  projects: Array<FakeRow>;
}

export function emptyDb(): FakeDb {
  return {
    schedules: [],
    layers: [],
    layerUsers: [],
    attachments: [],
    overrides: [],
    users: [],
    projects: [],
  };
}

function toComparable(value: unknown): number {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "number") {
    return value;
  }
  const parsed: Date = new Date(String(value));
  return parsed.getTime();
}

function toKey(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

/*
 * Interpret one query value against one row value. Unknown operators are
 * treated as "matches" so a new QueryHelper construct degrades to "return
 * everything" rather than to a silent empty result.
 */
export function matchesValue(queryValue: unknown, rowValue: unknown): boolean {
  if (queryValue === undefined) {
    return true;
  }

  if (queryValue instanceof FindOperator) {
    const generator: ((alias: string) => string) | undefined =
      queryValue.getSql as ((alias: string) => string) | undefined;
    const sql: string = generator ? generator("col") : "";
    const parameters: Array<unknown> = Object.values(
      queryValue.objectLiteralParameters || {},
    );
    const first: unknown = parameters[0];

    if (sql.includes("TRUE = FALSE")) {
      return false;
    }

    if (sql.includes(" or ") && sql.includes("IS NULL")) {
      if (rowValue === null || rowValue === undefined) {
        return true;
      }
      return parameters.map(toKey).includes(toKey(rowValue));
    }

    if (sql.includes("IS NOT NULL")) {
      return rowValue !== null && rowValue !== undefined;
    }

    if (sql.includes("IS NULL")) {
      return rowValue === null || rowValue === undefined;
    }

    if (sql.includes("IN (") && Array.isArray(first)) {
      return (first as Array<unknown>).map(toKey).includes(toKey(rowValue));
    }

    if (sql.includes("<=")) {
      return toComparable(rowValue) <= toComparable(first);
    }

    if (sql.includes(">=")) {
      return toComparable(rowValue) >= toComparable(first);
    }

    return true;
  }

  return toKey(queryValue) === toKey(rowValue);
}

export function matchesQuery(
  query: Record<string, unknown> | undefined,
  row: FakeRow,
): boolean {
  if (!query) {
    return true;
  }

  for (const [key, value] of Object.entries(query)) {
    if (!matchesValue(value, row[key])) {
      return false;
    }
  }

  return true;
}

function applySort(
  rows: Array<FakeRow>,
  sort: Record<string, unknown> | undefined,
): Array<FakeRow> {
  if (!sort) {
    return rows;
  }

  const [key, direction] = Object.entries(sort)[0] || [];

  if (!key) {
    return rows;
  }

  const descending: boolean = String(direction)
    .toLowerCase()
    .startsWith("desc");

  return [...rows].sort((a: FakeRow, b: FakeRow) => {
    const left: number = toComparable(a[key]);
    const right: number = toComparable(b[key]);
    return descending ? right - left : left - right;
  });
}

type FindByArgs = {
  query?: Record<string, unknown>;
  sort?: Record<string, unknown>;
};

function fakeFindBy(
  table: () => Array<FakeRow>,
): (args: FindByArgs) => Promise<Array<FakeRow>> {
  return (args: FindByArgs): Promise<Array<FakeRow>> => {
    const rows: Array<FakeRow> = table().filter((row: FakeRow) => {
      return matchesQuery(args.query, row);
    });
    return Promise.resolve(applySort(rows, args.sort));
  };
}

function fakeFindOneBy(
  table: () => Array<FakeRow>,
): (args: FindByArgs) => Promise<FakeRow | null> {
  return (args: FindByArgs): Promise<FakeRow | null> => {
    const row: FakeRow | undefined = table().find((candidate: FakeRow) => {
      return matchesQuery(args.query, candidate);
    });
    return Promise.resolve(row || null);
  };
}

function fakeFindOneById(
  table: () => Array<FakeRow>,
): (args: { id: ObjectID }) => Promise<FakeRow | null> {
  return (args: { id: ObjectID }): Promise<FakeRow | null> => {
    const row: FakeRow | undefined = table().find((candidate: FakeRow) => {
      return toKey(candidate["_id"]) === toKey(args.id);
    });
    return Promise.resolve(row || null);
  };
}

/*
 * Spy every read the resolver / materializer / roster path performs and
 * answer it from `db`. Call inside a test (or beforeEach); restore with
 * jest.restoreAllMocks().
 */
export function installFakeDb(db: FakeDb): void {
  jest.spyOn(OnCallDutyPolicyScheduleService, "findBy").mockImplementation(
    fakeFindBy(() => {
      return db.schedules;
    }) as never,
  );
  jest.spyOn(OnCallDutyPolicyScheduleService, "findOneById").mockImplementation(
    fakeFindOneById(() => {
      return db.schedules;
    }) as never,
  );
  jest.spyOn(OnCallDutyPolicyScheduleService, "findOneBy").mockImplementation(
    fakeFindOneBy(() => {
      return db.schedules;
    }) as never,
  );

  jest.spyOn(OnCallDutyPolicyScheduleLayerService, "findBy").mockImplementation(
    fakeFindBy(() => {
      return db.layers;
    }) as never,
  );

  jest
    .spyOn(OnCallDutyPolicyScheduleLayerUserService, "findBy")
    .mockImplementation(
      fakeFindBy(() => {
        return db.layerUsers;
      }) as never,
    );

  jest
    .spyOn(OnCallDutyPolicyEscalationRuleScheduleService, "findBy")
    .mockImplementation(
      fakeFindBy(() => {
        return db.attachments;
      }) as never,
    );

  jest.spyOn(OnCallDutyPolicyUserOverrideService, "findBy").mockImplementation(
    fakeFindBy(() => {
      return db.overrides;
    }) as never,
  );

  jest.spyOn(UserService, "findBy").mockImplementation(
    fakeFindBy(() => {
      return db.users;
    }) as never,
  );

  jest.spyOn(ProjectService, "findBy").mockImplementation(
    fakeFindBy(() => {
      return db.projects;
    }) as never,
  );
}

// -- Row builders ----------------------------------------------------------

export function oid(value: string): ObjectID {
  return new ObjectID(value);
}

export const DEFAULT_UPDATED_AT: Date = OneUptimeDate.fromString(
  "2026-08-01T10:00:00Z",
);

export function makeSchedule(data: {
  id: string;
  projectId: string;
  name?: string | undefined;
  timezone?: string | undefined;
  shiftConfigVersion?: number | undefined;
  createdAt?: Date | undefined;
  updatedAt?: Date | undefined;
}): FakeRow {
  return {
    _id: oid(data.id),
    id: oid(data.id),
    projectId: oid(data.projectId),
    name: data.name ?? `Schedule ${data.id}`,
    timezone: data.timezone,
    shiftConfigVersion: data.shiftConfigVersion ?? 0,
    createdAt:
      data.createdAt ?? OneUptimeDate.fromString("2026-01-01T00:00:00Z"),
    // Deliberately "recent": the resolver must NOT pick this up.
    updatedAt:
      data.updatedAt ?? OneUptimeDate.fromString("2026-12-31T00:00:00Z"),
  };
}

export function makeLayer(data: {
  id: string;
  scheduleId: string;
  projectId: string;
  name?: string | undefined;
  order?: number | undefined;
  startsAt: Date;
  handOffTime: Date;
  rotation?: Recurring | undefined;
  restrictionTimes?: RestrictionTimes | undefined;
  updatedAt?: Date | undefined;
}): FakeRow {
  return {
    _id: oid(data.id),
    id: oid(data.id),
    onCallDutyPolicyScheduleId: oid(data.scheduleId),
    projectId: oid(data.projectId),
    name: data.name ?? `Layer ${data.id}`,
    description: "",
    order: data.order ?? 1,
    startsAt: data.startsAt,
    handOffTime: data.handOffTime,
    rotation: data.rotation ?? rotation(EventInterval.Day, 1),
    restrictionTimes: data.restrictionTimes ?? noRestriction(),
    updatedAt: data.updatedAt ?? DEFAULT_UPDATED_AT,
  };
}

export function makeLayerUser(data: {
  id: string;
  scheduleId: string;
  layerId: string;
  projectId: string;
  userId: string;
  order?: number | undefined;
  updatedAt?: Date | undefined;
}): FakeRow {
  return {
    _id: oid(data.id),
    id: oid(data.id),
    onCallDutyPolicyScheduleId: oid(data.scheduleId),
    onCallDutyPolicyScheduleLayerId: oid(data.layerId),
    projectId: oid(data.projectId),
    userId: oid(data.userId),
    user: { id: oid(data.userId), _id: oid(data.userId) },
    order: data.order ?? 1,
    updatedAt: data.updatedAt ?? DEFAULT_UPDATED_AT,
  };
}

export function makeAttachment(data: {
  id: string;
  scheduleId: string;
  projectId: string;
  policyId: string;
  policyName?: string | undefined;
  ruleId: string;
  ruleName?: string | undefined;
  ruleOrder?: number | undefined;
  updatedAt?: Date | undefined;
}): FakeRow {
  return {
    _id: oid(data.id),
    id: oid(data.id),
    onCallDutyPolicyScheduleId: oid(data.scheduleId),
    projectId: oid(data.projectId),
    onCallDutyPolicyId: oid(data.policyId),
    onCallDutyPolicyEscalationRuleId: oid(data.ruleId),
    onCallDutyPolicy: {
      id: oid(data.policyId),
      _id: oid(data.policyId),
      name: data.policyName ?? `Policy ${data.policyId}`,
    },
    onCallDutyPolicyEscalationRule: {
      id: oid(data.ruleId),
      _id: oid(data.ruleId),
      name: data.ruleName ?? `Rule ${data.ruleId}`,
      order: data.ruleOrder ?? 1,
    },
    onCallDutyPolicySchedule: {
      id: oid(data.scheduleId),
      _id: oid(data.scheduleId),
      name: `Schedule ${data.scheduleId}`,
    },
    updatedAt: data.updatedAt ?? DEFAULT_UPDATED_AT,
  };
}

export function makeOverride(data: {
  id: string;
  projectId: string;
  overrideUserId: string;
  routeAlertsToUserId: string;
  startsAt: Date;
  endsAt: Date;
  policyId?: string | undefined;
  updatedAt?: Date | undefined;
}): FakeRow {
  return {
    _id: oid(data.id),
    id: oid(data.id),
    projectId: oid(data.projectId),
    overrideUserId: oid(data.overrideUserId),
    routeAlertsToUserId: oid(data.routeAlertsToUserId),
    startsAt: data.startsAt,
    endsAt: data.endsAt,
    onCallDutyPolicyId: data.policyId ? oid(data.policyId) : null,
    updatedAt: data.updatedAt ?? DEFAULT_UPDATED_AT,
  };
}

export function makeUser(data: {
  id: string;
  name?: string | undefined;
  email?: string | undefined;
  timezone?: string | undefined;
}): FakeRow {
  return {
    _id: oid(data.id),
    id: oid(data.id),
    name: data.name,
    email: data.email,
    timezone: data.timezone,
  };
}

export function makeProject(data: { id: string; name: string }): FakeRow {
  return {
    _id: oid(data.id),
    id: oid(data.id),
    name: data.name,
  };
}
