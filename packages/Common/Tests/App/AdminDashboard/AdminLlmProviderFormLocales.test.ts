import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import LlmType from "../../../Types/LLM/LlmType";
import {
  LLM_PROVIDER_CARD_OPTIONS,
  getGlobalLlmProviderFormFields,
  getLlmProviderFormSteps,
} from "../../../UI/Components/AI/LlmProviderFormFields";
import {
  LLM_PROVIDER_DEFAULT_VALUE_TEMPLATE,
  LLM_PROVIDER_TYPES,
  LLM_PROVIDER_TYPE_COPY,
  LlmProviderFormCopy,
} from "../../../UI/Components/AI/LlmProviderFormCopy";
import { CardSelectOption } from "../../../UI/Components/CardSelect/CardSelect";
import Field from "../../../UI/Components/Forms/Types/Field";
import { FormStep } from "../../../UI/Components/Forms/Types/FormStep";
import { MORE_FIELDS_SECTION_TITLE } from "../../../UI/Components/Forms/Utils/AdvancedFormSection";

/*
 * The Admin Dashboard's Global LLM Providers draws the same form as a
 * project's LLM Providers (LlmProviderFormFields). The Admin Dashboard looks
 * a Common component's words up in ITS OWN locale files, so a form
 * translated only in the Dashboard's shows English in the Admin Dashboard
 * in every language. Every string this form draws is held here to the
 * Admin Dashboard's locales, worded as the Dashboard words it.
 */

const FEATURE_SETS: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
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

function locale(app: string, code: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(
      path.join(FEATURE_SETS, app, "src", "Locales", `${code}.json`),
      "utf8",
    ),
  ) as Record<string, unknown>;
}

// Every text the Global LLM Providers form draws, in English.
function drawnTexts(): Array<string> {
  const texts: Set<string> = new Set<string>();
  const add: (text: unknown) => void = (text: unknown): void => {
    if (typeof text === "string" && text.trim()) {
      texts.add(text);
    }
  };

  for (const step of getLlmProviderFormSteps() as Array<
    FormStep<LlmProvider>
  >) {
    add(step.title);
  }

  for (const field of getGlobalLlmProviderFormFields({
    includeCost: true,
  }) as Array<Field<LlmProvider>>) {
    add(field.title);
    add(field.description);
    add(field.placeholder);
  }

  for (const option of LLM_PROVIDER_CARD_OPTIONS as Array<CardSelectOption>) {
    add(option.title);
    add(option.description);
  }

  for (const type of LLM_PROVIDER_TYPES) {
    add(LLM_PROVIDER_TYPE_COPY[type].apiKeyHint);
    add(LLM_PROVIDER_TYPE_COPY[type].baseUrlHint);
    add(LLM_PROVIDER_TYPE_COPY[type].modelNameHint);
    // The list's Model column, for a blank Model no one model stands for.
    add(LLM_PROVIDER_TYPE_COPY[type].defaultModelLabel);
  }

  add(LlmProviderFormCopy.optionalBaseUrlHint);
  add(LlmProviderFormCopy.baseUrlNoKeys);
  add(MORE_FIELDS_SECTION_TITLE);
  // The list's Model column names a blank Model by the server's default.
  add(LLM_PROVIDER_DEFAULT_VALUE_TEMPLATE);

  return Array.from(texts);
}

describe("the Global LLM Providers form, in the Admin Dashboard's languages", () => {
  const texts: Array<string> = drawnTexts();

  test("draws the provider form's words, cards and help", () => {
    expect(texts).toEqual(
      expect.arrayContaining([
        "Provider",
        "Connection",
        "LLM Provider",
        "Open models you run yourself. No API key.",
        "Never put keys here.",
        "Leave empty for {{model}}.",
        "Leave empty for the first model your server lists. To use another, type its name exactly as your server lists it.",
        "More fields",
        "{{name}} (default)",
        "First model the server lists",
      ]),
    );
  });

  test.each(LANGUAGES)(
    "%s: every one the Dashboard translates, worded as the Dashboard words it",
    (code: string) => {
      const dashboard: Record<string, unknown> = locale("Dashboard", code);
      const admin: Record<string, unknown> = locale("AdminDashboard", code);
      const differing: Array<string> = [];

      for (const text of texts) {
        const wording: unknown = dashboard[text];

        // A brand the Dashboard keeps as written, or a word it leaves be.
        if (typeof wording !== "string" || wording === text) {
          continue;
        }

        if (admin[text] !== wording) {
          differing.push(
            `${text} -> admin ${JSON.stringify(admin[text])}, dashboard ${JSON.stringify(wording)}`,
          );
        }
      }

      expect(differing).toEqual([]);
    },
  );

  test.each(LANGUAGES)(
    "%s: the help and the cards are translated, not English",
    (code: string) => {
      const admin: Record<string, unknown> = locale("AdminDashboard", code);

      for (const text of [
        "Connection",
        LLM_PROVIDER_TYPE_COPY[LLM_PROVIDER_TYPES[0]!].description,
        LlmProviderFormCopy.baseUrlNoKeys,
        LlmProviderFormCopy.nameDescription,
        // A blank Model Name on an OpenAI-compatible server, and its list.
        LLM_PROVIDER_TYPE_COPY[LlmType.OpenAICompatible].modelNameHint,
        LLM_PROVIDER_TYPE_COPY[LlmType.OpenAICompatible].defaultModelLabel!,
      ]) {
        expect({ text, translated: admin[text] !== text }).toEqual({
          text,
          translated: true,
        });
        expect(typeof admin[text]).toBe("string");
      }
    },
  );

  test("the Admin Dashboard's locales still have the same keys in every language", () => {
    const english: Array<string> = Object.keys(
      locale("AdminDashboard", "en"),
    ).sort();

    for (const code of LANGUAGES) {
      expect({
        code,
        keys: Object.keys(locale("AdminDashboard", code)).sort(),
      }).toEqual({ code, keys: english });
    }
  });
});
