/*
 * References and webhook URLs in a step's settings dialog wrap only between
 * their parts. The screenshot this came from had
 * {{local.components.webhook-1.returnValues.request-headers}} broken over
 * three lines at its hyphens ("webhook-" / "1.returnValues.request-" /
 * "headers}}"), which reads as three different things.
 */

import BreakableCode, {
  splitAfterSeparator,
} from "../../../../UI/Components/Workflow/BreakableCode";
import { describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { RenderResult, render } from "@testing-library/react";
import React from "react";

const REFERENCE: string =
  "{{local.components.webhook-1.returnValues.request-headers}}";

describe("splitAfterSeparator", () => {
  test("splits a reference after every dot, keeping the dot on the left", () => {
    expect(splitAfterSeparator(REFERENCE, ".")).toEqual([
      "{{local.",
      "components.",
      "webhook-1.",
      "returnValues.",
      "request-headers}}",
    ]);
  });

  test("never separates a name at its hyphen", () => {
    for (const part of splitAfterSeparator(REFERENCE, ".")) {
      expect(part.endsWith("-")).toBe(false);
    }
  });

  test("keeps a run of separators together, so https:// stays whole", () => {
    expect(
      splitAfterSeparator(
        "https://oneuptime.com/workflow/trigger/6f9b2c1e",
        "/",
      ),
    ).toEqual([
      "https://",
      "oneuptime.com/",
      "workflow/",
      "trigger/",
      "6f9b2c1e",
    ]);
  });

  test("a trailing separator stays on the last part rather than making an empty one", () => {
    expect(splitAfterSeparator("a.b.", ".")).toEqual(["a.", "b."]);
  });

  test("text without the separator is one part", () => {
    expect(splitAfterSeparator("request-body", ".")).toEqual(["request-body"]);
  });

  test("empty text has no parts", () => {
    expect(splitAfterSeparator("", ".")).toEqual([]);
  });

  test("joining the parts gives back the text exactly", () => {
    const samples: Array<[string, string]> = [
      [REFERENCE, "."],
      ["https://a.b/c//d/", "/"],
      ["..a..b..", "."],
      ["no-separator-here", "."],
    ];

    for (const [text, separator] of samples) {
      expect(splitAfterSeparator(text, separator).join("")).toBe(text);
    }
  });
});

describe("BreakableCode", () => {
  test("shows the text exactly, so selecting and copying it by hand still works", () => {
    const { getByTestId }: RenderResult = render(
      <BreakableCode text={REFERENCE} breakAfter="." dataTestId="code" />,
    );

    expect(getByTestId("code").textContent).toBe(REFERENCE);
  });

  test("offers a line break only after each separator", () => {
    const { getByTestId }: RenderResult = render(
      <BreakableCode text={REFERENCE} breakAfter="." dataTestId="code" />,
    );

    const code: HTMLElement = getByTestId("code");

    // Five parts, so four places to break - and no break after the last part.
    expect(code.querySelectorAll("wbr")).toHaveLength(4);

    for (const wbr of Array.from(code.querySelectorAll("wbr"))) {
      expect(wbr.previousSibling?.textContent?.endsWith(".")).toBe(true);
    }
  });

  test("each part is kept on one line, and set in the code font", () => {
    const { getByTestId }: RenderResult = render(
      <BreakableCode text={REFERENCE} breakAfter="." dataTestId="code" />,
    );

    const parts: Array<HTMLElement> = Array.from(
      getByTestId("code").querySelectorAll("span"),
    );

    expect(
      parts.map((part: HTMLElement) => {
        return part.textContent;
      }),
    ).toEqual(splitAfterSeparator(REFERENCE, "."));

    for (const part of parts) {
      expect(part).toHaveClass("whitespace-nowrap");
      /*
       * index.ejs sets `* { font-family: Inter }`, which matches the span
       * itself and beats the font it would inherit from <code>.
       */
      expect(part).toHaveClass("font-mono");
    }
  });

  test("renders a <code> element carrying the caller's classes", () => {
    const { getByTestId }: RenderResult = render(
      <BreakableCode
        text={REFERENCE}
        breakAfter="."
        dataTestId="code"
        className="text-xs text-gray-700"
      />,
    );

    const code: HTMLElement = getByTestId("code");

    expect(code.tagName).toBe("CODE");
    expect(code).toHaveClass("font-mono", "text-xs", "text-gray-700");
  });

  test("does not ask the browser to break anywhere it likes", () => {
    const { getByTestId }: RenderResult = render(
      <BreakableCode text={REFERENCE} breakAfter="." dataTestId="code" />,
    );

    const code: HTMLElement = getByTestId("code");

    expect(code.className).not.toMatch(/break-all|overflow-wrap|break-words/);
    expect(code.getAttribute("style") || "").not.toMatch(/overflow-wrap/);
  });
});
