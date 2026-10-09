process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    },
  };
});

import NtpMonitor, {
  NtpAttemptError,
} from "../../../../../Utils/Monitors/MonitorTypes/NtpMonitor";
import OnlineCheck from "../../../../../Utils/OnlineCheck";
import ProbeDnsLookup from "../../../../../Utils/Monitors/ProbeDnsLookup";
import FakeNtpServer, { FakeNtpBehaviour } from "./FakeNtpServer";
import Hostname from "Common/Types/API/Hostname";
import IPv4 from "Common/Types/IP/IPv4";
import IPv6 from "Common/Types/IP/IPv6";
import NtpMonitorResponse from "Common/Types/Monitor/NtpMonitor/NtpMonitorResponse";
import Port from "Common/Types/Port";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import { RequestFailedPhase } from "Common/Types/Probe/RequestFailedDetails";
import Sleep from "Common/Types/Sleep";
import dgram from "dgram";
import dns from "dns";

/*
 * The probe's NTP check over real UDP sockets, against FakeNtpServer on
 * 127.0.0.1: what it reports for a healthy server, a kiss-o'-death, an
 * unsynchronized server, silence, a closed port and the packets it must
 * ignore, and how it retries.
 *
 * Only three things are stubbed: the pause between attempts (so retries do
 * not cost a second each), the probe's own online check, and the DNS lookup
 * in the tests about host names.
 */

jest.setTimeout(30000);

type SpyLike = { mockRestore: () => void };

const SHORT_TIMEOUT_IN_MS: number = 300;

let server: FakeNtpServer | undefined = undefined;
let sleepSpy: ReturnType<typeof jest.spyOn> | undefined = undefined;
let onlineCheckSpy: ReturnType<typeof jest.spyOn> | undefined = undefined;
const extraSpies: Array<SpyLike> = [];

async function startServer(
  options: ConstructorParameters<typeof FakeNtpServer>[0],
): Promise<FakeNtpServer> {
  server = new FakeNtpServer(options);
  await server.start();
  return server;
}

async function query(data: {
  host?: string;
  port?: number;
  retry?: number;
  timeout?: number;
  isOnlineCheckRequest?: boolean;
}): Promise<NtpMonitorResponse | null> {
  return NtpMonitor.query({
    host: new IPv4(data.host || "127.0.0.1"),
    port: new Port(data.port ?? server!.port),
    options: {
      retry: data.retry ?? 0,
      timeout: data.timeout ?? SHORT_TIMEOUT_IN_MS,
      isOnlineCheckRequest: data.isOnlineCheckRequest,
    },
  });
}

// A UDP port nothing listens on: bind one, read its number, close it.
async function closedUdpPort(): Promise<number> {
  const socket: dgram.Socket = dgram.createSocket("udp4");

  await new Promise<void>((resolve: () => void): void => {
    socket.bind(0, "127.0.0.1", resolve);
  });

  const port: number = socket.address().port;

  await new Promise<void>((resolve: () => void): void => {
    socket.close(resolve);
  });

  return port;
}

function attemptNumbers(response: NtpMonitorResponse | null): Array<number> {
  return (response?.probeAttempts || []).map(
    (attempt: ProbeAttempt): number => {
      return attempt.attemptNumber;
    },
  );
}

beforeEach(() => {
  sleepSpy = jest.spyOn(Sleep, "sleep").mockResolvedValue(undefined);
  onlineCheckSpy = jest
    .spyOn(OnlineCheck, "canProbeMonitorPortMonitors")
    .mockResolvedValue(true);
});

afterEach(async () => {
  sleepSpy?.mockRestore();
  onlineCheckSpy?.mockRestore();

  while (extraSpies.length > 0) {
    extraSpies.pop()!.mockRestore();
  }

  if (server) {
    await server.stop();
    server = undefined;
  }
});

describe("NtpMonitor.query against a healthy server", () => {
  test("reports it answered, synchronized, with its stratum, reference and header", async () => {
    await startServer({
      behaviour: FakeNtpBehaviour.Healthy,
      stratum: 2,
      referenceId: Buffer.from([203, 0, 113, 7]),
    });

    const response: NtpMonitorResponse | null = await query({});

    expect(response).not.toBeNull();
    expect(response!.isOnline).toBe(true);
    expect(response!.isSynchronized).toBe(true);
    expect(response!.failureCause).toBe("");
    expect(response!.isTimeout).toBe(false);
    expect(response!.stratum).toBe(2);
    expect(response!.version).toBe(4);
    expect(response!.leapIndicator).toBe(0);
    expect(response!.kissCode).toBeUndefined();
    expect(response!.referenceId).toBe("203.0.113.7");
    expect(response!.serverAddress).toBe("127.0.0.1");
    expect(response!.port).toBe(server!.port);
    expect(response!.pollIntervalInSeconds).toBe(64);
    expect(response!.rootDelayInMs).toBeCloseTo(12.5, 1);
    expect(response!.rootDispersionInMs).toBeCloseTo(3.25, 1);
    expect(response!.dnsLookupInMs).toBeUndefined();
    expect(response!.totalAttempts).toBe(1);
  });

  test("sends one well-formed SNTP v4 client request from an ephemeral port", async () => {
    await startServer({ behaviour: FakeNtpBehaviour.Healthy });

    await query({});

    expect(server!.requests).toHaveLength(1);
    const request: Buffer = server!.requests[0]!;
    expect(request.length).toBe(48);
    expect(request[0]).toBe(0x23);
    expect(
      request.subarray(40, 48).every((b: number) => {
        return b === 0;
      }),
    ).toBe(false);
  });

  test("measures a server 250 ms ahead as about +250 ms", async () => {
    await startServer({
      behaviour: FakeNtpBehaviour.Healthy,
      clockSkewInMs: 250,
    });

    const response: NtpMonitorResponse | null = await query({});

    expect(response!.clockOffsetInMs!).toBeGreaterThan(240);
    expect(response!.clockOffsetInMs!).toBeLessThan(260);
    expect(response!.isSynchronized).toBe(true);
  });

  test("measures a server 2 seconds behind as about -2000 ms", async () => {
    await startServer({
      behaviour: FakeNtpBehaviour.Healthy,
      clockSkewInMs: -2000,
    });

    const response: NtpMonitorResponse | null = await query({});

    expect(response!.clockOffsetInMs!).toBeGreaterThan(-2010);
    expect(response!.clockOffsetInMs!).toBeLessThan(-1990);
    // Being off is a fact about the time, not about synchronization.
    expect(response!.isSynchronized).toBe(true);
    expect(response!.failureCause).toBe("");
  });

  test("times the exchange: a server that takes 120 ms answers in about 120 ms", async () => {
    await startServer({
      behaviour: FakeNtpBehaviour.Healthy,
      replyDelayInMs: 120,
    });

    const response: NtpMonitorResponse | null = await query({ timeout: 2000 });

    expect(response!.responseTimeInMs).toBeGreaterThanOrEqual(115);
    expect(response!.responseTimeInMs).toBeLessThan(1000);
    // The server's time is read when it received the request, not when it answered.
    expect(response!.roundTripDelayInMs!).toBeGreaterThanOrEqual(115);
  });

  test("reads an NTPv3 reply, as tick.jrc.us and time.nist.gov send", async () => {
    await startServer({ behaviour: FakeNtpBehaviour.Healthy, version: 3 });

    const response: NtpMonitorResponse | null = await query({});

    expect(response!.isOnline).toBe(true);
    expect(response!.version).toBe(3);
  });

  test("gives the server's time and its last sync as ISO dates", async () => {
    await startServer({ behaviour: FakeNtpBehaviour.Healthy });

    const before: number = Date.now();
    const response: NtpMonitorResponse | null = await query({});

    expect(Math.abs(Date.parse(response!.serverTime!) - before)).toBeLessThan(
      2000,
    );
    // The fake server last synced a minute before it answered.
    expect(Date.parse(response!.referenceTime!)).toBeLessThan(
      Date.parse(response!.serverTime!),
    );
  });
});

describe("NtpMonitor.query against a server that answers without good time", () => {
  test("a RATE kiss-o'-death is an answer, not synchronized, with its kiss code and no offset", async () => {
    await startServer({ behaviour: FakeNtpBehaviour.KissOfDeathRate });

    const response: NtpMonitorResponse | null = await query({ retry: 3 });

    expect(response!.isOnline).toBe(true);
    expect(response!.isSynchronized).toBe(false);
    expect(response!.stratum).toBe(0);
    expect(response!.kissCode).toBe("RATE");
    expect(response!.clockOffsetInMs).toBeUndefined();
    // Not a 0 ms error bound on the chart: a kiss describes no clock.
    expect(response!.rootDelayInMs).toBeUndefined();
    expect(response!.rootDispersionInMs).toBeUndefined();
    expect(response!.failureCause).toContain("kiss-o'-death (RATE)");
    expect(response!.failureCause).toContain("rate-limiting this probe");
  });

  test("a kiss-o'-death is never retried: asking again is what RATE says not to do", async () => {
    await startServer({ behaviour: FakeNtpBehaviour.KissOfDeathRate });

    const response: NtpMonitorResponse | null = await query({ retry: 3 });

    expect(server!.requests).toHaveLength(1);
    expect(attemptNumbers(response)).toEqual([1]);
    expect(sleepSpy).not.toHaveBeenCalled();
  });

  test("a server before its first sync (INIT) answers with its own clock, not synchronized", async () => {
    await startServer({
      behaviour: FakeNtpBehaviour.NotYetSynchronized,
      clockSkewInMs: 5000,
    });

    const response: NtpMonitorResponse | null = await query({});

    expect(response!.isOnline).toBe(true);
    expect(response!.isSynchronized).toBe(false);
    expect(response!.kissCode).toBe("INIT");
    expect(response!.clockOffsetInMs!).toBeGreaterThan(4990);
    expect(response!.failureCause).toContain("INIT");
    expect(response!.failureCause).toContain("not synchronized its clock");
  });

  test("a stratum 16 server with the leap alarm is answered but not synchronized", async () => {
    await startServer({ behaviour: FakeNtpBehaviour.Stratum16 });

    const response: NtpMonitorResponse | null = await query({});

    expect(response!.isOnline).toBe(true);
    expect(response!.isSynchronized).toBe(false);
    expect(response!.stratum).toBe(16);
    expect(response!.leapIndicator).toBe(3);
    expect(response!.failureCause).toBe(
      "The server reports its clock as not synchronized (leap indicator 3, alarm).",
    );
  });
});

describe("NtpMonitor.query when nothing answers", () => {
  test("a silent server times out on every attempt and says so", async () => {
    await startServer({ behaviour: FakeNtpBehaviour.Silent });

    const response: NtpMonitorResponse | null = await query({ retry: 2 });

    expect(response!.isOnline).toBe(false);
    expect(response!.isSynchronized).toBe(false);
    expect(response!.isTimeout).toBe(true);
    expect(response!.responseTimeInMs).toBe(0);
    expect(response!.failureCause).toBe(
      `No NTP reply from 127.0.0.1:${server!.port} within 0.3 seconds. Tried 3 times.`,
    );
    // The root cause's "Request Failed Details" read these.
    expect(response!.requestFailedDetails).toMatchObject({
      failedPhase: RequestFailedPhase.RequestTimeout,
      errorCode: "TIMEOUT",
    });
    expect(response!.requestFailedDetails!.errorDescription).toContain(
      "UDP port 123",
    );
    expect(attemptNumbers(response)).toEqual([1, 2, 3]);
    expect(server!.requests).toHaveLength(3);
    // A fresh request, with a fresh nonce, every attempt.
    expect(
      new Set(
        server!.requests.map((request: Buffer): string => {
          return request.subarray(40, 48).toString("hex");
        }),
      ).size,
    ).toBe(3);
  });

  test("retries 0 means exactly one attempt", async () => {
    await startServer({ behaviour: FakeNtpBehaviour.Silent });

    const response: NtpMonitorResponse | null = await query({ retry: 0 });

    expect(attemptNumbers(response)).toEqual([1]);
    expect(response!.failureCause).not.toContain("Tried");
    expect(sleepSpy).not.toHaveBeenCalled();
  });

  test("with no retry count it makes four attempts, a second apart", async () => {
    await startServer({ behaviour: FakeNtpBehaviour.Silent });

    const response: NtpMonitorResponse | null = await NtpMonitor.query({
      host: new IPv4("127.0.0.1"),
      port: server!.port,
      options: { timeout: 100 },
    });

    expect(attemptNumbers(response)).toEqual([1, 2, 3, 4]);
    expect(sleepSpy).toHaveBeenCalledTimes(3);
    expect(sleepSpy).toHaveBeenCalledWith(1000);
  });

  test("a server that answers the second attempt is online, with both attempts recorded", async () => {
    await startServer({
      behaviour: FakeNtpBehaviour.SilentThenHealthy,
      silentRequestCount: 1,
    });

    const response: NtpMonitorResponse | null = await query({ retry: 3 });

    expect(response!.isOnline).toBe(true);
    expect(response!.isSynchronized).toBe(true);
    expect(attemptNumbers(response)).toEqual([1, 2]);
    expect(response!.probeAttempts![0]!.isOnline).toBe(false);
    expect(response!.probeAttempts![1]!.isOnline).toBe(true);
  });

  test("a closed port is refused at once (ICMP port unreachable), not waited out", async () => {
    const port: number = await closedUdpPort();
    const startedAt: number = Date.now();

    const response: NtpMonitorResponse | null = await NtpMonitor.query({
      host: new IPv4("127.0.0.1"),
      port: port,
      options: { retry: 0, timeout: 5000 },
    });

    expect(Date.now() - startedAt).toBeLessThan(4000);
    expect(response!.isOnline).toBe(false);
    expect(response!.isTimeout).toBe(false);
    expect(response!.failureCause).toBe(
      `127.0.0.1:${port} refused the request: nothing is listening for NTP on UDP port ${port} there (ICMP port unreachable).`,
    );
    expect(response!.requestFailedDetails).toMatchObject({
      failedPhase: RequestFailedPhase.NetworkError,
      errorCode: "ECONNREFUSED",
    });
  });

  test("a probe that has lost its own network reports nothing rather than blame the server", async () => {
    await startServer({ behaviour: FakeNtpBehaviour.Silent });
    onlineCheckSpy!.mockResolvedValue(false);

    const response: NtpMonitorResponse | null = await query({});

    expect(response).toBeNull();
    expect(onlineCheckSpy).toHaveBeenCalledTimes(1);
  });

  test("the probe's own online check never consults the online check", async () => {
    await startServer({ behaviour: FakeNtpBehaviour.Silent });
    onlineCheckSpy!.mockResolvedValue(false);

    const response: NtpMonitorResponse | null = await query({
      isOnlineCheckRequest: true,
    });

    expect(response!.isOnline).toBe(false);
    expect(onlineCheckSpy).not.toHaveBeenCalled();
  });

  test("an answering server never triggers the online check", async () => {
    await startServer({ behaviour: FakeNtpBehaviour.Healthy });

    await query({});

    expect(onlineCheckSpy).not.toHaveBeenCalled();
  });
});

describe("NtpMonitor.query ignores packets that are not the reply", () => {
  test("a stale or spoofed reply before the real one is ignored, and the real one is used", async () => {
    await startServer({ behaviour: FakeNtpBehaviour.WrongOriginThenReal });

    const response: NtpMonitorResponse | null = await query({});

    expect(response!.isOnline).toBe(true);
    // The spoofed packet claimed a clock 100 seconds off.
    expect(Math.abs(response!.clockOffsetInMs!)).toBeLessThan(50);
  });

  test("only stale or spoofed replies is no answer at all", async () => {
    await startServer({ behaviour: FakeNtpBehaviour.WrongOriginOnly });

    const response: NtpMonitorResponse | null = await query({});

    expect(response!.isOnline).toBe(false);
    expect(response!.isTimeout).toBe(true);
    expect(response!.failureCause).toContain(
      "The probe ignored a packet that did not answer its request",
    );
    expect(response!.failureCause).toContain("stale or spoofed");
  });

  test("a packet shorter than 48 bytes is ignored", async () => {
    await startServer({ behaviour: FakeNtpBehaviour.ShortPacketOnly });

    const response: NtpMonitorResponse | null = await query({});

    expect(response!.isOnline).toBe(false);
    expect(response!.failureCause).toContain("47-byte packet");
  });

  test("the request reflected back (mode 3) is ignored", async () => {
    await startServer({ behaviour: FakeNtpBehaviour.EchoRequestOnly });

    const response: NtpMonitorResponse | null = await query({});

    expect(response!.isOnline).toBe(false);
    expect(response!.failureCause).toContain("mode 3");
  });
});

describe("NtpMonitor.query with a host name", () => {
  test("looks the name up and reports how long that took", async () => {
    await startServer({ behaviour: FakeNtpBehaviour.Healthy });

    const lookupSpy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(ProbeDnsLookup, "lookupWithoutAddrConfig")
      .mockImplementation(((
        _hostname: string,
        _options: dns.LookupOptions,
        callback: (
          error: NodeJS.ErrnoException | null,
          addresses: Array<dns.LookupAddress>,
        ) => void,
      ): void => {
        setTimeout((): void => {
          callback(null, [{ address: "127.0.0.1", family: 4 }]);
        }, 15);
      }) as never);
    extraSpies.push(lookupSpy);

    const response: NtpMonitorResponse | null = await NtpMonitor.query({
      host: new Hostname("time.example.com"),
      port: server!.port,
      options: { retry: 0, timeout: 2000 },
    });

    expect(lookupSpy).toHaveBeenCalledWith(
      "time.example.com",
      { all: true },
      expect.any(Function),
    );
    expect(response!.isOnline).toBe(true);
    expect(response!.serverAddress).toBe("127.0.0.1");
    expect(response!.dnsLookupInMs!).toBeGreaterThanOrEqual(10);
  });

  test("a name that does not resolve is a DNS failure, retried like any other", async () => {
    const lookupSpy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(ProbeDnsLookup, "lookupWithoutAddrConfig")
      .mockImplementation(((
        hostname: string,
        _options: dns.LookupOptions,
        callback: (error: NodeJS.ErrnoException | null) => void,
      ): void => {
        const error: NodeJS.ErrnoException = new Error(
          `getaddrinfo ENOTFOUND ${hostname}`,
        );
        error.code = "ENOTFOUND";
        callback(error);
      }) as never);
    extraSpies.push(lookupSpy);

    const response: NtpMonitorResponse | null = await NtpMonitor.query({
      host: new Hostname("no-such-host.invalid"),
      options: { retry: 1, timeout: 500 },
    });

    expect(response!.isOnline).toBe(false);
    expect(response!.isTimeout).toBe(false);
    expect(response!.failureCause).toBe(
      "Could not resolve no-such-host.invalid (ENOTFOUND). Tried 2 times.",
    );
    expect(response!.requestFailedDetails).toMatchObject({
      failedPhase: RequestFailedPhase.DNSResolution,
      errorCode: "ENOTFOUND",
    });
    expect(lookupSpy).toHaveBeenCalledTimes(2);
  });

  test("a lookup that hangs is cut off by the attempt's timeout", async () => {
    const lookupSpy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(ProbeDnsLookup, "lookupWithoutAddrConfig")
      .mockImplementation((() => {
        // Never calls back.
      }) as never);
    extraSpies.push(lookupSpy);

    const response: NtpMonitorResponse | null = await NtpMonitor.query({
      host: new Hostname("slow.example.com"),
      options: { retry: 0, timeout: 200 },
    });

    expect(response!.isOnline).toBe(false);
    expect(response!.isTimeout).toBe(true);
    expect(response!.failureCause).toBe(
      "Looking up slow.example.com did not finish within 0.2 seconds.",
    );
    expect(response!.requestFailedDetails).toMatchObject({
      failedPhase: RequestFailedPhase.DNSResolution,
      errorCode: "TIMEOUT",
    });
  });

  test("an IPv6 address this probe cannot send to falls back to the name's IPv4 address", async () => {
    await startServer({ behaviour: FakeNtpBehaviour.Healthy });

    extraSpies.push(
      jest
        .spyOn(ProbeDnsLookup, "lookupWithoutAddrConfig")
        .mockImplementation(((
          _hostname: string,
          _options: dns.LookupOptions,
          callback: (
            error: NodeJS.ErrnoException | null,
            addresses: Array<dns.LookupAddress>,
          ) => void,
        ): void => {
          callback(null, [
            { address: "2001:db8::123", family: 6 },
            { address: "127.0.0.1", family: 4 },
          ]);
        }) as never),
    );

    /*
     * A probe with no IPv6: connect() on the udp6 socket fails on the
     * probe's side, before anything is sent.
     */
    const realCreateSocket: typeof dgram.createSocket = dgram.createSocket;
    const udp6Attempts: Array<string> = [];

    extraSpies.push(
      jest.spyOn(dgram, "createSocket").mockImplementation(((
        options: dgram.SocketOptions,
      ): dgram.Socket => {
        const socket: dgram.Socket = realCreateSocket(options);

        if (options.type === "udp6") {
          socket.connect = ((
            _port: number,
            address: string,
            callback: (error?: Error) => void,
          ): void => {
            udp6Attempts.push(address);
            const error: NodeJS.ErrnoException = new Error(
              `connect EADDRNOTAVAIL ${address}`,
            );
            error.code = "EADDRNOTAVAIL";
            process.nextTick((): void => {
              callback(error);
            });
          }) as never;
        }

        return socket;
      }) as never),
    );

    const response: NtpMonitorResponse | null = await NtpMonitor.query({
      host: new Hostname("dual-stack.example.com"),
      port: server!.port,
      options: { retry: 0, timeout: 2000 },
    });

    expect(udp6Attempts).toEqual(["2001:db8::123"]);
    expect(response!.isOnline).toBe(true);
    expect(response!.serverAddress).toBe("127.0.0.1");
  });

  test("an IPv6-only target this probe cannot send to is the probe's failure, worded as such", async () => {
    const realCreateSocket: typeof dgram.createSocket = dgram.createSocket;

    extraSpies.push(
      jest.spyOn(dgram, "createSocket").mockImplementation(((
        options: dgram.SocketOptions,
      ): dgram.Socket => {
        const socket: dgram.Socket = realCreateSocket(options);

        socket.connect = ((
          _port: number,
          address: string,
          callback: (error?: Error) => void,
        ): void => {
          const error: NodeJS.ErrnoException = new Error(
            `connect EADDRNOTAVAIL ${address}`,
          );
          error.code = "EADDRNOTAVAIL";
          process.nextTick((): void => {
            callback(error);
          });
        }) as never;

        return socket;
      }) as never),
    );

    const response: NtpMonitorResponse | null = await NtpMonitor.query({
      host: new IPv6("2001:db8::123"),
      options: { retry: 0, timeout: 2000 },
    });

    expect(response!.isOnline).toBe(false);
    expect(response!.failureCause.startsWith("This probe ")).toBe(true);
    expect(response!.failureCause).toContain("IPv6");
  });
});

describe("NtpMonitor.getTarget", () => {
  test("defaults to port 123", () => {
    expect(
      NtpMonitor.getTarget({ host: new Hostname("time.example.com") }),
    ).toEqual({ host: "time.example.com", port: 123 });
  });

  test("uses the step's port", () => {
    expect(
      NtpMonitor.getTarget({
        host: new IPv4("192.0.2.10"),
        port: new Port(1123),
      }),
    ).toEqual({ host: "192.0.2.10", port: 1123 });
  });

  test("a port typed into the host wins over the step's", () => {
    expect(
      NtpMonitor.getTarget({
        host: Hostname.fromAuthority("time.example.com:4123"),
        port: new Port(1123),
      }),
    ).toEqual({ host: "time.example.com", port: 4123 });
  });

  test("drops the brackets of an IPv6 literal", () => {
    expect(NtpMonitor.getTarget({ host: new IPv6("2001:db8::1") }).host).toBe(
      "2001:db8::1",
    );
    expect(
      NtpMonitor.getTarget({
        host: Hostname.fromAuthority("[2001:db8::1]:123"),
      }),
    ).toEqual({ host: "2001:db8::1", port: 123 });
  });

  test("a port of 0 is no port", () => {
    expect(
      NtpMonitor.getTarget({ host: new IPv4("192.0.2.10"), port: 0 }).port,
    ).toBe(123);
  });
});

describe("NtpMonitor.getCandidates", () => {
  test("tries the first address, then the first of the other family", () => {
    expect(
      NtpMonitor.getCandidates([
        { address: "2001:db8::1", family: 6 },
        { address: "2001:db8::2", family: 6 },
        { address: "192.0.2.1", family: 4 },
        { address: "192.0.2.2", family: 4 },
      ]),
    ).toEqual([
      { address: "2001:db8::1", family: 6 },
      { address: "192.0.2.1", family: 4 },
    ]);
  });

  test("a single-family name is tried on its first address only", () => {
    expect(
      NtpMonitor.getCandidates([
        { address: "192.0.2.1", family: 4 },
        { address: "192.0.2.2", family: 4 },
      ]),
    ).toEqual([{ address: "192.0.2.1", family: 4 }]);
    expect(NtpMonitor.getCandidates([])).toEqual([]);
  });
});

describe("NtpMonitor.toAttemptError", () => {
  function errorWithCode(message: string, code: string): Error {
    const error: NodeJS.ErrnoException = new Error(message);
    error.code = code;
    return error;
  }

  test.each(["ENOTFOUND", "EAI_AGAIN", "EAI_FAIL"])(
    "%s is a DNS failure",
    (code: string) => {
      const error: NtpAttemptError = NtpMonitor.toAttemptError({
        error: errorWithCode(`getaddrinfo ${code} time.example.com`, code),
        host: "time.example.com",
        port: 123,
        timeoutInMs: 5000,
      });

      expect(error.failureCause).toBe(
        `Could not resolve time.example.com (${code}).`,
      );
      expect(error.requestFailedDetails.failedPhase).toBe(
        RequestFailedPhase.DNSResolution,
      );
      expect(error.isTimeout).toBe(false);
    },
  );

  test("ECONNREFUSED says nothing listens on the port", () => {
    const error: NtpAttemptError = NtpMonitor.toAttemptError({
      error: errorWithCode("recv ECONNREFUSED", "ECONNREFUSED"),
      host: "2001:db8::1",
      port: 123,
      timeoutInMs: 5000,
    });

    expect(error.failureCause).toBe(
      "[2001:db8::1]:123 refused the request: nothing is listening for NTP on UDP port 123 there (ICMP port unreachable).",
    );
    expect(error.code).toBe("ECONNREFUSED");
  });

  test("ENETUNREACH on an IPv4 target is this probe having no route", () => {
    const error: NtpAttemptError = NtpMonitor.toAttemptError({
      error: errorWithCode("connect ENETUNREACH 192.0.2.10", "ENETUNREACH"),
      host: "192.0.2.10",
      port: 123,
      timeoutInMs: 5000,
    });

    expect(error.failureCause.startsWith("This probe ")).toBe(true);
    expect(error.requestFailedDetails.errorDescription).toContain(
      "The failure is on the probe",
    );
  });

  test("anything else is a network error that quotes the OS", () => {
    const error: NtpAttemptError = NtpMonitor.toAttemptError({
      error: errorWithCode("send EMSGSIZE 192.0.2.10:123", "EMSGSIZE"),
      host: "192.0.2.10",
      port: 123,
      timeoutInMs: 5000,
    });

    expect(error.failureCause).toBe(
      "The NTP request to 192.0.2.10:123 failed: send EMSGSIZE 192.0.2.10:123.",
    );
    expect(error.requestFailedDetails.failedPhase).toBe(
      RequestFailedPhase.NetworkError,
    );
  });

  test("an NtpAttemptError passes through unchanged", () => {
    const original: NtpAttemptError = new NtpAttemptError({
      failureCause: "already worded",
      requestFailedDetails: {
        failedPhase: RequestFailedPhase.RequestTimeout,
        errorDescription: "x",
      },
    });

    expect(
      NtpMonitor.toAttemptError({
        error: original,
        host: "h",
        port: 123,
        timeoutInMs: 1,
      }),
    ).toBe(original);
  });
});
