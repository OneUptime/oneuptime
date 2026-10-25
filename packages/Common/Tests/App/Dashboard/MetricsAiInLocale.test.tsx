import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  configure,
  render,
  screen,
  within,
} from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import React from "react";
import { initReactI18next } from "react-i18next";
import { MemoryRouter } from "react-router-dom";

/*
 * Metrics → AI in the reader's language, with the shipped Dashboard locales:
 * the inbox scoped to the Metric lane (its intro, its kinds, statuses and
 * severities, its filters and its footer) and a finding's page (Fix with AI
 * for metric names with IDs, and how many times it was detected). Every
 * label here read English on a German page until the UI review: the AI
 * Insights inbox's status, severity, filter and sort words had no German,
 * and the Detections fact was glued together in English ("5 times").
 *
 * The pages are the real ones; only the network and the route are stubbed.
 */

configure({ asyncUtilTimeout: 20000 });

const INSIGHT_ID: string = "5231fafa-1111-4111-8111-111111111111";
const SERVICE_ID: string = "5231fafa-2222-4222-8222-222222222222";

let rows: Array<unknown> = [];
let item: unknown = null;

jest.mock("react-router-dom", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "react-router-dom",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    useParams: () => {
      return { id: INSIGHT_ID };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: async (request: {
        skip: number;
        limit: number;
      }): Promise<unknown> => {
        return {
          data: rows.slice(request.skip, request.skip + request.limit),
          count: rows.length,
          skip: request.skip,
          limit: request.limit,
        };
      },
      getItem: async (): Promise<unknown> => {
        return item;
      },
      count: async (): Promise<number> => {
        return rows.length;
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

// The page's own reads: Fix with AI is offered, and no triage has run yet.
async function answerPost(request: {
  url: { toString: () => string };
}): Promise<HTTPResponse<JSONObject>> {
  const url: string = request.url.toString();

  if (url.endsWith("/telemetry-ai/fix-suggestion")) {
    return new HTTPResponse<JSONObject>(
      200,
      {
        offer: "Act",
        blocker: null,
        repository: {
          id: "5231fafa-4444-4444-8444-444444444444",
          name: "acme/worker",
        },
        repositories: [],
        taskId: null,
      },
      {},
    );
  }

  return new HTTPResponse<JSONObject>(200, { run: null, events: [] }, {});
}

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (request: { url: { toString: () => string } }) => {
        return answerPost(request);
      },
      getFriendlyMessage: (error: unknown): string => {
        return error instanceof Error ? error.message : "Request failed";
      },
    },
  };
});

import AIInsightsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/AIInsights/Insights";
import AIInsightViewPage from "../../../../App/FeatureSet/Dashboard/src/Pages/AIInsights/View/Index";
import {
  TELEMETRY_AI_LANE_COPY,
  getTelemetryAiInsightsScope,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryAi/TelemetryAiCopy";
import {
  TELEMETRY_AI_FIX_LEAD_METRIC_NAMES,
  TELEMETRY_AI_FIX_TEST_IDS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryAi/TelemetryAiFixCopy";
import AIInsight from "../../../Models/DatabaseModels/AIInsight";
import { MetricInsightEvidence } from "../../../Types/AI/AIInsightEvidence";
import AIInsightSeverity from "../../../Types/AI/AIInsightSeverity";
import AIInsightStatus from "../../../Types/AI/AIInsightStatus";
import AIInsightType from "../../../Types/AI/AIInsightType";
import { TelemetryAiLane } from "../../../Types/AI/TelemetryAi";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const GERMAN: Record<string, string> = readLocale("de");

async function readIn(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

const NAMES: MetricInsightEvidence = {
  serviceId: SERVICE_ID,
  kind: "HighCardinality",
  shape: "Name",
  windowStartTime: "2026-10-24T08:00:00.000Z",
  windowEndTime: "2026-10-24T09:00:00.000Z",
  namePattern: "job.{id}.duration",
  nameCount: 1234,
  dataPointCount: 56000,
};

function finding(data: {
  index: number;
  insightType: AIInsightType;
  severity: AIInsightSeverity;
  status: AIInsightStatus;
  occurrenceCount: number;
}): AIInsight {
  const insight: AIInsight = new AIInsight();
  insight.id = new ObjectID(
    `5231fafa-0000-4000-8000-${String(data.index).padStart(12, "0")}`,
  );
  insight.title = `metric finding ${data.index}`;
  insight.insightType = data.insightType;
  insight.severity = data.severity;
  insight.status = data.status;
  insight.serviceName = "worker";
  insight.telemetryServiceId = new ObjectID(SERVICE_ID);
  insight.occurrenceCount = data.occurrenceCount;
  insight.firstSeenAt = new Date("2026-10-24T05:00:00.000Z");
  insight.lastSeenAt = new Date("2026-10-24T09:00:00.000Z");
  return insight;
}

function namesFinding(occurrenceCount: number): AIInsight {
  const insight: AIInsight = finding({
    index: 1,
    insightType: AIInsightType.MetricHighCardinality,
    severity: AIInsightSeverity.High,
    status: AIInsightStatus.ActionRequired,
    occurrenceCount,
  });
  insight.id = new ObjectID(INSIGHT_ID);
  insight.title = "worker sends 1,234 metrics named like job.{id}.duration";
  insight.evidence = { metric: NAMES };
  insight.detailMarkdown = "**Metric names with IDs in worker**";
  return insight;
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: readLocale("en") },
      de: { translation: GERMAN },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  window.history.replaceState(
    window.history.state,
    "",
    "/dashboard/5231fafa-9999-4999-8999-999999999999/metrics/ai/insights",
  );
  rows = [
    finding({
      index: 1,
      insightType: AIInsightType.MetricHighCardinality,
      severity: AIInsightSeverity.High,
      status: AIInsightStatus.ActionRequired,
      occurrenceCount: 5,
    }),
    finding({
      index: 2,
      insightType: AIInsightType.MetricHistogramBuckets,
      severity: AIInsightSeverity.Medium,
      status: AIInsightStatus.FixOpened,
      occurrenceCount: 3,
    }),
    finding({
      index: 3,
      insightType: AIInsightType.MetricMissingMetrics,
      severity: AIInsightSeverity.Low,
      status: AIInsightStatus.Detected,
      occurrenceCount: 8,
    }),
  ];
  item = namesFinding(5);
});

afterEach(async () => {
  cleanup();
  await readIn("en");
});

function renderInbox(): void {
  render(
    <MemoryRouter>
      <AIInsightsPage
        {...({} as any)}
        scope={getTelemetryAiInsightsScope(TelemetryAiLane.Metric, false)}
      />
    </MemoryRouter>,
  );
}

async function renderFinding(): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <AIInsightViewPage
          pageRoute={new Route("/")}
          currentProject={null}
          hasPaymentMethod={true}
        />
      </MemoryRouter>,
    );
  });
}

describe("Metrics → AI → Insights in German", () => {
  test("the intro, the kinds, the statuses and severities, the filters and the footer are German", async () => {
    await readIn("de");
    renderInbox();

    await screen.findByText("metric finding 1");

    const intro: string =
      TELEMETRY_AI_LANE_COPY[TelemetryAiLane.Metric].insightsIntro;

    expect(GERMAN[intro]).toMatch(
      /^Jede Stunde sucht OneUptime nach Metriken/u,
    );
    expect(screen.getByText(GERMAN[intro]!)).toBeInTheDocument();

    /*
     * The kinds, and a severity. Medium and Low are words alert severities
     * and monitor sensitivities share, which the docs name as each locale
     * draws them (StateSettingsI18n): a locale words them for every
     * feature at once, not from this page.
     */
    for (const label of [
      "Hohe Kardinalität",
      "Falsche Histogramm-Buckets",
      "Fehlende Metriken",
      "Hoch",
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }

    // Each status where the list says it, and on the status strip.
    for (const status of ["Handlungsbedarf", "PR geöffnet", "Erkannt"]) {
      expect(screen.getAllByText(status).length).toBeGreaterThan(0);
    }

    expect(
      within(
        screen.getByRole("combobox", { name: "Einblicke sortieren" }),
      ).getByRole("option", { name: "Zuletzt gesehen: neueste zuerst" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Jederzeit gesehen" }),
    ).toBeInTheDocument();
    // The counts are drawn apart from the sentence: read it whole.
    expect(document.body.textContent).toContain("3 von 3 Einblicken");

    // Not one of the inbox's own words is left in English.
    for (const english of [
      "Needs Attention",
      "Fix Opened",
      "Detected",
      "Seen any time",
      "Last seen: newest first",
    ]) {
      expect(screen.queryByText(english)).not.toBeInTheDocument();
    }
  });

  test("in English, the same page reads as it was written", async () => {
    renderInbox();

    await screen.findByText("metric finding 1");

    expect(
      screen.getByText(
        TELEMETRY_AI_LANE_COPY[TelemetryAiLane.Metric].insightsIntro,
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Needs Attention").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Fix Opened").length).toBeGreaterThan(0);
    expect(document.body.textContent).toContain("Showing 3 of 3 insights");
  });
});

describe("a finding's page in German", () => {
  test("Fix with AI says the IDs come out of the names, and Details counts in German", async () => {
    await readIn("de");
    await renderFinding();

    const lead: HTMLElement = await screen.findByTestId(
      TELEMETRY_AI_FIX_TEST_IDS.lead,
    );

    expect(GERMAN[TELEMETRY_AI_FIX_LEAD_METRIC_NAMES]).toBe(
      "OneUptime AI öffnet einen Pull Request, der die IDs aus diesen Metriknamen entfernt, damit Sie ihn prüfen können.",
    );
    expect(lead).toHaveTextContent(GERMAN[TELEMETRY_AI_FIX_LEAD_METRIC_NAMES]!);
    expect(screen.getByText("Erkennungen")).toBeInTheDocument();
    expect(screen.getByText("5-mal")).toBeInTheDocument();
    expect(screen.queryByText("5 times")).not.toBeInTheDocument();
  });

  test("a finding seen once says so, in either language", async () => {
    item = namesFinding(1);
    await renderFinding();

    expect(await screen.findByText("Once")).toBeInTheDocument();

    cleanup();
    await readIn("de");
    await renderFinding();

    expect(await screen.findByText("Einmal")).toBeInTheDocument();
  });

  test("in English, Details says how many times", async () => {
    await renderFinding();

    expect(await screen.findByText("5 times")).toBeInTheDocument();
    expect(
      await screen.findByTestId(TELEMETRY_AI_FIX_TEST_IDS.lead),
    ).toHaveTextContent(TELEMETRY_AI_FIX_LEAD_METRIC_NAMES);
  });
});
