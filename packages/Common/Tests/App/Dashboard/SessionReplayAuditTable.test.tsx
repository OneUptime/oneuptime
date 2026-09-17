import "@testing-library/jest-dom";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Route from "../../../Types/API/Route";
import RumSessionReplayView from "../../../Models/DatabaseModels/RumSessionReplayView";
import Navigation from "../../../UI/Utils/Navigation";
import getJestMockFunction, { MockFunction } from "../../MockType";
import SessionReplayAudit from "../../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/SessionReplayAudit";
import type { SessionReplayAuditSummary } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayAuditSummary";

/*
 * Render the page through a captured ModelTable. This keeps the regression
 * focused on the cross-database enrichment contract and the Session cell,
 * while still rendering the real cell and router link users interact with.
 */

type AuditColumn = {
  title: string;
  getElement?: ((item: RumSessionReplayView) => ReactElement) | undefined;
};

type AuditFilter = {
  title: string;
  field: Record<string, unknown>;
};

type CapturedTableProps = {
  columns: Array<AuditColumn>;
  filters: Array<AuditFilter>;
  query: Record<string, unknown>;
  selectMoreFields?: Record<string, unknown> | undefined;
  onFetchSuccess?:
    | ((items: Array<RumSessionReplayView>, totalCount: number) => void)
    | undefined;
};

let capturedTableProps: CapturedTableProps | null = null;

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps): null => {
      capturedTableProps = props;
      return null;
    },
  };
});

const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return { tenantid: "project-1" };
      },
    },
  };
});

const APP_ID: ObjectID = new ObjectID("0193c0de-1111-4aaa-8bbb-000000000001");
const OTHER_APP_ID: ObjectID = new ObjectID(
  "0193c0de-2222-4aaa-8bbb-000000000002",
);
const SESSION_A: string = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const SESSION_B: string = "b1b2c3d4e5f60718293a4b5c6d7e8f90";

let currentApplicationId: ObjectID = APP_ID;
let renderedPage: ReturnType<typeof render>;

function pageElement(): ReactElement {
  return (
    <MemoryRouter>
      <SessionReplayAudit
        pageRoute={new Route("/dashboard/rum/session-replay-audit")}
        currentProject={null}
        hasPaymentMethod={true}
      />
    </MemoryRouter>
  );
}

function auditRow(sessionId?: string): RumSessionReplayView {
  const row: RumSessionReplayView = new RumSessionReplayView();

  if (sessionId !== undefined) {
    row.sessionId = sessionId;
  }

  return row;
}

function wireSummary(sessionId: string, path: string): JSONObject {
  return {
    sessionId: sessionId,
    startTime: "2026-09-13T09:30:00.000Z",
    startTimeUnixMs: Date.parse("2026-09-13T09:30:00.000Z"),
    durationMs: 725000,
    entryUrl: `https://shop.example.com${path}`,
    browserName: "Chrome",
    browserVersion: "128",
    osName: "macOS",
    deviceType: "desktop",
  };
}

function column(title: string): AuditColumn {
  const match: AuditColumn | undefined = capturedTableProps?.columns.find(
    (candidate: AuditColumn): boolean => {
      return candidate.title === title;
    },
  );

  if (!match) {
    throw new Error(`Missing ${title} column`);
  }

  return match;
}

function sessionElement(row: RumSessionReplayView): ReactElement {
  return column("Session").getElement!(row);
}

function renderSession(row: RumSessionReplayView): void {
  render(<MemoryRouter>{sessionElement(row)}</MemoryRouter>);
}

function summaryFromCell(
  row: RumSessionReplayView,
): SessionReplayAuditSummary | undefined {
  return sessionElement(row).props.summary as
    | SessionReplayAuditSummary
    | undefined;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve: (value: T) => void = (): void => {
    // Replaced by the Promise constructor.
  };
  const promise: Promise<T> = new Promise<T>((done: (value: T) => void) => {
    resolve = done;
  });

  return { promise, resolve };
}

async function flushDetachedRequest(): Promise<void> {
  /* onFetchSuccess is intentionally void; let its await + then/catch settle. */
  await Promise.resolve();
  await Promise.resolve();
}

describe("RUM session replay audit table", () => {
  beforeEach(() => {
    capturedTableProps = null;
    currentApplicationId = APP_ID;
    postMock.mockReset();
    jest
      .spyOn(Navigation, "getLastParamAsObjectID")
      .mockImplementation((): ObjectID => {
        return currentApplicationId;
      });

    renderedPage = render(pageElement());
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("keeps the permanent audit query scoped to the application and the full-id filter", () => {
    expect(capturedTableProps?.query).toEqual({ rumApplicationId: APP_ID });
    expect(capturedTableProps?.selectMoreFields).toEqual({ sessionId: true });
    expect(
      capturedTableProps?.filters.find((filter: AuditFilter): boolean => {
        return filter.title === "Session ID";
      })?.field,
    ).toEqual({ sessionId: true });
  });

  test("shows a useful compact replay link before metadata arrives", () => {
    renderSession(auditRow(SESSION_A));

    expect(screen.getByText("Open session replay")).toBeInTheDocument();
    expect(screen.getByText("Session a1b2c3d4")).toBeInTheDocument();
    expect(screen.getByText(`Full session ID ${SESSION_A}`)).toHaveClass(
      "sr-only",
    );
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      expect.stringContaining(
        `${APP_ID.toString()}/session-replay/${SESSION_A}`,
      ),
    );
  });

  test("renders an em dash rather than a dead link for a missing session id", () => {
    renderSession(auditRow());

    expect(screen.getByTestId("audit-session-empty")).toHaveTextContent("—");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  test("enriches duplicate audit rows in one application-scoped batch", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse(
        200,
        { sessions: [wireSummary(SESSION_A, "/checkout?step=payment")] },
        {},
      ),
    );
    const first: RumSessionReplayView = auditRow(SESSION_A);
    const second: RumSessionReplayView = auditRow(SESSION_A);

    await act(async () => {
      capturedTableProps!.onFetchSuccess!([first, second], 2);
      await flushDetachedRequest();
    });

    await waitFor(() => {
      expect(summaryFromCell(first)?.entryUrl).toContain("/checkout");
    });

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postMock.mock.calls[0]![0].data).toEqual({
      rumApplicationId: APP_ID.toString(),
      sessionIds: [SESSION_A],
    });

    renderSession(first);

    expect(screen.getByText("/checkout?step=payment")).toBeInTheDocument();
    expect(screen.getByTestId("audit-session-context")).toHaveTextContent(
      /Recorded .* · 12m 05s · Chrome 128 on macOS · Desktop/,
    );
    expect(screen.getByTestId("audit-session-link").title).toContain(SESSION_A);
  });

  test("keeps the linked fallback when the retained recording no longer exists", async () => {
    postMock.mockResolvedValue(new HTTPResponse(200, { sessions: [] }, {}));
    const row: RumSessionReplayView = auditRow(SESSION_A);

    await act(async () => {
      capturedTableProps!.onFetchSuccess!([row], 1);
      await flushDetachedRequest();
    });

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(1);
    });

    renderSession(row);
    expect(screen.getByText("Open session replay")).toBeInTheDocument();
    expect(screen.getByText("Session a1b2c3d4")).toBeInTheDocument();
  });

  test("a denied or failed enrichment stays usable and retries on refresh", async () => {
    postMock
      .mockResolvedValueOnce(
        new HTTPErrorResponse(403, { message: "not allowed" }, {}),
      )
      .mockResolvedValueOnce(
        new HTTPResponse(
          200,
          { sessions: [wireSummary(SESSION_A, "/account")] },
          {},
        ),
      );
    const row: RumSessionReplayView = auditRow(SESSION_A);

    await act(async () => {
      capturedTableProps!.onFetchSuccess!([row], 1);
      await flushDetachedRequest();
    });

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(1);
    });
    expect(summaryFromCell(row)).toBeUndefined();

    await act(async () => {
      capturedTableProps!.onFetchSuccess!([row], 1);
      await flushDetachedRequest();
    });

    await waitFor(() => {
      expect(summaryFromCell(row)?.entryUrl).toContain("/account");
    });
    expect(postMock).toHaveBeenCalledTimes(2);
  });

  test("a slow response for an old page cannot replace the current page", async () => {
    const oldPage: ReturnType<typeof deferred<HTTPResponse<JSONObject>>> =
      deferred<HTTPResponse<JSONObject>>();
    const currentPage: ReturnType<typeof deferred<HTTPResponse<JSONObject>>> =
      deferred<HTTPResponse<JSONObject>>();
    postMock
      .mockReturnValueOnce(oldPage.promise)
      .mockReturnValueOnce(currentPage.promise);
    const rowA: RumSessionReplayView = auditRow(SESSION_A);
    const rowB: RumSessionReplayView = auditRow(SESSION_B);

    await act(async () => {
      capturedTableProps!.onFetchSuccess!([rowA], 1);
      capturedTableProps!.onFetchSuccess!([rowB], 1);
    });

    await act(async () => {
      currentPage.resolve(
        new HTTPResponse(
          200,
          { sessions: [wireSummary(SESSION_B, "/current-page")] },
          {},
        ),
      );
      await currentPage.promise;
      await flushDetachedRequest();
    });

    await waitFor(() => {
      expect(summaryFromCell(rowB)?.entryUrl).toContain("/current-page");
    });

    await act(async () => {
      oldPage.resolve(
        new HTTPResponse(
          200,
          { sessions: [wireSummary(SESSION_A, "/old-page")] },
          {},
        ),
      );
      await oldPage.promise;
      await flushDetachedRequest();
    });

    expect(summaryFromCell(rowA)).toBeUndefined();
    expect(summaryFromCell(rowB)?.entryUrl).toContain("/current-page");
  });

  test("navigation to another application invalidates an in-flight summary", async () => {
    const oldApplication: ReturnType<
      typeof deferred<HTTPResponse<JSONObject>>
    > = deferred<HTTPResponse<JSONObject>>();
    postMock.mockReturnValue(oldApplication.promise);
    const row: RumSessionReplayView = auditRow(SESSION_A);
    const oldFetchSuccess: NonNullable<CapturedTableProps["onFetchSuccess"]> =
      capturedTableProps!.onFetchSuccess!;

    await act(async () => {
      oldFetchSuccess([row], 1);
    });

    currentApplicationId = OTHER_APP_ID;
    renderedPage.rerender(pageElement());

    expect(capturedTableProps?.query).toEqual({
      rumApplicationId: OTHER_APP_ID,
    });
    expect(summaryFromCell(row)).toBeUndefined();

    await act(async () => {
      oldFetchSuccess([row], 1);
    });
    expect(postMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      oldApplication.resolve(
        new HTTPResponse(
          200,
          { sessions: [wireSummary(SESSION_A, "/old-application")] },
          {},
        ),
      );
      await oldApplication.promise;
      await flushDetachedRequest();
    });

    expect(summaryFromCell(row)).toBeUndefined();
  });
});
