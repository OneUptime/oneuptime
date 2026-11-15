import { describe, expect, test } from "@jest/globals";
import NtpMonitorResponse from "../../../Types/Monitor/NtpMonitor/NtpMonitorResponse";
import NtpMonitorUtil from "../../../Types/Monitor/NtpMonitor/NtpMonitorUtil";
import { createTranslator, Translator } from "../../../Types/Translator";
import { mdText } from "../../../Utils/Markdown/FeedMarkdown";
import MonitorRootCauseWording from "../../../Utils/Monitor/MonitorRootCauseWording";
import {
  readRootCauseResponseTime,
  wordRootCauseFact,
} from "../../../Utils/Monitor/RootCauseFacts";
import {
  PROBE_FAILURE_CAUSES,
  ProbeFailureCause,
  writeProbeFailureCause,
} from "../../../Utils/Monitor/ProbeFailureCauses";
import MonitorCriteriaEvaluator from "../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { isolated, withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { NO_BREAK_SPACE } from "../../../Types/NoBreakSpaces";

/*
 * A ROOT CAUSE'S FIGURES AND ITS CAUSE, IN THE READER'S LANGUAGE (#8268,
 * #8267).
 *
 * An incident's or an alert's root cause lists the check's Response Time,
 * Attempts and, for an NTP server that answered, its stratum, clock offset,
 * root dispersion and leap indicator. The engine writes each from a number,
 * in English and Latin digits: a Persian page read "زمان پاسخ: 411.0 ms"
 * beside a summary that said "۴۱۱ میلی‌ثانیه". Each figure is read back
 * now when it is exactly what the engine writes, and drawn as the
 * summaries draw it; **Cause** reads the probe's failure causes with
 * values (ProbeFailureCauses) in the reader's language too. English reads
 * the root cause as stored, byte for byte.
 */

// The engine's Response Snapshot and NTP facts, line for line as it writes them.
function snapshot(lines: ReadonlyArray<string>): string {
  return ["**Response Snapshot**", ...lines].join("\n");
}

function word(
  rootCause: string,
  language: string,
  setsValuesApart: boolean = false,
): string {
  return MonitorRootCauseWording.wordRootCause({
    rootCause: rootCause,
    translator: dashboardTranslator(language),
    setsValuesApart: setsValuesApart,
  });
}

// The value after `label` on the worded line that starts with "- ".
function factValue(worded: string, language: string, label: string): string {
  const wordedLabel: string = readDashboardLocale(language)[label] || label;
  const line: string | undefined = worded
    .split("\n")
    .find((candidate: string) => {
      return candidate.startsWith(`- ${wordedLabel}: `);
    });

  if (line === undefined) {
    throw new Error(`No line for ${label} in ${worded}`);
  }

  return line.slice(`- ${wordedLabel}: `.length);
}

// A text with its isolates' marks left out, and each no-break space a plain one.
function plain(text: string): string {
  return withoutIsolateMarks(text).split(NO_BREAK_SPACE).join(" ");
}

const ENGINE_NTP: NtpMonitorResponse = {
  isOnline: true,
  isSynchronized: true,
  responseTimeInMs: 12.5,
  failureCause: "",
  isTimeout: false,
  port: 123,
  stratum: 2,
  clockOffsetInMs: 1532.25,
  leapIndicator: 0,
  referenceId: "GPS",
  rootDispersionInMs: 3.25,
  serverAddress: "192.0.2.10",
} as unknown as NtpMonitorResponse;

const NTP_LINES: Array<string> = MonitorCriteriaEvaluator.getNtpResponseDetails(
  ENGINE_NTP,
).map((line: { toString: () => string }): string => {
  return line.toString();
});

describe("the engine writes a response time as it did", () => {
  test("two decimals below 100 ms, one below a second, none above", () => {
    expect(MonitorCriteriaEvaluator.formatMilliseconds(12.345)).toBe(
      "12.35 ms",
    );
    expect(MonitorCriteriaEvaluator.formatMilliseconds(411)).toBe("411.0 ms");
    expect(MonitorCriteriaEvaluator.formatMilliseconds(1532.4)).toBe("1532 ms");
    expect(MonitorCriteriaEvaluator.formatMilliseconds(0)).toBe("0.00 ms");
    expect(MonitorCriteriaEvaluator.formatMilliseconds(undefined)).toBeNull();
    expect(MonitorCriteriaEvaluator.formatMilliseconds(NaN)).toBeNull();
  });

  test("and reads back only what it writes", () => {
    expect(readRootCauseResponseTime("411.0 ms")).toBe(411);
    expect(readRootCauseResponseTime("12.35 ms")).toBe(12.35);
    expect(readRootCauseResponseTime("1532 ms")).toBe(1532);
    for (const stored of [
      "411 ms",
      "12.3 ms",
      "1532.0 ms",
      "1,532 ms",
      "411.0ms",
      " 411.0 ms",
      "411.0 s",
      "fast",
    ]) {
      expect({ stored, read: readRootCauseResponseTime(stored) }).toEqual({
        stored,
        read: null,
      });
    }
  });

  test("the NTP facts the engine writes, as this suite reads them", () => {
    expect(NTP_LINES).toEqual([
      "- Synchronized: Yes",
      "- Stratum: 2 (secondary server)",
      "- Clock Offset: 1,532 ms ahead of the probe",
      "- Leap Indicator: 0 (No leap second pending)",
      "- Reference: GPS",
      "- Root Dispersion: 3.25 ms",
      "- Server Address: 192.0.2.10",
    ]);
  });
});

describe("the Response Snapshot's figures in the reader's digits and units", () => {
  const ROOT_CAUSE: string = snapshot([
    mdText`- Response Status Code: ${503}`.toString(),
    mdText`- Response Time: ${MonitorCriteriaEvaluator.formatMilliseconds(411) as string}`.toString(),
    "- Timed Out: No",
    mdText`- Attempts: ${3}`.toString(),
    ...NTP_LINES,
  ]);

  test("English: byte for byte as stored", () => {
    expect(word(ROOT_CAUSE, "en")).toBe(ROOT_CAUSE);
    expect(word(ROOT_CAUSE, "en", true)).toBe(ROOT_CAUSE);
  });

  test("German: the unit and the decimal sign of the summaries", () => {
    const worded: string = word(ROOT_CAUSE, "de");

    expect(plain(factValue(worded, "de", "Response Time"))).toBe("411 ms");
    expect(factValue(worded, "de", "Attempts")).toBe("3");
    expect(factValue(worded, "de", "Stratum")).toBe("2 (Sekundärserver)");
    expect(plain(factValue(worded, "de", "Clock Offset"))).toBe(
      "1.532 ms vor der Sonde",
    );
    expect(plain(factValue(worded, "de", "Root Dispersion"))).toBe("3,25 ms");
    expect(factValue(worded, "de", "Leap Indicator")).toBe(
      "0 (keine Schaltsekunde ausstehend)",
    );
    // A status code is a code, and a reference a name: as written.
    expect(factValue(worded, "de", "Response Status Code")).toBe("503");
    expect(factValue(worded, "de", "Reference")).toBe("GPS");
  });

  test("a figure stays on the line of its unit: a no-break space between them", () => {
    const worded: string = word(ROOT_CAUSE, "de");

    expect(factValue(worded, "de", "Response Time")).toBe(
      `411${NO_BREAK_SPACE}ms`,
    );
    expect(factValue(worded, "de", "Root Dispersion")).toBe(
      `3,25${NO_BREAK_SPACE}ms`,
    );
  });

  test("Persian: every figure in Persian digits and its unit in Persian", () => {
    const worded: string = word(ROOT_CAUSE, "fa", true);
    const words: Record<string, string> = readDashboardLocale("fa");

    expect(plain(factValue(worded, "fa", "Response Time"))).toBe(
      (words["{{value}} ms"] as string).replace("{{value}}", "۴۱۱"),
    );
    expect(factValue(worded, "fa", "Attempts")).toBe("۳");
    expect(factValue(worded, "fa", "Stratum")).toBe("۲ (سرور ثانویه)");
    expect(plain(factValue(worded, "fa", "Root Dispersion"))).toBe(
      (words["{{value}} ms"] as string).replace("{{value}}", "۳٫۲۵"),
    );
    expect(plain(factValue(worded, "fa", "Clock Offset"))).toBe(
      (words["{{offset}} ahead of the probe"] as string).replace(
        "{{offset}}",
        (words["{{value}} ms"] as string).replace("{{value}}", "۱٬۵۳۲"),
      ),
    );
    expect(plain(factValue(worded, "fa", "Leap Indicator"))).toBe(
      "۰ (ثانیهٔ کبیسه‌ای در راه نیست)",
    );
    // The status code and the server's address stay as written, set apart.
    expect(factValue(worded, "fa", "Response Status Code")).toBe(
      isolated("503"),
    );
    expect(factValue(worded, "fa", "Server Address")).toBe(
      isolated("192.0.2.10"),
    );
    expect(plain(worded)).not.toMatch(/ ms\b/);
  });

  test("Arabic and Spanish: their own units, the figures as each writes a number", () => {
    const arabic: string = word(ROOT_CAUSE, "ar", true);
    const spanish: string = word(ROOT_CAUSE, "es");
    const ar: Record<string, string> = readDashboardLocale("ar");

    expect(plain(factValue(arabic, "ar", "Response Time"))).toBe(
      (ar["{{value}} ms"] as string).replace("{{value}}", "411"),
    );
    expect(factValue(arabic, "ar", "Attempts")).toBe("3");
    expect(plain(factValue(arabic, "ar", "Stratum"))).toBe(
      (ar["{{stratum}} (secondary server)"] as string).replace(
        "{{stratum}}",
        "2",
      ),
    );
    expect(plain(factValue(spanish, "es", "Root Dispersion"))).toBe("3,25 ms");
    expect(factValue(spanish, "es", "Stratum")).toBe(
      (
        readDashboardLocale("es")["{{stratum}} (secondary server)"] as string
      ).replace("{{stratum}}", "2"),
    );
  });

  test.each(DASHBOARD_LANGUAGES)(
    "%s words every figure, never with English's NTP words or its decimals",
    (language: string) => {
      const worded: string = plain(word(ROOT_CAUSE, language, true));

      for (const english of [
        "411.0",
        "secondary server",
        "ahead of the probe",
        "No leap second pending",
      ]) {
        expect({ language, english, left: worded.includes(english) }).toEqual({
          language,
          english,
          left: false,
        });
      }
    },
  );

  test("every stratum, offset and leap indicator the engine writes", () => {
    const de: Translator = dashboardTranslator("de");
    const words: Record<string, string> = readDashboardLocale("de");
    const fact: (label: string, value: string) => string | null = (
      label: string,
      value: string,
    ): string | null => {
      const worded: string | null = wordRootCauseFact({
        label,
        value,
        translator: de,
      });

      return worded === null ? null : plain(worded);
    };

    expect(fact("Stratum", NtpMonitorUtil.describeStratum(0))).toBe(
      words["0 (unspecified, not synchronized)"],
    );
    expect(fact("Stratum", NtpMonitorUtil.describeStratum(1))).toBe(
      "1 (Primärserver)",
    );
    expect(fact("Stratum", NtpMonitorUtil.describeStratum(15))).toBe(
      "15 (Sekundärserver)",
    );
    expect(fact("Stratum", NtpMonitorUtil.describeStratum(16))).toBe(
      "16 (nicht synchronisiert)",
    );
    expect(fact("Stratum", NtpMonitorUtil.describeStratum(0, "RATE"))).toBe(
      (words["0 (kiss-o'-death {{kissCode}})"] as string).replace(
        "{{kissCode}}",
        "RATE",
      ),
    );
    expect(fact("Clock Offset", NtpMonitorUtil.describeClockOffset(0))).toBe(
      words["In step with the probe"],
    );
    expect(
      fact("Clock Offset", NtpMonitorUtil.describeClockOffset(-0.042)),
    ).toBe(
      (words["{{offset}} behind the probe"] as string).replace(
        "{{offset}}",
        "0,042 ms",
      ),
    );
    expect(
      fact("Root Dispersion", NtpMonitorUtil.formatMilliseconds(1532.4)),
    ).toBe("1.532 ms");

    for (const indicator of [0, 1, 2, 3]) {
      const stored: string = `${indicator} (${NtpMonitorUtil.describeLeapIndicator(indicator)})`;
      const worded: string | null = fact("Leap Indicator", stored);

      expect({
        indicator,
        worded: worded !== null && worded !== stored,
      }).toEqual({
        indicator,
        worded: true,
      });
      expect(worded?.startsWith(`${indicator} (`)).toBe(true);
    }
  });

  test("a value the engine did not write stays as stored", () => {
    const de: Translator = dashboardTranslator("de");

    for (const [label, value] of [
      ["Response Time", "411 ms"],
      ["Response Time", "about 400 ms"],
      ["Attempts", "03"],
      ["Attempts", "three"],
      ["Stratum", "2 (primary server)"],
      ["Stratum", "1 (secondary server)"],
      ["Stratum", "0 (kiss-o'-death TOOLONG)"],
      ["Clock Offset", "1532 ms ahead of the probe"],
      ["Clock Offset", "0 ms ahead of the probe"],
      ["Root Dispersion", "3.250 ms"],
      ["Leap Indicator", "4 (Unknown)"],
      [
        "Leap Indicator",
        "0 (A leap second will be added at the end of the day)",
      ],
      ["Reference", "GPS"],
    ] as Array<[string, string]>) {
      expect({
        label,
        value,
        worded: wordRootCauseFact({ label, value, translator: de }),
      }).toEqual({
        label,
        value,
        worded: null,
      });
    }

    const edited: string = snapshot([
      "- Response Time: 411 ms",
      "- Attempts: three",
    ]);

    expect(word(edited, "de")).toBe(
      `**${readDashboardLocale("de")["Response Snapshot"]}**\n- ${readDashboardLocale("de")["Response Time"]}: 411 ms\n- ${readDashboardLocale("de")["Attempts"]}: three`,
    );
  });

  /*
   * A figure is the reader's digits whether or not their file words the
   * unit ("{{value}} ms" reads the same in most languages), as the
   * summaries write it; a fact's words stay English until it is worded.
   */
  test("a language with no wording of a fact keeps its words as stored, its figures in the reader's digits", () => {
    const silent: Translator = createTranslator((): undefined => {
      return undefined;
    }, "fa");

    expect(
      plain(
        wordRootCauseFact({
          label: "Response Time",
          value: "411.0 ms",
          translator: silent,
        }) as string,
      ),
    ).toBe("۴۱۱ ms");
    expect(
      wordRootCauseFact({
        label: "Stratum",
        value: "2 (secondary server)",
        translator: silent,
      }),
    ).toBeNull();
    expect(
      wordRootCauseFact({
        label: "Leap Indicator",
        value: "0 (No leap second pending)",
        translator: silent,
      }),
    ).toBeNull();
  });
});

describe("**Cause**: the probe's failure causes with values", () => {
  const cause: (text: string) => string = (text: string): string => {
    return mdText`**Cause**: ${text}`.toString();
  };

  const NTP_CAUSE: string = writeProbeFailureCause(
    ProbeFailureCause.TriedTimes,
    {
      cause: writeProbeFailureCause(ProbeFailureCause.NtpNoReply, {
        target: "192.0.2.10:123",
        timeoutInMs: 5000,
      }),
      count: 3,
    },
  );

  const IPV6_CAUSE: string = writeProbeFailureCause(
    ProbeFailureCause.ProbeCannotSendIPv6,
    { host: "2001:db8::1", detail: "connect EADDRNOTAVAIL 2001:db8::1:443" },
  );

  test("English: as stored", () => {
    expect(word(cause(NTP_CAUSE), "en")).toBe(cause(NTP_CAUSE));
  });

  test("German: the sentence in German, its values as found", () => {
    const worded: string = word(cause(NTP_CAUSE), "de");

    // Placed as text, as the engine placed the cause (mdText).
    expect(worded).toBe(
      mdText`**${readDashboardLocale("de")["Cause"] as string}**: ${`Innerhalb von 5${NO_BREAK_SPACE}Sek. kam keine NTP-Antwort von 192.0.2.10:123. 3-mal versucht.`}`.toString(),
    );
    expect(plain(worded)).toContain("kam keine NTP-Antwort von 192.0.2.10:123");
    expect(plain(worded)).toContain("3-mal versucht.");
  });

  test.each(["es", "ar", "fa"])(
    "%s: the probe-side sentence in the reader's words, the host and the OS's words kept",
    (language: string) => {
      const worded: string = withoutIsolateMarks(
        word(cause(IPV6_CAUSE), language, true),
      );

      expect(worded).not.toContain("This probe");
      expect(worded).toContain("2001:db8::1");
      expect(worded).toContain("EADDRNOTAVAIL");
      expect(
        readDashboardLocale(language)[
          PROBE_FAILURE_CAUSES[ProbeFailureCause.ProbeCannotSendIPv6]
        ],
      ).toBeTruthy();
    },
  );

  test("a cause somebody edited stays as they wrote it", () => {
    const edited: string = cause(`${NTP_CAUSE} Then it worked.`);

    // Only the label is worded: the cause is the stored line's, Markdown and all.
    expect(word(edited, "de")).toBe(
      edited.replace(
        "**Cause**",
        `**${readDashboardLocale("de")["Cause"] as string}**`,
      ),
    );
  });
});
