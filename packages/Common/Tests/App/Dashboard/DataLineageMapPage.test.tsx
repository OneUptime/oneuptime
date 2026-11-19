import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement, ReactNode } from "react";
import { ReactFlowProps } from "reactflow";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THE LINEAGE MAP PAGE (#9114).
 *
 * It asks the lineage-map route once and draws the answer: a card per
 * service, table, pipeline and dashboard, the counts of each, and a legend.
 * Selecting a card picks out everything upstream and downstream of it,
 * fades the rest, and says what it is with its page one click away; Show
 * Only Its Lineage leaves only that. A search keeps what it matches and
 * its lineage; the switches leave services, pipelines or dashboards off;
 * the List view says every arrow as a line, and is what a phone opens on.
 * A project with no lineage is told where lineage comes from, and a map
 * with more flows than it draws says so. The API is mocked and React Flow
 * is a stand-in that draws each card with the page's own card.
 */

const getLineageMapMock: MockFunction = getJestMockFunction();
const getStoresMock: MockFunction = getJestMockFunction();

let mockFlowProps: ReactFlowProps | null = null;

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DataObservabilityApi",
  () => {
    return {
      __esModule: true,
      default: {
        getLineageMap: (...args: Array<any>) => {
          return getLineageMapMock(...args);
        },
        getStores: (...args: Array<any>) => {
          return getStoresMock(...args);
        },
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
        to?: { toString: () => string };
        children: ReactNode;
        className?: string;
        dataTestId?: string;
      }): ReactElement => {
        return React.createElement(
          "a",
          {
            href: props.to?.toString(),
            className: props.className,
            "data-testid": props.dataTestId,
          },
          props.children,
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/DataObservability/Pipelines",
  () => {
    return {
      __esModule: true,
      getRunStatePill: (state: string | undefined): ReactElement => {
        return React.createElement(
          "span",
          { "data-testid": "run-state" },
          state || "No run yet",
        );
      },
    };
  },
);

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return new ObjectID("11111111-1111-4111-8111-111111111111");
      },
    },
  };
});

jest.mock("reactflow", () => {
  const MockReactFlow: (props: any) => React.ReactElement = (
    props: any,
  ): React.ReactElement => {
    mockFlowProps = props;

    return React.createElement(
      "div",
      { "data-testid": "mock-react-flow" },
      (props.nodes || []).map((node: any) => {
        const Card: any = props.nodeTypes[node.type];

        return React.createElement(
          "div",
          { key: node.id, "data-testid": `flow-node-${node.id}` },
          React.createElement(Card, {
            id: node.id,
            data: node.data,
            type: node.type,
            selected: false,
            isConnectable: false,
            xPos: node.position.x,
            yPos: node.position.y,
            zIndex: 0,
            dragging: false,
          }),
        );
      }),
      props.children,
    );
  };

  return {
    __esModule: true,
    default: MockReactFlow,
    Background: () => {
      return null;
    },
    Controls: () => {
      return null;
    },
    Handle: () => {
      return null;
    },
    Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
    BackgroundVariant: { Dots: "dots" },
    MarkerType: { ArrowClosed: "arrowclosed" },
    useStore: (selector: (state: { domNode: null }) => unknown): unknown => {
      return selector({ domNode: null });
    },
    useStoreApi: () => {
      return {
        getState: () => {
          return { domNode: null };
        },
      };
    },
  };
});

/*
 * The page comes last: requiring it runs the factories above, which use
 * ObjectID.
 */
import ObjectID from "../../../Types/ObjectID";
import Route from "../../../Types/API/Route";
import { DataAssetFreshness } from "../../../Types/DataObservability/DataAssetFreshness";
import DataAssetKind from "../../../Types/DataObservability/DataAssetKind";
import {
  DataBiLineageProblem,
  DataBiLineageSummary,
} from "../../../Types/DataObservability/DataBiLineage";
import {
  DataLineageMap,
  DataLineageMapBiTool,
  DataLineageMapEdge,
  DataLineageMapEdgeKind,
  DataLineageMapEvidence,
  DataLineageMapNode,
  DataLineageMapNodeKind,
  getLineageMapEdgeId,
} from "../../../Types/DataObservability/DataLineageMap";
import DataObservabilityLineageMapPage from "../../../../App/FeatureSet/Dashboard/src/Pages/DataObservability/LineageMap";
import { LINEAGE_HIGHLIGHT_COLOR } from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/LineageGraphModel";
import { LINEAGE_MAP_TRACES_COLOR } from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/LineageMapGraph";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";

const RAW: string = "22222222-2222-4222-8222-000000000001";
const ORDERS: string = "22222222-2222-4222-8222-000000000002";
const CONTACTS: string = "22222222-2222-4222-8222-000000000003";
const CHECKOUT: string = "55555555-5555-4555-8555-000000000001";
const SYNC: string = "33333333-3333-4333-8333-000000000001";
const BOARD: string = "44444444-4444-4444-8444-000000000001";

function tableCard(
  id: string,
  name: string,
  fields: Partial<DataLineageMapNode> = {},
): DataLineageMapNode {
  return {
    id: `table:${id}`,
    kind: DataLineageMapNodeKind.Table,
    name,
    dataAssetId: id,
    database: "Warehouse",
    assetKind: DataAssetKind.Table,
    freshness: DataAssetFreshness.Fresh,
    lateBySeconds: 0,
    isDropped: false,
    openAlertCount: 0,
    ...fields,
  };
}

function arrow(
  kind: DataLineageMapEdgeKind,
  source: string,
  target: string,
  fields: Partial<DataLineageMapEdge> = {},
): DataLineageMapEdge {
  return {
    id: getLineageMapEdgeId({ kind, source, target }),
    source,
    target,
    kind,
    seenIn: [DataLineageMapEvidence.Pipeline],
    pipelines: [],
    operations: [],
    lastSeenAt: null,
    ...fields,
  };
}

/*
 * checkout (a service) writes raw.orders, which feeds analytics.orders
 * (late, two open alerts), which a Revenue dashboard reads. Apart from
 * them, a HubSpot sync loads crm.contacts.
 */
function aMap(fields: Partial<DataLineageMap> = {}): DataLineageMap {
  return {
    nodes: [
      {
        id: `service:${CHECKOUT}`,
        kind: DataLineageMapNodeKind.Service,
        name: "checkout",
        serviceId: CHECKOUT,
      },
      tableCard(RAW, "raw.orders"),
      tableCard(ORDERS, "analytics.orders", {
        freshness: DataAssetFreshness.Late,
        lateBySeconds: 7200,
        openAlertCount: 2,
      }),
      {
        id: `dashboard:${BOARD}`,
        kind: DataLineageMapNodeKind.Dashboard,
        name: "Revenue",
        dataDashboardId: BOARD,
        tool: "Metabase",
        url: "https://metabase.example.com/dashboard/7",
      },
      {
        id: `pipeline:${SYNC}`,
        kind: DataLineageMapNodeKind.Pipeline,
        name: "hubspot_sync",
        dataPipelineId: SYNC,
        jobNamespace: "fivetran",
        lastRunState: "FAIL",
      },
      tableCard(CONTACTS, "crm.contacts"),
    ],
    edges: [
      arrow(
        DataLineageMapEdgeKind.Writes,
        `service:${CHECKOUT}`,
        `table:${RAW}`,
        {
          seenIn: [DataLineageMapEvidence.Traces],
          operations: ["INSERT"],
        },
      ),
      arrow(DataLineageMapEdgeKind.Feeds, `table:${RAW}`, `table:${ORDERS}`, {
        seenIn: [
          DataLineageMapEvidence.Pipeline,
          DataLineageMapEvidence.QueryHistory,
        ],
        pipelines: [
          {
            dataPipelineId: "p1",
            name: "orders_etl",
            lastRunState: "COMPLETE",
          },
        ],
      }),
      arrow(
        DataLineageMapEdgeKind.Reads,
        `table:${ORDERS}`,
        `dashboard:${BOARD}`,
        { seenIn: [DataLineageMapEvidence.BiTool] },
      ),
      arrow(
        DataLineageMapEdgeKind.Writes,
        `pipeline:${SYNC}`,
        `table:${CONTACTS}`,
      ),
    ],
    isTruncated: false,
    ...fields,
  };
}

function setPhoneWidth(isPhone: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => {
      return {
        matches: isPhone,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
      };
    },
  });
}

async function renderPage(): Promise<void> {
  render(
    <DataObservabilityLineageMapPage
      pageRoute={new Route("/dashboard/lineage")}
      currentProject={null}
      hasPaymentMethod={true}
    />,
  );
  await waitFor(() => {
    expect(getLineageMapMock).toHaveBeenCalled();
    expect(screen.queryByTestId("chart-skeleton")).toBeNull();
  });
}

function card(id: string): HTMLElement {
  return within(screen.getByTestId(`flow-node-${id}`)).getByTestId(
    "lineage-map-card",
  );
}

function isDimmed(id: string): boolean {
  return (
    screen
      .getByTestId(`flow-node-${id}`)
      .querySelector('[data-dimmed="true"]') !== null
  );
}

beforeEach(() => {
  getLineageMapMock.mockReset();
  getStoresMock.mockReset();
  // No database to pick from unless a test says so.
  getStoresMock.mockResolvedValue([]);
  mockFlowProps = null;
  setPhoneWidth(false);
});

afterEach(() => {
  cleanup();
});

describe("the Lineage Map page", () => {
  test("draws every card and counts each kind", async () => {
    getLineageMapMock.mockResolvedValue(aMap());
    await renderPage();

    expect(await screen.findByTestId("mock-react-flow")).toBeInTheDocument();
    expect(mockFlowProps!.nodes).toHaveLength(6);
    expect(mockFlowProps!.edges).toHaveLength(4);
    // React Flow lets a pointer through a card it may not select: each card takes its own clicks.
    for (const node of mockFlowProps!.nodes!) {
      expect(node.style).toEqual({ pointerEvents: "all" });
    }
    expect(screen.getByTestId("lineage-map-summary")).toHaveTextContent(
      "3 tables · 1 service · 1 pipeline · 1 dashboard",
    );
    expect(screen.getByTestId("lineage-map-legend")).toBeInTheDocument();
    expect(screen.queryByTestId("lineage-map-truncated")).toBeNull();

    // An arrow seen in traces is teal; nothing is picked out yet.
    const traced: any = mockFlowProps!.edges!.find((edge: any) => {
      return edge.source === `service:${CHECKOUT}`;
    });

    expect(traced.style.stroke).toBe(LINEAGE_MAP_TRACES_COLOR);
    expect(isDimmed(`table:${RAW}`)).toBe(false);
  });

  test("selecting a card picks out its whole lineage, fades the rest and opens its page", async () => {
    getLineageMapMock.mockResolvedValue(aMap());
    await renderPage();

    fireEvent.click(card(`table:${RAW}`));

    const details: HTMLElement = await screen.findByTestId(
      "lineage-map-details",
    );

    expect(within(details).getByText("raw.orders")).toBeInTheDocument();
    expect(
      within(
        within(details).getByTestId("lineage-map-details-upstream"),
      ).getByText("checkout"),
    ).toBeInTheDocument();
    // One step down is drawn; the dashboard two steps down is counted.
    const downstream: HTMLElement = within(details).getByTestId(
      "lineage-map-details-downstream",
    );

    expect(
      within(downstream).getByText("analytics.orders"),
    ).toBeInTheDocument();
    expect(downstream).toHaveTextContent("1 more further downstream");

    // Its table's page.
    expect(
      within(details).getByTestId("lineage-map-details-open"),
    ).toHaveAttribute("href", expect.stringContaining(`tables/${RAW}`));
    expect(PageMap.DATA_OBSERVABILITY_TABLE_VIEW).toBeDefined();

    // Its lineage stays clear and indigo; the HubSpot flow fades.
    expect(isDimmed(`service:${CHECKOUT}`)).toBe(false);
    expect(isDimmed(`dashboard:${BOARD}`)).toBe(false);
    expect(isDimmed(`table:${CONTACTS}`)).toBe(true);
    expect(isDimmed(`pipeline:${SYNC}`)).toBe(true);

    const picked: any = mockFlowProps!.edges!.find((edge: any) => {
      return edge.target === `dashboard:${BOARD}`;
    });

    expect(picked.style.stroke).toBe(LINEAGE_HIGHLIGHT_COLOR);
    expect(card(`table:${RAW}`)).toHaveAttribute("aria-pressed", "true");

    // Show Only Its Lineage leaves only that on the map; Show the Whole Map brings the rest back.
    fireEvent.click(within(details).getByTestId("lineage-map-details-only"));
    await waitFor(() => {
      expect(mockFlowProps!.nodes).toHaveLength(4);
    });
    fireEvent.click(screen.getByTestId("lineage-map-details-only"));
    await waitFor(() => {
      expect(mockFlowProps!.nodes).toHaveLength(6);
    });

    // A card's neighbour selects it; Close clears the selection.
    fireEvent.click(
      within(screen.getByTestId("lineage-map-details-upstream")).getByText(
        "checkout",
      ),
    );
    expect(
      await within(screen.getByTestId("lineage-map-details")).findByTestId(
        "lineage-map-details-open",
      ),
    ).toHaveAttribute("href", expect.stringContaining(CHECKOUT));
    fireEvent.click(screen.getByTestId("lineage-map-details-close"));
    expect(screen.queryByTestId("lineage-map-details")).toBeNull();
  });

  test("a table's card says how it is; a pipeline's its latest run; a dashboard opens in its tool", async () => {
    getLineageMapMock.mockResolvedValue(aMap());
    await renderPage();

    fireEvent.click(card(`table:${ORDERS}`));
    let details: HTMLElement = await screen.findByTestId("lineage-map-details");

    expect(details).toHaveTextContent("2 open alerts");
    expect(details).toHaveTextContent("Late by 2 hours");

    fireEvent.click(card(`pipeline:${SYNC}`));
    details = await screen.findByTestId("lineage-map-details");
    expect(within(details).getByTestId("run-state")).toHaveTextContent("FAIL");
    expect(
      within(details).getByTestId("lineage-map-details-open"),
    ).toHaveAttribute("href", expect.stringContaining(`pipelines/${SYNC}`));

    fireEvent.click(card(`dashboard:${BOARD}`));
    details = await screen.findByTestId("lineage-map-details");
    expect(
      within(details).getByTestId("lineage-map-details-open"),
    ).toHaveAttribute("href", "https://metabase.example.com/dashboard/7");
  });

  test("a search keeps what it matches and its lineage, and says when nothing matches", async () => {
    getLineageMapMock.mockResolvedValue(aMap());
    await renderPage();

    fireEvent.change(screen.getByTestId("lineage-map-search"), {
      target: { value: "contacts" },
    });
    await waitFor(() => {
      expect(mockFlowProps!.nodes).toHaveLength(2);
    });
    expect(screen.getByTestId("lineage-map-summary")).toHaveTextContent(
      "1 table · 1 pipeline",
    );

    fireEvent.change(screen.getByTestId("lineage-map-search"), {
      target: { value: "no-such-table" },
    });
    expect(await screen.findByTestId("lineage-map-no-match")).toHaveTextContent(
      "Nothing on the map matches your search.",
    );
  });

  test("a switch leaves services off the map, and back on", async () => {
    getLineageMapMock.mockResolvedValue(aMap());
    await renderPage();

    const services: HTMLElement = screen.getByTestId(
      `lineage-map-kind-${DataLineageMapNodeKind.Service}`,
    );

    expect(services).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(services);
    await waitFor(() => {
      expect(mockFlowProps!.nodes).toHaveLength(5);
    });
    expect(services).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(services);
    await waitFor(() => {
      expect(mockFlowProps!.nodes).toHaveLength(6);
    });
  });

  test("the List view says every arrow as a line, and a card in it selects it", async () => {
    getLineageMapMock.mockResolvedValue(aMap());
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "List" }));

    const list: HTMLElement = await screen.findByTestId("lineage-map-list");
    const flows: Array<HTMLElement> =
      within(list).getAllByTestId("lineage-map-flow");

    expect(flows).toHaveLength(4);
    expect(list).toHaveTextContent("checkout");
    expect(list).toHaveTextContent("writes");
    expect(list).toHaveTextContent("is read by");
    expect(list).toHaveTextContent("Moved by orders_etl");
    expect(screen.queryByTestId("mock-react-flow")).toBeNull();

    fireEvent.click(
      within(flows[0]!).getAllByTestId("lineage-map-list-card")[0]!,
    );
    expect(
      await screen.findByTestId("lineage-map-details"),
    ).toBeInTheDocument();
  });

  test("a phone opens on the list", async () => {
    setPhoneWidth(true);
    getLineageMapMock.mockResolvedValue(aMap());
    await renderPage();

    expect(await screen.findByTestId("lineage-map-list")).toBeInTheDocument();
    expect(screen.queryByTestId("mock-react-flow")).toBeNull();
  });

  test("a project with no lineage is told where it comes from, with the guide one click away", async () => {
    getLineageMapMock.mockResolvedValue({
      nodes: [],
      edges: [],
      isTruncated: false,
    });
    await renderPage();

    expect(await screen.findByText("No lineage yet")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Services in your traces: their database spans say which tables they read and write.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("lineage-map-empty-docs")).toHaveAttribute(
      "href",
      expect.stringContaining("/data-observability/lineage-and-pipelines"),
    );
    // Nothing to switch between yet.
    expect(screen.queryByTestId("lineage-map-view")).toBeNull();
  });

  test("a map with more flows than it draws says so", async () => {
    getLineageMapMock.mockResolvedValue(aMap({ isTruncated: true }));
    await renderPage();

    expect(
      await screen.findByTestId("lineage-map-truncated"),
    ).toHaveTextContent(
      "Your project has more flows than one map draws, so the most recently seen are drawn. Pick a database, or search your whole project, to find a table.",
    );
  });

  test("a read that failed says why and can be tried again", async () => {
    getLineageMapMock.mockRejectedValueOnce(new Error("Server is down."));
    getLineageMapMock.mockResolvedValueOnce(aMap());
    await renderPage();

    expect(await screen.findByText("Server is down.")).toBeInTheDocument();
  });

  test("its help says what the map is first, then its topics", async () => {
    getLineageMapMock.mockResolvedValue(aMap());
    await renderPage();

    fireEvent.click(screen.getByTestId("lineage-map-help"));
    expect(
      await screen.findByText("How the Lineage Map Works"),
    ).toBeInTheDocument();
    expect(screen.getByText("Where Lineage Comes From")).toBeInTheDocument();
  });
});

/*
 * A BI tool's dashboards on the map (#9507): a Power BI report on no
 * watched table is drawn with the dataset it charts and the data sources
 * it loads from; and a tool whose dashboards are on no watched table is
 * told of, with why, on an empty map and above a drawn one.
 */
describe("the Lineage Map page, with a BI tool's dashboards", () => {
  const SUMMARY: DataBiLineageSummary = {
    dashboardCount: 783,
    dashboardsOnWatchedTables: 0,
    tableCount: 0,
    matchedTableCount: 0,
    datasets: {
      count: 59,
      withTables: 0,
      withQueries: 0,
      withSchemaError: 0,
      schemaError: null,
      readingDataflows: 0,
    },
    sources: [],
    moreSourceCount: 0,
    unwatchedTables: [],
    problems: [DataBiLineageProblem.NoTablesFromTool],
  };
  const TOOL: DataLineageMapBiTool = {
    dataBiConnectionId: "77777777-7777-4777-8777-000000000001",
    name: "Oneuptime PBI Data Observability",
    tool: "Power BI",
    dashboardCount: 783,
    summary: SUMMARY,
  };
  const DATABASE_SOURCE: string = "source:sql server|sql01|facilities|";
  const FILE_SOURCE: string =
    "source:sharepoint|||https://acme.sharepoint.com/sites/facilities";

  function powerBiMap(fields: Partial<DataLineageMap> = {}): DataLineageMap {
    return {
      nodes: [
        {
          id: `dashboard:${BOARD}`,
          kind: DataLineageMapNodeKind.Dashboard,
          name: "15 29 EMG NUO Master Checklist- GANTT View.xlsx",
          dataDashboardId: BOARD,
          tool: "Power BI",
          url: "https://app.powerbi.com/groups/w1/reports/r1",
        },
        {
          id: "dataset:ds1",
          kind: DataLineageMapNodeKind.Dataset,
          name: "Master Checklist",
          tool: "Power BI",
          workspace: "New Unit Readiness",
        },
        {
          id: DATABASE_SOURCE,
          kind: DataLineageMapNodeKind.Source,
          name: "sql01 / Facilities",
          sourceType: "SQL Server",
          isDatabaseSource: true,
        },
        {
          id: FILE_SOURCE,
          kind: DataLineageMapNodeKind.Source,
          name: "https://acme.sharepoint.com/sites/facilities",
          sourceType: "SharePoint",
          isDatabaseSource: false,
        },
      ],
      edges: [
        arrow(DataLineageMapEdgeKind.Feeds, DATABASE_SOURCE, "dataset:ds1", {
          seenIn: [DataLineageMapEvidence.BiTool],
        }),
        arrow(DataLineageMapEdgeKind.Feeds, FILE_SOURCE, "dataset:ds1", {
          seenIn: [DataLineageMapEvidence.BiTool],
        }),
        arrow(
          DataLineageMapEdgeKind.Reads,
          "dataset:ds1",
          `dashboard:${BOARD}`,
          { seenIn: [DataLineageMapEvidence.BiTool] },
        ),
      ],
      isTruncated: false,
      ...fields,
    };
  }

  test("a report on no watched table is drawn with its dataset and the data sources it loads from", async () => {
    getLineageMapMock.mockResolvedValue(powerBiMap());
    await renderPage();

    expect(screen.getByTestId("lineage-map-summary")).toHaveTextContent(
      "1 dashboard · 1 dataset · 2 data sources",
    );
    // Each card says what it is: its workspace, its kind of source.
    expect(card("dataset:ds1")).toHaveTextContent("New Unit Readiness");
    expect(card(DATABASE_SOURCE)).toHaveTextContent("SQL Server");
    expect(card(FILE_SOURCE)).toHaveTextContent("SharePoint");

    // Selecting the report follows it up to where its data comes from.
    fireEvent.click(card(`dashboard:${BOARD}`));
    expect(isDimmed("dataset:ds1")).toBe(false);
    expect(isDimmed(DATABASE_SOURCE)).toBe(false);

    // The Dashboards switch leaves the report's dataset and sources off with it.
    fireEvent.click(screen.getByTestId("lineage-map-kind-Dashboard"));
    expect(screen.getByTestId("lineage-map-no-match")).toBeInTheDocument();
  });

  test("an empty map whose BI tool was read says why, and See Why says what to do", async () => {
    getLineageMapMock.mockResolvedValue({
      nodes: [],
      edges: [],
      isTruncated: false,
      biToolsOffTables: [TOOL],
    });
    await renderPage();

    expect(await screen.findByText("No lineage yet")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Your BI tools were read, but their dashboards are built on no table OneUptime watches yet. The map draws them once they are, from any of these:",
      ),
    ).toBeInTheDocument();

    const note: HTMLElement = screen.getByTestId("bi-lineage-note");

    expect(note).toHaveTextContent(
      "783 dashboards of Oneuptime PBI Data Observability are built on no table OneUptime watches.",
    );
    expect(note).toHaveTextContent("Power BI sent no tables");

    fireEvent.click(screen.getByTestId("bi-lineage-note-why"));
    expect(await screen.findByTestId("bi-lineage-dialog")).toBeInTheDocument();
    expect(
      screen.getByText("Let Power BI Describe Its Tables"),
    ).toBeInTheDocument();
  });

  test("a drawn map tells of a BI tool whose dashboards are on no watched table, above it", async () => {
    getLineageMapMock.mockResolvedValue(aMap({ biToolsOffTables: [TOOL] }));
    await renderPage();

    expect(await screen.findByTestId("mock-react-flow")).toBeInTheDocument();
    expect(screen.getByTestId("bi-lineage-notes")).toHaveTextContent(
      "783 dashboards of Oneuptime PBI Data Observability are built on no table OneUptime watches.",
    );
  });

  test("a map with nothing to tell of says nothing of BI tools", async () => {
    getLineageMapMock.mockResolvedValue(aMap());
    await renderPage();

    expect(await screen.findByTestId("mock-react-flow")).toBeInTheDocument();
    expect(screen.queryByTestId("bi-lineage-notes")).toBeNull();
  });
});

/*
 * A REAL PROJECT'S MAP (#6547): more flows than one map is read by. The
 * map says how many tables it left out, each once - "at least" when there
 * were more flows than were read - and starts somewhere instead when asked:
 * one database, picked from the databases the reader may read, or a search
 * of the whole project, for a table the newest flows leave out. Each is a
 * read of its own; Show Whole Map goes back.
 */
function store(dataStoreId: string, name: string): Record<string, unknown> {
  return {
    dataStoreId,
    name,
    kind: "PostgreSQL",
    isTableHealthEnabled: true,
    collector: "Server",
    probeName: null,
    status: "Collected",
    message: null,
    collectedAt: null,
    assetCount: 10,
    lateAssetCount: 0,
    alertMonitorCount: 0,
  };
}

const ORDERS_DB: string = "66666666-6666-4666-8666-000000000001";
const FINANCE_DB: string = "66666666-6666-4666-8666-000000000002";

function databasePicker(): HTMLElement {
  return screen.getByRole("combobox", {
    name: "Database to map",
    hidden: true,
  });
}

function pickDatabase(name: string): void {
  fireEvent.keyDown(databasePicker(), {
    key: "ArrowDown",
    code: "ArrowDown",
  });

  const option: HTMLElement = screen.getByRole("option", { name });

  fireEvent.mouseDown(option);
  fireEvent.click(option);
}

function lastRequest(): Record<string, unknown> {
  const calls: Array<Array<unknown>> = getLineageMapMock.mock.calls;

  return (calls[calls.length - 1]![0] || {}) as Record<string, unknown>;
}

describe("a project with more flows than one map draws", () => {
  test("says how many more tables are not on the map, each once", async () => {
    getLineageMapMock.mockResolvedValue(
      aMap({ isTruncated: true, hiddenTableCount: 12 }),
    );
    await renderPage();

    expect(
      await screen.findByTestId("lineage-map-truncated"),
    ).toHaveTextContent(
      "12 more tables are not on this map: it draws the most recently seen flows first. Pick a database, or search your whole project, to find them.",
    );
  });

  test("one more table: the one form", async () => {
    getLineageMapMock.mockResolvedValue(
      aMap({ isTruncated: true, hiddenTableCount: 1 }),
    );
    await renderPage();

    expect(
      await screen.findByTestId("lineage-map-truncated"),
    ).toHaveTextContent(
      "1 more table is not on this map: it draws the most recently seen flows first. Pick a database, or search your whole project, to find it.",
    );
  });

  test("more flows than were read: at least that many", async () => {
    getLineageMapMock.mockResolvedValue(
      aMap({
        isTruncated: true,
        hiddenTableCount: 300,
        isHiddenTableCountAtLeast: true,
      }),
    );
    await renderPage();

    expect(
      await screen.findByTestId("lineage-map-truncated"),
    ).toHaveTextContent("At least 300 more tables are not on this map");
  });

  test("a map that draws everything says nothing of what it left out, and searches only what it drew", async () => {
    getLineageMapMock.mockResolvedValue(aMap({ hiddenTableCount: 0 }));
    await renderPage();

    fireEvent.change(screen.getByTestId("lineage-map-search"), {
      target: { value: "orders" },
    });

    expect(screen.queryByTestId("lineage-map-truncated")).toBeNull();
    expect(screen.queryByTestId("lineage-map-search-project")).toBeNull();
    expect(getLineageMapMock).toHaveBeenCalledTimes(1);
  });

  test("Search Whole Project reads the map of what the words name across the project, and Show Whole Map goes back", async () => {
    getLineageMapMock.mockResolvedValue(
      aMap({ isTruncated: true, hiddenTableCount: 40 }),
    );
    await renderPage();

    // No words: nothing to search the project for.
    expect(screen.queryByTestId("lineage-map-search-project")).toBeNull();

    fireEvent.change(screen.getByTestId("lineage-map-search"), {
      target: { value: "  contacts " },
    });
    fireEvent.click(await screen.findByTestId("lineage-map-search-project"));

    await waitFor(() => {
      expect(getLineageMapMock).toHaveBeenCalledTimes(2);
    });
    expect(lastRequest()).toEqual({ search: "contacts" });
    expect(
      await screen.findByTestId("lineage-map-project-search"),
    ).toHaveTextContent(
      "Showing the flows of the tables, pipelines, services, dashboards, datasets and data sources whose names hold contacts, from your whole project.",
    );
    // The words searched are the ones on the map now: not offered again.
    expect(screen.queryByTestId("lineage-map-search-project")).toBeNull();

    fireEvent.click(screen.getByTestId("lineage-map-search-project-clear"));
    await waitFor(() => {
      expect(getLineageMapMock).toHaveBeenCalledTimes(3);
    });
    expect(lastRequest()).toEqual({});
    expect(screen.queryByTestId("lineage-map-project-search")).toBeNull();
  });

  test("Enter in the search box searches the whole project too, and clearing the box goes back", async () => {
    getLineageMapMock.mockResolvedValue(aMap({ isTruncated: true }));
    await renderPage();

    const search: HTMLElement = screen.getByTestId("lineage-map-search");

    fireEvent.change(search, { target: { value: "orders" } });
    fireEvent.keyDown(search, { key: "Enter", code: "Enter" });
    await waitFor(() => {
      expect(lastRequest()).toEqual({ search: "orders" });
    });

    fireEvent.change(screen.getByTestId("lineage-map-search"), {
      target: { value: "" },
    });
    await waitFor(() => {
      expect(lastRequest()).toEqual({});
    });
  });

  test("a search of the whole project that names nothing with lineage says so, its toolbar kept to go back", async () => {
    getLineageMapMock.mockResolvedValueOnce(aMap({ isTruncated: true }));
    getLineageMapMock.mockResolvedValueOnce({
      nodes: [],
      edges: [],
      isTruncated: false,
      hiddenTableCount: 0,
    });
    await renderPage();

    fireEvent.change(screen.getByTestId("lineage-map-search"), {
      target: { value: "nothing_here" },
    });
    fireEvent.click(await screen.findByTestId("lineage-map-search-project"));

    expect(
      await screen.findByTestId("lineage-map-focus-empty"),
    ).toHaveTextContent(
      "No table, pipeline, service, dashboard, dataset or data source whose name holds nothing_here has lineage yet.",
    );
    // Not the first-run onboarding: the project has lineage.
    expect(screen.queryByText("No lineage yet")).toBeNull();
    expect(
      screen.getByTestId("lineage-map-search-project-clear"),
    ).toBeInTheDocument();
  });
});

describe("the map of one database", () => {
  test("two databases or more: a picker, all of them by default; a database picked reads its map", async () => {
    getStoresMock.mockResolvedValue([
      store(ORDERS_DB, "orders-db"),
      store(FINANCE_DB, "finance-db"),
    ]);
    getLineageMapMock.mockResolvedValue(aMap());
    await renderPage();

    await screen.findByTestId("lineage-map-database");
    expect(screen.getByTestId("lineage-map-database")).toHaveTextContent(
      "All databases",
    );

    pickDatabase("orders-db");

    await waitFor(() => {
      expect(lastRequest()).toEqual({ dataStoreId: ORDERS_DB });
    });

    // Cleared: the whole project again.
    const clear: HTMLElement | null = screen
      .getByTestId("lineage-map-database")
      .querySelector<HTMLElement>(".ou-select__clear-indicator");

    expect(clear).not.toBeNull();
    fireEvent.mouseDown(clear as HTMLElement, { button: 0 });
    await waitFor(() => {
      expect(lastRequest()).toEqual({});
    });
  });

  test("one database, or none the reader may read: no picker", async () => {
    getStoresMock.mockResolvedValue([store(ORDERS_DB, "orders-db")]);
    getLineageMapMock.mockResolvedValue(aMap());
    await renderPage();

    await waitFor(() => {
      expect(getStoresMock).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByTestId("lineage-map-database")).toBeNull();
  });

  test("the databases could not be read: the map is the whole project's, with no picker", async () => {
    getStoresMock.mockRejectedValue(new Error("No access"));
    getLineageMapMock.mockResolvedValue(aMap());
    await renderPage();

    expect(screen.queryByTestId("lineage-map-database")).toBeNull();
    expect(await screen.findByTestId("mock-react-flow")).toBeInTheDocument();
  });

  test("a database with no flows yet says so, the picker kept", async () => {
    getStoresMock.mockResolvedValue([
      store(ORDERS_DB, "orders-db"),
      store(FINANCE_DB, "finance-db"),
    ]);
    getLineageMapMock.mockResolvedValueOnce(aMap());
    getLineageMapMock.mockResolvedValueOnce({
      nodes: [],
      edges: [],
      isTruncated: false,
    });
    await renderPage();
    await screen.findByTestId("lineage-map-database");

    pickDatabase("finance-db");

    expect(
      await screen.findByTestId("lineage-map-focus-empty"),
    ).toHaveTextContent(
      "No flows of this database's tables have been seen yet.",
    );
    expect(screen.getByTestId("lineage-map-database")).toBeInTheDocument();
  });

  test("searching the whole project leaves the database picked behind", async () => {
    getStoresMock.mockResolvedValue([
      store(ORDERS_DB, "orders-db"),
      store(FINANCE_DB, "finance-db"),
    ]);
    getLineageMapMock.mockResolvedValue(aMap({ isTruncated: true }));
    await renderPage();
    await screen.findByTestId("lineage-map-database");

    pickDatabase("orders-db");
    await waitFor(() => {
      expect(lastRequest()).toEqual({ dataStoreId: ORDERS_DB });
    });

    fireEvent.change(screen.getByTestId("lineage-map-search"), {
      target: { value: "revenue" },
    });
    fireEvent.click(await screen.findByTestId("lineage-map-search-project"));

    await waitFor(() => {
      expect(lastRequest()).toEqual({ search: "revenue" });
    });
    expect(screen.getByTestId("lineage-map-database")).toHaveTextContent(
      "All databases",
    );
  });
});

describe("while the next map is read", () => {
  test("the search box and the picker stay where the reader is: only the drawing waits", async () => {
    getStoresMock.mockResolvedValue([
      store(ORDERS_DB, "orders-db"),
      store(FINANCE_DB, "finance-db"),
    ]);
    getLineageMapMock.mockResolvedValueOnce(aMap({ isTruncated: true }));

    let resolveNext!: (map: DataLineageMap) => void;

    getLineageMapMock.mockReturnValueOnce(
      new Promise<DataLineageMap>((resolve: (map: DataLineageMap) => void) => {
        resolveNext = resolve;
      }),
    );
    await renderPage();
    await screen.findByTestId("lineage-map-database");

    pickDatabase("orders-db");

    await waitFor(() => {
      expect(getLineageMapMock).toHaveBeenCalledTimes(2);
    });
    // Still there, as typed and picked; the drawing waits under them.
    expect(screen.getByTestId("lineage-map-search")).toBeInTheDocument();
    expect(screen.getByTestId("lineage-map-database")).toHaveTextContent(
      "orders-db",
    );
    expect(screen.getByTestId("chart-skeleton")).toBeInTheDocument();
    expect(screen.queryByTestId("mock-react-flow")).toBeNull();
    // What the last map left out is not said of the one on its way.
    expect(screen.queryByTestId("lineage-map-truncated")).toBeNull();

    resolveNext(aMap());

    expect(await screen.findByTestId("mock-react-flow")).toBeInTheDocument();
    expect(screen.queryByTestId("chart-skeleton")).toBeNull();
  });
});
