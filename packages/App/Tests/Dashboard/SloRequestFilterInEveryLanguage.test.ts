import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import i18next from "Common/node_modules/i18next";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import {
  Translator,
  createTranslator,
} from "Common/UI/Utils/TranslateTemplate";
import { DASHBOARD_LANGUAGES } from "Common/Tests/Helpers/TranslatedLanguages";
import {
  SLO_REQUEST_FILTER_MAX_LENGTH,
  SLO_REQUEST_FILTER_MAX_TERMS,
} from "Common/Utils/Slo/SloRequestFilter";
import {
  getSloFormFields,
  validateRequestFilter,
} from "../../FeatureSet/Dashboard/src/Pages/Slo/SloFormFields";

/*
 * A REQUEST SLO'S FILTER IN THE READER'S LANGUAGE (#8444). The filter
 * itself is code - a traces search, `@http.route:/checkout*` - and reads
 * the same in every language. What the Dashboard says about it does not:
 * the create form's field and what it says of a filter it cannot read, the
 * Settings row, and the line under the overview's Services chip. Each is
 * read from the shipped locale files, and the code in it is kept exactly.
 */

const DASHBOARD: string = path.resolve(__dirname, "../../FeatureSet/Dashboard");

const FILTER: string = "@http.route:/checkout* -@http.route:/health";

// The marks a sentence drawn on the page sets each value apart with.
const ISOLATE_MARKS: RegExp = /[⁦-⁩]/g;

type SloValues = FormValues<ServiceLevelObjective>;

function readLocale(code: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(
      path.join(DASHBOARD, "src/Locales", `${code}.json`),
      "utf8",
    ),
  ) as Record<string, unknown>;
}

function shippedTranslatorFor(code: string): Translator {
  const locale: Record<string, unknown> = readLocale(code);

  return createTranslator((text: string): string | undefined => {
    const value: unknown = locale[text];

    return typeof value === "string" && value !== text ? value : undefined;
  }, code);
}

function plain(text: string | null): string | null {
  return text === null ? null : text.replace(ISOLATE_MARKS, "");
}

function errorFor(requestFilter: string | undefined | null): string | null {
  return plain(
    validateRequestFilter({
      requestFilter: requestFilter,
    } as unknown as SloValues),
  );
}

// Eleven terms: one more than a filter may have.
const TOO_MANY_TERMS: string = Array.from(
  { length: SLO_REQUEST_FILTER_MAX_TERMS + 1 },
  (_: unknown, index: number): string => {
    return `@tenant.id:t${index}`;
  },
).join(" ");

const TOO_LONG: string = `@http.route:/${"a".repeat(SLO_REQUEST_FILTER_MAX_LENGTH)}`;

function requestFilterField(): ModelField<ServiceLevelObjective> {
  const field: ModelField<ServiceLevelObjective> | undefined =
    getSloFormFields().find(
      (candidate: ModelField<ServiceLevelObjective>): boolean => {
        return Boolean(candidate.field?.requestFilter);
      },
    );

  if (!field) {
    throw new Error("The SLO form has no Request Filter field.");
  }

  return field;
}

/*
 * The form validates through the global i18next instance, as the
 * Dashboard's i18n.ts sets it up: every locale, switched as the language
 * picker does.
 */
beforeAll(async () => {
  await i18next.init({
    lng: "en",
    fallbackLng: "en",
    resources: Object.fromEntries(
      ["en", ...DASHBOARD_LANGUAGES].map((language: string) => {
        return [language, { translation: readLocale(language) }];
      }),
    ),
    interpolation: { escapeValue: false },
    initImmediate: false,
  });
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

async function readIn(language: string): Promise<void> {
  await i18next.changeLanguage(language);
  expect(i18next.resolvedLanguage || i18next.language).toBe(language);
}

describe("what the create form says of a filter, in English", () => {
  beforeAll(async () => {
    await readIn("en");
  });

  test.each([undefined, null, "", "   ", FILTER, 'name:"POST /checkout"'])(
    "%p is a filter it can count with",
    (filter: string | undefined | null) => {
      expect(errorFor(filter)).toBeNull();
    },
  );

  test("free text is neither an attribute nor the span's name, and says what to write", () => {
    expect(errorFor("checkout")).toBe(
      'The request filter takes span attributes and the span\'s name, such as @http.route:/checkout* or name:"POST /checkout". "checkout" is neither.',
    );
  });

  test("a filter past its length says how long one may be", () => {
    expect(errorFor(TOO_LONG)).toBe(
      "The request filter can be at most 500 characters long.",
    );
  });

  test("a filter past its terms says how many it may have", () => {
    expect(errorFor(TOO_MANY_TERMS)).toBe(
      "The request filter can have at most 10 terms.",
    );
  });
});

describe("a request SLO's filter in every Dashboard language", () => {
  test.each(DASHBOARD_LANGUAGES)(
    "%s words what the form says of a filter it cannot read, its own digits and the code kept",
    async (code: string) => {
      await readIn(code);

      const translator: Translator = shippedTranslatorFor(code);
      const freeText: string = errorFor("payments") as string;
      const tooLong: string = errorFor(TOO_LONG) as string;
      const tooMany: string = errorFor(TOO_MANY_TERMS) as string;
      const maxLength: string = translator.formatNumber(
        SLO_REQUEST_FILTER_MAX_LENGTH,
      );
      const maxTerms: string = translator.formatNumber(
        SLO_REQUEST_FILTER_MAX_TERMS,
      );

      // A filter it can read is still fine in any language.
      expect(errorFor(FILTER)).toBeNull();

      expect(freeText).not.toContain("is neither");
      // What was typed, quoted back as typed.
      expect(freeText).toContain("payments");
      expect(freeText).toContain("@http.route:/checkout*");
      expect(freeText).toContain('name:"POST /checkout"');

      expect(tooLong).not.toBe(
        `The request filter can be at most ${maxLength} characters long.`,
      );
      expect(tooLong).toContain(maxLength);

      expect(tooMany).not.toBe(
        `The request filter can have at most ${maxTerms} terms.`,
      );
      expect(tooMany).toContain(maxTerms);

      for (const sentence of [freeText, tooLong, tooMany]) {
        expect(sentence).not.toContain("{{");
      }
    },
  );

  test.each(DASHBOARD_LANGUAGES)(
    "%s words the overview's line under Services, and keeps the filter as typed",
    (code: string) => {
      const translator: Translator = shippedTranslatorFor(code);
      const line: string = plain(
        translator.translateTemplate(
          "Matching {{filter}}",
          { filter: FILTER },
          { setsValuesApart: true },
        ),
      ) as string;

      expect(line).not.toBe(`Matching ${FILTER}`);
      expect(line).toContain(FILTER);
    },
  );

  test.each(DASHBOARD_LANGUAGES)(
    "%s words the form's field and the Settings row",
    (code: string) => {
      const translator: Translator = shippedTranslatorFor(code);
      const field: ModelField<ServiceLevelObjective> = requestFilterField();
      const description: string = translator.translateText(
        field.description as string,
      ) as string;

      for (const english of [
        field.title as string,
        field.description as string,
        "Every request of its services",
        "Only the requests that match this traces search count.",
      ]) {
        expect({
          english,
          worded: translator.translateText(english),
        }).not.toEqual({ english, worded: english });
      }

      expect(description).toContain("-@http.route:/health");
      // The example a person types over is code, the same in every language.
      expect(translator.translateText(field.placeholder as string)).toBe(
        field.placeholder,
      );
    },
  );
});
