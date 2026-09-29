import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A database's Overview, rendered for real (sections and charts replaced by
 * markers), against the rows the end-to-end run found wrong:
 *
 *   - the header pill said "Connected" (green) for the traces-found
 *     `PostgreSQL orders-db.example.com:5432` (42b6aaae) right above
 *     "Engine metrics: Not connected" — the pill reads `lastSeenAt` (any
 *     source), and now says so in its own words;
 *   - the Docker database bb622879 (no address of its own, alias
 *     `e2e-receivers-postgres:5432` added) read "endpoint:
 *     Container/e2e-receivers-postgres";
 *   - a deleted id (the API answers `{}`, an EMPTY model) rendered a whole
 *     overview with setup buttons instead of "Database not found.";
 *   - Valkey cache/valkey, one pod, read "Tracked pods 2": its members
 *     include its Deployment's key 242669ec16c90df2.
 */

const PROJECT_ID_STRING: string = "21075038-d9f1-4d3a-b878-f64ae861f7be";
let mockModelIdString: string = "42b6aaae-7558-42fe-999b-395bbfc79d63";

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const aggregateMock: MockFunction = getJestMockFunction();
const runtimeSectionMock: MockFunction = getJestMockFunction();

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

// The arrow wrappers are load bearing: jest.mock is hoisted above the mocks.
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: (...args: Array<unknown>) => {
        return aggregateMock(...args);
      },
      getList: () => {
        return Promise.resolve({ data: [], count: 0 });
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (error: unknown) => {
        return (
          ((error as { message?: unknown } | null)?.message as string) ||
          "Could not load"
        );
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType(mockModelIdString);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("21075038-d9f1-4d3a-b878-f64ae861f7be");
      },
    },
  };
});

jest.mock("../../../UI/Components/Loader/PageLoader", () => {
  return {
    __esModule: true,
    default: () => {
      return <div data-testid="page-loader" />;
    },
  };
});

jest.mock("../../../UI/Components/ErrorMessage/ErrorMessage", () => {
  return {
    __esModule: true,
    default: (props: { message: string }) => {
      return <div data-testid="error-message">{props.message}</div>;
    },
  };
});

jest.mock(
  "../../../UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="time-range-picker" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ChartCard",
  () => {
    return {
      __esModule: true,
      default: (props: { title: string }) => {
        return <div data-testid="chart-card">{props.title}</div>;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/AutoRefreshControl",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="auto-refresh" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceActivity/ResourceActivityCards",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="activity-cards" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DatabaseRuntimeSection",
  () => {
    return {
      __esModule: true,
      default: (props: { memberCount: number }) => {
        runtimeSectionMock(props);
        return (
          <div data-testid="runtime-section">{`tracked:${props.memberCount}`}</div>
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DatabaseEngineMetricsSection",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="engine-section" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DatabaseCallingServicesCard",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="calling-services" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DatabaseServerUnscopedBanner",
  () => {
    return {
      __esModule: true,
      default: (props: { variant?: string }) => {
        return (
          <div data-testid="database-unscoped-banner">
            {props.variant || "unscoped"}
          </div>
        );
      },
    };
  },
);

import DatabaseServerOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/View/Overview";
import ResourceOverview, {
  RESOURCE_OVERVIEW_TITLE_BASIS_CLASS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ResourceOverview";
import IconProp from "../../../Types/Icon/IconProp";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import DatabaseServerEndpoint from "../../../Models/DatabaseModels/DatabaseServerEndpoint";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/test/databases/test"),
  currentProject: null,
  hasPaymentMethod: true,
};

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60 * 1000);
}

function endpointRows(values: Array<string>): {
  data: Array<DatabaseServerEndpoint>;
  count: number;
} {
  return {
    data: values.map((value: string): DatabaseServerEndpoint => {
      const row: DatabaseServerEndpoint = new DatabaseServerEndpoint();
      row.endpoint = value;
      return row;
    }),
    count: values.length,
  };
}

// Endpoints first; any later getList (the calling services' names) is empty.
function serveEndpoints(values: Array<string>): void {
  getListMock.mockImplementation((request: unknown) => {
    const modelType: unknown = (request as { modelType?: unknown }).modelType;
    return Promise.resolve(
      modelType === DatabaseServerEndpoint
        ? endpointRows(values)
        : { data: [], count: 0 },
    );
  });
}

// PostgreSQL orders-db.example.com:5432, found from client spans only.
function ordersDbFromSpans(): DatabaseServer {
  const row: DatabaseServer = new DatabaseServer();
  row.id = new ObjectID("42b6aaae-7558-42fe-999b-395bbfc79d63");
  row.projectId = new ObjectID(PROJECT_ID_STRING);
  row.name = "PostgreSQL orders-db.example.com:5432";
  row.dbSystem = "postgresql";
  row.serverAddress = "orders-db.example.com";
  row.serverPort = 5432;
  row.discoverySource = "client-spans";
  row.lastSeenAt = minutesAgo(2);
  return row;
}

async function renderOverview(): Promise<void> {
  render(
    <MemoryRouter>
      <DatabaseServerOverview {...PAGE_PROPS} />
    </MemoryRouter>,
  );
  await screen.findByText(/Engine metrics: /, undefined, { timeout: 3000 });
}

beforeEach(() => {
  getItemMock.mockReset();
  getListMock.mockReset();
  aggregateMock.mockReset();
  runtimeSectionMock.mockReset();
  aggregateMock.mockResolvedValue({ data: [] });
  mockModelIdString = "42b6aaae-7558-42fe-999b-395bbfc79d63";
});

afterEach(() => {
  cleanup();
});

describe("the database Overview header", () => {
  test("a database seen a minute ago with no engine metrics never reads 'Connected'", async () => {
    getItemMock.mockResolvedValue(ordersDbFromSpans());
    serveEndpoints(["orders-db.example.com:5432"]);

    await renderOverview();

    const pill: HTMLElement = screen.getByTestId("resource-overview-status");
    expect(pill).toHaveTextContent("Seen recently");
    expect(pill).not.toHaveTextContent(/connected/i);
    expect(pill.getAttribute("title") || "").toContain("Engine metrics");
    expect(
      screen.getByText("Engine metrics: Not connected"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("endpoint: orders-db.example.com:5432"),
    ).toBeInTheDocument();
  });

  test("a database no source ever saw reads 'Never seen', not 'Disconnected'", async () => {
    const row: DatabaseServer = ordersDbFromSpans();
    delete (row as { lastSeenAt?: Date }).lastSeenAt;
    getItemMock.mockResolvedValue(row);
    serveEndpoints(["orders-db.example.com:5432"]);

    await renderOverview();

    const pill: HTMLElement = screen.getByTestId("resource-overview-status");
    expect(pill).toHaveTextContent("Never seen");
    expect(pill).not.toHaveTextContent(/connected/i);
  });

  test("a Docker database with an alias shows the alias as its endpoint, not the container", async () => {
    mockModelIdString = "bb622879-1543-44e5-b12e-c7d9f406575d";
    const row: DatabaseServer = new DatabaseServer();
    row.id = new ObjectID("bb622879-1543-44e5-b12e-c7d9f406575d");
    row.projectId = new ObjectID(PROJECT_ID_STRING);
    row.name = "PostgreSQL e2e-receivers-postgres";
    row.dbSystem = "postgresql";
    row.discoverySource = "docker";
    row.workloadKind = "Container";
    row.workloadName = "e2e-receivers-postgres";
    row.dockerHostId = new ObjectID("477535e6-3462-49df-bf7f-5c0151a200c3");
    row.memberEntityKeys = { c281e9f63ebf20d9: "2026-09-25T01:00:00.398Z" };
    row.lastSeenAt = minutesAgo(1);
    getItemMock.mockResolvedValue(row);
    serveEndpoints(["e2e-receivers-postgres:5432"]);

    await renderOverview();

    expect(
      screen.getByText("endpoint: e2e-receivers-postgres:5432"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/endpoint: Container\//)).not.toBeInTheDocument();
  });

  test("a workload with no endpoint at all is labelled as a workload", async () => {
    mockModelIdString = "bb622879-1543-44e5-b12e-c7d9f406575d";
    const row: DatabaseServer = new DatabaseServer();
    row.id = new ObjectID("bb622879-1543-44e5-b12e-c7d9f406575d");
    row.projectId = new ObjectID(PROJECT_ID_STRING);
    row.name = "PostgreSQL e2e-receivers-postgres";
    row.dbSystem = "postgresql";
    row.discoverySource = "docker";
    row.workloadKind = "Container";
    row.workloadName = "e2e-receivers-postgres";
    row.dockerHostId = new ObjectID("477535e6-3462-49df-bf7f-5c0151a200c3");
    row.memberEntityKeys = { c281e9f63ebf20d9: "2026-09-25T01:00:00.398Z" };
    row.lastSeenAt = minutesAgo(1);
    getItemMock.mockResolvedValue(row);
    serveEndpoints([]);

    await renderOverview();

    expect(
      screen.getByText("workload: Container/e2e-receivers-postgres"),
    ).toBeInTheDocument();
  });
});

/*
 * The shared header: every other overview (Services, Hosts, Kubernetes, …)
 * passes only `status` and must keep its Connected / Disconnected pill.
 */
describe("ResourceOverview's status pill", () => {
  function renderHeader(
    props: Partial<React.ComponentProps<typeof ResourceOverview>>,
  ): void {
    render(
      <MemoryRouter>
        <ResourceOverview
          icon={IconProp.Database}
          title="checkout"
          identifier="checkout"
          identifierLabel="service.name"
          status="active"
          lastSeenAt={undefined}
          chips={[]}
          tiles={[]}
          detailRows={[]}
          controls={<div data-testid="controls" />}
          {...props}
        />
      </MemoryRouter>,
    );
  }

  test("without a label it is Connected / Disconnected, as before", () => {
    renderHeader({ status: "active" });
    expect(screen.getByTestId("resource-overview-status")).toHaveTextContent(
      "Connected",
    );
    cleanup();
    renderHeader({ status: "inactive" });
    const pill: HTMLElement = screen.getByTestId("resource-overview-status");
    expect(pill).toHaveTextContent("Disconnected");
    expect(pill.className).toContain("bg-amber-50");
  });

  test("a label, tone and description replace the words, colour and hover text", () => {
    renderHeader({
      status: "inactive",
      statusLabel: "Never seen",
      statusTone: "neutral",
      statusDescription: "What seen means",
    });
    const pill: HTMLElement = screen.getByTestId("resource-overview-status");
    expect(pill).toHaveTextContent("Never seen");
    expect(pill).not.toHaveTextContent("Disconnected");
    expect(pill.className).toContain("bg-gray-50");
    expect(pill).toHaveAttribute("title", "What seen means");
  });

  /*
   * md:flex-row put the controls beside the title from 768 px, where the
   * side menu is also shown: the title was 0 px wide at 768, 109 px at 900
   * and 181 px at 1024. The controls now wrap under the title whenever it
   * would be narrower than its basis, at any width.
   */
  test("the controls wrap under the title instead of squeezing it, at any width", () => {
    renderHeader({});
    const controls: HTMLElement = screen.getByTestId(
      "resource-overview-controls",
    );
    expect(controls).toContainElement(screen.getByTestId("controls"));
    const row: HTMLElement = screen.getByTestId("resource-overview-header-row");
    expect(controls.parentElement).toBe(row);
    const rowClasses: Array<string> = row.className.split(/\s+/);
    expect(rowClasses).toContain("flex");
    expect(rowClasses).toContain("flex-wrap");
    // No breakpoint decides it: not md, nor any other.
    expect(row.className).not.toMatch(/(^|\s)(sm|md|lg|xl|2xl):flex-(row|col)/);
    expect(rowClasses).not.toContain("flex-col");

    // The title asks for its basis and fills what is left beside the controls.
    const title: HTMLElement = screen.getByTestId(
      "resource-overview-title-block",
    );
    expect(title.parentElement).toBe(row);
    const titleClasses: Array<string> = title.className.split(/\s+/);
    expect(RESOURCE_OVERVIEW_TITLE_BASIS_CLASS).toBe("basis-96");
    expect(titleClasses).toContain(RESOURCE_OVERVIEW_TITLE_BASIS_CLASS);
    expect(titleClasses).toContain("grow");
    expect(titleClasses).toContain("min-w-0");
    expect(
      within(title).getByText("checkout", { selector: "h1" }),
    ).toBeTruthy();

    // The controls may shrink to the row and never hold it at their width.
    const controlClasses: Array<string> = controls.className.split(/\s+/);
    expect(controlClasses).toContain("max-w-full");
    expect(controls.className).not.toMatch(/flex-shrink-0|shrink-0/);
  });

  test("without controls the title still fills the row", () => {
    renderHeader({ controls: undefined });
    expect(
      screen.queryByTestId("resource-overview-controls"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("resource-overview-title-block").className,
    ).toContain("grow");
  });
});

describe("a database that does not exist", () => {
  test("the API's `{}` (an empty model) is 'Database not found.', not an overview", async () => {
    mockModelIdString = "3a84ec60-0000-4000-8000-000000000001";
    // What ModelAPI.getItem returns for a `{}` response: an empty model.
    getItemMock.mockResolvedValue(new DatabaseServer());
    serveEndpoints([]);

    render(
      <MemoryRouter>
        <DatabaseServerOverview {...PAGE_PROPS} />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId("error-message")).toHaveTextContent(
      "Database not found.",
    );
    expect(
      screen.queryByTestId("database-unscoped-banner"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("resource-overview-status"),
    ).not.toBeInTheDocument();
    expect(aggregateMock).not.toHaveBeenCalled();
  });
});

describe("the runtime card's tracked pods", () => {
  test("a one-pod Deployment is not counted twice (its Deployment key is no pod)", async () => {
    // Valkey cache/valkey on e2e-kind: two pods over its life + the Deployment.
    mockModelIdString = "e136b56a-55a2-4758-aa3f-190e41377a54";
    const row: DatabaseServer = new DatabaseServer();
    row.id = new ObjectID("e136b56a-55a2-4758-aa3f-190e41377a54");
    row.projectId = new ObjectID(PROJECT_ID_STRING);
    row.name = "Valkey cache/valkey";
    row.dbSystem = "valkey";
    row.discoverySource = "kubernetes";
    row.kubernetesClusterId = new ObjectID(
      "c1a5e000-0000-4000-8000-000000000001",
    );
    const cluster: KubernetesCluster = new KubernetesCluster();
    cluster.name = "e2e-kind";
    cluster.clusterIdentifier = "e2e-kind";
    row.kubernetesCluster = cluster;
    row.kubernetesNamespace = "cache";
    row.workloadKind = "Deployment";
    row.workloadName = "valkey";
    row.instanceCount = 1;
    row.memberEntityKeys = {
      "1b898749a42b7cb5": "2026-09-25T00:40:00.451Z",
      "242669ec16c90df2": "2026-09-25T00:40:00.451Z",
      e0c435f39e46f31f: "2026-09-24T22:35:00.393Z",
    };
    row.lastSeenAt = minutesAgo(1);
    getItemMock.mockResolvedValue(row);
    serveEndpoints([]);

    await renderOverview();

    const section: HTMLElement = await screen.findByTestId("runtime-section");
    expect(within(section).getByText("tracked:2")).toBeInTheDocument();
    const request: { select: Record<string, unknown> } = getItemMock.mock
      .calls[0]![0] as { select: Record<string, unknown> };
    expect(request.select["kubernetesCluster"]).toEqual({
      name: true,
      clusterIdentifier: true,
    });
  });
});
