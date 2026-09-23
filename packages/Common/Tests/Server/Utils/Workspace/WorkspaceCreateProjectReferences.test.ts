import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { TurnContext } from "botbuilder";
import type { SpyInstance } from "jest-mock";
import { FindOperator } from "typeorm";
import DatabaseBaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Label from "../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../../Models/DatabaseModels/MonitorStatus";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import IncidentService from "../../../../Server/Services/IncidentService";
import LabelService from "../../../../Server/Services/LabelService";
import MonitorService from "../../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../../Server/Services/MonitorStatusService";
import OnCallDutyPolicyService from "../../../../Server/Services/OnCallDutyPolicyService";
import ScheduledMaintenanceService from "../../../../Server/Services/ScheduledMaintenanceService";
import {
  ExpressRequest,
  ExpressResponse,
} from "../../../../Server/Utils/Express";
import Response from "../../../../Server/Utils/Response";
import {
  MicrosoftTeamsIncidentActionType,
  MicrosoftTeamsScheduledMaintenanceActionType,
} from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/ActionTypes";
import MicrosoftTeamsAuthAction, {
  MicrosoftTeamsRequest,
} from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Auth";
import MicrosoftTeamsIncidentActions from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Incident";
import MicrosoftTeamsScheduledMaintenanceActions from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/ScheduledMaintenance";
import SlackActionType from "../../../../Server/Utils/Workspace/Slack/Actions/ActionTypes";
import { SlackRequest } from "../../../../Server/Utils/Workspace/Slack/Actions/Auth";
import SlackIncidentActions from "../../../../Server/Utils/Workspace/Slack/Actions/Incident";
import SlackScheduledMaintenanceActions from "../../../../Server/Utils/Workspace/Slack/Actions/ScheduledMaintenance";
import WorkspaceProjectReferenceValidator from "../../../../Server/Utils/Workspace/WorkspaceProjectReferenceValidator";
import URL from "../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../Types/ObjectID";

/*
 * Slack and Microsoft Teams create incidents and scheduled maintenance events
 * as root from ids in the submitted card or view. Those ids are chosen by the
 * client, not by the form we rendered, so a user linked to one project could
 * send another project's monitors, labels, on-call policies or monitor status.
 * Teams then wrote currentMonitorStatusId onto every submitted monitor by id
 * alone, changing another project's monitors.
 *
 * These tests run the real ProjectScopedReferenceValidator and only stub the
 * lookups it makes, so a foreign or unknown id has to be caught by the actual
 * check before anything is created or written.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "4af3a31b-58b0-4746-8025-f9cd4db1945e",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "3376855b-361c-427c-8982-bad7ada30414",
);
const USER_ID: ObjectID = new ObjectID("7c2f6b40-6a1b-4f18-9d0e-2c5ba2d3f0a7");

const OWN_MONITOR_ID: string = "0e7c5d0e-8b44-4b53-9d3c-0f4e7a1b2c01";
const SECOND_OWN_MONITOR_ID: string = "0e7c5d0e-8b44-4b53-9d3c-0f4e7a1b2c02";
const FOREIGN_MONITOR_ID: string = "b1d0f6c2-3a5e-4c7d-8e9f-a0b1c2d3e4f5";
const OWN_LABEL_ID: string = "5f1e2d3c-4b5a-4968-8776-655443322110";
const FOREIGN_LABEL_ID: string = "6a7b8c9d-0e1f-4a2b-9c3d-4e5f6a7b8c9d";
const OWN_POLICY_ID: string = "9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a";
const FOREIGN_POLICY_ID: string = "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f";
const OWN_STATUS_ID: string = "1a1cf3f2-0e35-4a1e-98a1-3f0f8b5f7f9e";
const FOREIGN_STATUS_ID: string = "cfc2f04f-79cb-4344-8c54-dafe5e3a290c";
const UNKNOWN_ID: string = "9c0ba0b3-2f8e-4c02-a8d5-6a4d2f5b9c11";
const SEVERITY_ID: string = "59b5ab80-63f6-4ffd-b3df-31c6ad127695";
const CREATED_ID: ObjectID = new ObjectID(
  "a2eb67d4-bd2e-4186-9187-dad799c9316c",
);

function withProject<T extends DatabaseBaseModel>(
  model: T,
  id: string,
  projectId: ObjectID,
): T {
  model._id = id;
  model.setValue("projectId", projectId);
  model.setValue("name", `record ${id}`);
  return model;
}

// Stand-in for the database: every record the lookups can find, by service.
function registerRecords(): void {
  const byService: Array<{
    service: { findBy: unknown };
    records: Array<DatabaseBaseModel>;
  }> = [
    {
      service: MonitorService,
      records: [
        withProject(new Monitor(), OWN_MONITOR_ID, PROJECT_ID),
        withProject(new Monitor(), SECOND_OWN_MONITOR_ID, PROJECT_ID),
        withProject(new Monitor(), FOREIGN_MONITOR_ID, OTHER_PROJECT_ID),
      ],
    },
    {
      service: LabelService,
      records: [
        withProject(new Label(), OWN_LABEL_ID, PROJECT_ID),
        withProject(new Label(), FOREIGN_LABEL_ID, OTHER_PROJECT_ID),
      ],
    },
    {
      service: OnCallDutyPolicyService,
      records: [
        withProject(new OnCallDutyPolicy(), OWN_POLICY_ID, PROJECT_ID),
        withProject(
          new OnCallDutyPolicy(),
          FOREIGN_POLICY_ID,
          OTHER_PROJECT_ID,
        ),
      ],
    },
    {
      service: MonitorStatusService,
      records: [
        withProject(new MonitorStatus(), OWN_STATUS_ID, PROJECT_ID),
        withProject(new MonitorStatus(), FOREIGN_STATUS_ID, OTHER_PROJECT_ID),
      ],
    },
  ];

  for (const { service, records } of byService) {
    jest
      .spyOn(service as never, "findBy" as never)
      .mockImplementation((async (findBy: {
        query: { _id?: unknown };
      }): Promise<Array<DatabaseBaseModel>> => {
        // The validator looks ids up with QueryHelper.any (a Raw IN operator).
        const idFilter: FindOperator<unknown> = findBy.query
          ._id as FindOperator<unknown>;
        const requestedIds: Array<string> = (
          Object.values(idFilter.objectLiteralParameters || {}) as Array<
            Array<string>
          >
        )
          .flat()
          .map((id: string) => {
            return id.toLowerCase();
          });

        return records.filter((record: DatabaseBaseModel) => {
          return requestedIds.includes(record._id!.toLowerCase());
        });
      }) as never);
  }
}

type WriteSpies = {
  updateOneBy: SpyInstance<typeof MonitorService.updateOneBy>;
  updateOneById: SpyInstance<typeof MonitorService.updateOneById>;
};

function spyOnMonitorWrites(): WriteSpies {
  return {
    updateOneBy: jest.spyOn(MonitorService, "updateOneBy").mockResolvedValue(1),
    updateOneById: jest
      .spyOn(MonitorService, "updateOneById")
      .mockResolvedValue(1),
  };
}

function relationIds(
  models: Array<DatabaseBaseModel> | undefined,
): Array<string> {
  return (models || []).map((model: DatabaseBaseModel) => {
    return model.id!.toString();
  });
}

function expectScopedStatusWrites(
  updateOneBy: WriteSpies["updateOneBy"],
  monitorIds: Array<string>,
  statusId: string,
): void {
  expect(updateOneBy).toHaveBeenCalledTimes(monitorIds.length);

  monitorIds.forEach((monitorId: string, index: number) => {
    const args: Parameters<typeof MonitorService.updateOneBy>[0] =
      updateOneBy.mock.calls[index]![0];

    expect(args.query).toEqual({
      _id: monitorId,
      projectId: PROJECT_ID,
    });
    expect(String(args.data.currentMonitorStatusId)).toBe(statusId);
    expect(args.props).toEqual({ isRoot: true });
  });
}

function createTurnContext(): TurnContext {
  return {
    activity: {},
    deleteActivity: jest.fn(async (): Promise<void> => {}),
    sendActivity: jest.fn(async (): Promise<void> => {}),
  } as unknown as TurnContext;
}

function sentMessages(turnContext: TurnContext): Array<string> {
  return (turnContext.sendActivity as unknown as jest.Mock).mock.calls.map(
    (call: Array<unknown>) => {
      return String(call[0]);
    },
  );
}

type ForeignReferenceCase = {
  name: string;
  monitors: string;
  monitorStatus: string;
  labels: string;
  onCallDutyPolicies: string;
};

// One foreign (or unknown) id at a time; everything else stays valid.
const INCIDENT_BAD_REFERENCES: ReadonlyArray<ForeignReferenceCase> = [
  {
    name: "a monitor from another project",
    monitors: `${OWN_MONITOR_ID},${FOREIGN_MONITOR_ID}`,
    monitorStatus: OWN_STATUS_ID,
    labels: OWN_LABEL_ID,
    onCallDutyPolicies: OWN_POLICY_ID,
  },
  {
    name: "a monitor id that does not exist",
    monitors: `${OWN_MONITOR_ID},${UNKNOWN_ID}`,
    monitorStatus: OWN_STATUS_ID,
    labels: OWN_LABEL_ID,
    onCallDutyPolicies: OWN_POLICY_ID,
  },
  {
    name: "a monitor status from another project",
    monitors: OWN_MONITOR_ID,
    monitorStatus: FOREIGN_STATUS_ID,
    labels: OWN_LABEL_ID,
    onCallDutyPolicies: OWN_POLICY_ID,
  },
  {
    name: "a label from another project",
    monitors: OWN_MONITOR_ID,
    monitorStatus: OWN_STATUS_ID,
    labels: `${OWN_LABEL_ID},${FOREIGN_LABEL_ID}`,
    onCallDutyPolicies: OWN_POLICY_ID,
  },
  {
    name: "an on-call policy from another project",
    monitors: OWN_MONITOR_ID,
    monitorStatus: OWN_STATUS_ID,
    labels: OWN_LABEL_ID,
    onCallDutyPolicies: `${OWN_POLICY_ID},${FOREIGN_POLICY_ID}`,
  },
];

const SCHEDULED_MAINTENANCE_BAD_REFERENCES: ReadonlyArray<ForeignReferenceCase> =
  INCIDENT_BAD_REFERENCES.filter((reference: ForeignReferenceCase) => {
    // Scheduled maintenance cards carry no on-call policies.
    return !reference.onCallDutyPolicies.includes(FOREIGN_POLICY_ID);
  });

function createdIncident(): Incident {
  const incident: Incident = new Incident();
  incident.id = CREATED_ID;
  incident.projectId = PROJECT_ID;
  return incident;
}

function createdScheduledMaintenance(): ScheduledMaintenance {
  const scheduledMaintenance: ScheduledMaintenance = new ScheduledMaintenance();
  scheduledMaintenance.id = CREATED_ID;
  scheduledMaintenance.projectId = PROJECT_ID;
  return scheduledMaintenance;
}

beforeEach((): void => {
  registerRecords();
});

afterEach((): void => {
  jest.restoreAllMocks();
});

describe("WorkspaceProjectReferenceValidator", (): void => {
  test("parses a comma separated card value, dropping blanks", (): void => {
    expect(
      WorkspaceProjectReferenceValidator.parseCommaSeparatedIds(
        ` ${OWN_MONITOR_ID}, ,${SECOND_OWN_MONITOR_ID},`,
      ).map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([OWN_MONITOR_ID, SECOND_OWN_MONITOR_ID]);

    expect(
      WorkspaceProjectReferenceValidator.parseCommaSeparatedIds(""),
    ).toEqual([]);
    expect(
      WorkspaceProjectReferenceValidator.parseCommaSeparatedIds(undefined),
    ).toEqual([]);
  });

  test("accepts references that all belong to the project", async (): Promise<void> => {
    await expect(
      WorkspaceProjectReferenceValidator.validateReferencesBelongToProject({
        projectId: PROJECT_ID,
        subject: "incident",
        monitorIds: [new ObjectID(OWN_MONITOR_ID)],
        labelIds: [new ObjectID(OWN_LABEL_ID)],
        onCallDutyPolicyIds: [new ObjectID(OWN_POLICY_ID)],
        monitorStatusId: new ObjectID(OWN_STATUS_ID),
      }),
    ).resolves.toBeUndefined();
  });

  test("names the kind of each foreign reference", async (): Promise<void> => {
    await expect(
      WorkspaceProjectReferenceValidator.validateReferencesBelongToProject({
        projectId: PROJECT_ID,
        subject: "incident",
        monitorIds: [new ObjectID(FOREIGN_MONITOR_ID)],
        labelIds: [new ObjectID(FOREIGN_LABEL_ID)],
        onCallDutyPolicyIds: [new ObjectID(FOREIGN_POLICY_ID)],
        monitorStatusId: new ObjectID(FOREIGN_STATUS_ID),
      }),
    ).rejects.toThrow(
      /This incident references records that belong to a different project: .*Monitor .*Label .*On-Call Policy .*Monitor Status/,
    );
  });
});

describe("Microsoft Teams bot: SubmitNewIncident", (): void => {
  function submit(
    reference: Omit<ForeignReferenceCase, "name">,
    turnContext: TurnContext,
  ): Promise<void> {
    return MicrosoftTeamsIncidentActions.handleBotIncidentAction({
      actionType: MicrosoftTeamsIncidentActionType.SubmitNewIncident,
      actionValue: "",
      value: {
        incidentTitle: "Database down",
        incidentDescription: "Primary is not answering",
        incidentSeverity: SEVERITY_ID,
        incidentMonitors: reference.monitors,
        monitorStatus: reference.monitorStatus,
        labels: reference.labels,
        onCallDutyPolicies: reference.onCallDutyPolicies,
      },
      projectId: PROJECT_ID,
      oneUptimeUserId: USER_ID,
      databaseProps: {} as DatabaseCommonInteractionProps,
      turnContext,
    });
  }

  test("creates the incident and writes monitor status only within the linked project", async (): Promise<void> => {
    const writes: WriteSpies = spyOnMonitorWrites();
    const createSpy: SpyInstance<typeof IncidentService.create> = jest
      .spyOn(IncidentService, "create")
      .mockResolvedValue(createdIncident());
    jest
      .spyOn(IncidentService, "getIncidentLinkInDashboard")
      .mockResolvedValue(URL.fromString("https://oneuptime.com/incident"));
    const turnContext: TurnContext = createTurnContext();

    await submit(
      {
        monitors: `${OWN_MONITOR_ID}, ${SECOND_OWN_MONITOR_ID}`,
        monitorStatus: OWN_STATUS_ID,
        labels: OWN_LABEL_ID,
        onCallDutyPolicies: OWN_POLICY_ID,
      },
      turnContext,
    );

    expect(createSpy).toHaveBeenCalledTimes(1);
    const incident: Incident = createSpy.mock.calls[0]![0].data;
    expect(incident.projectId).toEqual(PROJECT_ID);
    expect(relationIds(incident.monitors)).toEqual([
      OWN_MONITOR_ID,
      SECOND_OWN_MONITOR_ID,
    ]);
    expect(relationIds(incident.labels)).toEqual([OWN_LABEL_ID]);
    expect(relationIds(incident.onCallDutyPolicies)).toEqual([OWN_POLICY_ID]);

    expectScopedStatusWrites(
      writes.updateOneBy,
      [OWN_MONITOR_ID, SECOND_OWN_MONITOR_ID],
      OWN_STATUS_ID,
    );
    expect(writes.updateOneById).not.toHaveBeenCalled();
    expect(sentMessages(turnContext)[0]).toContain(
      "Incident created successfully",
    );
  });

  test.each(INCIDENT_BAD_REFERENCES)(
    "refuses $name before creating anything",
    async (reference: ForeignReferenceCase): Promise<void> => {
      const writes: WriteSpies = spyOnMonitorWrites();
      const createSpy: SpyInstance<typeof IncidentService.create> = jest
        .spyOn(IncidentService, "create")
        .mockResolvedValue(createdIncident());
      const turnContext: TurnContext = createTurnContext();

      await submit(reference, turnContext);

      expect(createSpy).not.toHaveBeenCalled();
      expect(writes.updateOneBy).not.toHaveBeenCalled();
      expect(writes.updateOneById).not.toHaveBeenCalled();
      expect(sentMessages(turnContext)).toEqual([
        "❌ Failed to create incident. Please try again.",
      ]);
    },
  );
});

describe("Microsoft Teams card: submitNewIncident", (): void => {
  function submit(
    reference: Omit<ForeignReferenceCase, "name">,
  ): Promise<void> {
    const teamsRequest: MicrosoftTeamsRequest = {
      isAuthorized: true,
      projectId: PROJECT_ID,
      authToken: "",
      payloadType: "invoke",
      userId: "teams-user",
      payload: {
        value: {
          incidentTitle: "Database down",
          incidentDescription: "Primary is not answering",
          incidentSeverity: SEVERITY_ID,
          incidentMonitors: reference.monitors,
          monitorStatus: reference.monitorStatus,
          labels: reference.labels,
          onCallDutyPolicies: reference.onCallDutyPolicies,
        },
      },
    };

    return MicrosoftTeamsIncidentActions.submitNewIncident({
      teamsRequest,
      action: {
        actionType: MicrosoftTeamsIncidentActionType.SubmitNewIncident,
      },
      req: {} as ExpressRequest,
      res: {} as ExpressResponse,
    });
  }

  beforeEach((): void => {
    jest.spyOn(Response, "sendTextResponse").mockImplementation(() => {});
    jest
      .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
      .mockResolvedValue(USER_ID);
  });

  test("writes monitor status only within the linked project", async (): Promise<void> => {
    const writes: WriteSpies = spyOnMonitorWrites();
    const createSpy: SpyInstance<typeof IncidentService.create> = jest
      .spyOn(IncidentService, "create")
      .mockResolvedValue(createdIncident());

    await submit({
      monitors: OWN_MONITOR_ID,
      monitorStatus: OWN_STATUS_ID,
      labels: OWN_LABEL_ID,
      onCallDutyPolicies: OWN_POLICY_ID,
    });

    expect(createSpy).toHaveBeenCalledTimes(1);
    expectScopedStatusWrites(
      writes.updateOneBy,
      [OWN_MONITOR_ID],
      OWN_STATUS_ID,
    );
    expect(writes.updateOneById).not.toHaveBeenCalled();
  });

  test.each(INCIDENT_BAD_REFERENCES)(
    "refuses $name before creating anything",
    async (reference: ForeignReferenceCase): Promise<void> => {
      const writes: WriteSpies = spyOnMonitorWrites();
      const createSpy: SpyInstance<typeof IncidentService.create> = jest
        .spyOn(IncidentService, "create")
        .mockResolvedValue(createdIncident());

      await submit(reference);

      expect(createSpy).not.toHaveBeenCalled();
      expect(writes.updateOneBy).not.toHaveBeenCalled();
      expect(writes.updateOneById).not.toHaveBeenCalled();
    },
  );
});

describe("Microsoft Teams bot: SubmitNewScheduledMaintenance", (): void => {
  function submit(
    reference: Omit<ForeignReferenceCase, "name">,
    turnContext: TurnContext,
  ): Promise<void> {
    return MicrosoftTeamsScheduledMaintenanceActions.handleBotScheduledMaintenanceAction(
      MicrosoftTeamsScheduledMaintenanceActionType.SubmitNewScheduledMaintenance,
      turnContext,
      {
        scheduledMaintenanceTitle: "Database upgrade",
        scheduledMaintenanceDescription: "Upgrading the primary",
        startDate: "2030-01-01",
        startTime: "10:00",
        endDate: "2030-01-01",
        endTime: "11:00",
        scheduledMaintenanceMonitors: reference.monitors,
        monitorStatus: reference.monitorStatus,
        labels: reference.labels,
      },
      {
        isAuthorized: true,
        projectId: PROJECT_ID,
        authToken: "",
        payloadType: "invoke",
        userId: USER_ID.toString(),
      },
    );
  }

  test("creates the event and writes monitor status only within the linked project", async (): Promise<void> => {
    const writes: WriteSpies = spyOnMonitorWrites();
    const createSpy: SpyInstance<typeof ScheduledMaintenanceService.create> =
      jest
        .spyOn(ScheduledMaintenanceService, "create")
        .mockResolvedValue(createdScheduledMaintenance());
    jest
      .spyOn(
        ScheduledMaintenanceService,
        "getScheduledMaintenanceLinkInDashboard",
      )
      .mockResolvedValue(URL.fromString("https://oneuptime.com/maintenance"));
    const turnContext: TurnContext = createTurnContext();

    await submit(
      {
        monitors: `${OWN_MONITOR_ID},${SECOND_OWN_MONITOR_ID}`,
        monitorStatus: OWN_STATUS_ID,
        labels: OWN_LABEL_ID,
        onCallDutyPolicies: "",
      },
      turnContext,
    );

    expect(createSpy).toHaveBeenCalledTimes(1);
    const scheduledMaintenance: ScheduledMaintenance =
      createSpy.mock.calls[0]![0].data;
    expect(scheduledMaintenance.projectId).toEqual(PROJECT_ID);
    expect(relationIds(scheduledMaintenance.monitors)).toEqual([
      OWN_MONITOR_ID,
      SECOND_OWN_MONITOR_ID,
    ]);
    expect(relationIds(scheduledMaintenance.labels)).toEqual([OWN_LABEL_ID]);

    expectScopedStatusWrites(
      writes.updateOneBy,
      [OWN_MONITOR_ID, SECOND_OWN_MONITOR_ID],
      OWN_STATUS_ID,
    );
    expect(writes.updateOneById).not.toHaveBeenCalled();
    expect(sentMessages(turnContext)[0]).toContain(
      "Scheduled maintenance created successfully",
    );
  });

  test.each(SCHEDULED_MAINTENANCE_BAD_REFERENCES)(
    "refuses $name before creating anything",
    async (reference: ForeignReferenceCase): Promise<void> => {
      const writes: WriteSpies = spyOnMonitorWrites();
      const createSpy: SpyInstance<typeof ScheduledMaintenanceService.create> =
        jest
          .spyOn(ScheduledMaintenanceService, "create")
          .mockResolvedValue(createdScheduledMaintenance());
      const turnContext: TurnContext = createTurnContext();

      await submit(reference, turnContext);

      expect(createSpy).not.toHaveBeenCalled();
      expect(writes.updateOneBy).not.toHaveBeenCalled();
      expect(writes.updateOneById).not.toHaveBeenCalled();
      expect(sentMessages(turnContext)).toEqual([
        "❌ Failed to create scheduled maintenance. Please try again.",
      ]);
    },
  );
});

describe("Microsoft Teams card: submitNewScheduledMaintenance", (): void => {
  function submit(
    reference: Omit<ForeignReferenceCase, "name">,
  ): Promise<void> {
    return MicrosoftTeamsScheduledMaintenanceActions.submitNewScheduledMaintenance(
      {
        teamsRequest: {
          isAuthorized: true,
          projectId: PROJECT_ID,
          authToken: "",
          payloadType: "invoke",
          userId: "teams-user",
          payload: {
            value: {
              scheduledMaintenanceTitle: "Database upgrade",
              scheduledMaintenanceDescription: "Upgrading the primary",
              startDate: "2030-01-01T10:00:00.000Z",
              endDate: "2030-01-01T11:00:00.000Z",
              scheduledMaintenanceMonitors: reference.monitors,
              monitorStatus: reference.monitorStatus,
              labels: reference.labels,
            },
          },
        },
        action: {
          actionType:
            MicrosoftTeamsScheduledMaintenanceActionType.SubmitNewScheduledMaintenance,
        },
        req: {} as ExpressRequest,
        res: {} as ExpressResponse,
      },
    );
  }

  beforeEach((): void => {
    jest.spyOn(Response, "sendTextResponse").mockImplementation(() => {});
    jest
      .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
      .mockResolvedValue(USER_ID);
  });

  test("writes monitor status only within the linked project", async (): Promise<void> => {
    const writes: WriteSpies = spyOnMonitorWrites();
    const createSpy: SpyInstance<typeof ScheduledMaintenanceService.create> =
      jest
        .spyOn(ScheduledMaintenanceService, "create")
        .mockResolvedValue(createdScheduledMaintenance());

    await submit({
      monitors: OWN_MONITOR_ID,
      monitorStatus: OWN_STATUS_ID,
      labels: OWN_LABEL_ID,
      onCallDutyPolicies: "",
    });

    expect(createSpy).toHaveBeenCalledTimes(1);
    expectScopedStatusWrites(
      writes.updateOneBy,
      [OWN_MONITOR_ID],
      OWN_STATUS_ID,
    );
    expect(writes.updateOneById).not.toHaveBeenCalled();
  });

  test.each(SCHEDULED_MAINTENANCE_BAD_REFERENCES)(
    "refuses $name before creating anything",
    async (reference: ForeignReferenceCase): Promise<void> => {
      const writes: WriteSpies = spyOnMonitorWrites();
      const createSpy: SpyInstance<typeof ScheduledMaintenanceService.create> =
        jest
          .spyOn(ScheduledMaintenanceService, "create")
          .mockResolvedValue(createdScheduledMaintenance());

      await submit(reference);

      expect(createSpy).not.toHaveBeenCalled();
      expect(writes.updateOneBy).not.toHaveBeenCalled();
      expect(writes.updateOneById).not.toHaveBeenCalled();
    },
  );
});

describe("Slack: SubmitNewIncident", (): void => {
  function submit(viewValues: SlackRequest["viewValues"]): Promise<void> {
    return SlackIncidentActions.submitNewIncident({
      slackRequest: {
        isAuthorized: true,
        userId: USER_ID,
        projectId: PROJECT_ID,
        projectAuthToken: "xoxb-project",
        botUserId: "B123",
        slackUsername: "someone",
        viewValues,
      },
      // No channel, so no confirmation message is posted back to Slack.
      action: {
        actionType: SlackActionType.SubmitNewIncident,
        actionValue: "",
      },
      req: {} as ExpressRequest,
      res: {} as ExpressResponse,
    });
  }

  function viewValues(
    reference: Omit<ForeignReferenceCase, "name">,
  ): SlackRequest["viewValues"] {
    return {
      incidentTitle: "Database down",
      incidentDescription: "Primary is not answering",
      incidentSeverity: SEVERITY_ID,
      incidentMonitors: reference.monitors.split(","),
      monitorStatus: reference.monitorStatus,
      labels: reference.labels.split(","),
      onCallDutyPolicies: reference.onCallDutyPolicies.split(","),
    };
  }

  beforeEach((): void => {
    jest.spyOn(Response, "sendJsonObjectResponse").mockImplementation(() => {});
  });

  test("creates an incident whose references all belong to the project", async (): Promise<void> => {
    const createSpy: SpyInstance<typeof IncidentService.create> = jest
      .spyOn(IncidentService, "create")
      .mockResolvedValue(createdIncident());

    await submit(
      viewValues({
        monitors: OWN_MONITOR_ID,
        monitorStatus: OWN_STATUS_ID,
        labels: OWN_LABEL_ID,
        onCallDutyPolicies: OWN_POLICY_ID,
      }),
    );

    expect(createSpy).toHaveBeenCalledTimes(1);
    const incident: Incident = createSpy.mock.calls[0]![0].data;
    expect(relationIds(incident.monitors)).toEqual([OWN_MONITOR_ID]);
    expect(relationIds(incident.labels)).toEqual([OWN_LABEL_ID]);
    expect(relationIds(incident.onCallDutyPolicies)).toEqual([OWN_POLICY_ID]);
    // The monitor status is left to IncidentService, which checks it itself.
    expect(incident.changeMonitorStatusToId?.toString()).toBe(OWN_STATUS_ID);
  });

  test.each(
    INCIDENT_BAD_REFERENCES.filter((reference: ForeignReferenceCase) => {
      // Slack hands the status to IncidentService, which validates it on create.
      return reference.monitorStatus === OWN_STATUS_ID;
    }),
  )(
    "refuses $name before creating anything",
    async (reference: ForeignReferenceCase): Promise<void> => {
      const createSpy: SpyInstance<typeof IncidentService.create> = jest
        .spyOn(IncidentService, "create")
        .mockResolvedValue(createdIncident());

      await expect(submit(viewValues(reference))).rejects.toThrow(
        "This incident references records that",
      );

      expect(createSpy).not.toHaveBeenCalled();
    },
  );
});

describe("Slack: SubmitNewScheduledMaintenance", (): void => {
  function submit(
    reference: Omit<ForeignReferenceCase, "name">,
  ): Promise<void> {
    return SlackScheduledMaintenanceActions.submitNewScheduledMaintenance({
      slackRequest: {
        isAuthorized: true,
        userId: USER_ID,
        projectId: PROJECT_ID,
        projectAuthToken: "xoxb-project",
        botUserId: "B123",
        slackUsername: "someone",
        viewValues: {
          scheduledMaintenanceTitle: "Database upgrade",
          scheduledMaintenanceDescription: "Upgrading the primary",
          startDate: "2099-01-01T10:00:00.000Z",
          endDate: "2099-01-01T11:00:00.000Z",
          scheduledMaintenanceMonitors: reference.monitors.split(","),
          monitorStatus: reference.monitorStatus,
          labels: reference.labels.split(","),
        },
      },
      action: {
        actionType: SlackActionType.SubmitNewScheduledMaintenance,
        actionValue: "",
      },
      req: {} as ExpressRequest,
      res: {} as ExpressResponse,
    });
  }

  beforeEach((): void => {
    jest.spyOn(Response, "sendJsonObjectResponse").mockImplementation(() => {});
  });

  test("creates an event whose references all belong to the project", async (): Promise<void> => {
    const createSpy: SpyInstance<typeof ScheduledMaintenanceService.create> =
      jest
        .spyOn(ScheduledMaintenanceService, "create")
        .mockResolvedValue(createdScheduledMaintenance());

    await submit({
      monitors: OWN_MONITOR_ID,
      monitorStatus: OWN_STATUS_ID,
      labels: OWN_LABEL_ID,
      onCallDutyPolicies: "",
    });

    expect(createSpy).toHaveBeenCalledTimes(1);
    const scheduledMaintenance: ScheduledMaintenance =
      createSpy.mock.calls[0]![0].data;
    expect(relationIds(scheduledMaintenance.monitors)).toEqual([
      OWN_MONITOR_ID,
    ]);
    expect(relationIds(scheduledMaintenance.labels)).toEqual([OWN_LABEL_ID]);
  });

  test.each(
    SCHEDULED_MAINTENANCE_BAD_REFERENCES.filter(
      (reference: ForeignReferenceCase) => {
        return reference.monitorStatus === OWN_STATUS_ID;
      },
    ),
  )(
    "refuses $name before creating anything",
    async (reference: ForeignReferenceCase): Promise<void> => {
      const createSpy: SpyInstance<typeof ScheduledMaintenanceService.create> =
        jest
          .spyOn(ScheduledMaintenanceService, "create")
          .mockResolvedValue(createdScheduledMaintenance());

      await expect(submit(reference)).rejects.toThrow(
        "This scheduled maintenance event references records that",
      );

      expect(createSpy).not.toHaveBeenCalled();
    },
  );
});
