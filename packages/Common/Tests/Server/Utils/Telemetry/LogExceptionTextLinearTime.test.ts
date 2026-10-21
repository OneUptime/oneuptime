import LogExceptionExtractor, {
  ExtractedLogException,
} from "../../../../Server/Utils/Telemetry/LogExceptionExtractor";
import {
  looksLikeStackTrace,
  readAfterGoPanic,
  readAfterJavaThreadPrefix,
  readQualifiedTypeLine,
} from "../../../../Server/Utils/Telemetry/LogExceptionText";
import { generatedTexts } from "../../../Helpers/GeneratedTexts";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import { fastestRun } from "../../../Helpers/FastestRun";
import { describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * AN ERROR LOG'S BODY IS READ IN TIME IN LINE WITH ITS LENGTH, AND SAYS
 * WHAT IT SAID BEFORE.
 *
 * Every ERROR log an application sends is asked whether its body looks like
 * a stack trace and, when it does, what type and message its first line
 * names. The patterns that asked read one run again from each of its
 * characters: a run of line breaks before "at", a dotted name with no
 * "Error" in it, the white space before a message that holds a line
 * separator. A 4,000-character first line took seconds; the body is cut to
 * 16 KB first, which made it minutes. LogExceptionText reads it a fixed
 * number of times and answers exactly as each pattern did.
 * ---------------------------------------------------------------------------
 */

const LENGTH: number = 400000;

// How much of a body the extractor reads.
const BODY_LENGTH: number = 16 * 1024;

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

const LINE_SEPARATOR: string = String.fromCharCode(0x2028);
const HALF: number = LENGTH / 2;

// The patterns as they were: the references the readers must agree with.
const LOOKS_LIKE_STACK_TRACE_BEFORE: RegExp =
  /(?:Traceback \(most recent call last\)|\n\s+at\s+.+:\d+|\bpanic:\s|goroutine\s+\d+\s+\[|\n\s*File\s+"[^"]+",\s+line\s+\d+|(?:^|\n)[^@:\n]{0,256}@[A-Za-z][A-Za-z0-9+.-]{0,31}:[^\s]{1,2048}:\d{1,9}|\b[A-Za-z_][\w.$]*(?:Exception|Error)\b)/;
const JAVA_THREAD_PREFIX_BEFORE: RegExp =
  /^Exception in thread\s+"[^"]*"\s+(.*)$/;
const GO_PANIC_BEFORE: RegExp = /^panic:\s*(.*)$/;
const QUALIFIED_TYPE_BEFORE: RegExp =
  /^([A-Za-z_][\w.$]*\.[A-Za-z_][\w.$]*):\s*(.*)$/;

const ERROR_LOG: (body: string) => ExtractedLogException | null = (
  body: string,
): ExtractedLogException | null => {
  return LogExceptionExtractor.extractFromLogRecord({
    body: body,
    attributes: {},
    severityNumber: 17,
    hasTraceAndSpan: false,
  });
};

// A frame the body ends with, so the extractor goes on to read its first line.
const FRAME: string = "\n    at handler (/app/src/handler.js:10:5)";

describe("text built to be slow is read quickly", () => {
  test.each([
    ["a run of line breaks", repeat("\n", LENGTH) + "x"],
    ["line breaks before an indented at", repeat("\n at x", LENGTH)],
    ["a dotted name with no Error in it", "r." + repeat("E.", LENGTH)],
    ["Python file frames with no closing quote", repeat('\nFile "', LENGTH)],
    ["line breaks and tabs", repeat("\n\t", LENGTH) + "at"],
  ])("whether %s looks like a stack trace", (_label: string, text: string) => {
    expect(
      timeOf(() => {
        looksLikeStackTrace(text);
      }),
    ).toBeLessThan(2000);
  });

  test.each([
    [
      "a Go panic with tabs before a line separator",
      (): unknown => {
        return readAfterGoPanic(
          "panic:" + repeat("\t", LENGTH) + "y" + LINE_SEPARATOR + "x",
        );
      },
    ],
    [
      "a Java thread name with tabs before a line separator",
      (): unknown => {
        return readAfterJavaThreadPrefix(
          'Exception in thread "x"' +
            repeat("\t", LENGTH) +
            "y" +
            LINE_SEPARATOR +
            "x",
        );
      },
    ],
    [
      "a dotted type with tabs before a line separator",
      (): unknown => {
        return readQualifiedTypeLine(
          "A" +
            repeat(".A", HALF) +
            ":" +
            repeat("\t", HALF) +
            "y" +
            LINE_SEPARATOR +
            "x",
        );
      },
    ],
    [
      "a dotted type with no message",
      (): unknown => {
        return readQualifiedTypeLine(
          "A" + repeat(".A", LENGTH) + ":y" + LINE_SEPARATOR + "x",
        );
      },
    ],
  ])("the first line of %s", (_label: string, read: () => unknown) => {
    expect(timeOf(read)).toBeLessThan(2000);
  });

  test.each([
    [
      "a dotted type",
      "A" +
        repeat(".A", 3000) +
        ":" +
        repeat("\t", 3000) +
        "y" +
        LINE_SEPARATOR +
        "x" +
        FRAME,
    ],
    [
      "a Go panic",
      "panic:" + repeat("\t", 12000) + "y" + LINE_SEPARATOR + "x" + FRAME,
    ],
    [
      "a Java thread",
      'Exception in thread "x"' +
        repeat("\t", 12000) +
        "y" +
        LINE_SEPARATOR +
        "x" +
        FRAME,
    ],
    ["line breaks before a frame", repeat("\n", BODY_LENGTH - 64) + FRAME],
  ])(
    "an ERROR log whose body starts with %s, read whole by the extractor",
    (_label: string, body: string) => {
      expect(body.length).toBeLessThanOrEqual(BODY_LENGTH);

      let extracted: ExtractedLogException | null = null;

      expect(
        timeOf(() => {
          extracted = ERROR_LOG(body);
        }),
      ).toBeLessThan(2000);
      // The frame at the end of the body is found.
      expect(extracted).not.toBeNull();
      expect(JSON.parse(extracted!.parsedFrames)).toContainEqual({
        functionName: "handler",
        fileName: "/app/src/handler.js",
        lineNumber: 10,
        columnNumber: 5,
        inApp: true,
      });
    },
  );

  test("an exception's stack trace attribute of the longest a log keeps", () => {
    const stackTrace: string = "at\t" + repeat("\t", 64 * 1024) + "(:0:0)";
    let extracted: ExtractedLogException | null = null;

    expect(
      timeOf(() => {
        extracted = LogExceptionExtractor.extractFromLogRecord({
          body: "",
          attributes: {
            "exception.type": "Error",
            "exception.stacktrace": stackTrace,
          },
          severityNumber: 9,
          hasTraceAndSpan: false,
        });
      }),
    ).toBeLessThan(2000);
    expect(extracted!.exceptionType).toBe("Error");
  });
});

describe("the readers answer exactly as the patterns did", () => {
  const PIECES: ReadonlyArray<string> = [
    " ",
    "\t",
    "\r",
    "\n",
    "\n",
    "\n ",
    "\n\t",
    LINE_SEPARATOR,
    "\u2029",
    "\u00a0",
    "\u000b",
    "at",
    " at ",
    "x",
    "y",
    "1",
    ":",
    ":1",
    ":x",
    ".",
    "$",
    "_",
    "E",
    "Error",
    "Exception",
    "TypeError",
    "a.b",
    ".Error",
    "File",
    ' "',
    '"',
    '",',
    " line ",
    "line",
    "panic:",
    "goroutine 1 [",
    "Traceback (most recent call last)",
    "@",
    "a@https://x/y.js:1:2",
    "Exception in thread",
    ' "main" ',
    "java.lang.X",
    "A.B:",
    "-",
    "é",
    "\u212a",
  ];

  const SEEDS: ReadonlyArray<string> = [
    "TypeError: x is undefined\n    at foo (/app/a.js:1:2)",
    'Exception in thread "main" java.lang.IllegalStateException: boom\n\tat com.acme.A.b(A.java:5)',
    "panic: runtime error\n\ngoroutine 1 [running]:\nmain.main()\n\t/app/main.go:12 +0x1d",
    'Traceback (most recent call last):\n  File "/app/a.py", line 3, in main\nValueError: bad',
    "com.acme.FooException: oops\n  at x:1:2",
    "handleSubmit@https://app.example.com/a.js:1:98217\n@https://example.com/b.js:2:3",
    "\n\n at :1",
    'x.y: z\n  File "a", line 1',
    'Exception in thread "a" b.c: d',
    "panic:\t\u2028",
    "a.B: c",
  ];

  // Texts drawn from the pieces, and the seeds with pieces put in, taken out or written over.
  const drawnTexts: () => Array<string> = (): Array<string> => {
    const random: SeededRandom = seededRandom(65537);
    const texts: Array<string> = generatedTexts(20000, 271828, PIECES, 16);

    for (let index: number = 0; index < 20000; index++) {
      let text: string = SEEDS[random(SEEDS.length)]!;
      const changes: number = random(5);

      for (let change: number = 0; change < changes; change++) {
        const at: number = random(text.length + 1);
        const piece: string = PIECES[random(PIECES.length)]!;
        const kind: number = random(4);

        if (kind < 2) {
          text = text.slice(0, at) + piece + text.slice(at);
        } else if (kind === 2) {
          text = text.slice(0, at) + text.slice(at + 1);
        } else {
          text = text.slice(0, at) + piece + text.slice(at + 1);
        }
      }

      texts.push(text);
    }

    return texts;
  };

  const TEXTS: Array<string> = drawnTexts();

  test("whether a body looks like a stack trace", () => {
    const differences: Array<string> = [];
    let yes: number = 0;

    for (const text of TEXTS) {
      const expected: boolean = LOOKS_LIKE_STACK_TRACE_BEFORE.test(text);

      if (expected) {
        yes++;
      }

      if (looksLikeStackTrace(text) !== expected) {
        differences.push(JSON.stringify(text));
      }
    }

    expect(differences).toEqual([]);
    expect(yes).toBeGreaterThan(5000);
    expect(TEXTS.length - yes).toBeGreaterThan(5000);
  });

  test("what follows a Java thread name, a Go panic and a dotted type", () => {
    const differences: Array<string> = [];
    const found: { java: number; panic: number; qualified: number } = {
      java: 0,
      panic: 0,
      qualified: 0,
    };

    for (const text of TEXTS) {
      const java: RegExpMatchArray | null = text.match(
        JAVA_THREAD_PREFIX_BEFORE,
      );
      const panic: RegExpMatchArray | null = text.match(GO_PANIC_BEFORE);
      const qualified: RegExpMatchArray | null = text.match(
        QUALIFIED_TYPE_BEFORE,
      );

      found.java += java ? 1 : 0;
      found.panic += panic ? 1 : 0;
      found.qualified += qualified ? 1 : 0;

      if (
        readAfterJavaThreadPrefix(text) !== (java ? java[1] : null) ||
        readAfterGoPanic(text) !== (panic ? panic[1] : null) ||
        JSON.stringify(readQualifiedTypeLine(text)) !==
          JSON.stringify(
            qualified ? { type: qualified[1], message: qualified[2] } : null,
          )
      ) {
        differences.push(JSON.stringify(text));
      }
    }

    expect(differences).toEqual([]);
    // Each pattern matched often enough among the drawn texts to compare.
    expect(found.java).toBeGreaterThan(200);
    expect(found.panic).toBeGreaterThan(200);
    expect(found.qualified).toBeGreaterThan(200);
  });

  test("the first lines each language writes", () => {
    expect(
      readAfterJavaThreadPrefix(
        'Exception in thread "main" java.lang.IllegalStateException: boom',
      ),
    ).toBe("java.lang.IllegalStateException: boom");
    expect(readAfterGoPanic("panic: runtime error: index out of range")).toBe(
      "runtime error: index out of range",
    );
    expect(readAfterGoPanic("panic:")).toBe("");
    expect(readQualifiedTypeLine("com.acme.FooException: it broke")).toEqual({
      type: "com.acme.FooException",
      message: "it broke",
    });
    // A line separator in what follows: the patterns found nothing.
    expect(readAfterGoPanic("panic: a" + LINE_SEPARATOR + "b")).toBeNull();
    expect(readQualifiedTypeLine("a.B: c" + LINE_SEPARATOR + "d")).toBeNull();
    // ...while one in the white space before it was white space.
    expect(readAfterGoPanic("panic:" + LINE_SEPARATOR + "b")).toBe("b");
  });
});
