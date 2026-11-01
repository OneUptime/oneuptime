import "../../../TestingUtils/DiscoveryEnvironment";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import MonitorStepSnmpMonitor from "Common/Types/Monitor/MonitorStepSnmpMonitor";
import SnmpHardwareIdentity from "Common/Types/Monitor/SnmpMonitor/SnmpHardwareIdentity";
import SnmpVersion from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";
import SnmpMonitor from "../../../../Utils/Monitors/MonitorTypes/SnmpMonitor";

/*
 * What a discovery scan asks a host that answered it, read off a scripted
 * session: which requests go out, in which order, and what is left when a
 * device stops answering part-way. SnmpHardwareIdentityEndToEnd.test.ts reads a
 * real agent over a real socket.
 *
 * The device's objects are scripted by instance OID, so a table is only ever
 * what a walk of its column finds there. The scripted session answers the way
 * net-snmp does: a walk is a page of rows per GETBULK, and a request that
 * fails to get an answer times out, unless the device `hangs`, when only
 * closing the session ends it.
 */

const SCAN_TIMEOUT_IN_MS: number = 2000;
const BUDGET_IN_MS: number = 5000;

const IF_TYPE: string = "1.3.6.1.2.1.2.2.1.3";
const IF_PHYS_ADDRESS: string = "1.3.6.1.2.1.2.2.1.6";

const ENTITY_MIB: string = "1.3.6.1.2.1.47";
const ENT_CLASS: string = "1.3.6.1.2.1.47.1.1.1.1.5";
const ENT_FIRMWARE: string = "1.3.6.1.2.1.47.1.1.1.1.9";
const ENT_SOFTWARE: string = "1.3.6.1.2.1.47.1.1.1.1.10";
const ENT_SERIAL: string = "1.3.6.1.2.1.47.1.1.1.1.11";
const ENT_MODEL: string = "1.3.6.1.2.1.47.1.1.1.1.13";

const CLASS_CHASSIS: number = 3;
const CLASS_MODULE: number = 9;

const ETHERNET: number = 6;
const SOFTWARE_LOOPBACK: number = 24;
const RADIO: number = 71;

const FORTIGATE_SYS_OBJECT_ID: string = "1.3.6.1.4.1.12356.101.1.60";
const FN_SYS_SERIAL: string = "1.3.6.1.4.1.12356.100.1.1.1.0";
const FG_SYS_VERSION: string = "1.3.6.1.4.1.12356.101.4.1.1.0";

const MIKROTIK_SYS_OBJECT_ID: string = "1.3.6.1.4.1.14988.1";
const MTXR_SERIAL: string = "1.3.6.1.4.1.14988.1.1.7.3.0";

const MERAKI_SYS_OBJECT_ID: string = "1.3.6.1.4.1.29671.2.111";
const CISCO_SYS_OBJECT_ID: string = "1.3.6.1.4.1.9.1.1208";

interface FakeDevice {
  objects: Map<string, unknown>;
  // OID prefixes it fails to respond to.
  silentUnder: Array<string>;
  // A silent request is never given up on: only closing the session ends it.
  hangs: boolean;
}

interface FakeRequest {
  kind: "getBulk" | "get";
  oids: Array<string>;
}

interface FakeWorld {
  device: FakeDevice;
  requests: Array<FakeRequest>;
  closes: number;
  opened: number;
  // Requests left waiting, failed the moment the session closes.
  pending: Array<(error: Error) => void>;
}

const world: FakeWorld = {
  device: { objects: new Map(), silentUnder: [], hangs: false },
  requests: [],
  closes: 0,
  opened: 0,
  pending: [],
};

function compareOids(left: string, right: string): number {
  const leftParts: Array<number> = left.split(".").map(Number);
  const rightParts: Array<number> = right.split(".").map(Number);

  for (
    let index: number = 0;
    index < Math.min(leftParts.length, rightParts.length);
    index++
  ) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index]! - rightParts[index]!;
    }
  }

  return leftParts.length - rightParts.length;
}

function isSilent(oid: string): boolean {
  return world.device.silentUnder.some((prefix: string): boolean => {
    return oid === prefix || oid.startsWith(`${prefix}.`);
  });
}

function failToRespond(fail: (error: Error) => void): void {
  let settled: boolean = false;

  const settle: (error: Error) => void = (error: Error): void => {
    if (!settled) {
      settled = true;
      fail(error);
    }
  };

  world.pending.push(settle);

  if (!world.device.hangs) {
    setTimeout(() => {
      settle(new Error("Request timed out"));
    }, SCAN_TIMEOUT_IN_MS);
  }
}

jest.mock("net-snmp", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "net-snmp",
  ) as Record<string, unknown>;

  const makeSession: () => Record<string, unknown> = () => {
    world.opened++;

    return {
      on: jest.fn(),
      close: (): void => {
        world.closes++;

        for (const fail of world.pending.splice(0)) {
          fail(new Error("Socket forcibly closed"));
        }
      },
      get: (
        oids: Array<string>,
        callback: (
          error: Error | null,
          varbinds?: Array<unknown> | undefined,
        ) => void,
      ): void => {
        world.requests.push({ kind: "get", oids: oids });

        if (oids.some(isSilent)) {
          failToRespond(callback);
          return;
        }

        const noSuchInstance: number = (
          actual["ObjectType"] as Record<string, number>
        )["NoSuchInstance"]!;

        callback(
          null,
          oids.map((oid: string) => {
            return world.device.objects.has(oid)
              ? { oid: oid, type: 4, value: world.device.objects.get(oid) }
              : { oid: oid, type: noSuchInstance, value: null };
          }),
        );
      },
      subtree: (
        oid: string,
        maxRepetitions: number,
        feedCb: (varbinds: Array<unknown>) => boolean,
        doneCb: (error: Error | null) => void,
      ): void => {
        const instances: Array<string> = Array.from(world.device.objects.keys())
          .filter((instance: string): boolean => {
            return instance.startsWith(`${oid}.`);
          })
          .sort(compareOids);

        for (
          let offset: number = 0;
          offset === 0 || offset < instances.length;
          offset += maxRepetitions
        ) {
          world.requests.push({ kind: "getBulk", oids: [oid] });

          if (isSilent(oid)) {
            failToRespond(doneCb);
            return;
          }

          const page: Array<string> = instances.slice(
            offset,
            offset + maxRepetitions,
          );

          const isDone: boolean =
            page.length > 0 &&
            feedCb(
              page.map((instance: string) => {
                return {
                  oid: instance,
                  type: 4,
                  value: world.device.objects.get(instance),
                };
              }),
            );

          if (isDone) {
            break;
          }
        }

        doneCb(null);
      },
    };
  };

  return {
    ...actual,
    createSession: jest.fn(makeSession),
    createV3Session: jest.fn(makeSession),
  };
});

function macBuffer(mac: string): Buffer {
  return Buffer.from(mac.split(":").join(""), "hex");
}

interface PortRow {
  index: number;
  type: number;
  mac?: string | undefined;
}

function addPorts(ports: Array<PortRow>): void {
  for (const port of ports) {
    world.device.objects.set(`${IF_TYPE}.${port.index}`, port.type);
    world.device.objects.set(
      `${IF_PHYS_ADDRESS}.${port.index}`,
      port.mac ? macBuffer(port.mac) : Buffer.alloc(0),
    );
  }
}

function addEntityRow(
  index: number,
  physicalClass: number,
  cells: {
    model?: string | undefined;
    serial?: string | undefined;
    firmware?: string | undefined;
    software?: string | undefined;
  } = {},
): void {
  world.device.objects.set(`${ENT_CLASS}.${index}`, physicalClass);

  const columns: Array<[string, string | undefined]> = [
    [ENT_MODEL, cells.model],
    [ENT_SERIAL, cells.serial],
    [ENT_FIRMWARE, cells.firmware],
    [ENT_SOFTWARE, cells.software],
  ];

  for (const [column, value] of columns) {
    if (value) {
      world.device.objects.set(`${column}.${index}`, Buffer.from(value));
    }
  }
}

function config(
  overrides: Partial<MonitorStepSnmpMonitor> = {},
): MonitorStepSnmpMonitor {
  return {
    snmpVersion: SnmpVersion.V2c,
    hostname: "10.244.102.11",
    port: 161,
    communityString: "public",
    oids: [],
    timeout: SCAN_TIMEOUT_IN_MS,
    retries: 0,
    ...overrides,
  } as MonitorStepSnmpMonitor;
}

function walkedColumns(): Array<string> {
  return world.requests
    .filter((request: FakeRequest): boolean => {
      return request.kind === "getBulk";
    })
    .map((request: FakeRequest): string => {
      return request.oids[0]!;
    });
}

function gets(): Array<Array<string>> {
  return world.requests
    .filter((request: FakeRequest): boolean => {
      return request.kind === "get";
    })
    .map((request: FakeRequest): Array<string> => {
      return request.oids;
    });
}

/*
 * Moves the fake clock and lets what that settled run. This package's Jest has
 * no advanceTimersByTimeAsync.
 */
async function advance(milliseconds: number): Promise<void> {
  jest.advanceTimersByTime(milliseconds);

  for (let turn: number = 0; turn < 50; turn++) {
    await Promise.resolve();
  }
}

// Reads a device, letting scripted timeouts fire until the read settles.
async function read(
  sysObjectId: string | undefined,
  signal?: AbortSignal,
): Promise<{ identity: SnmpHardwareIdentity; tookInMs: number }> {
  const startedAt: number = Date.now();
  let settled: boolean = false;
  let identity: SnmpHardwareIdentity = {};

  const reading: Promise<void> = SnmpMonitor.probeHardwareIdentity(
    config(),
    sysObjectId,
    signal,
  ).then((result: SnmpHardwareIdentity) => {
    identity = result;
    settled = true;
  });

  for (let tick: number = 0; tick < 100 && !settled; tick++) {
    await advance(100);
  }

  await reading;

  return { identity: identity, tookInMs: Date.now() - startedAt };
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["performance"] });
  world.device = { objects: new Map(), silentUnder: [], hangs: false };
  world.requests = [];
  world.closes = 0;
  world.opened = 0;
  world.pending = [];
});

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

describe("what a device that answers tells a scan", () => {
  test("a switch: its first Ethernet port, and ENTITY-MIB's chassis row", async () => {
    addPorts([
      { index: 1, type: SOFTWARE_LOOPBACK },
      { index: 2, type: ETHERNET, mac: "00:1b:54:c2:7a:01" },
      { index: 3, type: ETHERNET, mac: "00:1b:54:c2:7a:02" },
    ]);
    addEntityRow(1, CLASS_CHASSIS, {
      model: "WS-C2960X-48TS-L",
      serial: "FOC1932X0K1",
      firmware: "15.2(7r)E",
      software: "15.2(7)E2",
    });

    const { identity } = await read(CISCO_SYS_OBJECT_ID);

    expect(identity).toEqual({
      scannedMacAddress: "00:1b:54:c2:7a:01",
      model: "WS-C2960X-48TS-L",
      serialNumber: "FOC1932X0K1",
      firmwareVersion: "15.2(7r)E",
      softwareVersion: "15.2(7)E2",
    });
  });

  test("the port is chosen by DeviceOwnMacUtil, from the row's own type and address", async () => {
    // An access point's radios hold no MAC; its wired port does.
    addPorts([
      { index: 1, type: RADIO, mac: "00:00:00:00:00:00" },
      { index: 7, type: ETHERNET, mac: "0c:8d:db:12:34:56" },
      { index: 3, type: SOFTWARE_LOOPBACK },
    ]);

    expect((await read(MERAKI_SYS_OBJECT_ID)).identity).toEqual({
      scannedMacAddress: "0c:8d:db:12:34:56",
    });
  });

  test("a stack: the chassis row, wherever in the table it is, not the first row", async () => {
    addEntityRow(10, CLASS_MODULE, { serial: "MODULE-10" });
    addEntityRow(9, CLASS_MODULE, { serial: "MODULE-9" });
    addEntityRow(1001, CLASS_CHASSIS, { serial: "CHASSIS-1001" });
    addEntityRow(1002, CLASS_CHASSIS, { serial: "CHASSIS-1002" });

    expect((await read(CISCO_SYS_OBJECT_ID)).identity).toEqual({
      serialNumber: "CHASSIS-1001",
    });
  });

  test("no chassis row: nothing, rather than the serial number of a module or an optic", async () => {
    addEntityRow(1, CLASS_MODULE, { serial: "SFP-OPTIC-1", model: "SFP-10G" });

    expect((await read(CISCO_SYS_OBJECT_ID)).identity).toEqual({});
    // And the row is not asked for.
    expect(gets()).toEqual([]);
  });

  test("a FortiGate: what ENTITY-MIB left empty, from its own MIB", async () => {
    addEntityRow(1, CLASS_CHASSIS, { serial: "FG100FTK20012345" });
    world.device.objects.set(
      FG_SYS_VERSION,
      Buffer.from("v7.2.6,build1575,230926 (GA.F)"),
    );

    const { identity } = await read(FORTIGATE_SYS_OBJECT_ID);

    expect(identity).toEqual({
      serialNumber: "FG100FTK20012345",
      firmwareVersion: "v7.2.6,build1575,230926 (GA.F)",
      softwareVersion: "7.2.6",
    });

    // The serial number ENTITY-MIB gave is not asked for again.
    expect(gets()[1]).toEqual([FG_SYS_VERSION]);
  });

  test("ENTITY-MIB's value wins over the vendor's", async () => {
    addEntityRow(1, CLASS_CHASSIS, {
      serial: "FROM-ENTITY",
      firmware: "from-entity",
    });
    world.device.objects.set(FN_SYS_SERIAL, Buffer.from("FROM-VENDOR"));

    const { identity } = await read(FORTIGATE_SYS_OBJECT_ID);

    expect(identity.serialNumber).toBe("FROM-ENTITY");
    expect(identity.firmwareVersion).toBe("from-entity");
  });

  test("a key is absent, not undefined, for what the device did not say", async () => {
    addPorts([{ index: 1, type: ETHERNET, mac: "00:1b:54:c2:7a:01" }]);
    addEntityRow(1, CLASS_CHASSIS, { serial: "FOC1932X0K1" });

    const { identity } = await read(CISCO_SYS_OBJECT_ID);

    expect(Object.keys(identity).sort()).toEqual([
      "scannedMacAddress",
      "serialNumber",
    ]);
  });
});

describe("what a sweep pays for it", () => {
  test("a device with neither table: one request a column, three in all", async () => {
    await read(CISCO_SYS_OBJECT_ID);

    expect(world.requests.length).toBe(3);
    expect(walkedColumns()).toEqual([IF_TYPE, IF_PHYS_ADDRESS, ENT_CLASS]);
  });

  test("the chassis row is one GET, not a walk of every column", async () => {
    addPorts([{ index: 1, type: ETHERNET, mac: "00:1b:54:c2:7a:01" }]);
    addEntityRow(1, CLASS_CHASSIS, { serial: "FOC1932X0K1" });

    await read(CISCO_SYS_OBJECT_ID);

    expect(walkedColumns()).toEqual([IF_TYPE, IF_PHYS_ADDRESS, ENT_CLASS]);
    expect(gets()).toEqual([
      [
        `${ENT_CLASS}.1`,
        `${ENT_MODEL}.1`,
        `${ENT_SERIAL}.1`,
        `${ENT_FIRMWARE}.1`,
        `${ENT_SOFTWARE}.1`,
      ],
    ]);
  });

  test("a host of no listed platform is never sent a vendor's OID", async () => {
    addPorts([{ index: 1, type: ETHERNET, mac: "00:1b:54:c2:7a:01" }]);

    await read(MERAKI_SYS_OBJECT_ID);
    await read(undefined);

    expect(gets()).toEqual([]);
  });

  test("a chassis with a thousand ports and modules: two requests a column at most", async () => {
    const ports: Array<PortRow> = [];

    for (let index: number = 1; index <= 1000; index++) {
      ports.push({
        index: index,
        type: ETHERNET,
        mac: `00:1b:54:c2:${(index >> 8).toString(16).padStart(2, "0")}:${(
          index & 0xff
        )
          .toString(16)
          .padStart(2, "0")}`,
      });
      addEntityRow(index + 1, CLASS_MODULE);
    }

    addPorts(ports);
    addEntityRow(1, CLASS_CHASSIS, { serial: "CHASSIS-1" });

    const { identity } = await read(CISCO_SYS_OBJECT_ID);

    expect(identity).toEqual({
      scannedMacAddress: "00:1b:54:c2:00:01",
      serialNumber: "CHASSIS-1",
    });
    expect(walkedColumns()).toEqual([
      IF_TYPE,
      IF_TYPE,
      IF_PHYS_ADDRESS,
      IF_PHYS_ADDRESS,
      ENT_CLASS,
      ENT_CLASS,
    ]);
  });

  test("one session, closed when the read ends", async () => {
    await read(CISCO_SYS_OBJECT_ID);

    expect(world.opened).toBe(1);
    expect(world.closes).toBe(1);
  });
});

describe("a device that stops answering", () => {
  test("a Meraki device, silent about ENTITY-MIB, keeps the MAC it gave and costs one timeout", async () => {
    addPorts([{ index: 1, type: ETHERNET, mac: "0c:8d:db:12:34:56" }]);
    world.device.silentUnder = [ENTITY_MIB];

    const { identity, tookInMs } = await read(MERAKI_SYS_OBJECT_ID);

    expect(identity).toEqual({ scannedMacAddress: "0c:8d:db:12:34:56" });
    expect(tookInMs).toBeLessThan(SCAN_TIMEOUT_IN_MS + 500);
    expect(world.closes).toBe(1);
  });

  test("a part that fails loses only its own values: the next is still asked", async () => {
    world.device.silentUnder = [IF_TYPE, ENTITY_MIB];
    world.device.objects.set(MTXR_SERIAL, Buffer.from("8F2C0A7E12B3"));

    const { identity } = await read(MIKROTIK_SYS_OBJECT_ID);

    expect(identity).toEqual({ serialNumber: "8F2C0A7E12B3" });
  });

  test("a host that goes silent resolves empty, it does not throw", async () => {
    world.device.silentUnder = ["1.3"];

    const { identity, tookInMs } = await read(CISCO_SYS_OBJECT_ID);

    expect(identity).toEqual({});
    expect(tookInMs).toBeLessThanOrEqual(BUDGET_IN_MS);
  });

  test("silence on every part of a listed platform is cut off at the budget", async () => {
    world.device.silentUnder = ["1.3"];

    const { identity, tookInMs } = await read(FORTIGATE_SYS_OBJECT_ID);

    expect(identity).toEqual({});
    expect(tookInMs).toBeLessThanOrEqual(BUDGET_IN_MS + 100);
    expect(tookInMs).toBeGreaterThanOrEqual(BUDGET_IN_MS - 1000);
    expect(world.closes).toBe(1);
  });

  test("a request that never ends cannot outlast the budget, and what was read is kept", async () => {
    addPorts([{ index: 1, type: ETHERNET, mac: "00:1b:54:c2:7a:01" }]);
    addEntityRow(1, CLASS_CHASSIS, { serial: "FOC1932X0K1" });
    world.device.silentUnder = [ENT_SERIAL, FN_SYS_SERIAL];
    world.device.hangs = true;

    const { identity, tookInMs } = await read(CISCO_SYS_OBJECT_ID);

    expect(identity).toEqual({ scannedMacAddress: "00:1b:54:c2:7a:01" });
    expect(tookInMs).toBeLessThanOrEqual(BUDGET_IN_MS + 100);
    expect(tookInMs).toBeGreaterThanOrEqual(BUDGET_IN_MS - 100);
    expect(world.closes).toBe(1);
  });

  test("a vendor's MIB that never answers cannot lose what ENTITY-MIB said", async () => {
    addPorts([{ index: 1, type: ETHERNET, mac: "70:4c:a5:12:34:56" }]);
    addEntityRow(1, CLASS_CHASSIS, { serial: "FG100FTK20012345" });
    world.device.silentUnder = [FG_SYS_VERSION];
    world.device.hangs = true;

    const { identity, tookInMs } = await read(FORTIGATE_SYS_OBJECT_ID);

    expect(identity).toEqual({
      scannedMacAddress: "70:4c:a5:12:34:56",
      serialNumber: "FG100FTK20012345",
    });
    expect(tookInMs).toBeLessThanOrEqual(BUDGET_IN_MS + 100);
  });

  test("a request that fails after the budget ran out changes nothing", async () => {
    addPorts([{ index: 1, type: ETHERNET, mac: "00:1b:54:c2:7a:01" }]);
    world.device.silentUnder = [ENTITY_MIB];
    world.device.hangs = true;

    const { identity } = await read(CISCO_SYS_OBJECT_ID);
    const requestsAtTheEnd: number = world.requests.length;

    await advance(60000);

    expect(identity).toEqual({ scannedMacAddress: "00:1b:54:c2:7a:01" });
    expect(world.pending).toEqual([]);
    // The session closed, so nothing is left to send a further request on.
    expect(world.requests.length).toBeLessThanOrEqual(requestsAtTheEnd);
  });

  test("a session that cannot be opened is nothing read, not a failure", async () => {
    const identity: SnmpHardwareIdentity =
      await SnmpMonitor.probeHardwareIdentity(
        config({ snmpVersion: SnmpVersion.V3 }),
        CISCO_SYS_OBJECT_ID,
      );

    expect(identity).toEqual({});
    expect(world.opened).toBe(0);
  });
});

describe("the scan's abort", () => {
  test("an abort that has already happened opens no session", async () => {
    const controller: AbortController = new AbortController();
    const reason: Error = new Error("sweep deadline");
    controller.abort(reason);

    await expect(
      SnmpMonitor.probeHardwareIdentity(
        config(),
        CISCO_SYS_OBJECT_ID,
        controller.signal,
      ),
    ).rejects.toBe(reason);

    expect(world.opened).toBe(0);
    expect(world.requests).toEqual([]);
  });

  test("an abort during the read rejects with its reason at once, and closes the session", async () => {
    world.device.silentUnder = ["1.3"];
    world.device.hangs = true;

    const controller: AbortController = new AbortController();
    const reason: Error = new Error("sweep deadline");
    const reading: Promise<SnmpHardwareIdentity> =
      SnmpMonitor.probeHardwareIdentity(
        config(),
        CISCO_SYS_OBJECT_ID,
        controller.signal,
      );

    await advance(100);
    expect(world.closes).toBe(0);

    controller.abort(reason);

    await expect(reading).rejects.toBe(reason);
    expect(world.closes).toBe(1);
  });

  test("an abort racing a failing request is still the abort", async () => {
    world.device.silentUnder = ["1.3"];

    const controller: AbortController = new AbortController();
    const reason: Error = new Error("sweep deadline");
    const reading: Promise<SnmpHardwareIdentity> =
      SnmpMonitor.probeHardwareIdentity(
        config(),
        CISCO_SYS_OBJECT_ID,
        controller.signal,
      );
    const settled: Promise<unknown> = expect(reading).rejects.toBe(reason);

    await advance(SCAN_TIMEOUT_IN_MS - 1);
    controller.abort(reason);

    await settled;
  });

  test("a read that finishes leaves no listener on the scan's signal", async () => {
    const controller: AbortController = new AbortController();
    const added: ReturnType<typeof jest.spyOn> = jest.spyOn(
      EventTarget.prototype,
      "addEventListener",
    );
    const removed: ReturnType<typeof jest.spyOn> = jest.spyOn(
      EventTarget.prototype,
      "removeEventListener",
    );

    await read(CISCO_SYS_OBJECT_ID, controller.signal);

    const abortListeners: (spy: ReturnType<typeof jest.spyOn>) => number = (
      spy: ReturnType<typeof jest.spyOn>,
    ): number => {
      return spy.mock.calls.filter((call: Array<unknown>): boolean => {
        return call[0] === "abort";
      }).length;
    };

    const addedCount: number = abortListeners(added);
    const removedCount: number = abortListeners(removed);

    added.mockRestore();
    removed.mockRestore();

    expect(addedCount).toBeGreaterThan(0);
    expect(removedCount).toBe(addedCount);
  });
});

describe("the varbinds it reads", () => {
  test("a text cell the agent lacks (noSuchInstance) is left out, not read as text", async () => {
    addEntityRow(1, CLASS_CHASSIS, { model: "C9300-24T" });

    const { identity } = await read(CISCO_SYS_OBJECT_ID);

    expect(identity).toEqual({ model: "C9300-24T" });
  });
});
