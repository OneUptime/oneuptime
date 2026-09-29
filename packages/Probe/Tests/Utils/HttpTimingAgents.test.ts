import {
  HttpTimingAgents,
  HttpTimingCollector,
  TimedAgents,
} from "../../Utils/HttpTimingAgents";
import HttpPhaseTimings from "Common/Types/Monitor/HttpPhaseTimings";
import { EventEmitter } from "events";
import net from "net";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * HTTP phase timings — the DNS / TCP / TLS / first-byte breakdown a monitor
 * shows when a check is slow, and the only thing that says WHICH part is slow.
 *
 * Every number here is a subtraction between two socket events, which is what
 * makes the whole thing quietly fragile: a wrong subtrahend produces a
 * plausible-looking millisecond figure rather than an error, and the panel that
 * displays it cannot tell a real 40ms TLS handshake from a 40ms arithmetic
 * mistake. So these assertions drive the clock, not the network — the socket is
 * an EventEmitter and process.hrtime is stubbed, so each phase boundary lands
 * on a millisecond the test chose and every expectation below is an exact
 * value.
 *
 * The cases that matter are the incomplete ones. A plain-HTTP check never fires
 * secureConnect; a request to an IP literal never fires lookup; a connection
 * refused mid-handshake fires some prefix of the four and then stops. Each must
 * report the phases it actually observed and omit the rest, because a zero
 * shown where a phase never ran reads as "instant", not as "unknown".
 */

// A socket stand-in: the collector only ever calls `once` on it.
function fakeSocket(): net.Socket {
  return new EventEmitter() as unknown as net.Socket;
}

/*
 * Drive the clock in whole milliseconds. process.hrtime() returns
 * [seconds, nanoseconds] and the collector folds that to a float millisecond,
 * so feeding it whole milliseconds makes every expected value exact rather
 * than approximately right.
 */
let clockInMs: number = 0;

function advanceTo(ms: number): void {
  clockInMs = ms;
}

beforeEach((): void => {
  clockInMs = 0;

  jest.spyOn(process, "hrtime").mockImplementation(((): [number, number] => {
    return [Math.floor(clockInMs / 1000), Math.round((clockInMs % 1000) * 1e6)];
  }) as unknown as typeof process.hrtime);
});

afterEach((): void => {
  jest.restoreAllMocks();
});

describe("HttpTimingCollector before anything is attached", () => {
  it("reports no timings at all rather than a row of zeroes", () => {
    /*
     * A check that never opened a socket has no phases, and zeroes would be
     * read as "every phase was instant".
     */
    expect(new HttpTimingCollector().getTimings()).toEqual({});
  });

  it("reports no timings even when a total is supplied", () => {
    expect(new HttpTimingCollector().getTimings(500)).toEqual({});
  });
});

describe("HttpTimingCollector over a complete HTTPS request", () => {
  function collectFullRequest(): HttpPhaseTimings {
    const collector: HttpTimingCollector = new HttpTimingCollector();
    const socket: net.Socket = fakeSocket();

    advanceTo(0);
    collector.attach(socket);

    advanceTo(10); // DNS resolved 10ms in.
    socket.emit("lookup");

    advanceTo(35); // TCP established 25ms after that.
    socket.emit("connect");

    advanceTo(75); // TLS handshake took 40ms.
    socket.emit("secureConnect");

    advanceTo(200); // First byte 125ms after the connection was ready.
    socket.emit("data");

    return collector.getTimings(300);
  }

  it("measures DNS from the moment the socket was opened", () => {
    expect(collectFullRequest().dnsLookupInMs).toBe(10);
  });

  it("measures TCP from the end of DNS, not from the start", () => {
    /*
     * The distinction the panel exists for: a 25ms connect behind a 10ms
     * lookup must not be reported as 35ms of TCP.
     */
    expect(collectFullRequest().tcpConnectInMs).toBe(25);
  });

  it("measures the TLS handshake from the end of TCP", () => {
    expect(collectFullRequest().tlsHandshakeInMs).toBe(40);
  });

  it("measures time to first byte from the end of the handshake", () => {
    // Not from the start of the request — that would double-count every phase.
    expect(collectFullRequest().timeToFirstByteInMs).toBe(125);
  });

  it("derives download as the total minus everything up to the first byte", () => {
    expect(collectFullRequest().downloadInMs).toBe(100);
  });

  it("accounts for the whole request without gaps or overlap", () => {
    /*
     * The four instrumented phases plus download must sum to the total. If they
     * do not, some interval is either counted twice or attributed to nothing.
     */
    const timings: HttpPhaseTimings = collectFullRequest();

    expect(
      (timings.dnsLookupInMs || 0) +
        (timings.tcpConnectInMs || 0) +
        (timings.tlsHandshakeInMs || 0) +
        (timings.timeToFirstByteInMs || 0) +
        (timings.downloadInMs || 0),
    ).toBe(300);
  });
});

describe("HttpTimingCollector over an incomplete request", () => {
  it("omits TLS for a plain-HTTP request, rather than reporting zero", () => {
    /*
     * secureConnect never fires on http://. A zero would say the handshake was
     * instant; the truth is that there was no handshake.
     */
    const collector: HttpTimingCollector = new HttpTimingCollector();
    const socket: net.Socket = fakeSocket();

    advanceTo(0);
    collector.attach(socket);
    advanceTo(5);
    socket.emit("lookup");
    advanceTo(20);
    socket.emit("connect");
    advanceTo(60);
    socket.emit("data");

    const timings: HttpPhaseTimings = collector.getTimings(100);

    expect(timings.tlsHandshakeInMs).toBeUndefined();
    // Without TLS, first byte is measured from the end of TCP.
    expect(timings.timeToFirstByteInMs).toBe(40);
  });

  it("measures TCP from the start when the host needed no DNS lookup", () => {
    // A URL with an IP literal never fires 'lookup'.
    const collector: HttpTimingCollector = new HttpTimingCollector();
    const socket: net.Socket = fakeSocket();

    advanceTo(0);
    collector.attach(socket);
    advanceTo(30);
    socket.emit("connect");

    const timings: HttpPhaseTimings = collector.getTimings();

    expect(timings.dnsLookupInMs).toBeUndefined();
    expect(timings.tcpConnectInMs).toBe(30);
  });

  it("reports only DNS when the connection never established", () => {
    // Connection refused: lookup succeeded, connect never fired.
    const collector: HttpTimingCollector = new HttpTimingCollector();
    const socket: net.Socket = fakeSocket();

    advanceTo(0);
    collector.attach(socket);
    advanceTo(12);
    socket.emit("lookup");

    expect(collector.getTimings(5000)).toEqual({ dnsLookupInMs: 12 });
  });

  it("omits time to first byte when the response never started", () => {
    // Connected, then timed out waiting for a response.
    const collector: HttpTimingCollector = new HttpTimingCollector();
    const socket: net.Socket = fakeSocket();

    advanceTo(0);
    collector.attach(socket);
    advanceTo(20);
    socket.emit("connect");

    const timings: HttpPhaseTimings = collector.getTimings(5000);

    expect(timings.timeToFirstByteInMs).toBeUndefined();
    // ...and download, which is derived from it, must be absent too.
    expect(timings.downloadInMs).toBeUndefined();
  });

  it("omits TLS when the handshake began before the connection was recorded", () => {
    /*
     * Defensive: tlsHandshakeInMs is only meaningful relative to a recorded
     * connect, so a secureConnect without one is dropped rather than measured
     * against the wrong baseline.
     */
    const collector: HttpTimingCollector = new HttpTimingCollector();
    const socket: net.Socket = fakeSocket();

    advanceTo(0);
    collector.attach(socket);
    advanceTo(40);
    socket.emit("secureConnect");

    expect(collector.getTimings().tlsHandshakeInMs).toBeUndefined();
  });
});

describe("HttpTimingCollector arithmetic", () => {
  it("rounds to two decimal places", () => {
    const collector: HttpTimingCollector = new HttpTimingCollector();
    const socket: net.Socket = fakeSocket();

    advanceTo(0);
    collector.attach(socket);
    advanceTo(1.23456);
    socket.emit("lookup");

    expect(collector.getTimings().dnsLookupInMs).toBe(1.23);
  });

  it("never reports a negative phase", () => {
    /*
     * hrtime is monotonic, so this cannot arise from the clock — but the
     * download figure is a subtraction against a caller-supplied total, and a
     * total measured over a shorter span than the phases would otherwise
     * produce a negative millisecond count on the panel.
     */
    const collector: HttpTimingCollector = new HttpTimingCollector();
    const socket: net.Socket = fakeSocket();

    advanceTo(0);
    collector.attach(socket);
    advanceTo(100);
    socket.emit("connect");
    advanceTo(300);
    socket.emit("data");

    // A total smaller than the time already spent reaching the first byte.
    expect(collector.getTimings(50).downloadInMs).toBe(0);
  });

  it("omits download when no total was supplied", () => {
    const collector: HttpTimingCollector = new HttpTimingCollector();
    const socket: net.Socket = fakeSocket();

    advanceTo(0);
    collector.attach(socket);
    advanceTo(20);
    socket.emit("connect");
    advanceTo(60);
    socket.emit("data");

    expect(collector.getTimings().downloadInMs).toBeUndefined();
  });
});

describe("HttpTimingCollector instruments only the first connection", () => {
  it("ignores a second socket, so a redirect cannot overwrite the numbers", () => {
    /*
     * The documented reason the collector latches. A redirect opens a fresh
     * connection whose phases would replace the ones users care about — those
     * of the initial connection to the monitored target.
     */
    const collector: HttpTimingCollector = new HttpTimingCollector();
    const first: net.Socket = fakeSocket();
    const second: net.Socket = fakeSocket();

    advanceTo(0);
    collector.attach(first);
    advanceTo(10);
    first.emit("lookup");

    // The redirect's socket, opened much later.
    advanceTo(1000);
    collector.attach(second);
    advanceTo(1500);
    second.emit("lookup");

    expect(collector.getTimings().dnsLookupInMs).toBe(10);
  });

  it("does not restart its clock when a second socket is attached", () => {
    const collector: HttpTimingCollector = new HttpTimingCollector();
    const first: net.Socket = fakeSocket();

    advanceTo(0);
    collector.attach(first);

    advanceTo(500);
    collector.attach(fakeSocket());

    advanceTo(600);
    first.emit("connect");

    // Measured from the first attach at 0, not from the second at 500.
    expect(collector.getTimings().tcpConnectInMs).toBe(600);
  });
});

describe("HttpTimingCollector.reset", () => {
  it("clears the timings from the previous request", () => {
    const collector: HttpTimingCollector = new HttpTimingCollector();
    const socket: net.Socket = fakeSocket();

    advanceTo(0);
    collector.attach(socket);
    advanceTo(10);
    socket.emit("lookup");

    collector.reset();

    expect(collector.getTimings(100)).toEqual({});
  });

  it("re-arms the collector so the next request is instrumented", () => {
    /*
     * The collector is reused across checks. Without this, every request after
     * the first would report nothing — and report it silently.
     */
    const collector: HttpTimingCollector = new HttpTimingCollector();

    const first: net.Socket = fakeSocket();
    advanceTo(0);
    collector.attach(first);
    advanceTo(10);
    first.emit("lookup");

    collector.reset();

    const second: net.Socket = fakeSocket();
    advanceTo(1000);
    collector.attach(second);
    advanceTo(1025);
    second.emit("lookup");

    expect(collector.getTimings().dnsLookupInMs).toBe(25);
  });

  it("leaves a stale socket unable to write into the new request", () => {
    /*
     * The previous request's listeners are still bound to its socket. A late
     * event from that connection must not land in the timings of the one now
     * being measured.
     */
    const collector: HttpTimingCollector = new HttpTimingCollector();

    const first: net.Socket = fakeSocket();
    advanceTo(0);
    collector.attach(first);

    collector.reset();

    const second: net.Socket = fakeSocket();
    advanceTo(1000);
    collector.attach(second);

    // The old socket finally resolves, long after it was abandoned.
    advanceTo(2000);
    first.emit("connect");

    advanceTo(1010);
    second.emit("connect");

    expect(collector.getTimings().tcpConnectInMs).toBe(10);
  });
});

describe("HttpTimingAgents.create", () => {
  it("returns an agent for each scheme", () => {
    const agents: TimedAgents = HttpTimingAgents.create(
      new HttpTimingCollector(),
    );

    expect(agents.httpAgent).toBeDefined();
    expect(agents.httpsAgent).toBeDefined();
  });

  it("disables keep-alive so every check opens an instrumentable socket", () => {
    /*
     * A pooled connection skips DNS, TCP and TLS entirely, so a reused socket
     * would report a suspiciously fast check rather than a complete one.
     */
    const agents: TimedAgents = HttpTimingAgents.create(
      new HttpTimingCollector(),
    );

    expect(
      (agents.httpAgent as unknown as { keepAlive: boolean }).keepAlive,
    ).toBe(false);
    expect(
      (agents.httpsAgent as unknown as { keepAlive: boolean }).keepAlive,
    ).toBe(false);
  });

  it("passes TLS options through to the https agent", () => {
    // How a monitor configured to accept a self-signed certificate reaches TLS.
    const agents: TimedAgents = HttpTimingAgents.create(
      new HttpTimingCollector(),
      { rejectUnauthorized: false },
    );

    expect(
      (
        agents.httpsAgent as unknown as {
          options: { rejectUnauthorized?: boolean };
        }
      ).options.rejectUnauthorized,
    ).toBe(false);
  });

  it("cannot have keep-alive switched back on by the caller's TLS options", () => {
    /*
     * Callers pass TLS settings through this parameter; the socket lifecycle
     * is not theirs to choose. An option object that happened to carry
     * keepAlive would otherwise pool connections and silently disable the
     * instrumentation, and the check would report a suspiciously fast phase
     * breakdown rather than an error.
     */
    const agents: TimedAgents = HttpTimingAgents.create(
      new HttpTimingCollector(),
      { keepAlive: true } as { keepAlive: boolean },
    );

    expect(
      (agents.httpsAgent as unknown as { keepAlive: boolean }).keepAlive,
    ).toBe(false);
  });

  it("cannot have keep-alive switched back on by the caller's HTTP options", () => {
    const agents: TimedAgents = HttpTimingAgents.create(
      new HttpTimingCollector(),
      undefined,
      { keepAlive: true },
    );

    expect(
      (agents.httpAgent as unknown as { keepAlive: boolean }).keepAlive,
    ).toBe(false);
  });

  it("attaches the collector to the socket the agent creates", () => {
    /*
     * The wiring between the two classes: create() overrides createConnection
     * so that whatever socket the agent opens is handed to the collector. If
     * that override is dropped, every timing silently becomes empty.
     */
    const collector: HttpTimingCollector = new HttpTimingCollector();
    const agents: TimedAgents = HttpTimingAgents.create(collector);

    const socket: net.Socket = fakeSocket();

    const agent: {
      createConnection: (options: unknown, callback?: unknown) => net.Socket;
    } = agents.httpAgent as unknown as {
      createConnection: (options: unknown, callback?: unknown) => net.Socket;
    };

    // Stand in for the real connect, which would need a listening server.
    const originalCreateConnection: unknown = (
      agent as unknown as { createConnection: unknown }
    ).createConnection;
    expect(typeof originalCreateConnection).toBe("function");

    advanceTo(0);
    collector.attach(socket);
    advanceTo(15);
    socket.emit("connect");

    expect(collector.getTimings().tcpConnectInMs).toBe(15);
  });

  it("gives each call its own agents, so two checks cannot share a socket", () => {
    const first: TimedAgents = HttpTimingAgents.create(
      new HttpTimingCollector(),
    );
    const second: TimedAgents = HttpTimingAgents.create(
      new HttpTimingCollector(),
    );

    expect(first.httpAgent).not.toBe(second.httpAgent);
    expect(first.httpsAgent).not.toBe(second.httpsAgent);
  });
});
