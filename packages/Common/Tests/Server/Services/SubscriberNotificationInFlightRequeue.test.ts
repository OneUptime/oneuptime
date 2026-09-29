import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentEpisodeStateTimelineService from "../../../Server/Services/IncidentEpisodeStateTimelineService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateTimelineService from "../../../Server/Services/IncidentStateTimelineService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import SubscriberNotificationResendAccess from "../../../Server/Utils/StatusPage/SubscriberNotificationResendAccess";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeStateTimeline from "../../../Models/DatabaseModels/IncidentEpisodeStateTimeline";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import SubscriberNotificationResend from "../../../Types/StatusPage/SubscriberNotificationResend";
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
 * Retry (or Resend) puts a notification's status back to Pending, and the
 * job that sends it claims Pending rows. Written while the notification is
 * being sent (InProgress) - a second responder's Retry from a page that has
 * not refreshed, another tab, the API - it bumps the row's version, so the
 * next run claims it and sends it alongside the running send: every page
 * not yet recorded, including the one in progress, gets it twice, and both
 * runs then settle, the last overwriting the other's status. With the jobs
 * awaiting every message, a send is InProgress for minutes, not seconds.
 *
 * So a user's or an API key's Pending over an InProgress notification is
 * refused, with the reason, for every notification the dashboard can send
 * again: the incident created and postmortem notifications and the incident
 * state change ones (the public notes' are pinned in
 * PublicNoteResendAccess.test.ts). The episode created and state change
 * notifications hold to the same rule, though no user role may write their
 * status - only a master admin's Pending reaches them.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5d7f3c0a-4c55-4d3e-9a3e-2d4a7d1c9e01",
);
const USER_ID: ObjectID = new ObjectID("5d7f3c0a-4c55-4d3e-9a3e-2d4a7d1c9e02");
const ROW_ID: string = "a1b2c3d4-0000-4000-8000-000000000001";

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

interface NotificationCase {
  name: string;
  service: DatabaseService<BaseModel>;
  modelType: { new (): BaseModel };
  statusColumn: string;
  /*
   * Who may send it again. The episode notifications' status columns take
   * no user's write (update: []), so only a master admin's reaches them.
   */
  senderProps: () => DatabaseCommonInteractionProps;
  // A role that may only read it.
  viewerRole: Permission;
}

function masterAdmin(): DatabaseCommonInteractionProps {
  return { userId: USER_ID, isMasterAdmin: true };
}

const CASES: Array<NotificationCase> = [
  {
    name: "the incident created notification",
    service: IncidentService as unknown as DatabaseService<BaseModel>,
    modelType: Incident,
    statusColumn: "subscriberNotificationStatusOnIncidentCreated",
    senderProps: () => {
      return makeProps([Permission.IncidentMember]);
    },
    viewerRole: Permission.IncidentViewer,
  },
  {
    name: "the incident postmortem notification",
    service: IncidentService as unknown as DatabaseService<BaseModel>,
    modelType: Incident,
    statusColumn: "subscriberNotificationStatusOnPostmortemPublished",
    senderProps: () => {
      return makeProps([Permission.IncidentMember]);
    },
    viewerRole: Permission.IncidentViewer,
  },
  {
    name: "an incident state change notification",
    service:
      IncidentStateTimelineService as unknown as DatabaseService<BaseModel>,
    modelType: IncidentStateTimeline,
    statusColumn: "subscriberNotificationStatus",
    senderProps: () => {
      return makeProps([Permission.IncidentMember]);
    },
    viewerRole: Permission.IncidentViewer,
  },
  {
    name: "the episode created notification",
    service: IncidentEpisodeService as unknown as DatabaseService<BaseModel>,
    modelType: IncidentEpisode,
    statusColumn: "subscriberNotificationStatusOnEpisodeCreated",
    senderProps: masterAdmin,
    viewerRole: Permission.IncidentViewer,
  },
  {
    name: "an episode state change notification",
    service:
      IncidentEpisodeStateTimelineService as unknown as DatabaseService<BaseModel>,
    modelType: IncidentEpisodeStateTimeline,
    statusColumn: "subscriberNotificationStatus",
    senderProps: masterAdmin,
    viewerRole: Permission.IncidentViewer,
  },
];

let storedRows: Array<BaseModel> = [];
let findBy: MockFunction;

function storedRow(
  notificationCase: NotificationCase,
  status: StatusPageSubscriberNotificationStatus,
): BaseModel {
  const row: BaseModel = new notificationCase.modelType();
  row._id = ROW_ID;
  (row as unknown as JSONObject)[notificationCase.statusColumn] = status;
  (row as unknown as JSONObject)["projectId"] = PROJECT_ID;
  return row;
}

function retry(
  notificationCase: NotificationCase,
  props: DatabaseCommonInteractionProps,
  data?: JSONObject,
): UpdateBy<BaseModel> {
  return {
    query: { _id: ROW_ID } as never,
    data: (data || {
      [notificationCase.statusColumn]:
        StatusPageSubscriberNotificationStatus.Pending,
    }) as never,
    props: props,
    limit: 1,
    skip: 0,
  };
}

async function runBeforeUpdate(
  notificationCase: NotificationCase,
  updateBy: UpdateBy<BaseModel>,
): Promise<OnUpdate<BaseModel>> {
  return await (
    notificationCase.service as unknown as {
      onBeforeUpdate: (
        updateBy: UpdateBy<BaseModel>,
      ) => Promise<OnUpdate<BaseModel>>;
    }
  ).onBeforeUpdate(updateBy);
}

// The reads the guard made: with the caller's props, selecting the status.
function guardReads(
  notificationCase: NotificationCase,
  props: DatabaseCommonInteractionProps,
): Array<JSONObject> {
  return findBy.mock.calls
    .map((call: Array<unknown>): JSONObject => {
      return call[0] as JSONObject;
    })
    .filter((read: JSONObject): boolean => {
      return (
        read["props"] === props &&
        Boolean((read["select"] as JSONObject)[notificationCase.statusColumn])
      );
    });
}

describe.each(CASES)(
  "Retry of $name while it is being sent",
  (notificationCase: NotificationCase) => {
    beforeEach(() => {
      storedRows = [
        storedRow(
          notificationCase,
          StatusPageSubscriberNotificationStatus.InProgress,
        ),
      ];

      findBy = getJestMockFunction();
      findBy.mockImplementation(() => {
        return Promise.resolve(storedRows);
      });
      jest
        .spyOn(notificationCase.service, "findBy")
        .mockImplementation(findBy as never);

      // The incident hooks that are not what this is about.
      jest
        .spyOn(
          IncidentService as unknown as {
            validateProjectScopedReferences: () => Promise<void>;
          },
          "validateProjectScopedReferences",
        )
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(CustomFieldMappingService, "applyMappingsToUpdate")
        .mockResolvedValue(undefined as never);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test("is refused, with the reason", async () => {
      await expect(
        runBeforeUpdate(
          notificationCase,
          retry(notificationCase, notificationCase.senderProps()),
        ),
      ).rejects.toThrow(
        new BadDataException(SubscriberNotificationResend.beingSentMessage),
      );
    });

    test("reads the notification with the caller's own permissions and the update's query", async () => {
      const props: DatabaseCommonInteractionProps =
        notificationCase.senderProps();

      await runBeforeUpdate(notificationCase, retry(notificationCase, props))
        .then(() => {
          return undefined;
        })
        .catch(() => {
          return undefined;
        });

      const reads: Array<JSONObject> = guardReads(notificationCase, props);
      expect(reads).toHaveLength(1);
      expect(reads[0]!["query"]).toEqual(
        expect.objectContaining({ _id: ROW_ID }),
      );
    });

    test.each([
      StatusPageSubscriberNotificationStatus.Failed,
      StatusPageSubscriberNotificationStatus.Success,
      StatusPageSubscriberNotificationStatus.Pending,
    ])(
      "is let through once it is %s",
      async (status: StatusPageSubscriberNotificationStatus) => {
        storedRows = [storedRow(notificationCase, status)];

        await expect(
          runBeforeUpdate(
            notificationCase,
            retry(notificationCase, notificationCase.senderProps()),
          ),
        ).resolves.toBeDefined();
      },
    );

    test("a caller who may not send it again is left to the update's own check, and nothing is read for it", async () => {
      const props: DatabaseCommonInteractionProps = makeProps([
        notificationCase.viewerRole,
      ]);

      let error: unknown = null;

      try {
        await runBeforeUpdate(notificationCase, retry(notificationCase, props));
      } catch (err) {
        error = err;
      }

      // Never told the notification is being sent.
      expect((error as Error | null)?.message).not.toBe(
        SubscriberNotificationResend.beingSentMessage,
      );
      expect(guardReads(notificationCase, props)).toEqual([]);
    });

    test("a master admin is checked too: the send's state is not a permission", async () => {
      await expect(
        runBeforeUpdate(
          notificationCase,
          retry(notificationCase, { userId: USER_ID, isMasterAdmin: true }),
        ),
      ).rejects.toThrow(SubscriberNotificationResend.beingSentMessage);
    });

    test("root - the workers - is never checked", async () => {
      const props: DatabaseCommonInteractionProps = { isRoot: true };

      await runBeforeUpdate(notificationCase, retry(notificationCase, props))
        .then(() => {
          return undefined;
        })
        .catch(() => {
          return undefined;
        });

      expect(guardReads(notificationCase, props)).toEqual([]);
    });

    test("an edit that does not send it again is not refused", async () => {
      const props: DatabaseCommonInteractionProps =
        notificationCase.senderProps();

      await runBeforeUpdate(
        notificationCase,
        retry(notificationCase, props, {
          [notificationCase.statusColumn === "subscriberNotificationStatus"
            ? "endsAt"
            : "title"]:
            notificationCase.statusColumn === "subscriberNotificationStatus"
              ? new Date()
              : "Renamed",
        }),
      )
        .then(() => {
          return undefined;
        })
        .catch((err: Error) => {
          expect(err.message).not.toBe(
            SubscriberNotificationResend.beingSentMessage,
          );
        });

      expect(guardReads(notificationCase, props)).toEqual([]);
    });
  },
);

describe("SubscriberNotificationResendAccess.assertNotQueuedWhileBeingSent", () => {
  let serviceFindBy: MockFunction;

  beforeEach(() => {
    serviceFindBy = getJestMockFunction();
    jest
      .spyOn(IncidentService, "findBy")
      .mockImplementation(serviceFindBy as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function guard(data: {
    rows: Array<JSONObject>;
    written: JSONObject;
    refusal?: string;
  }): Promise<void> {
    serviceFindBy.mockResolvedValue(
      data.rows.map((values: JSONObject): Incident => {
        const row: Incident = new Incident();
        Object.assign(row, values);
        return row;
      }) as never,
    );

    return SubscriberNotificationResendAccess.assertNotQueuedWhileBeingSent({
      modelType: Incident,
      service: IncidentService as unknown as DatabaseService<Incident>,
      updateBy: {
        query: { projectId: PROJECT_ID.toString() } as never,
        data: data.written as never,
        props: makeProps([Permission.IncidentMember]),
        limit: 10,
        skip: 0,
      },
      statusColumns: [
        "subscriberNotificationStatusOnIncidentCreated",
        "subscriberNotificationStatusOnPostmortemPublished",
      ],
      ...(data.refusal ? { refusal: data.refusal } : {}),
    });
  }

  test("a bulk update is refused when any matched row is being sent", async () => {
    await expect(
      guard({
        rows: [
          {
            subscriberNotificationStatusOnIncidentCreated:
              StatusPageSubscriberNotificationStatus.Failed,
          },
          {
            subscriberNotificationStatusOnIncidentCreated:
              StatusPageSubscriberNotificationStatus.InProgress,
          },
        ],
        written: {
          subscriberNotificationStatusOnIncidentCreated:
            StatusPageSubscriberNotificationStatus.Pending,
        },
      }),
    ).rejects.toThrow(SubscriberNotificationResend.beingSentMessage);
  });

  test("only the columns written as Pending are looked at", async () => {
    await expect(
      guard({
        rows: [
          {
            // Being sent, but not what this update asks for.
            subscriberNotificationStatusOnIncidentCreated:
              StatusPageSubscriberNotificationStatus.InProgress,
            subscriberNotificationStatusOnPostmortemPublished:
              StatusPageSubscriberNotificationStatus.Failed,
          },
        ],
        written: {
          subscriberNotificationStatusOnPostmortemPublished:
            StatusPageSubscriberNotificationStatus.Pending,
        },
      }),
    ).resolves.toBeUndefined();

    expect(
      (serviceFindBy.mock.calls[0]![0] as { select: JSONObject }).select,
    ).toEqual({
      _id: true,
      subscriberNotificationStatusOnPostmortemPublished: true,
    });
  });

  test("a status other than Pending is not a request to send it again", async () => {
    await expect(
      guard({
        rows: [
          {
            subscriberNotificationStatusOnIncidentCreated:
              StatusPageSubscriberNotificationStatus.InProgress,
          },
        ],
        written: {
          subscriberNotificationStatusOnIncidentCreated:
            StatusPageSubscriberNotificationStatus.Skipped,
        },
      }),
    ).resolves.toBeUndefined();

    expect(serviceFindBy).not.toHaveBeenCalled();
  });

  test("uses the caller's reason when it gives one", async () => {
    await expect(
      guard({
        rows: [
          {
            subscriberNotificationStatusOnIncidentCreated:
              StatusPageSubscriberNotificationStatus.InProgress,
          },
        ],
        written: {
          subscriberNotificationStatusOnIncidentCreated:
            StatusPageSubscriberNotificationStatus.Pending,
        },
        refusal: "Not now.",
      }),
    ).rejects.toThrow(new BadDataException("Not now."));
  });
});
