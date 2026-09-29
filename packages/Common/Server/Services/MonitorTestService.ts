import DatabaseService, { EntityManager } from "./DatabaseService";
import MonitorTest from "../../Models/DatabaseModels/MonitorTest";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import { MonitorStepProbeResponse } from "../../Models/DatabaseModels/MonitorProbe";

export class Service extends DatabaseService<MonitorTest> {
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
   */
  public async mergeStepProbeResponse(data: {
    testId: ObjectID;
    monitorStepProbeResponse: MonitorStepProbeResponse;
  }): Promise<void> {
    const testedAt: Date = OneUptimeDate.getCurrentDate();

    await this.executeTransaction(
      async (transactionalEntityManager: EntityManager) => {
        const updateQuery: string = `
          UPDATE "MonitorTest"
          SET "monitorStepProbeResponse" = COALESCE("monitorStepProbeResponse", '{}'::jsonb) || $2::jsonb,
              "testedAt" = $3,
              "updatedAt" = now()
          WHERE "_id" = $1
            AND "deletedAt" IS NULL
        `;

        await transactionalEntityManager.query(updateQuery, [
          data.testId.toString(),
          JSON.stringify(data.monitorStepProbeResponse),
          testedAt,
        ]);
      },
    );
  }
}

export default new Service();
