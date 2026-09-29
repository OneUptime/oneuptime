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
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Where MetricView's own "Reset zoom" goes (issue #4105).
 *
 * Where the view keeps the zoom itself (localChartZoom, or its own window)
 * it offers "Reset zoom" while zoomed. It used to add a row for it ABOVE
 * the whole view, only while zoomed: every zoom pushed the charts (and, in
 * the ten monitor step forms, the whole query builder) down by that row
 * and every reset pulled them back up, right under a reader about to
 * double-click; and in the step forms the button sat above the query
 * editors, far from the chart it resets and often scrolled out of sight.
 *
 * Now showing it moves nothing, and it sits with the charts:
 *   - with the query builder shown, at the end of the "Charts" heading row
 *     that is always there;
 *   - without it, floating (absolutely placed) on the first chart's top
 *     border, together with the refetch indicator, which used to hold that
 *     corner by itself.
 * Where the page or the host keeps the zoom, they offer the reset, and the
 * view adds none.
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
        return (
          <div data-testid="metric-charts">
            <button
              type="button"
              onClick={() => {
                props.onTimeRangeSelect?.(MOCK_DRAG.start, MOCK_DRAG.end);
              }}
            >
              Drag across the chart
            </button>
            <button
              type="button"
              onClick={() => {
                props.onTimeRangeReset?.();
              }}
            >
              Double-click the chart
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
        /*
         * The metric catalog answers after the first results have landed
         * (longer than one waitFor tick). Answered first, MetricView's
         * mount-time load drops the Metric step form's first result: a
         * fetch from the first render, before the form set its window,
         * supersedes it. That is not what is pinned here.
         */
        loadAllMetricsTypes: () => {
          return new Promise(
            (
              resolve: (value: {
                metricTypes: Array<unknown>;
                telemetryServices: Array<unknown>;
              }) => void,
            ) => {
              setTimeout(() => {
                resolve({ metricTypes: [], telemetryServices: [] });
              }, 200);
            },
          );
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

import MetricView from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricView";
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
import { TimeRangeZoomProvider } from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import { TimeRangeZoom } from "../../../UI/Components/Charts/TimeRangeZoom/UseTimeRangeZoom";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MetricsViewConfig from "../../../Types/Metrics/MetricsViewConfig";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import { MonitorStepMetricMonitorUtil } from "../../../Types/Monitor/MonitorStepMetricMonitor";
import { MonitorStepHostMonitorUtil } from "../../../Types/Monitor/MonitorStepHostMonitor";
import { MonitorStepKubernetesMonitorUtil } from "../../../Types/Monitor/MonitorStepKubernetesMonitor";
import { MonitorStepDockerMonitorUtil } from "../../../Types/Monitor/MonitorStepDockerMonitor";
import { MonitorStepDockerSwarmMonitorUtil } from "../../../Types/Monitor/MonitorStepDockerSwarmMonitor";
import { MonitorStepPodmanMonitorUtil } from "../../../Types/Monitor/MonitorStepPodmanMonitor";
import { MonitorStepProxmoxMonitorUtil } from "../../../Types/Monitor/MonitorStepProxmoxMonitor";
import { MonitorStepVMwareMonitorUtil } from "../../../Types/Monitor/MonitorStepVMwareMonitor";
import { MonitorStepCephMonitorUtil } from "../../../Types/Monitor/MonitorStepCephMonitor";
import { MonitorStepIoTMonitorUtil } from "../../../Types/Monitor/MonitorStepIoTMonitor";
import ObjectID from "../../../Types/ObjectID";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import TimeRange from "../../../Types/Time/TimeRange";

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");
const WINDOW_START: Date = new Date("2026-09-28T11:00:00.000Z");

// The test id of the floating pair: "Reset zoom" and the refetch indicator.
const OWN_ZOOM_CONTROLS_TEST_ID: string = "metric-view-own-zoom-controls";

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

function viewDataFor(metricName: string): MetricViewData {
  return {
    ...viewConfigFor(metricName),
    startAndEndDate: new InBetween<Date>(WINDOW_START, NOW),
  } as MetricViewData;
}

function resetButton(): HTMLElement | null {
  return screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID);
}

function chartsStandIn(): HTMLElement {
  return screen.getByTestId("metric-charts");
}

// Whether `later` comes after `earlier` in document order.
function follows(later: Node, earlier: Node): boolean {
  return Boolean(
    earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

/*
 * The "Charts" heading row MetricView draws above its charts whenever the
 * query builder is shown.
 */
function chartsHeadingRow(): HTMLElement {
  const label: HTMLElement | undefined = screen
    .getAllByText("Charts")
    .find((element: HTMLElement): boolean => {
      return element.tagName === "SPAN";
    });
  if (!label || !label.parentElement) {
    throw new Error('No "Charts" heading row');
  }
  return label.parentElement;
}

// Every element on the path from `root` down to `node`, in order.
function pathTo(root: HTMLElement, node: HTMLElement): Array<HTMLElement> {
  const path: Array<HTMLElement> = [];
  let current: HTMLElement | null = node;
  while (current && current !== root) {
    path.unshift(current);
    current = current.parentElement;
  }
  return path;
}

/*
 * The in-flow layout above the charts, as each element on the path from
 * the host down to the charts and the siblings laid out before it: an
 * element added to or dropped from the flow above the charts changes it.
 * Absolutely placed elements are left out: they move nothing.
 */
function flowAboveCharts(host: HTMLElement): Array<string> {
  const layout: Array<string> = [];
  for (const element of pathTo(host, chartsStandIn())) {
    const siblingsBefore: Array<string> = [];
    let sibling: Element | null = element.previousElementSibling;
    while (sibling) {
      if (!sibling.classList.contains("absolute")) {
        siblingsBefore.unshift(
          `${sibling.tagName}.${sibling.className || "-"}`,
        );
      }
      sibling = sibling.previousElementSibling;
    }
    layout.push(
      `${siblingsBefore.join(" + ") || "(first)"} > ${element.tagName}`,
    );
  }
  return layout;
}

// Fetches started and not yet answered.
let pendingFetches: number = 0;

// Every fetch answers at once, with no data.
function answerFetches(): void {
  fetchResultsMock.mockImplementation(() => {
    pendingFetches++;
    return Promise.resolve([{ data: [], truncated: false }]).then(
      (results: Array<unknown>): Array<unknown> => {
        pendingFetches--;
        return results;
      },
    );
  });
}

/*
 * Until every fetch so far is answered and the charts are up: before its
 * first answer lands, MetricView shows a loader in place of the charts,
 * and a gesture must not land on charts about to be swapped out.
 */
async function chartsSettled(): Promise<void> {
  await waitFor(() => {
    expect(fetchResultsMock).toHaveBeenCalled();
    expect(pendingFetches).toBe(0);
    expect(chartsStandIn()).toBeInTheDocument();
  });
  await act(async () => {
    await Promise.resolve();
  });
  // waitFor ticks the fake clock; "now" is where a rolling window reads it.
  jest.setSystemTime(NOW);
}

async function drag(): Promise<void> {
  fireEvent.click(
    await screen.findByRole("button", { name: "Drag across the chart" }),
  );
  await screen.findByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID);
  jest.setSystemTime(NOW);
}

async function doubleClick(): Promise<void> {
  fireEvent.click(
    await screen.findByRole("button", { name: "Double-click the chart" }),
  );
  await waitFor(() => {
    expect(resetButton()).toBeNull();
  });
  jest.setSystemTime(NOW);
}

// Holds the next fetches open: MetricView is then refetching.
function holdFetches(): void {
  fetchResultsMock.mockImplementation(() => {
    return new Promise(() => {
      // Intentionally never settles.
    });
  });
}

function refreshingIndicator(): HTMLElement | null {
  return (
    screen.queryAllByText("Refreshing").find((element: HTMLElement) => {
      return element.tagName === "DIV";
    }) || null
  );
}

function fakePageZoom(isZoomed: boolean): TimeRangeZoom {
  return {
    isZoomed: isZoomed,
    rangeBeforeZoom: isZoomed ? { range: TimeRange.PAST_ONE_HOUR } : null,
    zoomToTimeRange: () => {},
    resetZoom: () => {},
  };
}

// A step as the forms hold it.
type FormStep = {
  metricViewConfig: MetricsViewConfig;
  rollingTime: RollingTime;
};

interface FormCase {
  name: string;
  // Every infrastructure form keeps its query builder on the Advanced tab.
  opensOnAdvancedTab: boolean;
  initial: FormStep;
  form: React.FunctionComponent<any>;
  stepProp: string;
}

function formCase(
  name: string,
  form: React.FunctionComponent<any>,
  stepProp: string,
  defaults: FormStep,
  opensOnAdvancedTab: boolean,
): FormCase {
  return {
    name: name,
    opensOnAdvancedTab: opensOnAdvancedTab,
    form: form,
    stepProp: stepProp,
    initial: {
      ...defaults,
      metricViewConfig: viewConfigFor(`form.${name}.cpu`),
      rollingTime: RollingTime.Past1Hour,
    },
  };
}

const FORM_CASES: Array<FormCase> = [
  formCase(
    "Metric",
    MetricMonitorStepForm,
    "monitorStepMetricMonitor",
    MonitorStepMetricMonitorUtil.getDefault(),
    false,
  ),
  formCase(
    "Host",
    HostMonitorStepForm,
    "monitorStepHostMonitor",
    MonitorStepHostMonitorUtil.getDefault(),
    true,
  ),
  formCase(
    "Kubernetes",
    KubernetesMonitorStepForm,
    "monitorStepKubernetesMonitor",
    MonitorStepKubernetesMonitorUtil.getDefault(),
    true,
  ),
  formCase(
    "Docker",
    DockerMonitorStepForm,
    "monitorStepDockerMonitor",
    MonitorStepDockerMonitorUtil.getDefault(),
    true,
  ),
  formCase(
    "Docker Swarm",
    DockerSwarmMonitorStepForm,
    "monitorStepDockerSwarmMonitor",
    MonitorStepDockerSwarmMonitorUtil.getDefault(),
    true,
  ),
  formCase(
    "Podman",
    PodmanMonitorStepForm,
    "monitorStepPodmanMonitor",
    MonitorStepPodmanMonitorUtil.getDefault(),
    true,
  ),
  formCase(
    "Proxmox",
    ProxmoxMonitorStepForm,
    "monitorStepProxmoxMonitor",
    MonitorStepProxmoxMonitorUtil.getDefault(),
    true,
  ),
  formCase(
    "VMware",
    VMwareMonitorStepForm,
    "monitorStepVMwareMonitor",
    MonitorStepVMwareMonitorUtil.getDefault(),
    true,
  ),
  formCase(
    "Ceph",
    CephMonitorStepForm,
    "monitorStepCephMonitor",
    MonitorStepCephMonitorUtil.getDefault(),
    true,
  ),
  formCase(
    "IoT",
    IoTMonitorStepForm,
    "monitorStepIoTMonitor",
    MonitorStepIoTMonitorUtil.getDefault(),
    true,
  ),
];

// The form's parent, as MonitorStep holds it.
const FormHost: React.FunctionComponent<{ formCase: FormCase }> = (props: {
  formCase: FormCase;
}): React.ReactElement => {
  const [step, setStep] = React.useState<FormStep>(props.formCase.initial);
  return (
    <div data-testid="host">
      {React.createElement(props.formCase.form, {
        [props.formCase.stepProp]: step,
        onChange: setStep,
      })}
    </div>
  );
};

async function renderForm(caseToRender: FormCase): Promise<HTMLElement> {
  render(
    <MemoryRouter>
      <FormHost formCase={caseToRender} />
    </MemoryRouter>,
  );
  if (caseToRender.opensOnAdvancedTab) {
    fireEvent.click(await screen.findByRole("tab", { name: "Advanced" }));
  }
  await chartsSettled();
  return screen.getByTestId("host");
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  getListMock.mockReset();
  getItemMock.mockReset();
  fetchResultsMock.mockReset();
  getListMock.mockResolvedValue({ data: [], count: 0, skip: 0, limit: 0 });
  getItemMock.mockResolvedValue(null);
  pendingFetches = 0;
  answerFetches();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe.each(FORM_CASES)(
  "the $name monitor form (the query builder shown)",
  (caseToRender: FormCase) => {
    test("Reset zoom appears at the end of the Charts heading, after the query builder and right above the chart", async () => {
      await renderForm(caseToRender);

      await drag();

      const reset: HTMLElement = resetButton()!;
      expect(reset.parentElement).toBe(chartsHeadingRow());
      // Not above the query editors, where it used to be.
      expect(
        follows(reset, screen.getByRole("button", { name: "Add Metric" })),
      ).toBe(true);
      expect(follows(reset, screen.getAllByText("Queries")[0]!)).toBe(true);
      expect(follows(chartsStandIn(), reset)).toBe(true);
      expect(
        screen.getAllByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
      ).toHaveLength(1);
    });

    test("a zoom and a reset add or remove nothing in the flow: the builder and the chart stay put", async () => {
      const host: HTMLElement = await renderForm(caseToRender);
      const headingRow: HTMLElement = chartsHeadingRow();
      const before: Array<string> = flowAboveCharts(host);

      await drag();
      expect(flowAboveCharts(host)).toEqual(before);
      // The row that holds it is the one that was already there.
      expect(chartsHeadingRow()).toBe(headingRow);

      await doubleClick();
      expect(flowAboveCharts(host)).toEqual(before);
      expect(chartsHeadingRow()).toBe(headingRow);
    });

    test("the button keeps the heading row's height, and none of its capitals", async () => {
      await renderForm(caseToRender);

      await drag();

      const reset: HTMLElement = resetButton()!;
      // -my-1: the 24px button inside the 16px row, which does not grow.
      expect(reset).toHaveClass("-my-1");
      expect(reset).toHaveClass("ml-auto");
      expect(reset).toHaveClass("normal-case");
      expect(reset).toHaveClass("tracking-normal");
      expect(chartsHeadingRow()).toHaveClass("uppercase");
      expect(screen.queryByTestId(OWN_ZOOM_CONTROLS_TEST_ID)).toBeNull();
    });

    test("it resets the preview, and goes when there is nothing left to reset", async () => {
      await renderForm(caseToRender);
      await drag();

      fireEvent.click(resetButton()!);

      await waitFor(() => {
        expect(resetButton()).toBeNull();
      });
      // The heading stays, with nothing in it but its label.
      expect(within(chartsHeadingRow()).queryByRole("button")).toBeNull();
    });
  },
);

describe("the Metric monitor form's refetch indicator", () => {
  test("stays in the corner of the charts; the Reset is in the heading, so they never meet", async () => {
    await renderForm(FORM_CASES[0]!);
    holdFetches();

    await drag();

    const refreshing: HTMLElement | null = refreshingIndicator();
    expect(refreshing).not.toBeNull();
    expect(refreshing).toHaveClass("absolute");
    expect(refreshing).toHaveClass("right-2");
    expect(refreshing).toHaveClass("top-2");
    expect(resetButton()!.parentElement).toBe(chartsHeadingRow());
  });
});

/*
 * The hosts without the builder: the incident and alert snapshots and the
 * telemetry snapshot panel (charts in cards, localChartZoom), the monitor
 * view's preview (cards, its own window), the Criteria page's step preview
 * (no cards, localChartZoom) and the incident root cause chart (no cards,
 * its own window).
 */
interface BareHostCase {
  name: string;
  hideCardInCharts: boolean;
  localChartZoom: boolean;
  // Where the floating pair is centred: on the first chart's top border.
  topClass: string;
}

const BARE_HOST_CASES: Array<BareHostCase> = [
  {
    name: "a snapshot (chart cards, local zoom)",
    hideCardInCharts: false,
    localChartZoom: true,
    topClass: "top-0",
  },
  {
    name: "the monitor view's preview (chart cards, its own window)",
    hideCardInCharts: false,
    localChartZoom: false,
    topClass: "top-0",
  },
  {
    name: "the Criteria page's step preview (no chart cards, local zoom)",
    hideCardInCharts: true,
    localChartZoom: true,
    topClass: "top-[17px]",
  },
  {
    name: "the incident root cause chart (no chart cards, its own window)",
    hideCardInCharts: true,
    localChartZoom: false,
    topClass: "top-[17px]",
  },
];

const BareHost: React.FunctionComponent<{ hostCase: BareHostCase }> = (props: {
  hostCase: BareHostCase;
}): React.ReactElement => {
  const [data, setData] = React.useState<MetricViewData>(
    viewDataFor("bare.cpu"),
  );
  return (
    <div data-testid="host">
      <MetricView
        data={data}
        hideQueryElements={true}
        hideStartAndEndDate={true}
        hideCardInCharts={props.hostCase.hideCardInCharts}
        chartCssClass="rounded-lg border border-gray-200 shadow-sm"
        {...(props.hostCase.localChartZoom ? { localChartZoom: true } : {})}
        onChange={setData}
      />
    </div>
  );
};

async function renderBareHost(hostCase: BareHostCase): Promise<HTMLElement> {
  render(<BareHost hostCase={hostCase} />);
  await chartsSettled();
  return screen.getByTestId("host");
}

describe.each(BARE_HOST_CASES)(
  "$name (no query builder)",
  (hostCase: BareHostCase) => {
    test("Reset zoom floats with the charts, out of the flow", async () => {
      await renderBareHost(hostCase);

      await drag();

      const controls: HTMLElement = screen.getByTestId(
        OWN_ZOOM_CONTROLS_TEST_ID,
      );
      expect(resetButton()!.parentElement).toBe(controls);
      expect(controls).toHaveClass("absolute");
      // With the charts: in the positioned box that holds them.
      expect(controls.parentElement).toHaveClass("relative");
      expect(controls.parentElement).toContainElement(chartsStandIn());
      expect(
        screen.getAllByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
      ).toHaveLength(1);
    });

    test("a zoom and a reset add or remove nothing in the flow: the chart stays put", async () => {
      const host: HTMLElement = await renderBareHost(hostCase);
      const before: Array<string> = flowAboveCharts(host);
      const hostChildren: number = host.childElementCount;

      await drag();
      expect(flowAboveCharts(host)).toEqual(before);
      expect(host.childElementCount).toBe(hostChildren);

      await doubleClick();
      expect(flowAboveCharts(host)).toEqual(before);
      expect(host.childElementCount).toBe(hostChildren);
    });

    test("the pair is centred on the first chart's top border, clear of the chart's own title and hint", async () => {
      await renderBareHost(hostCase);

      await drag();

      const controls: HTMLElement = screen.getByTestId(
        OWN_ZOOM_CONTROLS_TEST_ID,
      );
      expect(controls).toHaveClass(hostCase.topClass);
      expect(controls).toHaveClass("-translate-y-1/2");
      expect(controls).toHaveClass("right-2");
    });

    test("only the button takes the pointer: a gesture anywhere else on the pair reaches the chart", async () => {
      await renderBareHost(hostCase);

      await drag();

      expect(screen.getByTestId(OWN_ZOOM_CONTROLS_TEST_ID)).toHaveClass(
        "pointer-events-none",
      );
      expect(resetButton()).toHaveClass("pointer-events-auto");
    });

    test("the refetch indicator sits beside the button, never under it", async () => {
      await renderBareHost(hostCase);
      holdFetches();

      await drag();

      const controls: HTMLElement = screen.getByTestId(
        OWN_ZOOM_CONTROLS_TEST_ID,
      );
      const refreshing: HTMLElement | null = refreshingIndicator();
      expect(refreshing).not.toBeNull();
      expect(refreshing!.parentElement).toBe(controls);
      // Placed by the pair, not on its own in the corner.
      expect(refreshing).not.toHaveClass("absolute");
      expect(follows(resetButton()!, refreshing!)).toBe(true);
    });

    test("before a zoom the pair offers no reset, and a double-click takes the reset away again", async () => {
      await renderBareHost(hostCase);

      expect(resetButton()).toBeNull();
      expect(
        within(screen.getByTestId(OWN_ZOOM_CONTROLS_TEST_ID)).queryByRole(
          "button",
        ),
      ).toBeNull();

      await drag();
      await doubleClick();

      expect(
        within(screen.getByTestId(OWN_ZOOM_CONTROLS_TEST_ID)).queryByRole(
          "button",
        ),
      ).toBeNull();
    });

    test("the button resets the charts' window", async () => {
      await renderBareHost(hostCase);
      await drag();
      const zoomedFetches: number = fetchResultsMock.mock.calls.length;

      fireEvent.click(resetButton()!);

      await waitFor(() => {
        expect(resetButton()).toBeNull();
      });
      expect(fetchResultsMock.mock.calls.length).toBeGreaterThan(zoomedFetches);
      const lastWindow: InBetween<Date> = (
        fetchResultsMock.mock.calls[
          fetchResultsMock.mock.calls.length - 1
        ]![0] as { metricViewData: MetricViewData }
      ).metricViewData.startAndEndDate!;
      expect(lastWindow.endValue.getTime()).toBe(NOW.getTime());
    });
  },
);

/*
 * Where the view does not keep the zoom, whoever does offers the reset:
 * a second one here would duplicate theirs.
 */
describe("where the page or the host keeps the zoom, the view adds no Reset of its own", () => {
  test("inside a zoomed page, with the query builder shown (the metric explorer)", async () => {
    render(
      <MemoryRouter>
        <TimeRangeZoomProvider zoom={fakePageZoom(true)}>
          <MetricView data={viewDataFor("explorer.cpu")} onChange={() => {}} />
        </TimeRangeZoomProvider>
      </MemoryRouter>,
    );
    await chartsSettled();

    expect(resetButton()).toBeNull();
    expect(within(chartsHeadingRow()).queryByRole("button")).toBeNull();
    expect(screen.queryByTestId(OWN_ZOOM_CONTROLS_TEST_ID)).toBeNull();
  });

  test("inside a zoomed page, without the builder (the device health charts)", async () => {
    render(
      <TimeRangeZoomProvider zoom={fakePageZoom(true)}>
        <MetricView
          data={viewDataFor("device.cpu")}
          hideQueryElements={true}
          hideStartAndEndDate={true}
          hideCardInCharts={true}
          onChange={() => {}}
        />
      </TimeRangeZoomProvider>,
    );
    await chartsSettled();

    expect(resetButton()).toBeNull();
    expect(screen.queryByTestId(OWN_ZOOM_CONTROLS_TEST_ID)).toBeNull();
  });

  test("with the host's own handlers, even inside a zoomed page (an embedded metric card)", async () => {
    render(
      <TimeRangeZoomProvider zoom={fakePageZoom(true)}>
        <MetricView
          data={viewDataFor("card.cpu")}
          hideQueryElements={true}
          hideStartAndEndDate={true}
          hideCardInCharts={true}
          onChange={() => {}}
          onTimeRangeSelect={() => {}}
          onTimeRangeReset={() => {}}
        />
      </TimeRangeZoomProvider>,
    );
    await chartsSettled();

    expect(resetButton()).toBeNull();
    expect(screen.queryByTestId(OWN_ZOOM_CONTROLS_TEST_ID)).toBeNull();
  });

  test("with the zoom switched off", async () => {
    render(
      <TimeRangeZoomProvider zoom={fakePageZoom(true)}>
        <MetricView
          data={viewDataFor("off.cpu")}
          hideQueryElements={true}
          hideStartAndEndDate={true}
          disableChartZoom={true}
          onChange={() => {}}
        />
      </TimeRangeZoomProvider>,
    );
    await chartsSettled();

    expect(resetButton()).toBeNull();
    expect(screen.queryByTestId(OWN_ZOOM_CONTROLS_TEST_ID)).toBeNull();
  });

  test("there, the refetch indicator keeps its corner of the charts", async () => {
    // The page's range, moved on by the page (a zoom, or its picker).
    const PageHost: React.FunctionComponent = (): React.ReactElement => {
      const [data, setData] = React.useState<MetricViewData>(
        viewDataFor("device.cpu"),
      );
      return (
        <TimeRangeZoomProvider zoom={fakePageZoom(true)}>
          <button
            type="button"
            onClick={() => {
              setData({
                ...data,
                startAndEndDate: new InBetween<Date>(MOCK_DRAG.start, NOW),
              });
            }}
          >
            Move the page range
          </button>
          <MetricView
            data={data}
            hideQueryElements={true}
            hideStartAndEndDate={true}
            hideCardInCharts={true}
            onChange={setData}
          />
        </TimeRangeZoomProvider>
      );
    };
    render(<PageHost />);
    await chartsSettled();
    holdFetches();

    act(() => {
      fireEvent.click(
        screen.getByRole("button", { name: "Move the page range" }),
      );
    });

    const refreshing: HTMLElement | null = refreshingIndicator();
    expect(refreshing).not.toBeNull();
    expect(refreshing).toHaveClass("absolute");
    expect(refreshing).toHaveClass("right-2");
    expect(refreshing).toHaveClass("top-2");
    expect(screen.queryByTestId(OWN_ZOOM_CONTROLS_TEST_ID)).toBeNull();
  });
});
