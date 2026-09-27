import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import StatusPageSubscriber from "../../../../Models/DatabaseModels/StatusPageSubscriber";
import StatusPageSubscriberService from "../../../../Server/Services/StatusPageSubscriberService";
import SubscriberNotificationDeliveryRecord from "../../../../Server/Utils/StatusPage/SubscriberNotificationDeliveryRecord";
import SubscriberNotificationFanOut from "../../../../Server/Utils/StatusPage/SubscriberNotificationFanOut";
import SubscriberNotificationTiming, {
  SubscriberNotificationSendWindow,
} from "../../../../Server/Utils/StatusPage/SubscriberNotificationTiming";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import ObjectID from "../../../../Types/ObjectID";
import StatusPageSubscriberNotificationMethod from "../../../../Types/StatusPage/StatusPageSubscriberNotificationMethod";
import logger from "../../../../Server/Utils/Logger";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * How a subscriber send walks one status page's subscribers: every one of
 * them, read in batches past LIMIT_MAX; a bounded number in flight; nothing
 * started once the send window closes; and a subscriber whose messages
 * cannot be built does not stop the rest.
 */

const STATUS_PAGE_ID: string = "b0000000-0000-4000-8000-000000000003";

function statusPage(): StatusPage {
  const page: StatusPage = new StatusPage();
  page._id = STATUS_PAGE_ID;
  page.name = "Site 03";
  return page;
}

function subscriberId(index: number): string {
  return `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;
}

function subscribers(count: number): Array<StatusPageSubscriber> {
  return Array.from({ length: count }, (_v: unknown, i: number) => {
    const row: StatusPageSubscriber = new StatusPageSubscriber();
    row._id = subscriberId(i + 1);
    return row;
  });
}

// The page's subscribers, served as getSubscribersByStatusPage serves them.
let stored: Array<StatusPageSubscriber> = [];
let reads: Array<{
  afterId: string | undefined;
  limit: number | undefined;
}> = [];

function openWindow(): SubscriberNotificationSendWindow {
  return SubscriberNotificationTiming.startSendWindow();
}

beforeEach(() => {
  stored = [];
  reads = [];

  jest
    .spyOn(StatusPageSubscriberService, "getSubscribersByStatusPage")
    .mockImplementation((async (
      _statusPageId: ObjectID,
      _props: unknown,
      options?: { afterId?: ObjectID; limit?: number },
    ): Promise<Array<StatusPageSubscriber>> => {
      reads.push({
        afterId: options?.afterId?.toString(),
        limit: options?.limit,
      });

      const after: Array<StatusPageSubscriber> = options?.afterId
        ? stored.filter((row: StatusPageSubscriber): boolean => {
            return row._id! > options.afterId!.toString();
          })
        : stored;

      return after.slice(0, options?.limit ?? after.length);
    }) as never);

  jest.spyOn(logger, "error").mockImplementation((): void => {});
  jest.spyOn(logger, "debug").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SubscriberNotificationFanOut.forEachSubscriber", () => {
  test("hands every subscriber of the page to the handler, and records the page finished", async () => {
    stored = subscribers(3);
    const record: SubscriberNotificationDeliveryRecord =
      new SubscriberNotificationDeliveryRecord({ dedupeEmailAndSms: false });
    const seen: Array<string> = [];

    record.startStatusPage(statusPage());
    await SubscriberNotificationFanOut.forEachSubscriber({
      statusPage: statusPage(),
      record: record,
      sendWindow: openWindow(),
      handler: async (subscriber: StatusPageSubscriber): Promise<void> => {
        seen.push(subscriber._id!);
      },
    });

    expect(seen.sort()).toEqual([
      subscriberId(1),
      subscriberId(2),
      subscriberId(3),
    ]);
    expect(record.didStatusPageSucceed(STATUS_PAGE_ID)).toBe(true);
  });

  test("reads the page in batches of LIMIT_MAX by default, each after the last one read", async () => {
    stored = subscribers(LIMIT_MAX + 2);
    let handled: number = 0;

    await SubscriberNotificationFanOut.forEachSubscriber({
      statusPage: statusPage(),
      record: new SubscriberNotificationDeliveryRecord({
        dedupeEmailAndSms: false,
      }),
      sendWindow: openWindow(),
      handler: async (): Promise<void> => {
        handled++;
      },
    });

    expect(handled).toBe(LIMIT_MAX + 2);
    expect(reads).toEqual([
      { afterId: undefined, limit: LIMIT_MAX },
      { afterId: subscriberId(LIMIT_MAX), limit: LIMIT_MAX },
    ]);
  });

  test("a page that fills its batches exactly takes one more read to see the end", async () => {
    stored = subscribers(6);
    let handled: number = 0;

    await SubscriberNotificationFanOut.forEachSubscriber({
      statusPage: statusPage(),
      record: new SubscriberNotificationDeliveryRecord({
        dedupeEmailAndSms: false,
      }),
      sendWindow: openWindow(),
      subscribersPerRead: 3,
      handler: async (): Promise<void> => {
        handled++;
      },
    });

    expect(handled).toBe(6);
    expect(
      reads.map((read: { afterId: string | undefined }) => {
        return read.afterId;
      }),
    ).toEqual([undefined, subscriberId(3), subscriberId(6)]);
  });

  test("a page with no subscriber is read once and finished", async () => {
    const record: SubscriberNotificationDeliveryRecord =
      new SubscriberNotificationDeliveryRecord({ dedupeEmailAndSms: false });

    record.startStatusPage(statusPage());
    await SubscriberNotificationFanOut.forEachSubscriber({
      statusPage: statusPage(),
      record: record,
      sendWindow: openWindow(),
      handler: async (): Promise<void> => {},
    });

    expect(reads).toHaveLength(1);
    expect(record.didStatusPageSucceed(STATUS_PAGE_ID)).toBe(true);
  });

  test("keeps at most the concurrency in flight", async () => {
    stored = subscribers(12);
    let inFlight: number = 0;
    let most: number = 0;

    await SubscriberNotificationFanOut.forEachSubscriber({
      statusPage: statusPage(),
      record: new SubscriberNotificationDeliveryRecord({
        dedupeEmailAndSms: false,
      }),
      sendWindow: openWindow(),
      concurrency: 4,
      handler: async (): Promise<void> => {
        inFlight++;
        most = Math.max(most, inFlight);
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 1);
        });
        inFlight--;
      },
    });

    expect(most).toBe(4);
  });

  test("uses SEND_CONCURRENCY by default", async () => {
    stored = subscribers(SubscriberNotificationTiming.SEND_CONCURRENCY + 10);
    let inFlight: number = 0;
    let most: number = 0;

    await SubscriberNotificationFanOut.forEachSubscriber({
      statusPage: statusPage(),
      record: new SubscriberNotificationDeliveryRecord({
        dedupeEmailAndSms: false,
      }),
      sendWindow: openWindow(),
      handler: async (): Promise<void> => {
        inFlight++;
        most = Math.max(most, inFlight);
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 1);
        });
        inFlight--;
      },
    });

    expect(most).toBe(SubscriberNotificationTiming.SEND_CONCURRENCY);
  });

  test("starts subscribers in the order they were read, so dedupe gives an address to the first", async () => {
    stored = subscribers(10);
    const started: Array<string> = [];

    await SubscriberNotificationFanOut.forEachSubscriber({
      statusPage: statusPage(),
      record: new SubscriberNotificationDeliveryRecord({
        dedupeEmailAndSms: false,
      }),
      sendWindow: openWindow(),
      concurrency: 3,
      handler: async (subscriber: StatusPageSubscriber): Promise<void> => {
        started.push(subscriber._id!);
        await Promise.resolve();
      },
    });

    expect(started).toEqual(
      stored.map((row: StatusPageSubscriber): string => {
        return row._id!;
      }),
    );
  });

  test("starts nothing once the send window has closed, and records the page not reached in full", async () => {
    stored = subscribers(10);
    const window: SubscriberNotificationSendWindow =
      new SubscriberNotificationSendWindow(Date.now() + 60_000);
    const record: SubscriberNotificationDeliveryRecord =
      new SubscriberNotificationDeliveryRecord({ dedupeEmailAndSms: false });
    let handled: number = 0;
    let now: number = Date.now();
    jest.spyOn(Date, "now").mockImplementation((): number => {
      return now;
    });

    record.startStatusPage(statusPage());
    await SubscriberNotificationFanOut.forEachSubscriber({
      statusPage: statusPage(),
      record: record,
      sendWindow: window,
      concurrency: 2,
      handler: async (): Promise<void> => {
        handled++;
        record.recordSent({
          statusPage: statusPage(),
          method: StatusPageSubscriberNotificationMethod.Email,
        });

        if (handled === 3) {
          // The third subscriber's send takes the rest of the window.
          now += 60_000;
        }

        await Promise.resolve();
      },
    });

    // The two in flight when it closed finish; none after.
    expect(handled).toBe(3);
    expect(record.didStatusPageSucceed(STATUS_PAGE_ID)).toBe(false);
    expect(record.hasFailures()).toBe(true);
    expect(record.toMarkdown()).toContain(
      "- **Site 03**: 3 email sent. The send ran out of time part-way through this status page",
    );
  });

  test("a window already closed reads nothing and records the page not reached in full", async () => {
    stored = subscribers(3);
    const record: SubscriberNotificationDeliveryRecord =
      new SubscriberNotificationDeliveryRecord({ dedupeEmailAndSms: false });

    record.startStatusPage(statusPage());
    await SubscriberNotificationFanOut.forEachSubscriber({
      statusPage: statusPage(),
      record: record,
      sendWindow: new SubscriberNotificationSendWindow(Date.now() - 1),
      handler: async (): Promise<void> => {
        throw new Error("never called");
      },
    });

    expect(reads).toEqual([]);
    expect(record.hasFailures()).toBe(true);
  });

  test("a handler that throws does not stop the others, and the page is recorded as failed part-way", async () => {
    stored = subscribers(5);
    const record: SubscriberNotificationDeliveryRecord =
      new SubscriberNotificationDeliveryRecord({ dedupeEmailAndSms: false });
    const handled: Array<string> = [];

    record.startStatusPage(statusPage());
    await SubscriberNotificationFanOut.forEachSubscriber({
      statusPage: statusPage(),
      record: record,
      sendWindow: openWindow(),
      concurrency: 2,
      handler: async (subscriber: StatusPageSubscriber): Promise<void> => {
        if (subscriber._id === subscriberId(2)) {
          throw new Error("template could not be compiled");
        }

        handled.push(subscriber._id!);
      },
    });

    expect(handled.sort()).toEqual([
      subscriberId(1),
      subscriberId(3),
      subscriberId(4),
      subscriberId(5),
    ]);
    expect(record.didStatusPageSucceed(STATUS_PAGE_ID)).toBe(false);
    expect(record.toMarkdown()).toContain(
      "Sending to this status page failed part-way",
    );
  });

  test("a read that fails is thrown, for the job to handle like any error on that page", async () => {
    jest
      .spyOn(StatusPageSubscriberService, "getSubscribersByStatusPage")
      .mockRejectedValue(new Error("database went away") as never);

    await expect(
      SubscriberNotificationFanOut.forEachSubscriber({
        statusPage: statusPage(),
        record: new SubscriberNotificationDeliveryRecord({
          dedupeEmailAndSms: false,
        }),
        sendWindow: openWindow(),
        handler: async (): Promise<void> => {},
      }),
    ).rejects.toThrow("database went away");
  });

  test("reads as root, around the hooks", async () => {
    const read: jest.SpiedFunction<
      typeof StatusPageSubscriberService.getSubscribersByStatusPage
    > = jest.spyOn(StatusPageSubscriberService, "getSubscribersByStatusPage");

    await SubscriberNotificationFanOut.forEachSubscriber({
      statusPage: statusPage(),
      record: new SubscriberNotificationDeliveryRecord({
        dedupeEmailAndSms: false,
      }),
      sendWindow: openWindow(),
      handler: async (): Promise<void> => {},
    });

    expect(read.mock.calls[0]![0].toString()).toBe(STATUS_PAGE_ID);
    expect(read.mock.calls[0]![1]).toEqual({ isRoot: true, ignoreHooks: true });
  });
});
