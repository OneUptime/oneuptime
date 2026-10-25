/** @timezone UTC */

import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../Types/JSON";
import {
  forgetRememberedDateTexts,
  getEnglishOf,
  setDateDisplayLanguage,
} from "../../../Types/DateLanguage";
import { CheckOn, FilterType } from "../../../Types/Monitor/CriteriaFilter";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import MonitorOverviewFamilyUtil, {
  MonitorOverviewFamily,
} from "../../../Utils/Monitor/MonitorOverviewFamily";
import MonitorOverviewPresentationUtil, {
  MonitorOverviewFact,
  MonitorOverviewPresentation,
  MonitorOverviewPresentationInput,
  MonitorOverviewStatusRef,
} from "../../../Utils/Monitor/MonitorOverviewPresentationUtil";
import { MonitorOverviewProbeSummary } from "../../../Utils/Monitor/MonitorOverviewProbeUtil";
import MonitorUptimeSummaryUtil, {
  UptimeWindowPresentation,
} from "../../../Utils/Monitor/MonitorUptimeSummaryUtil";
import {
  MonitorUptimeWindowKey,
  MonitorUptimeWindowTotal,
} from "../../../Types/Monitor/MonitorUptimeSummary";
import ObjectID from "../../../Types/ObjectID";
import { formatDurationCompactInLanguage } from "../../../Utils/Slo/SloDuration";

/*
 * The monitor overview's hero, pulse, facts, target and sections in the
 * reader's language, read from the Dashboard's real locale files.
 *
 * MonitorOverviewPresentationUtil writes every word of the overview, so the
 * page hands it the reader's Translator. A pseudo-locale (every en.json
 * value wrapped in ⟦ ⟧) shows that each text it writes is looked up, and
 * looked up by a key en.json has, so the extractor found it; the real
 * locales show the words are there in all sixteen languages, and a
 * sentence a language has not worded reads wholly in English, its interval
 * and its duration too. Without a translator it is English, word for word
 * (MonitorOverviewPresentationUtil.test.ts).
 */

const LOCALES_DIRECTORY: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

const localeCache: Map<string, Record<string, unknown>> = new Map<
  string,
  Record<string, unknown>
>();

const readLocale: (language: string) => Record<string, unknown> = (
  language: string,
): Record<string, unknown> => {
  if (!localeCache.has(language)) {
    localeCache.set(
      language,
      JSON.parse(
        fs.readFileSync(
          path.join(LOCALES_DIRECTORY, `${language}.json`),
          "utf8",
        ),
      ) as Record<string, unknown>,
    );
  }

  return localeCache.get(language)!;
};

// The reader's translator for a locale file, less any keys left out.
const translatorFor: (
  language: string,
  without?: Array<string>,
) => Translator = (language: string, without?: Array<string>): Translator => {
  const locale: Record<string, unknown> = readLocale(language);

  return createTranslator((text: string): string | undefined => {
    if (without && without.includes(text)) {
      return undefined;
    }

    const value: unknown = locale[text];

    return typeof value === "string" ? value : undefined;
  }, language);
};

const ENGLISH_LOCALE: Record<string, unknown> = readLocale("en");

// Every key a pseudo-locale run looked up.
const lookedUp: Set<string> = new Set<string>();

const PSEUDO: Translator = createTranslator(
  (text: string): string | undefined => {
    const value: unknown = ENGLISH_LOCALE[text];

    if (typeof value !== "string") {
      return undefined;
    }

    lookedUp.add(text);

    return `⟦${value}⟧`;
  },
  "de",
);

const NOW: Date = new Date("2026-09-21T12:00:00.000Z");
const STEP_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DEVICE_ID: string = "66666666-6666-4666-8666-666666666666";
const DAY: number = 86400;

const secondsAgo: (seconds: number) => Date = (seconds: number): Date => {
  return new Date(NOW.getTime() - seconds * 1000);
};

const OPERATIONAL: MonitorOverviewStatusRef = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Operational",
  color: "#10B981",
  isOperationalState: true,
  isOfflineState: false,
};

const OFFLINE: MonitorOverviewStatusRef = {
  id: "44444444-4444-4444-8444-444444444444",
  name: "Offline",
  color: "#EF4444",
  isOperationalState: false,
  isOfflineState: true,
};

// What the input names: the overview puts these in as they were written.
const NAMES_AS_WRITTEN: ReadonlySet<string> = new Set<string>([
  "Operational",
  "Offline",
  "London",
  "Tokyo",
  "London, Tokyo",
  "web-01.example.com",
  "GET https://api.example.com/health",
  "https://api.example.com/health",
  "Connection refused",
]);

const stepsOf: (...stepData: Array<JSONObject>) => MonitorSteps = (
  ...stepData: Array<JSONObject>
): MonitorSteps => {
  return {
    data: {
      monitorStepsInstanceArray: stepData.map((data: JSONObject) => {
        return { data: { id: STEP_ID, ...data } };
      }),
    },
  } as unknown as MonitorSteps;
};

const missingWindowSteps: (
  checkOn: CheckOn,
  minutes: number,
) => MonitorSteps = (checkOn: CheckOn, minutes: number): MonitorSteps => {
  return stepsOf({
    monitorCriteria: {
      data: {
        monitorCriteriaInstanceArray: [
          {
            data: {
              filters: [
                {
                  checkOn: checkOn,
                  filterType: FilterType.NotRecievedInMinutes,
                  value: minutes,
                },
              ],
            },
          },
        ],
      },
    },
  });
};

const probes: (
  overrides?: Partial<MonitorOverviewProbeSummary>,
) => MonitorOverviewProbeSummary = (
  overrides?: Partial<MonitorOverviewProbeSummary>,
): MonitorOverviewProbeSummary => {
  return {
    rows: [],
    attachedCount: 2,
    enabledCount: 2,
    reportingCount: 2,
    disabledCount: 0,
    disconnectedCount: 0,
    lastResultAt: secondsAgo(60),
    nextCheckAt: secondsAgo(-240),
    latestResult: {
      probeId: "11111111-1111-4111-8111-111111111111",
      probeName: "London",
      monitoredAt: secondsAgo(60),
      isOnline: true,
      responseTimeInMs: 120,
      responseCode: 200,
    },
    responseTime: {
      medianMs: 120,
      minMs: 100,
      maxMs: 140,
      respondedCount: 2,
      totalCount: 2,
    },
    ...overrides,
  };
};

const NO_RESULTS: Partial<MonitorOverviewProbeSummary> = {
  reportingCount: 0,
  lastResultAt: undefined,
  latestResult: undefined,
  responseTime: null,
};

const running: (
  monitorType: MonitorType,
  overrides?: Partial<MonitorOverviewPresentationInput>,
) => MonitorOverviewPresentationInput = (
  monitorType: MonitorType,
  overrides?: Partial<MonitorOverviewPresentationInput>,
): MonitorOverviewPresentationInput => {
  const family: MonitorOverviewFamily =
    MonitorOverviewFamilyUtil.getFamily(monitorType);

  return {
    now: NOW,
    monitorType: monitorType,
    monitorSteps: stepsOf({
      monitorDestination: "https://api.example.com/health",
      requestType: "GET",
      networkDeviceMonitor: { networkDeviceId: DEVICE_ID },
    }),
    monitoringInterval: "*/5 * * * *",
    createdAt: secondsAgo(30 * DAY),
    currentStatus: OPERATIONAL,
    statusSince: secondsAgo(3 * DAY + 4 * 3600),
    pause: {
      isDisabled: false,
      byManualIncident: false,
      byScheduledMaintenance: false,
    },
    probeFlags: { isNoProbeEnabled: false, isAllProbesDisconnected: false },
    probes: family === MonitorOverviewFamily.ProbeCheck ? probes() : null,
    heartbeat: {
      lastReceivedAt: secondsAgo(120),
      lastCheckedAt: secondsAgo(30),
      requestMethod: "POST",
    },
    email: { lastReceivedAt: secondsAgo(300), lastCheckedAt: secondsAgo(40) },
    agent: {
      lastReportAt: secondsAgo(45),
      hostname: "web-01.example.com",
      cpuPercent: 42.4,
      memoryPercent: 63.6,
    },
    telemetry: {
      lastScheduledAt: secondsAgo(30),
      nextEvaluationAt: secondsAgo(-270),
    },
    latestEvaluationAt: secondsAgo(90),
    evaluationStatus: "loaded",
    ...overrides,
  };
};

const watching: (
  overrides?: Partial<MonitorOverviewPresentationInput>,
) => MonitorOverviewPresentationInput = (
  overrides?: Partial<MonitorOverviewPresentationInput>,
): MonitorOverviewPresentationInput => {
  return running(MonitorType.ProbeStatus, {
    monitorSteps: stepsOf({
      probeStatusMonitor: {
        probeIds: [
          "11111111-1111-4111-8111-111111111111",
          "55555555-5555-4555-8555-555555555555",
        ],
      },
    }),
    monitoringInterval: undefined,
    ...overrides,
  });
};

interface Scenario {
  name: string;
  input: MonitorOverviewPresentationInput;
}

/*
 * One monitor per state the hero words differently, across the families:
 * every sentence, label and value the overview writes comes up in one.
 */
const SCENARIOS: Array<Scenario> = [
  { name: "manual", input: running(MonitorType.Manual) },
  {
    name: "archived",
    input: running(MonitorType.API, {
      pause: {
        isArchived: true,
        isDisabled: true,
        byManualIncident: false,
        byScheduledMaintenance: false,
      },
    }),
  },
  {
    name: "disabled",
    input: running(MonitorType.API, {
      pause: {
        isDisabled: true,
        byManualIncident: false,
        byScheduledMaintenance: false,
      },
    }),
  },
  {
    name: "paused by an incident",
    input: running(MonitorType.Logs, {
      currentStatus: OFFLINE,
      pause: {
        isDisabled: false,
        byManualIncident: true,
        byScheduledMaintenance: false,
      },
    }),
  },
  {
    name: "paused for maintenance",
    input: running(MonitorType.IncomingRequest, {
      pause: {
        isDisabled: false,
        byManualIncident: false,
        byScheduledMaintenance: true,
      },
    }),
  },
  {
    name: "every probe switched off",
    input: running(MonitorType.API, {
      probeFlags: { isNoProbeEnabled: true, isAllProbesDisconnected: false },
      probes: probes({
        ...NO_RESULTS,
        attachedCount: 2,
        enabledCount: 0,
        disabledCount: 2,
      }),
    }),
  },
  {
    name: "no probe attached",
    input: running(MonitorType.API, {
      probeFlags: { isNoProbeEnabled: true, isAllProbesDisconnected: false },
      probes: probes({
        ...NO_RESULTS,
        attachedCount: 0,
        enabledCount: 0,
      }),
    }),
  },
  {
    name: "probes unknown and none enabled",
    input: running(MonitorType.API, {
      probeFlags: { isNoProbeEnabled: true, isAllProbesDisconnected: false },
      probes: null,
    }),
  },
  {
    name: "every probe disconnected",
    input: running(MonitorType.Website, {
      probeFlags: { isNoProbeEnabled: false, isAllProbesDisconnected: true },
      probes: probes({ disconnectedCount: 2 }),
    }),
  },
  {
    name: "no criteria",
    input: running(MonitorType.DNS, { monitorSteps: stepsOf() }),
  },
  {
    name: "network device with no device",
    input: running(MonitorType.NetworkDevice, {
      monitorSteps: stepsOf({ networkDeviceMonitor: {} }),
    }),
  },
  {
    name: "new API monitor",
    input: running(MonitorType.API, {
      createdAt: secondsAgo(120),
      statusSince: undefined,
      probes: probes(NO_RESULTS),
    }),
  },
  {
    name: "new API monitor with one probe",
    input: running(MonitorType.API, {
      createdAt: secondsAgo(120),
      statusSince: undefined,
      probes: probes({ ...NO_RESULTS, attachedCount: 1, enabledCount: 1 }),
    }),
  },
  {
    name: "heartbeat that never received a request",
    input: running(MonitorType.IncomingRequest, { heartbeat: {} }),
  },
  {
    name: "heartbeat never received, judged offline",
    input: running(MonitorType.IncomingRequest, {
      currentStatus: OFFLINE,
      heartbeat: {},
    }),
  },
  {
    name: "inbound email that never received one",
    input: running(MonitorType.IncomingEmail, { email: {} }),
  },
  {
    name: "inbound email never received, judged offline",
    input: running(MonitorType.IncomingEmail, {
      currentStatus: OFFLINE,
      email: {},
    }),
  },
  {
    name: "server whose agent never reported",
    input: running(MonitorType.Server, { agent: {} }),
  },
  {
    name: "server never reported, judged offline",
    input: running(MonitorType.Server, { currentStatus: OFFLINE, agent: {} }),
  },
  {
    name: "kubernetes never evaluated",
    input: running(MonitorType.Kubernetes, {
      createdAt: secondsAgo(120),
      telemetry: {},
      latestEvaluationAt: undefined,
    }),
  },
  {
    name: "new network device",
    input: running(MonitorType.NetworkDevice, {
      createdAt: secondsAgo(3600),
      latestEvaluationAt: undefined,
    }),
  },
  {
    name: "API with a stale result",
    input: running(MonitorType.API, {
      probes: probes({ lastResultAt: secondsAgo(2 * 3600 + 300) }),
    }),
  },
  {
    name: "API that never reported, two days old",
    input: running(MonitorType.API, {
      createdAt: secondsAgo(2 * DAY),
      statusSince: undefined,
      probes: probes({ ...NO_RESULTS, nextCheckAt: undefined }),
    }),
  },
  {
    name: "metrics monitor with a stale evaluation",
    input: running(MonitorType.Metrics, {
      monitoringInterval: "* * * * *",
      telemetry: {
        lastScheduledAt: secondsAgo(10),
        nextEvaluationAt: secondsAgo(-50),
      },
      latestEvaluationAt: secondsAgo(3600 + 600),
    }),
  },
  {
    name: "kubernetes never evaluated, two days old",
    input: running(MonitorType.Kubernetes, {
      createdAt: secondsAgo(2 * DAY),
      telemetry: {
        lastScheduledAt: secondsAgo(10),
        nextEvaluationAt: secondsAgo(-50),
      },
      latestEvaluationAt: undefined,
    }),
  },
  {
    name: "logs monitor with nothing in the log's last day",
    input: running(MonitorType.Logs, {
      createdAt: secondsAgo(10 * DAY),
      latestEvaluationAt: undefined,
    }),
  },
  {
    name: "running API",
    input: running(MonitorType.API),
  },
  {
    name: "API whose probes disagree",
    input: running(MonitorType.API, {
      probes: probes({ upCount: 1, downCount: 1 }),
    }),
  },
  {
    name: "synthetic monitor whose probes disagree",
    input: running(MonitorType.SyntheticMonitor, {
      probes: probes({ upCount: 1, downCount: 1 }),
    }),
  },
  {
    name: "website that is down, with a cause",
    input: running(MonitorType.Website, {
      currentStatus: OFFLINE,
      probes: probes({
        downCount: 2,
        reportingCount: 2,
        disabledCount: 1,
        disconnectedCount: 1,
        latestResult: {
          probeId: "11111111-1111-4111-8111-111111111111",
          probeName: "London",
          monitoredAt: secondsAgo(60),
          isOnline: false,
          failureCause: "Connection refused",
        },
      }),
    }),
  },
  {
    name: "custom code that failed",
    input: running(MonitorType.CustomJavaScriptCode, {
      probes: probes({
        downCount: 1,
        latestResult: {
          probeId: "11111111-1111-4111-8111-111111111111",
          probeName: "London",
          monitoredAt: secondsAgo(60),
          isOnline: false,
        },
      }),
    }),
  },
  {
    name: "a reported result with no verdict",
    input: running(MonitorType.Ping, {
      probes: probes({
        latestResult: {
          probeId: "11111111-1111-4111-8111-111111111111",
          probeName: "London",
          monitoredAt: secondsAgo(60),
        },
      }),
    }),
  },
  {
    name: "probes unreadable",
    input: running(MonitorType.API, { probes: null }),
  },
  {
    name: "paused API, with probes off and disconnected",
    input: running(MonitorType.API, {
      pause: {
        isDisabled: true,
        byManualIncident: false,
        byScheduledMaintenance: false,
      },
      probes: probes({ disabledCount: 1, disconnectedCount: 1 }),
    }),
  },
  {
    name: "certificate valid for a month",
    input: running(MonitorType.SSLCertificate, {
      probes: probes({
        latestResult: {
          probeId: "11111111-1111-4111-8111-111111111111",
          probeName: "London",
          monitoredAt: secondsAgo(60),
          isOnline: true,
          isValidCertificate: true,
          sslExpiresAt: secondsAgo(-30 * DAY),
        },
      }),
    }),
  },
  {
    name: "certificate expiring in three hours",
    input: running(MonitorType.SSLCertificate, {
      probes: probes({
        latestResult: {
          probeId: "11111111-1111-4111-8111-111111111111",
          probeName: "London",
          monitoredAt: secondsAgo(60),
          isOnline: true,
          isValidCertificate: true,
          sslExpiresAt: secondsAgo(-3 * 3600),
        },
      }),
    }),
  },
  {
    name: "certificate that is not valid",
    input: running(MonitorType.SSLCertificate, {
      probes: probes({
        latestResult: {
          probeId: "11111111-1111-4111-8111-111111111111",
          probeName: "London",
          monitoredAt: secondsAgo(60),
          isOnline: false,
          isValidCertificate: false,
          sslExpiresAt: secondsAgo(-30 * DAY),
        },
      }),
    }),
  },
  {
    name: "certificate unreadable",
    input: running(MonitorType.SSLCertificate, { probes: null }),
  },
  {
    name: "domain that expired two days ago",
    input: running(MonitorType.Domain, {
      probes: probes({
        latestResult: {
          probeId: "11111111-1111-4111-8111-111111111111",
          probeName: "London",
          monitoredAt: secondsAgo(60),
          isOnline: false,
          domainExpiresAt: secondsAgo(2 * DAY + 3600),
        },
      }),
    }),
  },
  {
    name: "domain that expired twenty minutes ago",
    input: running(MonitorType.Domain, {
      probes: probes({
        latestResult: {
          probeId: "11111111-1111-4111-8111-111111111111",
          probeName: "London",
          monitoredAt: secondsAgo(60),
          isOnline: false,
          domainExpiresAt: secondsAgo(20 * 60),
        },
      }),
    }),
  },
  {
    name: "domain expiring in forty minutes",
    input: running(MonitorType.Domain, {
      probes: probes({
        latestResult: {
          probeId: "11111111-1111-4111-8111-111111111111",
          probeName: "London",
          monitoredAt: secondsAgo(60),
          isOnline: true,
          domainExpiresAt: secondsAgo(-40 * 60),
        },
      }),
    }),
  },
  {
    name: "domain unreadable",
    input: running(MonitorType.Domain, { probes: null }),
  },
  {
    name: "running heartbeat with a missing-request window",
    input: running(MonitorType.IncomingRequest, {
      monitorSteps: missingWindowSteps(CheckOn.IncomingRequest, 10),
    }),
  },
  {
    name: "running inbound email with a one-minute window, never checked",
    input: running(MonitorType.IncomingEmail, {
      monitorSteps: missingWindowSteps(CheckOn.EmailReceivedAt, 1),
      email: { lastReceivedAt: secondsAgo(300) },
    }),
  },
  {
    name: "running server",
    input: running(MonitorType.Server),
  },
  {
    name: "running server with nothing reported",
    input: running(MonitorType.Server, {
      agent: { lastReportAt: secondsAgo(45) },
    }),
  },
  {
    name: "running logs monitor",
    input: running(MonitorType.Logs),
  },
  {
    name: "weekly logs monitor",
    input: running(MonitorType.Logs, { monitoringInterval: "0 12 * * 5" }),
  },
  {
    name: "hourly metrics monitor",
    input: running(MonitorType.Metrics, { monitoringInterval: "0 * * * *" }),
  },
  {
    name: "running network device",
    input: running(MonitorType.NetworkDevice),
  },
  {
    name: "network device loading",
    input: running(MonitorType.NetworkDevice, {
      evaluationStatus: "loading",
      latestEvaluationAt: undefined,
    }),
  },
  {
    name: "network device with nothing in the log's last day",
    input: running(MonitorType.NetworkDevice, {
      currentStatus: OFFLINE,
      latestEvaluationAt: undefined,
    }),
  },
  {
    name: "probe status, all connected",
    input: watching({
      probeStatus: {
        probes: [
          {
            probeId: "11111111-1111-4111-8111-111111111111",
            probeName: "London",
            isGlobalProbe: false,
            isConnected: true,
          },
          {
            probeId: "55555555-5555-4555-8555-555555555555",
            probeName: "Tokyo",
            isGlobalProbe: false,
            isConnected: true,
          },
        ],
        connectedProbeCount: 2,
        disconnectedProbeCount: 0,
      },
    }),
  },
  {
    name: "probe status, both disconnected",
    input: watching({
      currentStatus: OFFLINE,
      probeStatus: {
        probes: [
          {
            probeId: "11111111-1111-4111-8111-111111111111",
            probeName: "London",
            isGlobalProbe: false,
            isConnected: false,
          },
          {
            probeId: "55555555-5555-4555-8555-555555555555",
            probeName: "Tokyo",
            isGlobalProbe: false,
            isConnected: false,
          },
        ],
        connectedProbeCount: 0,
        disconnectedProbeCount: 2,
      },
    }),
  },
  {
    name: "probe status watching one connected probe",
    input: watching({
      probeStatus: {
        probes: [
          {
            probeId: "11111111-1111-4111-8111-111111111111",
            probeName: "London",
            isGlobalProbe: false,
            isConnected: true,
          },
        ],
        connectedProbeCount: 1,
        disconnectedProbeCount: 0,
      },
    }),
  },
  {
    name: "probe status watching one disconnected probe",
    input: watching({
      currentStatus: OFFLINE,
      probeStatus: {
        probes: [
          {
            probeId: "11111111-1111-4111-8111-111111111111",
            probeName: "London",
            isGlobalProbe: false,
            isConnected: false,
          },
        ],
        connectedProbeCount: 0,
        disconnectedProbeCount: 1,
      },
    }),
  },
  {
    name: "probe status whose probes were all deleted",
    input: watching({
      probeStatus: {
        probes: [],
        connectedProbeCount: 0,
        disconnectedProbeCount: 0,
      },
    }),
  },
  {
    name: "probe status with no result",
    input: watching({}),
  },
  {
    name: "probe status loading",
    input: watching({ evaluationStatus: "loading" }),
  },
  {
    name: "probe status unreadable",
    input: watching({ evaluationStatus: "error" }),
  },
  {
    name: "probe status with nothing in the log's last day",
    input: watching({ currentStatus: OFFLINE, latestEvaluationAt: undefined }),
  },
  {
    name: "probe status watching no probes",
    input: running(MonitorType.ProbeStatus, {
      monitorSteps: stepsOf({ probeStatusMonitor: { probeIds: [] } }),
      monitoringInterval: undefined,
    }),
  },
  {
    name: "new probe status monitor",
    input: watching({
      createdAt: secondsAgo(30),
      latestEvaluationAt: undefined,
    }),
  },
];

interface WrittenText {
  where: string;
  text: string;
}

// Every text the presentation hands the page to show.
const textsOf: (
  presentation: MonitorOverviewPresentation,
) => Array<WrittenText> = (
  presentation: MonitorOverviewPresentation,
): Array<WrittenText> => {
  const texts: Array<WrittenText> = [];

  const add: (where: string, text: string | null | undefined) => void = (
    where: string,
    text: string | null | undefined,
  ): void => {
    if (text) {
      texts.push({ where: where, text: text });
    }
  };

  add("badge", presentation.badge.text);

  for (const badge of presentation.secondaryBadges) {
    add("secondary badge", badge.text);
  }

  add("headline", presentation.headline.text);
  add("explanation", presentation.explanation);
  add("last known status", presentation.lastKnownStatus);
  add("call to action", presentation.callToAction?.text);
  add("pulse label", presentation.pulse.label);
  add("pulse empty text", presentation.pulse.emptyText);
  add("pulse cadence", presentation.pulse.cadenceText);

  for (const fact of presentation.facts) {
    add(`${fact.key} label`, fact.label);
    add(`${fact.key} value`, fact.value);
    add(`${fact.key} secondary`, fact.secondary);
  }

  if (presentation.target && !presentation.target.isMono) {
    add("target", presentation.target.value);
  }

  add("summary description", presentation.sections.summary.description);

  return texts;
};

const LETTER: RegExp = /\p{L}/u;

const build: (
  input: MonitorOverviewPresentationInput,
  translator?: Translator,
) => MonitorOverviewPresentation = (
  input: MonitorOverviewPresentationInput,
  translator?: Translator,
): MonitorOverviewPresentation => {
  return MonitorOverviewPresentationUtil.build({
    ...input,
    translator: translator,
  });
};

const factOf: (
  presentation: MonitorOverviewPresentation,
  key: string,
) => MonitorOverviewFact = (
  presentation: MonitorOverviewPresentation,
  key: string,
): MonitorOverviewFact => {
  const fact: MonitorOverviewFact | undefined = presentation.facts.find(
    (item: MonitorOverviewFact) => {
      return item.key === key;
    },
  );

  if (!fact) {
    throw new Error(`no ${key} fact`);
  }

  return fact;
};

/*
 * Words a language writes as English does, by key: the Dashboard's
 * locales keep them on purpose ("CPU", German "Host", French
 * "Exceptions").
 */
const SAME_AS_ENGLISH: Record<string, ReadonlyArray<string>> = {
  CPU: LANGUAGES,
  Criteria: ["nl"],
  Disk: ["da", "no", "sv"],
  Down: ["nl"],
  Exceptions: ["fr"],
  Host: ["de", "es", "it", "pt", "nl"],
  Interfaces: ["fr", "es", "pt", "nl"],
  Manual: ["es", "pt"],
  // OneUptime's own status name, which these languages write as English does.
  Offline: ["de", "it", "pt", "nl", "da", "sv"],
  Spans: ["de", "fr", "es", "pt", "nl", "da", "no", "sv"],
  Up: ["nl"],
  "{{count}} down": ["nl"],
  "{{count}} down_one": ["nl"],
  "{{count}} incidents": ["fr"],
  "{{count}} incidents_one": ["fr", "nl", "sv"],
  "{{count}} minutes": ["fr"],
  "{{count}} minutes_one": ["fr"],
};

/*
 * Labels the translated docs quote as each language's Dashboard draws them
 * (Tests/FeatureSet/Docs/*DocsTranslations): "Up" and "Down" name an
 * interface's state on the network pages too, "Manual" the monitor type.
 * Where a language still draws one in English, its docs pages quote the
 * English, so the label is translated together with those pages, not here.
 */
const QUOTED_BY_THE_DOCS: Record<string, ReadonlyArray<string>> = {
  Down: [
    "it",
    "pt",
    "da",
    "no",
    "sv",
    "ru",
    "ko",
    "zh-CN",
    "zh-TW",
    "hi",
    "fa",
  ],
  Manual: [
    "it",
    "nl",
    "da",
    "no",
    "sv",
    "ru",
    "ko",
    "zh-CN",
    "zh-TW",
    "hi",
    "fa",
  ],
  "Not evaluated yet": [
    "it",
    "pt",
    "nl",
    "da",
    "no",
    "sv",
    "ru",
    "ko",
    "zh-CN",
    "zh-TW",
    "hi",
    "fa",
  ],
  Up: [
    "de",
    "fr",
    "it",
    "pt",
    "da",
    "no",
    "sv",
    "ru",
    "ko",
    "zh-CN",
    "zh-TW",
    "hi",
    "fa",
  ],
};

const isLeftInEnglish: (key: string, language: string) => boolean = (
  key: string,
  language: string,
): boolean => {
  return (
    (SAME_AS_ENGLISH[key] || []).includes(language) ||
    (QUOTED_BY_THE_DOCS[key] || []).includes(language)
  );
};

beforeEach(() => {
  forgetRememberedDateTexts();
});

afterEach(() => {
  setDateDisplayLanguage("en");
  forgetRememberedDateTexts();
});

describe("every text the monitor overview writes is looked up", () => {
  test.each(SCENARIOS)(
    "$name: each text comes from en.json, is a date in the reader's language, or is a name the monitor's owner wrote",
    (scenario: Scenario) => {
      const unlooked: Array<WrittenText> = textsOf(
        build(scenario.input, PSEUDO),
      ).filter((written: WrittenText): boolean => {
        return (
          !written.text.includes("⟦") &&
          LETTER.test(written.text) &&
          !NAMES_AS_WRITTEN.has(written.text) &&
          // A date written in the translator's language (German here).
          getEnglishOf(written.text) === undefined
        );
      });

      expect(unlooked).toEqual([]);
    },
  );

  test("the scenarios reach every sentence the overview writes", () => {
    for (const scenario of SCENARIOS) {
      build(scenario.input, PSEUDO);
    }

    /*
     * A sample from each part of the overview, so a scenario list that
     * stops reaching one is noticed.
     */
    for (const key of [
      "Manual monitor: OneUptime runs no checks. The status changes when someone sets it, or when an incident or scheduled maintenance event changes it.",
      "Monitoring is off because it is archived",
      "No result for {{duration}}, but this monitor checks {{interval}}. A probe may be overloaded or offline.",
      "{{count}} probes check this {{interval}}. The first result usually arrives within a few minutes.",
      "Every {{count}} minutes",
      "Every week on {{days}} at {{time}} (UTC)",
      "Expired {{count}} days ago",
      "Expires in {{count}} hours",
      "Mixed · {{up}} passed, {{down}} failed",
      "{{reporting}} of {{enabled}} reporting",
      "{{disconnected}} of {{total}} disconnected",
      "Browser script",
      "What each probe saw on its most recent check.",
      "Missing-email window",
      "Last missing-request check",
    ]) {
      expect(lookedUp.has(key)).toBe(true);
    }
  });
});

describe("the monitor overview in every locale", () => {
  test("every key the overview looks up is worded in each of the sixteen languages", () => {
    for (const scenario of SCENARIOS) {
      build(scenario.input, PSEUDO);
    }

    const untranslated: Array<string> = [];

    for (const key of [...lookedUp].sort()) {
      for (const language of LANGUAGES) {
        const value: unknown = readLocale(language)[key];

        if (value === ENGLISH_LOCALE[key] && !isLeftInEnglish(key, language)) {
          untranslated.push(`${language}: ${key}`);
        }
      }
    }

    expect(untranslated).toEqual([]);
  });

  test.each(LANGUAGES)(
    "%s: a running API monitor's hero, pulse and facts are in the language",
    (language: string) => {
      const english: MonitorOverviewPresentation = build(
        running(MonitorType.API),
      );
      const translated: MonitorOverviewPresentation = build(
        running(MonitorType.API),
        translatorFor(language),
      );

      expect(translated.pulse.label).not.toBe(english.pulse.label);
      expect(translated.pulse.cadenceText).not.toBe(english.pulse.cadenceText);
      expect(factOf(translated, "latest-result").label).not.toBe(
        factOf(english, "latest-result").label,
      );
      expect(factOf(translated, "probes").value).not.toBe(
        factOf(english, "probes").value,
      );
      expect(translated.sections.summary.description).not.toBe(
        english.sections.summary.description,
      );
      // What the monitor's owner named stays as written.
      expect(translated.badge.text).toBe("Operational");
      expect(factOf(translated, "latest-result").value).toContain(
        "120 ms · HTTP 200",
      );
    },
  );
});

describe("the monitor overview in German", () => {
  const GERMAN: Translator = translatorFor("de");

  beforeEach(() => {
    setDateDisplayLanguage("de");
  });

  test("a running API monitor", () => {
    const presentation: MonitorOverviewPresentation = build(
      running(MonitorType.API),
      GERMAN,
    );

    expect(presentation.pulse.label).toBe("Zuletzt geprüft");
    expect(presentation.pulse.cadenceText).toBe("Alle 5 Minuten");
    expect(factOf(presentation, "latest-result")).toMatchObject({
      label: "Letztes Ergebnis",
      // "Up" is drawn as the German network pages and docs draw it.
      value: "Up · 120 ms · HTTP 200",
      secondary: "von London",
    });
    expect(factOf(presentation, "probes")).toMatchObject({
      label: "Sonden",
      value: "2 von 2 melden",
    });
    expect(factOf(presentation, "owners").label).toBe("Eigentümer");
    expect(presentation.sections.summary.description).toBe(
      "Was jede Sonde bei ihrer letzten Prüfung gesehen hat.",
    );
  });

  test("an overdue check: the duration and the interval are German inside the German sentence", () => {
    const presentation: MonitorOverviewPresentation = build(
      running(MonitorType.API, {
        probes: probes({ lastResultAt: secondsAgo(2 * 3600 + 300) }),
      }),
      GERMAN,
    );
    const duration: string = formatDurationCompactInLanguage(
      2 * 3600 + 300,
      "de",
    );

    expect(duration).not.toBe("2h 5m");
    expect(duration).toContain("Min.");
    expect(presentation.explanation).toBe(
      `Seit ${duration} kein Ergebnis, obwohl dieser Monitor alle 5 Minuten prüft. Eine Sonde ist möglicherweise überlastet oder offline.`,
    );
    expect(presentation.secondaryBadges[0]?.text).toBe("Prüfungen überfällig");
  });

  test("a new monitor's probes and interval", () => {
    const presentation: MonitorOverviewPresentation = build(
      running(MonitorType.API, {
        createdAt: secondsAgo(120),
        statusSince: undefined,
        probes: probes({ ...NO_RESULTS, attachedCount: 1, enabledCount: 1 }),
      }),
      GERMAN,
    );

    expect(presentation.headline.text).toBe("Warten auf die erste Prüfung");
    expect(presentation.explanation).toBe(
      "1 Sonde prüft dies alle 5 Minuten. Das erste Ergebnis kommt meist innerhalb weniger Minuten.",
    );
  });

  test("a weekly interval names its weekday in German", () => {
    const presentation: MonitorOverviewPresentation = build(
      running(MonitorType.Logs, { monitoringInterval: "0 12 * * 5" }),
      GERMAN,
    );

    expect(presentation.pulse.cadenceText).toBe(
      "Jede Woche am Freitag um 12:00 (UTC)",
    );
    expect(factOf(presentation, "evaluates")).toMatchObject({
      label: "Wertet aus",
      value: "Jede Woche am Freitag um 12:00 (UTC)",
    });
  });

  test("certificate and domain expiry", () => {
    expect(
      factOf(
        build(
          running(MonitorType.SSLCertificate, {
            probes: probes({
              latestResult: {
                probeId: "11111111-1111-4111-8111-111111111111",
                probeName: "London",
                monitoredAt: secondsAgo(60),
                isOnline: true,
                isValidCertificate: true,
                sslExpiresAt: secondsAgo(-3 * 3600),
              },
            }),
          }),
          GERMAN,
        ),
        "certificate-expiry",
      ),
    ).toMatchObject({
      label: "Zertifikat läuft ab",
      value: "Läuft in 3 Stunden ab",
    });

    expect(
      factOf(
        build(
          running(MonitorType.Domain, {
            probes: probes({
              latestResult: {
                probeId: "11111111-1111-4111-8111-111111111111",
                probeName: "London",
                monitoredAt: secondsAgo(60),
                isOnline: false,
                domainExpiresAt: secondsAgo(2 * DAY + 3600),
              },
            }),
          }),
          GERMAN,
        ),
        "domain-expiry",
      ),
    ).toMatchObject({
      label: "Domain läuft ab",
      value: "Vor 2 Tagen abgelaufen",
    });
  });

  test("a Probe Status monitor names its disconnected probes as written", () => {
    const presentation: MonitorOverviewPresentation = build(
      watching({
        currentStatus: OFFLINE,
        probeStatus: {
          probes: [
            {
              probeId: "11111111-1111-4111-8111-111111111111",
              probeName: "London",
              isGlobalProbe: false,
              isConnected: false,
            },
            {
              probeId: "55555555-5555-4555-8555-555555555555",
              probeName: "Tokyo",
              isGlobalProbe: false,
              isConnected: false,
            },
          ],
          connectedProbeCount: 0,
          disconnectedProbeCount: 2,
        },
      }),
      GERMAN,
    );

    expect(factOf(presentation, "latest-result")).toMatchObject({
      label: "Letztes Ergebnis",
      value: "2 von 2 getrennt",
      secondary: "London, Tokyo",
    });
    expect(factOf(presentation, "probes")).toMatchObject({
      label: "Beobachtet",
      value: "2 Sonden",
    });
    expect(presentation.pulse.cadenceText).toBe("Jede Minute");
  });

  /*
   * A status's name reads as the hero's badge (StatusBadge) reads it: one
   * of OneUptime's own in the reader's words, a name the project gave a
   * status as written.
   */
  test("the last recorded status names OneUptime's own status in German, and the project's own as written", () => {
    const disabled: Partial<MonitorOverviewPresentationInput> = {
      pause: {
        isDisabled: true,
        byManualIncident: false,
        byScheduledMaintenance: false,
      },
    };

    expect(
      build(running(MonitorType.API, disabled), GERMAN).lastKnownStatus,
    ).toBe("Zuletzt erfasster Status: Betriebsbereit");
    expect(
      build(
        running(MonitorType.API, {
          ...disabled,
          currentStatus: {
            ...OPERATIONAL,
            name: "Checkout healthy (EU)",
          },
        }),
        GERMAN,
      ).lastKnownStatus,
    ).toBe("Zuletzt erfasster Status: Checkout healthy (EU)");
    // English names it as it is named.
    expect(build(running(MonitorType.API, disabled)).lastKnownStatus).toBe(
      "Last recorded status: Operational",
    );
  });

  test("a synthetic monitor's target is a German word", () => {
    expect(
      build(running(MonitorType.SyntheticMonitor), GERMAN).target?.value,
    ).toBe("Browser-Skript");
    expect(
      build(running(MonitorType.CustomJavaScriptCode), GERMAN).target?.value,
    ).toBe("Eigenes Skript");
  });
});

describe("a sentence the reader's language has not worded reads wholly in English", () => {
  const SENTENCE: string =
    "No result for {{duration}}, but this monitor checks {{interval}}. A probe may be overloaded or offline.";

  beforeEach(() => {
    setDateDisplayLanguage("de");
  });

  test("its interval and its duration go in in English, never German inside English", () => {
    const presentation: MonitorOverviewPresentation = build(
      running(MonitorType.API, {
        probes: probes({ lastResultAt: secondsAgo(2 * 3600 + 300) }),
      }),
      translatorFor("de", [SENTENCE]),
    );

    expect(presentation.explanation).toBe(
      "No result for 2h 5m, but this monitor checks every 5 minutes. A probe may be overloaded or offline.",
    );
    // The rest of the hero is still German.
    expect(presentation.secondaryBadges[0]?.text).toBe("Prüfungen überfällig");
  });

  test("a weekday inside an English sentence is English, and German inside a German one", () => {
    const waiting: MonitorOverviewPresentationInput = running(
      MonitorType.Kubernetes,
      {
        monitoringInterval: "0 12 * * 5",
        createdAt: secondsAgo(120),
        telemetry: {},
        latestEvaluationAt: undefined,
      },
    );

    expect(
      build(
        waiting,
        translatorFor("de", [
          "This monitor is evaluated {{interval}} once saved.",
        ]),
      ).explanation,
    ).toBe(
      "This monitor is evaluated every week on Friday at 12:00 (UTC) once saved.",
    );
    expect(build(waiting, translatorFor("de")).explanation).toBe(
      "Dieser Monitor wird nach dem Speichern jede Woche am Freitag um 12:00 (UTC) ausgewertet.",
    );
  });
});

describe("without a translator the overview is English", () => {
  test.each(SCENARIOS)("$name", (scenario: Scenario) => {
    setDateDisplayLanguage("de");

    const withoutTranslator: Array<WrittenText> = textsOf(
      MonitorOverviewPresentationUtil.build(scenario.input),
    );

    setDateDisplayLanguage("en");

    const english: Array<WrittenText> = textsOf(
      build(scenario.input, createTranslator(undefined, "en")),
    );

    expect(withoutTranslator).toEqual(english);
  });
});

describe("the uptime windows in the reader's language", () => {
  const DOWN_STATUS: string = "44444444-4444-4444-8444-444444444444";

  const windowOf: (data: {
    windowSeconds: number;
    coveredSeconds: number;
    downSeconds: number;
  }) => MonitorUptimeWindowTotal = (data: {
    windowSeconds: number;
    coveredSeconds: number;
    downSeconds: number;
  }): MonitorUptimeWindowTotal => {
    return {
      key: MonitorUptimeWindowKey.Last7Days,
      startDate: secondsAgo(data.windowSeconds),
      endDate: NOW,
      windowSeconds: data.windowSeconds,
      coveredSeconds: data.coveredSeconds,
      statusDurations: [
        {
          monitorStatusId: new ObjectID(DOWN_STATUS),
          seconds: data.downSeconds,
        },
      ],
    };
  };

  const describeWindow: (
    data: {
      windowSeconds: number;
      coveredSeconds: number;
      downSeconds: number;
    },
    translator?: Translator,
    caveat?: "paused" | "not-checking" | "no-results",
  ) => UptimeWindowPresentation = (
    data: {
      windowSeconds: number;
      coveredSeconds: number;
      downSeconds: number;
    },
    translator?: Translator,
    caveat?: "paused" | "not-checking" | "no-results",
  ): UptimeWindowPresentation => {
    return MonitorUptimeSummaryUtil.getWindowPresentation({
      window: windowOf(data),
      downtimeStatusIds: new Set<string>([DOWN_STATUS]),
      caveat: caveat ?? null,
      translator: translator,
    })!;
  };

  test("English, as it always read", () => {
    expect(
      describeWindow(
        { windowSeconds: 7 * DAY, coveredSeconds: 3 * DAY, downSeconds: 3900 },
        undefined,
        "paused",
      ).description,
    ).toBe("Down 1h 5m · measured over 3d · includes paused time");
    expect(
      describeWindow({
        windowSeconds: 7 * DAY,
        coveredSeconds: 7 * DAY,
        downSeconds: 0,
      }).description,
    ).toBe("No downtime");
    expect(
      describeWindow({
        windowSeconds: 7 * DAY,
        coveredSeconds: 0,
        downSeconds: 0,
      }),
    ).toMatchObject({
      valueText: "No data",
      description: "Nothing recorded in this window",
    });
  });

  test("German: each phrase in German, its durations too", () => {
    setDateDisplayLanguage("de");

    const german: Translator = translatorFor("de");

    expect(
      describeWindow(
        { windowSeconds: 7 * DAY, coveredSeconds: 3 * DAY, downSeconds: 3900 },
        german,
        "not-checking",
      ).description,
    ).toBe(
      `${formatDurationCompactInLanguage(3900, "de")} ausgefallen · gemessen über ${formatDurationCompactInLanguage(3 * DAY, "de")} · enthält Zeit ohne laufende Prüfungen`,
    );
    expect(
      describeWindow(
        { windowSeconds: 7 * DAY, coveredSeconds: 7 * DAY, downSeconds: 0 },
        german,
        "no-results",
      ).description,
    ).toBe("Keine Ausfallzeit · noch keine Prüfung abgeschlossen");
    expect(
      describeWindow(
        { windowSeconds: 7 * DAY, coveredSeconds: 0, downSeconds: 0 },
        german,
      ),
    ).toMatchObject({
      valueText: "Keine Daten",
      description: "In diesem Zeitraum nichts erfasst",
    });
  });

  test.each(LANGUAGES)(
    "%s: no phrase of a window is left in English",
    (language: string) => {
      setDateDisplayLanguage(language);

      const translated: UptimeWindowPresentation = describeWindow(
        { windowSeconds: 7 * DAY, coveredSeconds: 3 * DAY, downSeconds: 3900 },
        translatorFor(language),
        "paused",
      );

      for (const englishPhrase of [
        "Down",
        "measured over",
        "includes paused time",
      ]) {
        expect(translated.description).not.toContain(englishPhrase);
      }
    },
  );
});
