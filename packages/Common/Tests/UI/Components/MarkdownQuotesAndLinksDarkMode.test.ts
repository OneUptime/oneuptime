import { describe, expect, test } from "@jest/globals";
import {
  DarkModeScan,
  isRemappedForDarkMode,
  scanDarkMode,
} from "../../Helpers/DarkModeScan";
import {
  MARKDOWN_CALLOUT_BODY_CLASS_NAME,
  MARKDOWN_CALLOUT_CLASS_NAME,
  MARKDOWN_CALLOUT_STYLES,
  MARKDOWN_QUOTED_TEXT_CLASS_NAME,
  MARKDOWN_QUOTE_CLASS_NAME,
  MARKDOWN_TEXT_CLASS_NAME,
} from "../../../UI/Components/Markdown.tsx/MarkdownQuote";
import { MARKDOWN_LINK_CLASS_NAME } from "../../../UI/Components/Markdown.tsx/MarkdownLink";
import { MARKDOWN_CALLOUT_KINDS } from "../../../UI/Components/Markdown.tsx/MarkdownCallouts";

/*
 * Quotes, callouts and links in rendered Markdown, in the dark theme.
 *
 * The dark theme re-colours light utility classes in Theme.css, one rule
 * per class, rather than going by Tailwind's dark: variants; a class with no
 * rule keeps its light colour on a slate page. So every colour a quote, a
 * callout or a link is drawn with is held to a rule Theme.css has - which is
 * also why a quote's lighter text is the plain text-gray-600 class on each
 * paragraph (read from MarkdownQuoteContext), never a [&_p]: variant
 * Theme.css could not re-colour.
 */

const FILES: Array<string> = [
  "Components/Markdown.tsx/MarkdownQuote.tsx",
  "Components/Markdown.tsx/MarkdownLink.tsx",
];

// A colour utility of the families the quotes, callouts and links use.
const COLOUR_UTILITY: RegExp =
  /(?:^|:)(?:text|bg|border)-(?:gray|blue|green|violet|amber|red)-\d{2,3}$/;

// The one thing an arbitrary variant may carry here: a margin trimmed to 0.
const MARGIN_TRIM: RegExp = /\]:(?:mt|mb)-0$/;

const tokensOf: (classes: string) => Array<string> = (
  classes: string,
): Array<string> => {
  return classes.split(" ").filter((token: string): boolean => {
    return token.length > 0;
  });
};

describe("quotes, callouts and links in the dark theme", () => {
  const scan: DarkModeScan = scanDarkMode({ files: FILES });

  test("reads the colours they are drawn with", () => {
    expect(scan.colorTokens).toEqual(
      expect.arrayContaining([
        // The quote's bar and its lighter text, and text outside a quote.
        "border-gray-300",
        "text-gray-600",
        "text-gray-700",
        // Every callout's panel and icon.
        "border-blue-200",
        "bg-blue-50",
        "text-blue-500",
        "border-green-200",
        "bg-green-50",
        "text-green-600",
        "border-violet-200",
        "bg-violet-50",
        "text-violet-500",
        "border-amber-200",
        "bg-amber-50",
        "text-amber-500",
        "border-red-200",
        "bg-red-50",
        "text-red-500",
        // The link.
        "text-blue-600",
      ]),
    );
  });

  test("Theme.css re-colours every one of them", () => {
    expect(scan.unmapped).toEqual([]);
  });

  test("use no dark: variants and build no colour from a template", () => {
    expect(scan.filesUsingDarkVariant).toEqual([]);
    expect(scan.filesWithTemplatedColour).toEqual([]);
  });

  test("every callout kind's panel and icon colour is re-coloured", () => {
    for (const kind of MARKDOWN_CALLOUT_KINDS) {
      for (const token of [
        ...tokensOf(MARKDOWN_CALLOUT_STYLES[kind].panel),
        ...tokensOf(MARKDOWN_CALLOUT_STYLES[kind].icon),
      ]) {
        expect(`${kind}: ${token} ${isRemappedForDarkMode(token)}`).toBe(
          `${kind}: ${token} true`,
        );
      }
    }
  });

  test("a quote's colours are plain classes, not arbitrary variants", () => {
    for (const classes of [
      MARKDOWN_QUOTE_CLASS_NAME,
      MARKDOWN_QUOTED_TEXT_CLASS_NAME,
      MARKDOWN_TEXT_CLASS_NAME,
      MARKDOWN_CALLOUT_CLASS_NAME,
      MARKDOWN_CALLOUT_BODY_CLASS_NAME,
      MARKDOWN_LINK_CLASS_NAME,
    ]) {
      for (const token of tokensOf(classes)) {
        if (COLOUR_UTILITY.test(token)) {
          expect(`${token} ${isRemappedForDarkMode(token)}`).toBe(
            `${token} true`,
          );
        }

        // Only layout rides an arbitrary variant ("[&>*:first-child]:mt-0").
        if (token.startsWith("[&")) {
          expect(token).toMatch(MARGIN_TRIM);
        }
      }
    }
  });
});
