/*
 * How a CodeBlock lays out its code.
 *
 *   1. Every token is drawn in the code's own font. Every frontend's
 *      index.ejs draws every element in Inter (`* { font-family: Inter }`),
 *      and a rule that matches an element beats the font it would inherit,
 *      so highlight.js's token spans - a JSON key, an HTML attribute - were
 *      drawn in Inter between the code font's braces and spaces (the status
 *      page MCP configs, the embedded badge's HTML).
 *   2. A snippet of a line or two that people read whole and copy - an
 *      address, an ID, an embed code - can wrap (wrapLongLines) instead of
 *      scrolling sideways under the copy button, which covered its end on a
 *      phone. A program keeps its lines as written.
 */
import CodeBlock, {
  CODE_BLOCK_COPY_BUTTON_GUTTER_CLASS_NAME,
  CODE_BLOCK_TOKEN_FONT_CLASS_NAME,
  CODE_BLOCK_WRAP_CLASS_NAME,
} from "../../../UI/Components/CodeBlock/CodeBlock";
import "@testing-library/jest-dom";
import { cleanup, render, RenderResult } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

const LONG_LINE: string = `<img src="https://oneuptime.example.com/api/status-page/badge/3a000000-0000-4000-8000-0000000000a1?token=f3c1b2a4d5e6f3c1b2a4d5e6" alt="Status Badge" />`;

function codeOf(result: RenderResult): HTMLElement {
  const code: HTMLElement | null = result.container.querySelector("pre code");

  expect(code).not.toBeNull();

  return code as HTMLElement;
}

function classesOf(element: HTMLElement): Array<string> {
  return (element.getAttribute("class") || "").split(" ").filter(Boolean);
}

afterEach(() => {
  cleanup();
});

describe("the code's own font, for every token", () => {
  test("is the class that makes everything inside the code inherit its font", () => {
    expect(CODE_BLOCK_TOKEN_FONT_CLASS_NAME).toBe(
      "[&_*]:[font-family:inherit]",
    );
  });

  test.each([
    ["json", '{\n  "url": "https://example.com/mcp"\n}'],
    ["html", LONG_LINE],
    ["bash", "claude mcp add --transport http oneuptime https://x/mcp"],
    ["text", "3a000000-0000-4000-8000-0000000000a1"],
    // A language that is not registered is drawn as plain text, the same way.
    ["not-a-language", "plain"],
  ])(
    "%s code carries it, highlighted or not",
    (language: string, code: string) => {
      const result: RenderResult = render(
        <CodeBlock language={language} code={code} />,
      );

      expect(classesOf(codeOf(result))).toContain(
        CODE_BLOCK_TOKEN_FONT_CLASS_NAME,
      );
    },
  );

  test("highlighted code has token spans inside it, which the class reaches", () => {
    const result: RenderResult = render(
      <CodeBlock language="json" code={'{ "transport": "streamable-http" }'} />,
    );

    expect(codeOf(result).querySelectorAll("span").length).toBeGreaterThan(0);
  });
});

/*
 * Code reads left to right on every page, and so does its block: on a
 * right-to-left (Persian) page the copy button's right-2 meant the start of
 * the line, where it covered the code's first characters.
 */
describe("on a right-to-left page", () => {
  test("the block reads left to right, with its copy button inside it", () => {
    const result: RenderResult = render(
      <div dir="rtl">
        <CodeBlock language="bash" code="curl -fsSL https://x/install.sh" />
      </div>,
    );
    const block: HTMLElement = result.container.querySelector(
      "div[dir='rtl'] > div",
    ) as HTMLElement;

    expect(block).not.toBeNull();
    expect(block).toHaveAttribute("dir", "ltr");
    expect(
      block.querySelector("button[aria-label='Copy to clipboard']"),
    ).not.toBeNull();
    expect(block.querySelector("pre code")).not.toBeNull();
  });
});

describe("a long line", () => {
  test("scrolls as written by default: a program keeps its lines", () => {
    const result: RenderResult = render(
      <CodeBlock language="html" code={LONG_LINE} />,
    );
    const classes: Array<string> = classesOf(codeOf(result));

    for (const token of CODE_BLOCK_WRAP_CLASS_NAME.split(" ")) {
      expect(classes).not.toContain(token);
    }
    expect(classes).not.toContain(CODE_BLOCK_COPY_BUTTON_GUTTER_CLASS_NAME);
  });

  test("wraps with wrapLongLines, clear of the copy button", () => {
    const result: RenderResult = render(
      <CodeBlock language="html" code={LONG_LINE} wrapLongLines={true} />,
    );
    const classes: Array<string> = classesOf(codeOf(result));

    expect(CODE_BLOCK_WRAP_CLASS_NAME).toBe("whitespace-pre-wrap break-words");
    for (const token of CODE_BLOCK_WRAP_CLASS_NAME.split(" ")) {
      expect(classes).toContain(token);
    }
    /*
     * Important, so the highlight theme's own .hljs padding, which comes
     * after the utilities, does not take the gutter back.
     */
    expect(CODE_BLOCK_COPY_BUTTON_GUTTER_CLASS_NAME).toBe("!pr-14");
    expect(classes).toContain(CODE_BLOCK_COPY_BUTTON_GUTTER_CLASS_NAME);
    expect(
      result.container.querySelector("button[aria-label='Copy to clipboard']"),
    ).not.toBeNull();
  });

  test("needs no gutter where there is no copy button", () => {
    const result: RenderResult = render(
      <CodeBlock
        language="html"
        code={LONG_LINE}
        wrapLongLines={true}
        showCopyButton={false}
      />,
    );
    const classes: Array<string> = classesOf(codeOf(result));

    expect(classes).toContain("whitespace-pre-wrap");
    expect(classes).not.toContain(CODE_BLOCK_COPY_BUTTON_GUTTER_CLASS_NAME);
    expect(result.container.querySelector("button")).toBeNull();
  });
});
