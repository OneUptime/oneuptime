import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";

/*
 * A METRIC CARD'S TITLE IS LOOKED UP ONCE (#8355).
 *
 * EmbeddedMetricCard looks a title it is handed as words up itself (Card
 * looks up only a title handed as words, not one in the span that truncates
 * it: EmbeddedMetricCardTitleInLocale). A page that words its own title -
 * the Docker and Podman containers' "Container Metrics: {{containerName}}" -
 * had it looked up a second time, and a sentence that is itself a key read
 * as another word. The card takes isTitleTranslated now and draws such a
 * title as given; English is still looked up, once.
 *
 * In the Dashboard's own Spanish, Dutch and Persian: Spanish says "Red" for
 * Network and "Rojo" for "Red"; Dutch "Start" for Home and "Starten" for
 * "Start"; Persian "شبکه" for Network, made here a key of its own.
 */

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricView",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="metric-view" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/UseEventTimeReferenceLines",
  () => {
    return {
      __esModule: true,
      default: () => {
        return { lines: [], markerCount: 0 };
      },
    };
  },
);

jest.mock("../../../UI/Components/Date/RangeStartAndEndDateView", () => {
  return {
    __esModule: true,
    default: () => {
      return <span data-testid="card-picker" />;
    },
  };
});

import EmbeddedMetricCard from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/EmbeddedMetricCard";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import TimeRange from "../../../Types/Time/TimeRange";

interface Language {
  code: string;
  english: string;
  word: string;
  twice: string;
  extra?: Record<string, string>;
}

const LANGUAGES: Array<Language> = [
  { code: "es", english: "Network", word: "Red", twice: "Rojo" },
  { code: "nl", english: "Home", word: "Start", twice: "Starten" },
  {
    code: "fa",
    english: "Network",
    word: "شبکه",
    twice: "قرمز",
    extra: { شبکه: "قرمز" },
  },
];

const CONTAINER_SENTENCE: string = "Container Metrics: {{containerName}}";

// What a sentence the page worded reads, looked up again.
const SENTENCE_TWICE: string = "Looked up twice";

const QUERY_CONFIGS: Array<MetricQueryConfigData> = [
  {
    metricAliasData: { metricVariable: "a" },
    metricQueryData: {
      filterData: {
        metricName: "container.cpu.utilization",
        attributes: {},
        aggegationType: MetricsAggregationType.Avg,
      },
    },
  } as unknown as MetricQueryConfigData,
];

function dashboardIn(
  language: Language,
  extra: Record<string, string> = {},
): i18n {
  const instance: i18n = createInstance();

  instance.init({
    lng: language.code,
    fallbackLng: "en",
    resources: {
      en: { translation: readDashboardLocale("en") },
      [language.code]: {
        translation: {
          ...readDashboardLocale(language.code),
          ...(language.extra || {}),
          ...extra,
        },
      },
    },
    interpolation: { escapeValue: false },
    initImmediate: false,
  });

  return instance;
}

function drawCard(
  translation: i18n,
  title: string,
  isTitleTranslated?: boolean,
): void {
  render(
    <I18nextProvider i18n={translation}>
      <EmbeddedMetricCard
        title={title}
        isTitleTranslated={isTitleTranslated}
        queryConfigs={QUERY_CONFIGS}
        defaultTimeRange={{ range: TimeRange.PAST_ONE_HOUR }}
      />
    </I18nextProvider>,
  );
}

// The card's title, as the truncating span draws it.
function cardTitle(): string {
  const span: Element | null = document.body.querySelector(
    "span.block.truncate",
  );

  return (span?.textContent || "").trim();
}

afterEach(() => {
  cleanup();
});

describe.each(LANGUAGES)(
  "a metric card's title, in $code",
  (language: Language) => {
    const { english, word, twice } = language;

    test(`the words these cases lean on: ${english} is ${word}, and ${word} again ${twice}`, () => {
      const translation: i18n = dashboardIn(language);

      expect(translation.t(english)).toBe(word);
      expect(translation.t(word)).toBe(twice);
    });

    test("looks English up once", () => {
      drawCard(dashboardIn(language), english);

      expect(cardTitle()).toBe(word);
    });

    test(`draws a title the page worded as given: ${word}, never ${twice}`, () => {
      drawCard(dashboardIn(language), word, true);

      expect(cardTitle()).toBe(word);
      expect(screen.queryByText(twice)).toBeNull();
    });

    test("draws a container's sentence as the page worded it, even where that sentence is a key", () => {
      const worded: string = dashboardIn(language).t(CONTAINER_SENTENCE, {
        containerName: "web-1",
      }) as string;

      // In the language's words, the container's name in it.
      expect(worded).toContain("web-1");
      expect(worded).not.toBe("Container Metrics: web-1");

      drawCard(
        dashboardIn(language, { [worded]: SENTENCE_TWICE }),
        worded,
        true,
      );

      expect(cardTitle()).toBe(worded);
      expect(screen.queryByText(SENTENCE_TWICE)).toBeNull();
    });
  },
);
