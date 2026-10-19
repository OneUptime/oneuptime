import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import Hostname from "../../../Types/API/Hostname";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import URL from "../../../Types/API/URL";
import MetricsViewConfig from "../../../Types/Metrics/MetricsViewConfig";
import DnsRecordType from "../../../Types/Monitor/DnsMonitor/DnsRecordType";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteria from "../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import { KubernetesResourceScope } from "../../../Types/Monitor/MonitorStepKubernetesMonitor";
import Port from "../../../Types/Port";
import MonitorStep, {
  MonitorStepType,
} from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import Service from "../../../Models/DatabaseModels/Service";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import Probe from "../../../Models/DatabaseModels/Probe";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * WHAT THIS FILE PROTECTS
 *
 * This is the monitor "Criteria" page's step viewer, rendered for real.
 * The bug it pins: for most monitor types the page showed criteria and
 * nothing else — no destination, no metric name, no host — while the edit
 * modal showed the whole configuration. MonitorStepViewModel.test.ts holds
 * the mapping from step to rows; this file holds the other half, that the
 * component actually PUTS those rows on the page (and, for metric monitors,
 * the chart preview beside them).
 *
 * The metric preview is stubbed: it is the metric explorer's chart stack,
 * and what matters here is that the viewer hands it the right config, not
 * that ClickHouse answers.
 */

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getItem: (...args: Array<any>) => {
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

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorSteps/MonitorStepMetricPreview",
  () => {
    return {
      __esModule: true,
      default: (props: {
        metricsViewConfig: MetricsViewConfig;
        rollingTime: RollingTime | undefined;
      }) => {
        return (
          <div data-testid="metric-preview">
            {`${props.metricsViewConfig.queryConfigs.length} queries over ${props.rollingTime}`}
          </div>
        );
      },
    };
  },
);

// Imported after the mocks above so the component picks them up.
import MonitorStepElement from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorSteps/MonitorStep";

/*
 * The heading of the criteria section is the word "Criteria", which is also
 * the default NAME of a criteria instance — so the heading alone is an
 * ambiguous query. The description under it is unique to the section.
 */
const CRITERIA_SECTION_DESCRIPTION: string =
  "Criteria we will use to determine your resource status.";

const METRIC_VIEW_CONFIG: MetricsViewConfig = {
  queryConfigs: [
    {
      metricAliasData: {
        metricVariable: "a",
        title: "CPU Usage",
        description: undefined,
        legend: undefined,
        legendUnit: undefined,
      },
      metricQueryData: {
        filterData: {
          metricName: "container.cpu.usage",
          aggegationType: AggregationType.Avg,
        },
      },
    },
  ],
  formulaConfigs: [],
};

function buildStep(data: Partial<MonitorStepType>): MonitorStep {
  const monitorStep: MonitorStep = new MonitorStep();

  monitorStep.data = {
    ...(monitorStep.data as MonitorStepType),
    monitorCriteria: new MonitorCriteria(),
    ...data,
  } as MonitorStepType;

  return monitorStep;
}

function renderStep(monitorType: MonitorType, monitorStep: MonitorStep): void {
  render(
    <MemoryRouter>
      <MonitorStepElement
        monitorType={monitorType}
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
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getListMock.mockReset();
  getItemMock.mockReset();
  getListMock.mockResolvedValue({ data: [], count: 0, skip: 0, limit: 0 });
  getItemMock.mockResolvedValue(null);
});

describe("Monitor criteria page — metric monitors", () => {
  it("names the metric and the window instead of showing an empty section", async () => {
    renderStep(
      MonitorType.Metrics,
      buildStep({
        metricMonitor: {
          metricViewConfig: METRIC_VIEW_CONFIG,
          rollingTime: RollingTime.Past30Minutes,
          telemetryServiceIds: [],
        },
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("Metrics")).toBeInTheDocument();
    });

    expect(
      screen.getByText("CPU Usage (container.cpu.usage · Avg)"),
    ).toBeInTheDocument();
    expect(screen.getByText("Time Range")).toBeInTheDocument();
    expect(screen.getByText(RollingTime.Past30Minutes)).toBeInTheDocument();
  });

  it("renders the metric preview with the step's own config", async () => {
    renderStep(
      MonitorType.Metrics,
      buildStep({
        metricMonitor: {
          metricViewConfig: METRIC_VIEW_CONFIG,
          rollingTime: RollingTime.Past30Minutes,
          telemetryServiceIds: [],
        },
      }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("metric-preview")).toHaveTextContent(
        "1 queries over Past 30 Minutes",
      );
    });
  });

  it("shows the host an infrastructure monitor watches", async () => {
    renderStep(
      MonitorType.Host,
      buildStep({
        hostMonitor: {
          hostIdentifier: "web-1",
          metricViewConfig: METRIC_VIEW_CONFIG,
          rollingTime: RollingTime.Past5Minutes,
        },
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("web-1")).toBeInTheDocument();
    });

    expect(screen.getByTestId("metric-preview")).toBeInTheDocument();
  });

  it("shows the Kubernetes cluster and its resource filters", async () => {
    renderStep(
      MonitorType.Kubernetes,
      buildStep({
        kubernetesMonitor: {
          clusterIdentifier: "prod-cluster",
          resourceScope: KubernetesResourceScope.Workload,
          resourceFilters: { namespace: "payments" },
          metricViewConfig: METRIC_VIEW_CONFIG,
          rollingTime: RollingTime.Past5Minutes,
        },
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("prod-cluster")).toBeInTheDocument();
    });

    expect(screen.getByText("Namespace")).toBeInTheDocument();
    expect(screen.getByText("payments")).toBeInTheDocument();
  });
});

describe("Monitor criteria page — probe monitors", () => {
  it("still shows the API destination and request type", async () => {
    renderStep(
      MonitorType.API,
      buildStep({
        monitorDestination: URL.fromString("https://api.example.com/health"),
        requestType: HTTPMethod.POST,
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("API URL")).toBeInTheDocument();
    });

    expect(
      screen.getByText("https://api.example.com/health"),
    ).toBeInTheDocument();
    expect(screen.getByText(HTTPMethod.POST)).toBeInTheDocument();
  });

  it("shows the SSL certificate monitor's destination", async () => {
    renderStep(
      MonitorType.SSLCertificate,
      buildStep({
        monitorDestination: URL.fromString("https://secure.example.com"),
      }),
    );

    await waitFor(() => {
      expect(
        // URL.toString() renders the root path explicitly.
        screen.getByText("https://secure.example.com/"),
      ).toBeInTheDocument();
    });
  });

  it("shows the port monitor's host and port", async () => {
    renderStep(
      MonitorType.Port,
      buildStep({
        monitorDestination: new Hostname("db.example.com"),
        monitorDestinationPort: new Port(5432),
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("db.example.com")).toBeInTheDocument();
    });

    expect(screen.getByText("5432")).toBeInTheDocument();
  });

  it("shows the DNS query, record type and resolver", async () => {
    renderStep(
      MonitorType.DNS,
      buildStep({
        dnsMonitor: {
          queryName: "example.com",
          recordType: DnsRecordType.A,
          hostname: "8.8.8.8",
          port: 53,
          timeout: 5000,
          retries: 3,
        },
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("example.com")).toBeInTheDocument();
    });

    expect(screen.getByText("Record Type")).toBeInTheDocument();
    expect(screen.getByText("8.8.8.8")).toBeInTheDocument();
  });
});

describe("Monitor criteria page — resolved references", () => {
  it("names the telemetry services a log monitor is scoped to", async () => {
    const service: Service = new Service();
    service.id = new ObjectID("11111111-1111-4111-8111-111111111111");
    service.name = "checkout";

    getListMock.mockResolvedValue({
      data: [service],
      count: 1,
      skip: 0,
      limit: 10,
    });

    renderStep(
      MonitorType.Logs,
      buildStep({
        logMonitor: {
          attributes: {},
          body: "timeout",
          severityTexts: [],
          telemetryServiceIds: [
            new ObjectID("11111111-1111-4111-8111-111111111111"),
          ],
          lastXSecondsOfLogs: 60,
        },
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("checkout")).toBeInTheDocument();
    });

    expect(screen.getByText("Telemetry Services")).toBeInTheDocument();
  });

  it("names the network device a network device monitor alerts on", async () => {
    const networkDevice: NetworkDevice = new NetworkDevice();
    networkDevice.name = "core-switch-1";

    getItemMock.mockResolvedValue(networkDevice);

    renderStep(
      MonitorType.NetworkDevice,
      buildStep({
        networkDeviceMonitor: {
          networkDeviceId: "44444444-4444-4444-8444-444444444444",
          monitorInterfaces: true,
          collectEndpoints: false,
          oids: [],
        },
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("core-switch-1")).toBeInTheDocument();
    });
  });

  it("falls back to the stored id when the network device no longer resolves", async () => {
    getItemMock.mockResolvedValue(null);

    renderStep(
      MonitorType.NetworkDevice,
      buildStep({
        networkDeviceMonitor: {
          networkDeviceId: "44444444-4444-4444-8444-444444444444",
          monitorInterfaces: true,
          collectEndpoints: false,
          oids: [],
        },
      }),
    );

    await waitFor(() => {
      expect(
        screen.getByText("44444444-4444-4444-8444-444444444444"),
      ).toBeInTheDocument();
    });
  });
});

/*
 * A Probe Status monitor watches probes; no probe runs it. Its Criteria page
 * names the probes it watches - the project's own and the global ones, read
 * as the picker reads them - and its Monitor Details section does not claim
 * that "the probes check this resource".
 */
describe("Monitor criteria page — Probe Status monitors", () => {
  const FRANKFURT_ID: string = "7c000000-0000-4000-8000-000000000001";
  const GLOBAL_ID: string = "7c000000-0000-4000-8000-000000000002";
  const DELETED_ID: string = "7c000000-0000-4000-8000-000000000099";

  beforeEach(() => {
    getListMock.mockImplementation(
      (options: {
        requestOptions?: { overrideRequestUrl?: URL } | undefined;
      }) => {
        const isGlobalList: boolean = String(
          options.requestOptions?.overrideRequestUrl || "",
        ).includes("/probe/global-probes");
        const probe: Probe = new Probe();

        probe._id = isGlobalList ? GLOBAL_ID : FRANKFURT_ID;
        probe.name = isGlobalList
          ? "Bundled probe"
          : "Frankfurt (eu-central-1)";

        return Promise.resolve({ data: [probe], count: 1, skip: 0, limit: 1 });
      },
    );
  });

  it("names each probe it watches, the global ones too", async () => {
    renderStep(
      MonitorType.ProbeStatus,
      buildStep({
        probeStatusMonitor: { probeIds: [FRANKFURT_ID, GLOBAL_ID] },
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("Probes to Watch")).toBeInTheDocument();
    });

    expect(screen.getByTestId("monitor-step-details")).toHaveTextContent(
      "Frankfurt (eu-central-1), Bundled probe",
    );
  });

  it("a watched probe that was deleted reads as such, not as an id", async () => {
    renderStep(
      MonitorType.ProbeStatus,
      buildStep({
        probeStatusMonitor: { probeIds: [FRANKFURT_ID, DELETED_ID] },
      }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("monitor-step-details")).toHaveTextContent(
        "Frankfurt (eu-central-1), Deleted probe",
      );
    });

    expect(
      screen.getByTestId("monitor-step-details").textContent,
    ).not.toContain(DELETED_ID);
  });

  it("says what Monitor Details holds without claiming the probes check it", async () => {
    renderStep(
      MonitorType.ProbeStatus,
      buildStep({ probeStatusMonitor: { probeIds: [FRANKFURT_ID] } }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("monitor-step-details")).toHaveTextContent(
        "What this monitor watches, and the settings it uses.",
      );
    });

    expect(screen.getByTestId("monitor-step-details")).not.toHaveTextContent(
      "How the probes check this resource",
    );
  });

  it("a probe-run monitor still says how its probes check it", async () => {
    renderStep(
      MonitorType.API,
      buildStep({
        monitorDestination: URL.fromString("https://api.example.com/health"),
        requestType: HTTPMethod.GET,
      }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("monitor-step-details")).toHaveTextContent(
        "How the probes check this resource: what they connect to and the settings they use.",
      );
    });
  });
});

describe("Monitor criteria page — types without step configuration", () => {
  it("hides the Monitor Details section for incoming request monitors but still shows criteria", async () => {
    renderStep(MonitorType.IncomingRequest, buildStep({}));

    await waitFor(() => {
      expect(
        screen.getByText(CRITERIA_SECTION_DESCRIPTION),
      ).toBeInTheDocument();
    });

    expect(
      screen.queryByTestId("monitor-step-details"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Monitor Details")).not.toBeInTheDocument();
  });

  it("always renders the criteria section, whatever the monitor type", async () => {
    renderStep(
      MonitorType.Website,
      buildStep({
        monitorDestination: URL.fromString("https://example.com"),
      }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(CRITERIA_SECTION_DESCRIPTION),
      ).toBeInTheDocument();
    });

    expect(screen.getByTestId("monitor-step-details")).toBeInTheDocument();
  });
});

/*
 * A window on a JavaScript expression is judged check by check where the
 * expression keeps a match history - an API or Website monitor - and not on
 * a SQL Query monitor, whose window the server does not judge that way. The
 * criteria list reads each as the monitor it is on judges it.
 */
describe("Monitor criteria page — a filter's window reads as its monitor judges it", () => {
  function criteriaWith(criteriaFilter: CriteriaFilter): MonitorCriteria {
    const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
    instance.data = {
      id: "starting",
      monitorStatusId: undefined,
      filterCondition: FilterCondition.All,
      filters: [criteriaFilter],
      incidents: [],
      alerts: [],
      name: "Starting",
      description: "",
      isEnabled: true,
    };

    const monitorCriteria: MonitorCriteria = new MonitorCriteria();
    monitorCriteria.data = { monitorCriteriaInstanceArray: [instance] };
    return monitorCriteria;
  }

  function expressionWithWindow(expression: string): CriteriaFilter {
    return {
      checkOn: CheckOn.JavaScriptExpression,
      filterType: FilterType.EvaluatesToTrue,
      value: expression,
      evaluateOverTime: true,
      evaluateOverTimeOptions: {
        timeValueInMinutes: 5,
        evaluateOverTimeType: EvaluateOverTimeType.AllValues,
      },
    };
  }

  it("on an API monitor, says the expression must be true on every check of the window", async () => {
    renderStep(
      MonitorType.API,
      buildStep({
        monitorDestination: URL.fromString("https://example.com/health"),
        requestType: HTTPMethod.GET,
        monitorCriteria: criteriaWith(
          expressionWithWindow("'{{responseBody.status}}' === 'starting'"),
        ),
      }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(
          "Check if JavaScript expression '{{responseBody.status}}' === 'starting' - evaluates to true on every check in the past 5 minutes.",
        ),
      ).toBeInTheDocument();
    });
  });

  it("on a SQL Query monitor, claims no check-by-check wait", async () => {
    renderStep(
      MonitorType.SQLQuery,
      buildStep({
        monitorCriteria: criteriaWith(expressionWithWindow("{{rowCount}} > 0")),
      }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(CRITERIA_SECTION_DESCRIPTION),
      ).toBeInTheDocument();
    });

    expect(document.body.textContent).toContain(
      "{{rowCount}} > 0 - evaluates to true",
    );
    expect(document.body.textContent).not.toContain("on every check");
  });
});
