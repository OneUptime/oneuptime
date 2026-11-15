import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render, RenderResult, within } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import GoldenMetricTile from "../../../../App/FeatureSet/Dashboard/src/Components/Infrastructure/GoldenMetricTile";
import EventStatTile from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventStatTile";
import { LlmTile } from "../../../../App/FeatureSet/Dashboard/src/Components/LlmConversations/LlmSummaryTiles";
import CloudStatStrip from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudStatStrip";
import { ResourceOverviewTileCard } from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ResourceOverview";
import InsightStatusSummary from "../../../../App/FeatureSet/Dashboard/src/Components/AIInsights/InsightStatusSummary";
import { EMPTY_FIGURE_TEST_ID } from "../../../UI/Components/EmptyFigure/EmptyFigure";
import { EMPTY_VALUE_MARK } from "../../../UI/Components/Detail/EmptyValue";
import IconProp from "../../../Types/Icon/IconProp";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";

/*
 * EVERY STAT TILE DRAWS A READING IT DOES NOT HAVE AS THE FIGURE'S QUIET
 * DASH (#8264).
 *
 * A tile with no reading drew a bare em dash its caller handed it - about
 * a hundred and twenty `value={x === null ? "—" : fmt(x)}` - or a span of
 * its own (`text-2xl font-semibold text-gray-300`), in several greys, and
 * a screen reader heard "dash" or nothing. Each tile now draws EmptyFigure
 * for a value that is missing, blank or a dash: the em dash for the eye in
 * the grey of every empty value, at the tile's figure size, and "Not set"
 * for a screen reader in the reader's language. Callers hand no value.
 */

type Language = "en" | "de" | "ar" | "fa";

const LANGUAGES: ReadonlyArray<Language> = ["en", "de", "ar", "fa"];

const NOT_SET: Record<Language, string> = {
  en: "Not set",
  de: "Nicht festgelegt",
  ar: "غير معيّن",
  fa: "تنظیم نشده",
};

// The values a caller wrote for "no reading", and the one it hands now.
const NO_READINGS: ReadonlyArray<[string, string | null | undefined]> = [
  ["undefined", undefined],
  ["null", null],
  ["blank", ""],
  ["an em dash", "—"],
  ["a hyphen", "-"],
  ["an en dash", "–"],
];

const instances: Partial<Record<Language, i18n>> = {};

beforeAll(async () => {
  for (const language of LANGUAGES) {
    const instance: i18n = createInstance();
    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        [language]: { translation: readDashboardLocale(language) },
      },
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

function renderIn(
  language: Language,
  element: React.ReactElement,
): RenderResult {
  return render(
    <I18nextProvider i18n={instances[language]!}>{element}</I18nextProvider>,
  );
}

// What a screen reader hears: the text outside aria-hidden.
function spokenText(element: Element): string {
  const copy: Element = element.cloneNode(true) as Element;

  copy.querySelectorAll('[aria-hidden="true"]').forEach((hidden: Element) => {
    hidden.remove();
  });

  return (copy.textContent || "").replace(/\s+/g, " ").trim();
}

// The figure's quiet dash in an element, and what it says.
function expectEmptyFigure(figure: HTMLElement, language: Language): void {
  const empty: HTMLElement = within(figure).getByTestId(EMPTY_FIGURE_TEST_ID);

  expect(empty).toHaveClass("text-gray-400");
  expect(empty.querySelector('[aria-hidden="true"]')!.textContent).toBe(
    EMPTY_VALUE_MARK,
  );
  expect(spokenText(figure)).toBe(NOT_SET[language]);
  // One mark: the figure draws no dash of a caller's beside it.
  expect(figure.textContent).toBe(`${EMPTY_VALUE_MARK}${NOT_SET[language]}`);
}

const EVERY_LANGUAGE_AND_NO_READING: Array<
  [Language, string, string | null | undefined]
> = LANGUAGES.flatMap((language: Language) => {
  return NO_READINGS.map(
    ([name, value]: [string, string | null | undefined]): [
      Language,
      string,
      string | null | undefined,
    ] => {
      return [language, name, value];
    },
  );
});

describe("GoldenMetricTile", () => {
  test.each(EVERY_LANGUAGE_AND_NO_READING)(
    "in %s, a figure that is %s is the figure's quiet dash",
    (language: Language, _name: string, value: string | null | undefined) => {
      const { getByTestId } = renderIn(
        language,
        <GoldenMetricTile
          title="CPU"
          icon={IconProp.CPUChip}
          iconColor="blue"
          value={value}
        />,
      );

      const figure: HTMLElement = getByTestId("golden-metric-tile-value");
      // The figure's own size: the dash takes it.
      expect(figure).toHaveClass("text-2xl", "font-semibold");
      expectEmptyFigure(figure, language);
    },
  );

  test("a figure it has reads as given, with no quiet dash", () => {
    const { getByTestId } = renderIn(
      "fa",
      <GoldenMetricTile
        title="CPU"
        icon={IconProp.CPUChip}
        iconColor="blue"
        value="۴۲٪"
      />,
    );

    const figure: HTMLElement = getByTestId("golden-metric-tile-value");
    expect(figure).toHaveTextContent("۴۲٪");
    expect(within(figure).queryByTestId(EMPTY_FIGURE_TEST_ID)).toBeNull();
  });

  test("a figure written with a minus sign is a figure, not an empty one", () => {
    const { getByTestId } = renderIn(
      "en",
      <GoldenMetricTile
        title="Days left"
        icon={IconProp.Clock}
        iconColor="amber"
        value="-3 d"
      />,
    );

    expect(getByTestId("golden-metric-tile-value")).toHaveTextContent("-3 d");
  });
});

describe("EventStatTile", () => {
  test.each(
    LANGUAGES.flatMap((language: Language) => {
      return [
        [language, "card"],
        [language, "segment"],
      ] as Array<[Language, "card" | "segment"]>;
    }),
  )(
    "in %s, a %s with no reading draws the figure's quiet dash",
    (language: Language, variant: "card" | "segment") => {
      for (const [, value] of NO_READINGS) {
        const { container, unmount } = renderIn(
          language,
          <EventStatTile label="Alerts" value={value} variant={variant} />,
        );

        const figure: HTMLElement = container.querySelector(
          ".text-lg.font-semibold",
        ) as HTMLElement;
        expectEmptyFigure(figure, language);
        unmount();
      }
    },
  );

  test("an element it is handed is drawn as given", () => {
    const { container } = renderIn(
      "en",
      <EventStatTile label="Started" value={<time>09:30</time>} />,
    );

    expect(container.querySelector("time")).toHaveTextContent("09:30");
    expect(
      container.querySelector(`[data-testid="${EMPTY_FIGURE_TEST_ID}"]`),
    ).toBeNull();
  });
});

describe("LlmTile", () => {
  test.each(
    LANGUAGES.map((language: Language) => {
      return [language];
    }),
  )(
    "in %s, a total no provider reported is the figure's quiet dash",
    (language: Language) => {
      const { getByTestId } = renderIn(
        language,
        <LlmTile
          label="Cost (USD)"
          value={undefined}
          icon={IconProp.Billing}
          iconClassName="text-emerald-600"
          iconTileClassName="bg-emerald-50"
          dataTestId="llm-tile-cost"
          isLoading={false}
        />,
      );

      expectEmptyFigure(getByTestId("llm-tile-cost-value"), language);
    },
  );

  test("while it loads, it draws its placeholder, not an empty figure", () => {
    const { queryByTestId } = renderIn(
      "en",
      <LlmTile
        label="Cost (USD)"
        value={undefined}
        icon={IconProp.Billing}
        iconClassName="text-emerald-600"
        iconTileClassName="bg-emerald-50"
        dataTestId="llm-tile-cost"
        isLoading={true}
      />,
    );

    expect(queryByTestId("llm-tile-cost-value")).toBeNull();
    expect(queryByTestId(EMPTY_FIGURE_TEST_ID)).toBeNull();
  });
});

describe("CloudStatStrip", () => {
  test.each(
    LANGUAGES.map((language: Language) => {
      return [language];
    }),
  )(
    "in %s, a tile with no reading draws the figure's quiet dash",
    (language: Language) => {
      const { getAllByTestId } = renderIn(
        language,
        <CloudStatStrip
          tiles={[
            {
              key: "spend",
              title: "Spend",
              value: undefined,
              icon: IconProp.Billing,
              color: "blue",
            },
            {
              key: "resources",
              title: "Resources",
              value: "12",
              icon: IconProp.Cube,
              color: "sky",
            },
          ]}
        />,
      );

      const [empty, set] = getAllByTestId("cloud-stat-tile-value");
      expectEmptyFigure(empty!, language);
      expect(set!).toHaveTextContent("12");
      expect(within(set!).queryByTestId(EMPTY_FIGURE_TEST_ID)).toBeNull();
    },
  );
});

describe("ResourceOverview's tile", () => {
  test.each(
    LANGUAGES.map((language: Language) => {
      return [language];
    }),
  )(
    "in %s, a reading the resource has not reported is the figure's quiet dash",
    (language: Language) => {
      const { container } = renderIn(
        language,
        <ResourceOverviewTileCard
          title="Requests"
          value={undefined}
          icon={IconProp.Globe}
          iconColor="blue"
        />,
      );

      const figure: HTMLElement = container.querySelector(
        ".text-2xl.font-semibold",
      ) as HTMLElement;
      expectEmptyFigure(figure, language);
    },
  );

  test("its words for a missing value still win over the dash", () => {
    const { getByTestId, queryByTestId } = renderIn(
      "de",
      <ResourceOverviewTileCard
        title="Requests"
        value={undefined}
        valueNote="No data"
        icon={IconProp.Globe}
        iconColor="blue"
      />,
    );

    expect(getByTestId("resource-overview-tile-value-note")).toHaveTextContent(
      readDashboardLocale("de")["No data"]!,
    );
    expect(queryByTestId(EMPTY_FIGURE_TEST_ID)).toBeNull();
  });
});

describe("InsightStatusSummary", () => {
  test.each(
    LANGUAGES.map((language: Language) => {
      return [language];
    }),
  )(
    "in %s, a count that could not be read is the figure's quiet dash",
    (language: Language) => {
      const { container } = renderIn(
        language,
        <InsightStatusSummary
          buckets={[
            {
              label: "Open",
              value: "open",
              dotClassName: "bg-amber-500",
              count: null,
            },
          ]}
          selectedValue="open"
          isLoading={false}
          onSelect={() => {}}
        />,
      );

      const figure: HTMLElement = container.querySelector(
        ".text-2xl.font-semibold",
      ) as HTMLElement;
      expectEmptyFigure(figure, language);
    },
  );
});
