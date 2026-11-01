/*
 * Wrapped code, line by line (CodeBlock with wrapLongLines).
 *
 * A command of a few lines is wrapped, so it is read whole - on a phone,
 * in a dialog - instead of scrolling under the copy button. Drawn as one
 * block of text, the rest of a wrapped line started at the left edge like
 * the line under it: in the upgrade dialog,
 *
 *   curl -fsSL https://oneuptime.com/install/storage-array-agent -o
 *   install.sh
 *   bash install.sh
 *
 * read as three commands, the second of them "install.sh". Each line is
 * now drawn on its own, and its rest is indented under it. These are the
 * pieces that make that possible: the highlighter's markup cut into lines
 * that are each markup of their own, the spaces a line starts with, and
 * the places an address may wrap ("https://oneuptime.com/" "install/"
 * "proxmox-agent", never "https://oneuptime.com/ins" "tall/...").
 */
import { describe, expect, test } from "@jest/globals";
import hljs from "../../../UI/Components/CodeBlock/LanguageRegistry";
import {
  CODE_BLOCK_WRAPPED_LINE_INDENT,
  CodeBlockLine,
  addSlashBreaksToHtml,
  countLeadingSpaces,
  getCodeBlockLines,
  getSlashBreakOffsets,
  splitHighlightedHtmlIntoLines,
  splitTextAtSlashBreaks,
} from "../../../UI/Components/CodeBlock/CodeBlockLines";
import { htmlAsText } from "../../Helpers/HtmlText";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

function highlight(code: string, language: string): string {
  return hljs.highlight(code, { language: language, ignoreIllegals: true })
    .value;
}

// How many times `part` is in `text`, counted without a pattern.
function occurrences(text: string, part: string): number {
  return text.split(part).length - 1;
}

const SAMPLES: Array<[string, string]> = [
  [
    "bash",
    "curl -fsSL https://oneuptime.com/install/proxmox-agent -o install.sh\nONEUPTIME_URL=https://oneuptime.com \\\n  ONEUPTIME_TELEMETRY_INGESTION_KEY=94245962-5a3e-46a1-ac4c-7d9c1e43e7dc \\\n  bash install.sh",
  ],
  // A quoted string over two lines: one token across a line break.
  ["bash", 'echo "first\nsecond" # a comment\n\n  cd /opt/agent'],
  // An HTML tag over three lines: tokens inside tokens, across line breaks.
  [
    "xml",
    '<iframe\n  src="https://status.example.com/embed"\n  width="100%"\n></iframe>',
  ],
  ["yaml", "services:\n  agent:\n    image: oneuptime/agent:release\n"],
  ["json", '{\n  "url": "https://example.com/mcp",\n  "on": true\n}'],
];

describe("highlight.js's markup, one line at a time", () => {
  test.each(SAMPLES)(
    "%s: one piece of markup a line, each with the line's own text",
    (language: string, code: string) => {
      const lines: Array<string> | null = splitHighlightedHtmlIntoLines(
        highlight(code, language),
      );

      expect(lines).not.toBeNull();
      expect(
        lines!.map((line: string): string => {
          return htmlAsText(line);
        }),
      ).toEqual(code.split("\n"));
    },
  );

  test.each(SAMPLES)(
    "%s: every span a line opens is closed in it",
    (language: string, code: string) => {
      for (const line of splitHighlightedHtmlIntoLines(
        highlight(code, language),
      )!) {
        expect({ line, closes: occurrences(line, "</span>") }).toEqual({
          line,
          closes: occurrences(line, "<span"),
        });
      }
    },
  );

  test("a token over a line break is closed at the end of the line and opened again on the next, so it keeps its colour", () => {
    const lines: Array<string> = splitHighlightedHtmlIntoLines(
      highlight('echo "first\nsecond"', "bash"),
    )!;

    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(
      '<span class="hljs-built_in">echo</span> <span class="hljs-string">&quot;first</span>',
    );
    expect(lines[1]).toBe('<span class="hljs-string">second&quot;</span>');
  });

  test("tokens inside tokens are opened again in their order", () => {
    expect(
      splitHighlightedHtmlIntoLines(
        '<span class="a">x<span class="b">y\nz</span>w</span>',
      ),
    ).toEqual([
      '<span class="a">x<span class="b">y</span></span>',
      '<span class="a"><span class="b">z</span>w</span>',
    ]);
  });

  test("plain text and empty lines come through as they are", () => {
    expect(splitHighlightedHtmlIntoLines("")).toEqual([""]);
    expect(splitHighlightedHtmlIntoLines("a\n\nb\n")).toEqual([
      "a",
      "",
      "b",
      "",
    ]);
  });

  test("markup that is not only spans is not cut: the code is then drawn whole", () => {
    expect(splitHighlightedHtmlIntoLines("<b>a\nb</b>")).toBeNull();
    expect(splitHighlightedHtmlIntoLines("a</span>\nb")).toBeNull();
    expect(splitHighlightedHtmlIntoLines('<span class="a"\nb')).toBeNull();
    expect(splitHighlightedHtmlIntoLines("<spanx>a</spanx>")).toBeNull();
  });
});

describe("where an address may wrap", () => {
  test("after each slash of its path, never between or right after the two after its scheme, nor at its end", () => {
    expect(
      splitTextAtSlashBreaks(
        "curl -fsSL https://oneuptime.com/install/proxmox-agent -o install.sh",
      ),
    ).toEqual([
      "curl -fsSL https://oneuptime.com/",
      "install/",
      "proxmox-agent -o install.sh",
    ]);
    expect(splitTextAtSlashBreaks("https://a/")).toEqual(["https://a/"]);
    expect(getSlashBreakOffsets("no address here")).toEqual([]);
  });

  test("joined, the pieces are the line exactly", () => {
    const line: string =
      "curl -fsSLO https://tools.acme.com/oneuptime/install/vmware-agent/systemd/oneuptime-vmware-agent-native.service";

    expect(splitTextAtSlashBreaks(line).join("")).toBe(line);
  });

  test("in highlighted markup, only in its text: never inside a tag", () => {
    expect(
      addSlashBreaksToHtml(
        '<span class="hljs-built_in">cd</span> /opt/oneuptime-agent/<span class="x">a</span>',
      ),
    ).toBe(
      '<span class="hljs-built_in">cd</span> /<wbr>opt/<wbr>oneuptime-agent/<span class="x">a</span>',
    );
    expect(addSlashBreaksToHtml("https://oneuptime.com/install")).toBe(
      "https://oneuptime.com/<wbr>install",
    );
  });
});

describe("the lines of a code block", () => {
  test("count the spaces each starts with, so its rest wraps past them", () => {
    expect(countLeadingSpaces("bash install.sh")).toBe(0);
    expect(countLeadingSpaces("  bash install.sh")).toBe(2);
    expect(countLeadingSpaces("    ")).toBe(4);
    expect(countLeadingSpaces("\tx")).toBe(0);
    expect(CODE_BLOCK_WRAPPED_LINE_INDENT).toBe(2);
  });

  test("carry the text, the markup and the indent of every line of highlighted code", () => {
    const code: string =
      "curl -fsSL https://oneuptime.com/install/ceph-agent -o install.sh\nONEUPTIME_URL=https://oneuptime.com \\\n  bash install.sh";
    const lines: Array<CodeBlockLine> = getCodeBlockLines(
      code,
      highlight(code, "bash"),
    )!;

    expect(
      lines.map((line: CodeBlockLine): string => {
        return line.text;
      }),
    ).toEqual(code.split("\n"));
    expect(
      lines.map((line: CodeBlockLine): number => {
        return line.leadingSpaces;
      }),
    ).toEqual([0, 0, 2]);
    expect(lines[0]!.html).toContain(
      "https://oneuptime.com/<wbr>install/<wbr>",
    );
    for (const line of lines) {
      expect(htmlAsText(line.html!)).toBe(line.text);
    }
  });

  test("of code that is not highlighted carry its text alone", () => {
    expect(getCodeBlockLines("a\n  b", null)).toEqual([
      { text: "a", html: null, leadingSpaces: 0 },
      { text: "  b", html: null, leadingSpaces: 2 },
    ]);
  });

  test("are none when the markup cannot be cut, so the code is drawn whole", () => {
    expect(getCodeBlockLines("a\nb", "<b>a\nb</b>")).toBeNull();
    // Markup with a line more or less than the code.
    expect(getCodeBlockLines("a\nb", "a")).toBeNull();
  });
});

/*
 * A code block can hold text from outside - a host's log lines, a webhook
 * body - so the time it takes must grow in line with it.
 */
describe("in linear time", () => {
  test("400,000 characters of a token inside a token, over line breaks, are cut within two seconds", () => {
    const html: string = `<span class="a"><span class="b">${"x/\n".repeat(133333)}</span></span>`;
    let attempt: number = 0;

    const timed: FastestRun<number> = fastestRun({
      run: (): number => {
        attempt++;
        return splitHighlightedHtmlIntoLines(`${html}${attempt}`)!.length;
      },
      limitInMs: 2000,
    });

    expect(timed.result).toBe(133334);
    expect(timed.inMs).toBeLessThan(2000);
  });

  test("400,000 characters of slashes get their breaks within two seconds", () => {
    const text: string = "a/".repeat(200000);
    let attempt: number = 0;

    const timed: FastestRun<number> = fastestRun({
      run: (): number => {
        attempt++;
        return (
          addSlashBreaksToHtml(`${text}${attempt}`).length +
          splitTextAtSlashBreaks(`${text}${attempt}`).length
        );
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
  });
});
