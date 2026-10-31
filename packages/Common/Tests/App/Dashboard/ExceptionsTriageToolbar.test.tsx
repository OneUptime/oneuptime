/** @timezone UTC */

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
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The exceptions list's Assigned to me and Sort, on the real ExceptionsViewer
 * with TelemetryViewer captured and the data layer mocked: each reads the
 * list again with its filter or order, rides in the address bar, and is read
 * back from it - a shared link or a refresh opens the same list.
 */

let viewerProps: any = null;

jest.mock("../../../UI/Components/TelemetryViewer/TelemetryViewer", () => {
  return {
    __esModule: true,
    default: (props: any) => {
      viewerProps = props;
      return null;
    },
  };
});

const getListMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      count: (...args: Array<any>) => {
        return countMock(...args);
      },
      getCommonHeaders: () => {
        return {};
      },
      updateById: () => {
        return Promise.resolve();
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: unknown) => {
        return error instanceof Error ? error.message : "Something went wrong";
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return analyticsGetListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Telemetry/UseTelemetryEntityNames", () => {
  return {
    __esModule: true,
    default: () => {
      return {};
    },
  };
});

import ExceptionsViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionsViewer";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";
import UserUtil from "../../../UI/Utils/User";

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");
const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const ME: ObjectID = new ObjectID("77777777-7777-4777-8777-777777777777");

interface ListArgs {
  modelType: unknown;
  query: Record<string, unknown>;
  sort: Record<string, unknown>;
  select: Record<string, unknown>;
}

function listReads(): Array<ListArgs> {
  return getListMock.mock.calls
    .map((call: Array<unknown>): ListArgs => {
      return call[0] as ListArgs;
    })
    .filter((args: ListArgs): boolean => {
      return args.modelType === TelemetryException;
    });
}

function lastListRead(): ListArgs {
  const reads: Array<ListArgs> = listReads();
  return reads[reads.length - 1]!;
}

async function settle(): Promise<void> {
  for (let round: number = 0; round < 8; round++) {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }
}

async function openAt(search: string): Promise<void> {
  window.history.replaceState({}, "", `/dashboard/project/exceptions${search}`);
  await act(async () => {
    render(<ExceptionsViewer />);
  });
  await settle();
}

// The toolbar the viewer hands TelemetryViewer, drawn on its own.
async function drawToolbar(): Promise<void> {
  await act(async () => {
    render(viewerProps.toolbarLeadingActions);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  viewerProps = null;
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(UserUtil, "getUserId").mockReturnValue(ME);

  getListMock.mockReset();
  countMock.mockReset();
  postMock.mockReset();
  analyticsGetListMock.mockReset();

  getListMock.mockImplementation(async () => {
    return { data: [], count: 0 };
  });
  countMock.mockImplementation(async () => {
    return 0;
  });
  analyticsGetListMock.mockImplementation(async () => {
    return { data: [], count: 0 };
  });
  postMock.mockImplementation(async () => {
    return { data: { facets: {}, buckets: [], attributes: [] } };
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
  window.history.replaceState({}, "", "/");
});

describe("Assigned to me", () => {
  test("off by default: every exception, whoever owns it", async () => {
    await openAt("");

    expect(lastListRead().query["assignToUserId"]).toBeUndefined();
    // The row's chip and Assign to me read who owns each.
    expect(lastListRead().select).toMatchObject({
      assignToUserId: true,
      assignToTeamId: true,
      assignToUser: { name: true, email: true },
      assignToTeam: { name: true },
    });
  });

  test("on, from the address bar: only the reader's own", async () => {
    await openAt("?assigned=me");

    expect(String(lastListRead().query["assignToUserId"])).toBe(ME.toString());
  });

  test("one click turns it on and off, and the address bar follows", async () => {
    await openAt("");
    await drawToolbar();

    const toggle: HTMLElement = screen.getByTestId("exceptions-assigned-to-me");
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    await act(async () => {
      fireEvent.click(toggle);
    });
    await settle();

    expect(String(lastListRead().query["assignToUserId"])).toBe(ME.toString());
    expect(window.location.search).toContain("assigned=me");

    /*
     * The toolbar drawn again from the viewer's latest props, as
     * TelemetryViewer would: a second click turns it off.
     */
    const viewerToolbar: React.ReactElement = viewerProps.toolbarLeadingActions;
    const { unmount } = render(viewerToolbar);
    const toggles: Array<HTMLElement> = screen.getAllByTestId(
      "exceptions-assigned-to-me",
    );
    const latest: HTMLElement = toggles[toggles.length - 1]!;
    expect(latest).toHaveAttribute("aria-pressed", "true");

    await act(async () => {
      fireEvent.click(latest);
    });
    await settle();
    unmount();

    expect(lastListRead().query["assignToUserId"]).toBeUndefined();
    expect(window.location.search).not.toContain("assigned=");
  });
});

describe("Sort", () => {
  test("last seen by default, and not written to the address bar", async () => {
    await openAt("");

    expect(lastListRead().sort).toEqual({ lastSeenAt: SortOrder.Descending });
    expect(window.location.search).not.toContain("sort=");
  });

  test("most events, from the address bar", async () => {
    await openAt("?sort=most-events");

    expect(lastListRead().sort).toEqual({
      occuranceCount: SortOrder.Descending,
      lastSeenAt: SortOrder.Descending,
    });
  });

  test("an order the list does not know reads as last seen", async () => {
    await openAt("?sort=sideways");

    expect(lastListRead().sort).toEqual({ lastSeenAt: SortOrder.Descending });
  });

  test("picking an order reads the list again in it, and the address bar keeps it", async () => {
    await openAt("");
    await drawToolbar();

    await act(async () => {
      fireEvent.click(screen.getByTestId("exceptions-sort"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("exceptions-sort-first-seen"));
    });
    await settle();

    expect(lastListRead().sort).toEqual({
      firstSeenAt: SortOrder.Descending,
      lastSeenAt: SortOrder.Descending,
    });
    expect(window.location.search).toContain("sort=first-seen");
  });

  test("the menu names the order in use", async () => {
    await openAt("?sort=first-seen");
    await drawToolbar();

    expect(screen.getByTestId("exceptions-sort")).toHaveTextContent(
      "Sort: First seen",
    );
  });
});

describe("A list its host owns", () => {
  /*
   * Embedded with disableUrlSync (an incident's or a service's exceptions),
   * the address bar is the host page's: the list opens with everyone's
   * exceptions, by last seen, and the menu still names the order.
   */
  test("ignores the address bar: everyone's exceptions, by last seen", async () => {
    window.history.replaceState(
      {},
      "",
      "/dashboard/project/incidents/1?assigned=me&sort=most-events",
    );
    await act(async () => {
      render(<ExceptionsViewer disableUrlSync={true} />);
    });
    await settle();

    expect(lastListRead().query["assignToUserId"]).toBeUndefined();
    expect(lastListRead().sort).toEqual({ lastSeenAt: SortOrder.Descending });

    await drawToolbar();

    expect(screen.getByTestId("exceptions-assigned-to-me")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByTestId("exceptions-sort")).toHaveTextContent(
      "Sort: Last seen",
    );
  });
});
