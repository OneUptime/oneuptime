import NetworkControllerScheduler, {
  NETWORK_CONTROLLER_READ_JOB,
  NETWORK_CONTROLLER_READ_JOB_TIMEOUT_MS,
} from "../../../../Server/Utils/NetworkController/NetworkControllerScheduler";
import { NETWORK_CONTROLLER_READ_MAX_DURATION_MS } from "../../../../Server/Utils/NetworkController/NetworkControllerReadRunner";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import NetworkControllerConnection from "../../../../Models/DatabaseModels/NetworkControllerConnection";
import Queue, { QueueName } from "../../../../Server/Infrastructure/Queue";
import NetworkControllerConnectionService from "../../../../Server/Services/NetworkControllerConnectionService";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";

/*
 * When each Meraki connection is read: every minute the due connections
 * (never read, or next read in the past) are claimed - their next read
 * moved one interval on - and queued as one job each, deduplicated per
 * connection, so an organization is never read twice at once (which would
 * spend its API budget twice). The job carries the connection's id and
 * nothing else: never the key.
 */

const NOW: Date = new Date("2026-10-24T12:00:10Z");
const FIRST: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const SECOND: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");

function connection(
  id: ObjectID,
  readIntervalInMinutes: unknown = 5,
): NetworkControllerConnection {
  const value: NetworkControllerConnection = new NetworkControllerConnection();
  value.id = id;
  value.config = { organizationId: "549236", readIntervalInMinutes } as never;
  return value;
}

let findBy: jest.SpiedFunction<
  typeof NetworkControllerConnectionService.findBy
>;
let updateOneById: jest.SpiedFunction<
  typeof NetworkControllerConnectionService.updateOneById
>;
let addJob: jest.SpiedFunction<typeof Queue.addJob>;

beforeEach(() => {
  findBy = jest
    .spyOn(NetworkControllerConnectionService, "findBy")
    .mockResolvedValue([connection(FIRST), connection(SECOND, 30)]);
  updateOneById = jest
    .spyOn(NetworkControllerConnectionService, "updateOneById")
    .mockResolvedValue(undefined as never);
  addJob = jest.spyOn(Queue, "addJob").mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("NetworkControllerScheduler", () => {
  test("asks for enabled connections whose next read is due or was never set, oldest first", async () => {
    await NetworkControllerScheduler.enqueueDueConnections(NOW);

    const request: {
      query: JSONObject;
      limit: number;
      props: JSONObject;
      select: JSONObject;
      sort: JSONObject;
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
    expect(request.sort).toEqual({ nextPullAt: "ASC" });
    expect(request.limit).toBe(100);
    expect(request.props).toEqual({ isRoot: true });
    // Never the secrets: the job reads those itself.
    expect(Object.keys(request.select).sort()).toEqual(["_id", "config"]);
  });

  test("claims each one its own interval ahead, then queues it with its id only", async () => {
    expect(await NetworkControllerScheduler.enqueueDueConnections(NOW)).toBe(2);

    expect(
      updateOneById.mock.calls.map((call: Array<unknown>) => {
        return call[0];
      }),
    ).toEqual([
      {
        id: FIRST,
        data: { nextPullAt: new Date(NOW.getTime() + 5 * 60 * 1000) },
        props: { isRoot: true, ignoreHooks: true },
      },
      {
        id: SECOND,
        data: { nextPullAt: new Date(NOW.getTime() + 30 * 60 * 1000) },
        props: { isRoot: true, ignoreHooks: true },
      },
    ]);

    expect(addJob.mock.calls[0]).toEqual([
      QueueName.Worker,
      `network-controller-read-${FIRST.toString()}-${Math.floor(NOW.getTime() / 60000)}`,
      NETWORK_CONTROLLER_READ_JOB,
      { connectionId: FIRST.toString() },
      {
        attempts: 1,
        deduplication: { id: `network-controller-read-${FIRST.toString()}` },
      },
    ]);

    // Claimed before queued, so a tick running meanwhile cannot queue it again.
    expect(updateOneById.mock.invocationCallOrder[0]!).toBeLessThan(
      addJob.mock.invocationCallOrder[0]!,
    );
  });

  test("an interval that is not one of the choices reads as the default", async () => {
    findBy.mockResolvedValue([connection(FIRST, 2)]);

    await NetworkControllerScheduler.enqueueDueConnections(NOW);

    expect(
      (updateOneById.mock.calls[0]![0] as { data: JSONObject }).data,
    ).toEqual({ nextPullAt: new Date(NOW.getTime() + 5 * 60 * 1000) });
  });

  test("one connection that cannot be queued does not stop the others", async () => {
    addJob.mockRejectedValueOnce(new Error("redis unavailable"));

    expect(await NetworkControllerScheduler.enqueueDueConnections(NOW)).toBe(1);
    expect(addJob).toHaveBeenCalledTimes(2);
  });

  test("a connection without an id is passed over", async () => {
    findBy.mockResolvedValue([new NetworkControllerConnection()]);

    expect(await NetworkControllerScheduler.enqueueDueConnections(NOW)).toBe(0);
    expect(addJob).not.toHaveBeenCalled();
  });

  test("the same minute gives the same job id; the next minute a new one", () => {
    expect(NetworkControllerScheduler.jobIdOf(FIRST, NOW)).toBe(
      NetworkControllerScheduler.jobIdOf(
        FIRST,
        new Date(NOW.getTime() + 20 * 1000),
      ),
    );
    expect(NetworkControllerScheduler.jobIdOf(FIRST, NOW)).not.toBe(
      NetworkControllerScheduler.jobIdOf(
        FIRST,
        new Date(NOW.getTime() + 60 * 1000),
      ),
    );
  });

  test("a job may run as long as a read, and then some", () => {
    expect(NETWORK_CONTROLLER_READ_JOB_TIMEOUT_MS).toBeGreaterThan(
      NETWORK_CONTROLLER_READ_MAX_DURATION_MS + 60 * 1000,
    );
  });
});
