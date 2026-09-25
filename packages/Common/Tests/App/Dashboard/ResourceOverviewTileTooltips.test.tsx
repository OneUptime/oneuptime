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
import { MemoryRouter, useLocation } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The shared dashboard pieces that carry a metric's (i) tooltip:
 *
 *   - ResourceOverview's golden-metric tiles (every telemetry overview page),
 *     including a linked tile, where the link is laid over the card so the
 *     (i) is never inside an anchor;
 *   - ChartCard, in each of its three states;
 *   - the Infrastructure GoldenMetricTile (Kubernetes, Proxmox, Ceph...);
 *   - WebVitalsCard, for the card and for each vital, whose tooltip adds the
 *     Good / Poor limits the rating chip uses;
 *   - ResourceOverviewTab's summary fields;
 *   - ResourceTable's header tooltips, and the Kubernetes wrapper that passes
 *     them through.
 *
 * Tippy under jsdom (see InfoTooltip.test.tsx): the popup is portalled to
 * document.body and never finishes animating, so a shown tooltip is found
 * through `screen` and its presence is asserted.
 */

const lineChartMock: MockFunction = getJestMockFunction();

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

// recharts draws nothing in a 0x0 jsdom box; the card is checked by what it hands the chart.
jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return {
    __esModule: true,
    default: (props: { data: Array<unknown> }) => {
      lineChartMock(props);
      return (
        <div data-testid="line-chart">{`series:${props.data.length}`}</div>
      );
    },
  };
});

import ResourceOverview, {
  ResourceOverviewTile,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ResourceOverview";
import ChartCard from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ChartCard";
import WebVitalsCard, {
  describeWebVital,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/WebVitalsCard";
import { WebVital } from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/telemetryMetrics";
import InfraGoldenMetricTile from "../../../../App/FeatureSet/Dashboard/src/Components/Infrastructure/GoldenMetricTile";
import ResourceOverviewTab from "../../../../App/FeatureSet/Dashboard/src/Components/Infrastructure/ResourceOverviewTab";
import ResourceTable, {
  InfrastructureResource,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Infrastructure/ResourceTable";
import KubernetesResourceTable from "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/KubernetesResourceTable";
import Route from "../../../Types/API/Route";
import IconProp from "../../../Types/Icon/IconProp";
import SeriesPoint from "../../../UI/Components/Charts/Types/SeriesPoints";
import {
  describeWebVitalThresholds,
  WebVitalDefinition,
  WebVitalDefinitions,
} from "../../../Types/Rum/WebVitals";

const P95_TEXT: string =
  "p95: 95% of requests finished faster than this, and the slowest 5% took longer.";
const ERROR_TEXT: string =
  "The share of requests in the selected range that failed.";
const CLIENTS_TEXT: string =
  "Distinct platforms this app has been used on so far.";

async function hover(trigger: HTMLElement): Promise<void> {
  fireEvent.mouseEnter(trigger);
  await act(async () => {
    jest.advanceTimersByTime(200);
  });
}

async function expectTooltip(
  trigger: HTMLElement,
  text: string,
): Promise<void> {
  await hover(trigger);

  const describedBy: string | null = trigger.getAttribute("aria-describedby");

  expect(describedBy).toBeTruthy();
  expect(document.getElementById(describedBy as string)).toHaveTextContent(
    text,
  );
}

beforeEach(() => {
  jest.useFakeTimers();
  lineChartMock.mockReset();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

/* ------------------------------------------------------------------ */
/* ResourceOverview golden-metric tiles                                */
/* ------------------------------------------------------------------ */

function LocationProbe(): React.ReactElement {
  const location: { pathname: string } = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderOverview(
  tiles: Array<ResourceOverviewTile>,
  options: { tilesLoading?: boolean } = {},
): void {
  render(
    <MemoryRouter initialEntries={["/dashboard/overview"]}>
      <ResourceOverview
        icon={IconProp.Globe}
        title="Checkout Web"
        identifier="checkout-web"
        identifierLabel="service.name"
        status="connected"
        lastSeenAt={undefined}
        chips={[]}
        tiles={tiles}
        tilesLoading={options.tilesLoading}
        detailRows={[]}
      />
      <LocationProbe />
    </MemoryRouter>,
  );
}

function tileRoot(title: string): HTMLElement {
  const titleSpan: HTMLElement = screen.getByText(title, {
    selector: "span.uppercase",
  });
  return titleSpan.closest("[aria-busy]") as HTMLElement;
}

const P95_TILE: ResourceOverviewTile = {
  title: "p95 duration",
  value: "123 ms",
  icon: IconProp.Clock,
  iconColor: "violet",
  sublabel: "selected range",
  description: P95_TEXT,
};

describe("ResourceOverview tiles", () => {
  test("a tile with a description has an (i) whose tooltip is the description", async () => {
    renderOverview([P95_TILE]);

    const info: HTMLElement = screen.getByRole("button", {
      name: "About p95 duration",
    });

    expect(tileRoot("p95 duration")).toContainElement(info);
    await expectTooltip(info, P95_TEXT);
  });

  test("the value and sublabel still render beside the (i)", () => {
    renderOverview([P95_TILE]);

    const root: HTMLElement = tileRoot("p95 duration");

    expect(within(root).getByText("123 ms")).toBeInTheDocument();
    expect(within(root).getByText("selected range")).toBeInTheDocument();
  });

  test("a tile without a description has no (i)", () => {
    renderOverview([{ ...P95_TILE, description: undefined }]);

    expect(
      screen.queryByRole("button", { name: /^About / }),
    ).not.toBeInTheDocument();
  });

  test("a whitespace description has no (i)", () => {
    renderOverview([{ ...P95_TILE, description: "   " }]);

    expect(
      screen.queryByRole("button", { name: /^About / }),
    ).not.toBeInTheDocument();
  });

  test("each tile explains itself with its own text", async () => {
    renderOverview([
      P95_TILE,
      {
        title: "Error rate",
        value: "2.0%",
        icon: IconProp.Alert,
        iconColor: "rose",
        percent: 2,
        thresholds: { warn: 1, danger: 5 },
        description: ERROR_TEXT,
      },
    ]);

    await expectTooltip(
      screen.getByRole("button", { name: "About Error rate" }),
      ERROR_TEXT,
    );
    await expectTooltip(
      screen.getByRole("button", { name: "About p95 duration" }),
      P95_TEXT,
    );
  });

  test("a tile that is still loading already shows its (i)", async () => {
    renderOverview([{ ...P95_TILE, loading: true }]);

    const root: HTMLElement = tileRoot("p95 duration");

    expect(root).toHaveAttribute("aria-busy", "true");
    expect(within(root).getByText("Loading p95 duration")).toBeInTheDocument();
    expect(within(root).queryByText("123 ms")).not.toBeInTheDocument();

    await expectTooltip(
      within(root).getByRole("button", { name: "About p95 duration" }),
      P95_TEXT,
    );
  });

  test("tiles loaded as a group (tilesLoading) keep their (i)", () => {
    renderOverview([P95_TILE], { tilesLoading: true });

    expect(tileRoot("p95 duration")).toHaveAttribute("aria-busy", "true");
    expect(
      screen.getByRole("button", { name: "About p95 duration" }),
    ).toBeInTheDocument();
  });

  test("an unlinked tile has no link at all", () => {
    renderOverview([P95_TILE]);

    expect(within(tileRoot("p95 duration")).queryByRole("link")).toBeNull();
  });
});

describe("a linked ResourceOverview tile", () => {
  const CLIENTS: ResourceOverviewTile = {
    title: "Clients",
    value: "4",
    icon: IconProp.Window,
    iconColor: "amber",
    sublabel: "platforms seen",
    to: new Route("/dashboard/project/rum/app/clients"),
    description: CLIENTS_TEXT,
  };

  test("the link is an overlay anchor with the tile's route and a 'View <title>' name", () => {
    renderOverview([CLIENTS]);

    const link: HTMLElement = screen.getByRole("link", {
      name: "View Clients",
    });

    expect(link).toHaveAttribute("href", "/dashboard/project/rum/app/clients");
    expect(link).toHaveClass("absolute", "inset-0");
    expect(tileRoot("Clients")).toHaveClass("relative");
    expect(tileRoot("Clients")).toContainElement(link);

    const srOnly: HTMLElement = within(link).getByText("View Clients");
    expect(srOnly).toHaveClass("sr-only");
  });

  test("the link does not wrap the tile's content", () => {
    renderOverview([CLIENTS]);

    const link: HTMLElement = screen.getByRole("link", {
      name: "View Clients",
    });

    expect(link.textContent).toBe("View Clients");
    expect(within(link).queryByText("4")).toBeNull();
    expect(link.parentElement).toBe(tileRoot("Clients"));
  });

  test("the (i) is not a descendant of any anchor and is lifted above the overlay", () => {
    renderOverview([CLIENTS]);

    const info: HTMLElement = screen.getByRole("button", {
      name: "About Clients",
    });

    expect(info.closest("a")).toBeNull();
    for (const anchor of Array.from(document.querySelectorAll("a"))) {
      expect(anchor).not.toContainElement(info);
    }
    expect(info).toHaveClass("relative", "z-10");
  });

  test("clicking the (i) does not navigate; clicking the overlay does", () => {
    renderOverview([CLIENTS]);

    expect(screen.getByTestId("location")).toHaveTextContent(
      "/dashboard/overview",
    );

    fireEvent.click(screen.getByRole("button", { name: "About Clients" }));
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/dashboard/overview",
    );

    fireEvent.click(screen.getByRole("link", { name: "View Clients" }));
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/dashboard/project/rum/app/clients",
    );
  });

  test("hovering the (i) on a linked tile shows the text", async () => {
    renderOverview([CLIENTS]);

    await expectTooltip(
      screen.getByRole("button", { name: "About Clients" }),
      CLIENTS_TEXT,
    );
  });

  test("a linked tile without a description still links, with no (i)", () => {
    renderOverview([{ ...CLIENTS, description: undefined }]);

    expect(
      screen.getByRole("link", { name: "View Clients" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^About / }),
    ).not.toBeInTheDocument();
  });

  test("a linked tile that is loading keeps its link and its (i)", () => {
    renderOverview([{ ...CLIENTS, loading: true }]);

    expect(
      screen.getByRole("link", { name: "View Clients" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "About Clients" }).closest("a"),
    ).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* ChartCard                                                           */
/* ------------------------------------------------------------------ */

const WINDOW_START: Date = new Date("2026-09-24T10:00:00.000Z");
const WINDOW_END: Date = new Date("2026-09-24T11:00:00.000Z");

const DATA: Array<SeriesPoint> = [
  {
    seriesName: "p95",
    data: [{ x: WINDOW_START, y: 120 }],
  },
];

interface ChartCardOptions {
  loading?: boolean;
  series?: Array<SeriesPoint>;
  windowStart?: Date | null;
  description?: string | undefined;
}

function renderChartCard(options: ChartCardOptions = {}): void {
  render(
    <ChartCard
      title="p95 duration"
      icon={IconProp.Clock}
      iconColor="violet"
      series={options.series ?? DATA}
      windowStart={
        options.windowStart === undefined ? WINDOW_START : options.windowStart
      }
      windowEnd={WINDOW_END}
      syncId="test"
      loading={options.loading}
      description={"description" in options ? options.description : P95_TEXT}
    />,
  );
}

describe("ChartCard", () => {
  test("loading: the header already carries the (i)", async () => {
    renderChartCard({ loading: true });

    expect(screen.queryByTestId("line-chart")).not.toBeInTheDocument();
    await expectTooltip(
      screen.getByRole("button", { name: "About p95 duration" }),
      P95_TEXT,
    );
  });

  test("no window yet counts as loading and still carries the (i)", () => {
    renderChartCard({ windowStart: null });

    expect(screen.queryByTestId("line-chart")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "About p95 duration" }),
    ).toBeInTheDocument();
  });

  test("no data: the empty state keeps the (i)", async () => {
    renderChartCard({ series: [{ seriesName: "p95", data: [] }] });

    expect(screen.getByText("No data in this time range")).toBeInTheDocument();
    await expectTooltip(
      screen.getByRole("button", { name: "About p95 duration" }),
      P95_TEXT,
    );
  });

  test("with data: the chart renders and the (i) sits in its header", async () => {
    renderChartCard();

    expect(screen.getByTestId("line-chart")).toBeInTheDocument();
    expect(lineChartMock).toHaveBeenCalled();
    await expectTooltip(
      screen.getByRole("button", { name: "About p95 duration" }),
      P95_TEXT,
    );
  });

  test.each([
    ["loading", { loading: true }],
    ["no data", { series: [{ seriesName: "p95", data: [] }] }],
    ["data", {}],
  ])(
    "%s without a description: no (i)",
    (_: string, options: ChartCardOptions) => {
      renderChartCard({ ...options, description: undefined });

      expect(screen.getByText("p95 duration")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /^About / }),
      ).not.toBeInTheDocument();
    },
  );

  test("the (i) follows the title inside the header, not the icon badge", () => {
    renderChartCard();

    const info: HTMLElement = screen.getByRole("button", {
      name: "About p95 duration",
    });

    expect(info.previousElementSibling).toHaveTextContent("p95 duration");
  });
});

/* ------------------------------------------------------------------ */
/* Infrastructure GoldenMetricTile                                     */
/* ------------------------------------------------------------------ */

describe("Infrastructure GoldenMetricTile", () => {
  test("a description becomes the (i)'s tooltip", async () => {
    render(
      <InfraGoldenMetricTile
        title="CPU"
        icon={IconProp.Activity}
        iconColor="blue"
        value="42%"
        sublabel="of allocatable"
        percent={42}
        description="Processor time used across the cluster, as a share of what the nodes can allocate."
      />,
    );

    expect(screen.getByText("42%")).toBeInTheDocument();
    expect(screen.getByText("of allocatable")).toBeInTheDocument();
    await expectTooltip(
      screen.getByRole("button", { name: "About CPU" }),
      "Processor time used across the cluster, as a share of what the nodes can allocate.",
    );
  });

  test("no description, no (i)", () => {
    render(
      <InfraGoldenMetricTile
        title="CPU"
        icon={IconProp.Activity}
        iconColor="blue"
        value="42%"
      />,
    );

    expect(screen.getByText("CPU")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  test("the (i) follows the title", () => {
    render(
      <InfraGoldenMetricTile
        title="Pods"
        icon={IconProp.Cube}
        iconColor="emerald"
        value="12"
        description="Pods running in the cluster right now."
      />,
    );

    expect(
      screen.getByRole("button", { name: "About Pods" }).previousElementSibling,
    ).toHaveTextContent("Pods");
  });
});

/* ------------------------------------------------------------------ */
/* WebVitalsCard                                                       */
/* ------------------------------------------------------------------ */

function vitalsWith(
  value: (d: WebVitalDefinition) => number | null,
): Array<WebVital> {
  return WebVitalDefinitions.map((d: WebVitalDefinition): WebVital => {
    return {
      key: d.key,
      label: d.label,
      description: d.description,
      value: value(d),
      unit: d.unit,
      thresholds: d.thresholds,
    };
  });
}

const CARD_TEXT: string =
  "Standard measures of how fast and stable your pages feel to real visitors.";

describe("WebVitalsCard", () => {
  test("the card title carries an (i) with the card's description", async () => {
    render(
      <WebVitalsCard
        vitals={vitalsWith(() => {
          return 100;
        })}
        loading={false}
        description={CARD_TEXT}
      />,
    );

    const info: HTMLElement = screen.getByRole("button", {
      name: "About Core Web Vitals",
    });

    expect(info.querySelector("svg")).toHaveClass("h-4", "w-4");
    await expectTooltip(info, CARD_TEXT);
  });

  test("without a description the title is plain text", () => {
    render(
      <WebVitalsCard
        vitals={vitalsWith(() => {
          return 100;
        })}
        loading={false}
      />,
    );

    expect(screen.getByText("Core Web Vitals")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "About Core Web Vitals" }),
    ).not.toBeInTheDocument();
  });

  test("each reported vital has an (i) named after its short and long name", () => {
    render(
      <WebVitalsCard
        vitals={vitalsWith((d: WebVitalDefinition) => {
          return d.thresholds.warn / 2;
        })}
        loading={false}
      />,
    );

    for (const d of WebVitalDefinitions) {
      expect(
        screen.getByRole("button", {
          name: `About ${d.key.toUpperCase()} (${d.label})`,
        }),
      ).toBeInTheDocument();
    }
  });

  test.each(
    WebVitalDefinitions.map(
      (d: WebVitalDefinition): [string, WebVitalDefinition] => {
        return [d.key, d];
      },
    ),
  )(
    "%s: the tooltip is what it measures, then its Good / Poor limits",
    async (_: string, d: WebVitalDefinition) => {
      render(
        <WebVitalsCard
          vitals={vitalsWith((def: WebVitalDefinition) => {
            return def.thresholds.warn / 2;
          })}
          loading={false}
        />,
      );

      await expectTooltip(
        screen.getByRole("button", {
          name: `About ${d.key.toUpperCase()} (${d.label})`,
        }),
        `${d.description} ${describeWebVitalThresholds(d)}`,
      );
    },
  );

  test("the LCP limits read the way a person says them", async () => {
    render(
      <WebVitalsCard
        vitals={vitalsWith(() => {
          return 1000;
        })}
        loading={false}
      />,
    );

    await hover(
      screen.getByRole("button", {
        name: "About LCP (Largest Contentful Paint)",
      }),
    );

    expect(screen.getByRole("tooltip").textContent).toMatch(
      /Good below 2\.5 s; poor at 4 s or more\.$/,
    );
  });

  test("a vital with no value still explains itself when others reported", () => {
    render(
      <WebVitalsCard
        vitals={vitalsWith((d: WebVitalDefinition) => {
          return d.key === "lcp" ? 1200 : null;
        })}
        loading={false}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: "About INP (Interaction to Next Paint)",
      }),
    ).toBeInTheDocument();
  });

  test("the empty state shows no per-vital (i), but the card's own (i) stays", () => {
    render(
      <WebVitalsCard
        vitals={vitalsWith(() => {
          return null;
        })}
        loading={false}
        description={CARD_TEXT}
      />,
    );

    expect(screen.getByText("No web vitals reported yet")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^About / })).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "About Core Web Vitals" }),
    ).toBeInTheDocument();
  });

  test("while loading, only the card's (i) is shown", () => {
    render(
      <WebVitalsCard vitals={[]} loading={true} description={CARD_TEXT} />,
    );

    expect(screen.getAllByRole("button", { name: /^About / })).toHaveLength(1);
  });
});

describe("describeWebVital", () => {
  function vital(key: string): WebVital {
    return vitalsWith(() => {
      return 1;
    }).find((v: WebVital): boolean => {
      return v.key === key;
    })!;
  }

  test.each([
    ["lcp", "Good below 2.5 s; poor at 4 s or more."],
    ["inp", "Good below 200 ms; poor at 500 ms or more."],
    ["cls", "Good below 0.1; poor at 0.25 or more."],
    ["fcp", "Good below 1.8 s; poor at 3 s or more."],
    ["ttfb", "Good below 800 ms; poor at 1.8 s or more."],
  ])(
    "%s: description, one space, then the limits",
    (key: string, limits: string) => {
      const v: WebVital = vital(key);

      expect(describeWebVital(v)).toBe(`${v.description} ${limits}`);
    },
  );

  test("with no description it is just the limits, with no leading space", () => {
    expect(describeWebVital({ ...vital("cls"), description: "" })).toBe(
      "Good below 0.1; poor at 0.25 or more.",
    );
  });

  test("the limits follow the vital's own thresholds, so a change cannot leave the tooltip stale", () => {
    expect(
      describeWebVital({
        ...vital("lcp"),
        description: "Largest paint.",
        thresholds: { warn: 3000, danger: 6000 },
      }),
    ).toBe("Largest paint. Good below 3 s; poor at 6 s or more.");
  });
});

/* ------------------------------------------------------------------ */
/* ResourceOverviewTab summary fields                                  */
/* ------------------------------------------------------------------ */

describe("ResourceOverviewTab summary fields", () => {
  test("a field with a description gets an (i); one without does not", async () => {
    render(
      <ResourceOverviewTab
        summaryFields={[
          {
            title: "Ready",
            value: "3/3",
            description:
              "Pods that passed their readiness check, out of the pods wanted.",
          },
          { title: "Namespace", value: "default" },
        ]}
        labels={{}}
        annotations={{}}
        isLoading={false}
      />,
    );

    expect(screen.getByText("3/3")).toBeInTheDocument();
    expect(screen.getByText("default")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^About / })).toHaveLength(1);
    await expectTooltip(
      screen.getByRole("button", { name: "About Ready" }),
      "Pods that passed their readiness check, out of the pods wanted.",
    );
  });

  test("an element value keeps its (i)", () => {
    render(
      <ResourceOverviewTab
        summaryFields={[
          {
            title: "Restarts",
            value: <span data-testid="restarts">7</span>,
            description: "Container restarts since the pod was created.",
          },
        ]}
        labels={{}}
        annotations={{}}
        isLoading={false}
      />,
    );

    expect(screen.getByTestId("restarts")).toHaveTextContent("7");
    expect(
      screen.getByRole("button", { name: "About Restarts" }),
    ).toBeInTheDocument();
  });

  test("the summary cards are not clickable, so the (i) is the only control", () => {
    render(
      <ResourceOverviewTab
        summaryFields={[
          {
            title: "Ready",
            value: "3/3",
            description: "Pods that passed their readiness check.",
          },
        ]}
        labels={{}}
        annotations={{}}
        isLoading={false}
      />,
    );

    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/* ResourceTable / KubernetesResourceTable header tooltips             */
/* ------------------------------------------------------------------ */

const RESOURCES: Array<InfrastructureResource> = [
  {
    name: "api",
    namespace: "prod",
    cpuUtilization: 12,
    memoryUsageBytes: 200 * 1024 * 1024,
    memoryLimitBytes: 512 * 1024 * 1024,
    status: "Running",
    age: "3d",
    additionalAttributes: { restarts: "0" },
  },
  {
    name: "web",
    namespace: "prod",
    cpuUtilization: 140,
    memoryUsageBytes: 100 * 1024 * 1024,
    memoryLimitBytes: null,
    status: "Running",
    age: "1d",
    additionalAttributes: { restarts: "4" },
  },
];

const BUILT_IN: {
  status: string;
  cpu: string;
  memory: string;
  age: string;
} = {
  status: "The phase the pod reported most recently.",
  cpu: "Processor time used by the pod's containers - 100% is one full CPU core, so it can exceed 100%.",
  memory:
    "Memory the pod's containers are using, as a share of their limit when one is set.",
  age: "How long ago the pod was created.",
};

const RESTARTS_TEXT: string =
  "How many times the pod's containers were restarted since it was created.";

function headerInfo(): Array<string> {
  return screen
    .getAllByRole("button", { name: /^About / })
    .map((b: HTMLElement): string => {
      return b.getAttribute("aria-label") || "";
    });
}

describe("ResourceTable header tooltips", () => {
  test("built-in column descriptions become header (i)s", async () => {
    render(
      <ResourceTable
        resources={RESOURCES}
        title="Pods"
        description="Pods in the cluster."
        builtInColumnDescriptions={BUILT_IN}
      />,
    );

    expect(headerInfo()).toEqual([
      "About Status",
      "About CPU",
      "About Memory",
      "About Age",
    ]);

    for (const info of screen.getAllByRole("button", { name: /^About / })) {
      expect(info.closest("thead")).not.toBeNull();
    }

    await expectTooltip(
      screen.getByRole("button", { name: "About CPU" }),
      BUILT_IN.cpu,
    );
  });

  test.each([
    ["status", "About Status"],
    ["cpu", "About CPU"],
    ["memory", "About Memory"],
    ["age", "About Age"],
  ] as Array<[keyof typeof BUILT_IN, string]>)(
    "the %s description is shown on that column only",
    async (key: keyof typeof BUILT_IN, name: string) => {
      render(
        <ResourceTable
          resources={RESOURCES}
          title="Pods"
          description="Pods in the cluster."
          builtInColumnDescriptions={{ [key]: BUILT_IN[key] }}
        />,
      );

      expect(headerInfo()).toEqual([name]);
      await expectTooltip(screen.getByRole("button", { name }), BUILT_IN[key]);
    },
  );

  test("a custom column's description becomes its header (i)", async () => {
    render(
      <ResourceTable
        resources={RESOURCES}
        title="Pods"
        description="Pods in the cluster."
        columns={[
          { title: "Restarts", key: "restarts", description: RESTARTS_TEXT },
          { title: "Node", key: "node" },
        ]}
      />,
    );

    expect(headerInfo()).toEqual(["About Restarts"]);
    await expectTooltip(
      screen.getByRole("button", { name: "About Restarts" }),
      RESTARTS_TEXT,
    );
  });

  test("without any descriptions the table has no (i) at all", () => {
    render(
      <ResourceTable
        resources={RESOURCES}
        title="Pods"
        description="Pods in the cluster."
        columns={[{ title: "Restarts", key: "restarts" }]}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /^About / }),
    ).not.toBeInTheDocument();
  });

  test("hidden built-in columns take their (i) with them", () => {
    render(
      <ResourceTable
        resources={RESOURCES}
        title="Pods"
        description="Pods in the cluster."
        showStatus={false}
        showResourceMetrics={false}
        builtInColumnDescriptions={BUILT_IN}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /^About / }),
    ).not.toBeInTheDocument();
  });

  test("the CPU column still sorts when it carries an (i), and the (i) does not sort", () => {
    render(
      <ResourceTable
        resources={RESOURCES}
        title="Pods"
        description="Pods in the cluster."
        builtInColumnDescriptions={BUILT_IN}
      />,
    );

    const rowNames: () => Array<string> = (): Array<string> => {
      return Array.from(document.querySelectorAll("tbody tr"))
        .map((tr: Element): string => {
          return tr.querySelector("td")?.textContent?.trim() || "";
        })
        .filter(Boolean);
    };

    const before: Array<string> = rowNames();
    fireEvent.click(screen.getByRole("button", { name: "About CPU" }));
    expect(rowNames()).toEqual(before);

    // First click sorts descending (the table starts ascending).
    fireEvent.click(screen.getByRole("button", { name: "CPU" }));
    expect(rowNames()).toEqual(["web", "api"]);

    fireEvent.click(screen.getByRole("button", { name: "CPU" }));
    expect(rowNames()).toEqual(["api", "web"]);
  });

  test("the cell values render unchanged", () => {
    render(
      <ResourceTable
        resources={RESOURCES}
        title="Pods"
        description="Pods in the cluster."
        builtInColumnDescriptions={BUILT_IN}
      />,
    );

    expect(screen.getAllByText("140.0%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("12.0%").length).toBeGreaterThan(0);
  });
});

describe("KubernetesResourceTable passes the descriptions through", () => {
  test("built-in and custom column descriptions both reach the header", async () => {
    render(
      <KubernetesResourceTable
        resources={RESOURCES}
        title="Pods"
        description="Pods in the cluster."
        showNamespace={true}
        columns={[
          { title: "Restarts", key: "restarts", description: RESTARTS_TEXT },
        ]}
        builtInColumnDescriptions={BUILT_IN}
      />,
    );

    expect(screen.getByText("Namespace")).toBeInTheDocument();
    expect(headerInfo()).toEqual([
      "About Status",
      "About Restarts",
      "About CPU",
      "About Memory",
      "About Age",
    ]);

    await expectTooltip(
      screen.getByRole("button", { name: "About Restarts" }),
      RESTARTS_TEXT,
    );
    await expectTooltip(
      screen.getByRole("button", { name: "About Memory" }),
      BUILT_IN.memory,
    );
  });

  test("without descriptions it renders as before, with no (i)", () => {
    render(
      <KubernetesResourceTable
        resources={RESOURCES}
        title="Pods"
        description="Pods in the cluster."
        columns={[{ title: "Restarts", key: "restarts" }]}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /^About / }),
    ).not.toBeInTheDocument();
  });
});
