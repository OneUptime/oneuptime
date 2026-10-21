import IncidentEpisodePublicNoteService from "../../../Server/Services/IncidentEpisodePublicNoteService";
import IncidentPublicNoteService from "../../../Server/Services/IncidentPublicNoteService";
import ScheduledMaintenancePublicNoteService from "../../../Server/Services/ScheduledMaintenancePublicNoteService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import AuditLogService from "../../../Server/Services/AuditLogService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import BasePermission from "../../../Server/Types/Database/Permissions/BasePermission";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import SubscriberNotificationResendAccess from "../../../Server/Utils/StatusPage/SubscriberNotificationResendAccess";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisodePublicNote from "../../../Models/DatabaseModels/IncidentEpisodePublicNote";
import IncidentPublicNote from "../../../Models/DatabaseModels/IncidentPublicNote";
import ScheduledMaintenancePublicNote from "../../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import SubscriberNotificationResend from "../../../Types/StatusPage/SubscriberNotificationResend";
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
import {
  RowsCallerMayWriteRead,
  readsOfRowsCallerMayWrite,
  stubRowsCallerMayWrite,
} from "../TestingUtils/RowsCallerMayWrite";
import { idsNamedBy } from "../TestingUtils/QueryConditions";

/*
 * Sending a public note's 'posted' notification again - Retry after a
 * failure, and Resend after a success on the incident's notes - is an update
 * that writes Pending back into subscriberNotificationStatusOnNoteCreated.
 * These tests pin the server half, for the incident, incident episode and
 * scheduled maintenance public notes that share the dashboard's notes feed:
 *
 *   - it needs the permission to post a note that notifies subscribers as
 *     well as the note's edit permission, so a role that could not post the
 *     note cannot send it again, and a role that can only read notes cannot
 *     either;
 *   - permissions are checked before the note is read, so a refused caller
 *     never learns what state its notification is in;
 *   - a note posted without notifying subscribers (which the job never sends,
 *     so it would sit in Pending forever) and a notification being sent right
 *     now are refused, with the reason;
 *   - the notes are read with the caller's own permissions and the update's
 *     own query;
 *   - root (the workers) is never checked, and nothing else is looked at.
 */

interface ServiceCase {
  name: string;
  service: DatabaseService<BaseModel>;
  modelType: { new (): BaseModel };
  // A role that may post and edit the note.
  memberRole: Permission;
  // A role that may only read notes.
  viewerRole: Permission;
  createPermission: Permission;
  editPermission: Permission;
  readPermission: Permission;
}

const SERVICE_CASES: Array<ServiceCase> = [
  {
    name: "IncidentPublicNote",
    service: IncidentPublicNoteService as unknown as DatabaseService<BaseModel>,
    modelType: IncidentPublicNote,
    memberRole: Permission.IncidentMember,
    viewerRole: Permission.IncidentViewer,
    createPermission: Permission.CreateIncidentPublicNote,
    editPermission: Permission.EditIncidentPublicNote,
    readPermission: Permission.ReadIncidentPublicNote,
  },
  {
    name: "IncidentEpisodePublicNote",
    service:
      IncidentEpisodePublicNoteService as unknown as DatabaseService<BaseModel>,
    modelType: IncidentEpisodePublicNote,
    memberRole: Permission.IncidentMember,
    viewerRole: Permission.IncidentViewer,
    createPermission: Permission.CreateIncidentEpisodePublicNote,
    editPermission: Permission.EditIncidentEpisodePublicNote,
    readPermission: Permission.ReadIncidentEpisodePublicNote,
  },
  {
    name: "ScheduledMaintenancePublicNote",
    service:
      ScheduledMaintenancePublicNoteService as unknown as DatabaseService<BaseModel>,
    modelType: ScheduledMaintenancePublicNote,
    memberRole: Permission.ScheduledMaintenanceMember,
    viewerRole: Permission.ScheduledMaintenanceViewer,
    createPermission: Permission.CreateScheduledMaintenancePublicNote,
    editPermission: Permission.EditScheduledMaintenancePublicNote,
    readPermission: Permission.ReadScheduledMaintenancePublicNote,
  },
];

const PROJECT_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);
const USER_ID: ObjectID = new ObjectID("99999999-9999-4999-8999-999999999999");
const NOTE_ID: string = "77777777-7777-4777-8777-777777777777";
const OTHER_NOTE_ID: string = "77777777-7777-4777-8777-777777777778";

function makeProps(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId: PROJECT_ID,
    _type: "UserTenantAccessPermission",
    permissions: permissions.map((permission: Permission) => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
  };

  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenantPermission,
    },
  };
}

function storedNote(
  serviceCase: ServiceCase,
  overrides: JSONObject = {},
): BaseModel {
  const note: BaseModel = new serviceCase.modelType();
  note._id = NOTE_ID;
  Object.assign(note, {
    subscriberNotificationStatusOnNoteCreated:
      StatusPageSubscriberNotificationStatus.Success,
    shouldStatusPageSubscribersBeNotifiedOnNoteCreated: true,
    ...overrides,
  });
  return note;
}

const RESEND: JSONObject = {
  subscriberNotificationStatusOnNoteCreated:
    StatusPageSubscriberNotificationStatus.Pending,
  subscriberNotificationStatusMessage: null,
};

let storedNotes: Array<BaseModel> = [];
let noteFindBy: MockFunction;

function update(data: {
  props: DatabaseCommonInteractionProps;
  data?: JSONObject;
  miscDataProps?: JSONObject;
  query?: JSONObject;
}): UpdateBy<BaseModel> {
  return {
    query: (data.query || { _id: NOTE_ID }) as never,
    data: (data.data || { ...RESEND }) as never,
    props: data.props,
    miscDataProps: data.miscDataProps,
    limit: 1,
    skip: 0,
  };
}

async function runBeforeUpdate(
  serviceCase: ServiceCase,
  updateBy: UpdateBy<BaseModel>,
): Promise<OnUpdate<BaseModel>> {
  return await (
    serviceCase.service as unknown as {
      onBeforeUpdate: (
        updateBy: UpdateBy<BaseModel>,
      ) => Promise<OnUpdate<BaseModel>>;
    }
  ).onBeforeUpdate(updateBy);
}

describe.each(SERVICE_CASES)(
  "$name: sending the posted notification again",
  (serviceCase: ServiceCase) => {
    beforeEach(() => {
      storedNotes = [storedNote(serviceCase)];

      noteFindBy = getJestMockFunction();
      noteFindBy.mockImplementation(() => {
        return Promise.resolve(storedNotes);
      });
      jest
        .spyOn(serviceCase.service, "findBy")
        .mockImplementation(noteFindBy as never);
      // The notes a teammate's update may write: the stored ones.
      stubRowsCallerMayWrite(serviceCase.service as never, () => {
        return storedNotes;
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test.each([
      StatusPageSubscriberNotificationStatus.Success,
      StatusPageSubscriberNotificationStatus.Failed,
    ])(
      "a member may send a %s notification again, and the update goes through as written",
      async (status: StatusPageSubscriberNotificationStatus) => {
        storedNotes = [
          storedNote(serviceCase, {
            subscriberNotificationStatusOnNoteCreated: status,
          }),
        ];

        const result: OnUpdate<BaseModel> = await runBeforeUpdate(
          serviceCase,
          update({ props: makeProps([serviceCase.memberRole]) }),
        );

        expect(result.updateBy.data).toEqual(RESEND);
      },
    );

    test("reads the notes the caller's update may write, and holds the update to them", async () => {
      const props: DatabaseCommonInteractionProps = makeProps([
        serviceCase.memberRole,
      ]);
      const updateBy: UpdateBy<BaseModel> = update({ props });

      await runBeforeUpdate(serviceCase, updateBy);

      // The notes the caller may write: by the update's query, in their project.
      const reads: Array<RowsCallerMayWriteRead> = readsOfRowsCallerMayWrite(
        serviceCase.service as never,
      );
      expect(reads).toHaveLength(1);
      expect(reads[0]!.query["_id"]).toBe(NOTE_ID);
      expect(reads[0]!.query["projectId"]).toEqual(PROJECT_ID);

      // Those notes, read again by id with what the check needs.
      expect(noteFindBy).toHaveBeenCalledTimes(1);

      const findBy: {
        query: JSONObject;
        select: JSONObject;
        props: DatabaseCommonInteractionProps;
      } = noteFindBy.mock.calls[0]![0] as {
        query: JSONObject;
        select: JSONObject;
        props: DatabaseCommonInteractionProps;
      };

      expect(findBy.query).toEqual({ _id: NOTE_ID });
      expect(findBy.props).toEqual({ isRoot: true, ignoreHooks: true });
      expect(findBy.select).toEqual({
        _id: true,
        subscriberNotificationStatusOnNoteCreated: true,
        shouldStatusPageSubscribersBeNotifiedOnNoteCreated: true,
      });

      // The update writes only the notes checked.
      expect((updateBy.query as JSONObject)["_id"]).toBe(NOTE_ID);
      expect(updateBy.limit).toBe(1);
    });

    test("a note outside the caller's reach is neither checked nor written", async () => {
      stubRowsCallerMayWrite(serviceCase.service as never, () => {
        return [];
      });
      storedNotes = [
        storedNote(serviceCase, {
          shouldStatusPageSubscribersBeNotifiedOnNoteCreated: false,
        }),
      ];
      const updateBy: UpdateBy<BaseModel> = update({
        props: makeProps([serviceCase.memberRole]),
      });

      await expect(
        runBeforeUpdate(serviceCase, updateBy),
      ).resolves.toBeDefined();

      // Nothing read about it, and the update names no note.
      expect(noteFindBy).not.toHaveBeenCalled();
      expect(idsNamedBy((updateBy.query as JSONObject)["_id"])).toEqual([]);
    });

    test("a note posted without notifying subscribers is refused, with the reason", async () => {
      storedNotes = [
        storedNote(serviceCase, {
          subscriberNotificationStatusOnNoteCreated:
            StatusPageSubscriberNotificationStatus.Skipped,
          shouldStatusPageSubscribersBeNotifiedOnNoteCreated: false,
        }),
      ];

      await expect(
        runBeforeUpdate(
          serviceCase,
          update({ props: makeProps([serviceCase.memberRole]) }),
        ),
      ).rejects.toThrow(
        new BadDataException(
          SubscriberNotificationResend.notePostedWithoutNotifyingMessage,
        ),
      );
    });

    test("a notification being sent right now is refused: its send would overwrite the request", async () => {
      storedNotes = [
        storedNote(serviceCase, {
          subscriberNotificationStatusOnNoteCreated:
            StatusPageSubscriberNotificationStatus.InProgress,
        }),
      ];

      await expect(
        runBeforeUpdate(
          serviceCase,
          update({ props: makeProps([serviceCase.memberRole]) }),
        ),
      ).rejects.toThrow(SubscriberNotificationResend.beingSentMessage);
    });

    test("a bulk resend is refused when any matched note cannot be sent again", async () => {
      const quiet: BaseModel = storedNote(serviceCase, {
        shouldStatusPageSubscribersBeNotifiedOnNoteCreated: false,
      });
      quiet._id = OTHER_NOTE_ID;
      storedNotes = [storedNote(serviceCase), quiet];

      await expect(
        runBeforeUpdate(
          serviceCase,
          update({
            props: makeProps([serviceCase.memberRole]),
            query: { projectId: PROJECT_ID.toString() },
          }),
        ),
      ).rejects.toThrow(
        SubscriberNotificationResend.notePostedWithoutNotifyingMessage,
      );
    });

    test("a role that can only read notes may not, and learns nothing about the note", async () => {
      storedNotes = [
        storedNote(serviceCase, {
          shouldStatusPageSubscribersBeNotifiedOnNoteCreated: false,
        }),
      ];

      await expect(
        runBeforeUpdate(
          serviceCase,
          update({
            props: makeProps([
              serviceCase.viewerRole,
              serviceCase.readPermission,
            ]),
          }),
        ),
      ).rejects.toThrow(
        new NotAuthorizedException(
          SubscriberNotificationResend.noPermissionToResendNoteMessage,
        ),
      );
      expect(noteFindBy).not.toHaveBeenCalled();
    });

    test("a role that may edit notes but could not post one may not", async () => {
      await expect(
        runBeforeUpdate(
          serviceCase,
          update({
            props: makeProps([
              serviceCase.editPermission,
              serviceCase.readPermission,
            ]),
          }),
        ),
      ).rejects.toThrow(
        SubscriberNotificationResend.noPermissionToResendNoteMessage,
      );
      expect(noteFindBy).not.toHaveBeenCalled();
    });

    test("a role that may post notes but not edit them may not", async () => {
      await expect(
        runBeforeUpdate(
          serviceCase,
          update({
            props: makeProps([
              serviceCase.createPermission,
              serviceCase.readPermission,
            ]),
          }),
        ),
      ).rejects.toThrow(
        SubscriberNotificationResend.noPermissionToResendNoteMessage,
      );
      expect(noteFindBy).not.toHaveBeenCalled();
    });

    test("a custom role that may post and edit notes may", async () => {
      await expect(
        runBeforeUpdate(
          serviceCase,
          update({
            props: makeProps([
              serviceCase.createPermission,
              serviceCase.editPermission,
              serviceCase.readPermission,
            ]),
          }),
        ),
      ).resolves.toBeDefined();
    });

    test("a master admin skips the permission checks, not the checks on the note", async () => {
      storedNotes = [
        storedNote(serviceCase, {
          shouldStatusPageSubscribersBeNotifiedOnNoteCreated: false,
        }),
      ];

      await expect(
        runBeforeUpdate(
          serviceCase,
          update({ props: { userId: USER_ID, isMasterAdmin: true } }),
        ),
      ).rejects.toThrow(
        SubscriberNotificationResend.notePostedWithoutNotifyingMessage,
      );
    });

    test("root - the workers - is never checked, and nothing is read", async () => {
      storedNotes = [
        storedNote(serviceCase, {
          shouldStatusPageSubscribersBeNotifiedOnNoteCreated: false,
        }),
      ];

      await runBeforeUpdate(serviceCase, update({ props: { isRoot: true } }));

      expect(noteFindBy).not.toHaveBeenCalled();
    });

    test("an edit that does not send it again is not looked at", async () => {
      await runBeforeUpdate(
        serviceCase,
        update({
          props: makeProps([serviceCase.viewerRole]),
          data: { note: "Typo fixed." },
        }),
      );

      expect(noteFindBy).not.toHaveBeenCalled();
    });

    test("retrying the update notification needs the permission to post notifying notes too", async () => {
      await expect(
        runBeforeUpdate(
          serviceCase,
          update({
            props: makeProps([
              serviceCase.editPermission,
              serviceCase.readPermission,
            ]),
            data: {
              subscriberNotificationStatusOnNoteUpdated:
                StatusPageSubscriberNotificationStatus.Pending,
              subscriberNotificationStatusMessageOnNoteUpdated:
                SubscriberUpdateNotification.resendQueuedMessage,
            },
          }),
        ),
      ).rejects.toThrow(
        new NotAuthorizedException(
          SubscriberNotificationResend.noPermissionToNotifyAboutEditMessage,
        ),
      );
      expect(noteFindBy).not.toHaveBeenCalled();
    });
  },
);

/*
 * Telling subscribers about an edit - the edit carries the notify-on-edit
 * request (SubscriberUpdateNotification), or writes Pending into the note's
 * 'updated' status, as the dashboard's Retry of a failed update does - tells
 * every subscriber what the note says now. An editor can change the text
 * first, so it needs the permission to post a note that notifies
 * subscribers, as sending the 'posted' notification again does; and it is
 * refused while that update notification is being sent, whose send would
 * otherwise run alongside a second one or overwrite the request.
 */
describe.each(SERVICE_CASES)(
  "$name: telling subscribers about an edit",
  (serviceCase: ServiceCase) => {
    const NOTIFY_ON_EDIT: JSONObject =
      SubscriberUpdateNotification.getMiscDataProps();
    const EDIT: JSONObject = { note: "The fix is rolling out, ETA 14:00 UTC." };

    beforeEach(() => {
      storedNotes = [storedNote(serviceCase)];

      noteFindBy = getJestMockFunction();
      noteFindBy.mockImplementation(() => {
        return Promise.resolve(storedNotes);
      });
      jest
        .spyOn(serviceCase.service, "findBy")
        .mockImplementation(noteFindBy as never);
      // The notes a teammate's update may write: the stored ones.
      stubRowsCallerMayWrite(serviceCase.service as never, () => {
        return storedNotes;
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test("a member may, and the update notification is queued with the edit", async () => {
      const result: OnUpdate<BaseModel> = await runBeforeUpdate(
        serviceCase,
        update({
          props: makeProps([serviceCase.memberRole]),
          data: { ...EDIT },
          miscDataProps: NOTIFY_ON_EDIT,
        }),
      );

      expect(result.updateBy.data).toEqual({
        ...EDIT,
        subscriberNotificationStatusOnNoteUpdated:
          StatusPageSubscriberNotificationStatus.Pending,
        subscriberNotificationStatusMessageOnNoteUpdated:
          SubscriberUpdateNotification.queuedMessage,
      });
    });

    test("reads the update notification's state of the notes the caller's update may write, and holds the update to them", async () => {
      const props: DatabaseCommonInteractionProps = makeProps([
        serviceCase.memberRole,
      ]);
      const updateBy: UpdateBy<BaseModel> = update({
        props,
        data: { ...EDIT },
        miscDataProps: NOTIFY_ON_EDIT,
      });

      await runBeforeUpdate(serviceCase, updateBy);

      const reads: Array<RowsCallerMayWriteRead> = readsOfRowsCallerMayWrite(
        serviceCase.service as never,
      );
      expect(reads).toHaveLength(1);
      expect(reads[0]!.query["projectId"]).toEqual(PROJECT_ID);

      expect(noteFindBy).toHaveBeenCalledTimes(1);
      const findBy: {
        query: JSONObject;
        select: JSONObject;
        props: DatabaseCommonInteractionProps;
      } = noteFindBy.mock.calls[0]![0] as {
        query: JSONObject;
        select: JSONObject;
        props: DatabaseCommonInteractionProps;
      };
      expect(findBy.query).toEqual({ _id: NOTE_ID });
      expect(findBy.props).toEqual({ isRoot: true, ignoreHooks: true });
      expect(findBy.select).toEqual({
        _id: true,
        subscriberNotificationStatusOnNoteUpdated: true,
      });
      expect((updateBy.query as JSONObject)["_id"]).toBe(NOTE_ID);
    });

    test("a role that may edit notes but could not post one may not, and learns nothing about the note", async () => {
      await expect(
        runBeforeUpdate(
          serviceCase,
          update({
            props: makeProps([
              serviceCase.editPermission,
              serviceCase.readPermission,
            ]),
            data: { ...EDIT },
            miscDataProps: NOTIFY_ON_EDIT,
          }),
        ),
      ).rejects.toThrow(
        new NotAuthorizedException(
          SubscriberNotificationResend.noPermissionToNotifyAboutEditMessage,
        ),
      );
      expect(noteFindBy).not.toHaveBeenCalled();
    });

    test("that role may still save the edit without notifying subscribers", async () => {
      const result: OnUpdate<BaseModel> = await runBeforeUpdate(
        serviceCase,
        update({
          props: makeProps([
            serviceCase.editPermission,
            serviceCase.readPermission,
          ]),
          data: { ...EDIT },
        }),
      );

      expect(result.updateBy.data).toEqual(EDIT);
      expect(noteFindBy).not.toHaveBeenCalled();
    });

    test("a custom role that may post and edit notes may", async () => {
      await expect(
        runBeforeUpdate(
          serviceCase,
          update({
            props: makeProps([
              serviceCase.createPermission,
              serviceCase.editPermission,
              serviceCase.readPermission,
            ]),
            data: { ...EDIT },
            miscDataProps: NOTIFY_ON_EDIT,
          }),
        ),
      ).resolves.toBeDefined();
    });

    test("is refused, with the reason, while the update notification is being sent", async () => {
      storedNotes = [
        storedNote(serviceCase, {
          subscriberNotificationStatusOnNoteUpdated:
            StatusPageSubscriberNotificationStatus.InProgress,
        }),
      ];

      await expect(
        runBeforeUpdate(
          serviceCase,
          update({
            props: makeProps([serviceCase.memberRole]),
            data: { ...EDIT },
            miscDataProps: NOTIFY_ON_EDIT,
          }),
        ),
      ).rejects.toThrow(
        new BadDataException(
          SubscriberNotificationResend.updateBeingSentMessage,
        ),
      );
    });

    test("a Retry written straight into the column is refused while it is being sent too", async () => {
      storedNotes = [
        storedNote(serviceCase, {
          subscriberNotificationStatusOnNoteUpdated:
            StatusPageSubscriberNotificationStatus.InProgress,
        }),
      ];

      await expect(
        runBeforeUpdate(
          serviceCase,
          update({
            props: makeProps([serviceCase.memberRole]),
            data: {
              subscriberNotificationStatusOnNoteUpdated:
                StatusPageSubscriberNotificationStatus.Pending,
            },
          }),
        ),
      ).rejects.toThrow(SubscriberNotificationResend.updateBeingSentMessage);
    });

    test.each([
      StatusPageSubscriberNotificationStatus.Pending,
      StatusPageSubscriberNotificationStatus.Success,
      StatusPageSubscriberNotificationStatus.Failed,
      StatusPageSubscriberNotificationStatus.Skipped,
    ])(
      "is let through when the update notification is %s",
      async (status: StatusPageSubscriberNotificationStatus) => {
        storedNotes = [
          storedNote(serviceCase, {
            subscriberNotificationStatusOnNoteUpdated: status,
          }),
        ];

        await expect(
          runBeforeUpdate(
            serviceCase,
            update({
              props: makeProps([serviceCase.memberRole]),
              data: { ...EDIT },
              miscDataProps: NOTIFY_ON_EDIT,
            }),
          ),
        ).resolves.toBeDefined();
      },
    );

    test("the 'posted' notification being sent does not stop an edit that notifies: the update waits for it", async () => {
      storedNotes = [
        storedNote(serviceCase, {
          subscriberNotificationStatusOnNoteCreated:
            StatusPageSubscriberNotificationStatus.InProgress,
        }),
      ];

      await expect(
        runBeforeUpdate(
          serviceCase,
          update({
            props: makeProps([serviceCase.memberRole]),
            data: { ...EDIT },
            miscDataProps: NOTIFY_ON_EDIT,
          }),
        ),
      ).resolves.toBeDefined();
    });

    test("a master admin skips the permission checks, not the check on the send", async () => {
      storedNotes = [
        storedNote(serviceCase, {
          subscriberNotificationStatusOnNoteUpdated:
            StatusPageSubscriberNotificationStatus.InProgress,
        }),
      ];

      await expect(
        runBeforeUpdate(
          serviceCase,
          update({
            props: { userId: USER_ID, isMasterAdmin: true },
            data: { ...EDIT },
            miscDataProps: NOTIFY_ON_EDIT,
          }),
        ),
      ).rejects.toThrow(SubscriberNotificationResend.updateBeingSentMessage);
    });

    test("root - the workers - is never checked, and nothing is read", async () => {
      storedNotes = [
        storedNote(serviceCase, {
          subscriberNotificationStatusOnNoteUpdated:
            StatusPageSubscriberNotificationStatus.InProgress,
        }),
      ];

      await runBeforeUpdate(
        serviceCase,
        update({
          props: { isRoot: true },
          data: { ...EDIT },
          miscDataProps: NOTIFY_ON_EDIT,
        }),
      );

      expect(noteFindBy).not.toHaveBeenCalled();
    });
  },
);

describe("SubscriberNotificationResendAccess.assertCallerMayUpdateColumns", () => {
  const COLUMNS: JSONObject = {
    subscriberNotificationStatusOnIncidentCreated:
      StatusPageSubscriberNotificationStatus.Pending,
    statusPagesNotifiedOnCreation: [],
  };

  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.IncidentAdmin,
    Permission.IncidentMember,
    Permission.EditProjectIncident,
  ])("%s may write the incident's notification columns", (role: Permission) => {
    expect(() => {
      SubscriberNotificationResendAccess.assertCallerMayUpdateColumns({
        modelType: Incident,
        columns: COLUMNS,
        props: makeProps([role]),
        refusal: "refused",
      });
    }).not.toThrow();
  });

  test.each([
    Permission.IncidentViewer,
    Permission.Viewer,
    Permission.ReadProjectIncident,
    Permission.CreateProjectIncident,
    Permission.StatusPageAdmin,
  ])("%s may not, and is told what it was refused", (role: Permission) => {
    expect(() => {
      SubscriberNotificationResendAccess.assertCallerMayUpdateColumns({
        modelType: Incident,
        columns: COLUMNS,
        props: makeProps([role]),
        refusal: "You may not send it again.",
      });
    }).toThrow(new NotAuthorizedException("You may not send it again."));
  });

  test("root and master admins are not checked", () => {
    for (const props of [
      { isRoot: true },
      { userId: USER_ID, isMasterAdmin: true },
    ] as Array<DatabaseCommonInteractionProps>) {
      expect(() => {
        SubscriberNotificationResendAccess.assertCallerMayUpdateColumns({
          modelType: Incident,
          columns: COLUMNS,
          props,
          refusal: "refused",
        });
      }).not.toThrow();
    }
  });

  test("a caller with no credentials keeps the sign-in error, not the refusal", () => {
    let thrown: unknown = null;

    try {
      SubscriberNotificationResendAccess.assertCallerMayUpdateColumns({
        modelType: Incident,
        columns: COLUMNS,
        props: {},
        refusal: "refused",
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).not.toBeNull();
    expect((thrown as Error).message).not.toBe("refused");
  });
});

/*
 * End to end through DatabaseService.updateOneById with the real hook and
 * the real permission checks: only the database, the label query rewrite
 * and the audit log are stubbed.
 */
describe("IncidentPublicNoteService.updateOneById: sending a note's notification again", () => {
  let saveMock: MockFunction;
  let updateMock: MockFunction;

  beforeEach(() => {
    saveMock = getJestMockFunction();
    saveMock.mockImplementation((item: unknown) => {
      return Promise.resolve(item);
    });
    updateMock = getJestMockFunction();
    updateMock.mockResolvedValue({ affected: 1 });

    jest.spyOn(IncidentPublicNoteService, "findBy").mockImplementation((() => {
      return Promise.resolve([storedNote(SERVICE_CASES[0]!)]);
    }) as never);

    jest
      .spyOn(
        IncidentPublicNoteService as unknown as {
          _findBy: (...args: Array<unknown>) => Promise<unknown>;
        },
        "_findBy",
      )
      .mockImplementation((() => {
        const row: IncidentPublicNote = new IncidentPublicNote();
        row._id = NOTE_ID;
        row.projectId = PROJECT_ID;
        return Promise.resolve([row]);
      }) as never);

    jest
      .spyOn(
        IncidentPublicNoteService as unknown as {
          onUpdateSuccess: (...args: Array<unknown>) => Promise<unknown>;
        },
        "onUpdateSuccess",
      )
      .mockImplementation(((onUpdate: unknown): Promise<unknown> => {
        return Promise.resolve(onUpdate);
      }) as never);

    jest
      .spyOn(
        IncidentPublicNoteService as unknown as {
          getRepository: () => unknown;
        },
        "getRepository",
      )
      .mockReturnValue({
        update: updateMock,
        save: saveMock,
      } as never);

    jest.spyOn(BasePermission, "checkPermissions").mockImplementation(((
      _modelType: unknown,
      query: unknown,
    ): Promise<unknown> => {
      return Promise.resolve({ query });
    }) as never);

    jest
      .spyOn(IncidentPublicNoteService, "onTriggerWorkflow")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(IncidentPublicNoteService, "onTriggerRealtime")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(AuditLogService, "recordUpdate")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function written(): JSONObject {
    const calls: Array<Array<unknown>> = [
      ...saveMock.mock.calls,
      ...updateMock.mock.calls,
    ];

    expect(calls).toHaveLength(1);

    const call: Array<unknown> = calls[0]!;

    return (call.length > 1 ? call[1] : call[0]) as JSONObject;
  }

  test("an incident member's resend writes Pending", async () => {
    await IncidentPublicNoteService.updateOneById({
      id: new ObjectID(NOTE_ID),
      data: {
        subscriberNotificationStatusOnNoteCreated:
          StatusPageSubscriberNotificationStatus.Pending,
      },
      props: makeProps([Permission.IncidentMember]),
    });

    expect(written()["subscriberNotificationStatusOnNoteCreated"]).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
  });

  test("an incident viewer cannot, and nothing is written", async () => {
    // Refused by the update's own permission check, which comes first.
    await expect(
      IncidentPublicNoteService.updateOneById({
        id: new ObjectID(NOTE_ID),
        data: {
          subscriberNotificationStatusOnNoteCreated:
            StatusPageSubscriberNotificationStatus.Pending,
        },
        props: makeProps([Permission.IncidentViewer]),
      }),
    ).rejects.toThrow(NotAuthorizedException);

    expect(saveMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  test("a role that may edit notes but could not post one cannot, and nothing is written", async () => {
    await expect(
      IncidentPublicNoteService.updateOneById({
        id: new ObjectID(NOTE_ID),
        data: {
          subscriberNotificationStatusOnNoteCreated:
            StatusPageSubscriberNotificationStatus.Pending,
        },
        props: makeProps([
          Permission.EditIncidentPublicNote,
          Permission.ReadIncidentPublicNote,
        ]),
      }),
    ).rejects.toThrow(
      SubscriberNotificationResend.noPermissionToResendNoteMessage,
    );

    expect(saveMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  test("a role that may edit notes but could not post one cannot tell subscribers about its edit, and nothing is written", async () => {
    await expect(
      IncidentPublicNoteService.updateOneById({
        id: new ObjectID(NOTE_ID),
        data: { note: "Everything is fine, ignore the last update." },
        miscDataProps: SubscriberUpdateNotification.getMiscDataProps(),
        props: makeProps([
          Permission.EditIncidentPublicNote,
          Permission.ReadIncidentPublicNote,
        ]),
      }),
    ).rejects.toThrow(
      SubscriberNotificationResend.noPermissionToNotifyAboutEditMessage,
    );

    expect(saveMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  test("an incident member's edit that notifies subscribers queues the update notification", async () => {
    await IncidentPublicNoteService.updateOneById({
      id: new ObjectID(NOTE_ID),
      data: { note: "The fix is rolling out." },
      miscDataProps: SubscriberUpdateNotification.getMiscDataProps(),
      props: makeProps([Permission.IncidentMember]),
    });

    expect(written()["note"]).toBe("The fix is rolling out.");
    expect(written()["subscriberNotificationStatusOnNoteUpdated"]).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
  });

  test("that role can still edit the note itself", async () => {
    await IncidentPublicNoteService.updateOneById({
      id: new ObjectID(NOTE_ID),
      data: { note: "Corrected." },
      props: makeProps([
        Permission.EditIncidentPublicNote,
        Permission.ReadIncidentPublicNote,
      ]),
    });

    expect(written()["note"]).toBe("Corrected.");
  });
});
