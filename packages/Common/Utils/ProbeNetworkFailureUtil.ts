import HostAddressUtil from "./HostAddressUtil";

/*
 * Tells a check that failed ON THE PROBE apart from one that failed at the
 * destination, and words the probe-side case so it cannot be read as a
 * verdict on the customer's host.
 *
 * The case this exists for: a probe with no usable IPv6. Every IPv6 check it
 * runs fails before a single packet leaves the machine - ping6 answers
 * "connect: Cannot assign requested address", traceroute -6 the same, a TCP
 * connect EADDRNOTAVAIL - while every IPv4 monitor beside it keeps working.
 * Reported as "Unable to reach host ... No ICMP echo reply", that sends the
 * customer to debug a host that is answering perfectly well, which is exactly
 * what happened with 2001:518:2800:9::2.
 *
 * What counts as probe-side, and how sure we can be:
 *
 *   - EADDRNOTAVAIL ("Cannot assign requested address", "Can't assign
 *     requested address" on macOS/BSD). connect() found no local address to
 *     send from. Nothing was sent. Always the probe. From a TCP connect it
 *     can also mean the probe ran out of local ports, so the TCP wording
 *     does not state the missing IPv6 as fact (see isCauseAmbiguous).
 *   - EAFNOSUPPORT ("Address family not supported"). The probe's kernel has
 *     the family switched off. Nothing was sent. Always the probe.
 *   - ENETUNREACH ("Network is unreachable"). For ping and traceroute the
 *     connect() on a datagram/raw socket is only a lookup in the probe's own
 *     routing table, so it is the probe. For a TCP connect the SYN may already
 *     have left and a router's ICMPv6 "no route" reports the same errno, so
 *     there it is only LIKELY the probe and has to be worded that way.
 *   - "No route to host" in ping output. Kept from the markers PingMonitor
 *     already treated as the probe's own, but only as likely: macOS reports a
 *     failed neighbour lookup for an on-link host with the same text, which
 *     means the host is down. The IPv4 wording says the host may be down too.
 *
 * Deliberately NOT probe-side: "Destination Host Unreachable", "Destination
 * Net Unreachable", "Destination unreachable: Address unreachable", and
 * EHOSTUNREACH from a TCP connect. Those are ICMP errors a ROUTER sent back
 * about the target, which is a real outage on the path, so they stay in the
 * ordinary "could not reach the destination" bucket.
 *
 * Pure and isomorphic on purpose: Common/Utils/API.ts runs in the browser as
 * well as on the probe and reuses this, so nothing here may import Node.
 */

export enum ProbeNetworkFailureKind {
  // EADDRNOTAVAIL: no local address of the destination's family to send from.
  NoSourceAddress = "NoSourceAddress",
  // EAFNOSUPPORT: the probe's kernel has the address family disabled.
  AddressFamilyNotSupported = "AddressFamilyNotSupported",
  // ENETUNREACH: no route for the destination's network.
  NetworkUnreachable = "NetworkUnreachable",
  // "No route to host" in ping/traceroute output.
  NoRouteToHost = "NoRouteToHost",
}

/*
 * What the probe was doing when it failed. It only changes how sure the
 * classification can be: see ENETUNREACH above.
 */
export enum ProbeNetworkOperation {
  /*
   * ping, ping6, traceroute: connect() on a datagram or raw socket is a
   * route lookup in the probe's own kernel, and nothing is sent until it
   * succeeds.
   */
  PingOrTraceroute = "PingOrTraceroute",
  /*
   * A TCP connect (Port, SSL, HTTP): the SYN can already be on the wire when
   * the error comes back, so ENETUNREACH may have come from a router.
   */
  TcpConnect = "TcpConnect",
}

export interface ProbeNetworkFailure {
  kind: ProbeNetworkFailureKind;
  /*
   * True when the failure can only have happened on the probe. False when it
   * most likely did but something on the path could have produced the same
   * error, so the wording has to say "most likely".
   */
  isCertain: boolean;
  // The OS text that showed it: one line, as the operator should see it.
  detail: string;
  /*
   * The address the failure was for, when the error said (a Node error's
   * `address`). Lets a check against a DNS name know which family it was
   * actually using. An aggregate (one attempt per address) sets it only when
   * every attempt named an address of the same family: a dual-stack name
   * whose IPv4 attempt failed as well is not an IPv6 problem.
   */
  address?: string | undefined;
  /*
   * Set when the failure is certainly the probe's but the reason is not
   * the usual one. From a TCP connect, EADDRNOTAVAIL also means the probe
   * has run out of ephemeral ports for that destination, which a probe WITH
   * working IPv6 can hit too. The host was still never contacted; only the
   * explanation has to leave room for it.
   */
  isCauseAmbiguous?: boolean | undefined;
}

/*
 * Every describe() sentence opens with this, so a consumer holding only the
 * stored text (an observation narrative on the server) can tell a probe-side
 * cause from a verdict on the target without classifying it again.
 */
const PROBE_SIDE_CAUSE_PREFIX: string = "This probe ";

interface ProbeNetworkFailureMarker {
  marker: string;
  kind: ProbeNetworkFailureKind;
}

/*
 * Lower-cased strerror text, most specific first. Matched on the strerror
 * alone because the prefix before it varies: "ping6: connect:", "ping:
 * sendmsg:", traceroute's bare "connect:".
 */
const OUTPUT_MARKERS: Array<ProbeNetworkFailureMarker> = [
  {
    marker: "cannot assign requested address",
    kind: ProbeNetworkFailureKind.NoSourceAddress,
  },
  {
    marker: "can't assign requested address",
    kind: ProbeNetworkFailureKind.NoSourceAddress,
  },
  {
    marker: "address family not supported",
    kind: ProbeNetworkFailureKind.AddressFamilyNotSupported,
  },
  {
    marker: "network is unreachable",
    kind: ProbeNetworkFailureKind.NetworkUnreachable,
  },
  {
    marker: "no route to host",
    kind: ProbeNetworkFailureKind.NoRouteToHost,
  },
  {
    marker: "unreachable host",
    kind: ProbeNetworkFailureKind.NoRouteToHost,
  },
];

/*
 * Node error codes. EHOSTUNREACH is deliberately absent: from a socket it
 * means a router or the neighbour lookup gave up on the target.
 */
const ERROR_CODE_KINDS: Record<string, ProbeNetworkFailureKind> = {
  EADDRNOTAVAIL: ProbeNetworkFailureKind.NoSourceAddress,
  EAFNOSUPPORT: ProbeNetworkFailureKind.AddressFamilyNotSupported,
  ENETUNREACH: ProbeNetworkFailureKind.NetworkUnreachable,
};

// Long enough for any strerror line; short enough for an SMS root cause.
const MAX_DETAIL_LENGTH: number = 200;

// How far down an error's `cause` chain classifyError looks.
const MAX_CAUSE_DEPTH: number = 5;

/*
 * The fields classifyError reads, all optional because a thrown value can be
 * anything. `errors` is AggregateError's, `cause` is the ES2022 one (fetch
 * puts the socket error there), `address` is what Node sets on a socket error.
 */
interface ErrorLike {
  code?: unknown;
  message?: unknown;
  address?: unknown;
  errors?: unknown;
  cause?: unknown;
}

export default class ProbeNetworkFailureUtil {
  /*
   * Classifies OS output or error text: ping's combined output, traceroute's
   * stderr, an error message. Null when nothing in it says the probe was the
   * one that failed.
   */
  public static classifyOutput(data: {
    output: string;
    operation: ProbeNetworkOperation;
  }): ProbeNetworkFailure | null {
    const output: string = data.output || "";
    const lowerOutput: string = output.toLowerCase();

    for (const entry of OUTPUT_MARKERS) {
      if (!lowerOutput.includes(entry.marker)) {
        continue;
      }

      const isCertain: boolean | null = ProbeNetworkFailureUtil.getCertainty(
        entry.kind,
        data.operation,
      );

      if (isCertain === null) {
        continue;
      }

      const failure: ProbeNetworkFailure = {
        kind: entry.kind,
        isCertain: isCertain,
        detail: ProbeNetworkFailureUtil.getDetail(output, entry.marker),
      };

      if (
        ProbeNetworkFailureUtil.isCauseAmbiguous(entry.kind, data.operation)
      ) {
        failure.isCauseAmbiguous = true;
      }

      return failure;
    }

    return null;
  }

  /*
   * Classifies a Node error code (err.code). `detail` is what the operator
   * sees as the evidence; the code itself when the caller has nothing
   * better. Anything that is not a string code (a child process's numeric
   * exit status, undefined) is not classified.
   */
  public static classifyErrorCode(data: {
    code: unknown;
    operation: ProbeNetworkOperation;
    detail?: string | undefined;
    address?: string | undefined;
  }): ProbeNetworkFailure | null {
    if (typeof data.code !== "string") {
      return null;
    }

    const kind: ProbeNetworkFailureKind | undefined =
      ERROR_CODE_KINDS[data.code.toUpperCase()];

    if (!kind) {
      return null;
    }

    const isCertain: boolean | null = ProbeNetworkFailureUtil.getCertainty(
      kind,
      data.operation,
    );

    if (isCertain === null) {
      return null;
    }

    const failure: ProbeNetworkFailure = {
      kind: kind,
      isCertain: isCertain,
      detail: ProbeNetworkFailureUtil.getDetail(data.detail || data.code, ""),
    };

    if (data.address) {
      failure.address = data.address;
    }

    if (ProbeNetworkFailureUtil.isCauseAmbiguous(kind, data.operation)) {
      failure.isCauseAmbiguous = true;
    }

    return failure;
  }

  /*
   * Classifies a thrown value from a socket, TLS or fetch call.
   *
   * An AggregateError (Node's happy-eyeballs connect, one error per address
   * tried) is probe-side only when EVERY attempt was: an IPv6 attempt that
   * could not leave the probe next to an IPv4 attempt that timed out is an
   * IPv4 outage, not a probe problem. It is checked before `code` because
   * Node copies the first attempt's code onto the aggregate.
   *
   * Otherwise the error's own code decides, then its `cause` (fetch wraps
   * the socket error in a TypeError "fetch failed"), and last its message.
   */
  public static classifyError(data: {
    error: unknown;
    operation: ProbeNetworkOperation;
  }): ProbeNetworkFailure | null {
    return ProbeNetworkFailureUtil.classifyErrorAtDepth(
      data.error,
      data.operation,
      0,
    );
  }

  /*
   * Whether a failure is to be worded as an IPv6 one. In order: what the
   * caller knows, the address the error named, the host itself. A DNS name
   * with nothing else to go on is not assumed to be either.
   */
  public static isIPv6Failure(data: {
    host: string;
    failure: ProbeNetworkFailure;
    isIPv6Destination?: boolean | undefined;
  }): boolean {
    if (data.isIPv6Destination !== undefined) {
      return data.isIPv6Destination;
    }

    if (data.failure.address && HostAddressUtil.isIPv6(data.failure.address)) {
      return true;
    }

    return HostAddressUtil.isIPv6(data.host || "");
  }

  /*
   * The failure cause, in full sentences, for a check against `host`.
   *
   * The IPv6 wording says outright that the host was never contacted and
   * that this says nothing about whether it is up, because the thing being
   * corrected is an operator (or an incident root cause, or an SMS) reading
   * a probe's missing IPv6 as their host being down. The IPv4 wording makes
   * no IPv6 claim at all.
   *
   * Every sentence opens with PROBE_SIDE_CAUSE_PREFIX; see isProbeSideCause.
   */
  public static describe(data: {
    host: string;
    failure: ProbeNetworkFailure;
    isIPv6Destination?: boolean | undefined;
  }): string {
    const host: string = data.host;
    const detail: string = data.failure.detail;

    if (ProbeNetworkFailureUtil.isIPv6Failure(data)) {
      /*
       * A TCP connect's EADDRNOTAVAIL: still certainly the probe, but a
       * probe with IPv6 that has run out of local ports gets it too, so
       * "has no usable IPv6" would be a false reason and a false remedy.
       */
      if (data.failure.isCertain && data.failure.isCauseAmbiguous) {
        return `This probe could not open an IPv6 connection from its own side (${detail}), so ${host} was never contacted. This usually means the probe has no usable IPv6 address or route (less often, that it has run out of local ports); this says nothing about whether ${host} is up. Monitor IPv6 destinations from a probe that has IPv6 connectivity.`;
      }

      if (data.failure.isCertain) {
        return `This probe cannot send IPv6 traffic (${detail}), so ${host} was never contacted. The probe has no usable IPv6 address or route; this says nothing about whether ${host} is up. Monitor IPv6 destinations from a probe that has IPv6 connectivity.`;
      }

      return `This probe could not reach ${host} over IPv6 (${detail}). Most likely this probe has no IPv6 route rather than ${host} being down. Monitor IPv6 destinations from a probe that has IPv6 connectivity.`;
    }

    if (ProbeNetworkFailureUtil.isRouteFailure(data.failure.kind)) {
      /*
       * "No route to host" is also what a failed neighbour lookup for a
       * dead on-link host prints, so an uncertain match must leave room for
       * the host being the one that is down.
       */
      if (!data.failure.isCertain) {
        return `This probe may have no route to ${host} (${detail}); ${host} itself may also be down.`;
      }

      return `This probe has no route to ${host}: ${detail}.`;
    }

    return `This probe could not send traffic to ${host} (${detail}), so ${host} was never contacted. The failure is on the probe, not on ${host}.`;
  }

  /*
   * The same cause as a lower-case clause with no trailing period, for a
   * caller that has its own lead-in, e.g. "Traceroute could not run: " +
   * clause + ".".
   */
  public static describeClause(data: {
    host: string;
    failure: ProbeNetworkFailure;
    isIPv6Destination?: boolean | undefined;
  }): string {
    const detail: string = data.failure.detail;

    if (ProbeNetworkFailureUtil.isIPv6Failure(data)) {
      return data.failure.isCertain
        ? `this probe cannot send IPv6 traffic (${detail})`
        : `this probe most likely has no IPv6 route (${detail})`;
    }

    if (ProbeNetworkFailureUtil.isRouteFailure(data.failure.kind)) {
      return data.failure.isCertain
        ? `this probe has no route to ${data.host} (${detail})`
        : `this probe may have no route to ${data.host} (${detail}); ${data.host} itself may also be down`;
    }

    return `this probe could not send traffic to ${data.host} (${detail})`;
  }

  /*
   * True for a stored cause that opens the way every describe() sentence
   * does: it is about this probe, not a verdict on the destination. Checks
   * the text rather than classifying it, because a caller such as an SNMP
   * send error ("send EADDRNOTAVAIL ...") carries no strerror marker.
   */
  public static isProbeSideCause(text: string | null | undefined): boolean {
    return Boolean(text && text.startsWith(PROBE_SIDE_CAUSE_PREFIX));
  }

  // classifyOutput + describe, for a caller that only has the OS text.
  public static describeOutput(data: {
    host: string;
    output: string;
    operation: ProbeNetworkOperation;
    isIPv6Destination?: boolean | undefined;
  }): string | null {
    const failure: ProbeNetworkFailure | null =
      ProbeNetworkFailureUtil.classifyOutput({
        output: data.output,
        operation: data.operation,
      });

    if (!failure) {
      return null;
    }

    return ProbeNetworkFailureUtil.describe({
      host: data.host,
      failure: failure,
      isIPv6Destination: data.isIPv6Destination,
    });
  }

  // classifyError + describe, for a caller holding a thrown value.
  public static describeError(data: {
    host: string;
    error: unknown;
    operation: ProbeNetworkOperation;
    isIPv6Destination?: boolean | undefined;
  }): string | null {
    const failure: ProbeNetworkFailure | null =
      ProbeNetworkFailureUtil.classifyError({
        error: data.error,
        operation: data.operation,
      });

    if (!failure) {
      return null;
    }

    return ProbeNetworkFailureUtil.describe({
      host: data.host,
      failure: failure,
      isIPv6Destination: data.isIPv6Destination,
    });
  }

  /*
   * How sure a kind can be for an operation: true (certain), false (likely),
   * or null (not the probe's failure at all for this operation).
   */
  private static getCertainty(
    kind: ProbeNetworkFailureKind,
    operation: ProbeNetworkOperation,
  ): boolean | null {
    switch (kind) {
      case ProbeNetworkFailureKind.NoSourceAddress:
      case ProbeNetworkFailureKind.AddressFamilyNotSupported:
        return true;
      case ProbeNetworkFailureKind.NetworkUnreachable:
        return operation === ProbeNetworkOperation.PingOrTraceroute;
      case ProbeNetworkFailureKind.NoRouteToHost:
        /*
         * From a TCP connect this is EHOSTUNREACH, a router or neighbour
         * lookup giving up on the target: not the probe's failure.
         */
        return operation === ProbeNetworkOperation.PingOrTraceroute
          ? false
          : null;
      default:
        return null;
    }
  }

  // See ProbeNetworkFailure.isCauseAmbiguous.
  private static isCauseAmbiguous(
    kind: ProbeNetworkFailureKind,
    operation: ProbeNetworkOperation,
  ): boolean {
    return (
      kind === ProbeNetworkFailureKind.NoSourceAddress &&
      operation === ProbeNetworkOperation.TcpConnect
    );
  }

  // The kinds where "no route" is the honest summary rather than "could not send".
  private static isRouteFailure(kind: ProbeNetworkFailureKind): boolean {
    return (
      kind === ProbeNetworkFailureKind.NetworkUnreachable ||
      kind === ProbeNetworkFailureKind.NoRouteToHost
    );
  }

  /*
   * The line of the text that carries the marker (the whole text when there
   * is no marker), trimmed, without a trailing period so it can be quoted
   * mid-sentence, and capped. ping's output mixes a banner and statistics in
   * with the one line that matters.
   */
  private static getDetail(text: string, marker: string): string {
    const lines: Array<string> = (text || "")
      .split(/\r?\n/)
      .map((line: string) => {
        return line.trim();
      })
      .filter((line: string) => {
        return line.length > 0;
      });

    const line: string =
      (marker
        ? lines.find((candidate: string) => {
            return candidate.toLowerCase().includes(marker);
          })
        : undefined) ||
      lines[0] ||
      "";

    return line.replace(/\.+$/, "").substring(0, MAX_DETAIL_LENGTH);
  }

  private static classifyErrorAtDepth(
    error: unknown,
    operation: ProbeNetworkOperation,
    depth: number,
  ): ProbeNetworkFailure | null {
    if (!error || typeof error !== "object" || depth > MAX_CAUSE_DEPTH) {
      return null;
    }

    const errorLike: ErrorLike = error as ErrorLike;

    if (Array.isArray(errorLike.errors) && errorLike.errors.length > 0) {
      const failures: Array<ProbeNetworkFailure | null> = errorLike.errors.map(
        (inner: unknown) => {
          return ProbeNetworkFailureUtil.classifyErrorAtDepth(
            inner,
            operation,
            depth + 1,
          );
        },
      );

      if (
        failures.some((failure: ProbeNetworkFailure | null) => {
          return failure === null;
        })
      ) {
        return null;
      }

      // The least certain one: the wording must not claim more than every attempt showed.
      const classified: Array<ProbeNetworkFailure> =
        failures as Array<ProbeNetworkFailure>;
      const representative: ProbeNetworkFailure | undefined =
        classified.find((failure: ProbeNetworkFailure) => {
          return !failure.isCertain;
        }) || classified[0];

      if (!representative) {
        return null;
      }

      /*
       * Its address is what a caller words the family from, so it is kept
       * only when every attempt named an address of that same family. A
       * dual-stack name whose IPv4 attempt failed as well is not an IPv6
       * problem: a mixed-family aggregate names no address, and the caller
       * falls back to the host it was checking.
       */
      if (
        !ProbeNetworkFailureUtil.isSingleFamily(
          classified,
          representative.address,
        )
      ) {
        const withoutAddress: ProbeNetworkFailure = { ...representative };
        delete withoutAddress.address;

        return withoutAddress;
      }

      return representative;
    }

    /*
     * A cause that carries its own code or attempts is the more specific
     * account, and it decides - even when it says "not the probe". A wrapper
     * such as an AxiosError copies its cause's code onto itself, and for an
     * aggregate that is only the FIRST attempt's code.
     */
    if (ProbeNetworkFailureUtil.carriesSocketError(errorLike.cause)) {
      return ProbeNetworkFailureUtil.classifyErrorAtDepth(
        errorLike.cause,
        operation,
        depth + 1,
      );
    }

    const message: string =
      typeof errorLike.message === "string" ? errorLike.message : "";

    if (typeof errorLike.code === "string") {
      return ProbeNetworkFailureUtil.classifyErrorCode({
        code: errorLike.code,
        operation: operation,
        detail: message || undefined,
        address:
          typeof errorLike.address === "string"
            ? HostAddressUtil.stripBrackets(errorLike.address)
            : undefined,
      });
    }

    if (errorLike.cause) {
      const fromCause: ProbeNetworkFailure | null =
        ProbeNetworkFailureUtil.classifyErrorAtDepth(
          errorLike.cause,
          operation,
          depth + 1,
        );

      if (fromCause) {
        return fromCause;
      }
    }

    return message
      ? ProbeNetworkFailureUtil.classifyOutput({
          output: message,
          operation: operation,
        })
      : null;
  }

  /*
   * True when every attempt named an address in the same family as
   * `address`. An attempt with no address could have been either family.
   */
  private static isSingleFamily(
    attempts: Array<ProbeNetworkFailure>,
    address: string | undefined,
  ): boolean {
    if (!address) {
      return true;
    }

    const isIPv6: boolean = HostAddressUtil.isIPv6(address);

    return attempts.every((attempt: ProbeNetworkFailure) => {
      return (
        Boolean(attempt.address) &&
        HostAddressUtil.isIPv6(attempt.address || "") === isIPv6
      );
    });
  }

  // True for a value that has a string code or a list of attempts to go on.
  private static carriesSocketError(value: unknown): boolean {
    if (!value || typeof value !== "object") {
      return false;
    }

    const errorLike: ErrorLike = value as ErrorLike;

    return (
      typeof errorLike.code === "string" ||
      (Array.isArray(errorLike.errors) && errorLike.errors.length > 0)
    );
  }
}
