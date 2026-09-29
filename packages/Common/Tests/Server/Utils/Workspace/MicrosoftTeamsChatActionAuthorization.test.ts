import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { TurnContext } from "botbuilder";
import type { SpyInstance } from "jest-mock";
import Incident from "../../../../Models/DatabaseModels/Incident";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import AlertEpisodeService from "../../../../Server/Services/AlertEpisodeService";
import IncidentEpisodeInternalNoteService from "../../../../Server/Services/IncidentEpisodeInternalNoteService";
import IncidentInternalNoteService from "../../../../Server/Services/IncidentInternalNoteService";
import IncidentPublicNoteService from "../../../../Server/Services/IncidentPublicNoteService";
import IncidentService from "../../../../Server/Services/IncidentService";
import MonitorService from "../../../../Server/Services/MonitorService";
import OnCallDutyPolicyService from "../../../../Server/Services/OnCallDutyPolicyService";
import ScheduledMaintenanceInternalNoteService from "../../../../Server/Services/ScheduledMaintenanceInternalNoteService";
import ScheduledMaintenanceService from "../../../../Server/Services/ScheduledMaintenanceService";
import {
  MicrosoftTeamsAlertEpisodeActionType,
  MicrosoftTeamsIncidentActionType,
  MicrosoftTeamsIncidentEpisodeActionType,
  MicrosoftTeamsMonitorActionType,
  MicrosoftTeamsScheduledMaintenanceActionType,
} from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/ActionTypes";
import MicrosoftTeamsAlertEpisodeActions from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/AlertEpisode";
import { MicrosoftTeamsRequest } from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Auth";
import MicrosoftTeamsIncidentActions from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Incident";
import MicrosoftTeamsIncidentEpisodeActions from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/IncidentEpisode";
import MicrosoftTeamsMonitorActions from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Monitor";
import MicrosoftTeamsScheduledMaintenanceActions from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/ScheduledMaintenance";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";

/*
 * Teams cards used to reach services that write as root. Incident and alert
 * acknowledge / resolve already had a check (MicrosoftTeamsActionAuthorization
 * tests pin it); notes, on-call pages, episodes, monitors and scheduled
 * maintenance did not. The permission logic below is real; only persistence
 * is stubbed. The props are what handleBotInvokeActivity hands every handler
 * for a current project member.
 */

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

function createDatabaseProps(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: projectId,
    permissions: permissions.map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        isBlockPermission: false,
        labelIds: [],
      };
    }),
  };

  return {
    userId: userId,
    tenantId: projectId,
    userTeamIds: [],
    userTenantAccessPermission: {
      [projectId.toString()]: tenantPermission,
    },
  };
}

function createTurnContext(): TurnContext {
  return {
    activity: {},
    deleteActivity: jest.fn(async (): Promise<void> => {}),
    sendActivity: jest.fn(async (): Promise<void> => {}),
  } as unknown as TurnContext;
}

const readOnlyProps: DatabaseCommonInteractionProps = createDatabaseProps([
  Permission.Viewer,
]);

afterEach((): void => {
  jest.restoreAllMocks();
});

describe("Microsoft Teams incident notes and on-call pages", (): void => {
  test("a read-only member cannot post a public status-page note", async (): Promise<void> => {
    const addNoteSpy: SpyInstance<typeof IncidentPublicNoteService.addNote> =
      jest
        .spyOn(IncidentPublicNoteService, "addNote")
        .mockResolvedValue(undefined as never);

    await expect(
      MicrosoftTeamsIncidentActions.handleBotIncidentAction({
        actionType: MicrosoftTeamsIncidentActionType.SubmitIncidentNote,
        actionValue: ObjectID.generate().toString(),
        value: { noteType: "public", note: "All clear." },
        projectId: projectId,
        oneUptimeUserId: userId,
        databaseProps: readOnlyProps,
        turnContext: createTurnContext(),
      }),
    ).rejects.toThrow("add a public note to this incident");

    expect(addNoteSpy).not.toHaveBeenCalled();
  });

  test("an incident member posts a private note on an incident they can read", async (): Promise<void> => {
    const incidentId: ObjectID = ObjectID.generate();
    const props: DatabaseCommonInteractionProps = createDatabaseProps([
      Permission.IncidentMember,
    ]);
    const lookupSpy: SpyInstance<typeof IncidentService.findOneBy> = jest
      .spyOn(IncidentService, "findOneBy")
      .mockResolvedValue(new Incident());
    const addNoteSpy: SpyInstance<typeof IncidentInternalNoteService.addNote> =
      jest
        .spyOn(IncidentInternalNoteService, "addNote")
        .mockResolvedValue(undefined as never);

    await MicrosoftTeamsIncidentActions.handleBotIncidentAction({
      actionType: MicrosoftTeamsIncidentActionType.SubmitIncidentNote,
      actionValue: incidentId.toString(),
      value: { noteType: "private", note: "Looking." },
      projectId: projectId,
      oneUptimeUserId: userId,
      databaseProps: props,
      turnContext: createTurnContext(),
    });

    expect(lookupSpy.mock.calls[0]![0].props).toBe(props);
    expect(addNoteSpy).toHaveBeenCalledTimes(1);
    expect(addNoteSpy.mock.calls[0]![0]).toMatchObject({
      note: "Looking.",
      userId: userId,
      projectId: projectId,
    });
  });

  test("a read-only member cannot page an on-call policy", async (): Promise<void> => {
    const executeSpy: SpyInstance<
      typeof OnCallDutyPolicyService.executePolicy
    > = jest
      .spyOn(OnCallDutyPolicyService, "executePolicy")
      .mockResolvedValue();

    await expect(
      MicrosoftTeamsIncidentActions.handleBotIncidentAction({
        actionType:
          MicrosoftTeamsIncidentActionType.SubmitExecuteIncidentOnCallPolicy,
        actionValue: ObjectID.generate().toString(),
        value: { onCallPolicy: ObjectID.generate().toString() },
        projectId: projectId,
        oneUptimeUserId: userId,
        databaseProps: readOnlyProps,
        turnContext: createTurnContext(),
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedException);

    expect(executeSpy).not.toHaveBeenCalled();
  });

  test("a read-only member cannot acknowledge an incident", async (): Promise<void> => {
    const acknowledgeSpy: SpyInstance<
      typeof IncidentService.acknowledgeIncident
    > = jest
      .spyOn(IncidentService, "acknowledgeIncident")
      .mockResolvedValue(new Incident());

    await expect(
      MicrosoftTeamsIncidentActions.handleBotIncidentAction({
        actionType: MicrosoftTeamsIncidentActionType.AckIncident,
        actionValue: ObjectID.generate().toString(),
        value: {},
        projectId: projectId,
        oneUptimeUserId: userId,
        databaseProps: readOnlyProps,
        turnContext: createTurnContext(),
      }),
    ).rejects.toThrow("acknowledge this incident");

    expect(acknowledgeSpy).not.toHaveBeenCalled();
  });
});

describe("Microsoft Teams episodes", (): void => {
  test("a read-only member cannot acknowledge an alert episode", async (): Promise<void> => {
    const acknowledgeSpy: SpyInstance<
      typeof AlertEpisodeService.acknowledgeEpisode
    > = jest
      .spyOn(AlertEpisodeService, "acknowledgeEpisode")
      .mockResolvedValue(undefined as never);

    await expect(
      MicrosoftTeamsAlertEpisodeActions.handleBotAlertEpisodeAction({
        actionType: MicrosoftTeamsAlertEpisodeActionType.AckAlertEpisode,
        actionValue: ObjectID.generate().toString(),
        value: {},
        projectId: projectId,
        oneUptimeUserId: userId,
        databaseProps: readOnlyProps,
        turnContext: createTurnContext(),
      }),
    ).rejects.toThrow("acknowledge this alert episode");

    expect(acknowledgeSpy).not.toHaveBeenCalled();
  });

  test("a read-only member cannot change an alert episode's state", async (): Promise<void> => {
    const changeSpy: SpyInstance<
      typeof AlertEpisodeService.changeEpisodeState
    > = jest
      .spyOn(AlertEpisodeService, "changeEpisodeState")
      .mockResolvedValue();

    await expect(
      MicrosoftTeamsAlertEpisodeActions.handleBotAlertEpisodeAction({
        actionType:
          MicrosoftTeamsAlertEpisodeActionType.SubmitChangeAlertEpisodeState,
        actionValue: ObjectID.generate().toString(),
        value: { alertState: ObjectID.generate().toString() },
        projectId: projectId,
        oneUptimeUserId: userId,
        databaseProps: readOnlyProps,
        turnContext: createTurnContext(),
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedException);

    expect(changeSpy).not.toHaveBeenCalled();
  });

  test("a read-only member cannot add an incident episode note", async (): Promise<void> => {
    const addNoteSpy: SpyInstance<
      typeof IncidentEpisodeInternalNoteService.addNote
    > = jest
      .spyOn(IncidentEpisodeInternalNoteService, "addNote")
      .mockResolvedValue(undefined as never);

    await expect(
      MicrosoftTeamsIncidentEpisodeActions.handleBotIncidentEpisodeAction({
        actionType:
          MicrosoftTeamsIncidentEpisodeActionType.SubmitIncidentEpisodeNote,
        actionValue: ObjectID.generate().toString(),
        value: { note: "Noted." },
        projectId: projectId,
        oneUptimeUserId: userId,
        databaseProps: readOnlyProps,
        turnContext: createTurnContext(),
      }),
    ).rejects.toThrow("add a private note to this incident episode");

    expect(addNoteSpy).not.toHaveBeenCalled();
  });
});

describe("Microsoft Teams monitor enable / disable", (): void => {
  test("runs as the user, not as root", async (): Promise<void> => {
    const monitorId: ObjectID = ObjectID.generate();
    const props: DatabaseCommonInteractionProps = createDatabaseProps([
      Permission.MonitorMember,
    ]);
    const updateSpy: SpyInstance<typeof MonitorService.updateOneById> = jest
      .spyOn(MonitorService, "updateOneById")
      .mockResolvedValue(1);
    const turnContext: TurnContext = createTurnContext();

    await MicrosoftTeamsMonitorActions.handleBotMonitorAction({
      actionType: MicrosoftTeamsMonitorActionType.DisableMonitor,
      actionValue: monitorId.toString(),
      value: {},
      projectId: projectId,
      oneUptimeUserId: userId,
      databaseProps: props,
      turnContext: turnContext,
    });

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0]![0].props).toBe(props);
    expect(updateSpy.mock.calls[0]![0].data).toEqual({
      disableActiveMonitoring: true,
    });
    expect(turnContext.sendActivity).toHaveBeenCalledWith(
      "✅ Monitor disabled successfully.",
    );
  });

  test("an update that matched no row is refused, not reported as done", async (): Promise<void> => {
    // A monitor in another project, or outside the user's labels.
    jest.spyOn(MonitorService, "updateOneById").mockResolvedValue(0);
    const turnContext: TurnContext = createTurnContext();

    await expect(
      MicrosoftTeamsMonitorActions.handleBotMonitorAction({
        actionType: MicrosoftTeamsMonitorActionType.EnableMonitor,
        actionValue: ObjectID.generate().toString(),
        value: {},
        projectId: projectId,
        oneUptimeUserId: userId,
        databaseProps: createDatabaseProps([Permission.MonitorMember]),
        turnContext: turnContext,
      }),
    ).rejects.toThrow(
      "You do not have permission to enable this monitor: the monitor was not found in this project",
    );

    expect(turnContext.sendActivity).not.toHaveBeenCalled();
  });

  test("a permission refusal from the update names the action", async (): Promise<void> => {
    jest
      .spyOn(MonitorService, "updateOneById")
      .mockRejectedValue(new NotAuthorizedException("Monitor update denied."));

    await expect(
      MicrosoftTeamsMonitorActions.handleBotMonitorAction({
        actionType: MicrosoftTeamsMonitorActionType.DisableMonitor,
        actionValue: ObjectID.generate().toString(),
        value: {},
        projectId: projectId,
        oneUptimeUserId: userId,
        databaseProps: readOnlyProps,
        turnContext: createTurnContext(),
      }),
    ).rejects.toThrow(
      "You do not have permission to disable this monitor. Monitor update denied.",
    );
  });
});

describe("Microsoft Teams scheduled maintenance", (): void => {
  const request: MicrosoftTeamsRequest = {
    isAuthorized: true,
    projectId: projectId,
    authToken: "",
    payloadType: "invoke",
    userId: userId.toString(),
  };

  function mockEvent(): SpyInstance<
    typeof ScheduledMaintenanceService.findOneBy
  > {
    const event: ScheduledMaintenance = new ScheduledMaintenance();
    event.id = ObjectID.generate();
    event.projectId = projectId;
    return jest
      .spyOn(ScheduledMaintenanceService, "findOneBy")
      .mockResolvedValue(event);
  }

  test("a read-only member cannot mark an event as ongoing, and is told why", async (): Promise<void> => {
    const lookupSpy: SpyInstance<typeof ScheduledMaintenanceService.findOneBy> =
      mockEvent();
    const updateSpy: SpyInstance<
      typeof ScheduledMaintenanceService.updateOneById
    > = jest
      .spyOn(ScheduledMaintenanceService, "updateOneById")
      .mockResolvedValue(1);
    const turnContext: TurnContext = createTurnContext();

    await MicrosoftTeamsScheduledMaintenanceActions.handleBotScheduledMaintenanceAction(
      MicrosoftTeamsScheduledMaintenanceActionType.MarkAsOngoing,
      turnContext,
      { scheduledMaintenanceId: ObjectID.generate().toString() },
      request,
      readOnlyProps,
    );

    expect(updateSpy).not.toHaveBeenCalled();
    // The event is looked up inside the caller's project, not by id alone.
    expect(lookupSpy.mock.calls[0]![0].query).toMatchObject({
      projectId: projectId,
    });
    expect(turnContext.sendActivity).toHaveBeenCalledWith(
      expect.stringContaining(
        "You do not have permission to mark this scheduled maintenance event as ongoing.",
      ),
    );
  });

  test("a read-only member cannot add a note", async (): Promise<void> => {
    mockEvent();
    const addNoteSpy: SpyInstance<
      typeof ScheduledMaintenanceInternalNoteService.addNote
    > = jest
      .spyOn(ScheduledMaintenanceInternalNoteService, "addNote")
      .mockResolvedValue(undefined as never);
    const turnContext: TurnContext = createTurnContext();

    await MicrosoftTeamsScheduledMaintenanceActions.handleBotScheduledMaintenanceAction(
      MicrosoftTeamsScheduledMaintenanceActionType.SubmitScheduledMaintenanceNote,
      turnContext,
      {
        scheduledMaintenanceId: ObjectID.generate().toString(),
        note: "Starting.",
        isPublic: false,
      },
      request,
      readOnlyProps,
    );

    expect(addNoteSpy).not.toHaveBeenCalled();
    expect(turnContext.sendActivity).toHaveBeenCalledWith(
      expect.stringContaining(
        "add a private note to this scheduled maintenance event",
      ),
    );
  });

  test("a read-only member cannot create an event", async (): Promise<void> => {
    const createSpy: SpyInstance<typeof ScheduledMaintenanceService.create> =
      jest
        .spyOn(ScheduledMaintenanceService, "create")
        .mockResolvedValue(new ScheduledMaintenance());
    const turnContext: TurnContext = createTurnContext();

    await MicrosoftTeamsScheduledMaintenanceActions.handleBotScheduledMaintenanceAction(
      MicrosoftTeamsScheduledMaintenanceActionType.SubmitNewScheduledMaintenance,
      turnContext,
      {
        scheduledMaintenanceTitle: "Database upgrade",
        scheduledMaintenanceDescription: "Planned.",
        startDate: "2026-10-01",
        startTime: "10:00",
        endDate: "2026-10-01",
        endTime: "11:00",
      },
      request,
      readOnlyProps,
    );

    expect(createSpy).not.toHaveBeenCalled();
    expect(turnContext.sendActivity).toHaveBeenCalledWith(
      expect.stringContaining(
        "You do not have permission to create a scheduled maintenance event.",
      ),
    );
  });
});
