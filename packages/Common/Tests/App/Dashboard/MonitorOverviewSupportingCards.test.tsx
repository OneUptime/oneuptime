/** @timezone UTC */

import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import Permission from "../../../Types/Permission";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The monitor overview's supporting pieces that the card-level suites do not
 * reach: which telemetry preview a monitor gets, the activity card's
 * permission gate, the side-column details card, the security-events
 * preview's overview wording and the heartbeat link's copy button. Each
 * child that talks to the API is stubbed to record what it was handed.
 */

let mockPermissions: Array<Permission> = [Permission.ProjectOwner];
const mockRendered: Array<{ name: string; props: Record<string, unknown> }> =
  [];
const mockCount: MockFunction = getJestMockFunction();

const mockStub: (name: string) => {
  __esModule: boolean;
  default: (props: Record<string, unknown>) => ReactElement;
} = (
  name: string,
): {
  __esModule: boolean;
  default: (props: Record<string, unknown>) => ReactElement;
} => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      mockRendered.push({ name: name, props: props });
      const ReactModule: typeof React = jest.requireActual(
        "react",
      ) as typeof React;
      return ReactModule.createElement("div", { "data-testid": name }, name);
    },
  };
};

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return mockPermissions;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  return { ...actual, __esModule: true, HOST: "oneuptime.example.com" };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: (...args: Array<unknown>): Promise<number> => {
        return mockCount(...args) as Promise<number>;
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/LogMonitor/LogMonitorPreview",
  () => {
    return mockStub("log-preview");
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MetricMonitor/MetricMonitorPreview",
  () => {
    return mockStub("metric-preview");
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TraceTable",
  () => {
    return mockStub("trace-table");
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorFeed",
  () => {
    return mockStub("monitor-feed");
  },
);

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return mockStub("card-model-detail");
});

import MonitorActivityCard from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorActivityCard";
import MonitorOverviewDetailsCard, {
  getMonitorTypeTitle,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorOverviewDetailsCard";
import MonitorTelemetryPreview, {
  getTelemetryPreviewDescription,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorTelemetryPreview";
import IncomingMonitorLink, {
  getHeartbeatUrl,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/IncomingRequestMonitor/IncomingMonitorLink";
import SecurityEventsMonitorPreview from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SecurityEventsMonitor/SecurityEventsMonitorPreview";
import MonitorFeed from "../../../Models/DatabaseModels/MonitorFeed";
import { JSONObject } from "../../../Types/JSON";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorStepSecurityEventsMonitor, {
  MonitorStepSecurityEventsMonitorUtil,
} from "../../../Types/Monitor/MonitorStepSecurityEventsMonitor";
import MonitorType, {
  MonitorTypeHelper,
} from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { DetailStyle } from "../../../UI/Components/Detail/Detail";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";

const MONITOR_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const stepsOf: (...stepData: Array<JSONObject>) => MonitorSteps = (
  ...stepData: Array<JSONObject>
): MonitorSteps => {
  return {
    data: {
      monitorStepsInstanceArray: stepData.map(
        (data: JSONObject, index: number) => {
          return { data: { id: `step-${index}`, ...data } };
        },
      ),
    },
  } as unknown as MonitorSteps;
};

const LOG_STEP: JSONObject = { logMonitor: { body: "OutOfMemory" } };
const METRIC_STEP: JSONObject = { metricMonitor: { metricViewConfig: {} } };
const TRACE_STEP: JSONObject = {
  traceMonitor: {
    attributes: {},
    spanName: "checkout",
    spanStatuses: [],
    telemetryServiceIds: [],
    lastXSecondsOfSpans: 60,
  },
};
const renderedNames: () => Array<string> = (): Array<string> => {
  return mockRendered.map((entry: { name: string }) => {
    return entry.name;
  });
};

const lastProps: (name: string) => Record<string, unknown> = (
  name: string,
): Record<string, unknown> => {
  const entries: Array<{ name: string; props: Record<string, unknown> }> =
    mockRendered.filter((entry: { name: string }) => {
      return entry.name === name;
    });
  const entry: { props: Record<string, unknown> } | undefined =
    entries[entries.length - 1];

  if (!entry) {
    throw new Error(`${name} was never rendered`);
  }

  return entry.props;
};

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

beforeEach(() => {
  mockPermissions = [Permission.ProjectOwner];
  mockRendered.length = 0;
  mockCount.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("MonitorTelemetryPreview", () => {
  test("logs get a 'Logs preview' card around the log preview of step 0", () => {
    render(
      <MonitorTelemetryPreview
        monitorType={MonitorType.Logs}
        monitorSteps={stepsOf(LOG_STEP)}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Logs preview" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("card-description")).toHaveTextContent(
      "Preview of what this monitor's filter matches.",
    );
    expect(lastProps("log-preview")["monitorStepLogMonitor"]).toEqual(
      LOG_STEP["logMonitor"],
    );
  });

  test("with several steps it says only the first is previewed", () => {
    render(
      <MonitorTelemetryPreview
        monitorType={MonitorType.Logs}
        monitorSteps={stepsOf(LOG_STEP, { logMonitor: { body: "other" } })}
      />,
    );

    expect(screen.getByTestId("card-description")).toHaveTextContent(
      "Previewing the first of 2 criteria steps.",
    );
    expect(lastProps("log-preview")["monitorStepLogMonitor"]).toEqual(
      LOG_STEP["logMonitor"],
    );
    expect(getTelemetryPreviewDescription(1)).toBe(
      "Preview of what this monitor's filter matches.",
    );
  });

  test("metrics use the metric preview, which is its own card", () => {
    render(
      <MonitorTelemetryPreview
        monitorType={MonitorType.Metrics}
        monitorSteps={stepsOf(METRIC_STEP)}
      />,
    );

    expect(renderedNames()).toEqual(["metric-preview"]);
    expect(screen.queryByTestId("card")).toBeNull();
  });

  test("traces get the trace preview card, with the multi-step note only when there are more steps", () => {
    render(
      <MonitorTelemetryPreview
        monitorType={MonitorType.Traces}
        monitorSteps={stepsOf(TRACE_STEP)}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Traces preview" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("card-description")).toHaveTextContent(
      "The newest spans that match this monitor's filter.",
    );
    expect(lastProps("trace-table")["disableUrlState"]).toBe(true);
    cleanup();

    render(
      <MonitorTelemetryPreview
        monitorType={MonitorType.Traces}
        monitorSteps={stepsOf(TRACE_STEP, TRACE_STEP, TRACE_STEP)}
      />,
    );
    expect(screen.getByTestId("card-description")).toHaveTextContent(
      "Previewing the first of 3 criteria steps.",
    );
  });

  test("security events get their preview in overview wording", async () => {
    render(
      <MonitorTelemetryPreview
        monitorType={MonitorType.SecurityEvents}
        monitorSteps={stepsOf({})}
      />,
    );
    await flush();

    expect(
      screen.getByRole("heading", { name: "Security events preview" }),
    ).toBeInTheDocument();
    // Step 0 has no security events filter.
    expect(
      screen.getByText("This monitor has no filters yet."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/filters above/)).toBeNull();
  });

  test("no steps, or a type with no preview, renders nothing", () => {
    const empty: { container: HTMLElement } = render(
      <MonitorTelemetryPreview
        monitorType={MonitorType.Logs}
        monitorSteps={stepsOf()}
      />,
    );
    expect(empty.container.innerHTML).toBe("");
    cleanup();

    const other: { container: HTMLElement } = render(
      <MonitorTelemetryPreview
        monitorType={MonitorType.Kubernetes}
        monitorSteps={stepsOf(LOG_STEP)}
      />,
    );
    expect(other.container.innerHTML).toBe("");
    expect(mockRendered).toHaveLength(0);
  });
});

describe("SecurityEventsMonitorPreview wording", () => {
  const monitorStep: MonitorStepSecurityEventsMonitor = {
    ...MonitorStepSecurityEventsMonitorUtil.getDefault(),
    lastXSecondsOfEvents: 3600,
  };

  test("in the criteria form it still points at the filters above", async () => {
    render(
      <SecurityEventsMonitorPreview
        monitorStepSecurityEventsMonitor={undefined}
      />,
    );
    await flush();

    expect(
      screen.getByText(
        "Configure the filters above to preview matching security events.",
      ),
    ).toBeInTheDocument();
    cleanup();

    mockCount.mockResolvedValue(3 as never);
    render(
      <SecurityEventsMonitorPreview
        monitorStepSecurityEventsMonitor={monitorStep}
      />,
    );
    await flush();

    expect(screen.getByText(/security events match/)).toHaveTextContent(
      "security events match the filters above",
    );
  });

  test("on the overview it names the monitor's own filters", async () => {
    mockCount.mockResolvedValue(1 as never);

    render(
      <SecurityEventsMonitorPreview
        context="overview"
        monitorStepSecurityEventsMonitor={monitorStep}
      />,
    );
    await flush();

    const sentence: HTMLElement = screen.getByText(/security event matches/);
    expect(sentence).toHaveTextContent(
      "security event matches this monitor's filters",
    );
    expect(sentence).not.toHaveTextContent("filters above");
  });
});

describe("MonitorActivityCard", () => {
  test("a user who can read the feed gets it, as 'Recent activity'", () => {
    render(<MonitorActivityCard monitorId={MONITOR_ID} refreshToken={7} />);

    const props: Record<string, unknown> = lastProps("monitor-feed");
    expect(String(props["monitorId"])).toBe(MONITOR_ID.toString());
    expect(props["title"]).toBe("Recent activity");
    expect(props["description"]).toBe(
      "Everything that has happened to this monitor, newest first.",
    );
    expect(props["refreshToken"]).toBe(7);
  });

  test("a definite denial says the activity is hidden and sends no request", () => {
    mockPermissions = [Permission.ReadProjectMonitor];

    const gate: PermissionGateResult = PermissionGate.check(
      new MonitorFeed(),
      ModelAction.Read,
    );
    expect(gate.isAllowed).toBe(false);
    expect(gate.disabledReason).toBeTruthy();

    render(<MonitorActivityCard monitorId={MONITOR_ID} refreshToken={0} />);

    expect(
      screen.getByRole("heading", { name: "Recent activity" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("monitor-activity-hidden")).toHaveTextContent(
      "Activity is hidden",
    );
    expect(screen.getByTestId("monitor-activity-hidden")).toHaveTextContent(
      "You need permission to read this monitor's feed.",
    );
    expect(mockRendered).toHaveLength(0);
  });

  test("an empty permission snapshot still tries the feed", () => {
    mockPermissions = [];

    render(<MonitorActivityCard monitorId={MONITOR_ID} refreshToken={0} />);

    expect(screen.getByTestId("monitor-feed")).toBeInTheDocument();
  });
});

describe("MonitorOverviewDetailsCard", () => {
  test("a compact, one-column, stacked card with the monitor's own record", () => {
    const onSaveSuccess: MockFunction = getJestMockFunction();

    render(
      <MonitorOverviewDetailsCard
        monitorId={MONITOR_ID}
        refresher={true}
        onSaveSuccess={onSaveSuccess}
      />,
    );

    const props: Record<string, unknown> = lastProps("card-model-detail");
    expect(props["name"]).toBe("Monitor Details");
    expect(props["editButtonText"]).toBe("Edit");
    expect(props["isEditable"]).toBe(true);
    expect(props["refresher"]).toBe(true);
    expect(props["cardProps"]).toEqual({
      title: "Details",
      description: "Name, description and labels.",
      headerLayout: "stacked",
    });

    const detail: {
      modelId: ObjectID;
      style: DetailStyle;
      showDetailsInNumberOfColumns: number;
      fields: Array<{ title: string; placeholder?: string }>;
    } = props["modelDetailProps"] as {
      modelId: ObjectID;
      style: DetailStyle;
      showDetailsInNumberOfColumns: number;
      fields: Array<{ title: string; placeholder?: string }>;
    };
    expect(detail.modelId).toBe(MONITOR_ID);
    expect(detail.style).toBe(DetailStyle.Compact);
    expect(detail.showDetailsInNumberOfColumns).toBe(1);
    expect(
      detail.fields.map((field: { title: string }) => {
        return field.title;
      }),
    ).toEqual([
      "Name",
      "Description",
      "Labels",
      "Monitor Type",
      "Created",
      "Monitor ID",
    ]);
    expect(detail.fields[1]!.placeholder).toBe("No description");

    // The edit form is the one the overview always had.
    const formFields: Array<{ title: string }> = props["formFields"] as Array<{
      title: string;
    }>;
    expect(
      formFields.map((field: { title: string }) => {
        return field.title.trim();
      }),
    ).toEqual(["Name", "Description", "Labels"]);

    (props["onSaveSuccess"] as () => void)();
    expect(onSaveSuccess).toHaveBeenCalledTimes(1);
  });

  test("the type reads as the title the type picker uses, for every type", () => {
    for (const monitorType of Object.values(MonitorType)) {
      expect(getMonitorTypeTitle(monitorType)).toBe(
        MonitorTypeHelper.getTitle(monitorType),
      );
    }

    expect(getMonitorTypeTitle(undefined)).toBe("Unknown");
  });
});

describe("IncomingMonitorLink", () => {
  test("the heartbeat URL can be copied from the documentation card", () => {
    const secret: ObjectID = new ObjectID(
      "5ec2e7a1-9b3c-4d2e-8f10-7a6b5c4d3e2f",
    );

    render(
      <MemoryRouter>
        <IncomingMonitorLink secretKey={secret} />
      </MemoryRouter>,
    );

    const url: string = getHeartbeatUrl(secret).toString();
    expect(url).toContain("oneuptime.example.com/heartbeat/");
    expect(screen.getByText(url)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copy/ })).toBeInTheDocument();
  });
});
