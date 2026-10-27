import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { translateCreateAction } from "../../../UI/Components/ModelTable/BaseModelTable";
import {
  Translator,
  createTranslator,
} from "../../../UI/Utils/TranslateTemplate";
import {
  OPEN_NEW_SECURITY_CASE,
  OPEN_SECURITY_CASE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCasesTable";

/*
 * The case list's create button as the shared table draws it - through
 * translateCreateAction, from the list's createVerb "Open" and the model's
 * name "Security Case" - in every Dashboard language.
 *
 * "Open" is not one of the verbs the table words itself ("Create", "Add",
 * "Declare"...), so the two words were looked up one by one and joined verb
 * first: "Öffnen Sicherheitsfall" in German, open as a door is. The whole
 * phrase is in every locale now, and the table finds it first.
 */

const LOCALES_DIR: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((name: string): boolean => {
    return name.endsWith(".json");
  })
  .map((name: string): string => {
    return name.replace(/\.json$/, "");
  })
  .sort();

function locale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

function translatorFor(language: string): Translator {
  const values: Record<string, string> = locale(language);

  return createTranslator((text: string): string | undefined => {
    return values[text];
  }, language);
}

describe("Open Security Case, as the case list's header draws it", () => {
  test("reads in English as it always has", () => {
    expect(
      translateCreateAction(translatorFor("en"), {
        verb: "Open",
        itemName: "Security Case",
      }),
    ).toBe("Open Security Case");
    expect(OPEN_SECURITY_CASE).toBe("Open Security Case");
    expect(OPEN_NEW_SECURITY_CASE).toBe("Open New Security Case");
  });

  test("German opens a case: Sicherheitsfall eröffnen", () => {
    const button: string = translateCreateAction(translatorFor("de"), {
      verb: "Open",
      itemName: "Security Case",
    });

    expect(button).toBe("Sicherheitsfall eröffnen");
    expect(button).not.toBe("Öffnen Sicherheitsfall");
  });

  test.each(
    LANGUAGES.filter((language: string): boolean => {
      return language !== "en";
    }),
  )(
    "%s draws the whole phrase its locale words, the dialog's button the same",
    (language: string) => {
      const values: Record<string, string> = locale(language);
      const button: string = translateCreateAction(translatorFor(language), {
        verb: "Open",
        itemName: "Security Case",
      });

      expect(button).toBe(values[OPEN_SECURITY_CASE]);
      // The create dialog's submit button is that phrase, looked up whole.
      expect(translatorFor(language).translateText(OPEN_SECURITY_CASE)).toBe(
        button,
      );
      expect(
        translatorFor(language).translateText(OPEN_NEW_SECURITY_CASE),
      ).toBe(values[OPEN_NEW_SECURITY_CASE]);
    },
  );
});
