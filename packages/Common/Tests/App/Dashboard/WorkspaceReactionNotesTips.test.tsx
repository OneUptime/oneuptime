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

import WorkspaceReactionNotesTips from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/WorkspaceReactionNotesTips";

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

// Every line the card can show, as en.json keys.
const PIN: string =
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
  PIN,
  PIN_TO_CHANNEL,
  MEGAPHONE,
  SLACK_WHERE,
  TEAMS_WHERE,
  WHOSE,
  CONNECT,
  TEAMS_APP,
  DESCRIPTION,
];

const LOCALES: Array<string> = [
  "da",
  "de",
  "es",
  "fa",
  "fr",
  "hi",
  "it",
  "ja",
  "ko",
  "nl",
  "no",
  "pt",
  "ru",
  "sv",
  "zh-CN",
  "zh-TW",
];

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
        PIN,
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
        PIN,
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
    expect(markdown()).not.toContain("Megaphone");
    expect(markdown()).toContain("the channel of the alert episode");
    cleanup();

    render(
      <WorkspaceReactionNotesTips
        workspaceType={WorkspaceType.MicrosoftTeams}
        resourceName="scheduled maintenance event"
        supportsPublicNotes={true}
      />,
    );

    expect(markdown()).toContain(MEGAPHONE);
    expect(markdown()).not.toContain("Pin to channel");
    expect(markdown()).toContain(
      "the channel OneUptime created for the scheduled maintenance event",
    );
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
