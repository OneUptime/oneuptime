/** @timezone UTC */

import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { getJestSpyOn } from "../../Spy";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import persianLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import MonitorOverviewHero, {
  ComponentProps as HeroProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorOverviewHero";
import MonitorOverviewStatBar, {
  ComponentProps as StatBarProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorOverviewStatBar";
import { MonitorOpenWorkSide } from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorOverviewTypes";
import { ResourceOwnerEntry } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/OwnerEntry";
import {
  OverviewSection,
  resolveSection,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/OverviewSection";
import {
  forgetRememberedDateTexts,
  getEnglishOf,
  setDateDisplayLanguage,
} from "../../../Types/DateLanguage";
import { JSONObject } from "../../../Types/JSON";
import {
  MonitorUptimeSummary,
  MonitorUptimeWindowKey,
} from "../../../Types/Monitor/MonitorUptimeSummary";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
import MonitorOverviewPresentationUtil, {
  MonitorOverviewPresentation,
  MonitorOverviewPresentationInput,
  MonitorOverviewStatusRef,
} from "../../../Utils/Monitor/MonitorOverviewPresentationUtil";
import { MonitorOverviewProbeSummary } from "../../../Utils/Monitor/MonitorOverviewProbeUtil";
import {
  formatDurationCompact,
  formatDurationCompactInLanguage,
} from "../../../Utils/Slo/SloDuration";

/*
 * The monitor overview's hero and stat bar as a reader of another language
 * sees them, rendered with the Dashboard's real locale files:
 *
 * - a status's name reads as its badge reads it - OneUptime's own
 *   ("Operational") in the reader's words, a name the project gave a status
 *   as written - so the badge and the headline under it never disagree;
 * - the headline's German wording keeps its duration in the case Intl
 *   writes it in ("3 Tage", never "seit 3 Tage");
 * - the monitor type on the target line is the type picker's word for it;
 * - a compact duration names its units with the language's own short
 *   names: never "2h 8m" in Latin letters inside a Persian sentence, never
 *   a bare "T" for a German day;
 * - every tile note is the reader's, "Unresolved on this monitor" too.
 */

const NOW: Date = new Date("2026-09-21T12:00:00.000Z");
const DAY: number = 86400;
const MONITOR_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SUBJECT: string = MONITOR_ID.toString();
const STEP_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

// A letter of the Latin alphabet: an English word or unit symbol.
const LATIN_LETTERS: RegExp = /[A-Za-z]/;

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

const instances: Record<string, i18n> = {};

const translatorFor: (
  locale: Record<string, unknown>,
  language: string,
) => Translator = (
  locale: Record<string, unknown>,
  language: string,
): Translator => {
  return createTranslator((text: string): string | undefined => {
    const value: unknown = locale[text];

    return typeof value === "string" ? value : undefined;
  }, language);
};

const LOCALES: Record<string, Record<string, unknown>> = {
  en: englishLocale as Record<string, unknown>,
  de: germanLocale as Record<string, unknown>,
  fa: persianLocale as Record<string, unknown>,
};

beforeAll(async () => {
  for (const [language, locale] of Object.entries(LOCALES)) {
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

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  getJestSpyOn(PermissionGate, "checkColumnUpdate").mockImplementation(
    (): PermissionGateResult => {
      return { isAllowed: true };
    },
  );
  getJestSpyOn(PermissionGate, "check").mockImplementation(
    (): PermissionGateResult => {
      return { isAllowed: true };
    },
  );
  getJestSpyOn(ModelAPI, "getList").mockImplementation(
    async (): Promise<unknown> => {
      return { data: [], count: 0, skip: 0, limit: 10 };
    },
  );
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
  setDateDisplayLanguage(null);
  forgetRememberedDateTexts();
});

const stepsOf: (data: JSONObject) => MonitorSteps = (
  data: JSONObject,
): MonitorSteps => {
  return {
    data: {
      monitorStepsInstanceArray: [{ data: { id: STEP_ID, ...data } }],
    },
  } as unknown as MonitorSteps;
};

const probeSummary: () => MonitorOverviewProbeSummary =
  (): MonitorOverviewProbeSummary => {
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
        probeId: "33333333-3333-4333-8333-333333333333",
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
    };
  };

const inputFor: (
  monitorType: MonitorType,
  overrides?: Partial<MonitorOverviewPresentationInput>,
) => MonitorOverviewPresentationInput = (
  monitorType: MonitorType,
  overrides?: Partial<MonitorOverviewPresentationInput>,
): MonitorOverviewPresentationInput => {
  return {
    now: NOW,
    monitorType: monitorType,
    monitorSteps: stepsOf({
      monitorDestination: "https://api.example.com/health",
      requestType: "GET",
    }),
    monitoringInterval: "*/5 * * * *",
    createdAt: secondsAgo(30 * DAY),
    currentStatus: OPERATIONAL,
    statusSince: secondsAgo(3 * DAY + 4 * 3600 + 12 * 60),
    pause: {
      isDisabled: false,
      byManualIncident: false,
      byScheduledMaintenance: false,
    },
    probeFlags: { isNoProbeEnabled: false, isAllProbesDisconnected: false },
    probes: probeSummary(),
    heartbeat: {
      lastReceivedAt: undefined,
      lastCheckedAt: undefined,
      requestMethod: "POST",
    },
    email: { lastReceivedAt: undefined, lastCheckedAt: undefined },
    agent: {
      lastReportAt: undefined,
      hostname: undefined,
      cpuPercent: undefined,
      memoryPercent: undefined,
    },
    telemetry: { lastEvaluatedAt: undefined, nextEvaluationAt: undefined },
    latestEvaluationAt: undefined,
    ...overrides,
  };
};

const drawInLanguage: (language: string, element: ReactElement) => void = (
  language: string,
  element: ReactElement,
): void => {
  setDateDisplayLanguage(language);

  render(
    <I18nextProvider i18n={instances[language]!}>
      <MemoryRouter>{element}</MemoryRouter>
    </I18nextProvider>,
  );
};

const NO_OWNERS: OverviewSection<Array<ResourceOwnerEntry>> = resolveSection<
  Array<ResourceOwnerEntry>
>({ value: [], subjectId: SUBJECT });

const drawHero: (data: {
  language: string;
  monitorType?: MonitorType | undefined;
  overrides?: Partial<MonitorOverviewPresentationInput> | undefined;
}) => void = (data: {
  language: string;
  monitorType?: MonitorType | undefined;
  overrides?: Partial<MonitorOverviewPresentationInput> | undefined;
}): void => {
  const monitorType: MonitorType = data.monitorType || MonitorType.API;
  const presentation: MonitorOverviewPresentation =
    MonitorOverviewPresentationUtil.build({
      ...inputFor(monitorType, data.overrides),
      translator: translatorFor(LOCALES[data.language]!, data.language),
    });
  const props: HeroProps = {
    monitorId: MONITOR_ID,
    monitorType: monitorType,
    presentation: presentation,
    owners: NO_OWNERS,
    isRefreshing: false,
    refreshError: "",
    lastLoadedAt: secondsAgo(30),
    onRefresh: () => {},
  };

  drawInLanguage(data.language, <MonitorOverviewHero {...props} />);
};

const textOf: (testId: string) => string = (testId: string): string => {
  return (screen.getByTestId(testId).textContent || "").replace(/\s+/g, " ");
};

describe("the hero's status name reads as its badge reads it", () => {
  test("German: OneUptime's own status in German words, the badge and the headline alike", () => {
    drawHero({ language: "de" });

    expect(textOf("monitor-overview-badge")).toBe("Betriebsbereit");
    expect(textOf("monitor-overview-headline")).toBe(
      "Betriebsbereit · 3 Tage, 4 Stunden und 12 Minuten",
    );
  });

  test("German: a status the project named reads as written", () => {
    drawHero({
      language: "de",
      overrides: {
        currentStatus: { ...OPERATIONAL, name: "Checkout healthy (EU)" },
      },
    });

    expect(textOf("monitor-overview-badge")).toBe("Checkout healthy (EU)");
    expect(textOf("monitor-overview-headline")).toBe(
      "Checkout healthy (EU) · 3 Tage, 4 Stunden und 12 Minuten",
    );
  });

  test("Persian: the status and its duration in Persian", () => {
    drawHero({ language: "fa" });

    expect(textOf("monitor-overview-headline")).not.toContain("Operational");
    expect(textOf("monitor-overview-headline")).toContain("روز");
  });

  test("English, as it always read", () => {
    drawHero({ language: "en" });

    expect(textOf("monitor-overview-badge")).toBe("Operational");
    expect(textOf("monitor-overview-headline")).toBe(
      "Operational for 3 days, 4 hours, 12 minutes",
    );
  });

  /*
   * German puts a duration after "seit" in the dative ("seit 3 Tagen"),
   * which Intl does not write; the German wording leaves it in the case
   * Intl writes it in.
   */
  test("the German headline never puts the duration after a preposition that changes its case", () => {
    const wording: unknown = (germanLocale as Record<string, unknown>)[
      "{{headline}} for {{duration}}"
    ];

    expect(wording).toBe("{{headline}} · {{duration}}");
  });
});

describe("the hero's target line names the monitor type in the reader's words", () => {
  test("German: the type picker's word", () => {
    drawHero({ language: "de", monitorType: MonitorType.SSLCertificate });

    expect(textOf("monitor-overview-target")).toContain("SSL-Zertifikat");
    expect(textOf("monitor-overview-target")).not.toContain("SSL Certificate");
  });

  test("English, as it always read", () => {
    drawHero({ language: "en", monitorType: MonitorType.SSLCertificate });

    expect(textOf("monitor-overview-target")).toContain("SSL Certificate");
  });
});

const summary: MonitorUptimeSummary = {
  monitorId: MONITOR_ID,
  timezone: "UTC",
  generatedAt: NOW,
  startDate: new Date("2026-06-24T00:00:00.000Z"),
  endDate: NOW,
  buckets: [],
  windows: [
    {
      key: MonitorUptimeWindowKey.Last24Hours,
      startDate: secondsAgo(DAY),
      endDate: NOW,
      windowSeconds: DAY,
      coveredSeconds: DAY,
      statusDurations: [
        { monitorStatusId: new ObjectID(OPERATIONAL.id), seconds: DAY },
      ],
    },
    {
      key: MonitorUptimeWindowKey.Last7Days,
      startDate: secondsAgo(7 * DAY),
      endDate: NOW,
      windowSeconds: 7 * DAY,
      coveredSeconds: 7 * DAY,
      statusDurations: [
        {
          monitorStatusId: new ObjectID(OPERATIONAL.id),
          seconds: 7 * DAY - 35 * 60,
        },
        {
          monitorStatusId: new ObjectID("44444444-4444-4444-8444-444444444444"),
          seconds: 35 * 60,
        },
      ],
    },
    {
      key: MonitorUptimeWindowKey.Last30Days,
      startDate: secondsAgo(30 * DAY),
      endDate: NOW,
      windowSeconds: 30 * DAY,
      coveredSeconds: 30 * DAY,
      statusDurations: [
        {
          monitorStatusId: new ObjectID(OPERATIONAL.id),
          seconds: 30 * DAY - (2 * 3600 + 8 * 60),
        },
        {
          monitorStatusId: new ObjectID("44444444-4444-4444-8444-444444444444"),
          seconds: 2 * 3600 + 8 * 60,
        },
      ],
    },
  ],
  isComplete: true,
  completeFrom: null,
  statuses: [
    {
      id: new ObjectID(OPERATIONAL.id),
      name: "Operational",
      color: "#10B981",
      isOperationalState: true,
      isOfflineState: false,
      priority: 1,
    },
    {
      id: new ObjectID("44444444-4444-4444-8444-444444444444"),
      name: "Offline",
      color: "#EF4444",
      isOperationalState: false,
      isOfflineState: true,
      priority: 3,
    },
  ],
};

const openSide: (count: number) => OverviewSection<MonitorOpenWorkSide> = (
  count: number,
): OverviewSection<MonitorOpenWorkSide> => {
  return resolveSection<MonitorOpenWorkSide>({
    value: { count: count, rows: [] },
    subjectId: SUBJECT,
  });
};

const drawStatBar: (language: string) => void = (language: string): void => {
  const props: StatBarProps = {
    monitorId: MONITOR_ID,
    summary: resolveSection<MonitorUptimeSummary>({
      value: summary,
      subjectId: SUBJECT,
    }),
    caveat: null,
    openWork: { incidents: openSide(1), alerts: openSide(1) },
  };

  drawInLanguage(language, <MonitorOverviewStatBar {...props} />);
};

const tileText: (id: string) => string = (id: string): string => {
  return (document.getElementById(id)?.textContent || "").replace(/\s+/g, " ");
};

describe("the stat bar in the reader's language", () => {
  test("German: each window's downtime with German unit names, the open work's note in German", () => {
    drawStatBar("de");

    expect(tileText("monitor-uptime-7d")).toContain("35 Min. ausgefallen");
    expect(tileText("monitor-uptime-30d")).toContain(
      "2 Std., 8 Min. ausgefallen",
    );
    expect(tileText("monitor-open-now")).toContain(
      "Nicht behoben für diesen Monitor",
    );
    expect(tileText("monitor-open-now")).not.toContain(
      "Unresolved on this monitor",
    );
  });

  test("Persian: no unit in Latin letters", () => {
    drawStatBar("fa");

    for (const id of ["monitor-uptime-7d", "monitor-uptime-30d"]) {
      const note: string = tileText(id).replace(/[\d.%]+/g, "");

      expect(note).not.toMatch(LATIN_LETTERS);
    }
  });

  test("English, as it always read", () => {
    drawStatBar("en");

    expect(tileText("monitor-uptime-30d")).toContain("Down 2h 8m");
    expect(tileText("monitor-open-now")).toContain(
      "Unresolved on this monitor",
    );
  });
});

describe("a compact duration in a sentence's language", () => {
  const SECONDS: number = 2 * 3600 + 8 * 60;

  test("English is formatDurationCompact, word for word", () => {
    for (const seconds of [0, 45, 12 * 60, SECONDS, 3 * DAY + 3600]) {
      expect(formatDurationCompactInLanguage(seconds, "en")).toBe(
        formatDurationCompact(seconds),
      );
    }
  });

  test("German abbreviates each unit as German does", () => {
    expect(formatDurationCompactInLanguage(SECONDS, "de")).toBe(
      "2 Std., 8 Min.",
    );
    expect(formatDurationCompactInLanguage(12 * DAY + 3 * 3600, "de")).toBe(
      "12 Tg., 3 Std.",
    );
  });

  /*
   * Intl's narrow unit names are Latin letters in some languages ("3h 8m"
   * in Persian and Japanese); the short ones are the language's own.
   */
  test.each(["fa", "ja", "ko", "zh-CN", "zh-TW", "ru", "hi"])(
    "%s names its units in its own script",
    (language: string) => {
      for (const seconds of [35 * 60, SECONDS, 12 * DAY + 3 * 3600]) {
        expect(
          formatDurationCompactInLanguage(seconds, language).replace(
            /[\d\s.,]+/g,
            "",
          ),
        ).not.toMatch(LATIN_LETTERS);
      }
    },
  );

  test("inside a sentence still in English it goes back to its English", () => {
    const german: string = formatDurationCompactInLanguage(SECONDS, "de");

    expect(getEnglishOf(german)).toBe("2h 8m");
  });
});
