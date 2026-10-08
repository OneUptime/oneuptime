import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import React, { act } from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * Create Monitor on the insight page — the way from a quiet finding to an
 * incident the next time it happens. Rendered for real, against a fake
 * server, because what matters is what a person sees and can press:
 *
 *  - the button is there for an insight that can become a monitor, and
 *    takes them to Monitor Create carrying the insight's id;
 *  - an insight that cannot (a latency regression, a drift on a cumulative
 *    counter) keeps the button but disables it AND says why — a disabled
 *    button with no reason reads as broken;
 *  - somebody who may not create monitors is told so instead of being let
 *    into a wizard that refuses them at the end;
 *  - and the existing human actions are untouched.
 */

const INSIGHT_ID: string = "11111111-1111-4111-8111-111111111111";
const SERVICE_ID: string = "22222222-2222-4222-8222-222222222222";
const ENTITY_ID: string = "33333333-3333-4333-8333-333333333333";

let isMasterAdminForTest: boolean = false;
let permissionsForTest: Array<unknown> = [];
let insightRow: () => unknown = (): unknown => {
  return null;
};
let metricShapeRows: Array<Record<string, unknown>> = [];
let analyticsListRequests: Array<Record<string, unknown>> = [];

/*
 * The real router, with the page's id: the service and metric facts render
 * real Links, which need a Router around them (renderInsight supplies it).
 */
jest.mock("react-router-dom", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "react-router-dom",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    useParams: () => {
      return { id: INSIGHT_ID };
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: [...permissionsForTest] };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return isMasterAdminForTest;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: async (): Promise<unknown> => {
        const { default: HTTPResponse } = jest.requireActual(
          "../../../Types/API/HTTPResponse",
        ) as { default: new (...args: Array<unknown>) => unknown };
        // The triage panel: no run, so it renders nothing.
        return new HTTPResponse(200, { run: null, events: [] }, {});
      },
      getFriendlyMessage: (): string => {
        return "Request failed";
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<unknown> => {
        return insightRow();
      },
      getList: async (): Promise<unknown> => {
        return { data: [], count: 0, skip: 0, limit: 10 };
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: async (request: Record<string, unknown>): Promise<unknown> => {
        analyticsListRequests.push(request);
        return {
          data: metricShapeRows,
          count: metricShapeRows.length,
          skip: 0,
          limit: 1,
        };
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const { default: ObjectIDClass } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDClass("00000000-0000-4000-8000-000000000001");
      },
      getCurrentProject: (): null => {
        return null;
      },
      getCurrentPlan: (): null => {
        return null;
      },
    },
  };
});

import AIInsightViewPage from "../../../../App/FeatureSet/Dashboard/src/Pages/AIInsights/View/Index";
import {
  AI_INSIGHT_MONITOR_CUMULATIVE_COUNTER_BLOCKER,
  AI_INSIGHT_MONITOR_LATENCY_BLOCKER,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/AIInsightMonitorPrefill";
import Metric, {
  AggregationTemporality,
  MetricPointType,
} from "../../../Models/AnalyticsModels/Metric";
import AIInsight from "../../../Models/DatabaseModels/AIInsight";
import AIInsightEvidence from "../../../Types/AI/AIInsightEvidence";
import AIInsightSeverity from "../../../Types/AI/AIInsightSeverity";
import AIInsightStatus from "../../../Types/AI/AIInsightStatus";
import AIInsightType from "../../../Types/AI/AIInsightType";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import { getJestSpyOn } from "../../Spy";

type BuildInsightFunction = (data: {
  insightType: AIInsightType;
  title: string;
  evidence?: AIInsightEvidence | undefined;
  metricName?: string | undefined;
  serviceName?: string | undefined;
  telemetryServiceId?: string | undefined;
}) => AIInsight;

const buildInsight: BuildInsightFunction = (data: {
  insightType: AIInsightType;
  title: string;
  evidence?: AIInsightEvidence | undefined;
  metricName?: string | undefined;
  serviceName?: string | undefined;
  telemetryServiceId?: string | undefined;
}): AIInsight => {
  const insight: AIInsight = new AIInsight();
  insight.id = new ObjectID(INSIGHT_ID);
  insight.title = data.title;
  insight.insightType = data.insightType;
  insight.severity = AIInsightSeverity.Medium;
  insight.status = AIInsightStatus.ActionRequired;
  insight.detailMarkdown = "Evidence";
  insight.occurrenceCount = 4;
  if (data.evidence) {
    insight.evidence = data.evidence;
  }
  if (data.metricName) {
    insight.metricName = data.metricName;
  }
  if (data.serviceName) {
    insight.serviceName = data.serviceName;
  }
  if (data.telemetryServiceId) {
    insight.telemetryServiceId = new ObjectID(data.telemetryServiceId);
  }
  return insight;
};

const NEW_EXCEPTION: AIInsight = buildInsight({
  insightType: AIInsightType.NewException,
  title: "New exception: TimeoutError in checkout",
  serviceName: "checkout",
  telemetryServiceId: SERVICE_ID,
  evidence: {
    exception: {
      exceptionType: "TimeoutError",
      exceptionMessage: "Query timed out after 30000 ms",
    },
  },
});

const LATENCY: AIInsight = buildInsight({
  insightType: AIInsightType.TraceLatencyRegression,
  title: "Latency regression: p99 14.2x in pd-rte-83",
  serviceName: "pd-rte-83",
  telemetryServiceId: SERVICE_ID,
  evidence: {
    latency: {
      recentP99Ms: 14200,
      baselineP99Ms: 1000,
      regressionMultiplier: 14.2,
    },
  },
});

const METRIC_DRIFT: AIInsight = buildInsight({
  insightType: AIInsightType.MetricDrift,
  title: "Metric drift: system.disk.operations +193% week-over-week",
  metricName: "system.disk.operations",
  evidence: {
    metricDrift: {
      metricName: "system.disk.operations",
      primaryEntityId: ENTITY_ID,
      recentWeekMean: 293,
      priorWeekMean: 100,
      relativeChangePercent: 193,
      recentSampleCount: 2000,
      priorSampleCount: 2000,
    },
  },
});

function metricPoint(data: {
  pointType: MetricPointType;
  isMonotonic: boolean;
  temporality: AggregationTemporality;
}): Record<string, unknown> {
  const metric: Metric = new Metric();
  metric.metricPointType = data.pointType;
  metric.isMonotonic = data.isMonotonic;
  metric.aggregationTemporality = data.temporality;
  return metric as unknown as Record<string, unknown>;
}

let navigateMock: jest.Mock<any, any>;

async function renderInsight(insight: AIInsight): Promise<void> {
  insightRow = (): unknown => {
    return insight;
  };

  render(
    <MemoryRouter>
      <AIInsightViewPage {...({} as any)} />
    </MemoryRouter>,
  );

  await waitFor(() => {
    return expect(screen.getByText(insight.title!)).toBeInTheDocument();
  });
}

function createMonitorButton(): HTMLButtonElement | null {
  return screen.queryByRole("button", {
    name: "Create Monitor",
  }) as HTMLButtonElement | null;
}

/*
 * An enabled Button is its own tooltip trigger; a disabled one is wrapped in
 * a hoverable span (a disabled control never receives the pointer).
 */
async function tooltipOf(button: HTMLButtonElement): Promise<HTMLElement> {
  await act(async () => {
    fireEvent.mouseEnter(
      button.disabled ? (button.parentElement as HTMLElement) : button,
    );
  });

  return await screen.findByRole("tooltip");
}

describe("AI insight detail — Create Monitor", () => {
  beforeEach(() => {
    isMasterAdminForTest = false;
    permissionsForTest = [Permission.ProjectAdmin];
    metricShapeRows = [];
    analyticsListRequests = [];
    PermissionGate.clearPermissionPropsCache();
    window.localStorage.clear();

    navigateMock = jest.fn() as jest.Mock<any, any>;
    getJestSpyOn(Navigation, "navigate").mockImplementation(
      (...args: Array<unknown>): void => {
        navigateMock(...args);
      },
    );
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("offers Create Monitor on an insight that can become one", async () => {
    await renderInsight(NEW_EXCEPTION);

    const button: HTMLButtonElement | null = createMonitorButton();

    expect(button).not.toBeNull();
    expect(button).toBeEnabled();
    // The other actions are all still there.
    for (const name of ["Confirm", "Dismiss", "Resolve"]) {
      expect(screen.getByRole("button", { name: name })).toBeEnabled();
    }
  });

  test("goes to Monitor Create carrying the insight's id", async () => {
    await renderInsight(NEW_EXCEPTION);

    await act(async () => {
      fireEvent.click(createMonitorButton()!);
    });

    expect(navigateMock).toHaveBeenCalledTimes(1);

    const destination: string = String(navigateMock.mock.calls[0]![0]);

    expect(destination).toContain("/monitors/create");
    expect(
      new URLSearchParams(destination.substring(destination.indexOf("?"))).get(
        "aiInsightId",
      ),
    ).toBe(INSIGHT_ID);
  });

  test("explains what the button does before it is pressed", async () => {
    await renderInsight(NEW_EXCEPTION);

    const tooltip: HTMLElement = await tooltipOf(createMonitorButton()!);

    expect(tooltip).toHaveTextContent("pre-filled from this insight");
    expect(tooltip).toHaveTextContent("opens an incident");
  });

  test("a latency regression keeps the button, disabled, and says why", async () => {
    await renderInsight(LATENCY);

    const button: HTMLButtonElement | null = createMonitorButton();

    expect(button).not.toBeNull();
    expect(button).toBeDisabled();
    // Looks disabled rather than swallowing the click.
    expect(button).toHaveClass("disabled:opacity-50");

    const tooltip: HTMLElement = await tooltipOf(button!);

    expect(tooltip).toHaveTextContent(AI_INSIGHT_MONITOR_LATENCY_BLOCKER);

    fireEvent.click(button!);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  test("a drift on a cumulative counter is refused once the metric's shape is read", async () => {
    metricShapeRows = [
      metricPoint({
        pointType: MetricPointType.Sum,
        isMonotonic: true,
        temporality: AggregationTemporality.Cumulative,
      }),
    ];

    await renderInsight(METRIC_DRIFT);

    await waitFor(() => {
      return expect(createMonitorButton()).toBeDisabled();
    });

    const tooltip: HTMLElement = await tooltipOf(createMonitorButton()!);

    expect(tooltip).toHaveTextContent(
      AI_INSIGHT_MONITOR_CUMULATIVE_COUNTER_BLOCKER,
    );

    // The shape is read from the drifting metric on the entity it drifted on.
    expect(analyticsListRequests).toHaveLength(1);

    const query: Record<string, unknown> = analyticsListRequests[0]![
      "query"
    ] as Record<string, unknown>;

    expect(query["name"]).toBe("system.disk.operations");
    expect(String(query["primaryEntityId"])).toBe(ENTITY_ID);
    expect(analyticsListRequests[0]!["limit"]).toBe(1);
  });

  test("a drift on a gauge stays available", async () => {
    metricShapeRows = [
      metricPoint({
        pointType: MetricPointType.Gauge,
        isMonotonic: false,
        temporality: AggregationTemporality.Cumulative,
      }),
    ];

    await renderInsight(METRIC_DRIFT);

    await waitFor(() => {
      return expect(analyticsListRequests).toHaveLength(1);
    });

    expect(createMonitorButton()).toBeEnabled();
  });

  test("an unreadable metric shape is not held against the metric", async () => {
    metricShapeRows = [];

    await renderInsight(METRIC_DRIFT);

    await waitFor(() => {
      return expect(analyticsListRequests).toHaveLength(1);
    });

    expect(createMonitorButton()).toBeEnabled();
  });

  test("only a metric drift reads a metric's shape", async () => {
    await renderInsight(NEW_EXCEPTION);

    expect(createMonitorButton()).toBeEnabled();
    expect(analyticsListRequests).toHaveLength(0);
  });

  test("somebody who may not create monitors is told so, and goes nowhere", async () => {
    permissionsForTest = [Permission.Viewer];

    await renderInsight(NEW_EXCEPTION);

    const button: HTMLButtonElement | null = createMonitorButton();

    expect(button).not.toBeNull();
    expect(button).toBeDisabled();

    const tooltip: HTMLElement = await tooltipOf(button!);

    expect(tooltip).toHaveTextContent(
      "You do not have permission to create this Monitor.",
    );

    fireEvent.click(button!);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  test("while the permission snapshot cannot say, the button is not offered", async () => {
    permissionsForTest = [];

    await renderInsight(NEW_EXCEPTION);

    expect(createMonitorButton()).toBeNull();
    // Nothing else on the page depends on it.
    expect(screen.getByRole("button", { name: "Confirm" })).toBeEnabled();
  });

  test("a master admin may create one whatever the snapshot says", async () => {
    isMasterAdminForTest = true;
    permissionsForTest = [];

    await renderInsight(NEW_EXCEPTION);

    expect(createMonitorButton()).toBeEnabled();
  });
});
