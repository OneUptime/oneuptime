import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import React from "react";
import AttributeValuesLoadError, {
  ATTRIBUTE_VALUES_LOAD_ERROR_TEST_ID,
} from "../../../UI/Components/TelemetryViewer/components/AttributeValuesLoadError";
import TelemetrySearchSuggestions from "../../../UI/Components/TelemetryViewer/components/TelemetrySearchSuggestions";
import LogSearchSuggestions from "../../../UI/Components/LogsViewer/components/LogSearchSuggestions";
import {
  TelemetryLoadError,
  TelemetryLoadErrorKind,
} from "../../../UI/Utils/Telemetry/TelemetryLoadError";
import { escapeRegExp } from "../../../Utils/RegExpEscape";

/*
 * The `@key:` dropdown's "could not load the values" row (issue #4708) in
 * the dark theme.
 *
 * The dark theme is Theme.css remapping the light utilities a component
 * uses once <html> carries .dark; a utility with no remap keeps its light
 * colour and paints a light patch on the dark dropdown. Every colour the row
 * draws, in each of its states, and in both dropdowns that show it, must be
 * one the stylesheet remaps.
 */

const THEME_CSS: string = fs.readFileSync(
  path.resolve(__dirname, "..", "..", "..", "UI", "Styles", "Theme.css"),
  "utf8",
);

const COLOUR_NAMES: string =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";

const COLOUR_UTILITY: RegExp = new RegExp(
  `^(bg|text|border|ring|divide|placeholder|outline|fill|stroke|from|via|to)-(white|black|(${COLOUR_NAMES})-\\d{2,3})(\\/\\d{1,3})?$`,
);

const WHITESPACE: RegExp = /\s+/;
const CLASS_PREFIX_SELECTOR: RegExp = /\[class\*="([^"]+)"\]/g;

function utilityOf(token: string): string {
  return token.split(":").pop() || "";
}

function colourTokensIn(root: Element): Array<string> {
  const tokens: Set<string> = new Set<string>();

  for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
    for (const token of (element.getAttribute("class") || "").split(
      WHITESPACE,
    )) {
      if (token && COLOUR_UTILITY.test(utilityOf(token))) {
        tokens.add(token);
      }
    }
  }

  return Array.from(tokens).sort();
}

function isRemappedForDarkTheme(token: string): boolean {
  if (THEME_CSS.includes(`[class~="${token}"]`)) {
    return true;
  }

  if (
    !token.includes(":") &&
    !token.includes("/") &&
    new RegExp(`\\.${escapeRegExp(token)}(?![\\w-])`).test(THEME_CSS)
  ) {
    return true;
  }

  const prefixes: Array<string> = Array.from(
    THEME_CSS.matchAll(CLASS_PREFIX_SELECTOR),
  ).map((match: RegExpMatchArray): string => {
    return match[1]!;
  });

  return prefixes.some((prefix: string): boolean => {
    return token.startsWith(prefix);
  });
}

const ERRORS: Array<[string, TelemetryLoadError]> = [
  [
    "took too long",
    { kind: TelemetryLoadErrorKind.TimedOut, message: "took longer" },
  ],
  ["failed", { kind: TelemetryLoadErrorKind.Failed, message: "Network" }],
];

afterEach(() => {
  cleanup();
});

describe("the could-not-load row in the dark theme", () => {
  test.each(ERRORS)(
    "remaps every colour it draws when the values %s",
    (_label: string, error: TelemetryLoadError) => {
      render(
        <AttributeValuesLoadError
          attributeKey="exception.message"
          error={error}
          onRetry={jest.fn()}
        />,
      );

      const tokens: Array<string> = colourTokensIn(
        screen.getByTestId(ATTRIBUTE_VALUES_LOAD_ERROR_TEST_ID),
      );

      // The scan found the row's colours at all.
      expect(tokens).toEqual(
        expect.arrayContaining(["text-gray-700", "text-gray-500"]),
      );
      expect(
        tokens.filter((token: string): boolean => {
          return !isRemappedForDarkTheme(token);
        }),
      ).toEqual([]);
    },
  );

  test.each([
    ["the explorers' dropdown", TelemetrySearchSuggestions],
    ["the logs dropdown", LogSearchSuggestions],
  ])(
    "%s, holding the row or loading, draws only remapped colours",
    (
      _label: string,
      Dropdown: typeof TelemetrySearchSuggestions | typeof LogSearchSuggestions,
    ) => {
      const { container, rerender } = render(
        <Dropdown
          suggestions={[]}
          selectedIndex={-1}
          onSelect={jest.fn()}
          fieldContext="env"
          isAttributeMode={true}
          valuesError={ERRORS[0]![1]}
          onRetryValues={jest.fn()}
        />,
      );

      const withError: Array<string> = colourTokensIn(container);

      rerender(
        <Dropdown
          suggestions={[]}
          selectedIndex={-1}
          onSelect={jest.fn()}
          fieldContext="env"
          isAttributeMode={true}
          isLoading={true}
          loadingMessage="Loading values for env..."
        />,
      );

      const loading: Array<string> = colourTokensIn(container);

      expect(withError).toEqual(
        expect.arrayContaining(["bg-white", "border-gray-200"]),
      );
      expect(
        [...withError, ...loading].filter((token: string): boolean => {
          return !isRemappedForDarkTheme(token);
        }),
      ).toEqual([]);
    },
  );
});
