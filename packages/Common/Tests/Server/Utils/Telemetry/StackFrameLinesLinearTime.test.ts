import StackTraceParser, {
  ParsedStackTrace,
} from "../../../../Server/Utils/Telemetry/StackTraceParser";
import {
  FrameLineMatch,
  readCSharpFrameWithFile,
  readPhpFrame,
  readPythonFrame,
  readRubyFrame,
  readV8EvalFrame,
  readV8FrameWithParens,
  readV8FrameWithParensNoColumn,
  readV8FrameWithoutParens,
} from "../../../../Server/Utils/Telemetry/StackFrameLines";
import { generatedTexts } from "../../../Helpers/GeneratedTexts";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * A STACK TRACE IS READ IN TIME IN LINE WITH ITS LENGTH, FRAME FOR FRAME AS
 * BEFORE.
 *
 * Every exception an application sends at ingest - a span's
 * exception.stacktrace (as long as the request carrying it), a log's
 * exception attributes, an ERROR log's body - is parsed into frames, every
 * line by every language's patterns. Those patterns matched a lazy group
 * after a run of white space the group could also take, and tried every way
 * to split a line between them: one line of 4,000 characters built for it
 * took close to a minute. StackFrameLines reads a line a fixed number of
 * times and finds exactly what each pattern found.
 * ---------------------------------------------------------------------------
 */

const LENGTH: number = 400000;

const repeat: (unit: string, length: number) => string = (
  unit: string,
  length: number,
): string => {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
};

const timeOf: (run: () => unknown) => number = (run: () => unknown): number => {
  const startedAt: number = Date.now();
  run();
  return Date.now() - startedAt;
};

const HALF: number = LENGTH / 2;
const LINE_SEPARATOR: string = String.fromCharCode(0x2028);

// One line each, built so the pattern it was read with before tried every split.
const WORST_LINES: Array<[string, string]> = [
  ["at, tabs, then (:0:0)", "at\t" + repeat("\t", LENGTH) + "(:0:0)"],
  ["at, tabs, then (:0)", "at\t" + repeat("\t", LENGTH) + "(:0)"],
  ["at, tabs, then a", "at\t" + repeat("\t", LENGTH) + "a"],
  ["at x, then tab-( pairs", "at x" + repeat("\t(", LENGTH) + "x"],
  ["at x, then :1 pairs", "at x" + repeat(":1", LENGTH) + "x"],
  [
    "an eval frame with a run of tabs",
    "at\teval\t(eval\tat\t" + repeat("\t", LENGTH) + "\teval\t(eval",
  ],
  ["an eval frame with space-( pairs", "at eval (eval at x" + repeat(" (", LENGTH)],
  [
    "an eval frame with a location after every paren",
    "at eval (eval at x" + repeat(" (\r:1:2)", LENGTH),
  ],
  [
    "a Python file with candidates before a line separator",
    'File "x' + repeat('",\tline\t0,\tin\tx', LENGTH) + "\rz",
  ],
  ["a Python file with a run of tabs", 'File\t"\u0000",\tline\t0,\tin\t' + repeat("\t", LENGTH) + 'e",'],
  ["Ruby candidates with no closing quote", "x" + repeat(":0:in `x", LENGTH) + "z"],
  ["Ruby with a run of digits", repeat(":0", LENGTH)],
  ["C# with in after in", "at x" + repeat(" in x", LENGTH) + "z"],
  [
    "C# with tabs around an n",
    "at\t" + repeat("\t", HALF) + "n" + repeat("\t", HALF) + "in\tx",
  ],
  ["PHP candidates before a line separator", "#0 x" + repeat("(0):\t", LENGTH) + "\rz"],
  [
    "PHP with tabs around a location",
    "#0\t" + repeat("\t", HALF) + "(0):\t" + repeat("\t", HALF) + LINE_SEPARATOR,
  ],
  ["Go file names", repeat(".go:1 ", LENGTH)],
  ["browser frames", repeat("a@", LENGTH)],
];

// The patterns as they were: the references the readers must agree with.
interface Reader {
  name: string;
  read: (line: string) => FrameLineMatch | null;
  before: RegExp;
  // Pieces lines are drawn from, and frames they are drawn around.
  alphabet: ReadonlyArray<string>;
  frames: ReadonlyArray<string>;
}

const WHITE_SPACE_PIECES: ReadonlyArray<string> = [
  " ",
  "\t",
  "\r",
  "\n",
  LINE_SEPARATOR,
  "\u2029",
  "\u00a0",
  "\u000b",
  "\ufeff",
  "\u3000",
];

const COMMON_PIECES: ReadonlyArray<string> = [
  ...WHITE_SPACE_PIECES,
  ...WHITE_SPACE_PIECES,
  "x",
  "y",
  "1",
  "23",
  ":",
  "(",
  ")",
  ".",
  "/",
];

const READERS: ReadonlyArray<Reader> = [
  {
    name: "a V8 eval frame",
    read: readV8EvalFrame,
    before: /^at\s+eval\s+\(eval\s+at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/,
    alphabet: [...COMMON_PIECES, "eval", "(eval", "at", ":1:2)", ":3:", " (", "\t("],
    frames: [
      "at eval (eval at foo (/app/x.js:1:2)",
      "at  eval (eval  at   ( (x:1:2)",
      "at eval (eval at \t (y (/a b:3:4)) tail",
      "at eval (eval at run (/app/src/z.js:1:2), <anonymous>:1:1)",
    ],
  },
  {
    name: "a V8 frame with a name and a column",
    read: readV8FrameWithParens,
    before: /^at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)$/,
    alphabet: [...COMMON_PIECES, "at", ":1:2)", ":12:", " (", "\t(", "  ("],
    frames: [
      "at foo (/app/x.js:1:2)",
      "at   (x:1:2)",
      "at \t (a (b:12:34)",
      "at foo bar (baz (q:1:2)",
      "at Object.<anonymous> (C:\\app\\index.js:10:15)",
    ],
  },
  {
    name: "a V8 frame with a name and no column",
    read: readV8FrameWithParensNoColumn,
    before: /^at\s+(.+?)\s+\((.+?):(\d+)\)$/,
    alphabet: [...COMMON_PIECES, "at", ":1)", ":12", " (", "\t(", "  ("],
    frames: ["at foo (/app/x.js:1)", "at   (x:1)", "at \t (a (b:12)"],
  },
  {
    name: "a V8 frame with no name",
    read: readV8FrameWithoutParens,
    before: /^at\s+(.+?):(\d+):(\d+)$/,
    alphabet: [...COMMON_PIECES, "at", ":1:2", ":12:", ":3"],
    frames: ["at /app/x.js:1:2", "at  :1:2", "at x:1:2:3", "at \r :1:2"],
  },
  {
    name: "a Python frame",
    read: readPythonFrame,
    before: /^File\s+"(.+?)",\s+line\s+(\d+)(?:,\s+in\s+(.+))?$/,
    alphabet: [
      ...COMMON_PIECES,
      '"',
      '",',
      "line",
      " line ",
      "in",
      ", in ",
      ",",
      "File",
      '", line 3',
      ", in x",
    ],
    frames: [
      'File "/app/a.py", line 3, in main',
      'File "x", line 1',
      'File "a", line 2, in  ',
      'File "a", line 2, in \t',
      'File "a", line 2", line 4, in b',
    ],
  },
  {
    name: "a Ruby frame",
    read: readRubyFrame,
    before: /^(.+?):(\d+):in\s+[`'](.+?)'$/,
    alphabet: [...COMMON_PIECES, ":in", ":1:in `", ":2:in '", "'", "`", "in", ":3:in\t'"],
    frames: [
      "/app/a.rb:12:in `block in run'",
      "a:1:in 'b'",
      "x:1:in  `y:2:in 'z'",
      "a:b:1:in ``'",
    ],
  },
  {
    name: "a C# frame with a file",
    read: readCSharpFrameWithFile,
    before: /^at\s+(.+?)\s+in\s+(.+?):line\s+(\d+)$/,
    alphabet: [...COMMON_PIECES, "in", " in ", "\tin\t", ":line", ":line ", ":line 4", "line"],
    frames: [
      "at A.B() in /x.cs:line 4",
      "at   in  x:line 4",
      "at a in in b:line 1",
      "at a in  :line 1",
      "at App.Service.Run() in C:\\src\\Service.cs:line 42",
    ],
  },
  {
    name: "a PHP frame",
    read: readPhpFrame,
    before: /^#\d+\s+(.+?)\((\d+)\):\s+(.+)$/,
    alphabet: [...COMMON_PIECES, "(1):", "(12): ", "):", "#", "(3):\t"],
    frames: ["#0 /a.php(12): A->b()", "#1  (2): x", "#0 x(1):  ", "#0 a(1): b(2): c"],
  },
];

// What exec gave back, as a plain array (null when it found nothing).
const execBefore: (pattern: RegExp, line: string) => FrameLineMatch | null = (
  pattern: RegExp,
  line: string,
): FrameLineMatch | null => {
  const match: RegExpExecArray | null = new RegExp(pattern.source).exec(line);

  return match ? Array.from(match) : null;
};

// A frame with a few pieces put in, taken out or written over.
const mutated: (
  frame: string,
  alphabet: ReadonlyArray<string>,
  random: SeededRandom,
) => string = (
  frame: string,
  alphabet: ReadonlyArray<string>,
  random: SeededRandom,
): string => {
  let line: string = frame;
  const changes: number = 1 + random(4);

  for (let change: number = 0; change < changes; change++) {
    const at: number = random(line.length + 1);
    const piece: string = alphabet[random(alphabet.length)]!;
    const kind: number = random(4);

    if (kind < 2) {
      line = line.slice(0, at) + piece + line.slice(at);
    } else if (kind === 2) {
      line = line.slice(0, at) + line.slice(at + 1);
    } else {
      line = line.slice(0, at) + piece + line.slice(at + 1);
    }
  }

  return line;
};

describe("a line built to be slow is read quickly", () => {
  test.each(WORST_LINES)(
    "%s, parsed as a whole trace",
    (_label: string, line: string) => {
      let parsed: ParsedStackTrace | undefined;

      expect(
        timeOf(() => {
          parsed = StackTraceParser.parse(line);
        }),
      ).toBeLessThan(2000);
      expect(parsed!.raw).toBe(line);
    },
  );

  test.each(WORST_LINES)(
    "%s, read by every frame reader",
    (_label: string, line: string) => {
      for (const reader of READERS) {
        expect({
          reader: reader.name,
          fast: timeOf(() => {
            reader.read(line);
          }) < 2000,
        }).toEqual({ reader: reader.name, fast: true });
      }
    },
  );

  test("a long trace of real frames among built lines keeps every real frame", () => {
    const trace: string = [
      "Error: boom",
      "    at handler (/app/src/handler.js:10:5)",
      "at\t" + repeat("\t", LENGTH) + "a",
      "    at /app/src/index.js:3:1",
    ].join("\n");

    let parsed: ParsedStackTrace | undefined;

    expect(
      timeOf(() => {
        parsed = StackTraceParser.parse(trace);
      }),
    ).toBeLessThan(2000);
    expect(parsed!.frames).toEqual([
      {
        functionName: "handler",
        fileName: "/app/src/handler.js",
        lineNumber: 10,
        columnNumber: 5,
        inApp: true,
      },
      {
        functionName: "<anonymous>",
        fileName: "/app/src/index.js",
        lineNumber: 3,
        columnNumber: 1,
        inApp: true,
      },
    ]);
  });
});

describe.each(READERS)("$name is found exactly as before", (reader: Reader) => {
  test("on the frames it is written for, and their edge cases", () => {
    for (const frame of reader.frames) {
      expect({ frame, match: reader.read(frame) }).toEqual({
        frame,
        match: execBefore(reader.before, frame),
      });
      expect(reader.read(frame)).not.toBeNull();
    }
  });

  test("on twenty thousand lines drawn from its pieces", () => {
    const differences: Array<string> = [];

    for (const line of generatedTexts(20000, 7919, reader.alphabet, 14)) {
      const expected: FrameLineMatch | null = execBefore(reader.before, line);
      const actual: FrameLineMatch | null = reader.read(line);

      if (JSON.stringify(expected) !== JSON.stringify(actual)) {
        differences.push(JSON.stringify(line));
      }
    }

    expect(differences).toEqual([]);
  });

  test("on twenty thousand frames with pieces put in, taken out or written over", () => {
    const random: SeededRandom = seededRandom(104729);
    const differences: Array<string> = [];
    let matched: number = 0;

    for (let index: number = 0; index < 20000; index++) {
      const line: string = mutated(
        reader.frames[random(reader.frames.length)]!,
        reader.alphabet,
        random,
      );
      const expected: FrameLineMatch | null = execBefore(reader.before, line);
      const actual: FrameLineMatch | null = reader.read(line);

      if (expected) {
        matched++;
      }

      if (JSON.stringify(expected) !== JSON.stringify(actual)) {
        differences.push(JSON.stringify(line));
      }
    }

    expect(differences).toEqual([]);
    // The drawn lines hold matches enough to compare what was matched.
    expect(matched).toBeGreaterThan(1000);
  });
});

describe("what the patterns did when they gave white space back", () => {
  test("a V8 name that is one character of the white space after 'at'", () => {
    expect(readV8FrameWithParens("at \t (x:1:2)")).toEqual([
      "at \t (x:1:2)",
      "\t",
      "x",
      "1",
      "2",
    ]);
    expect(readV8FrameWithParens("at \r (x:1:2)")).toBeNull();
    expect(readV8FrameWithParens("at  \r (x:1:2)")).toEqual(
      execBefore(/^at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)$/, "at  \r (x:1:2)"),
    );
  });

  test("a V8 file that is the last character of the white space after 'at'", () => {
    expect(readV8FrameWithoutParens("at  :1:2")).toEqual([
      "at  :1:2",
      " ",
      "1",
      "2",
    ]);
    expect(readV8FrameWithoutParens("at :1:2")).toBeNull();
    expect(readV8FrameWithoutParens("at \r:1:2")).toBeNull();
  });

  test("a group never holds a line terminator, while a run of white space may", () => {
    expect(readV8FrameWithParens("at a\r (x:1:2)")).toEqual([
      "at a\r (x:1:2)",
      "a",
      "x",
      "1",
      "2",
    ]);
    expect(readV8FrameWithParens("at a\rb (x:1:2)")).toBeNull();
    expect(readV8FrameWithParens("at a (x\r:1:2)")).toBeNull();
  });

  test("a PHP file, Python function and C# file given one character back", () => {
    expect(readPhpFrame("#0  (2): x")).toEqual(["#0  (2): x", " ", "2", "x"]);
    expect(readPythonFrame('File "a", line 2, in  ')).toEqual([
      'File "a", line 2, in  ',
      "a",
      "2",
      " ",
    ]);
    expect(readCSharpFrameWithFile("at a in  :line 1")).toEqual([
      "at a in  :line 1",
      "a",
      " ",
      "1",
    ]);
  });
});
