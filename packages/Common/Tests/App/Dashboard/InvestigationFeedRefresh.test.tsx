import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * IncidentFeed and AlertFeed normally load once at page mount. An AI report is
 * posted later, immediately after the investigation completes, so the parent
 * page now changes refreshToken when InvestigationPanel sees that report.
 * These tests pin both the refresh signal and the less obvious request race:
 * an older mount-time response must never overwrite the refreshed feed.
 */

const getListMock: MockFunction = getJestMockFunction();
const feedRenderMock: MockFunction = getJestMockFunction();

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
      return React.createElement(
        "div",
        { "data-testid": "rendered-feed" },
        props.items.map((item: RenderedFeedItem): React.ReactElement => {
          return React.createElement(
            "div",
            { key: item.key },
            item.textInMarkdown,
          );
        }),
      );
    },
  };
});

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
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { DEFAULT_LIMIT } from "../../../Types/Database/LimitMax";
import { getSortOrderStorageKey } from "../../../UI/Components/Feed/useFeedOptions";

interface RenderedFeedItem {
  key: string;
  textInMarkdown: string;
  moreTextInMarkdown?: string | undefined;
  icon: IconProp;
  safeMode?: boolean | undefined;
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
  skip: number;
  limit: number;
  sort: Record<string, SortOrder>;
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

/*
 * A structured report in the exact layout AIInvestigationEngine posts: brand
 * heading, bold lead-in sections with citation markers, the server's
 * Evidence checked list and the footer.
 */
function structuredReport(summary: string, rootCause: string): string {
  return [
    "## 🧠 AI — Automated Root Cause Analysis",
    "",
    `**Summary** — ${summary}`,
    "",
    `**Most likely root cause** — ${rootCause}`,
    "",
    "**Evidence**",
    "- Pool usage stayed pinned at 10 [C2]",
    "",
    "**Suggested next steps**",
    "1. Roll back the release.",
    "",
    "**Evidence checked**",
    "- **[C1]** Incident search (3 found) — 3 row(s)",
    "- **[C2]** Max(db.client.connections.usage) — 80 row(s)",
    "",
    "---",
    "*Investigated automatically by OneUptime AI — read-only, 2 queries run across your own telemetry using claude-sonnet-4-5. This is an AI-generated first pass; verify before acting.*",
  ].join("\n");
}

const STRUCTURED_INCIDENT_REPORT: string = structuredReport(
  "Checkout latency passed 2s because the pool was cut to 10 [C1][C2].",
  "Release 2026.09.14-2 set the pool to 10 connections [C2].",
);
const COMPACT_INCIDENT_TEXT: string = [
  "**OneUptime AI posted a root cause analysis**",
  "Checkout latency passed 2s because the pool was cut to 10.",
  "**Most likely root cause:** Release 2026.09.14-2 set the pool to 10 connections.",
].join("\n\n");
const STRUCTURED_ALERT_REPORT: string = structuredReport(
  "Payment webhooks return 502 because the ledger timeout dropped to 1s [C1].",
  "A config reload set connectTimeout=1000ms [C2], [C1].",
);
const COMPACT_ALERT_TEXT: string = [
  "**OneUptime AI posted a root cause analysis**",
  "Payment webhooks return 502 because the ledger timeout dropped to 1s.",
  "**Most likely root cause:** A config reload set connectTimeout=1000ms.",
].join("\n\n");
/* Looks structured, but it is a person's note: it must never be compacted. */
const STRUCTURED_LOOKING_NOTE: string =
  "**Summary** — rolled back [C1].\n\n**Root cause** — pool size [C2].";

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

function structuredIncidentAnalysisItem(): IncidentFeed {
  const item: IncidentFeed = incidentAnalysisItem();
  item.id = new ObjectID("c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1");
  item.feedInfoInMarkdown = STRUCTURED_INCIDENT_REPORT;
  return item;
}

function structuredAlertAnalysisItem(): AlertFeed {
  const item: AlertFeed = alertAnalysisItem();
  item.id = new ObjectID("c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2");
  item.feedInfoInMarkdown = STRUCTURED_ALERT_REPORT;
  return item;
}

function incidentNoteItem(): IncidentFeed {
  const item: IncidentFeed = new IncidentFeed();
  item.id = new ObjectID("c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3");
  item.incidentId = INCIDENT_ID;
  item.incidentFeedEventType = IncidentFeedEventType.PrivateNote;
  item.feedInfoInMarkdown = STRUCTURED_LOOKING_NOTE;
  item.moreInformationInMarkdown = "Note attachments";
  item.postedAt = POSTED_AT;
  item.createdAt = POSTED_AT;
  return item;
}

function alertNoteItem(): AlertFeed {
  const item: AlertFeed = new AlertFeed();
  item.id = new ObjectID("c4c4c4c4-c4c4-4c4c-8c4c-c4c4c4c4c4c4");
  item.alertId = ALERT_ID;
  item.alertFeedEventType = AlertFeedEventType.PrivateNote;
  item.feedInfoInMarkdown = STRUCTURED_LOOKING_NOTE;
  item.moreInformationInMarkdown = "Note attachments";
  item.postedAt = POSTED_AT;
  item.createdAt = POSTED_AT;
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

/*
 * Both feeds open in the sort order the reader last chose, read from
 * localStorage on mount, so one test's choice must not reorder the next
 * test's requests.
 */
beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  feedRenderMock.mockReset();
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
    expect(request.skip).toBe(0);
    expect(request.limit).toBe(DEFAULT_LIMIT);
    expect(request.sort).toEqual({ postedAt: SortOrder.Descending });
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
    expect(request.skip).toBe(0);
    expect(request.limit).toBe(DEFAULT_LIMIT);
    expect(request.sort).toEqual({ postedAt: SortOrder.Descending });
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

  /*
   * The refresh after an investigation re-reads the same view the reader is
   * looking at. A reader who keeps these feeds oldest first must get the new
   * report at the end of that order, not a feed flipped back to newest first.
   */
  test("a refresh re-reads the incident and alert feeds in the reader's remembered order", async () => {
    window.localStorage.setItem(
      getSortOrderStorageKey("incident"),
      SortOrder.Ascending,
    );
    window.localStorage.setItem(
      getSortOrderStorageKey("alert"),
      SortOrder.Ascending,
    );
    getListMock.mockResolvedValue(listResult<IncidentFeed>([]) as never);

    const incidentView: ReturnType<typeof render> = render(incidentElement(0));
    await flush();
    incidentView.rerender(incidentElement(1));
    await flush();

    const alertView: ReturnType<typeof render> = render(alertElement(0));
    await flush();
    alertView.rerender(alertElement(1));
    await flush();

    const requests: Array<FeedListRequest> = getListMock.mock.calls.map(
      (call: Array<unknown>): FeedListRequest => {
        return call[0] as FeedListRequest;
      },
    );

    expect(
      requests.map((request: FeedListRequest): unknown => {
        return request.modelType;
      }),
    ).toEqual([IncidentFeed, IncidentFeed, AlertFeed, AlertFeed]);
    for (const request of requests) {
      expect(request.sort).toEqual({ postedAt: SortOrder.Ascending });
    }
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
    /* Not an AI investigation, so the text is never compacted. */
    expect(lastRenderedFeedProps().items[0]!.textInMarkdown).toBe(
      ORDINARY_ROOT_CAUSE,
    );
    expect(lastRenderedFeedProps().items[0]!.moreTextInMarkdown).toBe("");
  });
});

describe("AI root-cause items in incident and alert feeds", () => {
  test("a structured incident report becomes a compact item with the full report behind More Information", async () => {
    getListMock.mockResolvedValueOnce(
      listResult<IncidentFeed>([
        structuredIncidentAnalysisItem(),
        ordinaryIncidentRootCauseItem(),
        incidentNoteItem(),
      ]) as never,
    );

    render(incidentElement(0));
    expect(
      await screen.findByText(/OneUptime AI posted a root cause analysis/),
    ).toBeVisible();

    const items: Array<RenderedFeedItem> = lastRenderedFeedProps().items;
    expect(items).toHaveLength(3);

    expect(items[0]).toEqual(
      expect.objectContaining({
        textInMarkdown: COMPACT_INCIDENT_TEXT,
        moreTextInMarkdown: STRUCTURED_INCIDENT_REPORT,
        icon: IconProp.Sparkles,
        safeMode: true,
      }),
    );
    expect(items[0]!.textInMarkdown).not.toMatch(/\[C\d+\]/);
    expect(items[0]!.textInMarkdown).not.toContain("Evidence checked");
    expect(items[0]!.textInMarkdown).not.toContain("Suggested next steps");
    expect(items[0]!.moreTextInMarkdown).toContain("Evidence checked");

    /* Non-AI items keep exactly what was posted. */
    expect(items[1]).toEqual(
      expect.objectContaining({
        textInMarkdown: ORDINARY_ROOT_CAUSE,
        moreTextInMarkdown: "",
        icon: IconProp.Cube,
        safeMode: false,
      }),
    );
    expect(items[2]).toEqual(
      expect.objectContaining({
        textInMarkdown: STRUCTURED_LOOKING_NOTE,
        moreTextInMarkdown: "Note attachments",
        icon: IconProp.Lock,
        safeMode: false,
      }),
    );
  });

  test("a structured alert report becomes a compact item with the full report behind More Information", async () => {
    getListMock.mockResolvedValueOnce(
      listResult<AlertFeed>([
        structuredAlertAnalysisItem(),
        ordinaryAlertRootCauseItem(),
        alertNoteItem(),
      ]) as never,
    );

    render(alertElement(0));
    expect(
      await screen.findByText(/OneUptime AI posted a root cause analysis/),
    ).toBeVisible();

    const items: Array<RenderedFeedItem> = lastRenderedFeedProps().items;
    expect(items).toHaveLength(3);

    expect(items[0]).toEqual(
      expect.objectContaining({
        textInMarkdown: COMPACT_ALERT_TEXT,
        moreTextInMarkdown: STRUCTURED_ALERT_REPORT,
        icon: IconProp.Sparkles,
        safeMode: true,
      }),
    );
    expect(items[0]!.textInMarkdown).not.toMatch(/\[C\d+\]/);

    expect(items[1]).toEqual(
      expect.objectContaining({
        textInMarkdown: ORDINARY_ROOT_CAUSE,
        moreTextInMarkdown: "",
        icon: IconProp.Cube,
        safeMode: false,
      }),
    );
    expect(items[2]).toEqual(
      expect.objectContaining({
        textInMarkdown: STRUCTURED_LOOKING_NOTE,
        moreTextInMarkdown: "Note attachments",
        icon: IconProp.Lock,
        safeMode: false,
      }),
    );
  });

  test("a report recognised by its brand heading alone is compacted too", async () => {
    const incidentItem: IncidentFeed = structuredIncidentAnalysisItem();
    delete incidentItem.aiRunId;
    getListMock.mockResolvedValueOnce(
      listResult<IncidentFeed>([incidentItem]) as never,
    );

    const incidentView: ReturnType<typeof render> = render(incidentElement(0));
    expect(
      await screen.findByText(/OneUptime AI posted a root cause analysis/),
    ).toBeVisible();
    expect(lastRenderedFeedProps().items[0]).toEqual(
      expect.objectContaining({
        textInMarkdown: COMPACT_INCIDENT_TEXT,
        moreTextInMarkdown: STRUCTURED_INCIDENT_REPORT,
        icon: IconProp.Sparkles,
        safeMode: true,
      }),
    );

    incidentView.unmount();
    const alertItem: AlertFeed = structuredAlertAnalysisItem();
    delete alertItem.aiRunId;
    getListMock.mockResolvedValueOnce(
      listResult<AlertFeed>([alertItem]) as never,
    );

    render(alertElement(0));
    expect(
      await screen.findByText(/OneUptime AI posted a root cause analysis/),
    ).toBeVisible();
    expect(lastRenderedFeedProps().items[0]).toEqual(
      expect.objectContaining({
        textInMarkdown: COMPACT_ALERT_TEXT,
        moreTextInMarkdown: STRUCTURED_ALERT_REPORT,
        icon: IconProp.Sparkles,
        safeMode: true,
      }),
    );
  });

  test("an unstructured AI report is shown as posted, with no More Information", async () => {
    getListMock.mockResolvedValueOnce(
      listResult<IncidentFeed>([incidentAnalysisItem()]) as never,
    );

    const incidentView: ReturnType<typeof render> = render(incidentElement(0));
    expect(await screen.findByText(/connection exhaustion/)).toBeVisible();
    expect(lastRenderedFeedProps().items[0]).toEqual(
      expect.objectContaining({
        textInMarkdown: INCIDENT_ANALYSIS,
        moreTextInMarkdown: "",
        icon: IconProp.Sparkles,
        safeMode: true,
      }),
    );

    incidentView.unmount();
    getListMock.mockResolvedValueOnce(
      listResult<AlertFeed>([alertAnalysisItem()]) as never,
    );

    render(alertElement(0));
    expect(await screen.findByText(/failed dependency/)).toBeVisible();
    expect(lastRenderedFeedProps().items[0]).toEqual(
      expect.objectContaining({
        textInMarkdown: ALERT_ANALYSIS,
        moreTextInMarkdown: "",
        icon: IconProp.Sparkles,
        safeMode: true,
      }),
    );
  });

  test("an AI item that already has More Information keeps it and its full report text", async () => {
    const incidentItem: IncidentFeed = structuredIncidentAnalysisItem();
    incidentItem.moreInformationInMarkdown = "Existing incident details";
    getListMock.mockResolvedValueOnce(
      listResult<IncidentFeed>([incidentItem]) as never,
    );

    const incidentView: ReturnType<typeof render> = render(incidentElement(0));
    expect(await screen.findByText(/Checkout latency passed 2s/)).toBeVisible();
    expect(lastRenderedFeedProps().items[0]).toEqual(
      expect.objectContaining({
        textInMarkdown: STRUCTURED_INCIDENT_REPORT,
        moreTextInMarkdown: "Existing incident details",
        icon: IconProp.Sparkles,
        safeMode: true,
      }),
    );

    incidentView.unmount();
    const alertItem: AlertFeed = structuredAlertAnalysisItem();
    alertItem.moreInformationInMarkdown = "Existing alert details";
    getListMock.mockResolvedValueOnce(
      listResult<AlertFeed>([alertItem]) as never,
    );

    render(alertElement(0));
    expect(
      await screen.findByText(/Payment webhooks return 502/),
    ).toBeVisible();
    expect(lastRenderedFeedProps().items[0]).toEqual(
      expect.objectContaining({
        textInMarkdown: STRUCTURED_ALERT_REPORT,
        moreTextInMarkdown: "Existing alert details",
        icon: IconProp.Sparkles,
        safeMode: true,
      }),
    );
  });
});
