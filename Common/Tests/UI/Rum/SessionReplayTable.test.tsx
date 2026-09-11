import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The session list, rendered against a mocked /list and /ingest-status.
 * Skeleton rows while loading; routes, trace counts, idle hint and the
 * first-error action on a row; whole-row navigation with Cmd-click as a
 * real link; search debounced into the request; a sort change resets the
 * cursor; Next disabled without a cursor; unplayable rows never offer
 * Watch; the ignored user filter is called out instead of chipped; the
 * 30-day search cap reads as its fix.
 */

const postMock: MockFunction = getJestMockFunction();
const navigateMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: unknown): string => {
        return error instanceof HTTPErrorResponse
          ? error.message
          : String(error);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

import SessionReplayTable, {
  fetchSessionReplayList,
  parseSessionReplaySummary,
  SESSION_REPLAY_FRUSTRATION_COUNTERS,
  SESSION_REPLAY_LIST_URL_STORAGE_KEY,
  SESSION_REPLAY_SIGNAL_BADGES,
  SessionReplayListResult,
  SessionReplaySignalBadge,
  SessionReplaySummary,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayTable";
import { clearSessionReplayHealthStore } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/useSessionReplayHealth";
import { readReplayListUrl } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayViewPrefs";
import { SESSION_REPLAY_SEARCH_DEBOUNCE_MS } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplaySearchBar";

const APP_ID: string = "0193c0de-1111-4aaa-8bbb-000000000001";
const SESSION_A: string = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const SESSION_B: string = "b2c3d4e5f60718293a4b5c6d7e8f90a1";
const SESSION_C: string = "c3d4e5f60718293a4b5c6d7e8f90a1b2";
const VISITOR_A: string = "abc123def4567890abc123def4567890";
const NOW: number = Date.now();
const DAY_MS: number = 24 * 60 * 60 * 1000;

interface CapturedRequest {
  url: string;
  data: JSONObject;
}

function requestsTo(route: string): Array<CapturedRequest> {
  return postMock.mock.calls
    .map((call: Array<unknown>): CapturedRequest => {
      const request: { url: { toString: () => string }; data: JSONObject } =
        call[0] as { url: { toString: () => string }; data: JSONObject };

      return { url: request.url.toString(), data: request.data };
    })
    .filter((request: CapturedRequest): boolean => {
      return request.url.includes(route);
    });
}

function wireStatus(overrides?: JSONObject): JSONObject {
  return {
    isProjectAllowed: true,
    isApplicationEnabled: true,
    appIdentifier: "acme-web",
    allowedOrigins: ["https://app.acme.com"],
    samplePercentage: 100,
    captureTrigger: "Always",
    lastChunkReceivedAt: new Date(NOW - 12_000).toISOString(),
    budgetExceededAt: null,
    projectBytesUsedToday: 1024,
    dailyByteLimit: 1024 * 1024,
    applicationBytesUsedThisMonth: null,
    monthlyBudgetInGB: null,
    consentMode: "NotRequired",
    maskingMode: "MaskSensitiveInputsOnly",
    retentionInDays: 7,
    publishedRecorderVersion: "1.4.0",
    lastConfigFetchAt: new Date(NOW - 12_000).toISOString(),
    lastSessionStartedAt: new Date(NOW - 60_000).toISOString(),
    sessionsLast24h: 143,
    playableSessionsLast24h: 120,
    refusalsLast24h: [],
    ...overrides,
  };
}

/* One row as /list serialises it, with every additive projection present. */
function wireRow(overrides?: JSONObject): JSONObject {
  return {
    sessionId: SESSION_A,
    rumApplicationId: APP_ID,
    startTime: new Date(NOW - 3 * 60_000).toISOString(),
    endTime: new Date(NOW - 60_000).toISOString(),
    startTimeUnixMs: NOW - 3 * 60_000,
    durationMs: 90 * 60_000 + 12_000,
    isFinalized: 1,
    sealedReason: "",
    chunkCount: 12,
    maxChunkIndex: 11,
    missingChunkCount: 0,
    eventCount: 4000,
    payloadBytes: 100_000,
    hasError: 1,
    errorCount: 2,
    rageClickCount: 1,
    deadClickCount: 0,
    errorClickCount: 0,
    refreshRageCount: 0,
    pageCount: 4,
    triggerReason: "sampled",
    samplePercentageAtCapture: 100,
    entryUrl: "https://app.acme.com/checkout/payment",
    exitUrl: "https://app.acme.com/thanks",
    routes: [
      "https://app.acme.com/cart",
      "https://app.acme.com/checkout",
      "https://app.acme.com/checkout/payment",
      "https://app.acme.com/thanks",
    ],
    browserName: "Chrome",
    browserVersion: "126",
    osName: "macOS",
    deviceType: "desktop",
    countryCode: "DE",
    viewportWidth: 1440,
    viewportHeight: 900,
    identifiedUserKey: "k1",
    identifiedUserLabel: "jane@acme.com",
    maskingMode: "MaskSensitiveInputsOnly",
    fidelityNotices: [],
    traceCount: 3,
    exceptionGroupCount: 1,
    clickCount: 41,
    activeMs: 54 * 60_000,
    firstErrorOffsetMs: 65_000,
    expiresAtUnixMs: NOW + 6 * DAY_MS + 3600_000,
    tags: { build: "1.4.2" },
    ...overrides,
  };
}

function listResponse(
  sessions: Array<JSONObject>,
  nextCursor: JSONObject | null = null,
  ignoredFilters?: Array<string>,
): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(
    200,
    {
      sessions: sessions,
      nextCursor: nextCursor,
      ...(ignoredFilters ? { ignoredFilters: ignoredFilters } : {}),
    },
    {},
  );
}

/* One row as /users serialises it. */
function wireRollup(overrides?: JSONObject): JSONObject {
  return {
    groupKey: "u:k1",
    kind: "identified",
    identifiedUserKey: "k1",
    visitorId: VISITOR_A,
    identifiedUserLabel: "jane@acme.com",
    identifiedUserTraits: { plan: "pro" },
    sessionCount: 3,
    liveSessionCount: 0,
    firstSeenUnixMs: NOW - DAY_MS,
    lastSeenUnixMs: NOW - 60_000,
    totalDurationMs: 30 * 60_000,
    errorCount: 2,
    frustrationCount: 1,
    errorSessionCount: 1,
    pageCount: 9,
    lastSessionId: SESSION_A,
    lastEntryUrl: "https://app.acme.com/checkout",
    browserName: "Chrome",
    browserVersion: "126",
    osName: "macOS",
    deviceType: "desktop",
    countryCode: "DE",
    ...overrides,
  };
}

function usersResponse(users: Array<JSONObject>): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(
    200,
    { users: users, nextCursor: null },
    {},
  );
}

/*
 * Routes the mocked API by URL. `list` may be a function so a test can
 * answer differently per call (paging, errors). `users` answers the
 * rollup route; without it, /users gets the status body, which the users
 * table reads as an empty page.
 */
function mockApi(
  list: (
    data: JSONObject,
    index: number,
  ) => HTTPResponse<JSONObject> | HTTPErrorResponse,
  status: JSONObject = wireStatus(),
  users?: (
    data: JSONObject,
    index: number,
  ) => HTTPResponse<JSONObject> | HTTPErrorResponse,
): void {
  let listCalls: number = 0;
  let usersCalls: number = 0;

  postMock.mockImplementation((request: unknown): Promise<unknown> => {
    const typed: { url: { toString: () => string }; data: JSONObject } =
      request as { url: { toString: () => string }; data: JSONObject };

    if (typed.url.toString().includes("/session-replay/list")) {
      const index: number = listCalls;

      listCalls += 1;

      return Promise.resolve(list(typed.data, index));
    }

    if (users && typed.url.toString().includes("/session-replay/users")) {
      const index: number = usersCalls;

      usersCalls += 1;

      return Promise.resolve(users(typed.data, index));
    }

    return Promise.resolve(new HTTPResponse<JSONObject>(200, status, {}));
  });
}

function renderTable(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <SessionReplayTable rumApplicationId={new ObjectID(APP_ID)} />
    </MemoryRouter>,
  );
}

async function waitForRows(count: number): Promise<Array<HTMLElement>> {
  await waitFor(() => {
    expect(screen.getAllByTestId("session-row").length).toBe(count);
  });

  return screen.getAllByTestId("session-row");
}

beforeEach(() => {
  postMock.mockReset();
  navigateMock.mockReset();
  clearSessionReplayHealthStore();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");

  jest
    .spyOn(Navigation, "navigate")
    .mockImplementation((...args: Array<unknown>): void => {
      navigateMock(...args);
    });
});

describe("parseSessionReplaySummary", () => {
  it("reads every additive projection and tells 'hidden' from 'anonymous'", () => {
    const row: SessionReplaySummary = parseSessionReplaySummary(wireRow());

    expect(row.routes).toHaveLength(4);
    expect(row.traceCount).toBe(3);
    expect(row.clickCount).toBe(41);
    expect(row.activeMs).toBe(54 * 60_000);
    expect(row.firstErrorOffsetMs).toBe(65_000);
    expect(row.tags).toEqual({ build: "1.4.2" });
    expect(row.isIdentityVisible).toBe(true);

    const anonymous: SessionReplaySummary = parseSessionReplaySummary(
      wireRow({ identifiedUserLabel: "" }),
    );

    expect(anonymous.identifiedUserLabel).toBe("");
    expect(anonymous.isIdentityVisible).toBe(true);

    const hiddenRow: JSONObject = wireRow();

    delete hiddenRow["identifiedUserLabel"];

    expect(parseSessionReplaySummary(hiddenRow).isIdentityVisible).toBe(false);
  });

  it("reads the pseudonymous key and the visitor id, empty when absent", () => {
    const row: SessionReplaySummary = parseSessionReplaySummary(
      wireRow({ visitorId: VISITOR_A }),
    );

    expect(row.identifiedUserKey).toBe("k1");
    expect(row.visitorId).toBe(VISITOR_A);

    const legacy: JSONObject = wireRow();

    delete legacy["identifiedUserKey"];
    delete legacy["visitorId"];

    expect(parseSessionReplaySummary(legacy).identifiedUserKey).toBe("");
    expect(parseSessionReplaySummary(legacy).visitorId).toBe("");
  });

  it("an older server's row has undefined counters, never 0", () => {
    const legacy: JSONObject = wireRow();

    for (const key of [
      "routes",
      "traceCount",
      "clickCount",
      "activeMs",
      "firstErrorOffsetMs",
      "expiresAtUnixMs",
    ]) {
      delete legacy[key];
    }

    const row: SessionReplaySummary = parseSessionReplaySummary(legacy);

    expect(row.routes).toBeUndefined();
    expect(row.traceCount).toBeUndefined();
    expect(row.clickCount).toBeUndefined();
    expect(row.activeMs).toBeUndefined();
    expect(row.expiresAtUnixMs).toBeUndefined();
  });
});

describe("signal badge parity", () => {
  it("every counter in the server's frustration total has a badge", () => {
    for (const counter of SESSION_REPLAY_FRUSTRATION_COUNTERS) {
      const row: SessionReplaySummary = parseSessionReplaySummary(
        wireRow({
          errorCount: 0,
          rageClickCount: 0,
          deadClickCount: 0,
          errorClickCount: 0,
          refreshRageCount: 0,
          traceCount: 0,
          exceptionGroupCount: 0,
          [counter]: 1,
        }),
      );

      const shown: Array<SessionReplaySignalBadge> =
        SESSION_REPLAY_SIGNAL_BADGES.filter(
          (badge: SessionReplaySignalBadge): boolean => {
            return (badge.getCount(row) ?? 0) > 0;
          },
        );

      expect(shown.length).toBeGreaterThan(0);
    }
  });
});

describe("fetchSessionReplayList", () => {
  it("sends sortBy and echoes the cursor verbatim, and reads ignoredFilters defensively", async () => {
    const cursor: JSONObject = {
      sortBy: "errorCount",
      sortValue: 4,
      sessionId: SESSION_B,
    };

    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(
        200,
        {
          sessions: [wireRow()],
          nextCursor: cursor,
          ignoredFilters: ["identifiedUserRef"],
        },
        {},
      ),
    );

    const result: SessionReplayListResult = await fetchSessionReplayList({
      rumApplicationId: new ObjectID(APP_ID),
      signal: "errors",
      startTime: new Date(NOW - DAY_MS),
      endTime: new Date(NOW),
      limit: 20,
      sortBy: "errorCount",
      cursor: { startTimeUnixMs: 1, sessionId: SESSION_A },
    });

    const sent: JSONObject = requestsTo("/session-replay/list")[0]!.data;

    expect(sent["sortBy"]).toBe("errorCount");
    expect(sent["cursor"]).toEqual({
      startTimeUnixMs: 1,
      sessionId: SESSION_A,
    });
    expect(sent["filters"]).toEqual({ hasError: true });
    expect(result.nextCursor).toEqual(cursor);
    expect(result.ignoredFilters).toEqual(["identifiedUserRef"]);
  });

  it("omits sortBy for the default order so an older server keeps answering", async () => {
    postMock.mockResolvedValue(listResponse([]));

    await fetchSessionReplayList({
      rumApplicationId: new ObjectID(APP_ID),
      signal: "all",
      startTime: new Date(NOW - DAY_MS),
      endTime: new Date(NOW),
      limit: 20,
      sortBy: "startTime",
    });

    expect(
      requestsTo("/session-replay/list")[0]!.data["sortBy"],
    ).toBeUndefined();
  });
});

describe("SessionReplayTable rendering", () => {
  it("shows skeleton rows while loading, then the rows", async () => {
    let resolveList: (value: HTTPResponse<JSONObject>) => void = (): void => {
      /* replaced below */
    };

    postMock.mockImplementation((request: unknown): Promise<unknown> => {
      const url: string = (
        request as { url: { toString: () => string } }
      ).url.toString();

      if (url.includes("/session-replay/list")) {
        return new Promise<HTTPResponse<JSONObject>>(
          (resolve: (value: HTTPResponse<JSONObject>) => void): void => {
            resolveList = resolve;
          },
        );
      }

      return Promise.resolve(
        new HTTPResponse<JSONObject>(200, wireStatus(), {}),
      );
    });

    renderTable();

    expect(
      screen.getByTestId("table-skeleton-loader").querySelectorAll("tr"),
    ).toHaveLength(10);
    expect(screen.queryByRole("progressbar")).toBeNull();

    resolveList(listResponse([wireRow()]));

    await waitForRows(1);

    expect(screen.queryByTestId("table-skeleton-loader")).toBeNull();
  });

  it("renders routes, trace count, clicks, idle hint, hours, expiry and the first-error action", async () => {
    mockApi(() => {
      return listResponse([wireRow()]);
    });

    renderTable();

    const [row] = await waitForRows(1);

    expect(row).toHaveTextContent("/checkout/payment");
    expect(screen.getByTestId("session-row-routes")).toHaveTextContent("/cart");
    expect(screen.getByTestId("session-row-routes")).toHaveTextContent(
      "(4 pages)",
    );
    expect(row).toHaveTextContent("3 traces");
    expect(row).toHaveTextContent("1 exception group");
    expect(row).toHaveTextContent("2 errors");
    expect(row).toHaveTextContent("1 rage");
    expect(screen.getByTestId("session-row-activity")).toHaveTextContent(
      "4 pages · 41 clicks · idle 40%",
    );
    expect(row).toHaveTextContent("1h 30m");
    expect(row).toHaveTextContent("expires in 6d");
    expect(row).toHaveTextContent("Always-on");
    expect(row).not.toHaveTextContent("sampled");
    expect(screen.getByTestId("session-row-user")).toHaveTextContent(
      "jane@acme.com",
    );

    const firstError: HTMLAnchorElement = screen
      .getByTestId("session-row-first-error")
      .closest("a") as HTMLAnchorElement;

    /* 65s minus the 1s pre-roll, whole seconds, on the errors rail. */
    expect(firstError.getAttribute("href")).toContain(`/${SESSION_A}`);
    expect(firstError.getAttribute("href")).toContain("t=64");
    expect(firstError.getAttribute("href")).toContain("rail=errors");
  });

  it("a provisional row says Recording now with a live dot and honest placeholders", async () => {
    mockApi(() => {
      return listResponse([
        wireRow({
          isFinalized: 0,
          chunkCount: 0,
          durationMs: 0,
          pageCount: 0,
          errorCount: 0,
          rageClickCount: 0,
          traceCount: 0,
          exceptionGroupCount: 0,
          clickCount: 0,
          activeMs: 0,
        }),
      ]);
    });

    renderTable();

    const [row] = await waitForRows(1);

    expect(screen.getByTestId("session-row-playability")).toHaveAttribute(
      "data-kind",
      "recording",
    );
    expect(row).toHaveTextContent("Recording now");
    expect(screen.getByTestId("session-row-live")).toBeInTheDocument();
    expect(row).toHaveTextContent("Not counted yet");
    expect(screen.getByTestId("session-row-activity")).toHaveTextContent(
      "counting",
    );
    expect(row).not.toHaveTextContent("0 pages");
    expect(row).not.toHaveTextContent("0 clicks");
    expect(screen.getByTestId("session-row-watch")).toBeInTheDocument();
  });

  it("an unplayable row never offers Watch and keeps the reason reachable by keyboard", async () => {
    mockApi(() => {
      return listResponse([
        wireRow({ sealedReason: "recording-lost" }),
        wireRow({ sessionId: SESSION_B, chunkCount: 0 }),
      ]);
    });

    renderTable();

    await waitForRows(2);

    expect(screen.queryByTestId("session-row-watch")).toBeNull();
    expect(screen.queryByTestId("session-row-first-error")).toBeNull();
    expect(screen.getAllByTestId("session-row-signals-only").length).toBe(2);

    const badges: Array<HTMLElement> = screen.getAllByTestId(
      "session-row-playability",
    );

    expect(badges[0]).toHaveAttribute("data-kind", "lost");
    expect(badges[0]).toHaveAttribute("tabindex", "0");
    expect(badges[0]?.getAttribute("aria-label")).toContain("Recording lost:");
    expect(badges[1]).toHaveAttribute("data-kind", "metadata-only");
  });

  it("a hidden identity column reads Hidden, not Anonymous", async () => {
    const hidden: JSONObject = wireRow();

    delete hidden["identifiedUserLabel"];

    mockApi(() => {
      return listResponse([hidden]);
    });

    renderTable();

    const [row] = await waitForRows(1);

    expect(row).toHaveTextContent("Hidden");
    expect(row).not.toHaveTextContent("Anonymous");
  });

  /*
   * Issue #3705: a page that never calls identify() used to read
   * "Anonymous" on every row. With a recorder that mints a visitor id the
   * row names the browser instead, so the same person is recognisable
   * three rows down.
   */
  it("a session with no label but a visitor id reads as that visitor", async () => {
    mockApi(() => {
      return listResponse([
        wireRow({
          identifiedUserLabel: "",
          identifiedUserKey: "",
          visitorId: VISITOR_A,
        }),
      ]);
    });

    renderTable();

    await waitForRows(1);

    expect(screen.getByTestId("session-row-user")).toHaveTextContent(
      "Visitor abc123",
    );
    expect(screen.getByTestId("session-row-user")).toHaveAttribute(
      "data-user-kind",
      "visitor",
    );
    expect(screen.getByTestId("session-user-avatar")).toHaveTextContent("V");
  });

  it("a session with neither label nor visitor id is still Anonymous, and not clickable", async () => {
    mockApi(() => {
      return listResponse([
        wireRow({ identifiedUserLabel: "", identifiedUserKey: "" }),
      ]);
    });

    renderTable();

    await waitForRows(1);

    expect(screen.getByTestId("session-row-user")).toHaveTextContent(
      "Anonymous",
    );
    expect(screen.queryByTestId("session-row-user-filter")).toBeNull();
  });

  it("shows an active-share bar under the duration and folds signals past three", async () => {
    mockApi(() => {
      return listResponse([wireRow({ deadClickCount: 2 })]);
    });

    renderTable();

    const [row] = await waitForRows(1);

    /* 54 of 90 minutes active. */
    expect(screen.getByTestId("session-row-activity-bar")).toHaveAttribute(
      "title",
      "active 60% · idle 40%",
    );

    /* errors, rage, dead shown; traces and exception groups fold into +2. */
    const more: HTMLElement = screen.getByTestId("session-row-more-signals");

    expect(more).toHaveTextContent("+2");
    expect(more.getAttribute("title")).toBe("3 traces, 1 exception group");
    /* Folded, not lost: the row still says what it carries. */
    expect(row).toHaveTextContent("1 exception group");
  });
});

describe("SessionReplayTable user filter", () => {
  it("clicking a visible label narrows the list by that user's reference and does not navigate", async () => {
    mockApi(() => {
      return listResponse([wireRow()]);
    });

    renderTable();

    await waitForRows(1);

    fireEvent.click(screen.getByTestId("session-row-user-filter"));

    await waitFor(() => {
      expect(requestsTo("/session-replay/list").length).toBe(2);
    });

    expect(requestsTo("/session-replay/list")[1]!.data["filters"]).toEqual({
      identifiedUserRef: "jane@acme.com",
    });
    expect(navigateMock).not.toHaveBeenCalled();
    /* The reference never reaches the address bar; the box shows it. */
    expect(window.location.search).not.toContain("jane");
    expect(screen.getByTestId("session-search-input")).toHaveValue(
      "user:jane@acme.com",
    );
  });

  it("clicking a visitor narrows by visitor id, writes it to the URL, and chips it short", async () => {
    mockApi(() => {
      return listResponse([
        wireRow({
          identifiedUserLabel: "",
          identifiedUserKey: "",
          visitorId: VISITOR_A,
        }),
      ]);
    });

    renderTable();

    await waitForRows(1);

    fireEvent.click(screen.getByTestId("session-row-user-filter"));

    await waitFor(() => {
      expect(requestsTo("/session-replay/list").length).toBe(2);
    });

    expect(requestsTo("/session-replay/list")[1]!.data["filters"]).toEqual({
      visitorId: VISITOR_A,
    });
    expect(navigateMock).not.toHaveBeenCalled();
    expect(window.location.search).toContain(`visitor=${VISITOR_A}`);

    const chip: HTMLElement = screen.getByTestId("session-filter-chip");

    expect(chip).toHaveAttribute("data-field", "visitorId");
    expect(chip).toHaveTextContent("Visitor");
    expect(chip).toHaveTextContent("abc123…");
    expect(chip).not.toHaveTextContent(VISITOR_A);
  });

  it("clicking a hidden identity with a key narrows by the digest without showing it", async () => {
    const hidden: JSONObject = wireRow();

    delete hidden["identifiedUserLabel"];

    mockApi(() => {
      return listResponse([hidden]);
    });

    renderTable();

    await waitForRows(1);

    fireEvent.click(screen.getByTestId("session-row-user-filter"));

    await waitFor(() => {
      expect(requestsTo("/session-replay/list").length).toBe(2);
    });

    expect(requestsTo("/session-replay/list")[1]!.data["filters"]).toEqual({
      identifiedUserKey: "k1",
    });
    expect(window.location.search).toContain("userKey=k1");

    const chip: HTMLElement = screen.getByTestId("session-filter-chip");

    expect(chip).toHaveAttribute("data-field", "identifiedUserKey");
    expect(chip).toHaveTextContent("pseudonymous key");
    /* The box has no token for a digest, so it stays empty. */
    expect(screen.getByTestId("session-search-input")).toHaveValue("");
  });

  it("a user filter replaces any other identity filter and resets to page one", async () => {
    mockApi((_data: JSONObject, index: number) => {
      return listResponse(
        [
          wireRow({
            sessionId: index === 1 ? SESSION_B : SESSION_A,
            identifiedUserLabel: "",
            identifiedUserKey: "",
            visitorId: VISITOR_A,
          }),
        ],
        index === 0
          ? { startTimeUnixMs: NOW - 3 * 60_000, sessionId: SESSION_A }
          : null,
      );
    });

    window.history.replaceState(null, "", "/?userKey=k9");

    renderTable();

    await waitForRows(1);

    expect(requestsTo("/session-replay/list")[0]!.data["filters"]).toEqual({
      identifiedUserKey: "k9",
    });

    fireEvent.click(screen.getByTestId("pagination-next-button"));

    await waitFor(() => {
      expect(window.location.search).toContain("page=2");
    });

    fireEvent.click(screen.getByTestId("session-row-user-filter"));

    await waitFor(() => {
      expect(requestsTo("/session-replay/list").length).toBe(3);
    });

    const sent: JSONObject = requestsTo("/session-replay/list")[2]!.data;

    expect(sent["filters"]).toEqual({ visitorId: VISITOR_A });
    expect(sent["cursor"]).toBeUndefined();
    expect(window.location.search).not.toContain("page=");
    expect(window.location.search).not.toContain("userKey=");
  });
});

describe("SessionReplayTable identity nudge", () => {
  function anonymousRows(
    count: number,
    visitorId: string = "",
  ): Array<JSONObject> {
    return [SESSION_A, SESSION_B, SESSION_C]
      .slice(0, count)
      .map((sessionId: string): JSONObject => {
        return wireRow({
          sessionId: sessionId,
          identifiedUserLabel: "",
          identifiedUserKey: "",
          visitorId: visitorId,
        });
      });
  }

  it("appears when three or more rows are all anonymous, and says the recorder is old when none has a visitor id", async () => {
    mockApi(() => {
      return listResponse(anonymousRows(3));
    });

    renderTable();

    await waitForRows(3);

    const nudge: HTMLElement = screen.getByTestId("session-identity-nudge");

    expect(nudge).toHaveTextContent(
      "No session here is linked to a signed-in user.",
    );
    expect(nudge).toHaveTextContent("OneUptimeReplay.identify()");
    expect(nudge).toHaveTextContent("carry no visitor id yet");
  });

  it("drops the recorder line when the rows carry visitor ids", async () => {
    mockApi(() => {
      return listResponse(anonymousRows(3, VISITOR_A));
    });

    renderTable();

    await waitForRows(3);

    expect(screen.getByTestId("session-identity-nudge")).not.toHaveTextContent(
      "carry no visitor id yet",
    );
  });

  it("does not appear with fewer than three rows, with one identified row, or when identity is hidden", async () => {
    mockApi(() => {
      return listResponse(anonymousRows(2));
    });

    const view: ReturnType<typeof render> = renderTable();

    await waitForRows(2);

    expect(screen.queryByTestId("session-identity-nudge")).toBeNull();

    view.unmount();
    postMock.mockReset();
    mockApi(() => {
      return listResponse([
        ...anonymousRows(2),
        wireRow({ sessionId: SESSION_C }),
      ]);
    });

    const identified: ReturnType<typeof render> = renderTable();

    await waitForRows(3);

    expect(screen.queryByTestId("session-identity-nudge")).toBeNull();

    identified.unmount();
    postMock.mockReset();

    const hiddenRows: Array<JSONObject> = anonymousRows(3).map(
      (row: JSONObject): JSONObject => {
        delete row["identifiedUserLabel"];
        return row;
      },
    );

    mockApi(() => {
      return listResponse(hiddenRows);
    });

    renderTable();

    await waitForRows(3);

    expect(screen.queryByTestId("session-identity-nudge")).toBeNull();
  });

  it("dismiss hides it for the tab, See users switches view, and the guide link navigates", async () => {
    mockApi(
      () => {
        return listResponse(anonymousRows(3));
      },
      wireStatus(),
      () => {
        return usersResponse([]);
      },
    );

    renderTable();

    await waitForRows(3);

    fireEvent.click(screen.getByTestId("session-identity-nudge-guide"));

    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(
      (navigateMock.mock.calls[0]![0] as { toString: () => string }).toString(),
    ).toContain("documentation");

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(screen.queryByTestId("session-identity-nudge")).toBeNull();
    expect(
      window.sessionStorage.getItem(
        `oneuptime.replay.identityNudgeDismissed:${APP_ID}`,
      ),
    ).toBe("1");

    /* Remembered: a re-render of the same list does not bring it back. */
    fireEvent.click(screen.getByRole("button", { name: "Refresh sessions" }));

    await waitFor(() => {
      expect(requestsTo("/session-replay/list").length).toBe(2);
    });

    expect(screen.queryByTestId("session-identity-nudge")).toBeNull();
  });

  it("See users switches to the users view", async () => {
    mockApi(
      () => {
        return listResponse(anonymousRows(3));
      },
      wireStatus(),
      () => {
        return usersResponse([wireRollup()]);
      },
    );

    renderTable();

    await waitForRows(3);

    fireEvent.click(screen.getByTestId("session-identity-nudge-users"));

    await waitFor(() => {
      expect(screen.getAllByTestId("session-user-row").length).toBe(1);
    });

    expect(window.location.search).toContain("view=users");
    expect(screen.queryByTestId("session-identity-nudge")).toBeNull();
  });
});

describe("SessionReplayTable users view", () => {
  it("the toggle switches to the users view, stops /list, fetches /users and writes the URL", async () => {
    mockApi(
      () => {
        return listResponse([wireRow()]);
      },
      wireStatus(),
      () => {
        return usersResponse([wireRollup()]);
      },
    );

    renderTable();

    await waitForRows(1);

    expect(screen.getByTestId("session-view-sessions")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByTestId("session-view-users"));

    await waitFor(() => {
      expect(screen.getAllByTestId("session-user-row").length).toBe(1);
    });

    expect(screen.getByTestId("session-view-users")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(window.location.search).toContain("view=users");
    expect(requestsTo("/session-replay/users").length).toBe(1);
    expect(requestsTo("/session-replay/users")[0]!.data).toEqual(
      expect.objectContaining({ rumApplicationId: APP_ID, limit: 50 }),
    );
    /* No second list request for a view nobody is looking at. */
    expect(requestsTo("/session-replay/list").length).toBe(1);
    expect(screen.queryByTestId("session-row")).toBeNull();
    expect(screen.queryByTestId("session-search-input")).toBeNull();
    expect(screen.queryByTestId("session-replay-facets")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Refresh users" }),
    ).toBeInTheDocument();
  });

  it("opens straight into the users view from the URL without ever calling /list", async () => {
    mockApi(
      () => {
        return listResponse([wireRow()]);
      },
      wireStatus(),
      () => {
        return usersResponse([wireRollup()]);
      },
    );

    window.history.replaceState(null, "", "/?view=users");

    renderTable();

    await waitFor(() => {
      expect(screen.getAllByTestId("session-user-row").length).toBe(1);
    });

    expect(requestsTo("/session-replay/list").length).toBe(0);
    expect(requestsTo("/session-replay/users").length).toBe(1);
  });

  it("a Users row's Sessions action lands on the session list narrowed to that person", async () => {
    mockApi(
      () => {
        return listResponse([wireRow()]);
      },
      wireStatus(),
      () => {
        return usersResponse([
          wireRollup({
            groupKey: `v:${VISITOR_A}`,
            kind: "visitor",
            identifiedUserKey: "",
            identifiedUserLabel: "",
          }),
        ]);
      },
    );

    window.history.replaceState(null, "", "/?view=users");

    renderTable();

    await waitFor(() => {
      expect(screen.getAllByTestId("session-user-row").length).toBe(1);
    });

    fireEvent.click(screen.getByTestId("session-user-view-sessions"));

    await waitForRows(1);

    expect(requestsTo("/session-replay/list").length).toBe(1);
    expect(requestsTo("/session-replay/list")[0]!.data["filters"]).toEqual({
      visitorId: VISITOR_A,
    });
    expect(window.location.search).not.toContain("view=");
    expect(window.location.search).toContain(`visitor=${VISITOR_A}`);
    expect(screen.getByTestId("session-view-sessions")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("Refresh in the users view refetches /users, not /list", async () => {
    mockApi(
      () => {
        return listResponse([wireRow()]);
      },
      wireStatus(),
      () => {
        return usersResponse([wireRollup()]);
      },
    );

    window.history.replaceState(null, "", "/?view=users");

    renderTable();

    await waitFor(() => {
      expect(screen.getAllByTestId("session-user-row").length).toBe(1);
    });

    fireEvent.click(screen.getByRole("button", { name: "Refresh users" }));

    await waitFor(() => {
      expect(requestsTo("/session-replay/users").length).toBe(2);
    });

    expect(requestsTo("/session-replay/list").length).toBe(0);
  });
});

describe("SessionReplayTable navigation", () => {
  it("the whole row navigates; the entry title is a real link", async () => {
    mockApi(() => {
      return listResponse([wireRow()]);
    });

    renderTable();

    const [row] = await waitForRows(1);

    fireEvent.click(row as HTMLElement);

    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(
      (navigateMock.mock.calls[0]![0] as { toString: () => string }).toString(),
    ).toContain(`/${SESSION_A}`);
    expect(navigateMock.mock.calls[0]![1]).toEqual({});

    /* The route pill carries the same title; the entry title is the anchor. */
    const title: HTMLAnchorElement | null = (row as HTMLElement).querySelector(
      'a[title="https://app.acme.com/checkout/payment"]',
    );

    expect(title).not.toBeNull();
    expect(title?.getAttribute("href")).toContain(`/${SESSION_A}`);

    /* The list URL is stamped for the player's back link. */
    expect(
      window.sessionStorage.getItem(SESSION_REPLAY_LIST_URL_STORAGE_KEY),
    ).toContain("/");
  });

  /*
   * integration-002: the stamp is read back by the player's "Sessions"
   * link through readReplayListUrl, which hands the value straight to the
   * router and therefore refuses anything that is not a same-origin path.
   * An absolute stamp was silently dropped and the back link landed on the
   * unfiltered first page, so the round trip is pinned across both modules.
   */
  it("the stamped list URL survives the player's reader, filters and all", async () => {
    mockApi(() => {
      return listResponse([wireRow()]);
    });

    renderTable();

    await waitForRows(1);

    fireEvent.click(
      screen
        .getByTestId("session-facet-signal")
        .querySelector("button") as HTMLElement,
    );
    fireEvent.click(screen.getByText("Errors"));

    await waitFor(() => {
      expect(window.location.search).toContain("signal=errors");
    });

    const stamped: string | null = window.sessionStorage.getItem(
      SESSION_REPLAY_LIST_URL_STORAGE_KEY,
    );

    expect(stamped).not.toBeNull();
    expect(stamped?.startsWith("/")).toBe(true);
    expect(stamped).toContain("signal=errors");
    expect(readReplayListUrl(window.sessionStorage)).toBe(stamped);

    /* And the same after the row navigation re-stamps on the way out. */
    fireEvent.click((await waitForRows(1))[0] as HTMLElement);

    expect(readReplayListUrl(window.sessionStorage)).toContain("signal=errors");
  });

  it("Cmd-click on the row opens a new tab", async () => {
    mockApi(() => {
      return listResponse([wireRow()]);
    });

    renderTable();

    const [row] = await waitForRows(1);

    fireEvent.click(row as HTMLElement, { metaKey: true });

    expect(navigateMock.mock.calls[0]![1]).toEqual({ openInNewTab: true });
  });

  it("Enter on a focused row navigates", async () => {
    mockApi(() => {
      return listResponse([wireRow()]);
    });

    renderTable();

    const [row] = await waitForRows(1);

    fireEvent.keyDown(row as HTMLElement, { key: "Enter" });

    expect(navigateMock).toHaveBeenCalledTimes(1);
  });

  it("a click on a badge link is the link's, not the row's", async () => {
    mockApi(() => {
      return listResponse([wireRow()]);
    });

    renderTable();

    await waitForRows(1);

    fireEvent.click(screen.getByText("3 traces"));

    /* Link navigates once (its own handler), the row does not add a second. */
    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(
      (navigateMock.mock.calls[0]![0] as { toString: () => string }).toString(),
    ).toContain("rail=traces");
  });
});

describe("SessionReplayTable search, sort and paging", () => {
  it("search is debounced into the request as the server's filter", async () => {
    mockApi(() => {
      return listResponse([wireRow()]);
    });

    renderTable();

    await waitForRows(1);

    fireEvent.change(screen.getByTestId("session-search-input"), {
      target: { value: "/checkout jane" },
    });

    await waitFor(
      () => {
        expect(requestsTo("/session-replay/list").length).toBe(2);
      },
      { timeout: SESSION_REPLAY_SEARCH_DEBOUNCE_MS * 5 },
    );

    const sent: JSONObject = requestsTo("/session-replay/list")[1]!.data;

    expect(sent["filters"]).toEqual({ urlPrefix: "/checkout", search: "jane" });
    expect(window.location.search).toContain("urlPrefix=%2Fcheckout");
    expect(window.location.search).toContain("q=jane");
  });

  it("Next pages with the server's cursor and a sort change resets it", async () => {
    mockApi((data: JSONObject, index: number) => {
      if (index === 0) {
        return listResponse([wireRow()], {
          startTimeUnixMs: NOW - 3 * 60_000,
          sessionId: SESSION_A,
        });
      }

      if (index === 1) {
        expect(data["cursor"]).toEqual({
          startTimeUnixMs: NOW - 3 * 60_000,
          sessionId: SESSION_A,
        });

        return listResponse([wireRow({ sessionId: SESSION_B })], null);
      }

      return listResponse([wireRow()], {
        sortBy: "durationMs",
        sortValue: 100,
        sessionId: SESSION_A,
      });
    });

    renderTable();

    await waitForRows(1);

    const next: HTMLElement = screen.getByTestId("pagination-next-button");

    expect(next).not.toBeDisabled();

    fireEvent.click(next);

    await waitFor(() => {
      expect(requestsTo("/session-replay/list").length).toBe(2);
    });

    await waitFor(() => {
      expect(screen.getByTestId("pagination-next-button")).toBeDisabled();
    });

    expect(window.location.search).toContain("page=2");

    const combobox: HTMLElement = screen.getByRole("combobox", {
      name: "Sort sessions",
    });

    fireEvent.keyDown(combobox, { key: "ArrowDown", code: "ArrowDown" });
    fireEvent.click(screen.getByText("Longest"));

    await waitFor(() => {
      expect(requestsTo("/session-replay/list").length).toBe(3);
    });

    const sorted: JSONObject = requestsTo("/session-replay/list")[2]!.data;

    expect(sorted["sortBy"]).toBe("durationMs");
    expect(sorted["cursor"]).toBeUndefined();
    expect(window.location.search).toContain("sort=durationMs");
    expect(window.location.search).not.toContain("page=");
  });

  it("Next is disabled without a cursor", async () => {
    mockApi(() => {
      return listResponse([wireRow()], null);
    });

    renderTable();

    await waitForRows(1);

    expect(screen.getByTestId("pagination-next-button")).toBeDisabled();
  });

  it("quick filters land in the request and the URL", async () => {
    mockApi(() => {
      return listResponse([wireRow()]);
    });

    renderTable();

    await waitForRows(1);

    fireEvent.click(
      screen
        .getByTestId("session-facet-signal")
        .querySelector("button") as HTMLElement,
    );
    fireEvent.click(screen.getByText("Traced"));

    await waitFor(() => {
      expect(requestsTo("/session-replay/list").length).toBe(2);
    });

    expect(requestsTo("/session-replay/list")[1]!.data["filters"]).toEqual({
      hasTraces: true,
    });
    expect(window.location.search).toContain("signal=traced");
  });
});

describe("SessionReplayTable filter modal", () => {
  /*
   * ux-03: the modal writes urlPrefix straight from a text input and the
   * endpoint matches it from the start of each stored address, so an
   * un-anchored value is a filter that can only ever return nothing. It is
   * anchored on apply, and the chip shows what was actually sent.
   */
  it("anchors an un-anchored URL prefix on apply, and chips what was sent", async () => {
    mockApi(() => {
      return listResponse([wireRow()]);
    });

    renderTable();

    await waitForRows(1);

    fireEvent.click(screen.getByTestId("session-open-filters"));
    fireEvent.change(screen.getByTestId("session-filter-urlPrefix"), {
      target: { value: "checkout" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply Filters" }));

    await waitFor(() => {
      expect(requestsTo("/session-replay/list").length).toBe(2);
    });

    expect(requestsTo("/session-replay/list")[1]!.data["filters"]).toEqual({
      urlPrefix: "/checkout",
    });

    const chip: HTMLElement = screen.getByTestId("session-filter-chip");

    expect(chip).toHaveTextContent("/checkout");
  });
});

describe("SessionReplayTable honesty", () => {
  /*
   * server-3: the drop is the SERVER's fact, reported in ignoredFilters.
   * The old row-shape heuristic could not see it when the ignored filter
   * matched nothing - which is exactly the case the viewer needs told.
   */
  it("an ignored user filter is called out from the server's ignoredFilters, never chipped", async () => {
    const hidden: JSONObject = wireRow();

    delete hidden["identifiedUserLabel"];

    mockApi((_data: JSONObject, index: number) => {
      return index === 0
        ? listResponse([hidden])
        : listResponse([hidden], null, ["identifiedUserRef"]);
    });

    renderTable();

    await waitForRows(1);

    fireEvent.change(screen.getByTestId("session-search-input"), {
      target: { value: "user:jane@acme.com" },
    });
    fireEvent.keyDown(screen.getByTestId("session-search-input"), {
      key: "Enter",
    });

    await waitFor(() => {
      expect(screen.getByTestId("identity-filter-ignored")).toBeInTheDocument();
    });

    expect(screen.getByTestId("identity-filter-ignored")).toHaveTextContent(
      "NOT narrowed",
    );
    expect(screen.queryByTestId("session-filter-chip")).toBeNull();
    expect(requestsTo("/session-replay/list")[1]!.data["filters"]).toEqual({
      identifiedUserRef: "jane@acme.com",
    });
    /* And the reference never reached the address bar. */
    expect(window.location.search).not.toContain("jane");
  });

  it("the notice still fires when the ignored filter matched nothing", async () => {
    mockApi((_data: JSONObject, index: number) => {
      return index === 0
        ? listResponse([wireRow()])
        : listResponse([], null, ["identifiedUserRef"]);
    });

    renderTable();

    await waitForRows(1);

    fireEvent.change(screen.getByTestId("session-search-input"), {
      target: { value: "user:ghost@acme.com" },
    });
    fireEvent.keyDown(screen.getByTestId("session-search-input"), {
      key: "Enter",
    });

    await waitFor(() => {
      expect(screen.getByTestId("identity-filter-ignored")).toBeInTheDocument();
    });

    expect(screen.getByTestId("identity-filter-ignored")).toHaveTextContent(
      "ghost@acme.com",
    );
  });

  it("rows without the identity column alone never claim the filter was dropped", async () => {
    const hidden: JSONObject = wireRow();

    delete hidden["identifiedUserLabel"];

    /* No ignoredFilters: the server applied the filter and answered. */
    mockApi(() => {
      return listResponse([hidden]);
    });

    renderTable();

    await waitForRows(1);

    fireEvent.change(screen.getByTestId("session-search-input"), {
      target: { value: "user:jane@acme.com" },
    });
    fireEvent.keyDown(screen.getByTestId("session-search-input"), {
      key: "Enter",
    });

    await waitFor(() => {
      expect(requestsTo("/session-replay/list").length).toBe(2);
    });

    await waitFor(() => {
      expect(screen.getAllByTestId("session-row").length).toBe(1);
    });

    expect(screen.queryByTestId("identity-filter-ignored")).toBeNull();
  });

  it("the 30-day search cap reads as its fix, not as 'no sessions'", async () => {
    mockApi(() => {
      return new HTTPErrorResponse(
        400,
        {
          message:
            "Search covers at most 30 days at a time. Narrow the range to search it.",
        },
        {},
      );
    });

    renderTable();

    await waitFor(() => {
      expect(screen.getByTestId("list-error")).toHaveAttribute(
        "data-kind",
        "narrow-range",
      );
    });

    expect(screen.getByTestId("list-error")).toHaveTextContent(
      "Search covers at most 30 days at a time",
    );
    expect(screen.queryByTestId("list-empty")).toBeNull();
    expect(screen.getByTestId("list-error-retry")).toBeInTheDocument();
  });

  it("an empty page under a filter is filters-match-nothing with chips", async () => {
    mockApi(() => {
      return listResponse([]);
    });

    window.history.replaceState(null, "", "/?urlPrefix=%2Fnowhere");

    renderTable();

    await waitFor(() => {
      expect(screen.getByTestId("list-empty-variant")).toHaveTextContent(
        "filters-match-nothing",
      );
    });

    expect(screen.getAllByTestId("session-filter-chip").length).toBeGreaterThan(
      0,
    );

    fireEvent.click(screen.getByTestId("session-clear-filters"));

    await waitFor(() => {
      expect(requestsTo("/session-replay/list").length).toBe(2);
    });

    expect(requestsTo("/session-replay/list")[1]!.data["filters"]).toEqual({});
  });

  it("the refresh button has an accessible name", async () => {
    mockApi(() => {
      return listResponse([wireRow()]);
    });

    renderTable();

    await waitForRows(1);

    expect(
      screen.getByRole("button", { name: "Refresh sessions" }),
    ).toBeInTheDocument();
  });
});

describe("SessionReplayTable facet integration", () => {
  it("applies facets to the server, restarts pagination, synchronizes search and clears one selection", async () => {
    mockApi((_data: JSONObject, index: number) => {
      return listResponse(
        [wireRow({ sessionId: index === 1 ? SESSION_B : SESSION_A })],
        index === 0
          ? { startTimeUnixMs: NOW - 3 * 60_000, sessionId: SESSION_A }
          : null,
      );
    });
    renderTable();
    await waitForRows(1);
    fireEvent.click(screen.getByTestId("pagination-next-button"));
    await waitFor(() => {
      expect(window.location.search).toContain("page=2");
    });
    await waitFor(() => {
      expect(screen.getByTestId("pagination-next-button")).toBeDisabled();
    });
    fireEvent.click(
      screen
        .getByTestId("session-facet-browserName")
        .querySelector("button") as HTMLElement,
    );
    fireEvent.click(screen.getByRole("option", { name: "Firefox" }));
    await waitFor(() => {
      expect(requestsTo("/session-replay/list")).toHaveLength(3);
    });
    const filtered: JSONObject = requestsTo("/session-replay/list")[2]!.data;
    expect(filtered["filters"]).toEqual({ browserNames: ["Firefox"] });
    expect(filtered["cursor"]).toBeUndefined();
    expect(window.location.search).not.toContain("page=");
    expect(window.location.search).toContain("browser=Firefox");
    expect(screen.getByTestId("session-search-input")).toHaveValue(
      "browser:Firefox",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Clear Browser filter" }),
    );
    await waitFor(() => {
      expect(requestsTo("/session-replay/list")).toHaveLength(4);
    });
    expect(requestsTo("/session-replay/list")[3]!.data["filters"]).toEqual({});
    expect(screen.getByTestId("session-search-input")).toHaveValue("");
  });

  it("restores facet selections from a shared URL without exposing user identity", async () => {
    window.history.replaceState(
      null,
      "",
      "/?browser=Firefox&device=mobile&country=gb&minDuration=120",
    );
    mockApi(() => {
      return listResponse([wireRow()]);
    });
    renderTable();
    await waitForRows(1);
    expect(screen.getByTestId("session-facet-browserName")).toHaveTextContent(
      "Firefox",
    );
    expect(screen.getByTestId("session-facet-deviceType")).toHaveTextContent(
      "Mobile",
    );
    expect(screen.getByTestId("session-facet-countryCode")).toHaveTextContent(
      "United Kingdom (GB)",
    );
    expect(
      screen.getByTestId("session-facet-minDurationSeconds"),
    ).toHaveTextContent("At least 2 minutes");
    expect(requestsTo("/session-replay/list")[0]!.data["filters"]).toEqual({
      browserNames: ["Firefox"],
      deviceTypes: ["mobile"],
      countryCodes: ["GB"],
      minDurationMs: 120000,
    });
    expect(screen.getByTestId("session-replay-facets")).not.toHaveTextContent(
      "jane@acme.com",
    );
  });
});
