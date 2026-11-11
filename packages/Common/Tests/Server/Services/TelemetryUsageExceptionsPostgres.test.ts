import Entities from "../../../Models/DatabaseModels/Index";
import TelemetryUsageBilling from "../../../Models/DatabaseModels/TelemetryUsageBilling";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import DatabaseService from "../../../Server/Services/DatabaseService";
import ExceptionInstanceService from "../../../Server/Services/ExceptionInstanceService";
import LogService from "../../../Server/Services/LogService";
import MetricService from "../../../Server/Services/MetricService";
import PayAsYouGoBillingService from "../../../Server/Services/PayAsYouGoBillingService";
import ProfileSampleService from "../../../Server/Services/ProfileSampleService";
import ProfileService from "../../../Server/Services/ProfileService";
import RumSessionService from "../../../Server/Services/RumSessionService";
import SecurityEventService from "../../../Server/Services/SecurityEventService";
import SpanService from "../../../Server/Services/SpanService";
import TelemetryUsageBillingService from "../../../Server/Services/TelemetryUsageBillingService";
import { TracesDataIngestMetredPlan } from "../../../Server/Types/Billing/MeteredPlan/AllMeteredPlans";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import logger from "../../../Server/Utils/Logger";
import TelemetryUsageReads from "../../../Server/Utils/TelemetryUsage/TelemetryUsageReads";
import TelemetryUsageResourceNames from "../../../Server/Utils/TelemetryUsage/TelemetryUsageResourceNames";
import OneUptimeDate from "../../../Types/Date";
import ProductType from "../../../Types/MeteredPlan/ProductType";
import ObjectID from "../../../Types/ObjectID";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import {
  getTelemetryUsageWindow,
  TELEMETRY_USAGE_EXCEPTIONS_SIGNAL,
  TelemetryProjectUsagePage,
  TelemetryProjectUsageSummary,
  TelemetryUsageAmount,
  TelemetryUsageResourceSummary,
  TelemetryUsageSummary,
  TelemetryUsageWindow,
} from "../../../Types/Telemetry/TelemetryUsage";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import { DataSource } from "typeorm";

jest.mock("../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../Enterprise/TestBillingFlag",
    ) as typeof import("../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

/*
 * EXCEPTIONS APART FROM TRACES (issue #6356), ON A REAL, MIGRATED POSTGRES.
 *
 * Traces are billed as one product that sums the span rows and the
 * exception rows, so a Traces usage row keeps that sum in dataIngestedInGB -
 * what it is billed for - and records how much of it was exceptions in
 * exceptionDataIngestedInGB, the column this issue added. The usage reads
 * take that part out of Traces in SQL and show it as Exceptions; a row
 * counted before the column existed has none, and keeps its exceptions
 * inside Traces.
 *
 * The unit suites (TelemetryUsageExceptionsApart, TelemetryUsageReads) fake
 * the database. This one runs the real staging, metering, adding and reading
 * code against a clone of the MIGRATED TelemetryUsageBilling and Project
 * tables and shows:
 *
 *   - the migration made the column a nullable numeric, with no default;
 *   - metering (billing off) and billing (on, paying) write the part beside
 *     the whole, and billing prices the whole exactly as before - a free
 *     project gets no row, and a day metered without billing is never
 *     staged again when billing is turned on;
 *   - adding into a row keeps the part only while both sides have one;
 *   - over a range that mixes days counted before and after, every GB and
 *     every cent is counted once: Traces and Exceptions together are what
 *     billing charges for traces, and an old day's exceptions stay inside
 *     Traces.
 *
 * Opt in with RUN_POSTGRES_TELEMETRY_USAGE_EXCEPTIONS_TESTS=true against a
 * database the registered migrations have been applied to:
 *
 *   RUN_POSTGRES_TELEMETRY_USAGE_EXCEPTIONS_TESTS=true \
 *   TELEMETRY_USAGE_EXCEPTIONS_TEST_DATABASE_HOST=127.0.0.1 \
 *   TELEMETRY_USAGE_EXCEPTIONS_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/TelemetryUsageExceptionsPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml, right after
 * that job has applied every registered migration to an empty database. The
 * tables are structure-only clones (LIKE ... INCLUDING ALL) in a uniquely
 * named schema, first on the search_path, that is dropped afterwards; every
 * row is synthetic. ClickHouse is not used: its usage scans are answered
 * here, as the unit suites answer them.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_TELEMETRY_USAGE_EXCEPTIONS_TESTS"] === "true"
    ? describe
    : describe.skip;

const GB: number = 1024 * 1024 * 1024;

// A daily run at 08:00 UTC: the staging window is Oct 16 - Oct 22.
const NOW: Date = new Date("2026-10-23T08:00:00.000Z");
const STAGED_DAY: string = "2026-10-22";

const SERVICE_ID: string = "63560000-2222-4222-8222-222222222222";
const HOST_ID: string = "63560000-3333-4333-8333-333333333333";
const RUM_APP_ID: string = "63560000-5555-4555-8555-555555555555";
const GONE_ID: string = "63560000-6666-4666-8666-666666666666";

const SCHEMA_NAME_DASHES: RegExp = /-/g;

interface ScanRow {
  primaryEntityId: string;
  primaryEntityType: string | null;
  rowCount: number;
  estimatedBytes: number;
}

interface StoredRow {
  primaryEntityId: string;
  productType: string;
  day: string;
  dataIngestedInGB: number;
  exceptionDataIngestedInGB: number | null;
  totalCostInUSD: number;
  isReportedToBillingProvider: boolean;
}

interface SeedRow {
  projectId: ObjectID;
  day: string;
  productType: ProductType;
  primaryEntityId: string;
  primaryEntityType: ServiceType;
  gigabytes: string;
  // The exceptions' part as stored: NULL for a row counted before #6356.
  exceptions: string | null;
  cost: string;
  isDeleted?: boolean | undefined;
}

// A UTC day as the usage rows' `day` column spells it: "Oct 22, 2026".
function dayColumnOf(day: string): string {
  return new Date(`${day}T00:00:00.000Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
}

function scan(entityId: string, bytes: number, type?: ServiceType): ScanRow {
  return {
    primaryEntityId: entityId,
    primaryEntityType: type || ServiceType.OpenTelemetry,
    rowCount: 100,
    estimatedBytes: bytes,
  };
}

function rangeOf(startDay: string, endDay: string): TelemetryUsageWindow {
  return getTelemetryUsageWindow({
    startDay: startDay,
    endDay: endDay,
  }) as TelemetryUsageWindow;
}

describePostgres(
  "telemetry usage with exceptions apart from traces, against a migrated Postgres",
  () => {
    const schema: string = `usage_exceptions_${ObjectID.generate()
      .toString()
      .replace(SCHEMA_NAME_DASHES, "")}`;

    let database: DataSource;
    let spanScan: jest.SpyInstance;
    let exceptionScan: jest.SpyInstance;

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["TELEMETRY_USAGE_EXCEPTIONS_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["TELEMETRY_USAGE_EXCEPTIONS_TEST_DATABASE_PORT"] ||
            "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["TELEMETRY_USAGE_EXCEPTIONS_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        extra: { options: `-c search_path=${schema},public` },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);

      // The usage rows, and the projects the instance-wide list joins.
      for (const table of ["TelemetryUsageBilling", "Project"]) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      expect(
        (await database.query("SELECT current_schema()"))[0].current_schema,
      ).toBe(schema);
    }, 300000);

    afterAll(async () => {
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    beforeEach(() => {
      setTestBillingEnabled(false);

      for (const level of ["debug", "info", "warn", "error"] as const) {
        jest.spyOn(logger, level).mockImplementation(() => {
          return undefined as never;
        });
      }

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

      // Live updates and workflows are not what this is about.
      jest
        .spyOn(DatabaseService.prototype, "onTriggerRealtime")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(DatabaseService.prototype, "onTriggerWorkflow")
        .mockResolvedValue(undefined as never);

      jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);

      // The resources' names come from other tables; ids are enough here.
      jest
        .spyOn(TelemetryUsageResourceNames, "resolve")
        .mockResolvedValue(new Map<string, string>());

      // Each resource's retention: the host keeps 30 days, the rest 15.
      jest
        .spyOn(
          TelemetryUsageBillingService as unknown as {
            buildTelemetryRetentionMap: () => Promise<Map<string, number>>;
          },
          "buildTelemetryRetentionMap",
        )
        .mockResolvedValue(new Map<string, number>([[HOST_ID, 30]]));
      jest
        .spyOn(
          TelemetryUsageBillingService as unknown as {
            getProjectDefaultRetentionInDays: () => Promise<number>;
          },
          "getProjectDefaultRetentionInDays",
        )
        .mockResolvedValue(15);

      // A project that may pay as it goes, with no billing cutoff.
      jest
        .spyOn(PayAsYouGoBillingService, "canUsePayAsYouGo")
        .mockResolvedValue(true);
      jest
        .spyOn(PayAsYouGoBillingService, "isLiveAuthorizationFor")
        .mockReturnValue(false);
      jest
        .spyOn(PayAsYouGoBillingService, "getTelemetryBillingStartDate")
        .mockResolvedValue(undefined as never);

      installTelemetry({ spans: [], exceptions: [] });
    });

    afterEach(async () => {
      jest.restoreAllMocks();
      setTestBillingEnabled(false);

      if (database?.isInitialized) {
        await database.query(`DELETE FROM "${schema}"."TelemetryUsageBilling"`);
        await database.query(`DELETE FROM "${schema}"."Project"`);
      }
    });

    /*
     * ClickHouse's side: the days the tables hold rows on, and each table's
     * usage scan - spans and exceptions apart, as the two tables answer.
     */
    function installTelemetry(data: {
      spans: Array<ScanRow>;
      exceptions: Array<ScanRow>;
    }): void {
      for (const service of [
        SpanService,
        ExceptionInstanceService,
        LogService,
        MetricService,
        SecurityEventService,
        RumSessionService,
        ProfileService,
        ProfileSampleService,
      ]) {
        jest
          .spyOn(service, "getDaysWithRows")
          .mockResolvedValue([STAGED_DAY] as never);
      }

      spanScan = jest
        .spyOn(SpanService, "groupTelemetryUsageByService")
        .mockResolvedValue(data.spans as never);
      exceptionScan = jest
        .spyOn(ExceptionInstanceService, "groupTelemetryUsageByService")
        .mockResolvedValue(data.exceptions as never);
    }

    async function rowsOf(projectId: ObjectID): Promise<Array<StoredRow>> {
      const rows: Array<{
        primaryEntityId: string;
        productType: string;
        day: string;
        dataIngestedInGB: string;
        exceptionDataIngestedInGB: string | null;
        totalCostInUSD: string;
        isReportedToBillingProvider: boolean;
      }> = await database.query(
        `SELECT "primaryEntityId"::text AS "primaryEntityId", "productType", "day", "dataIngestedInGB"::text AS "dataIngestedInGB", "exceptionDataIngestedInGB"::text AS "exceptionDataIngestedInGB", "totalCostInUSD"::text AS "totalCostInUSD", "isReportedToBillingProvider" FROM "${schema}"."TelemetryUsageBilling" WHERE "projectId" = $1 ORDER BY "primaryEntityId", "productType"`,
        [projectId.toString()],
      );

      return rows.map(
        (row: {
          primaryEntityId: string;
          productType: string;
          day: string;
          dataIngestedInGB: string;
          exceptionDataIngestedInGB: string | null;
          totalCostInUSD: string;
          isReportedToBillingProvider: boolean;
        }): StoredRow => {
          return {
            primaryEntityId: row.primaryEntityId,
            productType: row.productType,
            day: row.day,
            dataIngestedInGB: Number(row.dataIngestedInGB),
            exceptionDataIngestedInGB:
              row.exceptionDataIngestedInGB === null
                ? null
                : Number(row.exceptionDataIngestedInGB),
            totalCostInUSD: Number(row.totalCostInUSD),
            isReportedToBillingProvider: row.isReportedToBillingProvider,
          };
        },
      );
    }

    async function addProject(
      projectId: ObjectID,
      name: string,
      options?: { isDeleted?: boolean },
    ): Promise<void> {
      await database.query(
        `INSERT INTO "${schema}"."Project" ("_id", "name", "slug", "version", "deletedAt") VALUES ($1, $2, $3, 1, $4)`,
        [
          projectId.toString(),
          name,
          `${name.toLowerCase()}-${projectId.toString().slice(0, 8)}`,
          options?.isDeleted ? NOW : null,
        ],
      );
    }

    async function seed(rows: Array<SeedRow>): Promise<void> {
      for (const row of rows) {
        await database.query(
          `INSERT INTO "${schema}"."TelemetryUsageBilling" ("projectId", "day", "productType", "primaryEntityId", "primaryEntityType", "dataIngestedInGB", "exceptionDataIngestedInGB", "totalCostInUSD", "retainTelemetryDataForDays", "isReportedToBillingProvider", "createdAt", "updatedAt", "version", "deletedAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 15, false, $9, $9, 1, $10)`,
          [
            row.projectId.toString(),
            dayColumnOf(row.day),
            row.productType,
            row.primaryEntityId,
            row.primaryEntityType,
            row.gigabytes,
            row.exceptions,
            row.cost,
            new Date(`${row.day}T00:00:00.000Z`),
            row.isDeleted ? NOW : null,
          ],
        );
      }
    }

    test("the migration made the exceptions' part a nullable numeric with no default, beside the GB a row is billed for", async () => {
      const columns: Array<{
        column_name: string;
        data_type: string;
        is_nullable: string;
        column_default: string | null;
      }> = await database.query(
        `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'TelemetryUsageBilling' AND column_name IN ('dataIngestedInGB', 'exceptionDataIngestedInGB', 'totalCostInUSD') ORDER BY column_name`,
      );

      expect(columns).toEqual([
        {
          column_name: "dataIngestedInGB",
          data_type: "numeric",
          is_nullable: "NO",
          column_default: null,
        },
        {
          column_name: "exceptionDataIngestedInGB",
          data_type: "numeric",
          is_nullable: "YES",
          column_default: null,
        },
        {
          column_name: "totalCostInUSD",
          data_type: "numeric",
          is_nullable: "NO",
          column_default: null,
        },
      ]);
    });

    describe("staging a trace day", () => {
      test("without billing, writes each resource's exceptions beside everything its traces sent, at no cost", async () => {
        const projectId: ObjectID = ObjectID.generate();

        installTelemetry({
          spans: [
            scan(SERVICE_ID, 3 * GB),
            scan(HOST_ID, GB, ServiceType.Host),
          ],
          exceptions: [scan(SERVICE_ID, GB)],
        });

        await TelemetryUsageBillingService.meterUnstagedTelemetryUsageForProject(
          {
            projectId: projectId,
            productType: ProductType.Traces,
          },
        );

        expect(await rowsOf(projectId)).toEqual([
          {
            primaryEntityId: SERVICE_ID,
            productType: ProductType.Traces,
            day: dayColumnOf(STAGED_DAY),
            // The spans and the exceptions: what the row is billed for.
            dataIngestedInGB: 4,
            // Of that, the exceptions.
            exceptionDataIngestedInGB: 1,
            totalCostInUSD: 0,
            isReportedToBillingProvider: false,
          },
          {
            primaryEntityId: HOST_ID,
            productType: ProductType.Traces,
            day: dayColumnOf(STAGED_DAY),
            dataIngestedInGB: 1,
            // A resource that recorded no exception: none, not unknown.
            exceptionDataIngestedInGB: 0,
            totalCostInUSD: 0,
            isReportedToBillingProvider: false,
          },
        ]);

        // One row per resource and product: none of its own for exceptions.
        expect(
          (
            await database.query(
              `SELECT COUNT(*)::int AS "count" FROM "${schema}"."TelemetryUsageBilling" WHERE "productType" = $1`,
              [TELEMETRY_USAGE_EXCEPTIONS_SIGNAL],
            )
          )[0].count,
        ).toBe(0);
      });

      test("with billing on, for a paying project, prices everything the row holds at the traces price, and charges it once", async () => {
        setTestBillingEnabled(true);

        const projectId: ObjectID = ObjectID.generate();

        // 40 GB of spans and 10 GB of exceptions, kept 15 days.
        installTelemetry({
          spans: [scan(SERVICE_ID, 40 * GB)],
          exceptions: [scan(SERVICE_ID, 10 * GB)],
        });

        await TelemetryUsageBillingService.stageUnstagedTelemetryUsageForProject(
          {
            projectId: projectId,
            productType: ProductType.Traces,
          },
        );

        const price: number = TracesDataIngestMetredPlan.getTotalCostInUSD({
          dataIngestedInGB: 50,
          retentionInDays: 15,
        });

        expect(price).toBeGreaterThan(0);

        const rows: Array<StoredRow> = await rowsOf(projectId);

        expect(rows).toHaveLength(1);
        expect(rows[0]!.dataIngestedInGB).toBe(50);
        expect(rows[0]!.exceptionDataIngestedInGB).toBe(10);
        // Exactly what the day cost before the exceptions were counted apart.
        expect(rows[0]!.totalCostInUSD).toBeCloseTo(price, 10);

        // What the Stripe report sums: the one Traces row, at that cost.
        const unreported: Array<TelemetryUsageBilling> =
          await TelemetryUsageBillingService.getUnreportedUsageBilling({
            projectId: projectId,
            productType: ProductType.Traces,
          });

        expect(unreported).toHaveLength(1);
        expect(Number(unreported[0]!.totalCostInUSD!.value)).toBeCloseTo(
          price,
          10,
        );

        // Nothing is ever owed for "Exceptions": it is no product.
        expect(
          await TelemetryUsageBillingService.getUnreportedUsageBilling({
            projectId: projectId,
            productType: TELEMETRY_USAGE_EXCEPTIONS_SIGNAL as ProductType,
          }),
        ).toEqual([]);

        // What the cloud marketplaces' hourly report asks for: every row owed.
        const owed: Array<TelemetryUsageBilling> =
          await TelemetryUsageBillingService.findBy({
            query: {
              projectId: projectId,
              isReportedToBillingProvider: false,
              totalCostInUSD: QueryHelper.greaterThan(0),
            },
            select: { _id: true, totalCostInUSD: true, day: true },
            skip: 0,
            limit: 1000,
            props: { isRoot: true },
          });

        expect(owed).toHaveLength(1);
        expect(Number(owed[0]!.totalCostInUSD!.value)).toBeCloseTo(price, 10);
      });

      test("with billing on, for a project that may not pay, stages nothing - no part either", async () => {
        setTestBillingEnabled(true);
        jest
          .spyOn(PayAsYouGoBillingService, "canUsePayAsYouGo")
          .mockResolvedValue(false);

        const projectId: ObjectID = ObjectID.generate();

        installTelemetry({
          spans: [scan(SERVICE_ID, 40 * GB)],
          exceptions: [scan(SERVICE_ID, 10 * GB)],
        });

        await TelemetryUsageBillingService.stageUnstagedTelemetryUsageForProject(
          {
            projectId: projectId,
            productType: ProductType.Traces,
          },
        );

        expect(await rowsOf(projectId)).toEqual([]);
        expect(spanScan).not.toHaveBeenCalled();
        expect(exceptionScan).not.toHaveBeenCalled();
      });

      test("billing turned on after a day was metered without it never stages that day again, nor charges for it", async () => {
        const projectId: ObjectID = ObjectID.generate();

        installTelemetry({
          spans: [scan(SERVICE_ID, 40 * GB)],
          exceptions: [scan(SERVICE_ID, 10 * GB)],
        });

        await TelemetryUsageBillingService.meterUnstagedTelemetryUsageForProject(
          {
            projectId: projectId,
            productType: ProductType.Traces,
          },
        );

        setTestBillingEnabled(true);

        await TelemetryUsageBillingService.stageUnstagedTelemetryUsageForProject(
          {
            projectId: projectId,
            productType: ProductType.Traces,
          },
        );

        // Scanned once, by the metering: the billing run found the day counted.
        expect(spanScan).toHaveBeenCalledTimes(1);
        expect(exceptionScan).toHaveBeenCalledTimes(1);

        const rows: Array<StoredRow> = await rowsOf(projectId);

        expect(rows).toHaveLength(1);
        expect(rows[0]!.dataIngestedInGB).toBe(50);
        expect(rows[0]!.exceptionDataIngestedInGB).toBe(10);
        expect(rows[0]!.totalCostInUSD).toBe(0);

        expect(
          await TelemetryUsageBillingService.getUnreportedUsageBilling({
            projectId: projectId,
            productType: ProductType.Traces,
          }),
        ).toEqual([]);
      });
    });

    describe("adding into a day's row", () => {
      async function add(
        projectId: ObjectID,
        gigabytes: number,
        exceptions: number | undefined,
      ): Promise<void> {
        await TelemetryUsageBillingService.updateUsageBilling({
          projectId: projectId,
          productType: ProductType.Traces,
          primaryEntityId: new ObjectID(SERVICE_ID),
          primaryEntityType: ServiceType.OpenTelemetry,
          dataIngestedInGB: gigabytes,
          exceptionDataIngestedInGB: exceptions,
          retentionInDays: 15,
          usageDate: new Date(`${STAGED_DAY}T00:00:00.000Z`),
          isBillable: false,
        });
      }

      test("sums both parts when each has one", async () => {
        const projectId: ObjectID = ObjectID.generate();

        await add(projectId, 4, 1);
        await add(projectId, 5, 2);

        const rows: Array<StoredRow> = await rowsOf(projectId);

        expect(rows).toHaveLength(1);
        expect(rows[0]!.dataIngestedInGB).toBe(9);
        expect(rows[0]!.exceptionDataIngestedInGB).toBe(3);
      });

      test("keeps no part on a row counted before the part was recorded, so none of its exceptions read as spans", async () => {
        const projectId: ObjectID = ObjectID.generate();

        await seed([
          {
            projectId: projectId,
            day: STAGED_DAY,
            productType: ProductType.Traces,
            primaryEntityId: SERVICE_ID,
            primaryEntityType: ServiceType.OpenTelemetry,
            gigabytes: "3",
            exceptions: null,
            cost: "0",
          },
        ]);

        await add(projectId, 2, 1);

        const rows: Array<StoredRow> = await rowsOf(projectId);

        expect(rows).toHaveLength(1);
        expect(rows[0]!.dataIngestedInGB).toBe(5);
        expect(rows[0]!.exceptionDataIngestedInGB).toBeNull();
      });

      test("and clears the part when what is added has none", async () => {
        const projectId: ObjectID = ObjectID.generate();

        await add(projectId, 4, 1);
        await add(projectId, 1, undefined);

        const rows: Array<StoredRow> = await rowsOf(projectId);

        expect(rows[0]!.dataIngestedInGB).toBe(5);
        expect(rows[0]!.exceptionDataIngestedInGB).toBeNull();
      });
    });

    describe("reading a range that mixes days counted before and after", () => {
      const ALPHA: ObjectID = new ObjectID(
        "63560000-aaaa-4aaa-8aaa-000000000001",
      );
      const BETA: ObjectID = new ObjectID(
        "63560000-bbbb-4bbb-8bbb-000000000002",
      );
      const GAMMA: ObjectID = new ObjectID(
        "63560000-cccc-4ccc-8ccc-000000000003",
      );
      const RANGE: TelemetryUsageWindow = rangeOf("2026-10-01", "2026-10-03");

      beforeEach(async () => {
        await addProject(ALPHA, "Alpha");
        await addProject(BETA, "Beta");
        await addProject(GAMMA, "Gamma", { isDeleted: true });

        await seed([
          // Oct 1, counted before #6356: no part, its exceptions inside Traces.
          {
            projectId: ALPHA,
            day: "2026-10-01",
            productType: ProductType.Traces,
            primaryEntityId: SERVICE_ID,
            primaryEntityType: ServiceType.OpenTelemetry,
            gigabytes: "3",
            exceptions: null,
            cost: "0.3",
          },
          // Oct 2, counted since: 1 GB of spans and 0.5 GB of exceptions.
          {
            projectId: ALPHA,
            day: "2026-10-02",
            productType: ProductType.Traces,
            primaryEntityId: SERVICE_ID,
            primaryEntityType: ServiceType.OpenTelemetry,
            gigabytes: "1.5",
            exceptions: "0.5",
            cost: "0.15",
          },
          {
            projectId: ALPHA,
            day: "2026-10-02",
            productType: ProductType.Logs,
            primaryEntityId: SERVICE_ID,
            primaryEntityType: ServiceType.OpenTelemetry,
            gigabytes: "2",
            exceptions: null,
            cost: "0.2",
          },
          // A part on another product's row is never read.
          {
            projectId: ALPHA,
            day: "2026-10-02",
            productType: ProductType.Logs,
            primaryEntityId: HOST_ID,
            primaryEntityType: ServiceType.Host,
            gigabytes: "1",
            exceptions: "0.4",
            cost: "0.1",
          },
          // Oct 3: a host whose traces were all exceptions...
          {
            projectId: ALPHA,
            day: "2026-10-03",
            productType: ProductType.Traces,
            primaryEntityId: HOST_ID,
            primaryEntityType: ServiceType.Host,
            gigabytes: "0.25",
            exceptions: "0.25",
            cost: "0.025",
          },
          // ...a part over the row, held to it...
          {
            projectId: ALPHA,
            day: "2026-10-03",
            productType: ProductType.Traces,
            primaryEntityId: SERVICE_ID,
            primaryEntityType: ServiceType.OpenTelemetry,
            gigabytes: "1",
            exceptions: "5",
            cost: "0.1",
          },
          // ...and one below none, held to none.
          {
            projectId: ALPHA,
            day: "2026-10-03",
            productType: ProductType.Traces,
            primaryEntityId: RUM_APP_ID,
            primaryEntityType: ServiceType.RealUserMonitor,
            gigabytes: "2",
            exceptions: "-1",
            cost: "0.2",
          },
          // Deleted, and after the range: neither is read.
          {
            projectId: ALPHA,
            day: "2026-10-03",
            productType: ProductType.Traces,
            primaryEntityId: GONE_ID,
            primaryEntityType: ServiceType.OpenTelemetry,
            gigabytes: "100",
            exceptions: "50",
            cost: "10",
            isDeleted: true,
          },
          {
            projectId: ALPHA,
            day: "2026-10-04",
            productType: ProductType.Traces,
            primaryEntityId: SERVICE_ID,
            primaryEntityType: ServiceType.OpenTelemetry,
            gigabytes: "7",
            exceptions: "7",
            cost: "0.7",
          },
          // Another project, and a deleted one.
          {
            projectId: BETA,
            day: "2026-10-02",
            productType: ProductType.Traces,
            primaryEntityId: SERVICE_ID,
            primaryEntityType: ServiceType.OpenTelemetry,
            gigabytes: "2",
            exceptions: "1.5",
            cost: "0.2",
          },
          {
            projectId: GAMMA,
            day: "2026-10-02",
            productType: ProductType.Traces,
            primaryEntityId: SERVICE_ID,
            primaryEntityType: ServiceType.OpenTelemetry,
            gigabytes: "9",
            exceptions: "9",
            cost: "0.9",
          },
        ]);
      });

      async function readAlpha(
        isCostIncluded: boolean,
      ): Promise<TelemetryUsageSummary> {
        return await TelemetryUsageReads.getProjectUsage({
          projectId: ALPHA,
          window: RANGE,
          isCostIncluded: isCostIncluded,
          nameProps: { isRoot: true },
        });
      }

      function gigabytesOf(
        byProduct: Partial<Record<string, TelemetryUsageAmount>>,
      ): Record<string, number> {
        const gigabytes: Record<string, number> = {};

        for (const [signal, amount] of Object.entries(byProduct)) {
          gigabytes[signal] = amount!.dataIngestedInGB;
        }

        return gigabytes;
      }

      test("shows an old day's exceptions inside Traces, and a new day's apart", async () => {
        const summary: TelemetryUsageSummary = await readAlpha(false);

        expect(
          summary.days.map(
            (day: TelemetryUsageSummary["days"][number]): unknown => {
              return {
                day: day.day,
                byProduct: gigabytesOf(day.byProduct),
                total: day.total.dataIngestedInGB,
              };
            },
          ),
        ).toEqual([
          {
            day: "2026-10-01",
            byProduct: { [ProductType.Traces]: 3 },
            total: 3,
          },
          {
            day: "2026-10-02",
            byProduct: {
              [ProductType.Traces]: 1,
              [TELEMETRY_USAGE_EXCEPTIONS_SIGNAL]: 0.5,
              [ProductType.Logs]: 3,
            },
            total: 4.5,
          },
          {
            day: "2026-10-03",
            byProduct: {
              [ProductType.Traces]: 2,
              [TELEMETRY_USAGE_EXCEPTIONS_SIGNAL]: 1.25,
            },
            total: 3.25,
          },
        ]);

        // The newest day counted at all, outside the range or not.
        expect(summary.latestDay).toBe("2026-10-04");
      });

      test("counts every GB and every cent of the range's rows once", async () => {
        const summary: TelemetryUsageSummary = await readAlpha(true);

        const held: Array<{ gigabytes: string; cost: string }> =
          await database.query(
            `SELECT SUM("dataIngestedInGB")::text AS "gigabytes", SUM("totalCostInUSD")::text AS "cost" FROM "${schema}"."TelemetryUsageBilling" WHERE "projectId" = $1 AND "createdAt" >= $2 AND "createdAt" < $3 AND "deletedAt" IS NULL`,
            [ALPHA.toString(), RANGE.start, RANGE.end],
          );

        expect(gigabytesOf(summary.byProduct)).toEqual({
          [ProductType.Traces]: 6,
          [TELEMETRY_USAGE_EXCEPTIONS_SIGNAL]: 1.75,
          [ProductType.Logs]: 3,
        });
        expect(summary.total.dataIngestedInGB).toBeCloseTo(10.75, 10);
        expect(summary.total.dataIngestedInGB).toBeCloseTo(
          Number(held[0]!.gigabytes),
          10,
        );
        expect(summary.total.totalCostInUSD).toBeCloseTo(1.075, 10);
        expect(summary.total.totalCostInUSD).toBeCloseTo(
          Number(held[0]!.cost),
          10,
        );

        // The exceptions' cost is their share of the traces rows' cost.
        expect(
          summary.byProduct[TELEMETRY_USAGE_EXCEPTIONS_SIGNAL]!.totalCostInUSD,
        ).toBeCloseTo(0.175, 10);
        expect(
          summary.byProduct[ProductType.Traces]!.totalCostInUSD,
        ).toBeCloseTo(0.6, 10);
      });

      test("Traces and Exceptions together cost what billing charges for traces", async () => {
        const summary: TelemetryUsageSummary = await readAlpha(true);

        const charged: Array<TelemetryUsageBilling> =
          await TelemetryUsageBillingService.getUnreportedUsageBilling({
            projectId: ALPHA,
            productType: ProductType.Traces,
          });
        // The range's traces rows: the one after it is billed on its own day.
        const chargedInRange: number = charged
          .map((row: TelemetryUsageBilling): number => {
            return Number(row.totalCostInUSD!.value);
          })
          .reduce((sum: number, cost: number): number => {
            return sum + cost;
          }, 0);

        expect(chargedInRange - 0.7).toBeCloseTo(
          summary.byProduct[ProductType.Traces]!.totalCostInUSD! +
            summary.byProduct[TELEMETRY_USAGE_EXCEPTIONS_SIGNAL]!
              .totalCostInUSD!,
          10,
        );
      });

      test("lists each resource's exceptions apart from its spans, heaviest first", async () => {
        const summary: TelemetryUsageSummary = await readAlpha(false);

        expect(
          summary.resources.map(
            (resource: TelemetryUsageResourceSummary): unknown => {
              return {
                id: resource.primaryEntityId,
                byProduct: gigabytesOf(resource.byProduct),
                total: resource.total.dataIngestedInGB,
              };
            },
          ),
        ).toEqual([
          {
            id: SERVICE_ID,
            byProduct: {
              // Oct 1's 3 GB, whole, and Oct 2's 1 GB of spans.
              [ProductType.Traces]: 4,
              [TELEMETRY_USAGE_EXCEPTIONS_SIGNAL]: 1.5,
              [ProductType.Logs]: 2,
            },
            total: 7.5,
          },
          {
            id: RUM_APP_ID,
            byProduct: { [ProductType.Traces]: 2 },
            total: 2,
          },
          {
            id: HOST_ID,
            // All its traces were exceptions; its logs' stray part is ignored.
            byProduct: {
              [ProductType.Logs]: 1,
              [TELEMETRY_USAGE_EXCEPTIONS_SIGNAL]: 0.25,
            },
            total: 1.25,
          },
        ]);
      });

      test("lists every project's exceptions apart for the instance admin, and sorts by them", async () => {
        const read: (
          sortBy:
            | "total"
            | ProductType
            | typeof TELEMETRY_USAGE_EXCEPTIONS_SIGNAL,
          sortOrder: "asc" | "desc",
        ) => Promise<TelemetryProjectUsagePage> = async (
          sortBy:
            | "total"
            | ProductType
            | typeof TELEMETRY_USAGE_EXCEPTIONS_SIGNAL,
          sortOrder: "asc" | "desc",
        ): Promise<TelemetryProjectUsagePage> => {
          return await TelemetryUsageReads.getUsageByProject({
            window: RANGE,
            isCostIncluded: true,
            sortBy: sortBy,
            sortOrder: sortOrder,
            skip: 0,
            limit: 50,
          });
        };

        const page: TelemetryProjectUsagePage = await read(
          TELEMETRY_USAGE_EXCEPTIONS_SIGNAL,
          "desc",
        );

        // The deleted project is left out.
        expect(
          page.projects.map(
            (project: TelemetryProjectUsageSummary): unknown => {
              return {
                name: project.projectName,
                byProduct: gigabytesOf(project.byProduct),
                total: project.total.dataIngestedInGB,
              };
            },
          ),
        ).toEqual([
          {
            name: "Alpha",
            byProduct: {
              [ProductType.Traces]: 6,
              [TELEMETRY_USAGE_EXCEPTIONS_SIGNAL]: 1.75,
              [ProductType.Logs]: 3,
            },
            total: 10.75,
          },
          {
            name: "Beta",
            byProduct: {
              [ProductType.Traces]: 0.5,
              [TELEMETRY_USAGE_EXCEPTIONS_SIGNAL]: 1.5,
            },
            total: 2,
          },
        ]);
        expect(gigabytesOf(page.byProduct)).toEqual({
          [ProductType.Traces]: 6.5,
          [TELEMETRY_USAGE_EXCEPTIONS_SIGNAL]: 3.25,
          [ProductType.Logs]: 3,
        });
        expect(page.total.dataIngestedInGB).toBeCloseTo(12.75, 10);
        expect(page.total.totalCostInUSD).toBeCloseTo(1.275, 10);

        expect(
          (await read(ProductType.Traces, "asc")).projects.map(
            (project: TelemetryProjectUsageSummary): string | null => {
              return project.projectName;
            },
          ),
        ).toEqual(["Beta", "Alpha"]);
      });
    });
  },
);
