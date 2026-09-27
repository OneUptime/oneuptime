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
import { DiscordScheduledMaintenanceActionModule } from "../../../../Server/Utils/Workspace/Discord/Actions/ScheduledMaintenance";
import {
  DiscordActionContext,
  DiscordActionModuleRegistration,
  DiscordActionResult,
  DiscordChoicePage,
  DiscordActionRegistration,
  DiscordChoiceProviderRegistration,
} from "../../../../Server/Utils/Workspace/Discord/Actions/Types";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";

// Failure inventory precedes these cases in E2E/Discord/OPERATIONS_FAILURES.md.
const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();
const resourceId: ObjectID = ObjectID.generate();
const stateId: ObjectID = ObjectID.generate();
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

describe("maintenance mutations", (): void => {
  test.each([
    ["MarkScheduledMaintenanceAsOngoing", "markScheduledMaintenanceAsOngoing"],
    [
      "MarkScheduledMaintenanceAsComplete",
      "markScheduledMaintenanceAsComplete",
    ],
  ] as const)(
    "%s records the actor",
    async (
      action: string,
      method:
        | "markScheduledMaintenanceAsOngoing"
        | "markScheduledMaintenanceAsComplete",
    ): Promise<void> => {
      await invoke(DiscordScheduledMaintenanceActionModule, action);
      expect(ScheduledMaintenanceService[method]).toHaveBeenCalledWith(
        resourceId,
        userId,
      );
    },
  );
  test("custom state preserves fresh actor props and notification behavior", async (): Promise<void> => {
    await invoke(
      DiscordScheduledMaintenanceActionModule,
      "SubmitChangeScheduledMaintenanceState",
      { stateId: stateId.toString() },
    );
    expect(
      ScheduledMaintenanceService.changeScheduledMaintenanceState,
    ).toHaveBeenCalledWith({
      projectId,
      scheduledMaintenanceId: resourceId,
      scheduledMaintenanceStateId: stateId,
      props,
      shouldNotifyStatusPageSubscribers: true,
      isSubscribersNotified: false,
      notifyOwners: true,
    });
    expect(ScheduledMaintenanceStateService.findOneBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { _id: stateId.toString(), projectId },
        props,
      }),
    );
  });
  test.each(["private", "public"])(
    "%s note keeps destination and actor",
    async (noteType: string): Promise<void> => {
      await invoke(
        DiscordScheduledMaintenanceActionModule,
        "SubmitScheduledMaintenanceNote",
        { note: "<@everyone> incident detail", noteType },
      );
      const service:
        | typeof ScheduledMaintenancePublicNoteService
        | typeof ScheduledMaintenanceInternalNoteService =
        noteType === "public"
          ? ScheduledMaintenancePublicNoteService
          : ScheduledMaintenanceInternalNoteService;
      const other:
        | typeof ScheduledMaintenancePublicNoteService
        | typeof ScheduledMaintenanceInternalNoteService =
        noteType === "public"
          ? ScheduledMaintenanceInternalNoteService
          : ScheduledMaintenancePublicNoteService;
      expect(service.addNote).toHaveBeenCalledWith({
        projectId,
        scheduledMaintenanceId: resourceId,
        userId,
        note: "<@everyone> incident detail",
      });
      expect(other.addNote).not.toHaveBeenCalled();
    },
  );
  test.each(["", "  ", "x".repeat(4001)])(
    "rejects invalid note text",
    async (note: string): Promise<void> => {
      await expect(
        invoke(
          DiscordScheduledMaintenanceActionModule,
          "SubmitScheduledMaintenanceNote",
          { note, noteType: "private" },
        ),
      ).rejects.toThrow();
      expect(
        ScheduledMaintenanceInternalNoteService.addNote,
      ).not.toHaveBeenCalled();
    },
  );
  test("rejects unknown note visibility", async (): Promise<void> => {
    await expect(
      invoke(
        DiscordScheduledMaintenanceActionModule,
        "SubmitScheduledMaintenanceNote",
        { note: "content", noteType: "shared" },
      ),
    ).rejects.toThrow();
    expect(
      ScheduledMaintenancePublicNoteService.addNote,
    ).not.toHaveBeenCalled();
  });
  test("rejects a foreign or hidden resource before root helper", async (): Promise<void> => {
    jest.mocked(ScheduledMaintenanceService.findOneBy).mockResolvedValue(null);
    await expect(
      invoke(
        DiscordScheduledMaintenanceActionModule,
        "MarkScheduledMaintenanceAsOngoing",
      ),
    ).rejects.toThrow(NotAuthorizedException);
    expect(
      ScheduledMaintenanceService.markScheduledMaintenanceAsOngoing,
    ).not.toHaveBeenCalled();
  });
  test("rejects a foreign or hidden custom state", async (): Promise<void> => {
    jest
      .mocked(ScheduledMaintenanceStateService.findOneBy)
      .mockResolvedValue(null);
    await expect(
      invoke(
        DiscordScheduledMaintenanceActionModule,
        "SubmitChangeScheduledMaintenanceState",
        { stateId: stateId.toString() },
      ),
    ).rejects.toThrow(NotAuthorizedException);
    expect(
      ScheduledMaintenanceService.changeScheduledMaintenanceState,
    ).not.toHaveBeenCalled();
  });
  test("rejects malformed state before mutation", async (): Promise<void> => {
    await expect(
      invoke(
        DiscordScheduledMaintenanceActionModule,
        "SubmitChangeScheduledMaintenanceState",
        { stateId: "not-an-id" },
      ),
    ).rejects.toThrow();
    expect(
      ScheduledMaintenanceService.changeScheduledMaintenanceState,
    ).not.toHaveBeenCalled();
  });
  test("rejects revoked membership despite stale root context", async (): Promise<void> => {
    jest
      .mocked(WorkspaceActionAuthorization.getProjectMemberProps)
      .mockRejectedValue(new NotAuthorizedException("Membership removed"));
    await expect(
      invoke(
        DiscordScheduledMaintenanceActionModule,
        "MarkScheduledMaintenanceAsComplete",
      ),
    ).rejects.toThrow("Membership removed");
    expect(
      ScheduledMaintenanceService.markScheduledMaintenanceAsComplete,
    ).not.toHaveBeenCalled();
  });
  test("read-only permission cannot create a timeline", async (): Promise<void> => {
    jest
      .mocked(WorkspaceActionAuthorization.getProjectMemberProps)
      .mockResolvedValue({
        ...props,
        userTenantAccessPermission: {
          [projectId.toString()]: {
            _type: "UserTenantAccessPermission",
            projectId,
            permissions: [],
          },
        },
      });
    await expect(
      invoke(
        DiscordScheduledMaintenanceActionModule,
        "MarkScheduledMaintenanceAsComplete",
      ),
    ).rejects.toThrow(NotAuthorizedException);
    expect(
      ScheduledMaintenanceService.markScheduledMaintenanceAsComplete,
    ).not.toHaveBeenCalled();
  });
});

describe("native maintenance forms", (): void => {
  test("notes require explicit private or public selection", async (): Promise<void> => {
    const result: DiscordActionResult = await invoke(
      DiscordScheduledMaintenanceActionModule,
      "ViewAddScheduledMaintenanceNote",
    );
    expect(result).toMatchObject({
      kind: "modal",
      modal: {
        customId: `SubmitScheduledMaintenanceNote:${resourceId}`,
        fields: expect.arrayContaining([
          expect.objectContaining({
            customId: "noteType",
            options: [
              { label: "Private", value: "private" },
              { label: "Public", value: "public" },
            ],
          }),
        ]),
      },
    });
  });
  test("state selector uses the paginated provider", async (): Promise<void> => {
    expect(
      await invoke(
        DiscordScheduledMaintenanceActionModule,
        "ViewChangeScheduledMaintenanceState",
      ),
    ).toMatchObject({
      kind: "picker",
      picker: {
        provider: "scheduled-maintenance-states",
        submitAction: "SubmitChangeScheduledMaintenanceState",
        field: "stateId",
        resourceId,
      },
    });
  });
  test("page two remains available beyond 25 states", async (): Promise<void> => {
    const rows: Array<ScheduledMaintenanceState> = Array.from(
      { length: 26 },
      (_: unknown, index: number): ScheduledMaintenanceState => {
        const row: ScheduledMaintenanceState = new ScheduledMaintenanceState();
        row.id = ObjectID.generate();
        row.name = `State ${index}`;
        return row;
      },
    );
    jest
      .spyOn(ScheduledMaintenanceStateService, "findBy")
      .mockResolvedValueOnce(rows)
      .mockResolvedValueOnce(rows.slice(25));
    const provider: DiscordChoiceProviderRegistration =
      DiscordScheduledMaintenanceActionModule.choiceProviders![0]!;
    const first: DiscordChoicePage = await provider.getPage({
      provider: provider.name,
      resourceId,
      context,
      limit: 25,
    });
    expect(first.options).toHaveLength(25);
    expect(first.nextCursor).toBe("25");
    const second: DiscordChoicePage = await provider.getPage({
      provider: provider.name,
      resourceId,
      context,
      limit: 25,
      cursor: first.nextCursor,
    });
    expect(second.options).toEqual([
      { label: "State 25", value: rows[25]!.id!.toString() },
    ]);
    expect(ScheduledMaintenanceStateService.findBy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        query: { projectId },
        skip: 25,
        limit: 26,
        props,
      }),
    );
  });
  test.each(["-1", "NaN", "9007199254740992"])(
    "invalid cursor %s cannot query",
    async (cursor: string): Promise<void> => {
      const lookup: jest.SpyInstance = jest
        .spyOn(ScheduledMaintenanceStateService, "findBy")
        .mockResolvedValue([]);
      const provider: DiscordChoiceProviderRegistration =
        DiscordScheduledMaintenanceActionModule.choiceProviders![0]!;
      await expect(
        provider.getPage({
          provider: provider.name,
          resourceId,
          context,
          limit: 25,
          cursor,
        }),
      ).rejects.toThrow();
      expect(lookup).not.toHaveBeenCalled();
    },
  );
});
