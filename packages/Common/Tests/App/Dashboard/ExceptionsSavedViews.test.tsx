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
import { act, cleanup, render } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The exceptions list's saved views, on the real ExceptionsViewer with
 * TelemetryViewer and the saved-views control captured and the data layer
 * mocked: what Save keeps of the list, what applying a view (and Clear
 * view, the empty state) does to it, the picked view in the address bar,
 * what a link naming one hands the control, and where the list has none.
 * The control itself, on the list's table, is
 * ExceptionSavedViewsControl.test.
 */

let viewerProps: any = null;
let controlProps: any = null;

jest.mock("../../../UI/Components/TelemetryViewer/TelemetryViewer", () => {
  return {
    __esModule: true,
    default: (props: any) => {
      viewerProps = props;
      return null;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetrySavedViewsControl",
  () => {
    return {
      __esModule: true,
      default: (props: any) => {
        controlProps = props;
        return null;
      },
    };
  },
);

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
import ExceptionSavedView from "../../../Models/DatabaseModels/ExceptionSavedView";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";
import TelemetrySavedViewState from "../../../Types/Telemetry/TelemetrySavedViewState";
import TimeRange from "../../../Types/Time/TimeRange";
import ProjectUtil from "../../../UI/Utils/Project";
import UserUtil from "../../../UI/Utils/User";

const NOW: Date = new Date("2026-10-30T12:00:00.000Z");
const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const ME: ObjectID = new ObjectID("77777777-7777-4777-8777-777777777777");
const SERVICE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

interface ListArgs {
  modelType: unknown;
  query: Record<string, unknown>;
  sort: Record<string, unknown>;
  limit: number;
}

function lastListRead(): ListArgs {
  const reads: Array<ListArgs> = getListMock.mock.calls
    .map((call: Array<unknown>): ListArgs => {
      return call[0] as ListArgs;
    })
    .filter((args: ListArgs): boolean => {
      return args.modelType === TelemetryException;
    });
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

async function openAt(
  search: string,
  element: React.ReactElement = <ExceptionsViewer />,
): Promise<void> {
  window.history.replaceState({}, "", `/dashboard/project/exceptions${search}`);
  await act(async () => {
    render(element);
  });
  await settle();
}

/*
 * The control as the viewer last drew it: the toolbar the viewer hands
 * TelemetryViewer, drawn on its own (TelemetryViewer is captured), and
 * null when the toolbar has no control.
 */
function drawnControl(): any {
  controlProps = null;
  const { unmount } = render(viewerProps.toolbarLeadingActions);
  unmount();
  return controlProps;
}

function params(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  viewerProps = null;
  controlProps = null;
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

describe("the Exceptions list's saved views", () => {
  test("are the list's own, beside its status", async () => {
    await openAt("");
    const control: any = drawnControl();

    expect(control).not.toBeNull();
    expect(control.modelType).toBe(ExceptionSavedView);
    expect(control.savedViewNoun).toBe("Exception");
    expect(control.explorerLabel).toBe("exceptions");
    // A bare visit: the project's default view may open.
    expect(control.hasInitialUrlState).toBe(false);
    expect(control.initialSavedViewId).toBeNull();
    expect(control.initialStateOverrides).toBeUndefined();
  });

  test("Save keeps the list as it is", async () => {
    await openAt(
      `?search=${encodeURIComponent("type:TypeError")}&filters=${encodeURIComponent(
        JSON.stringify([["resource.service.name", "checkout"]]),
      )}&range=${encodeURIComponent("Past 1 Week")}&pageSize=50&status=archived&class=all&assigned=me&sort=most-events`,
    );

    expect(drawnControl().captureCurrentState()).toEqual({
      search: "type:TypeError",
      filters: [["resource.service.name", "checkout"]],
      timeRange: { range: TimeRange.PAST_ONE_WEEK },
      pageSize: 50,
      exceptionStatus: "archived",
      exceptionClassScope: "all",
      exceptionAssignedToMe: true,
      exceptionSort: "most-events",
    });
  });

  test("applying a view sets the list, reads it again and writes the address bar", async () => {
    await openAt("");

    const view: TelemetrySavedViewState = {
      search: "env:production",
      filters: [["resource.service.name", "checkout"]],
      timeRange: { range: TimeRange.PAST_TWO_DAYS },
      pageSize: 50,
      exceptionStatus: "resolved",
      exceptionClassScope: "user-errors",
      exceptionAssignedToMe: true,
      exceptionSort: "first-seen",
    };

    const control: any = drawnControl();
    await act(async () => {
      control.applyState(view);
    });
    await settle();

    const read: ListArgs = lastListRead();
    expect(read.query["isResolved"]).toBe(true);
    expect(read.query["isArchived"]).toBe(false);
    expect(String(read.query["assignToUserId"])).toBe(ME.toString());
    expect(read.sort).toEqual({
      firstSeenAt: SortOrder.Descending,
      lastSeenAt: SortOrder.Descending,
    });
    expect(read.limit).toBe(50);

    expect(params().get("search")).toBe("env:production");
    expect(params().get("filters")).toBe(
      JSON.stringify([["resource.service.name", "checkout"]]),
    );
    expect(params().get("range")).toBe(TimeRange.PAST_TWO_DAYS);
    expect(params().get("status")).toBe("resolved");
    expect(params().get("class")).toBe("user-errors");
    expect(params().get("assigned")).toBe("me");
    expect(params().get("sort")).toBe("first-seen");

    // And Save, from there, keeps what the view set.
    expect(drawnControl().captureCurrentState()).toEqual(view);
  });

  test("Clear view - the empty state - puts the list back as it opens", async () => {
    await openAt(
      `?range=${encodeURIComponent("Past 1 Week")}&status=archived&class=all&assigned=me&sort=most-events&search=boom`,
    );

    const control: any = drawnControl();
    await act(async () => {
      control.applyState({});
    });
    await settle();

    const read: ListArgs = lastListRead();
    expect(read.query["isResolved"]).toBe(false);
    expect(read.query["isArchived"]).toBe(false);
    expect(read.query["assignToUserId"]).toBeUndefined();
    expect(read.sort).toEqual({ lastSeenAt: SortOrder.Descending });

    expect(params().get("range")).toBe(TimeRange.PAST_ONE_DAY);
    for (const name of ["search", "status", "class", "assigned", "sort"]) {
      expect({ name, value: params().get(name) }).toEqual({
        name,
        value: null,
      });
    }
  });

  test("the picked view rides in the address bar, and leaves with it", async () => {
    await openAt("");

    const picked: any = drawnControl();
    await act(async () => {
      picked.onSelectionChange("view-checkout");
    });
    await settle();
    expect(params().get("savedView")).toBe("view-checkout");

    const cleared: any = drawnControl();
    await act(async () => {
      cleared.onSelectionChange(null);
    });
    await settle();
    expect(params().get("savedView")).toBeNull();
  });

  test("a link naming a view hands it to the control, with what else the link said", async () => {
    await openAt(
      `?savedView=view-checkout&range=${encodeURIComponent("Past 2 Days")}&status=archived`,
    );
    const control: any = drawnControl();

    expect(control.initialSavedViewId).toBe("view-checkout");
    expect(control.initialStateOverrides).toEqual({
      timeRange: { range: TimeRange.PAST_TWO_DAYS },
      exceptionStatus: "archived",
    });
    // The view it names is the user's ask, and it stays in the address bar.
    expect(params().get("savedView")).toBe("view-checkout");
  });

  test("a link that says where to open keeps the project's default view off it", async () => {
    for (const search of [
      "?search=boom",
      `?range=${encodeURIComponent("Past 1 Week")}`,
      "?status=resolved",
      "?class=all",
      "?assigned=me",
      "?sort=first-seen",
    ]) {
      await openAt(search);
      expect({ search, skip: drawnControl().hasInitialUrlState }).toEqual({
        search,
        skip: true,
      });
      cleanup();
    }

    // The list writes its window on every change: the default one is no ask.
    await openAt(`?range=${encodeURIComponent("Past 1 Day")}`);
    expect(drawnControl().hasInitialUrlState).toBe(false);
  });

  test("the Resolved and Archived addresses kept from before the one list keep their status", async () => {
    await openAt("", <ExceptionsViewer defaultStatus="resolved" />);

    expect(drawnControl().hasInitialUrlState).toBe(true);
  });
});

describe("where the list has no saved views", () => {
  test("a list its host owns", async () => {
    await openAt("", <ExceptionsViewer disableUrlSync={true} />);

    expect(drawnControl()).toBeNull();
  });

  test("a service's exceptions", async () => {
    await openAt(
      "?savedView=view-checkout",
      <ExceptionsViewer primaryEntityId={SERVICE_ID} />,
    );

    expect(drawnControl()).toBeNull();
    // A view the link named is not carried on a list that cannot open it.
    expect(params().get("savedView")).toBeNull();
  });

  test("an inventory item's exceptions", async () => {
    await openAt(
      "",
      <ExceptionsViewer entityKeysFilter={["k8s.pod:checkout-7d9f"]} />,
    );

    expect(drawnControl()).toBeNull();
  });
});
