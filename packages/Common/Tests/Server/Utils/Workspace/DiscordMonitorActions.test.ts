import Monitor from "../../../../Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../../../Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceInternalNote from "../../../../Models/DatabaseModels/ScheduledMaintenanceInternalNote";
import ScheduledMaintenancePublicNote from "../../../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import MonitorService from "../../../../Server/Services/MonitorService";
import ScheduledMaintenanceService from "../../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "../../../../Server/Services/ScheduledMaintenanceStateService";
import ScheduledMaintenanceInternalNoteService from "../../../../Server/Services/ScheduledMaintenanceInternalNoteService";
import ScheduledMaintenancePublicNoteService from "../../../../Server/Services/ScheduledMaintenancePublicNoteService";
import WorkspaceActionAuthorization from "../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import { DiscordMonitorActionModule } from "../../../../Server/Utils/Workspace/Discord/Actions/Monitor";
import {
  DiscordActionContext,
  DiscordActionModuleRegistration,
  DiscordActionResult,
  DiscordActionRegistration,
} from "../../../../Server/Utils/Workspace/Discord/Actions/Types";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";

// Failure inventory precedes these cases in E2E/Discord/OPERATIONS_FAILURES.md.
const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();
const resourceId: ObjectID = ObjectID.generate();
const props: DatabaseCommonInteractionProps = {
  userId,
  tenantId: projectId,
  userTeamIds: [],
  userTenantAccessPermission: {
    [projectId.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId,
      permissions: [
        {
          _type: "UserPermission",
          permission: Permission.ProjectOwner,
          isBlockPermission: false,
          labelIds: [],
        },
      ],
    },
  },
};
const context: DiscordActionContext = {
  projectId,
  userId,
  props: { isRoot: true },
  guildId: "123456789012345678",
  discordUserId: "123456789012345679",
};

async function invoke(
  module: DiscordActionModuleRegistration,
  action: string,
  values: Record<string, string> = {},
  id: ObjectID | undefined = resourceId,
): Promise<DiscordActionResult> {
  const handler: DiscordActionRegistration | undefined = module.handlers.find(
    (entry: DiscordActionRegistration): boolean => {
      return entry.actions.includes(action);
    },
  );
  expect(handler).toBeDefined();
  return handler!.handle({ action, resourceId: id, context, values });
}

beforeEach((): void => {
  jest
    .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
    .mockResolvedValue(props);
  jest
    .spyOn(ScheduledMaintenanceService, "findOneBy")
    .mockResolvedValue(new ScheduledMaintenance());
  jest
    .spyOn(ScheduledMaintenanceStateService, "findOneBy")
    .mockResolvedValue(new ScheduledMaintenanceState());
  jest
    .spyOn(ScheduledMaintenanceService, "markScheduledMaintenanceAsOngoing")
    .mockResolvedValue(new ScheduledMaintenance());
  jest
    .spyOn(ScheduledMaintenanceService, "markScheduledMaintenanceAsComplete")
    .mockResolvedValue(new ScheduledMaintenance());
  jest
    .spyOn(ScheduledMaintenanceService, "changeScheduledMaintenanceState")
    .mockResolvedValue();
  jest
    .spyOn(ScheduledMaintenanceInternalNoteService, "addNote")
    .mockResolvedValue(new ScheduledMaintenanceInternalNote());
  jest
    .spyOn(ScheduledMaintenancePublicNoteService, "addNote")
    .mockResolvedValue(new ScheduledMaintenancePublicNote());
  jest.spyOn(MonitorService, "findOneBy").mockResolvedValue(new Monitor());
  jest.spyOn(MonitorService, "updateOneBy").mockResolvedValue(1);
});
afterEach((): void => {
  jest.restoreAllMocks();
});

describe("monitor controls", (): void => {
  test.each([
    ["EnableMonitor", false],
    ["DisableMonitor", true],
  ] as const)(
    "%s uses fresh scoped update props",
    async (action: string, disabled: boolean): Promise<void> => {
      await invoke(DiscordMonitorActionModule, action);
      expect(MonitorService.updateOneBy).toHaveBeenCalledWith({
        query: { _id: resourceId.toString(), projectId },
        data: { disableActiveMonitoring: disabled },
        props,
      });
    },
  );
  test("zero matched rows is a refusal", async (): Promise<void> => {
    jest.mocked(MonitorService.updateOneBy).mockResolvedValue(0);
    await expect(
      invoke(DiscordMonitorActionModule, "DisableMonitor"),
    ).rejects.toThrow(NotAuthorizedException);
  });
  test("database rejection is not success", async (): Promise<void> => {
    jest
      .mocked(MonitorService.updateOneBy)
      .mockRejectedValue(new Error("Storage failed"));
    await expect(
      invoke(DiscordMonitorActionModule, "DisableMonitor"),
    ).rejects.toThrow("Storage failed");
  });
  test("revoked member cannot update", async (): Promise<void> => {
    jest
      .mocked(WorkspaceActionAuthorization.getProjectMemberProps)
      .mockRejectedValue(new NotAuthorizedException("Removed"));
    await expect(
      invoke(DiscordMonitorActionModule, "EnableMonitor"),
    ).rejects.toThrow("Removed");
    expect(MonitorService.updateOneBy).not.toHaveBeenCalled();
  });
});
