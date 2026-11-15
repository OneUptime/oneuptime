import { describe, expect, test } from "@jest/globals";
import { createTranslator, Translator } from "../../../Types/Translator";
import {
  getProbeFailureCauseText,
  getProbeMessageText,
} from "../../../Utils/Monitor/ProbeFailureReading";
import {
  matchProbeFailureTemplate,
  NTP_NO_REPLY_IGNORED_PACKETS,
  PROBE_FAILURE_CAUSES,
  ProbeFailureCause,
  ProbeFailureCauseReading,
  readProbeFailureCause,
  wordProbeFailureCause,
  writeProbeFailureCause,
  writeProbeSeconds,
} from "../../../Utils/Monitor/ProbeFailureCauses";
import ProbeNetworkFailureUtil, {
  ProbeNetworkFailureKind,
} from "../../../Utils/ProbeNetworkFailureUtil";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  placeholdersOf,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { isolated, withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { NO_BREAK_SPACE } from "../../../Types/NoBreakSpaces";

/*
 * WHY A PROBE'S CHECK FAILED, WITH THE VALUES IT FOUND (#8267).
 *
 * The probe's other failure causes - an NTP lookup or query that failed, a
 * probe that could not open an IPv6 connection or has no route, a connect
 * whose every attempt failed - are OneUptime's own sentences with values
 * in them, and read English on every page. Each is written from one table
 * now, byte for byte as it was written by hand, and read back in the
 * reader's language with its values kept as found.
 */

const ENGLISH: Translator = createTranslator(undefined, "en");

// What each check wrote by hand before #8267, for the values below.
const AS_WRITTEN_BY_HAND: ReadonlyArray<{
  cause: ProbeFailureCause;
  values: Parameters<typeof writeProbeFailureCause>[1];
  english: string;
}> = [
  {
    cause: ProbeFailureCause.NtpLookupTimedOut,
    values: { host: "pool.ntp.org", timeoutInMs: 5000 },
    english: "Looking up pool.ntp.org did not finish within 5 seconds.",
  },
  {
    cause: ProbeFailureCause.NtpLookupTimedOut,
    values: { host: "pool.ntp.org", timeoutInMs: 1000 },
    english: "Looking up pool.ntp.org did not finish within 1 second.",
  },
  {
    cause: ProbeFailureCause.NtpNoReply,
    values: { target: "192.0.2.10:123", timeoutInMs: 2500 },
    english: "No NTP reply from 192.0.2.10:123 within 2.5 seconds.",
  },
  {
    cause: ProbeFailureCause.NtpNoReplyIgnoredPackets,
    values: {
      target: "[2001:db8::1]:123",
      timeoutInMs: 5000,
      count: 1,
      reply: "a reply from 198.51.100.7:123",
    },
    english:
      "No NTP reply from [2001:db8::1]:123 within 5 seconds. The probe ignored a packet that did not answer its request: a reply from 198.51.100.7:123.",
  },
  {
    cause: ProbeFailureCause.NtpNoReplyIgnoredPackets,
    values: {
      target: "time.example.com:123",
      timeoutInMs: 5000,
      count: 3,
      reply: "48 bytes that were not an NTP reply",
    },
    english:
      "No NTP reply from time.example.com:123 within 5 seconds. The probe ignored 3 packets that did not answer its request: 48 bytes that were not an NTP reply.",
  },
  {
    cause: ProbeFailureCause.NtpNameDidNotResolve,
    values: { host: "time.example.invalid", code: "ENOTFOUND" },
    english: "Could not resolve time.example.invalid (ENOTFOUND).",
  },
  {
    cause: ProbeFailureCause.NtpPortUnreachable,
    values: { target: "192.0.2.10:123", port: 123 },
    english:
      "192.0.2.10:123 refused the request: nothing is listening for NTP on UDP port 123 there (ICMP port unreachable).",
  },
  {
    cause: ProbeFailureCause.NtpRequestFailedWithCode,
    values: {
      target: "192.0.2.10:123",
      message: "send failed",
      code: "ENOBUFS",
    },
    english: "The NTP request to 192.0.2.10:123 failed: send failed (ENOBUFS).",
  },
  {
    cause: ProbeFailureCause.NtpRequestFailed,
    values: { target: "192.0.2.10:123", message: "send EPERM 192.0.2.10:123" },
    english:
      "The NTP request to 192.0.2.10:123 failed: send EPERM 192.0.2.10:123.",
  },
  {
    cause: ProbeFailureCause.TriedTimes,
    values: {
      cause: "No NTP reply from 192.0.2.10:123 within 5 seconds.",
      count: 4,
    },
    english:
      "No NTP reply from 192.0.2.10:123 within 5 seconds. Tried 4 times.",
  },
  {
    cause: ProbeFailureCause.AllConnectionAttemptsFailed,
    values: { error: "connect ECONNREFUSED 192.0.2.10:443" },
    english:
      "Request failed with AggregateError (all connection attempts failed). connect ECONNREFUSED 192.0.2.10:443",
  },
  {
    cause: ProbeFailureCause.AllConnectionAttemptsFailedWithAttempts,
    values: {
      error: "AggregateError",
      attempts:
        "Error: connect ECONNREFUSED ::1:80; Error: connect ECONNREFUSED 127.0.0.1:80",
    },
    english:
      "Request failed with AggregateError (all connection attempts failed). AggregateError. Attempts: Error: connect ECONNREFUSED ::1:80; Error: connect ECONNREFUSED 127.0.0.1:80",
  },
];

const DETAIL: string = "connect EADDRNOTAVAIL 2001:db8::1:443 - Local (:::0)";

// Every describe() sentence, as ProbeNetworkFailureUtil writes it.
const DESCRIBED: Record<string, string> = {
  [ProbeFailureCause.ProbeCouldNotOpenIPv6Connection]:
    ProbeNetworkFailureUtil.describe({
      host: "2001:db8::1",
      failure: {
        kind: ProbeNetworkFailureKind.NoSourceAddress,
        isCertain: true,
        isCauseAmbiguous: true,
        detail: DETAIL,
      },
    }),
  [ProbeFailureCause.ProbeCannotSendIPv6]: ProbeNetworkFailureUtil.describe({
    host: "2001:db8::1",
    failure: {
      kind: ProbeNetworkFailureKind.AddressFamilyNotSupported,
      isCertain: true,
      detail: "ping6: socket: Address family not supported by protocol",
    },
  }),
  [ProbeFailureCause.ProbeCouldNotReachOverIPv6]:
    ProbeNetworkFailureUtil.describe({
      host: "2001:db8::1",
      failure: {
        kind: ProbeNetworkFailureKind.NetworkUnreachable,
        isCertain: false,
        detail: "connect ENETUNREACH 2001:db8::1:443",
      },
    }),
  [ProbeFailureCause.ProbeMayHaveNoRoute]: ProbeNetworkFailureUtil.describe({
    host: "192.0.2.10",
    failure: {
      kind: ProbeNetworkFailureKind.NoRouteToHost,
      isCertain: false,
      detail: "ping: sendmsg: No route to host",
    },
  }),
  [ProbeFailureCause.ProbeHasNoRoute]: ProbeNetworkFailureUtil.describe({
    host: "192.0.2.10",
    failure: {
      kind: ProbeNetworkFailureKind.NetworkUnreachable,
      isCertain: true,
      detail: "ping: connect: Network is unreachable",
    },
  }),
  [ProbeFailureCause.ProbeCouldNotSendTraffic]:
    ProbeNetworkFailureUtil.describe({
      host: "192.0.2.10",
      failure: {
        kind: ProbeNetworkFailureKind.NoSourceAddress,
        isCertain: true,
        detail: "ping: connect: Cannot assign requested address",
      },
    }),
};

// describe()'s sentences, word for word as it wrote them by hand.
const DESCRIBED_BY_HAND: Record<string, string> = {
  [ProbeFailureCause.ProbeCouldNotOpenIPv6Connection]: `This probe could not open an IPv6 connection from its own side (${DETAIL}), so 2001:db8::1 was never contacted. This usually means the probe has no usable IPv6 address or route (less often, that it has run out of local ports); this says nothing about whether 2001:db8::1 is up. Monitor IPv6 destinations from a probe that has IPv6 connectivity.`,
  [ProbeFailureCause.ProbeCannotSendIPv6]:
    "This probe cannot send IPv6 traffic (ping6: socket: Address family not supported by protocol), so 2001:db8::1 was never contacted. The probe has no usable IPv6 address or route; this says nothing about whether 2001:db8::1 is up. Monitor IPv6 destinations from a probe that has IPv6 connectivity.",
  [ProbeFailureCause.ProbeCouldNotReachOverIPv6]:
    "This probe could not reach 2001:db8::1 over IPv6 (connect ENETUNREACH 2001:db8::1:443). Most likely this probe has no IPv6 route rather than 2001:db8::1 being down. Monitor IPv6 destinations from a probe that has IPv6 connectivity.",
  [ProbeFailureCause.ProbeMayHaveNoRoute]:
    "This probe may have no route to 192.0.2.10 (ping: sendmsg: No route to host); 192.0.2.10 itself may also be down.",
  [ProbeFailureCause.ProbeHasNoRoute]:
    "This probe has no route to 192.0.2.10: ping: connect: Network is unreachable.",
  [ProbeFailureCause.ProbeCouldNotSendTraffic]:
    "This probe could not send traffic to 192.0.2.10 (ping: connect: Cannot assign requested address), so 192.0.2.10 was never contacted. The failure is on the probe, not on 192.0.2.10.",
};

const EVERY_STORED: ReadonlyArray<string> = [
  ...AS_WRITTEN_BY_HAND.map((entry: { english: string }): string => {
    return entry.english;
  }),
  ...Object.values(DESCRIBED),
];

describe("the probe writes every cause from the table, byte for byte as it did by hand", () => {
  test.each(AS_WRITTEN_BY_HAND)(
    "$cause: $english",
    (entry: {
      cause: ProbeFailureCause;
      values: Parameters<typeof writeProbeFailureCause>[1];
      english: string;
    }) => {
      expect(writeProbeFailureCause(entry.cause, entry.values)).toBe(
        entry.english,
      );
    },
  );

  test.each(Object.keys(DESCRIBED_BY_HAND))(
    "ProbeNetworkFailureUtil.describe: %s",
    (cause: string) => {
      expect(DESCRIBED[cause]).toBe(DESCRIBED_BY_HAND[cause]);
      // Every describe() sentence still opens as a probe-side cause.
      expect(ProbeNetworkFailureUtil.isProbeSideCause(DESCRIBED[cause])).toBe(
        true,
      );
    },
  );

  test("a timeout in seconds as NtpMonitor wrote it: rounded to a tenth, one second singular", () => {
    expect(writeProbeSeconds(1000)).toBe("1 second");
    expect(writeProbeSeconds(1040)).toBe("1 second");
    expect(writeProbeSeconds(2500)).toBe("2.5 seconds");
    expect(writeProbeSeconds(500)).toBe("0.5 seconds");
    expect(writeProbeSeconds(60000)).toBe("60 seconds");
  });

  test("a value goes in literally, braces and dollar signs and all", () => {
    expect(
      writeProbeFailureCause(ProbeFailureCause.NtpRequestFailed, {
        target: "192.0.2.10:123",
        message: "weird {{count}} $& $1 message",
      }),
    ).toBe(
      "The NTP request to 192.0.2.10:123 failed: weird {{count}} $& $1 message.",
    );
  });

  test("the count of one writes the one sentence, never \"1 packets\"", () => {
    expect(
      writeProbeFailureCause(ProbeFailureCause.NtpNoReplyIgnoredPackets, {
        target: "t:123",
        timeoutInMs: 5000,
        count: 1,
        reply: "r",
      }),
    ).not.toContain("1 packets");
    expect(NTP_NO_REPLY_IGNORED_PACKETS.other).toBe(
      PROBE_FAILURE_CAUSES[ProbeFailureCause.NtpNoReplyIgnoredPackets],
    );
  });
});

describe("a stored cause is read back only when it is exactly one of the table's", () => {
  test.each(AS_WRITTEN_BY_HAND)(
    "reads $cause back with its values as stored",
    (entry: { cause: ProbeFailureCause; english: string }) => {
      const reading: ProbeFailureCauseReading | null = readProbeFailureCause(
        entry.english,
      );

      expect(reading?.cause).toBe(entry.cause);
    },
  );

  test.each(Object.keys(DESCRIBED))("reads %s back", (cause: string) => {
    expect(readProbeFailureCause(DESCRIBED[cause])?.cause).toBe(cause);
  });

  test("reads the values as the probe wrote them", () => {
    expect(
      readProbeFailureCause(
        "No NTP reply from 192.0.2.10:123 within 2.5 seconds.",
      )?.values,
    ).toEqual({ target: "192.0.2.10:123", seconds: "2.5 seconds" });
    expect(
      readProbeFailureCause(
        DESCRIBED[ProbeFailureCause.ProbeCouldNotOpenIPv6Connection],
      )?.values,
    ).toEqual({ detail: DETAIL, host: "2001:db8::1" });
    expect(
      readProbeFailureCause(
        "The NTP request to 192.0.2.10:123 failed: send failed (ENOBUFS).",
      ),
    ).toEqual({
      cause: ProbeFailureCause.NtpRequestFailedWithCode,
      values: {
        target: "192.0.2.10:123",
        message: "send failed",
        code: "ENOBUFS",
      },
    });
  });

  test("space round the text aside", () => {
    expect(
      readProbeFailureCause(
        "  Could not resolve time.example.invalid (ENOTFOUND).\n",
      )?.cause,
    ).toBe(ProbeFailureCause.NtpNameDidNotResolve);
  });

  test("a cause the probe holds inside another is read as the one round it", () => {
    const tried: ProbeFailureCauseReading | null = readProbeFailureCause(
      "No NTP reply from t.example:123 within 5 seconds. The probe ignored a packet that did not answer its request: a stray reply. Tried 3 times.",
    );

    expect(tried?.cause).toBe(ProbeFailureCause.TriedTimes);
    expect(tried?.values["count"]).toBe("3");
    expect(tried?.values["cause"]).toBe(
      "No NTP reply from t.example:123 within 5 seconds. The probe ignored a packet that did not answer its request: a stray reply.",
    );
    expect(
      readProbeFailureCause(
        `Request failed with AggregateError (all connection attempts failed). ${DESCRIBED[ProbeFailureCause.ProbeCannotSendIPv6]}`,
      )?.cause,
    ).toBe(ProbeFailureCause.AllConnectionAttemptsFailed);
  });

  test("a value that holds a fixed piece of its sentence is split where the probe put it", () => {
    // The OS's own words hold the "), so " that follows them.
    const detail: string = "odd (a), so (b) text";
    const stored: string = ProbeNetworkFailureUtil.describe({
      host: "192.0.2.10",
      failure: {
        kind: ProbeNetworkFailureKind.NoSourceAddress,
        isCertain: true,
        detail: detail,
      },
    });

    expect(readProbeFailureCause(stored)?.values).toEqual({
      host: "192.0.2.10",
      detail: detail,
    });

    // A message that holds " (" before the code.
    expect(
      readProbeFailureCause(
        "The NTP request to t:123 failed: send (it) broke (EPERM).",
      )?.values,
    ).toEqual({ target: "t:123", message: "send (it) broke", code: "EPERM" });

    // A packet that holds " within " and the sentence's own stop.
    expect(
      readProbeFailureCause(
        "No NTP reply from t:123 within 5 seconds. The probe ignored 2 packets that did not answer its request: x within y. z.",
      )?.values,
    ).toEqual({
      target: "t:123",
      seconds: "5 seconds",
      count: "2",
      reply: "x within y. z",
    });
  });

  test("a host is never split at a piece inside it: a host holds no space", () => {
    expect(
      readProbeFailureCause(
        "Looking up a within b did not finish within 5 seconds.",
      ),
    ).toBeNull();
    expect(
      readProbeFailureCause(
        "This probe has no route to 192.0.2.10: ping: connect: Network is unreachable.",
      )?.values,
    ).toEqual({
      host: "192.0.2.10",
      detail: "ping: connect: Network is unreachable",
    });
  });

  test("a value written twice must be the same both times", () => {
    expect(
      readProbeFailureCause(
        "This probe may have no route to 192.0.2.10 (x); 192.0.2.11 itself may also be down.",
      ),
    ).toBeNull();
  });

  test("a timeout the probe could not have written is not one", () => {
    for (const seconds of [
      "5 second",
      "1 seconds",
      "2.55 seconds",
      "five seconds",
      "05 seconds",
      "5 seconds ",
    ]) {
      expect({
        seconds,
        read: readProbeFailureCause(
          `Looking up pool.ntp.org did not finish within ${seconds}.`,
        ),
      }).toEqual({ seconds, read: null });
    }
  });

  test("a count, a port and a code are what the probe writes", () => {
    expect(
      readProbeFailureCause(
        "No NTP reply from t:123 within 5 seconds. The probe ignored 1 packets that did not answer its request: r.",
      ),
    ).toBeNull();
    expect(
      readProbeFailureCause(
        "t:123 refused the request: nothing is listening for NTP on UDP port one there (ICMP port unreachable).",
      ),
    ).toBeNull();
    expect(
      readProbeFailureCause("Could not resolve t.example (not found)."),
    ).toBeNull();
    // " Tried 1 times." is never written: one attempt adds nothing.
    expect(
      readProbeFailureCause(
        "No NTP reply from t:123 within 5 seconds. Tried 1 times.",
      ),
    ).toBeNull();
    // The code goes in only where the message does not hold it.
    expect(
      readProbeFailureCause(
        "The NTP request to t:123 failed: send EPERM (EPERM).",
      )?.cause,
    ).toBe(ProbeFailureCause.NtpRequestFailed);
  });

  test("Tried N times round anything but one of the table's causes is not one", () => {
    expect(
      readProbeFailureCause("The server said no. Tried 3 times."),
    ).toBeNull();
  });

  test("any other text stays as written", () => {
    for (const text of [
      "",
      "   ",
      "Connection refused",
      "Looking up pool.ntp.org did not finish within 5 seconds",
      "Error: Looking up pool.ntp.org did not finish within 5 seconds.",
      "No NTP reply from 192.0.2.10:123 within 5 seconds. And more.",
      "This probe could not send traffic to x",
      "Request failed with AggregateError (all connection attempts failed). ",
      "Request failed with AggregateError (all connection attempts failed).",
    ]) {
      expect({ text, read: readProbeFailureCause(text) }).toEqual({
        text,
        read: null,
      });
    }

    expect(readProbeFailureCause(null)).toBeNull();
    expect(readProbeFailureCause(undefined)).toBeNull();
  });

  test("reads a long text in time that grows with its length", () => {
    const longDetail: string = "x), so y ".repeat(20000);
    const stored: string = `This probe could not send traffic to h (${longDetail}), so h was never contacted. The failure is on the probe, not on h.`;
    const started: number = Date.now();

    expect(readProbeFailureCause(stored)?.values["detail"]).toBe(longDetail);
    expect(readProbeFailureCause(`${"( ".repeat(50000)} Tried 3 times.`)).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test("matches a template from its two ends", () => {
    expect(
      matchProbeFailureTemplate("a-b-c", "{{message}}-{{reply}}-c"),
    ).toEqual({ message: "a", reply: "b" });
    // Two values that may hold anything: the first piece found splits them.
    expect(
      matchProbeFailureTemplate("a-b-c-c", "{{message}}-{{reply}}-c"),
    ).toEqual({ message: "a", reply: "b-c" });
    expect(
      matchProbeFailureTemplate("a-b-d", "{{message}}-{{reply}}-c"),
    ).toBeNull();
    // A value is never empty.
    expect(
      matchProbeFailureTemplate("--c", "{{message}}-{{reply}}-c"),
    ).toBeNull();
    expect(matchProbeFailureTemplate("Fixed.", "Fixed.")).toEqual({});
    expect(matchProbeFailureTemplate("Fixed!", "Fixed.")).toBeNull();
  });
});

describe("a stored cause in the reader's language", () => {
  const word: (language: string, text: string, apart?: boolean) => string | null = (
    language: string,
    text: string,
    apart: boolean = false,
  ): string | null => {
    return wordProbeFailureCause({
      translator: dashboardTranslator(language),
      failureCause: text,
      options: apart ? { setsValuesApart: true } : undefined,
    });
  };

  test("English is never reworded: a view draws the stored text", () => {
    for (const text of EVERY_STORED) {
      expect({ text, worded: word("en", text) }).toEqual({
        text,
        worded: null,
      });
      expect(getProbeMessageText({ translator: ENGLISH, message: text })).toBe(
        text,
      );
      expect(
        getProbeMessageText({
          translator: dashboardTranslator("en"),
          message: text,
        }),
      ).toBe(text);
    }
  });

  /*
   * A duration is Intl's short unit, held to its figure by a no-break
   * space: German "2,5 Sek.", whose own stop a sentence never doubles.
   */
  test("German: the sentence in German, the values as found, the timeout in German", () => {
    expect(
      word("de", "No NTP reply from 192.0.2.10:123 within 2.5 seconds."),
    ).toBe(
      `Innerhalb von 2,5${NO_BREAK_SPACE}Sek. kam keine NTP-Antwort von 192.0.2.10:123.`,
    );
    expect(word("de", "Could not resolve time.example.invalid (ENOTFOUND).")).toBe(
      "time.example.invalid konnte nicht aufgelöst werden (ENOTFOUND).",
    );
    expect(
      word("de", "No NTP reply from 192.0.2.10:123 within 5 seconds. Tried 4 times."),
    ).toBe(
      `Innerhalb von 5${NO_BREAK_SPACE}Sek. kam keine NTP-Antwort von 192.0.2.10:123. 4-mal versucht.`,
    );
    expect(
      word("de", "Looking up pool.ntp.org did not finish within 1 second."),
    ).toBe(
      `Die Suche nach pool.ntp.org wurde nicht innerhalb von 1${NO_BREAK_SPACE}Sek. abgeschlossen.`,
    );
  });

  test("Spanish: a packet the probe ignored, one and many", () => {
    expect(
      word(
        "es",
        "No NTP reply from t.example:123 within 5 seconds. The probe ignored a packet that did not answer its request: a stray reply.",
      ),
    ).toBe(
      `No llegó ninguna respuesta NTP de t.example:123 en 5${NO_BREAK_SPACE}s. La sonda ignoró un paquete que no respondía a su solicitud: a stray reply.`,
    );
    expect(
      word(
        "es",
        "No NTP reply from t.example:123 within 5 seconds. The probe ignored 3 packets that did not answer its request: a stray reply.",
      ),
    ).toBe(
      `No llegó ninguna respuesta NTP de t.example:123 en 5${NO_BREAK_SPACE}s. La sonda ignoró 3 paquetes que no respondían a su solicitud: a stray reply.`,
    );
  });

  test("Persian: the probe-side sentence in Persian, the host and the OS's words set apart", () => {
    const text: string = DESCRIBED[ProbeFailureCause.ProbeCannotSendIPv6]!;
    const worded: string = word("fa", text, true) as string;
    const words: Record<string, string> = readDashboardLocale("fa");

    expect(worded).toContain(isolated("2001:db8::1"));
    expect(worded).toContain(
      isolated("ping6: socket: Address family not supported by protocol"),
    );
    expect(withoutIsolateMarks(worded)).toBe(
      (
        words[PROBE_FAILURE_CAUSES[ProbeFailureCause.ProbeCannotSendIPv6]] as string
      )
        .split("{{detail}}")
        .join("ping6: socket: Address family not supported by protocol")
        .split("{{host}}")
        .join("2001:db8::1"),
    );
    expect(worded).not.toContain("This probe");
  });

  test("Persian: the count and the timeout in Persian digits", () => {
    const worded: string = withoutIsolateMarks(
      word(
        "fa",
        "Looking up pool.ntp.org did not finish within 2.5 seconds. Tried 3 times.",
        true,
      ) as string,
    );

    expect(worded).toContain("۲٫۵");
    expect(worded).toContain("۳");
    expect(worded).toContain("pool.ntp.org");
    // The probe's English figures are gone: only the host keeps Latin letters.
    expect(worded).not.toContain("2.5");
    expect(worded).not.toContain("seconds");
  });

  test("Arabic: the AggregateError sentence, with the sentence it holds in Arabic too", () => {
    const inner: string = DESCRIBED[ProbeFailureCause.ProbeCouldNotSendTraffic]!;
    const worded: string = withoutIsolateMarks(
      word(
        "ar",
        `Request failed with AggregateError (all connection attempts failed). ${inner}`,
        true,
      ) as string,
    );
    const words: Record<string, string> = readDashboardLocale("ar");

    expect(worded.startsWith("فشل الطلب بالخطأ AggregateError")).toBe(true);
    expect(worded).toContain(
      (words[PROBE_FAILURE_CAUSES[ProbeFailureCause.ProbeCouldNotSendTraffic]] as string)
        .split("{{host}}")
        .join("192.0.2.10")
        .split("{{detail}}")
        .join("ping: connect: Cannot assign requested address"),
    );
    expect(worded).not.toContain("This probe");
  });

  test("the AggregateError's attempts stay as the runtime wrote them", () => {
    const worded: string = withoutIsolateMarks(
      word(
        "de",
        "Request failed with AggregateError (all connection attempts failed). AggregateError. Attempts: Error: connect ECONNREFUSED ::1:80; Error: connect ECONNREFUSED 127.0.0.1:80",
      ) as string,
    );

    expect(worded).toBe(
      "Die Anfrage ist mit AggregateError fehlgeschlagen (alle Verbindungsversuche sind fehlgeschlagen). AggregateError. Versuche: Error: connect ECONNREFUSED ::1:80; Error: connect ECONNREFUSED 127.0.0.1:80",
    );
  });

  test("a language with no wording of the cause yet draws it as stored", () => {
    const silent: Translator = createTranslator((): undefined => {
      return undefined;
    }, "de");

    for (const text of EVERY_STORED) {
      expect(
        wordProbeFailureCause({ translator: silent, failureCause: text }),
      ).toBeNull();
      expect(getProbeMessageText({ translator: silent, message: text })).toBe(
        text,
      );
    }
  });

  test.each(DASHBOARD_LANGUAGES)(
    "%s words every cause, no English sentence left and every value kept",
    (language: string) => {
      for (const text of EVERY_STORED) {
        const worded: string | null = word(language, text, true);

        expect({ language, text, worded: worded !== null }).toEqual({
          language,
          text,
          worded: true,
        });

        const plain: string = withoutIsolateMarks(worded as string);
        const reading: ProbeFailureCauseReading = readProbeFailureCause(
          text,
        ) as ProbeFailureCauseReading;

        for (const name of ["host", "target", "code", "detail", "message", "reply", "attempts"]) {
          const value: string | undefined = reading.values[name];

          if (value !== undefined) {
            expect({ language, name, kept: plain.includes(value) }).toEqual({
              language,
              name,
              kept: true,
            });
          }
        }

        expect({ language, text, english: plain.includes("This probe ") }).toEqual(
          { language, text, english: false },
        );

        // A unit's own stop ("Sek.", "sek.") never doubles the sentence's.
        expect({ language, text, doubled: plain.includes("..") }).toEqual({
          language,
          text,
          doubled: false,
        });
      }
    },
  );

  test("the summaries draw them: the Error line and the overview's cause", () => {
    const text: string = "Could not resolve time.example.invalid (ENOTFOUND).";

    expect(
      withoutIsolateMarks(
        getProbeMessageText({
          translator: dashboardTranslator("de"),
          message: text,
        }),
      ),
    ).toBe("time.example.invalid konnte nicht aufgelöst werden (ENOTFOUND).");
    expect(
      getProbeFailureCauseText({
        translator: dashboardTranslator("de"),
        failureCause: text,
      }),
    ).toBe("time.example.invalid konnte nicht aufgelöst werden (ENOTFOUND).");
    // The overview's line is not set apart: it is not only drawn on the page.
    expect(
      getProbeFailureCauseText({
        translator: dashboardTranslator("fa"),
        failureCause: text,
      }),
    ).toBe(withoutIsolateMarks(
      getProbeFailureCauseText({
        translator: dashboardTranslator("fa"),
        failureCause: text,
      }),
    ));
  });
});

describe("the table's words in the Dashboard's locales", () => {
  const KEYS: ReadonlyArray<string> = [
    ...Object.values(PROBE_FAILURE_CAUSES),
    `${NTP_NO_REPLY_IGNORED_PACKETS.other}_one`,
  ];

  test("English holds each key as its English, and the one sentence under _one", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    for (const key of Object.values(PROBE_FAILURE_CAUSES)) {
      expect({ key, english: english[key] }).toEqual({ key, english: key });
    }

    expect(english[`${NTP_NO_REPLY_IGNORED_PACKETS.other}_one`]).toBe(
      NTP_NO_REPLY_IGNORED_PACKETS.one,
    );
  });

  test.each(DASHBOARD_LANGUAGES)(
    "%s words every one, keeping its placeholders and its error names",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);
      const english: Record<string, string> = readDashboardLocale("en");

      for (const key of KEYS) {
        const wording: string | undefined = words[key];

        expect({ language, key, worded: Boolean(wording) && wording !== english[key] }).toEqual({
          language,
          key,
          worded: true,
        });
        expect({ language, key, placeholders: placeholdersOf(wording || "") }).toEqual({
          language,
          key,
          placeholders: placeholdersOf(english[key] || ""),
        });

        for (const name of ["AggregateError", "NTP", "IPv6", "UDP", "ICMP"]) {
          if ((english[key] || "").includes(name)) {
            expect({ language, key, name, kept: (wording || "").includes(name) }).toEqual({
              language,
              key,
              name,
              kept: true,
            });
          }
        }
      }
    },
  );
});
