import CloudConnectionScheduler, {
  CLOUD_CONNECTION_PULL_JOB,
  CLOUD_CONNECTION_PULL_JOB_TIMEOUT_MS,
} from "../../../../Server/Utils/CloudConnection/CloudConnectionScheduler";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import CloudConnection from "../../../../Models/DatabaseModels/CloudConnection";
import Queue, { QueueName } from "../../../../Server/Infrastructure/Queue";
import CloudConnectionService from "../../../../Server/Services/CloudConnectionService";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";

/*
 * When each cloud connection is read: every minute the due connections
 * (never read, or next read in the past) are claimed - their next read
 * moved one interval on, the interval the connection was saved with - and
 * queued as one job each, deduplicated per connection, with the
 * connection's id as the job's only data. `jest` is the global one.
 */

const NOW: Date = new Date("2026-10-21T15:30:10Z");
const AWS: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const AZURE: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const GCP: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");

function connection(
  id: ObjectID,
  provider: string,
  config?: JSONObject,
): CloudConnection {
  const value: CloudConnection = new CloudConnection();
  value.id = id;
  // A provider the catalog has no definition for is a case this file reads.
  value.provider = provider as CloudProvider;

  if (config) {
    value.config = config;
  }

  return value;
}

let findBy: jest.SpiedFunction<typeof CloudConnectionService.findBy>;
let updateOneById: jest.SpiedFunction<
  typeof CloudConnectionService.updateOneById
>;
let addJob: jest.SpiedFunction<typeof Queue.addJob>;

beforeEach(() => {
  findBy = jest
    .spyOn(CloudConnectionService, "findBy")
    .mockResolvedValue([
      connection(AWS, CloudProvider.AWS),
      connection(AZURE, CloudProvider.Azure, { readIntervalInMinutes: "30" }),
      connection(GCP, CloudProvider.GCP, { readIntervalInMinutes: "7" }),
    ]);
  updateOneById = jest
    .spyOn(CloudConnectionService, "updateOneById")
    .mockResolvedValue(undefined as never);
  addJob = jest.spyOn(Queue, "addJob").mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function claimedFor(id: ObjectID): Date {
  const call: Array<unknown> | undefined = updateOneById.mock.calls.find(
    (item: Array<unknown>): boolean => {
      return (item[0] as { id: ObjectID }).id.toString() === id.toString();
    },
  );
  expect(call).toBeDefined();
  return (call![0] as { data: { nextPullAt: Date } }).data.nextPullAt;
}

describe("CloudConnectionScheduler", () => {
  test("asks for enabled connections whose next read is due or was never set", async () => {
    await CloudConnectionScheduler.enqueueDueConnections(NOW);

    const request: {
      query: JSONObject;
      limit: number;
      props: JSONObject;
      select: JSONObject;
    } = findBy.mock.calls[0]![0] as never;

    expect(request.query["isEnabled"]).toBe(true);
    const operator: {
      _objectLiteralParameters: JSONObject;
      _getSql: (alias: string) => string;
    } = request.query["nextPullAt"] as never;
    const expected: { _getSql: (alias: string) => string } =
      QueryHelper.lessThanEqualToOrNull(NOW) as never;
    expect(Object.values(operator._objectLiteralParameters)).toEqual([NOW]);
    expect(operator._getSql("nextPullAt").replace(/:\w+/g, ":p")).toBe(
      expected._getSql("nextPullAt").replace(/:\w+/g, ":p"),
    );
    expect(operator._getSql("nextPullAt")).toContain("IS NULL");
    expect(request.limit).toBe(100);
    expect(request.props).toEqual({ isRoot: true });
    /*
     * The settings, for the interval - never the credentials or the pull
     * state: the job reads those itself.
     */
    expect(Object.keys(request.select).sort()).toEqual([
      "_id",
      "config",
      "provider",
    ]);
  });

  test("claims each one its own interval ahead, then queues it with its id only", async () => {
    expect(await CloudConnectionScheduler.enqueueDueConnections(NOW)).toBe(3);

    // AWS reads every 10 minutes unless saved otherwise.
    expect(claimedFor(AWS)).toEqual(new Date(NOW.getTime() + 10 * 60 * 1000));
    // A saved interval is kept.
    expect(claimedFor(AZURE)).toEqual(new Date(NOW.getTime() + 30 * 60 * 1000));
    // An interval the form never offers is the cloud's default.
    expect(claimedFor(GCP)).toEqual(new Date(NOW.getTime() + 5 * 60 * 1000));

    expect(updateOneById.mock.calls[0]![0]).toEqual({
      id: AWS,
      data: { nextPullAt: new Date(NOW.getTime() + 10 * 60 * 1000) },
      props: { isRoot: true, ignoreHooks: true },
    });

    expect(addJob).toHaveBeenCalledTimes(3);
    expect(addJob.mock.calls[0]).toEqual([
      QueueName.Worker,
      `cloud-connection-read-${AWS.toString()}-${Math.floor(NOW.getTime() / 60000)}`,
      CLOUD_CONNECTION_PULL_JOB,
      { connectionId: AWS.toString() },
      {
        attempts: 1,
        deduplication: { id: `cloud-connection-read-${AWS.toString()}` },
      },
    ]);

    // Claimed before queued, so a tick running meanwhile cannot queue it again.
    expect(updateOneById.mock.invocationCallOrder[0]!).toBeLessThan(
      addJob.mock.invocationCallOrder[0]!,
    );
  });

  test("one connection that cannot be queued does not stop the others", async () => {
    addJob.mockRejectedValueOnce(new Error("redis unavailable"));

    expect(await CloudConnectionScheduler.enqueueDueConnections(NOW)).toBe(2);
    expect(addJob).toHaveBeenCalledTimes(3);
  });

  test("a connection that cannot be claimed is not queued", async () => {
    updateOneById.mockRejectedValueOnce(new Error("database unavailable"));

    expect(await CloudConnectionScheduler.enqueueDueConnections(NOW)).toBe(2);
    expect(
      addJob.mock.calls.map((call: Array<unknown>): string => {
        return (call[3] as JSONObject)["connectionId"] as string;
      }),
    ).toEqual([AZURE.toString(), GCP.toString()]);
  });

  test("nothing due is nothing queued", async () => {
    findBy.mockResolvedValue([]);

    expect(await CloudConnectionScheduler.enqueueDueConnections(NOW)).toBe(0);
    expect(addJob).not.toHaveBeenCalled();
  });

  test("the same minute gives the same job id; the next minute a new one", () => {
    expect(CloudConnectionScheduler.jobIdOf(AWS, NOW)).toBe(
      CloudConnectionScheduler.jobIdOf(
        AWS,
        new Date(NOW.getTime() + 20 * 1000),
      ),
    );
    expect(CloudConnectionScheduler.jobIdOf(AWS, NOW)).not.toBe(
      CloudConnectionScheduler.jobIdOf(
        AWS,
        new Date(NOW.getTime() + 60 * 1000),
      ),
    );
  });

  test("an unknown cloud waits 15 minutes; a read that runs long is stopped", () => {
    expect(CloudConnectionScheduler.intervalOf(connection(AWS, "oracle"))).toBe(
      15,
    );
    /*
     * Within AWS's default interval. A shorter interval waits on the
     * deduplication instead: one job per connection, waiting or running.
     */
    expect(CLOUD_CONNECTION_PULL_JOB_TIMEOUT_MS).toBeLessThan(10 * 60 * 1000);
  });
});
