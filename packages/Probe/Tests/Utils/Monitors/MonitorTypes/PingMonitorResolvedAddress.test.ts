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
import IPv4 from "Common/Types/IP/IPv4";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";
import ping from "ping";
import PingMonitor, {
  DeviceReachabilityCheck,
} from "../../../../Utils/Monitors/MonitorTypes/PingMonitor";
import {
  DevicePollConfig,
  pollDevice,
} from "../../../../Jobs/NetworkDevice/FetchList";

/*
 * OneUptime issue #5185: a network device registered by its DNS name has no
 * IP address anywhere in OneUptime - its probe resolves the name on every
 * poll and throws the answer away. The ping already knows it: the OS ping
 * prints the address it resolved the name to on its first line, and the
 * `ping` library parses that into `numeric_host`. checkReachability now
 * reports that address beside the verdict, and the poll sends it to the
 * server, which records it as the device's IP address, credited to the
 * probe.
 *
 * What must hold: only for a DNS name (an address needs no resolving), only
 * when what was parsed IS an address (never a name, a parser's "NA", or a
 * fragment of an error line), and whether or not the host answered - a host
 * that did not answer still has the address it did not answer at.
 *
 * The OS ping binary is never forked: ping.promise.probe is spied on, and
 * the library's real parsers are fed the real first lines of each OS ping.
 */

interface PingParser {
  eat: (line: string) => PingParser;
  getResult: () => ping.PingResponse;
}

interface ParserFactory {
  createParser: (
    address: string,
    platform: string,
    config?: ping.PingConfig,
  ) => PingParser;
}

/*
 * The library ships no types for its internals; jest.requireActual is how
 * PingMonitorCheckReachability.test.ts reaches its argument builder too.
 */
const parserFactory: ParserFactory = jest.requireActual(
  "ping/lib/parser/factory",
) as ParserFactory;

function parse(
  platform: string,
  address: string,
  lines: Array<string>,
): ping.PingResponse {
  const parser: PingParser = parserFactory.createParser(address, platform, {});
  for (const line of lines) {
    parser.eat(line);
  }
  return parser.getResult();
}

function makePingResult(
  overrides?: Partial<ping.PingResponse>,
): ping.PingResponse {
  return {
    inputHost: "core-sw-01.corp.example",
    host: "core-sw-01.corp.example",
    numeric_host: "10.20.0.1",
    alive: true,
    output: "2 packets transmitted, 2 packets received, 0.0% packet loss",
    time: 1.2,
    times: [1.2, 1.4],
    min: "1.200",
    max: "1.400",
    avg: "1.300",
    stddev: "0.100",
    packetLoss: "0.000",
    ...overrides,
  };
}

function makeDeadResult(
  overrides?: Partial<ping.PingResponse>,
): ping.PingResponse {
  return makePingResult({
    alive: false,
    output: "2 packets transmitted, 0 packets received, 100.0% packet loss",
    time: "unknown",
    times: [],
    min: "unknown",
    max: "unknown",
    avg: "unknown",
    stddev: "unknown",
    packetLoss: "100.000",
    ...overrides,
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("PingMonitor.getResolvedAddress", () => {
  test("a DNS name and the IPv4 address it was pinged at", () => {
    expect(
      PingMonitor.getResolvedAddress("core-sw-01.corp.example", {
        numeric_host: "10.20.0.1",
      }),
    ).toEqual({
      resolvedHost: "core-sw-01.corp.example",
      resolvedAddress: "10.20.0.1",
    });
  });

  test("an IPv6 address is an address too", () => {
    expect(
      PingMonitor.getResolvedAddress("core-sw-01.corp.example", {
        numeric_host: "2001:db8::1",
      }).resolvedAddress,
    ).toBe("2001:db8::1");
  });

  test("the parsed address is trimmed", () => {
    expect(
      PingMonitor.getResolvedAddress("core-sw-01.corp.example", {
        numeric_host: " 10.20.0.1 ",
      }).resolvedAddress,
    ).toBe("10.20.0.1");
  });

  test("a device polled at an address resolved nothing", () => {
    for (const address of ["10.20.0.1", "2001:db8::1"]) {
      expect(
        PingMonitor.getResolvedAddress(address, { numeric_host: address }),
      ).toEqual({});
    }
  });

  test.each([
    ["Windows' marker for a header it could not read", "NA"],
    ["a name echoed back", "core-sw-01.corp.example"],
    ["a fragment of an error line", "am"],
    ["half an address", "10.20.0"],
    ["nothing", ""],
  ])("%s is never reported as an address", (_label: string, value: string) => {
    expect(
      PingMonitor.getResolvedAddress("core-sw-01.corp.example", {
        numeric_host: value,
      }),
    ).toEqual({});
  });

  test("no parsed address, or no target, resolves nothing", () => {
    expect(
      PingMonitor.getResolvedAddress("core-sw-01.corp.example", {}),
    ).toEqual({});
    expect(
      PingMonitor.getResolvedAddress("", { numeric_host: "10.20.0.1" }),
    ).toEqual({});
  });
});

/*
 * The address comes from the library parsing each OS's own first line. These
 * are those lines, verbatim in shape, through the library's real parsers.
 */
describe("the address each OS ping prints, through the library's parser", () => {
  const NAME: string = "core-sw-01.corp.example";

  test("Linux, IPv4", () => {
    const result: ping.PingResponse = parse("linux", NAME, [
      `PING ${NAME} (10.20.0.1) 56(84) bytes of data.`,
    ]);

    expect(PingMonitor.getResolvedAddress(NAME, result)).toEqual({
      resolvedHost: NAME,
      resolvedAddress: "10.20.0.1",
    });
  });

  test("Linux, a name that resolved to IPv6", () => {
    const result: ping.PingResponse = parse("linux", NAME, [
      `PING ${NAME}(${NAME} (2001:db8::1)) 56 data bytes`,
    ]);

    expect(PingMonitor.getResolvedAddress(NAME, result).resolvedAddress).toBe(
      "2001:db8::1",
    );
  });

  test("macOS", () => {
    const result: ping.PingResponse = parse("darwin", NAME, [
      `PING ${NAME} (10.20.0.1): 56 data bytes`,
    ]);

    expect(PingMonitor.getResolvedAddress(NAME, result).resolvedAddress).toBe(
      "10.20.0.1",
    );
  });

  test("Windows", () => {
    const result: ping.PingResponse = parse("win32", NAME, [
      "",
      `Pinging ${NAME} [10.20.0.1] with 32 bytes of data:`,
    ]);

    expect(PingMonitor.getResolvedAddress(NAME, result).resolvedAddress).toBe(
      "10.20.0.1",
    );
  });

  test("a name that did not resolve: nothing, though the parser read something", () => {
    const result: ping.PingResponse = parse("linux", NAME, [
      `ping: ${NAME}: Name or service not known`,
    ]);

    // The parser takes a slice of the error line as the "address".
    expect(result.numeric_host).toBeTruthy();
    expect(PingMonitor.getResolvedAddress(NAME, result)).toEqual({});
  });
});

describe("checkReachability reports the address a DNS name resolved to", () => {
  // eslint-disable-next-line @typescript-eslint/typedef
  let probeSpy = jest.spyOn(ping.promise, "probe");

  beforeEach(() => {
    probeSpy = jest
      .spyOn(ping.promise, "probe")
      .mockResolvedValue(makePingResult());
  });

  test("a host that answers", async () => {
    const result: DeviceReachabilityCheck = await PingMonitor.checkReachability(
      { host: new Hostname("core-sw-01.corp.example") },
    );

    expect(result).toEqual({
      isOnline: true,
      avgRttMs: 1.3,
      packetLossPercent: 0,
      failureCause: "",
      resolvedHost: "core-sw-01.corp.example",
      resolvedAddress: "10.20.0.1",
    });
  });

  test("a host that does not answer still has the address it did not answer at", async () => {
    probeSpy.mockResolvedValue(makeDeadResult());

    const result: DeviceReachabilityCheck = await PingMonitor.checkReachability(
      { host: new Hostname("core-sw-01.corp.example") },
    );

    expect(result.isOnline).toBe(false);
    expect(result.resolvedHost).toBe("core-sw-01.corp.example");
    expect(result.resolvedAddress).toBe("10.20.0.1");
  });

  test("the attempt that decided is the one reported: a retry that resolved elsewhere", async () => {
    probeSpy
      .mockResolvedValueOnce(makeDeadResult({ numeric_host: "10.20.0.1" }))
      .mockResolvedValueOnce(makePingResult({ numeric_host: "10.20.0.9" }));

    const result: DeviceReachabilityCheck = await PingMonitor.checkReachability(
      { host: new Hostname("core-sw-01.corp.example") },
    );

    expect(result.isOnline).toBe(true);
    expect(result.resolvedAddress).toBe("10.20.0.9");
  });

  test("a device polled at an address reports nothing more than before", async () => {
    probeSpy.mockResolvedValue(
      makePingResult({ inputHost: "10.0.0.5", numeric_host: "10.0.0.5" }),
    );

    const result: DeviceReachabilityCheck = await PingMonitor.checkReachability(
      { host: new IPv4("10.0.0.5") },
    );

    expect(Object.keys(result).sort()).toEqual(
      ["avgRttMs", "failureCause", "isOnline", "packetLossPercent"].sort(),
    );
  });

  test("a ping that never ran resolved nothing", async () => {
    probeSpy.mockRejectedValue(new Error("spawn EAGAIN"));

    const result: DeviceReachabilityCheck = await PingMonitor.checkReachability(
      { host: new Hostname("core-sw-01.corp.example") },
    );

    expect(result.isOnline).toBe(false);
    expect(result.resolvedAddress).toBeUndefined();
    expect(result.resolvedHost).toBeUndefined();
  });
});

describe("the poll sends it to the server", () => {
  test("a DNS-named device's report carries the address in its ping response", async () => {
    // eslint-disable-next-line @typescript-eslint/typedef
    const fetchSpy = jest
      .spyOn(API, "fetch")
      .mockResolvedValue({ data: {} } as never);
    jest.spyOn(PingMonitor, "checkReachability").mockResolvedValue({
      isOnline: true,
      avgRttMs: 1.3,
      packetLossPercent: 0,
      failureCause: "",
      resolvedHost: "core-fw-01.acme.example",
      resolvedAddress: "10.0.0.1",
    });

    await pollDevice({
      networkDeviceId: "device-1",
      projectId: "project-1",
      hostname: "core-fw-01.acme.example",
      pollMode: "ping",
      collectEndpoints: false,
    } as unknown as DevicePollConfig);

    const ingest: Array<JSONObject> = fetchSpy.mock.calls
      .map((call: Array<unknown>) => {
        return call[0] as JSONObject;
      })
      .filter((request: JSONObject) => {
        return String(request["url"]).endsWith(
          "/probe/network-device/response/ingest",
        );
      });

    expect(ingest).toHaveLength(1);
    const pingResponse: JSONObject = (ingest[0]!["data"] as JSONObject)[
      "pingResponse"
    ] as JSONObject;
    expect(pingResponse["resolvedHost"]).toBe("core-fw-01.acme.example");
    expect(pingResponse["resolvedAddress"]).toBe("10.0.0.1");
  });
});
