import { EntityManager } from "./DatabaseService";
import ProjectReferencesService from "./ProjectReferencesService";
import MonitorTest from "../../Models/DatabaseModels/MonitorTest";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import { MonitorStepProbeResponse } from "../../Models/DatabaseModels/MonitorProbe";

// A result for a test the reporting probe was not handed (or one that is gone).
export const MONITOR_TEST_NOT_HANDED_TO_PROBE_MESSAGE: string =
  "This monitor test was not handed to this probe, or no longer exists.";

export class Service extends ProjectReferencesService<MonitorTest> {
  private static readonly STALE_TEST_CLAIM_TIMEOUT_IN_MINUTES: number = 10;

  public constructor() {
    super(MonitorTest);
    this.hardDeleteItemsOlderThanInDays("createdAt", 2); // this is temporary data. Clear it after 2 days.
  }

  /**
   * Atomically claims monitor tests for a specific probe instance using
   * FOR UPDATE SKIP LOCKED so concurrent probe replicas do not execute the
   * same monitor test.
   */
  public async claimMonitorTestsForProbing(data: {
    probeId: ObjectID;
    limit: number;
  }): Promise<Array<ObjectID>> {
    const staleClaimThreshold: Date = OneUptimeDate.addRemoveMinutes(
      OneUptimeDate.getCurrentDate(),
      -Service.STALE_TEST_CLAIM_TIMEOUT_IN_MINUTES,
    );

    return await this.executeTransaction(
      async (transactionalEntityManager: EntityManager) => {
        const selectQuery: string = `
          SELECT mt."_id"
          FROM "MonitorTest" mt
          WHERE mt."probeId" = $1
            AND (
              mt."isInQueue" = true
              OR (
                mt."isInQueue" = false
                AND mt."updatedAt" <= $3
              )
            )
            AND mt."monitorStepProbeResponse" IS NULL
            AND mt."deletedAt" IS NULL
          ORDER BY mt."createdAt" ASC
          LIMIT $2
          FOR UPDATE OF mt SKIP LOCKED
        `;

        const selectedRows: Array<{ _id: string }> =
          await transactionalEntityManager.query(selectQuery, [
            data.probeId.toString(),
            data.limit,
            staleClaimThreshold,
          ]);

        if (selectedRows.length === 0) {
          return [];
        }

        const ids: Array<string> = selectedRows.map((row: { _id: string }) => {
          return row._id;
        });

        const updateQuery: string = `
          UPDATE "MonitorTest"
          SET "isInQueue" = false,
              "updatedAt" = now()
          WHERE "_id" = ANY($1::uuid[])
        `;

        await transactionalEntityManager.query(updateQuery, [ids]);

        return ids.map((id: string) => {
          return new ObjectID(id);
        });
      },
    );
  }

  /**
   * Merge a single step response into monitorStepProbeResponse atomically.
   * This avoids step-response overwrite races when multiple step jobs are
   * processed concurrently.
   *
   * Only the probe the test was handed to answers it: the UPDATE is keyed on
   * the test AND the probe that reported (as it authenticated to probe
   * ingest), so a probe that learned another test's id - another project's
   * included - writes nothing. Returns whether a row was written: false for
   * a test of another probe, and for one that is gone.
   */
  public async mergeStepProbeResponse(data: {
    testId: ObjectID;
    probeId: ObjectID;
    monitorStepProbeResponse: MonitorStepProbeResponse;
  }): Promise<boolean> {
    const testedAt: Date = OneUptimeDate.getCurrentDate();

    return await this.executeTransaction(
      async (transactionalEntityManager: EntityManager): Promise<boolean> => {
        const updateQuery: string = `
          UPDATE "MonitorTest"
          SET "monitorStepProbeResponse" = COALESCE("monitorStepProbeResponse", '{}'::jsonb) || $2::jsonb,
              "testedAt" = $3,
              "updatedAt" = now()
          WHERE "_id" = $1
            AND "probeId" = $4
            AND "deletedAt" IS NULL
          RETURNING "_id"
        `;

        const result: unknown = await transactionalEntityManager.query(
          updateQuery,
          [
            data.testId.toString(),
            JSON.stringify(data.monitorStepProbeResponse),
            testedAt,
            data.probeId.toString(),
          ],
        );

        return readUpdatedRowCount(result) > 0;
      },
    );
  }
}

/*
 * Rows a raw UPDATE ... RETURNING wrote, read defensively. The postgres
 * driver hands TypeORM's `manager.query` back `[rows, rowCount]` for an
 * UPDATE; a driver that returns the bare row array instead still yields one
 * row per test written. Anything unrecognisable reads as none: a result that
 * may not have landed is never reported as one that did.
 */
function readUpdatedRowCount(result: unknown): number {
  if (!Array.isArray(result)) {
    return 0;
  }

  if (
    result.length === 2 &&
    Array.isArray(result[0]) &&
    typeof result[1] === "number"
  ) {
    return result[1];
  }

  return result.length;
}

export default new Service();
