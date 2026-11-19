import { describe, expect, test } from "@jest/globals";
import AnnouncementReach from "../../../Types/StatusPage/AnnouncementReach";
import PickedStatusPagesReach, {
  PickedStatusPagesReachResult,
} from "../../../Types/StatusPage/PickedStatusPagesReach";
import PublicNoteReach, {
  PublicNoteNothingSentReason,
} from "../../../Types/StatusPage/PublicNoteReach";

/*
 * What a record on the status pages picked on its form does - an
 * announcement's (#9775), a maintenance event's and a template's (#9920):
 * whether a page picked shows it, whether it notifies anyone, and how the
 * answer travels - one of the pages' two reasons, or none; read so that an
 * answer the form cannot understand promises nothing. An announcement's
 * answer is this one, with what its Edit adds.
 */

function result(
  reason: PickedStatusPagesReachResult["nothingSentReason"],
): PickedStatusPagesReachResult {
  return { nothingSentReason: reason };
}

const REASONS: Array<PickedStatusPagesReachResult["nothingSentReason"]> = [
  null,
  PublicNoteNothingSentReason.NoStatusPages,
  PublicNoteNothingSentReason.NotificationsOff,
];

describe("what a reason means for the record", () => {
  test("the reasons mean what they mean for a public note, and an announcement: one rule", () => {
    for (const reason of REASONS) {
      expect(PickedStatusPagesReach.isShownOnAStatusPage(result(reason))).toBe(
        PublicNoteReach.isShownOnAStatusPage(result(reason)),
      );
      expect(PickedStatusPagesReach.isNotifying(result(reason))).toBe(
        PublicNoteReach.isNotifying(result(reason)),
      );
      expect(AnnouncementReach.isShownOnAStatusPage(result(reason))).toBe(
        PickedStatusPagesReach.isShownOnAStatusPage(result(reason)),
      );
    }
  });

  test("NotificationsOff shows it and tells no one; NoStatusPages shows it nowhere", () => {
    expect(
      PickedStatusPagesReach.isShownOnAStatusPage(
        result(PublicNoteNothingSentReason.NotificationsOff),
      ),
    ).toBe(true);
    expect(
      PickedStatusPagesReach.isNotifying(
        result(PublicNoteNothingSentReason.NotificationsOff),
      ),
    ).toBe(false);
    expect(
      PickedStatusPagesReach.isShownOnAStatusPage(
        result(PublicNoteNothingSentReason.NoStatusPages),
      ),
    ).toBe(false);
  });
});

describe("the answer as it travels", () => {
  test.each(REASONS)(
    "%s goes and comes back as it was, with nothing beside it",
    (reason: PickedStatusPagesReachResult["nothingSentReason"]) => {
      const json: ReturnType<typeof PickedStatusPagesReach.toJSON> =
        PickedStatusPagesReach.toJSON(result(reason));

      expect(json).toEqual({ nothingSentReason: reason });
      expect(PickedStatusPagesReach.fromJSON(json)).toEqual(result(reason));
    },
  );

  // A note's other reasons are an event's own, never the pages'.
  test.each([
    PublicNoteNothingSentReason.NoMonitors,
    PublicNoteNothingSentReason.HiddenFromStatusPages,
    PublicNoteNothingSentReason.NotPublishedYet,
  ])("%s is no reason the pages give: read as not known", (reason: string) => {
    expect(PickedStatusPagesReach.fromJSON({ nothingSentReason: reason })).toBe(
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
  ] as Array<[unknown]>)(
    "an answer that cannot be read promises nothing: %j",
    (json: unknown) => {
      expect(PickedStatusPagesReach.fromJSON(json)).toBeNull();
    },
  );

  test("the route is under each record's own API, and as many pages as one record can be on", () => {
    expect(PickedStatusPagesReach.routePath).toBe("/reach");
    expect(AnnouncementReach.routePath).toBe(PickedStatusPagesReach.routePath);
    expect(PickedStatusPagesReach.maxStatusPagesPerRequest).toBe(1000);
    expect(AnnouncementReach.maxStatusPagesPerRequest).toBe(
      PickedStatusPagesReach.maxStatusPagesPerRequest,
    );
  });
});
