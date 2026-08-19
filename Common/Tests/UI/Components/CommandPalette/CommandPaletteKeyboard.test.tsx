import CommandPalette from "../../../../UI/Components/CommandPalette/CommandPalette";
import { PaletteCommand } from "../../../../UI/Components/CommandPalette/Types";
import { resetPageScrollLockForTesting } from "../../../../UI/Utils/PageScrollLock";
/*
 * The main entry, not "/extend-expect": the latter no longer ships type
 * declarations, so every jest-dom matcher in this file fails to typecheck and
 * the whole suite is skipped before a single assertion runs.
 */
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The palette is portalled to document.body and handles its keys on the
 * dialog root. This suite pins the flat-list keyboard contract AND what the
 * rest of the document observes: handled keys still bubble (the palette does
 * not stopPropagation) but arrive flagged defaultPrevented, so page-level
 * shortcut listeners that respect the flag stay quiet — the same
 * document-listener technique OperatorSelectorKeyboard.test.tsx uses.
 */

interface ObservedKey {
  key: string;
  defaultPrevented: boolean;
}

// Keys that made it all the way up to a document-level listener, in order.
const documentKeys: Array<ObservedKey> = [];

const documentKeyDownListener: (event: KeyboardEvent) => void = (
  event: KeyboardEvent,
): void => {
  documentKeys.push({
    key: event.key,
    defaultPrevented: event.defaultPrevented,
  });
};

type MakeCommandFunction = (
  id: string,
  title: string,
  onSelect?: () => void,
) => PaletteCommand;

const makeCommand: MakeCommandFunction = (
  id: string,
  title: string,
  onSelect?: () => void,
): PaletteCommand => {
  return {
    id,
    title,
    category: "Pages",
    onSelect: onSelect || ((): void => {}),
  };
};

interface PaletteHarness {
  input: HTMLElement;
  onClose: jest.Mock;
}

type RenderPaletteFunction = (
  commands: Array<PaletteCommand>,
) => PaletteHarness;

const renderPalette: RenderPaletteFunction = (
  commands: Array<PaletteCommand>,
): PaletteHarness => {
  const onClose: jest.Mock = jest.fn();
  render(
    <CommandPalette commands={commands} isOpen={true} onClose={onClose} />,
  );
  return { input: screen.getByTestId("command-palette-input"), onClose };
};

type ExpectSelectedFunction = (commandId: string) => void;

const expectSelected: ExpectSelectedFunction = (commandId: string): void => {
  expect(
    screen.getByTestId(`command-palette-option-${commandId}`),
  ).toHaveAttribute("aria-selected", "true");
  expect(screen.getByTestId("command-palette-input")).toHaveAttribute(
    "aria-activedescendant",
    `command-palette-option-${commandId}`,
  );
};

const THREE_COMMANDS: Array<PaletteCommand> = [
  makeCommand("one", "First"),
  makeCommand("two", "Second"),
  makeCommand("three", "Third"),
];

describe("CommandPalette keyboard contract", () => {
  beforeEach(() => {
    resetPageScrollLockForTesting();
    documentKeys.length = 0;
    document.addEventListener("keydown", documentKeyDownListener);
  });

  afterEach(() => {
    document.removeEventListener("keydown", documentKeyDownListener);
    cleanup();
    resetPageScrollLockForTesting();
  });

  test("ArrowDown walks the flat list and wraps from the last row to the first", () => {
    const harness: PaletteHarness = renderPalette(THREE_COMMANDS);

    expectSelected("one");

    fireEvent.keyDown(harness.input, { key: "ArrowDown" });
    expectSelected("two");

    fireEvent.keyDown(harness.input, { key: "ArrowDown" });
    expectSelected("three");

    fireEvent.keyDown(harness.input, { key: "ArrowDown" });
    expectSelected("one");
  });

  test("ArrowUp from the first row wraps to the last", () => {
    const harness: PaletteHarness = renderPalette(THREE_COMMANDS);

    fireEvent.keyDown(harness.input, { key: "ArrowUp" });

    expectSelected("three");
  });

  test("Home and End jump to the first and last row", () => {
    const harness: PaletteHarness = renderPalette(THREE_COMMANDS);

    fireEvent.keyDown(harness.input, { key: "End" });
    expectSelected("three");

    fireEvent.keyDown(harness.input, { key: "Home" });
    expectSelected("one");
  });

  test("Enter runs the active command and closes the palette", () => {
    const onSelect: jest.Mock = jest.fn();
    const harness: PaletteHarness = renderPalette([
      makeCommand("one", "First"),
      makeCommand("two", "Second", onSelect),
      makeCommand("three", "Third"),
    ]);

    fireEvent.keyDown(harness.input, { key: "ArrowDown" });
    fireEvent.keyDown(harness.input, { key: "Enter" });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(harness.onClose).toHaveBeenCalledTimes(1);
  });

  test("Escape closes without running anything", () => {
    const onSelect: jest.Mock = jest.fn();
    const harness: PaletteHarness = renderPalette([
      makeCommand("one", "First", onSelect),
    ]);

    fireEvent.keyDown(harness.input, { key: "Escape" });

    expect(onSelect).not.toHaveBeenCalled();
    expect(harness.onClose).toHaveBeenCalledTimes(1);
  });

  test("handled keys are defaultPrevented; plain typing is not", () => {
    const harness: PaletteHarness = renderPalette(THREE_COMMANDS);

    // fireEvent returns false when a handler called preventDefault().
    expect(fireEvent.keyDown(harness.input, { key: "ArrowDown" })).toBe(false);
    expect(fireEvent.keyDown(harness.input, { key: "ArrowUp" })).toBe(false);
    expect(fireEvent.keyDown(harness.input, { key: "Home" })).toBe(false);
    expect(fireEvent.keyDown(harness.input, { key: "End" })).toBe(false);
    expect(fireEvent.keyDown(harness.input, { key: "Enter" })).toBe(false);
    expect(fireEvent.keyDown(harness.input, { key: "Escape" })).toBe(false);

    // Ordinary characters belong to the input — the palette must not eat them.
    expect(fireEvent.keyDown(harness.input, { key: "a" })).toBe(true);
  });

  test("keys bubble to document-level listeners flagged as consumed", () => {
    const harness: PaletteHarness = renderPalette(THREE_COMMANDS);

    fireEvent.keyDown(harness.input, { key: "ArrowDown" });
    fireEvent.keyDown(harness.input, { key: "Escape" });

    expect(documentKeys).toEqual([
      { key: "ArrowDown", defaultPrevented: true },
      { key: "Escape", defaultPrevented: true },
    ]);
  });

  test("navigation keys do nothing (and stay unprevented) on an empty list", () => {
    const harness: PaletteHarness = renderPalette([]);

    expect(fireEvent.keyDown(harness.input, { key: "ArrowDown" })).toBe(true);
    expect(fireEvent.keyDown(harness.input, { key: "Enter" })).toBe(true);
    expect(harness.onClose).not.toHaveBeenCalled();

    // Escape still closes an empty palette.
    expect(fireEvent.keyDown(harness.input, { key: "Escape" })).toBe(false);
    expect(harness.onClose).toHaveBeenCalledTimes(1);
  });

  test("selection follows the mouse, and the keyboard continues from there", () => {
    const harness: PaletteHarness = renderPalette(THREE_COMMANDS);

    fireEvent.mouseMove(screen.getByTestId("command-palette-option-two"));
    expectSelected("two");

    fireEvent.keyDown(harness.input, { key: "ArrowDown" });
    expectSelected("three");
  });

  test("the selection resets to the top when the query changes", () => {
    const harness: PaletteHarness = renderPalette(THREE_COMMANDS);

    fireEvent.keyDown(harness.input, { key: "End" });
    expectSelected("three");

    fireEvent.change(harness.input, { target: { value: "t" } });

    // "t" matches "Third" by prefix — it ranks first and is selected.
    expectSelected("three");
    fireEvent.change(harness.input, { target: { value: "" } });
    expectSelected("one");
  });
});
