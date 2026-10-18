import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import AIChatUnavailableView from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/AIChatUnavailableView";
import AIChatUnavailableReason, {
  getAIChatUnavailableCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/AIChatAvailability";

/*
 * What Ask AI shows instead of the composer when it cannot answer - on the
 * AI Copilot page and in the chat panel - in the reader's language, with a
 * button that says what it opens ("Add an LLM provider"), not a menu path
 * ("Go to Project Settings > AI > LLM Providers"). Its words were drawn as
 * they were written, in English in every language.
 */

const LOCALES: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

function locale(code: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${code}.json`), "utf8"),
  ) as Record<string, string>;
}

async function german(): Promise<i18n> {
  const instance: i18n = createInstance();

  await instance.init({
    lng: "de",
    fallbackLng: "de",
    resources: { de: { translation: locale("de") } },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });

  return instance;
}

afterEach(() => {
  cleanup();
});

const REASONS: Array<AIChatUnavailableReason> = Object.values(
  AIChatUnavailableReason,
) as Array<AIChatUnavailableReason>;

describe("Ask AI, when it cannot answer", () => {
  test.each(REASONS)(
    "%s: the button says what it opens, in a few words",
    (reason: AIChatUnavailableReason) => {
      const label: string = getAIChatUnavailableCopy(reason).actionLabel;

      expect(label).not.toMatch(/Go to|>/);
      expect(label.split(" ").length).toBeLessThanOrEqual(4);
    },
  );

  test.each(REASONS)(
    "%s: the title, the reason and the button are in the reader's language",
    async (reason: AIChatUnavailableReason) => {
      const de: Record<string, string> = locale("de");
      const copy: ReturnType<typeof getAIChatUnavailableCopy> =
        getAIChatUnavailableCopy(reason);

      render(
        <I18nextProvider i18n={await german()}>
          <MemoryRouter>
            <AIChatUnavailableView reason={reason} />
          </MemoryRouter>
        </I18nextProvider>,
      );

      for (const english of [copy.title, copy.description, copy.actionLabel]) {
        const translated: string | undefined = de[english];

        expect({ english, translated: Boolean(translated) }).toEqual({
          english,
          translated: true,
        });
        expect(translated).not.toBe(english);
        expect(screen.getByText(translated as string)).toBeInTheDocument();
      }
    },
  );
});
