import MetricTypeService from "../../../Server/Services/MetricTypeService";
import ObjectID from "../../../Types/ObjectID";
import BadDataException from "../../../Types/Exception/BadDataException";
import { getJestSpyOn } from "../../Spy";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

/*
 * Pins the SQL that associates services with a metric type.
 *
 * The association used to be expressed by handing `updateOneById` the whole
 * `services` array. Because `services` is an EntityArray, its mere PRESENCE as
 * a key routes DatabaseService to `getRepository().save()` — a real
 * BEGIN/COMMIT that reloads the entity, loads relation ids, bumps `version`,
 * and DELETEs then re-INSERTs junction rows, holding the MetricType row's
 * write lock across all of it. On a path that runs per metric name per batch
 * with no backpressure, that was the only multi-round-trip lock hold in the
 * pipeline.
 *
 * It was also losing data. save() deletes any association missing from the
 * array it is handed, and an ingest worker only knows the services in ITS
 * batch — so two workers deleted each other's associations and re-inserted
 * them on the next batch. Permanent junction churn, with real service-to-metric
 * links missing from the UI in between.
 *
 * The assertions below are about the emitted statement, because that is where
 * both properties live: it must be a single additive INSERT, and it must never
 * be able to express a delete.
 *
 * No Postgres — the repository is faked and the SQL is captured.
 */

const METRIC_TYPE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const SERVICE_A: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SERVICE_B: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

interface CapturedQuery {
  sql: string;
  params: Array<unknown>;
}

describe("MetricTypeService.attachServices", () => {
  let captured: Array<CapturedQuery>;

  beforeEach(() => {
    jest.restoreAllMocks();
    captured = [];

    getJestSpyOn(MetricTypeService, "getRepository").mockReturnValue({
      metadata: {
        findRelationWithPropertyPath: (path: string) => {
          if (path !== "services") {
            return undefined;
          }
          return {
            junctionEntityMetadata: {
              tableName: "MetricTypeService",
              columns: [
                { databaseName: "metricTypeId" },
                { databaseName: "serviceId" },
              ],
            },
          };
        },
      },
      manager: {
        query: async (
          sql: string,
          params: Array<unknown>,
        ): Promise<Array<unknown>> => {
          captured.push({ sql, params });
          return [];
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  });

  it("writes the associations in one statement", async () => {
    await MetricTypeService.attachServices({
      metricTypeId: METRIC_TYPE_ID,
      serviceIds: [SERVICE_A, SERVICE_B],
    });

    expect(captured).toHaveLength(1);
  });

  it("inserts additively, tolerating a concurrent writer adding the same pair", async () => {
    await MetricTypeService.attachServices({
      metricTypeId: METRIC_TYPE_ID,
      serviceIds: [SERVICE_A],
    });

    expect(captured[0]!.sql).toContain(
      `INSERT INTO "MetricTypeService" ("metricTypeId", "serviceId")`,
    );
    expect(captured[0]!.sql).toContain("ON CONFLICT DO NOTHING");
  });

  /*
   * The load-bearing negative. If a DELETE can ever be emitted here, the
   * data-loss bug is expressible again.
   */
  it("can never emit a DELETE", async () => {
    await MetricTypeService.attachServices({
      metricTypeId: METRIC_TYPE_ID,
      serviceIds: [SERVICE_A, SERVICE_B],
    });

    expect(captured[0]!.sql.toUpperCase()).not.toContain("DELETE");
  });

  it("never opens a transaction", async () => {
    await MetricTypeService.attachServices({
      metricTypeId: METRIC_TYPE_ID,
      serviceIds: [SERVICE_A],
    });

    expect(captured[0]!.sql.toUpperCase()).not.toContain("BEGIN");
    expect(captured[0]!.sql.toUpperCase()).not.toContain("COMMIT");
  });

  it("never touches the optimistic-lock version column", async () => {
    await MetricTypeService.attachServices({
      metricTypeId: METRIC_TYPE_ID,
      serviceIds: [SERVICE_A],
    });

    expect(captured[0]!.sql).not.toContain("version");
  });

  it("binds the ids as parameters, never as literals", async () => {
    await MetricTypeService.attachServices({
      metricTypeId: METRIC_TYPE_ID,
      serviceIds: [SERVICE_A, SERVICE_B],
    });

    expect(captured[0]!.params[0]).toBe(METRIC_TYPE_ID.toString());
    expect(captured[0]!.sql).not.toContain(METRIC_TYPE_ID.toString());
  });

  /*
   * Sorting is not cosmetic. Two workers inserting overlapping sets acquire
   * their row locks in the order the rows appear; a consistent order is what
   * keeps them from deadlocking each other.
   */
  it("sorts the ids so concurrent writers lock in a consistent order", async () => {
    const ids: Array<ObjectID> = [SERVICE_B, SERVICE_A];
    const expected: Array<string> = [
      SERVICE_A.toString(),
      SERVICE_B.toString(),
    ].sort();

    await MetricTypeService.attachServices({
      metricTypeId: METRIC_TYPE_ID,
      serviceIds: ids,
    });

    expect(captured[0]!.params[1]).toEqual(expected);
  });

  it("deduplicates repeated ids", async () => {
    await MetricTypeService.attachServices({
      metricTypeId: METRIC_TYPE_ID,
      serviceIds: [SERVICE_A, SERVICE_A, SERVICE_A],
    });

    expect(captured[0]!.params[1]).toEqual([SERVICE_A.toString()]);
  });

  it("issues nothing for an empty set", async () => {
    await MetricTypeService.attachServices({
      metricTypeId: METRIC_TYPE_ID,
      serviceIds: [],
    });

    expect(captured).toHaveLength(0);
  });

  it("requires a metric type id", async () => {
    await expect(
      MetricTypeService.attachServices({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        metricTypeId: undefined as any,
        serviceIds: [SERVICE_A],
      }),
    ).rejects.toThrow(BadDataException);
  });

  /*
   * The junction table and column names come from entity metadata, never from
   * a caller and never hardcoded at the call site — so a schema rename cannot
   * leave this writing to a table that no longer exists.
   */
  it("fails loudly if the relation metadata is missing rather than guessing", async () => {
    getJestSpyOn(MetricTypeService, "getRepository").mockReturnValue({
      metadata: {
        findRelationWithPropertyPath: () => {
          return undefined;
        },
      },
      manager: {
        query: async (): Promise<Array<unknown>> => {
          return [];
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    await expect(
      MetricTypeService.attachServices({
        metricTypeId: METRIC_TYPE_ID,
        serviceIds: [SERVICE_A],
      }),
    ).rejects.toThrow(BadDataException);
  });
});
