import { describe, expect, test } from "@jest/globals";
import { FindOperator } from "typeorm";
import Alert from "../../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import IncidentInternalNote from "../../../../../Models/DatabaseModels/IncidentInternalNote";
import Log from "../../../../../Models/AnalyticsModels/Log";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import MonitorOwnerTeam from "../../../../../Models/DatabaseModels/MonitorOwnerTeam";
import MonitorStatusTimeline from "../../../../../Models/DatabaseModels/MonitorStatusTimeline";
import OnCallDutyPolicySchedule from "../../../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import Probe from "../../../../../Models/DatabaseModels/Probe";
import Service from "../../../../../Models/DatabaseModels/Service";
import ServiceLevelObjective from "../../../../../Models/DatabaseModels/ServiceLevelObjective";
import TelemetryException from "../../../../../Models/DatabaseModels/TelemetryException";
import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import AnalyticsModelPermission from "../../../../../Server/Types/AnalyticsDatabase/ModelPermission";
import BasePermission from "../../../../../Server/Types/Database/Permissions/BasePermission";
import ReadAudiencePermission, {
  ReadAudienceCondition,
} from "../../../../../Server/Types/Database/Permissions/ReadAudiencePermission";
import { TelemetryReadScope } from "../../../../../Server/Utils/Telemetry/TelemetryReadScope";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ReadAudience from "../../../../../Types/BaseDatabase/ReadAudience";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";

/*
 * WHAT EVERY READER OF A SUBJECT MAY READ (#9576).
 *
 * An AI investigation reads as OneUptime and writes its report where
 * everyone who may see its incident or alert reads it. The permission
 * layer narrows each of its reads for that audience: a kind nobody reads
 * only by owner or label is read whole; a kind somebody does is read as
 * nobody in particular may read it (no owner, no label), beside what the
 * subject names itself; a private incident or alert is never read unless
 * it is the subject; and a record read through others goes with them.
 * Each condition is read here as Postgres reads it.
 */

const PROJECT: string = "11111111-1111-4111-8111-111111111111";
const SUBJECT_MONITOR: string = "22222222-2222-4222-8222-000000000001";
const SUBJECT_INCIDENT: string = "33333333-3333-4333-8333-000000000001";
const OTHER_INCIDENT: string = "33333333-3333-4333-8333-000000000002";

function audience(data: Partial<ReadAudience> = {}): ReadAudience {
  return {
    _type: "ReadAudience",
    projectId: PROJECT,
    ownedOnlyPermissions: [],
    labelledPermissions: [],
    named: {},
    telemetryBlockedIds: [],
    ...data,
  };
}

function sqlOf(condition: unknown, alias: string): string {
  expect(condition).toBeInstanceOf(FindOperator);

  return (condition as FindOperator<unknown>).getSql!(alias);
}

function parametersOf(condition: unknown): Record<string, unknown> {
  return (
    (condition as FindOperator<unknown>).objectLiteralParameters || {}
  ) as Record<string, unknown>;
}

const UNOWNED_MONITOR: string =
  '(NOT EXISTS (SELECT 1 FROM "MonitorOwnerUser" WHERE "MonitorOwnerUser"."monitorId" = "Monitor"."_id" AND "MonitorOwnerUser"."deletedAt" IS NULL) AND NOT EXISTS (SELECT 1 FROM "MonitorOwnerTeam" WHERE "MonitorOwnerTeam"."monitorId" = "Monitor"."_id" AND "MonitorOwnerTeam"."deletedAt" IS NULL))';
const UNLABELLED_MONITOR: string =
  '("Monitor"."_id" NOT IN (SELECT "MonitorLabel"."monitorId" FROM "MonitorLabel" WHERE "MonitorLabel"."monitorId" IS NOT NULL))';

describe("who reads for an audience", () => {
  test("only OneUptime's own read carries one: a person never reads as an audience", () => {
    const readers: ReadAudience = audience();

    expect(
      ReadAudiencePermission.getAudience({
        isRoot: true,
        readAudience: readers,
      }),
    ).toBe(readers);
    expect(ReadAudiencePermission.getAudience({ isRoot: true })).toBeNull();
    expect(
      ReadAudiencePermission.getAudience({
        userId: ObjectID.generate(),
        readAudience: readers,
      }),
    ).toBeNull();
    expect(ReadAudiencePermission.getAudience(undefined)).toBeNull();
  });

  test("its props read as OneUptime, held to the project, narrowed by the audience", () => {
    const readers: ReadAudience = audience();
    const props: DatabaseCommonInteractionProps =
      ReadAudiencePermission.getReadProps(readers);

    expect(props.isRoot).toBe(true);
    expect(props.tenantId?.toString()).toBe(PROJECT);
    expect(props.readAudience).toBe(readers);
  });
});

describe("which kinds somebody reads only by owner or label", () => {
  test("a project with no scoped permission narrows nobody", () => {
    const readers: ReadAudience = audience();

    expect(ReadAudiencePermission.narrowsNobody(readers)).toBe(true);
    expect(ReadAudiencePermission.isNarrowed(Monitor, readers)).toBe(false);
    expect(ReadAudiencePermission.isNarrowed(Service, readers)).toBe(false);
  });

  test("a monitor permission held scoped to Owned narrows monitors by owner, and nothing else", () => {
    const readers: ReadAudience = audience({
      ownedOnlyPermissions: [Permission.ReadProjectMonitor],
    });

    expect(ReadAudiencePermission.narrowsNobody(readers)).toBe(false);
    expect(ReadAudiencePermission.isNarrowedByOwners(Monitor, readers)).toBe(
      true,
    );
    expect(ReadAudiencePermission.isNarrowedByLabels(Monitor, readers)).toBe(
      false,
    );
    expect(ReadAudiencePermission.isNarrowed(Service, readers)).toBe(false);
    expect(ReadAudiencePermission.isNarrowed(Incident, readers)).toBe(false);
  });

  test("a role that grants many kinds narrows each of them: rules written on one permission reach every kind it reads", () => {
    const readers: ReadAudience = audience({
      labelledPermissions: [Permission.ProjectMember],
    });

    for (const kind of [Monitor, Service, Incident, ServiceLevelObjective]) {
      expect(ReadAudiencePermission.isNarrowedByLabels(kind, readers)).toBe(
        true,
      );
    }
  });

  test("the operational resources' wildcard narrows the kinds it reads", () => {
    const readers: ReadAudience = audience({
      ownedOnlyPermissions: [Permission.ReadAllOperationalResources],
    });

    expect(ReadAudiencePermission.isNarrowedByOwners(Monitor, readers)).toBe(
      true,
    );
  });

  test("a kind other records are set up with is never narrowed by owner: the Owned scope leaves its reads alone", () => {
    const readers: ReadAudience = audience({
      ownedOnlyPermissions: [Permission.ProjectMember, Permission.ProjectAdmin],
    });

    expect(ReadAudiencePermission.isNarrowedByOwners(Probe, readers)).toBe(
      false,
    );
    expect(
      ReadAudiencePermission.isNarrowedByOwners(
        OnCallDutyPolicySchedule,
        readers,
      ),
    ).toBe(false);
  });
});

describe("the records of a kind it keeps", () => {
  test("a kind nobody is narrowed on: every record, and no condition at all", () => {
    expect(
      ReadAudiencePermission.getConditions(Monitor, audience()),
    ).toEqual([]);
    expect(
      ReadAudiencePermission.getKeptCondition(Monitor, audience()),
    ).toBeNull();
  });

  test("narrowed by owners: none an owner, person or team, sets apart", () => {
    const kept: unknown = ReadAudiencePermission.getKeptCondition(
      Monitor,
      audience({ ownedOnlyPermissions: [Permission.ReadProjectMonitor] }),
    );

    expect(sqlOf(kept, '"Monitor"."_id"')).toBe(`(${UNOWNED_MONITOR})`);
  });

  test("narrowed by labels: none a label sets apart", () => {
    const kept: unknown = ReadAudiencePermission.getKeptCondition(
      Monitor,
      audience({ labelledPermissions: [Permission.MonitorViewer] }),
    );

    expect(sqlOf(kept, '"Monitor"."_id"')).toBe(`(${UNLABELLED_MONITOR})`);
  });

  test("narrowed by both: neither owner nor label sets it apart", () => {
    const kept: unknown = ReadAudiencePermission.getKeptCondition(
      Monitor,
      audience({
        ownedOnlyPermissions: [Permission.ReadProjectMonitor],
        labelledPermissions: [Permission.ReadProjectMonitor],
      }),
    );

    expect(sqlOf(kept, '"Monitor"."_id"')).toBe(
      `(${UNOWNED_MONITOR} AND ${UNLABELLED_MONITOR})`,
    );
  });

  test("what the subject names itself is kept whoever owns it and whatever it carries", () => {
    const kept: unknown = ReadAudiencePermission.getKeptCondition(
      Monitor,
      audience({
        labelledPermissions: [Permission.ReadProjectMonitor],
        named: { Monitor: [SUBJECT_MONITOR] },
      }),
    );
    const sql: string = sqlOf(kept, '"Monitor"."_id"');

    expect(sql.startsWith(`((${UNLABELLED_MONITOR}) OR ("Monitor"."_id" IN (:...`)).toBe(
      true,
    );
    expect(Object.values(parametersOf(kept))).toContainEqual([
      SUBJECT_MONITOR,
    ]);
    expect(
      ReadAudiencePermission.isNamed(
        Monitor,
        SUBJECT_MONITOR.toUpperCase(),
        audience({ named: { Monitor: [SUBJECT_MONITOR] } }),
      ),
    ).toBe(true);
  });

  test("a private incident is never kept, even when nobody is narrowed - unless it is the subject", () => {
    const narrowsNobody: unknown = ReadAudiencePermission.getKeptCondition(
      Incident,
      audience(),
    );

    expect(sqlOf(narrowsNobody, '"Incident"."_id"')).toBe(
      '(("Incident"."isPrivate" IS NULL OR "Incident"."isPrivate" = FALSE))',
    );

    const subject: unknown = ReadAudiencePermission.getKeptCondition(
      Incident,
      audience({ named: { Incident: [SUBJECT_INCIDENT] } }),
    );

    expect(sqlOf(subject, '"Incident"."_id"')).toContain(
      '"Incident"."_id" IN (:...',
    );
    expect(Object.values(parametersOf(subject))).toContainEqual([
      SUBJECT_INCIDENT,
    ]);
  });

  test("an alert, an incident's twin, likewise", () => {
    expect(
      sqlOf(
        ReadAudiencePermission.getKeptCondition(Alert, audience()),
        '"Alert"."_id"',
      ),
    ).toBe('(("Alert"."isPrivate" IS NULL OR "Alert"."isPrivate" = FALSE))');
  });

  test("what it leaves out is the kept records turned around, in its project only", () => {
    const setApart: unknown = ReadAudiencePermission.getSetApartCondition(
      Monitor,
      audience({ ownedOnlyPermissions: [Permission.ReadProjectMonitor] }),
    );
    const sql: string = sqlOf(setApart, '"Monitor"."_id"');

    expect(sql).toContain('("Monitor"."projectId" IN (:...');
    expect(sql).toContain(`(NOT (${UNOWNED_MONITOR}))`);
    expect(Object.values(parametersOf(setApart))).toContainEqual([PROJECT]);
    expect(
      ReadAudiencePermission.getSetApartCondition(Monitor, audience()),
    ).toBeNull();
  });
});

describe("a record read through others", () => {
  test("a monitor's status timeline goes with a monitor set apart", () => {
    const conditions: Array<ReadAudienceCondition> =
      ReadAudiencePermission.getConditions(
        MonitorStatusTimeline,
        audience({ ownedOnlyPermissions: [Permission.ReadProjectMonitor] }),
      );

    expect(
      conditions.map((each: ReadAudienceCondition): string => {
        return each.column;
      }),
    ).toEqual(["monitorId"]);

    const sql: string = sqlOf(
      conditions[0]!.condition,
      '"MonitorStatusTimeline"."monitorId"',
    );

    expect(sql).toContain(
      '"MonitorStatusTimeline"."monitorId" IS NULL OR "MonitorStatusTimeline"."monitorId" NOT IN (SELECT "record',
    );
    expect(sql).toContain('FROM "Monitor" "record');
    expect(sql).toContain('(NOT ((NOT EXISTS (SELECT 1 FROM "MonitorOwnerUser"');
  });

  test("nothing narrowed: the timeline is read whole", () => {
    expect(
      ReadAudiencePermission.getConditions(MonitorStatusTimeline, audience()),
    ).toEqual([]);
  });

  test("an incident's note goes with a private incident, whatever else narrows nobody", () => {
    const conditions: Array<ReadAudienceCondition> =
      ReadAudiencePermission.getConditions(IncidentInternalNote, audience());

    const incidentKey: ReadAudienceCondition | undefined = conditions.find(
      (each: ReadAudienceCondition): boolean => {
        return each.column === "incidentId";
      },
    );

    expect(incidentKey).toBeDefined();
    expect(
      sqlOf(incidentKey!.condition, '"IncidentInternalNote"."incidentId"'),
    ).toContain('"isPrivate" IS NULL OR');
  });

  test("an exception group goes with a service set apart by a label - whichever kind of resource its key names", () => {
    const conditions: Array<ReadAudienceCondition> =
      ReadAudiencePermission.getConditions(
        TelemetryException,
        audience({ labelledPermissions: [Permission.ReadService] }),
      );

    expect(
      conditions.map((each: ReadAudienceCondition): string => {
        return each.column;
      }),
    ).toEqual(["primaryEntityId"]);

    const sql: string = sqlOf(
      conditions[0]!.condition,
      '"TelemetryException"."primaryEntityId"',
    );

    // Only services are narrowed: a key naming a host names none left out.
    expect(sql).toContain('FROM "Service" "record');
    expect(sql).not.toContain('FROM "Host" "record');
    expect(sql).toContain(
      '"TelemetryException"."primaryEntityId" NOT IN (SELECT',
    );
  });

  test("a permission of its own held only for some labels weighs it by the labels of every record it names", () => {
    const conditions: Array<ReadAudienceCondition> =
      ReadAudiencePermission.getConditions(
        TelemetryException,
        audience({ labelledPermissions: [Permission.ReadTelemetryException] }),
      );
    const sql: string = sqlOf(
      conditions[0]!.condition,
      '"TelemetryException"."primaryEntityId"',
    );

    expect(sql).toContain('FROM "Service" "record');
    expect(sql).toContain('FROM "Host" "record');
  });

  test("an owner row goes with the record it owns", () => {
    const conditions: Array<ReadAudienceCondition> =
      ReadAudiencePermission.getConditions(
        MonitorOwnerTeam,
        audience({ ownedOnlyPermissions: [Permission.ReadProjectMonitor] }),
      );

    expect(
      conditions.map((each: ReadAudienceCondition): string => {
        return each.column;
      }),
    ).toContain("monitorId");
  });
});

describe("the permission layer narrows OneUptime's read for its audience", () => {
  test("a read of monitors made with the run's props leaves out those set apart", async () => {
    const readers: ReadAudience = audience({
      ownedOnlyPermissions: [Permission.ReadProjectMonitor],
    });
    const result: { query: Record<string, unknown> } =
      (await BasePermission.checkPermissions(
        Monitor,
        { projectId: new ObjectID(PROJECT) } as never,
        null,
        ReadAudiencePermission.getReadProps(readers),
        DatabaseRequestType.Read,
      )) as unknown as { query: Record<string, unknown> };

    expect(sqlOf(result.query["_id"], '"Monitor"."_id"')).toBe(
      `(${UNOWNED_MONITOR})`,
    );
  });

  test("a read of one monitor by its id keeps the id beside the audience's condition", async () => {
    const readers: ReadAudience = audience({
      ownedOnlyPermissions: [Permission.ReadProjectMonitor],
    });
    const result: { query: Record<string, unknown> } =
      (await BasePermission.checkPermissions(
        Monitor,
        { _id: SUBJECT_MONITOR } as never,
        null,
        ReadAudiencePermission.getReadProps(readers),
        DatabaseRequestType.Read,
      )) as unknown as { query: Record<string, unknown> };

    expect((result.query["_id"] as FindOperator<unknown>).type).toBe("and");
  });

  test("OneUptime's other reads, and the run's writes, are left as they were", async () => {
    const plain: { query: Record<string, unknown> } =
      (await BasePermission.checkPermissions(
        Monitor,
        { projectId: new ObjectID(PROJECT) } as never,
        null,
        { isRoot: true },
        DatabaseRequestType.Read,
      )) as unknown as { query: Record<string, unknown> };

    expect(plain.query["_id"]).toBeUndefined();

    const update: { query: Record<string, unknown> } =
      (await BasePermission.checkPermissions(
        Monitor,
        { projectId: new ObjectID(PROJECT) } as never,
        null,
        ReadAudiencePermission.getReadProps(
          audience({ ownedOnlyPermissions: [Permission.ReadProjectMonitor] }),
        ),
        DatabaseRequestType.Update,
      )) as unknown as { query: Record<string, unknown> };

    expect(update.query["_id"]).toBeUndefined();
  });

  test("a project that narrows nobody: the read is the one it always was", async () => {
    const result: { query: Record<string, unknown> } =
      (await BasePermission.checkPermissions(
        Monitor,
        { projectId: new ObjectID(PROJECT) } as never,
        null,
        ReadAudiencePermission.getReadProps(audience()),
        DatabaseRequestType.Read,
      )) as unknown as { query: Record<string, unknown> };

    expect(result.query["_id"]).toBeUndefined();
  });
});

describe("whose telemetry it reads", () => {
  test("every resource's, less those set apart", async () => {
    const blocked: string = "44444444-4444-4444-8444-000000000001";
    const props: DatabaseCommonInteractionProps =
      ReadAudiencePermission.getReadProps(
        audience({
          labelledPermissions: [Permission.ReadTelemetryService],
          telemetryBlockedIds: [blocked.toUpperCase()],
        }),
      );

    const scope: TelemetryReadScope = await AnalyticsModelPermission.getReadScope(
      Log,
      props,
    );

    expect(scope).toEqual({ readableIds: null, blockedIds: [blocked] });
    expect(
      AnalyticsModelPermission.readsEveryResourceForPermissions({
        props,
        permissions: [Permission.ReadTelemetryServiceLog],
        recordName: "Log",
      }),
    ).toBe(false);
  });

  test("OneUptime's other reads, and an audience that sets nothing apart, read every resource", async () => {
    expect(
      await AnalyticsModelPermission.getReadScope(Log, { isRoot: true }),
    ).toEqual({ readableIds: null, blockedIds: [] });
    expect(
      await AnalyticsModelPermission.getReadScope(
        Log,
        ReadAudiencePermission.getReadProps(audience()),
      ),
    ).toEqual({ readableIds: null, blockedIds: [] });
  });

  test("a read of incidents other than the subject never meets a private one", () => {
    const conditions: Array<ReadAudienceCondition> =
      ReadAudiencePermission.getConditions(
        Incident,
        audience({ named: { Incident: [SUBJECT_INCIDENT] } }),
      );

    expect(conditions).toHaveLength(1);
    expect(Object.values(parametersOf(conditions[0]!.condition))).not.toContainEqual(
      [OTHER_INCIDENT],
    );
  });
});
