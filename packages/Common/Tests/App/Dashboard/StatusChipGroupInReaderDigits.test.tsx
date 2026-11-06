import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import StatusChipGroup, {
  StatusChipOption,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Filters/StatusChipGroup";

/*
 * THE HEALTH CHIPS' COUNTS IN THE READER'S DIGITS.
 *
 * The network topology map and the network site map share one row of
 * status chips that are a status line and a filter at once: "All 42 ·
 * Needs attention 5 · Down 3". Like the shared filter buttons, each chip
 * drew its count as JavaScript writes a number - "3" beside a Persian
 * chip's name, where every other count on the page is "۳" (#6150's
 * review). A chip's count is written the way the reader's language writes
 * a number now; English reads as it did.
 */

const LATIN_DIGIT: RegExp = /[0-9]/;

const OPTIONS: Array<StatusChipOption> = [
  {
    value: "all",
    label: "All",
    description: "Every device",
    count: 1042,
    testId: "chip-all",
  },
  {
    value: "down",
    label: "Down",
    description: "Devices that stopped answering",
    color: "#ef4444",
    count: 3,
    testId: "chip-down",
  },
  {
    value: "degraded",
    label: "Degraded",
    description: "Devices that answer slowly",
    color: "#f59e0b",
    count: 0,
    testId: "chip-degraded",
  },
];

const languages: Record<string, i18n> = {};

beforeAll(async () => {
  const resources: Record<string, Record<string, string>> = {
    en: {},
    fa: { All: "همه", Down: "از کار افتاده", Degraded: "کاهش‌یافته" },
  };

  for (const language of Object.keys(resources)) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: { [language]: { translation: resources[language]! } },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    languages[language] = instance;
  }
});

afterEach(() => {
  cleanup();
});

function drawChips(language: string): void {
  render(
    <I18nextProvider i18n={languages[language]!}>
      <StatusChipGroup
        options={OPTIONS}
        value="all"
        onChange={() => {}}
        ariaLabel="Filter by health"
      />
    </I18nextProvider>,
  );
}

describe("the health chips' counts", () => {
  test("on a Persian page each chip's count is in Persian digits beside its Persian name", () => {
    drawChips("fa");

    const down: HTMLElement = screen.getByTestId("chip-down");

    expect(down).toHaveTextContent("از کار افتاده");
    expect(down).toHaveTextContent("۳");

    for (const option of OPTIONS) {
      expect(screen.getByTestId(option.testId).textContent).not.toMatch(
        LATIN_DIGIT,
      );
    }
  });

  test("a large count is grouped the Persian way, and a zero is a Persian zero", () => {
    drawChips("fa");

    expect(screen.getByTestId("chip-all")).toHaveTextContent(
      (1042).toLocaleString("fa"),
    );
    expect(screen.getByTestId("chip-degraded")).toHaveTextContent(
      (0).toLocaleString("fa"),
    );
  });

  test("in English the chips read as they did", () => {
    drawChips("en");

    expect(screen.getByTestId("chip-all")).toHaveTextContent("All1,042");
    expect(screen.getByTestId("chip-down")).toHaveTextContent("Down3");
    expect(screen.getByTestId("chip-degraded")).toHaveTextContent("Degraded0");
  });
});
