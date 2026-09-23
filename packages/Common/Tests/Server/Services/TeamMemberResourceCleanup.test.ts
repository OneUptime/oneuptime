import TeamMemberService from "../../../Server/Services/TeamMemberService";
import AlertEpisodeOwnerUserService from "../../../Server/Services/AlertEpisodeOwnerUserService";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertOwnerUserService from "../../../Server/Services/AlertOwnerUserService";
import AlertService from "../../../Server/Services/AlertService";
import AlertStateService from "../../../Server/Services/AlertStateService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentEpisodeOwnerUserService from "../../../Server/Services/IncidentEpisodeOwnerUserService";
import IncidentEpisodeRoleMemberService from "../../../Server/Services/IncidentEpisodeRoleMemberService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentMemberService from "../../../Server/Services/IncidentMemberService";
import IncidentOwnerUserService from "../../../Server/Services/IncidentOwnerUserService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import MonitorOwnerUserService from "../../../Server/Services/MonitorOwnerUserService";
import OnCallDutyPolicyOwnerUserService from "../../../Server/Services/OnCallDutyPolicyOwnerUserService";
import ScheduledMaintenanceOwnerUserService from "../../../Server/Services/ScheduledMaintenanceOwnerUserService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "../../../Server/Services/ScheduledMaintenanceStateService";
import StatusPageOwnerUserService from "../../../Server/Services/StatusPageOwnerUserService";
import UserNotificationSettingService from "../../../Server/Services/UserNotificationSettingService";
import ProjectLeaveResourceCleanup, {
  LifecycleResource,
  OwnerUserTable,
  ProjectLeaveResourceCleanupResult,
} from "../../../Server/Utils/TeamMember/ProjectLeaveResourceCleanup";
import logger from "../../../Server/Utils/Logger";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import fs from "fs";
import path from "path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Removing a user from a project used to leave them attached to its work:
 * still commander of open incidents, still owner of monitors, status pages,
 * incidents and on-call policies. The owner notifications then went to
 * someone whose notification settings were already gone and still claimed in
 * the feed that they had been notified.
 *
 * When the user's LAST accepted membership goes (the same rule as the
 * on-call cleanup), their roles on OPEN incidents and episodes and their
 * owner rows go too. Closed incidents, alerts, episodes and maintenance keep
 * theirs as history. Everything is spied; no Postgres or Redis involved.
 */

const PROJECT_ID: ObjectID = new ObjectID("project-1");
const USER_ID: ObjectID = new ObjectID("user-1");

const OPEN_INCIDENT_STATE: ObjectID = new ObjectID("state-identified");
const ACK_INCIDENT_STATE: ObjectID = new ObjectID("state-acknowledged");
const OPEN_ALERT_STATE: ObjectID = new ObjectID("alert-state-created");

const OPEN_INCIDENT: ObjectID = new ObjectID("incident-open");
const RESOLVED_INCIDENT: ObjectID = new ObjectID("incident-resolved");
const OPEN_EPISODE: ObjectID = new ObjectID("episode-open");
const RESOLVED_EPISODE: ObjectID = new ObjectID("episode-resolved");
const OPEN_ALERT: ObjectID = new ObjectID("alert-open");
const RESOLVED_ALERT: ObjectID = new ObjectID("alert-resolved");
const ONGOING_MAINTENANCE: ObjectID = new ObjectID("maintenance-ongoing");
const ENDED_MAINTENANCE: ObjectID = new ObjectID("maintenance-ended");

// The values bound into a QueryHelper.any(...) operator.
function anyValues(operator: any): Array<string> {
  return Object.values(
    operator.objectLiteralParameters as Record<string, Array<string>>,
  )[0]!;
}

function asService(service: unknown): DatabaseService<DatabaseBaseModel> {
  return service as DatabaseService<DatabaseBaseModel>;
}

// A row as the service would read it back: a model with the one column set.
function rowOn(
  service: unknown,
  column: string,
  value: ObjectID,
): DatabaseBaseModel {
  const row: DatabaseBaseModel = new (asService(service).modelType)();
  (row as any)[column] = value;
  return row;
}

function state(id: ObjectID, extra?: Record<string, unknown>): any {
  return { id: id, _id: id.toString(), ...(extra || {}) };
}

interface Spies {
  memberCount: any;
  incidentStates: any;
  alertStates: any;
  maintenanceStates: any;
  incidentFindBy: any;
  episodeFindBy: any;
  alertFindBy: any;
  alertEpisodeFindBy: any;
  maintenanceFindBy: any;
  roleFindBy: any;
  roleDeleteBy: any;
  episodeRoleFindBy: any;
  episodeRoleDeleteBy: any;
  // Keyed by the owner table name, e.g. "MonitorOwnerUser".
  ownerFindBy: Record<string, any>;
  ownerCountBy: Record<string, any>;
  ownerDeleteBy: Record<string, any>;
}

function tableName(service: unknown): string {
  return asService(service).getModel().tableName!;
}

/*
 * The world: the user holds a role on one open and one resolved incident, a
 * role on one open and one resolved episode, owns one open and one resolved
 * incident / episode / alert, one ongoing and one ended maintenance, a
 * monitor and a status page. Every other owner table is empty.
 */
function stubWorld(options?: { remainingMemberships?: number }): Spies {
  const ownerFindBy: Record<string, any> = {};
  const ownerCountBy: Record<string, any> = {};
  const ownerDeleteBy: Record<string, any> = {};

  for (const table of ProjectLeaveResourceCleanup.getOwnerUserTables()) {
    const name: string = tableName(table.service);
    ownerFindBy[name] = jest
      .spyOn(table.service, "findBy")
      .mockResolvedValue([] as never);
    ownerCountBy[name] = jest
      .spyOn(table.service, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);
    ownerDeleteBy[name] = jest
      .spyOn(table.service, "deleteBy")
      .mockResolvedValue(0 as never);
  }

  const lifecycleRows: Array<[unknown, string, Array<ObjectID>]> = [
    [
      IncidentOwnerUserService,
      "incidentId",
      [OPEN_INCIDENT, RESOLVED_INCIDENT],
    ],
    [
      IncidentEpisodeOwnerUserService,
      "incidentEpisodeId",
      [OPEN_EPISODE, RESOLVED_EPISODE],
    ],
    [AlertOwnerUserService, "alertId", [OPEN_ALERT, RESOLVED_ALERT]],
    [AlertEpisodeOwnerUserService, "alertEpisodeId", [RESOLVED_ALERT]],
    [
      ScheduledMaintenanceOwnerUserService,
      "scheduledMaintenanceId",
      [ONGOING_MAINTENANCE, ENDED_MAINTENANCE],
    ],
  ];

  for (const [service, column, resourceIds] of lifecycleRows) {
    ownerFindBy[tableName(service)].mockResolvedValue(
      resourceIds.map((id: ObjectID) => {
        return rowOn(service, column, id);
      }),
    );
    ownerDeleteBy[tableName(service)].mockResolvedValue(1);
  }

  for (const service of [MonitorOwnerUserService, StatusPageOwnerUserService]) {
    ownerCountBy[tableName(service)].mockResolvedValue(new PositiveNumber(2));
    ownerDeleteBy[tableName(service)].mockResolvedValue(2);
  }

  return {
    memberCount: jest
      .spyOn(TeamMemberService, "countBy")
      .mockResolvedValue(
        new PositiveNumber(options?.remainingMemberships ?? 0) as never,
      ),
    incidentStates: jest
      .spyOn(IncidentStateService, "getUnresolvedIncidentStates")
      .mockResolvedValue([
        state(OPEN_INCIDENT_STATE),
        state(ACK_INCIDENT_STATE),
      ]),
    alertStates: jest
      .spyOn(AlertStateService, "getUnresolvedAlertStates")
      .mockResolvedValue([state(OPEN_ALERT_STATE)]),
    maintenanceStates: jest
      .spyOn(ScheduledMaintenanceStateService, "findBy")
      .mockResolvedValue([
        state(new ObjectID("sm-scheduled"), { isScheduledState: true }),
        state(new ObjectID("sm-ongoing"), { isOngoingState: true }),
        state(new ObjectID("sm-ended"), { isEndedState: true }),
        state(new ObjectID("sm-completed"), { isResolvedState: true }),
        // Ordered after the end: still not open.
        state(new ObjectID("sm-archived")),
      ] as never),
    incidentFindBy: jest
      .spyOn(IncidentService, "findBy")
      .mockResolvedValue([state(OPEN_INCIDENT)] as never),
    episodeFindBy: jest
      .spyOn(IncidentEpisodeService, "findBy")
      .mockResolvedValue([state(OPEN_EPISODE)] as never),
    alertFindBy: jest
      .spyOn(AlertService, "findBy")
      .mockResolvedValue([state(OPEN_ALERT)] as never),
    alertEpisodeFindBy: jest
      .spyOn(AlertEpisodeService, "findBy")
      .mockResolvedValue([] as never),
    maintenanceFindBy: jest
      .spyOn(ScheduledMaintenanceService, "findBy")
      .mockResolvedValue([state(ONGOING_MAINTENANCE)] as never),
    roleFindBy: jest.spyOn(IncidentMemberService, "findBy").mockResolvedValue([
      rowOn(IncidentMemberService, "incidentId", OPEN_INCIDENT),
      rowOn(IncidentMemberService, "incidentId", RESOLVED_INCIDENT),
      // Two roles on the same incident: asked about once.
      rowOn(IncidentMemberService, "incidentId", OPEN_INCIDENT),
    ] as never),
    roleDeleteBy: jest
      .spyOn(IncidentMemberService, "deleteBy")
      .mockResolvedValue(2 as never),
    episodeRoleFindBy: jest
      .spyOn(IncidentEpisodeRoleMemberService, "findBy")
      .mockResolvedValue([
        rowOn(
          IncidentEpisodeRoleMemberService,
          "incidentEpisodeId",
          OPEN_EPISODE,
        ),
        rowOn(
          IncidentEpisodeRoleMemberService,
          "incidentEpisodeId",
          RESOLVED_EPISODE,
        ),
      ] as never),
    episodeRoleDeleteBy: jest
      .spyOn(IncidentEpisodeRoleMemberService, "deleteBy")
      .mockResolvedValue(1 as never),
    ownerFindBy,
    ownerCountBy,
    ownerDeleteBy,
  };
}

function cleanup(): Promise<ProjectLeaveResourceCleanupResult> {
  return ProjectLeaveResourceCleanup.cleanupForUserLeavingProject({
    projectId: PROJECT_ID,
    userId: USER_ID,
  });
}

describe("TeamMemberService resource cleanup when a user leaves the project", () => {
  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "debug").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("the guard", () => {
    test("still a member of another team: nothing is looked at or removed", async () => {
      const spies: Spies = stubWorld({ remainingMemberships: 1 });

      const result: ProjectLeaveResourceCleanupResult | null =
        await TeamMemberService.cleanupResourceAssignmentsIfUserLeftProject({
          projectId: PROJECT_ID,
          userId: USER_ID,
        });

      expect(result).toBeNull();
      expect(spies.memberCount).toHaveBeenCalledWith({
        query: {
          projectId: PROJECT_ID,
          userId: USER_ID,
          hasAcceptedInvitation: true,
        },
        props: { isRoot: true },
      });
      expect(spies.roleFindBy).not.toHaveBeenCalled();
      expect(spies.roleDeleteBy).not.toHaveBeenCalled();
      expect(spies.episodeRoleDeleteBy).not.toHaveBeenCalled();
      for (const deleteBy of Object.values(spies.ownerDeleteBy)) {
        expect(deleteBy).not.toHaveBeenCalled();
      }
    });

    test("no accepted membership left: the cleanup runs for that user and project", async () => {
      stubWorld();
      const run: any = jest.spyOn(
        ProjectLeaveResourceCleanup,
        "cleanupForUserLeavingProject",
      );

      const result: ProjectLeaveResourceCleanupResult | null =
        await TeamMemberService.cleanupResourceAssignmentsIfUserLeftProject({
          projectId: PROJECT_ID,
          userId: USER_ID,
        });

      expect(run).toHaveBeenCalledTimes(1);
      expect(run).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        userId: USER_ID,
      });
      expect(result).not.toBeNull();
    });

    test("a failing membership count makes the guard a no-op rather than an exception", async () => {
      const spies: Spies = stubWorld();
      spies.memberCount.mockRejectedValue(new Error("db down"));

      await expect(
        TeamMemberService.cleanupResourceAssignmentsIfUserLeftProject({
          projectId: PROJECT_ID,
          userId: USER_ID,
        }),
      ).resolves.toBeNull();

      expect(spies.roleDeleteBy).not.toHaveBeenCalled();
    });
  });

  describe("incident and episode roles", () => {
    test("roles on open incidents go through the service; roles on resolved ones stay", async () => {
      const spies: Spies = stubWorld();

      const result: ProjectLeaveResourceCleanupResult = await cleanup();

      expect(result.removedIncidentRoleCount).toBe(2);

      // The user's roles are read in this project only.
      expect(spies.roleFindBy.mock.calls[0]![0]).toMatchObject({
        query: { projectId: PROJECT_ID, userId: USER_ID },
        props: { isRoot: true },
      });

      // Which of their incidents are open: asked once per incident, by state.
      const incidentQuery: any = spies.incidentFindBy.mock.calls[0]![0].query;
      expect(incidentQuery.projectId).toBe(PROJECT_ID);
      expect(anyValues(incidentQuery._id)).toEqual([
        "incident-open",
        "incident-resolved",
      ]);
      expect(anyValues(incidentQuery.currentIncidentStateId)).toEqual([
        "state-identified",
        "state-acknowledged",
      ]);
      expect(spies.incidentStates).toHaveBeenCalledWith(PROJECT_ID, {
        isRoot: true,
      });

      // Deleted through IncidentMemberService, so each writes its feed item.
      expect(spies.roleDeleteBy).toHaveBeenCalledTimes(1);
      const deleteBy: any = spies.roleDeleteBy.mock.calls[0]![0];
      expect(deleteBy.query.projectId).toBe(PROJECT_ID);
      expect(deleteBy.query.userId).toBe(USER_ID);
      expect(anyValues(deleteBy.query.incidentId)).toEqual(["incident-open"]);
      expect(deleteBy.props).toEqual({ isRoot: true });
    });

    test("roles on open episodes go before the incident roles", async () => {
      const spies: Spies = stubWorld();

      const result: ProjectLeaveResourceCleanupResult = await cleanup();

      expect(result.removedIncidentEpisodeRoleCount).toBe(1);

      const episodeQuery: any = spies.episodeFindBy.mock.calls[0]![0].query;
      expect(anyValues(episodeQuery._id)).toEqual([
        "episode-open",
        "episode-resolved",
      ]);
      expect(anyValues(episodeQuery.currentIncidentStateId)).toEqual([
        "state-identified",
        "state-acknowledged",
      ]);

      const deleteBy: any = spies.episodeRoleDeleteBy.mock.calls[0]![0];
      expect(deleteBy.query.userId).toBe(USER_ID);
      expect(anyValues(deleteBy.query.incidentEpisodeId)).toEqual([
        "episode-open",
      ]);

      /*
       * Removing an episode role takes it off the episode's incidents; the
       * incident roles are read afterwards so those are not deleted twice.
       */
      expect(
        spies.episodeRoleDeleteBy.mock.invocationCallOrder[0]!,
      ).toBeLessThan(spies.roleFindBy.mock.invocationCallOrder[0]!);
    });

    test("no roles at all: nothing is looked up or deleted", async () => {
      const spies: Spies = stubWorld();
      spies.roleFindBy.mockResolvedValue([]);
      spies.episodeRoleFindBy.mockResolvedValue([]);
      spies.ownerFindBy[tableName(IncidentOwnerUserService)].mockResolvedValue(
        [],
      );
      spies.ownerFindBy[
        tableName(IncidentEpisodeOwnerUserService)
      ].mockResolvedValue([]);

      await cleanup();

      expect(spies.incidentFindBy).not.toHaveBeenCalled();
      expect(spies.episodeFindBy).not.toHaveBeenCalled();
      expect(spies.roleDeleteBy).not.toHaveBeenCalled();
      expect(spies.episodeRoleDeleteBy).not.toHaveBeenCalled();
    });

    test("every role is on a resolved incident: nothing is deleted", async () => {
      const spies: Spies = stubWorld();
      spies.incidentFindBy.mockResolvedValue([]);

      const result: ProjectLeaveResourceCleanupResult = await cleanup();

      expect(spies.roleDeleteBy).not.toHaveBeenCalled();
      expect(result.removedIncidentRoleCount).toBe(0);
    });
  });

  describe("owner rows", () => {
    test("on incidents, episodes, alerts and maintenance only the open ones lose the owner", async () => {
      const spies: Spies = stubWorld();

      await cleanup();

      const deletedIds: (service: unknown, column: string) => Array<string> = (
        service: unknown,
        column: string,
      ): Array<string> => {
        const deleteBy: any = spies.ownerDeleteBy[tableName(service)];
        expect(deleteBy).toHaveBeenCalledTimes(1);
        const call: any = deleteBy.mock.calls[0]![0];
        expect(call.query.projectId).toBe(PROJECT_ID);
        expect(call.query.userId).toBe(USER_ID);
        expect(call.props).toEqual({ isRoot: true });
        return anyValues(call.query[column]);
      };

      expect(deletedIds(IncidentOwnerUserService, "incidentId")).toEqual([
        "incident-open",
      ]);
      expect(
        deletedIds(IncidentEpisodeOwnerUserService, "incidentEpisodeId"),
      ).toEqual(["episode-open"]);
      expect(deletedIds(AlertOwnerUserService, "alertId")).toEqual([
        "alert-open",
      ]);
      expect(
        deletedIds(
          ScheduledMaintenanceOwnerUserService,
          "scheduledMaintenanceId",
        ),
      ).toEqual(["maintenance-ongoing"]);

      // The only alert episode they own is resolved: nothing to delete.
      expect(
        spies.ownerDeleteBy[tableName(AlertEpisodeOwnerUserService)],
      ).not.toHaveBeenCalled();

      // Alerts and alert episodes are open by alert state.
      expect(
        anyValues(
          spies.alertFindBy.mock.calls[0]![0].query.currentAlertStateId,
        ),
      ).toEqual(["alert-state-created"]);
      expect(
        anyValues(
          spies.alertEpisodeFindBy.mock.calls[0]![0].query.currentAlertStateId,
        ),
      ).toEqual(["alert-state-created"]);
    });

    test("maintenance is open until its first ended or completed state", async () => {
      const spies: Spies = stubWorld();

      await cleanup();

      const statesRead: any = spies.maintenanceStates.mock.calls[0]![0];
      expect(statesRead.query).toEqual({ projectId: PROJECT_ID });
      expect(statesRead.sort).toEqual({ order: "ASC" });

      const maintenanceQuery: any =
        spies.maintenanceFindBy.mock.calls[0]![0].query;
      expect(
        anyValues(maintenanceQuery.currentScheduledMaintenanceStateId),
      ).toEqual(["sm-scheduled", "sm-ongoing"]);
      expect(anyValues(maintenanceQuery._id)).toEqual([
        "maintenance-ongoing",
        "maintenance-ended",
      ]);
    });

    test("on monitors, status pages and every other standing resource, all of the user's rows go", async () => {
      const spies: Spies = stubWorld();

      const result: ProjectLeaveResourceCleanupResult = await cleanup();

      for (const service of [
        MonitorOwnerUserService,
        StatusPageOwnerUserService,
      ]) {
        const deleteBy: any = spies.ownerDeleteBy[tableName(service)];
        expect(deleteBy).toHaveBeenCalledTimes(1);
        expect(deleteBy.mock.calls[0]![0]).toEqual({
          query: { projectId: PROJECT_ID, userId: USER_ID },
          limit: expect.any(Number),
          skip: 0,
          props: { isRoot: true },
        });
      }

      // Tables where the user owns nothing are counted, not deleted from.
      const policyTable: string = tableName(OnCallDutyPolicyOwnerUserService);
      expect(spies.ownerCountBy[policyTable]).toHaveBeenCalledWith({
        query: { projectId: PROJECT_ID, userId: USER_ID },
        props: { isRoot: true },
      });
      expect(spies.ownerDeleteBy[policyTable]).not.toHaveBeenCalled();

      expect(result.removedOwnerUserCounts).toEqual({
        IncidentOwnerUser: 1,
        IncidentEpisodeOwnerUser: 1,
        AlertOwnerUser: 1,
        ScheduledMaintenanceOwnerUser: 1,
        MonitorOwnerUser: 2,
        StatusPageOwnerUser: 2,
      });
    });
  });

  describe("failure isolation", () => {
    test("a failing role lookup does not stop the owner cleanup", async () => {
      const spies: Spies = stubWorld();
      spies.episodeRoleFindBy.mockRejectedValue(new Error("db down"));
      spies.roleFindBy.mockRejectedValue(new Error("db down"));

      const result: ProjectLeaveResourceCleanupResult = await cleanup();

      expect(result.removedIncidentEpisodeRoleCount).toBe(0);
      expect(result.removedIncidentRoleCount).toBe(0);
      expect(result.removedOwnerUserCounts["MonitorOwnerUser"]).toBe(2);
      expect(logger.error).toHaveBeenCalled();
    });

    test("one owner table failing does not stop the others", async () => {
      const spies: Spies = stubWorld();
      spies.ownerDeleteBy[
        tableName(IncidentOwnerUserService)
      ].mockRejectedValue(new Error("db down"));
      spies.ownerCountBy[tableName(MonitorOwnerUserService)].mockRejectedValue(
        new Error("db down"),
      );

      const result: ProjectLeaveResourceCleanupResult = await cleanup();

      expect(
        result.removedOwnerUserCounts["IncidentOwnerUser"],
      ).toBeUndefined();
      expect(result.removedOwnerUserCounts["MonitorOwnerUser"]).toBeUndefined();
      expect(result.removedOwnerUserCounts["StatusPageOwnerUser"]).toBe(2);
      expect(result.removedOwnerUserCounts["AlertOwnerUser"]).toBe(1);
      expect(result.removedIncidentRoleCount).toBe(2);
    });

    test("no open state configured: nothing counts as open, nothing is deleted", async () => {
      const spies: Spies = stubWorld();
      spies.incidentStates.mockResolvedValue([]);

      const result: ProjectLeaveResourceCleanupResult = await cleanup();

      expect(spies.incidentFindBy).not.toHaveBeenCalled();
      expect(spies.roleDeleteBy).not.toHaveBeenCalled();
      expect(
        result.removedOwnerUserCounts["IncidentOwnerUser"],
      ).toBeUndefined();
    });
  });

  describe("the owner table registry", () => {
    /*
     * A new <Resource>OwnerUser table that is not registered would quietly
     * keep departed users as owners again.
     */
    test("covers every <Resource>OwnerUser model, by the model's own resource column", () => {
      const modelsDir: string = path.join(
        __dirname,
        "../../../Models/DatabaseModels",
      );
      const ownerUserModels: Array<string> = fs
        .readdirSync(modelsDir)
        .filter((file: string): boolean => {
          return file.endsWith("OwnerUser.ts");
        })
        .map((file: string): string => {
          return file.replace(/\.ts$/, "");
        })
        .sort();

      const tables: Array<OwnerUserTable> =
        ProjectLeaveResourceCleanup.getOwnerUserTables();

      expect(
        tables
          .map((table: OwnerUserTable): string => {
            return tableName(table.service);
          })
          .sort(),
      ).toEqual(ownerUserModels);

      for (const table of tables) {
        const model: DatabaseBaseModel = table.service.getModel();
        expect(model.hasColumn(table.resourceIdColumn)).toBe(true);
        expect(model.hasColumn("userId")).toBe(true);
        expect(model.hasColumn("projectId")).toBe(true);
      }
    });

    test("only resources that open and close are scoped to the open ones", () => {
      const scoped: Record<string, string | undefined> = {};

      for (const table of ProjectLeaveResourceCleanup.getOwnerUserTables()) {
        if (table.lifecycle) {
          scoped[tableName(table.service)] = table.lifecycle;
        }
      }

      expect(scoped).toEqual({
        IncidentOwnerUser: LifecycleResource.Incident,
        IncidentEpisodeOwnerUser: LifecycleResource.IncidentEpisode,
        AlertOwnerUser: LifecycleResource.Alert,
        AlertEpisodeOwnerUser: LifecycleResource.AlertEpisode,
        ScheduledMaintenanceOwnerUser: LifecycleResource.ScheduledMaintenance,
      });
    });
  });

  describe("onDeleteSuccess wiring", () => {
    test("runs once per (user, project), after the on-call cleanup and before the notification settings go", async () => {
      jest
        .spyOn(TeamMemberService, "refreshTokens")
        .mockResolvedValue(undefined);
      jest
        .spyOn(
          TeamMemberService,
          "updateSubscriptionSeatsByUniqueTeamMembersInProject",
        )
        .mockResolvedValue(undefined);
      const removeSettings: any = jest
        .spyOn(
          UserNotificationSettingService,
          "removeDefaultNotificationSettingsForUser",
        )
        .mockResolvedValue(undefined);
      const onCallCleanup: any = jest
        .spyOn(TeamMemberService, "cleanupOnCallAssignmentsIfUserLeftProject")
        .mockResolvedValue(null);
      const resourceCleanup: any = jest
        .spyOn(TeamMemberService, "cleanupResourceAssignmentsIfUserLeftProject")
        .mockResolvedValue(null);

      await (TeamMemberService as any).onDeleteSuccess({
        deleteBy: { query: {}, props: { isRoot: true } },
        carryForward: [
          {
            userId: USER_ID,
            projectId: PROJECT_ID,
            teamId: new ObjectID("t1"),
            hasAcceptedInvitation: true,
          },
          {
            userId: USER_ID,
            projectId: PROJECT_ID,
            teamId: new ObjectID("t2"),
            hasAcceptedInvitation: true,
          },
          {
            userId: new ObjectID("user-2"),
            projectId: PROJECT_ID,
            teamId: new ObjectID("t1"),
            hasAcceptedInvitation: false,
          },
        ],
      });

      expect(resourceCleanup).toHaveBeenCalledTimes(2);
      expect(resourceCleanup.mock.calls[0]![0]).toEqual({
        projectId: PROJECT_ID,
        userId: USER_ID,
      });
      // A revoked invitation is cleaned up too: an invitee owns nothing.
      expect(resourceCleanup.mock.calls[1]![0].userId.toString()).toBe(
        "user-2",
      );

      expect(onCallCleanup.mock.invocationCallOrder[0]!).toBeLessThan(
        resourceCleanup.mock.invocationCallOrder[0]!,
      );
      expect(resourceCleanup.mock.invocationCallOrder[0]!).toBeLessThan(
        removeSettings.mock.invocationCallOrder[0]!,
      );
    });
  });
});
