import MonitorTestService, {
  MONITOR_TEST_NOT_HANDED_TO_PROBE_MESSAGE,
} from "../../../Server/Services/MonitorTestService";
import { EntityManager } from "../../../Server/Services/DatabaseService";
import { MonitorStepProbeResponse } from "../../../Models/DatabaseModels/MonitorProbe";
import ObjectID from "../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A monitor test's result is written only on a test handed to the probe that
 * reported it: MonitorTestService.mergeStepProbeResponse keys its UPDATE on
 * the test AND the probe, and says whether it wrote. The statement itself is
 * run against Postgres in MonitorTestProbeResponsePostgres; this pins its
 * shape and how the answer is read, wherever the suite runs.
 */

const TEST_ID: ObjectID = new ObjectID("6f1c3c8e-2b7a-4d4e-9f0a-1c2d3e4f5a6b");
const PROBE_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const STEP_ID: string = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

const STEP_RESPONSE: MonitorStepProbeResponse = {
  [STEP_ID]: {
    isOnline: true,
    failureCause: "",
  } as unknown as ProbeMonitorResponse,
};

interface RecordedQuery {
  sql: string;
  parameters: Array<unknown>;
}

// Runs mergeStepProbeResponse against a manager that answers `answer`.
async function mergeAnswered(answer: unknown): Promise<{
  written: boolean;
  queries: Array<RecordedQuery>;
}> {
  const queries: Array<RecordedQuery> = [];

  const manager: EntityManager = {
    query: async (
      sql: string,
      parameters: Array<unknown>,
    ): Promise<unknown> => {
      queries.push({ sql, parameters });
      return answer;
    },
  } as unknown as EntityManager;

  jest
    .spyOn(MonitorTestService, "executeTransaction")
    .mockImplementation((async (
      run: (entityManager: EntityManager) => Promise<unknown>,
    ): Promise<unknown> => {
      return await run(manager);
    }) as never);

  const written: boolean = await MonitorTestService.mergeStepProbeResponse({
    testId: TEST_ID,
    probeId: PROBE_ID,
    monitorStepProbeResponse: STEP_RESPONSE,
  });

  return { written, queries };
}

const WHITESPACE: RegExp = /\s+/g;

function squash(sql: string): string {
  return sql.replace(WHITESPACE, " ").trim();
}

describe("MonitorTestService.mergeStepProbeResponse", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("writes only the test handed to the probe that reported it", async () => {
    const { queries } = await mergeAnswered([[{ _id: TEST_ID.toString() }], 1]);

    expect(queries).toHaveLength(1);

    const sql: string = squash(queries[0]!.sql);

    expect(sql).toContain('UPDATE "MonitorTest"');
    expect(sql).toContain(
      'WHERE "_id" = $1 AND "probeId" = $4 AND "deletedAt" IS NULL',
    );
    expect(sql).toContain('RETURNING "_id"');

    expect(queries[0]!.parameters[0]).toBe(TEST_ID.toString());
    expect(queries[0]!.parameters[3]).toBe(PROBE_ID.toString());
    // The merged step travels as one jsonb parameter.
    expect(JSON.parse(queries[0]!.parameters[1] as string)).toEqual(
      JSON.parse(JSON.stringify(STEP_RESPONSE)),
    );
  });

  test("merges into what other steps already wrote, never over it", async () => {
    const { queries } = await mergeAnswered([[{ _id: TEST_ID.toString() }], 1]);

    expect(squash(queries[0]!.sql)).toContain(
      `SET "monitorStepProbeResponse" = COALESCE("monitorStepProbeResponse", '{}'::jsonb) || $2::jsonb`,
    );
  });

  test("says it wrote when Postgres says a row was written", async () => {
    // How TypeORM's postgres driver answers an UPDATE: [rows, rowCount].
    expect((await mergeAnswered([[{ _id: TEST_ID.toString() }], 1])).written).toBe(
      true,
    );

    // A driver that hands back the RETURNING rows alone.
    expect((await mergeAnswered([{ _id: TEST_ID.toString() }])).written).toBe(
      true,
    );
  });

  test("says it wrote nothing for a test of another probe, or one that is gone", async () => {
    expect((await mergeAnswered([[], 0])).written).toBe(false);
    expect((await mergeAnswered([])).written).toBe(false);
  });

  test("an answer it cannot read is never taken for a written row", async () => {
    for (const answer of [undefined, null, 1, "UPDATE 1", { rowCount: 1 }]) {
      expect((await mergeAnswered(answer)).written).toBe(false);
    }
  });

  test("the refusal the queue worker raises says what happened", () => {
    expect(MONITOR_TEST_NOT_HANDED_TO_PROBE_MESSAGE).toBe(
      "This monitor test was not handed to this probe, or no longer exists.",
    );
  });
});
