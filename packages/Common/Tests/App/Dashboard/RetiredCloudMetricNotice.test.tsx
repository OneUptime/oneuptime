import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React from "react";
import { I18nextProvider } from "react-i18next";
import {
  PUBSUB_MESSAGES_PUBLISHED_METRIC,
  PUBSUB_PUBLISH_OPERATIONS_METRIC,
  RetiredCloudMetric,
  RetiredCloudMetricNotice as Notice,
  getRetiredCloudMetricNotices,
} from "../../../Utils/Metrics/RetiredCloudMetricMoves";
import RetiredCloudMetricNotice, {
  RETIRED_CLOUD_METRIC_NOTICES_TEST_ID,
  RETIRED_CLOUD_METRIC_NOTICE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/RetiredCloudMetricNotice";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

/*
 * What a query of a deprecated cloud metric says where it is seen (#9739's
 * gap, #9980): a monitor's Metrics card, a dashboard's chart and the query
 * being edited each draw one line a deprecated metric - Cosmos DB's
 * ServerSideLatency, Pub/Sub's send_message_operation_count - with what
 * replaces it, in the reader's language, each name drawn as code.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);
const LANGUAGES: ReadonlyArray<string> = ["en", ...DASHBOARD_LANGUAGES];

const COSMOS_SENTENCE: string =
  "Microsoft is removing {{metric}} from Azure Monitor: read {{direct}} or {{gateway}} instead. OneUptime still reads it for saved monitors and charts, and moves each to the latency its account reports once there is one.";
const PUBSUB_SENTENCE: string =
  "Google deprecates {{metric}}: read {{replacement}} instead, the messages published a minute, which is 60 times the rate a second. OneUptime still reads it for saved monitors and charts while Google publishes it.";

const locales: Record<string, Record<string, string>> = {};
const instances: Record<string, i18n> = {};

function query(metricName: unknown): unknown {
  return {
    metricAliasData: { metricVariable: "a" },
    metricQueryData: { filterData: { metricName, attributes: {} } },
  };
}

function draw(queryConfigs: Array<unknown>, language: string = "en"): void {
  render(
    <I18nextProvider i18n={instances[language]!}>
      <RetiredCloudMetricNotice queryConfigs={queryConfigs} />
    </I18nextProvider>,
  );
}

beforeAll(async () => {
  for (const language of LANGUAGES) {
    locales[language] = JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
    ) as Record<string, string>;
  }

  for (const language of LANGUAGES) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: locales["en"]! },
        [language]: { translation: locales[language]! },
      },
      interpolation: { escapeValue: false },
    });

    instances[language] = instance;
  }
});

afterEach(() => {
  cleanup();
});

describe("which queries say so", () => {
  test("each deprecated metric the queries read, once, with what replaces it", () => {
    const notices: Array<Notice> = getRetiredCloudMetricNotices([
      query("azure_serversidelatency_average"),
      query("azure_serversidelatency_average"),
      query(" Azure_ServerSideLatency_Average "),
      query(PUBSUB_PUBLISH_OPERATIONS_METRIC),
      query("azure_serversidelatencydirect_average"),
      query(PUBSUB_MESSAGES_PUBLISHED_METRIC),
    ]);

    expect(notices).toEqual([
      {
        metric: RetiredCloudMetric.CosmosServerSideLatency,
        metricName: "azure_serversidelatency_average",
        replacements: [
          "azure_serversidelatencydirect_average",
          "azure_serversidelatencygateway_average",
        ],
      },
      {
        metric: RetiredCloudMetric.PubSubPublishOperations,
        metricName: PUBSUB_PUBLISH_OPERATIONS_METRIC,
        replacements: [PUBSUB_MESSAGES_PUBLISHED_METRIC],
      },
    ]);
  });

  test("none for any other metric, nor for what is no query", () => {
    expect(
      getRetiredCloudMetricNotices([
        query("azure_percentage_cpu_average"),
        query(undefined),
        query(42),
        {},
        null,
        "azure_serversidelatency_average",
      ]),
    ).toEqual([]);
  });

  test("draws nothing at all when no query reads one", () => {
    draw([query("azure_percentage_cpu_average")]);

    expect(
      screen.queryByTestId(RETIRED_CLOUD_METRIC_NOTICES_TEST_ID),
    ).not.toBeInTheDocument();
  });
});

describe("what it says", () => {
  test("a Cosmos DB query names its replacements as code, and that it moves once the account reports one", () => {
    draw([query("azure_serversidelatency_maximum")]);

    const line: HTMLElement = screen.getByTestId(
      RETIRED_CLOUD_METRIC_NOTICE_TEST_ID,
    );

    expect(line).toHaveTextContent(
      "Microsoft is removing azure_serversidelatency_maximum from Azure Monitor: read azure_serversidelatencydirect_maximum or azure_serversidelatencygateway_maximum instead. OneUptime still reads it for saved monitors and charts, and moves each to the latency its account reports once there is one.",
    );
    expect(
      within(line)
        .getAllByText(/serversidelatency/)
        .map((element: HTMLElement): string => {
          return `${element.tagName}:${element.getAttribute("dir")}`;
        }),
    ).toEqual(["CODE:ltr", "CODE:ltr", "CODE:ltr"]);
    expect(screen.getByRole("note")).toBe(
      screen.getByTestId(RETIRED_CLOUD_METRIC_NOTICES_TEST_ID),
    );
  });

  test("a Pub/Sub query names the count that replaces it, and the factor between the two", () => {
    draw([query(PUBSUB_PUBLISH_OPERATIONS_METRIC)]);

    expect(
      screen.getByTestId(RETIRED_CLOUD_METRIC_NOTICE_TEST_ID),
    ).toHaveTextContent(
      `Google deprecates ${PUBSUB_PUBLISH_OPERATIONS_METRIC}: read ${PUBSUB_MESSAGES_PUBLISHED_METRIC} instead, the messages published a minute, which is 60 times the rate a second. OneUptime still reads it for saved monitors and charts while Google publishes it.`,
    );
  });

  test("one line a deprecated metric, both at once", () => {
    draw([
      query("azure_serversidelatency_average"),
      query(PUBSUB_PUBLISH_OPERATIONS_METRIC),
    ]);

    expect(
      screen.getAllByTestId(RETIRED_CLOUD_METRIC_NOTICE_TEST_ID),
    ).toHaveLength(2);
  });
});

describe("in every Dashboard language", () => {
  test.each(DASHBOARD_LANGUAGES as Array<string>)(
    "%s words both sentences, every name kept",
    (language: string) => {
      for (const sentence of [COSMOS_SENTENCE, PUBSUB_SENTENCE]) {
        const translated: string | undefined = locales[language]![sentence];

        expect(translated).toBeTruthy();
        expect([language, translated]).not.toEqual([language, sentence]);

        for (const placeholder of sentence.match(/\{\{\w+\}\}/g) || []) {
          expect([language, translated!.includes(placeholder)]).toEqual([
            language,
            true,
          ]);
        }
      }

      draw(
        [
          query("azure_serversidelatency_average"),
          query(PUBSUB_PUBLISH_OPERATIONS_METRIC),
        ],
        language,
      );

      const lines: Array<HTMLElement> = screen.getAllByTestId(
        RETIRED_CLOUD_METRIC_NOTICE_TEST_ID,
      );

      expect(lines[0]).not.toHaveTextContent("Microsoft is removing");
      expect(lines[0]).toHaveTextContent(
        "azure_serversidelatencygateway_average",
      );
      expect(lines[1]).not.toHaveTextContent("Google deprecates");
      expect(lines[1]).toHaveTextContent(PUBSUB_MESSAGES_PUBLISHED_METRIC);
    },
  );
});
