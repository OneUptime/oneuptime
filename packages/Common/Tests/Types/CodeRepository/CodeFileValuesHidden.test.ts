import {
  CodeFilePlaceholderWritten,
  MAX_PLACEHOLDERS_WRITTEN,
  countCodePlaceholder,
  findCodePlaceholdersWritten,
  holdsCodePlaceholder,
  readCodePlaceholdersWritten,
} from "../../../Types/CodeRepository/CodeFileValuesHidden";
import {
  CodeChangeProposedOn,
  CodeFileUnseen,
  readCodeChangeProposedOn,
} from "../../../Types/CodeRepository/CodeFileSeen";
import { AIChatLineRange } from "../../../Types/AI/AIChatRecordSeen";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * ISSUE #6364: THE PURE RULE OF WHAT A CODE CHANGE WRITES IN PLACE OF
 * VALUES HIDDEN FROM ASK AI.
 *
 * A placeholder Ask AI's version of a file holds more often than the file
 * on the branch does was written where a value was hidden from it; one the
 * file holds itself, kept as often, is the file's own text. Counted with
 * indexOf, lines numbered as read_code_file numbers them, and a stored
 * finding read back as untrusted.
 */

const IP: string = "[redacted-ip]";
const EMAIL: string = "[redacted-email]";
const SECRET: string = "[redacted]";
const PLACEHOLDERS: Array<string> = [EMAIL, IP, SECRET];

const range: (first: number, last: number) => AIChatLineRange = (
  first: number,
  last: number,
): AIChatLineRange => {
  return { first, last };
};

describe("counting a placeholder", () => {
  test.each<[string, string, number]>([
    ["", IP, 0],
    ["host = 10.0.0.12", IP, 0],
    [`host = ${IP}`, IP, 1],
    [`${IP}${IP}${IP}`, IP, 3],
    [`a ${IP}\nb ${IP}\n`, IP, 2],
    // One placeholder is never read inside another.
    [`password = ${SECRET}`, IP, 0],
    [`host = ${IP}`, SECRET, 0],
    ["[redacted-ip", IP, 0],
    ["redacted-ip]", IP, 0],
    [`[${IP}]`, IP, 1],
  ])(
    "%j holds %s %d times",
    (text: string, placeholder: string, count: number) => {
      expect(countCodePlaceholder(text, placeholder)).toBe(count);
    },
  );

  test("an empty placeholder is in no text", () => {
    expect(countCodePlaceholder("anything", "")).toBe(0);
    expect(holdsCodePlaceholder("anything", [""])).toBe(false);
  });

  test("whether a text holds any of them", () => {
    expect(holdsCodePlaceholder("const a = 1;\n", PLACEHOLDERS)).toBe(false);
    expect(holdsCodePlaceholder(`to: ${EMAIL}\n`, PLACEHOLDERS)).toBe(true);
    expect(holdsCodePlaceholder(`to: ${EMAIL}\n`, [IP])).toBe(false);
    expect(holdsCodePlaceholder(`to: ${EMAIL}\n`, [])).toBe(false);
  });

  test("sixteen megabytes on one line are read in a moment, by indexOf", () => {
    const text: string = `${"q".repeat(8 * 1024 * 1024)}${IP}${"z".repeat(8 * 1024 * 1024)}`;
    const branchContent: string = text.replace(IP, "10.0.0.1");
    const timed: FastestRun<Array<CodeFilePlaceholderWritten>> = fastestRun({
      run: (): Array<CodeFilePlaceholderWritten> => {
        return findCodePlaceholdersWritten({
          content: text,
          branchContent,
          placeholders: PLACEHOLDERS,
        });
      },
      limitInMs: 5000,
    });

    expect(countCodePlaceholder(text, IP)).toBe(1);
    expect(timed.result).toEqual([
      { placeholder: IP, written: 1, onBranch: 0, lines: [range(1, 1)] },
    ]);
    expect(timed.inMs).toBeLessThan(5000);
  });

  test("the module runs no regular expression over a text (Docs/notifications/README.md: megabyte-long values)", () => {
    const file: string = path.join(
      __dirname,
      "../../../Types/CodeRepository/CodeFileValuesHidden.ts",
    );
    const source: ts.SourceFile = ts.createSourceFile(
      file,
      fs.readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const found: Array<string> = [];

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (
        node.kind === ts.SyntaxKind.RegularExpressionLiteral ||
        ((ts.isNewExpression(node) || ts.isCallExpression(node)) &&
          node.expression.getText(source) === "RegExp")
      ) {
        found.push(node.getText(source));
      }

      ts.forEachChild(node, visit);
    };

    visit(source);

    expect(found).toEqual([]);
  });
});

describe("what a version writes in place of hidden values", () => {
  test("none in the version: nothing, whatever the branch's file holds", () => {
    expect(
      findCodePlaceholdersWritten({
        content: "host = process.env.HOST;\n",
        branchContent: `host = ${IP};\n`,
        placeholders: PLACEHOLDERS,
      }),
    ).toEqual([]);
  });

  test("the issue's case: an address and an email the file has as values, written back as placeholders", () => {
    expect(
      findCodePlaceholdersWritten({
        content: `export const PRIMARY = "${IP}";\nexport const BACKUP = "${IP}";\nexport const OPS = "${EMAIL}";\nexport const RETRIES = 4;\n`,
        branchContent:
          'export const PRIMARY = "10.0.0.12";\nexport const BACKUP = "10.0.0.13";\nexport const OPS = "ops@acme.com";\nexport const RETRIES = 3;\n',
        placeholders: PLACEHOLDERS,
      }),
    ).toEqual([
      { placeholder: IP, written: 2, onBranch: 0, lines: [range(1, 2)] },
      { placeholder: EMAIL, written: 1, onBranch: 0, lines: [range(3, 3)] },
    ]);
  });

  test("the file's own placeholder text, kept as often: nothing", () => {
    const tests: string = `expect(redact("ip 1.2.3.4")).toBe("ip ${IP}");\n`;

    expect(
      findCodePlaceholdersWritten({
        content: `${tests}// one more test\n`,
        branchContent: tests,
        placeholders: PLACEHOLDERS,
      }),
    ).toEqual([]);
    // Fewer than the file has: still nothing written over a value.
    expect(
      findCodePlaceholdersWritten({
        content: "// tests removed\n",
        branchContent: tests,
        placeholders: PLACEHOLDERS,
      }),
    ).toEqual([]);
  });

  test("more than the file's own: said, with how many the file has, on every line that holds it", () => {
    expect(
      findCodePlaceholdersWritten({
        // Line 1's input was "ip 1.2.3.4" before Ask AI read it.
        content: `expect(redact("ip ${IP}")).toBe("ip ${IP}");\n`,
        branchContent: `expect(redact("ip 1.2.3.4")).toBe("ip ${IP}");\n`,
        placeholders: PLACEHOLDERS,
      }),
    ).toEqual([
      { placeholder: IP, written: 2, onBranch: 1, lines: [range(1, 1)] },
    ]);
  });

  test("a new file - nothing on the branch - holds none of its own", () => {
    expect(
      findCodePlaceholdersWritten({
        content: `PASSWORD=${SECRET}\n`,
        branchContent: "",
        placeholders: PLACEHOLDERS,
      }),
    ).toEqual([
      { placeholder: SECRET, written: 1, onBranch: 0, lines: [range(1, 1)] },
    ]);
  });

  test("in the order the version first writes them, each counted on its own, only those given", () => {
    const content: string = `${SECRET}\n${IP}\n${EMAIL}\n`;
    const order: (placeholders: Array<string>) => Array<string> = (
      placeholders: Array<string>,
    ): Array<string> => {
      return findCodePlaceholdersWritten({
        content,
        branchContent: "",
        placeholders,
      }).map((written: CodeFilePlaceholderWritten): string => {
        return written.placeholder;
      });
    };

    expect(order([SECRET, IP, EMAIL])).toEqual([SECRET, IP, EMAIL]);
    expect(order([EMAIL, IP, SECRET])).toEqual([SECRET, IP, EMAIL]);
    expect(order([EMAIL, IP])).toEqual([IP, EMAIL]);
  });

  test("two first written on one line: in the placeholders' order", () => {
    const content: string = `${EMAIL} ${IP}\n${IP}\n`;

    expect(
      findCodePlaceholdersWritten({
        content,
        branchContent: "",
        placeholders: [IP, EMAIL],
      }).map((written: CodeFilePlaceholderWritten): string => {
        return written.placeholder;
      }),
    ).toEqual([IP, EMAIL]);
    expect(
      findCodePlaceholdersWritten({
        content,
        branchContent: "",
        placeholders: [EMAIL, IP],
      }).map((written: CodeFilePlaceholderWritten): string => {
        return written.placeholder;
      }),
    ).toEqual([EMAIL, IP]);
  });

  test.each<[string, string, Array<AIChatLineRange>]>([
    ["at the very start", `${IP} = a\nb\n`, [range(1, 1)]],
    ["at the very end, no last newline", `a\nb ${IP}`, [range(2, 2)]],
    ["twice on one line", `a ${IP} ${IP}\n`, [range(1, 1)]],
    [
      "lines running on",
      `${IP}\n${IP}\n${IP}\nx\n${IP}\n`,
      [range(1, 3), range(5, 5)],
    ],
    [
      "CRLF, as read_code_file numbers it",
      `a\r\nb ${IP}\r\nc\r\n${IP}\r\n`,
      [range(2, 2), range(4, 4)],
    ],
    ["after empty lines", `\n\n\n${IP}\n`, [range(4, 4)]],
  ])(
    "its lines: %s",
    (_case: string, content: string, lines: Array<AIChatLineRange>) => {
      expect(
        findCodePlaceholdersWritten({
          content,
          branchContent: "",
          placeholders: [IP],
        })[0]!.lines,
      ).toEqual(lines);
    },
  );
});

describe("a stored finding's placeholders, read as untrusted", () => {
  const WELL_FORMED: Array<CodeFilePlaceholderWritten> = [
    { placeholder: IP, written: 2, onBranch: 0, lines: [range(1, 2)] },
    { placeholder: SECRET, written: 3, onBranch: 1, lines: [range(4, 4)] },
  ];

  test("well formed: read back as written", () => {
    expect(
      readCodePlaceholdersWritten(JSON.parse(JSON.stringify(WELL_FORMED))),
    ).toEqual(WELL_FORMED);
  });

  const entry: (overrides: Record<string, unknown>) => Array<unknown> = (
    overrides: Record<string, unknown>,
  ): Array<unknown> => {
    return [{ ...WELL_FORMED[0], ...overrides }];
  };

  test.each<[string, unknown]>([
    ["not a list", { placeholder: IP }],
    ["null", null],
    ["an empty list", []],
    [
      "more than any redaction writes kinds of",
      Array.from({ length: MAX_PLACEHOLDERS_WRITTEN + 1 }, () => {
        return WELL_FORMED[0];
      }),
    ],
    ["an entry that is not an object", ["[redacted-ip]"]],
    ["an entry that is a list", [[IP, 2, 0]]],
    ["a placeholder missing", entry({ placeholder: undefined })],
    ["an empty placeholder", entry({ placeholder: "" })],
    [
      "a placeholder longer than any",
      entry({ placeholder: `[${"x".repeat(80)}]` }),
    ],
    ["a placeholder that is not text", entry({ placeholder: 4 })],
    ["written not a number", entry({ written: "2" })],
    ["written not whole", entry({ written: 1.5 })],
    ["written below zero", entry({ written: -1 })],
    ["written NaN", entry({ written: Number.NaN })],
    ["written Infinity", entry({ written: Number.POSITIVE_INFINITY })],
    ["on the branch as often as written", entry({ written: 2, onBranch: 2 })],
    [
      "on the branch more often than written",
      entry({ written: 2, onBranch: 3 }),
    ],
    ["on the branch below zero", entry({ onBranch: -1 })],
    ["no lines", entry({ lines: [] })],
    ["lines not a list", entry({ lines: "1-2" })],
    ["a line before the first", entry({ lines: [range(0, 1)] })],
    ["a run backwards", entry({ lines: [range(5, 2)] })],
    ["a line not whole", entry({ lines: [range(1.5, 2)] })],
  ])("%s: no note at all", (_case: string, value: unknown) => {
    expect(readCodePlaceholdersWritten(value)).toBeNull();
  });
});

describe("what a change was proposed on keeps of a finding of hidden values", () => {
  const proposedOn: (finding: Record<string, unknown>) => unknown = (
    finding: Record<string, unknown>,
  ): unknown => {
    return {
      branchName: "fix/login",
      files: [{ filePath: "config/servers.ts", fingerprint: "f1" }],
      unseen: [finding],
    };
  };

  test("kept whole, with the placeholders and lines the reviewer is told", () => {
    const finding: Record<string, unknown> = {
      filePath: "config/servers.ts",
      unseen: CodeFileUnseen.ValuesHidden,
      placeholdersWritten: [
        { placeholder: IP, written: 2, onBranch: 0, lines: [range(1, 2)] },
      ],
    };

    expect(readCodeChangeProposedOn(proposedOn(finding))).toEqual({
      branchName: "fix/login",
      files: [{ filePath: "config/servers.ts", fingerprint: "f1" }],
      unseen: [finding],
    });
  });

  test("the branch's file not read is kept too, and only as true", () => {
    const read: (value: unknown) => CodeChangeProposedOn | null = (
      value: unknown,
    ): CodeChangeProposedOn | null => {
      return readCodeChangeProposedOn(
        proposedOn({
          filePath: "config/servers.ts",
          unseen: CodeFileUnseen.ValuesHidden,
          branchTextNotRead: value,
        }),
      );
    };

    expect(read(true)!.unseen[0]!.branchTextNotRead).toBe(true);

    for (const value of [false, "true", 1, null]) {
      expect(read(value)!.unseen[0]).toEqual({
        filePath: "config/servers.ts",
        unseen: CodeFileUnseen.ValuesHidden,
      });
    }
  });

  test("damaged placeholders drop the note, never the finding or the hold", () => {
    const read: CodeChangeProposedOn | null = readCodeChangeProposedOn(
      proposedOn({
        filePath: "config/servers.ts",
        unseen: CodeFileUnseen.ValuesHidden,
        placeholdersWritten: [{ placeholder: IP, written: 0 }],
      }),
    );

    expect(read!.files).toEqual([
      { filePath: "config/servers.ts", fingerprint: "f1" },
    ]);
    expect(read!.unseen).toEqual([
      { filePath: "config/servers.ts", unseen: CodeFileUnseen.ValuesHidden },
    ]);
  });

  test("placeholders on a finding of another kind are not its own: left out", () => {
    const read: CodeChangeProposedOn | null = readCodeChangeProposedOn(
      proposedOn({
        filePath: "config/servers.ts",
        unseen: CodeFileUnseen.ChangedSinceRead,
        placeholdersWritten: [
          { placeholder: IP, written: 1, onBranch: 0, lines: [range(1, 1)] },
        ],
        branchTextNotRead: true,
      }),
    );

    expect(read!.unseen).toEqual([
      {
        filePath: "config/servers.ts",
        unseen: CodeFileUnseen.ChangedSinceRead,
      },
    ]);
  });

  test("a file can be named twice, for what Ask AI never saw and for what it writes", () => {
    const read: CodeChangeProposedOn | null = readCodeChangeProposedOn({
      branchName: "fix/login",
      files: [{ filePath: "config/servers.ts", fingerprint: "f1" }],
      unseen: [
        {
          filePath: "config/servers.ts",
          unseen: CodeFileUnseen.ValuesHidden,
          placeholdersWritten: [
            { placeholder: IP, written: 1, onBranch: 0, lines: [range(1, 1)] },
          ],
        },
        {
          filePath: "config/servers.ts",
          unseen: CodeFileUnseen.ChangedSinceRead,
        },
      ],
    });

    expect(
      read!.unseen.map((finding: { unseen: CodeFileUnseen }) => {
        return finding.unseen;
      }),
    ).toEqual([CodeFileUnseen.ValuesHidden, CodeFileUnseen.ChangedSinceRead]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Against an oracle that counts its own way: texts drawn from pieces that
 * hold placeholders, near-misses of them and newlines, in both endings.
 * ---------------------------------------------------------------------------
 */

const PIECES: Array<string> = [
  IP,
  EMAIL,
  SECRET,
  "[redacted-ip",
  "redacted]",
  "[[",
  "]]",
  "[redacted-",
  "a",
  "b",
  " ",
  "=",
  "\n",
  "\r\n",
  "10.0.0.1",
];

const drawText: (random: SeededRandom) => string = (
  random: SeededRandom,
): string => {
  const length: number = random(60);
  let text: string = "";

  for (let index: number = 0; index < length; index++) {
    text += PIECES[random(PIECES.length)];
  }

  return text;
};

// The oracle: each line on its own, split at every newline, counted by splitting.
const oracle: (
  content: string,
  branchContent: string,
  placeholders: Array<string>,
) => Array<CodeFilePlaceholderWritten> = (
  content: string,
  branchContent: string,
  placeholders: Array<string>,
): Array<CodeFilePlaceholderWritten> => {
  const count: (text: string, placeholder: string) => number = (
    text: string,
    placeholder: string,
  ): number => {
    return text.split(placeholder).length - 1;
  };
  const written: Array<CodeFilePlaceholderWritten> = [];

  for (const placeholder of placeholders) {
    const inContent: number = count(content, placeholder);
    const onBranch: number = count(branchContent, placeholder);

    if (inContent <= onBranch) {
      continue;
    }

    const lines: Array<AIChatLineRange> = [];

    content.split("\n").forEach((line: string, index: number): void => {
      if (!line.includes(placeholder)) {
        return;
      }

      const previous: AIChatLineRange | undefined = lines[lines.length - 1];

      if (previous && previous.last === index) {
        previous.last = index + 1;
      } else {
        lines.push(range(index + 1, index + 1));
      }
    });

    written.push({ placeholder, written: inContent, onBranch, lines });
  }

  // First written first; Array.prototype.sort is stable, so ties keep the placeholders' order.
  return written.sort(
    (a: CodeFilePlaceholderWritten, b: CodeFilePlaceholderWritten): number => {
      return a.lines[0]!.first - b.lines[0]!.first;
    },
  );
};

describe("every text, against an oracle", () => {
  test("what a version writes, its counts and its lines, as the oracle reads them", () => {
    const random: SeededRandom = seededRandom(63640);
    let said: number = 0;
    let keptTheFilesOwn: number = 0;

    for (let round: number = 0; round < 3000; round++) {
      const branchContent: string = drawText(random);
      // Often the branch's file with a few pieces more or fewer, as a change is.
      const content: string =
        random(3) === 0
          ? drawText(random)
          : branchContent.slice(0, random(branchContent.length + 1)) +
            drawText(random).slice(0, random(12)) +
            branchContent.slice(random(branchContent.length + 1));

      const found: Array<CodeFilePlaceholderWritten> =
        findCodePlaceholdersWritten({
          content,
          branchContent,
          placeholders: PLACEHOLDERS,
        });

      expect({ round, found }).toEqual({
        round,
        found: oracle(content, branchContent, PLACEHOLDERS),
      });

      if (found.length > 0) {
        said++;
      } else if (holdsCodePlaceholder(content, PLACEHOLDERS)) {
        keptTheFilesOwn++;
      }

      // Stored and read back, it is what was found.
      if (found.length > 0) {
        expect(
          readCodePlaceholdersWritten(JSON.parse(JSON.stringify(found))),
        ).toEqual(found);
      }
    }

    expect(said).toBeGreaterThan(500);
    expect(keptTheFilesOwn).toBeGreaterThan(200);
  });
});
