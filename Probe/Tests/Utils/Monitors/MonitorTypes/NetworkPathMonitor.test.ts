process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import NetworkPathMonitor from "../../../../Utils/Monitors/MonitorTypes/NetworkPathMonitor";
import { TraceRouteHop } from "Common/Types/Monitor/NetworkMonitor/NetworkPathTrace";
import { describe, expect, it } from "@jest/globals";

/*
 * Reading traceroute output back into hops.
 *
 * This is a text parser over the output of a program the probe does not
 * control, and its failure mode is a quiet one: a line it declines to
 * recognise simply is not a hop, so a path diagnosis comes back short rather
 * than wrong-looking. "3 hops to a host 12 away" reads like a healthy short
 * path, not like a parser that gave up, and nothing in the result says which
 * one happened.
 *
 * The cases that matter are the ones a real trace produces every time:
 * a hop that resolved a name AND an address, a hop with only an address, a
 * hop that timed out (`* * *`), the header line, and - on Windows - the
 * "name [address]" spelling that is two tokens rather than one.
 *
 * The parsers are private because nothing outside this class should call
 * them; they are reached here through the class object rather than
 * reimplemented, so these tests fail if the real ones change.
 */

interface ParserInternals {
  parseTracerouteOutput: (
    output: string,
    isWindows: boolean,
  ) => Array<TraceRouteHop>;
  isValidDestination: (destination: string) => boolean;
  isIPAddress: (address: string) => boolean;
}

const internals: ParserInternals =
  NetworkPathMonitor as unknown as ParserInternals;

function parseUnix(output: string): Array<TraceRouteHop> {
  return internals.parseTracerouteOutput(output, false);
}

function parseWindows(output: string): Array<TraceRouteHop> {
  return internals.parseTracerouteOutput(output, true);
}

describe("NetworkPathMonitor traceroute parsing", () => {
  describe("Unix / macOS", () => {
    it("reads a hop that resolved both a name and an address", () => {
      const [hop]: Array<TraceRouteHop> = parseUnix(
        " 1  router.local (192.168.1.1)  1.234 ms  1.567 ms  1.890 ms",
      );

      expect(hop).toEqual({
        hopNumber: 1,
        hostName: "router.local",
        address: "192.168.1.1",
        roundTripTimeInMS: 1.234,
        isTimeout: false,
      });
    });

    it("takes the FIRST round-trip time, not the last", () => {
      /*
       * Three probes per hop; the first is the one the rest of the product
       * charts, and picking another would quietly change every graph.
       */
      const [hop]: Array<TraceRouteHop> = parseUnix(
        " 5  core1.example.net (10.0.0.5)  8.5 ms  19.2 ms  31.7 ms",
      );

      expect(hop!.roundTripTimeInMS).toBe(8.5);
    });

    it("reads a hop that only gave an address", () => {
      const [hop]: Array<TraceRouteHop> = parseUnix(
        " 2  10.0.0.1  5.432 ms  5.678 ms  5.901 ms",
      );

      expect(hop!.address).toBe("10.0.0.1");
      expect(hop!.hostName).toBeUndefined();
      expect(hop!.roundTripTimeInMS).toBe(5.432);
      expect(hop!.isTimeout).toBe(false);
    });

    it("marks an all-asterisk hop as a timeout, keeping its number", () => {
      /*
       * The hop number has to survive: it is what tells an operator WHERE the
       * path breaks, and a dropped row would silently renumber everything
       * after it.
       */
      const [hop]: Array<TraceRouteHop> = parseUnix(" 7  * * *");

      expect(hop).toEqual({
        hopNumber: 7,
        address: undefined,
        hostName: undefined,
        roundTripTimeInMS: undefined,
        isTimeout: true,
      });
    });

    it("skips the header line rather than reading it as a hop", () => {
      const hops: Array<TraceRouteHop> = parseUnix(
        [
          "traceroute to example.com (93.184.216.34), 30 hops max, 60 byte packets",
          " 1  router.local (192.168.1.1)  1.2 ms  1.3 ms  1.4 ms",
        ].join("\n"),
      );

      expect(hops).toHaveLength(1);
      expect(hops[0]!.hopNumber).toBe(1);
    });

    it("skips blank lines", () => {
      const hops: Array<TraceRouteHop> = parseUnix(
        "\n 1  10.0.0.1  1.0 ms\n\n 2  10.0.0.2  2.0 ms\n\n",
      );

      expect(
        hops.map((hop: TraceRouteHop) => {
          return hop.hopNumber;
        }),
      ).toEqual([1, 2]);
    });

    it("reads a whole trace in order, timeouts included", () => {
      const hops: Array<TraceRouteHop> = parseUnix(
        [
          "traceroute to example.com (93.184.216.34), 30 hops max, 60 byte packets",
          " 1  router.local (192.168.1.1)  1.2 ms  1.3 ms  1.4 ms",
          " 2  * * *",
          " 3  core1.example.net (10.0.0.5)  8.5 ms  8.7 ms  8.9 ms",
          " 4  93.184.216.34  20.1 ms  20.3 ms  20.5 ms",
        ].join("\n"),
      );

      expect(hops).toHaveLength(4);
      expect(
        hops.map((hop: TraceRouteHop) => {
          return hop.isTimeout;
        }),
      ).toEqual([false, true, false, false]);
      expect(hops[3]!.address).toBe("93.184.216.34");
    });

    it("keeps a hop that answered with an unreachable notice instead of a time", () => {
      /*
       * !H / !N / !X mean the hop answered and refused to forward. That is a
       * different fact from a timeout and belongs in the path as the hop that
       * sent it, not as a gap.
       */
      const [hop]: Array<TraceRouteHop> = parseUnix(
        " 6  gw.example.net (10.9.9.9)  3.1 ms !H  3.2 ms !H",
      );

      expect(hop!.address).toBe("10.9.9.9");
      expect(hop!.hostName).toBe("gw.example.net");
      expect(hop!.isTimeout).toBe(false);
    });

    it("ignores a line with no hop number at all", () => {
      expect(parseUnix("some unexpected warning from traceroute")).toEqual([]);
    });

    it("ignores hop number 0, which no traceroute emits", () => {
      expect(parseUnix(" 0  10.0.0.1  1.0 ms")).toEqual([]);
    });

    it("returns nothing for empty output", () => {
      expect(parseUnix("")).toEqual([]);
    });
  });

  describe("Windows tracert", () => {
    it("reads a hop that gave only an address", () => {
      const [hop]: Array<TraceRouteHop> = parseWindows(
        "  1     1 ms     1 ms     1 ms  192.168.1.1",
      );

      expect(hop!.hopNumber).toBe(1);
      expect(hop!.address).toBe("192.168.1.1");
      expect(hop!.roundTripTimeInMS).toBe(1);
      expect(hop!.isTimeout).toBe(false);
    });

    it("splits a resolved 'name [address]' hop into both fields", () => {
      /*
       * Regression: tracert writes the resolved name and the bracketed
       * address as two whitespace-separated tokens, so taking the trailing
       * token alone yielded the literal "[93.184.216.34]" as the address and
       * threw the hostname away.
       */
      const [hop]: Array<TraceRouteHop> = parseWindows(
        "  8    18 ms    17 ms    18 ms  example.com [93.184.216.34]",
      );

      expect(hop!.hostName).toBe("example.com");
      expect(hop!.address).toBe("93.184.216.34");
    });

    it("marks 'Request timed out.' as a timeout", () => {
      const [hop]: Array<TraceRouteHop> = parseWindows(
        "  2     *        *        *     Request timed out.",
      );

      expect(hop!.isTimeout).toBe(true);
      expect(hop!.address).toBeUndefined();
      expect(hop!.hopNumber).toBe(2);
    });

    it("skips the two header lines", () => {
      const hops: Array<TraceRouteHop> = parseWindows(
        [
          "Tracing route to example.com [93.184.216.34]",
          "over a maximum of 30 hops:",
          "",
          "  1     1 ms     1 ms     1 ms  192.168.1.1",
        ].join("\n"),
      );

      expect(hops).toHaveLength(1);
      expect(hops[0]!.address).toBe("192.168.1.1");
    });
  });

  describe("isIPAddress", () => {
    it("recognises IPv4", () => {
      expect(internals.isIPAddress("192.168.1.1")).toBe(true);
      expect(internals.isIPAddress("8.8.8.8")).toBe(true);
    });

    it("recognises a full IPv6", () => {
      expect(
        internals.isIPAddress("2001:0db8:85a3:0000:0000:8a2e:0370:7334"),
      ).toBe(true);
    });

    it("does not mistake a hostname for an address", () => {
      expect(internals.isIPAddress("example.com")).toBe(false);
      expect(internals.isIPAddress("router.local")).toBe(false);
    });
  });

  describe("isValidDestination", () => {
    it("accepts hostnames and addresses", () => {
      expect(internals.isValidDestination("example.com")).toBe(true);
      expect(internals.isValidDestination("sub.example.co.uk")).toBe(true);
      expect(internals.isValidDestination("my-host.example.com")).toBe(true);
      expect(internals.isValidDestination("192.168.1.1")).toBe(true);
    });

    it("rejects shell metacharacters", () => {
      /*
       * The traceroute is spawned with execFile and an argv array, so a shell
       * never sees this string - but the guard is the reason that stays true
       * if the call site is ever refactored, and it is cheap to keep honest.
       */
      for (const hostile of [
        "example.com; rm -rf /",
        "example.com && whoami",
        "example.com | cat /etc/passwd",
        "$(whoami).example.com",
        "`whoami`.example.com",
        "example.com\nrm -rf /",
        "-example.com",
        "example.com/../../etc",
      ]) {
        expect(internals.isValidDestination(hostile)).toBe(false);
      }
    });

    it("rejects an empty destination", () => {
      expect(internals.isValidDestination("")).toBe(false);
    });

    it("rejects a name longer than a DNS name can be", () => {
      expect(internals.isValidDestination(`${"a".repeat(254)}.com`)).toBe(
        false,
      );
    });
  });
});
