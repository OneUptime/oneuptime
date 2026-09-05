import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
/*
 * The Dashboard has its own copy of react; Common's jest moduleNameMapper
 * pins react, react-dom and react-router-dom to this project's single copy
 * for every importer (see the note at the top of ReplayStage.test.tsx).
 */
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "@jest/globals";
import { ExceptionGroupSummary } from "../../../../App/FeatureSet/Dashboard/src/Utils/ExceptionCorrelation";
import getJestMockFunction, { MockFunction } from "../../MockType";
import SessionReplayMaskingMode from "../../../Types/Rum/SessionReplayMaskingMode";
import {
  SessionReplayFidelityNotice,
  SessionReplaySealedReason,
} from "../../../Types/Rum/SessionReplay";
import ReplayCorrelationPanel, {
  ReplayCorrelationPanelProps,
  ReplaySessionDetails,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayCorrelationPanel";
import { ReplayRailTabId } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/Rail/ReplaySignalTypes";

/*
 * The session details drawer, slimmed to Session / Privacy / Fidelity now
 * that the rail owns every backend row. What is pinned:
 *
 *  - exactly those three tabs (the embedded logs viewer and exceptions
 *    table are gone, and must not come back as tabs here);
 *  - Tags and Traits render from the details and are absent, not empty,
 *    when the manifest did not supply them (traits sit behind the identity
 *    ACL, so "absent" is a permission statement, not a data one);
 *  - "Open in rail" hands the host the rail tab to open;
 *  - the readable-content warning per masking mode is kept;
 *  - correlation-13: sub-second skew and gaps are shown in milliseconds,
 *    and the enum fields never render their raw tokens.
 */

const SESSION_ID: string = "a1b2c3d4e5f60718293a4b5c6d7e8f90";

function makeDetails(
  overrides?: Partial<ReplaySessionDetails>,
): ReplaySessionDetails {
  return {
    entryUrl: "https://app.acme.com/checkout",
    exitUrl: "https://app.acme.com/checkout/done",
    browserName: "Chrome",
    browserVersion: "126",
    osName: "macOS",
    deviceType: "desktop",
    countryCode: "DE",
    identifiedUserLabel: "jane@acme.com",
    maskingMode: SessionReplayMaskingMode.MaskAllText,
    consentState: "NotRequired",
    triggerReason: "error",
    recorderVersion: "1.4.0",
    rrwebVersion: "2.0.0",
    viewportWidth: 1440,
    viewportHeight: 900,
    clockSkewMs: 0,
    payloadBytes: 2048,
    startTime: "2026-08-14T10:00:00.000Z",
    endTime: "2026-08-14T10:12:30.000Z",
    traceIds: [],
    exceptionFingerprints: [],
    ...overrides,
  };
}

function makeProps(
  overrides?: Partial<ReplayCorrelationPanelProps>,
): ReplayCorrelationPanelProps {
  return {
    isOpen: true,
    onClose: (): void => {
      // not asserted here
    },
    activeTabId: "session",
    onTabChange: (): void => {
      // not asserted here
    },
    sessionId: SESSION_ID,
    details: makeDetails(),
    fidelityNotices: [],
    missingAssets: [],
    gaps: [],
    ...overrides,
  };
}

function renderPanel(
  overrides?: Partial<ReplayCorrelationPanelProps>,
): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <ReplayCorrelationPanel {...makeProps(overrides)} />
    </MemoryRouter>,
  );
}

describe("ReplayCorrelationPanel tabs", () => {
  it("has exactly the Session, Privacy and Fidelity tabs", () => {
    renderPanel();

    expect(screen.getByRole("button", { name: "Session" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Privacy" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^Fidelity/ }),
    ).toBeInTheDocument();

    for (const retired of ["Logs", "Errors", "Correlation"]) {
      expect(
        screen.queryByRole("button", { name: new RegExp(`^${retired}`) }),
      ).not.toBeInTheDocument();
    }
  });

  it("reports a tab click to the host and shows the controlled tab", () => {
    const onTabChange: MockFunction = getJestMockFunction();

    renderPanel({ onTabChange: onTabChange as () => void });

    fireEvent.click(screen.getByRole("button", { name: "Privacy" }));

    expect(onTabChange).toHaveBeenCalledWith("provenance");
    /* Still on Session until the host changes the prop. */
    expect(screen.getByTestId("details-tab-session")).toBeInTheDocument();
  });

  it("falls back to the Session tab for a tab id it no longer has", () => {
    renderPanel({ activeTabId: "logs" });

    expect(screen.getByTestId("details-tab-session")).toBeInTheDocument();
  });

  it("renders nothing while closed", () => {
    renderPanel({ isOpen: false });

    expect(screen.queryByText("Session details")).not.toBeInTheDocument();
  });
});

describe("ReplayCorrelationPanel Session tab", () => {
  it("renders tags and traits from the details", () => {
    renderPanel({
      details: makeDetails({
        tags: { plan: "pro", region: "eu" },
        identifiedUserTraits: { email: "jane@acme.com", tier: "gold" },
      }),
    });

    const tags: HTMLElement = screen.getByTestId("details-tags");

    expect(within(tags).getByText("Tags (2)")).toBeInTheDocument();
    expect(within(tags).getByText("plan")).toBeInTheDocument();
    expect(within(tags).getByText("pro")).toBeInTheDocument();

    const traits: HTMLElement = screen.getByTestId("details-traits");

    expect(within(traits).getByText("Traits (2)")).toBeInTheDocument();
    expect(within(traits).getByText("tier")).toBeInTheDocument();
    expect(within(traits).getByText("gold")).toBeInTheDocument();
  });

  it("omits the Tags and Traits sections when the manifest did not supply them", () => {
    renderPanel({
      details: makeDetails({ tags: undefined, identifiedUserTraits: null }),
    });

    expect(screen.queryByTestId("details-tags")).not.toBeInTheDocument();
    expect(screen.queryByTestId("details-traits")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Tags \(/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Traits \(/)).not.toBeInTheDocument();
  });

  it("treats an empty map as absent rather than rendering a zero", () => {
    renderPanel({
      details: makeDetails({ tags: {}, identifiedUserTraits: {} }),
    });

    expect(screen.queryByTestId("details-tags")).not.toBeInTheDocument();
    expect(screen.queryByTestId("details-traits")).not.toBeInTheDocument();
  });

  it("distinguishes 'identity not shown' from 'anonymous' from a label", () => {
    const { unmount } = renderPanel({
      details: makeDetails({ identifiedUserLabel: null }),
    });

    expect(screen.getByTestId("replay-details-end-user")).toHaveTextContent(
      "identity permission",
    );
    unmount();

    const second: ReturnType<typeof render> = renderPanel({
      details: makeDetails({ identifiedUserLabel: "" }),
    });

    expect(screen.getByTestId("replay-details-end-user")).toHaveTextContent(
      "Anonymous",
    );
    expect(screen.getByTestId("replay-details-end-user")).not.toHaveTextContent(
      "Shown on the session list",
    );
    second.unmount();

    renderPanel({
      details: makeDetails({ identifiedUserLabel: "jane@acme.com" }),
    });

    expect(screen.getByTestId("replay-details-end-user")).toHaveTextContent(
      "jane@acme.com",
    );
  });

  it("'Open in rail' hands the host the rail tab to open", () => {
    const onOpenRailTab: MockFunction = getJestMockFunction();

    renderPanel({
      onOpenRailTab: onOpenRailTab as (tabId: ReplayRailTabId) => void,
      details: makeDetails({
        traceIds: ["4bf92f3577b34da6a3ce929d0e0e4736"],
        exceptionFingerprints: ["fp-1", "fp-2"],
      }),
      railCounts: { logs: 37 },
    });

    fireEvent.click(screen.getByTestId("details-open-rail-traces"));
    fireEvent.click(screen.getByTestId("details-open-rail-errors"));
    fireEvent.click(screen.getByTestId("details-open-rail-logs"));

    expect(
      onOpenRailTab.mock.calls.map((call: Array<unknown>) => {
        return call[0];
      }),
    ).toEqual(["traces", "errors", "logs"]);

    expect(screen.getByTestId("details-rail-traces")).toHaveTextContent(
      "1 trace",
    );
    expect(screen.getByTestId("details-rail-errors")).toHaveTextContent(
      "2 errors",
    );
    expect(screen.getByTestId("details-rail-logs")).toHaveTextContent(
      "37 logs",
    );
  });

  it("renders no rail buttons without a host to open the rail, and never claims 0 logs before a fetch", () => {
    renderPanel();

    expect(
      screen.queryByTestId("details-open-rail-traces"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("details-rail-logs")).toHaveTextContent(
      "not fetched yet",
    );
    expect(screen.getByTestId("details-rail-logs")).not.toHaveTextContent("0");
  });

  it("keeps the header's coarse trace ids and fingerprints as links", async () => {
    renderPanel({
      details: makeDetails({
        traceIds: ["4bf92f3577b34da6a3ce929d0e0e4736"],
        exceptionFingerprints: ["fp-1"],
      }),
      resolveExceptionGroups: async (): Promise<
        Map<string, ExceptionGroupSummary>
      > => {
        return new Map<string, ExceptionGroupSummary>();
      },
    });

    expect(
      within(screen.getByTestId("details-trace-ids")).getByRole("link", {
        name: "4bf92f3577b34da6a3ce929d0e0e4736",
      }),
    ).toBeInTheDocument();

    /*
     * correlation-7: a group nobody could resolve still links, under the
     * short-hash label the shared helper defines - the link is never lost.
     */
    await act(async (): Promise<void> => {
      await Promise.resolve();
    });

    const fingerprints: HTMLElement = screen.getByTestId(
      "details-fingerprints",
    );

    expect(
      within(fingerprints).getByRole("link", { name: "Error fp-1" }),
    ).toBeInTheDocument();
  });

  /*
   * correlation-7: the panel used to render the bare fingerprint hash and
   * link it to a filtered list. It resolves the groups in one lookup now,
   * so the viewer reads the error and lands on it directly.
   */
  it("renders resolved exception groups by their error, linked to the exception", async () => {
    const seen: Array<Array<string>> = [];

    renderPanel({
      details: makeDetails({
        exceptionFingerprints: ["fp-1", "fp-2"],
      }),
      resolveExceptionGroups: async (
        fingerprints: Array<string>,
      ): Promise<Map<string, ExceptionGroupSummary>> => {
        seen.push(fingerprints);

        return new Map<string, ExceptionGroupSummary>([
          [
            "fp-1",
            {
              id: "0193c0de-1111-4aaa-8bbb-000000000001",
              fingerprint: "fp-1",
              exceptionType: "TypeError",
              message: "x is not a function",
            },
          ],
        ]);
      },
    });

    await act(async (): Promise<void> => {
      await Promise.resolve();
    });

    const fingerprints: HTMLElement = screen.getByTestId(
      "details-fingerprints",
    );

    /* One request for the whole set, not one per fingerprint. */
    expect(seen).toEqual([["fp-1", "fp-2"]]);
    expect(
      within(fingerprints).getByRole("link", {
        name: "TypeError: x is not a function",
      }),
    ).toBeInTheDocument();
    /* The unresolved one degrades rather than disappearing. */
    expect(
      within(fingerprints).getByRole("link", { name: "Error fp-2" }),
    ).toBeInTheDocument();
    expect(fingerprints).not.toHaveTextContent(/^fp-1$/);
  });

  /*
   * player-shell-18: nothing produces missingAssets, so the prop is
   * optional and its section is absent rather than showing "(0)".
   */
  it("omits the missing-assets section when nobody measured it", () => {
    renderPanel({ activeTabId: "fidelity", missingAssets: undefined });

    expect(screen.queryByText(/Missing assets/)).not.toBeInTheDocument();
  });
});

describe("ReplayCorrelationPanel Privacy tab", () => {
  it("keeps the readable-content warning per masking mode", () => {
    const first: ReturnType<typeof render> = renderPanel({
      activeTabId: "provenance",
      details: makeDetails({
        maskingMode: SessionReplayMaskingMode.MaskAllText,
      }),
    });

    expect(
      screen.queryByTestId("replay-details-readable-warning"),
    ).not.toBeInTheDocument();
    first.unmount();

    const second: ReturnType<typeof render> = renderPanel({
      activeTabId: "provenance",
      details: makeDetails({
        maskingMode: SessionReplayMaskingMode.MaskInputsOnly,
      }),
    });

    expect(
      screen.getByTestId("replay-details-readable-warning"),
    ).toHaveTextContent("only input values were masked");
    second.unmount();

    renderPanel({
      activeTabId: "provenance",
      details: makeDetails({
        maskingMode: SessionReplayMaskingMode.MaskSensitiveInputsOnly,
      }),
    });

    expect(
      screen.getByTestId("replay-details-readable-warning"),
    ).toHaveTextContent("did not declare as sensitive");
  });

  /*
   * ux-20: the panel printed the masking enum de-camel-cased ("Mask
   * Sensitive Inputs Only"), which names a constant rather than telling
   * the viewer what was recorded - and disagreed with the recording-health
   * card and the settings page, which already spell the same three modes.
   */
  it("describes the masking mode in the product's words, not the enum's", () => {
    const first: ReturnType<typeof render> = renderPanel({
      activeTabId: "provenance",
      details: makeDetails({
        maskingMode: SessionReplayMaskingMode.MaskSensitiveInputsOnly,
      }),
    });

    expect(screen.getByTestId("replay-details-masking-mode")).toHaveTextContent(
      "Sensitive inputs masked, page text recorded",
    );
    expect(
      screen.getByTestId("replay-details-masking-mode"),
    ).not.toHaveTextContent("Mask Sensitive Inputs Only");
    first.unmount();

    const second: ReturnType<typeof render> = renderPanel({
      activeTabId: "provenance",
      details: makeDetails({
        maskingMode: SessionReplayMaskingMode.MaskAllText,
      }),
    });

    expect(screen.getByTestId("replay-details-masking-mode")).toHaveTextContent(
      "All text masked (wireframe)",
    );
    second.unmount();

    /* An unknown value says so rather than being dressed up as a label. */
    renderPanel({
      activeTabId: "provenance",
      details: makeDetails({ maskingMode: "SomethingNewer" }),
    });

    expect(screen.getByTestId("replay-details-masking-mode")).toHaveTextContent(
      "unrecognised value (SomethingNewer)",
    );
  });

  it("shows a sub-second clock skew in milliseconds, never '0s (server-clamped)'", () => {
    renderPanel({
      activeTabId: "provenance",
      details: makeDetails({ clockSkewMs: 300 }),
    });

    expect(screen.getByTestId("replay-details-skew")).toHaveTextContent(
      "300 ms ahead (server-clamped)",
    );
    expect(screen.getByTestId("replay-details-skew")).not.toHaveTextContent(
      "0s",
    );
  });

  it("maps the consent state and trigger reason to readable copy", () => {
    renderPanel({
      activeTabId: "provenance",
      details: makeDetails({
        consentState: "NotRequired",
        triggerReason: "error",
      }),
    });

    expect(screen.getByTestId("replay-details-consent")).toHaveTextContent(
      "Not required",
    );
    expect(screen.getByTestId("replay-details-trigger")).toHaveTextContent(
      "An error occurred",
    );
    expect(screen.getByTestId("replay-details-trigger")).not.toHaveTextContent(
      /^Why recordederror$/,
    );
  });
});

describe("ReplayCorrelationPanel Fidelity tab", () => {
  it("explains why the recording ended from the sealed reason", () => {
    renderPanel({
      activeTabId: "fidelity",
      details: makeDetails({
        sealedReason: SessionReplaySealedReason.Budget,
        isFinalized: true,
      }),
    });

    expect(
      screen.getByTestId("replay-details-sealed-reason"),
    ).toHaveTextContent("upload budget exhausted");
  });

  it("says a still-open session has not been sealed yet", () => {
    renderPanel({
      activeTabId: "fidelity",
      details: makeDetails({ sealedReason: "", isFinalized: false }),
    });

    expect(
      screen.getByTestId("replay-details-sealed-reason"),
    ).toHaveTextContent("Still recording");
  });

  it("shows a sub-second gap in milliseconds, never '0s missing'", () => {
    renderPanel({
      activeTabId: "fidelity",
      gaps: [{ fromIndex: 3, toIndex: 5, missingMs: 500 }],
    });

    expect(screen.getByTestId("replay-details-gap")).toHaveTextContent(
      "500 ms missing between chunk 3 and chunk 5",
    );
  });

  it("orders playback-affecting notices before quiet capture notes", () => {
    renderPanel({
      activeTabId: "fidelity",
      fidelityNotices: [
        SessionReplayFidelityNotice.FontsOmitted,
        SessionReplayFidelityNotice.SnapshotTooLarge,
        SessionReplayFidelityNotice.SignalCapReached,
      ],
    });

    const notices: Array<HTMLElement> = screen.getAllByTestId(
      "replay-details-notice",
    );

    expect(notices).toHaveLength(3);
    expect(notices[0]).toHaveTextContent("A snapshot was too large to store");
    expect(notices[2]).toHaveTextContent("per-session cap was reached");
    /* The raw code never reaches the reader. */
    expect(screen.queryByText("signal-cap-reached")).not.toBeInTheDocument();
  });
});
