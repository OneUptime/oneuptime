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
    ).toBeInTheDocument();
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
