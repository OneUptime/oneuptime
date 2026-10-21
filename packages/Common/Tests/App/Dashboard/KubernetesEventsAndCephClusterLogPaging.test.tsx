import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { settle } from "./HostTooltipHarness";
import {
  choosePageSize,
  clickCardRefresh,
  columnTexts,
  nextButton,
  nextPage,
  numberedNames,
  pageSizeSelect,
  pagingSummary,
} from "./TablePagingHarness";

/*
 * The Kubernetes Events and Ceph Cluster Log pages, rendered for real with
 * their data layer mocked. Both read a day of log lines in one fetch and page
 * them client-side, so the page size is theirs to hold: the footer's
 * rows-per-page picker only reports what the reader chose.
 *
 * Both used to slice a fixed 25 rows and tell the footer the page size was
 * the number of rows on screen. The picker did nothing, and the five rows of
 * a short last page read "Showing 6-10 of 30". Nor was the page they were on
 * held to the rows there are, so a Refresh that came back shorter left the
 * reader on a page past the end.
 */

const MODEL_ID: string = "0193c0de-2222-4aaa-8bbb-000000000002";

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (error: unknown) => {
        return String((error as Error)?.message || error);
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
        return new ObjectIDType("0193c0de-2222-4aaa-8bbb-000000000002");
      },
      navigate: () => {},
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
        return new ObjectIDType("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

import KubernetesClusterEvents from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Events";
import CephClusterClusterLog from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/View/ClusterLog";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";

// The pages read their ids from the route, not from these props.
const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60 * 1000);
}

interface KvEntry {
  key: string;
  value: Record<string, unknown>;
}

function kvText(key: string, value: string): KvEntry {
  return { key: key, value: { stringValue: value } };
}

function kvList(key: string, values: Array<KvEntry>): KvEntry {
  return { key: key, value: { kvlistValue: { values: values } } };
}

/*
 * What the k8sobjects receiver ships for one Event: the object as an OTLP
 * kvlist body, stamped with the cluster it came from.
 */
function kubernetesEventLog(
  note: string,
  index: number,
): Record<string, unknown> {
  return {
    time: minutesAgo(index),
    attributes: { "resource.k8s.cluster.name": "prod-cluster" },
    body: JSON.stringify({
      kvlistValue: {
        values: [
          kvList("object", [
            kvText("type", "Normal"),
            kvText("reason", "Pulled"),
            kvText("note", note),
            kvList("regarding", [
              kvText("kind", "Pod"),
              kvText("name", "checkout"),
              kvText("namespace", "shop"),
            ]),
          ]),
        ],
      },
    }),
  };
}

// One ceph.log line, shipped verbatim by the Ceph agent's filelog receiver.
function cephLogLine(message: string, index: number): Record<string, unknown> {
  const time: Date = minutesAgo(index);

  return {
    time: time,
    body: `${time.toISOString()} mon.a (mon.0) ${1000 + index} : cluster [INF] ${message}`,
  };
}

interface LogPage {
  title: string;
  Page: React.FunctionComponent<PageComponentProps>;
  tableId: string;
  // The column that tells the rows apart: each row's message.
  messageColumn: number;
  // The rows' noun, as the pagination summary prints it.
  noun: string;
  // The page's own record, looked up before any log is read.
  item: Record<string, unknown>;
  // What the logs API hands back for these messages, newest first.
  logs: (messages: Array<string>) => Array<Record<string, unknown>>;
}

const PAGES: Array<LogPage> = [
  {
    title: "Kubernetes Events",
    Page: KubernetesClusterEvents,
    tableId: "kubernetes-events-table",
    messageColumn: 5,
    noun: "Kubernetes events",
    item: { _id: MODEL_ID, clusterIdentifier: "prod-cluster" },
    logs: (messages: Array<string>): Array<Record<string, unknown>> => {
      return messages.map(kubernetesEventLog);
    },
  },
  {
    title: "Ceph Cluster Log",
    Page: CephClusterClusterLog,
    tableId: "ceph-cluster-log-table",
    messageColumn: 3,
    noun: "log lines",
    item: { _id: MODEL_ID, name: "ceph-prod" },
    logs: (messages: Array<string>): Array<Record<string, unknown>> => {
      return messages.map(cephLogLine);
    },
  },
];

// Thirty messages, in the order the API returns them and the page lists them.
const THIRTY: Array<string> = numberedNames("message", 30);

beforeEach(() => {
  jest.useFakeTimers();
  getItemMock.mockReset();
  getListMock.mockReset();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe.each(PAGES)("paging through the $title page", (page: LogPage) => {
  function serve(messages: Array<string>): void {
    getListMock.mockResolvedValue({ data: page.logs(messages) });
  }

  beforeEach(() => {
    getItemMock.mockResolvedValue(page.item);
    serve(THIRTY);
  });

  async function renderPage(): Promise<void> {
    render(<page.Page {...PAGE_PROPS} />);
    await settle();
  }

  function visibleMessages(): Array<string> {
    return columnTexts(page.tableId, page.messageColumn);
  }

  test("shows 25 rows a page, and the last page's footer counts on from 25", async () => {
    await renderPage();

    expect(visibleMessages()).toEqual(THIRTY.slice(0, 25));
    expect(pagingSummary()).toBe(`Showing 1-25 of 30 ${page.noun}`);

    await nextPage();

    expect(visibleMessages()).toEqual(THIRTY.slice(25));
    // Not "Showing 6-10 of 30": the five rows here are 26 to 30.
    expect(pagingSummary()).toBe(`Showing 26-30 of 30 ${page.noun}`);
    expect(pageSizeSelect()).toHaveValue("25");
    expect(nextButton()).toBeDisabled();
  });

  test("the rows-per-page picker really changes the page size", async () => {
    await renderPage();
    await choosePageSize(50);

    expect(pageSizeSelect()).toHaveValue("50");
    // All thirty on one page, not the 25 the page opened with.
    expect(visibleMessages()).toEqual(THIRTY);
    expect(pagingSummary()).toBe(`Showing 1-30 of 30 ${page.noun}`);
    expect(nextButton()).toBeDisabled();
  });

  test("a smaller page size pages in smaller steps, from the first page", async () => {
    await renderPage();
    await nextPage();

    expect(visibleMessages()).toEqual(THIRTY.slice(25));

    // Row 26 of a 25-row page is not row 26 of a 10-row one: back to the top.
    await choosePageSize(10);

    expect(visibleMessages()).toEqual(THIRTY.slice(0, 10));

    await nextPage();

    expect(visibleMessages()).toEqual(THIRTY.slice(10, 20));

    await nextPage();

    expect(visibleMessages()).toEqual(THIRTY.slice(20));
    expect(pagingSummary()).toBe(`Showing 21-30 of 30 ${page.noun}`);
    expect(nextButton()).toBeDisabled();
  });

  test("a Refresh that comes back shorter does not strand the reader past its end", async () => {
    await renderPage();
    await nextPage();

    expect(visibleMessages()).toEqual(THIRTY.slice(25));

    // Older lines aged out of the day: ten are left, one page of them.
    serve(THIRTY.slice(0, 10));
    await clickCardRefresh();

    expect(visibleMessages()).toEqual(THIRTY.slice(0, 10));
    expect(pagingSummary()).toBe(`Showing 1-10 of 10 ${page.noun}`);
  });

  test("the page size the reader picked outlives a Refresh", async () => {
    await renderPage();
    await choosePageSize(10);
    await nextPage();
    await nextPage();

    expect(visibleMessages()).toEqual(THIRTY.slice(20));

    // Fifteen lines are two pages of ten: the reader lands on the last one.
    serve(THIRTY.slice(0, 15));
    await clickCardRefresh();

    expect(pageSizeSelect()).toHaveValue("10");
    expect(visibleMessages()).toEqual(THIRTY.slice(10, 15));
    expect(pagingSummary()).toBe(`Showing 11-15 of 15 ${page.noun}`);
    expect(nextButton()).toBeDisabled();
  });
});
