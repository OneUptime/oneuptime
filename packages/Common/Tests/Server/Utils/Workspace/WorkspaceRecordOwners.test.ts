import AlertEpisodeOwnerTeamService from "../../../../Server/Services/AlertEpisodeOwnerTeamService";
import AlertEpisodeOwnerUserService from "../../../../Server/Services/AlertEpisodeOwnerUserService";
import AlertOwnerTeamService from "../../../../Server/Services/AlertOwnerTeamService";
import AlertOwnerUserService from "../../../../Server/Services/AlertOwnerUserService";
import IncidentEpisodeOwnerTeamService from "../../../../Server/Services/IncidentEpisodeOwnerTeamService";
import IncidentEpisodeOwnerUserService from "../../../../Server/Services/IncidentEpisodeOwnerUserService";
import IncidentOwnerTeamService from "../../../../Server/Services/IncidentOwnerTeamService";
import IncidentOwnerUserService from "../../../../Server/Services/IncidentOwnerUserService";
import MonitorOwnerTeamService from "../../../../Server/Services/MonitorOwnerTeamService";
import MonitorOwnerUserService from "../../../../Server/Services/MonitorOwnerUserService";
import OnCallDutyPolicyOwnerTeamService from "../../../../Server/Services/OnCallDutyPolicyOwnerTeamService";
import OnCallDutyPolicyOwnerUserService from "../../../../Server/Services/OnCallDutyPolicyOwnerUserService";
import ScheduledMaintenanceOwnerTeamService from "../../../../Server/Services/ScheduledMaintenanceOwnerTeamService";
import ScheduledMaintenanceOwnerUserService from "../../../../Server/Services/ScheduledMaintenanceOwnerUserService";
import ServiceLevelObjectiveOwnerTeamService from "../../../../Server/Services/ServiceLevelObjectiveOwnerTeamService";
import ServiceLevelObjectiveOwnerUserService from "../../../../Server/Services/ServiceLevelObjectiveOwnerUserService";
import ObjectID from "../../../../Types/ObjectID";
import NotificationRuleEventType from "../../../../Types/Workspace/NotificationRules/EventType";
import { NotificationRuleConditionCheckOn } from "../../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import WorkspaceRecordOwners, {
  OWNER_READ_BATCH_SIZE,
  OwnedRecordKey,
} from "../../../../Server/Utils/Workspace/WorkspaceRecordOwners";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger");

/*
 * WHO OWNS A RECORD, AS AN OWNERS CONDITION READS IT (#7583).
 *
 * Each kind of record with owners keeps them in two tables - one row a
 * person, one a team - and a rule's owners condition is matched against
 * both, read when the record is posted about. Which record a notification
 * is for is decided by the kind of rules being matched, never guessed from
 * the ids it carries. A summary reads the owners of all its items at once,
 * a few hundred records a query.
 */

type FindAllBy = (args: {
  query: Record<string, unknown>;
  select: Record<string, unknown>;
}) => Promise<Array<Record<string, unknown>>>;

interface OwnedKind {
  eventType: NotificationRuleEventType;
  recordKey: OwnedRecordKey;
  checkOn: NotificationRuleConditionCheckOn;
  userService: unknown;
  teamService: unknown;
}

const KINDS: Array<OwnedKind> = [
  {
    eventType: NotificationRuleEventType.Incident,
    recordKey: "incidentId",
    checkOn: NotificationRuleConditionCheckOn.IncidentOwners,
    userService: IncidentOwnerUserService,
    teamService: IncidentOwnerTeamService,
  },
  {
    eventType: NotificationRuleEventType.Alert,
    recordKey: "alertId",
    checkOn: NotificationRuleConditionCheckOn.AlertOwners,
    userService: AlertOwnerUserService,
    teamService: AlertOwnerTeamService,
  },
  {
    eventType: NotificationRuleEventType.IncidentEpisode,
    recordKey: "incidentEpisodeId",
    checkOn: NotificationRuleConditionCheckOn.IncidentEpisodeOwners,
    userService: IncidentEpisodeOwnerUserService,
    teamService: IncidentEpisodeOwnerTeamService,
  },
  {
    eventType: NotificationRuleEventType.AlertEpisode,
    recordKey: "alertEpisodeId",
    checkOn: NotificationRuleConditionCheckOn.AlertEpisodeOwners,
    userService: AlertEpisodeOwnerUserService,
    teamService: AlertEpisodeOwnerTeamService,
  },
  {
    eventType: NotificationRuleEventType.ScheduledMaintenance,
    recordKey: "scheduledMaintenanceId",
    checkOn: NotificationRuleConditionCheckOn.ScheduledMaintenanceOwners,
    userService: ScheduledMaintenanceOwnerUserService,
    teamService: ScheduledMaintenanceOwnerTeamService,
  },
  {
    eventType: NotificationRuleEventType.Monitor,
    recordKey: "monitorId",
    checkOn: NotificationRuleConditionCheckOn.MonitorOwners,
    userService: MonitorOwnerUserService,
    teamService: MonitorOwnerTeamService,
  },
  {
    eventType: NotificationRuleEventType.OnCallDutyPolicy,
    recordKey: "onCallDutyPolicyId",
    checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicyOwners,
    userService: OnCallDutyPolicyOwnerUserService,
    teamService: OnCallDutyPolicyOwnerTeamService,
  },
  {
    eventType: NotificationRuleEventType.ServiceLevelObjective,
    recordKey: "serviceLevelObjectiveId",
    checkOn: NotificationRuleConditionCheckOn.SloOwners,
    userService: ServiceLevelObjectiveOwnerUserService,
    teamService: ServiceLevelObjectiveOwnerTeamService,
  },
];

// The ids a query asks for: the values bound into its QueryHelper.any(...).
function askedIds(
  query: Record<string, unknown>,
  column: string,
): Array<string> {
  const asked: { objectLiteralParameters?: Record<string, unknown> } = query[
    column
  ] as { objectLiteralParameters?: Record<string, unknown> };

  const values: unknown = Object.values(
    asked?.objectLiteralParameters || {},
  )[0];

  expect(Array.isArray(values)).toBe(true);

  return (values as Array<unknown>).map((value: unknown): string => {
    return String(value);
  });
}

/*
 * Stubs a kind's two owner tables with rows - [record, owner] pairs - and
 * answers each query with the rows of the records it asks for, recording
 * the records asked for each time.
 */
function givenOwnerRows(data: {
  kind: OwnedKind;
  users: Array<[ObjectID, ObjectID]>;
  teams: Array<[ObjectID, ObjectID]>;
}): { userQueries: Array<Array<string>>; teamQueries: Array<Array<string>> } {
  const queries: {
    userQueries: Array<Array<string>>;
    teamQueries: Array<Array<string>>;
  } = { userQueries: [], teamQueries: [] };

  for (const table of [
    {
      service: data.kind.userService,
      column: "userId",
      rows: data.users,
      asked: queries.userQueries,
    },
    {
      service: data.kind.teamService,
      column: "teamId",
      rows: data.teams,
      asked: queries.teamQueries,
    },
  ]) {
    const findAllBy: FindAllBy = async (args: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
    }): Promise<Array<Record<string, unknown>>> => {
      // Only the record and its owner are read, as root.
      expect(args.select).toEqual({
        [data.kind.recordKey]: true,
        [table.column]: true,
      });

      const ids: Array<string> = askedIds(args.query, data.kind.recordKey);
      table.asked.push(ids);

      return table.rows
        .filter((row: [ObjectID, ObjectID]): boolean => {
          return ids.includes(row[0].toString().toLowerCase());
        })
        .map((row: [ObjectID, ObjectID]): Record<string, unknown> => {
          return {
            [data.kind.recordKey]: row[0],
            [table.column]: row[1],
          };
        });
    };

    jest
      .spyOn(table.service as { findAllBy: FindAllBy }, "findAllBy")
      .mockImplementation(findAllBy as never);
  }

  return queries;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("The record a notification is for", () => {
  test.each(
    KINDS.map((kind: OwnedKind): [string, OwnedKind] => {
      return [kind.eventType, kind];
    }),
  )(
    "a %s rule reads the owners of the record it names",
    (_name: string, kind: OwnedKind) => {
      const recordId: ObjectID = ObjectID.generate();

      expect(
        WorkspaceRecordOwners.getOwnedRecord({
          eventType: kind.eventType,
          notificationFor: { [kind.recordKey]: recordId },
        }),
      ).toEqual({
        recordKey: kind.recordKey,
        recordId: recordId,
        checkOn: kind.checkOn,
      });
    },
  );

  test("the kind of rule decides, not the first id the notification carries", () => {
    const incidentId: ObjectID = ObjectID.generate();
    const monitorId: ObjectID = ObjectID.generate();

    // A monitor's notification that also names an incident is the monitor's.
    expect(
      WorkspaceRecordOwners.getOwnedRecord({
        eventType: NotificationRuleEventType.Monitor,
        notificationFor: { incidentId: incidentId, monitorId: monitorId },
      }),
    ).toEqual({
      recordKey: "monitorId",
      recordId: monitorId,
      checkOn: NotificationRuleConditionCheckOn.MonitorOwners,
    });

    expect(
      WorkspaceRecordOwners.getOwnedRecord({
        eventType: NotificationRuleEventType.Incident,
        notificationFor: { incidentId: incidentId, monitorId: monitorId },
      })?.recordId,
    ).toBe(incidentId);
  });

  test("a security case and a hunt have no owners", () => {
    for (const eventType of [
      NotificationRuleEventType.SecurityCase,
      NotificationRuleEventType.SecurityHunt,
    ]) {
      expect(
        WorkspaceRecordOwners.getOwnedRecord({
          eventType: eventType,
          notificationFor: { incidentId: ObjectID.generate() },
        }),
      ).toBeNull();
    }
  });

  test("a notification without the record's id has no owners to read", () => {
    expect(
      WorkspaceRecordOwners.getOwnedRecord({
        eventType: NotificationRuleEventType.Incident,
        notificationFor: { alertId: ObjectID.generate() },
      }),
    ).toBeNull();
  });
});

describe("Reading a record's owners", () => {
  test.each(
    KINDS.map((kind: OwnedKind): [string, OwnedKind] => {
      return [kind.recordKey, kind];
    }),
  )(
    "reads %s's owners from its own two tables: people, then teams",
    async (_name: string, kind: OwnedKind) => {
      const recordId: ObjectID = ObjectID.generate();
      const jane: ObjectID = ObjectID.generate();
      const platform: ObjectID = ObjectID.generate();

      givenOwnerRows({
        kind: kind,
        users: [[recordId, jane]],
        teams: [[recordId, platform]],
      });

      expect(
        await WorkspaceRecordOwners.getOwnerIds({
          recordKey: kind.recordKey,
          recordId: recordId,
        }),
      ).toEqual([jane.toString(), platform.toString()]);
    },
  );

  test("a record with no owners has none", async () => {
    const kind: OwnedKind = KINDS[0]!;

    givenOwnerRows({ kind: kind, users: [], teams: [] });

    expect(
      await WorkspaceRecordOwners.getOwnerIds({
        recordKey: kind.recordKey,
        recordId: ObjectID.generate(),
      }),
    ).toEqual([]);
  });

  test("names each owner once, however many rows name them", async () => {
    const kind: OwnedKind = KINDS[0]!;
    const recordId: ObjectID = ObjectID.generate();
    const jane: ObjectID = ObjectID.generate();

    givenOwnerRows({
      kind: kind,
      users: [
        [recordId, jane],
        [recordId, jane],
      ],
      teams: [],
    });

    expect(
      await WorkspaceRecordOwners.getOwnerIds({
        recordKey: kind.recordKey,
        recordId: recordId,
      }),
    ).toEqual([jane.toString()]);
  });
});

describe("Reading the owners of a summary's records", () => {
  test("reads every record's owners at once, by record id in lower case", async () => {
    const kind: OwnedKind = KINDS[1]!;
    const first: ObjectID = ObjectID.generate();
    const second: ObjectID = ObjectID.generate();
    const unowned: ObjectID = ObjectID.generate();
    const jane: ObjectID = ObjectID.generate();
    const sam: ObjectID = ObjectID.generate();
    const platform: ObjectID = ObjectID.generate();

    const queries: {
      userQueries: Array<Array<string>>;
      teamQueries: Array<Array<string>>;
    } = givenOwnerRows({
      kind: kind,
      users: [
        [first, jane],
        [second, sam],
      ],
      teams: [[first, platform]],
    });

    const owners: Map<
      string,
      Array<string>
    > = await WorkspaceRecordOwners.getOwnerIdsByRecord({
      recordKey: kind.recordKey,
      recordIds: [first, second, unowned, first],
    });

    expect(owners.get(first.toString().toLowerCase())).toEqual([
      jane.toString(),
      platform.toString(),
    ]);
    expect(owners.get(second.toString().toLowerCase())).toEqual([
      sam.toString(),
    ]);
    expect(owners.get(unowned.toString().toLowerCase())).toEqual([]);

    // One query a table, each record asked for once.
    expect(queries.userQueries).toHaveLength(1);
    expect(queries.teamQueries).toHaveLength(1);
    expect(queries.userQueries[0]).toHaveLength(3);
  });

  test(`reads ${OWNER_READ_BATCH_SIZE} records a query`, async () => {
    const kind: OwnedKind = KINDS[0]!;
    const recordIds: Array<ObjectID> = [];

    for (
      let index: number = 0;
      index < OWNER_READ_BATCH_SIZE * 2 + 1;
      index++
    ) {
      recordIds.push(ObjectID.generate());
    }

    const last: ObjectID = recordIds[recordIds.length - 1]!;
    const jane: ObjectID = ObjectID.generate();

    const queries: {
      userQueries: Array<Array<string>>;
      teamQueries: Array<Array<string>>;
    } = givenOwnerRows({
      kind: kind,
      users: [[last, jane]],
      teams: [],
    });

    const owners: Map<
      string,
      Array<string>
    > = await WorkspaceRecordOwners.getOwnerIdsByRecord({
      recordKey: kind.recordKey,
      recordIds: recordIds,
    });

    expect(
      queries.userQueries.map((ids: Array<string>): number => {
        return ids.length;
      }),
    ).toEqual([OWNER_READ_BATCH_SIZE, OWNER_READ_BATCH_SIZE, 1]);
    expect(queries.teamQueries).toHaveLength(3);
    expect(owners.size).toBe(recordIds.length);
    expect(owners.get(last.toString().toLowerCase())).toEqual([
      jane.toString(),
    ]);
  });

  test("asks nothing for no records", async () => {
    const kind: OwnedKind = KINDS[0]!;
    const queries: {
      userQueries: Array<Array<string>>;
      teamQueries: Array<Array<string>>;
    } = givenOwnerRows({ kind: kind, users: [], teams: [] });

    expect(
      (
        await WorkspaceRecordOwners.getOwnerIdsByRecord({
          recordKey: kind.recordKey,
          recordIds: [],
        })
      ).size,
    ).toBe(0);
    expect(queries.userQueries).toEqual([]);
    expect(queries.teamQueries).toEqual([]);
  });
});
