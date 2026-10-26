import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { Location } from "react-router-dom";
import Route from "../../../Types/API/Route";
import SideMenu from "../../../UI/Components/SideMenu/SideMenu";
import {
  getDrawnLanguage,
  getMenuWordsBreakClassName,
  SIDE_MENU_HYPHENATED_WORD_LENGTH,
  SIDE_MENU_HYPHENATED_WORDS_CLASS_NAME,
  SIDE_MENU_ITEM_TITLE_TEST_ID,
  SIDE_MENU_WORDS_CLASS_NAME,
} from "../../../UI/Components/SideMenu/SideMenuEntryState";
import SideMenuItem from "../../../UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "../../../UI/Components/SideMenu/SideMenuSection";
import Navigation from "../../../UI/Utils/Navigation";

/*
 * A menu's words say which language they are drawn in.
 *
 * Titles and section headings wrap onto a second line instead of ending in
 * an ellipsis, and a word longer than the whole line - a German compound,
 * "Benachrichtigungsprotokolle" (Notification Logs) - is hyphenated where
 * its language breaks it (hyphens: auto). A browser only hyphenates a word
 * in a language it is told, and the Dashboard's page says lang="en" whatever
 * the reader's language, so the words a menu translates carry the reader's
 * language themselves; the English ones it could not translate carry none
 * and stay the page's.
 *
 * Only a word too long to be sure of a line of its own is hyphenated
 * (getMenuWordsBreakClassName). Chrome hyphenates nothing else, but Firefox
 * and Safari hyphenate whatever word ends a line: French "Règles de taux de
 * consom- / mation" (Burn Rate Rules), German "Richtlinien für einge- /
 * hende Anrufe", where the word fits whole on the next line.
 */

// The reader's German, for the words these menus draw.
const GERMAN: Record<string, string> = {
  "Notification Logs": "Benachrichtigungsprotokolle",
  Basic: "Grundlegend",
  Overview: "Übersicht",
  "Navigate to": "Navigieren zu",
  "Incoming Call Policies": "Richtlinien für eingehende Anrufe",
  "Subscriber Settings": "Abonnenten-Einstellungen",
  "Delivery Logs": "Zustellungsprotokolle",
};

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string): string => {
          return GERMAN[key] ?? key;
        },
        i18n: { language: "de", resolvedLanguage: "de" },
      };
    },
  };
});

function goTo(path: string): void {
  window.history.pushState({}, "", path);
  Navigation.setLocation({
    pathname: path,
    search: "",
    hash: "",
    state: null,
    key: "test",
  } as Location);
}

function setViewportWidth(width: number): void {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

function statusPageMenu(): React.ReactElement {
  return (
    <SideMenu>
      <SideMenuSection title="Basic">
        <SideMenuItem link={{ title: "Overview", to: new Route("/s/1") }} />
        <SideMenuItem
          link={{
            title: "Webhook Subscribers",
            to: new Route("/s/1/webhooks"),
          }}
        />
      </SideMenuSection>
      <SideMenuSection title="Notification Logs">
        <SideMenuItem
          link={{ title: "Notification Logs", to: new Route("/s/1/logs") }}
        />
        <SideMenuItem
          link={{
            title: "Incoming Call Policies",
            to: new Route("/s/1/calls"),
          }}
        />
        <SideMenuItem
          link={{
            title: "Subscriber Settings",
            to: new Route("/s/1/subscriber-settings"),
          }}
          subItemLink={{
            title: "Delivery Logs",
            to: new Route("/s/1/subscriber-settings/logs"),
          }}
        />
      </SideMenuSection>
    </SideMenu>
  );
}

beforeEach(() => {
  setViewportWidth(1280);
});

afterEach(() => {
  cleanup();
});

describe("the language a menu's words are drawn in (getDrawnLanguage)", () => {
  test("is the reader's, for words the menu translated", () => {
    expect(
      getDrawnLanguage({
        english: "Notification Logs",
        drawn: "Benachrichtigungsprotokolle",
        language: "de",
      }),
    ).toBe("de");
  });

  test("is none for words left in English: they are the page's", () => {
    expect(
      getDrawnLanguage({
        english: "Webhook Subscribers",
        drawn: "Webhook Subscribers",
        language: "de",
      }),
    ).toBeUndefined();
  });

  test("is none without a language, or without words", () => {
    expect(
      getDrawnLanguage({
        english: "Overview",
        drawn: "Übersicht",
        language: "",
      }),
    ).toBeUndefined();
    expect(
      getDrawnLanguage({
        english: "Overview",
        drawn: "Übersicht",
        language: undefined,
      }),
    ).toBeUndefined();
    expect(
      getDrawnLanguage({
        english: undefined,
        drawn: undefined,
        language: "de",
      }),
    ).toBeUndefined();
  });
});

describe("which words may be hyphenated (getMenuWordsBreakClassName)", () => {
  test("a word too long to be sure of a line of its own, in the reader's language", () => {
    expect(
      getMenuWordsBreakClassName({
        text: "Benachrichtigungsprotokolle",
        lang: "de",
      }),
    ).toBe(SIDE_MENU_HYPHENATED_WORDS_CLASS_NAME);
    expect(
      getMenuWordsBreakClassName({
        text: "Zeitachse der Bereitschaftspläne",
        lang: "de",
      }),
    ).toBe(SIDE_MENU_HYPHENATED_WORDS_CLASS_NAME);
  });

  /*
   * Firefox and Safari hyphenate whatever word ends a line; a word that
   * fits a line of its own moves there whole instead.
   */
  test("no word that fits a line of its own: French Burn Rate Rules, German Incoming Call Policies", () => {
    for (const [text, lang] of [
      ["Règles de taux de consommation", "fr"],
      ["Journaux de notification", "fr"],
      ["Paramètres des abonnés", "fr"],
      ["Richtlinien für eingehende Anrufe", "de"],
    ] as Array<[string, string]>) {
      expect({
        text,
        className: getMenuWordsBreakClassName({ text, lang }),
      }).toEqual({ text, className: SIDE_MENU_WORDS_CLASS_NAME });
    }
  });

  test("a compound's parts are its words: it breaks at its own hyphen", () => {
    // Abonnenten (10) and Einstellungen (13).
    expect(
      getMenuWordsBreakClassName({
        text: "Abonnenten-Einstellungen",
        lang: "de",
      }),
    ).toBe(SIDE_MENU_WORDS_CLASS_NAME);
    expect(
      getMenuWordsBreakClassName({
        text: "Microsoft Teams-Abonnenten",
        lang: "de",
      }),
    ).toBe(SIDE_MENU_WORDS_CLASS_NAME);
  });

  test("words left in English are never hyphenated: the menu's English was written to fit", () => {
    expect(
      getMenuWordsBreakClassName({
        text: "Recommendations",
        lang: undefined,
      }),
    ).toBe(SIDE_MENU_WORDS_CLASS_NAME);
    expect(
      getMenuWordsBreakClassName({
        text: "Import from another tool",
        lang: undefined,
      }),
    ).toBe(SIDE_MENU_WORDS_CLASS_NAME);
    expect(getMenuWordsBreakClassName({ text: undefined, lang: "de" })).toBe(
      SIDE_MENU_WORDS_CLASS_NAME,
    );
  });

  test("counts letters, whatever their script, from the shortest long word up", () => {
    const shortest: string = "a".repeat(SIDE_MENU_HYPHENATED_WORD_LENGTH);

    expect(getMenuWordsBreakClassName({ text: shortest, lang: "de" })).toBe(
      SIDE_MENU_HYPHENATED_WORDS_CLASS_NAME,
    );
    expect(
      getMenuWordsBreakClassName({ text: shortest.slice(1), lang: "de" }),
    ).toBe(SIDE_MENU_WORDS_CLASS_NAME);
    // Thirteen letters each written in two UTF-16 units: still thirteen.
    expect(
      getMenuWordsBreakClassName({
        text: "\u{1D400}".repeat(SIDE_MENU_HYPHENATED_WORD_LENGTH - 1),
        lang: "de",
      }),
    ).toBe(SIDE_MENU_WORDS_CLASS_NAME);
  });

  test("hyphenates only inside such words, five letters either side of the hyphen", () => {
    expect(SIDE_MENU_HYPHENATED_WORDS_CLASS_NAME.split(" ")).toEqual([
      ...SIDE_MENU_WORDS_CLASS_NAME.split(" "),
      "hyphens-auto",
      `[hyphenate-limit-chars:${SIDE_MENU_HYPHENATED_WORD_LENGTH}_5_5]`,
    ]);
    expect(SIDE_MENU_WORDS_CLASS_NAME).not.toContain("hyphens");
  });
});

describe("a menu drawn in German", () => {
  test("a translated title says it is German, and may be hyphenated", async () => {
    goTo("/s/1/logs");

    await act(async () => {
      render(statusPageMenu());
    });

    const title: HTMLElement = screen
      .getByRole("link", { name: "Benachrichtigungsprotokolle" })
      .querySelector(`[data-testid="${SIDE_MENU_ITEM_TITLE_TEST_ID}"]`)!;

    expect(title).toHaveAttribute("lang", "de");
    expect(title).toHaveClass("hyphens-auto", "break-words", "min-w-0");
  });

  test("a translated title of words that fit a line each says it is German, and is never hyphenated", async () => {
    goTo("/s/1/calls");

    await act(async () => {
      render(statusPageMenu());
    });

    for (const name of [
      "Richtlinien für eingehende Anrufe",
      "Abonnenten-Einstellungen",
    ]) {
      const title: HTMLElement = screen
        .getByRole("link", { name })
        .querySelector(`[data-testid="${SIDE_MENU_ITEM_TITLE_TEST_ID}"]`)!;

      expect(title).toHaveAttribute("lang", "de");
      expect(title).toHaveClass("break-words", "min-w-0");
      expect(title).not.toHaveClass("hyphens-auto");
    }

    // A sub-entry's title follows the same rule.
    const subTitle: HTMLElement = screen
      .getByRole("link", { name: "Zustellungsprotokolle" })
      .querySelector(`[data-testid="${SIDE_MENU_ITEM_TITLE_TEST_ID}"]`)!;

    expect(subTitle).toHaveAttribute("lang", "de");
    expect(subTitle).toHaveClass("hyphens-auto", "break-words", "min-w-0");
  });

  test("a title left in English says nothing: it is the page's English", async () => {
    goTo("/s/1");

    await act(async () => {
      render(statusPageMenu());
    });

    const title: HTMLElement = screen
      .getByRole("link", { name: "Webhook Subscribers" })
      .querySelector(`[data-testid="${SIDE_MENU_ITEM_TITLE_TEST_ID}"]`)!;

    expect(title).not.toHaveAttribute("lang");
  });

  test("a section heading says it is German, and may be hyphenated", async () => {
    goTo("/s/1");

    await act(async () => {
      render(statusPageMenu());
    });

    const heading: HTMLElement = screen.getByRole("heading", {
      level: 6,
      name: "Benachrichtigungsprotokolle",
    });

    expect(heading).toHaveAttribute("lang", "de");
    expect(heading).toHaveClass("hyphens-auto", "break-words", "text-start");
  });

  test("on a phone, the button's section and page say they are German", async () => {
    setViewportWidth(375);
    goTo("/s/1/logs");

    await act(async () => {
      render(statusPageMenu());
    });

    const summary: HTMLElement = screen.getByRole("heading", { level: 3 });

    expect(summary).toHaveTextContent("Benachrichtigungsprotokolle");
    expect(summary).toHaveClass("break-words");
    for (const part of Array.from(summary.querySelectorAll("span"))) {
      expect(part).toHaveAttribute("lang", "de");
      // The one long word may be hyphenated; nothing else is.
      expect(part).toHaveClass("hyphens-auto");
    }
  });

  test("on a phone, a section and a page of words that fit a line each are never hyphenated", async () => {
    setViewportWidth(375);
    goTo("/s/1/calls");

    await act(async () => {
      render(statusPageMenu());
    });

    const summary: HTMLElement = screen.getByRole("heading", { level: 3 });
    const parts: Array<HTMLElement> = Array.from(
      summary.querySelectorAll("span"),
    );

    expect(summary).toHaveTextContent(
      "Benachrichtigungsprotokolle / Richtlinien für eingehende Anrufe",
    );
    expect(parts).toHaveLength(2);
    // The section, Notification Logs, holds the long word; the page none.
    expect(parts[0]).toHaveClass("hyphens-auto");
    expect(parts[1]).toHaveAttribute("lang", "de");
    expect(parts[1]).not.toHaveClass("hyphens-auto");
    expect(parts[1]).toHaveClass("break-words", "inline-block", "max-w-full");
  });
});
