import ProjectReferencesService from "./ProjectReferencesService";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import MonitorTest from "../../Models/DatabaseModels/MonitorTest";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import PositiveNumber from "../../Types/PositiveNumber";
import { MonitorStepProbeResponse } from "../../Models/DatabaseModels/MonitorProbe";
import ExceptionMessages from "../../Types/Exception/ExceptionMessages";
import TooManyRequestsException from "../../Types/Exception/TooManyRequestsException";
import MonitorStepLimit from "../../Types/Monitor/MonitorStepLimit";

/*
 * A result for a test the reporting probe was not handed (or one that is
 * gone). Kept in ExceptionMessages, so the telemetry worker can tell it
 * apart without loading this service (isNonActionableIngestError, issue
 * #8539).
 */
export const MONITOR_TEST_NOT_HANDED_TO_PROBE_MESSAGE: string =
  ExceptionMessages.MonitorTestNotHandedToProbe;

/*
 * How many "Test monitor" runs a project may ask for in a window. A person
 * testing monitors runs a few a minute at most - three is the most any
 * project on OneUptime Cloud ran in a minute - so this holds back only a
 * project that runs them as a load test of the probes.
 */
export const MAX_MONITOR_TESTS_PER_PROJECT_IN_WINDOW: number = 30;
export const MONITOR_TEST_WINDOW_IN_MINUTES: number = 10;

export class Service extends ProjectReferencesService<MonitorTest> {
  private static readonly STALE_TEST_CLAIM_TIMEOUT_IN_MINUTES: number = 10;

  public constructor() {
    super(MonitorTest);
    this.hardDeleteItemsOlderThanInDays("createdAt", 2); // this is temporary data. Clear it after 2 days.
  }

  /*
   * A "Test monitor" run is work for a probe, bounded twice. Through the API,
   * one free project ran 1,238 tests of up to 5,000 steps each in an hour:
   * the probe reports every step, and their 6.2 million reports held up
   * every project's probe results for hours.
   *
   * A test with more steps than any monitor may have (MonitorStepLimit) is
   * refused before anything else is checked: it reads nothing.
   */
  protected override async checkCreateBeforeReferences(
    createBy: CreateBy<MonitorTest>,
  ): Promise<void> {
    MonitorStepLimit.assertWithinLimit(createBy.data.monitorSteps);
  }

  /*
   * And a project that has already asked for
   * MAX_MONITOR_TESTS_PER_PROJECT_IN_WINDOW tests in the last
   * MONITOR_TEST_WINDOW_IN_MINUTES minutes is refused another - counted
   * after the base hook has checked the test's references, as a lookup of
   * the service's own must be (ProjectReferencesService).
   */
  protected override async onBeforeCreate(
    createBy: CreateBy<MonitorTest>,
  ): Promise<OnCreate<MonitorTest>> {
    await super.onBeforeCreate(createBy);

    await this.refuseTestPastProjectLimit(createBy);

    return { createBy: createBy, carryForward: undefined };
  }

  private async refuseTestPastProjectLimit(
    createBy: CreateBy<MonitorTest>,
  ): Promise<void> {
    const projectId: ObjectID | undefined =
      createBy.props.tenantId || createBy.data.projectId;

    if (!projectId) {
      return;
    }

    const recentTests: PositiveNumber = await this.countBy({
      query: {
        projectId: projectId,
        createdAt: QueryHelper.greaterThanEqualTo(
          OneUptimeDate.addRemoveMinutes(
            OneUptimeDate.getCurrentDate(),
            -MONITOR_TEST_WINDOW_IN_MINUTES,
          ),
        ),
      },
      props: {
        isRoot: true,
      },
    });

    if (recentTests.toNumber() >= MAX_MONITOR_TESTS_PER_PROJECT_IN_WINDOW) {
      throw new TooManyRequestsException(
        `This project has run ${MAX_MONITOR_TESTS_PER_PROJECT_IN_WINDOW} monitor tests in the last ${MONITOR_TEST_WINDOW_IN_MINUTES} minutes, the most it may. Try again in a few minutes.`,
      );
    }
  }

  /**
   * Claims this probe's monitor tests, oldest first, at most `limit`: the
   * ones still in the queue, and the ones a probe was handed more than
   * STALE_TEST_CLAIM_TIMEOUT_IN_MINUTES ago that never answered (it died or
   * restarted mid-test), which are handed out again.
   *
   * One self-committing statement (OneUptime issue #7392), the shape of
   * NetworkDeviceService.claimDevicesForPolling: the tests are locked FOR NO
   * KEY UPDATE SKIP LOCKED, so two replicas of a probe never run the same
   * test, and taken out of the queue by the same statement, so the locks
   * last only as long as it runs. FOR NO KEY UPDATE is the lock the UPDATE
   * takes anyway, and a foreign-key check against the row does not wait for
   * it.
   *
   * It was a transaction: SELECT ... FOR UPDATE, an UPDATE of the ids, then
   * COMMIT - four round trips on every probe tick, even with nothing in the
   * queue, holding FOR UPDATE for as long as a busy pod took to come back to
   * its connection.
   *
   * A test another replica took out of the queue while this statement
   * waited no longer matches: the row it left is checked again, and is
   * neither in the queue nor stale. The ids come back in claim order, the
   * oldest first.
   */
  public async claimMonitorTestsForProbing(data: {
    probeId: ObjectID;
    limit: number;
  }): Promise<Array<ObjectID>> {
    const staleClaimThreshold: Date = OneUptimeDate.addRemoveMinutes(
      OneUptimeDate.getCurrentDate(),
      -Service.STALE_TEST_CLAIM_TIMEOUT_IN_MINUTES,
    );

    const claimQuery: string = `
      WITH "pending" AS (
        SELECT mt."_id", mt."createdAt"
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
        FOR NO KEY UPDATE OF mt SKIP LOCKED
      ),
      "claimed" AS (
        UPDATE "MonitorTest" AS mt
        SET "isInQueue" = false,
            "updatedAt" = now()
        FROM "pending"
        WHERE mt."_id" = "pending"."_id"
        RETURNING mt."_id"
      )
      SELECT "pending"."_id"
      FROM "pending"
      INNER JOIN "claimed" ON "claimed"."_id" = "pending"."_id"
      ORDER BY "pending"."createdAt" ASC
    `;

    /*
     * A SELECT of the rows the UPDATE wrote, so the answer is those rows:
     * TypeORM hands a top-level UPDATE ... RETURNING back as
     * [rows, rowCount] instead.
     */
    const claimedRows: unknown = await this.getRepository().manager.query(
      claimQuery,
      [data.probeId.toString(), data.limit, staleClaimThreshold],
    );

    return Array.isArray(claimedRows)
      ? claimedRows.map((row: { _id: string }): ObjectID => {
          return new ObjectID(row._id);
        })
      : [];
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
   *
   * One self-committing statement, whose own WHERE is the guard (OneUptime
   * issue #8870). It ran inside a transaction, which added a BEGIN and a
   * COMMIT round trip to every step result of every "Test monitor" run, and
   * held the connection between them, for nothing to commit together.
   */
  public async mergeStepProbeResponse(data: {
    testId: ObjectID;
    probeId: ObjectID;
    monitorStepProbeResponse: MonitorStepProbeResponse;
  }): Promise<boolean> {
    const testedAt: Date = OneUptimeDate.getCurrentDate();

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

    const result: unknown = await this.getRepository().manager.query(
      updateQuery,
      [
        data.testId.toString(),
        JSON.stringify(data.monitorStepProbeResponse),
        testedAt,
        data.probeId.toString(),
      ],
    );

    return readUpdatedRowCount(result) > 0;
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
