import {
  afterEach,
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
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The telemetry guided setup, step by step (issue #6806): the setup guide
 * and the wait for the first data, then recommended alerts on the service
 * that reported, created in one click. It ends with a monitor on the data
 * or with "not now"; the records decide which step a returning person
 * lands on; nothing is made twice; the Free plan's acknowledgement is
 * asked; and who is told is said.
 */

const api: Record<string, MockFunction> = {
  loadService: getJestMockFunction(),
  loadReportingServices: getJestMockFunction(),
  loadFirstDataReached: getJestMockFunction(),
  loadCoveredRecommendationIds: getJestMockFunction(),
  createMonitors: getJestMockFunction(),
  loadMonitors: getJestMockFunction(),
};
let mayCreate: boolean = true;

/*
 * The server's guided setup runs (#7253), in memory: the store reads and
 * writes them as it would the server's (GuidedSetupRunServerMock).
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/GuidedSetupRunApi",
  () => {
    return (
      jest.requireActual("./GuidedSetupRunServerMock") as {
        guidedSetupRunApiModule: unknown;
      }
    ).guidedSetupRunApiModule;
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/Telemetry/TelemetrySetupApi",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/Telemetry/TelemetrySetupApi",
    ) as Record<string, unknown>;
    const calls: Record<string, (...args: Array<unknown>) => unknown> = {};

    for (const name of [
      "loadService",
      "loadReportingServices",
      "loadFirstDataReached",
      "loadCoveredRecommendationIds",
      "createMonitors",
      "loadMonitors",
    ]) {
      calls[name] = (...args: Array<unknown>): unknown => {
        return api[name]!(...args);
      };
    }

    return {
      __esModule: true,
      default: calls,
      getTelemetryRecommendations: actual["getTelemetryRecommendations"],
      mayCreateMonitors: (): boolean => {
        return mayCreate;
      },
    };
  },
);

const loadWhoIsToldFacts: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/WebsiteDown/WebsiteDownApi",
  () => {
    return {
      __esModule: true,
      default: {
        loadWhoIsToldFacts: (...args: Array<unknown>) => {
          return loadWhoIsToldFacts(...args);
        },
      },
    };
  },
);

/*
 * Who is told, as each monitor's "When this goes down" reads it (#7164):
 * WhoIsToldService's answer, by monitor id. Unread (rejected) until a test
 * hands one, so the summary says what the counts say.
 */
const getForMonitor: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/WhoIsToldApi",
  () => {
    return {
      __esModule: true,
      default: {
        getForMonitor: (...args: Array<unknown>) => {
          return getForMonitor(...args);
        },
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/Documentation",
  () => {
    return {
      __esModule: true,
      default: (props: {
        telemetryType?: string;
        everySignal?: boolean;
        isBare?: boolean;
        onSelectedKeyChange?: unknown;
      }) => {
        return (
          <div
            data-testid="telemetry-guide"
            data-type={props.telemetryType}
            data-every-signal={String(Boolean(props.everySignal))}
            data-bare={String(Boolean(props.isBare))}
            data-reports-key={String(Boolean(props.onSelectedKeyChange))}
          />
        );
      },
    };
  },
);

// The wait: here a button stands in for the first service reporting.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOnboarding/ResourceConnectionWatch",
  () => {
    return {
      __esModule: true,
      default: (props: {
        onConnected?: (record: {
          _id: string;
          getColumnValue: (name: string) => unknown;
        }) => void;
        ingestionKey?: unknown;
        dataPage?: unknown;
        onDataArrived?: unknown;
        isServiceRequired?: boolean;
        firstDataMilestones?: ReadonlyArray<string>;
      }) => {
        return (
          <button
            type="button"
            data-testid="first-data-arrives"
            data-watches-key={String(
              Boolean(
                props.ingestionKey || props.dataPage || props.onDataArrived,
              ),
            )}
            data-service-required={String(Boolean(props.isServiceRequired))}
            data-first-data={(props.firstDataMilestones || []).join(",")}
            onClick={() => {
              props.onConnected?.({
                _id: "svc-new",
                getColumnValue: (name: string): unknown => {
                  return name === "name" ? "checkout" : undefined;
                },
              });
            }}
          >
            Waiting
          </button>
        );
      },
    };
  },
);

let consentRequired: boolean = false;

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Billing/PayAsYouGo",
  () => {
    return {
      __esModule: true,
      isMonitorBatchConsentRequired: (): boolean => {
        return consentRequired;
      },
      MonitorBatchPayAsYouGoConsent: (props: {
        value: boolean;
        onChange: (value: boolean) => void;
      }) => {
        return consentRequired ? (
          <input
            type="checkbox"
            data-testid="billing-consent"
            checked={props.value}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              props.onChange(event.target.checked);
            }}
          />
        ) : (
          <></>
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLink",
  () => {
    return {
      __esModule: true,
      default: (props: {
        to: { toString: () => string };
        children: React.ReactNode;
        dataTestId?: string;
      }) => {
        return (
          <a href={props.to.toString()} data-testid={props.dataTestId}>
            {props.children}
          </a>
        );
      },
    };
  },
);

const sendMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ProductEvents", () => {
  return {
    __esModule: true,
    default: {
      send: (...args: Array<unknown>) => {
        return sendMock(...args);
      },
    },
  };
});

import TelemetryGuidedSetup from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/Telemetry/TelemetryGuidedSetup";
import { getGuidedSetupRunKey } from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/GuidedSetupProgress";
import { TELEMETRY_SETUP_COPY } from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/Telemetry/TelemetrySetup";
import { getTelemetryRecommendations } from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/Telemetry/TelemetrySetupApi";
import { getTelemetryWhoIsToldWords } from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/Telemetry/TelemetryWhoIsTold";
import ActivationMilestone from "../../../Types/Analytics/ActivationMilestone";
import { ProductEventName } from "../../../Types/Analytics/ProductEvent";
import { MonitorRecommendation } from "../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import {
  WhoIsToldBreakKind,
  WhoIsToldEvent,
  WhoIsToldFix,
  WhoIsToldOwnersSource,
  WhoIsToldResult,
  makeWhoIsToldBreak,
} from "../../../Types/Monitor/WhoIsTold";
import ObjectID from "../../../Types/ObjectID";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import { OnCallTestPageRecordKind } from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import { createTranslator, Translator } from "../../../Types/Translator";
import ProjectUtil from "../../../UI/Utils/Project";
import UserUtil from "../../../UI/Utils/User";
import {
  guidedSetupRunServer,
  readKeptRunValues,
} from "./GuidedSetupRunServerMock";

const PROJECT_ID: string = "65f00000-0000-4000-8000-000000006806";
const USER_ID: string = "40000000-0000-4000-8000-000000000001";

const RUN_KEY: string = getGuidedSetupRunKey({
  setup: "telemetry",
  projectId: PROJECT_ID,
  userId: USER_ID,
});

const RECOMMENDATIONS: Array<MonitorRecommendation> =
  getTelemetryRecommendations();
const IDS: Array<string> = RECOMMENDATIONS.map((r: MonitorRecommendation) => {
  return r.recommendationId;
});

const storedRun: () => Record<string, unknown> = (): Record<
  string,
  unknown
> => {
  return readKeptRunValues(window.localStorage.getItem(RUN_KEY)) as Record<
    string,
    unknown
  >;
};

const keepRun: (run: Record<string, unknown>) => void = (
  run: Record<string, unknown>,
): void => {
  window.localStorage.setItem(RUN_KEY, JSON.stringify(run));
};

const renderSetup: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    render(<TelemetryGuidedSetup />);
  });

  await waitFor(() => {
    expect(screen.getByTestId("guided-setup")).toBeInTheDocument();
  });
};

const stepState: (key: string) => string | null = (
  key: string,
): string | null => {
  return screen
    .getByTestId(`guided-setup-step-${key}`)
    .getAttribute("data-state");
};

const press: (testId: string) => Promise<void> = async (
  testId: string,
): Promise<void> => {
  await act(async () => {
    fireEvent.click(screen.getByTestId(testId));
  });
};

const sent: (name: ProductEventName) => Array<Record<string, unknown>> = (
  name: ProductEventName,
): Array<Record<string, unknown>> => {
  return sendMock.mock.calls
    .filter((call: Array<unknown>): boolean => {
      return call[0] === name;
    })
    .map((call: Array<unknown>): Record<string, unknown> => {
      return call[1] as Record<string, unknown>;
    });
};

const reachAlertStep: () => Promise<void> = async (): Promise<void> => {
  await renderSetup();
  await press("first-data-arrives");
  await waitFor(() => {
    expect(
      screen.getByTestId("guided-setup-recommendations"),
    ).toBeInTheDocument();
  });
};

beforeEach(() => {
  guidedSetupRunServer.reset();
  window.localStorage.clear();
  mayCreate = true;
  consentRequired = false;
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest.spyOn(UserUtil, "getUserId").mockReturnValue(new ObjectID(USER_ID));

  api["loadService"]!.mockResolvedValue({
    id: "svc-new",
    name: "checkout",
    hasReported: true,
  });
  api["loadReportingServices"]!.mockResolvedValue([]);
  // Nothing known of the project's first data: the setup's three are offered.
  api["loadFirstDataReached"]!.mockResolvedValue([]);
  api["loadCoveredRecommendationIds"]!.mockResolvedValue([]);
  api["createMonitors"]!.mockResolvedValue({
    createdIds: ["mon-1", "mon-2", "mon-3"],
    failures: [],
  });
  api["loadMonitors"]!.mockImplementation((async (ids: Array<string>) => {
    return ids.map((id: string) => {
      return { id: id, name: `checkout ${id}` };
    });
  }) as unknown as (...args: Array<unknown>) => unknown);
  loadWhoIsToldFacts.mockResolvedValue({
    policyCount: 0,
    incidentRuleCount: 0,
    alertRuleCount: 0,
    mayCreatePolicy: true,
    mayAddEscalationRules: true,
    mayAddRules: true,
  });
  getForMonitor.mockRejectedValue(new Error("Not read in this test."));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  for (const mock of Object.values(api)) {
    mock.mockReset();
  }
  loadWhoIsToldFacts.mockReset();
  getForMonitor.mockReset();
  sendMock.mockReset();
  window.localStorage.clear();
});

/*
 * What the setup sets up, beside the steps (#8897), in the order listed:
 * each step's outcome, whatever records the panel lists under it (#10276).
 */
const outcomesBeside: () => Array<string> = (): Array<string> => {
  return Array.from(
    screen
      .getByTestId("guided-setup-aside")
      .querySelectorAll(
        '[data-testid^="guided-setup-outcome-"][data-testid$="-text"]',
      ),
  ).map((item: Element): string => {
    return item.textContent || "";
  });
};

describe("1. Send your first data", () => {
  test("beside the steps, what it sets up, the first one open, and about how long", async () => {
    await renderSetup();

    expect(outcomesBeside()).toEqual([
      "Your app sends its logs, metrics and traces to OneUptime.",
      "Recommended monitors alert you when that data shows a problem.",
    ]);
    expect(screen.getByTestId("guided-setup-outcome-send")).toHaveAttribute(
      "data-state",
      "open",
    );
    expect(screen.getByTestId("guided-setup-minutes")).toHaveTextContent(
      /^About 10\sminutes$/,
    );
  });

  test("opens with the setup guide, OpenTelemetry for all three signals, and the wait", async () => {
    await renderSetup();

    expect(stepState("send")).toBe("open");
    expect(stepState("alert")).toBe("upcoming");
    expect(screen.getByTestId("telemetry-guide")).toHaveAttribute(
      "data-type",
      "traces",
    );
    /*
     * Its snippets set up logs, metrics and traces, as the setup says, not
     * the traces guide's alone, and a key it creates is not a Traces key
     * (issue #7927).
     */
    expect(screen.getByTestId("telemetry-guide")).toHaveAttribute(
      "data-every-signal",
      "true",
    );
    expect(screen.getByTestId("telemetry-guide")).toHaveAttribute(
      "data-bare",
      "true",
    );
    expect(screen.getByTestId("first-data-arrives")).toBeInTheDocument();
    expect(sent(ProductEventName.GuidedSetupStarted)).toEqual([
      { setup: "telemetry" },
    ]);
  });

  test("the first data keeps the service in the run and opens the alert step", async () => {
    await reachAlertStep();

    expect(storedRun()).toEqual({ serviceId: "svc-new" });
    expect(stepState("send")).toBe("done");
    expect(
      screen.getByTestId("guided-setup-step-send-done-line"),
    ).toHaveTextContent("checkout is sending data.");
    expect(stepState("alert")).toBe("open");
  });

  test("a project already sending data can pick a service that has reported", async () => {
    api["loadReportingServices"]!.mockResolvedValue([
      { id: "svc-old", name: "billing", hasReported: true },
    ]);
    await renderSetup();

    expect(
      screen.getByTestId("guided-setup-reporting-services"),
    ).toHaveTextContent("Use billing");
    await press("guided-setup-use-service-svc-old");

    expect(storedRun()).toEqual({ serviceId: "svc-old" });
    expect(stepState("alert")).toBe("open");
  });

  test("a project with no reporting service is not offered one", async () => {
    await renderSetup();

    expect(
      screen.queryByTestId("guided-setup-reporting-services"),
    ).not.toBeInTheDocument();
  });

  /*
   * Unlike the Setup Guide tabs, whose wait also ends on the key's first
   * data (#7754): step 2 alerts on the service, and every way this guide
   * offers names one.
   */
  test("waits for a service, not for the key's first data: the next step alerts on that service", async () => {
    await renderSetup();

    expect(screen.getByTestId("first-data-arrives")).toHaveAttribute(
      "data-watches-key",
      "false",
    );
    expect(screen.getByTestId("first-data-arrives")).toHaveAttribute(
      "data-service-required",
      "true",
    );
    expect(screen.getByTestId("telemetry-guide")).toHaveAttribute(
      "data-reports-key",
      "false",
    );
  });

  /*
   * #7888: data that names no service arrives with no service to finish
   * the step. While no service of the project has reported, the project's
   * first logs, metrics or traces are what that data is, and the step says
   * so (ResourceConnectionWatch, isServiceRequired) and waits on.
   */
  test("with no service reporting, it watches the first logs, metrics and traces, to say when data names no service", async () => {
    await renderSetup();

    expect(
      screen
        .getByTestId("first-data-arrives")
        .getAttribute("data-first-data")!
        .split(",")
        .sort(),
    ).toEqual(
      [
        ActivationMilestone.FirstTracesReceived,
        ActivationMilestone.FirstMetricsReceived,
        ActivationMilestone.FirstLogsReceived,
      ].sort(),
    );
  });

  test("with services that report, data may be theirs: it watches no first data, and offers them", async () => {
    api["loadReportingServices"]!.mockResolvedValue([
      { id: "svc-old", name: "billing", hasReported: true },
    ]);
    await renderSetup();

    expect(screen.getByTestId("first-data-arrives")).toHaveAttribute(
      "data-first-data",
      "",
    );
    expect(
      screen.getByTestId("guided-setup-reporting-services"),
    ).toBeInTheDocument();
  });
});

/*
 * #7146: each recommended monitor reads one kind of data, so it is offered
 * once the project's first data of that kind arrived - a service that sends
 * only logs gets the error-log monitor, not three that can never fire.
 */
describe("2. Get alerted: the monitors for the data that arrived", () => {
  const offeredTemplates: () => Array<string> = (): Array<string> => {
    return Array.from(
      screen.getByTestId("guided-setup-recommendations").querySelectorAll("li"),
    ).map((item: HTMLLIElement): string => {
      return (item.getAttribute("data-testid") || "").replace(
        "guided-setup-recommendation-",
        "",
      );
    });
  };

  test.each([
    [
      "logs only: the error logs, and the exceptions logs bring",
      [ActivationMilestone.FirstLogsReceived],
      ["service-unhandled-exceptions", "service-error-log-spike"],
    ],
    [
      "traces only: failing requests and exceptions",
      [ActivationMilestone.FirstTracesReceived],
      ["service-error-burst", "service-unhandled-exceptions"],
    ],
    [
      "metrics only: slow requests",
      [ActivationMilestone.FirstMetricsReceived],
      ["service-latency-p95"],
    ],
    [
      "traces and metrics: the three",
      [
        ActivationMilestone.FirstTracesReceived,
        ActivationMilestone.FirstMetricsReceived,
      ],
      [
        "service-error-burst",
        "service-latency-p95",
        "service-unhandled-exceptions",
      ],
    ],
    [
      "logs, metrics and traces: all four, in the setup's order",
      [
        ActivationMilestone.FirstLogsReceived,
        ActivationMilestone.FirstMetricsReceived,
        ActivationMilestone.FirstTracesReceived,
      ],
      [
        "service-error-burst",
        "service-latency-p95",
        "service-unhandled-exceptions",
        "service-error-log-spike",
      ],
    ],
    [
      "nothing known: the setup's three",
      [],
      [
        "service-error-burst",
        "service-latency-p95",
        "service-unhandled-exceptions",
      ],
    ],
  ])(
    "%s",
    async (
      _name: string,
      reached: Array<ActivationMilestone>,
      expected: Array<string>,
    ) => {
      api["loadFirstDataReached"]!.mockResolvedValue(reached);
      await reachAlertStep();

      expect(offeredTemplates()).toEqual(expected);
      // All ticked: the button makes each one.
      expect(
        screen.getByTestId("guided-setup-create-monitors"),
      ).toHaveTextContent(
        expected.length === 1
          ? "Create 1 monitor"
          : `Create ${expected.length} monitors`,
      );
      // What the service has already is asked of these, and only these.
      const asked: Array<MonitorRecommendation> = (
        api["loadCoveredRecommendationIds"]!.mock.calls[0]![0] as {
          recommendations: Array<MonitorRecommendation>;
        }
      ).recommendations;
      expect(
        asked.map((recommendation: MonitorRecommendation): string => {
          return recommendation.templateId;
        }),
      ).toEqual(expected);
    },
  );

  test("a read of the first data that fails offers the setup's three", async () => {
    api["loadFirstDataReached"]!.mockRejectedValue(
      new Error("The API is down."),
    );
    await reachAlertStep();

    expect(offeredTemplates()).toEqual([
      "service-error-burst",
      "service-latency-p95",
      "service-unhandled-exceptions",
    ]);
  });

  test("the logs-only service's monitor is made as the others are, for it", async () => {
    api["loadFirstDataReached"]!.mockResolvedValue([
      ActivationMilestone.FirstLogsReceived,
    ]);
    await reachAlertStep();
    await press("guided-setup-create-monitors");

    const made: {
      recommendations: Array<MonitorRecommendation>;
      recommendationIds: Array<string>;
      service: { id: string };
    } = api["createMonitors"]!.mock.calls[0]![0] as {
      recommendations: Array<MonitorRecommendation>;
      recommendationIds: Array<string>;
      service: { id: string };
    };

    expect(made.service.id).toBe("svc-new");
    expect(
      made.recommendations.map(
        (recommendation: MonitorRecommendation): string => {
          return recommendation.templateId;
        },
      ),
    ).toEqual(["service-unhandled-exceptions", "service-error-log-spike"]);
    expect(made.recommendationIds).toHaveLength(2);
  });
});

describe("2. Get alerted", () => {
  test("offers the three recommended monitors for the service, all ticked", async () => {
    await reachAlertStep();

    expect(
      api["loadCoveredRecommendationIds"]!.mock.calls[0]![0],
    ).toMatchObject({ service: { id: "svc-new", name: "checkout" } });
    for (const recommendation of RECOMMENDATIONS) {
      expect(
        screen.getByTestId(`guided-setup-pick-${recommendation.templateId}`),
      ).toBeChecked();
    }
    expect(
      screen.getByTestId("guided-setup-create-monitors"),
    ).toHaveTextContent("Create 3 monitors");
  });

  test("says these are alerts for the team, and who is told: the owners, with no on-call policy", async () => {
    await reachAlertStep();

    const who: HTMLElement = screen.getByTestId("guided-setup-who-is-told");
    expect(who).toHaveTextContent(TELEMETRY_SETUP_COPY.alertsNotIncidents);
    expect(who).toHaveTextContent(TELEMETRY_SETUP_COPY.whoOwners);
    expect(screen.getByTestId("guided-setup-page-someone")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/on-call-duty/setup`,
    );
  });

  test("a project that pages people already is told its on-call rules decide", async () => {
    loadWhoIsToldFacts.mockResolvedValue({
      policyCount: 1,
      incidentRuleCount: 1,
      alertRuleCount: 1,
      mayCreatePolicy: true,
      mayAddEscalationRules: true,
      mayAddRules: true,
    });
    await reachAlertStep();

    expect(screen.getByTestId("guided-setup-who-is-told")).toHaveTextContent(
      TELEMETRY_SETUP_COPY.whoExisting,
    );
    expect(
      screen.queryByTestId("guided-setup-page-someone"),
    ).not.toBeInTheDocument();
  });

  test("creates the ones picked in one click, keeps them in the run, and finishes", async () => {
    await reachAlertStep();
    await act(async () => {
      fireEvent.click(
        screen.getByTestId(
          `guided-setup-pick-${RECOMMENDATIONS[1]!.templateId}`,
        ),
      );
    });
    await press("guided-setup-create-monitors");

    const call: Record<string, unknown> = api["createMonitors"]!.mock
      .calls[0]![0] as Record<string, unknown>;
    expect(call["recommendationIds"]).toEqual([IDS[0], IDS[2]]);
    expect(call["service"]).toMatchObject({ id: "svc-new" });
    expect(storedRun()).toEqual({
      serviceId: "svc-new",
      monitorIds: "mon-1,mon-2,mon-3",
    });
    expect(screen.getByTestId("guided-setup-summary")).toBeInTheDocument();
    expect(
      screen.getByTestId("guided-setup-step-alert-done-line"),
    ).toHaveTextContent("3 monitors watch checkout.");
    expect(sent(ProductEventName.GuidedSetupFinished)).toHaveLength(1);
  });

  test("nothing picked is said, and makes nothing", async () => {
    await reachAlertStep();
    for (const recommendation of RECOMMENDATIONS) {
      await act(async () => {
        fireEvent.click(
          screen.getByTestId(`guided-setup-pick-${recommendation.templateId}`),
        );
      });
    }
    await press("guided-setup-create-monitors");

    expect(
      screen.getByText(TELEMETRY_SETUP_COPY.nothingPicked),
    ).toBeInTheDocument();
    expect(api["createMonitors"]).not.toHaveBeenCalled();
  });

  test("Not now ends the setup too, and is kept in the run", async () => {
    await reachAlertStep();
    await press("guided-setup-not-now");

    expect(storedRun()).toEqual({ serviceId: "svc-new", alertSkipped: true });
    expect(api["createMonitors"]).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("guided-setup-summary-watched-by"),
    ).toHaveTextContent(TELEMETRY_SETUP_COPY.summaryNotWatched);
    expect(sent(ProductEventName.GuidedSetupFinished)).toHaveLength(1);
  });

  test("a monitor the service has already is shown as watched, and not offered again", async () => {
    api["loadCoveredRecommendationIds"]!.mockResolvedValue([IDS[0]]);
    await reachAlertStep();

    expect(
      screen.getByTestId(
        `guided-setup-recommendation-${RECOMMENDATIONS[0]!.templateId}`,
      ),
    ).toHaveTextContent(TELEMETRY_SETUP_COPY.alreadyWatched);
    expect(
      screen.queryByTestId(
        `guided-setup-pick-${RECOMMENDATIONS[0]!.templateId}`,
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("guided-setup-create-monitors"),
    ).toHaveTextContent("Create 2 monitors");
  });

  test("a service watched by all three already is confirmed with Continue", async () => {
    api["loadCoveredRecommendationIds"]!.mockResolvedValue(IDS);
    await reachAlertStep();

    expect(
      screen.queryByTestId("guided-setup-create-monitors"),
    ).not.toBeInTheDocument();
    await press("guided-setup-alert-continue");

    expect(storedRun()).toEqual({ serviceId: "svc-new", alertConfirmed: true });
    expect(screen.getByTestId("guided-setup-summary")).toBeInTheDocument();
  });

  test("on the Free plan, create waits for the billing acknowledgement", async () => {
    consentRequired = true;
    await reachAlertStep();

    expect(screen.getByTestId("guided-setup-create-monitors")).toBeDisabled();
    await act(async () => {
      fireEvent.click(screen.getByTestId("billing-consent"));
    });
    expect(screen.getByTestId("guided-setup-create-monitors")).toBeEnabled();
    await press("guided-setup-create-monitors");

    expect(
      (api["createMonitors"]!.mock.calls[0]![0] as Record<string, unknown>)[
        "hasAcknowledgedBilling"
      ],
    ).toBe(true);
  });

  test("a refused monitor is named with its reason; the ones made stay, and Continue moves on", async () => {
    api["createMonitors"]!.mockResolvedValue({
      createdIds: ["mon-1"],
      failures: [{ name: "checkout Error Burst", message: "Limit reached" }],
    });
    await reachAlertStep();
    await press("guided-setup-create-monitors");

    expect(
      screen.getByTestId("guided-setup-create-failures"),
    ).toHaveTextContent("checkout Error Burst: Limit reached");
    expect(stepState("alert")).toBe("open");
    expect(storedRun()["monitorIds"]).toBe("mon-1");
    await press("guided-setup-alert-continue-anyway");
    expect(screen.getByTestId("guided-setup-summary")).toBeInTheDocument();
  });

  /*
   * #10276: the panel lists each monitor as it is made, and a refused one
   * with why and Try again - which makes only what is still missing: the
   * monitors made leave the pick once they watch the service, so a second
   * Create never makes a second copy of them.
   */
  test("the panel lists the monitors picked, then made; Try again makes only the one refused, never a second copy", async () => {
    expect(IDS.length).toBeGreaterThan(1);
    api["createMonitors"]!.mockResolvedValueOnce({
      createdIds: ["mon-1"],
      failures: [{ name: "checkout Error Burst", message: "Limit reached" }],
    });
    await reachAlertStep();

    // Every recommendation picked waits for Create.
    for (const id of IDS) {
      expect(
        screen.getByTestId(`guided-setup-resource-picked-${id}`),
      ).toHaveAttribute("data-status", "waiting");
    }

    // What the first Create made watches the service now.
    api["loadCoveredRecommendationIds"]!.mockResolvedValue(IDS.slice(1));
    await press("guided-setup-create-monitors");

    expect(
      screen.getByTestId("guided-setup-resource-monitor-mon-1"),
    ).toHaveAttribute("data-status", "created");
    expect(
      screen.getByTestId("guided-setup-resource-refused-0"),
    ).toHaveAttribute("data-status", "failed");
    expect(
      screen.getByTestId("guided-setup-resource-refused-0-error"),
    ).toHaveTextContent("Limit reached");
    // Only the refused one is left to make.
    expect(
      screen.getByTestId("guided-setup-create-monitors"),
    ).toHaveTextContent("Create 1 monitor");

    api["createMonitors"]!.mockResolvedValueOnce({
      createdIds: ["mon-2"],
      failures: [],
    });
    await press("guided-setup-resource-refused-0-retry");

    expect(api["createMonitors"]).toHaveBeenCalledTimes(2);
    expect(
      (
        api["createMonitors"]!.mock.calls[1]![0] as {
          recommendationIds: Array<string>;
        }
      ).recommendationIds,
    ).toEqual([IDS[0]]);
    expect(storedRun()["monitorIds"]).toBe("mon-1,mon-2");
    expect(screen.getByTestId("guided-setup-summary")).toBeInTheDocument();
  });

  test("a coverage read that fails after a refusal keeps the pick as it was", async () => {
    api["createMonitors"]!.mockResolvedValueOnce({
      createdIds: ["mon-1"],
      failures: [{ name: "checkout Error Burst", message: "Limit reached" }],
    });
    await reachAlertStep();
    api["loadCoveredRecommendationIds"]!.mockRejectedValue(
      new Error("Not now"),
    );
    await press("guided-setup-create-monitors");

    expect(
      screen.getByTestId("guided-setup-create-monitors"),
    ).toHaveTextContent(`Create ${IDS.length} monitors`);
    expect(
      screen.getByTestId("guided-setup-resource-refused-0"),
    ).toHaveAttribute("data-status", "failed");
  });

  test("an error says the server's reason and keeps the step open", async () => {
    api["createMonitors"]!.mockRejectedValue(new Error("Something broke"));
    await reachAlertStep();
    await press("guided-setup-create-monitors");

    expect(screen.getByText("Something broke")).toBeInTheDocument();
    expect(stepState("alert")).toBe("open");
  });

  test("someone who may not create monitors is told so, and can still say not now", async () => {
    mayCreate = false;
    await reachAlertStep();

    expect(
      screen.getByText(TELEMETRY_SETUP_COPY.cannotCreateMonitors),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("guided-setup-create-monitors"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("guided-setup-not-now")).toBeInTheDocument();
  });
});

describe("the summary", () => {
  test("lists the monitors made, each opening its page, and says what is next on the service", async () => {
    keepRun({ serviceId: "svc-new", monitorIds: "mon-1,mon-2" });
    await renderSetup();

    expect(screen.getByTestId("guided-setup-summary")).toHaveTextContent(
      "checkout is sending data",
    );
    expect(
      within(screen.getByTestId("guided-setup-summary")).getByText(
        "checkout mon-1",
      ),
    ).toHaveAttribute("href", `/dashboard/${PROJECT_ID}/monitors/mon-1`);
    // The panel lists them too, made, each opening its page (#10276).
    expect(
      screen.getByTestId("guided-setup-resource-monitor-mon-1"),
    ).toHaveAttribute("data-status", "created");
    expect(
      screen.getByTestId("guided-setup-resource-monitor-mon-1-open"),
    ).toHaveAttribute("href", `/dashboard/${PROJECT_ID}/monitors/mon-1`);
    expect(
      screen.getByTestId("guided-setup-more-recommendations"),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/service/svc-new/recommendations`,
    );
    expect(screen.getByText("View its logs")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/service/svc-new/logs`,
    );
  });

  test("Set up another service starts a new run", async () => {
    keepRun({ serviceId: "svc-new", alertSkipped: true });
    await renderSetup();
    await press("guided-setup-start-over");

    await waitFor(() => {
      expect(window.localStorage.getItem(RUN_KEY)).toBeNull();
    });
    expect(stepState("send")).toBe("open");
  });
});

/*
 * WHO IS TOLD, READ FROM THE RECORDS (#7164): the summary asks
 * WhoIsToldService about each monitor the setup made, and says its answer
 * in the words the monitor's "When this goes down" card says it, with each
 * break named once and the page that puts it right - never only the counts.
 */

// What WhoIsToldService answers for a telemetry monitor that opens an alert.
const alertAnswer: (data: {
  monitorId: string;
  owners?: Array<string>;
  pages?: string | undefined;
}) => WhoIsToldResult = (data: {
  monitorId: string;
  owners?: Array<string>;
  pages?: string | undefined;
}): WhoIsToldResult => {
  const event: WhoIsToldEvent = {
    kind: OnCallTestPageRecordKind.Alert,
    title: "checkout is failing",
    severityName: "High",
    owners: {
      source: WhoIsToldOwnersSource.ProjectOwners,
      userNames: data.owners || ["Ana Lopez"],
      teamNames: [],
    },
    ownerRules: [],
    rules: [],
    policies: data.pages
      ? [
          {
            id: "p1",
            name: "Default",
            isHidden: false,
            isNamedByCriteria: false,
            ruleIds: ["r1"],
            levelCount: 1,
            people: [
              {
                userId: "u9",
                name: data.pages,
                channels: [OnCallPageChannel.SMS],
                isFallback: false,
                isReachable: true,
              },
            ],
            notPaged: [],
          },
        ]
      : [],
    statusPages: [],
  };

  return {
    monitorId: data.monitorId,
    monitorName: `checkout ${data.monitorId}`,
    checkedAt: "2026-11-17T10:00:00.000Z",
    criteria: [{ id: "c1", name: "Errors", events: [event] }],
    channels: {
      isBillingEnabled: false,
      isSmsOn: true,
      isCallOn: true,
      isWhatsAppOn: true,
      isTelegramOn: true,
      hasOwnTwilioForSms: false,
      hasOwnTwilioForCalls: false,
      serverCanSendEmail: true,
      serverCanSendSms: true,
      serverCanCall: true,
    },
    breaks: data.pages
      ? []
      : [
          makeWhoIsToldBreak({
            kind: WhoIsToldBreakKind.OnlyIncidentsHaveRules,
            fix: WhoIsToldFix.AlertOnCallRules,
            recordKind: OnCallTestPageRecordKind.Alert,
          }),
        ],
  };
};

const answerFor: (
  answers: Record<string, WhoIsToldResult | Error>,
) => (...args: Array<unknown>) => Promise<WhoIsToldResult> = (
  answers: Record<string, WhoIsToldResult | Error>,
): ((...args: Array<unknown>) => Promise<WhoIsToldResult>) => {
  return async (...args: Array<unknown>): Promise<WhoIsToldResult> => {
    const id: string = (
      args[0] as { monitorId: ObjectID }
    ).monitorId.toString();
    const answer: WhoIsToldResult | Error | undefined = answers[id];

    if (!answer || answer instanceof Error) {
      throw answer || new Error("No such monitor.");
    }

    return answer;
  };
};

const whoIsToldRow: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId("guided-setup-summary-who-is-told");
};

describe("the summary: who is told, from the records", () => {
  test("asks WhoIsToldService about every monitor the setup made, and says their shared answer once, in the card's words", async () => {
    getForMonitor.mockImplementation(
      answerFor({
        "mon-1": alertAnswer({ monitorId: "mon-1" }),
        "mon-2": alertAnswer({ monitorId: "mon-2" }),
      }),
    );
    keepRun({ serviceId: "svc-new", monitorIds: "mon-1,mon-2" });
    await renderSetup();

    await waitFor(() => {
      expect(
        screen.getByTestId("guided-setup-summary-who-is-told-words"),
      ).toBeInTheDocument();
    });

    expect(
      getForMonitor.mock.calls.map((call: Array<unknown>): string => {
        return (call[0] as { monitorId: ObjectID }).monitorId.toString();
      }),
    ).toEqual(["mon-1", "mon-2"]);

    const lines: Array<HTMLElement> = screen.getAllByTestId(
      "guided-setup-who-is-told-line",
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveTextContent(
      "OneUptime opens an alert (High). It emails the Project Owners (Ana Lopez). Nobody is paged.",
    );
    // Told alike: no monitor is named in the sentence's place.
    expect(lines[0]).not.toHaveTextContent("checkout mon-1");
    // Nor the counts' sentence, which said less.
    expect(whoIsToldRow()).not.toHaveTextContent(
      TELEMETRY_SETUP_COPY.whoOwners,
    );
  });

  test("names the break a telemetry monitor's alert meets - only incidents have on-call rules - once, with Set Up Paging", async () => {
    getForMonitor.mockImplementation(
      answerFor({
        "mon-1": alertAnswer({ monitorId: "mon-1" }),
        "mon-2": alertAnswer({ monitorId: "mon-2" }),
        "mon-3": alertAnswer({ monitorId: "mon-3" }),
      }),
    );
    keepRun({ serviceId: "svc-new", monitorIds: "mon-1,mon-2,mon-3" });
    await renderSetup();

    await waitFor(() => {
      expect(
        screen.getAllByTestId("guided-setup-who-is-told-break"),
      ).toHaveLength(1);
    });

    const brk: HTMLElement = screen.getByTestId(
      "guided-setup-who-is-told-break",
    );
    expect(brk).toHaveAttribute(
      "data-kind",
      WhoIsToldBreakKind.OnlyIncidentsHaveRules,
    );
    expect(brk).toHaveTextContent(
      "Nobody is paged for this monitor's alerts: only incidents have on-call rules.",
    );
    expect(
      screen.getByTestId("guided-setup-who-is-told-fix"),
    ).toHaveTextContent("Set Up Paging");
    expect(screen.getByTestId("guided-setup-who-is-told-fix")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/alerts/settings/on-call-rules`,
    );
  });

  test("monitors told otherwise are each named over their own answer", async () => {
    getForMonitor.mockImplementation(
      answerFor({
        "mon-1": alertAnswer({ monitorId: "mon-1", pages: "Ben Ito" }),
        "mon-2": alertAnswer({ monitorId: "mon-2" }),
      }),
    );
    keepRun({ serviceId: "svc-new", monitorIds: "mon-1,mon-2" });
    await renderSetup();

    await waitFor(() => {
      expect(
        screen.getAllByTestId("guided-setup-who-is-told-line"),
      ).toHaveLength(2);
    });

    const lines: Array<HTMLElement> = screen.getAllByTestId(
      "guided-setup-who-is-told-line",
    );
    expect(lines[0]).toHaveTextContent("checkout mon-1");
    expect(lines[0]).toHaveTextContent("It pages Ben Ito through Default.");
    expect(lines[1]).toHaveTextContent("checkout mon-2");
    expect(lines[1]).toHaveTextContent("Nobody is paged.");
  });

  test("a monitor that can't be read leaves the others' answer standing", async () => {
    getForMonitor.mockImplementation(
      answerFor({
        "mon-1": new Error("Monitor not found."),
        "mon-2": alertAnswer({ monitorId: "mon-2" }),
      }),
    );
    keepRun({ serviceId: "svc-new", monitorIds: "mon-1,mon-2" });
    await renderSetup();

    await waitFor(() => {
      expect(
        screen.getByTestId("guided-setup-who-is-told-line"),
      ).toHaveTextContent("It emails the Project Owners (Ana Lopez).");
    });
    expect(
      screen.queryByTestId("guided-setup-summary-who-is-told-fallback"),
    ).not.toBeInTheDocument();
  });

  test("when no monitor's answer can be read, the counts' sentence is said, as before", async () => {
    keepRun({ serviceId: "svc-new", monitorIds: "mon-1" });
    await renderSetup();

    await waitFor(() => {
      expect(
        screen.getByTestId("guided-setup-summary-who-is-told-fallback"),
      ).toHaveTextContent(TELEMETRY_SETUP_COPY.whoOwners);
    });
  });

  test("a setup that made no monitor (Not now) asks nothing, and says the counts' sentence", async () => {
    keepRun({ serviceId: "svc-new", alertSkipped: true });
    await renderSetup();

    await waitFor(() => {
      expect(
        screen.getByTestId("guided-setup-summary-who-is-told-fallback"),
      ).toHaveTextContent(TELEMETRY_SETUP_COPY.whoOwners);
    });
    expect(getForMonitor).not.toHaveBeenCalled();
  });

  test("while the answers come, the row keeps the line's room with a skeleton", async () => {
    let answer: (result: WhoIsToldResult) => void = (): void => {};
    getForMonitor.mockImplementation((() => {
      return new Promise<WhoIsToldResult>(
        (resolve: (result: WhoIsToldResult) => void) => {
          answer = resolve;
        },
      );
    }) as unknown as (...args: Array<unknown>) => unknown);
    keepRun({ serviceId: "svc-new", monitorIds: "mon-1" });
    await renderSetup();

    expect(
      screen.getByTestId("guided-setup-summary-who-is-told-loading"),
    ).toBeInTheDocument();

    await act(async () => {
      answer(alertAnswer({ monitorId: "mon-1" }));
    });

    expect(
      screen.queryByTestId("guided-setup-summary-who-is-told-loading"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("guided-setup-who-is-told-line"),
    ).toBeInTheDocument();
  });
});

describe("getTelemetryWhoIsToldWords", () => {
  const english: Translator = createTranslator(undefined, "en");

  test("no answer says nothing, for the summary to fall back on the counts", () => {
    expect(
      getTelemetryWhoIsToldWords({ answers: [], translator: english }),
    ).toEqual({ lines: [], breaks: [] });
  });

  test("a break several monitors meet is said once, from the first monitor met", () => {
    const words: ReturnType<typeof getTelemetryWhoIsToldWords> =
      getTelemetryWhoIsToldWords({
        answers: ["mon-1", "mon-2"].map((id: string) => {
          return {
            monitorId: id,
            monitorName: `checkout ${id}`,
            result: alertAnswer({ monitorId: id }),
          };
        }),
        translator: english,
      });

    expect(words.lines).toEqual([
      {
        text: "OneUptime opens an alert (High). It emails the Project Owners (Ana Lopez). Nobody is paged.",
      },
    ]);
    expect(words.breaks).toHaveLength(1);
    expect(words.breaks[0]!.monitorId).toBe("mon-1");
  });
});

describe("leaving and coming back", () => {
  test("a run only the server kept - another device's - opens at the step it was on (#7253)", async () => {
    guidedSetupRunServer.seed("telemetry", { serviceId: "svc-new" });
    await renderSetup();

    await waitFor(() => {
      expect(stepState("alert")).toBe("open");
    });
    expect(stepState("send")).toBe("done");
    expect(api["loadService"]).toHaveBeenCalledWith("svc-new");
  });

  test("OneUptime out of reach when the page opens: it opens on what this browser kept (#7253)", async () => {
    keepRun({ serviceId: "svc-new" });
    guidedSetupRunServer.isDown = true;
    await renderSetup();

    await waitFor(() => {
      expect(stepState("alert")).toBe("open");
    });
    expect(stepState("send")).toBe("done");
  });

  test("a service that reported opens the alert step, and asks nothing again", async () => {
    keepRun({ serviceId: "svc-new" });
    await renderSetup();

    await waitFor(() => {
      expect(stepState("alert")).toBe("open");
    });
    expect(stepState("send")).toBe("done");
    expect(api["loadService"]).toHaveBeenCalledWith("svc-new");
  });

  test("monitors deleted since open the alert step again", async () => {
    keepRun({ serviceId: "svc-new", monitorIds: "mon-1" });
    api["loadMonitors"]!.mockResolvedValue([]);
    await renderSetup();

    await waitFor(() => {
      expect(stepState("alert")).toBe("open");
    });
  });

  test("a service deleted since starts the run again", async () => {
    keepRun({ serviceId: "svc-gone", alertSkipped: true });
    api["loadService"]!.mockResolvedValue(null);
    await renderSetup();

    await waitFor(() => {
      expect(window.localStorage.getItem(RUN_KEY)).toBeNull();
    });
    expect(stepState("send")).toBe("open");
  });

  test("a done step opened again goes back to the summary on Continue", async () => {
    keepRun({ serviceId: "svc-new", alertSkipped: true });
    await renderSetup();
    await act(async () => {
      fireEvent.click(
        screen.getByTestId("guided-setup-step-send").querySelector("button")!,
      );
    });
    await press("guided-setup-send-continue");

    expect(screen.getByTestId("guided-setup-summary")).toBeInTheDocument();
  });
});
