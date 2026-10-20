import AlertEpisodeService from "../../Services/AlertEpisodeService";
import AlertMeasurementValueService from "../../Services/AlertMeasurementValueService";
import AlertService from "../../Services/AlertService";
import IncidentEpisodeService from "../../Services/IncidentEpisodeService";
import IncidentMeasurementValueService from "../../Services/IncidentMeasurementValueService";
import IncidentService from "../../Services/IncidentService";
import logger from "../Logger";
import OneUptimeDate from "../../../Types/Date";
import IncidentMeasurementAnchorType from "../../../Types/Incident/IncidentMeasurementAnchorType";
import ObjectID from "../../../Types/ObjectID";
import OnCallDutyExecutionLogTimelineStatus from "../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";

/*
 * FIRST PAGED AT: WHEN SOMEBODY WAS FIRST PAGED ABOUT AN INCIDENT, AN ALERT
 * OR AN EPISODE.
 *
 * Every response time OneUptime keeps counts from the record's creation, so
 * a low-severity alert raised at night and paged in the morning has hours of
 * time to acknowledge before anybody heard of it. First Paged At is when the
 * people paged first heard: the first time an on-call policy's run or a
 * direct page actually notified somebody about the record. That is a step of
 * the run (OnCallDutyPolicyExecutionLogTimeline) that names who the page was
 * sent to and says it went out (PAGE_WENT_OUT_STATUSES) - never Skipped,
 * Error, or a page still being sent. The run's own start is not it: a run can
 * start and page nobody (a schedule with nobody on call at night), and a run
 * started by hand can come hours after the record.
 *
 * It is written once and never moved: the first step to say its page went
 * out sets it while it is empty, in one statement that checks it still is
 * (compareAndSetColumnsByIdWithoutHooks), so two runs paging at once cannot
 * move it. It holds when that step was created - when its person was paged,
 * as the escalation creates a step at the moment it pages someone - which is
 * also what the backfill reads from the steps of runs before the upgrade.
 *
 * Setting it on an incident or an alert works the record's measurements out
 * again, so "Time to acknowledge after paging"
 * (Utils/Measurement/MeasurementMoments) gets its start. Episodes have no
 * measurements.
 */

// What a step of a run says once its page went out to the person it names.
export const PAGE_WENT_OUT_STATUSES: ReadonlyArray<OnCallDutyExecutionLogTimelineStatus> =
  [
    // It reached them...
    OnCallDutyExecutionLogTimelineStatus.NotificationSent,
    // ...and they acknowledged it...
    OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged,
    // ...or passed it on to the next person (OnCallPagePassOn).
    OnCallDutyExecutionLogTimelineStatus.PassedOn,
  ];

// The fields of a step of a run (OnCallDutyPolicyExecutionLogTimeline) read here.
export interface PagingStep {
  alertSentToUserId?: ObjectID | null | undefined;
  status?: OnCallDutyExecutionLogTimelineStatus | null | undefined;
  createdAt?: Date | null | undefined;
  triggeredByIncidentId?: ObjectID | null | undefined;
  triggeredByAlertId?: ObjectID | null | undefined;
  triggeredByAlertEpisodeId?: ObjectID | null | undefined;
  triggeredByIncidentEpisodeId?: ObjectID | null | undefined;
}

type PagingStepRecordColumn =
  | "triggeredByIncidentId"
  | "triggeredByAlertId"
  | "triggeredByAlertEpisodeId"
  | "triggeredByIncidentEpisodeId";

type QueryFunction = (
  sql: string,
  parameters: Array<unknown>,
) => Promise<unknown>;

// One kind of record a run pages about.
interface PagedRecordKind {
  // The step's column that names a record of this kind.
  stepColumn: PagingStepRecordColumn;
  // The record's table.
  tableName: string;
  // Sets the record's First Paged At while it is empty: true when it did.
  setWhileEmpty: (recordId: ObjectID, pagedAt: Date) => Promise<boolean>;
  // Works the record's measurements out again, for a kind that has them.
  recomputeMeasurements?: ((recordId: ObjectID) => Promise<void>) | undefined;
  // The table of the kind's measurement definitions, for a kind that has them.
  measurementTableName?: string | undefined;
  // A statement on the database, for the backfill.
  query: QueryFunction;
}

/*
 * Written without the services' hooks and without moving updatedAt: nobody
 * edited the record, and its realtime listeners, workflows and audit log
 * have nothing to hear about.
 */
const PAGED_RECORD_KINDS: ReadonlyArray<PagedRecordKind> = [
  {
    stepColumn: "triggeredByIncidentId",
    tableName: "Incident",
    setWhileEmpty: async (
      recordId: ObjectID,
      pagedAt: Date,
    ): Promise<boolean> => {
      return await IncidentService.compareAndSetColumnsByIdWithoutHooks({
        id: recordId,
        data: { firstPagedAt: pagedAt },
        expectedData: { firstPagedAt: null as unknown as Date },
        skipUpdateDateColumn: true,
      });
    },
    recomputeMeasurements: async (recordId: ObjectID): Promise<void> => {
      await IncidentMeasurementValueService.recomputeForIncident({
        incidentId: recordId,
      });
    },
    measurementTableName: "IncidentMeasurement",
    query: async (
      sql: string,
      parameters: Array<unknown>,
    ): Promise<unknown> => {
      return await IncidentService.getRepository().manager.query(
        sql,
        parameters,
      );
    },
  },
  {
    stepColumn: "triggeredByAlertId",
    tableName: "Alert",
    setWhileEmpty: async (
      recordId: ObjectID,
      pagedAt: Date,
    ): Promise<boolean> => {
      return await AlertService.compareAndSetColumnsByIdWithoutHooks({
        id: recordId,
        data: { firstPagedAt: pagedAt },
        expectedData: { firstPagedAt: null as unknown as Date },
        skipUpdateDateColumn: true,
      });
    },
    recomputeMeasurements: async (recordId: ObjectID): Promise<void> => {
      await AlertMeasurementValueService.recomputeForAlert({
        alertId: recordId,
      });
    },
    measurementTableName: "AlertMeasurement",
    query: async (
      sql: string,
      parameters: Array<unknown>,
    ): Promise<unknown> => {
      return await AlertService.getRepository().manager.query(sql, parameters);
    },
  },
  {
    stepColumn: "triggeredByAlertEpisodeId",
    tableName: "AlertEpisode",
    setWhileEmpty: async (
      recordId: ObjectID,
      pagedAt: Date,
    ): Promise<boolean> => {
      return await AlertEpisodeService.compareAndSetColumnsByIdWithoutHooks({
        id: recordId,
        data: { firstPagedAt: pagedAt },
        expectedData: { firstPagedAt: null as unknown as Date },
        skipUpdateDateColumn: true,
      });
    },
    query: async (
      sql: string,
      parameters: Array<unknown>,
    ): Promise<unknown> => {
      return await AlertEpisodeService.getRepository().manager.query(
        sql,
        parameters,
      );
    },
  },
  {
    stepColumn: "triggeredByIncidentEpisodeId",
    tableName: "IncidentEpisode",
    setWhileEmpty: async (
      recordId: ObjectID,
      pagedAt: Date,
    ): Promise<boolean> => {
      return await IncidentEpisodeService.compareAndSetColumnsByIdWithoutHooks({
        id: recordId,
        data: { firstPagedAt: pagedAt },
        expectedData: { firstPagedAt: null as unknown as Date },
        skipUpdateDateColumn: true,
      });
    },
    query: async (
      sql: string,
      parameters: Array<unknown>,
    ): Promise<unknown> => {
      return await IncidentEpisodeService.getRepository().manager.query(
        sql,
        parameters,
      );
    },
  },
];

/*
 * The anchor type a measurement starts or ends at First Paged At by: the
 * same value in the incident and the alert enums
 * (IncidentMeasurementAnchorType, AlertMeasurementAnchorType).
 */
const FIRST_PAGED_AT_ANCHOR_TYPE: string =
  IncidentMeasurementAnchorType.FirstPagedAt;

// How many records the backfill reads, and fills, in one statement each.
export const FIRST_PAGED_AT_BACKFILL_BATCH_SIZE: number = 500;

// What the backfill did.
export interface FirstPagedAtBackfillResult {
  // How many records of each table it gave a First Paged At.
  filledByTable: Record<string, number>;
  /*
   * How many measurements that start or end at First Paged At it asked to
   * be worked out again for every record.
   */
  measurementsRequeued: number;
}

type ReadIdsFunction = (result: unknown) => Array<string>;

// The ids a SELECT handed back, however the driver shapes them.
const readIds: ReadIdsFunction = (result: unknown): Array<string> => {
  const rows: Array<unknown> = Array.isArray(result) ? result : [];

  return rows
    .map((row: unknown): string => {
      return row && typeof row === "object"
        ? String((row as Record<string, unknown>)["_id"] || "")
        : "";
    })
    .filter((id: string): boolean => {
      return Boolean(id);
    });
};

export default class FirstPagedAt {
  /*
   * Whether a step of a run is a page that went out: sent to somebody, and
   * saying it reached them. A step that skipped or could not reach somebody,
   * or is still sending, is not.
   */
  public static isPageThatWentOut(step: PagingStep): boolean {
    return Boolean(
      step.alertSentToUserId &&
        step.status &&
        PAGE_WENT_OUT_STATUSES.includes(step.status),
    );
  }

  /*
   * Records a step's page as the First Paged At of each record it names, on
   * a record that has none yet, and works the measurements of each record it
   * set out again. Never throws: it runs on the paging path, which a
   * bookkeeping write must never stop.
   */
  public static async recordPage(step: PagingStep): Promise<void> {
    if (!FirstPagedAt.isPageThatWentOut(step)) {
      return;
    }

    // When the person was paged. A step read without it is being paged now.
    const pagedAt: Date = step.createdAt
      ? OneUptimeDate.fromString(step.createdAt)
      : OneUptimeDate.getCurrentDate();

    for (const kind of PAGED_RECORD_KINDS) {
      const recordId: ObjectID | null | undefined = step[kind.stepColumn];

      if (!recordId) {
        continue;
      }

      try {
        const isFirstPage: boolean = await kind.setWhileEmpty(
          recordId,
          pagedAt,
        );

        if (isFirstPage && kind.recomputeMeasurements) {
          // Not awaited: a derived number must not hold up a page.
          kind.recomputeMeasurements(recordId).catch((err: Error) => {
            logger.error(err);
          });
        }
      } catch (err) {
        logger.error(
          `Could not record when ${kind.tableName} ${recordId.toString()} was first paged:`,
        );
        logger.error(err as Error);
      }
    }
  }

  /*
   * Gives every record paged before the upgrade its First Paged At, from the
   * steps of its runs: the earliest step that paged somebody, by the same
   * rule as recordPage. Walks each table in primary key order, a batch at a
   * time, and fills only what is still empty - checked again by the UPDATE
   * itself - so a page recorded meanwhile is kept, and two passes at once
   * write the same values.
   *
   * Then asks for every measurement that starts or ends at First Paged At to
   * be worked out again for every record (the measurement backfill,
   * Workers/Jobs/Measurement/BackfillMeasurements): one made while this ran
   * was worked out before its records had their start.
   */
  public static async backfill(options?: {
    batchSize?: number | undefined;
  }): Promise<FirstPagedAtBackfillResult> {
    const batchSize: number = Math.max(
      1,
      Math.floor(options?.batchSize || FIRST_PAGED_AT_BACKFILL_BATCH_SIZE),
    );

    const result: FirstPagedAtBackfillResult = {
      filledByTable: {},
      measurementsRequeued: 0,
    };

    for (const kind of PAGED_RECORD_KINDS) {
      let filled: number = 0;
      let lastId: string | null = null;

      for (;;) {
        const ids: Array<string> = readIds(
          await kind.query(
            `SELECT "_id"::text AS "_id" FROM "${kind.tableName}" WHERE "firstPagedAt" IS NULL AND ($2::uuid IS NULL OR "_id" > $2::uuid) ORDER BY "_id" ASC LIMIT $1`,
            [batchSize, lastId],
          ),
        );

        if (ids.length === 0) {
          break;
        }

        filled += readIds(
          await kind.query(
            `WITH "paged" AS (SELECT "${kind.stepColumn}" AS "recordId", MIN("createdAt") AS "firstPagedAt" FROM "OnCallDutyPolicyExecutionLogTimeline" WHERE "${kind.stepColumn}" = ANY($1::uuid[]) AND "alertSentToUserId" IS NOT NULL AND "status" = ANY($2::text[]) GROUP BY "${kind.stepColumn}"), "filled" AS (UPDATE "${kind.tableName}" AS "record" SET "firstPagedAt" = "paged"."firstPagedAt" FROM "paged" WHERE "record"."_id" = "paged"."recordId" AND "record"."firstPagedAt" IS NULL RETURNING "record"."_id") SELECT "_id"::text AS "_id" FROM "filled"`,
            [ids, [...PAGE_WENT_OUT_STATUSES]],
          ),
        ).length;

        lastId = ids[ids.length - 1]!;

        if (ids.length < batchSize) {
          break;
        }
      }

      result.filledByTable[kind.tableName] = filled;

      if (filled === 0 || !kind.measurementTableName) {
        continue;
      }

      result.measurementsRequeued += readIds(
        await kind.query(
          `WITH "requeued" AS (UPDATE "${kind.measurementTableName}" SET "backfillRequestedAt" = now(), "backfillCursorCreatedAt" = NULL, "backfillCompletedAt" = NULL WHERE "startAnchorType" = $1 OR "endAnchorType" = $1 RETURNING "_id") SELECT "_id"::text AS "_id" FROM "requeued"`,
          [FIRST_PAGED_AT_ANCHOR_TYPE],
        ),
      ).length;
    }

    return result;
  }
}
