// UX rule: Docs/ux/README.md#numbers-dates-and-plurals
import { beforeAll, describe, expect, test } from "@jest/globals";
import { render } from "@testing-library/react";
import i18next from "i18next";
import React, { ReactElement } from "react";
import { initReactI18next } from "react-i18next";
import { NO_BREAK_SPACE } from "../../../Types/NoBreakSpaces";
import { createTranslator, Translator } from "../../../Types/Translator";
import useTranslateValue from "../../../UI/Utils/Translation";
import useTranslator from "../../../UI/Utils/UseTranslator";

/*
 * AN ENGLISH KEY A PAGE DRAWS AS WRITTEN HOLDS A DURATION'S FIGURE (#8811).
 *
 * A key with no wording of its own - English, or a language that has not
 * worded it yet - is drawn as its English: "Every 5 minutes", "Reminders
 * can be sent between 15 minutes and 14 days before a shift.". Its wordings
 * held the figure to the duration's word (#8770); its English did not. Now
 * it does, whether or not the locale a front end ships holds the key (the
 * Admin Dashboard ships a small English): a text drawn through it is drawn.
 */

const NB: string = NO_BREAK_SPACE;

const KEYS: Record<string, string> = {
  "Every 5 minutes": "Every 5 minutes",
  "Reminders can be sent between 15 minutes and 14 days before a shift.":
    "Reminders can be sent between 15 minutes and 14 days before a shift.",
  "Up to 5 people": "Up to 5 people",
};

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: KEYS },
      de: { translation: { "Every 5 minutes": "Alle 5 Minuten" } },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

// The page's Translator (useTranslator), on a page in `language`.
const pageTranslator: (language: string) => Promise<Translator> = async (
  language: string,
): Promise<Translator> => {
  await i18next.changeLanguage(language);

  let translator: Translator | undefined = undefined;

  const Probe: () => ReactElement = (): ReactElement => {
    translator = useTranslator();

    return <div />;
  };

  render(<Probe />);

  return translator!;
};

// The words translateString draws for each text, on a page in `language`.
const drawn: (
  language: string,
  texts: Array<string>,
) => Promise<Array<string>> = async (
  language: string,
  texts: Array<string>,
): Promise<Array<string>> => {
  await i18next.changeLanguage(language);

  const results: Array<string> = [];

  const Probe: () => ReactElement = (): ReactElement => {
    const { translateString } = useTranslateValue();

    for (const text of texts) {
      results.push(translateString(text) || "");
    }

    return <div />;
  };

  render(<Probe />);

  return results;
};

describe("an English key drawn as written", () => {
  test("holds a duration's figure to its word", async () => {
    expect(
      await drawn("en", [
        "Every 5 minutes",
        "Reminders can be sent between 15 minutes and 14 days before a shift.",
      ]),
    ).toEqual([
      `Every 5${NB}minutes`,
      `Reminders can be sent between 15${NB}minutes and 14${NB}days before a shift.`,
    ]);
  });

  test("on a page in a language that has not worded it yet, too", async () => {
    expect(
      await drawn("de", [
        "Reminders can be sent between 15 minutes and 14 days before a shift.",
      ]),
    ).toEqual([
      `Reminders can be sent between 15${NB}minutes and 14${NB}days before a shift.`,
    ]);
  });

  test("a text no locale holds is drawn the same way", async () => {
    expect(await drawn("en", ["Backup every 5 minutes (custom)"])).toEqual([
      `Backup every 5${NB}minutes (custom)`,
    ]);
  });

  test("negative control: another word, and a language's own wording", async () => {
    expect(await drawn("en", ["Up to 5 people"])).toEqual(["Up to 5 people"]);
    // German's own wording, as its locale is handed it (this test's is plain).
    expect(await drawn("de", ["Every 5 minutes"])).toEqual(["Alle 5 Minuten"]);
  });
});

describe("the page's Translator draws an English key as written the same way", () => {
  test("translateText holds a duration's figure to its word", async () => {
    const translator: Translator = await pageTranslator("en");

    expect(translator.translateText("Every 5 minutes")).toBe(
      `Every 5${NB}minutes`,
    );
    expect(
      translator.translateText(
        "Issuing a free certificate, usually within 15 minutes.",
      ),
    ).toBe(`Issuing a free certificate, usually within 15${NB}minutes.`);
  });

  test("a key that comes back as itself is still no wording", async () => {
    const translator: Translator = await pageTranslator("en");

    // English's own key is no wording of it, held or not.
    expect(translator.hasTranslation("Every 5 minutes")).toBe(false);
    expect(translator.hasTranslation("Up to 5 people")).toBe(false);
  });

  test("a language's own wording is the wording, set as a wording is (#8770)", async () => {
    const translator: Translator = await pageTranslator("de");

    expect(translator.hasTranslation("Every 5 minutes")).toBe(true);
    expect(translator.translateText("Every 5 minutes")).toBe(
      `Alle 5${NB}Minuten`,
    );
  });

  test("a plural with no wording of its one form reads as English, never as a key", async () => {
    const translator: Translator = await pageTranslator("de");

    expect(
      translator.translatePlural(
        { one: "Every {{count}} minute", other: "Every {{count}} minutes" },
        1,
      ),
    ).toBe(`Every 1${NB}minute`);
    expect(
      translator.translatePlural(
        { one: "Every {{count}} minute", other: "Every {{count}} minutes" },
        5,
      ),
    ).toBe(`Every 5${NB}minutes`);
  });

  test("negative control: a translator for stored text gives an English text back as written", () => {
    const stored: Translator = createTranslator(undefined, "en");
    const page: Translator = createTranslator(undefined, "en", {
      drawsOnPage: true,
    });

    expect(stored.translateText("Every 5 minutes")).toBe("Every 5 minutes");
    expect(page.translateText("Every 5 minutes")).toBe(`Every 5${NB}minutes`);
    expect(page.translateText("Up to 5 people")).toBe("Up to 5 people");
  });
});
