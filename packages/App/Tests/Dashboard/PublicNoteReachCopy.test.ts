import PublicNoteReach, {
  PublicNoteNothingSentReason,
  PublicNoteReachResult,
} from "Common/Types/StatusPage/PublicNoteReach";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  getNotesCopy,
  NotesCopy,
} from "../../FeatureSet/Dashboard/src/Components/EventNotes/EventNotesUtil";
import {
  EDITED_NOTE_LEFT_QUIET,
  EDITED_NOTE_NOTIFIES_SUBSCRIBERS,
  getCreateNotifyDescriptions,
  getNothingSentSentences,
  getPublicNoteReachCopy,
  getPublicNotesCopyForReach,
  getUpdateNotifyDescriptions,
  NOTE_NOTIFIES_SUBSCRIBERS,
  NOTE_SHOWN_WITHOUT_NOTIFYING,
  NotifyDescriptions,
  PUBLIC_NOTE_REACH_COPY,
  PublicNoteReachEventCopy,
} from "../../FeatureSet/Dashboard/src/Components/EventNotes/PublicNoteReachCopy";
import SubscriberNotificationPreviewCopy from "../../FeatureSet/Dashboard/src/Components/StatusPage/SubscriberNotificationPreviewCopy";

/*
 * What the public note composer promises (#9735), worked out apart from
 * React (PublicNoteReachCopy): beside "Public", under "Notify status page
 * subscribers" ticked and unticked, under an edit's "Notify subscribers
 * about this update", and in the delete dialog - for an incident, an
 * episode and a maintenance event, for every answer the server can give
 * (Common/Types/StatusPage/PublicNoteReach), and while it has given none.
 *
 * The composer said "Visible on your status page" and "Subscribers will be
 * notified" of every event, also of one no status page shows. Now:
 *
 *   - "Visible on your status page", "Subscribers will be notified" and "The
 *     update will appear on your status page" only while a status page shows
 *     the event (and, for the notified, one that does notifies);
 *   - no page shows it: why, then "Any status page that starts showing this
 *     incident shows this note too, without notifying its subscribers." -
 *     #9684's sentences, word for word for an incident;
 *   - not known: no promise either way.
 *
 * And every sentence is worded in all 17 Dashboard languages.
 */

const EVENTS: Array<string> = ["incident", "episode", "maintenance event"];

const QUIET: string =
  "Unticked by default because status page subscribers were not notified when this incident was declared.";

const VISIBLE: string = "Visible on your status page";

const SHOWN_DELETE: string =
  "It will be removed from your status page. Subscribers who were already notified keep the message they received. This cannot be undone.";

const PRIVATE_DELETE: string =
  "The note will be permanently deleted. This cannot be undone.";

// The reasons that leave the note on no status page.
const NOT_SHOWN: Array<PublicNoteNothingSentReason> = [
  PublicNoteNothingSentReason.NoMonitors,
  PublicNoteNothingSentReason.HiddenFromStatusPages,
  PublicNoteNothingSentReason.NotPublishedYet,
  PublicNoteNothingSentReason.NoStatusPages,
];

function reach(
  reason: PublicNoteNothingSentReason | null,
): PublicNoteReachResult {
  return { nothingSentReason: reason };
}

const NOTIFIES: PublicNoteReachResult = reach(null);
const OFF: PublicNoteReachResult = reach(
  PublicNoteNothingSentReason.NotificationsOff,
);

// Every sentence of an event's copy.
function sentencesOf(copy: PublicNoteReachEventCopy): Array<string> {
  return [
    copy.notShownHint,
    copy.shownLater,
    ...Object.values(copy.nothingSent),
  ];
}

describe("an incident says what its notification preview says (#9684)", () => {
  const incident: PublicNoteReachEventCopy = getPublicNoteReachCopy("incident");

  test("each reason is the preview's sentence for a note, word for word", () => {
    expect(incident.nothingSent).toEqual({
      [PublicNoteNothingSentReason.NoMonitors]:
        "No monitors are attached. Subscribers hear about an incident through the monitors their status pages list.",
      [PublicNoteNothingSentReason.HiddenFromStatusPages]:
        "This incident is hidden from status pages.",
      [PublicNoteNothingSentReason.NotPublishedYet]:
        "No status page shows this incident yet.",
      [PublicNoteNothingSentReason.NoStatusPages]:
        "No status page shows this incident yet.",
      [PublicNoteNothingSentReason.NotificationsOff]:
        "The status pages that show this incident do not send notifications to their subscribers.",
    });
    expect(incident.nothingSent[PublicNoteNothingSentReason.NoMonitors]).toBe(
      SubscriberNotificationPreviewCopy.noMonitors,
    );
    expect(
      incident.nothingSent[PublicNoteNothingSentReason.HiddenFromStatusPages],
    ).toBe(SubscriberNotificationPreviewCopy.hiddenIncident);
    expect(
      incident.nothingSent[PublicNoteNothingSentReason.NoStatusPages],
    ).toBe(SubscriberNotificationPreviewCopy.noStatusPagesForNote);
    expect(
      incident.nothingSent[PublicNoteNothingSentReason.NotificationsOff],
    ).toBe(SubscriberNotificationPreviewCopy.notificationsOff);
    expect(incident.shownLater).toBe(
      SubscriberNotificationPreviewCopy.noteShownLater,
    );
  });

  test("the badge says the preview's sentence, without its full stop", () => {
    expect(incident.notShownHint).toBe(
      "No status page shows this incident yet",
    );
    expect(`${incident.notShownHint}.`).toBe(
      SubscriberNotificationPreviewCopy.noStatusPagesForNote,
    );
  });

  test("an event noun the composer does not know reads as an incident's", () => {
    expect(getPublicNoteReachCopy("security case")).toBe(incident);
  });
});

describe("an episode and a maintenance event say the same, each of itself", () => {
  test.each(["episode", "maintenance event"])(
    "the %s's sentences name it, and never an incident",
    (event: string) => {
      const copy: PublicNoteReachEventCopy = getPublicNoteReachCopy(event);

      for (const sentence of sentencesOf(copy)) {
        expect(sentence.toLowerCase()).toContain(`this ${event}`);
        expect(sentence).not.toMatch(/this incident/i);
      }
    },
  );

  test.each(EVENTS)(
    "the %s's badge is its 'no status page' sentence, without its full stop",
    (event: string) => {
      const copy: PublicNoteReachEventCopy = getPublicNoteReachCopy(event);

      expect(copy.notShownHint).not.toMatch(/[.!?]$/);
      expect(`${copy.notShownHint}.`).toBe(
        copy.nothingSent[PublicNoteNothingSentReason.NoStatusPages],
      );
    },
  );

  test.each(EVENTS)(
    "every %s sentence under the box is a whole sentence",
    (event: string) => {
      const copy: PublicNoteReachEventCopy = getPublicNoteReachCopy(event);

      for (const sentence of [
        copy.shownLater,
        ...Object.values(copy.nothingSent),
      ]) {
        expect(sentence).toMatch(/^[A-Z].*\.$/);
      }
    },
  );

  test("the later sentence is #9684's, for each event", () => {
    expect(getPublicNoteReachCopy("episode").shownLater).toBe(
      "Any status page that starts showing this episode shows this note too, without notifying its subscribers.",
    );
    expect(getPublicNoteReachCopy("maintenance event").shownLater).toBe(
      "Any status page that starts showing this maintenance event shows this note too, without notifying its subscribers.",
    );
  });

  test("a maintenance event, picked onto its pages, is never told it has no monitors", () => {
    const copy: PublicNoteReachEventCopy =
      getPublicNoteReachCopy("maintenance event");

    expect(copy.nothingSent[PublicNoteNothingSentReason.NoMonitors]).toBe(
      copy.nothingSent[PublicNoteNothingSentReason.NoStatusPages],
    );
    expect(copy.nothingSent[PublicNoteNothingSentReason.NotPublishedYet]).toBe(
      "This maintenance event is not published on status pages yet.",
    );
  });

  test("an episode hears about its incidents' monitors", () => {
    expect(
      getPublicNoteReachCopy("episode").nothingSent[
        PublicNoteNothingSentReason.NoMonitors
      ],
    ).toBe(
      "No monitors are attached to the incidents in this episode. Subscribers hear about an episode through the monitors their status pages list.",
    );
  });
});

describe("why nothing is sent, under the box", () => {
  test.each(EVENTS)(
    "%s: nothing to say while a note notifies",
    (event: string) => {
      expect(getNothingSentSentences(event, NOTIFIES)).toEqual([]);
    },
  );

  test.each(EVENTS)(
    "%s: shown and switched off, the reason alone - the note is on those pages already",
    (event: string) => {
      expect(getNothingSentSentences(event, OFF)).toEqual([
        getPublicNoteReachCopy(event).nothingSent[
          PublicNoteNothingSentReason.NotificationsOff
        ],
      ]);
    },
  );

  test.each(
    EVENTS.flatMap((event: string) => {
      return NOT_SHOWN.map(
        (
          reason: PublicNoteNothingSentReason,
        ): [string, PublicNoteNothingSentReason] => {
          return [event, reason];
        },
      );
    }),
  )(
    "%s, %s: why, then where the note shows later",
    (event: string, reason: PublicNoteNothingSentReason) => {
      const copy: PublicNoteReachEventCopy = getPublicNoteReachCopy(event);

      expect(getNothingSentSentences(event, reach(reason))).toEqual([
        copy.nothingSent[reason],
        copy.shownLater,
      ]);
    },
  );
});

describe("a new note's 'Notify status page subscribers'", () => {
  function describeFor(
    event: string,
    answer: PublicNoteReachResult | null,
    isNotifyingByDefault: boolean = true,
  ): NotifyDescriptions {
    return getCreateNotifyDescriptions({
      eventNoun: event,
      reach: answer,
      isNotifyingByDefault: isNotifyingByDefault,
      quietDescription: QUIET,
    });
  }

  test.each(EVENTS)(
    "%s, shown and notifies: the sentences it always said",
    (event: string) => {
      expect(describeFor(event, NOTIFIES)).toEqual({
        checked: [NOTE_NOTIFIES_SUBSCRIBERS],
        unchecked: [NOTE_SHOWN_WITHOUT_NOTIFYING],
      });
      expect(NOTE_NOTIFIES_SUBSCRIBERS).toBe(
        "Subscribers will be notified about this update as soon as you post it.",
      );
      expect(NOTE_SHOWN_WITHOUT_NOTIFYING).toBe(
        "The update will appear on your status page without notifying subscribers.",
      );
    },
  );

  test.each(EVENTS)(
    "%s, shown but every page switched off: ticked, why nobody is told; unticked, that it shows",
    (event: string) => {
      expect(describeFor(event, OFF)).toEqual({
        checked: [
          getPublicNoteReachCopy(event).nothingSent[
            PublicNoteNothingSentReason.NotificationsOff
          ],
        ],
        unchecked: [NOTE_SHOWN_WITHOUT_NOTIFYING],
      });
    },
  );

  test.each(
    EVENTS.flatMap((event: string) => {
      return NOT_SHOWN.map(
        (
          reason: PublicNoteNothingSentReason,
        ): [string, PublicNoteNothingSentReason] => {
          return [event, reason];
        },
      );
    }),
  )(
    "%s, %s: ticked or not, why it is on no page and where it shows later - never that it notifies or appears",
    (event: string, reason: PublicNoteNothingSentReason) => {
      const said: NotifyDescriptions = describeFor(event, reach(reason));
      const expected: Array<string> = getNothingSentSentences(
        event,
        reach(reason),
      );

      expect(said).toEqual({ checked: expected, unchecked: expected });

      for (const sentence of [...said.checked, ...said.unchecked]) {
        expect(sentence).not.toBe(NOTE_NOTIFIES_SUBSCRIBERS);
        expect(sentence).not.toBe(NOTE_SHOWN_WITHOUT_NOTIFYING);
      }
    },
  );

  test.each(EVENTS)(
    "%s, not known yet: no promise ticked, and nothing unticked",
    (event: string) => {
      expect(describeFor(event, null)).toEqual({ checked: [], unchecked: [] });
    },
  );

  describe("an event that started without notifying anyone", () => {
    test("shown: unticked, why it starts unticked; ticked, who is told", () => {
      expect(describeFor("incident", NOTIFIES, false)).toEqual({
        checked: [NOTE_NOTIFIES_SUBSCRIBERS],
        unchecked: [QUIET],
      });
      expect(describeFor("incident", OFF, false)).toEqual({
        checked: [
          getPublicNoteReachCopy("incident").nothingSent[
            PublicNoteNothingSentReason.NotificationsOff
          ],
        ],
        unchecked: [QUIET],
      });
    });

    test("not known: unticked, still why it starts unticked - that is true whatever the pages are", () => {
      expect(describeFor("incident", null, false)).toEqual({
        checked: [],
        unchecked: [QUIET],
      });
    });

    test("on no page: why not, ticked or not, in place of why it starts unticked", () => {
      expect(
        describeFor(
          "maintenance event",
          reach(PublicNoteNothingSentReason.NoStatusPages),
          false,
        ),
      ).toEqual({
        checked: [
          "No status page shows this maintenance event yet.",
          "Any status page that starts showing this maintenance event shows this note too, without notifying its subscribers.",
        ],
        unchecked: [
          "No status page shows this maintenance event yet.",
          "Any status page that starts showing this maintenance event shows this note too, without notifying its subscribers.",
        ],
      });
    });
  });
});

describe("an edit's 'Notify subscribers about this update'", () => {
  test.each(EVENTS)(
    "%s, notifies: the edited note goes out, marked as an update",
    (event: string) => {
      expect(
        getUpdateNotifyDescriptions({ eventNoun: event, reach: NOTIFIES }),
      ).toEqual({
        checked: [EDITED_NOTE_NOTIFIES_SUBSCRIBERS],
        unchecked: [EDITED_NOTE_LEFT_QUIET],
      });
    },
  );

  test.each(
    EVENTS.flatMap((event: string) => {
      return [...NOT_SHOWN, PublicNoteNothingSentReason.NotificationsOff].map(
        (
          reason: PublicNoteNothingSentReason,
        ): [string, PublicNoteNothingSentReason] => {
          return [event, reason];
        },
      );
    }),
  )(
    "%s, %s: ticked, why nobody gets it; unticked, the advice for a small fix",
    (event: string, reason: PublicNoteNothingSentReason) => {
      expect(
        getUpdateNotifyDescriptions({ eventNoun: event, reach: reach(reason) }),
      ).toEqual({
        checked: getNothingSentSentences(event, reach(reason)),
        unchecked: [EDITED_NOTE_LEFT_QUIET],
      });
    },
  );

  test("not known: no promise ticked", () => {
    expect(
      getUpdateNotifyDescriptions({ eventNoun: "episode", reach: null }),
    ).toEqual({ checked: [], unchecked: [EDITED_NOTE_LEFT_QUIET] });
  });
});

describe("beside 'Public', and in the delete dialog", () => {
  test.each(EVENTS)(
    "%s: a page shows it - the public notes' own words, untouched",
    (event: string) => {
      const copy: NotesCopy = getNotesCopy("public", event);

      for (const answer of [NOTIFIES, OFF]) {
        const said: NotesCopy = getPublicNotesCopyForReach({
          copy: copy,
          eventNoun: event,
          reach: answer,
        });

        expect(said).toBe(copy);
        expect(said.audienceHint).toBe(VISIBLE);
        expect(said.deleteDescription).toBe(SHOWN_DELETE);
      }
    },
  );

  test.each(
    EVENTS.flatMap((event: string) => {
      return NOT_SHOWN.map(
        (
          reason: PublicNoteNothingSentReason,
        ): [string, PublicNoteNothingSentReason] => {
          return [event, reason];
        },
      );
    }),
  )(
    "%s, %s: no page shows it yet, and deleting a note removes it from none",
    (event: string, reason: PublicNoteNothingSentReason) => {
      const said: NotesCopy = getPublicNotesCopyForReach({
        copy: getNotesCopy("public", event),
        eventNoun: event,
        reach: reach(reason),
      });

      expect(said.audienceHint).toBe(
        getPublicNoteReachCopy(event).notShownHint,
      );
      expect(said.deleteDescription).toBe(PRIVATE_DELETE);
      // The rest is the public notes' own.
      expect(said.audienceLabel).toBe("Public");
      expect(said.submitLabel).toBe("Post update");
    },
  );

  test.each(EVENTS)(
    "%s, not known: 'Public' alone, and a delete that promises no status page",
    (event: string) => {
      const said: NotesCopy = getPublicNotesCopyForReach({
        copy: getNotesCopy("public", event),
        eventNoun: event,
        reach: null,
      });

      expect(said.audienceHint).toBe("");
      expect(said.deleteDescription).toBe(PRIVATE_DELETE);
    },
  );
});

/*
 * Dashboard strings are looked up by their English text in each locale, so
 * a sentence with no entry reads English to everyone (Docs/ux/README.md#in
 * -every-language). Each is worded, not copied: no language reads one of
 * these in English.
 */
describe("every sentence the composer says of a status page is in every language", () => {
  const LOCALES_DIR: string = path.join(
    __dirname,
    "..",
    "..",
    "FeatureSet",
    "Dashboard",
    "src",
    "Locales",
  );

  const localeFiles: Array<string> = fs
    .readdirSync(LOCALES_DIR)
    .filter((name: string): boolean => {
      return name.endsWith(".json");
    });

  const SENTENCES: Array<string> = Array.from(
    new Set<string>([
      ...Object.values(PUBLIC_NOTE_REACH_COPY).flatMap(sentencesOf),
      NOTE_NOTIFIES_SUBSCRIBERS,
      NOTE_SHOWN_WITHOUT_NOTIFYING,
      EDITED_NOTE_NOTIFIES_SUBSCRIBERS,
      EDITED_NOTE_LEFT_QUIET,
      VISIBLE,
      PRIVATE_DELETE,
    ]),
  );

  const HINTS: Array<string> = Object.values(PUBLIC_NOTE_REACH_COPY).map(
    (copy: PublicNoteReachEventCopy): string => {
      return copy.notShownHint;
    },
  );

  function read(file: string): Record<string, unknown> {
    return JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
    ) as Record<string, unknown>;
  }

  test("there are 17 languages, English and 16 more", () => {
    expect(localeFiles).toHaveLength(18);
    expect(localeFiles).toContain("en.json");
  });

  test.each(localeFiles)("%s has every sentence", (file: string) => {
    const locale: Record<string, unknown> = read(file);
    const missing: Array<string> = SENTENCES.filter((text: string): boolean => {
      return typeof locale[text] !== "string" || !locale[text];
    });

    expect(missing).toEqual([]);
  });

  test.each(
    localeFiles.filter((file: string): boolean => {
      return file !== "en.json";
    }),
  )("%s words every sentence in its own language", (file: string) => {
    const locale: Record<string, unknown> = read(file);
    const english: Array<string> = SENTENCES.filter((text: string): boolean => {
      return locale[text] === text;
    });

    expect(english).toEqual([]);
  });

  /*
   * Beside "Public" a hint is a phrase, as "Visible on your status page" is,
   * and under the box each is a sentence: a language keeps the difference.
   */
  test.each(localeFiles)(
    "%s ends a badge's phrase without a sentence's mark, and a sentence with one",
    (file: string) => {
      const locale: Record<string, unknown> = read(file);

      for (const hint of HINTS) {
        expect(String(locale[hint])).not.toMatch(/[.。।!?؟]$/);
      }

      for (const copy of Object.values(PUBLIC_NOTE_REACH_COPY)) {
        for (const sentence of [
          copy.shownLater,
          ...Object.values(copy.nothingSent),
        ]) {
          expect(String(locale[sentence])).toMatch(/[.。।]$/);
        }
      }
    },
  );

  test.each(localeFiles)(
    "%s's badge phrase is its own 'no status page' sentence, for each event",
    (file: string) => {
      const locale: Record<string, unknown> = read(file);

      for (const copy of Object.values(PUBLIC_NOTE_REACH_COPY)) {
        const sentence: string = String(
          locale[copy.nothingSent[PublicNoteNothingSentReason.NoStatusPages]],
        );
        const hint: string = String(locale[copy.notShownHint]);

        // The sentence, less its mark - or, in Korean, its polite ending.
        if (file === "ko.json") {
          expect(sentence.startsWith(hint.replace(/음$/, ""))).toBe(true);
          continue;
        }

        expect(sentence.replace(/[.。।]$/, "")).toBe(hint);
      }
    },
  );
});

/*
 * The hook writes its route out, so the tenant-header sweep
 * (ProjectScopedApiTenantHeader.test.ts) sees it: the route it writes is
 * the one each event's API registers.
 */
describe("the composer asks on the route the server answers", () => {
  test("usePublicNoteReach writes the route PublicNoteReach names", () => {
    const source: string = fs
      .readFileSync(
        path.join(
          __dirname,
          "..",
          "..",
          "FeatureSet",
          "Dashboard",
          "src",
          "Components",
          "EventNotes",
          "usePublicNoteReach.ts",
        ),
        "utf8",
      )
      .replace(/\s+/g, " ");

    expect(source).toContain(
      `.addRoute( \`\${request.apiPath}${PublicNoteReach.routePath}\`, )`,
    );
    expect(source).toContain("headers: ModelAPI.getCommonHeaders(),");
    expect(source).toContain("data: { eventId: request.eventId.toString(), },");
  });
});
