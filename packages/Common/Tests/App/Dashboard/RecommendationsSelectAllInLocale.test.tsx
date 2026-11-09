import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import fs from "fs";
import path from "path";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import RecommendationsList, {
  RECOMMENDATION_CATEGORY_TEST_ID_PREFIX,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/RecommendationsList";
import {
  RecommendationCategoryGroup,
  RecommendationStatus,
  RecommendationViewModel,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/RecommendationViewModel";
import Route from "../../../Types/API/Route";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import {
  MonitorRecommendationResourceType,
  MonitorRecommendationSeverity,
} from "../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import RecommendationType from "../../../Types/Recommendation/RecommendationType";
import { SUPPORTED_DASHBOARD_LANGUAGE_CODES } from "../../../Types/Dashboard/DashboardLanguage";
import { getNumberLocale } from "../../../Types/DateLanguage";

/*
 * "SELECT ALL" FOR ONE RECOMMENDATION, IN EVERY LANGUAGE (#6150's review).
 *
 * A Recommendations section's heading offered "Select all {{count}}" for
 * any number left to set up, so a section of one read "Select all 1" - in
 * German "Alle 1 auswählen". A section of one has its card's own checkbox
 * one line below, so its heading offers nothing now; a section of two or
 * more says how many it selects, in each language's own words and digits,
 * from the Dashboard's shipped locale files.
 *
 * The sentence is shared with the discovered-devices import's "Select all
 * 511" (hosts). Chinese counted it with 台, the measure word for machines,
 * which is wrong for recommended monitors: it counts with 项 (items) now,
 * which is right for both.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

/*
 * Every language a reader can pick, English included: a language added to
 * the picker (Arabic was the eighteenth) is held to the same rule.
 */
const LANGUAGES: ReadonlyArray<string> = SUPPORTED_DASHBOARD_LANGUAGE_CODES;

const SELECT_ALL: string = "Select all {{count}}";

function readLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

const LOCALES: Record<string, Record<string, string>> = {};
const INSTANCES: Record<string, i18n> = {};

beforeAll(async () => {
  for (const language of LANGUAGES) {
    LOCALES[language] = readLocale(language);

    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: { [language]: { translation: LOCALES[language]! } },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    INSTANCES[language] = instance;
  }
});

afterEach(() => {
  cleanup();
});

function available(data: {
  templateId: string;
  name: string;
  category: string;
  severity: MonitorRecommendationSeverity;
}): RecommendationViewModel {
  return {
    recommendation: {
      recommendationId: `Kubernetes:${data.templateId}`,
      recommendationType: RecommendationType.Monitor,
      resourceType: MonitorRecommendationResourceType.Kubernetes,
      monitorType: MonitorType.Kubernetes,
      templateId: data.templateId,
      name: data.name,
      description: `Watch for ${data.name.toLowerCase()}.`,
      category: data.category,
      severity: data.severity,
      getMonitorStep: () => {
        return new MonitorStep();
      },
    },
    status: RecommendationStatus.Available,
  };
}

/*
 * Two sections: Workload with two recommendations left to set up, Storage
 * with one.
 */
const GROUPS: Array<RecommendationCategoryGroup> = [
  {
    category: "Workload",
    recommendations: [
      available({
        templateId: "k8s-pod-crash-loop",
        name: "Pod Crash Looping",
        category: "Workload",
        severity: "Critical",
      }),
      available({
        templateId: "k8s-pod-oom-killed",
        name: "Pod OOM Killed",
        category: "Workload",
        severity: "Warning",
      }),
    ],
  },
  {
    category: "Storage",
    recommendations: [
      available({
        templateId: "k8s-pv-almost-full",
        name: "Persistent Volume Almost Full",
        category: "Storage",
        severity: "Warning",
      }),
    ],
  },
];

function renderIn(language: string): void {
  render(
    <I18nextProvider i18n={INSTANCES[language]!}>
      <RecommendationsList
        groups={GROUPS}
        selectedRecommendationIds={new Set<string>()}
        onSelectionChange={() => {}}
        onDismiss={() => {}}
        onRestore={() => {}}
        getMonitorRoute={() => {
          return new Route("/dashboard/monitors");
        }}
      />
    </I18nextProvider>,
  );
}

function section(category: string): HTMLElement {
  return screen.getByTestId(
    `${RECOMMENDATION_CATEGORY_TEST_ID_PREFIX}${category}`,
  );
}

/*
 * What `language` says for selecting `count`, from its shipped locale, in
 * the digits the language is written with here: Persian's own, and Latin
 * ones in Arabic (Locales/ARABIC.md), as the translator writes a number.
 */
function selectAllWords(language: string, count: number): string {
  const template: string = LOCALES[language]![SELECT_ALL] || SELECT_ALL;

  return template.replace(
    "{{count}}",
    count.toLocaleString(getNumberLocale(language)),
  );
}

describe("a section of one recommendation offers no Select all", () => {
  test("German: a section of two reads Alle 2 auswählen, a section of one has no Alle 1 auswählen", () => {
    renderIn("de");

    expect(LOCALES["de"]![SELECT_ALL]).toBe("Alle {{count}} auswählen");
    expect(
      within(section("Workload")).getByRole("button", {
        name: "Alle 2 auswählen",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Alle 1 auswählen")).toBeNull();
    expect(
      within(section("Storage")).queryByTestId(
        "recommendation-group-select-all-Storage",
      ),
    ).toBeNull();
  });

  test("English: Select all 2, and never Select all 1", () => {
    renderIn("en");

    expect(
      within(section("Workload")).getByRole("button", {
        name: "Select all 2",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Select all 1")).toBeNull();
  });

  test.each(LANGUAGES)(
    "%s: the section of two says how many in its own words; the section of one offers none",
    (language: string) => {
      renderIn(language);

      expect(
        within(section("Workload")).getByTestId(
          "recommendation-group-select-all-Workload",
        ).textContent,
      ).toBe(selectAllWords(language, 2));

      expect(
        within(section("Storage")).queryByTestId(
          "recommendation-group-select-all-Storage",
        ),
      ).toBeNull();
      expect(document.body.textContent).not.toContain(
        selectAllWords(language, 1),
      );
    },
  );
});

describe("the sentence's words in every language", () => {
  test.each(
    LANGUAGES.filter((language: string): boolean => {
      return language !== "en";
    }),
  )(
    "%s words Select all {{count}} with the count in it, once",
    (language: string) => {
      const words: string | undefined = LOCALES[language]![SELECT_ALL];

      expect(typeof words).toBe("string");
      expect(words).not.toBe(SELECT_ALL);
      expect(words!.split("{{count}}")).toHaveLength(2);
    },
  );

  /*
   * 台 counts machines - right for the import's hosts, wrong for the
   * recommended monitors the same sentence selects. 项 (項) counts items,
   * which both are.
   */
  test.each([
    ["zh-CN", "项"],
    ["zh-TW", "項"],
  ])(
    "%s counts the items it selects with %s, never with the measure word for machines",
    (language: string, measureWord: string) => {
      const words: string = LOCALES[language]![SELECT_ALL]!;

      expect(words).toContain(`{{count}} ${measureWord}`);
      expect(words).not.toContain("台");
    },
  );
});
