import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import InlineSeparator from "../../../UI/Components/InlineSeparator/InlineSeparator";
import StatusTimelineLegend from "../../../UI/Components/StatusTimeline/StatusTimelineLegend";
import { StatusTimelineSummary } from "../../../UI/Components/StatusTimeline/StatusTimelineLayout";
import {
  listScanRoots,
  listSourceFiles,
  toRelativePath,
} from "../../ForeignHiddenRuleGuard";

/*
 * THE SEPARATOR BETWEEN TWO FACTS, DRAWN THE READER'S WAY.
 *
 * A line of facts was joined with a literal middle dot, {" · "}: "۱۲ حادثه ·
 * ۳ هشدار" on a Persian page, where the dot beside Persian digits read as
 * Persian's zero ("۰"). InlineSeparator draws what the reader's language
 * sets facts apart with (getInlineSeparator): a bullet on a Persian page,
 * the middle dot in every other language. Every frontend draws its
 * separators with it, and a new {" · "} fails here.
 */

const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
);

// The separator written by hand in JSX.
const LITERAL_SEPARATOR: string = '{" · "}';

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const language of ["en", "de", "fa"]) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: { [language]: { translation: {} } },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    instances[language] = instance;
  }
});

afterEach(() => {
  cleanup();
});

const draw: (language: string, element: ReactElement) => void = (
  language: string,
  element: ReactElement,
): void => {
  render(
    <I18nextProvider i18n={instances[language]!}>{element}</I18nextProvider>,
  );
};

describe("InlineSeparator", () => {
  test("a Persian page sets facts apart with a bullet", () => {
    draw(
      "fa",
      <p data-testid="facts">
        ۱۲ حادثه
        <InlineSeparator />۳ هشدار
      </p>,
    );

    expect(screen.getByTestId("facts").textContent).toBe("۱۲ حادثه • ۳ هشدار");
  });

  test.each(["en", "de"])(
    "%s: the middle dot, as the line always had it",
    (language: string) => {
      draw(
        language,
        <p data-testid="facts">
          12 incidents
          <InlineSeparator />3 alerts
        </p>,
      );

      expect(screen.getByTestId("facts").textContent).toBe(
        "12 incidents · 3 alerts",
      );
    },
  );
});

/*
 * A status that took three hours, four times, a quarter of the period - and
 * one before it, the baseline the legend counts no times for.
 */
const summaryOf: (name: string) => StatusTimelineSummary = (
  name: string,
): StatusTimelineSummary => {
  return {
    items: [
      {
        statusKey: "baseline",
        name: "Baseline",
        color: "#6b7280",
        durationMs: 9 * 3600 * 1000,
        share: 0.75,
        count: 1,
      },
      {
        statusKey: "degraded",
        name: name,
        color: "#d97706",
        durationMs: 3 * 3600 * 1000,
        share: 0.25,
        count: 4,
      },
    ],
    measuredMs: 12 * 3600 * 1000,
  };
};

describe("the status timeline's legend", () => {
  test("in Persian, its share, duration and count are set apart with bullets", () => {
    draw(
      "fa",
      <StatusTimelineLegend summary={summaryOf("عملیاتی")} showShare={true} />,
    );

    const facts: string = document.body.textContent || "";

    expect(facts).toContain(" • ");
    expect(facts).not.toContain(" · ");
  });

  test("in English, with the middle dot as before", () => {
    draw(
      "en",
      <StatusTimelineLegend
        summary={summaryOf("Operational")}
        showShare={true}
      />,
    );

    expect(document.body.textContent || "").toContain(" · ");
  });
});

describe("every frontend draws its separators with InlineSeparator", () => {
  test('no frontend writes {" · "} by hand', () => {
    const found: Array<string> = [];

    for (const root of listScanRoots(REPOSITORY_ROOT)) {
      for (const file of listSourceFiles(root)) {
        if (!file.endsWith(".tsx")) {
          continue;
        }

        const source: string = fs.readFileSync(file, "utf-8");
        let at: number = source.indexOf(LITERAL_SEPARATOR);

        while (at !== -1) {
          found.push(
            `${toRelativePath(REPOSITORY_ROOT, file)}:${source.slice(0, at).split("\n").length}`,
          );
          at = source.indexOf(LITERAL_SEPARATOR, at + 1);
        }
      }
    }

    expect(found).toEqual([]);
  });
});
