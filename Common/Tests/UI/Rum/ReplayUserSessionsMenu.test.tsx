import "@testing-library/jest-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";
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
    expect(button).toHaveAttribute("aria-haspopup", "true");
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
    expect(items[1]).toHaveTextContent("Chrome · desktop");
    expect(items[1]).toHaveTextContent("4m 12s");

    expect(items[2]).toHaveTextContent("2 days ago");
    expect(items[2]).toHaveTextContent("/orders/42");
    expect(items[2]).toHaveTextContent("Safari · mobile");
    expect(
      within(items[2] as HTMLElement).getByTestId("replay-user-session-errors"),
    ).toHaveTextContent("3");
    expect(
      within(items[2] as HTMLElement).queryByLabelText("Recording now"),
    ).not.toBeInTheDocument();
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
      <ReplayUserSessionsMenu {...makeProps({ currentSessionId: "missing" })} />,
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
