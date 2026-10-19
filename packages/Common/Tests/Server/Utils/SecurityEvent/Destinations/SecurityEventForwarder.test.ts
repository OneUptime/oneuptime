import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import SecurityEventDestination from "../../../../../Models/DatabaseModels/SecurityEventDestination";
import Semaphore from "../../../../../Server/Infrastructure/Semaphore";
import SecurityEventDestinationService from "../../../../../Server/Services/SecurityEventDestinationService";
import SecurityEventService, {
  FindArrivedEventsData,
} from "../../../../../Server/Services/SecurityEventService";
import SecurityEventForwarder, {
  FORWARD_MAX_BACKLOG_IN_HOURS,
  FORWARD_MAX_EVENTS_PER_WINDOW,
  FORWARD_PAGE_SIZE,
  FORWARD_SETTLE_IN_SECONDS,
  SecurityEventForwardResult,
} from "../../../../../Server/Utils/SecurityEvent/Destinations/SecurityEventForwarder";
import {
  SecurityEventSendResult,
  SecurityEventSender,
} from "../../../../../Server/Utils/SecurityEvent/Destinations/Types";
import OneUptimeDate from "../../../../../Types/Date";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import SecurityEventDestinationProvider from "../../../../../Types/SecurityEvent/Destinations/SecurityEventDestinationProvider";
import SecurityEventDestinationScope from "../../../../../Types/SecurityEvent/Destinations/SecurityEventDestinationScope";
import { SETUP_TEST_PRODUCT_NAME } from "../../../../../Types/SecurityEvent/SecuritySetupTest";
import { SecurityEventRecord } from "../../../../../Utils/SecurityEvent/Destinations/SecurityEventRecord";
import { DESTINATION_SETTINGS } from "./GoogleSecOpsFakeEndpoint";

const NOW: Date = new Date("2026-10-19T12:00:00.000Z");
const UNTIL: Date = new Date(NOW.getTime() - FORWARD_SETTLE_IN_SECONDS * 1000);
const PROJECT_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-00000000p001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-00000000p002",
);
const DESTINATION_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-00000000d001",
);

interface StoredEvent {
  projectId: ObjectID;
  createdAt: Date;
  categoryUid: number;
  productName: string;
  eventUid: string;
}

function toClickhouse(date: Date): string {
  return date.toISOString().replace("T", " ").replace(".000Z", "");
}

/*
 * The SecurityEvent table, as findArrivedEvents reads it: by project,
 * arrival window, scope and excluded products, in arrival order, a page at
 * a time. Rows are answered the way ClickHouse answers them.
 */
function installTable(stored: Array<StoredEvent>): {
  reads: Array<FindArrivedEventsData>;
} {
  const reads: Array<FindArrivedEventsData> = [];

  jest
    .spyOn(SecurityEventService, "findArrivedEvents")
    .mockImplementation(
      async (data: FindArrivedEventsData): Promise<Array<JSONObject>> => {
        reads.push(data);

        // DateTime columns hold whole seconds, and so do the bounds.
        const after: number = Math.floor(data.arrivedAfter.getTime() / 1000);
        const until: number = Math.floor(data.arrivedUntil.getTime() / 1000);

        return stored
          .filter((event: StoredEvent): boolean => {
            const created: number = Math.floor(
              event.createdAt.getTime() / 1000,
            );

            return (
              event.projectId.toString() === data.projectId.toString() &&
              created > after &&
              created <= until &&
              (!data.findingsOnly || event.categoryUid === 2) &&
              !data.excludeProductNames.includes(event.productName)
            );
          })
          .slice(data.offset, data.offset + data.limit)
          .map((event: StoredEvent): JSONObject => {
            return {
              _id: event.eventUid,
              time: toClickhouse(event.createdAt),
              createdAt: toClickhouse(event.createdAt),
              eventUid: event.eventUid,
              categoryUid: event.categoryUid,
              productName: event.productName,
              attributes: {},
            };
          });
      },
    );

  return { reads };
}

function events(data: {
  count: number;
  startAt: Date;
  everySeconds: number;
  projectId?: ObjectID | undefined;
  categoryUid?: number | undefined;
  productName?: string | undefined;
  prefix?: string | undefined;
}): Array<StoredEvent> {
  const list: Array<StoredEvent> = [];

  for (let index: number = 0; index < data.count; index++) {
    list.push({
      projectId: data.projectId || PROJECT_ID,
      createdAt: new Date(
        data.startAt.getTime() + (index + 1) * data.everySeconds * 1000,
      ),
      categoryUid: data.categoryUid ?? 2,
      productName: data.productName || "OneUptime Detections",
      eventUid: `${data.prefix || "evt"}-${index}`,
    });
  }

  return list;
}

// A SIEM that takes what it is sent, and can be told to stop part way.
class FakeSender implements SecurityEventSender {
  public sent: Array<string> = [];
  public stopAfter: number | null = null;

  public validateSettings(): void {
    // Settings are the fake endpoint's own.
  }

  public async send(data: {
    events: Array<SecurityEventRecord>;
  }): Promise<SecurityEventSendResult> {
    const result: SecurityEventSendResult = {
      processed: 0,
      sent: 0,
      rejected: 0,
      rejectionReason: "",
      requests: 1,
      failure: "",
      failureStatus: null,
    };

    for (const event of data.events) {
      if (this.stopAfter !== null && this.sent.length >= this.stopAfter) {
        result.failure = "Google SecOps did not accept the events (HTTP 503).";
        result.failureStatus = 503;
        return result;
      }

      this.sent.push(event.eventUid);
      result.sent++;
      result.processed++;
    }

    return result;
  }

  public async sendTestEvent(): Promise<void> {
    // Not used by the forwarder.
  }
}

function destination(
  overrides: Partial<{
    cursor: string | undefined;
    sendScope: SecurityEventDestinationScope;
    lastSendResult: JSONObject | undefined;
    provider: string;
  }> = {},
): SecurityEventDestination {
  const model: SecurityEventDestination = new SecurityEventDestination();
  model.id = DESTINATION_ID;
  model.projectId = PROJECT_ID;
  model.provider = (overrides.provider ||
    SecurityEventDestinationProvider.GoogleSecOps) as SecurityEventDestinationProvider;
  model.sendScope =
    overrides.sendScope || SecurityEventDestinationScope.Detections;

  if (overrides.cursor !== undefined) {
    model.cursor = overrides.cursor;
  }

  if (overrides.lastSendResult !== undefined) {
    model.lastSendResult = overrides.lastSendResult;
  }

  return model;
}

function installService(): { updates: Array<JSONObject> } {
  const updates: Array<JSONObject> = [];

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
  jest
    .spyOn(SecurityEventDestinationService, "getSettings")
    .mockResolvedValue(DESTINATION_SETTINGS);
  jest
    .spyOn(SecurityEventDestinationService, "updateOneById")
    .mockImplementation(async (data: { data: unknown }): Promise<number> => {
      updates.push(data.data as JSONObject);
      return 1;
    });

  return { updates };
}

describe("SecurityEventForwarder.forwardDestination", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("sends what arrived since the cursor, then moves the cursor to the end of the settled window", async () => {
    const { updates } = installService();
    const startAt: Date = OneUptimeDate.addRemoveMinutes(NOW, -4);
    installTable(events({ count: 5, startAt, everySeconds: 30 }));
    const sender: FakeSender = new FakeSender();

    const result: SecurityEventForwardResult =
      await SecurityEventForwarder.forwardDestination(
        destination({ cursor: startAt.toISOString() }),
        { sender },
      );

    expect(sender.sent).toEqual(["evt-0", "evt-1", "evt-2", "evt-3", "evt-4"]);
    expect(result.sent).toBe(5);
    expect(result.windows).toBe(1);
    expect(result.failure).toBe("");
    expect(updates).toHaveLength(1);
    expect(updates[0]!["cursor"]).toBe(UNTIL.toISOString());
    expect(updates[0]!["lastSentAt"]).toEqual(NOW);
    expect(updates[0]!["lastAttemptAt"]).toEqual(NOW);
    expect(updates[0]!["lastError"]).toBeNull();
  });

  test("an event younger than the settle time waits for the next run", async () => {
    installService();
    const startAt: Date = OneUptimeDate.addRemoveMinutes(NOW, -2);
    // One arrives 10 seconds ago: inside the settle time.
    installTable([
      ...events({ count: 1, startAt, everySeconds: 30, prefix: "old" }),
      ...events({
        count: 1,
        startAt: OneUptimeDate.addRemoveSeconds(NOW, -20),
        everySeconds: 10,
        prefix: "new",
      }),
    ]);
    const sender: FakeSender = new FakeSender();

    await SecurityEventForwarder.forwardDestination(
      destination({ cursor: startAt.toISOString() }),
      { sender },
    );

    expect(sender.sent).toEqual(["old-0"]);
  });

  test("a destination behind by several windows catches up window by window, each event once", async () => {
    installService();
    const startAt: Date = OneUptimeDate.addRemoveMinutes(NOW, -40);
    installTable(events({ count: 70, startAt, everySeconds: 30 }));
    const sender: FakeSender = new FakeSender();

    const result: SecurityEventForwardResult =
      await SecurityEventForwarder.forwardDestination(
        destination({ cursor: startAt.toISOString() }),
        { sender },
      );

    expect(result.windows).toBe(8);
    expect(sender.sent).toHaveLength(new Set(sender.sent).size);
    expect(sender.sent.length).toBe(
      events({ count: 70, startAt, everySeconds: 30 }).filter(
        (event: StoredEvent): boolean => {
          return event.createdAt.getTime() <= UNTIL.getTime();
        },
      ).length,
    );
  });

  test("a destination more than a day behind skips to the last day and says so", async () => {
    const { updates } = installService();
    const { reads } = installTable([]);

    const result: SecurityEventForwardResult =
      await SecurityEventForwarder.forwardDestination(
        destination({
          cursor: OneUptimeDate.addRemoveHours(NOW, -72).toISOString(),
        }),
        { sender: new FakeSender() },
      );

    expect(result.skippedBacklog).toBe(true);
    expect(reads[0]!.arrivedAfter.toISOString()).toBe(
      OneUptimeDate.addRemoveHours(
        NOW,
        -FORWARD_MAX_BACKLOG_IN_HOURS,
      ).toISOString(),
    );
    expect(
      (updates[0]!["lastSendResult"] as JSONObject)["skippedBacklog"],
    ).toBe(true);
  });

  test("a new destination with no cursor sends from now on, never history", async () => {
    const { updates } = installService();
    const { reads } = installTable(
      events({
        count: 3,
        startAt: OneUptimeDate.addRemoveMinutes(NOW, -10),
        everySeconds: 60,
      }),
    );
    const sender: FakeSender = new FakeSender();

    await SecurityEventForwarder.forwardDestination(destination(), {
      sender,
    });

    expect(sender.sent).toEqual([]);
    expect(reads).toHaveLength(0);
    expect(updates[0]!["cursor"]).toBe(UNTIL.toISOString());
  });

  test("a send that stops part way keeps its place, and the next run goes on from the next event", async () => {
    const startAt: Date = OneUptimeDate.addRemoveMinutes(NOW, -4);
    const stored: Array<StoredEvent> = events({
      count: 6,
      startAt,
      everySeconds: 30,
    });
    const sender: FakeSender = new FakeSender();
    sender.stopAfter = 4;

    const first: { updates: Array<JSONObject> } = installService();
    installTable(stored);

    const result: SecurityEventForwardResult =
      await SecurityEventForwarder.forwardDestination(
        destination({ cursor: startAt.toISOString() }),
        { sender },
      );

    expect(result.failure).toContain("HTTP 503");
    expect(result.partialWindowStart).toBe(startAt.toISOString());
    expect(result.partialWindowProcessed).toBe(4);
    expect(first.updates[0]!["cursor"]).toBe(startAt.toISOString());
    expect(first.updates[0]!["lastError"]).toContain("HTTP 503");
    expect(first.updates[0]!["lastSentAt"]).toEqual(NOW);

    // The SIEM is back.
    jest.restoreAllMocks();
    sender.stopAfter = null;
    installService();
    const { reads } = installTable(stored);

    await SecurityEventForwarder.forwardDestination(
      destination({
        cursor: startAt.toISOString(),
        lastSendResult: first.updates[0]!["lastSendResult"] as JSONObject,
      }),
      { sender },
    );

    expect(reads[0]!.offset).toBe(4);
    expect(sender.sent).toEqual([
      "evt-0",
      "evt-1",
      "evt-2",
      "evt-3",
      "evt-4",
      "evt-5",
    ]);
  });

  test("a stopped place from another window is not reused", async () => {
    installService();
    const startAt: Date = OneUptimeDate.addRemoveMinutes(NOW, -4);
    const { reads } = installTable(
      events({ count: 2, startAt, everySeconds: 30 }),
    );

    await SecurityEventForwarder.forwardDestination(
      destination({
        cursor: startAt.toISOString(),
        lastSendResult: {
          partialWindowStart: OneUptimeDate.addRemoveMinutes(
            NOW,
            -30,
          ).toISOString(),
          partialWindowProcessed: 1,
        },
      }),
      { sender: new FakeSender() },
    );

    expect(reads[0]!.offset).toBe(0);
  });

  test("detections only, or every event, as the destination asked", async () => {
    installService();
    const startAt: Date = OneUptimeDate.addRemoveMinutes(NOW, -4);
    const stored: Array<StoredEvent> = [
      ...events({ count: 2, startAt, everySeconds: 30, prefix: "finding" }),
      ...events({
        count: 3,
        startAt,
        everySeconds: 20,
        categoryUid: 3,
        prefix: "sign-in",
      }),
    ];
    installTable(stored);

    const detectionsOnly: FakeSender = new FakeSender();
    await SecurityEventForwarder.forwardDestination(
      destination({ cursor: startAt.toISOString() }),
      { sender: detectionsOnly },
    );

    const everything: FakeSender = new FakeSender();
    await SecurityEventForwarder.forwardDestination(
      destination({
        cursor: startAt.toISOString(),
        sendScope: SecurityEventDestinationScope.AllEvents,
      }),
      { sender: everything },
    );

    expect(detectionsOnly.sent.sort()).toEqual(["finding-0", "finding-1"]);
    expect(everything.sent).toHaveLength(5);
  });

  test("never sends a SIEM its own alerts back, nor the setup test's events", async () => {
    installService();
    const startAt: Date = OneUptimeDate.addRemoveMinutes(NOW, -4);
    const { reads } = installTable([
      ...events({ count: 1, startAt, everySeconds: 30, prefix: "ours" }),
      ...events({
        count: 1,
        startAt,
        everySeconds: 40,
        productName: "Google SecOps",
        prefix: "imported",
      }),
      ...events({
        count: 1,
        startAt,
        everySeconds: 50,
        productName: SETUP_TEST_PRODUCT_NAME,
        prefix: "test",
      }),
    ]);
    const sender: FakeSender = new FakeSender();

    await SecurityEventForwarder.forwardDestination(
      destination({ cursor: startAt.toISOString() }),
      { sender },
    );

    expect(sender.sent).toEqual(["ours-0"]);
    expect(reads[0]!.excludeProductNames).toEqual([
      "Google SecOps",
      SETUP_TEST_PRODUCT_NAME,
    ]);
  });

  test("reads only the destination's own project", async () => {
    installService();
    const startAt: Date = OneUptimeDate.addRemoveMinutes(NOW, -4);
    const { reads } = installTable([
      ...events({ count: 2, startAt, everySeconds: 30, prefix: "mine" }),
      ...events({
        count: 2,
        startAt,
        everySeconds: 30,
        projectId: OTHER_PROJECT_ID,
        prefix: "theirs",
      }),
    ]);
    const sender: FakeSender = new FakeSender();

    await SecurityEventForwarder.forwardDestination(
      destination({ cursor: startAt.toISOString() }),
      { sender },
    );

    expect(sender.sent).toEqual(["mine-0", "mine-1"]);

    for (const read of reads) {
      expect(read.projectId.toString()).toBe(PROJECT_ID.toString());
    }
  });

  test("a window holding more than one run sends is cut, and says so", async () => {
    installService();
    const startAt: Date = OneUptimeDate.addRemoveMinutes(NOW, -4);
    installTable(
      events({
        count: FORWARD_MAX_EVENTS_PER_WINDOW + 50,
        // From the second after the cursor's: the cursor's own second was sent.
        startAt: OneUptimeDate.addRemoveSeconds(startAt, 1),
        everySeconds: 0.01,
      }),
    );
    const sender: FakeSender = new FakeSender();

    const result: SecurityEventForwardResult =
      await SecurityEventForwarder.forwardDestination(
        destination({ cursor: startAt.toISOString() }),
        { sender },
      );

    expect(result.truncated).toBe(true);
    expect(sender.sent).toHaveLength(FORWARD_MAX_EVENTS_PER_WINDOW);
  });

  test("pages are read FORWARD_PAGE_SIZE at a time", async () => {
    installService();
    const startAt: Date = OneUptimeDate.addRemoveMinutes(NOW, -4);
    const { reads } = installTable(
      events({ count: FORWARD_PAGE_SIZE + 10, startAt, everySeconds: 0.1 }),
    );

    await SecurityEventForwarder.forwardDestination(
      destination({ cursor: startAt.toISOString() }),
      { sender: new FakeSender() },
    );

    expect(
      reads.map((read: FindArrivedEventsData): number => {
        return read.offset;
      }),
    ).toEqual([0, FORWARD_PAGE_SIZE]);
  });

  test("an unknown provider is an error, not a silent skip", async () => {
    installService();
    installTable([]);

    await expect(
      SecurityEventForwarder.forwardDestination(
        destination({ provider: "carrier-pigeon" }),
        { sender: new FakeSender() },
      ),
    ).rejects.toThrow("carrier-pigeon");
  });
});

describe("SecurityEventForwarder.forwardAllEnabled", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("sends each enabled destination under its own lock, and records a failure on the destination", async () => {
    const { updates } = installService();
    jest
      .spyOn(SecurityEventDestinationService, "findBy")
      .mockResolvedValue([
        destination({ cursor: UNTIL.toISOString() }),
      ] as never);
    jest
      .spyOn(SecurityEventDestinationService, "getSettings")
      .mockRejectedValue(new Error("The destination no longer exists."));
    const lock: SpyInstance<typeof Semaphore.lock> = jest
      .spyOn(Semaphore, "lock")
      .mockResolvedValue({} as never);
    jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);

    await SecurityEventForwarder.forwardAllEnabled();

    expect(lock).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: "SecurityEventForward",
        key: DESTINATION_ID.toString(),
        acquireAttemptsLimit: 1,
      }),
    );
    expect(updates[0]!["lastError"]).toBe("The destination no longer exists.");
  });

  test("a destination another worker is sending is left to it", async () => {
    installService();
    jest
      .spyOn(SecurityEventDestinationService, "findBy")
      .mockResolvedValue([
        destination({ cursor: UNTIL.toISOString() }),
      ] as never);
    jest.spyOn(Semaphore, "lock").mockRejectedValue(new Error("locked"));
    const forward: SpyInstance<
      typeof SecurityEventForwarder.forwardDestination
    > = jest.spyOn(SecurityEventForwarder, "forwardDestination");

    await SecurityEventForwarder.forwardAllEnabled();

    expect(forward).not.toHaveBeenCalled();
  });
});
