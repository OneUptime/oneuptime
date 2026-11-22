import { describe, expect, test } from "@jest/globals";
import { createTranslator, Translator } from "../../../Types/Translator";
import {
  getProbeFailureCauseText,
  getProbeMessageText,
} from "../../../Utils/Monitor/ProbeFailureReading";
import {
  matchProbeFailureTemplate,
  NTP_KISS_CODE_MEANINGS,
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
import NtpMonitorUtil from "../../../Types/Monitor/NtpMonitor/NtpMonitorUtil";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  placeholdersOf,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
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

// describe()'s certain IPv6 sentence, as the Ping check holds it in its message.
const DESCRIBED_BY_HAND_IPV6: string =
  "This probe cannot send IPv6 traffic (ping6: connect: Network is unreachable), so 2001:db8::1 was never contacted. The probe has no usable IPv6 address or route; this says nothing about whether 2001:db8::1 is up. Monitor IPv6 destinations from a probe that has IPv6 connectivity.";

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

/*
 * #8656: the NTP server that answered but is not synchronized, a Website
 * attempt the server answered with an error, the Ping check's messages and
 * a traceroute that could not run - word for word as the checks wrote them
 * by hand, and as they write them now.
 */
const NOT_SYNCHRONIZED: ReadonlyArray<{ written: string; english: string }> = [
  {
    written: NtpMonitorUtil.describeWhyNotSynchronized(
      { isSynchronized: false, stratum: 0, kissCode: "RATE" },
      true,
    ),
    english:
      "The server answered with a kiss-o'-death (RATE): the server is rate-limiting this probe and asks it to poll less often.",
  },
  {
    written: NtpMonitorUtil.describeWhyNotSynchronized(
      { isSynchronized: false, stratum: 0, kissCode: "ZZZZ" },
      true,
    ),
    english:
      "The server answered with a kiss-o'-death (ZZZZ): the server answered with the kiss code ZZZZ instead of the time.",
  },
  {
    written: NtpMonitorUtil.describeWhyNotSynchronized(
      { isSynchronized: false, stratum: 0 },
      true,
    ),
    english:
      "The server answered with stratum 0: it does not know its stratum, so it is not synchronized.",
  },
  {
    written: NtpMonitorUtil.describeWhyNotSynchronized(
      { isSynchronized: false, stratum: 2 },
      false,
    ),
    english: "The server answered, but its reply carried no usable time.",
  },
  {
    written: NtpMonitorUtil.describeWhyNotSynchronized(
      { isSynchronized: false, stratum: 2, leapIndicator: 3 },
      true,
    ),
    english:
      "The server reports its clock as not synchronized (leap indicator 3, alarm).",
  },
  {
    written: NtpMonitorUtil.describeWhyNotSynchronized(
      { isSynchronized: false, stratum: 16 },
      true,
    ),
    english:
      "The server reports stratum 16: it is not synchronized to a time source.",
  },
  {
    written: NtpMonitorUtil.describeWhyNotSynchronized(
      { isSynchronized: false, stratum: 3 },
      true,
    ),
    english: "The server is not synchronized.",
  },
];

const MONITOR_ID: string = "22222222-2222-4222-8222-222222222222";

const NO_ECHO: string = writeProbeFailureCause(
  ProbeFailureCause.PingNoEchoReply,
  { host: "192.0.2.10", count: 5 },
);

// The Ping monitor stores its thrown error's text: "Error: " and the message.
const PING_STORED: ReadonlyArray<{ written: string; english: string }> = [
  {
    written: `Error: ${writeProbeFailureCause(ProbeFailureCause.PingUnableToReachHost, { host: "192.0.2.10", cause: NO_ECHO, monitorId: MONITOR_ID })}`,
    english: `Error: Unable to reach host 192.0.2.10. No ICMP echo reply from 192.0.2.10 (5 sent) Monitor ID: ${MONITOR_ID}`,
  },
  {
    written: `Error: ${writeProbeFailureCause(ProbeFailureCause.PingUnableToReachHost, { host: "db.example.com", cause: writeProbeFailureCause(ProbeFailureCause.PingCouldNotResolve, { host: "db.example.com", output: "ping: db.example.com: Name or service not known" }), monitorId: MONITOR_ID })}`,
    english: `Error: Unable to reach host db.example.com. This probe could not resolve db.example.com: ping: db.example.com: Name or service not known Monitor ID: ${MONITOR_ID}`,
  },
  {
    written: `Error: ${writeProbeFailureCause(ProbeFailureCause.PingProbeSide, { cause: writeProbeFailureCause(ProbeFailureCause.PingIcmpNotUsable, { output: "ping: socket: Operation not permitted" }), monitorId: MONITOR_ID })}`,
    english: `Error: ICMP ping is not usable on this probe: ping: socket: Operation not permitted Monitor ID: ${MONITOR_ID}`,
  },
  {
    // A check with no monitor (Test Monitor) writes the id as undefined.
    written: `Error: ${writeProbeFailureCause(ProbeFailureCause.PingProbeSide, { cause: DESCRIBED_BY_HAND_IPV6, monitorId: String(undefined) })}`,
    english: `Error: ${DESCRIBED_BY_HAND_IPV6} Monitor ID: undefined`,
  },
];

const TRACEROUTE_STORED: ReadonlyArray<{ written: string; english: string }> = [
  {
    written: writeProbeFailureCause(ProbeFailureCause.TracerouteCouldNotRun, {
      clause: ProbeNetworkFailureUtil.describeClause({
        host: "2001:db8::7",
        failure: {
          kind: ProbeNetworkFailureKind.NoSourceAddress,
          isCertain: true,
          detail: "connect: Cannot assign requested address",
        },
      }),
    }),
    english:
      "Traceroute could not run: this probe cannot send IPv6 traffic (connect: Cannot assign requested address).",
  },
  {
    written: writeProbeFailureCause(ProbeFailureCause.TracerouteCouldNotRun, {
      clause: ProbeNetworkFailureUtil.describeClause({
        host: "192.0.2.1",
        failure: {
          kind: ProbeNetworkFailureKind.NoRouteToHost,
          isCertain: false,
          detail: "connect: No route to host",
        },
      }),
    }),
    english:
      "Traceroute could not run: this probe may have no route to 192.0.2.1 (connect: No route to host); 192.0.2.1 itself may also be down.",
  },
];

const SERVER_RETURNED: string = writeProbeFailureCause(
  ProbeFailureCause.ServerReturned,
  { status: 503 },
);

/*
 * #9759: a step that needs a one-time code, kept from a custom probe too
 * old to make one, whose result OneUptime writes for the probe.
 */
const TOO_OLD_FOR_ONE_TIME_CODES: string = writeProbeFailureCause(
  ProbeFailureCause.ProbeTooOldForOneTimeCodes,
  { version: "17.0.1" },
);

// #9737: an API check whose body is not JSON, so its request was not sent.
const REQUEST_BODY_NOT_JSON: string = writeProbeFailureCause(
  ProbeFailureCause.RequestBodyNotJson,
);

const EVERY_STORED: ReadonlyArray<string> = [
  ...AS_WRITTEN_BY_HAND.map((entry: { english: string }): string => {
    return entry.english;
  }),
  ...Object.values(DESCRIBED),
  ...[...NOT_SYNCHRONIZED, ...PING_STORED, ...TRACEROUTE_STORED].map(
    (entry: { english: string }): string => {
      return entry.english;
    },
  ),
  SERVER_RETURNED,
  TOO_OLD_FOR_ONE_TIME_CODES,
  REQUEST_BODY_NOT_JSON,
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

  test('the count of one writes the one sentence, never "1 packets"', () => {
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
    const unmatched: string = `${"( ".repeat(50000)} Tried 3 times.`;
    const read: FastestRun<Array<ProbeFailureCauseReading | null>> = fastestRun(
      {
        run: (): Array<ProbeFailureCauseReading | null> => {
          return [
            readProbeFailureCause(stored),
            readProbeFailureCause(unmatched),
          ];
        },
        limitInMs: 2000,
      },
    );

    expect(read.result[0]?.values["detail"]).toBe(longDetail);
    expect(read.result[1]).toBeNull();
    expect(read.inMs).toBeLessThan(2000);
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
  const word: (
    language: string,
    text: string,
    apart?: boolean,
  ) => string | null = (
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
    expect(
      word("de", "Could not resolve time.example.invalid (ENOTFOUND)."),
    ).toBe("time.example.invalid konnte nicht aufgelöst werden (ENOTFOUND).");
    expect(
      word(
        "de",
        "No NTP reply from 192.0.2.10:123 within 5 seconds. Tried 4 times.",
      ),
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
        words[
          PROBE_FAILURE_CAUSES[ProbeFailureCause.ProbeCannotSendIPv6]
        ] as string
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
    const inner: string =
      DESCRIBED[ProbeFailureCause.ProbeCouldNotSendTraffic]!;
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
      (
        words[
          PROBE_FAILURE_CAUSES[ProbeFailureCause.ProbeCouldNotSendTraffic]
        ] as string
      )
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

        for (const name of [
          "host",
          "target",
          "code",
          "detail",
          "message",
          "reply",
          "attempts",
          "kissCode",
          "output",
          "monitorId",
          "status",
        ]) {
          const value: string | undefined = reading.values[name];

          if (value !== undefined) {
            expect({ language, name, kept: plain.includes(value) }).toEqual({
              language,
              name,
              kept: true,
            });
          }
        }

        expect({
          language,
          text,
          english: plain.includes("This probe "),
        }).toEqual({ language, text, english: false });

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
    ).toBe(
      withoutIsolateMarks(
        getProbeFailureCauseText({
          translator: dashboardTranslator("fa"),
          failureCause: text,
        }),
      ),
    );
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

        expect({
          language,
          key,
          worded: Boolean(wording) && wording !== english[key],
        }).toEqual({
          language,
          key,
          worded: true,
        });
        expect({
          language,
          key,
          placeholders: placeholdersOf(wording || ""),
        }).toEqual({
          language,
          key,
          placeholders: placeholdersOf(english[key] || ""),
        });

        for (const name of ["AggregateError", "NTP", "IPv6", "UDP", "ICMP"]) {
          if ((english[key] || "").includes(name)) {
            expect({
              language,
              key,
              name,
              kept: (wording || "").includes(name),
            }).toEqual({
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

/*
 * #8656: the NTP server that answered but is not synchronized, a Website
 * or API attempt the server answered with an error, the Ping check's
 * messages and a traceroute that could not run.
 */
describe("the other causes the checks write (#8656)", () => {
  test.each([...NOT_SYNCHRONIZED, ...PING_STORED, ...TRACEROUTE_STORED])(
    "written from the table as by hand: $english",
    (entry: { written: string; english: string }) => {
      expect(entry.written).toBe(entry.english);
      expect(readProbeFailureCause(entry.english)).not.toBeNull();
    },
  );

  test("a step kept from a probe too old to make one-time codes (#9759)", () => {
    expect(TOO_OLD_FOR_ONE_TIME_CODES).toBe(
      "This check needs a one-time code, and this probe is too old to make one, so the check did not run. Update the probe to OneUptime 17.0.1 or later.",
    );
    expect(readProbeFailureCause(TOO_OLD_FOR_ONE_TIME_CODES)).toEqual({
      cause: ProbeFailureCause.ProbeTooOldForOneTimeCodes,
      values: { version: "17.0.1" },
    });
    // A release holds no space: anything else in its place is not the sentence.
    expect(
      readProbeFailureCause(
        "This check needs a one-time code, and this probe is too old to make one, so the check did not run. Update the probe to OneUptime 17 point 1 or later.",
      ),
    ).toBeNull();
  });

  test("an API check whose request body is not JSON, so nothing was sent (#9737)", () => {
    expect(REQUEST_BODY_NOT_JSON).toBe(
      "The request body is not valid JSON, so the request was not sent. Correct the body, or the value of a monitor secret it uses.",
    );
    expect(readProbeFailureCause(REQUEST_BODY_NOT_JSON)).toEqual({
      cause: ProbeFailureCause.RequestBodyNotJson,
      values: {},
    });
    // The sentence whole and nothing more: a longer text is not OneUptime's own.
    expect(
      readProbeFailureCause(`${REQUEST_BODY_NOT_JSON} Line 3, column 7.`),
    ).toBeNull();
    expect(
      wordProbeFailureCause({
        translator: dashboardTranslator("de"),
        failureCause: REQUEST_BODY_NOT_JSON,
      }),
    ).toBe(
      "Der Anfragetext ist kein gültiges JSON, daher wurde die Anfrage nicht gesendet. Korrigieren Sie den Anfragetext oder den Wert eines Monitor-Geheimnisses, das er verwendet.",
    );
  });

  test("an attempt the server answered with an error", () => {
    expect(SERVER_RETURNED).toBe("Server returned 503");
    expect(readProbeFailureCause(SERVER_RETURNED)?.values).toEqual({
      status: "503",
    });
    expect(readProbeFailureCause("Server returned five hundred")).toBeNull();
  });

  test("every kiss code the table names has a meaning, and the NTP check writes it", () => {
    for (const code of Object.keys(NTP_KISS_CODE_MEANINGS)) {
      const written: string = NtpMonitorUtil.describeWhyNotSynchronized(
        { isSynchronized: false, stratum: 0, kissCode: code },
        true,
      );

      expect(written).toBe(
        `The server answered with a kiss-o'-death (${code}): ${NTP_KISS_CODE_MEANINGS[code]}.`,
      );
      expect(readProbeFailureCause(written)?.cause).toBe(
        ProbeFailureCause.NtpKissOfDeath,
      );
      expect(NtpMonitorUtil.describeKissCode(code)).toBe(
        NTP_KISS_CODE_MEANINGS[code],
      );
    }

    // A meaning the table does not hold is not one of the table's.
    expect(
      readProbeFailureCause(
        "The server answered with a kiss-o'-death (RATE): the server is tired.",
      ),
    ).toBeNull();
  });

  test("the Ping check's message is read through every sentence it holds", () => {
    const reading: ProbeFailureCauseReading | null = readProbeFailureCause(
      PING_STORED[0]!.english,
    );

    expect(reading?.cause).toBe(ProbeFailureCause.ThrownError);
    expect(
      readProbeFailureCause(reading?.values["cause"], {
        among: [ProbeFailureCause.PingUnableToReachHost],
      }),
    ).toMatchObject({
      cause: ProbeFailureCause.PingUnableToReachHost,
      values: { host: "192.0.2.10", monitorId: MONITOR_ID },
    });
  });

  test("a runtime's error that holds none of the table's sentences stays as written", () => {
    for (const text of [
      "Error: connect ECONNREFUSED 192.0.2.10:443",
      "Error: Unable to reach host 192.0.2.10. Something else Monitor ID: x",
      "TypeError: No ICMP echo reply from 192.0.2.10 (5 sent) Monitor ID: x",
      "Error: The server is not synchronized.",
    ]) {
      expect({ text, read: readProbeFailureCause(text) }).toEqual({
        text,
        read: null,
      });
    }
  });

  test("a clause is only ever read inside the traceroute's sentence", () => {
    expect(
      readProbeFailureCause(
        "this probe cannot send IPv6 traffic (connect: Cannot assign requested address)",
      ),
    ).toBeNull();
    expect(
      readProbeFailureCause("Traceroute could not run: something broke."),
    ).toBeNull();
  });

  test("German, Spanish, Arabic and Persian word them, values as found", () => {
    const de: string = withoutIsolateMarks(
      wordProbeFailureCause({
        translator: dashboardTranslator("de"),
        failureCause: PING_STORED[0]!.english,
        options: { setsValuesApart: true },
      }) as string,
    );

    expect(de).toBe(
      `Fehler: Host 192.0.2.10 ist nicht erreichbar. Keine ICMP-Echo-Antwort von 192.0.2.10 (5 gesendet) Überwachungs-ID: ${MONITOR_ID}`,
    );

    const es: string = wordProbeFailureCause({
      translator: dashboardTranslator("es"),
      failureCause: NOT_SYNCHRONIZED[0]!.english,
    }) as string;

    expect(es).toBe(
      "El servidor respondió con un kiss-o'-death (RATE): el servidor está limitando la frecuencia de esta sonda y le pide que consulte con menos frecuencia.",
    );

    const ar: string = withoutIsolateMarks(
      wordProbeFailureCause({
        translator: dashboardTranslator("ar"),
        failureCause: TRACEROUTE_STORED[0]!.english,
        options: { setsValuesApart: true },
      }) as string,
    );

    expect(ar).toBe(
      "تعذّر تشغيل Traceroute: لا يستطيع هذا المسبار إرسال حركة IPv6 (connect: Cannot assign requested address).",
    );

    const fa: string = withoutIsolateMarks(
      wordProbeFailureCause({
        translator: dashboardTranslator("fa"),
        failureCause: NOT_SYNCHRONIZED[5]!.english,
        options: { setsValuesApart: true },
      }) as string,
    );

    // The stratum in Persian digits.
    expect(fa).toBe(
      "سرور لایهٔ ۱۶ را گزارش می‌دهد: با هیچ منبع زمانی همگام نیست.",
    );
    expect(
      wordProbeFailureCause({
        translator: dashboardTranslator("fa"),
        failureCause: SERVER_RETURNED,
      }),
    ).toBe("سرور 503 برگرداند");
  });

  test("the kiss codes' meanings are worded in every language", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const words: Record<string, string> = readDashboardLocale(language);

      for (const meaning of Object.values(NTP_KISS_CODE_MEANINGS)) {
        expect({
          language,
          meaning,
          worded: Boolean(words[meaning]) && words[meaning] !== meaning,
        }).toEqual({ language, meaning, worded: true });
      }
    }
  });
});
