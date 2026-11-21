/** @timezone UTC */

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import SecurityHuntRun from "../../../Models/DatabaseModels/SecurityHuntRun";
import SecurityLogSource from "../../../Models/DatabaseModels/SecurityLogSource";
import SecurityTelemetrySource from "../../../Models/DatabaseModels/SecurityTelemetrySource";
import Route from "../../../Types/API/Route";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import {
  FIRST_STRONG_ISOLATE,
  POP_DIRECTIONAL_ISOLATE,
} from "../../../Types/ReadingDirection";
import ProductType from "../../../Types/MeteredPlan/ProductType";
import ObjectID from "../../../Types/ObjectID";
import { SecurityTelemetrySourceKind } from "../../../Types/SecurityEvent/SecurityTelemetrySource";
import { DetectionRetrohuntResult } from "../../../Types/SecurityEvent/DetectionRetrohunt";
import {
  TelemetryIngestionBudgetScope,
  TelemetryIngestionBudgetState,
  TelemetryIngestionBudgetStatus,
} from "../../../Types/Telemetry/TelemetryIngestionBudget";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  RefusedTelemetry,
  RefusedTelemetryKind,
  writeRefusedTelemetryRecord,
} from "../../../Utils/SecurityEvent/RefusedTelemetry";
import {
  DASHBOARD_LANGUAGES,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * WHAT A BUDGET OR A RATE REFUSED, AS A READER SEES IT (#10431).
 *
 * A project at its logs budget during an attack: the Overview's card says
 * part of its telemetry was not scanned - never "All quiet" - with an amber
 * Sources cell and, at its foot, whose budget refused what, when and how
 * much, and Open Budgets; Your logs and the Traces source say it under
 * their switch; a retrohunt says what was refused over its period; a
 * hunt's run whose window was refused says so; and every Security Events
 * page shows the logs' and traces' budget banners while a source reads
 * them. In English, and in every language the Dashboard ships.
 */

const BUDGETS_ROUTE: Route = new Route(
  "/dashboard/project/settings/usage-history",
);
const budgetStatusMock: MockFunction = getJestMockFunction();
const retrohuntMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryIngestionBudget/ProjectTelemetryIngestionBudget",
  () => {
    return {
      __esModule: true,
      fetchProjectTelemetryIngestionBudgetStatus: () => {
        return budgetStatusMock();
      },
      getTelemetryIngestionBudgetsRoute: () => {
        return BUDGETS_ROUTE;
      },
      TelemetryIngestionBudgetExplorerBanner: () => {
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseApi",
  () => {
    return {
      __esModule: true,
      default: {
        runDetectionRuleRetrohunt: (...args: Array<unknown>) => {
          return retrohuntMock(...args);
        },
      },
    };
  },
);

import SecurityOverviewStatus, {
  SECURITY_REFUSED_TELEMETRY_TEST_ID,
  SECURITY_STATUS_HEADLINE_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityOverview/SecurityOverviewStatus";
import { SecuritySetupStatus } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityOverview/SecuritySetupModel";
import {
  QUIET_TITLE,
  SecurityOverviewQueue,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityOverview/SecurityOverviewStatusModel";
import * as Copy from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/RefusedTelemetry/RefusedTelemetryCopy";
import SecurityLogsSourceCard, {
  SECURITY_LOGS_SOURCE_REFUSED_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityLogsSourceCard";
import DetectionRuleRetrohuntPanel from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Retrohunt/DetectionRuleRetrohuntPanel";
import { RETROHUNT_TEST_IDS } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Retrohunt/RetrohuntCopy";
import { buildRetrohuntRequest } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Retrohunt/RetrohuntModel";
import HuntRunHistory from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Hunts/HuntRunHistory";
import { HUNTS_TEST_IDS } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Hunts/HuntsCopy";
import SecurityEventsReadBudgetBanners, {
  getSecurityEventsReadBudgetBannerSignals,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/RefusedTelemetry/SecurityEventsReadBudgetBanners";
import SecurityEventsNoResults, {
  SECURITY_EVENTS_NO_RESULTS_REFUSED_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsNoResults";

const NOW: Date = new Date("2026-11-20T15:00:00.000Z");
const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const EN: Record<string, string> = readDashboardLocale("en");

const refusal: (data: Partial<RefusedTelemetry>) => RefusedTelemetry = (
  data: Partial<RefusedTelemetry>,
): RefusedTelemetry => {
  return {
    signal: ProductType.Logs,
    kind: RefusedTelemetryKind.BudgetUsedUp,
    scope: TelemetryIngestionBudgetScope.Project,
    scopeId: PROJECT_ID.toString(),
    scopeName: "",
    from: "2026-11-20T14:02:00.000Z",
    to: null,
    refusedBytes: 52_428_800,
    refusedRequests: 1200,
    ...data,
  };
};

// What the sources kept, as a scan writes it on its result.
const keptResult: (refusals: Array<RefusedTelemetry>) => JSONObject = (
  refusals: Array<RefusedTelemetry>,
): JSONObject => {
  return {
    logsRead: 0,
    ...writeRefusedTelemetryRecord({ observation: null, refusals }),
  };
};

// The words of a locale's sentence around its placeholders.
const piecesOf: (sentence: string) => Array<string> = (
  sentence: string,
): Array<string> => {
  return sentence
    .split(/\{\{[^}]+\}\}/)
    .map((piece: string): string => {
      return piece.trim();
    })
    .filter((piece: string): boolean => {
      return piece.length > 1;
    });
};

// A text without the isolates and held spaces a sentence sets its values in.
const plain: (text: string | null | undefined) => string = (
  text: string | null | undefined,
): string => {
  return (text || "")
    .split(FIRST_STRONG_ISOLATE)
    .join("")
    .split(POP_DIRECTIONAL_ISOLATE)
    .join("")
    .split(" ")
    .join(" ");
};

// A moment as a line writes it: the reader's clock, in full.
const written: (iso: string) => string = (iso: string): string => {
  return OneUptimeDate.getDateAsLocalFormattedString(new Date(iso));
};

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {
    en: { translation: EN },
  };

  for (const language of DASHBOARD_LANGUAGES) {
    resources[language] = { translation: readDashboardLocale(language) };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources,
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  await i18next.changeLanguage("en");
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  budgetStatusMock.mockReset();
  retrohuntMock.mockReset();
});

describe("the Overview's card, at the logs budget during an attack", () => {
  const QUEUE: SecurityOverviewQueue = {
    openCases: 0,
    criticalOpenCases: 0,
    highOpenCases: 0,
    myOpenCases: 0,
    unassignedOpenCases: 0,
    runsWaitingForApproval: 0,
  };

  function status(
    overrides: Partial<SecuritySetupStatus> = {},
  ): SecuritySetupStatus {
    return {
      connections: 0,
      logsSourceEnabled: true,
      telemetrySourcesEnabled: 1,
      eventsLast24Hours: 1234,
      lastEventAt: new Date("2026-11-20T14:01:00.000Z"),
      enabledRules: 19,
      recommendedRules: 19,
      recommendedRulesOn: 19,
      threatIntelFeeds: 0,
      openCases: 0,
      enabledPlaybooks: 1,
      destinations: 0,
      ...overrides,
    };
  }

  function renderCard(value: SecuritySetupStatus): void {
    render(
      <MemoryRouter>
        <SecurityOverviewStatus
          queue={QUEUE}
          status={value}
          showPipeline={true}
          hasStatusFailed={false}
          isReading={false}
          now={NOW}
          onChanged={(): void => {}}
          onTryAgain={(): void => {}}
          onSetUp={(): void => {}}
        />
      </MemoryRouter>,
    );
  }

  const UNDER_ATTACK: SecuritySetupStatus = status({
    refusedTelemetry: [
      refusal({}),
      refusal({
        signal: ProductType.Traces,
        kind: RefusedTelemetryKind.RateLimited,
        from: "2026-11-20T09:00:00.000Z",
        to: "2026-11-20T09:20:00.000Z",
        refusedBytes: 0,
        refusedRequests: 250,
      }),
    ],
  });

  test("says part of the telemetry was not scanned, never all quiet, and the Sources cell is amber", () => {
    renderCard(UNDER_ATTACK);

    const band: HTMLElement = screen.getByTestId(SECURITY_STATUS_HEADLINE_ID);

    expect(band).toHaveAttribute("data-kind", "missing-telemetry");
    expect(band).toHaveAttribute("data-tone", "warning");
    expect(band).toHaveTextContent(Copy.MISSING_TELEMETRY_TITLE);
    expect(band).toHaveTextContent(Copy.MISSING_TELEMETRY_SUMMARY);
    expect(screen.queryByText(QUIET_TITLE)).not.toBeInTheDocument();
    expect(
      screen.getByText(Copy.SOURCES_TELEMETRY_REFUSED),
    ).toBeInTheDocument();
  });

  test("says at its foot whose budget refused what, when and how much, what goes on first, with Open Budgets", () => {
    const navigate: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((() => {
        return undefined;
      }) as never);

    renderCard(UNDER_ATTACK);

    const foot: HTMLElement = screen.getByTestId(
      SECURITY_REFUSED_TELEMETRY_TEST_ID,
    );
    const lines: Array<HTMLElement> = within(foot).getAllByTestId(
      `${SECURITY_REFUSED_TELEMETRY_TEST_ID}-line`,
    );

    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveAttribute("data-signal", ProductType.Logs);
    expect(lines[0]).toHaveAttribute("data-ongoing", "true");
    expect(lines[0]).toHaveTextContent(Copy.YOUR_LOGS_SOURCE);
    expect(plain(lines[0]!.textContent)).toContain(
      `Your daily logs budget was used up at ${written("2026-11-20T14:02:00.000Z")}. Logs since then were refused and not scanned.`,
    );
    expect(lines[0]).toHaveTextContent("in 1,200 requests was not stored.");
    expect(lines[1]).toHaveAttribute("data-signal", ProductType.Traces);
    expect(lines[1]).toHaveTextContent(Copy.TRACES_SOURCE);
    expect(lines[1]).toHaveTextContent("250 requests were throttled.");

    fireEvent.click(
      within(foot).getByTestId(
        `${SECURITY_REFUSED_TELEMETRY_TEST_ID}-open-budgets`,
      ),
    );
    expect(navigate).toHaveBeenCalledWith(BUDGETS_ROUTE);
  });

  test("a project whose telemetry was not refused reads all quiet, with nothing at its foot", () => {
    renderCard(status());

    expect(screen.getByTestId(SECURITY_STATUS_HEADLINE_ID)).toHaveAttribute(
      "data-kind",
      "quiet",
    );
    expect(
      screen.queryByTestId(SECURITY_REFUSED_TELEMETRY_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test.each(DASHBOARD_LANGUAGES)(
    "%s: the band, the Sources cell and the line are in the reader's language, never English",
    async (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);

      await act(async () => {
        await i18next.changeLanguage(language);
      });

      renderCard(status({ refusedTelemetry: [refusal({})] }));

      const band: HTMLElement = screen.getByTestId(SECURITY_STATUS_HEADLINE_ID);

      expect(plain(band.textContent)).toContain(
        plain(words[Copy.MISSING_TELEMETRY_TITLE]),
      );
      expect(plain(band.textContent)).not.toContain(
        Copy.MISSING_TELEMETRY_TITLE,
      );
      expect(plain(document.body.textContent)).toContain(
        plain(words[Copy.SOURCES_TELEMETRY_REFUSED]),
      );

      const line: HTMLElement = screen.getByTestId(
        `${SECURITY_REFUSED_TELEMETRY_TEST_ID}-line`,
      );

      for (const piece of piecesOf(
        words[Copy.LOGS_BUDGET_USED_UP_SINCE] || "",
      )) {
        expect({
          language,
          piece,
          shown: plain(line.textContent).includes(plain(piece)),
        }).toEqual({
          language,
          piece,
          shown: true,
        });
      }

      expect(plain(line.textContent)).not.toContain(
        "Logs since then were refused and not scanned.",
      );
    },
  );
});

describe("Your logs", () => {
  function stubSource(value: SecurityLogSource | null): void {
    jest.spyOn(ModelAPI, "getList").mockImplementation((async () => {
      return {
        data: value ? [value] : [],
        count: value ? 1 : 0,
        skip: 0,
        limit: 1,
      };
    }) as never);
  }

  function source(isEnabled: boolean): SecurityLogSource {
    const value: SecurityLogSource = new SecurityLogSource();
    value.id = new ObjectID("55555555-5555-4555-8555-555555555555");
    value.projectId = PROJECT_ID;
    value.isEnabled = isEnabled;
    value.lastScannedAt = new Date("2026-11-20T14:59:00.000Z");
    value.lastScanResult = keptResult([refusal({})]);
    return value;
  }

  test("says under its switch what a budget refused of the logs, while it is on", async () => {
    stubSource(source(true));

    await act(async () => {
      render(
        <MemoryRouter>
          <SecurityLogsSourceCard />
        </MemoryRouter>,
      );
    });

    const refused: HTMLElement = await screen.findByTestId(
      SECURITY_LOGS_SOURCE_REFUSED_TEST_ID,
    );

    expect(refused).toHaveTextContent("Your daily logs budget was used up at");
    expect(refused).toHaveTextContent(
      "Logs since then were refused and not scanned.",
    );
  });

  test("says nothing of it while it is off", async () => {
    stubSource(source(false));

    await act(async () => {
      render(
        <MemoryRouter>
          <SecurityLogsSourceCard />
        </MemoryRouter>,
      );
    });

    expect(
      screen.queryByTestId(SECURITY_LOGS_SOURCE_REFUSED_TEST_ID),
    ).not.toBeInTheDocument();
  });
});

describe("a retrohunt over a period whose logs were refused", () => {
  function answer(
    overrides: Partial<DetectionRetrohuntResult> = {},
  ): DetectionRetrohuntResult {
    return {
      startTime: new Date("2026-11-13T15:00:00.000Z"),
      endTime: NOW,
      periodInHours: 168,
      isCorrelation: false,
      windowInMinutes: 5,
      threshold: 10,
      firedCount: 0,
      groupCount: 0,
      eventCount: 0,
      matchedEventCount: 4,
      exceptionCount: 0,
      skippedEventCount: 0,
      preventedFiredCount: 0,
      groups: [],
      hasMoreGroups: false,
      candidateLimit: null,
      uncounted: null,
      refusedTelemetry: [],
      ...overrides,
    };
  }

  async function drawPanel(): Promise<void> {
    await act(async () => {
      render(
        <MemoryRouter>
          <DetectionRuleRetrohuntPanel
            getRequest={(periodInHours: number): JSONObject => {
              return buildRetrohuntRequest(
                { detectionRuleId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1" },
                periodInHours,
              );
            }}
          />
        </MemoryRouter>,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  test("says what was refused, so 'would not have fired' is not read as nothing happened", async () => {
    retrohuntMock.mockResolvedValue(
      answer({
        refusedTelemetry: [
          refusal({
            from: "2026-11-18T10:00:00.000Z",
            to: "2026-11-19T00:00:00.000Z",
          }),
        ],
      }) as never,
    );

    await drawPanel();

    const refused: HTMLElement = await screen.findByTestId(
      RETROHUNT_TEST_IDS.refused,
    );

    expect(refused).toHaveTextContent(Copy.RETROHUNT_REFUSED);
    expect(plain(refused.textContent)).toContain(
      `Your daily logs budget was used up from ${written("2026-11-18T10:00:00.000Z")} to ${written("2026-11-19T00:00:00.000Z")}. Logs in that time were refused and not scanned.`,
    );
    // A rule being written is not left for the budgets.
    expect(
      within(refused).queryByTestId(
        `${RETROHUNT_TEST_IDS.refused}-open-budgets`,
      ),
    ).not.toBeInTheDocument();
  });

  test("says nothing of it when nothing was refused", async () => {
    retrohuntMock.mockResolvedValue(answer() as never);

    await drawPanel();

    expect(
      await screen.findByTestId(RETROHUNT_TEST_IDS.summary),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(RETROHUNT_TEST_IDS.refused),
    ).not.toBeInTheDocument();
  });
});

describe("a hunt's runs", () => {
  const HOUR: number = 60 * 60 * 1000;

  function run(
    id: string,
    windowEndsAt: string,
    eventCount: number,
  ): SecurityHuntRun {
    const item: SecurityHuntRun = new SecurityHuntRun();
    item._id = id;
    item.windowEndAt = new Date(windowEndsAt);
    item.windowStartAt = new Date(item.windowEndAt.getTime() - HOUR);
    item.createdAt = new Date(item.windowEndAt.getTime() + 2 * 60 * 1000);
    item.eventCount = eventCount;
    return item;
  }

  test("a run whose window was refused says so under what it found; the others do not", async () => {
    const refusedRun: SecurityHuntRun = run(
      "a1000000-0000-4000-8000-000000000001",
      "2026-11-20T14:30:00.000Z",
      0,
    );
    const clearRun: SecurityHuntRun = run(
      "a1000000-0000-4000-8000-000000000002",
      "2026-11-20T11:00:00.000Z",
      2,
    );

    jest.spyOn(ModelAPI, "getList").mockImplementation((async (
      options: Record<string, unknown>,
    ) => {
      if (options["modelType"] === SecurityHuntRun) {
        return { data: [refusedRun, clearRun], count: 2, skip: 0, limit: 10 };
      }

      if (options["modelType"] === SecurityLogSource) {
        const value: SecurityLogSource = new SecurityLogSource();
        value.lastScanResult = keptResult([refusal({})]);
        return { data: [value], count: 1, skip: 0, limit: 1 };
      }

      const traces: SecurityTelemetrySource = new SecurityTelemetrySource();
      traces.kind = SecurityTelemetrySourceKind.Traces;
      return { data: [traces], count: 1, skip: 0, limit: 1 };
    }) as never);

    await act(async () => {
      render(
        <MemoryRouter>
          <HuntRunHistory
            huntId={new ObjectID("3b000000-0000-4000-8000-000000000001")}
            onClose={(): void => {}}
            onShowWindow={(): void => {}}
          />
        </MemoryRouter>,
      );
    });

    const refusedRow: HTMLElement = await screen.findByTestId(
      `${HUNTS_TEST_IDS.runRow}-${refusedRun._id}`,
    );
    const clearRow: HTMLElement = screen.getByTestId(
      `${HUNTS_TEST_IDS.runRow}-${clearRun._id}`,
    );

    expect(
      await within(refusedRow).findByTestId(`${HUNTS_TEST_IDS.runRow}-refused`),
    ).toHaveTextContent(Copy.HUNT_RUN_REFUSED);
    expect(
      within(clearRow).queryByTestId(`${HUNTS_TEST_IDS.runRow}-refused`),
    ).not.toBeInTheDocument();
  });
});

describe("the events list with nothing in its time range", () => {
  function stubSources(): void {
    jest.spyOn(ModelAPI, "getList").mockImplementation((async (
      options: Record<string, unknown>,
    ) => {
      if (options["modelType"] === SecurityLogSource) {
        const value: SecurityLogSource = new SecurityLogSource();
        value.lastScanResult = keptResult([refusal({})]);
        return { data: [value], count: 1, skip: 0, limit: 1 };
      }

      return { data: [], count: 0, skip: 0, limit: 1 };
    }) as never);
  }

  async function drawNoResults(data: {
    from: string;
    to: string;
    latest?: string | undefined;
  }): Promise<void> {
    await act(async () => {
      render(
        <MemoryRouter>
          <SecurityEventsNoResults
            latestEventTime={data.latest ? new Date(data.latest) : undefined}
            windowStartDate={new Date(data.from)}
            windowEndDate={new Date(data.to)}
          />
        </MemoryRouter>,
      );
    });
  }

  test("says events from a refused stretch are missing, never just that there were none", async () => {
    stubSources();

    await drawNoResults({
      from: "2026-11-20T14:00:00.000Z",
      to: "2026-11-20T15:00:00.000Z",
      latest: "2026-11-20T13:00:00.000Z",
    });

    expect(
      await screen.findByTestId(SECURITY_EVENTS_NO_RESULTS_REFUSED_ID),
    ).toHaveTextContent(Copy.NO_EVENTS_BUT_REFUSED);
    expect(
      screen.getByText("No security events in this time range"),
    ).toBeInTheDocument();
  });

  test("a time range nothing was refused in says only what it always said", async () => {
    stubSources();

    await drawNoResults({
      from: "2026-11-19T10:00:00.000Z",
      to: "2026-11-19T11:00:00.000Z",
    });

    expect(
      screen.getByText("No security events in this time range"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(SECURITY_EVENTS_NO_RESULTS_REFUSED_ID),
    ).not.toBeInTheDocument();
  });
});

describe("the budget banners of what Security Events reads", () => {
  const usedUp: TelemetryIngestionBudgetStatus = {
    dayStartsAt: "2026-11-20T00:00:00.000Z",
    resetsAt: "2026-11-21T00:00:00.000Z",
    resetTime: "00:00",
    timezone: "UTC",
    warningPercent: 80,
    countersAvailable: true,
    project: {
      scope: TelemetryIngestionBudgetScope.Project,
      signals: [ProductType.Logs, ProductType.Traces].map(
        (signal: ProductType.Logs | ProductType.Traces) => {
          return {
            signal,
            dailyBudgetBytes: 1000,
            dailyBudgetSource: null,
            rateLimitBytesPerSecond: null,
            rateLimitSource: null,
            usedBytes: 1000,
            droppedBytes: 10,
            droppedRequests: 1,
            throttledRequests: 0,
            percentUsed: 100,
            state: TelemetryIngestionBudgetState.Exhausted,
            warningCrossedAt: null,
            exhaustedAt: "2026-11-20T14:02:00.000Z",
          };
        },
      ),
    },
    ingestionKeys: [],
    teamsAndLabels: [],
  };

  test("the logs' while Your logs is on, the traces' while the Traces source is", () => {
    expect(
      getSecurityEventsReadBudgetBannerSignals({
        readsLogs: true,
        readsTraces: false,
      }),
    ).toEqual([ProductType.Logs]);
    expect(
      getSecurityEventsReadBudgetBannerSignals({
        readsLogs: true,
        readsTraces: true,
      }),
    ).toEqual([ProductType.Logs, ProductType.Traces]);
    expect(
      getSecurityEventsReadBudgetBannerSignals({
        readsLogs: false,
        readsTraces: false,
      }),
    ).toEqual([]);
  });

  test("a used-up logs budget is said over the page while Your logs is on, in one read of the budgets; the Traces source being off, nothing of the traces", async () => {
    budgetStatusMock.mockResolvedValue(usedUp as never);
    jest.spyOn(ModelAPI, "getList").mockImplementation((async (
      options: Record<string, unknown>,
    ) => {
      const isOn: boolean = options["modelType"] === SecurityLogSource;

      return { data: isOn ? [{ _id: "x" }] : [], count: isOn ? 1 : 0 };
    }) as never);

    await act(async () => {
      render(
        <MemoryRouter>
          <SecurityEventsReadBudgetBanners />
        </MemoryRouter>,
      );
    });

    const banners: Array<HTMLElement> = await screen.findAllByTestId(
      "telemetry-ingestion-budget-banner",
    );

    expect(banners).toHaveLength(1);
    expect(banners[0]).toHaveTextContent("today's ingestion budget of");
    expect(banners[0]).toHaveTextContent("Logs");
    expect(budgetStatusMock).toHaveBeenCalledTimes(1);
  });

  test("no source on, no banner and no read of the budgets", async () => {
    budgetStatusMock.mockResolvedValue(usedUp as never);
    jest.spyOn(ModelAPI, "getList").mockResolvedValue({
      data: [],
      count: 0,
    } as never);

    await act(async () => {
      render(
        <MemoryRouter>
          <SecurityEventsReadBudgetBanners />
        </MemoryRouter>,
      );
    });

    expect(
      screen.queryByTestId("telemetry-ingestion-budget-banner"),
    ).not.toBeInTheDocument();
    expect(budgetStatusMock).not.toHaveBeenCalled();
  });
});
