// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import NetbiosNameResolver, {
  DEFAULT_NETBIOS_MAX_HOSTS,
  DEFAULT_NETBIOS_PER_HOST_TIMEOUT_IN_MS,
  DEFAULT_NETBIOS_RETRY_PASSES,
  DEFAULT_NETBIOS_SEND_INTERVAL_IN_MS,
  DEFAULT_NETBIOS_TOTAL_BUDGET_IN_MS,
  DgramSocketLike,
  NETBIOS_NAME_SERVICE_PORT,
  NETBIOS_RECEIVE_BUFFER_SIZE_IN_BYTES,
  NetbiosNameResolution,
  NetbiosRemoteInfo,
  isNetbiosQueryAddressAllowed,
} from "../../../Utils/Discovery/NetbiosNameResolver";
import { encodeNbstatQuery } from "../../../Utils/Discovery/NetbiosNbstatCodec";
import logger from "Common/Server/Utils/Logger";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import dgram from "dgram";
import { EventEmitter } from "events";

/*
 * OneUptime issue #3677 — the probe's NetBIOS NBSTAT lookup, for hosts with
 * no DNS record and no SNMP.
 *
 * NO TEST HERE TOUCHES THE NETWORK except the single end-to-end test at the
 * bottom, which talks to a responder it binds itself on 127.0.0.1. Everything
 * else runs against a fake socket (an EventEmitter that records what it was
 * asked to send and replies on cue) and a fake clock whose `sleep` advances
 * time instead of waiting for it, so pacing, listening windows and the
 * wall-clock budget are all exact and instant.
 *
 * What is pinned is the contract that makes it safe to point at a network
 * this project may not administer:
 *
 *   - Only private and CGNAT IPv4 addresses are ever sent a datagram — never
 *     public, loopback or link-local, whatever the caller passes in.
 *   - A name is accepted only from the queried address and port with that
 *     host's transaction id, and only a unique <00> (or failing that <20>)
 *     name that normalises.
 *   - It stays bounded: paced sends, a retry for silent hosts only, an early
 *     stop, a host cap and a hard budget.
 *   - It never rejects, keeps what it found when something breaks, and closes
 *     its socket on every path.
 */

const UNIQUE_ACTIVE: number = 0x0400;
const GROUP_ACTIVE: number = 0x8400;

interface TableEntry {
  name: string;
  suffix: number;
  flags?: number;
}

/*
 * An NBSTAT response written out byte by byte here rather than produced by the
 * codec, so the resolver is not tested against the parser's own assumptions.
 */
function buildReply(transactionId: number, entries: Array<TableEntry>): Buffer {
  const header: Buffer = Buffer.alloc(12);
  header.writeUInt16BE(transactionId, 0);
  header.writeUInt16BE(0x8400, 2);
  header.writeUInt16BE(1, 6);

  const recordName: Buffer = Buffer.concat([
    Buffer.from([0x20]),
    Buffer.from("CK" + "A".repeat(30), "latin1"),
    Buffer.from([0x00]),
  ]);

  const fixed: Buffer = Buffer.alloc(10);
  fixed.writeUInt16BE(0x0021, 0);
  fixed.writeUInt16BE(0x0001, 2);
  fixed.writeUInt16BE(1 + entries.length * 18, 8);

  const table: Array<Buffer> = entries.map((entry: TableEntry) => {
    const bytes: Buffer = Buffer.alloc(18, 0x20);
    Buffer.from(entry.name, "latin1").copy(bytes, 0, 0, 15);
    bytes[15] = entry.suffix;
    bytes.writeUInt16BE(entry.flags ?? UNIQUE_ACTIVE, 16);
    return bytes;
  });

  return Buffer.concat([
    header,
    recordName,
    fixed,
    Buffer.from([entries.length]),
    ...table,
  ]);
}

function workstation(name: string): Array<TableEntry> {
  return [
    { name: name, suffix: 0x00 },
    { name: "CORP", suffix: 0x00, flags: GROUP_ACTIVE },
    { name: name, suffix: 0x20 },
  ];
}

interface SentQuery {
  address: string;
  port: number;
  transactionId: number;
  message: Buffer;
  at: number;
}

/*
 * A clock whose sleeps take no real time but still END LATER than anything
 * already in flight.
 *
 * Each sleep completes on the next setImmediate, and only THEN moves `time`
 * forward. That ordering is the point: a reply delivered as a microtask while
 * the resolver is listening wakes it BEFORE the sleep completes, exactly as a
 * real reply beats a real 1.5s timer — so a window that was cut short never
 * advances the clock, and `time` measures how long the lookup actually
 * listened rather than how long it asked to.
 */
class FakeClock {
  public time: number = 1_000_000;
  // Every duration asked for, in order, whether or not it ran to completion.
  public sleeps: Array<number> = [];
  // Runs as a sleep STARTS: "as soon as we begin waiting, ...".
  public onSleepStart: ((durationInMs: number) => void) | undefined = undefined;
  // Runs as a sleep COMPLETES, after time has moved: "by the end of it, ...".
  public onSleep: ((durationInMs: number) => void) | undefined = undefined;

  public now: () => number = (): number => {
    return this.time;
  };

  public sleep: (durationInMs: number) => Promise<void> = (
    durationInMs: number,
  ): Promise<void> => {
    this.sleeps.push(durationInMs);
    this.onSleepStart?.(durationInMs);

    return new Promise<void>((resolve: () => void) => {
      setImmediate(() => {
        this.time += durationInMs;
        this.onSleep?.(durationInMs);
        resolve();
      });
    });
  };
}

class FakeSocket extends EventEmitter implements DgramSocketLike {
  public sent: Array<SentQuery> = [];
  public boundPorts: Array<number> = [];
  public closeCount: number = 0;
  public recvBufferSize: number | undefined = undefined;
  public failSendTo: Set<string> = new Set<string>();
  public throwOnSendTo: Set<string> = new Set<string>();
  public bindBehaviour: "succeed" | "error" | "throw" | "never" = "succeed";
  public throwOnSetRecvBufferSize: boolean = false;
  // Called for every datagram handed to send(), to decide how to answer.
  public responder: ((query: SentQuery) => void) | undefined = undefined;

  public constructor(private clock: FakeClock) {
    super();
  }

  public bind(port: number, callback: () => void): this {
    this.boundPorts.push(port);

    if (this.bindBehaviour === "throw") {
      throw new Error("bind EADDRINUSE");
    }

    if (this.bindBehaviour === "error") {
      queueMicrotask(() => {
        this.emit("error", new Error("bind EACCES"));
      });
      return this;
    }

    if (this.bindBehaviour === "succeed") {
      callback();
    }

    return this;
  }

  public send(
    message: Buffer,
    port: number,
    address: string,
    callback: (error: Error | null) => void,
  ): void {
    if (this.throwOnSendTo.has(address)) {
      throw new Error(`send EINVAL ${address}`);
    }

    const query: SentQuery = {
      address: address,
      port: port,
      transactionId: message.readUInt16BE(0),
      message: message,
      at: this.clock.now(),
    };

    this.sent.push(query);

    if (this.failSendTo.has(address)) {
      queueMicrotask(() => {
        callback(new Error(`send EHOSTUNREACH ${address}`));
      });
      return;
    }

    queueMicrotask(() => {
      callback(null);
    });

    this.responder?.(query);
  }

  public close(): this {
    this.closeCount++;
    return this;
  }

  public setRecvBufferSize(size: number): void {
    if (this.throwOnSetRecvBufferSize) {
      throw new Error("ENOBUFS");
    }

    this.recvBufferSize = size;
  }

  // Delivers a datagram asynchronously, the way a real socket would.
  public deliver(message: Buffer, remote: Partial<NetbiosRemoteInfo>): void {
    queueMicrotask(() => {
      this.emit("message", message, {
        address: remote.address,
        port: remote.port ?? NETBIOS_NAME_SERVICE_PORT,
        family: "IPv4",
        size: message.length,
      });
    });
  }

  public answer(query: SentQuery, entries: Array<TableEntry>): void {
    this.deliver(buildReply(query.transactionId, entries), {
      address: query.address,
    });
  }

  public sentAddresses(): Array<string> {
    return this.sent.map((query: SentQuery) => {
      return query.address;
    });
  }
}

interface Harness {
  clock: FakeClock;
  socket: FakeSocket;
  createSocket: () => DgramSocketLike;
  // How many sockets the resolver asked for.
  createSocketCalls: () => number;
  // Makes createSocket throw instead, like a process out of descriptors.
  failCreateSocketWith: (error: Error) => void;
}

function harness(): Harness {
  const clock: FakeClock = new FakeClock();
  const socket: FakeSocket = new FakeSocket(clock);
  let calls: number = 0;
  let createError: Error | undefined = undefined;

  return {
    clock: clock,
    socket: socket,
    createSocket: (): DgramSocketLike => {
      calls++;

      if (createError) {
        throw createError;
      }

      return socket;
    },
    createSocketCalls: (): number => {
      return calls;
    },
    failCreateSocketWith: (error: Error): void => {
      createError = error;
    },
  };
}

function resolverFor(
  setup: Harness,
  overrides?: {
    perHostTimeoutInMs?: number;
    sendIntervalInMs?: number;
    totalBudgetInMs?: number;
    maxHosts?: number;
    retryPasses?: number;
    isAddressAllowed?: (ipAddress: string) => boolean;
  },
): NetbiosNameResolver {
  let nextTransactionId: number = 0x1000;

  return new NetbiosNameResolver({
    createSocket: setup.createSocket,
    now: setup.clock.now,
    sleep: setup.clock.sleep,
    randomTransactionId: (): number => {
      return nextTransactionId++;
    },
    ...overrides,
  });
}

function namesOf(resolution: NetbiosNameResolution): Record<string, string> {
  return Object.fromEntries(resolution.nameByIpAddress);
}

let warnedMessages: Array<string> = [];

beforeEach(() => {
  warnedMessages = [];

  jest.spyOn(logger, "warn").mockImplementation((message: unknown): never => {
    warnedMessages.push(String(message));
    return undefined as never;
  });
  jest.spyOn(logger, "debug").mockImplementation((): never => {
    return undefined as never;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("isNetbiosQueryAddressAllowed — where a datagram may ever go", () => {
  it("allows RFC 1918 and CGNAT addresses, edges included", () => {
    for (const address of [
      "10.0.0.1",
      "10.0.0.0",
      "10.255.255.255",
      "172.16.0.1",
      "172.31.255.254",
      "192.168.0.1",
      "192.168.255.254",
      "100.64.0.1",
      "100.127.255.254",
      "10.18.167.31",
    ]) {
      expect({
        address: address,
        allowed: isNetbiosQueryAddressAllowed(address),
      }).toEqual({ address: address, allowed: true });
    }
  });

  it("refuses public, loopback, link-local and neighbouring ranges", () => {
    for (const address of [
      "8.8.8.8",
      "1.1.1.1",
      "9.255.255.255",
      "11.0.0.0",
      "172.15.255.255",
      "172.32.0.0",
      "192.167.255.255",
      "192.169.0.0",
      "100.63.255.255",
      "100.128.0.0",
      "127.0.0.1",
      "127.1.2.3",
      "169.254.169.254",
      "169.254.0.1",
      "0.0.0.0",
      "255.255.255.255",
      "224.0.0.251",
    ]) {
      expect({
        address: address,
        allowed: isNetbiosQueryAddressAllowed(address),
      }).toEqual({ address: address, allowed: false });
    }
  });

  it("refuses anything that is not a canonical IPv4 literal", () => {
    for (const value of [
      "::1",
      "fe80::1",
      "fd00::1",
      "::ffff:10.0.0.1",
      " 10.0.0.1",
      "10.0.0.1 ",
      "010.0.0.1",
      "10.0.0",
      "10.0.0.1/8",
      "10.0.0.256",
      "host.corp.example.com",
      "",
      undefined,
      null,
      167772161,
      ["10.0.0.1"],
    ]) {
      expect(isNetbiosQueryAddressAllowed(value)).toBe(false);
    }
  });
});

describe("NetbiosNameResolver — defaults", () => {
  it("ships the documented budgets", () => {
    expect(NETBIOS_NAME_SERVICE_PORT).toBe(137);
    expect(DEFAULT_NETBIOS_PER_HOST_TIMEOUT_IN_MS).toBe(1500);
    expect(DEFAULT_NETBIOS_SEND_INTERVAL_IN_MS).toBe(10);
    expect(DEFAULT_NETBIOS_TOTAL_BUDGET_IN_MS).toBe(30000);
    expect(DEFAULT_NETBIOS_MAX_HOSTS).toBe(2000);
    expect(DEFAULT_NETBIOS_RETRY_PASSES).toBe(1);
    expect(NETBIOS_RECEIVE_BUFFER_SIZE_IN_BYTES).toBe(1024 * 1024);
  });

  it("the real address policy still refuses 127.0.0.1 — no socket is even created", async () => {
    /*
     * The end-to-end test below has to allow loopback to reach its own
     * responder. This is the other half: without that override, loopback is
     * refused before anything touches the network.
     */
    const setup: Harness = harness();
    const resolver: NetbiosNameResolver = new NetbiosNameResolver({
      createSocket: setup.createSocket,
      now: setup.clock.now,
      sleep: setup.clock.sleep,
    });

    const resolution: NetbiosNameResolution = await resolver.resolveNames([
      "127.0.0.1",
    ]);

    expect(setup.createSocketCalls()).toBe(0);
    expect(resolution.queriedCount).toBe(0);
    expect(resolution.skippedCount).toBe(1);
  });
});

describe("NetbiosNameResolver — choosing the name", () => {
  it("names a host by its unique <00> name, lower-cased", async () => {
    const setup: Harness = harness();
    setup.socket.responder = (query: SentQuery): void => {
      setup.socket.answer(query, workstation("REG01"));
    };

    const resolution: NetbiosNameResolution = await resolverFor(
      setup,
    ).resolveNames(["10.18.167.31"]);

    expect(namesOf(resolution)).toEqual({ "10.18.167.31": "reg01" });
    expect(resolution).toMatchObject({
      queriedCount: 1,
      skippedCount: 0,
      isTimeBudgetExhausted: false,
      isHostCapReached: false,
      failureReason: undefined,
    });
  });

  it("prefers <00> over <20> even when <20> is listed first", async () => {
    const setup: Harness = harness();
    setup.socket.responder = (query: SentQuery): void => {
      setup.socket.answer(query, [
        { name: "SRV-TWENTY", suffix: 0x20 },
        { name: "SRV-ZERO", suffix: 0x00 },
      ]);
    };

    const resolution: NetbiosNameResolution = await resolverFor(
      setup,
    ).resolveNames(["10.0.0.1"]);

    expect(namesOf(resolution)).toEqual({ "10.0.0.1": "srv-zero" });
  });

  it("falls back to the unique <20> name", async () => {
    const setup: Harness = harness();
    setup.socket.responder = (query: SentQuery): void => {
      setup.socket.answer(query, [
        { name: "CORP", suffix: 0x00, flags: GROUP_ACTIVE },
        { name: "NAS01", suffix: 0x20 },
      ]);
    };

    const resolution: NetbiosNameResolution = await resolverFor(
      setup,
    ).resolveNames(["10.0.0.1"]);

    expect(namesOf(resolution)).toEqual({ "10.0.0.1": "nas01" });
  });

  it("never names a host after a group, __MSBROWSE__ or IS~ name — and does not re-ask it", async () => {
    const setup: Harness = harness();
    setup.socket.responder = (query: SentQuery): void => {
      setup.socket.answer(query, [
        { name: "CORP", suffix: 0x00, flags: GROUP_ACTIVE },
        { name: "CORP", suffix: 0x20, flags: GROUP_ACTIVE },
        { name: "\u0001\u0002__MSBROWSE__\u0002", suffix: 0x01 },
        { name: "__MSBROWSE__", suffix: 0x00 },
        { name: "IS~WEB01", suffix: 0x00 },
      ]);
    };

    const start: number = setup.clock.time;
    const resolution: NetbiosNameResolution = await resolverFor(
      setup,
    ).resolveNames(["10.0.0.1"]);

    expect(namesOf(resolution)).toEqual({});
    /*
     * The host ANSWERED — its table simply holds nothing to call it. Asking
     * again would return the same table, so there is no retry, and the
     * listening window ends the moment the answer lands.
     */
    expect(setup.socket.sentAddresses()).toEqual(["10.0.0.1"]);
    expect(setup.clock.time - start).toBe(0);
  });
});

describe("NetbiosNameResolver — which replies count", () => {
  it("ignores a reply from an address it did not query, and re-asks the silent host", async () => {
    const setup: Harness = harness();
    setup.socket.responder = (query: SentQuery): void => {
      setup.socket.deliver(
        buildReply(query.transactionId, workstation("EVIL")),
        {
          address: "10.0.0.99",
        },
      );
    };

    const resolution: NetbiosNameResolution = await resolverFor(
      setup,
    ).resolveNames(["10.0.0.1"]);

    expect(namesOf(resolution)).toEqual({});
    expect(resolution.nameByIpAddress.has("10.0.0.99")).toBe(false);
    expect(setup.socket.sentAddresses()).toEqual(["10.0.0.1", "10.0.0.1"]);
  });

  it("ignores a reply from the right host but the wrong port", async () => {
    const setup: Harness = harness();
    setup.socket.responder = (query: SentQuery): void => {
      setup.socket.deliver(
        buildReply(query.transactionId, workstation("EVIL")),
        {
          address: query.address,
          port: 138,
        },
      );
    };

    const resolution: NetbiosNameResolution = await resolverFor(
      setup,
    ).resolveNames(["10.0.0.1"]);

    expect(namesOf(resolution)).toEqual({});
    expect(setup.socket.sent).toHaveLength(2);
  });

  it("ignores a reply carrying the wrong transaction id", async () => {
    const setup: Harness = harness();
    setup.socket.responder = (query: SentQuery): void => {
      setup.socket.deliver(
        buildReply((query.transactionId + 1) & 0xffff, workstation("EVIL")),
        { address: query.address },
      );
    };

    const resolution: NetbiosNameResolution = await resolverFor(
      setup,
    ).resolveNames(["10.0.0.1"]);

    expect(namesOf(resolution)).toEqual({});
    expect(setup.socket.sent).toHaveLength(2);
  });

  it("does not let one host's reply name another host that shares its transaction id", async () => {
    const setup: Harness = harness();
    const resolver: NetbiosNameResolver = new NetbiosNameResolver({
      createSocket: setup.createSocket,
      now: setup.clock.now,
      sleep: setup.clock.sleep,
      randomTransactionId: (): number => {
        return 7;
      },
    });

    setup.socket.responder = (query: SentQuery): void => {
      if (query.address === "10.0.0.1") {
        setup.socket.answer(query, workstation("ONLY-ONE"));
      }
    };

    const resolution: NetbiosNameResolution = await resolver.resolveNames([
      "10.0.0.1",
      "10.0.0.2",
    ]);

    expect(namesOf(resolution)).toEqual({ "10.0.0.1": "only-one" });
  });

  it("ignores garbage datagrams from the queried host without throwing", async () => {
    const setup: Harness = harness();
    setup.socket.responder = (query: SentQuery): void => {
      setup.socket.deliver(Buffer.from("not netbios at all"), {
        address: query.address,
      });
      setup.socket.deliver(Buffer.alloc(0), { address: query.address });
      setup.socket.deliver(query.message, { address: query.address });
    };

    const resolution: NetbiosNameResolution = await resolverFor(
      setup,
    ).resolveNames(["10.0.0.1"]);

    expect(namesOf(resolution)).toEqual({});
  });

  it("uses one transaction id per host, and sends the pinned NBSTAT query", async () => {
    const setup: Harness = harness();

    await resolverFor(setup).resolveNames(["10.0.0.1", "10.0.0.2"]);

    // Two hosts, two passes.
    expect(
      setup.socket.sent.map((query: SentQuery) => {
        return [query.address, query.port, query.transactionId];
      }),
    ).toEqual([
      ["10.0.0.1", 137, 0x1000],
      ["10.0.0.2", 137, 0x1001],
      ["10.0.0.1", 137, 0x1000],
      ["10.0.0.2", 137, 0x1001],
    ]);
    expect(setup.socket.sent[0]!.message).toEqual(encodeNbstatQuery(0x1000));
  });

  it("accepts a late answer to the first pass while pacing the retry", async () => {
    const setup: Harness = harness();
    const firstQueries: Array<SentQuery> = [];

    setup.socket.responder = (query: SentQuery): void => {
      firstQueries.push(query);
    };

    // During the listening window the first query's answer finally arrives.
    setup.clock.onSleep = (durationInMs: number): void => {
      if (durationInMs === 1500) {
        setup.socket.answer(firstQueries[0]!, workstation("SLOW"));
      }
    };

    const resolution: NetbiosNameResolution = await resolverFor(
      setup,
    ).resolveNames(["10.0.0.1", "10.0.0.2"]);

    expect(namesOf(resolution)).toEqual({ "10.0.0.1": "slow" });
    expect(setup.socket.sentAddresses()).toEqual([
      "10.0.0.1",
      "10.0.0.2",
      "10.0.0.2",
    ]);
  });
});

describe("NetbiosNameResolver — passes, pacing and early stop", () => {
  it("retries only the hosts that did not answer", async () => {
    const setup: Harness = harness();
    const askedCount: Map<string, number> = new Map<string, number>();

    setup.socket.responder = (query: SentQuery): void => {
      const count: number = (askedCount.get(query.address) ?? 0) + 1;
      askedCount.set(query.address, count);

      if (query.address === "10.0.0.1") {
        setup.socket.answer(query, workstation("FIRST-TIME"));
      }

      // Its first reply is "lost"; it answers the retry.
      if (query.address === "10.0.0.2" && count === 2) {
        setup.socket.answer(query, workstation("SECOND-TIME"));
      }
    };

    const resolution: NetbiosNameResolution = await resolverFor(
      setup,
    ).resolveNames(["10.0.0.1", "10.0.0.2", "10.0.0.3"]);

    expect(setup.socket.sentAddresses()).toEqual([
      "10.0.0.1",
      "10.0.0.2",
      "10.0.0.3",
      "10.0.0.2",
      "10.0.0.3",
    ]);
    expect(namesOf(resolution)).toEqual({
      "10.0.0.1": "first-time",
      "10.0.0.2": "second-time",
    });
    expect(resolution.queriedCount).toBe(3);
    expect(resolution.isTimeBudgetExhausted).toBe(false);
  });

  it("stops as soon as every host has answered, with no retry and no full window", async () => {
    const setup: Harness = harness();
    setup.socket.responder = (query: SentQuery): void => {
      setup.socket.answer(
        query,
        workstation(`HOST-${query.address.slice(-1)}`),
      );
    };

    const start: number = setup.clock.time;
    const resolution: NetbiosNameResolution = await resolverFor(
      setup,
    ).resolveNames(["10.0.0.1", "10.0.0.2", "10.0.0.3"]);

    expect(Object.keys(namesOf(resolution))).toHaveLength(3);
    expect(setup.socket.sent).toHaveLength(3);
    // Only the pacing between the three sends ever elapsed.
    expect(setup.clock.time - start).toBe(20);
  });

  it("ends the listening window early once the last host answers during it", async () => {
    const setup: Harness = harness();
    const pending: Array<SentQuery> = [];

    setup.socket.responder = (query: SentQuery): void => {
      pending.push(query);
    };

    // Both answers arrive only once the resolver has started listening.
    setup.clock.onSleepStart = (durationInMs: number): void => {
      if (durationInMs === 1500) {
        for (const query of pending.splice(0)) {
          setup.socket.answer(query, workstation("LATE"));
        }
      }
    };

    const start: number = setup.clock.time;
    const resolution: NetbiosNameResolution = await resolverFor(
      setup,
    ).resolveNames(["10.0.0.1", "10.0.0.2"]);

    expect(Object.keys(namesOf(resolution))).toHaveLength(2);
    // It did start listening...
    expect(setup.clock.sleeps).toEqual([10, 1500]);
    // ...but returned without the window elapsing, and without a retry.
    expect(setup.clock.time - start).toBe(10);
    expect(setup.socket.sent).toHaveLength(2);
  });

  it("paces sends at the configured interval, then listens once per pass", async () => {
    const setup: Harness = harness();
    const start: number = setup.clock.time;

    await resolverFor(setup, { retryPasses: 0 }).resolveNames([
      "10.0.0.1",
      "10.0.0.2",
      "10.0.0.3",
      "10.0.0.4",
    ]);

    expect(
      setup.socket.sent.map((query: SentQuery) => {
        return query.at - start;
      }),
    ).toEqual([0, 10, 20, 30]);
    expect(setup.clock.sleeps).toEqual([10, 10, 10, 1500]);
  });

  it("with the default single retry, a silent subnet costs two passes and two windows", async () => {
    const setup: Harness = harness();

    const resolution: NetbiosNameResolution = await resolverFor(
      setup,
    ).resolveNames(["10.0.0.1", "10.0.0.2"]);

    expect(setup.socket.sent).toHaveLength(4);
    expect(setup.clock.sleeps).toEqual([10, 1500, 10, 1500]);
    expect(resolution.isTimeBudgetExhausted).toBe(false);
    expect(namesOf(resolution)).toEqual({});
  });

  it("asks a duplicated address once", async () => {
    const setup: Harness = harness();
    setup.socket.responder = (query: SentQuery): void => {
      setup.socket.answer(query, workstation("DUP"));
    };

    const resolution: NetbiosNameResolution = await resolverFor(
      setup,
    ).resolveNames(["10.0.0.1", "10.0.0.1", "10.0.0.2", "10.0.0.1"]);

    expect(setup.socket.sentAddresses()).toEqual(["10.0.0.1", "10.0.0.2"]);
    expect(resolution.queriedCount).toBe(2);
    expect(resolution.skippedCount).toBe(0);
  });
});

describe("NetbiosNameResolver — addresses that are never sent anything", () => {
  it("sends only to private IPv4 addresses, whatever it is handed", async () => {
    const setup: Harness = harness();

    const resolution: NetbiosNameResolution = await resolverFor(
      setup,
    ).resolveNames([
      "8.8.8.8",
      "127.0.0.1",
      "169.254.169.254",
      "::1",
      "fe80::1",
      " 10.0.0.1",
      "010.0.0.1",
      "printer.corp.example.com",
      "",
      42 as unknown as string,
      null as unknown as string,
      "10.0.0.5",
    ]);

    expect([...new Set(setup.socket.sentAddresses())]).toEqual(["10.0.0.5"]);
    expect(resolution.queriedCount).toBe(1);
    expect(resolution.skippedCount).toBe(11);
  });

  it("creates no socket for an empty list", async () => {
    const setup: Harness = harness();

    const resolution: NetbiosNameResolution = await resolverFor(
      setup,
    ).resolveNames([]);

    expect(setup.createSocketCalls()).toBe(0);
    expect(resolution).toEqual({
      nameByIpAddress: new Map<string, string>(),
      queriedCount: 0,
      skippedCount: 0,
      isTimeBudgetExhausted: false,
      isHostCapReached: false,
      failureReason: undefined,
    });
  });

  it("creates no socket when every address is refused", async () => {
    const setup: Harness = harness();

    const resolution: NetbiosNameResolution = await resolverFor(
      setup,
    ).resolveNames(["8.8.8.8", "169.254.169.254"]);

    expect(setup.createSocketCalls()).toBe(0);
    expect(resolution.skippedCount).toBe(2);
  });

  it("treats an address policy that throws as a refusal", async () => {
    const setup: Harness = harness();

    const resolution: NetbiosNameResolution = await resolverFor(setup, {
      isAddressAllowed: (): boolean => {
        throw new Error("policy exploded");
      },
    }).resolveNames(["10.0.0.1"]);

    expect(setup.createSocketCalls()).toBe(0);
    expect(resolution.queriedCount).toBe(0);
  });

  it("tolerates being handed something that is not an array", async () => {
    const setup: Harness = harness();

    const resolution: NetbiosNameResolution = await resolverFor(
      setup,
    ).resolveNames(undefined as unknown as Array<string>);

    expect(resolution.queriedCount).toBe(0);
    expect(setup.createSocketCalls()).toBe(0);
  });
});

describe("NetbiosNameResolver — the socket", () => {
  it("binds an ephemeral port, never 137, and asks for a 1 MiB receive buffer", async () => {
    const setup: Harness = harness();

    await resolverFor(setup).resolveNames(["10.0.0.1"]);

    expect(setup.createSocketCalls()).toBe(1);
    expect(setup.socket.boundPorts).toEqual([0]);
    expect(setup.socket.recvBufferSize).toBe(1024 * 1024);
  });

  it("always has an 'error' listener, so a socket error cannot crash the probe", async () => {
    const setup: Harness = harness();
    let listenerCountDuringLookup: number = -1;

    setup.socket.responder = (): void => {
      listenerCountDuringLookup = setup.socket.listenerCount("error");
    };

    await resolverFor(setup).resolveNames(["10.0.0.1"]);

    expect(listenerCountDuringLookup).toBeGreaterThanOrEqual(1);
    // And after the lookup, a stray error is still swallowed.
    expect(() => {
      setup.socket.emit("error", new Error("late"));
    }).not.toThrow();
  });

  it("carries on when the kernel refuses the larger receive buffer", async () => {
    const setup: Harness = harness();
    setup.socket.throwOnSetRecvBufferSize = true;
    setup.socket.responder = (query: SentQuery): void => {
      setup.socket.answer(query, workstation("STILL-WORKS"));
    };

    const resolution: NetbiosNameResolution = await resolverFor(
      setup,
    ).resolveNames(["10.0.0.1"]);

    expect(namesOf(resolution)).toEqual({ "10.0.0.1": "still-works" });
    expect(resolution.failureReason).toBeUndefined();
  });

  it("is closed after a successful lookup", async () => {
    const setup: Harness = harness();
    setup.socket.responder = (query: SentQuery): void => {
      setup.socket.answer(query, workstation("OK"));
    };

    await resolverFor(setup).resolveNames(["10.0.0.1"]);

    expect(setup.socket.closeCount).toBe(1);
  });

  it("returns the names found so far when the socket errors mid-pass, and closes it", async () => {
    const setup: Harness = harness();
    setup.socket.responder = (query: SentQuery): void => {
      if (query.address === "10.0.0.1") {
        setup.socket.answer(query, workstation("BEFORE"));
      }

      if (query.address === "10.0.0.2") {
        queueMicrotask(() => {
          setup.socket.emit("error", new Error("recvmsg ENOMEM"));
        });
      }
    };

    const resolution: NetbiosNameResolution = await resolverFor(
      setup,
    ).resolveNames(["10.0.0.1", "10.0.0.2", "10.0.0.3", "10.0.0.4"]);

    expect(namesOf(resolution)).toEqual({ "10.0.0.1": "before" });
    expect(resolution.failureReason).toBe("recvmsg ENOMEM");
    // Nothing is sent once the socket has failed.
    expect(setup.socket.sentAddresses()).toEqual(["10.0.0.1", "10.0.0.2"]);
    expect(resolution.queriedCount).toBe(2);
    expect(resolution.skippedCount).toBe(2);
    expect(setup.socket.closeCount).toBe(1);
    expect(warnedMessages.join("\n")).toMatch(/socket failed: recvmsg ENOMEM/);
  });

  it("returns promptly when the socket errors during the listening window", async () => {
    const setup: Harness = harness();
    setup.clock.onSleep = (durationInMs: number): void => {
      if (durationInMs === 1500) {
        setup.socket.emit("error", new Error("socket closed underneath"));
      }
    };

    const resolution: NetbiosNameResolution = await resolverFor(
      setup,
    ).resolveNames(["10.0.0.1", "10.0.0.2"]);

    expect(resolution.failureReason).toBe("socket closed underneath");
    // No retry pass after the failure.
    expect(setup.socket.sent).toHaveLength(2);
    expect(setup.socket.closeCount).toBe(1);
  });

  it("reports a bind failure without sending anything, and closes the socket", async () => {
    const setup: Harness = harness();
    setup.socket.bindBehaviour = "error";

    const resolution: NetbiosNameResolution = await resolverFor(
      setup,
    ).resolveNames(["10.0.0.1"]);

    expect(resolution.failureReason).toBe("bind EACCES");
    expect(setup.socket.sent).toHaveLength(0);
    expect(resolution.queriedCount).toBe(0);
    expect(resolution.skippedCount).toBe(1);
    expect(setup.socket.closeCount).toBe(1);
  });

  it("reports a bind that throws, and closes the socket", async () => {
    const setup: Harness = harness();
    setup.socket.bindBehaviour = "throw";

    const resolution: NetbiosNameResolution = await resolverFor(
      setup,
    ).resolveNames(["10.0.0.1"]);

    expect(resolution.failureReason).toBe("bind EADDRINUSE");
    expect(setup.socket.closeCount).toBe(1);
  });

  it("gives up on a bind that never completes once the budget is spent", async () => {
    const setup: Harness = harness();
    setup.socket.bindBehaviour = "never";

    const resolution: NetbiosNameResolution = await resolverFor(setup, {
      totalBudgetInMs: 5000,
    }).resolveNames(["10.0.0.1"]);

    expect(resolution.isTimeBudgetExhausted).toBe(true);
    expect(resolution.failureReason).toMatch(/did not bind/);
    expect(setup.socket.sent).toHaveLength(0);
    expect(setup.socket.closeCount).toBe(1);
  });

  it("never rejects when the socket cannot even be created", async () => {
    const setup: Harness = harness();
    setup.failCreateSocketWith(new Error("EMFILE: too many open files"));

    const resolution: NetbiosNameResolution = await resolverFor(
      setup,
    ).resolveNames(["10.0.0.1"]);

    expect(resolution.failureReason).toBe("EMFILE: too many open files");
    expect(resolution.nameByIpAddress.size).toBe(0);
  });

  it("ignores events that arrive after the lookup has returned", async () => {
    const setup: Harness = harness();
    const queries: Array<SentQuery> = [];
    setup.socket.responder = (query: SentQuery): void => {
      queries.push(query);
    };

    const resolution: NetbiosNameResolution = await resolverFor(setup, {
      retryPasses: 0,
    }).resolveNames(["10.0.0.1"]);

    setup.socket.answer(queries[0]!, workstation("TOO-LATE"));
    await new Promise<void>((resolve: () => void) => {
      setImmediate(resolve);
    });

    expect(resolution.nameByIpAddress.size).toBe(0);
  });
});

describe("NetbiosNameResolver — one host's failed send", () => {
  it("closes out only that host when the send callback reports an error", async () => {
    const setup: Harness = harness();
    setup.socket.failSendTo.add("10.0.0.2");
    setup.socket.responder = (query: SentQuery): void => {
      setup.socket.answer(query, workstation(`OK-${query.address.slice(-1)}`));
    };

    const start: number = setup.clock.time;
    const resolution: NetbiosNameResolution = await resolverFor(
      setup,
    ).resolveNames(["10.0.0.1", "10.0.0.2", "10.0.0.3"]);

    expect(namesOf(resolution)).toEqual({
      "10.0.0.1": "ok-1",
      "10.0.0.3": "ok-3",
    });
    // Asked once, not retried, and it did not hold a listening window open.
    expect(setup.socket.sentAddresses()).toEqual([
      "10.0.0.1",
      "10.0.0.2",
      "10.0.0.3",
    ]);
    expect(setup.clock.time - start).toBe(20);
    expect(resolution.queriedCount).toBe(3);
    expect(resolution.failureReason).toBeUndefined();
  });

  it("closes out only that host when send throws synchronously", async () => {
    const setup: Harness = harness();
    setup.socket.throwOnSendTo.add("10.0.0.1");
    setup.socket.responder = (query: SentQuery): void => {
      setup.socket.answer(query, workstation("SURVIVOR"));
    };

    const resolution: NetbiosNameResolution = await resolverFor(
      setup,
    ).resolveNames(["10.0.0.1", "10.0.0.2"]);

    expect(namesOf(resolution)).toEqual({ "10.0.0.2": "survivor" });
    expect(resolution.failureReason).toBeUndefined();
    expect(setup.socket.closeCount).toBe(1);
  });
});

describe("NetbiosNameResolver — budget and host cap", () => {
  it("stops sending when the budget runs out and keeps the names already found", async () => {
    const setup: Harness = harness();
    setup.socket.responder = (query: SentQuery): void => {
      setup.socket.answer(
        query,
        workstation(`FAST-${query.address.slice(-1)}`),
      );
    };

    const resolution: NetbiosNameResolution = await resolverFor(setup, {
      totalBudgetInMs: 25,
    }).resolveNames([
      "10.0.0.1",
      "10.0.0.2",
      "10.0.0.3",
      "10.0.0.4",
      "10.0.0.5",
    ]);

    // Sends at +0, +10 and +20; at +30 the 25ms budget is gone.
    expect(setup.socket.sentAddresses()).toEqual([
      "10.0.0.1",
      "10.0.0.2",
      "10.0.0.3",
    ]);
    expect(namesOf(resolution)).toEqual({
      "10.0.0.1": "fast-1",
      "10.0.0.2": "fast-2",
      "10.0.0.3": "fast-3",
    });
    expect(resolution.isTimeBudgetExhausted).toBe(true);
    expect(resolution.queriedCount).toBe(3);
    expect(resolution.skippedCount).toBe(2);
    expect(setup.socket.closeCount).toBe(1);
    expect(warnedMessages.join("\n")).toMatch(
      /25ms budget after naming 3 host\(s\): 3 of 5 host\(s\) were queried/,
    );
  });

  it("cuts the listening window short at the budget and does not retry", async () => {
    const setup: Harness = harness();

    const resolution: NetbiosNameResolution = await resolverFor(setup, {
      totalBudgetInMs: 100,
    }).resolveNames(["10.0.0.1", "10.0.0.2"]);

    expect(setup.clock.sleeps).toEqual([10, 90]);
    expect(setup.socket.sent).toHaveLength(2);
    expect(resolution.isTimeBudgetExhausted).toBe(true);
    expect(setup.socket.closeCount).toBe(1);
  });

  it("does not report the budget exhausted when a silent subnet simply finished", async () => {
    const setup: Harness = harness();

    const resolution: NetbiosNameResolution = await resolverFor(setup, {
      retryPasses: 0,
    }).resolveNames(["10.0.0.1"]);

    expect(resolution.isTimeBudgetExhausted).toBe(false);
    expect(warnedMessages).toEqual([]);
  });

  it("asks at most maxHosts eligible hosts and says how many it left out", async () => {
    const setup: Harness = harness();
    setup.socket.responder = (query: SentQuery): void => {
      setup.socket.answer(query, workstation(`CAP-${query.address.slice(-1)}`));
    };

    const resolution: NetbiosNameResolution = await resolverFor(setup, {
      maxHosts: 2,
    }).resolveNames(["8.8.8.8", "10.0.0.1", "10.0.0.2", "10.0.0.3"]);

    expect(setup.socket.sentAddresses()).toEqual(["10.0.0.1", "10.0.0.2"]);
    expect(resolution.isHostCapReached).toBe(true);
    expect(resolution.queriedCount).toBe(2);
    // The public address and the host over the cap.
    expect(resolution.skippedCount).toBe(2);
    expect(warnedMessages.join("\n")).toMatch(
      /capped at 2 host\(s\) per scan; 3 unnamed host\(s\) were eligible, so 1 will keep/,
    );
  });

  it("does not count refused addresses toward the cap", async () => {
    const setup: Harness = harness();

    const resolution: NetbiosNameResolution = await resolverFor(setup, {
      maxHosts: 1,
      retryPasses: 0,
    }).resolveNames(["8.8.8.8", "1.1.1.1", "10.0.0.1"]);

    expect(resolution.isHostCapReached).toBe(false);
    expect(setup.socket.sentAddresses()).toEqual(["10.0.0.1"]);
  });
});

describe("NetbiosNameResolver — end to end over a real UDP socket", () => {
  /*
   * The one test that opens real sockets, both of them on this machine: a
   * responder bound to an ephemeral port on 127.0.0.1 that answers NBSTAT the
   * way a Windows host does, and the resolver's own socket. Loopback is
   * refused by the production policy (see "the real address policy still
   * refuses 127.0.0.1" above), so this test — and only this test — passes an
   * address policy that allows it.
   *
   * It proves what the fake socket cannot: that dgram's real bind/send/message
   * shapes match DgramSocketLike, that the query bytes survive the kernel, and
   * that the reply's source address and port are what acceptReply compares.
   */
  it("names a host that answers over real UDP", async () => {
    const responder: dgram.Socket = dgram.createSocket("udp4");
    const receivedQueries: Array<Buffer> = [];

    responder.on("message", (message: Buffer, remote: dgram.RemoteInfo) => {
      receivedQueries.push(message);
      responder.send(
        buildReply(message.readUInt16BE(0), workstation("LOOPBACK-HOST")),
        remote.port,
        remote.address,
      );
    });

    await new Promise<void>((resolve: () => void) => {
      responder.bind(0, "127.0.0.1", resolve);
    });

    try {
      const responderPort: number = responder.address().port;

      const resolver: NetbiosNameResolver = new NetbiosNameResolver({
        createSocket: (): DgramSocketLike => {
          return dgram.createSocket("udp4");
        },
        port: responderPort,
        perHostTimeoutInMs: 3000,
        totalBudgetInMs: 8000,
        isAddressAllowed: (ipAddress: string): boolean => {
          return ipAddress === "127.0.0.1";
        },
      });

      const startedAt: number = Date.now();
      const resolution: NetbiosNameResolution = await resolver.resolveNames([
        "127.0.0.1",
      ]);

      expect(namesOf(resolution)).toEqual({ "127.0.0.1": "loopback-host" });
      expect(resolution.failureReason).toBeUndefined();
      expect(resolution.queriedCount).toBe(1);
      expect(receivedQueries).toHaveLength(1);
      expect(receivedQueries[0]).toHaveLength(50);
      expect(receivedQueries[0]!.readUInt16BE(46)).toBe(0x0021);
      // Answered, so the listening window ended early.
      expect(Date.now() - startedAt).toBeLessThan(2500);
    } finally {
      await new Promise<void>((resolve: () => void) => {
        responder.close(resolve);
      });
    }
  });
});
