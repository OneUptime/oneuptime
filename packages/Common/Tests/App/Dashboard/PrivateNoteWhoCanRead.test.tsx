import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import React from "react";
import NoteComposer from "../../../../App/FeatureSet/Dashboard/src/Components/EventNotes/NoteComposer";
import {
  EVENT_NOTE_NOUNS,
  getNotesCopy,
  PRIVATE_NOTE_AUDIENCE_HINTS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventNotes/EventNotesUtil";
import {
  EVENT_STATE_KINDS,
  EventStateKind,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventStateKinds";
import { SubscriberFormCopy } from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/SubscriberFormChoices";
import { SubscriberRestrictionsCopy } from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/SubscriberRestrictionsCopy";
import { REACTION_PRIVATE_NOTE_LINES } from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/WorkspaceReactionNotesTips";
import { AI_ACTION_CARD_LINES } from "../../../Types/AI/AIActionWords";
import { getInlineSeparator } from "../../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * WHO CAN READ A PRIVATE NOTE, AS THE DASHBOARD SAYS IT (#7595).
 *
 * The private note composer said "Private · Only your team can see this",
 * and "team" read as one of OneUptime's Teams: a customer took it to mean
 * the members of a Team. A private note is read through its event
 * (@CanAccessIfCanReadOn), so the people who can read it are the people who
 * can see the event - on a private incident, alert or episode its owners
 * and the project's owners and admins. Every sentence that said a private
 * or internal note was for "your team" now says who can read it:
 *
 *   - the composer's badge names the event each feed is for, as each
 *     language words it, and is never cut (it wraps on a phone);
 *   - the alert and episode state change dialogs, a pin's line on the Slack
 *     and Microsoft Teams pages, OneUptime AI's card, a subscriber's
 *     Internal Note and the no-sign-in line of Who Can Subscribe say it too;
 *   - the private feed's header, its empty state, the composer's prompt and
 *     the editor's placeholder under the badge no longer say "your team"
 *     either, and the empty state no longer says "people in your project";
 *   - every one of those sentences is worded in all seventeen languages,
 *     none says a team, and the old sentences are gone from every file.
 */

// The languages the composer is drawn in here: two Latin, one right to left.
const RENDERED_LANGUAGES: ReadonlyArray<string> = ["en", "de", "ar"];

/*
 * The event each feed is for, as each drawn language's badge names it - not
 * the shared noun: each sentence is a whole key, worded its own way.
 */
const EVENT_WORDS: Record<string, Record<string, string>> = {
  en: {
    incident: "this incident",
    alert: "this alert",
    episode: "this episode",
    "scheduled maintenance event": "this maintenance event",
  },
  de: {
    incident: "diesen Vorfall",
    alert: "diese Warnung",
    episode: "diese Episode",
    "scheduled maintenance event": "dieses Wartungsereignis",
  },
  ar: {
    incident: "هذه الحادثة",
    alert: "هذا التنبيه",
    episode: "هذه الحلقة",
    "scheduled maintenance event": "حدث الصيانة هذا",
  },
};

// A team, as each language said it in the old sentences.
const TEAM_WORDS: Record<string, string> = {
  en: "team",
  de: "Team",
  fr: "équipe",
  es: "equipo",
  it: "team",
  pt: "equipe",
  nl: "team",
  da: "team",
  no: "team",
  sv: "team",
  ru: "команд",
  hi: "टीम",
  ja: "チーム",
  ko: "팀",
  "zh-CN": "团队",
  "zh-TW": "團隊",
  fa: "تیم",
  ar: "فريق",
};

// What the old badge said in each language: the negative control.
const OLD_BADGE: Record<string, string> = {
  ar: "لا يرى هذا إلا فريقك",
  da: "Kun dit team kan se dette",
  de: "Nur Ihr Team kann das sehen",
  es: "Solo tu equipo puede ver esto",
  fa: "فقط تیم شما این را می‌بیند",
  fr: "Seule votre équipe peut voir ceci",
  hi: "इसे सिर्फ़ आपकी टीम देख सकती है",
  it: "Solo il tuo team può vederlo",
  ja: "チームのメンバーだけが閲覧できます",
  ko: "팀만 볼 수 있습니다",
  nl: "Alleen uw team kan dit zien",
  no: "Bare teamet ditt kan se dette",
  pt: "Só sua equipe pode ver isto",
  ru: "Это видит только ваша команда",
  sv: "Bara ditt team kan se detta",
  "zh-CN": "只有你的团队能看到",
  "zh-TW": "只有你的團隊能看到",
};

function saysTeam(language: string, text: string): boolean {
  return text.toLowerCase().includes(TEAM_WORDS[language]!.toLowerCase());
}

// The English sentences the change took out: keys of every locale file once.
const OLD_KEYS: ReadonlyArray<string> = [
  "Only your team can see this",
  "Add an optional private note about this state change. Only your team can see it.",
  "Add an optional private note about this state change. Only your team can see it, and the same note is added to every alert you selected.",
  "Add an optional private note about this state change. Only your team can see it, and the same note is added to every episode you selected.",
  "- 📌 **Pin** (📌, 📍) - React with a pin to save the message as a **private note** (visible only to your team).",
  "Only your team sees it.",
  "Private note added, for your team only",
  "This page has no sign-in, so while this is on, only your team can add subscribers.",
  "Internal notes for your team about this {{event}}. They are never shown on a status page or sent to subscribers.",
  "Capture what your team learns while working on this {{event}}. Only people in your project can see private notes.",
  "Write a note for your team…",
  "Share findings, decisions and next steps with your team.",
];

/*
 * The private feed's header and empty state, as en.json keys: getNotesCopy
 * hands them back with the event already filled in.
 */
const PRIVATE_FEED_SENTENCES: ReadonlyArray<string> = [
  "Internal notes about this {{event}}. They are never shown on a status page or sent to subscribers.",
  "Capture what you learn while working on this {{event}}. Only people who can see it can read these notes.",
];

// Every sentence the change words, as en.json keys, each once.
const NEW_KEYS: ReadonlyArray<string> = Array.from(
  new Set<string>([
    ...Object.values(PRIVATE_NOTE_AUDIENCE_HINTS),
    ...PRIVATE_FEED_SENTENCES,
    getNotesCopy("private", "incident").composerPrompt,
    getNotesCopy("private", "incident").composerPlaceholder,
    EVENT_STATE_KINDS[EventStateKind.Alert].words.rowNoteDescription,
    EVENT_STATE_KINDS[EventStateKind.Alert].words.bulkNoteDescription,
    EVENT_STATE_KINDS[EventStateKind.IncidentEpisode].words.bulkNoteDescription,
    EVENT_STATE_KINDS[EventStateKind.AlertEpisode].words.bulkNoteDescription,
    ...Object.values(REACTION_PRIVATE_NOTE_LINES),
    AI_ACTION_CARD_LINES.privateNoteAddedToIncident,
    AI_ACTION_CARD_LINES.privateNoteAddedToAlert,
    SubscriberFormCopy.internalNoteDescription,
    SubscriberRestrictionsCopy.privateUsersOnlyNoSignInNote,
  ]),
);

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: readDashboardLocale("en") },
      de: { translation: readDashboardLocale("de") },
      ar: { translation: readDashboardLocale("ar") },
    },
    interpolation: { escapeValue: false },
  });
});

afterEach(async () => {
  cleanup();
  await act(async (): Promise<void> => {
    await i18next.changeLanguage("en");
  });
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

async function inLanguage(language: string): Promise<void> {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage(language);
  });
}

// What `language`'s Dashboard draws for an English key.
function drawn(language: string, key: string): string {
  return language === "en" ? key : readDashboardLocale(language)[key]!;
}

function renderComposer(visibility: "public" | "private", noun: string): void {
  render(
    <NoteComposer
      mode="create"
      visibility={visibility}
      copy={getNotesCopy(visibility, noun)}
      values={{
        note: "",
        attachments: [],
        shouldNotify: false,
        postedAt: null,
      }}
      onChange={() => {}}
      editorKey="editor"
      isAttachmentsEnabled={false}
      isPostedAtEditable={false}
      isSubmitting={false}
      onSubmit={() => {}}
    />,
  );
}

describe("the private note composer says who can read the note, naming its event", () => {
  const cases: Array<[string, string]> = RENDERED_LANGUAGES.flatMap(
    (language: string): Array<[string, string]> => {
      return EVENT_NOTE_NOUNS.map((noun: string): [string, string] => {
        return [language, noun];
      });
    },
  );

  test.each(cases)(
    "%s, on the private notes of the %s",
    async (language: string, noun: string) => {
      await inLanguage(language);
      renderComposer("private", noun);

      const badge: HTMLElement = screen.getByTestId("note-audience");
      const hint: HTMLElement = screen.getByTestId("note-audience-hint");
      const sentence: string = drawn(
        language,
        PRIVATE_NOTE_AUDIENCE_HINTS[noun]!,
      );

      expect(hint.textContent).toBe(sentence);
      expect(sentence).toContain(EVENT_WORDS[language]![noun]!);
      // "Private", the mark between, and the sentence: as a reader sees it.
      expect(badge.textContent).toBe(
        `${drawn(language, "Private")}${getInlineSeparator(language).trim()}${sentence}`,
      );
      expect(saysTeam(language, badge.textContent || "")).toBe(false);

      if (language !== "en") {
        // No English is left in it.
        expect(badge.textContent).not.toContain(
          PRIVATE_NOTE_AUDIENCE_HINTS[noun]!,
        );
        expect(badge.textContent).not.toContain("Private");
      }

      if (language === "ar") {
        expect(badge.textContent).not.toMatch(/[A-Za-z]/);
      }
    },
  );

  test("each event's sentence is its own, in every drawn language", async () => {
    for (const language of RENDERED_LANGUAGES) {
      await inLanguage(language);

      const sentences: Array<string> = [];

      for (const noun of EVENT_NOTE_NOUNS) {
        renderComposer("private", noun);
        sentences.push(screen.getByTestId("note-audience-hint").textContent!);
        cleanup();
      }

      expect(new Set(sentences).size).toBe(EVENT_NOTE_NOUNS.length);
    }
  });

  /*
   * The sentence is longer than the one it replaced, and a phone or a
   * longer language cannot fit it on one line beside the lock: the badge
   * wraps it instead of cutting it off.
   */
  test("the badge wraps the sentence: nothing in it is cut off", async () => {
    await inLanguage("de");
    renderComposer("private", "scheduled maintenance event");

    const badge: HTMLElement = screen.getByTestId("note-audience");
    const hint: HTMLElement = screen.getByTestId("note-audience-hint");

    for (const element of [badge, ...Array.from(badge.querySelectorAll("*"))]) {
      const classes: Array<string> = Array.from(element.classList);

      expect(classes).not.toContain("truncate");
      expect(classes).not.toContain("whitespace-nowrap");
      expect(classes).not.toContain("overflow-hidden");
    }

    expect(badge).toHaveClass("max-w-full", "min-w-0");
    expect(hint.parentElement).toHaveClass("break-words", "min-w-0");
    // The lock keeps its size beside a sentence of two lines.
    expect(badge.querySelector("svg")).toHaveClass("shrink-0");
  });

  test("a public note's badge still says where it is shown", async () => {
    for (const language of RENDERED_LANGUAGES) {
      await inLanguage(language);

      for (const noun of ["incident", "scheduled maintenance event"]) {
        renderComposer("public", noun);

        expect(screen.getByTestId("note-audience-hint").textContent).toBe(
          drawn(language, "Visible on your status page"),
        );
        cleanup();
      }
    }
  });
});

describe("every sentence that says who reads a private or internal note, in every language", () => {
  test("there are nineteen of them, each saying who can read, never a team", () => {
    expect(NEW_KEYS).toHaveLength(19);

    for (const key of NEW_KEYS) {
      expect({
        key: key,
        isEnglishKey: readDashboardLocale("en")[key] === key,
        saysTeam: saysTeam("en", key),
      }).toEqual({ key: key, isEnglishKey: true, saysTeam: false });
    }
  });

  test.each([...DASHBOARD_LANGUAGES])(
    "%s words each one its own way, and none says a team",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const key of NEW_KEYS) {
        const value: string = words[key] || "";

        expect({
          key: key,
          value: value,
          worded: isWordedInDashboardLocale(key, language),
          saysTeam: saysTeam(language, value),
          placeholders: placeholdersOf(value),
        }).toEqual({
          key: key,
          value: value,
          worded: true,
          saysTeam: false,
          placeholders: placeholdersOf(key),
        });
      }

      // Each event's badge sentence is its own in this language too.
      const hints: Array<string> = Object.values(
        PRIVATE_NOTE_AUDIENCE_HINTS,
      ).map((key: string): string => {
        return words[key] || "";
      });

      expect(new Set(hints).size).toBe(hints.length);
    },
  );

  /*
   * The negative control: the checks above fail on the old words. The
   * team scan finds a team in the old badge of every language, and a key
   * no file holds any more is not worded in any of them.
   */
  test("the checks catch the old words", () => {
    expect(Object.keys(OLD_BADGE).sort()).toEqual(
      [...DASHBOARD_LANGUAGES].sort(),
    );

    for (const [language, sentence] of Object.entries(OLD_BADGE)) {
      expect({
        language: language,
        saysTeam: saysTeam(language, sentence),
      }).toEqual({ language: language, saysTeam: true });
    }

    for (const key of OLD_KEYS) {
      expect(saysTeam("en", key)).toBe(true);

      for (const language of DASHBOARD_LANGUAGES) {
        expect(isWordedInDashboardLocale(key, language)).toBe(false);
      }
    }
  });

  test("the old sentences are gone from every locale file", () => {
    for (const language of ["en", ...DASHBOARD_LANGUAGES]) {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const key of OLD_KEYS) {
        expect({ language: language, key: key, kept: key in words }).toEqual({
          language: language,
          key: key,
          kept: false,
        });
      }

      // Nor does the old badge live on under another key.
      if (language !== "en") {
        expect(Object.values(words)).not.toContain(OLD_BADGE[language]);
      }
    }
  });

  test("OneUptime AI's card names the record its note is on, in German and Arabic too", () => {
    expect(AI_ACTION_CARD_LINES.privateNoteAddedToIncident).toBe(
      "Private note added, only for people who can see the incident",
    );
    expect(AI_ACTION_CARD_LINES.privateNoteAddedToAlert).toBe(
      "Private note added, only for people who can see the alert",
    );
    expect(
      drawn("de", AI_ACTION_CARD_LINES.privateNoteAddedToIncident),
    ).toContain("den Vorfall");
    expect(drawn("de", AI_ACTION_CARD_LINES.privateNoteAddedToAlert)).toContain(
      "die Warnung",
    );
    expect(
      drawn("ar", AI_ACTION_CARD_LINES.privateNoteAddedToIncident),
    ).toContain("الحادثة");
    expect(drawn("ar", AI_ACTION_CARD_LINES.privateNoteAddedToAlert)).toContain(
      "التنبيه",
    );
  });

  test("the state change dialogs of alerts and episodes say who reads the note", () => {
    expect(
      EVENT_STATE_KINDS[EventStateKind.Alert].words.rowNoteDescription,
    ).toBe(
      "Add an optional private note about this state change. Only people who can see this alert can read it.",
    );
    expect(
      EVENT_STATE_KINDS[EventStateKind.Alert].words.bulkNoteDescription,
    ).toBe(
      "Add an optional private note about this state change. The same note is added to every alert you selected, and only people who can see an alert can read it.",
    );

    for (const kind of [
      EventStateKind.IncidentEpisode,
      EventStateKind.AlertEpisode,
    ]) {
      expect(EVENT_STATE_KINDS[kind].words.bulkNoteDescription).toBe(
        "Add an optional private note about this state change. The same note is added to every episode you selected, and only people who can see an episode can read it.",
      );
    }
  });

  test("a subscriber's Internal Note and Who Can Subscribe say who, not a team", () => {
    expect(SubscriberFormCopy.internalNoteDescription).toBe(
      "The subscriber never sees it.",
    );
    expect(SubscriberRestrictionsCopy.privateUsersOnlyNoSignInNote).toBe(
      "This page has no sign-in, so while this is on, only people in your project can add subscribers.",
    );
  });
});
