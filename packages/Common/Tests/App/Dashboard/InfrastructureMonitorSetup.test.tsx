import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import ObjectID from "../../../Types/ObjectID";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorStepHostMonitor, {
  MonitorStepHostMonitorUtil,
} from "../../../Types/Monitor/MonitorStepHostMonitor";
import { MonitorStepKubernetesMonitorUtil } from "../../../Types/Monitor/MonitorStepKubernetesMonitor";
import { MonitorStepVMwareMonitorUtil } from "../../../Types/Monitor/MonitorStepVMwareMonitor";
import MonitorStepStorageArrayMonitor, {
  MonitorStepStorageArrayMonitorUtil,
} from "../../../Types/Monitor/MonitorStepStorageArrayMonitor";
import { getStorageArrayAlertTemplateById } from "../../../Types/Monitor/StorageArrayAlertTemplates";
import StorageSystem from "../../../Types/StorageArray/StorageSystem";
import {
  getHostAlertTemplateById,
  getHostDefaultAlertTemplateId,
} from "../../../Types/Monitor/HostAlertTemplates";
import MetricsViewConfig from "../../../Types/Metrics/MetricsViewConfig";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The shape every infrastructure monitor's setup takes now: what to watch
 * (with whether it is sending data, and its install steps when nothing is),
 * what to alert on (starting on the type's default), and More fields.
 */

const getListMock: MockFunction = getJestMockFunction();
const navigateMock: MockFunction = getJestMockFunction();
// What the add dialog hands back once the resource connects.
let mockConnectedRecord: Record<string, unknown> = {
  clusterIdentifier: "prod-east",
};

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      navigate: (...args: Array<unknown>) => {
        return navigateMock(...args);
      },
      getQueryStringByName: (): undefined => {
        return undefined;
      },
      getFirstParam: (): undefined => {
        return undefined;
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricView",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return React.createElement("div", { "data-testid": "metric-view" });
      },
    };
  },
);

// The add dialogs: a button that says the resource connected.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/HostCollector/AddHostModal",
  () => {
    return {
      __esModule: true,
      default: (props: {
        onHostConnected: (host: { hostIdentifier: string }) => void;
      }): React.ReactElement => {
        return React.createElement(
          "button",
          {
            "data-testid": "add-host-modal-connected",
            onClick: () => {
              props.onHostConnected({ hostIdentifier: "web-02" });
            },
          },
          "connected",
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOnboarding/AddResourceModal",
  () => {
    return {
      __esModule: true,
      default: (props: {
        onConnected: (record: Record<string, unknown>) => void;
      }): React.ReactElement => {
        return React.createElement(
          "button",
          {
            "data-testid": "add-resource-modal-connected",
            onClick: () => {
              props.onConnected(mockConnectedRecord);
            },
          },
          "connected",
        );
      },
    };
  },
);

import HostMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/HostMonitor/HostMonitorStepForm";
import KubernetesMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/KubernetesMonitor/KubernetesMonitorStepForm";
import VMwareMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/VMwareMonitor/VMwareMonitorStepForm";
import StorageArrayMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/StorageArrayMonitor/StorageArrayMonitorStepForm";
import {
  InfrastructureWatchWay,
  ResourceDataState,
  findTemplateIdForMetricsView,
  getInitialWatchWay,
  getMetricsViewSignature,
  getResourceDataState,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/InfrastructureMonitorSetup/InfrastructureMonitorSetupText";

const MINUTE: number = 60 * 1000;

function listOf(records: Array<Record<string, unknown>>): void {
  getListMock.mockImplementation(() => {
    return Promise.resolve({
      data: records,
      count: records.length,
      skip: 0,
      limit: 0,
    });
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function lastOf<T>(mock: MockFunction): T {
  const calls: Array<Array<unknown>> = mock.mock.calls;
  return calls[calls.length - 1]![0] as T;
}

function hostTemplateView(
  templateId: string,
  hostIdentifier: string,
): MonitorStepHostMonitor {
  return getHostAlertTemplateById(templateId)!.getMonitorStep({
    hostIdentifier: hostIdentifier,
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "web-01",
  }).data!.hostMonitor!;
}

function storageArrayMetricName(config: MonitorStepStorageArrayMonitor): string {
  return config.metricViewConfig.queryConfigs[0]!.metricQueryData.filterData
    .metricName as string;
}

// Holds the step the way the monitor form does, so each change is drawn.
function StorageArrayHarness(props: {
  initial: MonitorStepStorageArrayMonitor;
  onChange: (config: MonitorStepStorageArrayMonitor) => void;
}): React.ReactElement {
  const [step, setStep] = React.useState<MonitorStepStorageArrayMonitor>(
    props.initial,
  );

  return (
    <StorageArrayMonitorStepForm
      monitorStepStorageArrayMonitor={step}
      onChange={(config: MonitorStepStorageArrayMonitor) => {
        setStep(config);
        props.onChange(config);
      }}
      onMonitorCriteriaChange={getJestMockFunction()}
    />
  );
}

async function addStorageArray(record: Record<string, unknown>): Promise<void> {
  mockConnectedRecord = { name: record["name"] };
  listOf([record]);
  fireEvent.click(screen.getByTestId("infrastructure-resource-add"));
  await settle();
  fireEvent.click(screen.getByTestId("add-resource-modal-connected"));
  await settle();
  await settle();
}

beforeEach(() => {
  getListMock.mockReset();
  navigateMock.mockReset();
  listOf([]);
  mockConnectedRecord = { clusterIdentifier: "prod-east" };
});

afterEach(() => {
  cleanup();
});

describe("what to watch: nothing sending yet", () => {
  test("says so, offers the type's Add button, and picks what connects", async () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <HostMonitorStepForm
        monitorStepHostMonitor={MonitorStepHostMonitorUtil.getDefault()}
        onChange={onChange}
        onMonitorCriteriaChange={getJestMockFunction()}
      />,
    );
    await settle();

    const empty: HTMLElement = screen.getByTestId(
      "infrastructure-resource-empty",
    );
    expect(
      within(empty).getByText("Nothing is sending data yet."),
    ).toBeInTheDocument();
    expect(
      within(empty).getByText(
        "The install steps come with your keys filled in, and wait for the first data.",
      ),
    ).toBeInTheDocument();

    // The host connects while the dialog waits; the list is read again.
    listOf([
      {
        name: "web-02",
        hostIdentifier: "web-02",
        lastSeenAt: new Date(),
      },
    ]);
    fireEvent.click(within(empty).getByTestId("infrastructure-resource-add"));
    await settle();
    fireEvent.click(screen.getByTestId("add-host-modal-connected"));
    await settle();
    await settle();

    const config: MonitorStepHostMonitor =
      lastOf<MonitorStepHostMonitor>(onChange);
    expect(config.hostIdentifier).toBe("web-02");
    // The default alert, applied before any host was picked, names it now.
    expect(config.metricViewConfig.queryConfigs.length).toBeGreaterThan(0);
  });

  test("a Kubernetes cluster is added through its own install steps", async () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <KubernetesMonitorStepForm
        monitorStepKubernetesMonitor={MonitorStepKubernetesMonitorUtil.getDefault()}
        onChange={onChange}
        onMonitorCriteriaChange={getJestMockFunction()}
      />,
    );
    await settle();

    expect(screen.getByTestId("infrastructure-resource-add")).toHaveTextContent(
      "Add Kubernetes Cluster",
    );

    listOf([{ name: "prod-east", clusterIdentifier: "prod-east" }]);
    fireEvent.click(screen.getByTestId("infrastructure-resource-add"));
    await settle();
    fireEvent.click(screen.getByTestId("add-resource-modal-connected"));
    await settle();
    await settle();

    expect(
      lastOf<{ clusterIdentifier: string }>(onChange).clusterIdentifier,
    ).toBe("prod-east");
  });

  test("a vCenter is added on its own page", async () => {
    render(
      <VMwareMonitorStepForm
        monitorStepVMwareMonitor={MonitorStepVMwareMonitorUtil.getDefault()}
        onChange={getJestMockFunction()}
        onMonitorCriteriaChange={getJestMockFunction()}
      />,
    );
    await settle();

    fireEvent.click(screen.getByTestId("infrastructure-resource-add"));
    expect(navigateMock).toHaveBeenCalledTimes(1);
  });
});

describe("a storage array's default alert follows the array's platform", () => {
  test("before any array is picked every platform stays on offer; a FlashBlade added then gets FlashBlade's alert", async () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <StorageArrayHarness
        initial={MonitorStepStorageArrayMonitorUtil.getDefault()}
        onChange={onChange}
      />,
    );
    await settle();

    /*
     * The default is FlashArray's, as no platform is known, but it leaves the
     * platform open: FlashBlade's templates stay on offer.
     */
    let config: MonitorStepStorageArrayMonitor =
      lastOf<MonitorStepStorageArrayMonitor>(onChange);
    expect(config.storageSystem).toBeUndefined();
    expect(storageArrayMetricName(config)).toBe("purefa_info");
    expect(screen.getByTestId("alert-template-picked-name")).toHaveTextContent(
      "Array Stopped Reporting (FlashArray)",
    );

    // purefa_info never comes from a FlashBlade: it would never stop firing.
    await addStorageArray({
      name: "fb-01",
      storageSystem: StorageSystem.PureStorageFlashBlade,
      lastSeenAt: new Date(),
    });

    config = lastOf<MonitorStepStorageArrayMonitor>(onChange);
    expect(config.arrayIdentifier).toBe("fb-01");
    expect(config.storageSystem).toBe(StorageSystem.PureStorageFlashBlade);
    expect(storageArrayMetricName(config)).toBe("purefb_info");
    expect(screen.getByTestId("alert-template-picked-name")).toHaveTextContent(
      /^Array Stopped Reporting$/,
    );
  });

  test("a template of one platform gives way to the other platform's default when its array is picked", async () => {
    const onChange: MockFunction = getJestMockFunction();

    listOf([
      {
        name: "fa-01",
        storageSystem: StorageSystem.PureStorageFlashArray,
        lastSeenAt: new Date(),
      },
    ]);

    const savedOnFlashArray: MonitorStepStorageArrayMonitor =
      getStorageArrayAlertTemplateById("purefa-critical-alerts")!.getMonitorStep(
        {
          arrayIdentifier: "fa-01",
          onlineMonitorStatusId: ObjectID.generate(),
          offlineMonitorStatusId: ObjectID.generate(),
          defaultIncidentSeverityId: ObjectID.generate(),
          defaultAlertSeverityId: ObjectID.generate(),
          monitorName: "fa-01",
        },
      ).data!.storageArrayMonitor!;

    render(
      <StorageArrayHarness initial={savedOnFlashArray} onChange={onChange} />,
    );
    await settle();

    // A saved step is not rebuilt.
    expect(onChange).not.toHaveBeenCalled();

    await addStorageArray({
      name: "fb-01",
      storageSystem: StorageSystem.PureStorageFlashBlade,
      lastSeenAt: new Date(),
    });

    const config: MonitorStepStorageArrayMonitor =
      lastOf<MonitorStepStorageArrayMonitor>(onChange);
    expect(config.arrayIdentifier).toBe("fb-01");
    expect(config.storageSystem).toBe(StorageSystem.PureStorageFlashBlade);
    expect(storageArrayMetricName(config)).toBe("purefb_info");
  });
});

describe("what to watch: whether it is sending data", () => {
  test.each([
    [2 * MINUTE, ResourceDataState.Receiving, /^Receiving data\. Last data /],
    [
      3 * 60 * MINUTE,
      ResourceDataState.Quiet,
      /Check that its agent is running\.$/,
    ],
  ])(
    "a host last heard from %p ms ago reads %p",
    async (age: number, state: ResourceDataState, words: RegExp) => {
      listOf([
        {
          name: "web-01",
          hostIdentifier: "web-01",
          lastSeenAt: new Date(Date.now() - age),
        },
      ]);

      render(
        <HostMonitorStepForm
          monitorStepHostMonitor={{
            ...hostTemplateView(getHostDefaultAlertTemplateId(), "web-01"),
          }}
          onChange={getJestMockFunction()}
          onMonitorCriteriaChange={getJestMockFunction()}
        />,
      );
      await settle();

      const line: HTMLElement = screen.getByTestId(
        "infrastructure-resource-data-state",
      );
      expect(line).toHaveAttribute("data-state", state);
      expect(line.textContent || "").toMatch(words);
    },
  );
});

describe("a saved monitor opens the way it was made", () => {
  test("one made from a template shows that template picked, More fields folded, and nothing rebuilt", async () => {
    listOf([{ name: "web-01", hostIdentifier: "web-01" }]);
    const onCriteria: MockFunction = getJestMockFunction();

    render(
      <HostMonitorStepForm
        monitorStepHostMonitor={hostTemplateView("host-high-memory", "web-01")}
        onChange={getJestMockFunction()}
        onMonitorCriteriaChange={onCriteria}
      />,
    );
    await settle();

    expect(screen.getByTestId("alert-template-picked")).toHaveAttribute(
      "data-alert-template-id",
      "host-high-memory",
    );
    expect(onCriteria).not.toHaveBeenCalled();
    expect(
      within(screen.getByTestId("infrastructure-monitor-setup"))
        .getByTestId("folded-section-header")
        .getAttribute("aria-expanded"),
    ).toBe("false");
  });

  test("one that reads a query of its own opens More fields on the query builder", async () => {
    listOf([{ name: "web-01", hostIdentifier: "web-01" }]);
    const config: MonitorStepHostMonitor = hostTemplateView(
      "host-high-memory",
      "web-01",
    );
    config.metricViewConfig.queryConfigs[0]!.metricQueryData.filterData.metricName =
      "custom.metric";

    render(
      <HostMonitorStepForm
        monitorStepHostMonitor={config}
        onChange={getJestMockFunction()}
        onMonitorCriteriaChange={getJestMockFunction()}
      />,
    );
    await settle();

    expect(screen.queryByTestId("alert-template-picked")).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId("infrastructure-monitor-setup"))
        .getByTestId("folded-section-header")
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(screen.getByRole("tab", { name: "Advanced" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});

describe("the setup's rules", () => {
  test("data heard from in the last ten minutes is receiving; older is quiet; none is unknown", () => {
    const now: Date = new Date(Date.UTC(2026, 9, 30, 12, 0, 0));

    expect(
      getResourceDataState({
        lastSeenAt: new Date(now.getTime() - 10 * MINUTE),
        now: now,
      }),
    ).toBe(ResourceDataState.Receiving);
    expect(
      getResourceDataState({
        lastSeenAt: new Date(now.getTime() - 11 * MINUTE),
        now: now,
      }),
    ).toBe(ResourceDataState.Quiet);
    expect(getResourceDataState({ lastSeenAt: undefined, now: now })).toBe(
      ResourceDataState.Unknown,
    );
    expect(getResourceDataState({ lastSeenAt: "not a date", now: now })).toBe(
      ResourceDataState.Unknown,
    );
  });

  test("a new step starts on the alert templates; a saved query of its own on the query builder", () => {
    expect(getInitialWatchWay({ queryCount: 0, isTemplatePicked: false })).toBe(
      InfrastructureWatchWay.AlertTemplate,
    );
    expect(getInitialWatchWay({ queryCount: 2, isTemplatePicked: true })).toBe(
      InfrastructureWatchWay.AlertTemplate,
    );
    expect(getInitialWatchWay({ queryCount: 1, isTemplatePicked: false })).toBe(
      InfrastructureWatchWay.QueryBuilder,
    );
  });

  test("a metric view reads the same whatever order its queries are in, and differs by metric, filter or aggregation", () => {
    const view: MetricsViewConfig = MonitorStep.getMetricsViewConfig(
      getHostAlertTemplateById("host-high-cpu")!.getMonitorStep({
        hostIdentifier: "web-01",
        onlineMonitorStatusId: ObjectID.generate(),
        offlineMonitorStatusId: ObjectID.generate(),
        defaultIncidentSeverityId: ObjectID.generate(),
        defaultAlertSeverityId: ObjectID.generate(),
        monitorName: "web-01",
      }),
    )!;
    const reversed: MetricsViewConfig = {
      queryConfigs: [...view.queryConfigs].reverse(),
      formulaConfigs: [...view.formulaConfigs].reverse(),
    };

    expect(getMetricsViewSignature(reversed)).toBe(
      getMetricsViewSignature(view),
    );

    const otherAggregation: MetricsViewConfig = JSON.parse(
      JSON.stringify(view),
    ) as MetricsViewConfig;
    otherAggregation.queryConfigs[0]!.metricQueryData.filterData.aggegationType =
      MetricsAggregationType.Max;
    expect(getMetricsViewSignature(otherAggregation)).not.toBe(
      getMetricsViewSignature(view),
    );

    expect(
      findTemplateIdForMetricsView({
        templates: [{ id: "a" }, { id: "b" }],
        getMetricsViewConfig: (template: { id: string }) => {
          return template.id === "b" ? view : undefined;
        },
        current: reversed,
      }),
    ).toBe("b");
    expect(
      findTemplateIdForMetricsView({
        templates: [{ id: "a" }],
        getMetricsViewConfig: () => {
          return view;
        },
        current: { queryConfigs: [], formulaConfigs: [] },
      }),
    ).toBeUndefined();
  });
});
