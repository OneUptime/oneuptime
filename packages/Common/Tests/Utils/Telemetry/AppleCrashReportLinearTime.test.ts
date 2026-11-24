import {
  AppleBinaryImage,
  AppleCrashReport,
  parseAppleCrashReport,
  readAppleFrameLine,
  readAppleImageLine,
  readSideBySideSymbol,
} from "../../../Utils/Telemetry/AppleCrashReport";
import { normalizeAppleDebugId } from "../../../Utils/Telemetry/AppleSymbols";
import { fastestRun } from "../../Helpers/FastestRun";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import { describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * AN APPLE CRASH REPORT'S BINARY IMAGE LINES AND SIDE-BY-SIDE SYMBOLS ARE
 * READ IN TIME IN LINE WITH THEIR LENGTH, AS THEIR PATTERNS READ THEM.
 *
 * A report reaches OneUptime from the app on a device (#10145), and a line
 * of it may be as long as the report: 4 MB. Three patterns read its lines
 * by finding the first place a run of white space led to what they wanted,
 * and read each run again from each of its characters:
 *
 *   - KSCrash's image line, ^0x..\s+-\s+0x..\s+(.+?)\s+(\S+)\s+<uuid>\s*(.*)$:
 *     a line with two long runs of white space and no UUID after them, or
 *     a long run before a line separator after its UUID;
 *   - MetricKit's drawn image line, ^(.+?)\s+<uuid>$;
 *   - a frame's symbol written beside its position,
 *     ^(.*?)\s+\((.+) \+ (\d{1,20})\)$.
 *
 * Each took a quarter of a second at 32 KB and grew with the square of the
 * length: hours on a 4 MB line, on the server that reads every report.
 * Readers that read each character a fixed number of times stand for them
 * now (Utils/Telemetry/AppleCrashReport). OutsideTextPatternsGuard found
 * the first by its shape; these hold all three to their time, and to the
 * answers of the patterns, kept here as the reference.
 * ---------------------------------------------------------------------------
 */

const LENGTH: number = 400000;

const repeat: (unit: string, length: number) => string = (
  unit: string,
  length: number,
): string => {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
};

/*
 * How long the work takes: the fastest of up to three attempts, counted as
 * it would have run on a usual runner when every attempt overran on a slow
 * one (Tests/Helpers/FastestRun).
 */
const timeOf: (run: () => unknown) => number = (run: () => unknown): number => {
  return fastestRun({ run: run, limitInMs: 2000 }).inMs;
};

// The patterns as they were: the reference the readers must agree with.
const KSCRASH_IMAGE_BEFORE: RegExp =
  /^0x([0-9a-fA-F]{1,16})\s+-\s+0x([0-9a-fA-F]{1,16})\s+(.+?)\s+(\S+)\s+<([0-9a-fA-F-]{32,36})>\s*(.*)$/;
const DRAWN_IMAGE_BEFORE: RegExp = /^(.+?)\s+<([0-9a-fA-F-]{32,36})>$/;
const SIDE_BY_SIDE_BEFORE: RegExp = /^(.*?)\s+\((.+) \+ (\d{1,20})\)$/;

const readHex: (text: string) => number | null = (
  text: string,
): number | null => {
  const value: number = parseInt(text, 16);

  return Number.isSafeInteger(value) && value >= 0 ? value : null;
};

// An image line, as the module read it with the patterns.
function imageAsThePatternsReadIt(line: string): AppleBinaryImage | null {
  const trimmed: string = line.trim();
  const kscrash: RegExpMatchArray | null = trimmed.match(KSCRASH_IMAGE_BEFORE);

  if (kscrash) {
    return {
      name: kscrash[3]!.trim(),
      debugId: normalizeAppleDebugId(kscrash[5]!),
      loadAddress: readHex(kscrash[1]!),
      path: kscrash[6]!.trim() || null,
      architecture: kscrash[4]!,
    };
  }

  const drawn: RegExpMatchArray | null = trimmed.match(DRAWN_IMAGE_BEFORE);

  if (drawn) {
    return {
      name: drawn[1]!.trim(),
      debugId: normalizeAppleDebugId(drawn[2]!),
      loadAddress: null,
      path: null,
      architecture: null,
    };
  }

  return null;
}

function sideBySideAsThePatternReadIt(
  text: string,
): { before: string; symbol: string; offset: string } | null {
  const match: RegExpMatchArray | null = text.match(SIDE_BY_SIDE_BEFORE);

  return match
    ? { before: match[1]!, symbol: match[2]!, offset: match[3]! }
    : null;
}

const UUID: string = "70B89F27-1634-3580-A695-57CDB41D7743";
const UUID_32: string = "70b89f2716343580a69557cdb41d7743";
const UUID_37: string = `${UUID}0`;
const LINE_SEPARATOR: string = String.fromCharCode(0x2028);

// The pieces image lines are drawn from: KSCrash's and MetricKit's, and what breaks them.
const IMAGE_PIECES: ReadonlyArray<string> = [
  " ",
  "  ",
  "\t",
  " ",
  LINE_SEPARATOR,
  "\r",
  "MyApp",
  "My",
  "App",
  "arm64",
  "x86_64",
  `<${UUID}>`,
  `<${UUID_32}>`,
  `<${UUID_37}>`,
  `<${UUID}`,
  `${UUID}>`,
  "<",
  ">",
  "-",
  "0x1",
  "0x102a20000",
  "/private/var/containers/Bundle/Application/X/MyApp.app/MyApp",
  "(",
  "+",
  // A binary's architecture and UUID, as KSCrash writes them after its name.
  ` arm64  <${UUID}> `,
  `\tarm64\t<${UUID_32}>`,
  ` arm64 <${UUID}>${LINE_SEPARATOR}`,
  `MyApp arm64 <${UUID}>`,
];

// How a drawn line starts: KSCrash's addresses, written well or not, or nothing.
const IMAGE_PREFIXES: ReadonlyArray<string> = [
  "",
  "0x1 - 0x2 ",
  "0x102a20000 - 0x102b0ffff ",
  "0x1\t- 0x2\t",
  `0x1 - 0x2${LINE_SEPARATOR}  `,
  "0x12345678901234567 - 0x2 ",
  "0x1 -0x2 ",
];

const SIDE_BY_SIDE_PIECES: ReadonlyArray<string> = [
  " ",
  "\t",
  LINE_SEPARATOR,
  "\r",
  "(",
  ")",
  "main",
  " + ",
  "52",
  "123456789012345678901",
  "0x102a20000",
  "+",
  "x",
  "(main + 52)",
  " (main + 52)",
  `${LINE_SEPARATOR}(`,
  "-[UIApplication sendEvent:]",
];

const SIDE_BY_SIDE_ENDINGS: ReadonlyArray<string> = [
  "",
  " + 52)",
  " (main + 52)",
  " (x + 123456789012345678901)",
  ` (a${LINE_SEPARATOR}b + 7)`,
];

describe("a binary image line is read as the patterns read it", () => {
  test("on a hundred thousand drawn lines, KSCrash's and MetricKit's", () => {
    const differences: Array<string> = [];
    let kscrash: number = 0;
    let drawn: number = 0;

    for (const [index, prefix] of IMAGE_PREFIXES.entries()) {
      for (const text of generatedTexts(15000, 9922 + index, IMAGE_PIECES, 9)) {
        const line: string = prefix + text;
        const expected: AppleBinaryImage | null =
          imageAsThePatternsReadIt(line);

        if (expected?.architecture) {
          kscrash++;
        } else if (expected) {
          drawn++;
        }

        if (
          JSON.stringify(readAppleImageLine(line)) !== JSON.stringify(expected)
        ) {
          differences.push(JSON.stringify(line));
        }
      }
    }

    expect(differences.slice(0, 20)).toEqual([]);
    // Both kinds are among them, many times over.
    expect(kscrash).toBeGreaterThan(3000);
    expect(drawn).toBeGreaterThan(3000);
  });

  test("the lines KSCrash and MetricKit write", () => {
    expect(
      readAppleImageLine(
        `0x102a20000 - 0x102b0ffff MyApp arm64  <${UUID.toLowerCase()}> /private/var/containers/Bundle/Application/X/MyApp.app/MyApp`,
      ),
    ).toEqual({
      name: "MyApp",
      debugId: normalizeAppleDebugId(UUID),
      loadAddress: 0x102a20000,
      path: "/private/var/containers/Bundle/Application/X/MyApp.app/MyApp",
      architecture: "arm64",
    });
    // A name with spaces in it is read whole; a line with no path has none.
    expect(
      readAppleImageLine(`0x1 - 0x2 My Great App arm64 <${UUID}>`),
    ).toEqual({
      name: "My Great App",
      debugId: normalizeAppleDebugId(UUID),
      loadAddress: 1,
      path: null,
      architecture: "arm64",
    });
    expect(readAppleImageLine(`MyApp <${UUID}>`)).toEqual({
      name: "MyApp",
      debugId: normalizeAppleDebugId(UUID),
      loadAddress: null,
      path: null,
      architecture: null,
    });
    expect(readAppleImageLine(`UIKit Core <${UUID}>`)?.name).toBe("UIKit Core");
  });

  test("what the patterns refused, the readers refuse", () => {
    for (const line of [
      // A UUID of 37 characters, or with no closing bracket.
      `MyApp <${UUID_37}>`,
      `0x1 - 0x2 MyApp arm64 <${UUID}`,
      // A line separator in the path, or in the name.
      `0x1 - 0x2 MyApp arm64 <${UUID}> /a${LINE_SEPARATOR}b`,
      `My${LINE_SEPARATOR}App <${UUID}>`,
      // No white space before the UUID.
      `MyApp<${UUID}>`,
      "",
    ]) {
      expect({ line, image: readAppleImageLine(line) }).toEqual({
        line,
        image: imageAsThePatternsReadIt(line),
      });
      expect(readAppleImageLine(line)).toBeNull();
    }

    // An address of seventeen digits is no KSCrash line: it is read as drawn, with no load address.
    const tooLong: string = `0x12345678901234567 - 0x2 MyApp arm64 <${UUID}>`;

    expect(readAppleImageLine(tooLong)).toEqual(
      imageAsThePatternsReadIt(tooLong),
    );
    expect(readAppleImageLine(tooLong)).toEqual({
      name: "0x12345678901234567 - 0x2 MyApp arm64",
      debugId: normalizeAppleDebugId(UUID),
      loadAddress: null,
      path: null,
      architecture: null,
    });
  });

  test("a KSCrash line with no name keeps the empty name the pattern gave it", () => {
    const line: string = `0x1 - 0x2   arm64 <${UUID}> /usr/lib/dyld`;

    expect(readAppleImageLine(line)).toEqual(imageAsThePatternsReadIt(line));
    expect(readAppleImageLine(line)?.name).toBe("");
    expect(readAppleImageLine(line)?.architecture).toBe("arm64");
  });
});

describe("a frame's symbol written beside its position is read as the pattern read it", () => {
  test("on a hundred thousand drawn positions", () => {
    const differences: Array<string> = [];
    let read: number = 0;

    for (const [index, ending] of SIDE_BY_SIDE_ENDINGS.entries()) {
      for (const text of generatedTexts(
        20000,
        9923 + index,
        SIDE_BY_SIDE_PIECES,
        9,
      )) {
        const position: string = text + ending;
        const expected: ReturnType<typeof sideBySideAsThePatternReadIt> =
          sideBySideAsThePatternReadIt(position);

        if (expected) {
          read++;
        }

        if (
          JSON.stringify(readSideBySideSymbol(position)) !==
          JSON.stringify(expected)
        ) {
          differences.push(JSON.stringify(position));
        }
      }
    }

    expect(differences.slice(0, 20)).toEqual([]);
    expect(read).toBeGreaterThan(20000);
  });

  test("the positions KSCrash writes", () => {
    expect(readSideBySideSymbol("0x102a20000 + 181720 (main + 52)")).toEqual({
      before: "0x102a20000 + 181720",
      symbol: "main",
      offset: "52",
    });
    expect(
      readSideBySideSymbol("MyApp + 6948 (-[UIApplication sendEvent:] + 120)"),
    ).toEqual({
      before: "MyApp + 6948",
      symbol: "-[UIApplication sendEvent:]",
      offset: "120",
    });
    // The first "(" white space leads to opens the symbol.
    expect(readSideBySideSymbol("a (b (c + 1)")).toEqual({
      before: "a",
      symbol: "b (c",
      offset: "1",
    });
    expect(readSideBySideSymbol("0x102a20000 + 181720")).toBeNull();
    expect(readSideBySideSymbol("x (main + 123456789012345678901)")).toBeNull();
  });

  test("a frame line reads its symbol and position as before", () => {
    expect(
      readAppleFrameLine(
        "0   MyApp\t0x0000000102a4c5d8 0x102a20000 + 181720 (main + 52)",
        3,
      ),
    ).toEqual({
      index: 0,
      binaryName: "MyApp",
      offset: 181720,
      address: 0x0000000102a4c5d8,
      loadAddress: 0x102a20000,
      symbol: "main",
      symbolOffset: 52,
      lineIndex: 3,
    });
    expect(
      readAppleFrameLine(
        "1   UIKitCore   UIKitCore + 6948 (UIApplicationMain + 4)",
        4,
      ),
    ).toEqual({
      index: 1,
      binaryName: "UIKitCore",
      offset: 6948,
      address: null,
      loadAddress: null,
      symbol: "UIApplicationMain",
      symbolOffset: 4,
      lineIndex: 4,
    });
  });
});

const SLOW_IMAGE_LINES: Array<[string, string]> = [
  [
    "two long runs of white space and no UUID after them",
    "0x1 - 0x2 a" +
      repeat(" ", LENGTH / 2) +
      "b" +
      repeat(" ", LENGTH / 2) +
      "c",
  ],
  [
    "a long run of white space before a line separator after the UUID",
    `0x1 - 0x2 MyApp arm64 <${UUID}>` +
      repeat("\t", LENGTH) +
      `y${LINE_SEPARATOR}x`,
  ],
  [
    "a UUID after every word, and a line separator at the end",
    "0x1 - 0x2 " + repeat(`a <${UUID}> `, LENGTH) + `${LINE_SEPARATOR}x`,
  ],
  [
    "a drawn line with two long runs and no UUID",
    "a" + repeat(" ", LENGTH / 2) + "b" + repeat(" ", LENGTH / 2) + "c>",
  ],
  ["a run of UUID characters", `a <${repeat("a", LENGTH)}>`],
];

const SLOW_POSITIONS: Array<[string, string]> = [
  [
    "two long runs of white space and no symbol",
    "a" + repeat(" ", LENGTH / 2) + "b" + repeat(" ", LENGTH / 2) + "c",
  ],
  [
    "a long run of white space before every word, and an offset at the end",
    repeat("a ", LENGTH) + " + 1)",
  ],
  [
    "an opening parenthesis after every space, and a line separator in the symbol",
    repeat(" (x", LENGTH) + `${LINE_SEPARATOR} + 1)`,
  ],
  [
    "a line separator before them all",
    `${LINE_SEPARATOR}x` + repeat(" (x", LENGTH) + " + 1)",
  ],
];

describe("a long line is read quickly", () => {
  test.each(SLOW_IMAGE_LINES)(
    "an image line: %s",
    (_label: string, line: string) => {
      expect(
        timeOf(() => {
          readAppleImageLine(line);
        }),
      ).toBeLessThan(2000);
    },
  );

  test.each(SLOW_POSITIONS)(
    "a side-by-side symbol: %s",
    (_label: string, position: string) => {
      expect(
        timeOf(() => {
          readSideBySideSymbol(position);
        }),
      ).toBeLessThan(2000);
    },
  );

  test.each(SLOW_POSITIONS)(
    "a frame line: %s",
    (_label: string, position: string) => {
      expect(
        timeOf(() => {
          readAppleFrameLine(`0   MyApp   ${position}`, 0);
        }),
      ).toBeLessThan(2000);
    },
  );

  test.each(SLOW_IMAGE_LINES)(
    "a whole report, its image line: %s",
    (_label: string, line: string) => {
      const report: string = [
        "Thread 0 Crashed:",
        "0   MyApp\t0x0000000102a4c5d8 0x102a20000 + 181720",
        "",
        "Binary Images:",
        line,
      ].join("\n");

      expect(
        timeOf(() => {
          parseAppleCrashReport(report);
        }),
      ).toBeLessThan(2000);

      // The report is read, its frames all the same.
      const parsed: AppleCrashReport | null = parseAppleCrashReport(report);

      expect(parsed?.threads[0]?.frames).toHaveLength(1);
    },
  );
});
