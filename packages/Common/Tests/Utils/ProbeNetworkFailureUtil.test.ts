import ProbeNetworkFailureUtil, {
  ProbeNetworkFailure,
  ProbeNetworkFailureKind,
  ProbeNetworkOperation,
} from "../../Utils/ProbeNetworkFailureUtil";
import { describe, expect, test } from "@jest/globals";

/*
 * A probe with no usable IPv6 fails every IPv6 check before a packet leaves
 * the machine, and OneUptime used to report that as the customer's host
 * being down. The strings below are the ones reproduced in Docker
 * (node:26-bookworm-slim, iputils-ping 20221126, traceroute 2.1.2) for the
 * customer's address, 2001:518:2800:9::2, which answers from anywhere that
 * has IPv6.
 */

const CUSTOMER_ADDRESS: string = "2001:518:2800:9::2";

const PING: ProbeNetworkOperation = ProbeNetworkOperation.PingOrTraceroute;
const TCP: ProbeNetworkOperation = ProbeNetworkOperation.TcpConnect;

// IPv6 switched off on the probe's loopback: THE CUSTOMER'S CASE.
const PING6_NO_SOURCE_ADDRESS: string =
  "ping6: connect: Cannot assign requested address\n";
// A Docker bridge without --ipv6: the kernel has no IPv6 route at all.
const PING6_NO_ROUTE: string = "ping6: connect: Network is unreachable\n";
// A kernel booted with ipv6.disable=1.
const PING6_NO_FAMILY: string =
  "ping6: socket: Address family not supported by protocol\n";

// A Node socket error, shaped the way net.connect rejects.
function nodeError(
  code: string,
  message: string,
  address?: string,
): Error & { code: string; address?: string } {
  const error: Error & { code: string; address?: string } = Object.assign(
    new Error(message),
    { code: code },
  );

  if (address) {
    error.address = address;
  }

  return error;
}

function classifyPingOutput(output: string): ProbeNetworkFailure | null {
  return ProbeNetworkFailureUtil.classifyOutput({
    output: output,
    operation: PING,
  });
}

describe("ProbeNetworkFailureUtil.classifyOutput — what the probe could not send", () => {
  test("the customer's ping6 output is a certain no-source-address failure", () => {
    expect(classifyPingOutput(PING6_NO_SOURCE_ADDRESS)).toEqual({
      kind: ProbeNetworkFailureKind.NoSourceAddress,
      isCertain: true,
      detail: "ping6: connect: Cannot assign requested address",
    });
  });

  test("traceroute's stderr for the same probe, which has no prefix and a leading newline", () => {
    expect(
      classifyPingOutput("\nconnect: Cannot assign requested address\n"),
    ).toEqual({
      kind: ProbeNetworkFailureKind.NoSourceAddress,
      isCertain: true,
      detail: "connect: Cannot assign requested address",
    });
  });

  test("the macOS/BSD spelling of EADDRNOTAVAIL", () => {
    expect(
      classifyPingOutput("ping6: connect: Can't assign requested address")
        ?.kind,
    ).toBe(ProbeNetworkFailureKind.NoSourceAddress);
  });

  test("no IPv6 route is certain for ping: connect() there only looks at the probe's own table", () => {
    expect(classifyPingOutput(PING6_NO_ROUTE)).toEqual({
      kind: ProbeNetworkFailureKind.NetworkUnreachable,
      isCertain: true,
      detail: "ping6: connect: Network is unreachable",
    });
  });

  test("IPv6 disabled in the kernel", () => {
    expect(classifyPingOutput(PING6_NO_FAMILY)).toEqual({
      kind: ProbeNetworkFailureKind.AddressFamilyNotSupported,
      isCertain: true,
      detail: "ping6: socket: Address family not supported by protocol",
    });
  });

  test("the macOS wording of EAFNOSUPPORT", () => {
    expect(
      classifyPingOutput(
        "ping6: socket: Address family not supported by protocol family",
      )?.kind,
    ).toBe(ProbeNetworkFailureKind.AddressFamilyNotSupported);
  });

  test.each(["ping: connect: No route to host", "ping: unreachable host"])(
    "%s stays a probe-side no-route, but only as likely",
    (output: string) => {
      expect(classifyPingOutput(output)).toMatchObject({
        kind: ProbeNetworkFailureKind.NoRouteToHost,
        isCertain: false,
      });
    },
  );

  test("the detail is the line that says so, not ping's banner or statistics", () => {
    expect(
      classifyPingOutput(
        [
          "PING 2001:db8::1(2001:db8::1) 56 data bytes",
          "ping: sendmsg: Network is unreachable",
          "",
          "--- 2001:db8::1 ping statistics ---",
          "1 packets transmitted, 0 received, 100% packet loss, time 0ms",
        ].join("\n"),
      )?.detail,
    ).toBe("ping: sendmsg: Network is unreachable");
  });

  test("the detail is capped and never ends in a period", () => {
    const failure: ProbeNetworkFailure | null = classifyPingOutput(
      `connect: Cannot assign requested address${" x".repeat(200)}.`,
    );

    expect(failure?.detail.length).toBe(200);
    expect(
      classifyPingOutput("connect: Network is unreachable...")?.detail,
    ).toBe("connect: Network is unreachable");
  });

  test("matching is case-insensitive and keeps the OS's own casing in the detail", () => {
    expect(
      classifyPingOutput("PING6: CONNECT: CANNOT ASSIGN REQUESTED ADDRESS")
        ?.detail,
    ).toBe("PING6: CONNECT: CANNOT ASSIGN REQUESTED ADDRESS");
  });

  test("the no-source-address marker wins when an output carries two", () => {
    expect(
      classifyPingOutput(
        "connect: Network is unreachable\nconnect: Cannot assign requested address",
      )?.kind,
    ).toBe(ProbeNetworkFailureKind.NoSourceAddress);
  });
});

describe("ProbeNetworkFailureUtil.classifyOutput — what is NOT the probe's fault", () => {
  test.each([
    // A router on the path sent these back about the target.
    "From 2001:db8::1 icmp_seq=1 Destination Host Unreachable",
    "From 10.0.0.1 icmp_seq=1 Destination Net Unreachable",
    "From fe80::1%eth0 icmp_seq=1 Destination unreachable: Address unreachable",
    "From fe80::1%eth0 icmp_seq=1 Destination unreachable: No route",
    // A silent host.
    "5 packets transmitted, 0 packets received, 100.0% packet loss",
    // Not a routing problem at all.
    "ping: socket: Operation not permitted",
    "ping: rs1.example.net: Name or service not known",
    "",
  ])("%j", (output: string) => {
    expect(classifyPingOutput(output)).toBeNull();
  });

  test("no route to host is a router's verdict on a TCP connect, so it is not classified there", () => {
    expect(
      ProbeNetworkFailureUtil.classifyOutput({
        output: "connect EHOSTUNREACH 2001:db8::1:443",
        operation: TCP,
      }),
    ).toBeNull();
    expect(
      ProbeNetworkFailureUtil.classifyOutput({
        output: "No route to host",
        operation: TCP,
      }),
    ).toBeNull();
  });

  test("an undefined output is treated as empty", () => {
    expect(
      ProbeNetworkFailureUtil.classifyOutput({
        output: undefined as unknown as string,
        operation: PING,
      }),
    ).toBeNull();
  });
});

describe("ProbeNetworkFailureUtil.classifyOutput — TCP certainty", () => {
  test("network is unreachable is only LIKELY the probe on a TCP connect", () => {
    /*
     * A router's ICMPv6 "no route" arriving while the SYN is outstanding
     * produces the same errno, so the wording has to hedge.
     */
    expect(
      ProbeNetworkFailureUtil.classifyOutput({
        output: "Network is unreachable",
        operation: TCP,
      }),
    ).toMatchObject({
      kind: ProbeNetworkFailureKind.NetworkUnreachable,
      isCertain: false,
    });
  });

  test("a Node error message is classified by its code, not its text", () => {
    // classifyOutput reads strerror text; "ENETUNREACH" is for classifyErrorCode.
    expect(
      ProbeNetworkFailureUtil.classifyOutput({
        output: `connect ENETUNREACH ${CUSTOMER_ADDRESS}:179 - Local (:::0)`,
        operation: TCP,
      }),
    ).toBeNull();
  });

  test("a TCP connect's no-source-address is certain but not certainly missing IPv6", () => {
    /*
     * connect(2) also returns EADDRNOTAVAIL when the probe has run out of
     * local ports for the destination, which a probe with IPv6 can hit.
     */
    expect(
      ProbeNetworkFailureUtil.classifyOutput({
        output: "Cannot assign requested address",
        operation: TCP,
      }),
    ).toMatchObject({ isCertain: true, isCauseAmbiguous: true });
    expect(
      classifyPingOutput(PING6_NO_SOURCE_ADDRESS)?.isCauseAmbiguous,
    ).toBeUndefined();
    expect(
      ProbeNetworkFailureUtil.classifyOutput({
        output: "Address family not supported by protocol",
        operation: TCP,
      })?.isCauseAmbiguous,
    ).toBeUndefined();
  });

  test("the two failures that happen before any packet stay certain on TCP", () => {
    expect(
      ProbeNetworkFailureUtil.classifyOutput({
        output: "Cannot assign requested address",
        operation: TCP,
      })?.isCertain,
    ).toBe(true);
    expect(
      ProbeNetworkFailureUtil.classifyOutput({
        output: "Address family not supported by protocol",
        operation: TCP,
      })?.isCertain,
    ).toBe(true);
  });
});

describe("ProbeNetworkFailureUtil.classifyErrorCode", () => {
  test.each([
    [
      "EADDRNOTAVAIL",
      PING,
      ProbeNetworkFailureKind.NoSourceAddress,
      true,
      undefined,
    ],
    ["EADDRNOTAVAIL", TCP, ProbeNetworkFailureKind.NoSourceAddress, true, true],
    [
      "EAFNOSUPPORT",
      PING,
      ProbeNetworkFailureKind.AddressFamilyNotSupported,
      true,
      undefined,
    ],
    [
      "EAFNOSUPPORT",
      TCP,
      ProbeNetworkFailureKind.AddressFamilyNotSupported,
      true,
      undefined,
    ],
    [
      "ENETUNREACH",
      PING,
      ProbeNetworkFailureKind.NetworkUnreachable,
      true,
      undefined,
    ],
    [
      "ENETUNREACH",
      TCP,
      ProbeNetworkFailureKind.NetworkUnreachable,
      false,
      undefined,
    ],
  ])(
    "%s during %s is %s (certain: %s, ambiguous cause: %s)",
    (
      code: string,
      operation: ProbeNetworkOperation,
      kind: ProbeNetworkFailureKind,
      isCertain: boolean,
      isCauseAmbiguous: boolean | undefined,
    ) => {
      const failure: ProbeNetworkFailure | null =
        ProbeNetworkFailureUtil.classifyErrorCode({
          code: code,
          operation: operation,
        });

      expect(failure).toEqual({
        kind: kind,
        isCertain: isCertain,
        detail: code,
        isCauseAmbiguous: isCauseAmbiguous,
      });
      expect(failure?.isCauseAmbiguous).toBe(isCauseAmbiguous);
    },
  );

  test.each([
    "EHOSTUNREACH",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "ECONNRESET",
    "ENOTFOUND",
    "EAI_AGAIN",
    "ENOENT",
    "",
  ])("%j is not a probe-side failure", (code: string) => {
    expect(
      ProbeNetworkFailureUtil.classifyErrorCode({ code: code, operation: TCP }),
    ).toBeNull();
    expect(
      ProbeNetworkFailureUtil.classifyErrorCode({
        code: code,
        operation: PING,
      }),
    ).toBeNull();
  });

  test("a child process's numeric exit status is not an errno", () => {
    expect(
      ProbeNetworkFailureUtil.classifyErrorCode({ code: 1, operation: PING }),
    ).toBeNull();
    expect(
      ProbeNetworkFailureUtil.classifyErrorCode({
        code: undefined,
        operation: PING,
      }),
    ).toBeNull();
  });

  test("the caller's detail and address are carried through", () => {
    expect(
      ProbeNetworkFailureUtil.classifyErrorCode({
        code: "EADDRNOTAVAIL",
        operation: TCP,
        detail: `connect EADDRNOTAVAIL ${CUSTOMER_ADDRESS}:179 - Local (:::0)`,
        address: CUSTOMER_ADDRESS,
      }),
    ).toEqual({
      kind: ProbeNetworkFailureKind.NoSourceAddress,
      isCertain: true,
      detail: `connect EADDRNOTAVAIL ${CUSTOMER_ADDRESS}:179 - Local (:::0)`,
      address: CUSTOMER_ADDRESS,
      isCauseAmbiguous: true,
    });
  });

  test("a lower-case code is still recognised", () => {
    expect(
      ProbeNetworkFailureUtil.classifyErrorCode({
        code: "eaddrnotavail",
        operation: TCP,
      })?.kind,
    ).toBe(ProbeNetworkFailureKind.NoSourceAddress);
  });
});

describe("ProbeNetworkFailureUtil.classifyError", () => {
  test("the customer's TCP connect error, exactly as node raised it", () => {
    expect(
      ProbeNetworkFailureUtil.classifyError({
        error: nodeError(
          "EADDRNOTAVAIL",
          `connect EADDRNOTAVAIL ${CUSTOMER_ADDRESS}:179 - Local (:::0)`,
          CUSTOMER_ADDRESS,
        ),
        operation: TCP,
      }),
    ).toEqual({
      kind: ProbeNetworkFailureKind.NoSourceAddress,
      isCertain: true,
      detail: `connect EADDRNOTAVAIL ${CUSTOMER_ADDRESS}:179 - Local (:::0)`,
      address: CUSTOMER_ADDRESS,
      isCauseAmbiguous: true,
    });
  });

  test("fetch's TypeError, which hides the socket error in cause", () => {
    const error: Error & { cause?: unknown } = new TypeError("fetch failed");
    error.cause = nodeError(
      "EADDRNOTAVAIL",
      `connect EADDRNOTAVAIL ${CUSTOMER_ADDRESS}:443 - Local (:::0)`,
      CUSTOMER_ADDRESS,
    );

    expect(
      ProbeNetworkFailureUtil.classifyError({ error: error, operation: TCP }),
    ).toMatchObject({
      kind: ProbeNetworkFailureKind.NoSourceAddress,
      address: CUSTOMER_ADDRESS,
    });
  });

  test("an aggregate where every attempt failed on the probe is probe-side, as the least certain attempt", () => {
    const aggregate: Error & { errors: Array<Error>; code: string } =
      Object.assign(new Error(""), {
        code: "EADDRNOTAVAIL",
        errors: [
          nodeError("EADDRNOTAVAIL", "connect EADDRNOTAVAIL 2001:db8::1:443"),
          nodeError("ENETUNREACH", "connect ENETUNREACH 192.0.2.1:443"),
        ],
      });

    expect(
      ProbeNetworkFailureUtil.classifyError({
        error: aggregate,
        operation: TCP,
      }),
    ).toMatchObject({
      kind: ProbeNetworkFailureKind.NetworkUnreachable,
      isCertain: false,
    });
  });

  test("a mixed-family aggregate names no address, so it cannot be worded as IPv6", () => {
    /*
     * A dual-stack name whose IPv4 attempt failed as well is not an IPv6
     * problem, whichever attempt Node happened to try first.
     */
    const aggregate: Error & { errors: Array<Error>; code: string } =
      Object.assign(new Error(""), {
        code: "ENETUNREACH",
        errors: [
          nodeError(
            "ENETUNREACH",
            "connect ENETUNREACH 2001:db8::1:443 - Local (:::0)",
            "2001:db8::1",
          ),
          nodeError(
            "ENETUNREACH",
            "connect ENETUNREACH 192.0.2.1:443",
            "192.0.2.1",
          ),
        ],
      });

    const failure: ProbeNetworkFailure | null =
      ProbeNetworkFailureUtil.classifyError({
        error: aggregate,
        operation: TCP,
      });

    expect(failure).toMatchObject({
      kind: ProbeNetworkFailureKind.NetworkUnreachable,
      isCertain: false,
      detail: "connect ENETUNREACH 2001:db8::1:443 - Local (:::0)",
    });
    expect(failure?.address).toBeUndefined();
    expect(
      ProbeNetworkFailureUtil.isIPv6Failure({
        host: "dual-stack.example",
        failure: failure!,
      }),
    ).toBe(false);
  });

  test("an all-IPv6 aggregate keeps its address, and is worded as IPv6", () => {
    const aggregate: Error & { errors: Array<Error>; code: string } =
      Object.assign(new Error(""), {
        code: "EADDRNOTAVAIL",
        errors: [
          nodeError(
            "EADDRNOTAVAIL",
            "connect EADDRNOTAVAIL 2001:db8::1:443 - Local (:::0)",
            "2001:db8::1",
          ),
          nodeError(
            "ENETUNREACH",
            "connect ENETUNREACH 2001:db8::2:443 - Local (:::0)",
            "2001:db8::2",
          ),
        ],
      });

    const failure: ProbeNetworkFailure | null =
      ProbeNetworkFailureUtil.classifyError({
        error: aggregate,
        operation: TCP,
      });

    expect(failure).toMatchObject({
      kind: ProbeNetworkFailureKind.NetworkUnreachable,
      isCertain: false,
      address: "2001:db8::2",
    });
    expect(
      ProbeNetworkFailureUtil.isIPv6Failure({
        host: "v6-only.example",
        failure: failure!,
      }),
    ).toBe(true);
  });

  test("an aggregate with an attempt that named no address keeps none", () => {
    const aggregate: Error & { errors: Array<Error>; code: string } =
      Object.assign(new Error(""), {
        code: "EADDRNOTAVAIL",
        errors: [
          nodeError(
            "EADDRNOTAVAIL",
            "connect EADDRNOTAVAIL 2001:db8::1:443 - Local (:::0)",
            "2001:db8::1",
          ),
          nodeError("EADDRNOTAVAIL", "connect EADDRNOTAVAIL"),
        ],
      });

    expect(
      ProbeNetworkFailureUtil.classifyError({
        error: aggregate,
        operation: TCP,
      })?.address,
    ).toBeUndefined();
  });

  test("an aggregate where one attempt reached the network is NOT probe-side, whatever code node copied onto it", () => {
    /*
     * Happy eyeballs: the IPv6 attempt could not leave the probe, the IPv4
     * one timed out. That is an IPv4 outage, and Node sets the aggregate's
     * code to the FIRST attempt's, EADDRNOTAVAIL.
     */
    const aggregate: Error & { errors: Array<Error>; code: string } =
      Object.assign(new Error(""), {
        code: "EADDRNOTAVAIL",
        errors: [
          nodeError("EADDRNOTAVAIL", "connect EADDRNOTAVAIL 2001:db8::1:443"),
          nodeError("ETIMEDOUT", "connect ETIMEDOUT 192.0.2.1:443"),
        ],
      });

    expect(
      ProbeNetworkFailureUtil.classifyError({
        error: aggregate,
        operation: TCP,
      }),
    ).toBeNull();
  });

  test("a wrapper that copied its cause's code defers to the cause", () => {
    // The shape an AxiosError has around a happy-eyeballs AggregateError.
    const wrapper: Error & { code: string; cause: unknown } = Object.assign(
      new Error(""),
      {
        code: "EADDRNOTAVAIL",
        cause: Object.assign(new Error(""), {
          code: "EADDRNOTAVAIL",
          errors: [
            nodeError("EADDRNOTAVAIL", "connect EADDRNOTAVAIL 2001:db8::1:443"),
            nodeError("ECONNREFUSED", "connect ECONNREFUSED 192.0.2.1:443"),
          ],
        }),
      },
    );

    expect(
      ProbeNetworkFailureUtil.classifyError({ error: wrapper, operation: TCP }),
    ).toBeNull();
  });

  test("an error with no code falls back to its message", () => {
    expect(
      ProbeNetworkFailureUtil.classifyError({
        error: new Error("connect: Network is unreachable"),
        operation: PING,
      })?.kind,
    ).toBe(ProbeNetworkFailureKind.NetworkUnreachable);
  });

  test.each([
    undefined,
    null,
    "EADDRNOTAVAIL",
    42,
    new Error("connect ECONNREFUSED 192.0.2.1:443"),
    nodeError("ECONNREFUSED", "connect ECONNREFUSED 192.0.2.1:443"),
    nodeError("EHOSTUNREACH", "connect EHOSTUNREACH 2001:db8::1:443"),
  ])("%p is not probe-side", (error: unknown) => {
    expect(
      ProbeNetworkFailureUtil.classifyError({ error: error, operation: TCP }),
    ).toBeNull();
  });

  test("a cause chain that loops back on itself terminates", () => {
    const error: Error & { cause?: unknown } = new Error("outer");
    error.cause = error;

    expect(
      ProbeNetworkFailureUtil.classifyError({ error: error, operation: TCP }),
    ).toBeNull();
  });
});

describe("ProbeNetworkFailureUtil.describe — an IPv6 destination", () => {
  test("the customer's case says the host was never contacted and is not being judged", () => {
    const failure: ProbeNetworkFailure = classifyPingOutput(
      PING6_NO_SOURCE_ADDRESS,
    )!;

    expect(
      ProbeNetworkFailureUtil.describe({
        host: CUSTOMER_ADDRESS,
        failure: failure,
      }),
    ).toBe(
      `This probe cannot send IPv6 traffic (ping6: connect: Cannot assign requested address), so ${CUSTOMER_ADDRESS} was never contacted. The probe has no usable IPv6 address or route; this says nothing about whether ${CUSTOMER_ADDRESS} is up. Monitor IPv6 destinations from a probe that has IPv6 connectivity.`,
    );
  });

  test.each([PING6_NO_ROUTE, PING6_NO_FAMILY])(
    "%j gets the same certain wording",
    (output: string) => {
      const text: string = ProbeNetworkFailureUtil.describe({
        host: CUSTOMER_ADDRESS,
        failure: classifyPingOutput(output)!,
      });

      expect(text).toContain("This probe cannot send IPv6 traffic");
      expect(text).toContain(`${CUSTOMER_ADDRESS} was never contacted`);
      expect(text).toContain(output.trim());
    },
  );

  test("a TCP ENETUNREACH hedges, because a router could have said it", () => {
    const failure: ProbeNetworkFailure =
      ProbeNetworkFailureUtil.classifyErrorCode({
        code: "ENETUNREACH",
        operation: TCP,
        detail: `connect ENETUNREACH ${CUSTOMER_ADDRESS}:179 - Local (:::0)`,
      })!;

    expect(
      ProbeNetworkFailureUtil.describe({
        host: CUSTOMER_ADDRESS,
        failure: failure,
      }),
    ).toBe(
      `This probe could not reach ${CUSTOMER_ADDRESS} over IPv6 (connect ENETUNREACH ${CUSTOMER_ADDRESS}:179 - Local (:::0)). Most likely this probe has no IPv6 route rather than ${CUSTOMER_ADDRESS} being down. Monitor IPv6 destinations from a probe that has IPv6 connectivity.`,
    );
  });

  test("none of the IPv6 wordings reads as a verdict on the host", () => {
    for (const output of [
      PING6_NO_SOURCE_ADDRESS,
      PING6_NO_ROUTE,
      PING6_NO_FAMILY,
      "ping6: connect: No route to host",
    ]) {
      const text: string = ProbeNetworkFailureUtil.describe({
        host: CUSTOMER_ADDRESS,
        failure: classifyPingOutput(output)!,
      });

      expect(text).not.toContain("Unable to reach host");
      expect(text).not.toContain("No ICMP echo reply");
      expect(text).toContain("IPv6");
    }
  });

  test("a bracketed IPv6 host is still recognised as IPv6", () => {
    expect(
      ProbeNetworkFailureUtil.describe({
        host: `[${CUSTOMER_ADDRESS}]`,
        failure: classifyPingOutput(PING6_NO_SOURCE_ADDRESS)!,
      }),
    ).toContain("cannot send IPv6 traffic");
  });

  test("a DNS name whose error named an IPv6 address is worded as IPv6", () => {
    const failure: ProbeNetworkFailure = ProbeNetworkFailureUtil.classifyError({
      error: nodeError(
        "EADDRNOTAVAIL",
        `connect EADDRNOTAVAIL ${CUSTOMER_ADDRESS}:443 - Local (:::0)`,
        CUSTOMER_ADDRESS,
      ),
      operation: TCP,
    })!;

    const text: string = ProbeNetworkFailureUtil.describe({
      host: "rs1.example.net",
      failure: failure,
    });

    expect(text).toContain(
      "This probe could not open an IPv6 connection from its own side",
    );
    expect(text).toContain("rs1.example.net was never contacted");
  });

  test("the caller's own knowledge of the family wins", () => {
    const failure: ProbeNetworkFailure = classifyPingOutput(
      PING6_NO_SOURCE_ADDRESS,
    )!;

    expect(
      ProbeNetworkFailureUtil.describe({
        host: "rs1.example.net",
        failure: failure,
        isIPv6Destination: true,
      }),
    ).toContain("cannot send IPv6 traffic");
    expect(
      ProbeNetworkFailureUtil.describe({
        host: CUSTOMER_ADDRESS,
        failure: failure,
        isIPv6Destination: false,
      }),
    ).not.toContain("IPv6");
  });
});

describe("ProbeNetworkFailureUtil.describe — IPv4 and DNS names make no IPv6 claim", () => {
  test("no route keeps the wording PingMonitor has always used", () => {
    expect(
      ProbeNetworkFailureUtil.describe({
        host: "192.0.2.1",
        failure: classifyPingOutput("ping: connect: Network is unreachable")!,
      }),
    ).toBe(
      "This probe has no route to 192.0.2.1: ping: connect: Network is unreachable.",
    );
  });

  test("no source address says the host was never contacted", () => {
    const text: string = ProbeNetworkFailureUtil.describe({
      host: "192.0.2.1",
      failure: ProbeNetworkFailureUtil.classifyErrorCode({
        code: "EADDRNOTAVAIL",
        operation: TCP,
        detail: "connect EADDRNOTAVAIL 192.0.2.1:443 - Local (0.0.0.0:0)",
      })!,
    });

    expect(text).toBe(
      "This probe could not send traffic to 192.0.2.1 (connect EADDRNOTAVAIL 192.0.2.1:443 - Local (0.0.0.0:0)), so 192.0.2.1 was never contacted. The failure is on the probe, not on 192.0.2.1.",
    );
  });

  test.each([
    ["192.0.2.1", "ping: connect: Network is unreachable"],
    ["192.0.2.1", "ping: connect: Cannot assign requested address"],
    ["192.0.2.1", "ping: connect: No route to host"],
    ["rs1.example.net", "ping: connect: Network is unreachable"],
    ["rs1.example.net", "ping: socket: Address family not supported"],
  ])("%s with %j", (host: string, output: string) => {
    const text: string = ProbeNetworkFailureUtil.describe({
      host: host,
      failure: classifyPingOutput(output)!,
    });

    expect(text).not.toContain("IPv6");
    expect(text).toContain(host);
    expect(text).toContain(output);
  });
});

describe("ProbeNetworkFailureUtil.describe — only as sure as the evidence", () => {
  test("an IPv4 'No route to host' leaves room for the host being down", () => {
    /*
     * macOS prints this for a failed neighbour lookup: an on-link host that
     * is down, which is not the probe's fault at all.
     */
    expect(
      ProbeNetworkFailureUtil.describe({
        host: "192.168.1.250",
        failure: classifyPingOutput("ping: sendto: No route to host")!,
      }),
    ).toBe(
      "This probe may have no route to 192.168.1.250 (ping: sendto: No route to host); 192.168.1.250 itself may also be down.",
    );
  });

  test("a TCP EADDRNOTAVAIL to IPv6 does not state the missing IPv6 as fact", () => {
    /*
     * Reproduced with ip_local_port_range pinned to one port: the second
     * connect to [::1] fails exactly like the customer's, on a probe whose
     * IPv6 works.
     */
    const failure: ProbeNetworkFailure = ProbeNetworkFailureUtil.classifyError({
      error: nodeError(
        "EADDRNOTAVAIL",
        "connect EADDRNOTAVAIL ::1:8080 - Local (:::0)",
        "::1",
      ),
      operation: TCP,
    })!;

    const text: string = ProbeNetworkFailureUtil.describe({
      host: "::1",
      failure: failure,
    });

    expect(text).toBe(
      "This probe could not open an IPv6 connection from its own side (connect EADDRNOTAVAIL ::1:8080 - Local (:::0)), so ::1 was never contacted. This usually means the probe has no usable IPv6 address or route (less often, that it has run out of local ports); this says nothing about whether ::1 is up. Monitor IPv6 destinations from a probe that has IPv6 connectivity.",
    );
    expect(text).not.toContain("cannot send IPv6 traffic");
  });

  test("a TCP EAFNOSUPPORT keeps the definite wording: only a disabled family gives it", () => {
    expect(
      ProbeNetworkFailureUtil.describeError({
        host: CUSTOMER_ADDRESS,
        error: nodeError(
          "EAFNOSUPPORT",
          `connect EAFNOSUPPORT ${CUSTOMER_ADDRESS}:443`,
          CUSTOMER_ADDRESS,
        ),
        operation: TCP,
      }),
    ).toContain(
      `This probe cannot send IPv6 traffic (connect EAFNOSUPPORT ${CUSTOMER_ADDRESS}:443), so ${CUSTOMER_ADDRESS} was never contacted.`,
    );
  });

  test("ping's and traceroute's EADDRNOTAVAIL keep the definite wording", () => {
    expect(
      ProbeNetworkFailureUtil.describeOutput({
        host: CUSTOMER_ADDRESS,
        output: PING6_NO_SOURCE_ADDRESS,
        operation: PING,
      }),
    ).toContain("This probe cannot send IPv6 traffic");
  });
});

describe("ProbeNetworkFailureUtil.isProbeSideCause", () => {
  test("every describe() wording is recognised", () => {
    const failures: Array<[string, ProbeNetworkFailure]> = [
      [CUSTOMER_ADDRESS, classifyPingOutput(PING6_NO_SOURCE_ADDRESS)!],
      [
        CUSTOMER_ADDRESS,
        classifyPingOutput("ping6: connect: No route to host")!,
      ],
      [
        CUSTOMER_ADDRESS,
        ProbeNetworkFailureUtil.classifyErrorCode({
          code: "EADDRNOTAVAIL",
          operation: TCP,
        })!,
      ],
      [
        "192.0.2.1",
        classifyPingOutput("ping: connect: Network is unreachable")!,
      ],
      ["192.0.2.1", classifyPingOutput("ping: connect: No route to host")!],
      [
        "192.0.2.1",
        classifyPingOutput("ping: connect: Cannot assign requested address")!,
      ],
    ];

    for (const [host, failure] of failures) {
      expect(
        ProbeNetworkFailureUtil.isProbeSideCause(
          ProbeNetworkFailureUtil.describe({ host: host, failure: failure }),
        ),
      ).toBe(true);
    }
  });

  test.each([
    "Request timed out",
    "send EADDRNOTAVAIL 2001:518:2800:9::2:161",
    "Unable to reach host 192.0.2.1. No ICMP echo reply from 192.0.2.1 (5 sent)",
    "",
    undefined,
    null,
  ])("%p is not", (text: string | undefined | null) => {
    expect(ProbeNetworkFailureUtil.isProbeSideCause(text)).toBe(false);
  });
});

describe("ProbeNetworkFailureUtil.describeClause", () => {
  test.each([
    [
      CUSTOMER_ADDRESS,
      "\nconnect: Cannot assign requested address\n",
      "this probe cannot send IPv6 traffic (connect: Cannot assign requested address)",
    ],
    [
      CUSTOMER_ADDRESS,
      "connect: No route to host",
      "this probe most likely has no IPv6 route (connect: No route to host)",
    ],
    [
      "192.0.2.1",
      "connect: Network is unreachable",
      "this probe has no route to 192.0.2.1 (connect: Network is unreachable)",
    ],
    [
      "192.0.2.1",
      "connect: Cannot assign requested address",
      "this probe could not send traffic to 192.0.2.1 (connect: Cannot assign requested address)",
    ],
    [
      "192.0.2.1",
      "connect: No route to host",
      "this probe may have no route to 192.0.2.1 (connect: No route to host); 192.0.2.1 itself may also be down",
    ],
  ])("%s / %j", (host: string, output: string, expected: string) => {
    expect(
      ProbeNetworkFailureUtil.describeClause({
        host: host,
        failure: classifyPingOutput(output)!,
      }),
    ).toBe(expected);
  });
});

describe("ProbeNetworkFailureUtil.describeOutput / describeError", () => {
  test("describeOutput is classifyOutput then describe", () => {
    expect(
      ProbeNetworkFailureUtil.describeOutput({
        host: CUSTOMER_ADDRESS,
        output: PING6_NO_SOURCE_ADDRESS,
        operation: PING,
      }),
    ).toBe(
      ProbeNetworkFailureUtil.describe({
        host: CUSTOMER_ADDRESS,
        failure: classifyPingOutput(PING6_NO_SOURCE_ADDRESS)!,
      }),
    );
  });

  test("describeOutput is null when the probe was not at fault", () => {
    expect(
      ProbeNetworkFailureUtil.describeOutput({
        host: CUSTOMER_ADDRESS,
        output: "5 packets transmitted, 0 received, 100% packet loss",
        operation: PING,
      }),
    ).toBeNull();
  });

  test("describeError words a TCP failure against an IPv6 host", () => {
    expect(
      ProbeNetworkFailureUtil.describeError({
        host: CUSTOMER_ADDRESS,
        error: nodeError(
          "EADDRNOTAVAIL",
          `connect EADDRNOTAVAIL ${CUSTOMER_ADDRESS}:179 - Local (:::0)`,
          CUSTOMER_ADDRESS,
        ),
        operation: TCP,
      }),
    ).toBe(
      `This probe could not open an IPv6 connection from its own side (connect EADDRNOTAVAIL ${CUSTOMER_ADDRESS}:179 - Local (:::0)), so ${CUSTOMER_ADDRESS} was never contacted. This usually means the probe has no usable IPv6 address or route (less often, that it has run out of local ports); this says nothing about whether ${CUSTOMER_ADDRESS} is up. Monitor IPv6 destinations from a probe that has IPv6 connectivity.`,
    );
  });

  test("describeError is null for a refused connection, which proves the host is up", () => {
    expect(
      ProbeNetworkFailureUtil.describeError({
        host: CUSTOMER_ADDRESS,
        error: nodeError(
          "ECONNREFUSED",
          `connect ECONNREFUSED ${CUSTOMER_ADDRESS}:179`,
        ),
        operation: TCP,
      }),
    ).toBeNull();
  });
});
