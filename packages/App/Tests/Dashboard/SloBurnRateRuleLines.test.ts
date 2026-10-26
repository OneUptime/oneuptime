import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  Translator,
  createTranslator,
  translatableTerm,
} from "Common/UI/Utils/TranslateTemplate";
import {
  BURN_RATE_RULE_NOTHING_PICKED,
  getNamesOrNothingPicked,
} from "../../FeatureSet/Dashboard/src/Pages/Slo/Utils/BurnRateRuleLines";

/*
 * The Burn Rate Rules table's lines ("Alert: SEV1", "Incident: Checkout
 * SRE") say a rule picked nothing in the reader's language, whatever the
 * line's own wording: Swedish and Dutch write "Incident: {{owners}}" as the
 * English does, and handed to that line as a term, "None" stayed English.
 */

const LOCALES: string = path.resolve(
  __dirname,
  "../../FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: ReadonlyArray<string> = [
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

// A line's one placeholder, by its name.
const PLACEHOLDER: RegExp = /\{\{(\w+)\}\}/;

// Every call the page makes to draw an empty word.
const NOTHING_PICKED_CALL: RegExp = /getNamesOrNothingPicked\(/g;

const LINES: ReadonlyArray<string> = [
  "Alert: {{owners}}",
  "Incident: {{owners}}",
  "Alert: {{policies}}",
  "Incident: {{policies}}",
  "Alert: {{severity}}",
  "Incident: {{severity}}",
];

function readLocale(code: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${code}.json`), "utf8"),
  ) as Record<string, unknown>;
}

/*
 * A language as the Dashboard ships it: a string worded as the English is
 * left out of the shipped locale, so the lookup finds nothing for it.
 */
function shippedTranslatorFor(code: string): Translator {
  const locale: Record<string, unknown> = readLocale(code);

  return createTranslator((text: string): string | undefined => {
    const value: unknown = locale[text];

    return typeof value === "string" && value !== text ? value : undefined;
  }, code);
}

describe("a burn rate rule's line", () => {
  test("names what the rule picked, in the order given", () => {
    const english: Translator = shippedTranslatorFor("en");

    expect(
      getNamesOrNothingPicked(
        ["Checkout SRE", "", undefined, "  ", "Jane Doe"],
        BURN_RATE_RULE_NOTHING_PICKED.owners,
        english,
      ),
    ).toBe("Checkout SRE, Jane Doe");
  });

  test("says None, No escalation or Default in English when nothing is picked", () => {
    const english: Translator = shippedTranslatorFor("en");

    expect(
      getNamesOrNothingPicked(
        [],
        BURN_RATE_RULE_NOTHING_PICKED.owners,
        english,
      ),
    ).toBe("None");
    expect(
      getNamesOrNothingPicked(
        [],
        BURN_RATE_RULE_NOTHING_PICKED.onCallPolicies,
        english,
      ),
    ).toBe("No escalation");
    expect(
      getNamesOrNothingPicked(
        [undefined],
        BURN_RATE_RULE_NOTHING_PICKED.severity,
        english,
      ),
    ).toBe("Default");
  });

  test.each(LANGUAGES)(
    "says nothing was picked in the reader's words in %s, whatever the line's wording",
    (code: string) => {
      const translator: Translator = shippedTranslatorFor(code);
      const locale: Record<string, unknown> = readLocale(code);

      for (const word of Object.values(BURN_RATE_RULE_NOTHING_PICKED)) {
        const said: string = getNamesOrNothingPicked([], word, translator);

        expect({ code, word, said }).toEqual({
          code,
          word,
          said: locale[word] as string,
        });

        for (const line of LINES) {
          const placeholder: string = (
            line.match(PLACEHOLDER) as RegExpMatchArray
          )[1] as string;
          const filled: string = translator.translateTemplate(line, {
            [placeholder]: said,
          });

          expect(filled).toContain(said);
        }
      }
    },
  );

  test("Swedish and Dutch read Incident: Inga and Incident: Geen", () => {
    const swedish: Translator = shippedTranslatorFor("sv");
    const dutch: Translator = shippedTranslatorFor("nl");

    expect(
      swedish.translateTemplate("Incident: {{owners}}", {
        owners: getNamesOrNothingPicked(
          [],
          BURN_RATE_RULE_NOTHING_PICKED.owners,
          swedish,
        ),
      }),
    ).toBe(`Incident: ${readLocale("sv")["None"] as string}`);
    expect(
      dutch.translateTemplate("Incident: {{owners}}", {
        owners: getNamesOrNothingPicked(
          [],
          BURN_RATE_RULE_NOTHING_PICKED.owners,
          dutch,
        ),
      }),
    ).toBe(`Incident: ${readLocale("nl")["None"] as string}`);
  });

  test("a term in such a line would have stayed English", () => {
    // Why the word is looked up on its own: the line reads as the English.
    const swedish: Translator = shippedTranslatorFor("sv");

    expect(
      swedish.translateTemplate("Incident: {{owners}}", {
        owners: translatableTerm("None"),
      }),
    ).toBe("Incident: None");
  });
});

describe("the Burn Rate Rules page", () => {
  test("draws its lines' empty words through getNamesOrNothingPicked", () => {
    const page: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../FeatureSet/Dashboard/src/Pages/Slo/View/BurnRateRules.tsx",
      ),
      "utf8",
    );

    expect(page).not.toContain('translatableTerm("None")');
    expect(page).not.toContain('translatableTerm("Default")');
    expect(page).not.toContain('translatableTerm("No escalation")');
    expect(page.match(NOTHING_PICKED_CALL)?.length).toBe(4);
  });
});
