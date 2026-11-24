import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
/*
 * The Dashboard has its own copy of react; Common's jest moduleNameMapper
 * pins react and react-dom to this project's single copy for every
 * importer (see the note at the top of ReplayStage.test.tsx).
 */
import * as React from "react";
import { describe, expect, it } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";
import ReplayUserSessionsMenu, {
  ReplayUserSessionsMenuProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayUserSessionsMenu";
import { ReplayUserSessionItem } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayUserSessions";
import { LAYERED_POPOVER_CLASS_NAME } from "../../../UI/Components/Tooltip/LayeredPopover";
import { wasPressConsumedByAnAnchoredPopup } from "../../../UI/Types/LayeredDismissal";

/*
 * The "N sessions" dropdown in the player header
 * (github.com/OneUptime/oneuptime/issues/3705). Pinned: it opens and
 * closes from its trigger, lists newest first with the current session
 * marked and never re-opened, a click or Enter hands the chosen id to
 * the shell and shuts the menu, Escape shuts it and returns focus to the
 * trigger, the arrow keys move focus between rows, an outside click
 * shuts it, and the live dot and error count appear only when earned.
 */

const NOW: number = Date.parse("2026-09-05T10:00:00.000Z");
const HOUR_MS: number = 60 * 60 * 1000;
const CURRENT_ID: string = "a1b2c3d4e5f60718293a4b5c6d7e8f90";

function makeItem(
  sessionId: string,
  startTimeUnixMs: number,
  overrides?: Partial<ReplayUserSessionItem>,
): ReplayUserSessionItem {
  return {
    sessionId: sessionId,
    startTimeUnixMs: startTimeUnixMs,
    durationMs: 252000,
    entryUrl: "https://app.acme.com/checkout?step=2",
    browserName: "Chrome",
    deviceType: "desktop",
    hasError: false,
    errorCount: 0,
    isFinalized: true,
    identifiedUserKey: "key",
    visitorId: "visitor",
    identifiedUserLabel: "jane@acme.com",
    ...overrides,
  };
}

/* Newest first, the current session in the middle, as the shell merges them. */
const SESSIONS: Array<ReplayUserSessionItem> = [
  makeItem("newest", NOW - 5 * 60 * 1000, {
    isFinalized: false,
    durationMs: 30000,
    entryUrl: "https://app.acme.com/",
  }),
  makeItem(CURRENT_ID, NOW - 3 * HOUR_MS),
  makeItem("oldest", NOW - 2 * 24 * HOUR_MS, {
    errorCount: 3,
    hasError: true,
    entryUrl: "https://app.acme.com/orders/42",
    browserName: "Safari",
    deviceType: "mobile",
  }),
];

function makeProps(
  overrides?: Partial<ReplayUserSessionsMenuProps>,
): ReplayUserSessionsMenuProps {
  return {
    kind: "identified",
    sessions: SESSIONS,
    currentSessionId: CURRENT_ID,
    onOpenUserSession: getJestMockFunction(),
    nowUnixMs: NOW,
    ...overrides,
  };
}

function openMenu(): HTMLElement {
  fireEvent.click(screen.getByTestId("replay-user-sessions-button"));

  return screen.getByTestId("replay-user-sessions-menu");
}

describe("ReplayUserSessionsMenu", () => {
  it("is closed until the trigger is pressed, and the trigger says how many", () => {
    render(<ReplayUserSessionsMenu {...makeProps()} />);

    const button: HTMLElement = screen.getByTestId(
      "replay-user-sessions-button",
    );

    expect(button).toHaveTextContent("3 sessions");
    expect(button).toHaveAttribute("aria-haspopup", "listbox");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByTestId("replay-user-sessions-menu"),
    ).not.toBeInTheDocument();

    fireEvent.click(button);

    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("replay-user-sessions-menu")).toBeInTheDocument();

    fireEvent.click(button);

    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByTestId("replay-user-sessions-menu"),
    ).not.toBeInTheDocument();
  });

  /*
   * The trigger opens a listbox and must say so: a screen reader promised
   * a menu would then meet options where it expected menu items. And when
   * the shell could not page the whole list back to the current session
   * (ReplayUserSessionsState.isTruncated), the trigger must not describe
   * what it opens as "every session".
   */
  it("announces a listbox, and says when the list is only part of the story", () => {
    const { rerender } = render(<ReplayUserSessionsMenu {...makeProps()} />);
    const button: () => HTMLElement = (): HTMLElement => {
      return screen.getByTestId("replay-user-sessions-button");
    };

    expect(button()).toHaveAttribute("aria-haspopup", "listbox");
    expect(button()).not.toHaveAttribute("data-truncated");
    expect(button()).toHaveAttribute(
      "title",
      expect.stringContaining("Every session from this"),
    );

    rerender(<ReplayUserSessionsMenu {...makeProps({ isTruncated: true })} />);

    expect(button()).toHaveAttribute("data-truncated", "true");
    expect(button()).toHaveAttribute(
      "title",
      expect.stringContaining("than the switcher can show"),
    );

    fireEvent.click(button());

    expect(screen.getByTestId("replay-user-sessions-menu")).toHaveTextContent(
      /Some sessions from this (user|visitor)/,
    );
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("lists the sessions newest first in a listbox, with the current one marked", () => {
    render(<ReplayUserSessionsMenu {...makeProps()} />);

    const menu: HTMLElement = openMenu();

    expect(menu).toHaveTextContent("Sessions from this user · past 30 days");

    const listbox: HTMLElement = within(menu).getByRole("listbox");
    const items: Array<HTMLElement> = within(listbox).getAllByRole("option");

    expect(
      items.map((item: HTMLElement): string | null => {
        return item.getAttribute("data-session-id");
      }),
    ).toEqual(["newest", CURRENT_ID, "oldest"]);

    expect(items[1]).toHaveAttribute("aria-selected", "true");
    expect(items[1]).toHaveTextContent("Watching");
    expect(items[1]?.className).toContain("bg-indigo-50");
    expect(items[0]).toHaveAttribute("aria-selected", "false");
    expect(items[0]).not.toHaveTextContent("Watching");
    /* Only the current row is in the Tab sequence (roving tabindex). */
    expect(items[1]).toHaveAttribute("tabindex", "0");
    expect(items[0]).toHaveAttribute("tabindex", "-1");
  });

  it("describes each row: when, where, on what, how long, and its state", () => {
    render(<ReplayUserSessionsMenu {...makeProps()} />);

    const items: Array<HTMLElement> = within(openMenu()).getAllByTestId(
      "replay-user-session-item",
    );

    expect(items[0]).toHaveTextContent("5 minutes ago");
    expect(items[0]).toHaveTextContent("/");
    expect(items[0]).toHaveTextContent("30s");
    expect(
      within(items[0] as HTMLElement).getByLabelText("Recording now"),
    ).toBeInTheDocument();
    expect(
      within(items[0] as HTMLElement).queryByTestId(
        "replay-user-session-errors",
      ),
    ).not.toBeInTheDocument();

    expect(items[1]).toHaveTextContent("3 hours ago");
    expect(items[1]).toHaveTextContent("/checkout?step=2");
    expect(items[1]).toHaveTextContent("Chrome · Desktop");
    expect(items[1]).toHaveTextContent("4m 12s");

    expect(items[2]).toHaveTextContent("2 days ago");
    expect(items[2]).toHaveTextContent("/orders/42");
    expect(items[2]).toHaveTextContent("Safari · Mobile");
    expect(
      within(items[2] as HTMLElement).getByTestId("replay-user-session-errors"),
    ).toHaveTextContent("3");
    expect(
      within(items[2] as HTMLElement).queryByLabelText("Recording now"),
    ).not.toBeInTheDocument();
  });

  /*
   * github.com/OneUptime/oneuptime/issues/3642: an unfinalized sibling
   * whose every tab has closed is not recording. The red pulsing dot and
   * its "Recording now" label are for sessions that may still receive
   * footage; an ended one gets a still gray dot named "Recording ended".
   */
  describe("recording state", () => {
    function renderOne(overrides: Partial<ReplayUserSessionItem>): HTMLElement {
      render(
        <ReplayUserSessionsMenu
          {...makeProps({
            sessions: [
              makeItem("sibling", NOW - 5 * 60 * 1000, overrides),
              makeItem(CURRENT_ID, NOW - 3 * HOUR_MS),
            ],
          })}
        />,
      );

      return within(openMenu()).getAllByTestId(
        "replay-user-session-item",
      )[0] as HTMLElement;
    }

    it("a live sibling pulses red as 'Recording now' and is not marked ended", () => {
      const row: HTMLElement = renderOne({
        isFinalized: false,
        hasRecordingEnded: false,
      });

      const live: HTMLElement = within(row).getByTestId(
        "replay-user-session-live",
      );

      expect(live).toHaveAttribute("aria-label", "Recording now");
      expect(live.className).toContain("animate-pulse");
      expect(live.className).toContain("bg-red-500");
      expect(
        within(row).queryByTestId("replay-user-session-ended"),
      ).not.toBeInTheDocument();
    });

    it("an ended sibling that is still being finalized is quietly 'Recording ended', never 'Recording now'", () => {
      const row: HTMLElement = renderOne({
        isFinalized: false,
        hasRecordingEnded: true,
      });

      expect(
        within(row).queryByTestId("replay-user-session-live"),
      ).not.toBeInTheDocument();
      expect(
        within(row).queryByLabelText("Recording now"),
      ).not.toBeInTheDocument();

      const ended: HTMLElement = within(row).getByTestId(
        "replay-user-session-ended",
      );

      expect(ended).toHaveAttribute("aria-label", "Recording ended");
      expect(ended).toHaveAttribute("role", "img");
      expect(ended.className).not.toContain("animate-pulse");
      expect(ended.className).not.toContain("bg-red-500");
    });

    it("an older server's row without the flag keeps the live dot", () => {
      const row: HTMLElement = renderOne({ isFinalized: false });

      expect(
        within(row).getByTestId("replay-user-session-live"),
      ).toBeInTheDocument();
      expect(
        within(row).queryByTestId("replay-user-session-ended"),
      ).not.toBeInTheDocument();
    });

    it("a finalized sibling carries neither dot, whatever the flag says", () => {
      const row: HTMLElement = renderOne({
        isFinalized: true,
        hasRecordingEnded: true,
      });

      expect(
        within(row).queryByTestId("replay-user-session-live"),
      ).not.toBeInTheDocument();
      expect(
        within(row).queryByTestId("replay-user-session-ended"),
      ).not.toBeInTheDocument();
    });
  });

  it("names the visitor rather than the user when the link is the browser's id", () => {
    render(<ReplayUserSessionsMenu {...makeProps({ kind: "visitor" })} />);

    expect(openMenu()).toHaveTextContent(
      "Sessions from this visitor · past 30 days",
    );
  });

  it("a click hands the chosen session to the shell and closes the menu", () => {
    const onOpenUserSession: MockFunction = getJestMockFunction();

    render(
      <ReplayUserSessionsMenu
        {...makeProps({ onOpenUserSession: onOpenUserSession })}
      />,
    );

    const items: Array<HTMLElement> = within(openMenu()).getAllByTestId(
      "replay-user-session-item",
    );

    fireEvent.click(items[2] as HTMLElement);

    expect(onOpenUserSession).toHaveBeenCalledTimes(1);
    expect(onOpenUserSession).toHaveBeenCalledWith("oldest");
    expect(
      screen.queryByTestId("replay-user-sessions-menu"),
    ).not.toBeInTheDocument();
  });

  it("choosing the session already on screen only closes the menu", () => {
    const onOpenUserSession: MockFunction = getJestMockFunction();

    render(
      <ReplayUserSessionsMenu
        {...makeProps({ onOpenUserSession: onOpenUserSession })}
      />,
    );

    const items: Array<HTMLElement> = within(openMenu()).getAllByTestId(
      "replay-user-session-item",
    );

    fireEvent.click(items[1] as HTMLElement);

    expect(onOpenUserSession).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("replay-user-sessions-menu"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("replay-user-sessions-button")).toHaveFocus();
  });

  it("focuses the current row on open and moves with the arrow keys", () => {
    render(<ReplayUserSessionsMenu {...makeProps()} />);

    const listbox: HTMLElement = within(openMenu()).getByRole("listbox");
    const items: Array<HTMLElement> = within(listbox).getAllByRole("option");

    expect(items[1]).toHaveFocus();

    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    expect(items[2]).toHaveFocus();

    /* The list does not wrap: the oldest row is the end. */
    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    expect(items[2]).toHaveFocus();

    fireEvent.keyDown(listbox, { key: "ArrowUp" });
    expect(items[1]).toHaveFocus();

    fireEvent.keyDown(listbox, { key: "Home" });
    expect(items[0]).toHaveFocus();

    fireEvent.keyDown(listbox, { key: "End" });
    expect(items[2]).toHaveFocus();
  });

  it("Enter and Space open the focused row", () => {
    const onOpenUserSession: MockFunction = getJestMockFunction();

    render(
      <ReplayUserSessionsMenu
        {...makeProps({ onOpenUserSession: onOpenUserSession })}
      />,
    );

    let listbox: HTMLElement = within(openMenu()).getByRole("listbox");

    fireEvent.keyDown(listbox, { key: "ArrowUp" });
    fireEvent.keyDown(listbox, { key: "Enter" });

    expect(onOpenUserSession).toHaveBeenLastCalledWith("newest");
    expect(
      screen.queryByTestId("replay-user-sessions-menu"),
    ).not.toBeInTheDocument();

    listbox = within(openMenu()).getByRole("listbox");

    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    fireEvent.keyDown(listbox, { key: " " });

    expect(onOpenUserSession).toHaveBeenLastCalledWith("oldest");
    expect(onOpenUserSession).toHaveBeenCalledTimes(2);
  });

  it("Escape closes the menu, chooses nothing and returns focus to the trigger", () => {
    const onOpenUserSession: MockFunction = getJestMockFunction();
    const onWindowKey: MockFunction = getJestMockFunction();

    render(
      <ReplayUserSessionsMenu
        {...makeProps({ onOpenUserSession: onOpenUserSession })}
      />,
    );

    window.addEventListener("keydown", onWindowKey);

    try {
      const listbox: HTMLElement = within(openMenu()).getByRole("listbox");

      fireEvent.keyDown(listbox, { key: "Escape" });

      expect(onOpenUserSession).not.toHaveBeenCalled();
      expect(
        screen.queryByTestId("replay-user-sessions-menu"),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("replay-user-sessions-button")).toHaveFocus();
      /* The player's own Escape (close panel, leave theater) must not also fire. */
      expect(onWindowKey).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", onWindowKey);
    }
  });

  it("closes on a click outside without choosing anything", () => {
    const onOpenUserSession: MockFunction = getJestMockFunction();

    render(
      <div>
        <button type="button" data-testid="elsewhere">
          Elsewhere
        </button>
        <ReplayUserSessionsMenu
          {...makeProps({ onOpenUserSession: onOpenUserSession })}
        />
      </div>,
    );

    openMenu();

    const elsewhere: HTMLElement = screen.getByTestId("elsewhere");

    fireEvent.mouseDown(elsewhere, { button: 0 });
    fireEvent.click(elsewhere, { detail: 1 });

    expect(
      screen.queryByTestId("replay-user-sessions-menu"),
    ).not.toBeInTheDocument();
    expect(onOpenUserSession).not.toHaveBeenCalled();
  });

  it("stays open for a click inside the panel that is not on a row", () => {
    render(<ReplayUserSessionsMenu {...makeProps()} />);

    const menu: HTMLElement = openMenu();
    const heading: HTMLElement = within(menu).getByText(
      "Sessions from this user · past 30 days",
    );

    fireEvent.mouseDown(heading, { button: 0 });
    fireEvent.click(heading, { detail: 1 });

    expect(screen.getByTestId("replay-user-sessions-menu")).toBeInTheDocument();
  });

  it("falls back to the first row when the current session is not in the list", () => {
    render(
      <ReplayUserSessionsMenu
        {...makeProps({ currentSessionId: "missing" })}
      />,
    );

    const items: Array<HTMLElement> = within(openMenu()).getAllByRole("option");

    expect(items[0]).toHaveFocus();
    expect(items[0]).toHaveAttribute("tabindex", "0");
    expect(
      items.some((item: HTMLElement): boolean => {
        return item.getAttribute("aria-selected") === "true";
      }),
    ).toBe(false);
  });
});

/*
 * The panel is drawn on the tooltip layer (#9910): the player's header sits
 * in a player that rounds its corners and, in a drawer or a card, in boxes
 * that clip - a panel drawn in place under the trigger would be cut off
 * there. The layer keeps it whole, and keeps what the menu did.
 */
describe("ReplayUserSessionsMenu on the tooltip layer", () => {
  function renderInPlayer(): void {
    render(
      <div>
        <div data-testid="player" style={{ overflow: "hidden" }}>
          <ReplayUserSessionsMenu {...makeProps()} />
          <button type="button">Next session</button>
        </div>
        <button type="button" data-testid="elsewhere">
          Elsewhere
        </button>
      </div>,
    );
  }

  it("is drawn on the page's body, outside the player that clips it, hung from its trigger's start", () => {
    renderInPlayer();

    const menu: HTMLElement = openMenu();
    const layer: HTMLElement | null = menu.closest<HTMLElement>(
      `.${LAYERED_POPOVER_CLASS_NAME}`,
    );

    expect(screen.getByTestId("player")).not.toContainElement(menu);
    expect(layer?.parentElement).toBe(document.body);
    expect(layer).toHaveAttribute("data-popper-placement", "bottom-start");
    expect(
      (layer as HTMLElement & { _tippy?: { reference: Element } })._tippy
        ?.reference,
    ).toBe(screen.getByTestId("replay-user-sessions-button"));
    expect(menu).toHaveClass("w-[26rem]", "max-w-[calc(100vw-1rem)]");
    expect(menu).not.toHaveClass("absolute", "left-0", "mt-1");
  });

  it("Tab from the trigger reaches the current row, and from it goes on past the menu, closing it", () => {
    renderInPlayer();

    const trigger: HTMLElement = screen.getByTestId(
      "replay-user-sessions-button",
    );

    openMenu();
    act(() => {
      trigger.focus();
    });

    expect(fireEvent.keyDown(trigger, { key: "Tab" })).toBe(false);

    const current: HTMLElement = within(
      screen.getByTestId("replay-user-sessions-menu"),
    ).getByRole("option", { selected: true });

    expect(current).toHaveFocus();

    // The rows are one stop (roving focus): Tab goes on from the trigger.
    expect(fireEvent.keyDown(current, { key: "Tab" })).toBe(true);
    expect(trigger).toHaveFocus();
    expect(
      screen.queryByTestId("replay-user-sessions-menu"),
    ).not.toBeInTheDocument();
  });

  it("the focus leaving it for the player closes it", () => {
    renderInPlayer();

    openMenu();
    act(() => {
      screen.getByRole("button", { name: "Next session" }).focus();
    });

    expect(
      screen.queryByTestId("replay-user-sessions-menu"),
    ).not.toBeInTheDocument();
  });

  it("a press outside closes it and is spent there, not also a press on what is behind", () => {
    renderInPlayer();

    openMenu();

    const press: MouseEvent = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });

    act(() => {
      screen.getByTestId("elsewhere").dispatchEvent(press);
    });

    expect(
      screen.queryByTestId("replay-user-sessions-menu"),
    ).not.toBeInTheDocument();
    expect(wasPressConsumedByAnAnchoredPopup(press)).toBe(true);
  });

  it("the arrow keys still move between rows inside it, and Space opens one without reaching the player", () => {
    const onOpenUserSession: MockFunction = getJestMockFunction();
    const onWindowKey: MockFunction = getJestMockFunction();

    render(
      <ReplayUserSessionsMenu
        {...makeProps({ onOpenUserSession: onOpenUserSession })}
      />,
    );

    window.addEventListener("keydown", onWindowKey);

    try {
      const listbox: HTMLElement = within(openMenu()).getByRole("listbox");

      fireEvent.keyDown(listbox, { key: "ArrowDown" });

      const focused: HTMLElement = document.activeElement as HTMLElement;

      expect(focused).toHaveAttribute("data-session-id", "oldest");

      fireEvent.keyDown(focused, { key: " " });

      expect(onOpenUserSession).toHaveBeenCalledWith("oldest");
      // Space is play/pause on the player's window listener: spent here.
      expect(onWindowKey).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", onWindowKey);
    }
  });
});
