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
import { ProjectScopedReferenceException } from "../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import {
  ExpressRequest,
  ExpressResponse,
} from "../../../../Server/Utils/Express";
import logger from "../../../../Server/Utils/Logger";
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
import SlackActionAuthorization from "../../../../Server/Utils/Workspace/Slack/Actions/Authorization";
import SlackIncidentActions from "../../../../Server/Utils/Workspace/Slack/Actions/Incident";
import SlackScheduledMaintenanceActions from "../../../../Server/Utils/Workspace/Slack/Actions/ScheduledMaintenance";
import WorkspaceActionAuthorization from "../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceProjectReferenceValidator from "../../../../Server/Utils/Workspace/WorkspaceProjectReferenceValidator";
import URL from "../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";

/*
 * Slack and Microsoft Teams create incidents and scheduled maintenance events
 * as root from ids in the submitted card or view. Those ids are chosen by the
 * client, not by the form we rendered, so a user linked to one project could
 * send another project's monitors, labels, on-call policies or monitor status.
 * Teams then wrote currentMonitorStatusId onto every submitted monitor by id
 * alone, changing another project's monitors. Teams now hands the status to
 * the incident or event (changeMonitorStatusToId), as Slack and the dashboard
 * do, and the service applies it to the validated monitors.
 *
 * These tests run the real ProjectScopedReferenceValidator and only stub the
 * lookups it makes, so a foreign or unknown id has to be caught by the actual
 * check before anything is created or written.
 *
 * The refusal is a ProjectScopedReferenceException: a BadDataException whose
 * message the API and Slack pass on. It names the field and echoes the id the
 * caller sent - never the other project's record, which it does not read -
 * and answers a foreign id like one that matches nothing. Teams still answers
 * with a fixed line and leaves the message to its error log.
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

// The other project's records, by names no refusal may give them.
const FOREIGN_MONITOR_NAME: string = "Acme Corp payroll API";
const FOREIGN_LABEL_NAME: string = "acme-corp-payroll";
const FOREIGN_POLICY_NAME: string = "Acme Corp executives on call";
const FOREIGN_STATUS_NAME: string = "Acme Corp degraded";

/*
 * What Microsoft Teams answers a submit that references a record the project
 * does not have. It names no record.
 */
const UNAVAILABLE_REFERENCE_REASON: string =
  "One of the values you picked (a monitor, label, on-call policy, severity or status) is not available in this project any more. Please pick it again.";

function withProject<T extends DatabaseBaseModel>(
  model: T,
  id: string,
  projectId: ObjectID,
  name?: string | undefined,
): T {
  model._id = id;
  model.setValue("projectId", projectId);
  model.setValue("name", name || `record ${id}`);
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
        withProject(
          new Monitor(),
          FOREIGN_MONITOR_ID,
          OTHER_PROJECT_ID,
          FOREIGN_MONITOR_NAME,
        ),
      ],
    },
    {
      service: LabelService,
      records: [
        withProject(new Label(), OWN_LABEL_ID, PROJECT_ID),
        withProject(
          new Label(),
          FOREIGN_LABEL_ID,
          OTHER_PROJECT_ID,
          FOREIGN_LABEL_NAME,
        ),
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
          FOREIGN_POLICY_NAME,
        ),
      ],
    },
    {
      service: MonitorStatusService,
      records: [
        withProject(new MonitorStatus(), OWN_STATUS_ID, PROJECT_ID),
        withProject(
          new MonitorStatus(),
          FOREIGN_STATUS_ID,
          OTHER_PROJECT_ID,
          FOREIGN_STATUS_NAME,
        ),
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

/*
 * The chosen monitor status travels on the created incident or event, for
 * IncidentService / ScheduledMaintenanceService to apply to its (validated)
 * monitors with a status timeline entry. Nothing is written to a monitor
 * directly any more.
 */
function expectStatusChangeHandedToService(
  writes: WriteSpies,
  created: Incident | ScheduledMaintenance,
  statusId: string,
): void {
  expect(created.changeMonitorStatusToId?.toString()).toBe(statusId);
  expect(writes.updateOneBy).not.toHaveBeenCalled();
  expect(writes.updateOneById).not.toHaveBeenCalled();
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

// The ids a submitted card or view carries, as the client sends them.
type ReferenceChoice = {
  monitors: string;
  monitorStatus: string;
  labels: string;
  onCallDutyPolicies: string;
};

type ForeignReferenceCase = ReferenceChoice & {
  name: string;
  // What the validator says of the bad reference, after "This <subject> ".
  refusal: string;
  // What identifies the bad record: its name and id. Never shown in chat.
  identifying: Array<string>;
};

// One foreign (or unknown) id at a time; everything else stays valid.
const INCIDENT_BAD_REFERENCES: ReadonlyArray<ForeignReferenceCase> = [
  {
    name: "a monitor from another project",
    monitors: `${OWN_MONITOR_ID},${FOREIGN_MONITOR_ID}`,
    monitorStatus: OWN_STATUS_ID,
    labels: OWN_LABEL_ID,
    onCallDutyPolicies: OWN_POLICY_ID,
    refusal: `references records that are not in this project: Monitor "${FOREIGN_MONITOR_ID}". Please pick values from this project and try again.`,
    identifying: [FOREIGN_MONITOR_NAME, FOREIGN_MONITOR_ID],
  },
  {
    name: "a monitor id that does not exist",
    monitors: `${OWN_MONITOR_ID},${UNKNOWN_ID}`,
    monitorStatus: OWN_STATUS_ID,
    labels: OWN_LABEL_ID,
    onCallDutyPolicies: OWN_POLICY_ID,
    refusal: `references records that are not in this project: Monitor "${UNKNOWN_ID}". Please pick values from this project and try again.`,
    identifying: [UNKNOWN_ID],
  },
  {
    name: "a monitor status from another project",
    monitors: OWN_MONITOR_ID,
    monitorStatus: FOREIGN_STATUS_ID,
    labels: OWN_LABEL_ID,
    onCallDutyPolicies: OWN_POLICY_ID,
    refusal: `references records that are not in this project: Monitor Status "${FOREIGN_STATUS_ID}". Please pick values from this project and try again.`,
    identifying: [FOREIGN_STATUS_NAME, FOREIGN_STATUS_ID],
  },
  {
    name: "a label from another project",
    monitors: OWN_MONITOR_ID,
    monitorStatus: OWN_STATUS_ID,
    labels: `${OWN_LABEL_ID},${FOREIGN_LABEL_ID}`,
    onCallDutyPolicies: OWN_POLICY_ID,
    refusal: `references records that are not in this project: Label "${FOREIGN_LABEL_ID}". Please pick values from this project and try again.`,
    identifying: [FOREIGN_LABEL_NAME, FOREIGN_LABEL_ID],
  },
  {
    name: "an on-call policy from another project",
    monitors: OWN_MONITOR_ID,
    monitorStatus: OWN_STATUS_ID,
    labels: OWN_LABEL_ID,
    onCallDutyPolicies: `${OWN_POLICY_ID},${FOREIGN_POLICY_ID}`,
    refusal: `references records that are not in this project: On-Call Policy "${FOREIGN_POLICY_ID}". Please pick values from this project and try again.`,
    identifying: [FOREIGN_POLICY_NAME, FOREIGN_POLICY_ID],
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
      /This incident references records that are not in this project: .*Monitor .*Label .*On-Call Policy .*Monitor Status/,
    );
  });

  test.each(INCIDENT_BAD_REFERENCES)(
    "refuses $name with a ProjectScopedReferenceException: a BadDataException that echoes the id, never the record's name",
    async (reference: ForeignReferenceCase): Promise<void> => {
      let refusal: unknown = undefined;

      try {
        await WorkspaceProjectReferenceValidator.validateReferencesBelongToProject(
          {
            projectId: PROJECT_ID,
            subject: "incident",
            monitorIds:
              WorkspaceProjectReferenceValidator.parseCommaSeparatedIds(
                reference.monitors,
              ),
            labelIds: WorkspaceProjectReferenceValidator.parseCommaSeparatedIds(
              reference.labels,
            ),
            onCallDutyPolicyIds:
              WorkspaceProjectReferenceValidator.parseCommaSeparatedIds(
                reference.onCallDutyPolicies,
              ),
            monitorStatusId: new ObjectID(reference.monitorStatus),
          },
        );
      } catch (error) {
        refusal = error;
      }

      expect(refusal).toBeInstanceOf(ProjectScopedReferenceException);
      expect(refusal).toBeInstanceOf(BadDataException);
      expect((refusal as BadDataException).message).toBe(
        `This incident ${reference.refusal}`,
      );

      for (const name of [
        FOREIGN_MONITOR_NAME,
        FOREIGN_LABEL_NAME,
        FOREIGN_POLICY_NAME,
        FOREIGN_STATUS_NAME,
      ]) {
        expect((refusal as BadDataException).message).not.toContain(name);
      }
    },
  );
});

describe("Microsoft Teams bot: SubmitNewIncident", (): void => {
  function submit(
    reference: ReferenceChoice,
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

  let errorLog: SpyInstance<typeof logger.error>;

  beforeEach((): void => {
    errorLog = jest.spyOn(logger, "error").mockImplementation((): void => {});
  });

  test("creates the incident and hands the monitor status to IncidentService instead of writing monitors", async (): Promise<void> => {
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

    expectStatusChangeHandedToService(writes, incident, OWN_STATUS_ID);
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

      /*
       * One reply, and it says what to do, but not which record: the
       * validator's message names another project's.
       */
      const messages: Array<string> = sentMessages(turnContext);
      expect(messages).toEqual([
        `❌ Could not create the incident: ${UNAVAILABLE_REFERENCE_REASON}`,
      ]);
      for (const identifying of reference.identifying) {
        expect(messages[0]).not.toContain(identifying);
      }

      // Which record it was is for an operator, in the log.
      expect(errorLog).toHaveBeenCalledTimes(2);
      expect(errorLog).toHaveBeenNthCalledWith(
        1,
        `Could not create an incident from Microsoft Teams: ProjectScopedReferenceException: This incident ${reference.refusal}`,
        { projectId: PROJECT_ID.toString() },
      );
      expect(errorLog.mock.calls[1]![0]).toBeInstanceOf(
        ProjectScopedReferenceException,
      );
    },
  );
});

describe("Microsoft Teams card: submitNewIncident", (): void => {
  function submit(reference: ReferenceChoice): Promise<void> {
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

  test("hands the monitor status to IncidentService instead of writing monitors", async (): Promise<void> => {
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
    expectStatusChangeHandedToService(
      writes,
      createSpy.mock.calls[0]![0].data,
      OWN_STATUS_ID,
    );
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
    reference: ReferenceChoice,
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
      { userId: USER_ID, tenantId: PROJECT_ID },
    );
  }

  let errorLog: SpyInstance<typeof logger.error>;

  beforeEach((): void => {
    // Create permission is covered by the workspace authorization tests.
    jest
      .spyOn(WorkspaceActionAuthorization, "assertCanCreate")
      .mockResolvedValue();
    errorLog = jest.spyOn(logger, "error").mockImplementation((): void => {});
  });

  test("creates the event and hands the monitor status to ScheduledMaintenanceService instead of writing monitors", async (): Promise<void> => {
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

    expectStatusChangeHandedToService(
      writes,
      scheduledMaintenance,
      OWN_STATUS_ID,
    );
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

      /*
       * One reply, and it says what to do, but not which record: the
       * validator's message names another project's.
       */
      const messages: Array<string> = sentMessages(turnContext);
      expect(messages).toEqual([
        `❌ Could not create the scheduled maintenance event: ${UNAVAILABLE_REFERENCE_REASON}`,
      ]);
      for (const identifying of reference.identifying) {
        expect(messages[0]).not.toContain(identifying);
      }

      // Which record it was is for an operator, in the log.
      expect(errorLog).toHaveBeenCalledTimes(2);
      expect(errorLog).toHaveBeenNthCalledWith(
        1,
        `Could not create a scheduled maintenance event from Microsoft Teams: ProjectScopedReferenceException: This scheduled maintenance event ${reference.refusal}`,
        { projectId: PROJECT_ID.toString() },
      );
      expect(errorLog.mock.calls[1]![0]).toBeInstanceOf(
        ProjectScopedReferenceException,
      );
    },
  );
});

describe("Microsoft Teams card: submitNewScheduledMaintenance", (): void => {
  function submit(reference: ReferenceChoice): Promise<void> {
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

  test("hands the monitor status to ScheduledMaintenanceService instead of writing monitors", async (): Promise<void> => {
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
    expectStatusChangeHandedToService(
      writes,
      createSpy.mock.calls[0]![0].data,
      OWN_STATUS_ID,
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

  function viewValues(reference: ReferenceChoice): SlackRequest["viewValues"] {
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

      // The validator's own message, as Slack has always passed it on.
      await expect(submit(viewValues(reference))).rejects.toThrow(
        `This incident ${reference.refusal}`,
      );

      expect(createSpy).not.toHaveBeenCalled();
    },
  );
});

describe("Slack: SubmitNewScheduledMaintenance", (): void => {
  function submit(reference: ReferenceChoice): Promise<void> {
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
    // Create permission is covered by the Slack authorization tests.
    jest
      .spyOn(SlackActionAuthorization, "authorize")
      .mockResolvedValue({ userId: USER_ID, tenantId: PROJECT_ID });
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

      // The validator's own message, as Slack has always passed it on.
      await expect(submit(reference)).rejects.toThrow(
        `This scheduled maintenance event ${reference.refusal}`,
      );

      expect(createSpy).not.toHaveBeenCalled();
    },
  );
});
