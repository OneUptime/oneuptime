import IncidentPostmortemPublication, {
  IncidentPostmortemState,
  IncidentPostmortemStoredState,
} from "../../../Types/StatusPage/IncidentPostmortemPublication";
import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import { describe, expect, test } from "@jest/globals";

/*
 * When the status page shows an incident's postmortem, when an update
 * publishes it, and when that queues its subscriber notification. The server
 * queues the notification on these answers and the send job skips one the
 * status page would not show, so a wrong answer either emails every
 * subscriber of a status page again on every save, or never tells them at
 * all.
 */

const NOTE: string = "## What happened\n\nCheckout returned errors.";

function shown(note: string | null = NOTE): IncidentPostmortemState {
  return { showPostmortemOnStatusPage: true, postmortemNote: note };
}

function hidden(note: string | null = NOTE): IncidentPostmortemState {
  return { showPostmortemOnStatusPage: false, postmortemNote: note };
}

describe("IncidentPostmortemPublication.normalizeNote", () => {
  test("reads a note as the status page does: without the whitespace around it", () => {
    expect(IncidentPostmortemPublication.normalizeNote(`  ${NOTE}\n\n`)).toBe(
      NOTE,
    );
  });

  test("writes every line ending as \\n, so a note saved from Windows reads the same", () => {
    expect(
      IncidentPostmortemPublication.normalizeNote(
        "## What happened\r\n\r\nCheckout returned errors.",
      ),
    ).toBe(NOTE);
    expect(
      IncidentPostmortemPublication.normalizeNote(
        "## What happened\r\rCheckout returned errors.",
      ),
    ).toBe(NOTE);
  });

  test.each([
    ["null", null],
    ["undefined", undefined],
    ["an empty string", ""],
    ["whitespace", " \n\t "],
    ["a number", 42],
    ["an object", { note: NOTE }],
  ])("reads %s as no note", (_label: string, value: unknown) => {
    expect(IncidentPostmortemPublication.normalizeNote(value)).toBe("");
    expect(IncidentPostmortemPublication.hasNote(value)).toBe(false);
  });

  test("keeps what is inside the note as it is", () => {
    expect(
      IncidentPostmortemPublication.normalizeNote("a  b\n\n\n- c   d"),
    ).toBe("a  b\n\n\n- c   d");
  });
});

describe("IncidentPostmortemPublication.isPublished", () => {
  test("a postmortem switched on with a note is on the status page", () => {
    expect(IncidentPostmortemPublication.isPublished(shown())).toBe(true);
  });

  test("a postmortem switched off is not, whatever its note says", () => {
    expect(IncidentPostmortemPublication.isPublished(hidden())).toBe(false);
  });

  test.each([
    ["no note", null],
    ["an empty note", ""],
    ["a note of whitespace", "  \n  "],
  ])(
    "a postmortem switched on with %s is not: the status page shows nothing",
    (_label: string, note: string | null) => {
      expect(IncidentPostmortemPublication.isPublished(shown(note))).toBe(
        false,
      );
    },
  );

  test("only a real true counts as switched on", () => {
    expect(
      IncidentPostmortemPublication.isPublished({
        showPostmortemOnStatusPage: null,
        postmortemNote: NOTE,
      }),
    ).toBe(false);
    expect(
      IncidentPostmortemPublication.isPublished({
        showPostmortemOnStatusPage: "true" as unknown as boolean,
        postmortemNote: NOTE,
      }),
    ).toBe(false);
  });

  test("no postmortem at all is not published", () => {
    expect(IncidentPostmortemPublication.isPublished(undefined)).toBe(false);
    expect(IncidentPostmortemPublication.isPublished(null)).toBe(false);
  });
});

describe("IncidentPostmortemPublication.isWrittenBy", () => {
  test("names the two columns that decide what the status page shows", () => {
    expect([...IncidentPostmortemPublication.columns].sort()).toEqual([
      "postmortemNote",
      "showPostmortemOnStatusPage",
    ]);
  });

  test.each([
    ["the note", { postmortemNote: NOTE }],
    ["a cleared note", { postmortemNote: null }],
    ["an empty note", { postmortemNote: "" }],
    ["the switch on", { showPostmortemOnStatusPage: true }],
    ["the switch off", { showPostmortemOnStatusPage: false }],
  ] as Array<[string, Record<string, unknown>]>)(
    "an update that writes %s writes the postmortem",
    (_label: string, written: Record<string, unknown>) => {
      expect(IncidentPostmortemPublication.isWrittenBy(written)).toBe(true);
    },
  );

  test.each([
    ["nothing", {}],
    ["the title", { title: "Checkout errors" }],
    ["only the notify flag", { notifySubscribersOnPostmortemPublished: true }],
    ["only Published At", { postmortemPostedAt: new Date() }],
    ["only the attachments", { postmortemAttachments: [] }],
    [
      "the note as undefined, which writes nothing",
      { postmortemNote: undefined },
    ],
  ] as Array<[string, Record<string, unknown>]>)(
    "an update that writes %s does not",
    (_label: string, written: Record<string, unknown>) => {
      expect(IncidentPostmortemPublication.isWrittenBy(written)).toBe(false);
    },
  );

  test("no update data writes nothing", () => {
    expect(IncidentPostmortemPublication.isWrittenBy(undefined)).toBe(false);
    expect(IncidentPostmortemPublication.isWrittenBy(null)).toBe(false);
  });
});

describe("IncidentPostmortemPublication.getStateAfterUpdate", () => {
  test("takes each column the update writes, and the stored one otherwise", () => {
    expect(
      IncidentPostmortemPublication.getStateAfterUpdate({
        stored: hidden(),
        written: { showPostmortemOnStatusPage: true },
      }),
    ).toEqual(shown());

    expect(
      IncidentPostmortemPublication.getStateAfterUpdate({
        stored: shown(),
        written: { postmortemNote: "New" },
      }),
    ).toEqual(shown("New"));
  });

  test("a note written as null clears it", () => {
    expect(
      IncidentPostmortemPublication.getStateAfterUpdate({
        stored: shown(),
        written: { postmortemNote: null },
      }),
    ).toEqual(shown(null));
  });

  test("an incident not read before the write holds only what the update writes", () => {
    expect(
      IncidentPostmortemPublication.getStateAfterUpdate({
        stored: undefined,
        written: { showPostmortemOnStatusPage: true },
      }),
    ).toEqual(shown(null));
  });
});

describe("IncidentPostmortemPublication.isNoteChanged", () => {
  test("a different note is a change", () => {
    expect(
      IncidentPostmortemPublication.isNoteChanged({
        stored: shown(),
        written: { postmortemNote: `${NOTE}\n\nFollow-ups.` },
      }),
    ).toBe(true);
  });

  test("writing back the note the incident holds is not", () => {
    expect(
      IncidentPostmortemPublication.isNoteChanged({
        stored: shown(),
        written: { postmortemNote: NOTE },
      }),
    ).toBe(false);
  });

  test.each([
    ["with whitespace around it", `\n${NOTE}  \n`],
    ["with Windows line endings", NOTE.replace(/\n/g, "\r\n")],
  ])("the same note %s is not", (_label: string, note: string) => {
    expect(
      IncidentPostmortemPublication.isNoteChanged({
        stored: shown(),
        written: { postmortemNote: note },
      }),
    ).toBe(false);
  });

  test("clearing a note is a change, and so is writing one where there was none", () => {
    expect(
      IncidentPostmortemPublication.isNoteChanged({
        stored: shown(),
        written: { postmortemNote: null },
      }),
    ).toBe(true);
    expect(
      IncidentPostmortemPublication.isNoteChanged({
        stored: hidden(null),
        written: { postmortemNote: NOTE },
      }),
    ).toBe(true);
  });

  test("no note written as an empty note, or the other way round, is not", () => {
    expect(
      IncidentPostmortemPublication.isNoteChanged({
        stored: hidden(null),
        written: { postmortemNote: "" },
      }),
    ).toBe(false);
    expect(
      IncidentPostmortemPublication.isNoteChanged({
        stored: hidden(""),
        written: { postmortemNote: null },
      }),
    ).toBe(false);
  });

  test("an update that writes no note changes no note", () => {
    expect(
      IncidentPostmortemPublication.isNoteChanged({
        stored: shown(),
        written: { showPostmortemOnStatusPage: false },
      }),
    ).toBe(false);
  });

  test("a note written to an incident not read before the write counts as changed", () => {
    expect(
      IncidentPostmortemPublication.isNoteChanged({
        stored: undefined,
        written: { postmortemNote: NOTE },
      }),
    ).toBe(true);
  });
});

describe("IncidentPostmortemPublication.isPublishedByUpdate", () => {
  test.each([
    [
      "switching publishing on over a written note",
      hidden(),
      { showPostmortemOnStatusPage: true },
    ],
    [
      "writing the note and switching publishing on together",
      hidden(null),
      { showPostmortemOnStatusPage: true, postmortemNote: NOTE },
    ],
    [
      "writing the note of a postmortem switched on with none",
      shown(null),
      { postmortemNote: NOTE },
    ],
    [
      "the Edit Postmortem form saved with publishing switched on",
      hidden(),
      {
        postmortemNote: NOTE,
        postmortemAttachments: [],
        showPostmortemOnStatusPage: true,
        notifySubscribersOnPostmortemPublished: true,
      },
    ],
  ] as Array<[string, IncidentPostmortemState, Record<string, unknown>]>)(
    "%s publishes it",
    (
      _label: string,
      stored: IncidentPostmortemState,
      written: Record<string, unknown>,
    ) => {
      expect(
        IncidentPostmortemPublication.isPublishedByUpdate({ stored, written }),
      ).toBe(true);
    },
  );

  test.each([
    [
      "saving a published postmortem as it is",
      shown(),
      { postmortemNote: NOTE, showPostmortemOnStatusPage: true },
    ],
    [
      "editing a published postmortem",
      shown(),
      { postmortemNote: `${NOTE}\n\nFollow-ups.` },
    ],
    [
      "switching publishing off",
      shown(),
      { showPostmortemOnStatusPage: false },
    ],
    [
      "emptying the note of a published postmortem",
      shown(),
      { postmortemNote: "" },
    ],
    [
      "switching publishing on with no note",
      hidden(null),
      { showPostmortemOnStatusPage: true },
    ],
    [
      "writing the note of a postmortem switched off",
      hidden(null),
      { postmortemNote: NOTE },
    ],
    [
      "switching publishing on with a note of whitespace",
      hidden("   "),
      { showPostmortemOnStatusPage: true },
    ],
  ] as Array<[string, IncidentPostmortemState, Record<string, unknown>]>)(
    "%s does not",
    (
      _label: string,
      stored: IncidentPostmortemState,
      written: Record<string, unknown>,
    ) => {
      expect(
        IncidentPostmortemPublication.isPublishedByUpdate({ stored, written }),
      ).toBe(false);
    },
  );

  test("an incident not read before the write is published by an update that writes both", () => {
    expect(
      IncidentPostmortemPublication.isPublishedByUpdate({
        stored: undefined,
        written: { showPostmortemOnStatusPage: true, postmortemNote: NOTE },
      }),
    ).toBe(true);
    expect(
      IncidentPostmortemPublication.isPublishedByUpdate({
        stored: undefined,
        written: { showPostmortemOnStatusPage: true },
      }),
    ).toBe(false);
  });
});

describe("IncidentPostmortemPublication.shouldQueueNotification", () => {
  function storedWith(
    status: StatusPageSubscriberNotificationStatus | undefined,
    state: IncidentPostmortemState = hidden(),
  ): IncidentPostmortemStoredState {
    return {
      ...state,
      subscriberNotificationStatusOnPostmortemPublished: status,
    };
  }

  const PUBLISH: Record<string, unknown> = {
    showPostmortemOnStatusPage: true,
  };

  test.each([
    [
      "skipped when the incident was declared",
      StatusPageSubscriberNotificationStatus.Skipped,
    ],
    [
      "sent when it was published before",
      StatusPageSubscriberNotificationStatus.Success,
    ],
    [
      "failed when it was published before",
      StatusPageSubscriberNotificationStatus.Failed,
    ],
  ])(
    "publishing queues a notification %s",
    (_label: string, status: StatusPageSubscriberNotificationStatus) => {
      expect(
        IncidentPostmortemPublication.shouldQueueNotification({
          stored: storedWith(status),
          written: PUBLISH,
        }),
      ).toBe(true);
    },
  );

  test.each([
    ["waiting for the job", StatusPageSubscriberNotificationStatus.Pending],
    ["being sent", StatusPageSubscriberNotificationStatus.InProgress],
  ])(
    "publishing does not queue one %s: it is on its way, and would go twice",
    (_label: string, status: StatusPageSubscriberNotificationStatus) => {
      expect(IncidentPostmortemPublication.isOnItsWay(status)).toBe(true);
      expect(
        IncidentPostmortemPublication.shouldQueueNotification({
          stored: storedWith(status),
          written: PUBLISH,
        }),
      ).toBe(false);
    },
  );

  test.each([
    ["Pending, the API's way of sending it again", "Pending"],
    ["Skipped", "Skipped"],
    ["Success", "Success"],
  ])(
    "an update that sets the status to %s itself is left to it",
    (_label: string, status: string) => {
      expect(
        IncidentPostmortemPublication.shouldQueueNotification({
          stored: storedWith(StatusPageSubscriberNotificationStatus.Skipped),
          written: {
            ...PUBLISH,
            subscriberNotificationStatusOnPostmortemPublished: status,
          },
        }),
      ).toBe(false);
    },
  );

  test("an update that does not publish it queues nothing", () => {
    expect(
      IncidentPostmortemPublication.shouldQueueNotification({
        stored: storedWith(
          StatusPageSubscriberNotificationStatus.Success,
          shown(),
        ),
        written: { postmortemNote: `${NOTE}\n\nFollow-ups.` },
      }),
    ).toBe(false);
  });

  test("Notify Subscribers plays no part: the job reads it when it would send", () => {
    for (const notify of [true, false]) {
      expect(
        IncidentPostmortemPublication.shouldQueueNotification({
          stored: storedWith(StatusPageSubscriberNotificationStatus.Skipped),
          written: {
            ...PUBLISH,
            notifySubscribersOnPostmortemPublished: notify,
          },
        }),
      ).toBe(true);
    }

    expect(
      IncidentPostmortemPublication.shouldQueueNotification({
        stored: storedWith(
          StatusPageSubscriberNotificationStatus.Skipped,
          shown(),
        ),
        written: { notifySubscribersOnPostmortemPublished: true },
      }),
    ).toBe(false);
  });

  test("an incident not read before the write queues on what the update writes alone", () => {
    expect(
      IncidentPostmortemPublication.shouldQueueNotification({
        stored: undefined,
        written: { showPostmortemOnStatusPage: true, postmortemNote: NOTE },
      }),
    ).toBe(true);
  });

  test("Skipped, Success and Failed are settled, not on their way", () => {
    for (const status of [
      StatusPageSubscriberNotificationStatus.Skipped,
      StatusPageSubscriberNotificationStatus.Success,
      StatusPageSubscriberNotificationStatus.Failed,
      undefined,
      null,
    ]) {
      expect(IncidentPostmortemPublication.isOnItsWay(status)).toBe(false);
    }
  });
});

describe("IncidentPostmortemPublication's messages", () => {
  test("the queued message says the postmortem was published and subscribers will hear", () => {
    expect(IncidentPostmortemPublication.queuedMessage).toBe(
      "Postmortem published. Subscribers will be notified shortly.",
    );
  });

  test("the skip reads like the job's other skips", () => {
    expect(IncidentPostmortemPublication.noNoteMessage).toMatch(
      /Skipping notifications to subscribers\.$/,
    );
    expect(IncidentPostmortemPublication.noNoteMessage).toContain(
      "has no note",
    );
  });
});
