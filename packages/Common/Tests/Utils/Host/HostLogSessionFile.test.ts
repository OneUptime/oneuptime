import { HostLogSessionLevel } from "../../../Types/Host/HostLogSession";
import HostLogSessionFileWriter, {
  HOST_LOG_SESSION_FILE_MAX_BYTES,
  HOST_LOG_SESSION_FILE_MAX_LINES,
  HostLogSessionFile,
  HostLogSessionFileHeader,
  HostLogSessionLine,
  utf8Length,
} from "../../../Utils/Host/HostLogSessionFile";
import { describe, expect, test } from "@jest/globals";

/*
 * A log session's lines as a file (#9966): the text `logcat -v threadtime`
 * prints, which a vendor's support asks for, with what OneUptime knows of
 * the session in Logcat's own divider lines at the top.
 */

const HEADER: HostLogSessionFileHeader = {
  sessionId: "6f1c2d0e-5a4b-4c3d-9e8f-0a1b2c3d4e5f",
  deviceName: "store-0412-kiosk-02",
  requestedBy: "Dana Reyes",
  requestedAt: new Date("2026-11-19T14:02:41.000Z"),
  note: "Checking why the payment app crashes after 6pm",
  minimumLevel: HostLogSessionLevel.Debug,
};

function line(data: Partial<HostLogSessionLine> = {}): HostLogSessionLine {
  return {
    time: new Date("2026-11-19T14:03:07.123Z"),
    severityNumber: 9,
    severityText: "Information",
    body: "Start proc 4321:com.example/u0a190",
    attributes: {
      "android.log.tag": "ActivityManager",
      "process.pid": 580,
      "thread.id": 1029,
      "android.log.buffer": "main",
    },
    ...data,
  };
}

function lineAt(index: number): HostLogSessionLine {
  return line({
    time: new Date(Date.UTC(2026, 10, 19, 14, 3, 7, 0) + index),
    body: `line ${index}`,
  });
}

describe("a line, as logcat -v threadtime prints it", () => {
  test("the date and time to the millisecond, the ids, the priority, the tag padded to eight, then the message", () => {
    expect(HostLogSessionFileWriter.formatLine(line())).toEqual([
      "11-19 14:03:07.123   580  1029 I ActivityManager: Start proc 4321:com.example/u0a190",
    ]);
    expect(
      HostLogSessionFileWriter.formatLine(
        line({
          attributes: {
            "android.log.tag": "Zygote",
            "process.pid": "7",
            "thread.id": "7",
          },
        }),
      ),
    ).toEqual([
      "11-19 14:03:07.123     7     7 I Zygote  : Start proc 4321:com.example/u0a190",
    ]);
  });

  test("its time is UTC, with leading zeros", () => {
    expect(
      HostLogSessionFileWriter.formatTime(new Date("2026-01-02T03:04:05.006Z")),
    ).toBe("01-02 03:04:05.006");
    // A time as ClickHouse hands it back, as text.
    expect(
      HostLogSessionFileWriter.formatLine(
        line({ time: "2026-11-19T23:59:59.999Z" }),
      )[0],
    ).toMatch(/^11-19 23:59:59\.999 /);
  });

  test("each line of a message is a line of its own, with the same prefix, as Logcat writes it", () => {
    expect(
      HostLogSessionFileWriter.formatLine(
        line({
          severityNumber: 17,
          body: "FATAL EXCEPTION: main\r\njava.lang.IllegalStateException: Printer offline\n\tat com.example.kiosk.Main.onCreate(Main.kt:20)",
          attributes: {
            "android.log.tag": "AndroidRuntime",
            "process.pid": 4321,
            "thread.id": 4321,
          },
        }),
      ),
    ).toEqual([
      "11-19 14:03:07.123  4321  4321 E AndroidRuntime: FATAL EXCEPTION: main",
      "11-19 14:03:07.123  4321  4321 E AndroidRuntime: java.lang.IllegalStateException: Printer offline",
      "11-19 14:03:07.123  4321  4321 E AndroidRuntime: \tat com.example.kiosk.Main.onCreate(Main.kt:20)",
    ]);
  });

  test("what it lacks reads as Logcat reads nothing: ids 0, an empty tag, an empty message", () => {
    expect(
      HostLogSessionFileWriter.formatLine({
        time: new Date("2026-11-19T14:03:07.123Z"),
      }),
    ).toEqual(["11-19 14:03:07.123     0     0 I         : "]);
  });

  test("a line with no time is none the device sent, and is left out", () => {
    expect(
      HostLogSessionFileWriter.formatLine(line({ time: undefined })),
    ).toEqual([]);
    expect(
      HostLogSessionFileWriter.formatLine(line({ time: "not a time" })),
    ).toEqual([]);
  });
});

describe("a line's priority letter", () => {
  test("from OneUptime's severity number, each range its letter", () => {
    const letters: Array<string> = [
      1, 4, 5, 8, 9, 12, 13, 16, 17, 20, 21, 24,
    ].map((severityNumber: number): string => {
      return HostLogSessionFileWriter.priorityOf({ severityNumber });
    });

    expect(letters).toEqual([
      "V",
      "V",
      "D",
      "D",
      "I",
      "I",
      "W",
      "W",
      "E",
      "E",
      "F",
      "F",
    ]);
  });

  test("from its word when it has no number, as OneUptime or OTLP writes it", () => {
    const priority: (severityText: string) => string = (
      severityText: string,
    ): string => {
      return HostLogSessionFileWriter.priorityOf({ severityText });
    };

    expect(priority("Trace")).toBe("V");
    expect(priority("Debug")).toBe("D");
    expect(priority("Information")).toBe("I");
    expect(priority("INFO")).toBe("I");
    expect(priority("Warning")).toBe("W");
    expect(priority("WARN")).toBe("W");
    expect(priority("Error")).toBe("E");
    expect(priority("Fatal")).toBe("F");
    expect(priority("Unspecified")).toBe("I");
    expect(HostLogSessionFileWriter.priorityOf({ severityNumber: "13" })).toBe(
      "W",
    );
  });
});

describe("the file", () => {
  test("says what session it is in Logcat's divider lines, then has each line, each buffer's first under Logcat's own divider", () => {
    const writer: HostLogSessionFileWriter = new HostLogSessionFileWriter(
      HEADER,
    );

    writer.add(line());
    writer.add(
      line({
        severityNumber: 13,
        body: "Low on memory",
        attributes: {
          "android.log.tag": "lowmemorykiller",
          "process.pid": 1,
          "thread.id": 2,
          "android.log.buffer": "system",
        },
      }),
    );
    writer.add(line({ body: "Second line of main" }));

    const file: HostLogSessionFile = writer.finish();

    expect(file.content.split("\n")).toEqual([
      "--------- OneUptime log session 6f1c2d0e-5a4b-4c3d-9e8f-0a1b2c3d4e5f on store-0412-kiosk-02, requested by Dana Reyes on 2026-11-19 14:02 UTC",
      "--------- Note: Checking why the payment app crashes after 6pm",
      "--------- Debug and above, as logcat -v threadtime, times in UTC",
      "--------- beginning of main",
      "11-19 14:03:07.123   580  1029 I ActivityManager: Start proc 4321:com.example/u0a190",
      "--------- beginning of system",
      "11-19 14:03:07.123     1     2 W lowmemorykiller: Low on memory",
      "11-19 14:03:07.123   580  1029 I ActivityManager: Second line of main",
      "",
    ]);
    expect(file.lineCount).toBe(3);
    expect(file.isTruncated).toBe(false);
    expect(file.fileName).toBe(
      "store-0412-kiosk-02-log-session-2026-11-19-14-02.txt",
    );
  });

  test("without a note or a requester's name, it says what it knows", () => {
    const file: HostLogSessionFile = new HostLogSessionFileWriter({
      sessionId: "s1",
      deviceName: "kiosk",
    }).finish();

    expect(file.content.split("\n")).toEqual([
      "--------- OneUptime log session s1 on kiosk",
      "--------- Info and above, as logcat -v threadtime, times in UTC",
      "--------- OneUptime: no lines from this session yet.",
      "",
    ]);
    expect(file.lineCount).toBe(0);
  });

  test("a header value is one line: a name or a note cannot start a line of its own", () => {
    const lines: Array<string> = HostLogSessionFileWriter.headerLines({
      sessionId: "s1",
      deviceName: "kiosk\n11-19 00:00:00.000     1     1 E fake: injected",
      note: "first\nsecond",
    });

    expect(lines).toHaveLength(3);
    for (const value of lines) {
      expect(value.startsWith("---------")).toBe(true);
    }
  });

  test("its name is the device's, the session's and the time it was asked for, safe as a file name", () => {
    expect(
      HostLogSessionFileWriter.fileName({
        sessionId: "s1",
        deviceName: "Store 0412 / Kiosk #2 (front)",
        requestedAt: new Date("2026-11-19T09:05:00.000Z"),
      }),
    ).toBe("Store-0412-Kiosk-2-front-log-session-2026-11-19-09-05.txt");
    expect(
      HostLogSessionFileWriter.fileName({
        sessionId: "s1",
        deviceName: "../..",
      }),
    ).toBe("device-log-session.txt");
  });
});

describe("how much a file holds", () => {
  test("by default, at most 100,000 lines and 32 MB", () => {
    expect(HOST_LOG_SESSION_FILE_MAX_LINES).toBe(100_000);
    expect(HOST_LOG_SESSION_FILE_MAX_BYTES).toBe(32 * 1024 * 1024);
  });

  test("a file full of lines refuses the next, and says at its end how many the session has", () => {
    const writer: HostLogSessionFileWriter = new HostLogSessionFileWriter(
      HEADER,
      {
        maxLines: 3,
      },
    );

    expect(
      [0, 1, 2, 3, 4].map((index: number): boolean => {
        return writer.add(lineAt(index));
      }),
    ).toEqual([true, true, true, false, false]);
    expect(writer.full).toBe(true);

    const file: HostLogSessionFile = writer.finish({ totalLineCount: 254331 });
    const lines: Array<string> = file.content.trimEnd().split("\n");

    expect(file.lineCount).toBe(3);
    expect(file.isTruncated).toBe(true);
    expect(lines[lines.length - 2]).toMatch(/ line 2$/);
    expect(lines[lines.length - 1]).toBe(
      "--------- OneUptime: the first 3 lines of 254331. A file holds at most 3 lines and 32 MB; read the rest in Logs.",
    );
  });

  test("a file never grows past its bytes, counted in UTF-8 as the file is written", () => {
    const writer: HostLogSessionFileWriter = new HostLogSessionFileWriter(
      HEADER,
      {
        maxBytes: 1024,
      },
    );
    let added: number = 0;

    while (writer.add(line({ body: "Ünïcödé ✓ ".repeat(5) }))) {
      added++;
    }

    const file: HostLogSessionFile = writer.finish({ totalLineCount: 500 });
    const withoutFooter: string =
      file.content.trimEnd().split("\n").slice(0, -1).join("\n") + "\n";

    expect(added).toBeGreaterThan(0);
    expect(file.lineCount).toBe(added);
    expect(utf8Length(withoutFooter)).toBeLessThanOrEqual(1024);
    expect(file.isTruncated).toBe(true);
  });

  test("a session with exactly as many lines as were read is whole", () => {
    const writer: HostLogSessionFileWriter = new HostLogSessionFileWriter(
      HEADER,
      {
        maxLines: 3,
      },
    );

    writer.add(lineAt(0));
    writer.add(lineAt(1));

    expect(writer.finish({ totalLineCount: 2 }).isTruncated).toBe(false);
  });

  test("UTF-8 is counted as a file holds it", () => {
    expect(utf8Length("a")).toBe(1);
    expect(utf8Length("é")).toBe(2);
    expect(utf8Length("✓")).toBe(3);
    expect(utf8Length("🔍")).toBe(4);
  });
});
