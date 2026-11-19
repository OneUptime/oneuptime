import ColumnSelector, {
  COLUMN_SELECTOR_PANEL_TEST_ID,
} from "../../../UI/Components/LogsViewer/components/ColumnSelector";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import React from "react";
import { initReactI18next } from "react-i18next";

/*
 * The logs toolbar's Columns, on a Persian page (#9859).
 *
 * Its button says how many columns are shown, and said it in Latin digits,
 * "3", beside Persian words: a count is written in the reader's digits
 * (translator.formatNumber), "۳". Its panel is drawn over the page from the
 * button (LayeredPopover), in the page's reading direction.
 *
 * The Dashboard sets i18next up once, globally, with react-i18next; so does
 * this file. Each jest file has its own module registry, so it reaches no
 * other suite.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, unknown>;
}

const COLUMNS: Array<{ id: string; label: string }> = [
  { id: "time", label: "Time" },
  { id: "service", label: "Service" },
  { id: "body", label: "Message" },
  { id: "traceId", label: "Trace ID" },
];

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      fa: { translation: readLocale("fa") },
      en: { translation: readLocale("en") },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(async () => {
  cleanup();
  document.documentElement.removeAttribute("dir");
  await act(async () => {
    await i18next.changeLanguage("en");
  });
});

function renderSelector(): void {
  render(
    <ColumnSelector
      availableColumns={COLUMNS}
      selectedColumns={["time", "service", "body"]}
      onChange={(): void => {}}
    />,
  );
}

describe("the logs toolbar's Columns", () => {
  test("says how many are shown in the reader's digits", async () => {
    await act(async () => {
      await i18next.changeLanguage("fa");
    });
    renderSelector();

    const button: HTMLElement = screen.getByRole("button", {
      expanded: false,
    });

    expect(button).toHaveTextContent("۳");
    expect(button).not.toHaveTextContent("3");
  });

  test("in English, the same count in Latin digits", () => {
    renderSelector();

    expect(
      screen.getByRole("button", { name: /Columns/, expanded: false }),
    ).toHaveTextContent(/^Columns\s*3$/);
  });

  test("opens its panel over the page, in the page's direction", async () => {
    await act(async () => {
      await i18next.changeLanguage("fa");
    });
    document.documentElement.setAttribute("dir", "rtl");
    renderSelector();

    fireEvent.click(screen.getByRole("button", { expanded: false }));

    const panel: HTMLElement = screen.getByTestId(
      COLUMN_SELECTOR_PANEL_TEST_ID,
    );

    expect(panel.closest("[data-tippy-root]")?.parentElement).toBe(
      document.body,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Its end on the button's end: the left, on a line read from the right.
    expect(panel.closest("[data-tippy-root]")).toHaveAttribute(
      "data-popper-placement",
      "bottom-start",
    );
  });
});
