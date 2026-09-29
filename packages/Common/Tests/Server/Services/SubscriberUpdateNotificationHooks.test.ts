import IncidentEpisodePublicNoteService from "../../../Server/Services/IncidentEpisodePublicNoteService";
import IncidentPublicNoteService from "../../../Server/Services/IncidentPublicNoteService";
import ScheduledMaintenancePublicNoteService from "../../../Server/Services/ScheduledMaintenancePublicNoteService";
import StatusPageAnnouncementService from "../../../Server/Services/StatusPageAnnouncementService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentEpisodePublicNote from "../../../Models/DatabaseModels/IncidentEpisodePublicNote";
import IncidentPublicNote from "../../../Models/DatabaseModels/IncidentPublicNote";
import ScheduledMaintenancePublicNote from "../../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import StatusPageAnnouncement from "../../../Models/DatabaseModels/StatusPageAnnouncement";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import SubscriberUpdateNotification from "../../../Types/StatusPage/SubscriberUpdateNotification";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Editing an announcement or a public note notifies subscribers only when the
 * edit asks for it. These tests pin the server half of that: the update
 * request's misc data props reach each service's onBeforeUpdate (through
 * updateOneById and _updateBy), the hook queues the update notification by
 * setting its status to Pending, and nothing is queued otherwise - including
 * for internal writes that skip hooks, such as the worker's own status
 * updates.
 */

interface ServiceCase {
  name: string;
  service: DatabaseService<BaseModel>;
  modelType: { new (): BaseModel };
  statusColumn: string;
  messageColumn: string;
  originalStatusColumn: string;
  contentColumn: string;
  editPermission: Permission;
  readOnlyPermission: Permission;
}

const SERVICE_CASES: Array<ServiceCase> = [
  {
    name: "StatusPageAnnouncement",
    service:
      StatusPageAnnouncementService as unknown as DatabaseService<BaseModel>,
    modelType: StatusPageAnnouncement,
    statusColumn: "subscriberNotificationStatusOnAnnouncementUpdated",
    messageColumn: "subscriberNotificationStatusMessageOnAnnouncementUpdated",
    originalStatusColumn: "subscriberNotificationStatus",
    contentColumn: "title",
    editPermission: Permission.EditStatusPageAnnouncement,
    readOnlyPermission: Permission.ReadStatusPageAnnouncement,
  },
  {
    name: "IncidentPublicNote",
    service: IncidentPublicNoteService as unknown as DatabaseService<BaseModel>,
    modelType: IncidentPublicNote,
    statusColumn: "subscriberNotificationStatusOnNoteUpdated",
    messageColumn: "subscriberNotificationStatusMessageOnNoteUpdated",
    originalStatusColumn: "subscriberNotificationStatusOnNoteCreated",
    contentColumn: "note",
    editPermission: Permission.EditIncidentPublicNote,
    readOnlyPermission: Permission.ReadIncidentPublicNote,
  },
  {
    name: "ScheduledMaintenancePublicNote",
    service:
      ScheduledMaintenancePublicNoteService as unknown as DatabaseService<BaseModel>,
    modelType: ScheduledMaintenancePublicNote,
    statusColumn: "subscriberNotificationStatusOnNoteUpdated",
    messageColumn: "subscriberNotificationStatusMessageOnNoteUpdated",
    originalStatusColumn: "subscriberNotificationStatusOnNoteCreated",
    contentColumn: "note",
    editPermission: Permission.EditScheduledMaintenancePublicNote,
    readOnlyPermission: Permission.ReadScheduledMaintenancePublicNote,
  },
  {
    name: "IncidentEpisodePublicNote",
    service:
      IncidentEpisodePublicNoteService as unknown as DatabaseService<BaseModel>,
    modelType: IncidentEpisodePublicNote,
    statusColumn: "subscriberNotificationStatusOnNoteUpdated",
    messageColumn: "subscriberNotificationStatusMessageOnNoteUpdated",
    originalStatusColumn: "subscriberNotificationStatusOnNoteCreated",
    contentColumn: "note",
    editPermission: Permission.EditIncidentEpisodePublicNote,
    readOnlyPermission: Permission.ReadIncidentEpisodePublicNote,
  },
];

const ROW_ID: ObjectID = new ObjectID("77777777-7777-4777-8777-777777777777");
const PROJECT_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);

type RunBeforeUpdateFunction = (
  serviceCase: ServiceCase,
  data: JSONObject,
  miscDataProps?: JSONObject | undefined,
) => Promise<OnUpdate<BaseModel>>;

const runBeforeUpdate: RunBeforeUpdateFunction = async (
  serviceCase: ServiceCase,
  data: JSONObject,
  miscDataProps?: JSONObject | undefined,
): Promise<OnUpdate<BaseModel>> => {
  const updateBy: UpdateBy<BaseModel> = {
    query: { _id: ROW_ID.toString() } as never,
    data: data as never,
    props: { isRoot: true },
    limit: 1,
    skip: 0,
  };

  if (miscDataProps !== undefined) {
    updateBy.miscDataProps = miscDataProps;
  }

  return await (
    serviceCase.service as unknown as {
      onBeforeUpdate: (
        updateBy: UpdateBy<BaseModel>,
      ) => Promise<OnUpdate<BaseModel>>;
    }
  ).onBeforeUpdate(updateBy);
};

describe.each(SERVICE_CASES)(
  "$name onBeforeUpdate",
  (serviceCase: ServiceCase) => {
    test("queues an update notification when the edit asks for one", async () => {
      const result: OnUpdate<BaseModel> = await runBeforeUpdate(
        serviceCase,
        { [serviceCase.contentColumn]: "Corrected text" },
        SubscriberUpdateNotification.getMiscDataProps(),
      );

      const data: JSONObject = result.updateBy.data as JSONObject;

      expect(data[serviceCase.statusColumn]).toBe(
        StatusPageSubscriberNotificationStatus.Pending,
      );
      expect(data[serviceCase.messageColumn]).toBe(
        SubscriberUpdateNotification.queuedMessage,
      );
      expect(result.carryForward).toBeNull();
    });

    test("keeps the edit itself intact", async () => {
      const result: OnUpdate<BaseModel> = await runBeforeUpdate(
        serviceCase,
        { [serviceCase.contentColumn]: "Corrected text" },
        SubscriberUpdateNotification.getMiscDataProps(),
      );

      expect(
        (result.updateBy.data as JSONObject)[serviceCase.contentColumn],
      ).toBe("Corrected text");
    });

    test("never touches the original notification's status", async () => {
      /*
       * Re-sending the "posted" notification for an edit is exactly the
       * confusing message this feature replaces.
       */
      const result: OnUpdate<BaseModel> = await runBeforeUpdate(
        serviceCase,
        { [serviceCase.contentColumn]: "Corrected text" },
        SubscriberUpdateNotification.getMiscDataProps(),
      );

      expect(
        (result.updateBy.data as JSONObject)[serviceCase.originalStatusColumn],
      ).toBeUndefined();
    });

    test.each([
      ["no misc data props", undefined],
      ["empty misc data props", {}],
      ["an explicit no", { notifySubscribersOfUpdate: false }],
      ['the string "false"', { notifySubscribersOfUpdate: "false" }],
      ["an unrelated misc data prop", { notifySubscribers: true }],
    ] as Array<[string, JSONObject | undefined]>)(
      "does not queue anything for %s",
      async (_label: string, miscDataProps: JSONObject | undefined) => {
        const result: OnUpdate<BaseModel> = await runBeforeUpdate(
          serviceCase,
          { [serviceCase.contentColumn]: "Typo fix" },
          miscDataProps,
        );

        const data: JSONObject = result.updateBy.data as JSONObject;

        expect(data[serviceCase.statusColumn]).toBeUndefined();
        expect(data[serviceCase.messageColumn]).toBeUndefined();
        expect(data).toEqual({ [serviceCase.contentColumn]: "Typo fix" });
      },
    );

    test("leaves a retry that sets the status directly alone", async () => {
      /*
       * The dashboard's retry button writes Pending straight to the column,
       * without the misc data prop. The hook must not overwrite its message.
       */
      const result: OnUpdate<BaseModel> = await runBeforeUpdate(serviceCase, {
        [serviceCase.statusColumn]:
          StatusPageSubscriberNotificationStatus.Pending,
        [serviceCase.messageColumn]:
          SubscriberUpdateNotification.resendQueuedMessage,
      });

      expect(result.updateBy.data).toEqual({
        [serviceCase.statusColumn]:
          StatusPageSubscriberNotificationStatus.Pending,
        [serviceCase.messageColumn]:
          SubscriberUpdateNotification.resendQueuedMessage,
      });
    });

    test("overrides a caller-supplied status with Pending when an update notification is asked for", async () => {
      const result: OnUpdate<BaseModel> = await runBeforeUpdate(
        serviceCase,
        {
          [serviceCase.contentColumn]: "Corrected text",
          [serviceCase.statusColumn]:
            StatusPageSubscriberNotificationStatus.Success,
        },
        SubscriberUpdateNotification.getMiscDataProps(),
      );

      expect(
        (result.updateBy.data as JSONObject)[serviceCase.statusColumn],
      ).toBe(StatusPageSubscriberNotificationStatus.Pending);
    });
  },
);

describe("StatusPageAnnouncement onBeforeUpdate keeps its existing notify toggle behaviour", () => {
  const announcementCase: ServiceCase = SERVICE_CASES[0]!;

  test("turning the create-time toggle off still skips the original notification", async () => {
    const result: OnUpdate<BaseModel> = await runBeforeUpdate(
      announcementCase,
      { shouldStatusPageSubscribersBeNotified: false },
    );

    const data: JSONObject = result.updateBy.data as JSONObject;

    expect(data["subscriberNotificationStatus"]).toBe(
      StatusPageSubscriberNotificationStatus.Skipped,
    );
    expect(
      data["subscriberNotificationStatusOnAnnouncementUpdated"],
    ).toBeUndefined();
  });

  test("the toggle and an update notification are independent of each other", async () => {
    const result: OnUpdate<BaseModel> = await runBeforeUpdate(
      announcementCase,
      { shouldStatusPageSubscribersBeNotified: true, title: "New title" },
      SubscriberUpdateNotification.getMiscDataProps(),
    );

    const data: JSONObject = result.updateBy.data as JSONObject;

    expect(data["subscriberNotificationStatus"]).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
    expect(data["subscriberNotificationStatusOnAnnouncementUpdated"]).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
  });
});

describe.each(SERVICE_CASES)(
  "$name updateOneById carries the request through to the write",
  (serviceCase: ServiceCase) => {
    let updateMock: MockFunction;

    beforeEach(() => {
      jest.restoreAllMocks();

      const foundItem: BaseModel = new serviceCase.modelType();
      foundItem._id = ROW_ID.toString();

      jest
        .spyOn(serviceCase.service as any, "_findBy")
        .mockResolvedValue([foundItem] as never);

      updateMock = getJestMockFunction();
      updateMock.mockImplementation(() => {
        return Promise.resolve({ affected: 1 });
      });

      jest
        .spyOn(serviceCase.service, "getRepository")
        .mockReturnValue({ update: updateMock, save: jest.fn() } as never);

      /*
       * The success hooks post feed items and sync image visibility; they
       * need a database and are not what these tests are about.
       */
      jest
        .spyOn(serviceCase.service as any, "onUpdateSuccess")
        .mockImplementation(((onUpdate: unknown) => {
          return Promise.resolve(onUpdate);
        }) as never);

      jest
        .spyOn(ModelPermission, "checkUpdatePermissionByModel")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(ModelPermission, "checkUpdateQueryPermissions")
        .mockImplementation(((
          _modelType: unknown,
          query: unknown,
        ): Promise<unknown> => {
          return Promise.resolve(query);
        }) as never);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    type WrittenColumnsFunction = () => JSONObject;

    const writtenColumns: WrittenColumnsFunction = (): JSONObject => {
      expect(updateMock).toHaveBeenCalledTimes(1);
      return updateMock.mock.calls[0]![1] as JSONObject;
    };

    test("writes a Pending update notification when the request asks for one", async () => {
      await serviceCase.service.updateOneById({
        id: ROW_ID,
        data: { [serviceCase.contentColumn]: "Corrected text" } as never,
        miscDataProps: SubscriberUpdateNotification.getMiscDataProps(),
        props: { isRoot: true },
      });

      const written: JSONObject = writtenColumns();

      expect(written[serviceCase.contentColumn]).toBe("Corrected text");
      expect(written[serviceCase.statusColumn]).toBe(
        StatusPageSubscriberNotificationStatus.Pending,
      );
      expect(written[serviceCase.messageColumn]).toBe(
        SubscriberUpdateNotification.queuedMessage,
      );
    });

    test("writes only the edit when the request does not ask", async () => {
      await serviceCase.service.updateOneById({
        id: ROW_ID,
        data: { [serviceCase.contentColumn]: "Typo fix" } as never,
        props: { isRoot: true },
      });

      const written: JSONObject = writtenColumns();

      expect(written[serviceCase.contentColumn]).toBe("Typo fix");
      expect(written[serviceCase.statusColumn]).toBeUndefined();
      expect(written[serviceCase.messageColumn]).toBeUndefined();
    });

    test("ignores the request on hook-free writes, like the worker's own status updates", async () => {
      await serviceCase.service.updateOneById({
        id: ROW_ID,
        data: {
          [serviceCase.statusColumn]:
            StatusPageSubscriberNotificationStatus.Success,
        } as never,
        miscDataProps: SubscriberUpdateNotification.getMiscDataProps(),
        props: { isRoot: true, ignoreHooks: true },
      });

      expect(writtenColumns()[serviceCase.statusColumn]).toBe(
        StatusPageSubscriberNotificationStatus.Success,
      );
    });

    test("hands the same misc data props to the success hook", async () => {
      await serviceCase.service.updateOneById({
        id: ROW_ID,
        data: { [serviceCase.contentColumn]: "Corrected text" } as never,
        miscDataProps: SubscriberUpdateNotification.getMiscDataProps(),
        props: { isRoot: true },
      });

      const onUpdateSuccess: jest.Mock = (
        serviceCase.service as unknown as { onUpdateSuccess: jest.Mock }
      ).onUpdateSuccess;
      const onUpdate: OnUpdate<BaseModel> = onUpdateSuccess.mock
        .calls[0]![0] as OnUpdate<BaseModel>;

      expect(onUpdate.updateBy.miscDataProps).toEqual({
        notifySubscribersOfUpdate: true,
      });
    });
  },
);

describe.each(SERVICE_CASES)(
  "$name update notification columns and access control",
  (serviceCase: ServiceCase) => {
    const propsWith: (
      permission: Permission,
    ) => DatabaseCommonInteractionProps = (
      permission: Permission,
    ): DatabaseCommonInteractionProps => {
      return {
        userId: new ObjectID("99999999-9999-4999-8999-999999999999"),
        tenantId: PROJECT_ID,
        userTenantAccessPermission: {
          [PROJECT_ID.toString()]: {
            _type: "UserTenantAccessPermission",
            projectId: PROJECT_ID,
            permissions: [
              {
                _type: "UserPermission",
                permission: permission,
                labelIds: [],
                // Allow-permissions are the ones with this explicitly false.
                isBlockPermission: false,
              },
            ],
          },
        },
      } as unknown as DatabaseCommonInteractionProps;
    };

    test("the columns exist on the model and are optional", () => {
      const model: BaseModel = new serviceCase.modelType();

      for (const column of [
        serviceCase.statusColumn,
        serviceCase.messageColumn,
      ]) {
        expect(model.getTableColumns().columns).toContain(column);
        expect(model.getTableColumnMetadata(column).required).toBeFalsy();
      }
    });

    test.each([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
    ])(
      "an editor with %s may queue an update notification through the API",
      (permission: Permission) => {
        expect(() => {
          ColumnPermissions.checkDataColumnPermissions(
            serviceCase.modelType,
            {
              [serviceCase.statusColumn]:
                StatusPageSubscriberNotificationStatus.Pending,
              [serviceCase.messageColumn]: "queued",
            } as never,
            propsWith(permission),
            DatabaseRequestType.Update,
          );
        }).not.toThrow();
      },
    );

    test("the model-specific edit permission may queue it too", () => {
      expect(() => {
        ColumnPermissions.checkDataColumnPermissions(
          serviceCase.modelType,
          {
            [serviceCase.statusColumn]:
              StatusPageSubscriberNotificationStatus.Pending,
          } as never,
          propsWith(serviceCase.editPermission),
          DatabaseRequestType.Update,
        );
      }).not.toThrow();
    });

    test("a read-only member cannot queue it", () => {
      expect(() => {
        ColumnPermissions.checkDataColumnPermissions(
          serviceCase.modelType,
          {
            [serviceCase.statusColumn]:
              StatusPageSubscriberNotificationStatus.Pending,
          } as never,
          propsWith(serviceCase.readOnlyPermission),
          DatabaseRequestType.Update,
        );
      }).toThrow(BadDataException);
    });

    test("uses the same update and read permissions as the original notification status", () => {
      const model: BaseModel = new serviceCase.modelType();
      const accessControl: ReturnType<
        BaseModel["getColumnAccessControlForAllColumns"]
      > = model.getColumnAccessControlForAllColumns();

      for (const column of [
        serviceCase.statusColumn,
        serviceCase.messageColumn,
      ]) {
        expect([...(accessControl[column]?.update || [])].sort()).toEqual(
          [
            ...(accessControl[serviceCase.originalStatusColumn]?.update || []),
          ].sort(),
        );
        expect([...(accessControl[column]?.read || [])].sort()).toEqual(
          [
            ...(accessControl[serviceCase.originalStatusColumn]?.read || []),
          ].sort(),
        );
      }
    });

    test("cannot be set when creating, since there is nothing to have updated yet", () => {
      const model: BaseModel = new serviceCase.modelType();
      const accessControl: ReturnType<
        BaseModel["getColumnAccessControlForAllColumns"]
      > = model.getColumnAccessControlForAllColumns();

      expect(accessControl[serviceCase.statusColumn]?.create).toEqual([]);
      expect(accessControl[serviceCase.messageColumn]?.create).toEqual([]);
    });
  },
);
