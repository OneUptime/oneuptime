import "@testing-library/jest-dom";
import { act, render, screen, within } from "@testing-library/react";
/*
 * The Dashboard has its own copy of react; Common's jest moduleNameMapper
 * pins react, react-dom and react-router-dom to this project's single copy
 * for every importer (see the note at the top of ReplayStage.test.tsx).
 */
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { Mock } from "jest-mock";
import ReplayCorrelationPanel, {
  REPLAY_HEADER_EXCEPTION_GROUP_CAP,
  ReplayCorrelationPanelProps,
  ReplaySessionDetails,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayCorrelationPanel";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import SessionReplayMaskingMode from "../../../Types/Rum/SessionReplayMaskingMode";
import { MAX_EXCEPTION_FINGERPRINT_LOOKUP } from "../../../Types/Telemetry/ExceptionFingerprintLookup";

/*
 * The session details' exception groups, resolved by the panel's own
 * lookup (no resolveExceptionGroups injected): one request for the
 * header's fingerprints to POST /telemetry-exception/by-fingerprints, which
 * answers each with the exception it counts on. A fingerprint of an
 * exception merged into another is answered with the one it was merged
 * into, so its entry reads as that exception's error and opens it directly
 * - not the filtered list under a short hash. The server is mocked.
 */

interface RequestArgs {
  url: { toString: () => string };
  data: JSONObject;
}

const postMock: Mock<(args: RequestArgs) => Promise<unknown>> =
  jest.fn<(args: RequestArgs) => Promise<unknown>>();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (args: RequestArgs): Promise<unknown> => {
        return postMock(args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): JSONObject => {
        return {};
      },
    },
  };
});

const SESSION_ID: string = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const SURVIVOR_ID: string = "0193c0de-5555-4aaa-8bbb-00000000000a";

function details(exceptionFingerprints: Array<string>): ReplaySessionDetails {
  return {
    entryUrl: "https://app.acme.com/checkout",
    exitUrl: "https://app.acme.com/checkout/done",
    browserName: "Chrome",
    browserVersion: "126",
    osName: "macOS",
    deviceType: "desktop",
    countryCode: "DE",
    identifiedUserLabel: "jane@acme.com",
    identifiedUserKey: "5f4dcc3b5aa765d61d8327deb882cf99",
    visitorId: "",
    maskingMode: SessionReplayMaskingMode.MaskAllText,
    consentState: "NotRequired",
    triggerReason: "error",
    recorderKind: "dom",
    recorderVersion: "1.4.0",
    rrwebVersion: "2.0.0",
    viewportWidth: 1440,
    viewportHeight: 900,
    clockSkewMs: 0,
    payloadBytes: 2048,
    startTime: "2026-08-14T10:00:00.000Z",
    endTime: "2026-08-14T10:12:30.000Z",
    traceIds: [],
    exceptionFingerprints,
  };
}

function renderPanel(exceptionFingerprints: Array<string>): void {
  const props: ReplayCorrelationPanelProps = {
    isOpen: true,
    onClose: (): void => {
      // not asserted here
    },
    activeTabId: "session",
    onTabChange: (): void => {
      // not asserted here
    },
    sessionId: SESSION_ID,
    details: details(exceptionFingerprints),
    fidelityNotices: [],
    missingAssets: [],
    gaps: [],
  };

  render(
    <MemoryRouter>
      <ReplayCorrelationPanel {...props} />
    </MemoryRouter>,
  );
}

async function settle(): Promise<void> {
  await act(async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function lookups(): Array<RequestArgs> {
  return postMock.mock.calls.map((call: Array<unknown>): RequestArgs => {
    return call[0] as RequestArgs;
  });
}

beforeEach(() => {
  postMock.mockReset();
  postMock.mockImplementation(async () => {
    // fp-b's exception was merged into another: the answer names that one.
    return new HTTPResponse<JSONObject>(
      200,
      {
        exceptions: [
          {
            fingerprint: "fp-b",
            telemetryExceptionId: SURVIVOR_ID,
            exceptionType: "TypeError",
            message: "x is not a function",
          },
        ],
      },
      {},
    );
  });
});

describe("the session's exception groups, looked up by the panel", () => {
  it("asks once, for the header's fingerprints, the exception each counts on", async () => {
    renderPanel(["fp-b", "fp-c", "fp-b"]);
    await settle();

    expect(lookups()).toHaveLength(1);
    expect(lookups()[0]!.url.toString()).toContain(
      "/telemetry-exception/by-fingerprints",
    );
    expect(lookups()[0]!.data).toEqual({ fingerprints: ["fp-b", "fp-c"] });
  });

  it("links a merged exception's fingerprint straight to the exception it was merged into, by its error", async () => {
    renderPanel(["fp-b", "fp-c"]);
    await settle();

    const groups: HTMLElement = screen.getByTestId("details-fingerprints");
    const merged: HTMLElement = within(groups).getByRole("link", {
      name: "TypeError: x is not a function",
    });

    expect(merged).toHaveAttribute(
      "href",
      expect.stringContaining(`/exceptions/${SURVIVOR_ID}`),
    );
    expect(merged.getAttribute("href")).not.toContain("fingerprint");

    // One nobody answered for still links, to the filtered list.
    expect(
      within(groups).getByRole("link", { name: "Error fp-c" }),
    ).toHaveAttribute("href", expect.stringContaining("fingerprint"));
  });

  it("a refused lookup keeps every link, unlabelled", async () => {
    postMock.mockImplementation(async () => {
      return new HTTPErrorResponse(
        403,
        { message: "You do not have permission to read exceptions." },
        {},
      );
    });

    renderPanel(["fp-b"]);
    await settle();

    expect(
      within(screen.getByTestId("details-fingerprints")).getByRole("link", {
        name: "Error fp-b",
      }),
    ).toBeInTheDocument();
  });

  it("one request takes every fingerprint a session header keeps", () => {
    expect(MAX_EXCEPTION_FINGERPRINT_LOOKUP).toBeGreaterThanOrEqual(
      REPLAY_HEADER_EXCEPTION_GROUP_CAP,
    );
  });
});
