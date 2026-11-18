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
import Route from "../../../Types/API/Route";
import {
  DATA_OBSERVABILITY_NO_OWNER_FILTER,
  DataObservabilityIssueAlertFilter,
  DataObservabilityIssuesRequest,
  DataObservabilityIssuesResponse,
  DataObservabilityStoreSummary,
  DataObservabilityCollector,
} from "../../../Types/DataObservability/DataObservabilityApiTypes";
import {
  DataAttentionItem,
  DataAttentionKind,
} from "../../../Types/DataObservability/DataObservabilityAttention";
import ObjectID from "../../../Types/ObjectID";
import { EMPTY_TABLE_CLEAR_FILTERS_TEST_ID } from "../../../UI/Components/Table/TableEmptyStateBuilders";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import { getJestSpyOn } from "../../Spy";
import { PROJECT_ID, goTo } from "./SideMenuHarness";
import { ATTENTION_ITEM_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/AttentionItemList";
import DataObservabilityApi from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DataObservabilityApi";
import {
  DATA_OBSERVABILITY_ISSUES_LIST_ID,
  getIssuesRoute,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/IssuesCopy";
import DataObservabilityIssuesPage, {
  ISSUES_FILTERS_TEST_ID,
  ISSUES_PAGE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/DataObservability/Issues";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";

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

jest.setTimeout(60000);

/*
 * THE ISSUES PAGE: EVERYTHING THAT NEEDS SOMEONE, FILTERED (#6549).
 *
 * It opens on every issue, worst first, a page at a time from the server,
 * each drawn as the Overview draws it. Whether anyone was told, the kind,
 * the database and the owner - or No owner - filter it on the server, and
 * are kept in the address, so Back and a shared link open the same list.
 * Empty, it says what was looked at and found well - or, filtered, that
 * nothing matches, with a way to clear the filters.
 */

const STORE: string = "10000000-0000-4000-8000-000000000001";
const TABLE: string = "10000000-0000-4000-8000-000000000101";
const PIPELINE: string = "10000000-0000-4000-8000-000000000201";
const ISSUES_PATH: string = `/dashboard/${PROJECT_ID}/data-observability/issues`;

const pageProps: PageComponentProps = {
  pageRoute: new Route(ISSUES_PATH),
  currentProject: null,
  hasPaymentMethod: false,
} as unknown as PageComponentProps;

function item(
  kind: DataAttentionKind,
  name: string,
  fields: Partial<DataAttentionItem> = {},
): DataAttentionItem {
  return {
    kind,
    name,
    where: null,
    message: null,
    overdueBySeconds: 0,
    since: null,
    dataStoreId: null,
    dataAssetId: null,
    dataPipelineId: null,
    dataCheckId: null,
    dataProductId: null,
    dataReconciliationId: null,
    alert: null,
    ...fields,
  };
}

function store(): DataObservabilityStoreSummary {
  return {
    dataStoreId: STORE,
    name: "orders-db",
    kind: "PostgreSQL",
    isTableHealthEnabled: true,
    collector: DataObservabilityCollector.OneUptime,
    probeName: null,
    status: "Collected",
    message: null,
    collectedAt: new Date().toISOString(),
    assetCount: 3,
    lateAssetCount: 1,
    alertMonitorCount: 1,
  };
}

function answerOf(
  items: Array<DataAttentionItem>,
  fields: Partial<DataObservabilityIssuesResponse> = {},
): DataObservabilityIssuesResponse {
  return {
    items,
    count: items.length,
    totalCount: items.length,
    skip: 0,
    limit: 25,
    stores: [store()],
    owners: [],
    ...fields,
  };
}

const ISSUES: Array<DataAttentionItem> = [
  item(DataAttentionKind.PipelineFailed, "nightly_load", {
    where: "airflow",
    message: "relation staging.orders does not exist",
    dataPipelineId: PIPELINE,
  }),
  item(DataAttentionKind.TableLate, "public.payments", {
    where: "orders-db",
    overdueBySeconds: 4 * 3600,
    dataAssetId: TABLE,
    dataStoreId: STORE,
  }),
];

let answer: DataObservabilityIssuesResponse | Error;
let requests: Array<DataObservabilityIssuesRequest>;

beforeEach(() => {
  goTo(ISSUES_PATH);
  requests = [];
  answer = answerOf(ISSUES);

  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
  jest
    .spyOn(DataObservabilityApi, "getIssues")
    .mockImplementation(async (request: DataObservabilityIssuesRequest) => {
      requests.push(request);

      if (answer instanceof Error) {
        throw answer;
      }

      return answer;
    });
  // Nobody owns anything here: the owners are the Overview suite's to pin.
  getJestSpyOn(ModelAPI, "getList").mockResolvedValue({
    data: [],
    count: 0,
    skip: 0,
    limit: 500,
  } as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function openPage(): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <DataObservabilityIssuesPage {...pageProps} />
      </MemoryRouter>,
    );
  });
}

function addressFilter(): string | null {
  return new URLSearchParams(window.location.search).get(
    `${DATA_OBSERVABILITY_ISSUES_LIST_ID}-filter`,
  );
}

describe("opening the page", () => {
  test("every issue, worst first, the first page from the server, each drawn as the Overview draws it", async () => {
    await openPage();

    await waitFor(() => {
      expect(screen.queryAllByTestId(ATTENTION_ITEM_TEST_ID)).toHaveLength(2);
    });

    expect(requests).toEqual([{ skip: 0, limit: 25 }]);

    const items: Array<HTMLElement> = screen.queryAllByTestId(
      ATTENTION_ITEM_TEST_ID,
    );

    expect(within(items[0]!).getByText("nightly_load")).toBeInTheDocument();
    expect(within(items[1]!).getByText("public.payments")).toBeInTheDocument();
    expect(
      screen.getByTestId("data-observability-issues-pagination"),
    ).toBeInTheDocument();
    expect(screen.getByTestId(ISSUES_PAGE_TEST_ID)).toHaveTextContent(
      "Issues",
    );
  });

  test("its filters: whether anyone was told, a kind, a database and an owner - all of them, to begin with", async () => {
    await openPage();

    const filters: HTMLElement = await screen.findByTestId(
      ISSUES_FILTERS_TEST_ID,
    );

    expect(
      within(filters).getByRole("radio", { name: "Any" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      within(filters).getByRole("radio", { name: "Alert open" }),
    ).toBeInTheDocument();
    expect(
      within(filters).getByRole("radio", { name: "No alert open" }),
    ).toBeInTheDocument();
    expect(within(filters).getByText("All kinds")).toBeInTheDocument();
    expect(within(filters).getByText("All databases")).toBeInTheDocument();
    expect(within(filters).getByText("Anyone")).toBeInTheDocument();
  });

  test("a link with filters opens the page already filtered, and asks the server for just those", async () => {
    window.history.replaceState(
      {},
      "",
      getIssuesRoute({
        kind: DataAttentionKind.TableLate,
        owner: DATA_OBSERVABILITY_NO_OWNER_FILTER,
        alert: DataObservabilityIssueAlertFilter.None,
      }).toString(),
    );

    await openPage();

    await waitFor(() => {
      expect(requests).toHaveLength(1);
    });

    expect(requests[0]).toEqual({
      kinds: [DataAttentionKind.TableLate],
      owner: DATA_OBSERVABILITY_NO_OWNER_FILTER,
      alert: DataObservabilityIssueAlertFilter.None,
      skip: 0,
      limit: 25,
    });
    expect(
      await screen.findByRole("radio", { name: "No alert open" }),
    ).toHaveAttribute("aria-checked", "true");
  });
});

describe("filtering", () => {
  test("whether anyone was told is asked of the server, from the first page, and kept in the address", async () => {
    await openPage();

    fireEvent.click(await screen.findByRole("radio", { name: "Alert open" }));

    await waitFor(() => {
      expect(requests).toHaveLength(2);
    });

    expect(requests[1]).toEqual({
      alert: DataObservabilityIssueAlertFilter.Open,
      skip: 0,
      limit: 25,
    });
    expect(
      JSON.parse(addressFilter() || "{}") as Record<string, unknown>,
    ).toEqual({ alert: DataObservabilityIssueAlertFilter.Open });
    expect(TableFilterUrlState.read(DATA_OBSERVABILITY_ISSUES_LIST_ID, "filter"))
      .toEqual({ alert: DataObservabilityIssueAlertFilter.Open });

    // Any again: no filter left in the address.
    fireEvent.click(screen.getByRole("radio", { name: "Any" }));

    await waitFor(() => {
      expect(requests).toHaveLength(3);
    });

    expect(requests[2]).toEqual({ skip: 0, limit: 25 });
    expect(addressFilter()).toBeNull();
  });

  test("nothing matches: says so, and Clear Filters shows everything again", async () => {
    window.history.replaceState(
      {},
      "",
      getIssuesRoute({ kind: DataAttentionKind.CheckFailing }).toString(),
    );
    answer = answerOf([]);

    await openPage();

    expect(
      await screen.findByText("No issue matches these filters"),
    ).toBeInTheDocument();

    answer = answerOf(ISSUES);
    fireEvent.click(screen.getByTestId(EMPTY_TABLE_CLEAR_FILTERS_TEST_ID));

    await waitFor(() => {
      expect(screen.queryAllByTestId(ATTENTION_ITEM_TEST_ID)).toHaveLength(2);
    });

    expect(requests[requests.length - 1]).toEqual({ skip: 0, limit: 25 });
    expect(addressFilter()).toBeNull();
  });
});

describe("nothing to list, and a read that fails", () => {
  test("nothing needs anyone: it says what was looked at and found well", async () => {
    answer = answerOf([]);

    await openPage();

    expect(
      await screen.findByText("Nothing needs attention right now"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Every database was read, no pipeline run failed, no check is failing, and every table is changing as often as it usually does.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("No issue matches these filters")).toBeNull();
  });

  test("the issues not read: it says so, and Try again reads them again", async () => {
    answer = new Error("The server could not be reached.");

    await openPage();

    expect(
      await screen.findByTestId("data-observability-issues-error"),
    ).toBeInTheDocument();

    answer = answerOf(ISSUES);
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));

    await waitFor(() => {
      expect(screen.queryAllByTestId(ATTENTION_ITEM_TEST_ID)).toHaveLength(2);
    });
    expect(requests).toHaveLength(2);
  });
});
