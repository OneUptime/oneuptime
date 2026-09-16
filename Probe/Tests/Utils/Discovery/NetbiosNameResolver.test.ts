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
  MAX_AUTOMATIC_NETBIOS_TOTAL_BUDGET_IN_MS,
  MAX_NETBIOS_MAX_HOSTS_OVERRIDE,
  NETBIOS_NAME_SERVICE_PORT,
  NETBIOS_RECEIVE_BUFFER_SIZE_IN_BYTES,
  NetbiosNameResolution,
  NetbiosRemoteInfo,
  getNetbiosTotalBudgetInMs,
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

function harness(clock: FakeClock = new FakeClock()): Harness {
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
      eligibleCount: 0,
      maxHosts: DEFAULT_NETBIOS_MAX_HOSTS,
      // Nothing to ask sizes to the floor.
      totalBudgetInMs: DEFAULT_NETBIOS_TOTAL_BUDGET_IN_MS,
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

/*
 * `count` distinct RFC 1918 addresses in ascending order from 10.0.0.1 — the
 * shape a large sweep hands the resolver once SNMP and reverse DNS have named
 * nothing.
 */
function privateAddresses(count: number): Array<string> {
  const addresses: Array<string> = [];

  for (let index: number = 1; index <= count; index++) {
    addresses.push(
      `10.${Math.floor(index / 65536) % 256}.${Math.floor(index / 256) % 256}.${index % 256}`,
    );
  }

  return addresses;
}

/*
 * The default workload at the host cap, worked by hand rather than by calling
 * the function under test: two passes (the first and one retry), each pacing
 * 1,999 gaps of 10ms and then listening 1,500ms, plus 25% headroom.
 *
 *   2 × (1,999 × 10 + 1,500) × 1.25 = 2 × 21,490 × 1.25 = 53,725ms
 */
const DEFAULT_CAP_WORKLOAD_BUDGET_IN_MS: number = 53725;

// What the same two silent passes take on the fake clock, without headroom.
const DEFAULT_CAP_WORKLOAD_ELAPSED_IN_MS: number = 42980;

/*
 * A FakeClock whose sleeps complete on a microtask instead of the next
 * setImmediate — for the thousands-of-hosts lookups below ONLY.
 *
 * FakeClock spends one event-loop turn per sleep so that a reply can beat a
 * listening window. A lookup of 2,000 silent hosts has no reply to race, but
 * it does pace 4,000 sends, and a loop turn each costs seconds of real time
 * on a busy machine. Every test that uses this clock has no responder.
 */
class SilentHostsClock extends FakeClock {
  public override sleep: (durationInMs: number) => Promise<void> = (
    durationInMs: number,
  ): Promise<void> => {
    this.sleeps.push(durationInMs);
    this.onSleepStart?.(durationInMs);

    return Promise.resolve().then(() => {
      this.time += durationInMs;
      this.onSleep?.(durationInMs);
    });
  };
}

describe("getNetbiosTotalBudgetInMs — sizing the budget to the lookup", () => {
  /*
   * The old budget was a flat 30s, which fits ONE paced pass over the 2,000
   * host cap but not the retry pass the lookup also runs. Every large lookup
   * silently lost its retries — and, now that a cut-short lookup is reported
   * on the scan, would have said so on every large scan for a budget sized
   * below its own work. These tests pin the arithmetic that replaced it,
   * directly, so a change to the headroom, the pass count or the bounds
   * cannot slip through as "the resolver still returns names".
   */

  it("keeps 30s as the floor and 2 minutes as the automatic ceiling", () => {
    expect(DEFAULT_NETBIOS_TOTAL_BUDGET_IN_MS).toBe(30 * 1000);
    expect(MAX_AUTOMATIC_NETBIOS_TOTAL_BUDGET_IN_MS).toBe(2 * 60 * 1000);
  });

  it("gives a small lookup the 30s floor", () => {
    /*
     * A /24's worth of silent hosts needs about 8s. Shrinking the budget to
     * that would buy nothing — the lookup stops as soon as its passes end —
     * and would leave no slack for a slow event loop during the upload.
     */
    for (const targetCount of [0, 1, 2, 254, 1000]) {
      expect({
        targetCount: targetCount,
        budget: getNetbiosTotalBudgetInMs({ targetCount: targetCount }),
      }).toEqual({ targetCount: targetCount, budget: 30000 });
    }
  });

  it("sizes the default host-cap workload to both passes plus headroom, exactly", () => {
    expect(getNetbiosTotalBudgetInMs({ targetCount: 2000 })).toBe(
      DEFAULT_CAP_WORKLOAD_BUDGET_IN_MS,
    );

    // Spelling the defaults out changes nothing.
    expect(
      getNetbiosTotalBudgetInMs({
        targetCount: DEFAULT_NETBIOS_MAX_HOSTS,
        sendIntervalInMs: DEFAULT_NETBIOS_SEND_INTERVAL_IN_MS,
        perHostTimeoutInMs: DEFAULT_NETBIOS_PER_HOST_TIMEOUT_IN_MS,
        retryPasses: DEFAULT_NETBIOS_RETRY_PASSES,
      }),
    ).toBe(DEFAULT_CAP_WORKLOAD_BUDGET_IN_MS);

    /*
     * The regression this replaces: the two passes alone overrun the old
     * flat budget, and the sized one covers them with room left over.
     */
    expect(DEFAULT_CAP_WORKLOAD_ELAPSED_IN_MS).toBeGreaterThan(
      DEFAULT_NETBIOS_TOTAL_BUDGET_IN_MS,
    );
    expect(DEFAULT_CAP_WORKLOAD_BUDGET_IN_MS).toBeGreaterThan(
      DEFAULT_CAP_WORKLOAD_ELAPSED_IN_MS,
    );
    expect(DEFAULT_CAP_WORKLOAD_BUDGET_IN_MS).toBeLessThan(
      MAX_AUTOMATIC_NETBIOS_TOTAL_BUDGET_IN_MS,
    );
  });

  it("leaves the floor exactly where the worst case first exceeds it", () => {
    // 2 × (1,050 × 10 + 1,500) × 1.25 = 30,000 — still the floor.
    expect(getNetbiosTotalBudgetInMs({ targetCount: 1051 })).toBe(30000);
    // 2 × (1,051 × 10 + 1,500) × 1.25 = 30,025 — the first host past it.
    expect(getNetbiosTotalBudgetInMs({ targetCount: 1052 })).toBe(30025);
  });

  it("stops growing at the 2 minute ceiling", () => {
    /*
     * Nothing bounds this pass but its own budget, and a finished scan stays
     * In Progress until it returns. However big or slow the lookup, a name
     * must not hold the scan longer than this.
     */
    // 2 × (4,649 × 10 + 1,500) × 1.25 = 119,975 — just under.
    expect(getNetbiosTotalBudgetInMs({ targetCount: 4650 })).toBe(119975);
    expect(getNetbiosTotalBudgetInMs({ targetCount: 4651 })).toBe(120000);
    expect(getNetbiosTotalBudgetInMs({ targetCount: 4652 })).toBe(120000);
    expect(getNetbiosTotalBudgetInMs({ targetCount: 100000 })).toBe(120000);
    expect(
      getNetbiosTotalBudgetInMs({ targetCount: Number.MAX_SAFE_INTEGER }),
    ).toBe(120000);

    // Slow pacing, a long window and extra retries over the default cap.
    expect(
      getNetbiosTotalBudgetInMs({
        targetCount: 2000,
        sendIntervalInMs: 100,
        perHostTimeoutInMs: 5000,
        retryPasses: 3,
      }),
    ).toBe(MAX_AUTOMATIC_NETBIOS_TOTAL_BUDGET_IN_MS);
  });

  it("sizes a lookup with no retry pass for one pass, rounding up", () => {
    // (2,999 × 10 + 1,500) × 1.25 = 39,362.5, rounded UP so it is never short.
    expect(
      getNetbiosTotalBudgetInMs({ targetCount: 3000, retryPasses: 0 }),
    ).toBe(39363);

    // One pass over the default cap fits the floor, as it always did.
    expect(
      getNetbiosTotalBudgetInMs({ targetCount: 2000, retryPasses: 0 }),
    ).toBe(30000);
  });

  it("multiplies the estimate by every extra retry pass", () => {
    // 3 × (999 × 10 + 1,500) × 1.25 = 43,087.5
    expect(
      getNetbiosTotalBudgetInMs({ targetCount: 1000, retryPasses: 2 }),
    ).toBe(43088);
  });

  it("with no pacing, counts only the listening windows, whatever the host count", () => {
    for (const targetCount of [1, 2000, 5000]) {
      // 2 × 20,000 × 1.25
      expect(
        getNetbiosTotalBudgetInMs({
          targetCount: targetCount,
          sendIntervalInMs: 0,
          perHostTimeoutInMs: 20000,
        }),
      ).toBe(50000);
    }

    expect(
      getNetbiosTotalBudgetInMs({ targetCount: 5000, sendIntervalInMs: 0 }),
    ).toBe(30000);
  });

  it("charges no pacing for a lone host: zero and one host size alike", () => {
    /*
     * Pacing is the gap BETWEEN sends, so one host costs one listening window
     * per pass and no more. Counting a gap per host would overcharge every
     * small lookup by one interval per pass.
     */
    const options: { sendIntervalInMs: number; perHostTimeoutInMs: number } = {
      sendIntervalInMs: 1000,
      perHostTimeoutInMs: 20000,
    };

    expect(getNetbiosTotalBudgetInMs({ targetCount: 0, ...options })).toBe(
      50000,
    );
    expect(getNetbiosTotalBudgetInMs({ targetCount: 1, ...options })).toBe(
      50000,
    );
    // 2 × (1 × 1,000 + 20,000) × 1.25
    expect(getNetbiosTotalBudgetInMs({ targetCount: 2, ...options })).toBe(
      52500,
    );
  });

  it("falls back to the defaults for non-finite pacing, window and retry inputs", () => {
    /*
     * A NaN that reached the arithmetic would make the budget NaN, and
     * `now() >= NaN` is never true — a lookup with no budget at all.
     */
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(
        getNetbiosTotalBudgetInMs({
          targetCount: 2000,
          sendIntervalInMs: value,
        }),
      ).toBe(DEFAULT_CAP_WORKLOAD_BUDGET_IN_MS);
      expect(
        getNetbiosTotalBudgetInMs({
          targetCount: 2000,
          perHostTimeoutInMs: value,
        }),
      ).toBe(DEFAULT_CAP_WORKLOAD_BUDGET_IN_MS);
      expect(
        getNetbiosTotalBudgetInMs({ targetCount: 2000, retryPasses: value }),
      ).toBe(DEFAULT_CAP_WORKLOAD_BUDGET_IN_MS);
    }
  });

  it("treats a non-finite host count as nothing to ask", () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(getNetbiosTotalBudgetInMs({ targetCount: value })).toBe(30000);
    }
  });

  it("clamps negative inputs to zero instead of letting them shrink the estimate", () => {
    expect(getNetbiosTotalBudgetInMs({ targetCount: -50 })).toBe(30000);

    // A negative interval paces nothing: 2 × (0 + 20,000) × 1.25.
    expect(
      getNetbiosTotalBudgetInMs({
        targetCount: 2000,
        sendIntervalInMs: -10,
        perHostTimeoutInMs: 20000,
      }),
    ).toBe(50000);

    // A negative window listens for nothing: 2 × (1,999 × 10) × 1.25.
    expect(
      getNetbiosTotalBudgetInMs({
        targetCount: 2000,
        perHostTimeoutInMs: -5000,
      }),
    ).toBe(49975);

    // Negative retries are no retries: one pass, as with retryPasses 0.
    expect(
      getNetbiosTotalBudgetInMs({ targetCount: 3000, retryPasses: -3 }),
    ).toBe(39363);
  });

  it("floors a fractional host count and retry count, but keeps fractional timings", () => {
    expect(getNetbiosTotalBudgetInMs({ targetCount: 2000.9 })).toBe(
      DEFAULT_CAP_WORKLOAD_BUDGET_IN_MS,
    );
    expect(
      getNetbiosTotalBudgetInMs({ targetCount: 2000, retryPasses: 1.9 }),
    ).toBe(DEFAULT_CAP_WORKLOAD_BUDGET_IN_MS);
    expect(
      getNetbiosTotalBudgetInMs({ targetCount: 3000, retryPasses: 0.5 }),
    ).toBe(39363);

    // 2 × (1,999 × 10.5 + 1,500) × 1.25 = 56,223.75
    expect(
      getNetbiosTotalBudgetInMs({ targetCount: 2000, sendIntervalInMs: 10.5 }),
    ).toBe(56224);
    // 2 × (1,999 × 10 + 1,500.5) × 1.25 = 53,726.25
    expect(
      getNetbiosTotalBudgetInMs({
        targetCount: 2000,
        perHostTimeoutInMs: 1500.5,
      }),
    ).toBe(53727);
  });

  it("never shrinks as the host count grows", () => {
    let previous: number = getNetbiosTotalBudgetInMs({ targetCount: 0 });

    for (let targetCount: number = 1; targetCount <= 6000; targetCount++) {
      const budget: number = getNetbiosTotalBudgetInMs({
        targetCount: targetCount,
      });

      if (budget < previous) {
        throw new Error(
          `budget fell from ${previous}ms to ${budget}ms at ${targetCount} hosts`,
        );
      }

      previous = budget;
    }

    expect(previous).toBe(MAX_AUTOMATIC_NETBIOS_TOTAL_BUDGET_IN_MS);
  });

  it("never returns NaN, a fraction or anything outside its bounds, whatever it is fed", () => {
    const values: Array<number | undefined> = [
      NaN,
      Infinity,
      -Infinity,
      -1,
      0,
      0.5,
      1,
      10,
      1e9,
      undefined,
    ];
    const outOfBounds: Array<string> = [];

    for (const targetCount of values) {
      for (const sendIntervalInMs of values) {
        for (const perHostTimeoutInMs of values) {
          for (const retryPasses of values) {
            const budget: number = getNetbiosTotalBudgetInMs({
              targetCount: targetCount as number,
              sendIntervalInMs: sendIntervalInMs,
              perHostTimeoutInMs: perHostTimeoutInMs,
              retryPasses: retryPasses,
            });

            if (
              !Number.isInteger(budget) ||
              budget < DEFAULT_NETBIOS_TOTAL_BUDGET_IN_MS ||
              budget > MAX_AUTOMATIC_NETBIOS_TOTAL_BUDGET_IN_MS
            ) {
              outOfBounds.push(
                `${JSON.stringify([targetCount, sendIntervalInMs, perHostTimeoutInMs, retryPasses])} -> ${budget}`,
              );
            }
          }
        }
      }
    }

    expect(outOfBounds).toEqual([]);
  });
});

describe("NetbiosNameResolver — a budget sized to the lookup it runs", () => {
  /*
   * The pure sizing above is only half of it: the resolver has to feed it the
   * hosts it will ACTUALLY ask (eligible, de-duplicated, cut to the cap) and
   * its OWN pacing, window and retry count, per lookup — and a caller that
   * fixes the budget has to get exactly that budget. Each of those is a
   * separate way to end up back at a flat figure that cuts large lookups
   * short.
   */

  it("a silent lookup at the host cap finishes its retry pass instead of being cut at 30s", async () => {
    const setup: Harness = harness(new SilentHostsClock());
    const addresses: Array<string> = privateAddresses(2000);
    const start: number = setup.clock.time;

    const resolution: NetbiosNameResolution =
      await resolverFor(setup).resolveNames(addresses);

    expect(resolution.totalBudgetInMs).toBe(DEFAULT_CAP_WORKLOAD_BUDGET_IN_MS);
    expect(resolution.isTimeBudgetExhausted).toBe(false);
    expect(resolution.failureReason).toBeUndefined();
    expect(resolution.queriedCount).toBe(2000);
    expect(resolution.skippedCount).toBe(0);

    // Every host was asked twice: the first pass, then the whole retry pass.
    expect(setup.socket.sent).toHaveLength(4000);
    expect(setup.socket.sentAddresses().slice(0, 2000)).toEqual(addresses);
    expect(setup.socket.sentAddresses().slice(2000)).toEqual(addresses);

    /*
     * Both listening windows ran in full, and the lookup took longer than the
     * old flat budget allowed — so under it, this could not have finished.
     */
    expect(
      setup.clock.sleeps.filter((durationInMs: number) => {
        return durationInMs === DEFAULT_NETBIOS_PER_HOST_TIMEOUT_IN_MS;
      }),
    ).toHaveLength(2);
    expect(setup.clock.time - start).toBe(DEFAULT_CAP_WORKLOAD_ELAPSED_IN_MS);
    expect(setup.clock.time - start).toBeGreaterThan(
      DEFAULT_NETBIOS_TOTAL_BUDGET_IN_MS,
    );

    expect(warnedMessages).toEqual([]);
    expect(setup.socket.closeCount).toBe(1);
  });

  it("the same lookup under a fixed 30s budget loses most of its retry pass — the failure sizing prevents", async () => {
    /*
     * The old behaviour, reproduced by fixing the budget at the old figure.
     * queriedCount alone cannot show the damage — every host was asked once —
     * so the datagrams are counted: the first pass ends at +21,490ms, and the
     * retry pass sends one query per 10ms until +30,000ms, 851 of its 2,000.
     */
    const setup: Harness = harness(new SilentHostsClock());

    const resolution: NetbiosNameResolution = await resolverFor(setup, {
      totalBudgetInMs: DEFAULT_NETBIOS_TOTAL_BUDGET_IN_MS,
    }).resolveNames(privateAddresses(2000));

    expect(resolution.totalBudgetInMs).toBe(30000);
    expect(resolution.isTimeBudgetExhausted).toBe(true);
    expect(resolution.queriedCount).toBe(2000);
    expect(setup.socket.sent).toHaveLength(2000 + 851);
    expect(warnedMessages.join("\n")).toMatch(
      /exceeded their 30000ms budget after naming 0 host\(s\): 2000 of 2000 host\(s\) were queried/,
    );
  });

  it("an explicit budget still cuts the first pass short, and is the one reported", async () => {
    const setup: Harness = harness(new SilentHostsClock());
    const addresses: Array<string> = privateAddresses(2000);

    const resolution: NetbiosNameResolution = await resolverFor(setup, {
      totalBudgetInMs: 10000,
    }).resolveNames(addresses);

    // One send per 10ms from +0: the send due at +10,000ms is refused.
    expect(setup.socket.sentAddresses()).toEqual(addresses.slice(0, 1000));
    expect(resolution).toMatchObject({
      queriedCount: 1000,
      skippedCount: 1000,
      isTimeBudgetExhausted: true,
      isHostCapReached: false,
      eligibleCount: 2000,
      maxHosts: 2000,
      totalBudgetInMs: 10000,
    });
    expect(setup.socket.closeCount).toBe(1);
  });

  it("sizes from the resolver's own pacing, window and retry count", async () => {
    /*
     * A resolver built with slower pacing and an extra retry must be sized for
     * THAT work, not the defaults — or a caller tuning pacing down for a
     * sensitive network would silently lose its later passes.
     */
    const setup: Harness = harness(new SilentHostsClock());
    const start: number = setup.clock.time;

    const resolution: NetbiosNameResolution = await resolverFor(setup, {
      sendIntervalInMs: 50,
      perHostTimeoutInMs: 3000,
      retryPasses: 2,
    }).resolveNames(privateAddresses(500));

    // 3 × (499 × 50 + 3,000) × 1.25 = 104,812.5
    expect(resolution.totalBudgetInMs).toBe(104813);
    expect(resolution.totalBudgetInMs).toBe(
      getNetbiosTotalBudgetInMs({
        targetCount: 500,
        sendIntervalInMs: 50,
        perHostTimeoutInMs: 3000,
        retryPasses: 2,
      }),
    );
    expect(resolution.isTimeBudgetExhausted).toBe(false);
    expect(setup.socket.sent).toHaveLength(1500);
    expect(setup.clock.time - start).toBe(3 * (499 * 50 + 3000));
  });

  it("sizes from the hosts it will actually ask: the cap, not every eligible host", async () => {
    const setup: Harness = harness();
    const start: number = setup.clock.time;

    const resolution: NetbiosNameResolution = await resolverFor(setup, {
      maxHosts: 3,
      sendIntervalInMs: 1000,
      perHostTimeoutInMs: 20000,
    }).resolveNames(privateAddresses(10));

    // 2 × (2 × 1,000 + 20,000) × 1.25 — ten hosts would have been 72,500.
    expect(resolution.totalBudgetInMs).toBe(55000);
    expect(resolution.isHostCapReached).toBe(true);
    expect(resolution.eligibleCount).toBe(10);
    expect(resolution.isTimeBudgetExhausted).toBe(false);
    expect(setup.socket.sent).toHaveLength(6);
    expect(setup.clock.time - start).toBe(44000);
  });

  it("does not let refused or duplicated addresses enlarge the budget", async () => {
    const setup: Harness = harness();

    const resolution: NetbiosNameResolution = await resolverFor(setup, {
      sendIntervalInMs: 1000,
      perHostTimeoutInMs: 20000,
    }).resolveNames([
      "10.0.0.1",
      "10.0.0.1",
      "8.8.8.8",
      "10.0.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "::1",
      "10.0.0.1",
    ]);

    // One host: 2 × 20,000 × 1.25. Counting all eight entries would be 67,500.
    expect(resolution.totalBudgetInMs).toBe(50000);
    expect(resolution.eligibleCount).toBe(1);
    expect(setup.socket.sentAddresses()).toEqual(["10.0.0.1", "10.0.0.1"]);
  });

  it("treats an explicit totalBudgetInMs of undefined as 'size it', like omitting it", async () => {
    /*
     * A caller forwarding an unset setting passes `setting || undefined`, as
     * FetchScans does for the reverse-DNS budget. An undefined taken as a
     * fixed budget would become Math.max(1, undefined) — NaN — and a NaN
     * deadline never expires.
     */
    const setup: Harness = harness();
    const resolver: NetbiosNameResolver = new NetbiosNameResolver({
      createSocket: setup.createSocket,
      now: setup.clock.now,
      sleep: setup.clock.sleep,
      sendIntervalInMs: 1000,
      perHostTimeoutInMs: 20000,
      totalBudgetInMs: undefined,
    });

    const resolution: NetbiosNameResolution = await resolver.resolveNames([
      "10.0.0.1",
    ]);

    expect(resolution.totalBudgetInMs).toBe(50000);
    expect(resolution.isTimeBudgetExhausted).toBe(false);
  });

  it("sizes every lookup afresh on a reused resolver", async () => {
    /*
     * The budget is worked out per resolveNames call. One cached from an
     * earlier, smaller lookup would cut a later large one short; one cached
     * from a large lookup would let a later small one overstay.
     */
    const setup: Harness = harness();
    const resolver: NetbiosNameResolver = resolverFor(setup, {
      sendIntervalInMs: 1000,
      perHostTimeoutInMs: 20000,
    });

    const small: NetbiosNameResolution = await resolver.resolveNames([
      "10.0.0.1",
    ]);
    const large: NetbiosNameResolution = await resolver.resolveNames(
      privateAddresses(10),
    );
    const smallAgain: NetbiosNameResolution = await resolver.resolveNames([
      "10.0.0.2",
    ]);

    expect([
      small.totalBudgetInMs,
      large.totalBudgetInMs,
      smallAgain.totalBudgetInMs,
    ]).toEqual([50000, 72500, 50000]);
    expect(large.isTimeBudgetExhausted).toBe(false);
  });

  it("uses a fixed budget as given, below the floor or above the automatic ceiling", async () => {
    /*
     * The operator's figure is the operator's: neither the 30s floor nor the
     * 2 minute ceiling applies to a budget the caller chose.
     */
    for (const totalBudgetInMs of [5000, 10 * 60 * 1000]) {
      const setup: Harness = harness();

      const resolution: NetbiosNameResolution = await resolverFor(setup, {
        totalBudgetInMs: totalBudgetInMs,
      }).resolveNames(["10.0.0.1"]);

      expect(resolution.totalBudgetInMs).toBe(totalBudgetInMs);
      // Two 1.5s windows fit either figure.
      expect(resolution.isTimeBudgetExhausted).toBe(false);
      expect(setup.socket.sent).toHaveLength(2);
    }
  });

  it("clamps a fixed budget of zero or less to 1ms — never 'no limit', never 'automatic'", async () => {
    /*
     * FINITE zero or less only. -Number.MAX_VALUE is here so the line drawn
     * for non-finite budgets (sized automatically, below) is not drawn by
     * magnitude: it is as far from zero as -Infinity and is still a number a
     * caller wrote as a budget.
     */
    for (const totalBudgetInMs of [0, -0, -100, -Number.MAX_VALUE]) {
      const setup: Harness = harness();

      const resolution: NetbiosNameResolution = await resolverFor(setup, {
        totalBudgetInMs: totalBudgetInMs,
      }).resolveNames(["10.0.0.1", "10.0.0.2"]);

      expect(resolution.totalBudgetInMs).toBe(1);
      expect(resolution.isTimeBudgetExhausted).toBe(true);
      // The first send is due at once; the second, 10ms later, is past it.
      expect(setup.socket.sentAddresses()).toEqual(["10.0.0.1"]);
    }
  });

  it("a socket that never binds waits out the sized budget, and reports it", async () => {
    /*
     * The bind wait is bounded by the same budget as everything else. Sized
     * for 2,000 hosts it must wait THAT long — not the floor, or a slow bind
     * on a loaded probe would abandon a lookup it had time for — and say so.
     */
    for (const [hostCount, expectedBudgetInMs] of [
      [2000, DEFAULT_CAP_WORKLOAD_BUDGET_IN_MS],
      [1, DEFAULT_NETBIOS_TOTAL_BUDGET_IN_MS],
    ] as Array<[number, number]>) {
      warnedMessages = [];
      const setup: Harness = harness();
      setup.socket.bindBehaviour = "never";
      const start: number = setup.clock.time;

      const resolution: NetbiosNameResolution = await resolverFor(
        setup,
      ).resolveNames(privateAddresses(hostCount));

      expect(setup.clock.sleeps).toEqual([expectedBudgetInMs]);
      expect(setup.clock.time - start).toBe(expectedBudgetInMs);
      expect(resolution).toEqual({
        nameByIpAddress: new Map<string, string>(),
        queriedCount: 0,
        skippedCount: hostCount,
        isTimeBudgetExhausted: true,
        isHostCapReached: false,
        eligibleCount: hostCount,
        maxHosts: DEFAULT_NETBIOS_MAX_HOSTS,
        totalBudgetInMs: expectedBudgetInMs,
        failureReason: "The UDP socket did not bind in time.",
      });
      expect(setup.socket.sent).toHaveLength(0);
      expect(setup.socket.closeCount).toBe(1);
      expect(warnedMessages.join("\n")).toContain(
        `did not bind within ${expectedBudgetInMs}ms`,
      );
    }
  });
});

describe("NetbiosNameResolver — a fixed budget that is not a finite number", () => {
  /*
   * The constructor used to clamp a fixed budget with Math.max(1, ...), which
   * does nothing useful for the three non-finite numbers: NaN and Infinity
   * pass straight through it and make a deadline no clock ever reaches, and
   * -Infinity becomes 1ms, cutting the lookup off after one datagram for a
   * budget nobody chose. NaN is also worse here than in reverse DNS: every
   * listening window is Math.min(window, deadline - now), so a NaN deadline
   * turns each window into a sleep of NaN milliseconds. All three now mean
   * "size it automatically", the only answer still bounded.
   */

  it.each([NaN, Infinity, -Infinity])(
    "reports and runs under the automatic budget when the fixed budget is %p",
    async (totalBudgetInMs: number) => {
      /*
       * One silent host, 1s pacing and a 20s window: two passes of 20,000ms
       * with 25% headroom is 50,000ms. The run must be indistinguishable from
       * one given no budget — same figure, same datagrams, same two full
       * listening windows — rather than merely reporting the right number.
       */
      const nonFiniteSetup: Harness = harness();

      const nonFinite: NetbiosNameResolution = await resolverFor(
        nonFiniteSetup,
        {
          sendIntervalInMs: 1000,
          perHostTimeoutInMs: 20000,
          totalBudgetInMs: totalBudgetInMs,
        },
      ).resolveNames(["10.0.0.1"]);

      const omittedSetup: Harness = harness();

      const omitted: NetbiosNameResolution = await resolverFor(omittedSetup, {
        sendIntervalInMs: 1000,
        perHostTimeoutInMs: 20000,
      }).resolveNames(["10.0.0.1"]);

      expect(nonFinite.totalBudgetInMs).toBe(50000);
      expect(nonFinite.totalBudgetInMs).toBe(
        getNetbiosTotalBudgetInMs({
          targetCount: 1,
          sendIntervalInMs: 1000,
          perHostTimeoutInMs: 20000,
          retryPasses: DEFAULT_NETBIOS_RETRY_PASSES,
        }),
      );
      expect(nonFinite).toEqual(omitted);
      expect(nonFiniteSetup.clock.sleeps).toEqual([20000, 20000]);
      expect(nonFiniteSetup.clock.sleeps).toEqual(omittedSetup.clock.sleeps);
      expect(nonFiniteSetup.socket.sentAddresses()).toEqual([
        "10.0.0.1",
        "10.0.0.1",
      ]);
      expect(nonFinite.isTimeBudgetExhausted).toBe(false);
    },
  );

  it.each([NaN, Infinity, -Infinity])(
    "stops a lookup fixed at %p once a clock jumping 1,000,000ms per reading passes the automatic deadline",
    async (totalBudgetInMs: number) => {
      /*
       * The reproduction from review. Reading 0 fixes the deadline at the
       * 30,000ms floor two hosts get; the next reading, taken before the first
       * send, is a million milliseconds later. Against a NaN or Infinity
       * deadline that reading was never late, so both hosts were asked twice
       * and the lookup claimed to have finished in time.
       *
       * Built directly rather than through resolverFor because the clock is
       * the variable under test; the socket is still the fake one.
       */
      const setup: Harness = harness();
      let reading: number = 0;

      const resolution: NetbiosNameResolution = await new NetbiosNameResolver({
        createSocket: setup.createSocket,
        sleep: setup.clock.sleep,
        now: (): number => {
          const value: number = reading;
          reading += 1000000;
          return value;
        },
        totalBudgetInMs: totalBudgetInMs,
      }).resolveNames(["10.0.0.1", "10.0.0.2"]);

      expect(setup.socket.sent).toHaveLength(0);
      expect(resolution).toMatchObject({
        queriedCount: 0,
        skippedCount: 2,
        isTimeBudgetExhausted: true,
        eligibleCount: 2,
        totalBudgetInMs: DEFAULT_NETBIOS_TOTAL_BUDGET_IN_MS,
      });
      expect(resolution.failureReason).toBeUndefined();
      expect(setup.socket.closeCount).toBe(1);
      expect(warnedMessages.join("\n")).toContain(
        "exceeded their 30000ms budget after naming 0 host(s): 0 of 2 host(s) were queried",
      );
    },
  );

  it.each([NaN, Infinity, -Infinity])(
    "cuts a lookup fixed at %p at exactly the automatic budget when its timers run late",
    async (totalBudgetInMs: number) => {
      /*
       * The jump above proves SOME deadline; this proves it is the automatic
       * one, to the millisecond. Every sleep here takes twice as long as asked
       * — timers firing far later than the headroom allows for — so the
       * 50,000ms automatic budget cannot fit two 20,000ms windows. The first
       * window ends at +40,000ms, the retry is sent, and the second window is
       * cut to the 10,000ms left. Unbounded (NaN, Infinity) the second window
       * would run its full 20,000ms (or NaN); clamped to 1ms (-Infinity) the
       * first would be a single millisecond.
       */
      const setup: Harness = harness();
      setup.clock.onSleep = (durationInMs: number): void => {
        setup.clock.time += durationInMs;
      };

      const resolution: NetbiosNameResolution = await resolverFor(setup, {
        sendIntervalInMs: 1000,
        perHostTimeoutInMs: 20000,
        totalBudgetInMs: totalBudgetInMs,
      }).resolveNames(["10.0.0.1"]);

      expect(setup.clock.sleeps).toEqual([20000, 10000]);
      expect(setup.socket.sentAddresses()).toEqual(["10.0.0.1", "10.0.0.1"]);
      expect(resolution.totalBudgetInMs).toBe(50000);
      expect(resolution.isTimeBudgetExhausted).toBe(true);
      expect(resolution.queriedCount).toBe(1);
      expect(warnedMessages.join("\n")).toContain(
        "exceeded their 50000ms budget",
      );
    },
  );

  it.each([NaN, Infinity, -Infinity])(
    "waits out the automatic budget, not %p, for a socket that never binds",
    async (totalBudgetInMs: number) => {
      /*
       * The bind wait is `sleep(deadline - now)`. With a NaN deadline that is
       * a sleep of NaN — which a real setTimeout fires after about a
       * millisecond, abandoning a bind that had time — and with Infinity a
       * sleep a real setTimeout also cannot honour. Sized automatically, one
       * host waits the 30,000ms floor and says so.
       */
      const setup: Harness = harness();
      setup.socket.bindBehaviour = "never";
      const start: number = setup.clock.time;

      const resolution: NetbiosNameResolution = await resolverFor(setup, {
        totalBudgetInMs: totalBudgetInMs,
      }).resolveNames(["10.0.0.1"]);

      expect(setup.clock.sleeps).toEqual([DEFAULT_NETBIOS_TOTAL_BUDGET_IN_MS]);
      expect(setup.clock.time - start).toBe(DEFAULT_NETBIOS_TOTAL_BUDGET_IN_MS);
      expect(resolution).toMatchObject({
        queriedCount: 0,
        isTimeBudgetExhausted: true,
        totalBudgetInMs: DEFAULT_NETBIOS_TOTAL_BUDGET_IN_MS,
        failureReason: "The UDP socket did not bind in time.",
      });
      expect(setup.socket.sent).toHaveLength(0);
      expect(setup.socket.closeCount).toBe(1);
      expect(warnedMessages.join("\n")).toContain(
        `did not bind within ${DEFAULT_NETBIOS_TOTAL_BUDGET_IN_MS}ms`,
      );
    },
  );

  it("sizes a non-finite budget per lookup on a reused resolver, like an omitted one", async () => {
    /*
     * The fallback is decided once, in the constructor; the figure must still
     * be worked out for each lookup's own host count. Resolving NaN to a
     * figure fixed at construction would pass every single-lookup test above.
     */
    const setup: Harness = harness();
    const resolver: NetbiosNameResolver = resolverFor(setup, {
      sendIntervalInMs: 1000,
      perHostTimeoutInMs: 20000,
      totalBudgetInMs: Infinity,
    });

    const small: NetbiosNameResolution = await resolver.resolveNames([
      "10.0.0.1",
    ]);
    const large: NetbiosNameResolution = await resolver.resolveNames(
      privateAddresses(10),
    );

    expect([small.totalBudgetInMs, large.totalBudgetInMs]).toEqual([
      50000, 72500,
    ]);
    expect(large.isTimeBudgetExhausted).toBe(false);
  });
});

describe("NetbiosNameResolver — the host cap the constructor applies", () => {
  /*
   * The cap is now something an operator sets, through
   * PROBE_DISCOVERY_NETBIOS_MAX_HOSTS: FetchScans reads it, passes
   * `setting || undefined` down through SubnetScanner.attachNetbiosNames, and
   * THIS constructor decides what the lookup actually runs under. So every
   * shape that can reach it has to land somewhere bounded.
   */

  it.each([NaN, Infinity, -Infinity])(
    "uses the built-in cap of 2,000 when maxHosts is %p, rather than no cap at all",
    async (maxHosts: number) => {
      /*
       * The bug this pins. The constructor used to clamp with
       * Math.max(1, Math.floor(maxHosts)), which does nothing useful for the
       * three non-finite numbers:
       *
       *   - NaN survives it, and `eligibleCount > NaN` is false, so the cap
       *     was never "reached": a /16 of unnamed hosts would have been paced
       *     a datagram each, tens of thousands of NBSTAT queries, exactly the
       *     reconnaissance burst the cap exists to prevent.
       *   - Infinity survives it too, with the same effect.
       *   - -Infinity became 1, so the whole estate got ONE query.
       *
       * Reported figures alone would not show any of that, so the datagrams
       * are counted: 2,001 eligible hosts, 2,000 asked, and the cap reported
       * as reached. One pass only, to halve the work; the cap is what is
       * under test, not the retry.
       */
      const setup: Harness = harness(new SilentHostsClock());
      const addresses: Array<string> = privateAddresses(
        DEFAULT_NETBIOS_MAX_HOSTS + 1,
      );

      const resolution: NetbiosNameResolution = await resolverFor(setup, {
        maxHosts: maxHosts,
        retryPasses: 0,
      }).resolveNames(addresses);

      expect(resolution).toMatchObject({
        maxHosts: DEFAULT_NETBIOS_MAX_HOSTS,
        isHostCapReached: true,
        eligibleCount: 2001,
        queriedCount: 2000,
        skippedCount: 1,
        isTimeBudgetExhausted: false,
        // One paced pass over 2,000 hosts still fits the 30s floor.
        totalBudgetInMs: DEFAULT_NETBIOS_TOTAL_BUDGET_IN_MS,
      });
      expect(setup.socket.sentAddresses()).toEqual(addresses.slice(0, 2000));
      expect(warnedMessages.join("\n")).toMatch(
        /capped at 2000 host\(s\) per scan; 2001 unnamed host\(s\) were eligible, so 1 will keep/,
      );
      expect(setup.socket.closeCount).toBe(1);
    },
  );

  it.each([0, -0, -1, -2000, -Number.MAX_VALUE])(
    "clamps a finite cap of %p to one host, so the lookup still asks somebody",
    async (maxHosts: number) => {
      /*
       * FINITE values only, and -Number.MAX_VALUE is here deliberately: the
       * line between "clamp to 1" and "use the default" is drawn by
       * finiteness, not by magnitude, so a number as far from zero as
       * -Infinity must still clamp. A cap of 0 would turn the lookup off
       * while still reporting it as having run.
       */
      const setup: Harness = harness();

      const resolution: NetbiosNameResolution = await resolverFor(setup, {
        maxHosts: maxHosts,
        retryPasses: 0,
      }).resolveNames(privateAddresses(3));

      expect(resolution).toMatchObject({
        maxHosts: 1,
        isHostCapReached: true,
        eligibleCount: 3,
        queriedCount: 1,
        skippedCount: 2,
      });
      expect(setup.socket.sentAddresses()).toEqual(["10.0.0.1"]);
    },
  );

  it.each([
    [1.9, 1],
    [2.7, 2],
    [3.999, 3],
  ] as Array<[number, number]>)(
    "floors a fractional cap of %p to %p whole hosts",
    async (maxHosts: number, appliedMaxHosts: number) => {
      const setup: Harness = harness();

      const resolution: NetbiosNameResolution = await resolverFor(setup, {
        maxHosts: maxHosts,
        retryPasses: 0,
      }).resolveNames(privateAddresses(4));

      expect(resolution).toMatchObject({
        maxHosts: appliedMaxHosts,
        isHostCapReached: true,
        eligibleCount: 4,
        queriedCount: appliedMaxHosts,
        skippedCount: 4 - appliedMaxHosts,
      });
      expect(setup.socket.sent).toHaveLength(appliedMaxHosts);
    },
  );

  it("floors a large fractional cap too, and reports the floored figure", async () => {
    /*
     * Cheaply, on a list that reaches nothing: the cap the result carries is
     * the cap that WOULD be applied, and eligibleCount - maxHosts is what the
     * scan's status message subtracts. A fraction there would print "2000.999
     * hosts".
     */
    const setup: Harness = harness();

    const resolution: NetbiosNameResolution = await resolverFor(setup, {
      maxHosts: 2000.999,
    }).resolveNames([]);

    expect(resolution.maxHosts).toBe(2000);
    expect(setup.createSocketCalls()).toBe(0);
  });

  it("a raised cap of 3,000 asks three thousand hosts and sizes the budget for them", async () => {
    /*
     * What PROBE_DISCOVERY_NETBIOS_MAX_HOSTS buys, end to end on the fake
     * socket: 500 more hosts asked than the built-in cap allows, AND a budget
     * grown to cover them. A raised cap with the old 53,725ms budget would
     * simply have moved the truncation from the cap to the clock.
     */
    const setup: Harness = harness(new SilentHostsClock());
    const addresses: Array<string> = privateAddresses(3500);
    const start: number = setup.clock.time;

    const resolution: NetbiosNameResolution = await resolverFor(setup, {
      maxHosts: 3000,
    }).resolveNames(addresses);

    expect(resolution).toMatchObject({
      maxHosts: 3000,
      isHostCapReached: true,
      eligibleCount: 3500,
      queriedCount: 3000,
      skippedCount: 500,
      isTimeBudgetExhausted: false,
      // 2 × (2,999 × 10 + 1,500) × 1.25 — the built-in cap would give 53,725.
      totalBudgetInMs: 78725,
    });
    expect(resolution.totalBudgetInMs).toBe(
      getNetbiosTotalBudgetInMs({ targetCount: 3000 }),
    );
    expect(resolution.totalBudgetInMs).toBeGreaterThan(
      DEFAULT_CAP_WORKLOAD_BUDGET_IN_MS,
    );

    // Both passes ran over all three thousand, in address order.
    expect(setup.socket.sent).toHaveLength(6000);
    expect(setup.socket.sentAddresses().slice(0, 3000)).toEqual(
      addresses.slice(0, 3000),
    );
    expect(setup.socket.sentAddresses().slice(3000)).toEqual(
      addresses.slice(0, 3000),
    );
    expect(setup.clock.time - start).toBe(2 * (2999 * 10 + 1500));
    expect(resolution.failureReason).toBeUndefined();
  });

  it("the highest cap an operator may configure still finishes both passes inside the automatic ceiling", async () => {
    /*
     * MAX_NETBIOS_MAX_HOSTS_OVERRIDE is a claim about arithmetic, and
     * Probe/Config.ts reads it as the parser's maximum: at this many hosts the
     * sized budget must still be UNDER
     * MAX_AUTOMATIC_NETBIOS_TOTAL_BUDGET_IN_MS, or the clamp takes over and
     * the extra hosts the operator asked for are cut by the clock instead —
     * the same silent truncation, differently caused. Proven by running it,
     * not only by the sizing function.
     */
    expect(MAX_NETBIOS_MAX_HOSTS_OVERRIDE).toBe(4000);
    expect(MAX_NETBIOS_MAX_HOSTS_OVERRIDE).toBeGreaterThan(
      DEFAULT_NETBIOS_MAX_HOSTS,
    );
    // 2 × (3,999 × 10 + 1,500) × 1.25 = 103,725 — about 104 seconds.
    expect(
      getNetbiosTotalBudgetInMs({
        targetCount: MAX_NETBIOS_MAX_HOSTS_OVERRIDE,
      }),
    ).toBe(103725);
    expect(
      getNetbiosTotalBudgetInMs({
        targetCount: MAX_NETBIOS_MAX_HOSTS_OVERRIDE,
      }),
    ).toBeLessThan(MAX_AUTOMATIC_NETBIOS_TOTAL_BUDGET_IN_MS);

    const setup: Harness = harness(new SilentHostsClock());
    const start: number = setup.clock.time;

    const resolution: NetbiosNameResolution = await resolverFor(setup, {
      maxHosts: MAX_NETBIOS_MAX_HOSTS_OVERRIDE,
    }).resolveNames(privateAddresses(MAX_NETBIOS_MAX_HOSTS_OVERRIDE));

    expect(resolution).toMatchObject({
      maxHosts: 4000,
      isHostCapReached: false,
      eligibleCount: 4000,
      queriedCount: 4000,
      skippedCount: 0,
      isTimeBudgetExhausted: false,
      totalBudgetInMs: 103725,
    });
    // Every host asked twice, and the whole thing inside its own budget.
    expect(setup.socket.sent).toHaveLength(8000);
    expect(setup.clock.time - start).toBe(2 * (3999 * 10 + 1500));
    expect(setup.clock.time - start).toBeLessThan(resolution.totalBudgetInMs);
    expect(warnedMessages).toEqual([]);
  });
});

describe("NetbiosNameResolver — eligibleCount, maxHosts and totalBudgetInMs on every return path", () => {
  /*
   * The scan's status note is built from these three fields: how many unnamed
   * hosts the cap left out (eligibleCount - maxHosts), how many of the hosts
   * it did ask were never reached, and the time limit it ran under. The
   * resolver has seven ways to return, and a field missing from any one of
   * them surfaces as "undefined hosts" or a note that silently says nothing
   * on exactly the scans that went wrong. So every path is pinned.
   */

  it("on an empty list, reports the resolver's cap and a fixed budget without opening a socket", async () => {
    const setup: Harness = harness();

    const resolution: NetbiosNameResolution = await resolverFor(setup, {
      maxHosts: 7,
      totalBudgetInMs: 4321,
    }).resolveNames([]);

    expect(setup.createSocketCalls()).toBe(0);
    expect(resolution).toEqual({
      nameByIpAddress: new Map<string, string>(),
      queriedCount: 0,
      skippedCount: 0,
      isTimeBudgetExhausted: false,
      isHostCapReached: false,
      eligibleCount: 0,
      maxHosts: 7,
      totalBudgetInMs: 4321,
      failureReason: undefined,
    });
  });

  it("when every address is refused — public, loopback, link-local, IPv6, non-strings, duplicates", async () => {
    const setup: Harness = harness();

    const resolution: NetbiosNameResolution = await resolverFor(
      setup,
    ).resolveNames([
      "8.8.8.8",
      "8.8.8.8",
      "127.0.0.1",
      "169.254.169.254",
      "::1",
      42 as unknown as string,
      null as unknown as string,
      undefined as unknown as string,
      "127.0.0.1",
    ]);

    expect(setup.createSocketCalls()).toBe(0);
    expect(resolution).toEqual({
      nameByIpAddress: new Map<string, string>(),
      queriedCount: 0,
      // Seven distinct inputs; the repeats are not counted twice.
      skippedCount: 7,
      isTimeBudgetExhausted: false,
      isHostCapReached: false,
      eligibleCount: 0,
      maxHosts: DEFAULT_NETBIOS_MAX_HOSTS,
      totalBudgetInMs: DEFAULT_NETBIOS_TOTAL_BUDGET_IN_MS,
      failureReason: undefined,
    });
  });

  it("counts only allowed addresses as eligible when refused ones are mixed in", async () => {
    const setup: Harness = harness();
    setup.socket.responder = (query: SentQuery): void => {
      setup.socket.answer(query, workstation("MIXED"));
    };

    const resolution: NetbiosNameResolution = await resolverFor(
      setup,
    ).resolveNames([
      "10.0.0.1",
      "8.8.8.8",
      "10.0.0.2",
      "10.0.0.1",
      "127.0.0.1",
      "192.168.1.1",
      "100.64.0.1",
      "172.16.0.1",
      "192.168.1.1",
    ]);

    expect(resolution).toEqual({
      nameByIpAddress: new Map<string, string>([
        ["10.0.0.1", "mixed"],
        ["10.0.0.2", "mixed"],
        ["192.168.1.1", "mixed"],
        ["100.64.0.1", "mixed"],
        ["172.16.0.1", "mixed"],
      ]),
      queriedCount: 5,
      skippedCount: 2,
      isTimeBudgetExhausted: false,
      isHostCapReached: false,
      eligibleCount: 5,
      maxHosts: DEFAULT_NETBIOS_MAX_HOSTS,
      totalBudgetInMs: DEFAULT_NETBIOS_TOTAL_BUDGET_IN_MS,
      failureReason: undefined,
    });
  });

  it("counts distinct addresses as eligible, so repeats cannot trip the host cap", async () => {
    /*
     * eligibleCount - maxHosts is what the scan reports as "not asked". A
     * sweep that listed a host once per interface must not inflate it — or
     * report a cap that was never reached.
     */
    const setup: Harness = harness();

    const resolution: NetbiosNameResolution = await resolverFor(setup, {
      maxHosts: 2,
      retryPasses: 0,
    }).resolveNames([
      "10.0.0.1",
      "10.0.0.2",
      "10.0.0.1",
      "10.0.0.2",
      "10.0.0.1",
      "10.0.0.1",
      "10.0.0.2",
    ]);

    expect(resolution).toMatchObject({
      eligibleCount: 2,
      maxHosts: 2,
      isHostCapReached: false,
      queriedCount: 2,
      skippedCount: 0,
    });
    expect(setup.socket.sentAddresses()).toEqual(["10.0.0.1", "10.0.0.2"]);
  });

  it("when a custom host cap is reached, eligibleCount runs past maxHosts by exactly the hosts left out", async () => {
    const setup: Harness = harness();
    setup.socket.responder = (query: SentQuery): void => {
      setup.socket.answer(query, workstation("CAPPED"));
    };

    const resolution: NetbiosNameResolution = await resolverFor(setup, {
      maxHosts: 3,
    }).resolveNames(["8.8.8.8", ...privateAddresses(8), "127.0.0.1"]);

    expect(resolution).toMatchObject({
      queriedCount: 3,
      // Two refused, five over the cap.
      skippedCount: 7,
      isTimeBudgetExhausted: false,
      isHostCapReached: true,
      eligibleCount: 8,
      maxHosts: 3,
      totalBudgetInMs: DEFAULT_NETBIOS_TOTAL_BUDGET_IN_MS,
      failureReason: undefined,
    });
    expect(resolution.eligibleCount - resolution.maxHosts).toBe(5);
    expect(warnedMessages.join("\n")).toMatch(
      /capped at 3 host\(s\) per scan; 8 unnamed host\(s\) were eligible, so 5 will keep/,
    );
  });

  it("when the default cap is reached, sizes for the 2,000 asked and still finishes the retry pass", async () => {
    const setup: Harness = harness(new SilentHostsClock());

    const resolution: NetbiosNameResolution = await resolverFor(
      setup,
    ).resolveNames(privateAddresses(2500));

    expect(resolution).toMatchObject({
      queriedCount: 2000,
      skippedCount: 500,
      isTimeBudgetExhausted: false,
      isHostCapReached: true,
      eligibleCount: 2500,
      maxHosts: DEFAULT_NETBIOS_MAX_HOSTS,
      // Not 2 × (2,499 × 10 + 1,500) × 1.25 = 66,225, which sizing all 2,500 would give.
      totalBudgetInMs: DEFAULT_CAP_WORKLOAD_BUDGET_IN_MS,
      failureReason: undefined,
    });
    expect(setup.socket.sent).toHaveLength(4000);
    // The cap warning, and no budget warning after it.
    expect(warnedMessages).toHaveLength(1);
    expect(warnedMessages[0]).toMatch(
      /capped at 2000 host\(s\) per scan; 2500 unnamed host\(s\) were eligible, so 500 will keep/,
    );
  });

  it("reports the host cap as clamped, not as configured", async () => {
    /*
     * A cap of 0 would ask nobody and a fractional one is meaningless, so the
     * constructor clamps both. The result must carry the cap that was
     * APPLIED, or eligibleCount - maxHosts disagrees with what was sent.
     */
    for (const [maxHosts, appliedMaxHosts] of [
      [0, 1],
      [2.7, 2],
    ] as Array<[number, number]>) {
      const setup: Harness = harness();

      const resolution: NetbiosNameResolution = await resolverFor(setup, {
        maxHosts: maxHosts,
        retryPasses: 0,
      }).resolveNames(privateAddresses(3));

      expect(resolution).toMatchObject({
        maxHosts: appliedMaxHosts,
        eligibleCount: 3,
        isHostCapReached: true,
        queriedCount: appliedMaxHosts,
        skippedCount: 3 - appliedMaxHosts,
      });
      expect(setup.socket.sent).toHaveLength(appliedMaxHosts);
    }
  });

  it("when the socket cannot be created, still reports the eligible hosts and the sized budget", async () => {
    const setup: Harness = harness();
    setup.failCreateSocketWith(new Error("EMFILE: too many open files"));

    const resolution: NetbiosNameResolution = await resolverFor(setup, {
      sendIntervalInMs: 1000,
      perHostTimeoutInMs: 20000,
    }).resolveNames(["10.0.0.1", "10.0.0.2", "8.8.8.8", "10.0.0.3"]);

    expect(resolution).toEqual({
      nameByIpAddress: new Map<string, string>(),
      queriedCount: 0,
      skippedCount: 4,
      isTimeBudgetExhausted: false,
      isHostCapReached: false,
      eligibleCount: 3,
      maxHosts: DEFAULT_NETBIOS_MAX_HOSTS,
      // 2 × (2 × 1,000 + 20,000) × 1.25
      totalBudgetInMs: 55000,
      failureReason: "EMFILE: too many open files",
    });
    // Nothing was waited on.
    expect(setup.clock.sleeps).toEqual([]);
  });

  it("when the socket errors mid-lookup", async () => {
    const setup: Harness = harness();
    setup.socket.responder = (query: SentQuery): void => {
      if (query.address === "10.0.0.1") {
        setup.socket.answer(query, workstation("EARLY"));
      }

      if (query.address === "10.0.0.2") {
        queueMicrotask(() => {
          setup.socket.emit("error", new Error("recvmsg ENOMEM"));
        });
      }
    };

    const resolution: NetbiosNameResolution = await resolverFor(
      setup,
    ).resolveNames(["10.0.0.1", "10.0.0.2", "10.0.0.3", "10.0.0.4", "1.1.1.1"]);

    expect(resolution).toEqual({
      nameByIpAddress: new Map<string, string>([["10.0.0.1", "early"]]),
      queriedCount: 2,
      skippedCount: 3,
      isTimeBudgetExhausted: false,
      isHostCapReached: false,
      eligibleCount: 4,
      maxHosts: DEFAULT_NETBIOS_MAX_HOSTS,
      totalBudgetInMs: DEFAULT_NETBIOS_TOTAL_BUDGET_IN_MS,
      failureReason: "recvmsg ENOMEM",
    });
  });

  it("when the bind emits an error", async () => {
    const setup: Harness = harness();
    setup.socket.bindBehaviour = "error";

    const resolution: NetbiosNameResolution = await resolverFor(setup, {
      maxHosts: 2,
    }).resolveNames(privateAddresses(3));

    expect(resolution).toEqual({
      nameByIpAddress: new Map<string, string>(),
      queriedCount: 0,
      skippedCount: 3,
      isTimeBudgetExhausted: false,
      isHostCapReached: true,
      eligibleCount: 3,
      maxHosts: 2,
      totalBudgetInMs: DEFAULT_NETBIOS_TOTAL_BUDGET_IN_MS,
      failureReason: "bind EACCES",
    });
  });

  it("when the bind throws", async () => {
    const setup: Harness = harness();
    setup.socket.bindBehaviour = "throw";

    const resolution: NetbiosNameResolution = await resolverFor(setup, {
      totalBudgetInMs: 9000,
    }).resolveNames(["10.0.0.1", "127.0.0.1"]);

    expect(resolution).toEqual({
      nameByIpAddress: new Map<string, string>(),
      queriedCount: 0,
      skippedCount: 2,
      isTimeBudgetExhausted: false,
      isHostCapReached: false,
      eligibleCount: 1,
      maxHosts: DEFAULT_NETBIOS_MAX_HOSTS,
      totalBudgetInMs: 9000,
      failureReason: "bind EADDRINUSE",
    });
  });

  it("when the bind never completes, with the cap also reached", async () => {
    const setup: Harness = harness();
    setup.socket.bindBehaviour = "never";

    const resolution: NetbiosNameResolution = await resolverFor(setup, {
      maxHosts: 2,
      totalBudgetInMs: 5000,
    }).resolveNames(privateAddresses(5));

    expect(resolution).toEqual({
      nameByIpAddress: new Map<string, string>(),
      queriedCount: 0,
      skippedCount: 5,
      isTimeBudgetExhausted: true,
      isHostCapReached: true,
      eligibleCount: 5,
      maxHosts: 2,
      totalBudgetInMs: 5000,
      failureReason: "The UDP socket did not bind in time.",
    });
    expect(setup.clock.sleeps).toEqual([5000]);
  });

  it("when the budget runs out, with the cap also reached", async () => {
    const setup: Harness = harness();
    setup.socket.responder = (query: SentQuery): void => {
      setup.socket.answer(query, workstation(`B-${query.address.slice(-1)}`));
    };

    const resolution: NetbiosNameResolution = await resolverFor(setup, {
      maxHosts: 5,
      totalBudgetInMs: 25,
    }).resolveNames([...privateAddresses(6), "8.8.8.8"]);

    // Sends at +0, +10 and +20 of the five under the cap.
    expect(resolution).toEqual({
      nameByIpAddress: new Map<string, string>([
        ["10.0.0.1", "b-1"],
        ["10.0.0.2", "b-2"],
        ["10.0.0.3", "b-3"],
      ]),
      queriedCount: 3,
      skippedCount: 4,
      isTimeBudgetExhausted: true,
      isHostCapReached: true,
      eligibleCount: 6,
      maxHosts: 5,
      totalBudgetInMs: 25,
      failureReason: undefined,
    });
  });

  it("on an ordinary successful lookup", async () => {
    const setup: Harness = harness();
    setup.socket.responder = (query: SentQuery): void => {
      if (query.address !== "10.0.0.3") {
        setup.socket.answer(
          query,
          workstation(`OK-${query.address.slice(-1)}`),
        );
      }
    };

    const resolution: NetbiosNameResolution = await resolverFor(
      setup,
    ).resolveNames(["10.0.0.1", "10.0.0.2", "10.0.0.3"]);

    expect(resolution).toEqual({
      nameByIpAddress: new Map<string, string>([
        ["10.0.0.1", "ok-1"],
        ["10.0.0.2", "ok-2"],
      ]),
      queriedCount: 3,
      skippedCount: 0,
      isTimeBudgetExhausted: false,
      isHostCapReached: false,
      eligibleCount: 3,
      maxHosts: DEFAULT_NETBIOS_MAX_HOSTS,
      totalBudgetInMs: DEFAULT_NETBIOS_TOTAL_BUDGET_IN_MS,
      failureReason: undefined,
    });
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
