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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4105 in the monitor create/edit forms and the Criteria page.
 *
 * Every metric-backed monitor step (Metric, Host, Kubernetes, Docker,
 * Docker Swarm, Podman, Proxmox, VMware, Ceph, IoT) previews its queries
 * over the monitor's rolling window: the window the monitor evaluates,
 * picked with the form's "Time Range" field and saved with the monitor.
 * These charts used to refuse a drag altogether. They now zoom the preview
 * only:
 *
 * - a drag re-queries the preview over the dragged window and NEVER calls
 *   the form's onChange (a zoom must not dirty or change the monitor);
 * - a double-click, or the preview's Reset zoom, brings the rolling window
 *   back;
 * - picking another rolling window in the form ends the zoom.
 *
 * The Criteria page previews each step the same way, each on its own.
 *
 * The forms and MetricView are real; MetricCharts is stood in for with
 * buttons that call exactly the handlers MetricView hands the charts.
 */

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const fetchResultsMock: MockFunction = getJestMockFunction();

interface MockChartsProps {
  metricViewData: {
    queryConfigs: Array<{
      metricQueryData: { filterData: { metricName?: unknown } };
    }>;
  };
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  onTimeRangeReset?: (() => void) | undefined;
}

const mockChartsByMetric: Record<string, MockChartsProps> = {};

const MOCK_DRAG: { start: Date; end: Date } = {
  start: new Date("2026-09-28T11:20:00.000Z"),
  end: new Date("2026-09-28T11:30:00.000Z"),
};

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts",
  () => {
    return {
      __esModule: true,
      default: (props: MockChartsProps): React.ReactElement => {
        const metricName: string = String(
          props.metricViewData.queryConfigs[0]?.metricQueryData.filterData
            .metricName || "",
        );
        mockChartsByMetric[metricName] = props;

        return (
          <div data-testid={`charts-${metricName}`}>
            <button
              type="button"
              onClick={() => {
                props.onTimeRangeSelect?.(MOCK_DRAG.start, MOCK_DRAG.end);
              }}
            >
              {`Drag across ${metricName}`}
            </button>
            <button
              type="button"
              onClick={() => {
                props.onTimeRangeReset?.();
              }}
            >
              {`Double-click ${metricName}`}
            </button>
          </div>
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        fetchResults: (...args: Array<unknown>) => {
          return fetchResultsMock(...args);
        },
        loadAllMetricsTypes: () => {
          return Promise.resolve({ metricTypes: [], telemetryServices: [] });
        },
        getMetricTypes: () => {
          return Promise.resolve([]);
        },
        clearQueryTopNOverridesForScope: () => {
          return undefined;
        },
      },
    };
  },
);

// The forms' dropdowns (hosts, clusters, rolling time) as plain selects.
jest.mock("../../../UI/Components/Dropdown/Dropdown", () => {
  return {
    __esModule: true,
    default: (props: {
      options: Array<{ label: string; value: unknown }>;
      value?: { value: unknown } | undefined;
      onChange?: ((value: unknown) => void) | undefined;
    }) => {
      return (
        <select
          value={String(props.value?.value ?? "")}
          onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
            props.onChange?.(event.target.value);
          }}
        >
          <option value="">Select</option>
          {(props.options || []).map(
            (option: { label: string; value: unknown }) => {
              return (
                <option key={String(option.value)} value={String(option.value)}>
                  {option.label}
                </option>
              );
            },
          )}
        </select>
      );
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return new ObjectID("99999999-9999-4999-8999-999999999999");
      },
    },
  };
});

import MetricMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MetricMonitor/MetricMonitorStepForm";
import HostMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/HostMonitor/HostMonitorStepForm";
import KubernetesMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/KubernetesMonitor/KubernetesMonitorStepForm";
import DockerMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/DockerMonitor/DockerMonitorStepForm";
import DockerSwarmMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/DockerSwarmMonitor/DockerSwarmMonitorStepForm";
import PodmanMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/PodmanMonitor/PodmanMonitorStepForm";
import ProxmoxMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/ProxmoxMonitor/ProxmoxMonitorStepForm";
import VMwareMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/VMwareMonitor/VMwareMonitorStepForm";
import CephMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/CephMonitor/CephMonitorStepForm";
import IoTMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/IoTMonitor/IoTMonitorStepForm";
import MonitorStepElement from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorSteps/MonitorStep";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MetricsViewConfig from "../../../Types/Metrics/MetricsViewConfig";
import MonitorCriteria from "../../../Types/Monitor/MonitorCriteria";
import MonitorStep, {
  MonitorStepType,
} from "../../../Types/Monitor/MonitorStep";
import MonitorStepMetricMonitor, {
  MonitorStepMetricMonitorUtil,
} from "../../../Types/Monitor/MonitorStepMetricMonitor";
import MonitorStepHostMonitor, {
  MonitorStepHostMonitorUtil,
} from "../../../Types/Monitor/MonitorStepHostMonitor";
import MonitorStepKubernetesMonitor, {
  MonitorStepKubernetesMonitorUtil,
} from "../../../Types/Monitor/MonitorStepKubernetesMonitor";
import MonitorStepDockerMonitor, {
  MonitorStepDockerMonitorUtil,
} from "../../../Types/Monitor/MonitorStepDockerMonitor";
import MonitorStepDockerSwarmMonitor, {
  MonitorStepDockerSwarmMonitorUtil,
} from "../../../Types/Monitor/MonitorStepDockerSwarmMonitor";
import MonitorStepPodmanMonitor, {
  MonitorStepPodmanMonitorUtil,
} from "../../../Types/Monitor/MonitorStepPodmanMonitor";
import MonitorStepProxmoxMonitor, {
  MonitorStepProxmoxMonitorUtil,
} from "../../../Types/Monitor/MonitorStepProxmoxMonitor";
import MonitorStepVMwareMonitor, {
  MonitorStepVMwareMonitorUtil,
} from "../../../Types/Monitor/MonitorStepVMwareMonitor";
import MonitorStepCephMonitor, {
  MonitorStepCephMonitorUtil,
} from "../../../Types/Monitor/MonitorStepCephMonitor";
import MonitorStepIoTMonitor, {
  MonitorStepIoTMonitorUtil,
} from "../../../Types/Monitor/MonitorStepIoTMonitor";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import RollingTime from "../../../Types/RollingTime/RollingTime";

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");
const HOUR_AGO: Date = new Date("2026-09-28T11:00:00.000Z");
const SIX_HOURS_AGO: Date = new Date("2026-09-28T06:00:00.000Z");

type Window = [number, number];

function windowOf(start: Date, end: Date): Window {
  return [start.getTime(), end.getTime()];
}

function viewConfigFor(metricName: string): MetricsViewConfig {
  return {
    queryConfigs: [
      {
        metricAliasData: {
          metricVariable: "a",
          title: metricName,
          description: "",
          legend: "",
          legendUnit: "",
        },
        metricQueryData: {
          filterData: {
            metricName: metricName,
            aggegationType: MetricsAggregationType.Avg,
          },
        },
      },
    ],
    formulaConfigs: [],
  };
}

function fetchedWindowsFor(metricName: string): Array<Window> {
  const windows: Array<Window> = [];
  for (const call of fetchResultsMock.mock.calls) {
    const data: MetricViewData = (call[0] as { metricViewData: MetricViewData })
      .metricViewData;
    const queried: boolean = data.queryConfigs.some(
      (queryConfig: MetricViewData["queryConfigs"][number]): boolean => {
        return (
          String(queryConfig.metricQueryData.filterData.metricName) ===
          metricName
        );
      },
    );
    if (queried && data.startAndEndDate) {
      windows.push([
        data.startAndEndDate.startValue.getTime(),
        data.startAndEndDate.endValue.getTime(),
      ]);
    }
  }
  return windows;
}

function lastFetchedWindowFor(metricName: string): Window | undefined {
  const windows: Array<Window> = fetchedWindowsFor(metricName);
  return windows[windows.length - 1];
}

function chartsOf(metricName: string): MockChartsProps {
  const charts: MockChartsProps | undefined = mockChartsByMetric[metricName];
  if (!charts) {
    throw new Error(`No charts rendered for ${metricName}`);
  }
  return charts;
}

/*
 * Waits for the control to be on screen first: a chart sits behind
 * MetricView's loader until its latest fetch lands.
 */
async function click(label: string): Promise<void> {
  const control: HTMLElement = await screen.findByRole("button", {
    name: label,
  });
  // findByRole ticks the fake clock; a relative range resolves from NOW.
  jest.setSystemTime(NOW);
  fireEvent.click(control);
}

/*
 * MetricView draws its charts once before it loads, then shows a loader
 * until its first fetch lands. Wait for that fetch and the charts after it,
 * so a gesture never lands on a chart about to be swapped for the loader.
 */
async function previewSettled(metricName: string): Promise<void> {
  await waitFor(() => {
    expect(fetchedWindowsFor(metricName).length).toBeGreaterThan(0);
    expect(screen.getByTestId(`charts-${metricName}`)).toBeInTheDocument();
  });
  // waitFor ticks the fake clock; "now" is where the assertions read it.
  jest.setSystemTime(NOW);
}

// A step as the forms hold it: this metric, over the past hour.
type FormStep = {
  metricViewConfig: MetricsViewConfig;
  rollingTime: RollingTime;
};

type RenderFormFunction = (
  step: FormStep,
  onChange: (step: FormStep) => void,
) => React.ReactElement;

interface FormCase {
  name: string;
  metricName: string;
  // Every infrastructure form keeps its query builder on the Advanced tab.
  opensOnAdvancedTab: boolean;
  initial: FormStep;
  renderForm: RenderFormFunction;
}

// A form type's default step, charting this metric over the past hour.
function stepFor(defaults: FormStep, metricName: string): FormStep {
  return {
    ...defaults,
    metricViewConfig: viewConfigFor(metricName),
    rollingTime: RollingTime.Past1Hour,
  };
}

const FORM_CASES: Array<FormCase> = [
  {
    name: "Metric",
    metricName: "form.metric.cpu",
    opensOnAdvancedTab: false,
    initial: stepFor(
      MonitorStepMetricMonitorUtil.getDefault(),
      "form.metric.cpu",
    ),
    renderForm: (step: FormStep, onChange: (step: FormStep) => void) => {
      return (
        <MetricMonitorStepForm
          monitorStepMetricMonitor={step as MonitorStepMetricMonitor}
          onChange={onChange as (step: MonitorStepMetricMonitor) => void}
        />
      );
    },
  },
  {
    name: "Host",
    metricName: "form.host.cpu",
    opensOnAdvancedTab: true,
    initial: stepFor(MonitorStepHostMonitorUtil.getDefault(), "form.host.cpu"),
    renderForm: (step: FormStep, onChange: (step: FormStep) => void) => {
      return (
        <HostMonitorStepForm
          monitorStepHostMonitor={step as MonitorStepHostMonitor}
          onChange={onChange as (step: MonitorStepHostMonitor) => void}
        />
      );
    },
  },
  {
    name: "Kubernetes",
    metricName: "form.k8s.cpu",
    opensOnAdvancedTab: true,
    initial: stepFor(
      MonitorStepKubernetesMonitorUtil.getDefault(),
      "form.k8s.cpu",
    ),
    renderForm: (step: FormStep, onChange: (step: FormStep) => void) => {
      return (
        <KubernetesMonitorStepForm
          monitorStepKubernetesMonitor={step as MonitorStepKubernetesMonitor}
          onChange={onChange as (step: MonitorStepKubernetesMonitor) => void}
        />
      );
    },
  },
  {
    name: "Docker",
    metricName: "form.docker.cpu",
    opensOnAdvancedTab: true,
    initial: stepFor(
      MonitorStepDockerMonitorUtil.getDefault(),
      "form.docker.cpu",
    ),
    renderForm: (step: FormStep, onChange: (step: FormStep) => void) => {
      return (
        <DockerMonitorStepForm
          monitorStepDockerMonitor={step as MonitorStepDockerMonitor}
          onChange={onChange as (step: MonitorStepDockerMonitor) => void}
        />
      );
    },
  },
  {
    name: "Docker Swarm",
    metricName: "form.swarm.cpu",
    opensOnAdvancedTab: true,
    initial: stepFor(
      MonitorStepDockerSwarmMonitorUtil.getDefault(),
      "form.swarm.cpu",
    ),
    renderForm: (step: FormStep, onChange: (step: FormStep) => void) => {
      return (
        <DockerSwarmMonitorStepForm
          monitorStepDockerSwarmMonitor={step as MonitorStepDockerSwarmMonitor}
          onChange={onChange as (step: MonitorStepDockerSwarmMonitor) => void}
        />
      );
    },
  },
  {
    name: "Podman",
    metricName: "form.podman.cpu",
    opensOnAdvancedTab: true,
    initial: stepFor(
      MonitorStepPodmanMonitorUtil.getDefault(),
      "form.podman.cpu",
    ),
    renderForm: (step: FormStep, onChange: (step: FormStep) => void) => {
      return (
        <PodmanMonitorStepForm
          monitorStepPodmanMonitor={step as MonitorStepPodmanMonitor}
          onChange={onChange as (step: MonitorStepPodmanMonitor) => void}
        />
      );
    },
  },
  {
    name: "Proxmox",
    metricName: "form.proxmox.cpu",
    opensOnAdvancedTab: true,
    initial: stepFor(
      MonitorStepProxmoxMonitorUtil.getDefault(),
      "form.proxmox.cpu",
    ),
    renderForm: (step: FormStep, onChange: (step: FormStep) => void) => {
      return (
        <ProxmoxMonitorStepForm
          monitorStepProxmoxMonitor={step as MonitorStepProxmoxMonitor}
          onChange={onChange as (step: MonitorStepProxmoxMonitor) => void}
        />
      );
    },
  },
  {
    name: "VMware",
    metricName: "form.vmware.cpu",
    opensOnAdvancedTab: true,
    initial: stepFor(
      MonitorStepVMwareMonitorUtil.getDefault(),
      "form.vmware.cpu",
    ),
    renderForm: (step: FormStep, onChange: (step: FormStep) => void) => {
      return (
        <VMwareMonitorStepForm
          monitorStepVMwareMonitor={step as MonitorStepVMwareMonitor}
          onChange={onChange as (step: MonitorStepVMwareMonitor) => void}
        />
      );
    },
  },
  {
    name: "Ceph",
    metricName: "form.ceph.cpu",
    opensOnAdvancedTab: true,
    initial: stepFor(MonitorStepCephMonitorUtil.getDefault(), "form.ceph.cpu"),
    renderForm: (step: FormStep, onChange: (step: FormStep) => void) => {
      return (
        <CephMonitorStepForm
          monitorStepCephMonitor={step as MonitorStepCephMonitor}
          onChange={onChange as (step: MonitorStepCephMonitor) => void}
        />
      );
    },
  },
  {
    name: "IoT",
    metricName: "form.iot.cpu",
    opensOnAdvancedTab: true,
    initial: stepFor(MonitorStepIoTMonitorUtil.getDefault(), "form.iot.cpu"),
    renderForm: (step: FormStep, onChange: (step: FormStep) => void) => {
      return (
        <IoTMonitorStepForm
          monitorStepIoTMonitor={step as MonitorStepIoTMonitor}
          onChange={onChange as (step: MonitorStepIoTMonitor) => void}
        />
      );
    },
  },
];

const formChangeMock: MockFunction = getJestMockFunction();

/*
 * The form's parent, as MonitorStep holds it: every onChange is applied to
 * the step, the way an edit in the form is. "Pick past 6 hours" is the
 * form's Time Range field choosing another rolling window.
 */
const FormHost: React.FunctionComponent<{ formCase: FormCase }> = (props: {
  formCase: FormCase;
}): React.ReactElement => {
  const [step, setStep] = React.useState<FormStep>(props.formCase.initial);

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          setStep({ ...step, rollingTime: RollingTime.Past6Hours });
        }}
      >
        Pick past 6 hours
      </button>
      {props.formCase.renderForm(step, (next: FormStep) => {
        formChangeMock(next);
        setStep(next);
      })}
    </div>
  );
};

async function renderForm(formCase: FormCase): Promise<void> {
  render(
    <MemoryRouter>
      <FormHost formCase={formCase} />
    </MemoryRouter>,
  );
  if (formCase.opensOnAdvancedTab) {
    fireEvent.click(await screen.findByRole("tab", { name: "Advanced" }));
  }
  await previewSettled(formCase.metricName);
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  getListMock.mockReset();
  getItemMock.mockReset();
  fetchResultsMock.mockReset();
  formChangeMock.mockReset();
  for (const key of Object.keys(mockChartsByMetric)) {
    delete mockChartsByMetric[key];
  }
  getListMock.mockResolvedValue({ data: [], count: 0, skip: 0, limit: 0 });
  getItemMock.mockResolvedValue(null);
  fetchResultsMock.mockImplementation(() => {
    return Promise.resolve([{ data: [], truncated: false }]);
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe.each(FORM_CASES)(
  "the $name monitor form's metric preview",
  (formCase: FormCase) => {
    const metricName: string = formCase.metricName;

    test("previews the rolling window and offers a drag, with no reset yet", async () => {
      await renderForm(formCase);

      const [start, end] = lastFetchedWindowFor(metricName)!;
      expect(end - start).toBeGreaterThanOrEqual(60 * 60 * 1000);
      expect(end - start).toBeLessThan(61 * 60 * 1000);
      // Zoom used to be switched off here: the drag is offered now.
      expect(chartsOf(metricName).onTimeRangeSelect).toBeInstanceOf(Function);
      expect(chartsOf(metricName).onTimeRangeReset).toBeUndefined();
      expect(
        screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
      ).toBeNull();
    });

    test("a drag zooms the preview and never reaches the form", async () => {
      await renderForm(formCase);
      formChangeMock.mockClear();

      await click(`Drag across ${metricName}`);

      await waitFor(() => {
        expect(lastFetchedWindowFor(metricName)).toEqual(
          windowOf(MOCK_DRAG.start, MOCK_DRAG.end),
        );
      });
      expect(formChangeMock).not.toHaveBeenCalled();
      expect(chartsOf(metricName).onTimeRangeReset).toBeInstanceOf(Function);
      expect(
        screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
      ).toBeVisible();
    });

    test("a double-click brings the rolling window back, without touching the form", async () => {
      await renderForm(formCase);
      const rollingWindow: Window = lastFetchedWindowFor(metricName)!;
      formChangeMock.mockClear();

      await click(`Drag across ${metricName}`);
      await waitFor(() => {
        expect(chartsOf(metricName).onTimeRangeReset).toBeInstanceOf(Function);
      });
      await click(`Double-click ${metricName}`);

      await waitFor(() => {
        expect(lastFetchedWindowFor(metricName)).toEqual(rollingWindow);
      });
      expect(formChangeMock).not.toHaveBeenCalled();
      expect(chartsOf(metricName).onTimeRangeReset).toBeUndefined();
      expect(
        screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
      ).toBeNull();
    });

    test("Reset zoom does what a double-click does", async () => {
      await renderForm(formCase);
      const rollingWindow: Window = lastFetchedWindowFor(metricName)!;

      await click(`Drag across ${metricName}`);
      fireEvent.click(
        await screen.findByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
      );

      await waitFor(() => {
        expect(lastFetchedWindowFor(metricName)).toEqual(rollingWindow);
      });
    });

    test("picking another rolling window in the form ends the zoom", async () => {
      await renderForm(formCase);

      await click(`Drag across ${metricName}`);
      await waitFor(() => {
        expect(chartsOf(metricName).onTimeRangeReset).toBeInstanceOf(Function);
      });

      await click("Pick past 6 hours");

      await waitFor(() => {
        expect(lastFetchedWindowFor(metricName)).toEqual(
          windowOf(SIX_HOURS_AGO, NOW),
        );
      });
      expect(chartsOf(metricName).onTimeRangeReset).toBeUndefined();
      expect(
        screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
      ).toBeNull();
    });
  },
);

describe("the Criteria page's step previews", () => {
  function metricStep(
    metricName: string,
    rollingTime: RollingTime,
  ): MonitorStep {
    const monitorStep: MonitorStep = new MonitorStep();
    monitorStep.data = {
      ...(monitorStep.data as MonitorStepType),
      monitorCriteria: new MonitorCriteria(),
      metricMonitor: {
        metricViewConfig: viewConfigFor(metricName),
        rollingTime: rollingTime,
        telemetryServiceIds: [],
      },
    } as MonitorStepType;
    return monitorStep;
  }

  function renderSteps(): void {
    render(
      <MemoryRouter>
        {[
          metricStep("criteria.first", RollingTime.Past1Hour),
          metricStep("criteria.second", RollingTime.Past6Hours),
        ].map((monitorStep: MonitorStep, index: number) => {
          return (
            <MonitorStepElement
              key={index}
              monitorType={MonitorType.Metrics}
              monitorStep={monitorStep}
              monitorStatusOptions={[]}
              incidentSeverityOptions={[]}
              alertSeverityOptions={[]}
              onCallPolicyOptions={[]}
              labelOptions={[]}
              teamOptions={[]}
              userOptions={[]}
              incidentRoleOptions={[]}
            />
          );
        })}
      </MemoryRouter>,
    );
  }

  async function stepsRendered(): Promise<void> {
    await previewSettled("criteria.first");
    await previewSettled("criteria.second");
  }

  test("each step's preview zooms on its own", async () => {
    renderSteps();
    await stepsRendered();

    await click("Drag across criteria.first");

    await waitFor(() => {
      expect(lastFetchedWindowFor("criteria.first")).toEqual(
        windowOf(MOCK_DRAG.start, MOCK_DRAG.end),
      );
    });
    // The other step still previews its own six-hour rolling window.
    for (const [start, end] of fetchedWindowsFor("criteria.second")) {
      expect(end - start).toBeGreaterThanOrEqual(
        NOW.getTime() - SIX_HOURS_AGO.getTime(),
      );
    }
    expect(chartsOf("criteria.second").onTimeRangeReset).toBeUndefined();

    // Only the zoomed preview offers the way back.
    const resetButtons: Array<HTMLElement> = screen.getAllByTestId(
      RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID,
    );
    expect(resetButtons).toHaveLength(1);
    const firstPreview: HTMLElement = (
      await screen.findByTestId("charts-criteria.first")
    ).closest("[data-testid='monitor-step-metric-preview']") as HTMLElement;
    expect(
      within(firstPreview).getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBe(resetButtons[0]);
  });

  test("a double-click on a step's preview returns it to that step's rolling window", async () => {
    renderSteps();
    await stepsRendered();
    const firstWindow: Window = lastFetchedWindowFor("criteria.first")!;
    expect(firstWindow[1] - firstWindow[0]).toBeLessThan(61 * 60 * 1000);

    await click("Drag across criteria.first");
    await waitFor(() => {
      expect(chartsOf("criteria.first").onTimeRangeReset).toBeInstanceOf(
        Function,
      );
    });
    await click("Double-click criteria.first");

    await waitFor(() => {
      expect(lastFetchedWindowFor("criteria.first")).toEqual(firstWindow);
    });
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
  });

  test("a double-click on the OTHER step's preview does not undo this one's zoom", async () => {
    renderSteps();
    await stepsRendered();

    await click("Drag across criteria.first");
    await waitFor(() => {
      expect(chartsOf("criteria.first").onTimeRangeReset).toBeInstanceOf(
        Function,
      );
    });

    await click("Double-click criteria.second");

    expect(lastFetchedWindowFor("criteria.first")).toEqual(
      windowOf(MOCK_DRAG.start, MOCK_DRAG.end),
    );
    expect(
      screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeVisible();
  });

  test("each preview still charts, and names, the rolling window its step evaluates", async () => {
    renderSteps();
    await stepsRendered();

    expect(
      screen.getByText(
        "The metrics this monitor evaluates, over the past 1 hour.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "The metrics this monitor evaluates, over the past 6 hours.",
      ),
    ).toBeInTheDocument();

    const [firstStart, firstEnd] = lastFetchedWindowFor("criteria.first")!;
    expect(firstEnd - firstStart).toBeGreaterThanOrEqual(
      NOW.getTime() - HOUR_AGO.getTime(),
    );
    expect(firstEnd - firstStart).toBeLessThan(
      NOW.getTime() - SIX_HOURS_AGO.getTime(),
    );
    const [secondStart, secondEnd] = lastFetchedWindowFor("criteria.second")!;
    expect(secondEnd - secondStart).toBeGreaterThanOrEqual(
      NOW.getTime() - SIX_HOURS_AGO.getTime(),
    );
  });
});
