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
import fs from "fs";
import path from "path";
import { ExceptionGroupSummary } from "../../../../App/FeatureSet/Dashboard/src/Utils/ExceptionCorrelation";
import getJestMockFunction, { MockFunction } from "../../MockType";
import SessionReplayMaskingMode from "../../../Types/Rum/SessionReplayMaskingMode";
import {
  SessionReplayFidelityNotice,
  SessionReplaySealedReason,
} from "../../../Types/Rum/SessionReplay";
import ReplayCorrelationPanel, {
  getReplayDetailsExternalUrl,
  REPLAY_HEADER_EXCEPTION_GROUP_CAP,
  REPLAY_HEADER_FINAL_TRACE_ID_CAP,
  REPLAY_HEADER_LIVE_TRACE_ID_CAP,
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

    expect(screen.getByRole("tab", { name: "Session" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Privacy" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^Fidelity/ })).toBeInTheDocument();

    for (const retired of ["Logs", "Errors", "Correlation"]) {
      expect(
        screen.queryByRole("tab", { name: new RegExp(`^${retired}`) }),
      ).not.toBeInTheDocument();
    }
  });

  it("reports a tab click to the host and shows the controlled tab", () => {
    const onTabChange: MockFunction = getJestMockFunction();

    renderPanel({ onTabChange: onTabChange as () => void });

    fireEvent.click(screen.getByRole("tab", { name: "Privacy" }));

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

  it("exposes the drawer and its active content with dialog and tab semantics", () => {
    renderPanel();

    expect(
      screen.getByRole("dialog", { name: "Session details" }),
    ).toHaveAttribute("aria-modal", "true");
    expect(
      screen.getByRole("tablist", { name: "Detail sections" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Session" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("Session");
    expect(
      screen.getByRole("button", { name: "Close details panel" }),
    ).toBeInTheDocument();
  });
});

describe("getReplayDetailsExternalUrl", () => {
  it("accepts HTTP(S) destinations and preserves their display value", () => {
    expect(getReplayDetailsExternalUrl("https://app.acme.com/a?b=1#c")).toBe(
      "https://app.acme.com/a?b=1#c",
    );
    expect(getReplayDetailsExternalUrl("http://localhost:3000/path")).toBe(
      "http://localhost:3000/path",
    );
  });

  it("rejects executable, non-web and malformed destinations", () => {
    expect(getReplayDetailsExternalUrl("javascript:alert(1)")).toBeNull();
    expect(getReplayDetailsExternalUrl("data:text/html,hello")).toBeNull();
    expect(getReplayDetailsExternalUrl("/relative/path")).toBeNull();
    expect(getReplayDetailsExternalUrl("not a URL")).toBeNull();
    expect(getReplayDetailsExternalUrl("   ")).toBeNull();
  });
});

describe("ReplayCorrelationPanel Session tab", () => {
  it("labels React Native recordings as an app rather than a browser", () => {
    renderPanel({
      details: makeDetails({
        recorderKind: "rn-view-tree",
        browserName: "Acme Mobile",
        browserVersion: "4.2.0",
        osName: "ios 18.1",
        deviceType: "ios",
      }),
    });

    const client: HTMLElement = screen.getByTestId("replay-details-browser");
    const device: HTMLElement = screen.getByTestId("replay-details-device");

    expect(client).toHaveTextContent("AppAcme Mobile 4.2.0");
    expect(client).toHaveAttribute("data-tile-icon", "DevicePhoneMobile");
    expect(device).toHaveTextContent("DeviceiOS");
    expect(device).toHaveAttribute("data-tile-icon", "DevicePhoneMobile");
    expect(screen.getByTestId("details-section-environment")).toHaveAttribute(
      "data-section-icon",
      "DevicePhoneMobile",
    );
    expect(screen.queryByText("Browser")).not.toBeInTheDocument();
    expect(
      screen.getByText(/Mobile traces and logs reach this rail/),
    ).toHaveTextContent("OneUptimeReplay.onSessionChange()");
    /*
     * Issue #3979 made web linking automatic; React Native did not change.
     * Its SDK instruments no networking, so the manual hook stays, and the
     * copy says why rather than borrowing the web's "automatic" claim.
     */
    expect(
      screen.getByText(/Mobile traces and logs reach this rail/),
    ).toHaveTextContent("adds nothing to your app's own requests");
    expect(
      screen.queryByTestId("details-correlation-web"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/recorder stamps session.id on its own network/),
    ).not.toBeInTheDocument();
  });

  /*
   * Issue #3979: a web recording links backend telemetry with no code -
   * same-origin requests carry the session's trace context, ingest stamps
   * spans, the rail joins logs and exceptions by trace id. The copy used
   * to say every other signal "must add the same attribute" through
   * onSessionChange; the hook is optional now.
   */
  it("tells a web recording that backend linking is automatic and the session hook optional", () => {
    renderPanel();

    const copy: HTMLElement = screen.getByTestId("details-correlation-web");

    expect(copy).toHaveTextContent("own origin");
    expect(copy).toHaveTextContent("stamped with its id at ingest");
    expect(copy).toHaveTextContent("by trace id");
    expect(copy).toHaveTextContent("no code needed");
    expect(copy).toHaveTextContent("Trace propagation origins");
    expect(copy).toHaveTextContent(
      "OneUptimeReplay.onSessionChange() is optional",
    );
    expect(copy).not.toHaveTextContent("must add");
    expect(copy).not.toHaveTextContent("Signals are matched using session.id");
    expect(copy).not.toHaveTextContent(
      /recorder stamps session.id on its own network/,
    );
    expect(
      screen.queryByText(/Mobile traces and logs reach this rail/),
    ).not.toBeInTheDocument();
  });

  it("organizes metadata into named, semantic sections", () => {
    renderPanel();

    const sectionNames: Array<string> = [
      "Session",
      "Journey",
      "Environment",
      "Related telemetry",
    ];

    for (const name of sectionNames) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }

    expect(screen.getByTestId("details-section-session").tagName).toBe(
      "SECTION",
    );
    expect(screen.getByTestId("details-section-journey").tagName).toBe(
      "SECTION",
    );
    expect(screen.getByTestId("details-section-environment").tagName).toBe(
      "SECTION",
    );
    expect(screen.getByTestId("details-section-telemetry").tagName).toBe(
      "SECTION",
    );
  });

  it("shortens the header identifier while keeping the full copyable session ID", () => {
    renderPanel();

    expect(screen.getByTitle(SESSION_ID)).toHaveTextContent(
      `Session ${SESSION_ID.slice(0, 12)}…`,
    );
    expect(screen.getByTestId("replay-details-session-id")).toHaveTextContent(
      SESSION_ID,
    );
    expect(
      screen.getByRole("button", { name: "Copy full Session ID" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Copy Session ID" }),
    ).toBeInTheDocument();
  });

  it("renders safe journey URLs as external links with copy actions", () => {
    renderPanel();

    const entry: HTMLElement = screen.getByTestId("replay-details-entry-url");
    const entryLink: HTMLElement = within(entry).getByRole("link", {
      name: "Entry URL: https://app.acme.com/checkout (opens in a new tab)",
    });

    expect(entryLink).toHaveAttribute("href", "https://app.acme.com/checkout");
    expect(entryLink).toHaveAttribute("target", "_blank");
    expect(entryLink).toHaveAttribute("rel", "noreferrer");
    expect(
      within(entry).getByRole("button", { name: "Copy Entry URL" }),
    ).toBeInTheDocument();

    const exit: HTMLElement = screen.getByTestId("replay-details-exit-url");
    expect(
      within(exit).getByRole("link", {
        name: "Exit URL: https://app.acme.com/checkout/done (opens in a new tab)",
      }),
    ).toHaveAttribute("href", "https://app.acme.com/checkout/done");
    expect(
      within(exit).getByRole("button", { name: "Copy Exit URL" }),
    ).toBeInTheDocument();
  });

  it("copies the exact full session ID and journey URL with feedback", async () => {
    const writeText: MockFunction =
      getJestMockFunction().mockResolvedValue(undefined);
    const originalClipboard: PropertyDescriptor | undefined =
      Object.getOwnPropertyDescriptor(navigator, "clipboard");

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    const view: ReturnType<typeof render> = renderPanel();

    try {
      await act(async (): Promise<void> => {
        fireEvent.click(
          screen.getByRole("button", { name: "Copy Session ID" }),
        );
        await Promise.resolve();
      });

      expect(writeText).toHaveBeenLastCalledWith(SESSION_ID);
      expect(
        within(screen.getByTestId("replay-details-session-id")).getByRole(
          "button",
          { name: "Copied" },
        ),
      ).toBeInTheDocument();

      await act(async (): Promise<void> => {
        fireEvent.click(screen.getByRole("button", { name: "Copy Entry URL" }));
        await Promise.resolve();
      });

      expect(writeText).toHaveBeenLastCalledWith(
        "https://app.acme.com/checkout",
      );
      expect(
        within(screen.getByTestId("replay-details-entry-url")).getByRole(
          "button",
          { name: "Copied" },
        ),
      ).toBeInTheDocument();
    } finally {
      view.unmount();

      if (originalClipboard) {
        Object.defineProperty(navigator, "clipboard", originalClipboard);
      } else {
        Reflect.deleteProperty(navigator, "clipboard");
      }
    }
  });

  it("prevents overlapping clipboard writes while a copy is pending", async () => {
    let resolveWrite: (() => void) | undefined;
    const pendingWrite: Promise<void> = new Promise<void>(
      (resolve: () => void): void => {
        resolveWrite = resolve;
      },
    );
    const writeText: MockFunction = getJestMockFunction().mockImplementation(
      (): Promise<void> => {
        return pendingWrite;
      },
    );
    const originalClipboard: PropertyDescriptor | undefined =
      Object.getOwnPropertyDescriptor(navigator, "clipboard");

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    const view: ReturnType<typeof render> = renderPanel();

    try {
      fireEvent.click(screen.getByRole("button", { name: "Copy Session ID" }));

      const pendingButton: HTMLElement = screen.getByRole("button", {
        name: "Copying",
      });

      expect(pendingButton).toBeDisabled();
      expect(pendingButton).toHaveAttribute("aria-busy", "true");

      fireEvent.click(pendingButton);
      expect(writeText).toHaveBeenCalledTimes(1);

      await act(async (): Promise<void> => {
        resolveWrite?.();
        await pendingWrite;
        await Promise.resolve();
      });

      expect(
        screen.getByRole("button", { name: "Copied" }),
      ).toBeInTheDocument();
    } finally {
      resolveWrite?.();
      view.unmount();

      if (originalClipboard) {
        Object.defineProperty(navigator, "clipboard", originalClipboard);
      } else {
        Reflect.deleteProperty(navigator, "clipboard");
      }
    }
  });

  it("shows a manual-copy fallback when clipboard access is unavailable", async () => {
    const onClose: MockFunction = getJestMockFunction();
    const originalClipboard: PropertyDescriptor | undefined =
      Object.getOwnPropertyDescriptor(navigator, "clipboard");

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });

    const view: ReturnType<typeof render> = renderPanel({ onClose });

    try {
      await act(async (): Promise<void> => {
        fireEvent.click(screen.getByRole("button", { name: "Copy Entry URL" }));
        await Promise.resolve();
      });

      const fallback: HTMLElement = screen.getByRole("button", {
        name: "Clipboard unavailable. Select the displayed value to copy it.",
      });

      expect(fallback).toHaveTextContent("Copy unavailable");
      const entry: HTMLElement = screen.getByTestId("replay-details-entry-url");
      const manualInput: HTMLInputElement = within(entry).getByRole("textbox", {
        name: "Manual copy Entry URL",
      }) as HTMLInputElement;

      expect(manualInput).toHaveValue("https://app.acme.com/checkout");
      expect(manualInput).toHaveFocus();
      expect(manualInput.selectionStart).toBe(0);
      expect(manualInput.selectionEnd).toBe(
        "https://app.acme.com/checkout".length,
      );
      expect(within(entry).getByRole("status")).toHaveTextContent(
        "Clipboard unavailable. The value is selected for manual copy.",
      );
      expect(
        within(entry).getByRole("group", {
          name: "Manual copy help for Entry URL",
        }),
      ).toBeInTheDocument();

      fireEvent.keyDown(manualInput, { key: "Escape" });

      expect(onClose).not.toHaveBeenCalled();
      expect(
        within(entry).queryByRole("textbox", {
          name: "Manual copy Entry URL",
        }),
      ).not.toBeInTheDocument();
      expect(
        within(entry).getByRole("button", { name: "Copy Entry URL" }),
      ).toHaveFocus();

      await act(async (): Promise<void> => {
        fireEvent.click(
          within(entry).getByRole("button", { name: "Copy Entry URL" }),
        );
        await Promise.resolve();
      });
      fireEvent.click(within(entry).getByRole("button", { name: "Dismiss" }));

      expect(
        within(entry).queryByRole("textbox", {
          name: "Manual copy Entry URL",
        }),
      ).not.toBeInTheDocument();
      expect(
        within(entry).getByRole("button", { name: "Copy Entry URL" }),
      ).toHaveFocus();
    } finally {
      view.unmount();

      if (originalClipboard) {
        Object.defineProperty(navigator, "clipboard", originalClipboard);
      } else {
        Reflect.deleteProperty(navigator, "clipboard");
      }
    }
  });

  it("shows untrusted journey values without turning them into links", () => {
    renderPanel({
      details: makeDetails({
        entryUrl: "javascript:alert(document.cookie)",
        exitUrl: "not a URL",
      }),
    });

    const entry: HTMLElement = screen.getByTestId("replay-details-entry-url");
    const exit: HTMLElement = screen.getByTestId("replay-details-exit-url");

    expect(within(entry).queryByRole("link")).not.toBeInTheDocument();
    expect(within(exit).queryByRole("link")).not.toBeInTheDocument();
    expect(entry).toHaveTextContent("javascript:alert(document.cookie)");
    expect(exit).toHaveTextContent("not a URL");
  });

  it("formats environment facts into compact tiles with honest empty states", () => {
    renderPanel();

    expect(screen.getByTestId("replay-details-browser")).toHaveTextContent(
      "Chrome 126",
    );
    expect(screen.getByTestId("replay-details-os")).toHaveTextContent("macOS");
    expect(screen.getByTestId("replay-details-device")).toHaveTextContent(
      "Desktop",
    );
    expect(screen.getByTestId("replay-details-country")).toHaveTextContent(
      "DE",
    );
    expect(screen.getByTestId("replay-details-viewport")).toHaveTextContent(
      "1440 × 900",
    );
    expect(screen.getByTestId("replay-details-payload")).toHaveTextContent(
      "2.0 KiB",
    );
  });

  it("uses placeholders instead of inventing incomplete environment facts", () => {
    renderPanel({
      details: makeDetails({
        browserName: "",
        browserVersion: "",
        osName: "",
        deviceType: "",
        countryCode: "",
        viewportWidth: 1440,
        viewportHeight: 0,
        payloadBytes: 0,
      }),
    });

    for (const testId of [
      "replay-details-browser",
      "replay-details-os",
      "replay-details-device",
      "replay-details-country",
      "replay-details-viewport",
      "replay-details-payload",
    ]) {
      expect(screen.getByTestId(testId)).toHaveTextContent("—");
    }
  });

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
        exceptionFingerprints: [],
      }),
      railCounts: { errors: 2, logs: 37 },
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
    expect(
      screen.getByRole("button", { name: "Open trace in rail" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open errors in rail" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open logs in rail" }),
    ).toBeInTheDocument();
  });

  it("renders no rail buttons without a host to open the rail, and never claims 0 logs before a fetch", () => {
    renderPanel();

    expect(
      screen.queryByTestId("details-open-rail-traces"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("details-rail-logs")).toHaveTextContent(
      "Not fetched yet",
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
   * The copy under the lists said "capped at 50" long after the header
   * kept 100 trace ids while live and 200 once finalized. The numbers are
   * now named constants, pinned below against the server sources.
   */
  it("quotes the header caps that apply to a finalized session", () => {
    renderPanel({
      details: makeDetails({
        isFinalized: true,
        traceIds: ["4bf92f3577b34da6a3ce929d0e0e4736"],
        exceptionFingerprints: ["fp-1"],
      }),
    });

    const caps: HTMLElement = screen.getByTestId("details-correlation-caps");

    expect(caps).toHaveTextContent(
      "The session header keeps at most 200 trace IDs and 100 exception groups; the rail queries your telemetry directly, so it is not limited to these.",
    );
    expect(caps).not.toHaveTextContent("50");
  });

  it("quotes the live cap, and the final one, while the session is not finalized", () => {
    renderPanel({
      details: makeDetails({
        isFinalized: false,
        traceIds: ["4bf92f3577b34da6a3ce929d0e0e4736"],
      }),
    });

    const caps: HTMLElement = screen.getByTestId("details-correlation-caps");

    expect(caps).toHaveTextContent(
      "While the session is live its header keeps at most 100 trace IDs (200 once it is finalized, with up to 100 exception groups)",
    );
    expect(caps).not.toHaveTextContent("capped at 50");
  });

  it("says nothing about caps when the header carries no ids", () => {
    renderPanel({
      details: makeDetails({ traceIds: [], exceptionFingerprints: [] }),
    });

    expect(
      screen.queryByTestId("details-correlation-caps"),
    ).not.toBeInTheDocument();
  });

  it("restates the caps the ingest and the finalizer actually enforce", () => {
    const appRoot: string = path.resolve(__dirname, "../../../../App");
    const ingest: string = fs.readFileSync(
      path.join(
        appRoot,
        "FeatureSet/Telemetry/Services/SessionReplayIngestService.ts",
      ),
      "utf8",
    );
    const finalizer: string = fs.readFileSync(
      path.join(appRoot, "FeatureSet/Workers/Jobs/Rum/FinalizeSessions.ts"),
      "utf8",
    );

    const readConstant: (source: string, name: string) => number = (
      source: string,
      name: string,
    ): number => {
      const match: RegExpMatchArray | null = source.match(
        new RegExp(`${name}: number = (\\d+);`),
      );

      expect([name, match !== null]).toEqual([name, true]);

      return Number((match as RegExpMatchArray)[1]);
    };

    expect(readConstant(ingest, "PROVISIONAL_HEADER_MAX_TRACE_IDS")).toBe(
      REPLAY_HEADER_LIVE_TRACE_ID_CAP,
    );
    expect(readConstant(finalizer, "MAX_TRACE_IDS_PER_SESSION")).toBe(
      REPLAY_HEADER_FINAL_TRACE_ID_CAP,
    );
    expect(
      readConstant(finalizer, "MAX_EXCEPTION_FINGERPRINTS_PER_SESSION"),
    ).toBe(REPLAY_HEADER_EXCEPTION_GROUP_CAP);

    /* The provisional header never carries exception groups at all. */
    expect(ingest).toContain("exceptionFingerprints: [],");
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
  it("shows the mobile recording source and synthetic event format", () => {
    renderPanel({
      activeTabId: "provenance",
      details: makeDetails({
        recorderKind: "rn-view-tree",
        recorderVersion: "0.1.0",
        rrwebVersion: "synthetic-1",
      }),
    });

    expect(
      screen.getByTestId("replay-details-recorder-kind"),
    ).toHaveTextContent("Recording sourceReact Native app");
    expect(
      screen.getByText("Synthetic rrweb event format"),
    ).toBeInTheDocument();
    expect(screen.getByText("synthetic-1")).toBeInTheDocument();
    expect(screen.queryByText("rrweb version")).not.toBeInTheDocument();
  });

  it.each(["dom", ""])(
    "keeps web and legacy manifests on the web presentation (%s)",
    (recorderKind: string) => {
      renderPanel({
        activeTabId: "provenance",
        details: makeDetails({ recorderKind: recorderKind }),
      });

      expect(
        screen.getByTestId("replay-details-recorder-kind"),
      ).toHaveTextContent("Web browser");
      expect(screen.getByText("rrweb version")).toBeInTheDocument();
    },
  );

  it("separates capture policy, recorder and timing into scannable sections", () => {
    renderPanel({ activeTabId: "provenance" });

    for (const name of ["Capture policy", "Recorder", "Timing"]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }

    expect(screen.getByTestId("details-section-capture-policy").tagName).toBe(
      "SECTION",
    );
    expect(screen.getByTestId("details-section-recorder").tagName).toBe(
      "SECTION",
    );
    expect(screen.getByTestId("details-section-timing").tagName).toBe(
      "SECTION",
    );
  });

  it("summarizes the fully masked policy as a positive privacy state", () => {
    renderPanel({
      activeTabId: "provenance",
      details: makeDetails({
        maskingMode: SessionReplayMaskingMode.MaskAllText,
      }),
    });

    const summary: HTMLElement = screen.getByTestId(
      "replay-details-privacy-summary",
    );

    expect(summary).toHaveTextContent("Page content was masked");
    expect(summary).toHaveTextContent(
      "replaced before this session left the device",
    );
    expect(
      screen.queryByTestId("replay-details-readable-warning"),
    ).not.toBeInTheDocument();
  });

  it("renders recorder capabilities as individually readable values", () => {
    renderPanel({
      activeTabId: "provenance",
      details: makeDetails({
        recorderCapabilities: ["canvas", "shadow-dom"],
      }),
    });

    const capabilities: HTMLElement = screen.getByTestId(
      "replay-details-capabilities",
    );

    expect(within(capabilities).getByText("canvas")).toBeInTheDocument();
    expect(within(capabilities).getByText("shadow-dom")).toBeInTheDocument();
  });

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
  it("groups status, gaps and limitations and gives healthy empty states", () => {
    renderPanel({ activeTabId: "fidelity" });

    for (const name of [
      "Recording status",
      "Recording gaps",
      "Capture limitations",
    ]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }

    expect(screen.getByTestId("replay-details-gaps-empty")).toHaveTextContent(
      "No chunks are missing",
    );
    expect(
      screen.getByTestId("replay-details-limitations-empty"),
    ).toHaveTextContent("no capture limitations");
  });

  it("shows missing assets in their own counted section", () => {
    renderPanel({
      activeTabId: "fidelity",
      missingAssets: [
        "https://cdn.acme.com/fonts/inter.woff2",
        "https://cdn.acme.com/app.css",
      ],
    });

    const section: HTMLElement = screen.getByTestId(
      "details-section-missing-assets",
    );

    expect(
      within(section).getByRole("heading", { name: "Missing assets" }),
    ).toBeInTheDocument();
    expect(within(section).getByText("2")).toBeInTheDocument();
    expect(section).toHaveTextContent("inter.woff2");
    expect(section).toHaveTextContent("app.css");
  });

  it("explains why the recording ended from the sealed reason", () => {
    renderPanel({
      activeTabId: "fidelity",
      details: makeDetails({
        sealedReason: SessionReplaySealedReason.Budget,
        isFinalized: true,
      }),
    });

    const reason: HTMLElement = screen.getByTestId(
      "replay-details-sealed-reason",
    );

    expect(reason).toHaveTextContent("upload budget exhausted");
    expect(reason).toHaveAttribute("data-tone", "warn");
    expect(reason).toHaveAttribute("data-state-icon", "alert");
    expect(
      screen.getByTestId("details-section-recording-status"),
    ).toHaveAttribute("data-section-icon", "Alert");
  });

  it.each([
    SessionReplaySealedReason.IdleTimeout,
    SessionReplaySealedReason.DurationCap,
    SessionReplaySealedReason.Truncated,
  ])("keeps the %s stop reason informational", (sealedReason: string) => {
    renderPanel({
      activeTabId: "fidelity",
      details: makeDetails({ sealedReason, isFinalized: true }),
    });

    const reason: HTMLElement = screen.getByTestId(
      "replay-details-sealed-reason",
    );

    expect(reason).toHaveAttribute("data-tone", "info");
    expect(reason).toHaveAttribute("data-state-icon", "info");
    expect(reason).not.toHaveClass("border-emerald-200");
    expect(
      screen.getByTestId("details-section-recording-status"),
    ).toHaveAttribute("data-section-icon", "Info");
  });

  it("reserves the success treatment for a normal final chunk", () => {
    renderPanel({
      activeTabId: "fidelity",
      details: makeDetails({
        sealedReason: SessionReplaySealedReason.FinalChunk,
        isFinalized: true,
      }),
    });

    const reason: HTMLElement = screen.getByTestId(
      "replay-details-sealed-reason",
    );

    expect(reason).toHaveAttribute("data-tone", "success");
    expect(reason).toHaveAttribute("data-state-icon", "check-circle");
    expect(reason).toHaveClass("border-emerald-200");
    expect(
      screen.getByTestId("details-section-recording-status"),
    ).toHaveAttribute("data-section-icon", "CheckCircle");
  });

  it("says a still-open session has not been sealed yet", () => {
    renderPanel({
      activeTabId: "fidelity",
      details: makeDetails({ sealedReason: "", isFinalized: false }),
    });

    expect(
      screen.getByTestId("replay-details-sealed-reason"),
    ).toHaveTextContent("Still recording");
    expect(
      screen.getByTestId("details-section-recording-status"),
    ).toHaveAttribute("data-section-icon", "Clock");
  });

  /*
   * github.com/OneUptime/oneuptime/issues/3642. The provisional header's
   * sealedReason is written by the FIRST final chunk to land - in a
   * multi-page app that is the page the user left, while the next page is
   * still recording. "How the recording ended" may only quote it once the
   * recording has ended: finalized, or every tab closed.
   */
  describe("before the finalizer has run", () => {
    it("a live session is 'Still recording' even when its provisional header already says final-chunk", () => {
      renderPanel({
        activeTabId: "fidelity",
        details: makeDetails({
          sealedReason: SessionReplaySealedReason.FinalChunk,
          isFinalized: false,
        }),
        hasRecordingEnded: false,
      });

      const reason: HTMLElement = screen.getByTestId(
        "replay-details-sealed-reason",
      );

      expect(reason).toHaveTextContent("Still recording");
      expect(reason).not.toHaveTextContent("Recording ended normally");
      expect(
        screen.queryByTestId("replay-details-finalizing"),
      ).not.toBeInTheDocument();
    });

    it("an older host that does not pass the flag keeps the not-finalized copy", () => {
      renderPanel({
        activeTabId: "fidelity",
        details: makeDetails({
          sealedReason: SessionReplaySealedReason.FinalChunk,
          isFinalized: false,
        }),
      });

      expect(
        screen.getByTestId("replay-details-sealed-reason"),
      ).toHaveTextContent("Still recording");
    });

    it("an ended session quotes the final chunk's reason and says the counts are still coming", () => {
      renderPanel({
        activeTabId: "fidelity",
        details: makeDetails({
          sealedReason: SessionReplaySealedReason.FinalChunk,
          isFinalized: false,
        }),
        hasRecordingEnded: true,
      });

      const reason: HTMLElement = screen.getByTestId(
        "replay-details-sealed-reason",
      );

      expect(reason).toHaveTextContent("Recording ended normally");
      expect(reason).not.toHaveTextContent("Still recording");
      expect(screen.getByTestId("replay-details-finalizing")).toHaveTextContent(
        "Still being finalized",
      );
      /*
       * No fixed time: a session the finalizer lost track of waits for a
       * far slower sweep, and "within a minute or two" would then be
       * wrong for hours.
       */
      expect(
        screen.getByTestId("replay-details-finalizing"),
      ).not.toHaveTextContent(/minute/);
    });

    it("an ended session without a reason says every tab closed, not 'still recording'", () => {
      renderPanel({
        activeTabId: "fidelity",
        details: makeDetails({ sealedReason: "", isFinalized: false }),
        hasRecordingEnded: true,
      });

      const reason: HTMLElement = screen.getByTestId(
        "replay-details-sealed-reason",
      );

      expect(reason).toHaveTextContent("Every tab of this session has closed");
      expect(reason).not.toHaveTextContent("Still recording");
      expect(
        screen.getByTestId("replay-details-finalizing"),
      ).toBeInTheDocument();
    });

    it("a finalized session quotes the finalizer's reason and no finalizing note, whatever the flag", () => {
      renderPanel({
        activeTabId: "fidelity",
        details: makeDetails({
          sealedReason: SessionReplaySealedReason.IdleTimeout,
          isFinalized: true,
        }),
        hasRecordingEnded: true,
      });

      expect(
        screen.getByTestId("replay-details-sealed-reason"),
      ).toHaveTextContent("Recording ended after inactivity");
      expect(
        screen.queryByTestId("replay-details-finalizing"),
      ).not.toBeInTheDocument();
    });
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
