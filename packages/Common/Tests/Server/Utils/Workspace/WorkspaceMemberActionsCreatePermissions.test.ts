import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../../Models/DatabaseModels/AlertEpisode";
import AlertEpisodeInternalNote from "../../../../Models/DatabaseModels/AlertEpisodeInternalNote";
import AlertEpisodeStateTimeline from "../../../../Models/DatabaseModels/AlertEpisodeStateTimeline";
import AlertInternalNote from "../../../../Models/DatabaseModels/AlertInternalNote";
import AlertStateTimeline from "../../../../Models/DatabaseModels/AlertStateTimeline";
import { DatabaseBaseModelType } from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeInternalNote from "../../../../Models/DatabaseModels/IncidentEpisodeInternalNote";
import IncidentEpisodePublicNote from "../../../../Models/DatabaseModels/IncidentEpisodePublicNote";
import IncidentEpisodeStateTimeline from "../../../../Models/DatabaseModels/IncidentEpisodeStateTimeline";
import IncidentInternalNote from "../../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentPublicNote from "../../../../Models/DatabaseModels/IncidentPublicNote";
import IncidentStateTimeline from "../../../../Models/DatabaseModels/IncidentStateTimeline";
import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceInternalNote from "../../../../Models/DatabaseModels/ScheduledMaintenanceInternalNote";
import ScheduledMaintenancePublicNote from "../../../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import ScheduledMaintenanceStateTimeline from "../../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import AlertEpisodeInternalNoteService from "../../../../Server/Services/AlertEpisodeInternalNoteService";
import AlertEpisodeService from "../../../../Server/Services/AlertEpisodeService";
import AlertEpisodeStateTimelineService from "../../../../Server/Services/AlertEpisodeStateTimelineService";
import AlertInternalNoteService from "../../../../Server/Services/AlertInternalNoteService";
import AlertService from "../../../../Server/Services/AlertService";
import AlertStateTimelineService from "../../../../Server/Services/AlertStateTimelineService";
import IncidentEpisodeInternalNoteService from "../../../../Server/Services/IncidentEpisodeInternalNoteService";
import IncidentEpisodePublicNoteService from "../../../../Server/Services/IncidentEpisodePublicNoteService";
import IncidentEpisodeService from "../../../../Server/Services/IncidentEpisodeService";
import IncidentEpisodeStateTimelineService from "../../../../Server/Services/IncidentEpisodeStateTimelineService";
import IncidentInternalNoteService from "../../../../Server/Services/IncidentInternalNoteService";
import IncidentPublicNoteService from "../../../../Server/Services/IncidentPublicNoteService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentStateTimelineService from "../../../../Server/Services/IncidentStateTimelineService";
import OnCallDutyPolicyExecutionLogService from "../../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import ScheduledMaintenanceInternalNoteService from "../../../../Server/Services/ScheduledMaintenanceInternalNoteService";
import ScheduledMaintenancePublicNoteService from "../../../../Server/Services/ScheduledMaintenancePublicNoteService";
import ScheduledMaintenanceService from "../../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateTimelineService from "../../../../Server/Services/ScheduledMaintenanceStateTimelineService";
import ModelPermission from "../../../../Server/Types/Database/Permissions/Index";
import WorkspaceMemberActions, {
  WorkspaceEventType,
} from "../../../../Server/Utils/Workspace/WorkspaceMemberActions";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";

/*
 * WHAT A SLACK OR MICROSOFT TEAMS BUTTON WRITES NEEDS NO MORE THAN WHAT THE
 * DASHBOARD'S SAME BUTTON NEEDS.
 *
 * Every row a chat action creates - a state timeline row, an on-call policy
 * execution log, a note (from a form or from an emoji reaction) - is built
 * here exactly as the action builds it, then put to the create checks the
 * write runs (ModelPermission.checkCreatePermissions: the table, its blocks,
 * every column the row carries) for someone holding only the permission the
 * dashboard asks for that row. Each must pass: a column the chat wrote that
 * the dashboard does not would refuse members the dashboard lets through.
 * And each must be refused for a read-only member, whose button is refused
 * the same way.
 */

type AnySpy = SpyInstance<(...args: Array<any>) => any>;

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

function propsHolding(
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
    userTenantAccessPermission: {
      [projectId.toString()]: tenantPermission,
    },
  };
}

// The record a button acts on, readable to the member.
function stubReadable(service: object, record: object): void {
  jest
    .spyOn(service as { findOneBy: () => Promise<unknown> }, "findOneBy")
    .mockResolvedValue(record);
}

// The create a write goes through, kept from writing anything.
function stubCreate(service: object): AnySpy {
  return (
    jest.spyOn(
      service as { create: () => Promise<unknown> },
      "create",
    ) as AnySpy
  ).mockImplementation(async (createBy: unknown): Promise<unknown> => {
    return (createBy as { data: unknown }).data;
  });
}

interface ChatWrite {
  name: string;
  modelType: DatabaseBaseModelType;
  // The service whose create the action writes through.
  service: object;
  // The one permission the dashboard asks for the same row.
  dashboardPermission: Permission;
  // Makes the write as the chat action makes it, with `props`.
  write: (props: DatabaseCommonInteractionProps) => Promise<unknown>;
}

// A state change of each kind of record, as WorkspaceMemberActions makes it.
function stateChange(data: {
  name: string;
  type: WorkspaceEventType;
  recordService: object;
  record: object;
  modelType: DatabaseBaseModelType;
  service: object;
  dashboardPermission: Permission;
}): ChatWrite {
  return {
    name: data.name,
    modelType: data.modelType,
    service: data.service,
    dashboardPermission: data.dashboardPermission,
    write: async (props: DatabaseCommonInteractionProps): Promise<void> => {
      stubReadable(data.recordService, data.record);

      await WorkspaceMemberActions.changeState({
        event: { type: data.type, id: ObjectID.generate() },
        stateId: ObjectID.generate(),
        props: props,
      });
    },
  };
}

// An on-call policy executed for a record, as WorkspaceMemberActions does.
function execution(data: {
  name: string;
  type: WorkspaceEventType;
  recordService: object;
  record: object;
}): ChatWrite {
  return {
    name: data.name,
    modelType: OnCallDutyPolicyExecutionLog,
    service: OnCallDutyPolicyExecutionLogService,
    dashboardPermission: Permission.CreateProjectOnCallDutyPolicyExecutionLog,
    write: async (props: DatabaseCommonInteractionProps): Promise<void> => {
      stubReadable(data.recordService, data.record);

      await WorkspaceMemberActions.executeOnCallPolicy({
        event: { type: data.type, id: ObjectID.generate() },
        onCallDutyPolicyId: ObjectID.generate(),
        props: props,
      });
    },
  };
}

/*
 * A note, as the note services' addNote writes it - from an emoji reaction
 * too, which names the message it came from.
 */
function note(data: {
  name: string;
  modelType: DatabaseBaseModelType;
  service: object;
  dashboardPermission: Permission;
  recordKey: string;
}): ChatWrite {
  return {
    name: data.name,
    modelType: data.modelType,
    service: data.service,
    dashboardPermission: data.dashboardPermission,
    write: async (props: DatabaseCommonInteractionProps): Promise<unknown> => {
      return await (
        data.service as {
          addNote: (args: Record<string, unknown>) => Promise<unknown>;
        }
      ).addNote({
        [data.recordKey]: ObjectID.generate(),
        projectId: projectId,
        note: "Restarted the primary database.",
        postedFromSlackMessageId: "C0INCIDENT:1700000000.000100",
        props: props,
      });
    },
  };
}

function inProject<T extends { projectId?: ObjectID | undefined }>(
  record: T,
): T {
  record.projectId = projectId;
  return record;
}

const CHAT_WRITES: Array<ChatWrite> = [
  stateChange({
    name: "an incident's state change",
    type: WorkspaceEventType.Incident,
    recordService: IncidentService,
    record: inProject(new Incident()),
    modelType: IncidentStateTimeline,
    service: IncidentStateTimelineService,
    dashboardPermission: Permission.CreateIncidentStateTimeline,
  }),
  stateChange({
    name: "an alert's state change",
    type: WorkspaceEventType.Alert,
    recordService: AlertService,
    record: inProject(new Alert()),
    modelType: AlertStateTimeline,
    service: AlertStateTimelineService,
    dashboardPermission: Permission.CreateAlertStateTimeline,
  }),
  stateChange({
    name: "an incident episode's state change",
    type: WorkspaceEventType.IncidentEpisode,
    recordService: IncidentEpisodeService,
    record: inProject(new IncidentEpisode()),
    modelType: IncidentEpisodeStateTimeline,
    service: IncidentEpisodeStateTimelineService,
    dashboardPermission: Permission.CreateIncidentEpisodeStateTimeline,
  }),
  stateChange({
    name: "an alert episode's state change",
    type: WorkspaceEventType.AlertEpisode,
    recordService: AlertEpisodeService,
    record: inProject(new AlertEpisode()),
    modelType: AlertEpisodeStateTimeline,
    service: AlertEpisodeStateTimelineService,
    dashboardPermission: Permission.CreateAlertEpisodeStateTimeline,
  }),
  stateChange({
    name: "a scheduled maintenance event's state change",
    type: WorkspaceEventType.ScheduledMaintenance,
    recordService: ScheduledMaintenanceService,
    record: inProject(new ScheduledMaintenance()),
    modelType: ScheduledMaintenanceStateTimeline,
    service: ScheduledMaintenanceStateTimelineService,
    dashboardPermission: Permission.CreateScheduledMaintenanceStateTimeline,
  }),
  execution({
    name: "an on-call policy executed for an incident",
    type: WorkspaceEventType.Incident,
    recordService: IncidentService,
    record: inProject(new Incident()),
  }),
  execution({
    name: "an on-call policy executed for an alert",
    type: WorkspaceEventType.Alert,
    recordService: AlertService,
    record: inProject(new Alert()),
  }),
  execution({
    name: "an on-call policy executed for an incident episode",
    type: WorkspaceEventType.IncidentEpisode,
    recordService: IncidentEpisodeService,
    record: inProject(new IncidentEpisode()),
  }),
  execution({
    name: "an on-call policy executed for an alert episode",
    type: WorkspaceEventType.AlertEpisode,
    recordService: AlertEpisodeService,
    record: inProject(new AlertEpisode()),
  }),
  note({
    name: "a public incident note",
    modelType: IncidentPublicNote,
    service: IncidentPublicNoteService,
    dashboardPermission: Permission.CreateIncidentPublicNote,
    recordKey: "incidentId",
  }),
  note({
    name: "a private incident note",
    modelType: IncidentInternalNote,
    service: IncidentInternalNoteService,
    dashboardPermission: Permission.CreateIncidentInternalNote,
    recordKey: "incidentId",
  }),
  note({
    name: "a private alert note",
    modelType: AlertInternalNote,
    service: AlertInternalNoteService,
    dashboardPermission: Permission.CreateAlertInternalNote,
    recordKey: "alertId",
  }),
  note({
    name: "a public incident episode note",
    modelType: IncidentEpisodePublicNote,
    service: IncidentEpisodePublicNoteService,
    dashboardPermission: Permission.CreateIncidentEpisodePublicNote,
    recordKey: "incidentEpisodeId",
  }),
  note({
    name: "a private incident episode note",
    modelType: IncidentEpisodeInternalNote,
    service: IncidentEpisodeInternalNoteService,
    dashboardPermission: Permission.CreateIncidentEpisodeInternalNote,
    recordKey: "incidentEpisodeId",
  }),
  note({
    name: "a private alert episode note",
    modelType: AlertEpisodeInternalNote,
    service: AlertEpisodeInternalNoteService,
    dashboardPermission: Permission.CreateAlertEpisodeInternalNote,
    recordKey: "alertEpisodeId",
  }),
  note({
    name: "a public scheduled maintenance note",
    modelType: ScheduledMaintenancePublicNote,
    service: ScheduledMaintenancePublicNoteService,
    dashboardPermission: Permission.CreateScheduledMaintenancePublicNote,
    recordKey: "scheduledMaintenanceId",
  }),
  note({
    name: "a private scheduled maintenance note",
    modelType: ScheduledMaintenanceInternalNote,
    service: ScheduledMaintenanceInternalNoteService,
    dashboardPermission: Permission.CreateScheduledMaintenanceInternalNote,
    recordKey: "scheduledMaintenanceId",
  }),
];

// The row the write handed its create, and the props it handed with it.
async function rowWritten(
  chatWrite: ChatWrite,
  props: DatabaseCommonInteractionProps,
): Promise<{ data: any; props: DatabaseCommonInteractionProps }> {
  const createSpy: AnySpy = stubCreate(chatWrite.service);

  await chatWrite.write(props);

  expect(createSpy).toHaveBeenCalledTimes(1);
  return createSpy.mock.calls[0]![0];
}

afterEach((): void => {
  jest.restoreAllMocks();
});

describe("the rows Slack and Microsoft Teams buttons write", (): void => {
  test.each(CHAT_WRITES)(
    "$name is written with the member's props, and passes the create checks with only the dashboard's permission",
    async (chatWrite: ChatWrite): Promise<void> => {
      const props: DatabaseCommonInteractionProps = propsHolding([
        chatWrite.dashboardPermission,
      ]);

      const written: { data: any; props: DatabaseCommonInteractionProps } =
        await rowWritten(chatWrite, props);

      expect(written.props).toBe(props);
      expect(written.data).toBeInstanceOf(chatWrite.modelType);
      expect(written.data.projectId?.toString()).toBe(projectId.toString());
      expect((): void => {
        ModelPermission.checkCreatePermissions(
          chatWrite.modelType,
          written.data,
          written.props,
        );
      }).not.toThrow();
    },
  );

  test.each(CHAT_WRITES)(
    "$name is refused by the create checks for a read-only member",
    async (chatWrite: ChatWrite): Promise<void> => {
      const props: DatabaseCommonInteractionProps = propsHolding([
        Permission.Viewer,
      ]);

      const written: { data: any; props: DatabaseCommonInteractionProps } =
        await rowWritten(chatWrite, props);

      expect((): void => {
        ModelPermission.checkCreatePermissions(
          chatWrite.modelType,
          written.data,
          written.props,
        );
      }).toThrow(NotAuthorizedException);
    },
  );

  test.each(CHAT_WRITES)(
    "$name carries no column of OneUptime's own - creator, timestamps, ids",
    async (chatWrite: ChatWrite): Promise<void> => {
      const written: { data: any; props: DatabaseCommonInteractionProps } =
        await rowWritten(
          chatWrite,
          propsHolding([chatWrite.dashboardPermission]),
        );

      for (const column of [
        "_id",
        "createdByUserId",
        "createdByUser",
        "deletedByUserId",
        "createdAt",
        "updatedAt",
      ]) {
        expect(written.data[column]).toBeUndefined();
      }
    },
  );
});
