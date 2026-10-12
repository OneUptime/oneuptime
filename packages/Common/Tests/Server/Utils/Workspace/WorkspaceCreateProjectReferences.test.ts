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
import DatabaseBaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../../Models/DatabaseModels/Incident";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import IncidentService from "../../../../Server/Services/IncidentService";
import MonitorService from "../../../../Server/Services/MonitorService";
import ScheduledMaintenanceService from "../../../../Server/Services/ScheduledMaintenanceService";
import { UnreadableReferenceException } from "../../../../Server/Utils/Database/ProjectScopedReferenceRefusal";
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
import MicrosoftTeamsIncidentActions from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Incident";
import MicrosoftTeamsScheduledMaintenanceActions from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/ScheduledMaintenance";
import SlackActionType from "../../../../Server/Utils/Workspace/Slack/Actions/ActionTypes";
import { SlackRequest } from "../../../../Server/Utils/Workspace/Slack/Actions/Auth";
import SlackActionAuthorization from "../../../../Server/Utils/Workspace/Slack/Actions/Authorization";
import SlackIncidentActions from "../../../../Server/Utils/Workspace/Slack/Actions/Incident";
import SlackScheduledMaintenanceActions from "../../../../Server/Utils/Workspace/Slack/Actions/ScheduledMaintenance";
import SlackUtil from "../../../../Server/Utils/Workspace/Slack/Slack";
import WorkspaceActionAuthorization from "../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceProjectReferenceValidator from "../../../../Server/Utils/Workspace/WorkspaceProjectReferenceValidator";
import URL from "../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../Types/ObjectID";
import {
  WorkspaceMessageBlock,
  WorkspacePayloadMarkdown,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";

/*
 * Slack and Microsoft Teams create incidents and scheduled maintenance events
 * from ids in the submitted card or view. Those ids are chosen by the client,
 * not by the form we rendered: a submit can carry another project's monitors,
 * labels, on-call policies or monitor status, a record deleted since the form
 * was sent, or one its member may not read.
 *
 * So nothing is checked or created as root any more. The record is created
 * with the props of the member the chat account is connected to - the props
 * the dashboard's create would carry - and the create itself holds every id
 * it names to what that member may name: one of another project, one that is
 * gone, one outside the member's read, all answered like a record the
 * project does not have (DatabaseService's reference checks). Here the
 * create is stubbed, so these tests pin what the chat side does: every id is
 * handed over, with the member's props, the chosen monitor status travels on
 * the record (changeMonitorStatusToId) rather than being written onto the
 * monitors, and a refusal is answered - in Slack, in a direct message with
 * the create's own words (the id the member sent, never another project's
 * record name); in Teams, with a fixed line, the details in the log.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "4af3a31b-58b0-4746-8025-f9cd4db1945e",
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
const SEVERITY_ID: string = "59b5ab80-63f6-4ffd-b3df-31c6ad127695";
const CREATED_ID: ObjectID = new ObjectID(
  "a2eb67d4-bd2e-4186-9187-dad799c9316c",
);

// The other project's records, by names no reply may give them.
const FOREIGN_MONITOR_NAME: string = "Acme Corp payroll API";
const FOREIGN_LABEL_NAME: string = "acme-corp-payroll";
const FOREIGN_POLICY_NAME: string = "Acme Corp executives on call";

// The member a chat account is connected to, with their own permissions.
const MEMBER_PROPS: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  tenantId: PROJECT_ID,
};

/*
 * What Microsoft Teams answers a submit that references a record the member
 * may not name. It names no record.
 */
const UNAVAILABLE_REFERENCE_REASON: string =
  "One of the values you picked (a monitor, label, on-call policy, severity or status) is not available in this project any more. Please pick it again.";

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
 * IncidentService / ScheduledMaintenanceService to apply to its monitors
 * with a status timeline entry. Nothing is written to a monitor directly.
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

const OWN_CHOICE: ReferenceChoice = {
  monitors: `${OWN_MONITOR_ID},${SECOND_OWN_MONITOR_ID}`,
  monitorStatus: OWN_STATUS_ID,
  labels: OWN_LABEL_ID,
  onCallDutyPolicies: OWN_POLICY_ID,
};

type RefusedReferenceCase = ReferenceChoice & {
  name: string;
  // The refusal the create gives: its class, and what it says after "This <subject> ".
  refusal: "foreign" | "unreadable";
  says: string;
  // What identifies another project's record: never in a reply.
  identifying: Array<string>;
};

/*
 * One reference the member may not name at a time, everything else theirs,
 * and the refusal the create's own check answers it with.
 */
const INCIDENT_REFUSED_REFERENCES: ReadonlyArray<RefusedReferenceCase> = [
  {
    name: "a monitor from another project",
    monitors: `${OWN_MONITOR_ID},${FOREIGN_MONITOR_ID}`,
    monitorStatus: OWN_STATUS_ID,
    labels: OWN_LABEL_ID,
    onCallDutyPolicies: OWN_POLICY_ID,
    refusal: "foreign",
    says: `references records that are not in this project: Monitor "${FOREIGN_MONITOR_ID}". Please pick values from this project and try again.`,
    identifying: [FOREIGN_MONITOR_NAME],
  },
  {
    name: "a monitor the member may not read (a label their read does not reach)",
    monitors: `${OWN_MONITOR_ID},${SECOND_OWN_MONITOR_ID}`,
    monitorStatus: OWN_STATUS_ID,
    labels: OWN_LABEL_ID,
    onCallDutyPolicies: OWN_POLICY_ID,
    refusal: "unreadable",
    says: `references records that are not in this project: Monitors "${SECOND_OWN_MONITOR_ID}". Please pick values from this project and try again.`,
    identifying: [],
  },
  {
    name: "a label from another project",
    monitors: OWN_MONITOR_ID,
    monitorStatus: OWN_STATUS_ID,
    labels: `${OWN_LABEL_ID},${FOREIGN_LABEL_ID}`,
    onCallDutyPolicies: OWN_POLICY_ID,
    refusal: "foreign",
    says: `references records that are not in this project: Label "${FOREIGN_LABEL_ID}". Please pick values from this project and try again.`,
    identifying: [FOREIGN_LABEL_NAME],
  },
  {
    name: "an on-call policy the member may not read",
    monitors: OWN_MONITOR_ID,
    monitorStatus: OWN_STATUS_ID,
    labels: OWN_LABEL_ID,
    onCallDutyPolicies: `${OWN_POLICY_ID},${FOREIGN_POLICY_ID}`,
    refusal: "unreadable",
    says: `references records that are not in this project: On-Call Duty Policies "${FOREIGN_POLICY_ID}". Please pick values from this project and try again.`,
    identifying: [FOREIGN_POLICY_NAME],
  },
];

const SCHEDULED_MAINTENANCE_REFUSED_REFERENCES: ReadonlyArray<RefusedReferenceCase> =
  INCIDENT_REFUSED_REFERENCES.filter((reference: RefusedReferenceCase) => {
    // Scheduled maintenance cards carry no on-call policies.
    return !reference.onCallDutyPolicies.includes(FOREIGN_POLICY_ID);
  });

function refusalOf(
  reference: RefusedReferenceCase,
  subject: string,
): ProjectScopedReferenceException {
  const message: string = `This ${subject} ${reference.says}`;

  return reference.refusal === "unreadable"
    ? new UnreadableReferenceException(message)
    : new ProjectScopedReferenceException(message);
}

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

  test("checks nothing as root any more: it only reads the ids a card carries", (): void => {
    expect(
      Object.getOwnPropertyNames(WorkspaceProjectReferenceValidator).filter(
        (name: string) => {
          return (
            typeof (
              WorkspaceProjectReferenceValidator as unknown as Record<
                string,
                unknown
              >
            )[name] === "function"
          );
        },
      ),
    ).toEqual(["parseCommaSeparatedIds"]);
  });
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
      databaseProps: MEMBER_PROPS,
      turnContext,
    });
  }

  let errorLog: SpyInstance<typeof logger.error>;

  beforeEach((): void => {
    // The permission to declare one is covered by the submit and authorization tests.
    jest
      .spyOn(WorkspaceActionAuthorization, "assertCanCreate")
      .mockResolvedValue();
    errorLog = jest.spyOn(logger, "error").mockImplementation((): void => {});
  });

  test("creates the incident with the member's props and every id the card carried, and hands the monitor status to IncidentService instead of writing monitors", async (): Promise<void> => {
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
        ...OWN_CHOICE,
        monitors: `${OWN_MONITOR_ID}, ${SECOND_OWN_MONITOR_ID}`,
      },
      turnContext,
    );

    expect(createSpy).toHaveBeenCalledTimes(1);
    // Never root: the create holds every id to what this member may name.
    expect(createSpy.mock.calls[0]![0].props).toBe(MEMBER_PROPS);
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

  test.each(INCIDENT_REFUSED_REFERENCES)(
    "a create that refuses $name creates nothing, and is answered without naming the record",
    async (reference: RefusedReferenceCase): Promise<void> => {
      const writes: WriteSpies = spyOnMonitorWrites();
      const refusal: ProjectScopedReferenceException = refusalOf(
        reference,
        "incident",
      );
      const createSpy: SpyInstance<typeof IncidentService.create> = jest
        .spyOn(IncidentService, "create")
        .mockRejectedValue(refusal);
      const turnContext: TurnContext = createTurnContext();

      await submit(reference, turnContext);

      // Asked once, as the member, with what the card carried.
      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(createSpy.mock.calls[0]![0].props).toBe(MEMBER_PROPS);
      expect(writes.updateOneBy).not.toHaveBeenCalled();
      expect(writes.updateOneById).not.toHaveBeenCalled();

      /*
       * One reply, and it says what to do, but not which record: the
       * create's message names it.
       */
      const messages: Array<string> = sentMessages(turnContext);
      expect(messages).toEqual([
        `❌ Could not create the incident: ${UNAVAILABLE_REFERENCE_REASON}`,
      ]);
      for (const identifying of [
        ...reference.identifying,
        FOREIGN_MONITOR_ID,
        FOREIGN_LABEL_ID,
        FOREIGN_POLICY_ID,
      ]) {
        expect(messages[0]).not.toContain(identifying);
      }

      // Which record it was is for an operator, in the log.
      expect(errorLog).toHaveBeenCalledTimes(2);
      expect(errorLog).toHaveBeenNthCalledWith(
        1,
        `Could not create an incident from Microsoft Teams: ${refusal.constructor.name}: This incident ${reference.says}`,
        { projectId: PROJECT_ID.toString() },
      );
      expect(errorLog.mock.calls[1]![0]).toBe(refusal);
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
      MEMBER_PROPS,
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

  test("creates the event with the member's props and every id the card carried, and hands the monitor status to ScheduledMaintenanceService instead of writing monitors", async (): Promise<void> => {
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

    await submit({ ...OWN_CHOICE, onCallDutyPolicies: "" }, turnContext);

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy.mock.calls[0]![0].props).toBe(MEMBER_PROPS);
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

  test.each(SCHEDULED_MAINTENANCE_REFUSED_REFERENCES)(
    "a create that refuses $name creates nothing, and is answered without naming the record",
    async (reference: RefusedReferenceCase): Promise<void> => {
      const writes: WriteSpies = spyOnMonitorWrites();
      const refusal: ProjectScopedReferenceException = refusalOf(
        reference,
        "scheduled maintenance event",
      );
      const createSpy: SpyInstance<typeof ScheduledMaintenanceService.create> =
        jest
          .spyOn(ScheduledMaintenanceService, "create")
          .mockRejectedValue(refusal);
      const turnContext: TurnContext = createTurnContext();

      await submit(reference, turnContext);

      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(createSpy.mock.calls[0]![0].props).toBe(MEMBER_PROPS);
      expect(writes.updateOneBy).not.toHaveBeenCalled();
      expect(writes.updateOneById).not.toHaveBeenCalled();

      const messages: Array<string> = sentMessages(turnContext);
      expect(messages).toEqual([
        `❌ Could not create the scheduled maintenance event: ${UNAVAILABLE_REFERENCE_REASON}`,
      ]);
      for (const identifying of [
        ...reference.identifying,
        FOREIGN_MONITOR_ID,
        FOREIGN_LABEL_ID,
      ]) {
        expect(messages[0]).not.toContain(identifying);
      }

      expect(errorLog).toHaveBeenCalledTimes(2);
      expect(errorLog).toHaveBeenNthCalledWith(
        1,
        `Could not create a scheduled maintenance event from Microsoft Teams: ${refusal.constructor.name}: This scheduled maintenance event ${reference.says}`,
        { projectId: PROJECT_ID.toString() },
      );
      expect(errorLog.mock.calls[1]![0]).toBe(refusal);
    },
  );
});

/*
 * Slack has answered the view already (response_action: clear), so a
 * refusal reaches the member in a direct message: "Could not <action>: " and
 * the create's own words, which name the id they sent - never another
 * project's record by name.
 */
function directMessageTexts(
  directMessages: SpyInstance<typeof SlackUtil.sendDirectMessageToUser>,
): Array<string> {
  return directMessages.mock.calls.map(
    (call: Parameters<typeof SlackUtil.sendDirectMessageToUser>): string => {
      const block: WorkspaceMessageBlock | undefined = call[0].messageBlocks[0];
      return (block as WorkspacePayloadMarkdown).text;
    },
  );
}

function slackRequest(viewValues: SlackRequest["viewValues"]): SlackRequest {
  return {
    isAuthorized: true,
    userId: USER_ID,
    projectId: PROJECT_ID,
    projectAuthToken: "xoxb-project",
    botUserId: "B123",
    slackUserId: "U0MEMBER",
    slackUsername: "someone",
    viewValues,
  };
}

describe("Slack: SubmitNewIncident", (): void => {
  function submit(viewValues: SlackRequest["viewValues"]): Promise<void> {
    return SlackIncidentActions.submitNewIncident({
      slackRequest: slackRequest(viewValues),
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

  let directMessages: SpyInstance<typeof SlackUtil.sendDirectMessageToUser>;

  beforeEach((): void => {
    jest.spyOn(Response, "sendJsonObjectResponse").mockImplementation(() => {});
    // Who may declare one is covered by the Slack authorization tests.
    jest
      .spyOn(SlackActionAuthorization, "authorize")
      .mockResolvedValue(MEMBER_PROPS);
    directMessages = jest
      .spyOn(SlackUtil, "sendDirectMessageToUser")
      .mockResolvedValue();
  });

  test("creates the incident with the member's props and every id the view carried", async (): Promise<void> => {
    const createSpy: SpyInstance<typeof IncidentService.create> = jest
      .spyOn(IncidentService, "create")
      .mockResolvedValue(createdIncident());

    await submit(viewValues(OWN_CHOICE));

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy.mock.calls[0]![0].props).toBe(MEMBER_PROPS);
    const incident: Incident = createSpy.mock.calls[0]![0].data;
    expect(relationIds(incident.monitors)).toEqual([
      OWN_MONITOR_ID,
      SECOND_OWN_MONITOR_ID,
    ]);
    expect(relationIds(incident.labels)).toEqual([OWN_LABEL_ID]);
    expect(relationIds(incident.onCallDutyPolicies)).toEqual([OWN_POLICY_ID]);
    // The monitor status is left to IncidentService, which checks it itself.
    expect(incident.changeMonitorStatusToId?.toString()).toBe(OWN_STATUS_ID);
    // Credited by the create, from the member's props.
    expect(incident.createdByUserId).toBeUndefined();
    expect(directMessages).not.toHaveBeenCalled();
  });

  test.each(INCIDENT_REFUSED_REFERENCES)(
    "a create that refuses $name is told to the member in a direct message, in the create's words, and nothing is thrown",
    async (reference: RefusedReferenceCase): Promise<void> => {
      const createSpy: SpyInstance<typeof IncidentService.create> = jest
        .spyOn(IncidentService, "create")
        .mockRejectedValue(refusalOf(reference, "incident"));

      await expect(submit(viewValues(reference))).resolves.toBeUndefined();

      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(createSpy.mock.calls[0]![0].props).toBe(MEMBER_PROPS);
      const texts: Array<string> = directMessageTexts(directMessages);
      expect(texts).toHaveLength(1);
      expect(texts[0]).toContain("Could not declare the incident: ");
      expect(texts[0]).toContain(
        "references records that are not in this project",
      );
      for (const identifying of reference.identifying) {
        expect(texts[0]).not.toContain(identifying);
      }
    },
  );

  test("a requester the authorization refuses creates nothing (told by the authorization itself)", async (): Promise<void> => {
    (
      SlackActionAuthorization.authorize as unknown as jest.Mock
    ).mockResolvedValue(null);
    const createSpy: SpyInstance<typeof IncidentService.create> = jest
      .spyOn(IncidentService, "create")
      .mockResolvedValue(createdIncident());

    await submit(viewValues(OWN_CHOICE));

    expect(createSpy).not.toHaveBeenCalled();
  });

  test("an unexpected failure of the create is not swallowed", async (): Promise<void> => {
    jest
      .spyOn(IncidentService, "create")
      .mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.5:5432"));

    await expect(submit(viewValues(OWN_CHOICE))).rejects.toThrow(
      "connect ECONNREFUSED 10.0.0.5:5432",
    );
    expect(directMessages).not.toHaveBeenCalled();
  });
});

describe("Slack: SubmitNewScheduledMaintenance", (): void => {
  function submit(reference: ReferenceChoice): Promise<void> {
    return SlackScheduledMaintenanceActions.submitNewScheduledMaintenance({
      slackRequest: slackRequest({
        scheduledMaintenanceTitle: "Database upgrade",
        scheduledMaintenanceDescription: "Upgrading the primary",
        startDate: "2099-01-01T10:00:00.000Z",
        endDate: "2099-01-01T11:00:00.000Z",
        scheduledMaintenanceMonitors: reference.monitors.split(","),
        monitorStatus: reference.monitorStatus,
        labels: reference.labels.split(","),
      }),
      action: {
        actionType: SlackActionType.SubmitNewScheduledMaintenance,
        actionValue: "",
      },
      req: {} as ExpressRequest,
      res: {} as ExpressResponse,
    });
  }

  let directMessages: SpyInstance<typeof SlackUtil.sendDirectMessageToUser>;

  beforeEach((): void => {
    jest.spyOn(Response, "sendJsonObjectResponse").mockImplementation(() => {});
    // Create permission is covered by the Slack authorization tests.
    jest
      .spyOn(SlackActionAuthorization, "authorize")
      .mockResolvedValue(MEMBER_PROPS);
    directMessages = jest
      .spyOn(SlackUtil, "sendDirectMessageToUser")
      .mockResolvedValue();
  });

  test("creates the event with the member's props and every id the view carried", async (): Promise<void> => {
    const createSpy: SpyInstance<typeof ScheduledMaintenanceService.create> =
      jest
        .spyOn(ScheduledMaintenanceService, "create")
        .mockResolvedValue(createdScheduledMaintenance());

    await submit({ ...OWN_CHOICE, monitors: OWN_MONITOR_ID });

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy.mock.calls[0]![0].props).toBe(MEMBER_PROPS);
    const scheduledMaintenance: ScheduledMaintenance =
      createSpy.mock.calls[0]![0].data;
    expect(relationIds(scheduledMaintenance.monitors)).toEqual([
      OWN_MONITOR_ID,
    ]);
    expect(relationIds(scheduledMaintenance.labels)).toEqual([OWN_LABEL_ID]);
    expect(scheduledMaintenance.createdByUserId).toBeUndefined();
  });

  test.each(SCHEDULED_MAINTENANCE_REFUSED_REFERENCES)(
    "a create that refuses $name is told to the member in a direct message, and nothing is thrown",
    async (reference: RefusedReferenceCase): Promise<void> => {
      const createSpy: SpyInstance<typeof ScheduledMaintenanceService.create> =
        jest
          .spyOn(ScheduledMaintenanceService, "create")
          .mockRejectedValue(
            refusalOf(reference, "scheduled maintenance event"),
          );

      await expect(submit(reference)).resolves.toBeUndefined();

      expect(createSpy).toHaveBeenCalledTimes(1);
      const texts: Array<string> = directMessageTexts(directMessages);
      expect(texts).toHaveLength(1);
      expect(texts[0]).toContain(
        "Could not create the scheduled maintenance event: ",
      );
      for (const identifying of reference.identifying) {
        expect(texts[0]).not.toContain(identifying);
      }
    },
  );
});
