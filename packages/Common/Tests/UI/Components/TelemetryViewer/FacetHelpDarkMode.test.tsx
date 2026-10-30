import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import fs from "fs";
import path from "path";
import React from "react";
import { DarkModeScan, scanDarkMode } from "../../../Helpers/DarkModeScan";
import FacetHelpButton from "../../../../UI/Components/TelemetryViewer/components/FacetHelpButton";

/*
 * A facet's (i) and what it says - the traces explorer's Span Type - in the
 * dark theme.
 *
 * Theme.css re-colours the light utility classes under html.dark, one rule
 * per class and per variant; a class without a rule keeps its light colour
 * and nothing fails (Tests/Helpers/DarkModeScan). So every colour class the
 * header row, the (i), the help it opens and a described option draw with
 * is held to what Theme.css remaps. The help opens in Tippy's light-bordered
 * box, which Theme.css re-colours as a whole; an option's own sentence opens
 * in Tippy's dark box, which reads the same on either theme.
 */

const FILES: Array<string> = [
  "Components/TelemetryViewer/components/FacetHelpButton.tsx",
  "Components/TelemetryViewer/components/FacetSectionHeader.tsx",
  "Components/TelemetryViewer/components/TelemetryFacetSection.tsx",
  "Components/TelemetryViewer/components/TelemetryFacetValueRow.tsx",
];

const THEME_CSS: string = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "..", "UI", "Styles", "Theme.css"),
  "utf8",
);

afterEach(() => {
  cleanup();
});

describe("a facet's (i) in the dark theme", () => {
  const scan: DarkModeScan = scanDarkMode({ files: FILES });

  test("no part uses a dark: variant or builds a colour class from a template", () => {
    expect(scan.filesUsingDarkVariant).toEqual([]);
    expect(scan.filesWithTemplatedColour).toEqual([]);
  });

  test("every colour class they use is remapped for dark mode", () => {
    // The scan found the new parts' colours, so this is not vacuous.
    expect(scan.colorTokens).toEqual(
      expect.arrayContaining([
        // The (i), and the pointer over it.
        "text-gray-400",
        "hover:text-gray-600",
        // The keyboard's ring round the (i), and round the header's row.
        "focus-visible:ring-indigo-500",
        "focus-visible:after:ring-indigo-500",
        // The header's row under the pointer.
        "hover:bg-gray-50",
        // The help: each option's name, and its sentence.
        "text-gray-900",
        "text-gray-600",
        "text-gray-700",
      ]),
    );

    expect(scan.unmapped).toEqual([]);
  });

  test("the help opens in the light-bordered box, which the dark theme re-colours", async () => {
    render(
      <FacetHelpButton
        title="Span Type"
        help={{
          entries: [
            {
              value: "root",
              label: "Root spans",
              description: "Where a trace starts.",
            },
          ],
        }}
      />,
    );

    fireEvent.mouseEnter(
      screen.getByRole("button", { name: "About Span Type" }),
    );
    await act(async () => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 250);
      });
    });

    const box: HTMLElement = screen.getByRole("tooltip");
    expect(
      box.closest("[data-theme]") || box.querySelector("[data-theme]") || box,
    ).toHaveAttribute("data-theme", "light-border");

    // The box, its arrow and its words, re-coloured under html.dark.
    expect(THEME_CSS).toMatch(
      /html\.dark \.tippy-box\[data-theme~="light-border"\] \{[^}]*background-color: var\(--ou-surface-primary\);[^}]*color: var\(--ou-text-secondary\);/,
    );
    expect(THEME_CSS).toContain(
      'html.dark .tippy-box[data-theme~="light-border"] > .tippy-svg-arrow',
    );
  });
});
