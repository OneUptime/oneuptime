import Hostname from "../../Types/API/Hostname";
import URL from "../../Types/API/URL";
import Exception from "../../Types/Exception/Exception";
import IP from "../../Types/IP/IP";
import MonitorType from "../../Types/Monitor/MonitorType";
import HostAddressUtil from "../HostAddressUtil";

export interface ParsedMonitorDestination {
  destination: IP | URL | Hostname | undefined;
  // Null when the value parsed. A string is the message to show the operator.
  error: string | null;
}

/*
 * Turns what somebody typed (or, far more often, PASTED) into the monitor
 * destination for a monitor type, or into the reason it cannot be one.
 *
 * Lives here rather than inline in the dashboard form so the parsing is
 * testable on its own — the form's job is state, not address syntax.
 *
 * Two IPv6 shapes have to be handled that IPv4 never needed, and getting
 * either wrong is SILENT rather than loud:
 *
 *   - SURROUNDING WHITESPACE. An address copied out of a looking glass, a
 *     router config or a terminal usually arrives with a trailing space or a
 *     newline. IP.isIP deliberately does not trim, so " 2001:db8::1" was not
 *     an IP; it fell through to Hostname.fromString, which split it on the
 *     first colon into host "2001" / port 518 — a legal Port, so nothing
 *     threw, no error appeared, and the monitor saved was pointed at a host
 *     called "2001". The IPv4 equivalent, "1.1.1.1 ", has no colon and
 *     Hostname trims, so it always worked. That asymmetry is the whole bug:
 *     the same paste that works for v4 corrupts v6.
 *
 *   - BRACKETS. "[2001:db8::1]" is how an IPv6 host is written inside a URL,
 *     so it is what people have in front of them. For a Ping/IP/Port
 *     destination there is no URL, so the brackets are noise and are dropped
 *     — rather than rejected with "Hostname [2001 is not in valid format".
 */
export default class MonitorDestinationUtil {
  public static parse(data: {
    value: string;
    monitorType: MonitorType;
  }): ParsedMonitorDestination {
    const value: string = (data.value || "").trim();

    if (!value) {
      return { destination: undefined, error: "Destination is required" };
    }

    try {
      switch (data.monitorType) {
        case MonitorType.IP:
          return {
            destination: IP.fromString(HostAddressUtil.stripBrackets(value)),
            error: null,
          };

        case MonitorType.Ping:
        case MonitorType.Port: {
          const host: string = HostAddressUtil.stripBrackets(value);

          if (IP.isIP(host)) {
            return { destination: IP.fromString(host), error: null };
          }

          /*
           * A trailing colon is a port that was not typed, and
           * Hostname.fromAuthority DROPS it — deliberately, because a stored
           * "host:" should still read back as a host. Here that would be the
           * same class of bug this whole file exists to stop: "2001:" would
           * be stored as "2001", which is not what anybody typed. Say so
           * instead.
           */
          if (host.endsWith(":")) {
            return {
              destination: undefined,
              error: `${value} is not a valid hostname or IP address.`,
            };
          }

          /*
           * Not an address, so it is a name — possibly with a ":port", which
           * is what someone pasting "rs1.example.net:179" means.
           *
           * fromAuthority rather than `new Hostname`: the constructor accepts
           * a whole authority and stores it as the HOST, so the destination
           * would be a host literally named "rs1.example.net:179" and the
           * socket would go looking for it in DNS. fromAuthority splits the
           * port off properly, and — unlike the fromString this used to
           * call — leaves a bare IPv6 literal alone.
           */
          return { destination: Hostname.fromAuthority(host), error: null };
        }

        case MonitorType.Website:
        case MonitorType.API:
        case MonitorType.SSLCertificate:
          return {
            destination: URL.fromString(
              MonitorDestinationUtil.toUrlWithBracketedIpv6Host(value),
            ),
            error: null,
          };

        default:
          return { destination: undefined, error: null };
      }
    } catch (err: unknown) {
      return {
        destination: undefined,
        error:
          err instanceof Exception
            ? err.getMessage()
            : (err as Error)?.message || "Invalid Destination",
      };
    }
  }

  /*
   * A URL whose host is a BARE IPv6 literal is not a URL: "https://2001:db8::1/"
   * has to be written "https://[2001:db8::1]/", because otherwise the first
   * colon reads as the port separator. Node's own URL parser, axios and every
   * browser reject the bare form, so a Website or API monitor saved with one
   * failed permanently with an opaque target error.
   *
   * Brackets the host when it needs them, and leaves every other URL — every
   * IPv4 and DNS one — byte for byte alone.
   */
  public static toUrlWithBracketedIpv6Host(value: string): string {
    const trimmed: string = value.trim();
    const schemeMatch: RegExpMatchArray | null = trimmed.match(
      /^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)(.*)$/,
    );

    const scheme: string = schemeMatch ? (schemeMatch[1] as string) : "";
    const rest: string = schemeMatch ? (schemeMatch[2] as string) : trimmed;

    // The authority ends at the first "/", "?" or "#".
    const authorityEnd: number = rest.search(/[/?#]/);
    const authority: string =
      authorityEnd === -1 ? rest : rest.substring(0, authorityEnd);
    const remainder: string =
      authorityEnd === -1 ? "" : rest.substring(authorityEnd);

    // Userinfo is not a host; everything after the last "@" is.
    const atIndex: number = authority.lastIndexOf("@");
    const userInfo: string =
      atIndex === -1 ? "" : authority.substring(0, atIndex + 1);
    const host: string = authority.substring(atIndex + 1);

    if (!HostAddressUtil.isIPv6(host) || host.startsWith("[")) {
      return trimmed;
    }

    return `${scheme}${userInfo}[${host}]${remainder}`;
  }
}
