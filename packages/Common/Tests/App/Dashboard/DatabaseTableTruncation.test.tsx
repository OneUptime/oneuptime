import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * The two Databases table cells whose text is a long host name, rendered
 * for real from the columns the pages hand ModelTable, against what the
 * UI re-verification found at 1440 px:
 *
 *   - Endpoints tab, k8s postgres 68fc0503: a pod DNS endpoint
 *     ("postgres-0.postgres-headless.data.svc.cluster.local:5432@e2e-kind")
 *     made the Endpoint column 582 px and the "Discovered (Kubernetes
 *     Service)" pill 268 px; the table was 1280 px in a 1098 px card and
 *     Delete sat past the card's edge;
 *   - Databases list, Name column: under its 14rem cap the monospace
 *     endpoint line broke mid-token and split ports across lines
 *     ("mariarv2.rcv-e2e.example.net:33" / "06").
 */

interface CapturedColumn {
  title: string;
  getElement?: (item: unknown) => React.ReactElement;
  wrapContent?: boolean;
  wrapMaxWidthClassName?: string;
}

interface CapturedTableProps {
  columns: Array<CapturedColumn>;
}

let tableProps: CapturedTableProps | null = null;
const countMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps) => {
      tableProps = props;
      return <div data-testid="model-table" />;
    },
  };
});

// The arrow wrappers are load bearing: jest.mock is hoisted above the mocks.
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: (...args: Array<unknown>) => {
        return countMock(...args);
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DatabaseServerSummaryStrip",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="summary-strip" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DocumentationCard",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/useResourceOwners",
  () => {
    return {
      __esModule: true,
      buildEnumFacetQuery: () => {
        return undefined;
      },
      default: () => {
        return {
          getOwnersForResource: () => {
            return [];
          },
          isLoadingOwners: false,
          onResourcesFetched: () => {},
          filterBar: <div />,
          mergeFiltersIntoQuery: (query: unknown) => {
            return query;
          },
          facetSaveState: undefined,
          restoreFacetState: () => {},
        };
      },
    };
  },
);

jest.mock("../../../UI/Components/BulkUpdate/BulkLabelActions", () => {
  return {
    __esModule: true,
    default: () => {
      return { bulkActions: [], modals: <></> };
    },
  };
});

jest.mock("../../../UI/Components/BulkUpdate/BulkOwnerActions", () => {
  return {
    __esModule: true,
    default: () => {
      return { bulkActions: [], modals: <></> };
    },
  };
});

jest.mock("../../../UI/Components/BulkUpdate/BulkArchiveActions", () => {
  return {
    __esModule: true,
    default: () => {
      return { archiveBulkActions: [], unarchiveBulkActions: [] };
    },
  };
});

import DatabaseServerEndpoints, {
  DATABASE_ENDPOINT_COLUMN_MAX_WIDTH_CLASS,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/View/Endpoints";
import Databases, {
  DATABASE_NAME_COLUMN_MAX_WIDTH_CLASS,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/Databases";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import DatabaseServerEndpoint from "../../../Models/DatabaseModels/DatabaseServerEndpoint";
import Route from "../../../Types/API/Route";

const DATABASE_ID: string = "68fc0503-1d2e-4f3a-9b4c-5d6e7f8a9b0c";
const POD_ENDPOINT: string =
  "postgres-0.postgres-headless.data.svc.cluster.local:5432@e2e-kind";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/test/databases"),
  currentProject: null,
  hasPaymentMethod: true,
};

function column(title: string): CapturedColumn {
  const found: CapturedColumn | undefined = (tableProps?.columns || []).find(
    (candidate: CapturedColumn): boolean => {
      return candidate.title === title;
    },
  );
  if (!found || !found.getElement) {
    throw new Error(`No "${title}" column with a cell renderer.`);
  }
  return found;
}

function renderCell(title: string, item: unknown): void {
  render(<MemoryRouter>{column(title).getElement!(item)}</MemoryRouter>);
}

beforeEach(() => {
  tableProps = null;
  countMock.mockReset();
  countMock.mockResolvedValue(0);
});

afterEach(() => {
  cleanup();
});

describe("the Endpoints tab's Endpoint cell", () => {
  function renderEndpointsPage(): void {
    goTo(`/dashboard/${PROJECT_ID}/databases/${DATABASE_ID}/endpoints`);
    render(
      <MemoryRouter>
        <DatabaseServerEndpoints {...PAGE_PROPS} />
      </MemoryRouter>,
    );
    cleanup();
  }

  function endpointRow(data: {
    endpoint: string;
    isPrimary: boolean;
    source?: string;
  }): DatabaseServerEndpoint {
    const row: DatabaseServerEndpoint = new DatabaseServerEndpoint();
    row.endpoint = data.endpoint;
    row.isPrimary = data.isPrimary;
    row.source = data.source || "workload";
    return row;
  }

  test("a pod DNS endpoint is cut with an ellipsis inside a capped cell, in full on hover", () => {
    renderEndpointsPage();

    renderCell(
      "Endpoint",
      endpointRow({ endpoint: POD_ENDPOINT, isPrimary: false }),
    );

    const value: HTMLElement = screen.getByTestId("database-endpoint-value");
    // The whole value is in the DOM (a copy takes all of it) and the title.
    expect(value).toHaveTextContent(POD_ENDPOINT);
    expect(value).toHaveAttribute("title", POD_ENDPOINT);
    const valueClasses: Array<string> = value.className.split(/\s+/);
    expect(valueClasses).toContain("truncate");
    expect(valueClasses).toContain("min-w-0");
    // break-all never wrapped anything: every body cell is nowrap.
    expect(valueClasses).not.toContain("break-all");

    // The cap sits on the cell's own box, which is what limits the column.
    const cell: HTMLElement = value.parentElement!;
    expect(DATABASE_ENDPOINT_COLUMN_MAX_WIDTH_CLASS).toBe("max-w-xs");
    expect(cell.className.split(/\s+/)).toContain(
      DATABASE_ENDPOINT_COLUMN_MAX_WIDTH_CLASS,
    );
    expect(cell.className.split(/\s+/)).toContain("min-w-0");
  });

  test("the Primary pill keeps its size while the endpoint beside it shrinks", () => {
    renderEndpointsPage();

    renderCell(
      "Endpoint",
      endpointRow({ endpoint: POD_ENDPOINT, isPrimary: true }),
    );

    const pill: HTMLElement = screen.getByText("Primary");
    expect(pill.closest(".flex-shrink-0")).not.toBeNull();
    expect(screen.getByTestId("database-endpoint-value")).toHaveAttribute(
      "title",
      POD_ENDPOINT,
    );
  });

  test("an empty endpoint shows a dash and no hover text", () => {
    renderEndpointsPage();

    renderCell("Endpoint", endpointRow({ endpoint: "", isPrimary: false }));

    const value: HTMLElement = screen.getByTestId("database-endpoint-value");
    expect(value).toHaveTextContent("—");
    expect(value).not.toHaveAttribute("title");
  });

  test("'Added by' is a short pill, not 'Discovered (Kubernetes Service)'", () => {
    renderEndpointsPage();

    renderCell(
      "Added by",
      endpointRow({ endpoint: POD_ENDPOINT, isPrimary: false }),
    );

    expect(screen.getByTestId("pill")).toHaveTextContent(
      /^Kubernetes Service$/,
    );
    expect(
      screen.queryByText("Discovered (Kubernetes Service)"),
    ).not.toBeInTheDocument();
  });
});

describe("the Databases list's Name cell", () => {
  async function renderListPage(): Promise<void> {
    goTo(`/dashboard/${PROJECT_ID}/databases`);
    render(
      <MemoryRouter>
        <Databases {...PAGE_PROPS} />
      </MemoryRouter>,
    );
    // The table mounts once the page has counted the project's databases.
    await screen.findByTestId("model-table");
    cleanup();
  }

  test("the endpoint line is one line cut with an ellipsis, in full on hover — never split mid-port", async () => {
    await renderListPage();

    const name: CapturedColumn = column("Name");
    // The cap that broke the line is still what fits the list at 1440 px.
    expect(name.wrapContent).toBe(true);
    expect(name.wrapMaxWidthClassName).toBe(
      DATABASE_NAME_COLUMN_MAX_WIDTH_CLASS,
    );

    const row: DatabaseServer = new DatabaseServer();
    row._id = DATABASE_ID;
    row.name = "MariaDB mariarv2.rcv-e2e.example.net:3306";
    row.serverAddress = "mariarv2.rcv-e2e.example.net";
    row.serverPort = 3306;
    renderCell("Name", row);

    const endpoint: HTMLElement = screen.getByTestId("database-name-endpoint");
    expect(endpoint).toHaveTextContent("mariarv2.rcv-e2e.example.net:3306");
    expect(endpoint).toHaveAttribute(
      "title",
      "mariarv2.rcv-e2e.example.net:3306",
    );
    const classes: Array<string> = endpoint.className.split(/\s+/);
    expect(classes).toContain("truncate");
    expect(classes).toContain("font-mono");
    expect(classes).not.toContain("break-all");
  });
});
