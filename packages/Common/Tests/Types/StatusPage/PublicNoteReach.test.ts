import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../Types/JSON";
import PublicNoteReach, {
  PublicNoteNothingSentReason,
  PublicNoteReachResult,
} from "../../../Types/StatusPage/PublicNoteReach";
import { SubscriberNotificationPreviewNothingSentReason } from "../../../Types/StatusPage/SubscriberNotificationPreview";

/*
 * What a public note posted now does (#9735), as the server answers it and
 * the note composer reads it: whether a status page shows the note, whether
 * it notifies anyone, and how the answer travels - one reason, or none, and
 * nothing else; read so that an answer the dashboard cannot understand
 * promises nothing.
 */

const ALL_REASONS: Array<PublicNoteNothingSentReason> = Object.values(
  PublicNoteNothingSentReason,
);

function result(
  reason: PublicNoteNothingSentReason | null,
): PublicNoteReachResult {
  return { nothingSentReason: reason };
}

describe("what a reason means for the note", () => {
  test("no reason: the note is on a status page, and notifies its subscribers", () => {
    expect(PublicNoteReach.isShownOnAStatusPage(result(null))).toBe(true);
    expect(PublicNoteReach.isNotifying(result(null))).toBe(true);
  });

  test("NotificationsOff: the note is on the pages that show the event, and notifies no one", () => {
    const off: PublicNoteReachResult = result(
      PublicNoteNothingSentReason.NotificationsOff,
    );

    expect(PublicNoteReach.isShownOnAStatusPage(off)).toBe(true);
    expect(PublicNoteReach.isNotifying(off)).toBe(false);
  });

  test.each([
    PublicNoteNothingSentReason.NoMonitors,
    PublicNoteNothingSentReason.HiddenFromStatusPages,
    PublicNoteNothingSentReason.NotPublishedYet,
    PublicNoteNothingSentReason.NoStatusPages,
  ])(
    "%s: the note is on no status page, and notifies no one",
    (reason: PublicNoteNothingSentReason) => {
      expect(PublicNoteReach.isShownOnAStatusPage(result(reason))).toBe(false);
      expect(PublicNoteReach.isNotifying(result(reason))).toBe(false);
    },
  );

  test("every reason is one or the other: shown and quiet, or on no page", () => {
    const shownAndQuiet: Array<PublicNoteNothingSentReason> =
      ALL_REASONS.filter((reason: PublicNoteNothingSentReason): boolean => {
        return PublicNoteReach.isShownOnAStatusPage(result(reason));
      });

    expect(shownAndQuiet).toEqual([
      PublicNoteNothingSentReason.NotificationsOff,
    ]);
  });
});

describe("an incident's reason is its notification preview's", () => {
  /*
   * The four reasons a note on an incident that exists can have are the
   * preview's, by name: one rule decides both (#9684).
   */
  test.each([
    [null, null],
    [
      SubscriberNotificationPreviewNothingSentReason.NoMonitors,
      PublicNoteNothingSentReason.NoMonitors,
    ],
    [
      SubscriberNotificationPreviewNothingSentReason.HiddenFromStatusPages,
      PublicNoteNothingSentReason.HiddenFromStatusPages,
    ],
    [
      SubscriberNotificationPreviewNothingSentReason.NoStatusPages,
      PublicNoteNothingSentReason.NoStatusPages,
    ],
    [
      SubscriberNotificationPreviewNothingSentReason.NotificationsOff,
      PublicNoteNothingSentReason.NotificationsOff,
    ],
  ] as Array<
    [
      SubscriberNotificationPreviewNothingSentReason | null,
      PublicNoteNothingSentReason | null,
    ]
  >)(
    "%s reads as %s",
    (
      preview: SubscriberNotificationPreviewNothingSentReason | null,
      expected: PublicNoteNothingSentReason | null,
    ) => {
      expect(PublicNoteReach.fromPreviewReason(preview)).toEqual(
        result(expected),
      );

      if (preview !== null) {
        expect(String(expected)).toBe(String(preview));
      }
    },
  );

  /*
   * A declare's two reasons never come with a note; read by what each does
   * to a note all the same, they never promise a page or a subscriber.
   */
  test("a declare's reasons read by what they do to a note: private is on no page, notifying off tells no one", () => {
    const privateIncident: PublicNoteReachResult =
      PublicNoteReach.fromPreviewReason(
        SubscriberNotificationPreviewNothingSentReason.PrivateIncident,
      );
    const notifyOff: PublicNoteReachResult = PublicNoteReach.fromPreviewReason(
      SubscriberNotificationPreviewNothingSentReason.NotifyOff,
    );

    expect(PublicNoteReach.isShownOnAStatusPage(privateIncident)).toBe(false);
    expect(PublicNoteReach.isNotifying(privateIncident)).toBe(false);
    expect(PublicNoteReach.isNotifying(notifyOff)).toBe(false);
  });

  test("every preview reason has its reading", () => {
    for (const reason of Object.values(
      SubscriberNotificationPreviewNothingSentReason,
    )) {
      expect(
        ALL_REASONS.includes(
          PublicNoteReach.fromPreviewReason(reason)
            .nothingSentReason as PublicNoteNothingSentReason,
        ),
      ).toBe(true);
    }
  });
});

describe("how the answer travels", () => {
  test.each([null, ...ALL_REASONS])(
    "%s survives the trip to the dashboard",
    (reason: PublicNoteNothingSentReason | null) => {
      const json: JSONObject = JSON.parse(
        JSON.stringify(PublicNoteReach.toJSON(result(reason))),
      ) as JSONObject;

      expect(PublicNoteReach.fromJSON(json)).toEqual(result(reason));
    },
  );

  test("only the reason travels: no page, no name, no count", () => {
    expect(
      Object.keys(
        PublicNoteReach.toJSON(
          result(PublicNoteNothingSentReason.NotificationsOff),
        ),
      ),
    ).toEqual(["nothingSentReason"]);
  });

  /*
   * An answer the dashboard cannot read says nothing: read as "notifies",
   * a missing field would make the very promise this is here to keep honest.
   */
  test.each([
    [undefined],
    [null],
    ["NotificationsOff"],
    [[]],
    [{}],
    [{ nothingSentReason: undefined }],
    [{ nothingSentReason: "Nobody" }],
    [{ nothingSentReason: 3 }],
    [{ nothingSentReason: false }],
    [{ nothingSentReason: {} }],
  ] as Array<[unknown]>)(
    "%j is not understood, and reads as not known",
    (json: unknown) => {
      expect(PublicNoteReach.fromJSON(json)).toBeNull();
    },
  );

  test("a reason it knows, beside fields it does not, is read", () => {
    expect(
      PublicNoteReach.fromJSON({
        nothingSentReason: "NoStatusPages",
        statusPages: ["Site 03"],
      }),
    ).toEqual(result(PublicNoteNothingSentReason.NoStatusPages));
  });

  test("the route each event's API answers on", () => {
    expect(PublicNoteReach.routePath).toBe("/public-note-reach");
  });
});
