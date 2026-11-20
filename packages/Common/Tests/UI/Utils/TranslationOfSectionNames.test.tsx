import { beforeAll, describe, expect, test } from "@jest/globals";
import { render } from "@testing-library/react";
import i18next from "i18next";
import React, { ReactElement } from "react";
import { initReactI18next } from "react-i18next";
import useTranslateValue, {
  UseTranslateValueResult,
} from "../../../UI/Utils/Translation";
import { translateText } from "../../../UI/Utils/TranslateTemplate";
import { composeWords } from "../../../Types/ComposedWords";

/*
 * A TEXT THAT IS ALSO THE NAME OF A SECTION OF KEYS IS DRAWN AS WRITTEN.
 *
 * The Dashboard's locale files keep a few older keys in sections -
 * "common": { "save": ... }, "navbar": { "items": ... } - and look every
 * other text up whole. A label, a monitor or a team named "common" was
 * looked up whole too, found the section, and i18next answered with a
 * sentence of its own - "key 'common (en)' returned an object instead of
 * string." - which was drawn where the name should be.
 */

const ENGLISH: Record<string, unknown> = {
  common: { save: "Save", cancel: "Cancel" },
  navbar: { items: { formsTitle: "Forms" } },
  Save: "Save",
};

const GERMAN: Record<string, unknown> = {
  common: { save: "Speichern", cancel: "Abbrechen" },
  navbar: { items: { formsTitle: "Formulare" } },
  Save: "Speichern",
  "Find One {{itemName}}": "{{itemName}} finden",
};

beforeAll(async () => {
  // As a front end sets it up: keys in sections are read with a dot.
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: ENGLISH },
      de: { translation: GERMAN },
    },
    interpolation: { escapeValue: false },
  });
});

// The page's helpers, on a page in `language`.
const helpersIn: (
  language: string,
) => Promise<UseTranslateValueResult> = async (
  language: string,
): Promise<UseTranslateValueResult> => {
  await i18next.changeLanguage(language);

  let helpers: UseTranslateValueResult | undefined = undefined;

  const Probe: () => ReactElement = (): ReactElement => {
    helpers = useTranslateValue();

    return <div />;
  };

  render(<Probe />);

  return helpers!;
};

describe("a text named like a section of keys", () => {
  test.each(["en", "de"])(
    "is drawn as written on a page in %s",
    async (language: string) => {
      const { translateString, hasTranslation } = await helpersIn(language);

      expect(translateString("common")).toBe("common");
      expect(translateString("navbar")).toBe("navbar");
      // It has no wording of its own, whatever the section holds.
      expect(hasTranslation("common")).toBe(false);
    },
  );

  test("is drawn as written outside React too", async () => {
    await i18next.changeLanguage("de");

    expect(translateText("common")).toBe("common");
    expect(translateText("navbar")).toBe("navbar");
  });

  test("is drawn as written inside words built from it", async () => {
    // A workflow's record step, built from a model named "common".
    const english: string = composeWords("Find One {{itemName}}", {
      itemName: "common",
    });
    const { translateString } = await helpersIn("de");

    expect(translateString(english)).toBe("common finden");
  });

  test("leaves the texts that have a wording translated", async () => {
    const { translateString } = await helpersIn("de");

    expect(translateString("Save")).toBe("Speichern");
    expect(translateText("Save")).toBe("Speichern");
    // A key in a section is still read the way its callers read it.
    expect(i18next.t("common.save")).toBe("Speichern");
  });
});
