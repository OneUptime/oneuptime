import { beforeAll, beforeEach, describe, expect, test } from "@jest/globals";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import type {
  SessionReplayAuditPresentation,
  SessionReplayAuditSummary,
} from "../../FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayAuditSummary";

jest.mock("Common/UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: jest.fn(),
    },
  };
});

jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return { tenantid: "project-1" };
      },
    },
  };
});

const APP_ID: string = "0193c0de-1111-4aaa-8bbb-000000000001";
const SESSION_A: string = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const SESSION_B: string = "b1b2c3d4e5f60718293a4b5c6d7e8f90";
const START: string = "2026-09-13T09:30:00.000Z";

type SummaryModule =
  typeof import("../../FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayAuditSummary");

let summaryModule: SummaryModule;
let postMock: jest.Mock;

function wireSummary(overrides: JSONObject = {}): JSONObject {
  return {
    sessionId: SESSION_A,
    startTime: START,
    startTimeUnixMs: String(Date.parse(START)),
    durationMs: "725000",
    entryUrl: "https://shop.example.com/checkout?step=payment",
    browserName: "Chrome",
    browserVersion: "128",
    osName: "macOS",
    deviceType: "desktop",
    ...overrides,
  };
}

beforeAll(async () => {
  (globalThis as Record<string, unknown>)["window"] = {
    location: { pathname: "/", search: "", hash: "" },
    history: {
      state: null,
      replaceState: (): void => {
        // Not used by this client.
      },
    },
  };

  const api: { default: { post: jest.Mock } } = (await import(
    "Common/UI/Utils/API/API"
  )) as unknown as { default: { post: jest.Mock } };

  postMock = api.default.post;
  summaryModule = await import(
    "../../FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayAuditSummary"
  );
});

beforeEach(() => {
  postMock.mockReset();
});

describe("session replay audit summary presentation", () => {
  test("uses the entry path as the primary label and keeps useful context", () => {
    const summary: SessionReplayAuditSummary =
      summaryModule.parseSessionReplayAuditSummary(wireSummary());
    const presentation: SessionReplayAuditPresentation =
      summaryModule.describeSessionReplayAuditSession({
        sessionId: SESSION_A,
        summary: summary,
      });

    expect(presentation.primaryLabel).toBe("/checkout?step=payment");
    expect(presentation.sessionLabel).toBe("Session a1b2c3d4");
    expect(presentation.fullSessionId).toBe(SESSION_A);
    expect(presentation.startedAt?.toISOString()).toBe(START);
    expect(presentation.durationLabel).toBe("12m 05s");
    expect(presentation.deviceLabel).toBe("Chrome 128 on macOS · Desktop");
  });

  test("falls back to a readable replay action and short id without metadata", () => {
    expect(
      summaryModule.describeSessionReplayAuditSession({
        sessionId: SESSION_A,
      }),
    ).toMatchObject({
      primaryLabel: "Open session replay",
      sessionLabel: "Session a1b2c3d4",
      fullSessionId: SESSION_A,
      startedAt: null,
      durationLabel: "",
      deviceLabel: "",
    });
  });

  test("never applies metadata belonging to a different session id", () => {
    const summary: SessionReplayAuditSummary =
      summaryModule.parseSessionReplayAuditSummary(wireSummary());

    expect(
      summaryModule.describeSessionReplayAuditSession({
        sessionId: SESSION_B,
        summary: summary,
      }).primaryLabel,
    ).toBe("Open session replay");
  });

  test("handles roots, relative paths and invalid dates defensively", () => {
    expect(summaryModule.sessionReplayEntryPath("https://example.com")).toBe(
      "/",
    );
    expect(summaryModule.sessionReplayEntryPath("/already-relative?q=1")).toBe(
      "/already-relative?q=1",
    );

    const summary: SessionReplayAuditSummary =
      summaryModule.parseSessionReplayAuditSummary(
        wireSummary({ startTime: "not-a-date", startTimeUnixMs: undefined }),
      );

    expect(summaryModule.sessionReplayStartDate(summary)).toBeNull();
  });

  test("omits empty duration and device details instead of rendering placeholders", () => {
    const summary: SessionReplayAuditSummary =
      summaryModule.parseSessionReplayAuditSummary(
        wireSummary({
          durationMs: 0,
          browserName: "",
          browserVersion: "",
          osName: "",
          deviceType: "",
        }),
      );
    const presentation: SessionReplayAuditPresentation =
      summaryModule.describeSessionReplayAuditSession({
        sessionId: SESSION_A,
        summary: summary,
      });

    expect(presentation.durationLabel).toBe("");
    expect(presentation.deviceLabel).toBe("");
  });
});

describe("fetchSessionReplayAuditSummaries", () => {
  test("deduplicates ids and makes one application-scoped request", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse(200, { sessions: [wireSummary()] }, {}),
    );

    const summaries: Map<string, SessionReplayAuditSummary> =
      await summaryModule.fetchSessionReplayAuditSummaries({
        rumApplicationId: new ObjectID(APP_ID),
        sessionIds: [SESSION_A, SESSION_A, ` ${SESSION_B} `, "", undefined],
      });

    expect(postMock).toHaveBeenCalledTimes(1);

    const request: {
      url: { toString(): string };
      data: JSONObject;
      headers: Record<string, string>;
    } = postMock.mock.calls[0]![0] as {
      url: { toString(): string };
      data: JSONObject;
      headers: Record<string, string>;
    };

    expect(request.url.toString()).toContain(
      "/telemetry/rum/session-replay/summaries",
    );
    expect(request.data).toEqual({
      rumApplicationId: APP_ID,
      sessionIds: [SESSION_A, SESSION_B],
    });
    expect(request.headers).toEqual({ tenantid: "project-1" });
    expect(summaries.get(SESSION_A)?.entryUrl).toContain("/checkout");
  });

  test("ignores unsolicited and malformed response rows", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse(
        200,
        {
          sessions: [
            wireSummary({ sessionId: SESSION_B }),
            wireSummary({ sessionId: "" }),
          ],
        },
        {},
      ),
    );

    const summaries: Map<string, SessionReplayAuditSummary> =
      await summaryModule.fetchSessionReplayAuditSummaries({
        rumApplicationId: new ObjectID(APP_ID),
        sessionIds: [SESSION_A],
      });

    expect(summaries.size).toBe(0);
  });

  test("does not call the API when a page has no session ids", async () => {
    const summaries: Map<string, SessionReplayAuditSummary> =
      await summaryModule.fetchSessionReplayAuditSummaries({
        rumApplicationId: new ObjectID(APP_ID),
        sessionIds: ["", "   ", null, undefined],
      });

    expect(summaries.size).toBe(0);
    expect(postMock).not.toHaveBeenCalled();
  });

  test("propagates endpoint failures so the page can choose its fallback", async () => {
    postMock.mockResolvedValue(
      new HTTPErrorResponse(403, { message: "Not authorized" }, {}),
    );

    await expect(
      summaryModule.fetchSessionReplayAuditSummaries({
        rumApplicationId: new ObjectID(APP_ID),
        sessionIds: [SESSION_A],
      }),
    ).rejects.toBeInstanceOf(HTTPErrorResponse);
  });
});
