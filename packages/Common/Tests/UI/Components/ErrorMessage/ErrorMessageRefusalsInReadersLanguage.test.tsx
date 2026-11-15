import ErrorMessage from "../../../../UI/Components/ErrorMessage/ErrorMessage";
import ErrorMessageText from "../../../../UI/Components/ErrorMessage/ErrorMessageText";
import TableEmptyState, {
  TABLE_EMPTY_STATE_TEST_ID,
  TableEmptyStateKind,
} from "../../../../UI/Components/Table/TableEmptyState";
import { getErrorInSentenceText } from "../../../../UI/Utils/ErrorInSentence";
import { getRefusalText } from "../../../../Types/Exception/RefusalWithValues";
import {
  CHECK_NOT_WRITTEN_REFUSAL,
  CustomSqlRefusal,
  RULE_NOT_A_CHECK_REFUSAL,
} from "../../../../Types/DataObservability/DataCheckRefusals";
import {
  getMonitorTypeMismatchRefusal,
  MONITOR_NOT_FOUND_REFUSAL,
  MONITOR_TYPE_MISMATCH_REFUSAL,
} from "../../../../Utils/Monitor/MonitorTemplateLinkRefusal";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "../../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../../Helpers/IsolateMarks";
import "@testing-library/jest-dom";
import { cleanup, render, RenderResult, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";

/*
 * A SERVER REFUSAL WITH A VALUE IN IT, IN THE READER'S LANGUAGE, WHEREVER
 * A SHARED PLACE DRAWS IT (#8280).
 *
 * Some refusals carry a value: why a monitor cannot be linked to a template
 * ("This monitor's type is Ping, and this template's type is API. ..."),
 * why a data check could not be written ("The rule could not be made a
 * check: {{reason}}"). They are RefusalWithValues: read back out of the
 * English the server sends, and said in the reader's language around their
 * value (sayErrorMessage). A card's own sentence did that since #7678 and
 * #7530; ErrorMessageText - the words of ErrorMessage, of TableEmptyState's
 * description, the notes feed and the Templates menu - looked the whole
 * message up, which is no key once its value is in, so it read English on
 * every page. Read here from the Dashboard's locale files as they ship.
 */

const LANGUAGES: Array<string> = ["de", "fr", "ja", "fa", "ar"];

const instances: Map<string, i18n> = new Map<string, i18n>();

beforeAll(async () => {
  for (const language of ["en", ...LANGUAGES]) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: readDashboardLocale("en") },
        [language]: { translation: readDashboardLocale(language) },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    instances.set(language, instance);
  }
});

afterEach(() => {
  cleanup();
});

const drawIn: (language: string, element: ReactElement) => RenderResult = (
  language: string,
  element: ReactElement,
): RenderResult => {
  return render(
    <I18nextProvider i18n={instances.get(language)!}>
      {element}
    </I18nextProvider>,
  );
};

const TYPE_MISMATCH: string = getMonitorTypeMismatchRefusal({
  monitorType: "Ping",
  templateType: "API",
});

const NOT_A_CHECK: string = getRefusalText(RULE_NOT_A_CHECK_REFUSAL, {
  reason: "the table has no column for a customer's country",
});

const NOT_WRITTEN: string = getRefusalText(CHECK_NOT_WRITTEN_REFUSAL, {
  reason: CustomSqlRefusal.noQuery,
});

const REFUSALS: Array<[string, string, string]> = [
  ["a monitor of another type", TYPE_MISMATCH, "This monitor's type is"],
  [
    "a rule that cannot be a check",
    NOT_A_CHECK,
    "The rule could not be made a check:",
  ],
  [
    "a check OneUptime AI could not write",
    NOT_WRITTEN,
    "OneUptime AI could not write a check",
  ],
];

// The refusal as a card's own sentence says it, in `language`.
const said: (language: string, message: string) => string = (
  language: string,
  message: string,
): string => {
  return withoutIsolateMarks(
    getErrorInSentenceText({
      message: message,
      translator: dashboardTranslator(language),
    }),
  );
};

const textOf: (element: HTMLElement) => string = (
  element: HTMLElement,
): string => {
  return withoutIsolateMarks(element.textContent || "").trim();
};

describe("the refusals are what they claim to be", () => {
  test.each(REFUSALS)(
    "%s is worded in every language here, and reads apart from its English",
    (_refusal: string, message: string, english: string) => {
      expect(message.startsWith(english)).toBe(true);

      for (const language of LANGUAGES) {
        expect({ language, words: said(language, message) }).not.toEqual({
          language,
          words: message,
        });
        expect(said(language, message)).not.toContain(english);
      }
    },
  );
});

describe.each(LANGUAGES)("on a page in %s", (language: string) => {
  test.each(REFUSALS)(
    "ErrorMessage says %s in the reader's language, with its value",
    (_refusal: string, message: string, english: string) => {
      const result: RenderResult = drawIn(
        language,
        <div data-testid="list">
          <ErrorMessage message={message} />
        </div>,
      );

      const text: string = textOf(result.getByTestId("list"));

      expect(text).toBe(said(language, message));
      expect(text).not.toContain(english);
    },
  );

  test.each(REFUSALS)(
    "a table's description says %s in the reader's language, with its value",
    (_refusal: string, message: string, english: string) => {
      drawIn(
        language,
        <TableEmptyState
          kind={TableEmptyStateKind.Error}
          title="Could not link the monitors"
          description={message}
        />,
      );

      const table: HTMLElement = screen.getByTestId(TABLE_EMPTY_STATE_TEST_ID);

      expect(textOf(table)).toContain(said(language, message));
      expect(textOf(table)).not.toContain(english);
    },
  );

  test("the values stay as the server wrote them where they are not the product's words", () => {
    const result: RenderResult = drawIn(
      language,
      <p data-testid="words">
        <ErrorMessageText message={NOT_A_CHECK} />
      </p>,
    );

    expect(textOf(result.getByTestId("words"))).toContain(
      "the table has no column for a customer's country",
    );
  });

  test("a refusal with no value is looked up, as before", () => {
    const result: RenderResult = drawIn(
      language,
      <p data-testid="words">
        <ErrorMessageText message={MONITOR_NOT_FOUND_REFUSAL} />
      </p>,
    );

    expect(textOf(result.getByTestId("words"))).toBe(
      readDashboardLocale(language)[MONITOR_NOT_FOUND_REFUSAL],
    );
  });
});

describe("on a page read right to left", () => {
  test.each(["fa", "ar"])(
    "in %s, the refusal is the page's own line: not set apart, though its values are Latin",
    (language: string) => {
      const result: RenderResult = drawIn(
        language,
        <p data-testid="words">
          <ErrorMessageText message={TYPE_MISMATCH} />
        </p>,
      );

      const words: HTMLElement = result.getByTestId("words");

      expect(words.querySelector("bdi")).toBeNull();
      expect(textOf(words)).toBe(said(language, TYPE_MISMATCH));
    },
  );

  test.each(["fa", "ar"])(
    "in %s, a message nobody worded is still set apart, left to right, its full stop at its end",
    (language: string) => {
      const message: string = "Promo code is invalid.";
      const result: RenderResult = drawIn(
        language,
        <p data-testid="words">
          <ErrorMessageText message={message} />
        </p>,
      );

      const words: HTMLElement = result.getByTestId("words");

      expect(words.querySelector("bdi")).toHaveAttribute("dir", "ltr");
      expect(words.textContent).toBe(message);
    },
  );
});

describe("on an English page, exactly as before", () => {
  test.each(REFUSALS)(
    "ErrorMessage says %s as the server wrote it",
    (_refusal: string, message: string) => {
      const result: RenderResult = drawIn(
        "en",
        <p data-testid="words">
          <ErrorMessageText message={message} />
        </p>,
      );

      expect(result.getByTestId("words").innerHTML).toBe(message);
    },
  );

  test("a table's description is the server's words, as written", () => {
    drawIn(
      "en",
      <TableEmptyState
        kind={TableEmptyStateKind.Error}
        title="Could not link the monitors"
        description={TYPE_MISMATCH}
      />,
    );

    expect(screen.getByTestId(TABLE_EMPTY_STATE_TEST_ID)).toHaveTextContent(
      TYPE_MISMATCH,
    );
  });

  test("a message drawn as an element is drawn as it is", () => {
    const result: RenderResult = drawIn(
      "de",
      <p data-testid="words">
        <ErrorMessageText message={<strong>{TYPE_MISMATCH}</strong>} />
      </p>,
    );

    expect(result.getByTestId("words").innerHTML).toBe(
      `<strong>${TYPE_MISMATCH}</strong>`,
    );
  });
});

describe("a language with no wording of the refusal", () => {
  test("says it in English, with its values, as the server wrote it", async () => {
    const bare: i18n = createInstance();

    await bare.init({
      lng: "de",
      fallbackLng: "en",
      resources: { en: { translation: {} }, de: { translation: {} } },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    const result: RenderResult = render(
      <I18nextProvider i18n={bare}>
        <p data-testid="words">
          <ErrorMessageText message={TYPE_MISMATCH} />
        </p>
      </I18nextProvider>,
    );

    expect(textOf(result.getByTestId("words"))).toBe(TYPE_MISMATCH);
  });

  test("the refusal's template is a key of every language here", () => {
    for (const language of LANGUAGES) {
      expect(
        readDashboardLocale(language)[MONITOR_TYPE_MISMATCH_REFUSAL.template],
      ).toBeTruthy();
    }
  });
});
