import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * IMPORT FROM GRAFANA OR DATADOG and IMPORT ALERTS (issue #7697), rendered
 * for real against stand-ins of the server: a file is pasted, read in the
 * browser, previewed item by item - exact, approximate, or not converted
 * and why - and only Create makes anything, through the create the forms
 * use. A query no rule converted goes to OneUptime AI only when asked, and
 * is used only once the person reads it and picks Use This Query.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
        i18n: { language: "en" },
      };
    },
  };
});

import ImportAlertsModal from "../../../../App/FeatureSet/Dashboard/src/Components/ObservabilityImport/ImportAlertsModal";
import ImportDashboardModal from "../../../../App/FeatureSet/Dashboard/src/Components/ObservabilityImport/ImportDashboardModal";
import MetricUtil from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics";
import Metric, {
  AggregationTemporality,
} from "../../../Models/AnalyticsModels/Metric";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import { MetricMonitorQueryLanguage } from "../../../Types/Monitor/MonitorStepMetricMonitor";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { ImportItemStatus } from "../../../Types/ObservabilityImport/ObservabilityImport";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import { IMPORT_ALERTS_ON_DASHBOARDS } from "../../../Utils/ObservabilityImport/ImportSource";
import { MODAL_NEXT_BUTTON_TEST_ID } from "../../../UI/Components/Forms/Utils/SteppedFormFooter";
import { readFixture } from "../../Utils/ObservabilityImport/ImportFixtures";

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";

type Created = { model: Dashboard | Monitor };

let created: Array<Created>;
let posted: Array<JSONObject>;

const status: (data: {
  operational?: boolean;
  offline?: boolean;
  priority: number;
}) => MonitorStatus = (data: {
  operational?: boolean;
  offline?: boolean;
  priority: number;
}): MonitorStatus => {
  const item: MonitorStatus = new MonitorStatus();
  item._id = ObjectID.generate().toString();
  item.isOperationalState = Boolean(data.operational);
  item.isOfflineState = Boolean(data.offline);
  item.priority = data.priority;
  return item;
};

beforeEach(() => {
  created = [];
  posted = [];

  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));

  jest.spyOn(ModelAPI, "getList").mockImplementation((async (args: {
    modelType: unknown;
  }) => {
    let data: Array<unknown> = [];

    if (args.modelType === MonitorStatus) {
      data = [
        status({ operational: true, priority: 1 }),
        status({ priority: 2 }),
        status({ offline: true, priority: 3 }),
      ];
    } else if (args.modelType === IncidentSeverity) {
      data = [new IncidentSeverity(), new IncidentSeverity()].map(
        (item: IncidentSeverity) => {
          item._id = ObjectID.generate().toString();
          return item;
        },
      );
    } else if (args.modelType === AlertSeverity) {
      data = [new AlertSeverity(), new AlertSeverity()].map(
        (item: AlertSeverity) => {
          item._id = ObjectID.generate().toString();
          return item;
        },
      );
    } else if (args.modelType === Monitor) {
      const taken: Monitor = new Monitor();
      taken.name = "InstanceDown";
      data = [taken];
    } else if (args.modelType === MetricType) {
      // The project has checkout.orders, a gauge as the Agent sends a rate.
      const orders: MetricType = new MetricType();
      orders.name = "checkout.orders";
      orders.aggregationTemporality = AggregationTemporality.Cumulative;
      data = [orders];
    }

    return { data, count: data.length, skip: 0, limit: 100 };
  }) as never);

  jest.spyOn(ModelAPI, "create").mockImplementation((async (args: Created) => {
    created.push(args);
    return new HTTPResponse(200, args.model as unknown as JSONObject, {});
  }) as never);

  jest
    .spyOn(MetricUtil, "getTelemetryAttributeValues")
    .mockResolvedValue(["checkout-2", "checkout-1"] as never);

  jest.spyOn(API, "post").mockImplementation((async (args: {
    data: JSONObject;
  }) => {
    posted.push(args.data);
    return new HTTPResponse(
      200,
      {
        promQL:
          "sum(rate(http_request_duration_seconds_sum[5m])) / sum(rate(http_request_duration_seconds_count[5m]))",
        explanation: "The mean request duration.",
      },
      {},
    );
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

const paste: (text: string) => void = (text: string): void => {
  fireEvent.change(screen.getByTestId("import-text"), {
    target: { value: text },
  });
};

// Preview: the file step's way on, a plain Next.
const preview: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    fireEvent.click(screen.getByTestId(MODAL_NEXT_BUTTON_TEST_ID));
  });
};

// Create: the preview's one primary button.
const submit: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
  });
};

const rowTitled: (title: string) => HTMLElement = (
  title: string,
): HTMLElement => {
  const row: HTMLElement | undefined = screen
    .getAllByTestId("import-item")
    .find((candidate: HTMLElement): boolean => {
      return within(candidate).queryByText(title) !== null;
    });

  if (!row) {
    throw new Error(`no row titled ${title}`);
  }

  return row;
};

describe("Import from Grafana or Datadog", () => {
  const renderModal: (
    onCreated: (dashboard: Dashboard) => void,
  ) => Promise<void> = async (
    onCreated: (dashboard: Dashboard) => void,
  ): Promise<void> => {
    await act(async () => {
      render(
        <MemoryRouter>
          <ImportDashboardModal onClose={() => {}} onCreated={onCreated} />
        </MemoryRouter>,
      );
    });
  };

  test("a Grafana dashboard is previewed panel by panel, and created only with Create Dashboard", async () => {
    const onCreated: jest.Mock = jest.fn();

    await renderModal(onCreated as never);
    paste(readFixture("grafana-mixed-loki-prometheus.json"));
    await preview();

    expect(screen.getByTestId("dashboard-import-preview")).toBeInTheDocument();
    expect(created).toHaveLength(0);

    // Each panel says how it converts, and a panel not converted says why.
    expect(
      within(rowTitled("Error ratio")).getByTestId(
        `import-status-${ImportItemStatus.Exact}`,
      ),
    ).toBeInTheDocument();
    expect(
      within(rowTitled("Latency heatmap")).getByTestId(
        `import-status-${ImportItemStatus.NotConverted}`,
      ),
    ).toBeInTheDocument();
    expect(
      within(rowTitled("Latency heatmap")).getByTestId("import-notes"),
    ).toHaveTextContent(
      "OneUptime has no widget like Grafana's heatmap panel.",
    );

    // The dashboard's name, from the file's title.
    expect(screen.getByTestId("dashboard-import-name")).toHaveValue(
      "Checkout service",
    );

    await submit();

    expect(created).toHaveLength(1);

    const dashboard: Dashboard = created[0]!.model as Dashboard;

    expect(dashboard.name).toBe("Checkout service");
    expect(dashboard.projectId?.toString()).toBe(PROJECT_ID);
    expect(
      (dashboard.dashboardViewConfig as unknown as JSONObject)["components"],
    ).toBeDefined();
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  test("a file for the other screen says where it goes, and nothing is previewed", async () => {
    await renderModal(() => {});
    paste(readFixture("prometheus-rules.yaml"));
    await preview();

    expect(screen.queryByTestId("dashboard-import-preview")).toBeNull();
    expect(screen.getByText(IMPORT_ALERTS_ON_DASHBOARDS)).toBeInTheDocument();
  });

  test("OneUptime AI is asked only when the person asks, with the query alone, and its answer used only once picked", async () => {
    await renderModal(() => {});
    paste(readFixture("grafana-mixed-loki-prometheus.json"));
    await preview();

    expect(posted).toHaveLength(0);

    const native: HTMLElement = rowTitled("Native histogram");

    await act(async () => {
      fireEvent.click(within(native).getByTestId("import-ai-convert"));
    });

    expect(posted).toHaveLength(1);
    expect(Object.keys(posted[0]!).sort()).toEqual([
      "language",
      "query",
      "variableNames",
    ]);
    expect(posted[0]!["query"]).toBe(
      "histogram_avg(rate(http_request_duration_seconds[5m]))",
    );

    // Read before it is used: still not converted.
    expect(
      within(rowTitled("Native histogram")).getByTestId("import-ai-answer"),
    ).toHaveTextContent("The mean request duration.");
    expect(
      within(rowTitled("Native histogram")).getByTestId(
        `import-status-${ImportItemStatus.NotConverted}`,
      ),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(
        within(rowTitled("Native histogram")).getByTestId("import-ai-use"),
      );
    });

    expect(
      within(rowTitled("Native histogram")).getByTestId(
        `import-status-${ImportItemStatus.Approximate}`,
      ),
    ).toBeInTheDocument();
    expect(
      within(rowTitled("Native histogram")).getByTestId("import-notes"),
    ).toHaveTextContent("OneUptime AI converted this query.");
  });
});

describe("Import Alerts", () => {
  const renderModal: (
    onImported: (count: number) => void,
  ) => Promise<void> = async (
    onImported: (count: number) => void,
  ): Promise<void> => {
    await act(async () => {
      render(
        <MemoryRouter>
          <ImportAlertsModal onClose={() => {}} onImported={onImported} />
        </MemoryRouter>,
      );
    });
  };

  test("each converted rule becomes a Metrics monitor, named apart from the project's own", async () => {
    const onImported: jest.Mock = jest.fn();

    await renderModal(onImported as never);
    paste(readFixture("prometheus-rules.yaml"));
    await preview();

    expect(screen.getByTestId("alerts-import-preview")).toBeInTheDocument();
    expect(created).toHaveLength(0);
    expect(
      within(rowTitled("job:http_requests:rate5m")).getByTestId(
        `import-status-${ImportItemStatus.NotConverted}`,
      ),
    ).toBeInTheDocument();

    await submit();

    const monitors: Array<Monitor> = created.map((item: Created): Monitor => {
      return item.model as Monitor;
    });

    // InstanceDown, TargetMissing and HighLatency; InstanceDown is taken.
    expect(
      monitors.map((monitor: Monitor): string => {
        return monitor.name || "";
      }),
    ).toEqual(["InstanceDown 2", "TargetMissing", "HighLatency"]);

    for (const monitor of monitors) {
      expect(monitor.monitorType).toBe(MonitorType.Metrics);
      expect(
        monitor.monitorSteps?.data?.monitorStepsInstanceArray,
      ).toHaveLength(1);
    }

    expect(onImported).toHaveBeenCalledWith(3);
  });

  test("a rule the source has paused starts unticked, and is not created", async () => {
    await renderModal(() => {});
    paste(readFixture("grafana-alert-rules-export.yaml"));
    await preview();

    await submit();

    expect(
      created.map((item: Created): string => {
        return (item.model as Monitor).name || "";
      }),
    ).toEqual(["High error ratio"]);
  });

  /*
   * Datadog's anomaly, forecast and log monitors (issues #10324, #10325):
   * each becomes the monitor of what it reads, its condition said as the
   * monitor form says it.
   */
  test("Datadog's anomaly, forecast and log monitors become a Metrics monitor of one metric, a PromQL forecast and a Logs monitor", async () => {
    const monitors: Array<unknown> = [
      "datadog-monitor-nginx-5xx.json",
      "datadog-monitor-kubernetes-autoscaler-forecast.json",
      "datadog-monitor-cisco-aci-critical-fault.json",
    ].map((name: string): unknown => {
      return JSON.parse(readFixture(name));
    });

    await renderModal(() => {});
    paste(JSON.stringify(monitors));
    await preview();

    const anomaly: HTMLElement = rowTitled(
      "[NGINX] 5xx Errors higher than usual",
    );

    expect(
      within(anomaly).getByTestId(
        `import-status-${ImportItemStatus.Approximate}`,
      ),
    ).toBeInTheDocument();
    expect(within(anomaly).getByTestId("import-query")).toHaveTextContent(
      "avg by (upstream) (nginx.upstream.peers.responses.5xx)",
    );
    expect(
      within(anomaly).getByTestId("import-rule-sentence"),
    ).toHaveTextContent("is unusually high for this hour of the week");
    expect(
      within(anomaly).getByTestId("import-rule-sensitivity"),
    ).toHaveTextContent("Sensitivity High");

    const forecast: HTMLElement = rowTitled(
      "Kubernetes Cluster Autoscaler too many unused nodes forecast",
    );

    expect(
      within(forecast).getByTestId("import-rule-sentence"),
    ).toHaveTextContent("forecast to rise above");

    // Its name is longer than a monitor's: the row shows its start.
    const logs: HTMLElement | undefined = screen
      .getAllByTestId("import-item")
      .find((candidate: HTMLElement): boolean => {
        return (candidate.textContent || "").includes(
          "[Cisco ACI] critical fault received",
        );
      });

    if (!logs) {
      throw new Error("no row of the Cisco ACI monitor");
    }

    expect(within(logs).getByTestId("import-query")).toHaveTextContent(
      "@datadog.source:cisco-aci @cisco_aci.severity:critical",
    );
    expect(within(logs).getByTestId("import-rule-sentence")).toHaveTextContent(
      "Alerts when any matching log arrives in",
    );

    await submit();

    const byName: Map<string, Monitor> = new Map<string, Monitor>(
      created.map((item: Created): [string, Monitor] => {
        const monitor: Monitor = item.model as Monitor;
        return [monitor.name || "", monitor];
      }),
    );
    const stepOf: (name: string) => MonitorStep | undefined = (
      name: string,
    ): MonitorStep | undefined => {
      return byName.get(name)?.monitorSteps?.data?.monitorStepsInstanceArray[0];
    };

    expect(created).toHaveLength(3);
    expect(
      byName.get("[NGINX] 5xx Errors higher than usual")?.monitorType,
    ).toBe(MonitorType.Metrics);
    expect(
      stepOf("[NGINX] 5xx Errors higher than usual")?.data?.metricMonitor
        ?.queryLanguage,
    ).toBe(MetricMonitorQueryLanguage.Builder);
    expect(
      stepOf("Kubernetes Cluster Autoscaler too many unused nodes forecast")
        ?.data?.metricMonitor?.queryLanguage,
    ).toBe(MetricMonitorQueryLanguage.PromQL);

    const logMonitor: Monitor | undefined = Array.from(byName.values()).find(
      (monitor: Monitor): boolean => {
        return monitor.monitorType === MonitorType.Logs;
      },
    );

    expect(logMonitor).toBeDefined();
    expect(
      logMonitor?.monitorSteps?.data?.monitorStepsInstanceArray[0]?.data
        ?.logMonitor?.lastXSecondsOfLogs,
    ).toBe(300);
  });
});

describe("a DogStatsD count in a Datadog dashboard", () => {
  test("the preview asks whether the gauge is a rate and its seconds, and counts it per interval, exactly", async () => {
    const asked: Array<JSONObject> = [];
    const point: Metric = new Metric();

    point.time = new Date("2026-11-23T10:00:10.000Z");
    point.startTime = new Date("2026-11-23T10:00:00.000Z");

    jest.spyOn(AnalyticsModelAPI, "getList").mockImplementation((async (args: {
      query: JSONObject;
    }) => {
      asked.push(args.query);
      return { data: [point], count: 1, skip: 0, limit: 1 };
    }) as never);

    await act(async () => {
      render(
        <MemoryRouter>
          <ImportDashboardModal onClose={() => {}} onCreated={() => {}} />
        </MemoryRouter>,
      );
    });

    paste(
      JSON.stringify({
        title: "Checkout",
        layout_type: "ordered",
        widgets: [
          {
            definition: {
              type: "timeseries",
              title: "Orders",
              requests: [{ q: "sum:checkout.orders{*}.as_count()" }],
            },
          },
        ],
      }),
    );
    await preview();

    // Asked once, for the gauge read with .as_count(), marked as a rate.
    expect(asked).toHaveLength(1);
    expect(asked[0]!["name"]).toBe("checkout.orders");
    expect(asked[0]!["attributes"]).toEqual({ "datadog.metric.type": "rate" });

    const orders: HTMLElement = rowTitled("Orders");

    expect(
      within(orders).getByTestId(`import-status-${ImportItemStatus.Exact}`),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(within(orders).getByTestId("import-item-queries-toggle"));
    });

    expect(within(orders).getByTestId("import-query")).toHaveTextContent(
      "sum (sum_over_time(checkout_orders[$__interval]) * 10)",
    );
  });
});
