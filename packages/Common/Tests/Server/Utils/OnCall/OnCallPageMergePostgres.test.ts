import Entities from "../../../../Models/DatabaseModels/Index";
import UserOnCallLog from "../../../../Models/DatabaseModels/UserOnCallLog";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import OnCallDutyPolicyExecutionLogTimelineService from "../../../../Server/Services/OnCallDutyPolicyExecutionLogTimelineService";
import UserOnCallLogService from "../../../../Server/Services/UserOnCallLogService";
import logger from "../../../../Server/Utils/Logger";
import OnCallPageMerge, {
  OnCallMergedPageReading,
  OnCallMergedPageStanding,
  OnCallPageCover,
  OnCallPageMergeRecordOf,
} from "../../../../Server/Utils/OnCall/OnCallPageMerge";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import OnCallDutyExecutionLogTimelineStatus from "../../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import OnCallDutyPolicyStatus from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import { getOnCallPageMergeTakenOverMessage } from "../../../../Types/OnCallDutyPolicy/OnCallPageMerge";
import UserNotificationEventType from "../../../../Types/UserNotification/UserNotificationEventType";
import UserNotificationExecutionStatus from "../../../../Types/UserNotification/UserNotificationExecutionStatus";
import { DataSource } from "typeorm";

/*
 * ONE PAGE FOR SOMEBODY TWO POLICIES PAGE ABOUT ONE RECORD, AGAINST A
 * MIGRATED POSTGRES (issue #7837).
 *
 * The unit suites fake the services, so they cannot tell whether the reads
 * that merge pages run at all: a relation selected by a wrong name, or a
 * column the migration did not add, would throw - and every one of these
 * reads is best effort, so a merge read that throws merges nothing and
 * pages everybody as before, with nothing failing. These run the reads and
 * the take-over write as TypeORM sends them:
 *
 *   - findCovers: the open page another policy's run has of somebody a
 *     level pages, with that policy's name; only an open page (still
 *     sending, or all sent with its run still paging) of a run that may
 *     stand for theirs; their first; nobody for a run whose pages are never
 *     merged; an alert's pages by the alert;
 *   - readMergedPage, on a merged page read back from the database (its
 *     status and mergedIntoUserOnCallLogId): waits, answered with when, or
 *     takes the page over with what the other page sent (nothing after a
 *     failure, and from the start when that page is gone);
 *   - takeOverMergedPage writes what the other page sent as a JSON object
 *     the atomic claim reads, so what reached them is not sent again and
 *     the rest is;
 *   - findMergedPagesToAnswer: their merged pages about the record, only.
 *
 * Nothing may log an error: a merge read that failed into "paging everybody
 * as before", or a claim that fell back to its non-atomic write, fails the
 * test it happened in.
 *
 * Opt in with RUN_POSTGRES_ONCALL_PAGE_MERGE_TESTS=true against a Postgres
 * migrated to the current head - the Postgres Schema Drift workflow's
 * database right after its drift check. The UserOnCallLog,
 * OnCallDutyPolicyExecutionLog, OnCallDutyPolicy and
 * OnCallDutyPolicyExecutionLogTimeline tables' STRUCTURE is cloned into a
 * unique schema (search_path holds only that schema) that is dropped
 * afterwards; every row is synthetic. Credentials from DATABASE_USERNAME /
 * DATABASE_PASSWORD, database from ONCALL_PAGE_MERGE_TEST_DATABASE_NAME or
 * DATABASE_NAME, endpoint from ONCALL_PAGE_MERGE_TEST_DATABASE_HOST / _PORT
 * (default localhost:5400, Scripts/Dev/docker-compose.dev.yml).
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_ONCALL_PAGE_MERGE_TESTS"] === "true"
    ? describe
    : describe.skip;

const MINUTE: number = 60 * 1000;

const TABLES: Array<string> = [
  "UserOnCallLog",
  "OnCallDutyPolicyExecutionLog",
  "OnCallDutyPolicy",
  "OnCallDutyPolicyExecutionLogTimeline",
];

// What the other page sent, by claim key, as the claims write it.
const SENT_AT: string = "2026-11-16T08:00:00.000Z";
const CLAIMS_SENT: JSONObject = {
  "rule-1": SENT_AT,
  "rule-1:repeat:1": "2026-11-16T08:05:00.000Z",
};

type RecordColumn = "triggeredByIncidentId" | "triggeredByAlertId";

interface RecordFixture {
  column: RecordColumn;
  id: ObjectID;
}

interface RunFixture {
  policyId: ObjectID | null;
  status?: OnCallDutyPolicyStatus | undefined;
  triggeredByUserId?: ObjectID | undefined;
  pageAgainNumber?: number | undefined;
  isObserverPage?: boolean | undefined;
  userNotificationEventType?: UserNotificationEventType | undefined;
}

interface PageFixture {
  userId: ObjectID;
  runId: ObjectID;
  policyId: ObjectID | null;
  status: UserNotificationExecutionStatus;
  record?: RecordFixture | undefined;
  projectId?: ObjectID | undefined;
  createdAt?: Date | undefined;
  acknowledgedAt?: Date | undefined;
  userNotificationEventType?: UserNotificationEventType | undefined;
  executedNotificationRules?: JSONObject | undefined;
  mergedIntoUserOnCallLogId?: ObjectID | undefined;
  lineId?: ObjectID | undefined;
}

interface CoverRow {
  user: string;
  page: string;
  run: string;
  policyName: string | null;
}

function idOf(id: ObjectID | string | undefined | null): string {
  return (id || "").toString().toLowerCase();
}

function coverRows(covers: Map<string, OnCallPageCover>): Array<CoverRow> {
  return [...covers.entries()]
    .map(([user, cover]: [string, OnCallPageCover]): CoverRow => {
      return {
        user: user,
        page: idOf(cover.userOnCallLogId),
        run: idOf(cover.executionLogId),
        policyName: cover.policyName,
      };
    })
    .sort((a: CoverRow, b: CoverRow): number => {
      return a.user.localeCompare(b.user);
    });
}

describePostgres(
  "one page for somebody two policies page, against Postgres",
  () => {
    const schema: string = `oncall_page_merge_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;
    const projectId: ObjectID = ObjectID.generate();
    let database: DataSource;
    let incidentId: ObjectID;
    let loggedErrors: jest.SpyInstance;

    async function cloneTable(table: string): Promise<void> {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
      // A fixture names only what the reads touch; the key stays NOT NULL.
      const columns: Array<{ column_name: string }> = await database.query(
        `SELECT column_name FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2 AND is_nullable = 'NO' AND column_name <> '_id'`,
        [schema, table],
      );
      for (const column of columns) {
        await database.query(
          `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
        );
      }
    }

    async function addPolicy(name: string): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      await database.query(
        `INSERT INTO "${schema}"."OnCallDutyPolicy" ("_id", "projectId", "name", "version")
        VALUES ($1, $2, $3, 1)`,
        [id.toString(), projectId.toString(), name],
      );
      return id;
    }

    async function addRun(run: RunFixture): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      await database.query(
        `INSERT INTO "${schema}"."OnCallDutyPolicyExecutionLog"
          ("_id", "projectId", "onCallDutyPolicyId", "status", "triggeredByIncidentId",
           "userNotificationEventType", "triggeredByUserId", "pageAgainNumber", "isObserverPage", "version")
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1)`,
        [
          id.toString(),
          projectId.toString(),
          run.policyId ? run.policyId.toString() : null,
          run.status || OnCallDutyPolicyStatus.Executing,
          incidentId.toString(),
          run.userNotificationEventType ||
            UserNotificationEventType.IncidentCreated,
          run.triggeredByUserId ? run.triggeredByUserId.toString() : null,
          run.pageAgainNumber || 0,
          Boolean(run.isObserverPage),
        ],
      );
      return id;
    }

    async function addPage(page: PageFixture): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      const record: RecordFixture = page.record || {
        column: "triggeredByIncidentId",
        id: incidentId,
      };
      await database.query(
        `INSERT INTO "${schema}"."UserOnCallLog"
          ("_id", "projectId", "userId", "status", "${record.column}", "userNotificationEventType",
           "onCallDutyPolicyExecutionLogId", "onCallDutyPolicyId", "onCallDutyPolicyExecutionLogTimelineId",
           "createdAt", "acknowledgedAt", "executedNotificationRules", "mergedIntoUserOnCallLogId", "version")
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 1)`,
        [
          id.toString(),
          (page.projectId || projectId).toString(),
          page.userId.toString(),
          page.status,
          record.id.toString(),
          page.userNotificationEventType ||
            UserNotificationEventType.IncidentCreated,
          page.runId.toString(),
          page.policyId ? page.policyId.toString() : null,
          page.lineId ? page.lineId.toString() : null,
          (page.createdAt || new Date()).toISOString(),
          page.acknowledgedAt ? page.acknowledgedAt.toISOString() : null,
          page.executedNotificationRules
            ? JSON.stringify(page.executedNotificationRules)
            : null,
          page.mergedIntoUserOnCallLogId
            ? page.mergedIntoUserOnCallLogId.toString()
            : null,
        ],
      );
      return id;
    }

    async function addLine(
      runId: ObjectID,
      status: OnCallDutyExecutionLogTimelineStatus,
    ): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      await database.query(
        `INSERT INTO "${schema}"."OnCallDutyPolicyExecutionLogTimeline"
          ("_id", "projectId", "onCallDutyPolicyExecutionLogId", "status", "statusMessage", "version")
        VALUES ($1, $2, $3, $4, $5, 1)`,
        [id.toString(), projectId.toString(), runId.toString(), status, ""],
      );
      return id;
    }

    async function setPage(
      id: ObjectID,
      columns: {
        status?: UserNotificationExecutionStatus;
        acknowledgedAt?: Date | null;
        executedNotificationRules?: JSONObject;
      },
    ): Promise<void> {
      if (columns.status) {
        await database.query(
          `UPDATE "${schema}"."UserOnCallLog" SET "status" = $2 WHERE "_id" = $1`,
          [id.toString(), columns.status],
        );
      }
      if (columns.acknowledgedAt !== undefined) {
        await database.query(
          `UPDATE "${schema}"."UserOnCallLog" SET "acknowledgedAt" = $2 WHERE "_id" = $1`,
          [
            id.toString(),
            columns.acknowledgedAt
              ? columns.acknowledgedAt.toISOString()
              : null,
          ],
        );
      }
      if (columns.executedNotificationRules) {
        await database.query(
          `UPDATE "${schema}"."UserOnCallLog" SET "executedNotificationRules" = $2 WHERE "_id" = $1`,
          [id.toString(), JSON.stringify(columns.executedNotificationRules)],
        );
      }
    }

    async function setRunStatus(
      id: ObjectID,
      status: OnCallDutyPolicyStatus,
    ): Promise<void> {
      await database.query(
        `UPDATE "${schema}"."OnCallDutyPolicyExecutionLog" SET "status" = $2 WHERE "_id" = $1`,
        [id.toString(), status],
      );
    }

    async function findCovers(data: {
      runId: ObjectID;
      userIds: Array<ObjectID>;
      record?: OnCallPageMergeRecordOf | undefined;
      userNotificationEventType?: UserNotificationEventType | undefined;
    }): Promise<Array<CoverRow>> {
      return coverRows(
        await OnCallPageMerge.findCovers({
          projectId: projectId,
          executionLogId: data.runId,
          userNotificationEventType:
            data.userNotificationEventType ||
            UserNotificationEventType.IncidentCreated,
          record: data.record || { triggeredByIncidentId: incidentId },
          userIds: data.userIds,
        }),
      );
    }

    // A merged page as the person's-log worker reads it, from the database.
    async function readMergedPageBack(
      id: ObjectID,
    ): Promise<OnCallMergedPageReading> {
      const page: UserOnCallLog | null = await UserOnCallLogService.findOneById(
        {
          id: id,
          select: {
            _id: true,
            status: true,
            mergedIntoUserOnCallLogId: true,
          },
          props: {
            isRoot: true,
          },
        },
      );

      expect(page?.status).toBe(UserNotificationExecutionStatus.AlreadyPaged);

      return await OnCallPageMerge.readMergedPage(page!);
    }

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["ONCALL_PAGE_MERGE_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["ONCALL_PAGE_MERGE_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["ONCALL_PAGE_MERGE_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        extra: {
          options: `-c search_path=${schema}`,
        },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);
      for (const table of TABLES) {
        await cloneTable(table);
      }
      expect(
        (await database.query("SELECT current_schema()"))[0].current_schema,
      ).toBe(schema);
    });

    afterAll(async () => {
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    beforeEach(async () => {
      for (const level of ["debug", "info", "warn"] as const) {
        jest.spyOn(logger, level).mockImplementation(() => {
          return undefined as never;
        });
      }
      loggedErrors = jest.spyOn(logger, "error").mockImplementation(() => {
        return undefined as never;
      });
      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

      incidentId = ObjectID.generate();
      for (const table of TABLES) {
        await database.query(`DELETE FROM "${schema}"."${table}"`);
      }
    });

    afterEach(() => {
      /*
       * A merge read that threw logs it and merges nothing, and a claim
       * that fell back logs it too: either would pass a test that expects
       * nobody merged, or a claim refused, for the wrong reason.
       */
      expect(loggedErrors).not.toHaveBeenCalled();
      jest.restoreAllMocks();
    });

    test("a level finds the open page another policy's run has of somebody it pages, with that policy's name", async () => {
      const payments: ObjectID = await addPolicy("Payments");
      const billing: ObjectID = await addPolicy("Billing");
      const paymentsRun: ObjectID = await addRun({ policyId: payments });
      const billingRun: ObjectID = await addRun({ policyId: billing });
      const ana: ObjectID = ObjectID.generate();
      const ben: ObjectID = ObjectID.generate();
      const anaPage: ObjectID = await addPage({
        userId: ana,
        runId: paymentsRun,
        policyId: payments,
        status: UserNotificationExecutionStatus.Executing,
      });

      expect(
        await findCovers({ runId: billingRun, userIds: [ana, ben] }),
      ).toEqual([
        {
          user: idOf(ana),
          page: idOf(anaPage),
          run: idOf(paymentsRun),
          policyName: "Payments",
        },
      ]);
    });

    test("only an open page of a run that may stand for theirs is merged into", async () => {
      const payments: ObjectID = await addPolicy("Payments");
      const billing: ObjectID = await addPolicy("Billing");
      const paymentsRun: ObjectID = await addRun({ policyId: payments });
      const billingRun: ObjectID = await addRun({ policyId: billing });
      const stoppedRun: ObjectID = await addRun({
        policyId: payments,
        status: OnCallDutyPolicyStatus.Completed,
      });
      const observerRun: ObjectID = await addRun({
        policyId: payments,
        isObserverPage: true,
      });
      const directPage: ObjectID = await addRun({
        policyId: null,
        triggeredByUserId: ObjectID.generate(),
      });

      const people: Record<string, ObjectID> = {};
      const person: (name: string) => ObjectID = (name: string): ObjectID => {
        people[name] = people[name] || ObjectID.generate();
        return people[name]!;
      };

      // All its notifications went out, and its run still pages: open.
      await addPage({
        userId: person("all sent, run still paging"),
        runId: paymentsRun,
        policyId: payments,
        status: UserNotificationExecutionStatus.Completed,
      });

      // This run's own page of them is its own.
      await addPage({
        userId: person("this run's own page"),
        runId: billingRun,
        policyId: billing,
        status: UserNotificationExecutionStatus.Executing,
      });
      await addPage({
        userId: person("answered"),
        runId: paymentsRun,
        policyId: payments,
        status: UserNotificationExecutionStatus.Executing,
        acknowledgedAt: new Date(Date.now() - MINUTE),
      });
      await addPage({
        userId: person("about another incident"),
        runId: paymentsRun,
        policyId: payments,
        status: UserNotificationExecutionStatus.Executing,
        record: { column: "triggeredByIncidentId", id: ObjectID.generate() },
      });
      await addPage({
        userId: person("in another project"),
        runId: paymentsRun,
        policyId: payments,
        status: UserNotificationExecutionStatus.Executing,
        projectId: ObjectID.generate(),
      });
      await addPage({
        userId: person("all sent, run stopped"),
        runId: stoppedRun,
        policyId: payments,
        status: UserNotificationExecutionStatus.Completed,
      });
      await addPage({
        userId: person("failed"),
        runId: paymentsRun,
        policyId: payments,
        status: UserNotificationExecutionStatus.Error,
      });
      await addPage({
        userId: person("escalated"),
        runId: paymentsRun,
        policyId: payments,
        status: UserNotificationExecutionStatus.PassedOn,
      });
      // A merged page stands on another; nothing is merged into it.
      await addPage({
        userId: person("merged itself"),
        runId: paymentsRun,
        policyId: payments,
        status: UserNotificationExecutionStatus.AlreadyPaged,
      });
      await addPage({
        userId: person("an observer's page"),
        runId: observerRun,
        policyId: payments,
        status: UserNotificationExecutionStatus.Executing,
      });
      await addPage({
        userId: person("a page from Slack"),
        runId: directPage,
        policyId: null,
        status: UserNotificationExecutionStatus.Executing,
      });

      const covers: Array<CoverRow> = await findCovers({
        runId: billingRun,
        userIds: Object.values(people),
      });

      expect(
        covers.map((cover: CoverRow): string => {
          return cover.user;
        }),
      ).toEqual([idOf(people["all sent, run still paging"])]);
      expect(covers[0]?.run).toBe(idOf(paymentsRun));
    });

    test("their first page is the one theirs is merged into", async () => {
      const payments: ObjectID = await addPolicy("Payments");
      const platform: ObjectID = await addPolicy("Platform");
      const billing: ObjectID = await addPolicy("Billing");
      const paymentsRun: ObjectID = await addRun({ policyId: payments });
      const platformRun: ObjectID = await addRun({ policyId: platform });
      const billingRun: ObjectID = await addRun({ policyId: billing });
      const ana: ObjectID = ObjectID.generate();

      await addPage({
        userId: ana,
        runId: paymentsRun,
        policyId: payments,
        status: UserNotificationExecutionStatus.Executing,
        createdAt: new Date(Date.now() - MINUTE),
      });
      const firstPage: ObjectID = await addPage({
        userId: ana,
        runId: platformRun,
        policyId: platform,
        status: UserNotificationExecutionStatus.Executing,
        createdAt: new Date(Date.now() - 5 * MINUTE),
      });

      expect(await findCovers({ runId: billingRun, userIds: [ana] })).toEqual([
        {
          user: idOf(ana),
          page: idOf(firstPage),
          run: idOf(platformRun),
          policyName: "Platform",
        },
      ]);
    });

    test("a policy started by hand, a page again and an observer's page merge nobody's page", async () => {
      const payments: ObjectID = await addPolicy("Payments");
      const billing: ObjectID = await addPolicy("Billing");
      const paymentsRun: ObjectID = await addRun({ policyId: payments });
      const ana: ObjectID = ObjectID.generate();
      await addPage({
        userId: ana,
        runId: paymentsRun,
        policyId: payments,
        status: UserNotificationExecutionStatus.Executing,
      });

      const byHand: ObjectID = await addRun({
        policyId: billing,
        triggeredByUserId: ObjectID.generate(),
      });
      const pageAgain: ObjectID = await addRun({
        policyId: billing,
        pageAgainNumber: 1,
      });
      const observers: ObjectID = await addRun({
        policyId: billing,
        isObserverPage: true,
      });

      for (const runId of [byHand, pageAgain, observers]) {
        expect(await findCovers({ runId: runId, userIds: [ana] })).toEqual([]);
      }

      // The automatic run beside them does merge into it.
      const automatic: ObjectID = await addRun({ policyId: billing });
      expect(
        (await findCovers({ runId: automatic, userIds: [ana] })).length,
      ).toBe(1);
    });

    test("an alert's pages are found by the alert", async () => {
      const payments: ObjectID = await addPolicy("Payments");
      const billing: ObjectID = await addPolicy("Billing");
      const alertCreated: UserNotificationEventType =
        UserNotificationEventType.AlertCreated;
      const paymentsRun: ObjectID = await addRun({
        policyId: payments,
        userNotificationEventType: alertCreated,
      });
      const billingRun: ObjectID = await addRun({
        policyId: billing,
        userNotificationEventType: alertCreated,
      });
      const alertId: ObjectID = ObjectID.generate();
      const ana: ObjectID = ObjectID.generate();
      const anaPage: ObjectID = await addPage({
        userId: ana,
        runId: paymentsRun,
        policyId: payments,
        status: UserNotificationExecutionStatus.Executing,
        record: { column: "triggeredByAlertId", id: alertId },
        userNotificationEventType: alertCreated,
      });

      expect(
        await findCovers({
          runId: billingRun,
          userIds: [ana],
          record: { triggeredByAlertId: alertId },
          userNotificationEventType: alertCreated,
        }),
      ).toEqual([
        {
          user: idOf(ana),
          page: idOf(anaPage),
          run: idOf(paymentsRun),
          policyName: "Payments",
        },
      ]);
      expect(
        await findCovers({
          runId: billingRun,
          userIds: [ana],
          record: { triggeredByAlertId: ObjectID.generate() },
          userNotificationEventType: alertCreated,
        }),
      ).toEqual([]);
    });

    test("a merged page, read back, waits while the page it stands on is open, and is answered with it", async () => {
      const payments: ObjectID = await addPolicy("Payments");
      const billing: ObjectID = await addPolicy("Billing");
      const paymentsRun: ObjectID = await addRun({ policyId: payments });
      const billingRun: ObjectID = await addRun({ policyId: billing });
      const ana: ObjectID = ObjectID.generate();
      const anaPage: ObjectID = await addPage({
        userId: ana,
        runId: paymentsRun,
        policyId: payments,
        status: UserNotificationExecutionStatus.Executing,
      });
      const merged: ObjectID = await addPage({
        userId: ana,
        runId: billingRun,
        policyId: billing,
        status: UserNotificationExecutionStatus.AlreadyPaged,
        mergedIntoUserOnCallLogId: anaPage,
      });

      expect(await readMergedPageBack(merged)).toEqual({
        standing: OnCallMergedPageStanding.Waits,
        claimsSent: {},
        policyName: "Payments",
      });

      // All sent, its run still paging: still open.
      await setPage(anaPage, {
        status: UserNotificationExecutionStatus.Completed,
      });
      expect((await readMergedPageBack(merged)).standing).toBe(
        OnCallMergedPageStanding.Waits,
      );

      const answeredAt: Date = new Date(SENT_AT);
      await setPage(anaPage, { acknowledgedAt: answeredAt });
      const answered: OnCallMergedPageReading =
        await readMergedPageBack(merged);
      expect(answered.standing).toBe(OnCallMergedPageStanding.Answered);
      expect(answered.acknowledgedAt?.toISOString()).toBe(
        answeredAt.toISOString(),
      );
    });

    test("a merged page takes the page over when the page it stands on ended without their answer", async () => {
      const payments: ObjectID = await addPolicy("Payments");
      const billing: ObjectID = await addPolicy("Billing");
      const paymentsRun: ObjectID = await addRun({ policyId: payments });
      const billingRun: ObjectID = await addRun({ policyId: billing });
      const ana: ObjectID = ObjectID.generate();
      const anaPage: ObjectID = await addPage({
        userId: ana,
        runId: paymentsRun,
        policyId: payments,
        status: UserNotificationExecutionStatus.Executing,
        executedNotificationRules: CLAIMS_SENT,
      });
      const merged: ObjectID = await addPage({
        userId: ana,
        runId: billingRun,
        policyId: billing,
        status: UserNotificationExecutionStatus.AlreadyPaged,
        mergedIntoUserOnCallLogId: anaPage,
      });

      // They escalated it from one of its messages: what it sent counts.
      await setPage(anaPage, {
        status: UserNotificationExecutionStatus.PassedOn,
      });
      expect(await readMergedPageBack(merged)).toEqual({
        standing: OnCallMergedPageStanding.TakesOver,
        claimsSent: CLAIMS_SENT,
        policyName: "Payments",
      });

      // All sent, and its policy stopped: what it sent counts.
      await setPage(anaPage, {
        status: UserNotificationExecutionStatus.Completed,
      });
      await setRunStatus(paymentsRun, OnCallDutyPolicyStatus.Completed);
      expect(await readMergedPageBack(merged)).toEqual({
        standing: OnCallMergedPageStanding.TakesOver,
        claimsSent: CLAIMS_SENT,
        policyName: "Payments",
      });

      // It failed: everything is sent again.
      await setPage(anaPage, {
        status: UserNotificationExecutionStatus.Error,
      });
      expect(await readMergedPageBack(merged)).toEqual({
        standing: OnCallMergedPageStanding.TakesOver,
        claimsSent: {},
        policyName: "Payments",
      });

      // It is gone: from the start.
      await database.query(
        `DELETE FROM "${schema}"."UserOnCallLog" WHERE "_id" = $1`,
        [anaPage.toString()],
      );
      expect(await readMergedPageBack(merged)).toEqual({
        standing: OnCallMergedPageStanding.TakesOver,
        claimsSent: {},
        policyName: null,
      });
    });

    test("taking the page over writes what the other page sent as its own, so only the rest is sent", async () => {
      const payments: ObjectID = await addPolicy("Payments");
      const billing: ObjectID = await addPolicy("Billing");
      const paymentsRun: ObjectID = await addRun({ policyId: payments });
      const billingRun: ObjectID = await addRun({ policyId: billing });
      const ana: ObjectID = ObjectID.generate();
      const anaPage: ObjectID = await addPage({
        userId: ana,
        runId: paymentsRun,
        policyId: payments,
        status: UserNotificationExecutionStatus.PassedOn,
        executedNotificationRules: CLAIMS_SENT,
      });
      const line: ObjectID = await addLine(
        billingRun,
        OnCallDutyExecutionLogTimelineStatus.AlreadyPaged,
      );
      const merged: ObjectID = await addPage({
        userId: ana,
        runId: billingRun,
        policyId: billing,
        status: UserNotificationExecutionStatus.AlreadyPaged,
        mergedIntoUserOnCallLogId: anaPage,
        lineId: line,
      });
      const lineWrites: jest.SpyInstance = jest
        .spyOn(OnCallDutyPolicyExecutionLogTimelineService, "updateOneById")
        .mockResolvedValue(undefined as never);

      const reading: OnCallMergedPageReading = await readMergedPageBack(merged);
      const message: string = getOnCallPageMergeTakenOverMessage({
        policyName: reading.policyName,
      });

      await UserOnCallLogService.takeOverMergedPage({
        userOnCallLogId: merged,
        statusMessage: message,
        executedNotificationRules: reading.claimsSent,
      });

      const rows: Array<{
        status: string;
        statusMessage: string;
        kind: string;
        hasSent: boolean;
        hasRepeat: boolean;
      }> = await database.query(
        `SELECT "status", "statusMessage",
          jsonb_typeof("executedNotificationRules") AS "kind",
          "executedNotificationRules" ? 'rule-1' AS "hasSent",
          "executedNotificationRules" ? 'rule-1:repeat:1' AS "hasRepeat"
        FROM "${schema}"."UserOnCallLog" WHERE "_id" = $1`,
        [merged.toString()],
      );
      expect(rows).toEqual([
        {
          status: UserNotificationExecutionStatus.Executing,
          statusMessage: message,
          kind: "object",
          hasSent: true,
          hasRepeat: true,
        },
      ]);

      // Its line says it pages them now.
      expect(lineWrites).toHaveBeenCalledTimes(1);
      expect(idOf(lineWrites.mock.calls[0][0].id)).toBe(idOf(line));
      expect(lineWrites.mock.calls[0][0].data).toEqual({
        status: OnCallDutyExecutionLogTimelineStatus.Executing,
        statusMessage: message,
      });

      // What reached them is not sent again; the rest is, once.
      for (const sent of Object.keys(CLAIMS_SENT)) {
        expect(
          await UserOnCallLogService.claimNotificationExecution({
            userOnCallLogId: merged,
            claimKey: sent,
          }),
        ).toBe(false);
      }
      expect(
        await UserOnCallLogService.claimNotificationExecution({
          userOnCallLogId: merged,
          claimKey: "rule-2",
        }),
      ).toBe(true);
      expect(
        await UserOnCallLogService.claimNotificationExecution({
          userOnCallLogId: merged,
          claimKey: "rule-2",
        }),
      ).toBe(false);
    });

    test("the merged pages answered with their answer are theirs about the record, and only those", async () => {
      const payments: ObjectID = await addPolicy("Payments");
      const billing: ObjectID = await addPolicy("Billing");
      const platform: ObjectID = await addPolicy("Platform");
      const paymentsRun: ObjectID = await addRun({ policyId: payments });
      const billingRun: ObjectID = await addRun({ policyId: billing });
      const platformRun: ObjectID = await addRun({ policyId: platform });
      const ana: ObjectID = ObjectID.generate();
      const ben: ObjectID = ObjectID.generate();
      const otherProject: ObjectID = ObjectID.generate();

      await addPage({
        userId: ana,
        runId: paymentsRun,
        policyId: payments,
        status: UserNotificationExecutionStatus.Executing,
      });
      const fromBilling: ObjectID = await addPage({
        userId: ana,
        runId: billingRun,
        policyId: billing,
        status: UserNotificationExecutionStatus.AlreadyPaged,
      });
      const fromPlatform: ObjectID = await addPage({
        userId: ana,
        runId: platformRun,
        policyId: platform,
        status: UserNotificationExecutionStatus.AlreadyPaged,
      });
      await addPage({
        userId: ana,
        runId: billingRun,
        policyId: billing,
        status: UserNotificationExecutionStatus.AlreadyPaged,
        record: { column: "triggeredByIncidentId", id: ObjectID.generate() },
      });
      await addPage({
        userId: ben,
        runId: billingRun,
        policyId: billing,
        status: UserNotificationExecutionStatus.AlreadyPaged,
      });
      const elsewhere: ObjectID = await addPage({
        userId: ana,
        runId: billingRun,
        policyId: billing,
        status: UserNotificationExecutionStatus.AlreadyPaged,
        projectId: otherProject,
      });

      const answered: (data: {
        projectId?: ObjectID | undefined;
      }) => Promise<Array<string>> = async (data: {
        projectId?: ObjectID | undefined;
      }): Promise<Array<string>> => {
        const pages: Array<UserOnCallLog> =
          await OnCallPageMerge.findMergedPagesToAnswer({
            projectId: data.projectId,
            userId: ana,
            record: { triggeredByIncidentId: incidentId },
          });
        return pages
          .map((page: UserOnCallLog): string => {
            expect(idOf(page.triggeredByIncidentId)).toBe(idOf(incidentId));
            return idOf(page.id);
          })
          .sort();
      };

      expect(await answered({ projectId: projectId })).toEqual(
        [idOf(fromBilling), idOf(fromPlatform)].sort(),
      );
      expect(await answered({})).toEqual(
        [idOf(fromBilling), idOf(fromPlatform), idOf(elsewhere)].sort(),
      );
    });
  },
);
