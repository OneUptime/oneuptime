import { afterEach, describe, expect, jest, test } from "@jest/globals";
import PublicNoteApprovalRequest, {
  PublicNoteApprovalRequestKind,
} from "../../../../Models/DatabaseModels/PublicNoteApprovalRequest";
import PublicNoteApprovalRequestService, {
  PublicNoteApprovalRequestRow,
} from "../../../../Server/Services/PublicNoteApprovalRequestService";
import logger from "../../../../Server/Utils/Logger";
import { PublicNoteKind } from "../../../../Server/Utils/Notes/PublicNoteApprovalEngine";
import PublicNoteApprovalNotifications from "../../../../Server/Utils/Notes/PublicNoteApprovalNotifications";
import PublicNoteApprovalRequests, {
  ASK_BY_EVERYTHING,
  ASK_BY_NOTHING,
  PublicNoteApprovalRequestKey,
} from "../../../../Server/Utils/Notes/PublicNoteApprovalRequests";
import { UserNotificationChannels } from "../../../../Server/Services/UserNotificationSettingService";
import ObjectID from "../../../../Types/ObjectID";

/*
 * THE RECORD OF WHOM A STEP OF A PUBLIC NOTE ASKED (#6353), AS
 * PublicNoteApprovalRequests KEEPS IT.
 *
 *  - by their notification settings a person is asked about a step of a round
 *    once, and once more when its last step is asked again: the request's
 *    message - final or not - plays no part;
 *  - in chat, once for each message that asks: whether approving publishes
 *    the note, not whether the step is asked again;
 *  - a claim says what this ask may ask by: what nobody claimed yet;
 *  - what was claimed and not asked is taken back, and so is a chat request
 *    once its message is replaced - each best effort, logged when it cannot.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const NOTE_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const BOB: ObjectID = new ObjectID("b2b2b2b2-0000-4000-8000-000000000002");
const CAROL: ObjectID = new ObjectID("c3c3c3c3-0000-4000-8000-000000000003");

function key(
  overrides: Partial<PublicNoteApprovalRequestKey> = {},
): PublicNoteApprovalRequestKey {
  return {
    kind: PublicNoteKind.Incident,
    projectId: PROJECT_ID,
    noteId: NOTE_ID,
    submittedAt: "2026-11-09T09:00:00.000Z",
    stepId: "5e000000-0000-4000-8000-0000000000a1",
    isFinal: true,
    isAskedAgain: false,
    ...overrides,
  };
}

function request(
  userId: ObjectID,
  kind: PublicNoteApprovalRequestKind,
  isFinal: boolean,
  isAskedAgain: boolean,
): PublicNoteApprovalRequest {
  const row: PublicNoteApprovalRequest = new PublicNoteApprovalRequest();
  row.userId = userId;
  row.kind = kind;
  row.isFinal = isFinal;
  row.isAskedAgain = isAskedAgain;
  return row;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the requests a person asked about a step holds", () => {
  test("one of each kind: the notifications' by whether the step is asked again, the chat's by whether approving publishes", () => {
    expect(PublicNoteApprovalRequests.getRows(key())).toEqual([
      {
        kind: PublicNoteApprovalRequestKind.Notifications,
        isFinal: false,
        isAskedAgain: false,
      },
      {
        kind: PublicNoteApprovalRequestKind.Chat,
        isFinal: true,
        isAskedAgain: false,
      },
    ]);
    expect(
      PublicNoteApprovalRequests.getRows(
        key({ isFinal: true, isAskedAgain: true }),
      ),
    ).toEqual([
      {
        kind: PublicNoteApprovalRequestKind.Notifications,
        isFinal: false,
        isAskedAgain: true,
      },
      {
        kind: PublicNoteApprovalRequestKind.Chat,
        isFinal: true,
        isAskedAgain: false,
      },
    ]);
  });

  test("only the kinds a claim names", () => {
    expect(
      PublicNoteApprovalRequests.getRows(key(), {
        notifications: false,
        chat: true,
      }),
    ).toEqual([
      {
        kind: PublicNoteApprovalRequestKind.Chat,
        isFinal: true,
        isAskedAgain: false,
      },
    ]);
    expect(PublicNoteApprovalRequests.getRows(key(), ASK_BY_NOTHING)).toEqual(
      [],
    );
  });

  test("each kind of note is tied by its own column", () => {
    expect(
      PublicNoteApprovalRequests.getNoteColumn(PublicNoteKind.Incident),
    ).toBe("incidentPublicNoteId");
    expect(
      PublicNoteApprovalRequests.getNoteColumn(PublicNoteKind.IncidentEpisode),
    ).toBe("incidentEpisodePublicNoteId");
    expect(
      PublicNoteApprovalRequests.getNoteColumn(
        PublicNoteKind.ScheduledMaintenance,
      ),
    ).toBe("scheduledMaintenancePublicNoteId");
  });
});

describe("claim", () => {
  test("writes both requests of the person for the step, as one claim, and says what it won", async () => {
    const claim: jest.SpyInstance = jest
      .spyOn(PublicNoteApprovalRequestService, "claim")
      .mockResolvedValue([
        PublicNoteApprovalRequestKind.Notifications,
        PublicNoteApprovalRequestKind.Chat,
      ] as never);

    await expect(
      PublicNoteApprovalRequests.claim({
        key: key({ kind: PublicNoteKind.ScheduledMaintenance }),
        userId: BOB,
      }),
    ).resolves.toEqual(ASK_BY_EVERYTHING);

    expect(claim).toHaveBeenCalledTimes(1);
    expect(claim.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      noteColumn: "scheduledMaintenancePublicNoteId",
      noteId: NOTE_ID,
      userId: BOB,
      submittedAt: "2026-11-09T09:00:00.000Z",
      stepId: "5e000000-0000-4000-8000-0000000000a1",
      rows: PublicNoteApprovalRequests.getRows(key()),
    });
  });

  test.each([
    [[PublicNoteApprovalRequestKind.Chat], { notifications: false, chat: true }],
    [
      [PublicNoteApprovalRequestKind.Notifications],
      { notifications: true, chat: false },
    ],
    [[], ASK_BY_NOTHING],
  ] as Array<[Array<PublicNoteApprovalRequestKind>, unknown]>)(
    "won %j: asks by that alone",
    async (won: Array<PublicNoteApprovalRequestKind>, expected: unknown) => {
      jest
        .spyOn(PublicNoteApprovalRequestService, "claim")
        .mockResolvedValue(won as never);

      await expect(
        PublicNoteApprovalRequests.claim({ key: key(), userId: BOB }),
      ).resolves.toEqual(expected);
    },
  );

  test("throws when the record cannot be written: the caller decides", async () => {
    jest
      .spyOn(PublicNoteApprovalRequestService, "claim")
      .mockRejectedValue(new Error("down") as never);

    await expect(
      PublicNoteApprovalRequests.claim({ key: key(), userId: BOB }),
    ).rejects.toThrow("down");
  });
});

describe("readAsked", () => {
  test("by person: notifications for this step asked again or not, chat for this message", async () => {
    jest.spyOn(PublicNoteApprovalRequestService, "findForStep").mockResolvedValue([
      request(BOB, PublicNoteApprovalRequestKind.Notifications, false, false),
      // Bob's chat message asked as the step was not the last: not this one.
      request(BOB, PublicNoteApprovalRequestKind.Chat, false, false),
      request(CAROL, PublicNoteApprovalRequestKind.Notifications, false, false),
      request(CAROL, PublicNoteApprovalRequestKind.Chat, true, false),
    ] as never);

    const asked: Map<string, unknown> = await PublicNoteApprovalRequests.readAsked(
      key({ isFinal: true }),
    );

    expect(asked.get(BOB.toString())).toEqual({
      notifications: true,
      chat: false,
    });
    expect(asked.get(CAROL.toString())).toEqual(ASK_BY_EVERYTHING);
  });

  test("the step asked again asks again by notifications: an earlier ask of it does not count", async () => {
    jest.spyOn(PublicNoteApprovalRequestService, "findForStep").mockResolvedValue([
      request(BOB, PublicNoteApprovalRequestKind.Notifications, false, false),
      request(BOB, PublicNoteApprovalRequestKind.Chat, true, false),
    ] as never);

    const asked: Map<string, unknown> = await PublicNoteApprovalRequests.readAsked(
      key({ isFinal: true, isAskedAgain: true }),
    );

    expect(asked.get(BOB.toString())).toEqual({
      notifications: false,
      chat: true,
    });
  });

  test("reads the step of the round, of the note, of the project", async () => {
    const find: jest.SpyInstance = jest
      .spyOn(PublicNoteApprovalRequestService, "findForStep")
      .mockResolvedValue([] as never);

    await PublicNoteApprovalRequests.readAsked(key());

    expect(find).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      noteId: NOTE_ID,
      submittedAt: "2026-11-09T09:00:00.000Z",
      stepId: "5e000000-0000-4000-8000-0000000000a1",
    });
  });
});

describe("release and releaseChat", () => {
  test("release takes back only what the claim gave", async () => {
    const release: jest.SpyInstance = jest
      .spyOn(PublicNoteApprovalRequestService, "release")
      .mockResolvedValue(1 as never);

    await PublicNoteApprovalRequests.release({
      key: key(),
      userId: BOB,
      claim: { notifications: false, chat: true },
    });

    expect(release.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      noteId: NOTE_ID,
      submittedAt: "2026-11-09T09:00:00.000Z",
      stepId: "5e000000-0000-4000-8000-0000000000a1",
      userIds: [BOB],
      rows: [
        {
          kind: PublicNoteApprovalRequestKind.Chat,
          isFinal: true,
          isAskedAgain: false,
        },
      ] as Array<PublicNoteApprovalRequestRow>,
    });
  });

  test("releaseChat takes back the chat requests of the message replaced, never the notifications'", async () => {
    const release: jest.SpyInstance = jest
      .spyOn(PublicNoteApprovalRequestService, "release")
      .mockResolvedValue(2 as never);

    await PublicNoteApprovalRequests.releaseChat({
      projectId: PROJECT_ID,
      noteId: NOTE_ID,
      submittedAt: "2026-11-09T09:00:00.000Z",
      stepId: "5e000000-0000-4000-8000-0000000000a1",
      isFinal: false,
      userIds: [BOB, CAROL],
    });

    expect(release.mock.calls[0]![0]).toMatchObject({
      userIds: [BOB, CAROL],
      rows: [
        {
          kind: PublicNoteApprovalRequestKind.Chat,
          isFinal: false,
          isAskedAgain: false,
        },
      ],
    });
  });

  test("releaseChat of nobody reads nothing", async () => {
    const release: jest.SpyInstance = jest.spyOn(
      PublicNoteApprovalRequestService,
      "release",
    );

    await PublicNoteApprovalRequests.releaseChat({
      projectId: PROJECT_ID,
      noteId: NOTE_ID,
      submittedAt: "x",
      stepId: "y",
      isFinal: false,
      userIds: [],
    });

    expect(release).not.toHaveBeenCalled();
  });

  test("both are best effort: a failure is logged, never thrown", async () => {
    jest
      .spyOn(PublicNoteApprovalRequestService, "release")
      .mockRejectedValue(new Error("down") as never);
    const error: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {
        return undefined;
      });

    await expect(
      PublicNoteApprovalRequests.release({
        key: key(),
        userId: BOB,
        claim: ASK_BY_EVERYTHING,
      }),
    ).resolves.toBeUndefined();
    await expect(
      PublicNoteApprovalRequests.releaseChat({
        projectId: PROJECT_ID,
        noteId: NOTE_ID,
        submittedAt: "x",
        stepId: "y",
        isFinal: true,
        userIds: [BOB],
      }),
    ).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("could not take back"),
      expect.anything(),
    );
  });
});

describe("record", () => {
  test("claims each person once, and counts what it wrote", async () => {
    const claim: jest.SpyInstance = jest
      .spyOn(PublicNoteApprovalRequestService, "claim")
      .mockResolvedValueOnce([
        PublicNoteApprovalRequestKind.Notifications,
        PublicNoteApprovalRequestKind.Chat,
      ] as never)
      .mockResolvedValueOnce([] as never);

    await expect(
      PublicNoteApprovalRequests.record({
        key: key(),
        userIds: [BOB.toString(), CAROL.toString(), BOB.toString()],
      }),
    ).resolves.toBe(2);

    expect(claim).toHaveBeenCalledTimes(2);
  });
});

describe("the channels a claim asks by", () => {
  test("everything, chat alone, or everything but chat", () => {
    expect(PublicNoteApprovalNotifications.getChannels(ASK_BY_EVERYTHING)).toBe(
      UserNotificationChannels.All,
    );
    expect(
      PublicNoteApprovalNotifications.getChannels({
        notifications: false,
        chat: true,
      }),
    ).toBe(UserNotificationChannels.ChatOnly);
    expect(
      PublicNoteApprovalNotifications.getChannels({
        notifications: true,
        chat: false,
      }),
    ).toBe(UserNotificationChannels.AllButChat);
  });
});
