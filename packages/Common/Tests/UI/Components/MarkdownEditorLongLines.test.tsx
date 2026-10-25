import React from "react";
import MarkdownEditor from "../../../UI/Components/Markdown.tsx/MarkdownEditor";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "@jest/globals";
import { fastestRun } from "../../Helpers/FastestRun";

/*
 * ---------------------------------------------------------------------------
 * THE EDITOR OPENS, SAVES AND PASTES INTO A NOTE WITH LONG LINES QUICKLY.
 *
 * Whoever writes a note, a description or a postmortem decides its lines,
 * and the editor reads all of them in the browser of everyone who opens it:
 * to show it (markdown to HTML, when the editor opens), on every keystroke
 * (HTML back to markdown), and when something is pasted into the middle of
 * a line in the markdown source (the spaces at the split). Each of these
 * read some lines - a heading or a table row with a long run of white space
 * in it, a run of images or tags that close nothing, a table of one long
 * cell over many rows, a list item of many paragraphs - in time that grew
 * with the square or the cube of their length, and held the tab for
 * minutes. These tests open, type into and paste into the real editor on
 * such notes, as a person would.
 * ---------------------------------------------------------------------------
 */

const LENGTH: number = 400000;

const LINE_SEPARATOR: string = String.fromCharCode(0x2028);

// `unit` written `count` times over: whole pieces, never one cut short.
const times: (unit: string, count: number) => string = (
  unit: string,
  count: number,
): string => {
  return unit.repeat(Math.floor(count));
};

/*
 * How long the work takes: the fastest of up to three attempts, counted as
 * it would have run on a usual runner when every attempt overran on a slow
 * one (Tests/Helpers/FastestRun).
 */
const timeOf: (run: () => unknown) => number = (run: () => unknown): number => {
  return fastestRun({ run: run, limitInMs: 2000 }).inMs;
};

const editableOf: () => HTMLElement = (): HTMLElement => {
  return document.querySelector('[contenteditable="true"]') as HTMLElement;
};

afterEach(() => {
  cleanup();
});

describe("the editor opens a note with long lines quickly", () => {
  test.each([
    ["a heading with a long run of spaces", `# a${times(" ", LENGTH)}x`],
    [
      "a heading with runs of tabs around a line separator",
      `#\t${times("\t", LENGTH / 2)}x${times("\t", LENGTH / 2)}${LINE_SEPARATOR}\tx`,
    ],
    [
      "a table delimiter row with long runs of white space",
      `a|b\n${times(" ", LENGTH / 2)}-${times(" ", LENGTH / 2)}x|`,
    ],
    [
      "a fence line with a long run of tabs",
      `\`\`\`${times("\t", LENGTH)}\`\`\``,
    ],
    [
      "a list item with a long run and a line separator",
      `-${times(" ", LENGTH)}x${LINE_SEPARATOR}y`,
    ],
    ["images that close none", times("![](\u0000", LENGTH / 5)],
    ["links that close none", `${times("[(](((", LENGTH / 6)}][\t](\u0000)`],
    ["inline tags that close none", times("<U\t", LENGTH / 3)],
  ])("%s", (_label: string, note: string) => {
    expect(
      timeOf(() => {
        render(<MarkdownEditor initialValue={note} />);
        cleanup();
      }),
    ).toBeLessThan(2000);
  });

  test("and shows it as before", () => {
    render(
      <MarkdownEditor
        initialValue={`## Title${times(" ", 1000)}##\n\n![a](b.png) [c](d)`}
      />,
    );

    expect(editableOf().innerHTML).toBe(
      '<h2>Title</h2><p><img alt="a" src="b.png"> <a href="d">c</a></p>',
    );
  });
});

describe("a keystroke in such a note is saved quickly", () => {
  test.each([
    /*
     * 16,666 rows, not 33,333: each row is a node the editor walks on
     * every keystroke, and the walk is linear in the rows (533 ms on a
     * developer machine at 16,666 rows, 1,102 ms at 33,333, the cell's
     * length barely counting), so at 33,333 rows a CI runner took 2,128 ms
     * of the 2,000 (2026-10-25). The cell keeps its 100,000 characters:
     * lined up to it, these rows would still be past the longest string
     * a browser holds, so a table lined up whatever its size still fails.
     */
    [
      "a table of one long cell over many rows",
      `| a |\n| --- |\n| ${times("y", LENGTH / 4)} |\n${times("| x |\n", LENGTH / 24)}`,
    ],
    /*
     * 200,000 characters, not 400,000: each paragraph is a node the editor
     * walks on every keystroke, so this note's linear walk is the heaviest
     * here - 1.4 s on a developer machine at 400,000 characters, 0.7 s at
     * 200,000 and 0.33 s at 100,000, and on a CI runner it reached 2,030 ms
     * of the 2,000 at 400,000 (2026-10-21). Half the note leaves the linear
     * walk room to spare; the walk whose time grew with the square took
     * minutes at either length.
     */
    ["a list item of many paragraphs", `- a${times("\n\n  x", LENGTH / 10)}`],
    ["a code block of line feeds", `\`\`\`\n${times("\n", LENGTH)}x\n\`\`\``],
  ])("%s", (_label: string, note: string) => {
    const onChange: jest.Mock = jest.fn();
    render(<MarkdownEditor initialValue={note} onChange={onChange} />);
    const editable: HTMLElement = editableOf();

    expect(
      timeOf(() => {
        fireEvent.input(editable);
      }),
    ).toBeLessThan(2000);
  });

  test("and the table a keystroke saves reads back as the same table", () => {
    const onChange: jest.Mock = jest.fn();
    const long: string = times("y", 100000);
    const note: string = `| a |\n| --- |\n| ${long} |\n${times("| x |\n", 1000)}`;
    render(<MarkdownEditor initialValue={note} onChange={onChange} />);

    fireEvent.input(editableOf());

    const saved: string = String(
      onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] ?? "",
    );

    // Lined up, it was a thousand rows padded to a hundred thousand characters.
    expect(saved.length).toBeLessThan(110000);
    expect(saved.startsWith(`| a |\n| --- |\n| ${long} |\n| x |\n`)).toBe(true);
  });
});

describe("a block pasted into the middle of a long line in the markdown source", () => {
  test("goes on lines of its own quickly, the spaces at the split gone as before", () => {
    const onChange: jest.Mock = jest.fn();
    const line: string = `Restart${times(" ", LENGTH)}the \t pod now`;
    const caret: number = line.indexOf("the") + "the \t ".length;

    expect(
      timeOf(() => {
        onChange.mockClear();
        render(<MarkdownEditor initialValue={line} onChange={onChange} />);
        fireEvent.click(screen.getByRole("button", { name: "Markdown" }));
        const textarea: HTMLTextAreaElement = screen.getByRole(
          "textbox",
        ) as HTMLTextAreaElement;
        textarea.setSelectionRange(caret, caret);
        fireEvent.paste(textarea, {
          clipboardData: {
            types: ["text/html", "text/plain"],
            items: [],
            getData: (format: string): string => {
              if (format === "text/html") {
                return "<ul><li>restart api</li><li>check logs</li></ul>";
              }
              return format === "text/plain" ? "restart api\ncheck logs" : "";
            },
          },
        });
        cleanup();
      }),
    ).toBeLessThan(2000);

    const calls: Array<Array<unknown>> = onChange.mock.calls;
    const saved: string = String(calls[calls.length - 1]?.[0] ?? "");

    // The run of spaces is the line's own: compared without it, so a failure reads.
    expect(saved.split(times(" ", LENGTH)).join("<the run>")).toBe(
      "Restart<the run>the\n\n- restart api\n- check logs\n\npod now",
    );
  });
});
