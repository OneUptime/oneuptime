import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import MonitorService from "../../../../Server/Services/MonitorService";
import IncomingRequestSecretActivity from "../../../../Server/Utils/Monitor/IncomingRequestSecretActivity";
import { IncomingRequestSecretProblem } from "../../../../Types/Monitor/IncomingMonitor/IncomingRequestSecret";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A monitor's record of whether its requests send one of the project's
 * incoming request secrets (issue #8498): when a request with one last came,
 * and when one without a valid one last came, and why.
 *
 * What matters:
 *   - each is a hook-free stamp on the monitor that leaves updatedAt alone:
 *     a request is not an edit;
 *   - at most once per monitor every five minutes for each of the two, across
 *     every pod (a Redis key set only if it is not there), so a sender calling
 *     every second - or a stranger hammering a URL - costs one UPDATE in five
 *     minutes;
 *   - a malformed monitor id records nothing;
 *   - it never throws: it is bookkeeping, and must not fail a request or a
 *     job.
 *
 * Redis is a map that can be made to fail; the monitor update is a stub.
 */

jest.mock("../../../../Server/Utils/Logger");

const MONITOR_ID: string = "b0b0b0b0-0000-4000-8000-0000000000b0";
const OTHER_MONITOR_ID: string = "b0b0b0b0-0000-4000-8000-0000000000b1";

let redis: Map<string, string>;
let redisFails: boolean;
let expiries: Array<number | undefined>;

let setStringIfNotExists: jest.SpiedFunction<
  typeof GlobalCache.setStringIfNotExists
>;
let updateMonitor: jest.SpiedFunction<
  typeof MonitorService.updateColumnsByIdWithoutHooks
>;

type UpdateCall = Parameters<
  typeof MonitorService.updateColumnsByIdWithoutHooks
>[0];

const updates: () => Array<UpdateCall> = (): Array<UpdateCall> => {
  return updateMonitor.mock.calls.map((call: [UpdateCall]): UpdateCall => {
    return call[0];
  });
};

beforeEach(() => {
  redis = new Map<string, string>();
  redisFails = false;
  expiries = [];

  setStringIfNotExists = jest
    .spyOn(GlobalCache, "setStringIfNotExists")
    .mockImplementation(
      async (
        namespace: string,
        key: string,
        value: string,
        options?: { expiresInSeconds?: number | undefined },
      ) => {
        if (redisFails) {
          throw new Error("Redis is down");
        }

        const name: string = `${namespace}-${key}`;

        if (redis.has(name)) {
          return false;
        }

        expiries.push(options?.expiresInSeconds);
        redis.set(name, value);
        return true;
      },
    );

  updateMonitor = jest
    .spyOn(MonitorService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("IncomingRequestSecretActivity.record", () => {
  test("stamps when a request with a valid secret last came, and nothing else", async () => {
    await IncomingRequestSecretActivity.record({
      monitorId: new ObjectID(MONITOR_ID),
      sentValidSecret: true,
    });

    expect(updates()).toHaveLength(1);

    const update: UpdateCall = updates()[0]!;

    expect(update.id.toString()).toBe(MONITOR_ID);
    expect(Object.keys(update.data)).toEqual(["incomingRequestWithSecretAt"]);
    expect(update.data.incomingRequestWithSecretAt).toBeInstanceOf(Date);
  });

  test("stamps when a request without one last came, and why", async () => {
    await IncomingRequestSecretActivity.record({
      monitorId: MONITOR_ID,
      sentValidSecret: false,
      problem: IncomingRequestSecretProblem.WrongSecret,
    });

    const update: UpdateCall = updates()[0]!;

    expect(Object.keys(update.data).sort()).toEqual([
      "incomingRequestWithoutSecretAt",
      "incomingRequestWithoutSecretReason",
    ]);
    expect(update.data.incomingRequestWithoutSecretAt).toBeInstanceOf(Date);
    expect(update.data.incomingRequestWithoutSecretReason).toBe(
      IncomingRequestSecretProblem.WrongSecret,
    );
  });

  test("a request without one, with no reason given, sent none", async () => {
    await IncomingRequestSecretActivity.record({
      monitorId: MONITOR_ID,
      sentValidSecret: false,
    });

    expect(updates()[0]!.data.incomingRequestWithoutSecretReason).toBe(
      IncomingRequestSecretProblem.NoSecret,
    );
  });

  test("is a stamp, not an edit: no hooks, and updatedAt left alone", async () => {
    await IncomingRequestSecretActivity.record({
      monitorId: MONITOR_ID,
      sentValidSecret: true,
    });

    expect(updates()[0]!.skipUpdateDateColumn).toBe(true);
  });

  test("stamps at most once per monitor every five minutes", async () => {
    for (let call: number = 0; call < 5; call++) {
      await IncomingRequestSecretActivity.record({
        monitorId: MONITOR_ID,
        sentValidSecret: false,
        problem: IncomingRequestSecretProblem.NoSecret,
      });
    }

    expect(updates()).toHaveLength(1);
    expect(expiries).toEqual([IncomingRequestSecretActivity.EVERY_SECONDS]);
    expect(IncomingRequestSecretActivity.EVERY_SECONDS).toBe(5 * 60);
  });

  test("keeps a window for each of the two, so a fixed sender shows as soon as it sends the secret", async () => {
    await IncomingRequestSecretActivity.record({
      monitorId: MONITOR_ID,
      sentValidSecret: false,
    });
    await IncomingRequestSecretActivity.record({
      monitorId: MONITOR_ID,
      sentValidSecret: true,
    });

    expect(updates()).toHaveLength(2);
    expect(Object.keys(updates()[1]!.data)).toEqual([
      "incomingRequestWithSecretAt",
    ]);
  });

  test("keeps a window for each monitor", async () => {
    await IncomingRequestSecretActivity.record({
      monitorId: MONITOR_ID,
      sentValidSecret: false,
    });
    await IncomingRequestSecretActivity.record({
      monitorId: OTHER_MONITOR_ID,
      sentValidSecret: false,
    });

    expect(
      updates().map((update: UpdateCall): string => {
        return update.id.toString();
      }),
    ).toEqual([MONITOR_ID, OTHER_MONITOR_ID]);
  });

  test("keys its windows under a namespace of its own, by kind and monitor", async () => {
    await IncomingRequestSecretActivity.record({
      monitorId: MONITOR_ID,
      sentValidSecret: false,
    });
    await IncomingRequestSecretActivity.record({
      monitorId: MONITOR_ID,
      sentValidSecret: true,
    });

    expect(
      setStringIfNotExists.mock.calls.map(
        (call: Parameters<typeof GlobalCache.setStringIfNotExists>): string => {
          return `${call[0]}/${call[1]}`;
        },
      ),
    ).toEqual([
      `${IncomingRequestSecretActivity.NAMESPACE}/without-${MONITOR_ID}`,
      `${IncomingRequestSecretActivity.NAMESPACE}/with-${MONITOR_ID}`,
    ]);
  });

  test("records nothing for a missing or malformed monitor id", async () => {
    for (const monitorId of [undefined, null, "", "not-a-monitor"]) {
      await IncomingRequestSecretActivity.record({
        monitorId: monitorId,
        sentValidSecret: false,
      });
    }

    expect(setStringIfNotExists).not.toHaveBeenCalled();
    expect(updateMonitor).not.toHaveBeenCalled();
  });

  test("never throws when Redis fails, and then stamps nothing", async () => {
    redisFails = true;

    await expect(
      IncomingRequestSecretActivity.record({
        monitorId: MONITOR_ID,
        sentValidSecret: false,
      }),
    ).resolves.toBeUndefined();

    expect(updateMonitor).not.toHaveBeenCalled();
  });

  test("never throws when the stamp fails", async () => {
    updateMonitor.mockRejectedValueOnce(new Error("Postgres is down"));

    await expect(
      IncomingRequestSecretActivity.record({
        monitorId: MONITOR_ID,
        sentValidSecret: true,
      }),
    ).resolves.toBeUndefined();
  });
});
