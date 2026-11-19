import { describe, expect, test } from "@jest/globals";
import AnnouncementReach, {
  AnnouncementReachResult,
} from "../../../Types/StatusPage/AnnouncementReach";
import PublicNoteReach, {
  PublicNoteNothingSentReason,
} from "../../../Types/StatusPage/PublicNoteReach";
import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";

/*
 * What an announcement on the status pages picked does (#9775), as the
 * server answers it and the announcement form reads it: whether a page
 * picked shows it, whether it notifies anyone, and how the answer travels -
 * one of the pages' two reasons, or none, and nothing else; read so that an
 * answer the form cannot understand promises nothing.
 */

function result(
  reason: AnnouncementReachResult["nothingSentReason"],
): AnnouncementReachResult {
  return { nothingSentReason: reason };
}

describe("what a reason means for the announcement", () => {
  test("no reason: a page picked shows it, and tells its subscribers", () => {
    expect(AnnouncementReach.isShownOnAStatusPage(result(null))).toBe(true);
    expect(AnnouncementReach.isNotifying(result(null))).toBe(true);
  });

  test("NotificationsOff: it shows on the pages picked that show announcements, and tells no one", () => {
    const off: AnnouncementReachResult = result(
      PublicNoteNothingSentReason.NotificationsOff,
    );

    expect(AnnouncementReach.isShownOnAStatusPage(off)).toBe(true);
    expect(AnnouncementReach.isNotifying(off)).toBe(false);
  });

  test("NoStatusPages: it shows nowhere, and tells no one", () => {
    const nowhere: AnnouncementReachResult = result(
      PublicNoteNothingSentReason.NoStatusPages,
    );

    expect(AnnouncementReach.isShownOnAStatusPage(nowhere)).toBe(false);
    expect(AnnouncementReach.isNotifying(nowhere)).toBe(false);
  });

  test("the reasons mean what they mean for a public note: one rule for both", () => {
    for (const reason of [
      null,
      PublicNoteNothingSentReason.NoStatusPages,
      PublicNoteNothingSentReason.NotificationsOff,
    ] as Array<AnnouncementReachResult["nothingSentReason"]>) {
      expect(AnnouncementReach.isShownOnAStatusPage(result(reason))).toBe(
        PublicNoteReach.isShownOnAStatusPage(result(reason)),
      );
      expect(AnnouncementReach.isNotifying(result(reason))).toBe(
        PublicNoteReach.isNotifying(result(reason)),
      );
    }
  });
});

describe("the answer as it travels", () => {
  test.each([
    null,
    PublicNoteNothingSentReason.NoStatusPages,
    PublicNoteNothingSentReason.NotificationsOff,
  ] as Array<AnnouncementReachResult["nothingSentReason"]>)(
    "%s goes and comes back as it was, with nothing beside it",
    (reason: AnnouncementReachResult["nothingSentReason"]) => {
      const json: ReturnType<typeof AnnouncementReach.toJSON> =
        AnnouncementReach.toJSON(result(reason));

      expect(json).toEqual({ nothingSentReason: reason });
      expect(AnnouncementReach.fromJSON(json)).toEqual(result(reason));
    },
  );

  /*
   * A note's other reasons are about an incident's monitors, its
   * visibility and a maintenance event's publish time: an announcement has
   * none of them, so an answer naming one is not understood.
   */
  test.each([
    PublicNoteNothingSentReason.NoMonitors,
    PublicNoteNothingSentReason.HiddenFromStatusPages,
    PublicNoteNothingSentReason.NotPublishedYet,
  ])("%s is no announcement's reason: read as not known", (reason: string) => {
    expect(AnnouncementReach.fromJSON({ nothingSentReason: reason })).toBe(
      null,
    );
  });

  test.each([
    [undefined],
    [null],
    [[]],
    ["NotificationsOff"],
    [{}],
    [{ nothingSentReason: "SomethingNew" }],
    [{ nothingSentReason: 3 }],
    [{ reason: null }],
  ] as Array<[unknown]>)(
    "an answer that cannot be read promises nothing: %j",
    (json: unknown) => {
      expect(AnnouncementReach.fromJSON(json)).toBeNull();
    },
  );

  test("the route is under the announcement's API", () => {
    expect(AnnouncementReach.routePath).toBe("/reach");
  });
});

/*
 * On the announcement's Edit the answer also says where the announcement's
 * own notification stands (#9921): the update job skips an update while it
 * has not gone out, and "Notify subscribers about this update" says so.
 */
describe("an Edit's answer: the announcement's own notification", () => {
  test.each(Object.values(StatusPageSubscriberNotificationStatus))(
    "%s goes and comes back beside the reason",
    (status: StatusPageSubscriberNotificationStatus) => {
      const answer: AnnouncementReachResult = {
        nothingSentReason: PublicNoteNothingSentReason.NotificationsOff,
        originalNotificationStatus: status,
      };

      const json: ReturnType<typeof AnnouncementReach.toJSON> =
        AnnouncementReach.toJSON(answer);

      expect(json).toEqual({
        nothingSentReason: "NotificationsOff",
        originalNotificationStatus: status,
      });
      expect(AnnouncementReach.fromJSON(json)).toEqual(answer);
    },
  );

  test("none stored travels as null", () => {
    const json: ReturnType<typeof AnnouncementReach.toJSON> =
      AnnouncementReach.toJSON({
        nothingSentReason: null,
        originalNotificationStatus: null,
      });

    expect(json).toEqual({
      nothingSentReason: null,
      originalNotificationStatus: null,
    });
    expect(AnnouncementReach.fromJSON(json)).toEqual({
      nothingSentReason: null,
      originalNotificationStatus: null,
    });
  });

  test("a Create's answer carries none: only the reason travels", () => {
    expect(
      Object.keys(AnnouncementReach.toJSON({ nothingSentReason: null })),
    ).toEqual(["nothingSentReason"]);
    expect(
      AnnouncementReach.fromJSON({ nothingSentReason: null }),
    ).not.toHaveProperty("originalNotificationStatus");
  });

  test.each([["SomethingNew"], [3], [{}], [true]] as Array<[unknown]>)(
    "a status it does not know is left out, and the pages' answer still stands: %j",
    (status: unknown) => {
      const read: AnnouncementReachResult | null = AnnouncementReach.fromJSON({
        nothingSentReason: "NoStatusPages",
        originalNotificationStatus: status,
      });

      expect(read).toEqual({
        nothingSentReason: PublicNoteNothingSentReason.NoStatusPages,
      });
      expect(read).not.toHaveProperty("originalNotificationStatus");
    },
  );

  test("a reason it cannot read still promises nothing, whatever the status", () => {
    expect(
      AnnouncementReach.fromJSON({
        nothingSentReason: "NotPublishedYet",
        originalNotificationStatus: "Pending",
      }),
    ).toBeNull();
  });
});
