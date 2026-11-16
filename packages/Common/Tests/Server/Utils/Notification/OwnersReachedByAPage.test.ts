import User from "../../../../Models/DatabaseModels/User";
import UserOnCallLogTimeline from "../../../../Models/DatabaseModels/UserOnCallLogTimeline";
import UserOnCallLogTimelineService from "../../../../Server/Services/UserOnCallLogTimelineService";
import FindBy from "../../../../Server/Types/Database/FindBy";
import logger from "../../../../Server/Utils/Logger";
import { OwnerNotificationOf } from "../../../../Server/Utils/Notification/OwnerNotificationDeliveries";
import OwnersReachedByAPage, {
  ON_CALL_PAGE_STATUSES_OUT,
  PAGED_RECORD_COLUMN_OF,
} from "../../../../Server/Utils/Notification/OwnersReachedByAPage";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import Email from "../../../../Types/Email";
import { JSONObject } from "../../../../Types/JSON";
import Name from "../../../../Types/Name";
import { OwnerNotificationKind } from "../../../../Types/Notification/OwnerNotificationDelivery";
import ObjectID from "../../../../Types/ObjectID";
import { isOnCallPageNotificationOut } from "../../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import UserNotificationStatus from "../../../../Types/UserNotification/UserNotificationStatus";
import {
  InMemoryOnCallPages,
  PageNotification,
  useInMemoryOnCallPages,
} from "../../../Helpers/InMemoryOnCallPages";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ONE NOTIFICATION FOR A NEW ALERT, NOT TWO (#7987).
 *
 * The owners' Created jobs of incidents, alerts and their episodes leave out
 * each owner a page about that same record reached already: one with a
 * notification of the page that went out (isOnCallPageNotificationOut). Here
 * the read that finds them runs on the person's on-call timeline held in
 * memory as the database answers its query (InMemoryOnCallPages): which
 * notifications count, which do not, that it is one read for every owner,
 * and that a read that fails leaves nobody out - nobody may miss being
 * told because of it.
 */

// The person's on-call timeline is all this reads: no other service is loaded.
jest.mock("../../../../Server/Services/UserOnCallLogTimelineService", () => {
  return {
    __esModule: true,
    default: { findBy: jest.fn() },
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "79870000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "79870000-0000-4000-8000-000000000002",
);
const RECORD_ID: ObjectID = new ObjectID(
  "79870000-0000-4000-8000-0000000000a1",
);
const OTHER_RECORD_ID: ObjectID = new ObjectID(
  "79870000-0000-4000-8000-0000000000a2",
);

function makeUser(n: number, name: string): User {
  const user: User = new User(
    new ObjectID(`79870000-0000-4000-8000-00000000010${n}`),
  );
  user.name = new Name(name);
  user.email = new Email(`${name.split(" ")[0]!.toLowerCase()}@acme.test`);
  return user;
}

const ANA: User = makeUser(1, "Ana Lopez");
const BO: User = makeUser(2, "Bo Chen");
const CARA: User = makeUser(3, "Cara Diaz");

// Each record's "created" notification, with the timeline column naming it.
const CREATED: Array<{
  kind: OwnerNotificationKind;
  column: keyof PageNotification;
}> = [
  {
    kind: OwnerNotificationKind.IncidentCreated,
    column: "triggeredByIncidentId",
  },
  { kind: OwnerNotificationKind.AlertCreated, column: "triggeredByAlertId" },
  {
    kind: OwnerNotificationKind.IncidentEpisodeCreated,
    column: "triggeredByIncidentEpisodeId",
  },
  {
    kind: OwnerNotificationKind.AlertEpisodeCreated,
    column: "triggeredByAlertEpisodeId",
  },
];

function createdOf(
  kind: OwnerNotificationKind = OwnerNotificationKind.AlertCreated,
): OwnerNotificationOf {
  return {
    kind: kind,
    projectId: PROJECT_ID,
    resourceId: RECORD_ID,
    eventId: RECORD_ID,
  };
}

// A notification of a page about the alert, to `user`, in `status`.
function pageOfTheAlert(
  user: User,
  status: UserNotificationStatus = UserNotificationStatus.Sent,
): PageNotification {
  return {
    projectId: PROJECT_ID,
    userId: user.id!,
    triggeredByAlertId: RECORD_ID,
    status: status,
  };
}

function namesOf(users: Array<User>): Array<string> {
  return users.map((user: User): string => {
    return user.name!.toString();
  });
}

// The values a QueryHelper.any in a query names, lowercased.
function anyOf(condition: unknown): Array<string> {
  const parameters: JSONObject =
    (condition as { objectLiteralParameters?: JSONObject })
      .objectLiteralParameters || {};

  return Object.values(parameters)
    .flatMap((entry: unknown): Array<unknown> => {
      return Array.isArray(entry) ? entry : [entry];
    })
    .map((entry: unknown): string => {
      return String(entry).toLowerCase();
    });
}

function idsOf(users: Array<User>): Array<string> {
  return users.map((user: User): string => {
    return user.id!.toString().toLowerCase();
  });
}

describe("OwnersReachedByAPage", () => {
  let pages: InMemoryOnCallPages;
  let errors: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    pages = useInMemoryOnCallPages();
    errors = jest.spyOn(logger, "error").mockImplementation((() => {
      // read by the tests
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the statuses read are exactly those of a notification that went out", () => {
    expect([...ON_CALL_PAGE_STATUSES_OUT].sort()).toEqual(
      [
        UserNotificationStatus.Sending,
        UserNotificationStatus.Sent,
        UserNotificationStatus.Acknowledged,
        UserNotificationStatus.PassedOn,
        UserNotificationStatus.NotAnswered,
      ].sort(),
    );

    // Read from isOnCallPageNotificationOut, so the two never part ways.
    for (const status of Object.values(UserNotificationStatus)) {
      expect([status, ON_CALL_PAGE_STATUSES_OUT.includes(status)]).toEqual([
        status,
        isOnCallPageNotificationOut(status),
      ]);
    }
  });

  test("only a record's created notification is one a page tells of too", () => {
    expect(PAGED_RECORD_COLUMN_OF).toEqual({
      [OwnerNotificationKind.IncidentCreated]: "triggeredByIncidentId",
      [OwnerNotificationKind.AlertCreated]: "triggeredByAlertId",
      [OwnerNotificationKind.IncidentEpisodeCreated]:
        "triggeredByIncidentEpisodeId",
      [OwnerNotificationKind.AlertEpisodeCreated]: "triggeredByAlertEpisodeId",
    });
  });

  test.each(CREATED)(
    "$kind: one read, of the record's page, for every owner at once",
    async (created: {
      kind: OwnerNotificationKind;
      column: keyof PageNotification;
    }) => {
      pages.add({
        projectId: PROJECT_ID,
        userId: BO.id!,
        [created.column]: RECORD_ID,
      });

      const reached: Array<User> = await OwnersReachedByAPage.findAmong({
        notification: createdOf(created.kind),
        owners: [ANA, BO, CARA],
      });

      expect(namesOf(reached)).toEqual(["Bo Chen"]);
      expect(pages.reads).toHaveLength(1);

      const read: FindBy<UserOnCallLogTimeline> = pages.reads[0]!;
      const query: JSONObject = read.query as JSONObject;

      // The record's column, and no other record's.
      expect(Object.keys(query).sort()).toEqual(
        ["projectId", "status", "userId", created.column].sort(),
      );
      expect(String(query[created.column])).toBe(RECORD_ID.toString());
      expect(String(query["projectId"])).toBe(PROJECT_ID.toString());
      expect(anyOf(query["userId"]).sort()).toEqual(
        idsOf([ANA, BO, CARA]).sort(),
      );
      expect(anyOf(query["status"]).sort()).toEqual(
        ON_CALL_PAGE_STATUSES_OUT.map((status: UserNotificationStatus) => {
          return status.toLowerCase();
        }).sort(),
      );
      expect(read.select).toEqual({ userId: true, status: true });
      expect(read.props).toEqual({ isRoot: true });
      expect(read.skip).toBe(0);
      expect(read.limit).toBe(LIMIT_PER_PROJECT);
    },
  );

  test("hands back the owners a page reached, in the order given, each once", async () => {
    pages.add(pageOfTheAlert(CARA));
    pages.add(pageOfTheAlert(ANA));
    // A push the person was sent again, and the email of the same page.
    pages.add(pageOfTheAlert(ANA));
    pages.add(pageOfTheAlert(ANA, UserNotificationStatus.Acknowledged));

    const reached: Array<User> = await OwnersReachedByAPage.findAmong({
      notification: createdOf(),
      owners: [ANA, BO, CARA],
    });

    expect(namesOf(reached)).toEqual(["Ana Lopez", "Cara Diaz"]);
    expect(reached[0]).toBe(ANA);
    expect(errors).not.toHaveBeenCalled();
  });

  test.each([
    UserNotificationStatus.Sending,
    UserNotificationStatus.Sent,
    UserNotificationStatus.Acknowledged,
    UserNotificationStatus.PassedOn,
    UserNotificationStatus.NotAnswered,
  ])(
    "a notification of the page that is %s reached them",
    async (status: UserNotificationStatus) => {
      pages.add(pageOfTheAlert(ANA, status));

      expect(
        namesOf(
          await OwnersReachedByAPage.findAmong({
            notification: createdOf(),
            owners: [ANA, BO],
          }),
        ),
      ).toEqual(["Ana Lopez"]);
    },
  );

  test.each([UserNotificationStatus.Error, UserNotificationStatus.Skipped])(
    "a notification of the page that is %s did not reach them: they are not left out",
    async (status: UserNotificationStatus) => {
      pages.add(pageOfTheAlert(ANA, status));

      expect(
        await OwnersReachedByAPage.findAmong({
          notification: createdOf(),
          owners: [ANA, BO],
        }),
      ).toEqual([]);
    },
  );

  test("a notification that did not go out does not count, even should the read hand one back", async () => {
    const failed: UserOnCallLogTimeline = new UserOnCallLogTimeline();
    failed.userId = ANA.id!;
    failed.status = UserNotificationStatus.Error;

    const skipped: UserOnCallLogTimeline = new UserOnCallLogTimeline();
    skipped.userId = BO.id!;
    skipped.status = UserNotificationStatus.Skipped;

    jest
      .spyOn(UserOnCallLogTimelineService, "findBy")
      .mockResolvedValue([failed, skipped]);

    expect(
      await OwnersReachedByAPage.findAmong({
        notification: createdOf(),
        owners: [ANA, BO],
      }),
    ).toEqual([]);
  });

  test("a page of somebody's that has sent nothing yet - held for working hours, or their first rule waits - leaves them to be told", async () => {
    // Bo's page went out; Ana's is held, so her timeline has no row of it.
    pages.add(pageOfTheAlert(BO));

    expect(
      namesOf(
        await OwnersReachedByAPage.findAmong({
          notification: createdOf(),
          owners: [ANA, BO],
        }),
      ),
    ).toEqual(["Bo Chen"]);
  });

  test("a page about another record does not count: another alert, an incident, an episode", async () => {
    pages.add({
      projectId: PROJECT_ID,
      userId: ANA.id!,
      triggeredByAlertId: OTHER_RECORD_ID,
    });
    // The incident declared from the alert, and the episode it opened.
    pages.add({
      projectId: PROJECT_ID,
      userId: ANA.id!,
      triggeredByIncidentId: OTHER_RECORD_ID,
    });
    pages.add({
      projectId: PROJECT_ID,
      userId: ANA.id!,
      triggeredByAlertEpisodeId: OTHER_RECORD_ID,
    });
    // The alert's page, for an incident of the same id: another kind of record.
    pages.add({
      projectId: PROJECT_ID,
      userId: BO.id!,
      triggeredByIncidentId: RECORD_ID,
    });

    expect(
      await OwnersReachedByAPage.findAmong({
        notification: createdOf(),
        owners: [ANA, BO],
      }),
    ).toEqual([]);
  });

  test("a page in another project does not count", async () => {
    pages.add({ ...pageOfTheAlert(ANA), projectId: OTHER_PROJECT_ID });

    expect(
      await OwnersReachedByAPage.findAmong({
        notification: createdOf(),
        owners: [ANA],
      }),
    ).toEqual([]);
  });

  test("somebody paged who is not one of the owners is not handed back", async () => {
    pages.add(pageOfTheAlert(CARA));

    expect(
      await OwnersReachedByAPage.findAmong({
        notification: createdOf(),
        owners: [ANA, BO],
      }),
    ).toEqual([]);
  });

  test("a read that fails says so and leaves nobody out, so every owner is told", async () => {
    pages.add(pageOfTheAlert(ANA));
    pages.failWith(new Error("The database is away"));

    expect(
      await OwnersReachedByAPage.findAmong({
        notification: createdOf(),
        owners: [ANA, BO],
      }),
    ).toEqual([]);

    expect(errors).toHaveBeenCalledTimes(1);
    expect(String(errors.mock.calls[0]![0])).toBe(
      `Could not read whom the on-call page of AlertCreated ${RECORD_ID.toString()} reached: Error: The database is away. Telling every owner.`,
    );
    expect(errors.mock.calls[0]![1]).toEqual({
      projectId: PROJECT_ID.toString(),
      ownerNotificationKind: OwnerNotificationKind.AlertCreated,
      resourceId: RECORD_ID.toString(),
    });
  });

  test("with no owners, reads nothing", async () => {
    expect(
      await OwnersReachedByAPage.findAmong({
        notification: createdOf(),
        owners: [],
      }),
    ).toEqual([]);
    expect(pages.reads).toEqual([]);
  });

  test.each([
    OwnerNotificationKind.AlertStateChanged,
    OwnerNotificationKind.IncidentInternalNotePosted,
    OwnerNotificationKind.IncidentReminder,
    OwnerNotificationKind.AlertEpisodeOwnerAdded,
    OwnerNotificationKind.MonitorCreated,
  ])(
    "%s - a notification no page tells of - leaves nobody out, and reads nothing",
    async (kind: OwnerNotificationKind) => {
      pages.add(pageOfTheAlert(ANA));

      expect(
        await OwnersReachedByAPage.findAmong({
          notification: createdOf(kind),
          owners: [ANA],
        }),
      ).toEqual([]);
      expect(pages.reads).toEqual([]);
    },
  );

  test("an owner with no id is not looked for", async () => {
    const nobody: User = new User();
    nobody.name = new Name("Nobody");

    pages.add(pageOfTheAlert(ANA));

    expect(
      namesOf(
        await OwnersReachedByAPage.findAmong({
          notification: createdOf(),
          owners: [nobody, ANA],
        }),
      ),
    ).toEqual(["Ana Lopez"]);
    expect(anyOf((pages.reads[0]!.query as JSONObject)["userId"])).toEqual(
      idsOf([ANA]),
    );
  });
});
