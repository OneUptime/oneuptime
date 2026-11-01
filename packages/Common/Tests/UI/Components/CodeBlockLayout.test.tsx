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
  CODE_BLOCK_LINE_CLASS_NAME,
  CODE_BLOCK_TOKEN_FONT_CLASS_NAME,
  CODE_BLOCK_WRAP_CLASS_NAME,
  getCodeBlockLineStyle,
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

/*
 * Wrapped, each line is drawn on its own, and the rest of a line that does
 * not fit is indented under it: in the upgrade dialog the end of
 * "curl -fsSL https://oneuptime.com/install/storage-array-agent -o
 * install.sh" wrapped to the left edge and read as a command of its own.
 */
describe("a wrapped line's rest", () => {
  const COMMAND: string = [
    "curl -fsSL https://oneuptime.com/install/storage-array-agent -o install.sh",
    "ONEUPTIME_URL=https://oneuptime.com \\",
    "  bash install.sh",
  ].join("\n");

  function linesOf(result: RenderResult): Array<HTMLElement> {
    return Array.from(codeOf(result).children) as Array<HTMLElement>;
  }

  test("is indented under its line: a hanging indent past the spaces the line starts with", () => {
    const result: RenderResult = render(
      <CodeBlock language="bash" code={COMMAND} wrapLongLines={true} />,
    );
    const lines: Array<HTMLElement> = linesOf(result);

    expect(lines).toHaveLength(3);
    expect(CODE_BLOCK_LINE_CLASS_NAME).toBe("block");
    for (const line of lines) {
      expect(classesOf(line)).toContain(CODE_BLOCK_LINE_CLASS_NAME);
    }
    expect(lines[0]!.style.paddingLeft).toBe("2ch");
    expect(lines[0]!.style.textIndent).toBe("-2ch");
    // A line that starts with two spaces wraps past them.
    expect(lines[2]!.style.paddingLeft).toBe("4ch");
    expect(lines[2]!.style.textIndent).toBe("-4ch");
    expect(getCodeBlockLineStyle(0)).toEqual({
      paddingLeft: "2ch",
      textIndent: "-2ch",
    });
  });

  test("keeps the code exactly as written: what a selection copies", () => {
    const code: string = `${COMMAND}\n\n  # done\n`;
    const result: RenderResult = render(
      <CodeBlock language="bash" code={code} wrapLongLines={true} />,
    );

    expect(codeOf(result).textContent).toBe(code);
    expect(linesOf(result)).toHaveLength(code.split("\n").length);
  });

  test("an address in it may break after a slash of its path, not mid-word", () => {
    const result: RenderResult = render(
      <CodeBlock language="bash" code={COMMAND} wrapLongLines={true} />,
    );
    const first: HTMLElement = linesOf(result)[0]!;

    expect(first.querySelectorAll("wbr")).toHaveLength(2);
    expect(first.textContent).toBe(COMMAND.split("\n")[0] + "\n");
  });

  test("of code no highlighter knows is drawn the same way", () => {
    const result: RenderResult = render(
      <CodeBlock
        language="not-a-language"
        code={"https://oneuptime.com/install/x\n  next"}
        wrapLongLines={true}
      />,
    );
    const lines: Array<HTMLElement> = linesOf(result);

    expect(lines).toHaveLength(2);
    // After "oneuptime.com/" and "install/".
    expect(lines[0]!.querySelectorAll("wbr")).toHaveLength(2);
    expect(lines[1]!.style.paddingLeft).toBe("4ch");
    expect(codeOf(result).textContent).toBe(
      "https://oneuptime.com/install/x\n  next",
    );
  });

  test("a token over a line break keeps its colour on both lines", () => {
    const result: RenderResult = render(
      <CodeBlock
        language="bash"
        code={'echo "first\nsecond"'}
        wrapLongLines={true}
      />,
    );
    const lines: Array<HTMLElement> = linesOf(result);

    expect(lines).toHaveLength(2);
    expect(lines[0]!.querySelector(".hljs-string")?.textContent).toBe('"first');
    expect(lines[1]!.querySelector(".hljs-string")?.textContent).toBe(
      'second"',
    );
  });

  test("code that scrolls as written is drawn whole, without lines of its own", () => {
    const result: RenderResult = render(
      <CodeBlock language="bash" code={COMMAND} />,
    );

    expect(
      codeOf(result).querySelector(`span.${CODE_BLOCK_LINE_CLASS_NAME}`),
    ).toBeNull();
    expect(codeOf(result).querySelector("wbr")).toBeNull();
    expect(codeOf(result).textContent).toBe(COMMAND);
  });
});
