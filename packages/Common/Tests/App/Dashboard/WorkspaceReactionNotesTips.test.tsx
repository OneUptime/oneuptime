import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import React, { ReactElement } from "react";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";

/*
 * The "Tips: Using Emoji Reactions" card of a record's Slack and Microsoft
 * Teams pages: one card for both chats, in the reader's language.
 *
 * A message pinned in a record's channel is saved as a note in its
 * author's words, and somebody whose account is not connected is asked to
 * connect - they no longer have to connect first, as the Teams card used to
 * say. Each line is one translated sentence of Markdown, read here as the
 * Markdown the card hands its viewer.
 */

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): ReactElement => {
      return <pre data-testid="tips-markdown">{props.text}</pre>;
    },
  };
});

import WorkspaceReactionNotesTips, {
  getReactionPrivateNoteLine,
  REACTION_PRIVATE_NOTE_LINES,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/WorkspaceReactionNotesTips";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

/*
 * Every line the card can show, as en.json keys. What a pin saves names who
 * can read it, the people who can see the record, one line a record: it said
 * "visible only to your team", which read as one of OneUptime's Teams - or,
 * on the Microsoft Teams page, as the team in Microsoft Teams (#7595).
 */
const PIN_INCIDENT: string =
  "- 📌 **Pin** (📌, 📍) - React with a pin to save the message as a **private note** (only people who can see the incident can read it).";
const PIN_EPISODE: string =
  "- 📌 **Pin** (📌, 📍) - React with a pin to save the message as a **private note** (only people who can see the episode can read it).";
const PIN_ALERT: string =
  "- 📌 **Pin** (📌, 📍) - React with a pin to save the message as a **private note** (only people who can see the alert can read it).";
const PIN_MAINTENANCE: string =
  "- 📌 **Pin** (📌, 📍) - React with a pin to save the message as a **private note** (only people who can see the maintenance event can read it).";
const OLD_PIN: string =
  "- 📌 **Pin** (📌, 📍) - React with a pin to save the message as a **private note** (visible only to your team).";
const PIN_TO_CHANNEL: string =
  "- **Pin to channel** - Pinning the message with Slack's own *Pin to channel* does the same as a pin.";
const MEGAPHONE: string =
  "- 📣 **Megaphone or loudspeaker** (📣, 📢) - React with a megaphone to save the message as a **public note** (visible on the status page).";
const SLACK_WHERE: string =
  "This works in the channel of the {{resourceName}}, on messages and on replies. OneUptime saves the message and confirms with a reply in the thread.";
const TEAMS_WHERE: string =
  "This works in the channel OneUptime created for the {{resourceName}}, on messages and on replies. OneUptime picks the reaction up within a minute, saves the message and confirms with a reply in the thread.";
const WHOSE: string =
  "The note keeps the message's formatting and links and shows who wrote it. A private note is filed at the time the message was posted.";
const CONNECT: string =
  "If your {{workspace}} account is not connected to OneUptime yet, OneUptime asks you to connect it, then saves the message.";
const TEAMS_APP: string =
  "The OneUptime app needs to be installed in the team.";
const DESCRIPTION: string =
  "You can use emoji reactions in {{workspace}} to save messages as notes on the {{resourceName}}.";

const ALL_LINES: Array<string> = [
  PIN_INCIDENT,
  PIN_EPISODE,
  PIN_ALERT,
  PIN_MAINTENANCE,
  PIN_TO_CHANNEL,
  MEGAPHONE,
  SLACK_WHERE,
  TEAMS_WHERE,
  WHOSE,
  CONNECT,
  TEAMS_APP,
  DESCRIPTION,
];

const LOCALES: Array<string> = [...DASHBOARD_LANGUAGES];

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: readLocale("en") },
      de: { translation: readLocale("de") },
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

function markdown(): string {
  return screen.getByTestId("tips-markdown").textContent || "";
}

describe("the emoji reaction tips, in English", () => {
  test("Slack, on an incident: a pin, Slack's own Pin and a megaphone, then whose words and how to connect", () => {
    render(
      <WorkspaceReactionNotesTips
        workspaceType={WorkspaceType.Slack}
        resourceName="incident"
        supportsPublicNotes={true}
      />,
    );

    expect(screen.getByText("Tips: Using Emoji Reactions")).toBeInTheDocument();
    expect(
      screen.getByText(
        "You can use emoji reactions in Slack to save messages as notes on the incident.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("reaction-notes-tips-Slack")).toBeInTheDocument();

    expect(markdown()).toBe(
      [
        PIN_INCIDENT,
        PIN_TO_CHANNEL,
        MEGAPHONE,
        "",
        "This works in the channel of the incident, on messages and on replies. OneUptime saves the message and confirms with a reply in the thread.",
        "",
        WHOSE,
        "",
        "If your Slack account is not connected to OneUptime yet, OneUptime asks you to connect it, then saves the message.",
      ].join("\n"),
    );
  });

  test("Microsoft Teams, on an alert: a pin only, read within a minute, and the app must be in the team", () => {
    render(
      <WorkspaceReactionNotesTips
        workspaceType={WorkspaceType.MicrosoftTeams}
        resourceName="alert"
        supportsPublicNotes={false}
      />,
    );

    expect(
      screen.getByText(
        "You can use emoji reactions in Microsoft Teams to save messages as notes on the alert.",
      ),
    ).toBeInTheDocument();

    expect(markdown()).toBe(
      [
        PIN_ALERT,
        "",
        "This works in the channel OneUptime created for the alert, on messages and on replies. OneUptime picks the reaction up within a minute, saves the message and confirms with a reply in the thread.",
        "",
        WHOSE,
        "",
        "If your Microsoft Teams account is not connected to OneUptime yet, OneUptime asks you to connect it, then saves the message.",
        "",
        TEAMS_APP,
      ].join("\n"),
    );
  });

  test("a megaphone only where the record takes public notes; Slack's own Pin only in Slack", () => {
    render(
      <WorkspaceReactionNotesTips
        workspaceType={WorkspaceType.Slack}
        resourceName="alert episode"
        supportsPublicNotes={false}
      />,
    );

    expect(markdown()).toContain(PIN_TO_CHANNEL);
    expect(markdown()).toContain(PIN_EPISODE);
    expect(markdown()).not.toContain("Megaphone");
    expect(markdown()).toContain("the channel of the alert episode");
    cleanup();

    render(
      <WorkspaceReactionNotesTips
        workspaceType={WorkspaceType.MicrosoftTeams}
        resourceName="maintenance event"
        supportsPublicNotes={true}
      />,
    );

    expect(markdown()).toContain(MEGAPHONE);
    expect(markdown()).toContain(PIN_MAINTENANCE);
    expect(markdown()).not.toContain("Pin to channel");
    expect(markdown()).toContain(
      "the channel OneUptime created for the maintenance event",
    );
  });

  test.each([
    ["incident", PIN_INCIDENT],
    ["incident episode", PIN_EPISODE],
    ["alert", PIN_ALERT],
    ["alert episode", PIN_EPISODE],
    ["maintenance event", PIN_MAINTENANCE],
  ])(
    "on the pages of an %s, a pin saves a note only the people who can see it can read",
    (resourceName: string, line: string) => {
      for (const workspaceType of [
        WorkspaceType.Slack,
        WorkspaceType.MicrosoftTeams,
      ]) {
        render(
          <WorkspaceReactionNotesTips
            workspaceType={workspaceType}
            resourceName={resourceName}
            supportsPublicNotes={false}
          />,
        );

        expect(markdown().split("\n")[0]).toBe(line);
        expect(markdown()).not.toContain("your team");
        expect(markdown()).not.toContain(OLD_PIN);
        cleanup();
      }
    },
  );

  test("every record the pages name has its line, and a record not listed reads as an incident's", () => {
    expect(Object.keys(REACTION_PRIVATE_NOTE_LINES).sort()).toEqual(
      [
        "alert",
        "alert episode",
        "incident",
        "incident episode",
        "maintenance event",
      ].sort(),
    );
    expect(getReactionPrivateNoteLine("monitor")).toBe(PIN_INCIDENT);

    for (const line of Object.values(REACTION_PRIVATE_NOTE_LINES)) {
      expect(line).toMatch(
        /\(only people who can see the [a-z ]+ can read it\)\.$/,
      );
    }
  });

  test("nobody is told to connect first: a pin before connecting is saved once they have", () => {
    for (const workspaceType of [
      WorkspaceType.Slack,
      WorkspaceType.MicrosoftTeams,
    ]) {
      render(
        <WorkspaceReactionNotesTips
          workspaceType={workspaceType}
          resourceName="incident"
          supportsPublicNotes={true}
        />,
      );

      expect(markdown()).not.toContain("first");
      expect(markdown()).toContain("then saves the message.");
      cleanup();
    }
  });
});

describe("the emoji reaction tips, in German", () => {
  test("every line is German, the chat's name is kept", async () => {
    await act(async (): Promise<void> => {
      await i18next.changeLanguage("de");
    });

    render(
      <WorkspaceReactionNotesTips
        workspaceType={WorkspaceType.Slack}
        resourceName="incident"
        supportsPublicNotes={true}
      />,
    );

    expect(
      screen.getByText("Tipps: Emoji-Reaktionen verwenden"),
    ).toBeInTheDocument();
    expect(markdown()).toContain("**private Notiz**");
    expect(markdown()).toContain(
      "(nur wer den Vorfall sehen kann, kann sie lesen)",
    );
    expect(markdown()).not.toContain("Ihr Team");
    expect(markdown()).toContain("**öffentliche Notiz**");
    expect(markdown()).toContain("Wenn Ihr Slack-Konto noch nicht");
    expect(markdown()).toContain("Die Notiz behält die Formatierung");
    // No English line is left over.
    expect(markdown()).not.toContain("React with");
    expect(markdown()).not.toContain("This works");
  });
});

describe("the emoji reaction tips, in every language", () => {
  test.each(LOCALES)(
    "%s: every line the card can show is translated, with its placeholders",
    (locale: string) => {
      const translations: Record<string, string> = readLocale(locale);

      for (const line of ALL_LINES) {
        const translated: string | undefined = translations[line];

        expect(translated).toBeDefined();
        expect(translated).not.toBe(line);

        for (const placeholder of ["{{workspace}}", "{{resourceName}}"]) {
          expect(translated!.includes(placeholder)).toBe(
            line.includes(placeholder),
          );
        }
      }
    },
  );

  test("the old pin line that said a team sees the note is gone from every file", () => {
    for (const locale of ["en", ...LOCALES]) {
      expect(Object.keys(readLocale(locale))).not.toContain(OLD_PIN);
    }
  });

  test("the old Teams line that said to connect first is gone from every file", () => {
    for (const locale of ["en", ...LOCALES]) {
      expect(
        Object.keys(readLocale(locale)).filter((key: string): boolean => {
          return key.startsWith(
            "You need to connect your Microsoft Teams account to OneUptime first",
          );
        }),
      ).toEqual([]);
    }
  });
});
