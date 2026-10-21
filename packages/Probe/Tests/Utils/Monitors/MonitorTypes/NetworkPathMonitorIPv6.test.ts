process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import { describe, expect, it } from "@jest/globals";
import IP from "Common/Types/IP/IP";
import Hostname from "Common/Types/API/Hostname";
import URL from "Common/Types/API/URL";
import NetworkPathMonitor from "../../../../Utils/Monitors/MonitorTypes/NetworkPathMonitor";
import NetworkPathTrace, {
  TraceRoute,
  TraceRouteHop,
} from "Common/Types/Monitor/NetworkMonitor/NetworkPathTrace";

/*
 * The path diagnosis attached to every FAILED Ping/IP/Port check
 * (Probe/Utils/Monitors/Monitor.ts). It is the thing an operator looks at
 * when a monitor goes red, so for the IPv6 customer report behind this suite
 * it was the one place that could have explained what was wrong — and it
 * produced nothing at all.
 *
 * Two independent reasons, both pinned here:
 *   - a monitor destination is a base `IP`, which is an instanceof NEITHER
 *     IPv4 nor IPv6, so it fell through to the string branch and an OBJECT
 *     was handed to execFile and to the resolver;
 *   - the local "simplified" IPv6 regex refused "::1", "2001:db8::" and
 *     "::ffff:192.0.2.1", so those were treated as DNS names and traceroute
 *     was never run.
 *
 * The private helpers are reached through the class object rather than
 * reimplemented, so these fail if the real ones change.
 */

interface Internals {
  isIPAddress: (address: string) => boolean;
  isIPv6Address: (address: string) => boolean;
  isValidDestination: (destination: string) => boolean;
  parseTracerouteOutput: (
    output: string,
    isWindows: boolean,
  ) => Array<TraceRouteHop>;
  getTracerouteFailureMessage: (err: unknown, destination: string) => string;
  performTraceroute: (
    destination: string,
    maxHops: number,
    timeout: number,
  ) => Promise<TraceRoute>;
}

const internals: Internals = NetworkPathMonitor as unknown as Internals;

const CUSTOMER_ADDRESS: string = "2001:518:2800:9::2";

describe("NetworkPathMonitor.isIPAddress", () => {
  it.each([
    CUSTOMER_ADDRESS,
    "::1",
    "::",
    "2001:db8::",
    "::ffff:192.0.2.1",
    "fe80::1",
    "2001:0db8:85a3:0000:0000:8a2e:0370:7334",
    `[${CUSTOMER_ADDRESS}]`,
    "192.0.2.1",
  ])("recognises %s as an address", (address: string) => {
    expect(internals.isIPAddress(address)).toBe(true);
  });

  it.each([
    "rs1.example.net",
    "localhost",
    "",
    "not-an-address",
    "2001:db8:::1",
  ])("does not mistake %s for an address", (address: string) => {
    expect(internals.isIPAddress(address)).toBe(false);
  });
});

describe("NetworkPathMonitor.isValidDestination", () => {
  it.each([CUSTOMER_ADDRESS, "::1", "2001:db8::", "::ffff:192.0.2.1"])(
    "will run traceroute for %s",
    (address: string) => {
      /*
       * Each of these was refused outright before: the hostname fallback
       * pattern has no ":" in its character class, so the diagnosis came
       * back "Invalid destination: ::1. Must be a valid hostname or IP
       * address." for an address that plainly is one.
       */
      expect(internals.isValidDestination(address)).toBe(true);
    },
  );

  it.each(["192.0.2.1", "rs1.example.net"])(
    "still accepts %s",
    (address: string) => {
      expect(internals.isValidDestination(address)).toBe(true);
    },
  );

  it("still refuses a destination that could carry a shell argument", () => {
    expect(internals.isValidDestination("example.com; rm -rf /")).toBe(false);
    expect(internals.isValidDestination("-f")).toBe(false);
    expect(internals.isValidDestination("")).toBe(false);
  });
});

describe("NetworkPathMonitor.isIPv6Address", () => {
  it.each([CUSTOMER_ADDRESS, `[${CUSTOMER_ADDRESS}]`, "::1", "2001:db8::"])(
    "%s needs the v6 traceroute",
    (address: string) => {
      expect(internals.isIPv6Address(address)).toBe(true);
    },
  );

  it.each(["192.0.2.1", "rs1.example.net"])(
    "%s does not",
    (address: string) => {
      expect(internals.isIPv6Address(address)).toBe(false);
    },
  );
});

describe("NetworkPathMonitor.trace — the destination it actually traces", () => {
  /*
   * A real traceroute is not run here: each of these asserts the string the
   * rest of the method works from, which is where both bugs lived. An
   * unroutable documentation address (RFC 3849 / RFC 5737) keeps the exec
   * itself short and harmless.
   */
  const unroutableV6: string = "2001:db8::1";
  const unroutableV4: string = "192.0.2.1";

  it("a base IP instance is traced by ADDRESS, not by [object Object]", async () => {
    /*
     * MonitorStep.fromJSON rebuilds a destination with `new IP(...)`, which
     * is an instanceof neither IPv4 nor IPv6. That object used to reach
     * execFile directly and throw ERR_INVALID_ARG_TYPE into a catch that
     * swallowed it, so EVERY Ping/IP monitor — v4 and v6 alike — got an
     * empty traceroute.
     */
    const result: NetworkPathTrace = await NetworkPathMonitor.trace(
      IP.fromString(unroutableV6),
      {
        timeout: 1500,
        maxHops: 1,
      },
    );

    expect(result.traceRoute?.destinationAddress).toBe(unroutableV6);
    expect(typeof result.traceRoute?.destinationAddress).toBe("string");
  });

  it("the same is true for an IPv4 monitor destination", async () => {
    const result: NetworkPathTrace = await NetworkPathMonitor.trace(
      IP.fromString(unroutableV4),
      {
        timeout: 1500,
        maxHops: 1,
      },
    );

    expect(result.traceRoute?.destinationAddress).toBe(unroutableV4);
  });

  it("an IP literal is never sent to the resolver", async () => {
    /*
     * DNS is for names. "::1" used to miss the address check and get a
     * queryA, which came back EBADNAME and filled the DNS panel with a
     * failure about an address that never needed resolving.
     */
    const result: NetworkPathTrace = await NetworkPathMonitor.trace(
      IP.fromString("::1"),
      {
        timeout: 1500,
        maxHops: 1,
      },
    );

    expect(result.dnsLookup).toBeUndefined();
  });

  it("a bracketed IPv6 destination is unwrapped", async () => {
    const result: NetworkPathTrace = await NetworkPathMonitor.trace(
      new Hostname(`[${unroutableV6}]`),
      { timeout: 1500, maxHops: 1 },
    );

    expect(result.traceRoute?.destinationAddress).toBe(unroutableV6);
    expect(result.dnsLookup).toBeUndefined();
  });

  it("a URL destination is unwrapped too", async () => {
    const result: NetworkPathTrace = await NetworkPathMonitor.trace(
      URL.fromString(`https://[${unroutableV6}]/`),
      { timeout: 1500, maxHops: 1 },
    );

    expect(result.traceRoute?.destinationAddress).toBe(unroutableV6);
  });
});

describe("NetworkPathMonitor traceroute parsing — IPv6 output", () => {
  const parseUnix: (output: string) => Array<TraceRouteHop> = (
    output: string,
  ): Array<TraceRouteHop> => {
    return internals.parseTracerouteOutput(output, false);
  };

  it("reads a Linux IPv6 hop that gave a name and an address", () => {
    const [hop]: Array<TraceRouteHop> = parseUnix(
      " 1  rtr.example.net (2001:db8::1)  1.234 ms  1.567 ms  1.890 ms",
    );

    expect(hop).toEqual({
      hopNumber: 1,
      hostName: "rtr.example.net",
      address: "2001:db8::1",
      roundTripTimeInMS: 1.234,
      isTimeout: false,
    });
  });

  it("reads an IPv6 hop that gave only an address", () => {
    const [hop]: Array<TraceRouteHop> = parseUnix(
      " 3  2001:518:2800:9::1  8.5 ms  9.1 ms  8.9 ms",
    );

    expect(hop!.address).toBe("2001:518:2800:9::1");
    expect(hop!.roundTripTimeInMS).toBe(8.5);
  });

  it("reads a macOS traceroute6 hop, which prints a name and NO address", () => {
    /*
     * macOS traceroute6 prints "1  localhost  0.263 ms" where the IPv4
     * traceroute beside it prints "localhost (127.0.0.1)". The hop matched
     * neither pattern and was dropped, so an IPv6 diagnosis from a macOS
     * probe came back with zero hops and nothing saying why.
     */
    const [hop]: Array<TraceRouteHop> = parseUnix(
      " 1  rtr.example.net  0.263 ms  0.259 ms  0.096 ms",
    );

    expect(hop).toEqual({
      hopNumber: 1,
      hostName: "rtr.example.net",
      address: undefined,
      roundTripTimeInMS: 0.263,
      isTimeout: false,
    });
  });

  it("skips the traceroute6 header line", () => {
    expect(
      parseUnix(
        "traceroute6 to 2001:db8::1 (2001:db8::1) from ::1, 3 hops max",
      ),
    ).toEqual([]);
  });

  it("still reads a timed-out hop", () => {
    const [hop]: Array<TraceRouteHop> = parseUnix(" 4  * * *");

    expect(hop!.isTimeout).toBe(true);
  });
});

describe("NetworkPathMonitor.getTracerouteFailureMessage — a traceroute that could not run", () => {
  /*
   * An execFile rejection, shaped the way node builds one: the message is
   * "Command failed: <argv>\n<stderr>" and the OS's own words are also on
   * err.stderr.
   */
  function execFileError(data: {
    argv: string;
    stdout: string;
    stderr: string;
  }): Error & { code: number; stdout: string; stderr: string; cmd: string } {
    return Object.assign(
      new Error(`Command failed: ${data.argv}\n${data.stderr}`),
      {
        code: 1,
        killed: false,
        signal: null,
        cmd: data.argv,
        stdout: data.stdout,
        stderr: data.stderr,
      },
    );
  }

  it("the customer's exact traceroute failure says the probe cannot send IPv6", () => {
    /*
     * Reproduced in node:26-bookworm-slim (traceroute 2.1.2) with IPv6
     * switched off on the loopback. The dashboard showed "Route did not
     * reach the destination. Command failed: traceroute -6 -m 20 -w 3
     * 2001:518:2800:9::2 connect: Cannot assign requested address" — a
     * verdict on a route no packet ever took.
     */
    const error: Error = execFileError({
      argv: `traceroute -6 -m 20 -w 3 ${CUSTOMER_ADDRESS}`,
      stdout: `traceroute to ${CUSTOMER_ADDRESS} (${CUSTOMER_ADDRESS}), 20 hops max, 80 byte packets\n`,
      stderr: "\nconnect: Cannot assign requested address\n",
    });

    expect(error.message).toBe(
      `Command failed: traceroute -6 -m 20 -w 3 ${CUSTOMER_ADDRESS}\n\nconnect: Cannot assign requested address\n`,
    );

    const message: string = internals.getTracerouteFailureMessage(
      error,
      CUSTOMER_ADDRESS,
    );

    expect(message).toBe(
      "Traceroute could not run: this probe cannot send IPv6 traffic (connect: Cannot assign requested address).",
    );
    expect(message).not.toContain("Command failed");
  });

  it("no IPv6 route on the probe is the same probe-side cause", () => {
    expect(
      internals.getTracerouteFailureMessage(
        execFileError({
          argv: `traceroute -6 -m 20 -w 3 ${CUSTOMER_ADDRESS}`,
          stdout: "",
          stderr: "\nconnect: Network is unreachable\n",
        }),
        CUSTOMER_ADDRESS,
      ),
    ).toBe(
      "Traceroute could not run: this probe cannot send IPv6 traffic (connect: Network is unreachable).",
    );
  });

  it("an IPv4 destination with no route makes no IPv6 claim", () => {
    expect(
      internals.getTracerouteFailureMessage(
        execFileError({
          argv: "traceroute -m 20 -w 3 192.0.2.1",
          stdout: "",
          stderr: "\nconnect: Network is unreachable\n",
        }),
        "192.0.2.1",
      ),
    ).toBe(
      "Traceroute could not run: this probe has no route to 192.0.2.1 (connect: Network is unreachable).",
    );
  });

  it("any other traceroute error shows the OS's words without the argv", () => {
    expect(
      internals.getTracerouteFailureMessage(
        execFileError({
          argv: "traceroute -m 20 -w 3 rs1.example.net",
          stdout: "",
          stderr:
            'rs1.example.net: Name or service not known\nCannot handle "host" cmdline arg `rs1.example.net\' on position 1 (argc 5)\n',
        }),
        "rs1.example.net",
      ),
    ).toBe(
      'rs1.example.net: Name or service not known\nCannot handle "host" cmdline arg `rs1.example.net\' on position 1 (argc 5)',
    );
  });

  it("a missing binary, which has no stderr, falls back to the message", () => {
    const error: Error = Object.assign(new Error("spawn traceroute ENOENT"), {
      code: "ENOENT",
      stdout: "",
      stderr: "",
    });

    expect(internals.getTracerouteFailureMessage(error, CUSTOMER_ADDRESS)).toBe(
      "spawn traceroute ENOENT",
    );
  });

  it.each([
    "Traceroute timed out",
    `Invalid destination: x. Must be a valid hostname or IP address.`,
  ])("our own %j is left exactly as it was", (text: string) => {
    expect(
      internals.getTracerouteFailureMessage(new Error(text), CUSTOMER_ADDRESS),
    ).toBe(text);
  });

  it("a thrown non-Error is shown as text", () => {
    expect(
      internals.getTracerouteFailureMessage("boom", CUSTOMER_ADDRESS),
    ).toBe("boom");
  });

  it("an invalid destination that happens to read like an OS error is not classified", async () => {
    /*
     * Only stderr is classified. The "Invalid destination" message quotes
     * the destination, and that must never be mistaken for the kernel
     * saying the probe has no route. Nothing is exec'd: validation refuses
     * it first.
     */
    const traceRoute: TraceRoute = await internals.performTraceroute(
      "network is unreachable",
      1,
      1000,
    );

    expect(traceRoute.failureMessage).toBe(
      "Invalid destination: network is unreachable. Must be a valid hostname or IP address.",
    );
    expect(traceRoute.hops).toEqual([]);
  });
});
