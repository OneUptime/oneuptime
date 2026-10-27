import { describe, expect, test } from "@jest/globals";
import BadDataException from "../../../Types/Exception/BadDataException";
import {
  MAX_VIDEO_CALL_TRANSCRIPT_CHARACTERS,
  MAX_VIDEO_CALL_TRANSCRIPT_INPUT_CHARACTERS,
  MAX_VIDEO_CALL_TRANSCRIPT_LINES,
} from "../../../Types/VideoCall/VideoCallTranscript";
import TranscriptText, {
  MAX_REMARK_LENGTH,
  MERGED_REMARK_LENGTH,
  PreparedTranscript,
  TranscriptLine,
  TranscriptSourceFormat,
} from "../../../Utils/VideoCall/TranscriptText";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * A call's transcript arrives as whatever a meeting tool saved - WebVTT
 * from Zoom or Microsoft Teams, SRT, text a person pasted - and becomes
 * remarks: who spoke, when, and what they said. These pin each format the
 * parser reads (in the shapes those tools really write), the stored format
 * that reads back exactly, the limits a person is told about, and that the
 * text - a file anyone could have written - is read in time that grows with
 * its length alone.
 */

const ZOOM_VTT: string = [
  "WEBVTT",
  "",
  "1",
  "00:00:05.120 --> 00:00:09.300",
  "Priya Shah: Checkout has been timing out since the 14:05 deploy.",
  "",
  "2",
  "00:00:10.000 --> 00:00:14.000",
  "Sam Lee: I see the database pool at a hundred percent.",
  "",
  "3",
  "00:01:20.500 --> 00:01:24.000",
  "Priya Shah: The pool maxes at 50 and we just went to 100 workers.",
  "",
].join("\n");

const TEAMS_VTT: string = [
  "WEBVTT",
  "",
  "8f2c4a1e-1111-4a2b-9c3d-000000000001/12-0",
  "00:00:03.520 --> 00:00:05.320",
  "<v Priya Shah>Okay, checkout is down.</v>",
  "",
  "8f2c4a1e-1111-4a2b-9c3d-000000000001/13-0",
  "00:00:05.400 --> 00:00:07.000",
  "<v Priya Shah>Who is looking at the database?</v>",
  "",
  "8f2c4a1e-1111-4a2b-9c3d-000000000002/1-0",
  "00:00:09.000 --> 00:00:12.000",
  "<v Sam Lee>I am. The pool is full.</v>",
  "",
].join("\n");

const SRT: string = [
  "1",
  "00:00:01,000 --> 00:00:04,000",
  "Priya Shah: Rolling back the worker change.",
  "",
  "2",
  "00:00:30,000 --> 00:00:33,500",
  "Sam Lee: Latency is back to normal.",
  "",
].join("\n");

function texts(lines: Array<TranscriptLine>): Array<string> {
  return lines.map((line: TranscriptLine): string => {
    return line.text;
  });
}

function expectBadData(run: () => unknown, message: RegExp): void {
  let thrown: unknown = null;

  try {
    run();
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(BadDataException);
  expect((thrown as Error).message).toMatch(message);
}

describe("TranscriptText.detectFormat", () => {
  test("a file that starts WEBVTT is WebVTT, BOM or not", () => {
    expect(TranscriptText.detectFormat(ZOOM_VTT)).toBe(
      TranscriptSourceFormat.WebVTT,
    );
    expect(TranscriptText.detectFormat(`\uFEFF${ZOOM_VTT}`)).toBe(
      TranscriptSourceFormat.WebVTT,
    );
  });

  test("numbered cues with comma times are SRT", () => {
    expect(TranscriptText.detectFormat(SRT)).toBe(TranscriptSourceFormat.SRT);
  });

  test("anything else is text", () => {
    expect(
      TranscriptText.detectFormat("Priya: hello\nSam: the pool is full"),
    ).toBe(TranscriptSourceFormat.Text);
    expect(TranscriptText.detectFormat("")).toBe(TranscriptSourceFormat.Text);
  });
});

describe("TranscriptText.parse - WebVTT", () => {
  test("Zoom's cues: the speaker before the colon, the time of each cue", () => {
    const lines: Array<TranscriptLine> = TranscriptText.parse(ZOOM_VTT);

    expect(lines).toEqual([
      {
        offsetInSeconds: 5.12,
        speaker: "Priya Shah",
        text: "Checkout has been timing out since the 14:05 deploy.",
      },
      {
        offsetInSeconds: 10,
        speaker: "Sam Lee",
        text: "I see the database pool at a hundred percent.",
      },
      {
        offsetInSeconds: 80.5,
        speaker: "Priya Shah",
        text: "The pool maxes at 50 and we just went to 100 workers.",
      },
    ]);
  });

  test("Microsoft Teams' cues: the speaker from the voice span, the cue ids dropped", () => {
    const lines: Array<TranscriptLine> = TranscriptText.parse(TEAMS_VTT);

    expect(
      lines.map((line: TranscriptLine) => {
        return [line.speaker, line.text];
      }),
    ).toEqual([
      ["Priya Shah", "Okay, checkout is down."],
      ["Priya Shah", "Who is looking at the database?"],
      ["Sam Lee", "I am. The pool is full."],
    ]);
  });

  test("a voice span with classes, styling spans and inline times are read for their words", () => {
    const lines: Array<TranscriptLine> = TranscriptText.parse(
      [
        "WEBVTT",
        "",
        "00:00:01.000 --> 00:00:03.000 align:start position:10%",
        "<v.loud.slow Esme Ruiz><c.yellow>Never</c> <00:00:01.500><i>drink</i> &amp; deploy &lt;on Fridays&gt;</v>",
        "",
      ].join("\n"),
    );

    expect(lines).toEqual([
      {
        offsetInSeconds: 1,
        speaker: "Esme Ruiz",
        text: "Never drink & deploy <on Fridays>",
      },
    ]);
  });

  test("a caption over several lines is one remark; NOTE, STYLE and REGION blocks are not cues", () => {
    const lines: Array<TranscriptLine> = TranscriptText.parse(
      [
        "WEBVTT - incident bridge",
        "",
        "NOTE this cue was edited",
        "00:00:00.000 --> 00:00:01.000 is not a cue in a note",
        "",
        "STYLE",
        "::cue { color: lime }",
        "",
        "REGION",
        "id:fred width:40%",
        "",
        "00:00:02.000 --> 00:00:05.000",
        "Priya Shah: The deploy at 14:05",
        "doubled the workers.",
        "",
      ].join("\n"),
    );

    expect(lines).toEqual([
      {
        offsetInSeconds: 2,
        speaker: "Priya Shah",
        text: "The deploy at 14:05 doubled the workers.",
      },
    ]);
  });

  test("Windows line endings and hour-less times are read the same", () => {
    const lines: Array<TranscriptLine> = TranscriptText.parse(
      "WEBVTT\r\n\r\n01:02.500 --> 01:04.000\r\nSam Lee: Restarting the pods.\r\n",
    );

    expect(lines).toEqual([
      {
        offsetInSeconds: 62.5,
        speaker: "Sam Lee",
        text: "Restarting the pods.",
      },
    ]);
  });

  test("a cue with no words is no remark", () => {
    expect(
      TranscriptText.parse(
        "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<i></i>\n\n00:00:03.000 --> 00:00:04.000\n\n",
      ),
    ).toEqual([]);
  });
});

describe("TranscriptText.parse - SRT", () => {
  test("numbered cues with comma times", () => {
    expect(TranscriptText.parse(SRT)).toEqual([
      {
        offsetInSeconds: 1,
        speaker: "Priya Shah",
        text: "Rolling back the worker change.",
      },
      {
        offsetInSeconds: 30,
        speaker: "Sam Lee",
        text: "Latency is back to normal.",
      },
    ]);
  });
});

describe("TranscriptText.parse - pasted text", () => {
  test("a time in brackets or before the words, and the speaker before the colon", () => {
    expect(
      TranscriptText.parse(
        "[00:12:03] Priya Shah: The pool is full.\n00:13:10 Sam Lee: Rolling back.",
      ),
    ).toEqual([
      {
        offsetInSeconds: 723,
        speaker: "Priya Shah",
        text: "The pool is full.",
      },
      { offsetInSeconds: 790, speaker: "Sam Lee", text: "Rolling back." },
    ]);
  });

  test("a Google Docs transcript: a time on its own line dates the lines after it", () => {
    const lines: Array<TranscriptLine> = TranscriptText.parse(
      [
        "Checkout incident bridge - Transcript",
        "00:00:00",
        "",
        "Priya Shah: Checkout is down.",
        "Sam Lee: The pool is full.",
        "00:05:00",
        "Priya Shah: Rolling back fixed it.",
      ].join("\n"),
    );

    expect(lines).toEqual([
      { text: "Checkout incident bridge - Transcript" },
      { offsetInSeconds: 0, speaker: "Priya Shah", text: "Checkout is down." },
      { offsetInSeconds: 0, speaker: "Sam Lee", text: "The pool is full." },
      {
        offsetInSeconds: 300,
        speaker: "Priya Shah",
        text: "Rolling back fixed it.",
      },
    ]);
  });

  test("a CJK speaker before a full-width colon", () => {
    expect(TranscriptText.parse("张伟：数据库连接池满了")).toEqual([
      { speaker: "张伟", text: "数据库连接池满了" },
    ]);
  });

  test("only a name is a speaker: not a lower-case word, a time, a link or a sentence", () => {
    const lines: Array<TranscriptLine> = TranscriptText.parse(
      [
        "note: we restarted it",
        "https://status.example.com: still red",
        "We deployed at 14:05: then it broke",
        "Dr. Smith: punctuation is not a name",
      ].join("\n"),
    );

    expect(
      lines.map((line: TranscriptLine) => {
        return line.speaker;
      }),
    ).toEqual([undefined, undefined, undefined, undefined]);
    expect(texts(lines)).toEqual([
      "note: we restarted it",
      "https://status.example.com: still red",
      "We deployed at 14:05: then it broke",
      "Dr. Smith: punctuation is not a name",
    ]);
  });

  test("a '<' that starts no tag is kept as text", () => {
    expect(
      TranscriptText.parse("Sam Lee: latency is <200ms again, a < b"),
    ).toEqual([{ speaker: "Sam Lee", text: "latency is <200ms again, a < b" }]);
  });
});

describe("TranscriptText.parseClock and formatOffset", () => {
  test.each([
    ["00:00:05.120", 5.12],
    ["1:02:03", 3723],
    ["01:02:03,500", 3723.5],
    ["12:03", 723],
    ["100:00:00", 360000],
    [" 00:00:01.000 ", 1],
  ])("%s is %d seconds", (clock: string, seconds: number) => {
    expect(TranscriptText.parseClock(clock)).toBeCloseTo(seconds, 6);
  });

  test.each([
    ["00:61:00"],
    ["00:00:60"],
    ["1:2:3"],
    ["abc"],
    ["12"],
    ["00:00:01.1234"],
    ["1:00:00:00"],
    [""],
    ["0000000000000000000:00"],
  ])("%s is no clock", (clock: string) => {
    expect(TranscriptText.parseClock(clock)).toBeNull();
  });

  test("an offset is written HH:MM:SS, whole seconds", () => {
    expect(TranscriptText.formatOffset(0)).toBe("00:00:00");
    expect(TranscriptText.formatOffset(5.9)).toBe("00:00:05");
    expect(TranscriptText.formatOffset(3723)).toBe("01:02:03");
    expect(TranscriptText.formatOffset(-4)).toBe("00:00:00");
    expect(TranscriptText.formatOffset(360000)).toBe("100:00:00");
  });

  test("a cue's timing line, and nothing else, has a start", () => {
    expect(
      TranscriptText.readCueTiming("00:00:01.000 --> 00:00:04.000 line:0"),
    ).toBe(1);
    expect(TranscriptText.readCueTiming("00:00:01.000 --> later")).toBeNull();
    expect(TranscriptText.readCueTiming("a --> b")).toBeNull();
    expect(
      TranscriptText.readCueTiming("Sam: the arrow --> is in the words"),
    ).toBeNull();
  });
});

describe("TranscriptText - remarks", () => {
  test("a speaker's consecutive cues within a minute are one remark", () => {
    const merged: Array<TranscriptLine> = TranscriptText.mergeRemarks(
      TranscriptText.parse(TEAMS_VTT),
    );

    expect(merged).toEqual([
      {
        offsetInSeconds: 3.52,
        speaker: "Priya Shah",
        text: "Okay, checkout is down. Who is looking at the database?",
      },
      {
        offsetInSeconds: 9,
        speaker: "Sam Lee",
        text: "I am. The pool is full.",
      },
    ]);
  });

  test("cues more than a minute apart, or that would make a long remark, stay apart", () => {
    const long: string = "word ".repeat(100).trim();

    expect(
      TranscriptText.mergeRemarks([
        { offsetInSeconds: 0, speaker: "A", text: "first" },
        { offsetInSeconds: 61, speaker: "A", text: "much later" },
      ]),
    ).toHaveLength(2);

    expect(
      TranscriptText.mergeRemarks([
        { offsetInSeconds: 0, speaker: "A", text: long },
        { offsetInSeconds: 1, speaker: "A", text: long },
      ]),
    ).toHaveLength(2);
    expect(long.length * 2 + 1).toBeGreaterThan(MERGED_REMARK_LENGTH);
  });

  test("lines with neither a speaker nor a time stay as they were written", () => {
    expect(
      TranscriptText.mergeRemarks([{ text: "one" }, { text: "two" }]),
    ).toEqual([{ text: "one" }, { text: "two" }]);
  });

  test("a remark longer than the longest kept is cut at words into several", () => {
    const words: string = Array.from(
      { length: 900 },
      (_: unknown, index: number) => {
        return `w${index}`;
      },
    ).join(" ");

    const split: Array<TranscriptLine> = TranscriptText.splitLongRemarks([
      { offsetInSeconds: 3, speaker: "A", text: words },
    ]);

    expect(split.length).toBeGreaterThan(1);

    for (const line of split) {
      expect(line.text.length).toBeLessThanOrEqual(MAX_REMARK_LENGTH);
      expect(line.speaker).toBe("A");
      expect(line.offsetInSeconds).toBe(3);
      // Cut between words, never inside one.
      expect(line.text.startsWith(" ")).toBe(false);
    }

    expect(
      split
        .map((line: TranscriptLine) => {
          return line.text;
        })
        .join(" "),
    ).toBe(words);
  });
});

describe("TranscriptText - the stored format", () => {
  test("reads back exactly: time, speaker and words", () => {
    const lines: Array<TranscriptLine> = [
      {
        offsetInSeconds: 723,
        speaker: "Priya Shah",
        text: "The pool is full.",
      },
      { speaker: "Sam Lee", text: "Note: this has a colon" },
      { text: "No speaker: and a colon" },
      { offsetInSeconds: 3600, text: "An hour in" },
    ];

    const stored: string = TranscriptText.serialize(lines);

    expect(stored).toBe(
      [
        "00:12:03\tPriya Shah\tThe pool is full.",
        "\tSam Lee\tNote: this has a colon",
        "\t\tNo speaker: and a colon",
        "01:00:00\t\tAn hour in",
      ].join("\n"),
    );
    expect(TranscriptText.deserialize(stored)).toEqual(lines);
  });

  test("a tab or a line break in a remark never survives into the stored text", () => {
    const stored: string = TranscriptText.serialize([
      { speaker: "A\tB", text: "one\ttwo\nthree" },
    ]);

    expect(stored).toBe("\tA B\tone two three");
    expect(TranscriptText.deserialize(stored)).toEqual([
      { speaker: "A B", text: "one two three" },
    ]);
  });

  test("a line written some other way is read as words", () => {
    expect(TranscriptText.deserialize("just words\n\n")).toEqual([
      { text: "just words" },
    ]);
    expect(TranscriptText.deserialize(undefined)).toEqual([]);
    expect(TranscriptText.deserialize("")).toEqual([]);
  });

  test("a person reads it with times and names", () => {
    expect(
      TranscriptText.toReadableText([
        { offsetInSeconds: 723, speaker: "Priya Shah", text: "Full." },
        { text: "Unknown" },
      ]),
    ).toBe("[00:12:03] Priya Shah: Full.\nUnknown");
  });
});

describe("TranscriptText.prepare", () => {
  test("a Zoom file: remarks, what to store, and its info", () => {
    const prepared: PreparedTranscript = TranscriptText.prepare({
      text: ZOOM_VTT,
      fileName:
        "C:\\Users\\priya\\Downloads\\GMT20261017-140512_Recording.transcript.vtt",
    });

    expect(prepared.format).toBe(TranscriptSourceFormat.WebVTT);
    expect(prepared.lines).toHaveLength(3);
    expect(prepared.stored.split("\n")).toHaveLength(3);
    expect(prepared.info).toEqual({
      lineCount: 3,
      speakerCount: 2,
      characterCount: prepared.lines.reduce(
        (total: number, line: TranscriptLine) => {
          return total + line.text.length;
        },
        0,
      ),
      durationInSeconds: 75,
      fileName: "GMT20261017-140512_Recording.transcript.vtt",
    });
  });

  test("a transcript with no words is refused with what to add instead", () => {
    expectBadData(() => {
      return TranscriptText.prepare({ text: "   \n\n" });
    }, /no words in it.*\.vtt, \.srt or \.txt/);
    expectBadData(() => {
      return TranscriptText.prepare({ text: "WEBVTT\n\n" });
    }, /no words in it/);
  });

  test("a file longer than what may be sent is refused before it is read", () => {
    expectBadData(() => {
      return TranscriptText.prepare({
        text: "a".repeat(MAX_VIDEO_CALL_TRANSCRIPT_INPUT_CHARACTERS + 1),
      });
    }, /too long to add: more than 2,000,000 characters/);
  });

  test("more remarks than a transcript keeps is refused", () => {
    const lines: string = Array.from(
      { length: MAX_VIDEO_CALL_TRANSCRIPT_LINES + 1 },
      (_: unknown, index: number) => {
        return `line ${index}`;
      },
    ).join("\n");

    expectBadData(() => {
      return TranscriptText.prepare({ text: lines });
    }, /more than 20,000 remarks/);
  });

  test("more talk than a transcript keeps is refused, saying about how long that is", () => {
    // 450 lines of 1,000 characters: under the line limit, over the stored one.
    const line: string = "x".repeat(999);
    const text: string = Array.from({ length: 450 }, () => {
      return line;
    }).join("\n");

    expect(text.length).toBeGreaterThan(MAX_VIDEO_CALL_TRANSCRIPT_CHARACTERS);
    expectBadData(() => {
      return TranscriptText.prepare({ text });
    }, /more than 400,000 characters of talk, about eight hours/);
  });

  test("a transcript just under the limit is kept whole", () => {
    const line: string = "y".repeat(999);
    const text: string = Array.from({ length: 390 }, () => {
      return line;
    }).join("\n");

    const prepared: PreparedTranscript = TranscriptText.prepare({ text });

    expect(prepared.lines).toHaveLength(390);
    expect(prepared.stored.length).toBeLessThanOrEqual(
      MAX_VIDEO_CALL_TRANSCRIPT_CHARACTERS,
    );
  });

  test("control characters in a pasted transcript become spaces", () => {
    const prepared: PreparedTranscript = TranscriptText.prepare({
      text: "Sam Lee: one\u0000two\u0007three",
    });

    expect(prepared.lines).toEqual([
      { speaker: "Sam Lee", text: "one two three" },
    ]);
  });
});

describe("TranscriptText - describing a transcript", () => {
  test("its length in words", () => {
    expect(
      TranscriptText.describeInfo({
        lineCount: 312,
        speakerCount: 6,
        characterCount: 48_000,
        durationInSeconds: 3120,
      }),
    ).toBe("52 minutes, 6 speakers, 312 remarks");
    expect(
      TranscriptText.describeInfo({
        lineCount: 1,
        speakerCount: 1,
        characterCount: 10,
        durationInSeconds: 30,
      }),
    ).toBe("1 speaker, 1 remark");
    expect(
      TranscriptText.describeInfo({
        lineCount: 1200,
        speakerCount: 0,
        characterCount: 10,
      }),
    ).toBe("1,200 remarks");
  });

  test("info as stored is read defensively", () => {
    expect(TranscriptText.readInfo(null)).toBeNull();
    expect(TranscriptText.readInfo([1])).toBeNull();
    expect(
      TranscriptText.readInfo({
        lineCount: 3.7,
        speakerCount: "6",
        characterCount: -1,
        durationInSeconds: 90,
        fileName: "call.vtt",
      }),
    ).toEqual({
      lineCount: 3,
      speakerCount: 0,
      characterCount: 0,
      durationInSeconds: 90,
      fileName: "call.vtt",
    });
  });
});

/*
 * The text is a file anyone could have written. Each of these is about
 * 400,000 characters of the worst shape for one of the parser's readings;
 * every one must be read in well under two seconds, as a linear reading is.
 */
describe("TranscriptText - reads hostile text in linear time", () => {
  const SIZE: number = 400_000;

  const hostile: Array<[string, string]> = [
    ["one line of '<'", "<".repeat(SIZE)],
    ["unclosed voice spans", "<v ".repeat(SIZE / 3)],
    ["colons", ":".repeat(SIZE)],
    ["name-like words and colons", "Aa Bb: ".repeat(SIZE / 7)],
    ["cue arrows", "00:00:00.000 --> ".repeat(SIZE / 17)],
    ["brackets", "[".repeat(SIZE)],
    ["references", "&amp;".repeat(SIZE / 5)],
    ["inline timestamps", "<00:00:01.000".repeat(SIZE / 13)],
    ["timing lines", "00:00:01.000 --> 00:00:02.000\n".repeat(SIZE / 30)],
    [
      "blank-line cues",
      "WEBVTT\n\n" +
        "1\n00:00:01.000 --> 00:00:02.000\nA: b\n\n".repeat(SIZE / 40),
    ],
    ["tags inside tags", "<b<i<u".repeat(SIZE / 6)],
  ];

  test.each(hostile)("%s", (_name: string, text: string) => {
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        try {
          TranscriptText.prepare({ text });
        } catch (error) {
          // Refusing it (too many remarks, no words) is an answer too.
          expect(error).toBeInstanceOf(BadDataException);
        }
      },
      limitInMs: 2_000,
    });

    expect(timed.inMs).toBeLessThan(2_000);
  });
});
