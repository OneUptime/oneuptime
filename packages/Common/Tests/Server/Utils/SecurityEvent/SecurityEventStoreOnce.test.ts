import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock } from "jest-mock";
import Semaphore, {
  SemaphoreMutex,
} from "../../../../Server/Infrastructure/Semaphore";
import logger from "../../../../Server/Utils/Logger";
import SecurityEventDedupe from "../../../../Server/Utils/SecurityEvent/SecurityEventDedupe";
import SecurityEventStoreOnce, {
  SECURITY_EVENT_PRODUCT_LOCK_NAMESPACE,
  SHARED_RECORD_PRODUCT_NAMES,
  SharedRecordGroup,
} from "../../../../Server/Utils/SecurityEvent/SecurityEventStoreOnce";
import ObjectID from "../../../../Types/ObjectID";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import { getJestSpyOn } from "../../../Spy";

/*
 * Records more than one way brings in are stored once: a Microsoft Entra ID
 * record its connection reads from Graph and Your logs reads from Azure's
 * export, and an AWS CloudTrail, Google Cloud or Azure Activity Log audit
 * record Your logs reads from the logs and Cloud audit logs reads from the
 * cloud account. Whichever way stores a record second looks its id up
 * first and skips it, under the product's lock every way takes around its
 * look-up and its insert. Valkey and ClickHouse are stood in for: a lock
 * that really excludes, and a table the look-up reads.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5e0a1e55-0000-4000-8000-0000000000a1",
);

afterEach(() => {
  jest.restoreAllMocks();
});

function event(
  overrides: Partial<NormalizedSecurityEvent> = {},
): NormalizedSecurityEvent {
  return {
    time: new Date("2026-10-30T10:00:00.000Z"),
    eventUid: "entra:signin:66ea54eb",
    categoryUid: 3,
    categoryName: "Identity & Access Management",
    classUid: 3002,
    className: "Authentication",
    activityName: "Logon",
    severityId: 2,
    severityName: OcsfSeverity.Low,
    statusName: "Failure",
    message: "Failed sign-in",
    vendorName: "Microsoft",
    productName: "Microsoft Entra ID",
    ruleId: "",
    ruleName: "",
    mitreTactics: [],
    mitreTechniques: [],
    principalUser: "alice@contoso.example",
    principalHost: "",
    principalIp: "203.0.113.7",
    principalProcess: "",
    processName: "",
    processPath: "",
    processCommandLine: "",
    parentProcessName: "",
    parentProcessPath: "",
    parentProcessCommandLine: "",
    targetUser: "",
    targetHost: "",
    targetIp: "",
    targetPort: 0,
    targetResource: "",
    observables: [],
    attributes: {},
    ...overrides,
  };
}

/*
 * Valkey's lock, as the store sees it: one holder per key at a time, the
 * rest waiting their turn.
 */
function installLock(): {
  taken: Array<{ namespace: string; key: string }>;
  released: number;
} {
  const tails: Map<string, Promise<void>> = new Map();
  const state: {
    taken: Array<{ namespace: string; key: string }>;
    released: number;
  } = { taken: [], released: 0 };
  const releases: WeakMap<Record<string, unknown>, () => void> = new WeakMap();

  getJestSpyOn(Semaphore, "lock").mockImplementation((async (data: {
    namespace: string;
    key: string;
  }) => {
    const id: string = `${data.namespace}|${data.key}`;
    const previous: Promise<void> = tails.get(id) || Promise.resolve();
    let release: () => void = (): void => {};
    const held: Promise<void> = new Promise<void>((resolve: () => void) => {
      release = resolve;
    });

    tails.set(
      id,
      previous.then(() => {
        return held;
      }),
    );
    await previous;
    state.taken.push({ namespace: data.namespace, key: data.key });

    const mutex: Record<string, unknown> = {};
    releases.set(mutex, release);
    return mutex;
  }) as never);
  getJestSpyOn(Semaphore, "release").mockImplementation((async (
    mutex: SemaphoreMutex,
  ) => {
    state.released++;
    releases.get(mutex as unknown as Record<string, unknown>)?.();
  }) as never);

  return state;
}

// ClickHouse's SecurityEvent table, as the dedupe reads it.
function installTable(): Array<NormalizedSecurityEvent> {
  const table: Array<NormalizedSecurityEvent> = [];

  getJestSpyOn(SecurityEventDedupe, "findExistingEventUids").mockImplementation(
    (async (data: {
      vendorName: string;
      productName: string;
      ids: Array<string>;
    }) => {
      // A read takes a moment, so two ways reading at once both see the table as it was.
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 5);
      });

      return new Set(
        table
          .filter((stored: NormalizedSecurityEvent): boolean => {
            return (
              stored.vendorName === data.vendorName &&
              stored.productName === data.productName &&
              data.ids.includes(stored.eventUid)
            );
          })
          .map((stored: NormalizedSecurityEvent): string => {
            return stored.eventUid;
          }),
      );
    }) as never,
  );

  return table;
}

function group(events: Array<NormalizedSecurityEvent>): SharedRecordGroup {
  return {
    vendorName: events[0]!.vendorName,
    productName: events[0]!.productName,
    events,
  };
}

describe("SecurityEventStoreOnce - which records more than one way brings in", () => {
  test("Microsoft Entra ID's and the three clouds' audit records", () => {
    expect([...SHARED_RECORD_PRODUCT_NAMES].sort()).toEqual(
      [
        "Microsoft Entra ID",
        "AWS CloudTrail",
        "Google Cloud Audit Logs",
        "Azure Activity Log",
      ].sort(),
    );
  });

  test("only a record that carries its own id at the source: an id made up from a log line is no record's", () => {
    expect(SecurityEventStoreOnce.isSharedRecord(event())).toBe(true);
    expect(
      SecurityEventStoreOnce.isSharedRecord(
        event({ eventUid: "log:0192f1a0-0000-7000-8000-000000000001" }),
      ),
    ).toBe(false);
    expect(SecurityEventStoreOnce.isSharedRecord(event({ eventUid: "" }))).toBe(
      false,
    );
    expect(
      SecurityEventStoreOnce.isSharedRecord(
        event({ productName: "PAN-OS", vendorName: "Palo Alto Networks" }),
      ),
    ).toBe(false);
    expect(
      SecurityEventStoreOnce.isSharedRecord(
        event({
          vendorName: "Amazon Web Services",
          productName: "AWS CloudTrail",
          eventUid: "cloudtrail:0f5a2c1e",
        }),
      ),
    ).toBe(true);
  });

  test("a batch is split by product - the dedupe's scope - the rest kept in order", () => {
    const signIn: NormalizedSecurityEvent = event({
      eventUid: "entra:signin:1",
    });
    const trail: NormalizedSecurityEvent = event({
      vendorName: "Amazon Web Services",
      productName: "AWS CloudTrail",
      eventUid: "cloudtrail:1",
    });
    const ssh: NormalizedSecurityEvent = event({
      vendorName: "",
      productName: "SSH",
      eventUid: "log:1",
    });
    const secondSignIn: NormalizedSecurityEvent = event({
      eventUid: "entra:signin:2",
    });
    const sudo: NormalizedSecurityEvent = event({
      vendorName: "",
      productName: "sudo",
      eventUid: "log:2",
    });

    const split: {
      shared: Array<SharedRecordGroup>;
      rest: Array<NormalizedSecurityEvent>;
    } = SecurityEventStoreOnce.split([signIn, trail, ssh, secondSignIn, sudo]);

    expect(split.rest).toEqual([ssh, sudo]);
    expect(
      split.shared.map((shared: SharedRecordGroup) => {
        return [
          shared.productName,
          shared.events.map((one: NormalizedSecurityEvent): string => {
            return one.eventUid;
          }),
        ];
      }),
    ).toEqual([
      ["Microsoft Entra ID", ["entra:signin:1", "entra:signin:2"]],
      ["AWS CloudTrail", ["cloudtrail:1"]],
    ]);
  });

  test("the lock is the product's, the same whichever way takes it: a connection's provider, or the product", () => {
    expect(
      SecurityEventStoreOnce.lockKey(PROJECT_ID, "Microsoft Entra ID"),
    ).toBe(`${PROJECT_ID.toString()}:microsoft-entra-id`);
    expect(SecurityEventStoreOnce.lockKey(PROJECT_ID, "AWS CloudTrail")).toBe(
      `${PROJECT_ID.toString()}:product:AWS CloudTrail`,
    );
  });
});

describe("SecurityEventStoreOnce.storeNew", () => {
  test("looks the group's ids up and inserts only the new ones, under the product's lock", async () => {
    const lock: {
      taken: Array<{ namespace: string; key: string }>;
      released: number;
    } = installLock();
    const table: Array<NormalizedSecurityEvent> = installTable();
    const order: Array<string> = [];

    table.push(event({ eventUid: "entra:signin:old" }));

    const stored: Array<NormalizedSecurityEvent> =
      await SecurityEventStoreOnce.storeNew({
        projectId: PROJECT_ID,
        group: group([
          event({ eventUid: "entra:signin:old" }),
          event({ eventUid: "entra:signin:new" }),
          // The same record twice in one read is one record.
          event({ eventUid: "entra:signin:new" }),
        ]),
        insert: async (events: Array<NormalizedSecurityEvent>) => {
          order.push(`insert:${events.length}`);
          table.push(...events);
        },
      });

    expect(
      stored.map((one: NormalizedSecurityEvent): string => {
        return one.eventUid;
      }),
    ).toEqual(["entra:signin:new"]);
    expect(order).toEqual(["insert:1"]);
    expect(lock.taken).toEqual([
      {
        namespace: SECURITY_EVENT_PRODUCT_LOCK_NAMESPACE,
        key: `${PROJECT_ID.toString()}:microsoft-entra-id`,
      },
    ]);
    expect(lock.released).toBe(1);
  });

  test("nothing new is nothing inserted; an empty group takes no lock", async () => {
    const lock: {
      taken: Array<{ namespace: string; key: string }>;
      released: number;
    } = installLock();
    const table: Array<NormalizedSecurityEvent> = installTable();
    // A jest-mock Mock, as @jest/globals' jest.fn makes it.
    const insert: Mock<
      (events: Array<NormalizedSecurityEvent>) => Promise<void>
    > = jest.fn(
      async (_events: Array<NormalizedSecurityEvent>): Promise<void> => {},
    );

    table.push(event());

    await expect(
      SecurityEventStoreOnce.storeNew({
        projectId: PROJECT_ID,
        group: group([event()]),
        insert,
      }),
    ).resolves.toEqual([]);
    expect(insert).not.toHaveBeenCalled();

    await expect(
      SecurityEventStoreOnce.storeNew({
        projectId: PROJECT_ID,
        group: {
          vendorName: "Microsoft",
          productName: "Microsoft Entra ID",
          events: [],
        },
        insert,
      }),
    ).resolves.toEqual([]);
    expect(lock.taken).toHaveLength(1);
  });

  test("two ways storing the same records at the same moment store each once", async () => {
    installLock();
    const table: Array<NormalizedSecurityEvent> = installTable();
    const inserted: Array<string> = [];
    const records: Array<NormalizedSecurityEvent> = [1, 2, 3].map(
      (index: number): NormalizedSecurityEvent => {
        return event({ eventUid: `entra:signin:${index}` });
      },
    );
    const insert: (
      events: Array<NormalizedSecurityEvent>,
    ) => Promise<void> = async (
      events: Array<NormalizedSecurityEvent>,
    ): Promise<void> => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 5);
      });
      table.push(...events);
      inserted.push(
        ...events.map((one: NormalizedSecurityEvent): string => {
          return one.eventUid;
        }),
      );
    };

    // Your logs reading Azure's export, and the connection reading Graph.
    const [fromLogs, fromConnection] = await Promise.all([
      SecurityEventStoreOnce.storeNew({
        projectId: PROJECT_ID,
        group: group(records),
        insert,
      }),
      SecurityEventStoreOnce.withProductLock({
        projectId: PROJECT_ID,
        productName: "Microsoft Entra ID",
        work: async (): Promise<Array<string>> => {
          const existing: Set<string> =
            await SecurityEventDedupe.findExistingEventUids({
              projectId: PROJECT_ID,
              vendorName: "Microsoft",
              productName: "Microsoft Entra ID",
              ids: records.map((one: NormalizedSecurityEvent): string => {
                return one.eventUid;
              }),
            });
          const fresh: Array<NormalizedSecurityEvent> = records.filter(
            (one: NormalizedSecurityEvent): boolean => {
              return !existing.has(one.eventUid);
            },
          );

          await insert(fresh);

          return fresh.map((one: NormalizedSecurityEvent): string => {
            return one.eventUid;
          });
        },
      }),
    ]);

    expect(inserted.sort()).toEqual([
      "entra:signin:1",
      "entra:signin:2",
      "entra:signin:3",
    ]);
    expect(fromLogs.length + fromConnection.length).toBe(3);
  });
});

describe("SecurityEventStoreOnce.withProductLock", () => {
  test("without Valkey the work still runs, looked up before it inserts, and says so", async () => {
    const warnings: Array<string> = [];

    getJestSpyOn(Semaphore, "lock").mockRejectedValue(
      new Error("Valkey is not reachable") as never,
    );
    getJestSpyOn(logger, "warn").mockImplementation(((message: string) => {
      warnings.push(message);
    }) as never);

    await expect(
      SecurityEventStoreOnce.withProductLock({
        projectId: PROJECT_ID,
        productName: "Microsoft Entra ID",
        work: async (): Promise<string> => {
          return "stored";
        },
      }),
    ).resolves.toBe("stored");
    expect(warnings[0]).toContain("without the product lock");
    expect(warnings[0]).toContain("Valkey is not reachable");
  });

  test("the lock is released when the work fails, and a release that fails is logged, never thrown", async () => {
    const lock: {
      taken: Array<{ namespace: string; key: string }>;
      released: number;
    } = installLock();

    await expect(
      SecurityEventStoreOnce.withProductLock({
        projectId: PROJECT_ID,
        productName: "AWS CloudTrail",
        work: async (): Promise<void> => {
          throw new Error("insert refused");
        },
      }),
    ).rejects.toThrow("insert refused");
    expect(lock.released).toBe(1);

    const errors: Array<string> = [];

    getJestSpyOn(Semaphore, "release").mockRejectedValue(
      new Error("lock expired") as never,
    );
    getJestSpyOn(logger, "error").mockImplementation(((message: string) => {
      errors.push(message);
    }) as never);

    await expect(
      SecurityEventStoreOnce.withProductLock({
        projectId: PROJECT_ID,
        productName: "AWS CloudTrail",
        work: async (): Promise<number> => {
          return 3;
        },
      }),
    ).resolves.toBe(3);
    expect(errors[0]).toContain("could not release the product lock");
  });
});
