import RedactLatestIncomingRequests from "../../../FeatureSet/Workers/DataMigrations/RedactLatestIncomingRequests";
import Entities from "Common/Models/DatabaseModels/Index";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import DatabaseService from "Common/Server/Services/DatabaseService";
import MonitorService from "Common/Server/Services/MonitorService";
import logger from "Common/Server/Utils/Logger";
import LatestIncomingRequest, {
  LatestIncomingRequestColumns,
  ReadersCopyRewrite,
} from "Common/Server/Utils/Monitor/LatestIncomingRequest";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import { JSONObject } from "Common/Types/JSON";
import IncomingMonitorRequest from "Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import Permission, { UserPermission } from "Common/Types/Permission";
import UserType from "Common/Types/UserType";
import { DataSource } from "Common/node_modules/typeorm";

/*
 * AN INCOMING REQUEST MONITOR'S LATEST REQUEST, KEPT TWICE, ON A MIGRATED
 * POSTGRES (#6402).
 *
 * Monitor.incomingMonitorRequest is the copy people read, cut as the
 * monitor's logs are; Monitor.incomingMonitorRequestAsReceived, added by
 * 1809080466402-AddIncomingMonitorRequestAsReceived, is the request as it
 * came, which only the server reads. Only Postgres can show:
 *
 *  - the column the migration adds is a nullable jsonb, as the entity says;
 *  - the ingest's one statement writes both copies, each as jsonb accepts;
 *  - changing Keep request content writes the copy people read again from
 *    the request as it came - a compare-and-set whose expected values are
 *    the jsonb the monitor was read with, which Postgres must find equal to
 *    what it holds, keys reordered and numbers respelled - and a request
 *    that came in meanwhile is never overwritten;
 *  - RedactLatestIncomingRequests splits each monitor's request kept once,
 *    as it came, leaves deleted monitors alone, and changes nothing the
 *    second time;
 *  - a Viewer's real select returns the cut copy and nothing of the
 *    request as it came, and asking for it is refused.
 *
 * Opt in with RUN_POSTGRES_LATEST_INCOMING_REQUEST_TESTS=true against a
 * Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database, right after its drift check. The Monitor table's
 * STRUCTURE is cloned into a unique schema (search_path holds only that
 * schema), dropped afterwards. Credentials from DATABASE_USERNAME /
 * DATABASE_PASSWORD, database from LATEST_INCOMING_REQUEST_TEST_DATABASE_NAME
 * or DATABASE_NAME, endpoint from LATEST_INCOMING_REQUEST_TEST_DATABASE_HOST
 * / _PORT (default localhost:5400).
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_LATEST_INCOMING_REQUEST_TESTS"] === "true"
    ? describe
    : describe.skip;

// A statement that waits on a lock fails instead of hanging the suite.
const LOCK_TIMEOUT_MS: number = 5000;

const DASHES: RegExp = /-/g;

const REDACTED: string = "[REDACTED]";
const LIVE_TOKEN: string = "example-live-token-7f3a9c2b";

interface StoredCopies {
  keepResponseContent: boolean;
  incomingMonitorRequest: JSONObject | null;
  incomingMonitorRequestAsReceived: JSONObject | null;
}

describePostgres(
  "an incoming request monitor's latest request (Postgres)",
  () => {
    const schema: string = `latest_incoming_request_${ObjectID.generate()
      .toString()
      .replace(DASHES, "")}`;
    const projectId: ObjectID = ObjectID.generate();
    const operationalStatusId: ObjectID = ObjectID.generate();

    let database: DataSource;

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["LATEST_INCOMING_REQUEST_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["LATEST_INCOMING_REQUEST_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["LATEST_INCOMING_REQUEST_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        extra: {
          options: `-c search_path=${schema} -c lock_timeout=${LOCK_TIMEOUT_MS}`,
        },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);
      await database.query(
        `CREATE TABLE "${schema}"."Monitor" (LIKE public."Monitor" INCLUDING ALL)`,
      );
    }, 120000);

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

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database as never);

      // Live updates and workflows are not what this is about.
      jest
        .spyOn(DatabaseService.prototype, "onTriggerRealtime")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(DatabaseService.prototype, "onTriggerWorkflow")
        .mockResolvedValue(undefined as never);

      await database.query(`DELETE FROM "${schema}"."Monitor"`);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    // A deploy hook, as its sender sent it.
    function deployHook(
      monitorId: ObjectID,
      at: string,
      body: JSONObject = {
        status: "deployed",
        deployedBy: "jane@acme.example",
      },
    ): IncomingMonitorRequest {
      return {
        projectId: projectId,
        monitorId: monitorId,
        requestMethod: HTTPMethod.POST,
        requestHeaders: {
          "content-type": "application/json",
          authorization: `Bearer ${LIVE_TOKEN}`,
        },
        requestBody: body,
        incomingRequestReceivedAt: new Date(at),
        checkedAt: new Date(at),
        onlyCheckForIncomingRequestReceivedAt: false,
      } as IncomingMonitorRequest;
    }

    async function insertMonitor(data: {
      keepResponseContent: boolean;
      incomingMonitorRequest?: unknown;
      incomingMonitorRequestAsReceived?: unknown;
      deletedAt?: Date | null;
    }): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();

      await database.query(
        `INSERT INTO "${schema}"."Monitor" ("_id", "version", "projectId", "name", "slug", "monitorType", "currentMonitorStatusId", "keepResponseContent", "incomingMonitorRequest", "incomingMonitorRequestAsReceived", "deletedAt") VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10)`,
        [
          id.toString(),
          projectId.toString(),
          `Deploy hook ${id.toString()}`,
          `deploy-hook-${id.toString()}`,
          MonitorType.IncomingRequest,
          // Foreign keys are not cloned: any status id stands in.
          operationalStatusId.toString(),
          data.keepResponseContent,
          data.incomingMonitorRequest === undefined
            ? null
            : JSON.stringify(data.incomingMonitorRequest),
          data.incomingMonitorRequestAsReceived === undefined
            ? null
            : JSON.stringify(data.incomingMonitorRequestAsReceived),
          data.deletedAt || null,
        ],
      );

      return id;
    }

    // What the ingest writes for a request, in its one statement (MonitorResource).
    async function ingest(
      monitorId: ObjectID,
      request: IncomingMonitorRequest,
      keepResponseContent: boolean,
    ): Promise<void> {
      const columns: LatestIncomingRequestColumns =
        LatestIncomingRequest.toColumns({
          request: request,
          keepResponseContent: keepResponseContent,
        });

      await MonitorService.updateColumnsByIdWithoutHooks({
        id: monitorId,
        data: {
          incomingRequestMonitorHeartbeatCheckedAt: new Date(),
          incomingMonitorRequest: columns.incomingMonitorRequest,
          incomingMonitorRequestAsReceived:
            columns.incomingMonitorRequestAsReceived,
        } as never,
      });
    }

    // The save that changes the switch, as the row holds it afterwards.
    async function setSwitch(
      monitorId: ObjectID,
      keepResponseContent: boolean,
    ): Promise<void> {
      await database.query(
        `UPDATE "${schema}"."Monitor" SET "keepResponseContent" = $1 WHERE "_id" = $2`,
        [keepResponseContent, monitorId.toString()],
      );
    }

    async function storedCopies(monitorId: ObjectID): Promise<StoredCopies> {
      const rows: Array<StoredCopies> = await database.query(
        `SELECT "keepResponseContent", "incomingMonitorRequest", "incomingMonitorRequestAsReceived" FROM "${schema}"."Monitor" WHERE "_id" = $1`,
        [monitorId.toString()],
      );

      expect(rows).toHaveLength(1);

      return rows[0]!;
    }

    function viewer(): DatabaseCommonInteractionProps {
      return {
        tenantId: projectId,
        userId: ObjectID.generate(),
        userType: UserType.User,
        userTenantAccessPermission: {
          [projectId.toString()]: {
            _type: "UserTenantAccessPermission",
            projectId: projectId,
            permissions: [
              {
                _type: "UserPermission",
                permission: Permission.Viewer,
                labelIds: [],
                isBlockPermission: false,
              } as UserPermission,
            ],
          },
        },
      } as unknown as DatabaseCommonInteractionProps;
    }

    test("the migration's column is a nullable jsonb beside the copy people read", async () => {
      const columns: Array<{
        column_name: string;
        data_type: string;
        is_nullable: string;
      }> = await database.query(
        `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Monitor' AND column_name IN ('incomingMonitorRequest', 'incomingMonitorRequestAsReceived') ORDER BY column_name`,
      );

      expect(columns).toEqual([
        {
          column_name: "incomingMonitorRequest",
          data_type: "jsonb",
          is_nullable: "YES",
        },
        {
          column_name: "incomingMonitorRequestAsReceived",
          data_type: "jsonb",
          is_nullable: "YES",
        },
      ]);
    });

    test("a request that comes in is written twice in one statement: as it came, and cut", async () => {
      const id: ObjectID = await insertMonitor({ keepResponseContent: true });

      await ingest(id, deployHook(id, "2026-11-09T08:00:00.000Z"), true);

      const stored: StoredCopies = await storedCopies(id);

      expect(
        stored.incomingMonitorRequestAsReceived!["requestHeaders"],
      ).toEqual({
        "content-type": "application/json",
        authorization: `Bearer ${LIVE_TOKEN}`,
      });
      expect(stored.incomingMonitorRequest!["requestHeaders"]).toEqual({
        "content-type": "application/json",
        authorization: REDACTED,
      });
      expect(stored.incomingMonitorRequest!["requestBody"]).toEqual({
        status: "deployed",
        deployedBy: REDACTED,
      });
      expect(JSON.stringify(stored.incomingMonitorRequest)).not.toContain(
        LIVE_TOKEN,
      );
    });

    test("turning Keep request content off takes the headers and body out of the copy people read; on again brings them back", async () => {
      const id: ObjectID = await insertMonitor({ keepResponseContent: true });
      await ingest(id, deployHook(id, "2026-11-09T08:00:00.000Z"), true);
      const asItCame: JSONObject = (await storedCopies(id))
        .incomingMonitorRequestAsReceived!;

      await setSwitch(id, false);
      await expect(
        MonitorService.rewriteLatestIncomingRequestForReaders(id),
      ).resolves.toBe(true);

      let stored: StoredCopies = await storedCopies(id);

      expect(stored.incomingMonitorRequest!["requestHeaders"]).toBeUndefined();
      expect(stored.incomingMonitorRequest!["requestBody"]).toBeUndefined();
      expect(stored.incomingMonitorRequest!["isResponseContentOmitted"]).toBe(
        true,
      );
      expect(stored.incomingMonitorRequestAsReceived).toEqual(asItCame);

      await setSwitch(id, true);
      await expect(
        MonitorService.rewriteLatestIncomingRequestForReaders(id),
      ).resolves.toBe(true);

      stored = await storedCopies(id);

      expect(stored.incomingMonitorRequest!["requestHeaders"]).toEqual({
        "content-type": "application/json",
        authorization: REDACTED,
      });
      expect(
        stored.incomingMonitorRequest!["isResponseContentOmitted"],
      ).toBeUndefined();
      expect(stored.incomingMonitorRequestAsReceived).toEqual(asItCame);
    });

    test("the compare-and-set finds what it read in what Postgres keeps, keys reordered and numbers respelled", async () => {
      const id: ObjectID = await insertMonitor({ keepResponseContent: true });
      await ingest(
        id,
        deployHook(id, "2026-11-09T08:00:00.000Z", {
          zeta: 1,
          alpha: [1.5, 2.0, { name: "Jürgen ✓", nested: { b: true, a: null } }],
          large: 1e21,
          small: 5e-7,
          empty: {},
          text: "line one\nline two",
        }),
        true,
      );

      await setSwitch(id, false);

      await expect(
        MonitorService.rewriteLatestIncomingRequestForReaders(id),
      ).resolves.toBe(true);
      expect(
        (await storedCopies(id)).incomingMonitorRequest![
          "isResponseContentOmitted"
        ],
      ).toBe(true);
    });

    test("a request that came in after the monitor was read wins: nothing is written over it", async () => {
      const id: ObjectID = await insertMonitor({ keepResponseContent: true });
      await ingest(id, deployHook(id, "2026-11-09T08:00:00.000Z"), true);
      await setSwitch(id, false);

      // Read for the rewrite...
      const read: Monitor | null = await MonitorService.findOneById({
        id: id,
        select: {
          keepResponseContent: true,
          incomingMonitorRequest: true,
          incomingMonitorRequestAsReceived: true,
        },
        props: { isRoot: true },
      });
      const rewrite: ReadersCopyRewrite | null =
        LatestIncomingRequest.getReadersCopyRewrite(read!);

      // ...then a new request, written by the ingest.
      await ingest(id, deployHook(id, "2026-11-09T08:05:00.000Z"), false);
      const afterTheRequest: StoredCopies = await storedCopies(id);

      await expect(
        MonitorService.compareAndSetColumnsByIdWithoutHooks({
          id: id,
          data: rewrite!.data as never,
          expectedData: rewrite!.expectedData as never,
          skipUpdateDateColumn: true,
        }),
      ).resolves.toBe(false);

      expect(await storedCopies(id)).toEqual(afterTheRequest);
      expect(
        afterTheRequest.incomingMonitorRequestAsReceived!["checkedAt"],
      ).toBe("2026-11-09T08:05:00.000Z");
    });

    test("a switch saved again after the read is not written over either", async () => {
      const id: ObjectID = await insertMonitor({ keepResponseContent: true });
      await ingest(id, deployHook(id, "2026-11-09T08:00:00.000Z"), true);
      await setSwitch(id, false);

      const read: Monitor | null = await MonitorService.findOneById({
        id: id,
        select: {
          keepResponseContent: true,
          incomingMonitorRequest: true,
          incomingMonitorRequestAsReceived: true,
        },
        props: { isRoot: true },
      });
      const rewrite: ReadersCopyRewrite | null =
        LatestIncomingRequest.getReadersCopyRewrite(read!);

      // Turned back on meanwhile: that save writes its own copy.
      await setSwitch(id, true);

      await expect(
        MonitorService.compareAndSetColumnsByIdWithoutHooks({
          id: id,
          data: rewrite!.data as never,
          expectedData: rewrite!.expectedData as never,
          skipUpdateDateColumn: true,
        }),
      ).resolves.toBe(false);

      expect(
        (await storedCopies(id)).incomingMonitorRequest!["requestHeaders"],
      ).toBeDefined();
    });

    test("the copy is written again without moving updatedAt: the save that changed the switch moved it", async () => {
      const id: ObjectID = await insertMonitor({ keepResponseContent: true });
      await ingest(id, deployHook(id, "2026-11-09T08:00:00.000Z"), true);
      await database.query(
        `UPDATE "${schema}"."Monitor" SET "updatedAt" = '2026-11-09T09:00:00.000Z' WHERE "_id" = $1`,
        [id.toString()],
      );
      await setSwitch(id, false);

      await MonitorService.rewriteLatestIncomingRequestForReaders(id);

      const rows: Array<{ updatedAt: Date }> = await database.query(
        `SELECT "updatedAt" FROM "${schema}"."Monitor" WHERE "_id" = $1`,
        [id.toString()],
      );

      expect(new Date(rows[0]!.updatedAt).toISOString()).toBe(
        "2026-11-09T09:00:00.000Z",
      );
    });

    describe("RedactLatestIncomingRequests", () => {
      test("splits each request kept once, leaves deleted monitors and empty ones alone, and changes nothing the second time", async () => {
        const unsplitId: ObjectID = ObjectID.generate();
        const unsplit: JSONObject = JSON.parse(
          JSON.stringify(deployHook(unsplitId, "2026-11-08T22:00:00.000Z")),
        );

        const keptId: ObjectID = await insertMonitor({
          keepResponseContent: true,
          incomingMonitorRequest: unsplit,
        });
        const quietId: ObjectID = await insertMonitor({
          keepResponseContent: false,
          incomingMonitorRequest: unsplit,
        });
        const deletedId: ObjectID = await insertMonitor({
          keepResponseContent: true,
          incomingMonitorRequest: unsplit,
          deletedAt: new Date("2026-11-01T00:00:00.000Z"),
        });
        const emptyId: ObjectID = await insertMonitor({
          keepResponseContent: true,
        });

        await new RedactLatestIncomingRequests().migrate();

        const kept: StoredCopies = await storedCopies(keptId);
        expect(kept.incomingMonitorRequestAsReceived).toEqual(unsplit);
        expect(kept.incomingMonitorRequest!["requestHeaders"]).toEqual({
          "content-type": "application/json",
          authorization: REDACTED,
        });

        const quiet: StoredCopies = await storedCopies(quietId);
        expect(quiet.incomingMonitorRequestAsReceived).toEqual(unsplit);
        expect(quiet.incomingMonitorRequest!["requestBody"]).toBeUndefined();
        expect(quiet.incomingMonitorRequest!["isResponseContentOmitted"]).toBe(
          true,
        );

        // A deleted monitor is nobody's to read: left as it was.
        const deleted: StoredCopies = await storedCopies(deletedId);
        expect(deleted.incomingMonitorRequest).toEqual(unsplit);
        expect(deleted.incomingMonitorRequestAsReceived).toBeNull();

        const empty: StoredCopies = await storedCopies(emptyId);
        expect(empty.incomingMonitorRequest).toBeNull();
        expect(empty.incomingMonitorRequestAsReceived).toBeNull();

        const afterFirstRun: Array<StoredCopies> = [
          await storedCopies(keptId),
          await storedCopies(quietId),
        ];

        await new RedactLatestIncomingRequests().migrate();

        expect([
          await storedCopies(keptId),
          await storedCopies(quietId),
        ]).toEqual(afterFirstRun);
      });
    });

    describe("a Viewer's reads", () => {
      test("the overview's select returns the cut copy, and nothing of the request as it came", async () => {
        const id: ObjectID = await insertMonitor({ keepResponseContent: true });
        await ingest(id, deployHook(id, "2026-11-09T08:00:00.000Z"), true);

        const monitor: Monitor | null = await MonitorService.findOneById({
          id: id,
          select: {
            name: true,
            monitorType: true,
            incomingRequestMonitorHeartbeatCheckedAt: true,
            incomingMonitorRequest: true,
          },
          props: viewer(),
        });

        expect(monitor?.incomingMonitorRequest?.requestHeaders).toEqual({
          "content-type": "application/json",
          authorization: REDACTED,
        });
        expect(monitor?.incomingMonitorRequestAsReceived).toBeUndefined();
        expect(JSON.stringify(monitor)).not.toContain(LIVE_TOKEN);
      });

      test("asking for the request as it came is refused", async () => {
        const id: ObjectID = await insertMonitor({ keepResponseContent: true });
        await ingest(id, deployHook(id, "2026-11-09T08:00:00.000Z"), true);

        await expect(
          MonitorService.findOneById({
            id: id,
            select: { incomingMonitorRequestAsReceived: true },
            props: viewer(),
          }),
        ).rejects.toBeInstanceOf(NotAuthorizedException);
      });
    });
  },
);
