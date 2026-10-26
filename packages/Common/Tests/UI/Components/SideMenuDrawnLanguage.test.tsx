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
  SIDE_MENU_ITEM_TITLE_TEST_ID,
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
 */

// The reader's German, for the words these menus draw.
const GERMAN: Record<string, string> = {
  "Notification Logs": "Benachrichtigungsprotokolle",
  Basic: "Grundlegend",
  Overview: "Übersicht",
  "Navigate to": "Navigieren zu",
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
    expect(summary).toHaveClass("hyphens-auto", "break-words");
    for (const part of Array.from(summary.querySelectorAll("span"))) {
      expect(part).toHaveAttribute("lang", "de");
    }
  });
});
