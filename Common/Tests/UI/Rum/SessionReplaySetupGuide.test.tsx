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
import { RecordingHealthStatus } from "../../../Types/Rum/SessionReplayHealth";

/*
 * The five-step live setup guide shown in place of an empty session list.
 *
 * The three live checks flip as the health status changes; "Watch it"
 * appears only with a playable session and opens the newest one through
 * the LIST endpoint (never the manifest, which writes an audit row); the
 * not-sampled cause quotes the current sample percentage; the
 * onSessionChange snippet is present; the install snippet uses the safe
 * identifier or the placeholder; the CSP block keeps 'self'
 * (session-list-15); "Run the installation test" lands on THIS
 * application's settings (settings-setup-17).
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

import SessionReplaySetupGuide, {
  LiveCheck,
  buildLiveChecks,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplaySetupGuide";
import { clearSessionReplayHealthStore } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/useSessionReplayHealth";
import {
  buildCspSnippet,
  buildScriptTagSnippet,
  getSafeAppIdentifier,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayInstallSnippet";

const APP_ID: string = "0193c0de-1111-4aaa-8bbb-000000000001";
const SESSION_ID: string = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const NOW: number = Date.parse("2026-09-05T10:00:00.000Z");

function iso(offsetMs: number): string {
  return new Date(NOW - offsetMs).toISOString();
}

function makeStatus(
  overrides?: Partial<RecordingHealthStatus>,
): RecordingHealthStatus {
  return {
    appIdentifier: "acme-web",
    allowedOrigins: [],
    policy: {
      isProjectEnabled: true,
      isApplicationEnabled: true,
      captureTrigger: "Always",
      samplePercentage: 100,
      consentMode: "NotRequired",
      maskingMode: "MaskSensitiveInputsOnly",
      retentionInDays: 7,
    },
    publishedRecorderVersion: "1.4.0",
    lastConfigFetchAt: null,
    lastChunkReceivedAt: null,
    lastSessionStartedAt: null,
    budgetExceededAt: null,
    sessionsLast24h: 0,
    playableSessionsLast24h: 0,
    refusalsLast24h: [],
    projectBytesUsedToday: 0,
    dailyByteLimit: 1024 * 1024 * 1024,
    applicationBytesUsedThisMonth: null,
    monthlyBudgetInGB: null,
    ...overrides,
  };
}

function wireStatus(overrides?: JSONObject): JSONObject {
  return {
    isProjectAllowed: true,
    isApplicationEnabled: true,
    appIdentifier: "acme-web",
    allowedOrigins: [],
    samplePercentage: 100,
    captureTrigger: "Always",
    lastChunkReceivedAt: null,
    budgetExceededAt: null,
    projectBytesUsedToday: 0,
    dailyByteLimit: 1024 * 1024 * 1024,
    applicationBytesUsedThisMonth: null,
    monthlyBudgetInGB: null,
    consentMode: "NotRequired",
    maskingMode: "MaskSensitiveInputsOnly",
    retentionInDays: 7,
    publishedRecorderVersion: "1.4.0",
    lastConfigFetchAt: null,
    lastSessionStartedAt: null,
    sessionsLast24h: 0,
    playableSessionsLast24h: 0,
    refusalsLast24h: [],
    ...overrides,
  };
}

function checkByKey(checks: Array<LiveCheck>, key: string): LiveCheck {
  const check: LiveCheck | undefined = checks.find(
    (entry: LiveCheck): boolean => {
      return entry.key === key;
    },
  );

  expect(check).toBeDefined();

  return check as LiveCheck;
}

function renderGuide(): void {
  render(
    <MemoryRouter>
      <SessionReplaySetupGuide rumApplicationId={new ObjectID(APP_ID)} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  postMock.mockReset();
  navigateMock.mockReset();
  clearSessionReplayHealthStore();

  /*
   * Only navigate is stubbed: the route builders under test call the real
   * Navigation.getFirstParam for the project segment.
   */
  jest
    .spyOn(Navigation, "navigate")
    .mockImplementation((...args: Array<unknown>): void => {
      navigateMock(...args);
    });
});

describe("buildLiveChecks", () => {
  it("with no status every row is unknown, not pending", () => {
    for (const check of buildLiveChecks(null, NOW)) {
      expect(check.state).toBe("unknown");
    }
  });

  it("never loaded: the first row is pending with the install cause, the rest wait on it", () => {
    const checks: Array<LiveCheck> = buildLiveChecks(makeStatus(), NOW);

    expect(checkByKey(checks, "loaded").state).toBe("pending");
    expect(checkByKey(checks, "loaded").detail).toContain(
      "No page has fetched this application's policy yet",
    );
    expect(checkByKey(checks, "chunk").state).toBe("pending");
    expect(checkByKey(checks, "chunk").detail).toBe(
      "Waits on the recorder loading.",
    );
    expect(checkByKey(checks, "playable").state).toBe("pending");
  });

  it("switched-off project explains that loading will not help", () => {
    const checks: Array<LiveCheck> = buildLiveChecks(
      makeStatus({
        policy: {
          isProjectEnabled: false,
          isApplicationEnabled: true,
          captureTrigger: "Always",
          samplePercentage: 100,
          consentMode: "NotRequired",
          maskingMode: "MaskAllText",
          retentionInDays: 7,
        },
      }),
      NOW,
    );

    expect(checkByKey(checks, "loaded").detail).toContain(
      "switched off for this project",
    );
  });

  it("loaded, no chunk: the cause quotes the current sample percentage", () => {
    const checks: Array<LiveCheck> = buildLiveChecks(
      makeStatus({
        lastConfigFetchAt: iso(12 * 1000),
        policy: {
          isProjectEnabled: true,
          isApplicationEnabled: true,
          captureTrigger: "Always",
          samplePercentage: 10,
          consentMode: "NotRequired",
          maskingMode: "MaskAllText",
          retentionInDays: 7,
        },
      }),
      NOW,
    );

    expect(checkByKey(checks, "loaded").state).toBe("done");
    expect(checkByKey(checks, "loaded").detail).toBe("Policy fetched 12s ago.");
    expect(checkByKey(checks, "chunk").state).toBe("pending");
    expect(checkByKey(checks, "chunk").detail).toContain(
      "Sampling is 10%, so about 1 in 10 visits records",
    );
  });

  it("loaded, no chunk, sampling 0%: says nothing records", () => {
    const checks: Array<LiveCheck> = buildLiveChecks(
      makeStatus({
        lastConfigFetchAt: iso(12 * 1000),
        policy: {
          isProjectEnabled: true,
          isApplicationEnabled: true,
          captureTrigger: "Always",
          samplePercentage: 0,
          consentMode: "NotRequired",
          maskingMode: "MaskAllText",
          retentionInDays: 7,
        },
      }),
      NOW,
    );

    expect(checkByKey(checks, "chunk").detail).toContain("Sampling is 0%");
  });

  it("loaded, no chunk: consent and error-trigger causes come before the CSP hint", () => {
    const consent: Array<LiveCheck> = buildLiveChecks(
      makeStatus({
        lastConfigFetchAt: iso(1000),
        policy: {
          isProjectEnabled: true,
          isApplicationEnabled: true,
          captureTrigger: "Always",
          samplePercentage: 100,
          consentMode: "RequireExplicit",
          maskingMode: "MaskAllText",
          retentionInDays: 7,
        },
      }),
      NOW,
    );

    expect(checkByKey(consent, "chunk").detail).toContain(
      "OneUptimeReplay.grantConsent()",
    );

    const errorTrigger: Array<LiveCheck> = buildLiveChecks(
      makeStatus({
        lastConfigFetchAt: iso(1000),
        policy: {
          isProjectEnabled: true,
          isApplicationEnabled: true,
          captureTrigger: "OnErrorOrFrustration",
          samplePercentage: 100,
          consentMode: "NotRequired",
          maskingMode: "MaskAllText",
          retentionInDays: 7,
        },
      }),
      NOW,
    );

    expect(checkByKey(errorTrigger, "chunk").detail).toContain(
      "On error or frustration",
    );

    const healthyPolicy: Array<LiveCheck> = buildLiveChecks(
      makeStatus({ lastConfigFetchAt: iso(1000) }),
      NOW,
    );

    expect(checkByKey(healthyPolicy, "chunk").detail).toContain(
      "CSP connect-src",
    );
  });

  it("a chunk without a playable session is pending; a playable session is done", () => {
    const written: Array<LiveCheck> = buildLiveChecks(
      makeStatus({
        lastConfigFetchAt: iso(1000),
        lastChunkReceivedAt: iso(1000),
        playableSessionsLast24h: 0,
      }),
      NOW,
    );

    expect(checkByKey(written, "chunk").state).toBe("done");
    expect(checkByKey(written, "playable").state).toBe("pending");

    const ready: Array<LiveCheck> = buildLiveChecks(
      makeStatus({
        lastConfigFetchAt: iso(1000),
        lastChunkReceivedAt: iso(1000),
        playableSessionsLast24h: 3,
      }),
      NOW,
    );

    expect(checkByKey(ready, "playable").state).toBe("done");
    expect(checkByKey(ready, "playable").detail).toBe(
      "3 playable sessions in the last 24h.",
    );

    const unknownCount: Array<LiveCheck> = buildLiveChecks(
      makeStatus({
        lastChunkReceivedAt: iso(1000),
        playableSessionsLast24h: null,
      }),
      NOW,
    );

    expect(checkByKey(unknownCount, "playable").state).toBe("unknown");
  });
});

describe("Install snippet builders", () => {
  it("uses the identifier only when it is within the safe charset", () => {
    expect(getSafeAppIdentifier("acme-web.v2")).toBe("acme-web.v2");
    expect(getSafeAppIdentifier('x" onload="alert(1)')).toBe(
      "YOUR_APP_IDENTIFIER",
    );
    expect(getSafeAppIdentifier("")).toBe("YOUR_APP_IDENTIFIER");
    expect(
      buildScriptTagSnippet("https://one.example.com", "acme-web"),
    ).toContain('data-oneuptime-app-identifier="acme-web"');
    expect(buildScriptTagSnippet("https://one.example.com", "<bad>")).toContain(
      'data-oneuptime-app-identifier="YOUR_APP_IDENTIFIER"',
    );
  });

  it("the script tag derives the host from its src and carries crossorigin, like the docs", () => {
    const snippet: string = buildScriptTagSnippet(
      "https://one.example.com",
      "acme-web",
    );

    expect(snippet).toContain(
      'src="https://one.example.com/telemetry/session-replay/v1/recorder.js"',
    );
    expect(snippet).toContain('crossorigin="anonymous"');
    expect(snippet).not.toContain("data-oneuptime-host");
  });

  it("the CSP block adds to 'self' rather than replacing the directive (session-list-15)", () => {
    const csp: string = buildCspSnippet("https://one.example.com");

    expect(csp).toContain("script-src  'self' https://one.example.com;");
    expect(csp).toContain("connect-src 'self' https://one.example.com;");
  });
});

describe("SessionReplaySetupGuide (rendered)", () => {
  it("never-loaded: leads with the diagnosis, shows the snippets, the live checks pending and no Watch it", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(200, wireStatus(), {}),
    );

    renderGuide();

    await screen.findByTestId("setup-guide-diagnosis");

    expect(screen.getByTestId("health-diagnosis")).toHaveAttribute(
      "data-state",
      "never-loaded",
    );
    expect(screen.getByTestId("live-check-loaded")).toHaveAttribute(
      "data-state",
      "pending",
    );
    expect(screen.queryByTestId("setup-watch-newest")).toBeNull();

    /* The identifier from the status lands in the snippet. */
    expect(screen.getByTestId("setup-step-2")).toHaveTextContent(
      'data-oneuptime-app-identifier="acme-web"',
    );
    /* Step 4 carries the correlation hook. */
    expect(screen.getByTestId("setup-correlation-snippet")).toHaveTextContent(
      "OneUptimeReplay.onSessionChange",
    );
    expect(screen.getByTestId("setup-correlation-snippet")).toHaveTextContent(
      'resource.attributes["session.id"]',
    );
    /* Step 3 keeps 'self'. */
    expect(screen.getByTestId("setup-csp-snippet")).toHaveTextContent(
      "script-src 'self'",
    );
    expect(screen.getByTestId("setup-live-checks")).toHaveAttribute(
      "aria-live",
      "polite",
    );
  });

  it("an unsafe identifier falls back to the placeholder", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(
        200,
        wireStatus({ appIdentifier: 'x" onload="alert(1)' }),
        {},
      ),
    );

    renderGuide();

    await screen.findByTestId("setup-guide-diagnosis");

    expect(screen.getByTestId("setup-step-2")).toHaveTextContent(
      'data-oneuptime-app-identifier="YOUR_APP_IDENTIFIER"',
    );
    expect(screen.getByTestId("setup-step-2")).not.toHaveTextContent("onload");
  });

  it("with a playable session, Watch it opens the newest one via the list endpoint", async () => {
    postMock.mockImplementation((request: unknown): Promise<unknown> => {
      const url: string = (
        request as { url: { toString: () => string } }
      ).url.toString();

      if (url.includes("/session-replay/list")) {
        return Promise.resolve(
          new HTTPResponse<JSONObject>(
            200,
            { sessions: [{ sessionId: SESSION_ID }], nextCursor: null },
            {},
          ),
        );
      }

      return Promise.resolve(
        new HTTPResponse<JSONObject>(
          200,
          wireStatus({
            lastConfigFetchAt: iso(1000),
            lastChunkReceivedAt: iso(1000),
            sessionsLast24h: 1,
            playableSessionsLast24h: 1,
          }),
          {},
        ),
      );
    });

    renderGuide();

    const watch: HTMLElement = await screen.findByTestId("setup-watch-newest");

    expect(screen.getByTestId("live-check-playable")).toHaveAttribute(
      "data-state",
      "done",
    );

    fireEvent.click(watch);

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledTimes(1);
    });

    const listCall: { url: { toString: () => string }; data: JSONObject } =
      postMock.mock.calls.find((call: Array<unknown>): boolean => {
        return (call[0] as { url: { toString: () => string } }).url
          .toString()
          .includes("/session-replay/list");
      })![0] as { url: { toString: () => string }; data: JSONObject };

    expect(listCall.data).toEqual({
      rumApplicationId: APP_ID,
      limit: 1,
      filters: { isPlayable: true },
    });
    expect(
      (navigateMock.mock.calls[0]![0] as { toString: () => string }).toString(),
    ).toContain(`/rum/${APP_ID}/session-replay/${SESSION_ID}`);
    /* Never the manifest: opening one writes an audit row. */
    for (const call of postMock.mock.calls) {
      expect(
        (call[0] as { url: { toString: () => string } }).url.toString(),
      ).not.toContain("/manifest");
    }
  });

  it("'Run the installation test' lands on THIS application's settings (settings-setup-17)", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(200, wireStatus(), {}),
    );

    renderGuide();

    await screen.findByTestId("setup-guide-diagnosis");
    fireEvent.click(screen.getByTestId("setup-open-install-test"));

    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(
      (navigateMock.mock.calls[0]![0] as { toString: () => string }).toString(),
    ).toContain(`/rum/${APP_ID}/session-replay-settings`);
  });

  it("a permission failure keeps the steps and says why the checks cannot run", async () => {
    postMock.mockResolvedValue(
      new HTTPErrorResponse(403, { message: "Not authorized" }, {}),
    );

    renderGuide();

    const error: HTMLElement = await screen.findByTestId(
      "setup-guide-health-error",
    );

    expect(error).toHaveTextContent("You cannot see recording health");
    expect(screen.getByTestId("setup-step-2")).toBeInTheDocument();
    expect(screen.getByTestId("live-check-loaded")).toHaveAttribute(
      "data-state",
      "unknown",
    );
  });
});
