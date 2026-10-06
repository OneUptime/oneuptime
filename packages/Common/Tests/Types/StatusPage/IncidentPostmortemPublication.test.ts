import IncidentPostmortemPublication, {
  IncidentPostmortemState,
  IncidentPostmortemStoredState,
  PostmortemNotificationAction,
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

describe("IncidentPostmortemPublication.getNotificationAction", () => {
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
        IncidentPostmortemPublication.getNotificationAction({
          stored: storedWith(status),
          written: PUBLISH,
        }),
      ).toBe(PostmortemNotificationAction.Queue);
    },
  );

  test.each([
    ["waiting for the job", StatusPageSubscriberNotificationStatus.Pending],
    ["being sent", StatusPageSubscriberNotificationStatus.InProgress],
  ])(
    "publishing does not queue one %s - it would go twice - but looks again once written, in case the run holding it skipped it",
    (_label: string, status: StatusPageSubscriberNotificationStatus) => {
      expect(IncidentPostmortemPublication.isOnItsWay(status)).toBe(true);
      expect(
        IncidentPostmortemPublication.getNotificationAction({
          stored: storedWith(status),
          written: PUBLISH,
        }),
      ).toBe(PostmortemNotificationAction.QueueIfSkippedMeanwhile);
    },
  );

  test.each([
    [
      "Pending, the API's way of sending it again",
      StatusPageSubscriberNotificationStatus.Success,
      "Pending",
    ],
    [
      "Skipped over a notification that went out",
      StatusPageSubscriberNotificationStatus.Success,
      "Skipped",
    ],
    [
      "Success over one that was skipped",
      StatusPageSubscriberNotificationStatus.Skipped,
      "Success",
    ],
  ])(
    "an update that sets the status to %s itself is left to it",
    (
      _label: string,
      stored: StatusPageSubscriberNotificationStatus,
      written: string,
    ) => {
      const update: {
        stored: IncidentPostmortemStoredState;
        written: Record<string, unknown>;
      } = {
        stored: storedWith(stored),
        written: {
          ...PUBLISH,
          subscriberNotificationStatusOnPostmortemPublished: written,
        },
      };

      expect(IncidentPostmortemPublication.isStatusSetByUpdate(update)).toBe(
        true,
      );
      expect(IncidentPostmortemPublication.getNotificationAction(update)).toBe(
        PostmortemNotificationAction.None,
      );
    },
  );

  test.each([
    StatusPageSubscriberNotificationStatus.Skipped,
    StatusPageSubscriberNotificationStatus.Success,
    StatusPageSubscriberNotificationStatus.Failed,
  ])(
    "the status written back as it is stored (%s) - a client writing the whole incident back - is no choice: the publish queues it",
    (status: StatusPageSubscriberNotificationStatus) => {
      const update: {
        stored: IncidentPostmortemStoredState;
        written: Record<string, unknown>;
      } = {
        stored: storedWith(status),
        written: {
          ...PUBLISH,
          subscriberNotificationStatusOnPostmortemPublished: status,
        },
      };

      expect(IncidentPostmortemPublication.isStatusSetByUpdate(update)).toBe(
        false,
      );
      expect(IncidentPostmortemPublication.getNotificationAction(update)).toBe(
        PostmortemNotificationAction.Queue,
      );
    },
  );

  test("an update that writes no status sets none", () => {
    expect(
      IncidentPostmortemPublication.isStatusSetByUpdate({
        stored: storedWith(StatusPageSubscriberNotificationStatus.Skipped),
        written: PUBLISH,
      }),
    ).toBe(false);
  });

  test("for an incident the read did not see, any status written is the caller's", () => {
    expect(
      IncidentPostmortemPublication.isStatusSetByUpdate({
        stored: undefined,
        written: {
          subscriberNotificationStatusOnPostmortemPublished: "Skipped",
        },
      }),
    ).toBe(true);
  });

  test("an update that does not publish it does nothing to it", () => {
    for (const written of [
      { postmortemNote: `${NOTE}\n\nFollow-ups.` },
      { postmortemNote: NOTE, showPostmortemOnStatusPage: true },
      { showPostmortemOnStatusPage: false },
    ]) {
      expect(
        IncidentPostmortemPublication.getNotificationAction({
          stored: storedWith(
            StatusPageSubscriberNotificationStatus.Success,
            shown(),
          ),
          written: written,
        }),
      ).toBe(PostmortemNotificationAction.None);
    }
  });

  test("Notify Subscribers plays no part: the job reads it when it would send", () => {
    for (const notify of [true, false]) {
      expect(
        IncidentPostmortemPublication.getNotificationAction({
          stored: storedWith(StatusPageSubscriberNotificationStatus.Skipped),
          written: {
            ...PUBLISH,
            notifySubscribersOnPostmortemPublished: notify,
          },
        }),
      ).toBe(PostmortemNotificationAction.Queue);
    }

    expect(
      IncidentPostmortemPublication.getNotificationAction({
        stored: storedWith(
          StatusPageSubscriberNotificationStatus.Skipped,
          shown(),
        ),
        written: { notifySubscribersOnPostmortemPublished: true },
      }),
    ).toBe(PostmortemNotificationAction.None);
  });

  test("an incident not read before the write is queued on what the update writes alone", () => {
    expect(
      IncidentPostmortemPublication.getNotificationAction({
        stored: undefined,
        written: { showPostmortemOnStatusPage: true, postmortemNote: NOTE },
      }),
    ).toBe(PostmortemNotificationAction.Queue);
    expect(
      IncidentPostmortemPublication.getNotificationAction({
        stored: undefined,
        written: { showPostmortemOnStatusPage: true },
      }),
    ).toBe(PostmortemNotificationAction.None);
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

describe("IncidentPostmortemPublication.isSwitchedOn", () => {
  test.each([
    ["true", true],
    ['the string "true" a hand-written API request may send', "true"],
    ['"TRUE" with spaces around it', " TRUE "],
  ] as Array<[string, unknown]>)(
    "%s switches it on, as Postgres stores it",
    (_label: string, value: unknown) => {
      expect(IncidentPostmortemPublication.isSwitchedOn(value)).toBe(true);
      expect(
        IncidentPostmortemPublication.isPublishedByUpdate({
          stored: hidden(),
          written: { showPostmortemOnStatusPage: value },
        }),
      ).toBe(true);
    },
  );

  test.each([
    ["false", false],
    ['"false"', "false"],
    ["null", null],
    ["1", 1],
    ['"yes"', "yes"],
  ] as Array<[string, unknown]>)(
    "%s does not",
    (_label: string, value: unknown) => {
      expect(IncidentPostmortemPublication.isSwitchedOn(value)).toBe(false);
    },
  );
});

describe("IncidentPostmortemPublication's messages", () => {
  test("the queued message says the postmortem was published and subscribers will hear", () => {
    expect(IncidentPostmortemPublication.queuedMessage).toBe(
      "Postmortem published. Subscribers will be notified shortly.",
    );
  });

  test("the skips read like the job's other skips", () => {
    expect(IncidentPostmortemPublication.noNoteMessage).toMatch(
      /Skipping notifications to subscribers\.$/,
    );
    expect(IncidentPostmortemPublication.noNoteMessage).toContain(
      "has no note",
    );
    // Kept word for word: it is what incidents already show.
    expect(IncidentPostmortemPublication.notShownMessage).toBe(
      "Incident is not set to show postmortem on status page. Skipping notifications to subscribers.",
    );
  });

  test("the skip for a hidden incident says what happens next, not that nothing will", () => {
    expect(IncidentPostmortemPublication.hiddenIncidentMessage).toBe(
      "Incident is hidden from status pages. Subscribers will be sent the postmortem when the incident is made visible on status pages.",
    );
    expect(IncidentPostmortemPublication.hiddenIncidentMessage).not.toContain(
      "Skipping",
    );
  });

  test("showing the incident queues it with its own reason", () => {
    expect(IncidentPostmortemPublication.shownQueuedMessage).toBe(
      "Incident made visible on status pages. Subscribers will be sent its postmortem shortly.",
    );
    expect(IncidentPostmortemPublication.shownQueuedMessage).not.toBe(
      IncidentPostmortemPublication.queuedMessage,
    );
  });

  test("the dashboard's words for a postmortem that waits for its incident", () => {
    expect(IncidentPostmortemPublication.hiddenIncidentLabel).toBe(
      "Not sent yet: incident hidden from status pages",
    );
    expect(IncidentPostmortemPublication.sendsOnShowDescription).toBe(
      "This incident's postmortem was published while the incident was hidden, so subscribers have not been sent it. Turning this on sends it to them.",
    );
  });
});

/*
 * A POSTMORTEM PUBLISHED WHILE ITS INCIDENT IS HIDDEN IS SENT WHEN THE
 * INCIDENT IS SHOWN. The status page shows a postmortem only on an incident
 * it shows - Visible on Status Page on, and not private - so the send job
 * skips one whose incident is hidden; the update that shows the incident is
 * when the status page first shows it (#4429 found it was never sent at all).
 */
describe("IncidentPostmortemPublication.isIncidentShown", () => {
  test("an incident switched on and not private is shown", () => {
    expect(
      IncidentPostmortemPublication.isIncidentShown({
        isVisibleOnStatusPage: true,
        isPrivate: false,
      }),
    ).toBe(true);
    expect(
      IncidentPostmortemPublication.isIncidentShown({
        isVisibleOnStatusPage: true,
      }),
    ).toBe(true);
  });

  test.each([
    ["switched off", { isVisibleOnStatusPage: false }],
    ["never set, as the job and the status page read it", {}],
    ["null", { isVisibleOnStatusPage: null }],
    [
      "private, whatever its switch says",
      { isVisibleOnStatusPage: true, isPrivate: true },
    ],
    [
      'private, as a hand-written "true"',
      { isVisibleOnStatusPage: true, isPrivate: "true" },
    ],
  ] as Array<[string, Record<string, unknown>]>)(
    "an incident %s is not",
    (_label: string, incident: Record<string, unknown>) => {
      expect(IncidentPostmortemPublication.isIncidentShown(incident)).toBe(
        false,
      );
    },
  );

  test("nothing read is not", () => {
    expect(IncidentPostmortemPublication.isIncidentShown(null)).toBe(false);
    expect(IncidentPostmortemPublication.isIncidentShown(undefined)).toBe(
      false,
    );
  });
});

describe("IncidentPostmortemPublication.mayShowIncident", () => {
  test.each([
    ["Visible on Status Page written as true", { isVisibleOnStatusPage: true }],
    [
      'Visible on Status Page written as a hand-written "true"',
      { isVisibleOnStatusPage: " TRUE " },
    ],
    ["Private Incident written as false", { isPrivate: false }],
    ["Private Incident written as null", { isPrivate: null }],
    [
      "the Settings form's save, showing it",
      { isVisibleOnStatusPage: true, isPrivate: false },
    ],
  ] as Array<[string, Record<string, unknown>]>)(
    "%s may show the incident",
    (_label: string, written: Record<string, unknown>) => {
      expect(IncidentPostmortemPublication.mayShowIncident(written)).toBe(true);
    },
  );

  test.each([
    [
      "Visible on Status Page written as false",
      { isVisibleOnStatusPage: false },
    ],
    // A switch written as null is stored as null, which reads as off.
    ["Visible on Status Page written as null", { isVisibleOnStatusPage: null }],
    /*
     * The Settings form sends both switches with every save: saving a hidden
     * incident, even one made not private, leaves it hidden.
     */
    [
      "the Settings form's save, keeping it hidden",
      { isVisibleOnStatusPage: false, isPrivate: false },
    ],
    [
      "Visible on Status Page written as null with Private Incident off",
      { isVisibleOnStatusPage: null, isPrivate: false },
    ],
    ["Private Incident written as true", { isPrivate: true }],
    [
      "both switches written to hide it",
      { isVisibleOnStatusPage: false, isPrivate: true },
    ],
    ["neither switch written", { title: "Renamed" }],
    [
      "the postmortem's own columns",
      { showPostmortemOnStatusPage: true, postmortemNote: NOTE },
    ],
  ] as Array<[string, Record<string, unknown>]>)(
    "%s does not",
    (_label: string, written: Record<string, unknown>) => {
      expect(IncidentPostmortemPublication.mayShowIncident(written)).toBe(
        false,
      );
    },
  );

  test("no update data shows nothing", () => {
    expect(IncidentPostmortemPublication.mayShowIncident(undefined)).toBe(
      false,
    );
    expect(IncidentPostmortemPublication.mayShowIncident(null)).toBe(false);
  });
});

describe("IncidentPostmortemPublication.isComparedBy", () => {
  test("an update that writes the postmortem, or may show the incident, has it compared", () => {
    for (const written of [
      { postmortemNote: NOTE },
      { showPostmortemOnStatusPage: true },
      { isVisibleOnStatusPage: true },
      { isPrivate: false },
    ]) {
      expect(IncidentPostmortemPublication.isComparedBy(written)).toBe(true);
    }
  });

  test("any other update does not", () => {
    for (const written of [
      { title: "Renamed" },
      { isVisibleOnStatusPage: false },
      { isVisibleOnStatusPage: false, isPrivate: false },
      { notifySubscribersOnPostmortemPublished: true },
      {},
    ]) {
      expect(IncidentPostmortemPublication.isComparedBy(written)).toBe(false);
    }
    expect(IncidentPostmortemPublication.isComparedBy(undefined)).toBe(false);
  });
});

describe("IncidentPostmortemPublication.isShownByUpdate", () => {
  const SHOW: Record<string, unknown> = { isVisibleOnStatusPage: true };

  test.each([
    ["switched off", { isVisibleOnStatusPage: false }],
    [
      "never set, which the status page reads as hidden",
      { isVisibleOnStatusPage: null },
    ],
    ["not read", {}],
  ] as Array<[string, Record<string, unknown>]>)(
    "an incident %s before the update is shown by switching it on",
    (_label: string, stored: Record<string, unknown>) => {
      expect(
        IncidentPostmortemPublication.isShownByUpdate({
          stored: { ...shown(), ...stored },
          written: SHOW,
        }),
      ).toBe(true);
    },
  );

  test("writing it back on an incident already shown is no change", () => {
    expect(
      IncidentPostmortemPublication.isShownByUpdate({
        stored: { ...shown(), isVisibleOnStatusPage: true, isPrivate: false },
        written: { isVisibleOnStatusPage: true, isPrivate: false },
      }),
    ).toBe(false);
  });

  test("a private incident switched on stays hidden: it is not shown", () => {
    expect(
      IncidentPostmortemPublication.isShownByUpdate({
        stored: { ...shown(), isVisibleOnStatusPage: false, isPrivate: true },
        written: SHOW,
      }),
    ).toBe(false);
  });

  test("a private incident switched on and made not private in one update is shown", () => {
    expect(
      IncidentPostmortemPublication.isShownByUpdate({
        stored: { ...shown(), isVisibleOnStatusPage: false, isPrivate: true },
        written: { isVisibleOnStatusPage: true, isPrivate: false },
      }),
    ).toBe(true);
  });

  test("an incident switched on while private is shown when it is made not private", () => {
    expect(
      IncidentPostmortemPublication.isShownByUpdate({
        stored: { ...shown(), isVisibleOnStatusPage: true, isPrivate: true },
        written: { isPrivate: false },
      }),
    ).toBe(true);
  });

  test("made private in the same update, it is not shown", () => {
    expect(
      IncidentPostmortemPublication.isShownByUpdate({
        stored: { ...shown(), isVisibleOnStatusPage: false },
        written: { isVisibleOnStatusPage: true, isPrivate: "true" },
      }),
    ).toBe(false);
  });

  test("hiding the incident, or leaving its switches alone, shows nothing", () => {
    for (const written of [
      { isVisibleOnStatusPage: false },
      { isPrivate: false },
      { postmortemNote: NOTE },
      {},
    ]) {
      expect(
        IncidentPostmortemPublication.isShownByUpdate({
          stored: { ...shown(), isVisibleOnStatusPage: false },
          written: written,
        }),
      ).toBe(false);
    }
  });

  test("an incident the read before the write did not see counts as hidden before", () => {
    expect(
      IncidentPostmortemPublication.isShownByUpdate({
        stored: undefined,
        written: SHOW,
      }),
    ).toBe(true);
  });
});

describe("IncidentPostmortemPublication.isHiddenIncidentSkip", () => {
  test("a skip because the incident was hidden is one", () => {
    expect(
      IncidentPostmortemPublication.isHiddenIncidentSkip({
        status: StatusPageSubscriberNotificationStatus.Skipped,
        message: IncidentPostmortemPublication.hiddenIncidentMessage,
      }),
    ).toBe(true);
  });

  test.each([
    [
      "in the words an earlier release used: its incident may have been shown since, its postmortem on the status page for a while",
      "Incident is not visible on status page. Skipping notifications to subscribers.",
    ],
    ["switched off", IncidentPostmortemPublication.notShownMessage],
    ["with no note", IncidentPostmortemPublication.noNoteMessage],
    [
      "with Notify Subscribers off",
      "Incident is not set to notify subscribers on postmortem published. Skipping notifications to subscribers.",
    ],
    [
      "with no monitors",
      "No monitors are attached to this incident. Skipping notifications to subscribers.",
    ],
    ["with no message", null],
  ] as Array<[string, string | null]>)(
    "a skip %s is not",
    (_label: string, message: string | null) => {
      expect(
        IncidentPostmortemPublication.isHiddenIncidentSkip({
          status: StatusPageSubscriberNotificationStatus.Skipped,
          message: message,
        }),
      ).toBe(false);
    },
  );

  test.each([
    StatusPageSubscriberNotificationStatus.Pending,
    StatusPageSubscriberNotificationStatus.InProgress,
    StatusPageSubscriberNotificationStatus.Success,
    StatusPageSubscriberNotificationStatus.Failed,
    null,
    undefined,
  ])(
    "a notification that is %s is not, whatever its message says",
    (status: StatusPageSubscriberNotificationStatus | null | undefined) => {
      expect(
        IncidentPostmortemPublication.isHiddenIncidentSkip({
          status: status,
          message: IncidentPostmortemPublication.hiddenIncidentMessage,
        }),
      ).toBe(false);
    },
  );

  test("nothing read is not", () => {
    expect(IncidentPostmortemPublication.isHiddenIncidentSkip(null)).toBe(
      false,
    );
    expect(IncidentPostmortemPublication.isHiddenIncidentSkip(undefined)).toBe(
      false,
    );
  });
});

describe("IncidentPostmortemPublication.getNotificationAction, for an update that shows the incident", () => {
  const SHOW: Record<string, unknown> = { isVisibleOnStatusPage: true };

  // As the read before the write sees an update that shows the incident.
  function hiddenIncident(
    overrides: Partial<IncidentPostmortemStoredState> = {},
  ): IncidentPostmortemStoredState {
    return {
      isVisibleOnStatusPage: false,
      isPrivate: false,
      subscriberNotificationStatusOnPostmortemPublished:
        StatusPageSubscriberNotificationStatus.Skipped,
      subscriberNotificationStatusMessageOnPostmortemPublished:
        IncidentPostmortemPublication.hiddenIncidentMessage,
      ...overrides,
    };
  }

  test("a notification skipped because the incident was hidden is looked at again once the incident is shown", () => {
    expect(
      IncidentPostmortemPublication.getNotificationAction({
        stored: hiddenIncident(),
        written: SHOW,
      }),
    ).toBe(PostmortemNotificationAction.QueueIfSkippedAsHidden);
  });

  test.each([
    ["waiting for the job", StatusPageSubscriberNotificationStatus.Pending],
    ["being sent", StatusPageSubscriberNotificationStatus.InProgress],
  ])(
    "so is one %s when the update read it: the run holding it may skip it as hidden",
    (_label: string, status: StatusPageSubscriberNotificationStatus) => {
      expect(
        IncidentPostmortemPublication.getNotificationAction({
          stored: hiddenIncident({
            subscriberNotificationStatusOnPostmortemPublished: status,
            subscriberNotificationStatusMessageOnPostmortemPublished:
              IncidentPostmortemPublication.queuedMessage,
          }),
          written: SHOW,
        }),
      ).toBe(PostmortemNotificationAction.QueueIfSkippedAsHidden);
    },
  );

  test("so is the notification of an incident the read before the write did not see: where it stands then decides", () => {
    expect(
      IncidentPostmortemPublication.getNotificationAction({
        stored: undefined,
        written: SHOW,
      }),
    ).toBe(PostmortemNotificationAction.QueueIfSkippedAsHidden);
  });

  test.each([
    ["was sent already", StatusPageSubscriberNotificationStatus.Success, null],
    [
      "failed - Retry is the way to send it again",
      StatusPageSubscriberNotificationStatus.Failed,
      "Not every subscriber was sent this notification.",
    ],
    [
      "was skipped with Notify Subscribers off",
      StatusPageSubscriberNotificationStatus.Skipped,
      "Incident is not set to notify subscribers on postmortem published. Skipping notifications to subscribers.",
    ],
    [
      "was skipped for an incident without monitors",
      StatusPageSubscriberNotificationStatus.Skipped,
      "No monitors are attached to this incident. Skipping notifications to subscribers.",
    ],
    [
      "was skipped when it was not published",
      StatusPageSubscriberNotificationStatus.Skipped,
      IncidentPostmortemPublication.notShownMessage,
    ],
    [
      "was skipped in an earlier release's words, which a migration left only on incidents shown since",
      StatusPageSubscriberNotificationStatus.Skipped,
      "Incident is not visible on status page. Skipping notifications to subscribers.",
    ],
  ] as Array<[string, StatusPageSubscriberNotificationStatus, string | null]>)(
    "a notification that %s stays as it is",
    (
      _label: string,
      status: StatusPageSubscriberNotificationStatus,
      message: string | null,
    ) => {
      expect(
        IncidentPostmortemPublication.getNotificationAction({
          stored: hiddenIncident({
            subscriberNotificationStatusOnPostmortemPublished: status,
            subscriberNotificationStatusMessageOnPostmortemPublished: message,
          }),
          written: SHOW,
        }),
      ).toBe(PostmortemNotificationAction.None);
    },
  );

  test("an incident already shown sends nothing when its switch is written back on", () => {
    expect(
      IncidentPostmortemPublication.getNotificationAction({
        stored: hiddenIncident({ isVisibleOnStatusPage: true }),
        written: SHOW,
      }),
    ).toBe(PostmortemNotificationAction.None);
  });

  test("a private incident switched on stays hidden, and sends nothing", () => {
    expect(
      IncidentPostmortemPublication.getNotificationAction({
        stored: hiddenIncident({ isPrivate: true }),
        written: SHOW,
      }),
    ).toBe(PostmortemNotificationAction.None);
  });

  test("a status the update sets itself is the caller's: nothing is queued over it", () => {
    expect(
      IncidentPostmortemPublication.getNotificationAction({
        stored: hiddenIncident(),
        written: {
          ...SHOW,
          subscriberNotificationStatusOnPostmortemPublished:
            StatusPageSubscriberNotificationStatus.Pending,
        },
      }),
    ).toBe(PostmortemNotificationAction.None);
  });

  test("the status written back as stored - the whole incident written back - is no choice: showing it still looks again", () => {
    expect(
      IncidentPostmortemPublication.getNotificationAction({
        stored: hiddenIncident(),
        written: {
          ...SHOW,
          subscriberNotificationStatusOnPostmortemPublished:
            StatusPageSubscriberNotificationStatus.Skipped,
        },
      }),
    ).toBe(PostmortemNotificationAction.QueueIfSkippedAsHidden);
  });

  test("published and shown in one update, it is the publish that queues it", () => {
    expect(
      IncidentPostmortemPublication.getNotificationAction({
        stored: hiddenIncident(hidden()),
        written: { ...SHOW, showPostmortemOnStatusPage: true },
      }),
    ).toBe(PostmortemNotificationAction.Queue);
  });

  test("Notify Subscribers plays no part: the job reads it when it would send", () => {
    for (const notify of [true, false]) {
      expect(
        IncidentPostmortemPublication.getNotificationAction({
          stored: hiddenIncident(),
          written: {
            ...SHOW,
            notifySubscribersOnPostmortemPublished: notify,
          },
        }),
      ).toBe(PostmortemNotificationAction.QueueIfSkippedAsHidden);
    }
  });
});

describe("IncidentPostmortemPublication.isDueOnceShown", () => {
  // Read again once the update that showed the incident is written.
  function readAgain(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      ...shown(),
      isVisibleOnStatusPage: true,
      isPrivate: false,
      subscriberNotificationStatusOnPostmortemPublished:
        StatusPageSubscriberNotificationStatus.Skipped,
      subscriberNotificationStatusMessageOnPostmortemPublished:
        IncidentPostmortemPublication.hiddenIncidentMessage,
      ...overrides,
    };
  }

  test("a postmortem waiting for its incident, with both on the status page now, is due", () => {
    expect(IncidentPostmortemPublication.isDueOnceShown(readAgain())).toBe(
      true,
    );
  });

  test.each([
    ["hidden again in the meantime", { isVisibleOnStatusPage: false }],
    ["private", { isPrivate: true }],
    ["taken off the status page", { showPostmortemOnStatusPage: false }],
    ["emptied", { postmortemNote: "  " }],
    [
      "queued already",
      {
        subscriberNotificationStatusOnPostmortemPublished:
          StatusPageSubscriberNotificationStatus.Pending,
      },
    ],
    [
      "skipped for another reason",
      {
        subscriberNotificationStatusMessageOnPostmortemPublished:
          IncidentPostmortemPublication.notShownMessage,
      },
    ],
  ] as Array<[string, Record<string, unknown>]>)(
    "one %s is not",
    (_label: string, overrides: Record<string, unknown>) => {
      expect(
        IncidentPostmortemPublication.isDueOnceShown(readAgain(overrides)),
      ).toBe(false);
    },
  );

  test("an incident gone is not", () => {
    expect(IncidentPostmortemPublication.isDueOnceShown(null)).toBe(false);
  });
});

describe("IncidentPostmortemPublication.isWaitingForIncidentToShow and isSentBySwitchingVisibilityOn", () => {
  function waiting(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      ...shown(),
      isVisibleOnStatusPage: false,
      isPrivate: false,
      notifySubscribersOnPostmortemPublished: true,
      subscriberNotificationStatusOnPostmortemPublished:
        StatusPageSubscriberNotificationStatus.Skipped,
      subscriberNotificationStatusMessageOnPostmortemPublished:
        IncidentPostmortemPublication.hiddenIncidentMessage,
      ...overrides,
    };
  }

  test("a hidden incident whose published postmortem was skipped because it was hidden waits for it, and switching it on sends it", () => {
    expect(
      IncidentPostmortemPublication.isWaitingForIncidentToShow(waiting()),
    ).toBe(true);
    expect(
      IncidentPostmortemPublication.isSentBySwitchingVisibilityOn(waiting()),
    ).toBe(true);
  });

  test("a note left unread is not known to be empty: the switch decides", () => {
    const unread: Record<string, unknown> = waiting();
    delete unread["postmortemNote"];

    expect(
      IncidentPostmortemPublication.isWaitingForIncidentToShow(unread),
    ).toBe(true);
    expect(
      IncidentPostmortemPublication.isSentBySwitchingVisibilityOn(unread),
    ).toBe(true);
  });

  test("a private incident waits too, but switching it on alone does not send it: it stays hidden", () => {
    expect(
      IncidentPostmortemPublication.isWaitingForIncidentToShow(
        waiting({ isPrivate: true }),
      ),
    ).toBe(true);
    expect(
      IncidentPostmortemPublication.isSentBySwitchingVisibilityOn(
        waiting({ isPrivate: true }),
      ),
    ).toBe(false);
  });

  test.each([
    [
      "shown on status pages - an earlier release showed it unsent",
      { isVisibleOnStatusPage: true },
    ],
    [
      "with Notify Subscribers off",
      { notifySubscribersOnPostmortemPublished: false },
    ],
    ["not published", { showPostmortemOnStatusPage: false }],
    ["with an empty note", { postmortemNote: "" }],
    [
      "already queued",
      {
        subscriberNotificationStatusOnPostmortemPublished:
          StatusPageSubscriberNotificationStatus.Pending,
      },
    ],
    [
      "skipped for another reason",
      {
        subscriberNotificationStatusMessageOnPostmortemPublished:
          IncidentPostmortemPublication.notShownMessage,
      },
    ],
    [
      "skipped in an earlier release's words",
      {
        subscriberNotificationStatusMessageOnPostmortemPublished:
          "Incident is not visible on status page. Skipping notifications to subscribers.",
      },
    ],
  ] as Array<[string, Record<string, unknown>]>)(
    "an incident %s does not",
    (_label: string, overrides: Record<string, unknown>) => {
      expect(
        IncidentPostmortemPublication.isWaitingForIncidentToShow(
          waiting(overrides),
        ),
      ).toBe(false);
      expect(
        IncidentPostmortemPublication.isSentBySwitchingVisibilityOn(
          waiting(overrides),
        ),
      ).toBe(false);
    },
  );

  test("nothing loaded does not", () => {
    expect(IncidentPostmortemPublication.isWaitingForIncidentToShow(null)).toBe(
      false,
    );
    expect(
      IncidentPostmortemPublication.isSentBySwitchingVisibilityOn(undefined),
    ).toBe(false);
  });
});
