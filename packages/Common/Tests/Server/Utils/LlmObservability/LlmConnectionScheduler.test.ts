import LlmConnectionScheduler, {
  LLM_CONNECTION_PULL_JOB,
} from "../../../../Server/Utils/LlmObservability/LlmConnectionScheduler";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import LlmObservabilityConnection from "../../../../Models/DatabaseModels/LlmObservabilityConnection";
import Queue, { QueueName } from "../../../../Server/Infrastructure/Queue";
import LlmObservabilityConnectionService from "../../../../Server/Services/LlmObservabilityConnectionService";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import { JSONObject } from "../../../../Types/JSON";
import LlmConnectionProvider from "../../../../Types/LlmObservability/LlmConnectionProvider";
import ObjectID from "../../../../Types/ObjectID";

/*
 * When each connection is read: every minute the due connections (never
 * read, or next read in the past) are claimed - their next read moved one
 * interval on - and queued as one job each, deduplicated per connection,
 * with the connection's id as the job's only data.
 */

const NOW: Date = new Date("2026-10-19T15:30:10Z");
const FIRST: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const SECOND: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");

function connection(id: ObjectID): LlmObservabilityConnection {
  const value: LlmObservabilityConnection = new LlmObservabilityConnection();
  value.id = id;
  value.provider = LlmConnectionProvider.OpenAI;
  return value;
}

let findBy: jest.SpiedFunction<typeof LlmObservabilityConnectionService.findBy>;
let updateOneById: jest.SpiedFunction<
  typeof LlmObservabilityConnectionService.updateOneById
>;
let addJob: jest.SpiedFunction<typeof Queue.addJob>;

beforeEach(() => {
  findBy = jest
    .spyOn(LlmObservabilityConnectionService, "findBy")
    .mockResolvedValue([connection(FIRST), connection(SECOND)]);
  updateOneById = jest
    .spyOn(LlmObservabilityConnectionService, "updateOneById")
    .mockResolvedValue(undefined as never);
  addJob = jest.spyOn(Queue, "addJob").mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("LlmConnectionScheduler", () => {
  test("asks for enabled connections whose next read is due or was never set", async () => {
    await LlmConnectionScheduler.enqueueDueConnections(NOW);

    const request: {
      query: JSONObject;
      limit: number;
      props: JSONObject;
      select: JSONObject;
    } = findBy.mock.calls[0]![0] as never;

    expect(request.query["isEnabled"]).toBe(true);
    // A raw operator: due at or before now, or never set.
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
    // Never the settings or the secrets: the job reads those itself.
    expect(Object.keys(request.select).sort()).toEqual(["_id", "provider"]);
  });

  test("claims each one an interval ahead, then queues it with its id only", async () => {
    expect(await LlmConnectionScheduler.enqueueDueConnections(NOW)).toBe(2);

    expect(updateOneById.mock.calls[0]![0]).toEqual({
      id: FIRST,
      data: { nextPullAt: new Date(NOW.getTime() + 15 * 60 * 1000) },
      props: { isRoot: true, ignoreHooks: true },
    });

    expect(addJob).toHaveBeenCalledTimes(2);
    expect(addJob.mock.calls[0]).toEqual([
      QueueName.Worker,
      `llm-connection-pull-${FIRST.toString()}-${Math.floor(NOW.getTime() / 60000)}`,
      LLM_CONNECTION_PULL_JOB,
      { connectionId: FIRST.toString() },
      {
        attempts: 1,
        deduplication: { id: `llm-connection-pull-${FIRST.toString()}` },
      },
    ]);

    // Claimed before queued, so a tick running meanwhile cannot queue it again.
    expect(updateOneById.mock.invocationCallOrder[0]!).toBeLessThan(
      addJob.mock.invocationCallOrder[0]!,
    );
  });

  test("one connection that cannot be queued does not stop the others", async () => {
    addJob.mockRejectedValueOnce(new Error("redis unavailable"));

    expect(await LlmConnectionScheduler.enqueueDueConnections(NOW)).toBe(1);
    expect(addJob).toHaveBeenCalledTimes(2);
  });

  test("the same minute gives the same job id; the next minute a new one", () => {
    expect(LlmConnectionScheduler.jobIdOf(FIRST, NOW)).toBe(
      LlmConnectionScheduler.jobIdOf(
        FIRST,
        new Date(NOW.getTime() + 20 * 1000),
      ),
    );
    expect(LlmConnectionScheduler.jobIdOf(FIRST, NOW)).not.toBe(
      LlmConnectionScheduler.jobIdOf(
        FIRST,
        new Date(NOW.getTime() + 60 * 1000),
      ),
    );
  });
});
