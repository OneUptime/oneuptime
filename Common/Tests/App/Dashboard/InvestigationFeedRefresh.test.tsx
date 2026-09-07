import { afterEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import AlertFeedElement from "../../../../App/FeatureSet/Dashboard/src/Components/Alert/AlertFeed";
import IncidentFeedElement from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentFeed";
import AlertFeed, {
  AlertFeedEventType,
} from "../../../Models/DatabaseModels/AlertFeed";
import IncidentFeed, {
  IncidentFeedEventType,
} from "../../../Models/DatabaseModels/IncidentFeed";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import ScheduledMaintenanceFeedElement from "../../../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ScheduledMaintenanceFeed";
import ScheduledMaintenanceFeed, {
  ScheduledMaintenanceFeedEventType,
} from "../../../Models/DatabaseModels/ScheduledMaintenanceFeed";

/*
 * IncidentFeed and AlertFeed normally load once at page mount. An AI report is
 * posted later, immediately after the investigation completes, so the parent
 * page now changes refreshToken when InvestigationPanel sees that report.
 * These tests pin both the refresh signal and the less obvious request race:
 * an older mount-time response must never overwrite the refreshed feed.
 */

const getListMock: MockFunction = getJestMockFunction();
const feedRenderMock: MockFunction = getJestMockFunction();
const itemDialogCleanupMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
    },
  };
});

/* Keep the test about feed state, not markdown parsing or timeline chrome. */
jest.mock("../../../UI/Components/Feed/Feed", () => {
  return {
    __esModule: true,
    default: (props: RenderedFeedProps): React.ReactElement => {
      feedRenderMock(props);
      const [isExpanded, setIsExpanded] = React.useState<boolean>(false);
      return React.createElement(
        "div",
        { "data-testid": "rendered-feed" },
        React.createElement(
          "button",
          {
            type: "button",
            "aria-expanded": isExpanded,
            onClick: () => {
              setIsExpanded(!isExpanded);
            },
          },
          isExpanded ? "Collapse test history" : "Expand test history",
        ),
        props.items.map((item: RenderedFeedItem): React.ReactElement => {
          return React.createElement(MockFeedItem, { key: item.key, item });
        }),
      );
    },
  };
});

interface RenderedFeedItem {
  key: string;
  textInMarkdown: string;
  icon: IconProp;
  safeMode?: boolean | undefined;
}

// A stateful item dialog models the lifetime of FeedItem's More Information
// modal, including the cleanup that releases its focus trap and scroll lock.
function MockItemDialog(): React.ReactElement {
  React.useEffect(() => {
    return () => {
      itemDialogCleanupMock();
    };
  }, []);
  return (
    <div role="dialog" aria-label="Feed item details">
      Expanded details
    </div>
  );
}

function MockFeedItem(props: { item: RenderedFeedItem }): React.ReactElement {
  const [showDetails, setShowDetails] = React.useState<boolean>(false);
  return (
    <div>
      <span>{props.item.textInMarkdown}</span>
      <button
        type="button"
        onClick={() => {
          setShowDetails(true);
        }}
      >
        Open test details
      </button>
      {showDetails && <MockItemDialog />}
    </div>
  );
}

interface RenderedFeedProps {
  items: Array<RenderedFeedItem>;
  noItemsMessage: string;
}

interface ListResult<T> {
  data: Array<T>;
  count: number;
  skip: number;
  limit: number;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

interface FeedListRequest {
  modelType: unknown;
  query: Record<string, unknown>;
  select: Record<string, unknown>;
}

const INCIDENT_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const ALERT_ID: ObjectID = new ObjectID("77777777-7777-4777-8777-777777777777");
const NEXT_INCIDENT_ID: ObjectID = new ObjectID(
  "abababab-abab-4bab-8bab-abababababab",
);
const NEXT_ALERT_ID: ObjectID = new ObjectID(
  "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd",
);
const AI_RUN_ID: ObjectID = new ObjectID(
  "12121212-1212-4212-8212-121212121212",
);
const POSTED_AT: Date = new Date("2026-08-07T11:00:00.000Z");
const INCIDENT_ANALYSIS: string =
  "## AI — Automated Root Cause Analysis\n\nThe incident was caused by connection exhaustion.";
const ALERT_ANALYSIS: string =
  "## AI — Automated Root Cause Analysis\n\nThe alert was caused by a failed dependency.";
const ORDINARY_ROOT_CAUSE: string =
  "## Root cause\n\nAn engineer identified a configuration regression.";

function listResult<T>(data: Array<T>): ListResult<T> {
  return {
    data,
    count: data.length,
    skip: 0,
    limit: 100,
  };
}

function incidentAnalysisItem(): IncidentFeed {
  const item: IncidentFeed = new IncidentFeed();
  item.id = new ObjectID("88888888-8888-4888-8888-888888888888");
  item.incidentId = INCIDENT_ID;
  item.incidentFeedEventType = IncidentFeedEventType.RootCause;
  item.aiRunId = AI_RUN_ID;
  item.feedInfoInMarkdown = INCIDENT_ANALYSIS;
  item.postedAt = POSTED_AT;
  item.createdAt = POSTED_AT;
  return item;
}

function alertAnalysisItem(): AlertFeed {
  const item: AlertFeed = new AlertFeed();
  item.id = new ObjectID("99999999-9999-4999-8999-999999999999");
  item.alertId = ALERT_ID;
  item.alertFeedEventType = AlertFeedEventType.RootCause;
  item.aiRunId = AI_RUN_ID;
  item.feedInfoInMarkdown = ALERT_ANALYSIS;
  item.postedAt = POSTED_AT;
  item.createdAt = POSTED_AT;
  return item;
}

function nextIncidentAnalysisItem(): IncidentFeed {
  const item: IncidentFeed = incidentAnalysisItem();
  item.id = new ObjectID("dededede-dede-4ede-8ede-dededededede");
  item.incidentId = NEXT_INCIDENT_ID;
  item.feedInfoInMarkdown =
    "## AI — Automated Root Cause Analysis\n\nThe next incident has its own report.";
  return item;
}

function nextAlertAnalysisItem(): AlertFeed {
  const item: AlertFeed = alertAnalysisItem();
  item.id = new ObjectID("efefefef-efef-4fef-8fef-efefefefefef");
  item.alertId = NEXT_ALERT_ID;
  item.feedInfoInMarkdown =
    "## AI — Automated Root Cause Analysis\n\nThe next alert has its own report.";
  return item;
}

function ordinaryIncidentRootCauseItem(): IncidentFeed {
  const item: IncidentFeed = incidentAnalysisItem();
  item.id = new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  delete item.aiRunId;
  item.feedInfoInMarkdown = ORDINARY_ROOT_CAUSE;
  return item;
}

function ordinaryAlertRootCauseItem(): AlertFeed {
  const item: AlertFeed = alertAnalysisItem();
  item.id = new ObjectID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  delete item.aiRunId;
  item.feedInfoInMarkdown = ORDINARY_ROOT_CAUSE;
  return item;
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise: Promise<T> = new Promise<T>((resolve: (value: T) => void) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve: (value: T): void => {
      resolvePromise!(value);
    },
  };
}

function incidentElement(refreshToken: number): React.ReactElement {
  return (
    <IncidentFeedElement incidentId={INCIDENT_ID} refreshToken={refreshToken} />
  );
}

function alertElement(refreshToken: number): React.ReactElement {
  return <AlertFeedElement alertId={ALERT_ID} refreshToken={refreshToken} />;
}

async function flush(): Promise<void> {
  await act(async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function resolveDeferred<T>(
  deferred: Deferred<T>,
  value: T,
): Promise<void> {
  await act(async (): Promise<void> => {
    deferred.resolve(value);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function lastRenderedFeedProps(): RenderedFeedProps {
  const calls: Array<Array<RenderedFeedProps>> = feedRenderMock.mock
    .calls as Array<Array<RenderedFeedProps>>;
  return calls[calls.length - 1]![0]!;
}

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  feedRenderMock.mockReset();
  itemDialogCleanupMock.mockReset();
});

describe("investigation reports in incident and alert feeds", () => {
  test("refreshToken makes the incident feed fetch and show the posted report", async () => {
    getListMock
      .mockResolvedValueOnce(listResult<IncidentFeed>([]) as never)
      .mockResolvedValueOnce(
        listResult<IncidentFeed>([incidentAnalysisItem()]) as never,
      );

    const view: ReturnType<typeof render> = render(incidentElement(0));

    await waitFor((): void => {
      expect(getListMock).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText(/connection exhaustion/)).toBeNull();

    view.rerender(
      <IncidentFeedElement
        incidentId={new ObjectID(INCIDENT_ID.toString())}
        refreshToken={1}
      />,
    );

    await waitFor(
      (): void => {
        expect(screen.getByText(/connection exhaustion/)).toBeVisible();
      },
      { timeout: 10000 },
    );
    expect(getListMock).toHaveBeenCalledTimes(2);
    expect(lastRenderedFeedProps().items[0]).toEqual(
      expect.objectContaining({
        icon: IconProp.Sparkles,
        safeMode: true,
      }),
    );

    const request: FeedListRequest = getListMock.mock
      .calls[1]![0] as FeedListRequest;
    expect(request.modelType).toBe(IncidentFeed);
    expect(request.query).toEqual({ incidentId: INCIDENT_ID });
    expect(request.select).toEqual(
      expect.objectContaining({
        feedInfoInMarkdown: true,
        aiRunId: true,
        incidentFeedEventType: true,
      }),
    );

    view.rerender(incidentElement(1));
    await flush();
    expect(getListMock).toHaveBeenCalledTimes(2);
  });

  test("refreshToken makes the alert feed fetch and show the posted report", async () => {
    getListMock
      .mockResolvedValueOnce(listResult<AlertFeed>([]) as never)
      .mockResolvedValueOnce(
        listResult<AlertFeed>([alertAnalysisItem()]) as never,
      );

    const view: ReturnType<typeof render> = render(alertElement(10));

    await waitFor((): void => {
      expect(getListMock).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText(/failed dependency/)).toBeNull();

    view.rerender(
      <AlertFeedElement
        alertId={new ObjectID(ALERT_ID.toString())}
        refreshToken={11}
      />,
    );

    await waitFor(
      (): void => {
        expect(screen.getByText(/failed dependency/)).toBeVisible();
      },
      { timeout: 10000 },
    );
    expect(getListMock).toHaveBeenCalledTimes(2);
    expect(lastRenderedFeedProps().items[0]).toEqual(
      expect.objectContaining({
        icon: IconProp.Sparkles,
        safeMode: true,
      }),
    );

    const request: FeedListRequest = getListMock.mock
      .calls[1]![0] as FeedListRequest;
    expect(request.modelType).toBe(AlertFeed);
    expect(request.query).toEqual({ alertId: ALERT_ID });
    expect(request.select).toEqual(
      expect.objectContaining({
        feedInfoInMarkdown: true,
        aiRunId: true,
        alertFeedEventType: true,
      }),
    );

    view.rerender(alertElement(11));
    await flush();
    expect(getListMock).toHaveBeenCalledTimes(2);
  });

  test("a late mount-time incident response cannot erase the refreshed report", async () => {
    const initialRequest: Deferred<ListResult<IncidentFeed>> =
      createDeferred<ListResult<IncidentFeed>>();
    const refreshedRequest: Deferred<ListResult<IncidentFeed>> =
      createDeferred<ListResult<IncidentFeed>>();

    getListMock
      .mockReturnValueOnce(initialRequest.promise as never)
      .mockReturnValueOnce(refreshedRequest.promise as never);

    const view: ReturnType<typeof render> = render(incidentElement(0));
    await flush();
    expect(getListMock).toHaveBeenCalledTimes(1);

    view.rerender(incidentElement(1));
    await flush();
    expect(getListMock).toHaveBeenCalledTimes(2);

    await resolveDeferred(
      refreshedRequest,
      listResult<IncidentFeed>([incidentAnalysisItem()]),
    );
    expect(screen.getByText(/connection exhaustion/)).toBeVisible();

    /* The older empty result arrives last and must be ignored. */
    await resolveDeferred(initialRequest, listResult<IncidentFeed>([]));
    expect(screen.getByText(/connection exhaustion/)).toBeVisible();
  });

  test("a late mount-time alert response cannot erase the refreshed report", async () => {
    const initialRequest: Deferred<ListResult<AlertFeed>> =
      createDeferred<ListResult<AlertFeed>>();
    const refreshedRequest: Deferred<ListResult<AlertFeed>> =
      createDeferred<ListResult<AlertFeed>>();

    getListMock
      .mockReturnValueOnce(initialRequest.promise as never)
      .mockReturnValueOnce(refreshedRequest.promise as never);

    const view: ReturnType<typeof render> = render(alertElement(20));
    await flush();
    expect(getListMock).toHaveBeenCalledTimes(1);

    view.rerender(alertElement(21));
    await flush();
    expect(getListMock).toHaveBeenCalledTimes(2);

    await resolveDeferred(
      refreshedRequest,
      listResult<AlertFeed>([alertAnalysisItem()]),
    );
    expect(screen.getByText(/failed dependency/)).toBeVisible();

    await resolveDeferred(initialRequest, listResult<AlertFeed>([]));
    expect(screen.getByText(/failed dependency/)).toBeVisible();
  });

  test("subject navigation never paints the previous incident or alert feed", async () => {
    const nextIncidentRequest: Deferred<ListResult<IncidentFeed>> =
      createDeferred<ListResult<IncidentFeed>>();
    getListMock
      .mockResolvedValueOnce(
        listResult<IncidentFeed>([incidentAnalysisItem()]) as never,
      )
      .mockReturnValueOnce(nextIncidentRequest.promise as never);

    const incidentView: ReturnType<typeof render> = render(incidentElement(0));
    expect(await screen.findByText(/connection exhaustion/)).toBeVisible();

    incidentView.rerender(
      <IncidentFeedElement incidentId={NEXT_INCIDENT_ID} refreshToken={0} />,
    );
    expect(screen.queryByText(/connection exhaustion/)).toBeNull();
    await flush();
    expect(getListMock).toHaveBeenCalledTimes(2);

    await resolveDeferred(
      nextIncidentRequest,
      listResult<IncidentFeed>([nextIncidentAnalysisItem()]),
    );
    expect(screen.getByText(/next incident has its own report/)).toBeVisible();

    incidentView.unmount();
    getListMock.mockClear();

    const nextAlertRequest: Deferred<ListResult<AlertFeed>> =
      createDeferred<ListResult<AlertFeed>>();
    getListMock
      .mockResolvedValueOnce(
        listResult<AlertFeed>([alertAnalysisItem()]) as never,
      )
      .mockReturnValueOnce(nextAlertRequest.promise as never);

    const alertView: ReturnType<typeof render> = render(alertElement(0));
    expect(await screen.findByText(/failed dependency/)).toBeVisible();

    alertView.rerender(
      <AlertFeedElement alertId={NEXT_ALERT_ID} refreshToken={0} />,
    );
    expect(screen.queryByText(/failed dependency/)).toBeNull();
    await flush();
    expect(getListMock).toHaveBeenCalledTimes(2);

    await resolveDeferred(
      nextAlertRequest,
      listResult<AlertFeed>([nextAlertAnalysisItem()]),
    );
    expect(screen.getByText(/next alert has its own report/)).toBeVisible();
  });

  test("ordinary incident and alert root causes keep their standard rendering", async () => {
    getListMock.mockResolvedValueOnce(
      listResult<IncidentFeed>([ordinaryIncidentRootCauseItem()]) as never,
    );

    const incidentView: ReturnType<typeof render> = render(incidentElement(0));
    expect(await screen.findByText(/configuration regression/)).toBeVisible();
    expect(lastRenderedFeedProps().items[0]).toEqual(
      expect.objectContaining({
        icon: IconProp.Cube,
        safeMode: false,
      }),
    );

    incidentView.unmount();
    getListMock.mockResolvedValueOnce(
      listResult<AlertFeed>([ordinaryAlertRootCauseItem()]) as never,
    );

    render(alertElement(0));
    expect(await screen.findByText(/configuration regression/)).toBeVisible();
    expect(lastRenderedFeedProps().items[0]).toEqual(
      expect.objectContaining({
        icon: IconProp.Cube,
        safeMode: false,
      }),
    );
  });
});

const MAINTENANCE_ID: ObjectID = new ObjectID(
  "23232323-2323-4232-8232-232323232323",
);
const NEXT_MAINTENANCE_ID: ObjectID = new ObjectID(
  "34343434-3434-4343-8343-343434343434",
);
type EventFeed = IncidentFeed | AlertFeed | ScheduledMaintenanceFeed;

interface FeedSpec {
  name: string;
  element: (id: ObjectID) => React.ReactElement;
  id: ObjectID;
  nextId: ObjectID;
  item: () => EventFeed;
}

function maintenanceItem(): ScheduledMaintenanceFeed {
  const item: ScheduledMaintenanceFeed = new ScheduledMaintenanceFeed();
  item.id = new ObjectID("45454545-4545-4454-8454-454545454545");
  item.scheduledMaintenanceId = MAINTENANCE_ID;
  item.scheduledMaintenanceFeedEventType =
    ScheduledMaintenanceFeedEventType.ScheduledMaintenanceCreated;
  item.feedInfoInMarkdown = "Maintenance window scheduled";
  item.postedAt = POSTED_AT;
  item.createdAt = POSTED_AT;
  return item;
}

const refreshSpecs: Array<FeedSpec> = [
  {
    name: "incident",
    id: INCIDENT_ID,
    nextId: NEXT_INCIDENT_ID,
    item: incidentAnalysisItem,
    element: (id: ObjectID): React.ReactElement => {
      return <IncidentFeedElement incidentId={id} />;
    },
  },
  {
    name: "alert",
    id: ALERT_ID,
    nextId: NEXT_ALERT_ID,
    item: alertAnalysisItem,
    element: (id: ObjectID): React.ReactElement => {
      return <AlertFeedElement alertId={id} />;
    },
  },
  {
    name: "maintenance",
    id: MAINTENANCE_ID,
    nextId: NEXT_MAINTENANCE_ID,
    item: maintenanceItem,
    element: (id: ObjectID): React.ReactElement => {
      return <ScheduledMaintenanceFeedElement scheduledMaintenanceId={id} />;
    },
  },
];

describe.each(refreshSpecs)("$name expanded feed history", (spec: FeedSpec) => {
  test("preserves expansion while unmounting item dialogs and their effects during refresh", async () => {
    const refreshedRequest: Deferred<ListResult<EventFeed>> =
      createDeferred<ListResult<EventFeed>>();
    getListMock
      .mockResolvedValueOnce(listResult<EventFeed>([spec.item()]) as never)
      .mockReturnValueOnce(refreshedRequest.promise as never);
    render(spec.element(spec.id));
    const originalFeed: HTMLElement =
      await screen.findByTestId("rendered-feed");
    await waitFor(() => {
      expect(originalFeed).toBeVisible();
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Expand test history" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Open test details" }));
    expect(
      screen.getByRole("dialog", { name: "Feed item details" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByTestId("rendered-feed")).toBe(originalFeed);
    expect(originalFeed).not.toBeVisible();
    expect(screen.getByText("Collapse test history")).not.toBeVisible();
    expect(screen.getByTestId("component-loader")).toBeVisible();
    expect(screen.queryByRole("dialog", { hidden: true })).toBeNull();
    expect(screen.queryByText("Open test details")).toBeNull();
    expect(itemDialogCleanupMock).toHaveBeenCalledTimes(1);
    expect(lastRenderedFeedProps().items).toEqual([]);
    await resolveDeferred(
      refreshedRequest,
      listResult<EventFeed>([spec.item()]),
    );
    expect(screen.getByTestId("rendered-feed")).toBe(originalFeed);
    expect(originalFeed).toBeVisible();
    expect(screen.queryByRole("dialog", { hidden: true })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Open test details" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Collapse test history" }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  test("keeps item dialogs unmounted after a failed refresh", async () => {
    getListMock
      .mockResolvedValueOnce(listResult<EventFeed>([spec.item()]) as never)
      .mockRejectedValueOnce(new Error("Could not refresh feed"));
    render(spec.element(spec.id));
    await waitFor(() => {
      expect(screen.getByTestId("rendered-feed")).toBeVisible();
    });
    fireEvent.click(screen.getByRole("button", { name: "Open test details" }));
    expect(
      screen.getByRole("dialog", { name: "Feed item details" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await screen.findByText("Could not refresh feed");
    expect(screen.getByTestId("rendered-feed")).not.toBeVisible();
    expect(screen.queryByRole("dialog", { hidden: true })).toBeNull();
    expect(screen.queryByText("Open test details")).toBeNull();
    expect(itemDialogCleanupMock).toHaveBeenCalledTimes(1);
    expect(lastRenderedFeedProps().items).toEqual([]);
  });

  test("resets expansion when navigating to a different event", async () => {
    const nextRequest: Deferred<ListResult<EventFeed>> =
      createDeferred<ListResult<EventFeed>>();
    getListMock
      .mockResolvedValueOnce(listResult<EventFeed>([spec.item()]) as never)
      .mockReturnValueOnce(nextRequest.promise as never);
    const view: ReturnType<typeof render> = render(spec.element(spec.id));
    await waitFor(() => {
      expect(screen.getByTestId("rendered-feed")).toBeVisible();
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Expand test history" }),
    );
    view.rerender(spec.element(spec.nextId));
    await resolveDeferred(nextRequest, listResult<EventFeed>([spec.item()]));
    expect(
      screen.getByRole("button", { name: "Expand test history" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Collapse test history")).toBeNull();
  });
});
