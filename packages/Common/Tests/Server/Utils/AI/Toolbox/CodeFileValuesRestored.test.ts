import {
  CodeFileValuesRestored,
  restoreCodeFileValuesHidden,
} from "../../../../../Server/Utils/AI/Toolbox/CodeFileValuesRestored";
import {
  CodeLineRun,
  findCodePrivateKeyBlockLines,
  formatCodeLinesWithNumbers,
  getCodeLinePrefixLength,
  splitCodeFileLines,
  widenCodeLinesToWholeRuns,
} from "../../../../../Server/Utils/AI/Toolbox/CodeFileLines";
import ToolResultSerializer from "../../../../../Server/Utils/AI/Toolbox/Serializer";
import { describe, expect, test } from "@jest/globals";

/*
 * HIDDEN VALUES WRITTEN BACK (issue #6388), the pure rule: a line of the
 * model's version that holds a placeholder and reads exactly as a read of
 * the file shows one text of it - one line, or a private key block's run -
 * is written as the file has it, when no other text of the file reads the
 * same. Every other line stays as the model wrote it, and what placeholders
 * are left is counted against the file. (CommitCodeOverHiddenValues runs it
 * through the real tools, on every host.)
 */

// A line as read_code_file numbers it: "NNN| " before its text.
const NUMBERED_LINE: RegExp = /^ *\d+\| /;

// A file as a model writes it whole from a read of all of it: each line as shown, its number taken off.
const asShown: (fileContent: string) => string = (
  fileContent: string,
): string => {
  const lines: Array<string> = splitCodeFileLines(fileContent);
  const prefixLength: number = getCodeLinePrefixLength(lines.length);
  const shown: string = ToolResultSerializer.serializeText(
    formatCodeLinesWithNumbers({ lines, startLine: 1 }),
    lines.length,
  ).text;

  return `${shown
    .split("\n")
    .map((line: string): string => {
      return NUMBERED_LINE.test(line) ? line.slice(prefixLength) : line;
    })
    .join("\n")}${fileContent.endsWith("\n") ? "\n" : ""}`;
};

const SERVERS: string = [
  'export const PRIMARY_HOST = "203.0.113.12";',
  'export const BACKUP_HOST = "203.0.113.13";',
  'export const ON_CALL = "ops@acme.com";',
  "export const RETRIES = 3;",
  "",
].join("\n");

const retriesFive: (text: string) => string = (text: string): string => {
  return text.replace("RETRIES = 3;", "RETRIES = 5;");
};

describe("restoreCodeFileValuesHidden", () => {
  test("each line kept as shown is written as the file has it: nothing left to say", () => {
    const restored: CodeFileValuesRestored = restoreCodeFileValuesHidden({
      content: retriesFive(asShown(SERVERS)),
      fileContent: SERVERS,
    });

    expect(asShown(SERVERS)).toContain('PRIMARY_HOST = "[redacted-ip]";');
    expect(restored).toEqual({
      content: retriesFive(SERVERS),
      restoredLineCount: 3,
      placeholdersWritten: [],
    });
  });

  test("a version with no placeholder is left exactly as it is", () => {
    const content: string = "export const RETRIES = 5;\n";

    expect(
      restoreCodeFileValuesHidden({ content, fileContent: SERVERS }),
    ).toEqual({ content, restoredLineCount: 0, placeholdersWritten: [] });
  });

  test("a line changed keeps its placeholder, named on its line; the others are written back", () => {
    const restored: CodeFileValuesRestored = restoreCodeFileValuesHidden({
      content: retriesFive(asShown(SERVERS)).replace(
        'ON_CALL = "[redacted-email]";',
        'ON_CALL = "[redacted-email]"; // pager',
      ),
      fileContent: SERVERS,
    });

    expect(restored.content).toBe(
      retriesFive(SERVERS).replace(
        'ON_CALL = "ops@acme.com";',
        'ON_CALL = "[redacted-email]"; // pager',
      ),
    );
    expect(restored.restoredLineCount).toBe(2);
    expect(restored.placeholdersWritten).toEqual([
      {
        placeholder: "[redacted-email]",
        written: 1,
        onBranch: 0,
        lines: [{ first: 3, last: 3 }],
      },
    ]);
  });

  test("two lines that show the same with different values: neither is written back", () => {
    const fileContent: string = 'host = "203.0.113.1"\nhost = "203.0.113.2"\n';
    const restored: CodeFileValuesRestored = restoreCodeFileValuesHidden({
      content: asShown(fileContent),
      fileContent,
    });

    expect(restored.content).toBe(
      'host = "[redacted-ip]"\nhost = "[redacted-ip]"\n',
    );
    expect(restored.restoredLineCount).toBe(0);
    expect(restored.placeholdersWritten).toEqual([
      {
        placeholder: "[redacted-ip]",
        written: 2,
        onBranch: 0,
        lines: [{ first: 1, last: 2 }],
      },
    ]);
  });

  test("two lines with the same value: one text, both written back", () => {
    const fileContent: string =
      'host = "203.0.113.1"\nx = 1\nhost = "203.0.113.1"\n';

    expect(
      restoreCodeFileValuesHidden({
        content: asShown(fileContent),
        fileContent,
      }).content,
    ).toBe(fileContent);
  });

  test("placeholder text the file holds itself, shown as it is, makes a line that reads like it ambiguous", () => {
    const fileContent: string =
      'ip = "203.0.113.1"\nexpect(x).toBe(1);\nip = "[redacted-ip]"\n';
    const restored: CodeFileValuesRestored = restoreCodeFileValuesHidden({
      content: asShown(fileContent),
      fileContent,
    });

    // Line 1 and line 3 both read 'ip = "[redacted-ip]"': it cannot tell which held the address.
    expect(restored.content).toBe(
      'ip = "[redacted-ip]"\nexpect(x).toBe(1);\nip = "[redacted-ip]"\n',
    );
    expect(restored.placeholdersWritten).toEqual([
      {
        placeholder: "[redacted-ip]",
        written: 2,
        onBranch: 1,
        lines: [
          { first: 1, last: 1 },
          { first: 3, last: 3 },
        ],
      },
    ]);
  });

  test("the file's own placeholder text, kept: nothing to write back, nothing said", () => {
    const fileContent: string = 'expect(shown).toBe("[redacted]");\n';

    expect(
      restoreCodeFileValuesHidden({
        content: `${fileContent}// more\n`,
        fileContent,
      }),
    ).toEqual({
      content: `${fileContent}// more\n`,
      restoredLineCount: 0,
      placeholdersWritten: [],
    });
  });

  test("lines moved: each value goes with its line", () => {
    const [a, b, c, d]: Array<string> = asShown(SERVERS).split("\n");
    const [oa, ob, oc, od]: Array<string> = SERVERS.split("\n");

    expect(
      restoreCodeFileValuesHidden({
        content: [d, c, a, b, ""].join("\n"),
        fileContent: SERVERS,
      }).content,
    ).toBe([od, oc, oa, ob, ""].join("\n"));
  });

  test("a line no text of the file reads like keeps its placeholder: never a value guessed", () => {
    const restored: CodeFileValuesRestored = restoreCodeFileValuesHidden({
      content: 'export const PRIMARY_HOST = "[redacted-email]";\n',
      fileContent: SERVERS,
    });

    expect(restored.content).toBe(
      'export const PRIMARY_HOST = "[redacted-email]";\n',
    );
    expect(restored.placeholdersWritten).toHaveLength(1);
  });

  test("a private key block, shown as one placeholder, is written back whole; lines after it named on the model's own lines", () => {
    const fileContent: string = [
      "const KEY = `",
      "-----BEGIN PRIVATE KEY-----",
      "Zmlyc3Qga2V5IGJvZHk",
      "c2Vjb25kIGxpbmU",
      "-----END PRIVATE KEY-----",
      "`;",
      'const HOST = "203.0.113.9";',
      "",
    ].join("\n");
    const shown: string = asShown(fileContent);

    expect(shown).toBe(
      'const KEY = `\n[redacted-private-key]\n`;\nconst HOST = "[redacted-ip]";\n',
    );

    const restored: CodeFileValuesRestored = restoreCodeFileValuesHidden({
      content: shown.replace(
        'HOST = "[redacted-ip]";',
        'HOST = "[redacted-ip]"; // edge',
      ),
      fileContent,
    });

    expect(restored.content).toBe(
      fileContent.replace(
        'HOST = "203.0.113.9";',
        'HOST = "[redacted-ip]"; // edge',
      ),
    );
    // Line 7 of what is written, line 4 of what the model wrote.
    expect(restored.placeholdersWritten).toEqual([
      {
        placeholder: "[redacted-ip]",
        written: 1,
        onBranch: 0,
        lines: [{ first: 4, last: 4 }],
      },
    ]);
  });

  test("a line shown only beside the line before it - a value read across their break - is not written back", () => {
    const lines: Array<string> = [];

    for (let line: number = 1; line <= 120; line++) {
      lines.push(line === 99 ? "const password =" : `v${line} = ${line};`);
    }

    const fileContent: string = `${lines.join("\n")}\n`;
    const shown: string = asShown(fileContent);

    // The key-value rule reads "100|" as the password's value: line 100 loses its number.
    expect(shown).toContain("const password =\n[redacted] v100 = 100;\n");

    const restored: CodeFileValuesRestored = restoreCodeFileValuesHidden({
      content: shown,
      fileContent,
    });

    expect(restored.content).toBe(shown);
    expect(restored.placeholdersWritten).toEqual([
      {
        placeholder: "[redacted]",
        written: 1,
        onBranch: 0,
        lines: [{ first: 100, last: 100 }],
      },
    ]);
  });

  test("a Windows file: a line ends as the model ended it", () => {
    const fileContent: string = 'a = "203.0.113.1"\r\nb = 2\r\n';
    const shown: string = asShown(fileContent);

    expect(shown).toBe('a = "[redacted-ip]"\r\nb = 2\r\n');
    expect(
      restoreCodeFileValuesHidden({ content: shown, fileContent }).content,
    ).toBe(fileContent);
    expect(
      restoreCodeFileValuesHidden({
        content: shown.replace(/\r/g, ""),
        fileContent,
      }).content,
    ).toBe('a = "203.0.113.1"\nb = 2\n');
  });

  test("an empty file, or one without the line: nothing written back", () => {
    for (const fileContent of ["", "x = 1\n"]) {
      const restored: CodeFileValuesRestored = restoreCodeFileValuesHidden({
        content: 'host = "[redacted-ip]"\n',
        fileContent,
      });

      expect(restored.content).toBe('host = "[redacted-ip]"\n');
      expect(restored.restoredLineCount).toBe(0);
    }
  });
});

describe("a file's lines as read_code_file shows them", () => {
  test("split at each newline, none after a last one, none for an empty file", () => {
    expect(splitCodeFileLines("")).toEqual([]);
    expect(splitCodeFileLines("a\nb\n")).toEqual(["a", "b"]);
    expect(splitCodeFileLines("a\nb")).toEqual(["a", "b"]);
    expect(splitCodeFileLines("a\r\n")).toEqual(["a\r"]);
  });

  test("numbered to the width of the last line's number", () => {
    expect(
      formatCodeLinesWithNumbers({ lines: ["a", "b"], startLine: 9 }),
    ).toBe(" 9| a\n10| b");
    expect(getCodeLinePrefixLength(10)).toBe(4);
    expect(getCodeLinePrefixLength(999)).toBe(5);
  });

  test("a private key block's run of lines, header to footer", () => {
    const content: string = [
      "a",
      "-----BEGIN RSA PRIVATE KEY-----",
      "x",
      "-----END RSA PRIVATE KEY-----",
      "b",
      'k = "-----BEGIN EC PRIVATE KEY-----\\nzz\\n-----END EC PRIVATE KEY-----"',
      "-----BEGIN PRIVATE KEY-----",
      "never ends",
      "",
    ].join("\n");

    expect(findCodePrivateKeyBlockLines(content)).toEqual([
      { first: 2, last: 4 },
      { first: 6, last: 6 },
    ]);
    expect(findCodePrivateKeyBlockLines("no keys here\n")).toEqual([]);
  });

  test("a window widened so it cuts no run: started inside one, ended inside one, or both", () => {
    const runs: Array<CodeLineRun> = [
      { first: 5, last: 9 },
      { first: 20, last: 22 },
    ];

    expect(widenCodeLinesToWholeRuns({ first: 1, last: 4, runs })).toEqual({
      first: 1,
      last: 4,
    });
    expect(widenCodeLinesToWholeRuns({ first: 7, last: 12, runs })).toEqual({
      first: 5,
      last: 12,
    });
    expect(widenCodeLinesToWholeRuns({ first: 1, last: 6, runs })).toEqual({
      first: 1,
      last: 9,
    });
    expect(widenCodeLinesToWholeRuns({ first: 6, last: 21, runs })).toEqual({
      first: 5,
      last: 22,
    });
    // A run's first or last line is inside it too.
    expect(widenCodeLinesToWholeRuns({ first: 9, last: 20, runs })).toEqual({
      first: 5,
      last: 22,
    });
  });
});
