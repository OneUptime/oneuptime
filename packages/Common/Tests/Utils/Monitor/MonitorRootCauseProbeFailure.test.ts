import { describe, expect, test } from "@jest/globals";
import { RequestFailedPhase } from "../../../Types/Probe/RequestFailedDetails";
import { createTranslator, Translator } from "../../../Types/Translator";
import { mdText } from "../../../Utils/Markdown/FeedMarkdown";
import MonitorRootCauseWording from "../../../Utils/Monitor/MonitorRootCauseWording";
import {
  PROBE_TIMEOUT_FAILURE_CAUSE,
  writeProbeTimeoutFailureCause,
} from "../../../Utils/Monitor/ProbeFailureReading";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * AN INCIDENT'S ROOT CAUSE NAMES WHY THE CHECK FAILED IN THE READER'S
 * LANGUAGE (#7422, #7424).
 *
 * The engine writes a failed check's cause after **Cause** and, for a
 * request, its phase as "- Failed Phase: DNS Resolution". The labels were
 * worded already; the values stayed English even when they were
 * OneUptime's own words. The probe's timeout sentence and a phase the probe
 * names now read in the reader's language, with the count in the reader's
 * digits; every other cause and value stays as stored.
 */

// A root cause as the engine writes it, with the cause placed by mdText.
const rootCauseWithCause: (cause: string) => string = (
  cause: string,
): string => {
  return mdText`**Created because the following criteria was met**:

**Criteria Name**: Website is down

**Cause**: ${cause}
`.toString();
};

const rootCauseWithPhase: (phase: string) => string = (
  phase: string,
): string => {
  return [
    "**Request Failed Details**",
    mdText`- Failed Phase: ${phase}`.toString(),
    "- Error Code: ECONNREFUSED",
  ].join("\n");
};

const word: (rootCause: string, language: string) => string = (
  rootCause: string,
  language: string,
): string => {
  return MonitorRootCauseWording.wordRootCause({
    rootCause: rootCause,
    translator: dashboardTranslator(language),
  });
};

// The line that starts with `start`.
const lineStarting: (text: string, start: string) => string = (
  text: string,
  start: string,
): string => {
  return (
    text.split("\n").find((line: string): boolean => {
      return line.startsWith(start);
    }) || ""
  );
};

describe("the probe's timeout sentence after Cause", () => {
  test("in German: the German sentence with the count", () => {
    const words: Record<string, string> = readDashboardLocale("de");
    const worded: string = word(
      rootCauseWithCause(writeProbeTimeoutFailureCause(3)),
      "de",
    );

    expect(lineStarting(worded, `**${words["Cause"]}**`)).toBe(
      `**${words["Cause"]}**: Die Anfrage wurde 3-mal versucht und hat das Zeitlimit überschritten.`,
    );
  });

  test("in German, one try: the one form", () => {
    const words: Record<string, string> = readDashboardLocale("de");
    const worded: string = word(
      rootCauseWithCause(writeProbeTimeoutFailureCause(1)),
      "de",
    );

    expect(worded).toContain(
      words[`${PROBE_TIMEOUT_FAILURE_CAUSE.other}_one`]!,
    );
    expect(worded).not.toContain("Request was tried");
  });

  test("in Persian: the count in Persian digits", () => {
    const worded: string = word(
      rootCauseWithCause(writeProbeTimeoutFailureCause(3)),
      "fa",
    );

    expect(worded).toContain("\u{06F3}");
    expect(worded).not.toContain("Request was tried");
  });

  test("in English: as stored, 1 times and all", () => {
    const stored: string = rootCauseWithCause(writeProbeTimeoutFailureCause(1));

    expect(word(stored, "en")).toBe(stored);
  });

  test.each([
    "connect ECONNREFUSED 203.0.113.7:443",
    "Request was tried 3 times and it timed out",
    "Request failed with AggregateError (all connection attempts failed). Request was tried 3 times and it timed out.",
  ])("any other cause stays as stored: %s", (cause: string) => {
    const stored: string = rootCauseWithCause(cause);
    const worded: string = word(stored, "de");
    const storedLine: string = lineStarting(stored, "**Cause**");

    expect(lineStarting(worded, "**Ursache**")).toBe(
      storedLine.replace("**Cause**", "**Ursache**"),
    );
  });

  test("a language that does not word the sentence keeps it as stored", () => {
    const words: Record<string, string> = readDashboardLocale("de");
    const withoutSentence: Translator = createTranslator(
      (text: string): string | undefined => {
        return text === PROBE_TIMEOUT_FAILURE_CAUSE.other
          ? undefined
          : words[text];
      },
      "de",
    );
    const stored: string = rootCauseWithCause(writeProbeTimeoutFailureCause(1));

    expect(
      MonitorRootCauseWording.wordRootCause({
        rootCause: stored,
        translator: withoutSentence,
      }),
    ).toContain("Request was tried 1 times and it timed out.");
  });

  test("the sentence somewhere other than after Cause stays as stored", () => {
    const stored: string = `Note: ${writeProbeTimeoutFailureCause(3)}`;

    expect(word(stored, "de")).toBe(stored);
  });
});

describe("the phase after Failed Phase", () => {
  test.each(Object.values(RequestFailedPhase))(
    "%s reads in German and Persian",
    (phase: RequestFailedPhase) => {
      for (const language of ["de", "fa"]) {
        const words: Record<string, string> = readDashboardLocale(language);
        const worded: string = word(rootCauseWithPhase(phase), language);

        expect(lineStarting(worded, "- ")).toBe(
          mdText`- ${words["Failed Phase"]!}: ${words[phase]!}`.toString(),
        );
      }
    },
  );

  test("a phase no probe writes today stays as stored", () => {
    const worded: string = word(rootCauseWithPhase("QUIC Handshake"), "de");

    expect(lineStarting(worded, "- ")).toBe(
      "- Fehlgeschlagene Phase: QUIC Handshake",
    );
  });

  test("in English: as stored", () => {
    const stored: string = rootCauseWithPhase(RequestFailedPhase.TLSHandshake);

    expect(word(stored, "en")).toBe(stored);
  });

  test("the other facts keep their stored values", () => {
    const worded: string = word(
      rootCauseWithPhase(RequestFailedPhase.TCPConnection),
      "de",
    );

    expect(worded).toContain("ECONNREFUSED");
    expect(worded).toContain("TCP-Verbindung");
  });
});
