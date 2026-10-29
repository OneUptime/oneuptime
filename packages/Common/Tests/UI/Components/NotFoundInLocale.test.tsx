import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React from "react";
import { I18nextProvider } from "react-i18next";
import NotFound from "../../../UI/Components/404";
import Route from "../../../Types/API/Route";
import Email from "../../../Types/Email";

/*
 * THE DASHBOARD'S "PAGE NOT FOUND", IN EVERY LANGUAGE IT SHIPS.
 *
 * Every address the Dashboard has no page for draws it - since #5397 an
 * unknown Settings address too (which drew a blank page), as the person
 * links stored in years of feed entries and chat messages lead there when
 * they are mistyped. It read English in thirteen of the sixteen languages,
 * and right to left its line between "404" and the words sat on the wrong
 * side, the words running into the number ("Page not found404").
 */

const LOCALES: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

const TITLE: string = "Page not found";
const MESSAGE: string = "Please check the URL in the address bar and try again.";
const GO_HOME: string = "Go Home";
const CONTACT_SUPPORT: string = "Contact Support";

const STRINGS: Array<string> = [TITLE, MESSAGE, GO_HOME, CONTACT_SUPPORT];

type Locale = Record<string, unknown>;

const readLocale: (language: string) => Locale = (
  language: string,
): Locale => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${language}.json`), "utf8"),
  ) as Locale;
};

const PHYSICAL_SIDE: RegExp =
  /(?:^|:)(?:m[lr]|p[lr]|border-[lr]|space-x|left|right)-/;

describe("the Dashboard's locale files", () => {
  test("hold every string the page shows, in English as the key", () => {
    const english: Locale = readLocale("en");

    for (const key of STRINGS) {
      expect([key, english[key]]).toEqual([key, key]);
    }
  });

  test.each(LANGUAGES)("translate every one of them in %s", (language) => {
    const locale: Locale = readLocale(language);

    for (const key of STRINGS) {
      const value: unknown = locale[key];

      expect({ key, isString: typeof value === "string" }).toEqual({
        key,
        isString: true,
      });
      expect({ key, translated: value !== key }).toEqual({
        key,
        translated: true,
      });
    }
  });

  test.each(LANGUAGES)("keep the message's full stop in %s", (language) => {
    const value: string = readLocale(language)[MESSAGE] as string;

    // A full stop of the language's own: "。" in Chinese and Japanese, "।" in Hindi.
    expect(value).toMatch(/[.。।]$/u);
  });
});

describe("drawn in each language", () => {
  const instances: Record<string, i18n> = {};

  beforeAll(async () => {
    for (const language of LANGUAGES) {
      const instance: i18n = createInstance();

      await instance.init({
        lng: language,
        resources: {
          [language]: {
            translation: readLocale(language) as Record<string, string>,
          },
        },
        interpolation: { escapeValue: false },
        keySeparator: false,
        nsSeparator: false,
      });

      instances[language] = instance;
    }
  });

  afterEach(() => {
    cleanup();
  });

  test.each(LANGUAGES)("in %s, every word is the language's", (language) => {
    const locale: Locale = readLocale(language);

    render(
      <I18nextProvider i18n={instances[language]!}>
        <NotFound
          homeRoute={new Route("/dashboard")}
          supportEmail={new Email("support@example.com")}
        />
      </I18nextProvider>,
    );

    expect(
      screen.getByRole("heading", { name: locale[TITLE] as string }),
    ).toBeInTheDocument();
    expect(screen.getByText(locale[MESSAGE] as string)).toBeInTheDocument();
    expect(screen.getByText(locale[GO_HOME] as string)).toBeInTheDocument();
    expect(
      screen.getByText(locale[CONTACT_SUPPORT] as string),
    ).toBeInTheDocument();
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument();
  });
});

describe("its layout reads right to left as well as left to right", () => {
  afterEach(() => {
    cleanup();
  });

  test("every side it sets is a logical one: start and end, never left and right", () => {
    const { container } = render(
      <NotFound
        homeRoute={new Route("/dashboard")}
        supportEmail={new Email("support@example.com")}
      />,
    );

    // The page's own boxes, not the shared Buttons inside it.
    const boxes: Array<Element> = Array.from(
      container.querySelectorAll("div, p, h1, main"),
    );

    expect(boxes.length).toBeGreaterThan(0);

    for (const box of boxes) {
      for (const name of Array.from(box.classList)) {
        // Taking a Button's own md:ml-3 off sets no side: it is the gap's.
        if (name === "[&_button]:md:ml-0") {
          continue;
        }

        expect({ name, physical: PHYSICAL_SIDE.test(name) }).toEqual({
          name,
          physical: false,
        });
      }
    }
  });

  test("the buttons are spaced by the row's gap, with a Button's own dialog margin taken off", () => {
    render(
      <NotFound
        homeRoute={new Route("/dashboard")}
        supportEmail={new Email("support@example.com")}
      />,
    );

    const row: HTMLElement = screen.getByText(GO_HOME).closest("button")!
      .parentElement!;

    expect(row).toHaveClass("gap-3");
    expect(row).toHaveClass("[&_button]:md:ml-0");
    expect(row).toHaveClass("flex-wrap");
  });
});
