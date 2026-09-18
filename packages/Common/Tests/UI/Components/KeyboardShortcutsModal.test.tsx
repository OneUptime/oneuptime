import KeyboardKey from "../../../UI/Components/KeyboardShortcut/KeyboardKey";
import KeyboardShortcutsModal, {
  KeyboardShortcutGroup,
} from "../../../UI/Components/KeyboardShortcut/KeyboardShortcutsModal";
import { describe, expect, it } from "@jest/globals";
import "@testing-library/jest-dom";
import { fireEvent, render, RenderResult } from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * WHY THIS FILE EXISTS
 *
 * This dialog is the only place the product says what its keyboard can do, so
 * the two ways it can quietly go wrong both matter: a sequence rendered as if
 * it were a chord ("G K" instead of "G then K") teaches a shortcut that does
 * not exist, and a group whose rows were all gated off leaves a heading with
 * nothing under it.
 */

function group(
  overrides: Partial<KeyboardShortcutGroup>,
): KeyboardShortcutGroup {
  return {
    id: "general",
    title: "General",
    shortcuts: [
      {
        id: "command-palette",
        keySequence: [[KeyboardKey.Mod, "K"]],
        description: "Open the command palette",
      },
    ],
    ...overrides,
  };
}

function renderModal(
  groups: Array<KeyboardShortcutGroup>,
  onClose: MockFunction = getJestMockFunction(),
): RenderResult {
  return render(
    <KeyboardShortcutsModal
      groups={groups}
      title="Keyboard shortcuts"
      description="Work faster without leaving the keyboard."
      thenLabel="then"
      closeButtonText="Close"
      onClose={onClose}
    />,
  );
}

describe("KeyboardShortcutsModal", () => {
  it("renders inside a dialog, titled and described", () => {
    const { getByTestId } = renderModal([group({})]);

    expect(getByTestId("keyboard-shortcuts-modal")).toBeInTheDocument();
    expect(getByTestId("modal-title")).toHaveTextContent("Keyboard shortcuts");
    expect(getByTestId("modal-description")).toHaveTextContent(
      "Work faster without leaving the keyboard.",
    );
  });

  it("renders each group under its own heading", () => {
    const { getByTestId, getByText } = renderModal([
      group({}),
      group({
        id: "go-to",
        title: "Go to",
        shortcuts: [
          {
            id: "go-to-i",
            keySequence: [["g"], ["i"]],
            description: "Incidents",
          },
        ],
      }),
    ]);

    expect(getByTestId("shortcut-group-general")).toBeInTheDocument();
    expect(getByTestId("shortcut-group-go-to")).toBeInTheDocument();
    expect(getByText("General")).toBeInTheDocument();
    expect(getByText("Go to")).toBeInTheDocument();
  });

  it("lists a shortcut's description beside its keys", () => {
    const { getByTestId } = renderModal([group({})]);

    const row: HTMLElement = getByTestId("shortcut-command-palette");

    expect(row).toHaveTextContent("Open the command palette");
    // jsdom reports a non-Apple platform, so Mod renders as "Ctrl".
    expect(row).toHaveTextContent("Ctrl");
    expect(row).toHaveTextContent("K");
  });

  it("joins the two halves of a sequence with the 'then' label", () => {
    /*
     * The whole point of the sequence rendering: "g" and "i" are pressed one
     * after the other, not together, and a reader must be able to tell.
     */
    const { getByTestId } = renderModal([
      group({
        id: "go-to",
        title: "Go to",
        shortcuts: [
          {
            id: "go-to-i",
            keySequence: [["g"], ["i"]],
            description: "Incidents",
          },
        ],
      }),
    ]);

    const row: HTMLElement = getByTestId("shortcut-go-to-i");

    /*
     * Read the keycaps themselves rather than the row's text: KeyboardShortcut
     * also emits a screen-reader-only spelling of each chord, so the row's raw
     * text carries every key twice.
     */
    const keycaps: Array<string> = Array.from(row.querySelectorAll("kbd")).map(
      (keycap: Element) => {
        return keycap.textContent || "";
      },
    );

    expect(keycaps).toEqual(["G", "I"]);
    expect(row).toHaveTextContent("then");
  });

  it("does not print 'then' for a single-chord shortcut", () => {
    const { getByTestId } = renderModal([group({})]);

    expect(getByTestId("shortcut-command-palette")).not.toHaveTextContent(
      "then",
    );
  });

  it("spells a shortcut out in words for screen readers", () => {
    /*
     * The keycaps are aria-hidden because glyphs like ⌘ are announced
     * inconsistently; the spoken form is the only thing assistive tech reads.
     */
    const { getByTestId } = renderModal([group({})]);

    expect(getByTestId("shortcut-command-palette")).toHaveTextContent(
      "Control + K",
    );
  });

  it("hides a group whose shortcuts were all gated off", () => {
    const { queryByTestId, getByTestId } = renderModal([
      group({}),
      group({ id: "go-to", title: "Go to", shortcuts: [] }),
    ]);

    expect(getByTestId("shortcut-group-general")).toBeInTheDocument();
    expect(queryByTestId("shortcut-group-go-to")).toBeNull();
  });

  it("renders every shortcut in a group, not just the first", () => {
    const { getByTestId } = renderModal([
      group({
        shortcuts: [
          {
            id: "search-list",
            keySequence: [["/"]],
            description: "Search the list on this page",
          },
          {
            id: "shortcuts-help",
            keySequence: [["?"]],
            description: "Show keyboard shortcuts",
          },
          {
            id: "dismiss",
            keySequence: [[KeyboardKey.Escape]],
            description: "Close a dialog or panel",
          },
        ],
      }),
    ]);

    expect(getByTestId("shortcut-search-list")).toHaveTextContent(
      "Search the list on this page",
    );
    expect(getByTestId("shortcut-shortcuts-help")).toHaveTextContent(
      "Show keyboard shortcuts",
    );
    expect(getByTestId("shortcut-dismiss")).toHaveTextContent("Esc");
  });

  it("closes when the header's close button is used", () => {
    const onClose: MockFunction = getJestMockFunction();
    const { getByTestId } = renderModal([group({})], onClose);

    fireEvent.click(getByTestId("close-button"));

    expect(onClose).toHaveBeenCalled();
  });

  it("renders nothing at all when every group is empty", () => {
    const { getByTestId, queryByTestId } = renderModal([
      group({ shortcuts: [] }),
    ]);

    // The dialog still opens — it just has no rows to show.
    expect(getByTestId("keyboard-shortcuts-modal")).toBeInTheDocument();
    expect(queryByTestId("shortcut-group-general")).toBeNull();
  });
});
