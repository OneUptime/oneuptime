import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import React from "react";
import { initReactI18next } from "react-i18next";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import MonitorEvaluationSummary, {
  MonitorEvaluationCriteriaResult,
} from "../../../Types/Monitor/MonitorEvaluationSummary";
import EvaluationLogList, {
  NOT_EVALUATED_AFTER_MATCH_WORDS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/EvaluationLogList";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

/*
 * WHY A CRITERIA WAS NOT EVALUATED, WHEN THE FIRST MATCH CHANGES NO STATUS
 * (#11238).
 *
 * A criteria that changes no status decides none: the criteria after it
 * that change the status are evaluated until one matches and sets it. The
 * Monitor Summary says why each criteria it passed over was not evaluated -
 * one that changes no status after a first match that changes none, one
 * after the criteria that set the status - naming the criteria it means,
 * and how this monitor judges its criteria, in the reader's language. A
 * monitor whose first match decides reads as it always did.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: Array<string> = [...DASHBOARD_LANGUAGES];

const AT: Date = new Date("2026-11-20T08:15:00.000Z");

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

async function readIn(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

function result(
  overrides: Partial<MonitorEvaluationCriteriaResult> & { criteriaId: string },
): MonitorEvaluationCriteriaResult {
  return {
    criteriaName: overrides.criteriaId,
    filterCondition: FilterCondition.All,
    met: false,
    message: "Criteria was not met.",
    filters: [],
    ...overrides,
  };
}

// Stored as the evaluator stores a criteria it passed over.
function passedOver(
  criteriaId: string,
  skipCause: MonitorEvaluationCriteriaResult["skipCause"],
  criteriaName?: string,
): MonitorEvaluationCriteriaResult {
  return result({
    criteriaId: criteriaId,
    ...(criteriaName !== undefined ? { criteriaName: criteriaName } : {}),
    skipped: true,
    skipCause: skipCause,
    skipReason: "Stored English reason.",
    message: "Stored English reason.",
  });
}

/*
 * The recommended network device pack's poll after a missed one: the port
 * alert matches first and changes no status, the next alert changes none
 * either, Device unreachable does not match, the healthy criteria matches
 * and sets the status, and the criteria after it are passed over.
 */
const PACK_POLL: Array<MonitorEvaluationCriteriaResult> = [
  result({ criteriaId: "Interface saturated", met: true }),
  passedOver("Interface errors", "changes-no-status"),
  result({ criteriaId: "Device unreachable", met: false }),
  result({ criteriaId: "Device is online", met: true }),
  passedOver("Device is back", "status-already-set"),
];

function renderCriteria(
  criteriaResults: Array<MonitorEvaluationCriteriaResult>,
): Array<HTMLElement> {
  const summary: MonitorEvaluationSummary = {
    evaluatedAt: AT,
    criteriaResults: criteriaResults,
    events: [],
  };

  render(<EvaluationLogList evaluationSummary={summary} />);

  // Every criteria is a row of its own, in the order it was evaluated.
  return screen.getAllByRole("group");
}

// What a passed-over row says: why, and how the monitor judges its criteria.
function said(row: HTMLElement): { why: string; how: string } {
  const why: HTMLElement = within(row).getByText(
    (_content: string, element: Element | null): boolean => {
      return Boolean(
        element?.matches("div.text-sm.text-gray-600") &&
          element.parentElement?.matches("div.mt-3"),
      );
    },
  );
  const how: HTMLElement = why.nextElementSibling as HTMLElement;

  return { why: why.textContent || "", how: how?.textContent || "" };
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {
    en: { translation: readLocale("en") },
  };

  for (const language of LANGUAGES) {
    resources[language] = { translation: readLocale(language) };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: resources,
    interpolation: { escapeValue: false },
  });
});

afterEach(async () => {
  cleanup();
  await readIn("en");
});

describe("why a criteria was not evaluated, in English", () => {
  test("after a first match that changes no status: the first match, and that this one changes none either", () => {
    const rows: Array<HTMLElement> = renderCriteria(PACK_POLL);

    expect(rows).toHaveLength(PACK_POLL.length);
    expect(said(rows[1]!)).toEqual({
      why: "Not evaluated because “Interface saturated” matched first, and this criteria changes no status.",
      how: "Criteria are evaluated in order; this monitor stops at the first match that changes its status.",
    });
    expect(rows[1]).toHaveAccessibleName("Interface errors: Not evaluated");
  });

  test("after the criteria that set the status: that criteria, not the first match", () => {
    const rows: Array<HTMLElement> = renderCriteria(PACK_POLL);

    expect(said(rows[4]!)).toEqual({
      why: "Not evaluated because “Device is online” matched and set the monitor's status.",
      how: "Criteria are evaluated in order; this monitor stops at the first match that changes its status.",
    });
    expect(rows[4]).toHaveAccessibleName("Device is back: Not evaluated");
  });

  test("the criteria evaluated for the status read as any evaluated criteria do", () => {
    const rows: Array<HTMLElement> = renderCriteria(PACK_POLL);

    expect(rows[0]).toHaveAccessibleName("Interface saturated: Met");
    expect(rows[2]).toHaveAccessibleName("Device unreachable: Not Met");
    expect(rows[3]).toHaveAccessibleName("Device is online: Met");
  });

  test("a first match that decides: the words it always had", () => {
    const rows: Array<HTMLElement> = renderCriteria([
      result({ criteriaId: "Device unreachable", met: true }),
      passedOver("Device is online", "earlier-criterion-matched"),
    ]);

    expect(said(rows[1]!)).toEqual({
      why: "Not evaluated because “Device unreachable” matched first.",
      how: "Criteria are evaluated in order; this monitor stops after the first match.",
    });
  });

  test("a criteria with no name is named by its place, as the list names it", () => {
    const rows: Array<HTMLElement> = renderCriteria([
      result({ criteriaId: "first", criteriaName: "", met: true }),
      result({ criteriaId: "second", criteriaName: "", met: true }),
      passedOver("third", "status-already-set", ""),
    ]);

    expect(said(rows[2]!).why).toBe(
      "Not evaluated because “Criteria 2” matched and set the monitor's status.",
    );
  });

  test("a disabled criteria after the status was set stays disabled, with its own reason", () => {
    const rows: Array<HTMLElement> = renderCriteria([
      result({ criteriaId: "Interface saturated", met: true }),
      result({ criteriaId: "Device is online", met: true }),
      result({
        criteriaId: "Old check",
        skipped: true,
        skipCause: "disabled",
        skipReason: "This criteria is disabled, so it was not evaluated.",
        message: "This criteria is disabled, so it was not evaluated.",
      }),
    ]);

    expect(rows[2]).toHaveAccessibleName("Old check: Disabled");
    expect(rows[2]).toHaveTextContent(
      "This criteria is disabled, so it was not evaluated.",
    );
    expect(rows[2]).not.toHaveTextContent("set the monitor's status");
  });

  test("each cause has words of its own", () => {
    const words: Array<string> = Object.values(NOT_EVALUATED_AFTER_MATCH_WORDS);

    expect(new Set(words).size).toBe(words.length);
  });
});

describe.each(LANGUAGES)(
  "why a criteria was not evaluated, in %s",
  (language: string) => {
    test("each cause is worded in the language, naming its criteria once", async () => {
      await readIn(language);

      const rows: Array<HTMLElement> = renderCriteria(PACK_POLL);
      const noStatus: { why: string; how: string } = said(rows[1]!);
      const afterStatus: { why: string; how: string } = said(rows[4]!);

      // Never the English, and never the stored reason.
      expect(noStatus.why).not.toBe(
        "Not evaluated because “Interface saturated” matched first, and this criteria changes no status.",
      );
      expect(afterStatus.why).not.toBe(
        "Not evaluated because “Device is online” matched and set the monitor's status.",
      );
      expect(noStatus.how).not.toBe(
        "Criteria are evaluated in order; this monitor stops at the first match that changes its status.",
      );
      expect(noStatus.why).not.toContain("Stored English reason.");

      // The criteria each one means, by name, once.
      expect(noStatus.why.split("“Interface saturated”").length - 1).toBe(1);
      expect(afterStatus.why.split("“Device is online”").length - 1).toBe(1);
      expect(afterStatus.why).not.toContain("Interface saturated");

      // Two causes, two sentences.
      expect(noStatus.why.replace("“Interface saturated”", "")).not.toBe(
        afterStatus.why.replace("“Device is online”", ""),
      );
    });

    test("a monitor that stops at its first match is said apart from one that stops at its first status match", async () => {
      await readIn(language);

      const judgedPast: string = said(renderCriteria(PACK_POLL)[1]!).how;

      cleanup();

      const stoppedAtFirst: string = said(
        renderCriteria([
          result({ criteriaId: "Device unreachable", met: true }),
          passedOver("Device is online", "earlier-criterion-matched"),
        ])[1]!,
      ).how;

      expect(judgedPast).not.toBe(stoppedAtFirst);
      expect(judgedPast.length).toBeGreaterThan(0);
      expect(stoppedAtFirst.length).toBeGreaterThan(0);
    });
  },
);
