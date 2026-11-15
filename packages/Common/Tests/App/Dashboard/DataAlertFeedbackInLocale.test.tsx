import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import i18next from "i18next";
import * as React from "react";
import { initReactI18next } from "react-i18next";

/*
 * WHAT YOU MAKE OF A DATA ALERT, IN THE READER'S WORDS.
 *
 * A data alert's Why This Happened card asks what the person handling it
 * makes of it: Useful, Expected or Not an Issue. The buttons were titled
 * with the stored value, and "Useful" and "Expected" were no keys of any
 * locale, so they read English on every page - beside the Documentation
 * page, which now names them in the reader's words (#7531). Each has a key
 * every language words, and what is saved stays the value.
 */

import DataObservabilityApi from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DataObservabilityApi";
import DataAlertExplanationCard, {
  FEEDBACK_BUTTONS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DataAlertExplanationCard";
import { DOCUMENTATION_TRANSLATIONS } from "../../../../App/FeatureSet/Dashboard/src/Pages/DataObservability/Documentation";
import {
  DATA_ALERT_FEEDBACK_VALUES,
  DataAlertExplanation,
  DataAlertFeedback,
} from "../../../Types/DataObservability/DataAlertFeedback";
import ObjectID from "../../../Types/ObjectID";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { getJestSpyOn } from "../../Spy";

const ALERT_ID: string = "75350000-0000-4000-8000-000000000001";

const EXPLANATION: DataAlertExplanation = {
  causes: [],
  impact: { tables: [], dashboards: [], services: [], people: [] },
  feedback: null,
  isCauseConfirmed: null,
};

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: readDashboardLocale("en") },
      de: { translation: readDashboardLocale("de") },
      es: { translation: readDashboardLocale("es") },
      ja: { translation: readDashboardLocale("ja") },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(async () => {
  cleanup();
  jest.restoreAllMocks();
  await i18next.changeLanguage("en");
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

async function drawCard(language: string): Promise<void> {
  getJestSpyOn(DataObservabilityApi, "getAlertExplanation").mockResolvedValue(
    EXPLANATION as never,
  );

  await act(async () => {
    await i18next.changeLanguage(language);
  });
  await act(async () => {
    render(<DataAlertExplanationCard alertId={new ObjectID(ALERT_ID)} />);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

// The card's answers, as its buttons read.
function answers(): Array<string> {
  return screen
    .getAllByRole("button")
    .map((button: HTMLElement): string => {
      return (button.textContent || "").trim();
    })
    .filter((text: string): boolean => {
      return text.length > 0;
    });
}

describe("a name for every answer", () => {
  test("every answer a data alert takes, in its order, each by a key", () => {
    expect(
      FEEDBACK_BUTTONS.map(
        (button: { feedback: DataAlertFeedback }): DataAlertFeedback => {
          return button.feedback;
        },
      ),
    ).toEqual([...DATA_ALERT_FEEDBACK_VALUES]);

    const english: Record<string, string> = readDashboardLocale("en");

    for (const button of FEEDBACK_BUTTONS) {
      // English reads the stored value, as it did.
      expect(button.label).toBe(button.feedback);
      expect(english[button.label]).toBe(button.feedback);
    }
  });

  test("each is worded in every language the Dashboard is read in, never the English kept", () => {
    for (const button of FEEDBACK_BUTTONS) {
      for (const language of DASHBOARD_LANGUAGES) {
        expect({
          label: button.label,
          language,
          worded: isWordedInDashboardLocale(button.label, language),
          english: readDashboardLocale(language)[button.label] === button.label,
        }).toEqual({
          label: button.label,
          language,
          worded: true,
          english: false,
        });
      }
    }
  });

  test.each([...DASHBOARD_LANGUAGES])(
    "the %s Documentation page names each answer as its button reads",
    async (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);
      const text: string = (await DOCUMENTATION_TRANSLATIONS[language]!())
        .default;

      for (const button of FEEDBACK_BUTTONS) {
        expect({
          language,
          answer: button.feedback,
          named: text.includes(`**${words[button.label]}**`),
        }).toEqual({ language, answer: button.feedback, named: true });
      }
    },
  );
});

describe("the card's buttons", () => {
  test("in English, read Useful, Expected and Not an Issue, as before", async () => {
    await drawCard("en");

    expect(answers()).toEqual(["Useful", "Expected", "Not an Issue"]);
  });

  test.each([
    ["de", ["Nützlich", "Erwartet", "Kein Problem"]],
    ["es", ["Útil", "Esperado", "No es un problema"]],
    ["ja", ["役に立った", "想定どおり", "問題ではない"]],
  ])("in %s, read %j", async (language: string, expected: Array<string>) => {
    await drawCard(language);

    expect(answers()).toEqual(expected);
  });

  test("in German, Erwartet saves the stored answer, Expected", async () => {
    const send: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      DataObservabilityApi,
      "sendAlertFeedback",
    ).mockResolvedValue(undefined as never);

    await drawCard("de");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Erwartet" }));
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![1]).toEqual({
      feedback: DataAlertFeedback.Expected,
    });
  });
});
