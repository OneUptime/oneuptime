import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import AccessTokenService from "../../../../Server/Services/AccessTokenService";
import ProjectService from "../../../../Server/Services/ProjectService";
import UserNotificationSettingService, {
  UserNotificationChannels,
} from "../../../../Server/Services/UserNotificationSettingService";
import logger from "../../../../Server/Utils/Logger";
import { PublicNoteKind } from "../../../../Server/Utils/Notes/PublicNoteApprovalEngine";
import PublicNoteApprovalNotifications, {
  PublicNoteApprovalMessageFacts,
} from "../../../../Server/Utils/Notes/PublicNoteApprovalNotifications";
import PublicNoteApprovalRequests, {
  ASK_BY_EVERYTHING,
  ASK_BY_NOTHING,
  PublicNoteApprovalRequestClaim,
  PublicNoteApprovalRequestKey,
} from "../../../../Server/Utils/Notes/PublicNoteApprovalRequests";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../Types/ObjectID";
import type { SpyInstance } from "jest-mock";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySpy = SpyInstance<(...args: Array<any>) => any>;

/*
 * EACH APPROVER ASKED ABOUT A STEP ONCE (#6353): what askApprovers does
 * with the step it asks about (`request`).
 *
 *  - Each person is claimed before they are asked, and asked only by what
 *    the claim won: everything the first time, their chat accounts alone
 *    when only the chat message changed, nothing when it was all claimed.
 *  - A follow-up - who approves changed while the note waits - first reads
 *    whom the step asked, and looks no further at those asked by everything;
 *    when that cannot be read, or a claim cannot be written, it asks nobody,
 *    so as never to ask anybody twice. The step's own ask asks anyway: a
 *    note never waits for nobody.
 *  - A claim whose ask failed is taken back, for the next ask to try again.
 *  - Who may be told is decided first: a claim is made only for a member who
 *    can read the note.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const ALICE: string = "a1a1a1a1-0000-4000-8000-000000000001";
const BOB: string = "b2b2b2b2-0000-4000-8000-000000000002";
const CAROL: string = "c3c3c3c3-0000-4000-8000-000000000003";

function facts(): PublicNoteApprovalMessageFacts {
  return {
    projectId: PROJECT_ID,
    recordLabel: "Incident INC-42",
    recordTitle: "Checkout is down",
    notesUrl: "https://oneuptime.example/dashboard/p/incidents/i/public-notes",
    note: "We are looking into it.",
    isEdit: false,
    incidentId: new ObjectID("33333333-3333-4333-8333-333333333333"),
  };
}

const REQUEST: PublicNoteApprovalRequestKey = {
  kind: PublicNoteKind.Incident,
  projectId: PROJECT_ID,
  noteId: new ObjectID("44444444-4444-4444-8444-444444444444"),
  submittedAt: "2026-11-09T09:00:00.000Z",
  stepId: "5e000000-0000-4000-8000-0000000000a1",
  isFinal: false,
  isAskedAgain: false,
};

let members: Set<string>;
let sent: Array<{
  userId: string;
  channels: UserNotificationChannels | undefined;
}>;
let failingSends: Set<string>;

async function ask(
  data: {
    userIds?: Array<string>;
    request?: PublicNoteApprovalRequestKey | undefined;
    isFollowUp?: boolean;
  } = {},
): Promise<Array<string>> {
  const asked: Array<ObjectID> =
    await PublicNoteApprovalNotifications.askApprovers({
      facts: facts(),
      userIds: data.userIds || [BOB, CAROL],
      namedUserIds: [BOB],
      sentByUserId: ALICE,
      stepLabel: "Step 1 of 2 (Support)",
      canRead: async (): Promise<boolean> => {
        return true;
      },
      ...("request" in data ? { request: data.request } : { request: REQUEST }),
      ...(data.isFollowUp ? { isFollowUp: true } : {}),
    });

  return asked.map((id: ObjectID): string => {
    return id.toString();
  });
}

beforeEach(() => {
  members = new Set([ALICE, BOB, CAROL]);
  sent = [];
  failingSends = new Set();

  jest
    .spyOn(
      AccessTokenService,
      "getDatabaseCommonInteractionPropsByUserAndProject",
    )
    .mockImplementation((async (data: {
      userId: ObjectID;
      projectId: ObjectID;
    }): Promise<DatabaseCommonInteractionProps> => {
      return {
        userId: data.userId,
        tenantId: data.projectId,
        userTenantAccessPermission: members.has(data.userId.toString())
          ? ({ [data.projectId.toString()]: {} } as never)
          : {},
      } as DatabaseCommonInteractionProps;
    }) as never);
  jest
    .spyOn(
      UserNotificationSettingService,
      "addPublicNoteApprovalNotificationSettings",
    )
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(UserNotificationSettingService, "sendUserNotification")
    .mockImplementation((async (data: {
      userId: ObjectID;
      channels?: UserNotificationChannels;
    }): Promise<void> => {
      if (failingSends.has(data.userId.toString())) {
        throw new Error("No way through.");
      }

      sent.push({ userId: data.userId.toString(), channels: data.channels });
    }) as never);
  jest
    .spyOn(PublicNoteApprovalNotifications, "getUserNames")
    .mockResolvedValue({ [ALICE]: "Alice" } as never);
  jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
    name: "Acme",
  } as never);
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function claims(
  byUser: Record<string, PublicNoteApprovalRequestClaim>,
): AnySpy {
  return jest
    .spyOn(PublicNoteApprovalRequests, "claim")
    .mockImplementation((async (data: {
      userId: ObjectID;
    }): Promise<PublicNoteApprovalRequestClaim> => {
      return byUser[data.userId.toString()] || ASK_BY_NOTHING;
    }) as never) as AnySpy;
}

describe("a step's ask, with what it asks about", () => {
  test("claims each person, and asks by what the claim won: everything, the chat alone, or nothing", async () => {
    const claim: AnySpy = claims({
      [BOB]: ASK_BY_EVERYTHING,
      [CAROL]: { notifications: false, chat: true },
    }) as AnySpy;

    await expect(ask({ userIds: [BOB, CAROL, ALICE] })).resolves.toEqual([
      BOB,
      CAROL,
    ]);

    expect(sent).toEqual([
      { userId: BOB, channels: undefined },
      { userId: CAROL, channels: UserNotificationChannels.ChatOnly },
    ]);
    expect(claim).toHaveBeenCalledTimes(3);
    expect(claim.mock.calls[0]![0]).toEqual({
      key: REQUEST,
      userId: new ObjectID(BOB),
    });
  });

  test("everything but chat, when only the notifications were left", async () => {
    claims({ [BOB]: { notifications: true, chat: false } });

    await ask({ userIds: [BOB] });

    expect(sent).toEqual([
      { userId: BOB, channels: UserNotificationChannels.AllButChat },
    ]);
  });

  test("a claim is made only for a member of the project who may read the note", async () => {
    members.delete(CAROL);
    const claim: AnySpy = claims({ [BOB]: ASK_BY_EVERYTHING }) as AnySpy;

    await ask();

    expect(
      claim.mock.calls.map((call: Array<unknown>): string => {
        return (call[0] as { userId: ObjectID }).userId.toString();
      }),
    ).toEqual([BOB]);
  });

  test("a claim that cannot be written: the step's own ask asks anyway", async () => {
    jest
      .spyOn(PublicNoteApprovalRequests, "claim")
      .mockRejectedValue(new Error("down") as never);

    await expect(ask()).resolves.toEqual([BOB, CAROL]);
    expect(sent).toEqual([
      { userId: BOB, channels: undefined },
      { userId: CAROL, channels: undefined },
    ]);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("they are asked anyway"),
      expect.anything(),
    );
  });

  test("a send that fails takes its claim back, for the next ask; the others are asked", async () => {
    claims({ [BOB]: ASK_BY_EVERYTHING, [CAROL]: ASK_BY_EVERYTHING });
    const release: AnySpy = jest
      .spyOn(PublicNoteApprovalRequests, "release")
      .mockResolvedValue(undefined as never) as AnySpy;
    failingSends.add(BOB);

    await expect(ask()).resolves.toEqual([CAROL]);

    expect(release).toHaveBeenCalledTimes(1);
    expect(release.mock.calls[0]![0]).toEqual({
      key: REQUEST,
      userId: new ObjectID(BOB),
      claim: ASK_BY_EVERYTHING,
    });
  });

  test("with no step to name, everybody is asked as before: nothing is claimed", async () => {
    const claim: AnySpy = jest.spyOn(
      PublicNoteApprovalRequests,
      "claim",
    ) as AnySpy;

    await expect(ask({ request: undefined })).resolves.toEqual([BOB, CAROL]);
    expect(claim).not.toHaveBeenCalled();
  });
});

describe("a follow-up's ask", () => {
  test("reads whom the step asked first, and looks no further at those asked by everything", async () => {
    jest.spyOn(PublicNoteApprovalRequests, "readAsked").mockResolvedValue(
      new Map([
        [BOB, ASK_BY_EVERYTHING],
        [CAROL, { notifications: true, chat: false }],
      ]) as never,
    );
    const claim: AnySpy = claims({
      [CAROL]: { notifications: false, chat: true },
    }) as AnySpy;
    const props: AnySpy = jest.spyOn(
      AccessTokenService,
      "getDatabaseCommonInteractionPropsByUserAndProject",
    ) as AnySpy;

    await expect(ask({ isFollowUp: true })).resolves.toEqual([CAROL]);

    expect(sent).toEqual([
      { userId: CAROL, channels: UserNotificationChannels.ChatOnly },
    ]);
    expect(claim).toHaveBeenCalledTimes(1);
    // Bob was not even looked at.
    expect(
      props.mock.calls.map((call: Array<unknown>): string => {
        return (call[0] as { userId: ObjectID }).userId.toString();
      }),
    ).toEqual([CAROL]);
  });

  test("asks nobody when whom the step asked cannot be read", async () => {
    jest
      .spyOn(PublicNoteApprovalRequests, "readAsked")
      .mockRejectedValue(new Error("down") as never);
    const claim: AnySpy = jest.spyOn(
      PublicNoteApprovalRequests,
      "claim",
    ) as AnySpy;

    await expect(ask({ isFollowUp: true })).resolves.toEqual([]);
    expect(sent).toEqual([]);
    expect(claim).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("nobody new was asked"),
      expect.anything(),
    );
  });

  test("asks nobody whose claim cannot be written", async () => {
    jest
      .spyOn(PublicNoteApprovalRequests, "readAsked")
      .mockResolvedValue(new Map() as never);
    jest
      .spyOn(PublicNoteApprovalRequests, "claim")
      .mockRejectedValue(new Error("down") as never);

    await expect(ask({ isFollowUp: true })).resolves.toEqual([]);
    expect(sent).toEqual([]);
  });

  test("asks nobody with no step to name: it could not tell whom it asked", async () => {
    const claim: AnySpy = jest.spyOn(
      PublicNoteApprovalRequests,
      "claim",
    ) as AnySpy;

    await expect(
      ask({ request: undefined, isFollowUp: true }),
    ).resolves.toEqual([]);
    expect(sent).toEqual([]);
    expect(claim).not.toHaveBeenCalled();
  });

  test("when everybody was asked by everything, nothing is read at all", async () => {
    jest.spyOn(PublicNoteApprovalRequests, "readAsked").mockResolvedValue(
      new Map([
        [BOB, ASK_BY_EVERYTHING],
        [CAROL, ASK_BY_EVERYTHING],
      ]) as never,
    );
    const project: AnySpy = jest.spyOn(ProjectService, "findOneById") as AnySpy;

    await expect(ask({ isFollowUp: true })).resolves.toEqual([]);
    expect(project).not.toHaveBeenCalled();
  });
});
