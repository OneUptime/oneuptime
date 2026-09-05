import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
/*
 * The Dashboard has its own copy of react; Common's jest moduleNameMapper
 * pins react and react-dom to this project's single copy for every
 * importer (see the note at the top of ReplayStage.test.tsx).
 */
import * as React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";
import ReplayHeader, {
  REPLAY_HEADER_COPIED_MS,
  ReplayHeaderHandle,
  ReplayHeaderProps,
  ReplayHeaderTab,
  copyTextToClipboard,
  formatReplayTabLabel,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayHeader";

/*
 * The player's header. Pinned: identity copy that never claims "anonymous"
 * when the viewer merely may not know (player-shell-5, correlation-9),
 * the wall clock next to the offset (REPLAY -> OUT 7), tab pills with real
 * labels and tab semantics (player-shell-8, -19), the Live pill, the
 * "Continue in Tab 2" chip, copy-link that is announced instead of
 * relabelled and shows the URL when the clipboard is unavailable
 * (player-shell-12), and the back link that keeps the browser's own
 * behaviour for modified clicks.
 */

const SESSION_ID: string = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
/* 2026-09-04 10:12:41.200 local: the tests only compare shape and offset. */
const START_UNIX_MS: number = new Date(2026, 8, 4, 10, 12, 41, 200).getTime();
const MOMENT_URL: string = `https://dash.example/dashboard/p/rum/a/session-replay/${SESSION_ID}?t=41`;

function makeTab(overrides: Partial<ReplayHeaderTab>): ReplayHeaderTab {
  return {
    tabId: "tab-1",
    label: "Tab 1",
    durationMs: 252000,
    openedAtMs: 0,
    hasFootage: true,
    isActive: true,
    ...overrides,
  };
}

function makeProps(overrides?: Partial<ReplayHeaderProps>): ReplayHeaderProps {
  return {
    sessionId: SESSION_ID,
    backHref: "/dashboard/p/rum/a/session-replay?signal=errors",
    onBack: jest.fn(),
    identity: { label: "jane@acme.com", traits: { plan: "pro" } },
    facts: [
      { label: "Browser", value: "Chrome 126" },
      { label: "OS", value: "macOS" },
      { label: "Viewport", value: "1440x900" },
    ],
    startTimeUnixMs: START_UNIX_MS,
    currentTimeMs: 41200,
    durationMs: 252000,
    isLive: false,
    tabs: [makeTab({})],
    onSwitchTab: jest.fn(),
    isWide: true,
    onToggleWide: jest.fn(),
    isTheater: false,
    onToggleTheater: jest.fn(),
    onOpenDetails: jest.fn(),
    buildMomentUrl: (): string => {
      return MOMENT_URL;
    },
    ...overrides,
  };
}

function setClipboard(
  writeText: ((text: string) => Promise<void>) | null,
): void {
  Object.defineProperty(navigator, "clipboard", {
    value: writeText ? { writeText: writeText } : undefined,
    configurable: true,
  });
}

describe("ReplayHeader", () => {
  afterEach(() => {
    setClipboard(null);
    jest.useRealTimers();
  });

  describe("identity", () => {
    it("shows the identified user and a traits chip that opens the details", () => {
      const props: ReplayHeaderProps = makeProps();

      render(<ReplayHeader {...props} />);

      expect(screen.getByTestId("replay-header-user")).toHaveTextContent(
        "jane@acme.com",
      );

      fireEvent.click(screen.getByTestId("replay-header-traits"));

      expect(screen.getByTestId("replay-header-traits")).toHaveTextContent(
        "1 trait",
      );
      expect(props.onOpenDetails).toHaveBeenCalledTimes(1);
    });

    it("says the identity is hidden when the manifest did not serve it, never 'anonymous'", () => {
      render(<ReplayHeader {...makeProps({ identity: { label: null } })} />);

      const user: HTMLElement = screen.getByTestId("replay-header-user");

      expect(user).toHaveTextContent("Identity hidden");
      expect(user).toHaveAttribute(
        "title",
        expect.stringContaining("permission"),
      );
      expect(user).not.toHaveTextContent(/anonymous/i);
      expect(
        screen.queryByTestId("replay-header-traits"),
      ).not.toBeInTheDocument();
    });

    it("says anonymous only for an empty label served with the permission", () => {
      render(<ReplayHeader {...makeProps({ identity: { label: "" } })} />);

      expect(screen.getByTestId("replay-header-user")).toHaveTextContent(
        "Anonymous",
      );
    });
  });

  describe("clock", () => {
    it("shows the playhead as wall-clock time next to the offset and the length", () => {
      render(<ReplayHeader {...makeProps()} />);

      /* 10:12:41 + 41.2s = 10:13:22 local. */
      expect(screen.getByTestId("replay-header-wall-clock")).toHaveTextContent(
        "10:13:22",
      );
      expect(screen.getByTestId("replay-header-clock")).toHaveTextContent(
        "(0:41 / 4:12)",
      );
    });

    it("omits the wall clock when the session start is unknown, without printing Invalid Date", () => {
      render(<ReplayHeader {...makeProps({ startTimeUnixMs: null })} />);

      expect(
        screen.queryByTestId("replay-header-wall-clock"),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("replay-header-clock")).not.toHaveTextContent(
        /Invalid/,
      );
      expect(screen.getByTestId("replay-header-clock")).toHaveTextContent(
        "(0:41 / 4:12)",
      );
    });

    it("renders every non-blank fact with its label as the title", () => {
      render(<ReplayHeader {...makeProps()} />);

      const facts: Array<HTMLElement> =
        screen.getAllByTestId("replay-header-fact");

      expect(
        facts.map((fact: HTMLElement): string | null => {
          return fact.textContent;
        }),
      ).toEqual(["Chrome 126", "macOS", "1440x900"]);
      expect(facts[2]).toHaveAttribute("title", "Viewport: 1440x900");
    });

    /*
     * ux-16: below md each fact carried `hidden ... md:inline`, so on a
     * tablet in portrait the facts vanished outright and the viewer could
     * not tell which browser, OS or viewport they were watching without
     * opening Details. They collapse to one truncated line instead.
     */
    it("collapses the facts to one truncated line below md instead of hiding them", () => {
      render(<ReplayHeader {...makeProps()} />);

      const compact: HTMLElement = screen.getByTestId(
        "replay-header-facts-compact",
      );

      expect(compact).toHaveTextContent("Chrome 126 · macOS · 1440x900");
      expect(compact.className).toContain("truncate");
      /* Shown only where the per-fact spans are hidden, and vice versa. */
      expect(compact.className).toContain("md:hidden");
      expect(
        screen.getAllByTestId("replay-header-fact")[0]?.className,
      ).toContain("md:inline");
      expect(compact).toHaveAttribute(
        "title",
        "Browser: Chrome 126 · OS: macOS · Viewport: 1440x900",
      );
    });

    it("renders no compact line when the manifest served no facts", () => {
      render(<ReplayHeader {...makeProps({ facts: [] })} />);

      expect(
        screen.queryByTestId("replay-header-facts-compact"),
      ).not.toBeInTheDocument();
    });
  });

  describe("tabs", () => {
    const tabs: Array<ReplayHeaderTab> = [
      makeTab({
        tabId: "tab-1",
        label: "Tab 1",
        durationMs: 252000,
        isActive: true,
      }),
      makeTab({
        tabId: "tab-2",
        label: "Tab 2",
        durationMs: 30000,
        openedAtMs: 134000,
        isActive: false,
      }),
      makeTab({
        tabId: "tab-3",
        label: "Tab 3",
        durationMs: 0,
        openedAtMs: null,
        hasFootage: false,
        isActive: false,
      }),
    ];

    it("labels tabs with ordinal, duration and when they opened, with tab semantics", () => {
      render(<ReplayHeader {...makeProps({ tabs: tabs })} />);

      const tablist: HTMLElement = screen.getByRole("tablist");
      const pills: Array<HTMLElement> =
        within(tablist).getAllByTestId("replay-tab-pill");

      expect(pills).toHaveLength(3);
      expect(pills[0]).toHaveTextContent("Tab 1 · 4m 12s");
      expect(pills[0]).toHaveAttribute("aria-selected", "true");
      expect(pills[1]).toHaveTextContent("Tab 2 · 30s · (opened 2:14)");
      expect(pills[1]).toHaveAttribute("aria-selected", "false");
      expect(pills[2]).toHaveTextContent("Tab 3 · no footage");
      expect(pills[2]).toBeDisabled();
      expect(pills[2]).toHaveAttribute(
        "title",
        "No footage stored for this tab",
      );
    });

    it("switches only to another tab that has footage", () => {
      const props: ReplayHeaderProps = makeProps({ tabs: tabs });

      render(<ReplayHeader {...props} />);

      const pills: Array<HTMLElement> =
        screen.getAllByTestId("replay-tab-pill");

      fireEvent.click(pills[0] as HTMLElement);
      expect(props.onSwitchTab).not.toHaveBeenCalled();

      fireEvent.click(pills[2] as HTMLElement);
      expect(props.onSwitchTab).not.toHaveBeenCalled();

      fireEvent.click(pills[1] as HTMLElement);
      expect(props.onSwitchTab).toHaveBeenCalledWith("tab-2");
    });

    it("renders no tablist for a single-tab recording", () => {
      render(<ReplayHeader {...makeProps()} />);

      expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    });

    it("offers 'Continue in Tab 2' when the shell says the session goes on elsewhere", () => {
      const props: ReplayHeaderProps = makeProps({
        tabs: tabs,
        continueInTab: tabs[1] as ReplayHeaderTab,
      });

      render(<ReplayHeader {...props} />);

      const chip: HTMLElement = screen.getByTestId("replay-continue-in-tab");

      expect(chip).toHaveTextContent("Continue in Tab 2");
      fireEvent.click(chip);
      expect(props.onSwitchTab).toHaveBeenCalledWith("tab-2");
    });

    it("formatReplayTabLabel covers the three shapes", () => {
      expect(formatReplayTabLabel(makeTab({ openedAtMs: 0 }))).toBe(
        "Tab 1 · 4m 12s",
      );
      expect(
        formatReplayTabLabel(
          makeTab({ label: "Tab 2", durationMs: 30000, openedAtMs: 134000 }),
        ),
      ).toBe("Tab 2 · 30s · (opened 2:14)");
      expect(formatReplayTabLabel(makeTab({ hasFootage: false }))).toBe(
        "Tab 1 · no footage",
      );
    });
  });

  describe("state pills", () => {
    it("shows the Live pill only while the session is still being recorded", () => {
      const { rerender } = render(
        <ReplayHeader {...makeProps({ isLive: true })} />,
      );

      expect(screen.getByTestId("replay-live-pill")).toHaveTextContent("Live");

      rerender(<ReplayHeader {...makeProps({ isLive: false })} />);

      expect(screen.queryByTestId("replay-live-pill")).not.toBeInTheDocument();
    });

    it("surfaces a warning-grade sealed reason and hides an informational one", () => {
      const { rerender } = render(
        <ReplayHeader
          {...makeProps({
            sealedReason: {
              title: "Recording stopped: upload budget exhausted",
              description: "Raise the budget.",
              severity: "warn",
            },
          })}
        />,
      );

      expect(screen.getByTestId("replay-sealed-pill")).toHaveTextContent(
        "Recording stopped: upload budget exhausted",
      );

      rerender(
        <ReplayHeader
          {...makeProps({
            sealedReason: {
              title: "Recording ended normally",
              description: "Complete.",
              severity: "info",
            },
          })}
        />,
      );

      expect(
        screen.queryByTestId("replay-sealed-pill"),
      ).not.toBeInTheDocument();
    });
  });

  describe("actions", () => {
    it("wide and theater carry aria-pressed and call their toggles", () => {
      const props: ReplayHeaderProps = makeProps({
        isWide: true,
        isTheater: false,
      });

      render(<ReplayHeader {...props} />);

      const wide: HTMLElement = screen.getByTestId("replay-toggle-wide");
      const theater: HTMLElement = screen.getByTestId("replay-toggle-theater");

      expect(wide).toHaveAttribute("aria-pressed", "true");
      expect(theater).toHaveAttribute("aria-pressed", "false");
      expect(theater).toHaveTextContent("Theater");

      fireEvent.click(wide);
      fireEvent.click(theater);
      fireEvent.click(screen.getByTestId("replay-open-details"));

      expect(props.onToggleWide).toHaveBeenCalledTimes(1);
      expect(props.onToggleTheater).toHaveBeenCalledTimes(1);
      expect(props.onOpenDetails).toHaveBeenCalledTimes(1);
    });

    it("labels the theater button as the exit while in theater mode", () => {
      render(<ReplayHeader {...makeProps({ isTheater: true })} />);

      expect(screen.getByTestId("replay-toggle-theater")).toHaveTextContent(
        "Exit theater",
      );
      expect(screen.getByTestId("replay-toggle-theater")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    it("renders the pin control the shell hands in", () => {
      render(
        <ReplayHeader
          {...makeProps({
            pinControl: <button data-testid="fake-pin">Pin</button>,
          })}
        />,
      );

      expect(screen.getByTestId("fake-pin")).toBeInTheDocument();
    });
  });

  describe("back link", () => {
    it("points at the stamped list URL and stays in the SPA on a plain click", () => {
      const props: ReplayHeaderProps = makeProps();

      render(<ReplayHeader {...props} />);

      const link: HTMLElement = screen.getByTestId("replay-back-link");

      expect(link).toHaveAttribute("href", props.backHref);

      fireEvent.click(link, { button: 0 });
      expect(props.onBack).toHaveBeenCalledTimes(1);
    });

    it("leaves a modified click (new tab) to the browser", () => {
      const props: ReplayHeaderProps = makeProps();

      render(<ReplayHeader {...props} />);

      fireEvent.click(screen.getByTestId("replay-back-link"), {
        button: 0,
        metaKey: true,
      });
      fireEvent.click(screen.getByTestId("replay-back-link"), { button: 1 });

      expect(props.onBack).not.toHaveBeenCalled();
    });
  });

  describe("copy link at this moment", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    it("copies the built URL, announces it, keeps the button label, and clears after 2s", async () => {
      const writeText: MockFunction = getJestMockFunction();

      writeText.mockResolvedValue(undefined);

      setClipboard(writeText);

      render(<ReplayHeader {...makeProps()} />);

      const button: HTMLElement = screen.getByTestId("replay-copy-link");

      expect(button).toHaveTextContent("Link");

      await act(async (): Promise<void> => {
        fireEvent.click(button);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(writeText).toHaveBeenCalledWith(MOMENT_URL);
      expect(screen.getByTestId("replay-copy-link-status")).toHaveTextContent(
        "Link copied to the clipboard.",
      );
      expect(screen.getByTestId("replay-copy-link-status")).toHaveAttribute(
        "role",
        "status",
      );
      /* The button never changes width by relabelling itself. */
      expect(button).toHaveTextContent("Link");
      expect(
        screen.queryByTestId("replay-copy-link-fallback"),
      ).not.toBeInTheDocument();

      act((): void => {
        jest.advanceTimersByTime(REPLAY_HEADER_COPIED_MS);
      });

      expect(screen.getByTestId("replay-copy-link-status")).toHaveTextContent(
        "",
      );
    });

    it("shows the URL in a read-only field when there is no clipboard", async () => {
      setClipboard(null);

      render(<ReplayHeader {...makeProps()} />);

      await act(async (): Promise<void> => {
        fireEvent.click(screen.getByTestId("replay-copy-link"));
        await Promise.resolve();
        await Promise.resolve();
      });

      const fallback: HTMLElement = screen.getByTestId(
        "replay-copy-link-fallback",
      );
      const input: HTMLInputElement = within(fallback).getByLabelText(
        "Link to this moment",
      ) as HTMLInputElement;

      expect(input.value).toBe(MOMENT_URL);
      expect(input).toHaveAttribute("readonly");

      fireEvent.click(within(fallback).getByText("Close"));
      expect(
        screen.queryByTestId("replay-copy-link-fallback"),
      ).not.toBeInTheDocument();
    });

    it("falls back to the visible field when the clipboard write rejects", async () => {
      setClipboard(async (): Promise<void> => {
        throw new Error("NotAllowedError");
      });

      render(<ReplayHeader {...makeProps()} />);

      await act(async (): Promise<void> => {
        fireEvent.click(screen.getByTestId("replay-copy-link"));
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(
        screen.getByTestId("replay-copy-link-fallback"),
      ).toBeInTheDocument();
    });

    it("does nothing when no URL can be built", async () => {
      const writeText: MockFunction = getJestMockFunction();

      writeText.mockResolvedValue(undefined);

      setClipboard(writeText);

      render(
        <ReplayHeader
          {...makeProps({
            buildMomentUrl: (): string | null => {
              return null;
            },
          })}
        />,
      );

      await act(async (): Promise<void> => {
        fireEvent.click(screen.getByTestId("replay-copy-link"));
        await Promise.resolve();
      });

      expect(writeText).not.toHaveBeenCalled();
      expect(
        screen.queryByTestId("replay-copy-link-fallback"),
      ).not.toBeInTheDocument();
    });

    it("exposes copyLink on its handle for the keyboard shortcut", async () => {
      const writeText: MockFunction = getJestMockFunction();

      writeText.mockResolvedValue(undefined);

      setClipboard(writeText);

      const ref: React.RefObject<ReplayHeaderHandle> =
        React.createRef<ReplayHeaderHandle>();

      render(<ReplayHeader ref={ref} {...makeProps()} />);

      await act(async (): Promise<void> => {
        ref.current?.copyLink();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(writeText).toHaveBeenCalledWith(MOMENT_URL);
    });

    /*
     * ux-10: the rail's per-row "Copy link to this moment" wrote straight
     * to navigator.clipboard, so it said nothing on success and nothing at
     * all when the clipboard was missing. It borrows this path now.
     */
    it("exposes copyUrl on its handle so the rail's row action is announced too", async () => {
      const writeText: MockFunction = getJestMockFunction();

      writeText.mockResolvedValue(undefined);

      setClipboard(writeText);

      const ref: React.RefObject<ReplayHeaderHandle> =
        React.createRef<ReplayHeaderHandle>();
      const rowUrl: string = `${MOMENT_URL}&signal=rec%3A3%3A12`;

      render(<ReplayHeader ref={ref} {...makeProps()} />);

      await act(async (): Promise<void> => {
        ref.current?.copyUrl(rowUrl);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(writeText).toHaveBeenCalledWith(rowUrl);
      expect(screen.getByTestId("replay-copy-link-status")).toHaveTextContent(
        "Link copied to the clipboard.",
      );
    });

    it("copyUrl shows the read-only field when there is no clipboard", async () => {
      setClipboard(null);

      const ref: React.RefObject<ReplayHeaderHandle> =
        React.createRef<ReplayHeaderHandle>();

      render(<ReplayHeader ref={ref} {...makeProps()} />);

      await act(async (): Promise<void> => {
        ref.current?.copyUrl(MOMENT_URL);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(
        within(screen.getByTestId("replay-copy-link-fallback")).getByLabelText(
          "Link to this moment",
        ),
      ).toHaveValue(MOMENT_URL);
    });
  });

  /*
   * ux-19: "Copy id" discarded the result of copyTextToClipboard, so it
   * looked like it had done nothing on success and actually did nothing on
   * a clipboard-less install - and the user pasted stale text into a ticket.
   */
  describe("copy session id", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    it("announces the copy in the same live region as the Link button", async () => {
      const writeText: MockFunction = getJestMockFunction();

      writeText.mockResolvedValue(undefined);

      setClipboard(writeText);

      render(<ReplayHeader {...makeProps()} />);

      await act(async (): Promise<void> => {
        fireEvent.click(screen.getByTestId("replay-copy-session-id"));
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(writeText).toHaveBeenCalledWith(SESSION_ID);
      expect(screen.getByTestId("replay-copy-link-status")).toHaveTextContent(
        "Session id copied to the clipboard.",
      );
    });

    it("shows the id in a read-only field when the clipboard refuses", async () => {
      setClipboard(async (): Promise<void> => {
        throw new Error("denied");
      });

      render(<ReplayHeader {...makeProps()} />);

      await act(async (): Promise<void> => {
        fireEvent.click(screen.getByTestId("replay-copy-session-id"));
        await Promise.resolve();
        await Promise.resolve();
      });

      const fallback: HTMLElement = screen.getByTestId(
        "replay-copy-link-fallback",
      );

      expect(fallback).toHaveTextContent("copy the session id by hand");
      expect(within(fallback).getByLabelText("Session id")).toHaveValue(
        SESSION_ID,
      );
    });
  });

  describe("copyTextToClipboard", () => {
    it("reports false rather than throwing when the clipboard is missing or rejects", async () => {
      setClipboard(null);
      expect(await copyTextToClipboard("x")).toBe(false);

      setClipboard(async (): Promise<void> => {
        throw new Error("denied");
      });
      expect(await copyTextToClipboard("x")).toBe(false);

      const writeText: MockFunction = getJestMockFunction();

      writeText.mockResolvedValue(undefined);

      setClipboard(writeText);
      expect(await copyTextToClipboard("hello")).toBe(true);
      expect(writeText).toHaveBeenCalledWith("hello");
    });
  });
});
