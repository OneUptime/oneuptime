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
 * separators with it, and a new middle dot written by hand as a JSX node of
 * its own fails here, in each form one was written.
 */

const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
);

/*
 * A middle dot written by hand as a JSX node of its own, in each form the
 * frontends wrote one (125 of them, before InlineSeparator).
 */
const HAND_WRITTEN_SEPARATORS: Array<[string, RegExp]> = [
  // {" · "}
  ["an expression", /\{\s*(["'`])\s*\u{00B7}\s*\1\s*\}/gu],
  // {cond ? " · " : ""}, {isLast ? "" : " ·"}, {cond && " · "}
  ["a condition's text", /(?:\?|:|&&)\s*(["'`])\s*\u{00B7}\s*\1\s*(?=[:})])/gu],
  // <span> · </span>, <span aria-hidden="true">·</span>, <span>&middot;</span>
  ["an element's whole text", />[ \t]*(?:\u{00B7}|&middot;)[ \t]*<\//gu],
  // A line of its own between an element's tags: ·, ·{" "}, &middot;
  ["a line of its own", /^[ \t]*(?:\u{00B7}|&middot;)(?:\{" "\})?[ \t]*$/gmu],
];

const findHandWrittenSeparators: (source: string) => Array<string> = (
  source: string,
): Array<string> => {
  const found: Array<string> = [];

  for (const [form, pattern] of HAND_WRITTEN_SEPARATORS) {
    for (const match of source.matchAll(pattern)) {
      found.push(
        `${form}, line ${source.slice(0, match.index).split("\n").length}`,
      );
    }
  }

  return found;
};

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

  /*
   * Where a line's gap or margins space its facts, the dot was a span's
   * whole text: markOnly draws the mark without the spaces.
   */
  test.each([
    ["fa", "\u{2022}"],
    ["en", "\u{00B7}"],
    ["de", "\u{00B7}"],
  ])(
    "%s: markOnly draws the mark alone, %s",
    (language: string, mark: string) => {
      draw(
        language,
        <span data-testid="mark" aria-hidden="true">
          <InlineSeparator markOnly />
        </span>,
      );

      expect(screen.getByTestId("mark").textContent).toBe(mark);
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
    // Monitoring was on throughout (issue #6480).
    monitoringOffMs: 0,
    monitoringOffCount: 0,
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
  test("no frontend writes a middle dot by hand as a JSX node of its own", () => {
    const found: Array<string> = [];

    for (const root of listScanRoots(REPOSITORY_ROOT)) {
      for (const file of listSourceFiles(root)) {
        if (!file.endsWith(".tsx")) {
          continue;
        }

        for (const where of findHandWrittenSeparators(
          fs.readFileSync(file, "utf-8"),
        )) {
          found.push(`${toRelativePath(REPOSITORY_ROOT, file)}: ${where}`);
        }
      }
    }

    expect(found).toEqual([]);
  });

  // The guard finds each form a frontend wrote, and leaves text and strings.
  test.each([
    ['{" · "}', "an expression, line 1"],
    ['{cond ? " · " : ""}', "a condition's text, line 1"],
    ['{isLast ? "" : " ·"}', "a condition's text, line 1"],
    ['{cond && " · "}', "a condition's text, line 1"],
    ["<span> · </span>", "an element's whole text, line 1"],
    ['<span aria-hidden="true">·</span>', "an element's whole text, line 1"],
    ["<span>&middot;</span>", "an element's whole text, line 1"],
    ["<span>\n  ·\n</span>", "a line of its own, line 2"],
    ['<p>\n  {a}{" "}\n  ·{" "}\n  {b}\n</p>', "a line of its own, line 3"],
  ])("finds %j", (source: string, where: string) => {
    expect(findHandWrittenSeparators(source)).toEqual([where]);
  });

  test.each([
    'parts.join(" · ")',
    "`${a} · ${b}`",
    "<InlineSeparator />",
    "<InlineSeparator markOnly />",
    ' * A comment: "12 incidents · 3 alerts".',
  ])("leaves %j", (source: string) => {
    expect(findHandWrittenSeparators(source)).toEqual([]);
  });
});
