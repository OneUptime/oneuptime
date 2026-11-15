// UX rule: Docs/ux/README.md#in-every-language
import "@testing-library/jest-dom";
import { act, cleanup, render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import EventRootCauseMetricChart, {
  RootCauseEventReader,
  RootCauseMoments,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/EventRootCauseMetricChart";
import { EventMetricSubject } from "../../../../App/FeatureSet/Dashboard/src/Utils/EventMetricInvestigation";
import { RootCauseEvent } from "../../../../App/FeatureSet/Dashboard/src/Utils/EventRootCauseMetrics";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import ObjectID from "../../../Types/ObjectID";
import { TelemetryQuery } from "../../../Types/Telemetry/TelemetryQuery";
import TelemetryType from "../../../Types/Telemetry/TelemetryType";
import { StateListType } from "../../../Utils/StateOrder";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";

/*
 * THE LINE OVER A ROOT CAUSE CARD'S CHARTS FOLLOWS THE READER'S LANGUAGE
 * (#8269).
 *
 * An incident a grouped metric monitor opened for a series with no value
 * for its attribute has its charts narrowed to that series, and the card
 * says so: "scoped to the affected series (service.name = (unset))". The
 * "(unset)" was English on a German or Persian page. The card now works
 * the line out as it is drawn, from the event it read, with the reader's
 * word - and when the language changes after the read (the language menu,
 * or the person's own language arriving once the page is up), the line
 * changes with it, without reading the event again.
 *
 * The investigation is drawn as what it is handed.
 */

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/EventMetricInvestigationPanel",
  () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const mockReact: typeof React = require("react");

    return {
      __esModule: true,
      default: (props: { seriesSummary: string }) => {
        return mockReact.createElement(
          "p",
          { "data-testid": "scoped-line" },
          props.seriesSummary,
        );
      },
    };
  },
);

function groupedBy(keys: Array<string>): MetricQueryConfigData {
  return {
    metricAliasData: {
      metricVariable: "a",
      title: "",
      description: "",
      legend: "",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: "http.requests",
        aggegationType: MetricsAggregationType.Sum,
      } as never,
      groupByAttributeKeys: keys,
    },
  };
}

const SNAPSHOT: TelemetryQuery = {
  telemetryType: TelemetryType.Metric,
  telemetryQuery: null,
  metricViewData: {
    startAndEndDate: new InBetween<Date>(
      new Date("2026-11-15T10:00:00.000Z"),
      new Date("2026-11-15T11:00:00.000Z"),
    ),
    queryConfigs: [groupedBy(["service.name", "host.name"])],
    formulaConfigs: [],
  },
};

const EVENT: RootCauseEvent = {
  telemetryQuery: SNAPSHOT,
  seriesLabels: { "service.name": "", "host.name": "prod-01" },
  monitors: [],
  createdCriteriaId: null,
  startedAt: new Date("2026-11-15T10:30:00.000Z"),
  impactStartedAt: undefined,
};

const MOMENTS: RootCauseMoments = { stateTimeline: [], states: [] };

let reads: number = 0;

const READER: RootCauseEventReader = {
  subject: EventMetricSubject.Incident,
  stateList: StateListType.IncidentState,
  readEvent: (): Promise<RootCauseEvent | null> => {
    reads++;
    return Promise.resolve(EVENT);
  },
  readMoments: (): Promise<RootCauseMoments> => {
    return Promise.resolve(MOMENTS);
  },
};

const EVENT_ID: ObjectID = ObjectID.generate();

let instance: i18n;

beforeAll(async () => {
  instance = createInstance();

  await instance.init({
    lng: "de",
    fallbackLng: "en",
    resources: {
      en: { translation: readDashboardLocale("en") },
      de: { translation: readDashboardLocale("de") },
      fa: { translation: readDashboardLocale("fa") },
      ar: { translation: readDashboardLocale("ar") },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(async () => {
  cleanup();
  reads = 0;
  await instance.changeLanguage("de");
});

const drawCard: () => Promise<HTMLElement> = async (): Promise<HTMLElement> => {
  render(
    <I18nextProvider i18n={instance}>
      <EventRootCauseMetricChart eventId={EVENT_ID} reader={READER} />
    </I18nextProvider>,
  );

  return screen.findByTestId("scoped-line");
};

function lineIn(language: string): string {
  return `service.name = ${readDashboardLocale(language)["(unset)"]}, host.name = prod-01`;
}

describe("a Root Cause card's scoped line", () => {
  test.each(["de", "fa", "ar"])(
    "says an empty group in %s, a real value as it is",
    async (language: string) => {
      await act(async () => {
        await instance.changeLanguage(language);
      });

      const line: HTMLElement = await drawCard();

      expect(line.textContent).toBe(lineIn(language));
      expect(line.textContent).not.toContain("(unset)");
    },
  );

  test("in English it says (unset), as before", async () => {
    await act(async () => {
      await instance.changeLanguage("en");
    });

    expect((await drawCard()).textContent).toBe(
      "service.name = (unset), host.name = prod-01",
    );
  });

  test("follows the language when it changes after the read, without reading again", async () => {
    const line: HTMLElement = await drawCard();

    expect(line.textContent).toBe(lineIn("de"));
    expect(reads).toBe(1);

    await act(async () => {
      await instance.changeLanguage("fa");
    });

    expect(screen.getByTestId("scoped-line").textContent).toBe(lineIn("fa"));

    await act(async () => {
      await instance.changeLanguage("en");
    });

    expect(screen.getByTestId("scoped-line").textContent).toBe(
      "service.name = (unset), host.name = prod-01",
    );
    expect(reads).toBe(1);
  });

  test("the languages the test reads each have a word of their own (control)", () => {
    const words: Set<string> = new Set<string>(
      ["en", "de", "fa", "ar"].map((language: string): string => {
        return readDashboardLocale(language)["(unset)"] as string;
      }),
    );

    expect(words.size).toBe(4);
  });
});
