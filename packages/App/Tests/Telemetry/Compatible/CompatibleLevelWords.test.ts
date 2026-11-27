import { describe, expect, test } from "@jest/globals";
import OtlpJson, {
  OTLP_SEVERITY_ERROR,
  OTLP_SEVERITY_FATAL,
  OTLP_SEVERITY_INFO,
  OTLP_SEVERITY_UNSPECIFIED,
  OtlpSeverity,
} from "../../../FeatureSet/Telemetry/Utils/Compatible/OtlpJson";
import {
  LOG_SEVERITY_WORDS,
  LogSeverityWord,
  WORDS_THAT_NAME_NOTHING,
  spellingsOf,
} from "../Helpers/LogSeverityWords";

/*
 * THE COMPATIBLE ENDPOINTS READ A LEVEL WORD AS EVERY LOG INGEST DOES
 * (issue #8536).
 *
 * Loki, Splunk HEC, Datadog and Sentry turn a level word into a severity
 * with OtlpJson.severityFromWord. It had a table of its own, which
 * disagreed with the one OTLP and Fluent ingest read: `critical` was ERROR2
 * there and FATAL everywhere else, `verbose` TRACE instead of DEBUG,
 * `panic` FATAL instead of ERROR3, and Appendix B's java.util.logging and
 * zap words and the spec's numbered steps were unknown. So `{"level":
 * "critical"}` was Fatal through Fluent Bit and Error through Loki.
 *
 * Now it reads the shared table (LOG_SEVERITY_NUMBER_BY_TEXT), held here to
 * the same hand-written list the OTLP, Fluent and remapper suites use, plus
 * the three words only these tools write. Datadog keeps its own `critical`
 * (DatadogIntake.test.ts says why).
 */

// What an OTLP severity number is written as: TRACE ... FATAL4.
function otlpTextOf(severityNumber: number): string {
  const names: Array<string> = [
    "TRACE",
    "DEBUG",
    "INFO",
    "WARN",
    "ERROR",
    "FATAL",
  ];
  const name: string = names[Math.floor((severityNumber - 1) / 4)]!;
  const step: number = (severityNumber - 1) % 4;

  return step === 0 ? name : `${name}${step + 1}`;
}

describe("OtlpJson.severityFromWord reads the level words every log ingest reads (issue #8536)", () => {
  test.each(
    LOG_SEVERITY_WORDS.map(
      (word: LogSeverityWord): [string, number, string] => {
        return [word.word, word.severityNumber, word.source];
      },
    ),
  )(
    "%s is %i, in any case and with spaces around it (%s)",
    (word: string, severityNumber: number) => {
      for (const written of spellingsOf(word)) {
        expect({
          written,
          severity: OtlpJson.severityFromWord(written),
        }).toEqual({
          written,
          severity: {
            number: severityNumber,
            text: otlpTextOf(severityNumber),
          },
        });
      }
    },
  );

  test.each([
    ["ok", "Datadog's passing check"],
    ["success", "Datadog's passing check"],
    ["log", "Sentry's log level"],
  ])("%s, a word only these tools write (%s), is INFO", (word: string) => {
    for (const written of spellingsOf(word)) {
      expect(OtlpJson.severityFromWord(written)).toBe(OTLP_SEVERITY_INFO);
    }
  });

  // All but "LOG": no level elsewhere, but Sentry's here (above).
  test.each(
    WORDS_THAT_NAME_NOTHING.filter(([, written]: [string, string]): boolean => {
      return written.toLowerCase() !== "log";
    }),
  )(
    "%s (%p) is UNSPECIFIED - the constant itself, which LokiPush compares with",
    (_label: string, written: string) => {
      expect(OtlpJson.severityFromWord(written)).toBe(
        OTLP_SEVERITY_UNSPECIFIED,
      );
    },
  );

  test("a value that is not text is UNSPECIFIED", () => {
    for (const value of [undefined, null, 17, true, {}, ["error"]]) {
      expect(OtlpJson.severityFromWord(value)).toBe(OTLP_SEVERITY_UNSPECIFIED);
    }
  });

  /*
   * The words this table read differently before, and how every other
   * path has read them since #8425.
   */
  test.each([
    ["critical", 21, "FATAL", "ERROR2 before"],
    ["verbose", 5, "DEBUG", "TRACE before"],
    // A crash (issue #11228): FATAL as before #8536, ERROR3 in between.
    ["panic", 21, "FATAL", "unchanged"],
    ["crit", 18, "ERROR2", "unchanged"],
    ["alert", 19, "ERROR3", "unchanged"],
    ["emergency", 21, "FATAL", "unchanged"],
    ["severe", 17, "ERROR", "unknown before"],
    ["fine", 6, "DEBUG2", "unknown before"],
    ["warn2", 14, "WARN2", "unknown before"],
  ])(
    "%s is %i (%s): %s",
    (written: string, severityNumber: number, text: string) => {
      expect(OtlpJson.severityFromWord(written)).toEqual({
        number: severityNumber,
        text: text,
      });
    },
  );

  test("the named severities are the module's own constants", () => {
    expect(OtlpJson.severityFromWord("error")).toBe(OTLP_SEVERITY_ERROR);
    expect(OtlpJson.severityFromWord("fatal")).toBe(OTLP_SEVERITY_FATAL);
    expect(OtlpJson.severityFromWord("info")).toBe(OTLP_SEVERITY_INFO);
  });
});

describe("OtlpJson.severityFromNumber", () => {
  test("is every SeverityNumber from 1 to 24 by its name and numbered step", () => {
    for (
      let severityNumber: number = 1;
      severityNumber <= 24;
      severityNumber++
    ) {
      const severity: OtlpSeverity =
        OtlpJson.severityFromNumber(severityNumber);

      expect(severity).toEqual({
        number: severityNumber,
        text: otlpTextOf(severityNumber),
      });
    }
  });

  test("is UNSPECIFIED for 0, and for anything that is no SeverityNumber", () => {
    for (const value of [0, 25, -1, 1.5, Number.NaN, Infinity]) {
      expect(OtlpJson.severityFromNumber(value)).toBe(
        OTLP_SEVERITY_UNSPECIFIED,
      );
    }
  });
});
