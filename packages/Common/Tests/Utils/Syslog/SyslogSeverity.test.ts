import {
  DEFAULT_SYSLOG_FACILITY,
  DEFAULT_SYSLOG_SEVERITY,
  SYSLOG_FACILITY_LABELS,
  SYSLOG_SEVERITY_KEYWORDS,
  SYSLOG_SEVERITY_LABELS,
  SYSLOG_TO_OTEL_SEVERITY,
  getSyslogFacilityLabel,
  getSyslogSeverityLabel,
  isSyslogSeverity,
  mapSyslogSeverity,
} from "../../../Utils/Syslog/SyslogSeverity";
import LogSeverity, {
  LOG_SEVERITY_NUMBER_BY_TEXT,
  logSeverityNumberFromText,
} from "../../../Types/Log/LogSeverity";
import { describe, expect, test } from "@jest/globals";

/*
 * What a syslog priority says, in words and as a log severity. The tables
 * are RFC 5424's (section 6.2.1): 24 facilities, 8 severities. They are
 * pinned whole, because the words are stored on every syslog log
 * (`syslog.facility.name`, `syslog.severity.name`) and monitors and saved
 * searches are written against them.
 */

describe("the facilities", () => {
  test("are RFC 5424's 24, under the names logs have always been stored with", () => {
    expect(SYSLOG_FACILITY_LABELS).toEqual([
      "kernel",
      "user",
      "mail",
      "system",
      "security",
      "syslogd",
      "line_printer",
      "network_news",
      "uucp",
      "clock",
      "security2",
      "ftp",
      "ntp",
      "log_audit",
      "log_alert",
      "clock2",
      "local0",
      "local1",
      "local2",
      "local3",
      "local4",
      "local5",
      "local6",
      "local7",
    ]);
  });

  test("each code reads as its name, and anything else as unknown", () => {
    SYSLOG_FACILITY_LABELS.forEach((label: string, code: number) => {
      expect(getSyslogFacilityLabel(code)).toBe(label);
    });

    for (const code of [
      -1,
      24,
      99,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      expect({ code, label: getSyslogFacilityLabel(code) }).toEqual({
        code,
        label: "unknown",
      });
    }
  });

  test("no name is used twice", () => {
    expect(new Set(SYSLOG_FACILITY_LABELS).size).toBe(24);
  });
});

describe("the severities", () => {
  test("are RFC 5424's 8, from emergency (0) to debug (7)", () => {
    expect(SYSLOG_SEVERITY_LABELS).toEqual([
      "emergency",
      "alert",
      "critical",
      "error",
      "warning",
      "notice",
      "informational",
      "debug",
    ]);
  });

  test("each code reads as its name, and anything else as unknown", () => {
    SYSLOG_SEVERITY_LABELS.forEach((label: string, code: number) => {
      expect(getSyslogSeverityLabel(code)).toBe(label);
    });

    for (const code of [-1, 8, 2.5, Number.NaN]) {
      expect(getSyslogSeverityLabel(code)).toBe("unknown");
    }
  });

  /*
   * Appendix B's syslog column of the OpenTelemetry Logs Data Model, as the
   * Collector's syslog parser and the host collector's journald mapping
   * number them (issue #11228). Alert (1) used to be Fatal (23) here alone,
   * while the word `alert` and a collector's syslog record were Error (19).
   */
  test("become log severities: 0 fatal, 1-3 error, 4 warning, 5-6 information, 7 debug", () => {
    expect(
      [0, 1, 2, 3, 4, 5, 6, 7].map((code: number) => {
        return mapSyslogSeverity(code);
      }),
    ).toEqual([
      { number: 21, text: LogSeverity.Fatal },
      { number: 19, text: LogSeverity.Error },
      { number: 18, text: LogSeverity.Error },
      { number: 17, text: LogSeverity.Error },
      { number: 13, text: LogSeverity.Warning },
      { number: 10, text: LogSeverity.Information },
      { number: 9, text: LogSeverity.Information },
      { number: 5, text: LogSeverity.Debug },
    ]);
  });

  test("are stored by their RFC 5424 keywords, as the one table of level words stores them", () => {
    expect(SYSLOG_SEVERITY_KEYWORDS).toEqual([
      "emerg",
      "alert",
      "crit",
      "err",
      "warning",
      "notice",
      "info",
      "debug",
    ]);

    SYSLOG_SEVERITY_KEYWORDS.forEach((keyword: string, code: number) => {
      expect({ keyword, number: mapSyslogSeverity(code).number }).toEqual({
        keyword,
        number: logSeverityNumberFromText(keyword),
      });
      expect(LOG_SEVERITY_NUMBER_BY_TEXT.has(keyword.toUpperCase())).toBe(true);
    });
  });

  /*
   * The names a person reads are RFC 5424's too, but not every one is the
   * keyword: the table reads `critical` in full as an application logger's
   * top level (Fatal), syslog's Critical is its keyword `crit` (Error).
   */
  test("a severity's name is not what it is stored by: critical is the keyword crit", () => {
    expect(getSyslogSeverityLabel(2)).toBe("critical");
    expect(mapSyslogSeverity(2)).toEqual({
      number: logSeverityNumberFromText("crit"),
      text: LogSeverity.Error,
    });
    expect(logSeverityNumberFromText("critical")).toBe(21);
  });

  test("the table has exactly the eight, and a worse syslog severity is always a more severe log severity", () => {
    expect(Object.keys(SYSLOG_TO_OTEL_SEVERITY).sort()).toEqual([
      "0",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
    ]);

    for (let code: number = 1; code <= 7; code++) {
      expect(mapSyslogSeverity(code).number).toBeLessThan(
        mapSyslogSeverity(code - 1).number,
      );
    }
  });

  test("the number sits in the range OpenTelemetry gives its text", () => {
    const ranges: Record<string, [number, number]> = {
      [LogSeverity.Debug]: [5, 8],
      [LogSeverity.Information]: [9, 12],
      [LogSeverity.Warning]: [13, 16],
      [LogSeverity.Error]: [17, 20],
      [LogSeverity.Fatal]: [21, 24],
    };

    for (const mapped of Object.values(SYSLOG_TO_OTEL_SEVERITY)) {
      const range: [number, number] | undefined = ranges[mapped.text];

      expect(range).toBeDefined();
      expect(mapped.number).toBeGreaterThanOrEqual(range![0]);
      expect(mapped.number).toBeLessThanOrEqual(range![1]);
    }
  });

  test("a missing or impossible severity is unspecified", () => {
    for (const code of [undefined, null, -1, 8, 99, 2.5, Number.NaN]) {
      expect({ code, mapped: mapSyslogSeverity(code) }).toEqual({
        code,
        mapped: { number: 0, text: LogSeverity.Unspecified },
      });
    }
  });
});

describe("isSyslogSeverity", () => {
  test("is true for the eight codes and nothing else", () => {
    for (const code of [0, 1, 2, 3, 4, 5, 6, 7]) {
      expect(isSyslogSeverity(code)).toBe(true);
    }

    for (const value of [
      -1,
      8,
      2.5,
      Number.NaN,
      "3",
      null,
      undefined,
      true,
      {},
      [3],
    ]) {
      expect({ value, is: isSyslogSeverity(value) }).toEqual({
        value,
        is: false,
      });
    }
  });
});

describe("a message that came without a priority", () => {
  test("is user.notice: priority 13, what RFC 3164 has a relay assume", () => {
    expect(DEFAULT_SYSLOG_FACILITY).toBe(1);
    expect(DEFAULT_SYSLOG_SEVERITY).toBe(5);
    expect(DEFAULT_SYSLOG_FACILITY * 8 + DEFAULT_SYSLOG_SEVERITY).toBe(13);
    expect(getSyslogFacilityLabel(DEFAULT_SYSLOG_FACILITY)).toBe("user");
    expect(getSyslogSeverityLabel(DEFAULT_SYSLOG_SEVERITY)).toBe("notice");
    expect(mapSyslogSeverity(DEFAULT_SYSLOG_SEVERITY).text).toBe(
      LogSeverity.Information,
    );
  });
});
