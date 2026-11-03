import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import persianLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/fa.json";

/*
 * An EmbeddedMetricCard's title in the reader's language.
 *
 * The card wraps its title in a span that truncates it, and Card translates
 * only a title it is handed as words. So every card of charts - the Golden
 * Signals of the Ceph and storage array Overviews among them - kept its
 * English title in all 16 languages, under a description in the reader's
 * language (Card is handed that as words). The card looks its title up
 * before it wraps it.
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

// The locale's flat keys, the ones a card's words are looked up by.
const PERSIAN: Record<string, string> = persianLocale as unknown as Record<
  string,
  string
>;

const TITLE: string = "Golden Signals";
const DESCRIPTION: string =
  "Capacity, client I/O, and OSD latency for this cluster.";

const QUERY_CONFIGS: Array<MetricQueryConfigData> = [
  {
    metricAliasData: { metricVariable: "a" },
    metricQueryData: {
      filterData: {
        metricName: "ceph_cluster_total_used_bytes",
        attributes: {},
        aggegationType: MetricsAggregationType.Avg,
      },
    },
  } as unknown as MetricQueryConfigData,
];

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  const locales: Record<string, Record<string, unknown>> = {
    en: englishLocale as Record<string, unknown>,
    fa: persianLocale as Record<string, unknown>,
  };

  for (const [language, locale] of Object.entries(locales)) {
    const instance: i18n = createInstance();

    // The Dashboard's own configuration (Utils/i18n.ts).
    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: englishLocale },
        [language]: { translation: locale },
      },
      interpolation: { escapeValue: false },
    });

    instances[language] = instance;
  }
});

afterEach(() => {
  cleanup();
});

function drawCard(language: string, title: string | React.ReactElement): void {
  render(
    <I18nextProvider i18n={instances[language]!}>
      <EmbeddedMetricCard
        title={title}
        description={DESCRIPTION}
        queryConfigs={QUERY_CONFIGS}
        defaultTimeRange={{ range: TimeRange.PAST_ONE_HOUR }}
      />
    </I18nextProvider>,
  );
}

describe("an EmbeddedMetricCard's title", () => {
  test("the shipped Persian words differ from the English, so the checks below mean something", () => {
    expect(PERSIAN[TITLE]).toBeTruthy();
    expect(PERSIAN[TITLE]).not.toBe(TITLE);
    expect(PERSIAN[DESCRIPTION]).toBeTruthy();
    expect(PERSIAN[DESCRIPTION]).not.toBe(DESCRIPTION);
  });

  test("is in the reader's language, as the description under it is", () => {
    drawCard("fa", TITLE);

    const title: HTMLElement = screen.getByText(PERSIAN[TITLE]!);
    // Still the wrapper that truncates a long title beside the controls.
    expect(title).toHaveClass("block", "truncate");
    expect(screen.queryByText(TITLE)).toBeNull();
    expect(screen.getByText(PERSIAN[DESCRIPTION]!)).toBeInTheDocument();
  });

  test("reads as written in English", () => {
    drawCard("en", TITLE);

    expect(screen.getByText(TITLE)).toHaveClass("block", "truncate");
    expect(screen.getByText(DESCRIPTION)).toBeInTheDocument();
  });

  test("a title the locale has no words for reads as written", () => {
    const own: string = "fa-prod-01 replication";
    expect(PERSIAN[own]).toBeUndefined();

    drawCard("fa", own);

    expect(screen.getByText(own)).toHaveClass("block", "truncate");
  });

  test("a title handed over as an element is drawn as it is", () => {
    drawCard("fa", <span data-testid="own-title">{TITLE}</span>);

    expect(screen.getByTestId("own-title")).toHaveTextContent(TITLE);
  });
});
