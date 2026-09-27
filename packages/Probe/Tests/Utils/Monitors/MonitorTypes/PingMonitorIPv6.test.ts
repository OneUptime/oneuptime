// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.example.com";
process.env["PROBE_KEY"] = "test-probe-key";
process.env["PROBE_ID"] = "11111111-2222-3333-4444-555555555555";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Hostname from "Common/Types/API/Hostname";
import URL from "Common/Types/API/URL";
import IP from "Common/Types/IP/IP";
import IPv6 from "Common/Types/IP/IPv6";
import PositiveNumber from "Common/Types/PositiveNumber";
import ping from "ping";
import OnlineCheck from "../../../../Utils/OnlineCheck";
import PingMonitor, {
  PingResponse,
} from "../../../../Utils/Monitors/MonitorTypes/PingMonitor";

/*
 * The Ping-MONITOR path (PingMonitor.ping) with an IPv6 destination.
 *
 * A customer had working Ping monitors on their IPv4 BGP endpoints and could
 * not get the IPv6 ones to work. Their address, used throughout, was
 * 2001:518:2800:9::2.
 *
 * Nothing here forks a ping binary: ping.promise.probe is spied on, and the
 * assertions are about the target and the config it is handed, plus how a
 * failure is explained back to the operator.
 */

const CUSTOMER_ADDRESS: string = "2001:518:2800:9::2";

function makeAliveResult(
  overrides?: Partial<ping.PingResponse>,
): ping.PingResponse {
  return {
    inputHost: CUSTOMER_ADDRESS,
    host: CUSTOMER_ADDRESS,
    numeric_host: CUSTOMER_ADDRESS,
    alive: true,
    output: "5 packets transmitted, 5 packets received, 0.0% packet loss",
    time: 12,
    times: [12, 13, 12, 14, 12],
    min: "12.000",
    max: "14.000",
    avg: "12.600",
    stddev: "0.800",
    packetLoss: "0.000",
    ...overrides,
  };
}

function makeDeadResult(output: string): ping.PingResponse {
  return makeAliveResult({
    alive: false,
    output: output,
    time: "unknown",
    times: [],
    min: "unknown",
    max: "unknown",
    avg: "unknown",
    stddev: "unknown",
    packetLoss: "unknown",
  });
}

// eslint-disable-next-line @typescript-eslint/typedef
let probeSpy = jest.spyOn(ping.promise, "probe");

beforeEach(() => {
  probeSpy = jest
    .spyOn(ping.promise, "probe")
    .mockResolvedValue(makeAliveResult());
  jest
    .spyOn(OnlineCheck, "canProbeMonitorPingMonitors")
    .mockResolvedValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("PingMonitor.ping — the IPv6 target it hands the library", () => {
  test("an IP destination is pinged at the address, with v6 set", async () => {
    await PingMonitor.ping(IP.fromString(CUSTOMER_ADDRESS) as IPv6, {
      retry: 0,
      timeout: new PositiveNumber(5000),
    });

    expect(probeSpy).toHaveBeenCalledTimes(1);
    expect(probeSpy.mock.calls[0]![0]).toBe(CUSTOMER_ADDRESS);
    expect(probeSpy.mock.calls[0]![1]).toMatchObject({ v6: true });
  });

  test("an IPv4 destination still goes out with v6 off", async () => {
    await PingMonitor.ping(IP.fromString("192.0.2.1") as never, {
      retry: 0,
      timeout: new PositiveNumber(5000),
    });

    expect(probeSpy.mock.calls[0]![0]).toBe("192.0.2.1");
    expect(probeSpy.mock.calls[0]![1]).toMatchObject({ v6: false });
  });

  test("the family is stated rather than left to the library to sniff", async () => {
    /*
     * ping-promise only auto-detects when v6 is absent, and it detects by
     * running net.isIPv6 over the string it was given — so a bracketed
     * literal, or an address that arrived as a Hostname, would silently
     * pick the IPv4 binary.
     */
    await PingMonitor.ping(new Hostname(`[${CUSTOMER_ADDRESS}]`), {
      retry: 0,
      timeout: new PositiveNumber(5000),
    });

    expect(probeSpy.mock.calls[0]![1]).toHaveProperty("v6", true);
  });

  test("a bracketed IPv6 literal is unwrapped before it reaches ping", async () => {
    /*
     * "[2001:518:2800:9::2]" is URL syntax. Passed through, ping treats it
     * as a NAME and answers "unknown host" for an address that needs no
     * DNS at all.
     */
    await PingMonitor.ping(new Hostname(`[${CUSTOMER_ADDRESS}]`), {
      retry: 0,
      timeout: new PositiveNumber(5000),
    });

    expect(probeSpy.mock.calls[0]![0]).toBe(CUSTOMER_ADDRESS);
  });

  test("a URL destination is unwrapped the same way", async () => {
    await PingMonitor.ping(URL.fromString(`https://[${CUSTOMER_ADDRESS}]/`), {
      retry: 0,
      timeout: new PositiveNumber(5000),
    });

    expect(probeSpy.mock.calls[0]![0]).toBe(CUSTOMER_ADDRESS);
    expect(probeSpy.mock.calls[0]![1]).toMatchObject({ v6: true });
  });

  test("a reachable IPv6 host is online with its round-trip time", async () => {
    const response: PingResponse | null = await PingMonitor.ping(
      IP.fromString(CUSTOMER_ADDRESS) as IPv6,
      { retry: 0, timeout: new PositiveNumber(5000) },
    );

    expect(response?.isOnline).toBe(true);
    expect(response?.responseTimeInMS?.toNumber()).toBe(13);
    expect(response?.pingResponse?.packetsReceived).toBe(5);
    expect(response?.failureCause).toBe("");
  });

  test("each attempt gets its own config object, which the library mutates", async () => {
    probeSpy.mockResolvedValue(makeDeadResult("100% packet loss"));

    await PingMonitor.ping(IP.fromString(CUSTOMER_ADDRESS) as IPv6, {
      retry: 1,
      timeout: new PositiveNumber(5000),
    });

    expect(probeSpy).toHaveBeenCalledTimes(2);
    expect(probeSpy.mock.calls[0]![1]).not.toBe(probeSpy.mock.calls[1]![1]);
  });
});

describe("PingMonitor.ping — why an IPv6 check failed", () => {
  test("a probe with no IPv6 route says so, instead of blaming the peer", async () => {
    /*
     * This is what a probe container on a default Docker bridge produces:
     * IPv4 egress works, IPv6 has no route at all, and the kernel refuses
     * before a packet leaves. It used to be reported as the same bare
     * "Unable to reach host 2001:518:2800:9::2" as a genuinely dead peer,
     * with the real reason discarded — which is exactly what makes an IPv6
     * monitor look like it cannot be made to work.
     */
    probeSpy.mockResolvedValue(
      makeDeadResult("ping6: connect: Network is unreachable"),
    );

    const response: PingResponse | null = await PingMonitor.ping(
      IP.fromString(CUSTOMER_ADDRESS) as IPv6,
      { retry: 0, timeout: new PositiveNumber(5000) },
    );

    expect(response?.isOnline).toBe(false);
    expect(response?.failureCause).toContain(
      "This probe cannot send IPv6 traffic (ping6: connect: Network is unreachable)",
    );
    expect(response?.failureCause).toContain(
      `${CUSTOMER_ADDRESS} was never contacted`,
    );
    expect(response?.failureCause).not.toContain("Unable to reach host");
    expect(response?.failureCause).not.toContain("No ICMP echo reply");
  });

  test("the same failure on IPv4 does not claim an IPv6 problem", async () => {
    probeSpy.mockResolvedValue(
      makeDeadResult("ping: connect: Network is unreachable"),
    );

    const response: PingResponse | null = await PingMonitor.ping(
      IP.fromString("192.0.2.1") as never,
      { retry: 0, timeout: new PositiveNumber(5000) },
    );

    expect(response?.failureCause).toContain("no route");
    expect(response?.failureCause).not.toContain("IPv6");
  });

  test("a peer that simply does not answer is still reported as no reply", async () => {
    probeSpy.mockResolvedValue(
      makeDeadResult(
        "5 packets transmitted, 0 packets received, 100.0% packet loss",
      ),
    );

    const response: PingResponse | null = await PingMonitor.ping(
      IP.fromString(CUSTOMER_ADDRESS) as IPv6,
      { retry: 0, timeout: new PositiveNumber(5000) },
    );

    expect(response?.isOnline).toBe(false);
    expect(response?.failureCause).toContain("No ICMP echo reply");
    expect(response?.failureCause).not.toContain("no route");
  });

  test("a router's ICMP unreachable is a real outage, not a probe problem", async () => {
    /*
     * "Destination Host Unreachable" comes BACK from a router about the
     * target. Folding it in with the probe's own no-route case would blame
     * the wrong side.
     */
    probeSpy.mockResolvedValue(
      makeDeadResult(
        "From 2001:db8::1 icmp_seq=1 Destination Host Unreachable",
      ),
    );

    const response: PingResponse | null = await PingMonitor.ping(
      IP.fromString(CUSTOMER_ADDRESS) as IPv6,
      { retry: 0, timeout: new PositiveNumber(5000) },
    );

    expect(response?.failureCause).toContain("No ICMP echo reply");
    expect(response?.failureCause).not.toContain("This probe has no route");
  });

  test("a name that never resolved says that, rather than 'no reply'", async () => {
    probeSpy.mockResolvedValue(
      makeDeadResult("ping: rs1.example.net: Name or service not known"),
    );

    const response: PingResponse | null = await PingMonitor.ping(
      new Hostname("rs1.example.net"),
      { retry: 0, timeout: new PositiveNumber(5000) },
    );

    expect(response?.failureCause).toContain("could not resolve");
  });

  test("a probe that cannot use ICMP at all still reports that first", async () => {
    probeSpy.mockResolvedValue(
      makeDeadResult("ping: socket: Operation not permitted"),
    );

    const response: PingResponse | null = await PingMonitor.ping(
      IP.fromString(CUSTOMER_ADDRESS) as IPv6,
      { retry: 0, timeout: new PositiveNumber(5000) },
    );

    expect(response?.failureCause).toContain("not usable on this probe");
  });
});

describe("PingMonitor.ping — a probe that cannot send IPv6 at all", () => {
  /*
   * THE CUSTOMER'S REPORT. Their IPv6 Ping monitor on 2001:518:2800:9::2
   * went red with "Unable to reach host 2001:518:2800:9::2. No ICMP echo
   * reply from 2001:518:2800:9::2 (5 sent)" — while the host answered 5/5
   * echoes from anywhere with IPv6. The probe had IPv6 switched off on its
   * loopback, and this, exactly, is what ping6 printed there (reproduced in
   * node:26-bookworm-slim with iputils-ping 20221126, `lo.disable_ipv6=1`).
   * The library resolves alive=false with it in `output`; it never rejects.
   */
  const CUSTOMER_PING6_OUTPUT: string =
    "ping6: connect: Cannot assign requested address\n";

  test("the customer's exact output is reported as the probe's problem, not the host's", async () => {
    probeSpy.mockResolvedValue(
      makeAliveResult({
        alive: false,
        host: "connect:",
        numeric_host: undefined,
        output: CUSTOMER_PING6_OUTPUT,
        time: "unknown",
        times: [],
        min: "unknown",
        max: "unknown",
        avg: "unknown",
        stddev: "unknown",
        packetLoss: "unknown",
      }),
    );

    const response: PingResponse | null = await PingMonitor.ping(
      IP.fromString(CUSTOMER_ADDRESS) as IPv6,
      { retry: 0, timeout: new PositiveNumber(5000) },
    );

    expect(response?.isOnline).toBe(false);
    expect(response?.isTimeout).toBe(false);
    expect(response?.failureCause).toContain(
      `This probe cannot send IPv6 traffic (ping6: connect: Cannot assign requested address), so ${CUSTOMER_ADDRESS} was never contacted.`,
    );
    expect(response?.failureCause).toContain(
      `this says nothing about whether ${CUSTOMER_ADDRESS} is up`,
    );
    expect(response?.failureCause).not.toContain("No ICMP echo reply");
    expect(response?.failureCause).not.toContain("Unable to reach host");
  });

  test("every retry attempt carries the same probe-side cause, and the retries are unchanged", async () => {
    probeSpy.mockResolvedValue(makeDeadResult(CUSTOMER_PING6_OUTPUT));

    const response: PingResponse | null = await PingMonitor.ping(
      IP.fromString(CUSTOMER_ADDRESS) as IPv6,
      { retry: 3, timeout: new PositiveNumber(5000) },
    );

    // Attempt 1/4 .. 4/4, as in the customer's Retry Attempts card.
    expect(probeSpy).toHaveBeenCalledTimes(4);
    expect(response?.isOnline).toBe(false);
    expect(response?.totalAttempts).toBe(4);

    for (const attempt of response?.probeAttempts || []) {
      expect(attempt.isOnline).toBe(false);
      expect(attempt.failureCause).toContain(
        "This probe cannot send IPv6 traffic",
      );
      expect(attempt.failureCause).not.toContain("Unable to reach host");
      expect(attempt.failureCause).not.toContain("No ICMP echo reply");
    }
  });

  test.each([
    // A Docker bridge without --ipv6.
    "ping6: connect: Network is unreachable\n",
    // macOS/BSD's spelling of EADDRNOTAVAIL.
    "ping6: connect: Can't assign requested address\n",
  ])("%j is the same probe-side cause", async (output: string) => {
    probeSpy.mockResolvedValue(makeDeadResult(output));

    const response: PingResponse | null = await PingMonitor.ping(
      IP.fromString(CUSTOMER_ADDRESS) as IPv6,
      { retry: 0, timeout: new PositiveNumber(5000) },
    );

    expect(response?.isOnline).toBe(false);
    expect(response?.failureCause).toContain(
      `This probe cannot send IPv6 traffic (${output.trim()})`,
    );
    expect(response?.failureCause).not.toContain("Unable to reach host");
  });

  test("IPv6 disabled in the kernel is no IPv6, not 'ICMP unusable', despite its 'socket:' prefix", async () => {
    /*
     * The infra markers include "socket:", which would otherwise claim ICMP
     * is broken on a probe whose IPv4 pings are working fine.
     */
    probeSpy.mockResolvedValue(
      makeDeadResult(
        "ping6: socket: Address family not supported by protocol\n",
      ),
    );

    const response: PingResponse | null = await PingMonitor.ping(
      IP.fromString(CUSTOMER_ADDRESS) as IPv6,
      { retry: 0, timeout: new PositiveNumber(5000) },
    );

    expect(response?.failureCause).toContain(
      "This probe cannot send IPv6 traffic (ping6: socket: Address family not supported by protocol)",
    );
    expect(response?.failureCause).not.toContain("not usable on this probe");
  });

  test("a next hop that answers 'Address unreachable' is still the host's outage", async () => {
    /*
     * The real network failure, reproduced beside the probe-side ones: a
     * route to a dead next hop. The kernel DID send, and a neighbour lookup
     * gave up on the far side, so this keeps the ordinary no-reply verdict.
     */
    probeSpy.mockResolvedValue(
      makeDeadResult(
        [
          "PING 2001:518:2800:9::2(2001:518:2800:9::2) 56 data bytes",
          "From fe80::1%eth0 icmp_seq=1 Destination unreachable: Address unreachable",
          "",
          "--- 2001:518:2800:9::2 ping statistics ---",
          "5 packets transmitted, 0 received, +5 errors, 100% packet loss, time 4080ms",
        ].join("\n"),
      ),
    );

    const response: PingResponse | null = await PingMonitor.ping(
      IP.fromString(CUSTOMER_ADDRESS) as IPv6,
      { retry: 0, timeout: new PositiveNumber(5000) },
    );

    expect(response?.failureCause).toContain(
      `Unable to reach host ${CUSTOMER_ADDRESS}. No ICMP echo reply from ${CUSTOMER_ADDRESS} (5 sent)`,
    );
    expect(response?.failureCause).not.toContain("IPv6 traffic");
  });

  test("a silent host keeps the 'Unable to reach host' lead", async () => {
    probeSpy.mockResolvedValue(
      makeDeadResult(
        "5 packets transmitted, 0 packets received, 100.0% packet loss",
      ),
    );

    const response: PingResponse | null = await PingMonitor.ping(
      IP.fromString(CUSTOMER_ADDRESS) as IPv6,
      { retry: 0, timeout: new PositiveNumber(5000) },
    );

    expect(response?.failureCause).toContain(
      `Unable to reach host ${CUSTOMER_ADDRESS}. No ICMP echo reply from ${CUSTOMER_ADDRESS} (5 sent)`,
    );
  });

  test("an IPv4 probe-side failure drops the lead too, and says nothing about IPv6", async () => {
    probeSpy.mockResolvedValue(
      makeDeadResult("ping: connect: Cannot assign requested address\n"),
    );

    const response: PingResponse | null = await PingMonitor.ping(
      IP.fromString("192.0.2.1") as never,
      { retry: 0, timeout: new PositiveNumber(5000) },
    );

    expect(response?.isOnline).toBe(false);
    expect(response?.failureCause).toContain(
      "This probe could not send traffic to 192.0.2.1 (ping: connect: Cannot assign requested address), so 192.0.2.1 was never contacted.",
    );
    expect(response?.failureCause).not.toContain("Unable to reach host");
    expect(response?.failureCause).not.toContain("IPv6");
  });

  test("an IPv4 'Network is unreachable' is certain, so it drops the lead as well", async () => {
    probeSpy.mockResolvedValue(
      makeDeadResult("ping: connect: Network is unreachable\n"),
    );

    const response: PingResponse | null = await PingMonitor.ping(
      IP.fromString("192.0.2.1") as never,
      { retry: 0, timeout: new PositiveNumber(5000) },
    );

    expect(response?.failureCause).toContain(
      "This probe has no route to 192.0.2.1: ping: connect: Network is unreachable.",
    );
    expect(response?.failureCause).not.toContain("Unable to reach host");
    expect(response?.failureCause).not.toContain("IPv6");
  });

  /*
   * "No route to host" is only LIKELY the probe's: macOS prints it for a
   * failed neighbour lookup, i.e. an on-link host that is down. Reproduced
   * on macOS against an unused address on the local /24, which printed this
   * after its first ARP miss. Dropping the lead here blamed only the probe,
   * with no hedge, for a device that was simply off.
   */
  test("an uncertain IPv4 'No route to host' keeps the lead and leaves room for the host being down", async () => {
    probeSpy.mockResolvedValue(
      makeDeadResult(
        "ping: sendto: No route to host\nping: sendto: Host is down\nPING 192.0.2.1 (192.0.2.1): 56 data bytes\nRequest timeout for icmp_seq 0\n\n--- 192.0.2.1 ping statistics ---\n5 packets transmitted, 0 packets received, 100.0% packet loss\n",
      ),
    );

    const response: PingResponse | null = await PingMonitor.ping(
      IP.fromString("192.0.2.1") as never,
      { retry: 0, timeout: new PositiveNumber(5000) },
    );

    expect(response?.isOnline).toBe(false);
    expect(response?.failureCause).toContain(
      "Unable to reach host 192.0.2.1. This probe may have no route to 192.0.2.1 (ping: sendto: No route to host); 192.0.2.1 itself may also be down.",
    );
    expect(response?.failureCause).not.toContain("IPv6");
  });

  test.each([
    // macOS: the request line, then the neighbour lookup giving up.
    "PING 192.168.1.250 (192.168.1.250): 56 data bytes\nping: sendto: No route to host\nRequest timeout for icmp_seq 0\n",
    // Linux: the kernel's own neighbour lookup failing, beside the ICMP error.
    "From 192.168.1.10 icmp_seq=1 Destination Host Unreachable\nping: sendmsg: No route to host\n",
  ])("%j keeps the 'Unable to reach host' lead", async (output: string) => {
    probeSpy.mockResolvedValue(makeDeadResult(output));

    const response: PingResponse | null = await PingMonitor.ping(
      IP.fromString("192.168.1.250") as never,
      { retry: 0, timeout: new PositiveNumber(5000) },
    );

    expect(response?.failureCause).toContain(
      "Unable to reach host 192.168.1.250. This probe may have no route to 192.168.1.250 (ping: ",
    );
    expect(response?.failureCause).toContain(
      "192.168.1.250 itself may also be down.",
    );
    expect(response?.failureCause).not.toContain("IPv6");
  });
});

describe("PingMonitor.getPingTarget", () => {
  test.each([
    [CUSTOMER_ADDRESS, CUSTOMER_ADDRESS, true],
    [`[${CUSTOMER_ADDRESS}]`, CUSTOMER_ADDRESS, true],
    ["::1", "::1", true],
    ["2001:db8::", "2001:db8::", true],
    ["192.0.2.1", "192.0.2.1", false],
    ["rs1.example.net", "rs1.example.net", false],
  ])(
    "a Hostname of %s pings %s (v6: %s)",
    (value: string, expectedAddress: string, expectedIsIPv6: boolean) => {
      expect(PingMonitor.getPingTarget(new Hostname(value))).toEqual({
        hostAddress: expectedAddress,
        isIPv6Target: expectedIsIPv6,
      });
    },
  );

  test("an IP object reports its own family without re-parsing the string", () => {
    expect(
      PingMonitor.getPingTarget(IP.fromString(CUSTOMER_ADDRESS) as IPv6),
    ).toEqual({
      hostAddress: CUSTOMER_ADDRESS,
      isIPv6Target: true,
    });
  });
});

describe("PingMonitor.getPingConfig — the monitor path", () => {
  test("linux IPv6 keeps the per-reply wait and asks for the v6 binary", () => {
    expect(
      PingMonitor.getPingConfig({
        isIPv6Target: true,
        packetCount: 5,
        timeoutInSeconds: 5,
        platform: "linux",
        useDeadline: false,
      }),
    ).toEqual({ min_reply: 5, v6: true, timeout: 5 });
  });

  test("macOS IPv6 disables the wait, because ping6 there has no -W", () => {
    /*
     * Without this, EVERY IPv6 Ping/IP monitor on a macOS or FreeBSD probe
     * failed instantly and permanently with "There is no timeout option on
     * ping6" — reported to the operator as a real outage of their peer.
     */
    expect(
      PingMonitor.getPingConfig({
        isIPv6Target: true,
        packetCount: 5,
        timeoutInSeconds: 5,
        platform: "darwin",
        useDeadline: false,
      }),
    ).toEqual({ min_reply: 5, v6: true, timeout: false });
  });

  test("the monitor path sets no deadline, on any platform", () => {
    for (const platform of [
      "linux",
      "darwin",
      "win32",
    ] as Array<NodeJS.Platform>) {
      for (const isIPv6Target of [false, true]) {
        expect(
          PingMonitor.getPingConfig({
            isIPv6Target: isIPv6Target,
            packetCount: 5,
            timeoutInSeconds: 5,
            platform: platform,
            useDeadline: false,
          }),
        ).not.toHaveProperty("deadline");
      }
    }
  });

  test("the IPv4 argv is exactly what it has always been", () => {
    expect(
      PingMonitor.getPingConfig({
        isIPv6Target: false,
        packetCount: 5,
        timeoutInSeconds: 5,
        platform: "linux",
        useDeadline: false,
      }),
    ).toEqual({ min_reply: 5, v6: false, timeout: 5 });
  });
});
