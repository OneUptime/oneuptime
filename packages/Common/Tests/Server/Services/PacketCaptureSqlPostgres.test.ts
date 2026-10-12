import Entities from "../../../Models/DatabaseModels/Index";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import PacketCapture from "../../../Models/DatabaseModels/PacketCapture";
import PacketCaptureAPI, {
  PacketCaptureDownload,
} from "../../../Server/API/PacketCaptureAPI";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import AuditLogService from "../../../Server/Services/AuditLogService";
import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import PacketCaptureService, {
  ALREADY_FINISHED_MESSAGE,
  HEARTBEAT_TIMEOUT_MESSAGE,
  NOT_STARTED_MESSAGE,
  PICKUP_TIMEOUT_MESSAGE,
  UPLOAD_TIMEOUT_MESSAGE,
} from "../../../Server/Services/PacketCaptureService";
import logger from "../../../Server/Utils/Logger";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import MimeType from "../../../Types/File/MimeType";
import ObjectID from "../../../Types/ObjectID";
import { PacketCaptureCapability } from "../../../Types/PacketCapture/PacketCaptureCapability";
import PacketCaptureEndReason from "../../../Types/PacketCapture/PacketCaptureEndReason";
import { PacketCaptureJob } from "../../../Types/PacketCapture/PacketCaptureJob";
import { PACKET_CAPTURE_NOT_FOUND_MESSAGE } from "../../../Types/PacketCapture/PacketCapturePermissions";
import PacketCaptureStatus from "../../../Types/PacketCapture/PacketCaptureStatus";
import Permission from "../../../Types/Permission";
import { customDomainCaller } from "../API/CustomDomainCallers";
import { dashboardStartCapture } from "../../Helpers/PacketCaptureStartBody";
import { getJestSpyOn } from "../../Spy";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import {
  makePcap,
  makePcapRecord,
  pcapLength,
} from "../Utils/PacketCapture/PcapFixture";
import { DataSource, QueryRunner } from "typeorm";

/*
 * Packet capture's hand-written SQL against a real Postgres: the probe's
 * claim (FOR UPDATE SKIP LOCKED), its heartbeat and stop answer, its
 * failure and completion reports, Stop from the dashboard, the stale
 * capture sweep and the retention sweep. Each is keyed on the probe or the
 * project in its WHERE clause, and each reads what the driver returns - an
 * UPDATE ... RETURNING comes back from TypeORM's postgres runner as
 * [rows, rowCount] - which the unit suite's fake EntityManager cannot show.
 *
 * Opt in with RUN_POSTGRES_PACKET_CAPTURE_SQL_TESTS=true against a Postgres
 * migrated to the current head - the Postgres Schema Drift workflow's
 * database right after its drift check (CI runs it in
 * .github/workflows/postgres-schema-drift.yaml). The PacketCapture, File and Probe
 * tables' STRUCTURE is cloned into a unique schema (search_path holds only
 * that schema), dropped afterwards - with the Project, User and
 * NetworkDevice tables a capture's relations join when the service reads
 * one whole (a delete's audit snapshot). Credentials from DATABASE_USERNAME /
 * DATABASE_PASSWORD, database from PACKET_CAPTURE_SQL_TEST_DATABASE_NAME or
 * DATABASE_NAME, endpoint from PACKET_CAPTURE_SQL_TEST_DATABASE_HOST /
 * _PORT (default localhost:5400, Scripts/Dev/docker-compose.dev.yml).
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_PACKET_CAPTURE_SQL_TESTS"] === "true"
    ? describe
    : describe.skip;

// A statement that blocks instead of skipping a locked row fails, never hangs.
const LOCK_TIMEOUT_MS: number = 5000;

const TABLES: Array<string> = [
  "PacketCapture",
  "File",
  "Probe",
  "Project",
  "User",
  "NetworkDevice",
];

const DASHES: RegExp = /-/g;

describePostgres("packet capture SQL against Postgres", () => {
  const schema: string = `packet_capture_${ObjectID.generate()
    .toString()
    .replace(DASHES, "")}`;
  let database: DataSource;

  const projectId: ObjectID = ObjectID.generate();
  const otherProjectId: ObjectID = ObjectID.generate();
  const probeId: ObjectID = ObjectID.generate();
  const otherProbeId: ObjectID = ObjectID.generate();
  const deviceId: ObjectID = ObjectID.generate();

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["PACKET_CAPTURE_SQL_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["PACKET_CAPTURE_SQL_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["PACKET_CAPTURE_SQL_TEST_DATABASE_NAME"] ||
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

    for (const table of TABLES) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    // A fixture names only what a statement reads; ids stay NOT NULL.
    const columns: Array<{ table_name: string; column_name: string }> =
      await database.query(
        `SELECT table_name, column_name FROM information_schema.columns
         WHERE table_schema = $1 AND is_nullable = 'NO' AND column_name <> '_id'`,
        [schema],
      );

    for (const column of columns) {
      await database.query(
        `ALTER TABLE "${schema}"."${column.table_name}" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
      );
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

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    for (const table of TABLES) {
      await database.query(`DELETE FROM "${schema}"."${table}"`);
    }

    await insertProbe({ id: probeId, projectId: projectId, name: "Site A" });
    await insertProbe({
      id: otherProbeId,
      projectId: otherProjectId,
      name: "Elsewhere",
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  interface CaptureRow {
    _id: string;
    status: string;
    statusMessage: string | null;
    endReason: string | null;
    startedAt: Date | null;
    completedAt: Date | null;
    stopRequestedAt: Date | null;
    packetCount: number | null;
    fileSizeInBytes: number | null;
    fileId: string | null;
    updatedAt: Date;
  }

  async function insertProbe(data: {
    id: ObjectID;
    projectId: ObjectID | null;
    name: string;
    isGlobalProbe?: boolean;
  }): Promise<void> {
    await database.query(
      `INSERT INTO "${schema}"."Probe" ("_id", "projectId", "name", "isGlobalProbe")
       VALUES ($1, $2, $3, $4)`,
      [
        data.id.toString(),
        data.projectId ? data.projectId.toString() : null,
        data.name,
        Boolean(data.isGlobalProbe),
      ],
    );
  }

  async function insertCapture(
    data: {
      probe?: ObjectID;
      project?: ObjectID;
      status?: PacketCaptureStatus;
      createdMinutesAgo?: number;
      updatedMinutesAgo?: number;
      startedMinutesAgo?: number | null;
      maxDurationInSeconds?: number;
      maxFileSizeInMB?: number;
      deleted?: boolean;
      stopRequested?: boolean;
      fileId?: ObjectID | null;
      interfaceName?: string;
      bpfFilter?: string;
    } = {},
  ): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    const minutesAgo: (minutes: number) => Date = (minutes: number): Date => {
      return new Date(Date.now() - minutes * 60 * 1000);
    };

    await database.query(
      `INSERT INTO "${schema}"."PacketCapture"
        ("_id", "projectId", "probeId", "status", "interfaceName", "bpfFilter",
         "maxDurationInSeconds", "maxPackets", "maxFileSizeInMB",
         "createdAt", "updatedAt", "startedAt", "deletedAt", "stopRequestedAt",
         "fileId", "version")
       VALUES ($1, $2, $3, $4, $5, $6, $7, 100000, $8, $9, $10, $11, $12, $13, $14, 1)`,
      [
        id.toString(),
        (data.project || projectId).toString(),
        (data.probe || probeId).toString(),
        data.status || PacketCaptureStatus.Pending,
        data.interfaceName || "eth0",
        data.bpfFilter ?? "port 53",
        data.maxDurationInSeconds ?? 60,
        data.maxFileSizeInMB ?? 10,
        minutesAgo(data.createdMinutesAgo ?? 0),
        minutesAgo(data.updatedMinutesAgo ?? data.createdMinutesAgo ?? 0),
        data.startedMinutesAgo === undefined || data.startedMinutesAgo === null
          ? null
          : minutesAgo(data.startedMinutesAgo),
        data.deleted ? new Date() : null,
        data.stopRequested ? new Date() : null,
        data.fileId ? data.fileId.toString() : null,
      ],
    );

    return id;
  }

  async function insertFile(): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();

    await database.query(
      `INSERT INTO "${schema}"."File" ("_id", "name", "file", "fileType", "isPublic", "projectId")
       VALUES ($1, 'capture.pcap', $2, $3, false, $4)`,
      [
        id.toString(),
        Buffer.from([1, 2, 3]),
        MimeType.pcap,
        projectId.toString(),
      ],
    );

    return id;
  }

  async function readCapture(id: ObjectID): Promise<CaptureRow | undefined> {
    const rows: Array<CaptureRow> = await database.query(
      `SELECT * FROM "${schema}"."PacketCapture" WHERE "_id" = $1`,
      [id.toString()],
    );

    return rows[0];
  }

  async function countRows(table: string): Promise<number> {
    const rows: Array<{ count: string }> = await database.query(
      `SELECT count(*)::text AS count FROM "${schema}"."${table}"`,
    );

    return Number(rows[0]!.count);
  }

  describe("the probe's claim", () => {
    test("hands a probe only its own Pending, undeleted captures inside the pickup window, oldest first, and marks them Running", async () => {
      const newer: ObjectID = await insertCapture({ createdMinutesAgo: 1 });
      const older: ObjectID = await insertCapture({
        createdMinutesAgo: 2,
        interfaceName: "any",
        bpfFilter: "",
      });
      const stale: ObjectID = await insertCapture({ createdMinutesAgo: 6 });
      const deleted: ObjectID = await insertCapture({ deleted: true });
      const running: ObjectID = await insertCapture({
        status: PacketCaptureStatus.Running,
      });
      const others: ObjectID = await insertCapture({
        probe: otherProbeId,
        project: otherProjectId,
      });

      const jobs: Array<PacketCaptureJob> =
        await PacketCaptureService.claimPendingForProbe({
          probeId: probeId,
          limit: 5,
        });

      expect(
        jobs.map((job: PacketCaptureJob): string => {
          return job.id;
        }),
      ).toEqual([older.toString(), newer.toString()]);
      expect(jobs[0]).toEqual({
        id: older.toString(),
        interfaceName: "any",
        bpfFilter: "",
        maxDurationInSeconds: 60,
        maxPackets: 100000,
        maxFileSizeInBytes: 10 * 1024 * 1024,
      });

      for (const id of [newer, older]) {
        const row: CaptureRow = (await readCapture(id))!;
        expect(row.status).toBe(PacketCaptureStatus.Running);
        expect(row.startedAt).toBeInstanceOf(Date);
      }

      for (const id of [stale, deleted, others]) {
        expect((await readCapture(id))!.status).toBe(
          PacketCaptureStatus.Pending,
        );
      }

      expect((await readCapture(running))!.status).toBe(
        PacketCaptureStatus.Running,
      );
    });

    test("hands out no more than the slots the probe has", async () => {
      await insertCapture({ createdMinutesAgo: 3 });
      await insertCapture({ createdMinutesAgo: 2 });
      await insertCapture({ createdMinutesAgo: 1 });

      expect(
        await PacketCaptureService.claimPendingForProbe({
          probeId: probeId,
          limit: 2,
        }),
      ).toHaveLength(2);
      expect(
        await PacketCaptureService.claimPendingForProbe({
          probeId: probeId,
          limit: 2,
        }),
      ).toHaveLength(1);
      expect(
        await PacketCaptureService.claimPendingForProbe({
          probeId: probeId,
          limit: 2,
        }),
      ).toHaveLength(0);
    });

    test("skips a capture another replica is claiming, rather than waiting for it", async () => {
      const locked: ObjectID = await insertCapture({ createdMinutesAgo: 2 });
      const free: ObjectID = await insertCapture({ createdMinutesAgo: 1 });

      const holder: QueryRunner = database.createQueryRunner();
      await holder.connect();
      await holder.startTransaction();
      await holder.query(
        `SELECT "_id" FROM "${schema}"."PacketCapture" WHERE "_id" = $1 FOR UPDATE`,
        [locked.toString()],
      );

      try {
        const jobs: Array<PacketCaptureJob> =
          await PacketCaptureService.claimPendingForProbe({
            probeId: probeId,
            limit: 2,
          });

        expect(
          jobs.map((job: PacketCaptureJob): string => {
            return job.id;
          }),
        ).toEqual([free.toString()]);
      } finally {
        await holder.rollbackTransaction();
        await holder.release();
      }

      expect((await readCapture(locked))!.status).toBe(
        PacketCaptureStatus.Pending,
      );
    });
  });

  describe("the probe's heartbeat and the stops it is told about", () => {
    test("a capture the probe is running is heard from, and keeps running", async () => {
      const running: ObjectID = await insertCapture({
        status: PacketCaptureStatus.Running,
        updatedMinutesAgo: 1,
        startedMinutesAgo: 1,
      });
      const before: Date = (await readCapture(running))!.updatedAt;

      expect(
        await PacketCaptureService.findCapturesToStop({
          probeId: probeId,
          runningPacketCaptureIds: [running.toString()],
        }),
      ).toEqual([]);

      expect((await readCapture(running))!.updatedAt.getTime()).toBeGreaterThan(
        before.getTime(),
      );
    });

    test("names what was stopped, settled, deleted or is not this probe's - and touches none of them", async () => {
      const stopped: ObjectID = await insertCapture({
        status: PacketCaptureStatus.Running,
        stopRequested: true,
      });
      const completed: ObjectID = await insertCapture({
        status: PacketCaptureStatus.Completed,
      });
      const deleted: ObjectID = await insertCapture({
        status: PacketCaptureStatus.Running,
        deleted: true,
      });
      const othersRunning: ObjectID = await insertCapture({
        status: PacketCaptureStatus.Running,
        probe: otherProbeId,
        project: otherProjectId,
        updatedMinutesAgo: 1,
      });
      const unknown: ObjectID = ObjectID.generate();
      const othersBefore: Date = (await readCapture(othersRunning))!.updatedAt;

      const toStop: Array<string> =
        await PacketCaptureService.findCapturesToStop({
          probeId: probeId,
          runningPacketCaptureIds: [
            stopped.toString(),
            completed.toString(),
            deleted.toString(),
            othersRunning.toString(),
            unknown.toString(),
          ],
        });

      expect(toStop.sort()).toEqual(
        [
          stopped.toString(),
          completed.toString(),
          deleted.toString(),
          othersRunning.toString(),
          unknown.toString(),
        ].sort(),
      );

      // Another probe's capture is never marked as heard from by this one.
      expect((await readCapture(othersRunning))!.updatedAt.getTime()).toBe(
        othersBefore.getTime(),
      );
    });
  });

  describe("the probe's reports", () => {
    test("a failure settles this probe's Running capture, and only that", async () => {
      const running: ObjectID = await insertCapture({
        status: PacketCaptureStatus.Running,
      });

      expect(
        await PacketCaptureService.recordFailure({
          probeId: otherProbeId,
          packetCaptureId: running,
          statusMessage: "not mine",
        }),
      ).toBe(false);
      expect((await readCapture(running))!.status).toBe(
        PacketCaptureStatus.Running,
      );

      expect(
        await PacketCaptureService.recordFailure({
          probeId: probeId,
          packetCaptureId: running,
          statusMessage: "tcpdump could not use the filter.",
        }),
      ).toBe(true);

      const row: CaptureRow = (await readCapture(running))!;

      expect(row.status).toBe(PacketCaptureStatus.Failed);
      expect(row.statusMessage).toBe("tcpdump could not use the filter.");
      expect(row.completedAt).toBeInstanceOf(Date);

      // Settled: a second report changes nothing.
      expect(
        await PacketCaptureService.recordFailure({
          probeId: probeId,
          packetCaptureId: running,
          statusMessage: "again",
        }),
      ).toBe(false);
    });

    test("a reason longer than the column still settles the capture", async () => {
      const running: ObjectID = await insertCapture({
        status: PacketCaptureStatus.Running,
      });

      expect(
        await PacketCaptureService.recordFailure({
          probeId: probeId,
          packetCaptureId: running,
          statusMessage: "x".repeat(2000),
        }),
      ).toBe(true);
      expect((await readCapture(running))!.statusMessage).toHaveLength(500);
    });

    test("a completion stores the file as a private file of the capture's project and counts the packets in it", async () => {
      const running: ObjectID = await insertCapture({
        status: PacketCaptureStatus.Running,
        startedMinutesAgo: 1,
        maxFileSizeInMB: 1,
      });
      const whole: Buffer = makePcap({ packetLengths: [60, 1514, 98] });
      const uploaded: Buffer = Buffer.concat([
        whole,
        makePcapRecord({ capturedLength: 200, index: 3 }).subarray(0, 50),
      ]);

      expect(
        await PacketCaptureService.recordCompletion({
          probeId: probeId,
          packetCaptureId: running,
          pcap: uploaded,
          endReason: PacketCaptureEndReason.DurationReached,
        }),
      ).toBe(true);

      const row: CaptureRow = (await readCapture(running))!;

      expect(row.status).toBe(PacketCaptureStatus.Completed);
      expect(row.endReason).toBe(PacketCaptureEndReason.DurationReached);
      expect(row.packetCount).toBe(3);
      expect(row.fileSizeInBytes).toBe(pcapLength([60, 1514, 98]));
      expect(row.completedAt).toBeInstanceOf(Date);
      expect(row.fileId).toBeTruthy();

      const files: Array<{
        file: Buffer;
        fileType: string;
        isPublic: boolean;
        projectId: string;
        name: string;
      }> = await database.query(
        `SELECT "file", "fileType", "isPublic", "projectId", "name" FROM "${schema}"."File" WHERE "_id" = $1`,
        [row.fileId],
      );

      expect(files).toHaveLength(1);
      expect(files[0]!.file.equals(whole)).toBe(true);
      expect(files[0]!.fileType).toBe(MimeType.pcap);
      expect(files[0]!.isPublic).toBe(false);
      expect(files[0]!.projectId).toBe(projectId.toString());
      expect(files[0]!.name).toMatch(/^packet-capture-site-a-eth0-.*\.pcap$/);
    });

    test("another probe's report of the capture is refused, and no file is kept", async () => {
      const running: ObjectID = await insertCapture({
        status: PacketCaptureStatus.Running,
      });

      expect(
        await PacketCaptureService.recordCompletion({
          probeId: otherProbeId,
          packetCaptureId: running,
          pcap: makePcap({ packetLengths: [60] }),
          endReason: PacketCaptureEndReason.DurationReached,
        }),
      ).toBe(false);

      expect((await readCapture(running))!.status).toBe(
        PacketCaptureStatus.Running,
      );
      expect(await countRows("File")).toBe(0);
    });

    test("a capture settled while its file was uploading keeps no file", async () => {
      const completed: ObjectID = await insertCapture({
        status: PacketCaptureStatus.Running,
      });

      // The read sees it Running; the sweep fails it before the write.
      const findOneBy: typeof PacketCaptureService.findOneBy =
        PacketCaptureService.findOneBy.bind(PacketCaptureService);

      jest
        .spyOn(PacketCaptureService, "findOneBy")
        .mockImplementationOnce(
          async (...args: Parameters<typeof findOneBy>) => {
            const capture: Awaited<ReturnType<typeof findOneBy>> =
              await findOneBy(...args);

            await database.query(
              `UPDATE "${schema}"."PacketCapture" SET "status" = $2 WHERE "_id" = $1`,
              [completed.toString(), PacketCaptureStatus.Failed],
            );

            return capture;
          },
        );

      expect(
        await PacketCaptureService.recordCompletion({
          probeId: probeId,
          packetCaptureId: completed,
          pcap: makePcap({ packetLengths: [60] }),
          endReason: PacketCaptureEndReason.DurationReached,
        }),
      ).toBe(false);

      expect(await countRows("File")).toBe(0);
      expect((await readCapture(completed))!.status).toBe(
        PacketCaptureStatus.Failed,
      );
    });
  });

  describe("Stop from the dashboard", () => {
    test("asks a Running capture of the project to stop, and keeps the first time it was asked", async () => {
      const running: ObjectID = await insertCapture({
        status: PacketCaptureStatus.Running,
      });

      await PacketCaptureService.requestStop({
        packetCaptureId: running,
        projectId: projectId,
      });

      const first: Date = (await readCapture(running))!.stopRequestedAt!;

      expect(first).toBeInstanceOf(Date);

      await PacketCaptureService.requestStop({
        packetCaptureId: running,
        projectId: projectId,
      });

      expect((await readCapture(running))!.stopRequestedAt!.getTime()).toBe(
        first.getTime(),
      );

      expect(
        await PacketCaptureService.findCapturesToStop({
          probeId: probeId,
          runningPacketCaptureIds: [running.toString()],
        }),
      ).toEqual([running.toString()]);
    });

    test("another project's capture is not found, and is not touched", async () => {
      const running: ObjectID = await insertCapture({
        status: PacketCaptureStatus.Running,
      });

      await expect(
        PacketCaptureService.requestStop({
          packetCaptureId: running,
          projectId: otherProjectId,
        }),
      ).rejects.toThrow(PACKET_CAPTURE_NOT_FOUND_MESSAGE);

      expect((await readCapture(running))!.stopRequestedAt).toBeNull();
    });

    test("a capture that has not started, or has finished, cannot be stopped", async () => {
      const pending: ObjectID = await insertCapture();
      const completed: ObjectID = await insertCapture({
        status: PacketCaptureStatus.Completed,
      });

      await expect(
        PacketCaptureService.requestStop({
          packetCaptureId: pending,
          projectId: projectId,
        }),
      ).rejects.toThrow(NOT_STARTED_MESSAGE);
      await expect(
        PacketCaptureService.requestStop({
          packetCaptureId: completed,
          projectId: projectId,
        }),
      ).rejects.toThrow(ALREADY_FINISHED_MESSAGE);
    });
  });

  describe("the stale capture sweep", () => {
    test("fails what nobody will finish, with the reason, and leaves the rest", async () => {
      const notPickedUp: ObjectID = await insertCapture({
        createdMinutesAgo: 6,
      });
      const waiting: ObjectID = await insertCapture({ createdMinutesAgo: 1 });
      const silent: ObjectID = await insertCapture({
        status: PacketCaptureStatus.Running,
        startedMinutesAgo: 4,
        updatedMinutesAgo: 3,
        maxDurationInSeconds: 1800,
      });
      const pastDeadline: ObjectID = await insertCapture({
        status: PacketCaptureStatus.Running,
        startedMinutesAgo: 12,
        updatedMinutesAgo: 0,
        maxDurationInSeconds: 60,
      });
      const healthy: ObjectID = await insertCapture({
        status: PacketCaptureStatus.Running,
        startedMinutesAgo: 5,
        updatedMinutesAgo: 0,
        maxDurationInSeconds: 1800,
      });
      const uploading: ObjectID = await insertCapture({
        status: PacketCaptureStatus.Running,
        startedMinutesAgo: 9,
        updatedMinutesAgo: 0,
        maxDurationInSeconds: 60,
      });
      const deletedStale: ObjectID = await insertCapture({
        createdMinutesAgo: 30,
        deleted: true,
      });

      expect(await PacketCaptureService.failStaleCaptures()).toBe(3);

      expect(await readCapture(notPickedUp)).toMatchObject({
        status: PacketCaptureStatus.Failed,
        statusMessage: PICKUP_TIMEOUT_MESSAGE,
      });
      expect(await readCapture(silent)).toMatchObject({
        status: PacketCaptureStatus.Failed,
        statusMessage: HEARTBEAT_TIMEOUT_MESSAGE,
      });
      expect(await readCapture(pastDeadline)).toMatchObject({
        status: PacketCaptureStatus.Failed,
        statusMessage: UPLOAD_TIMEOUT_MESSAGE,
      });

      for (const id of [waiting, deletedStale]) {
        expect((await readCapture(id))!.status).toBe(
          PacketCaptureStatus.Pending,
        );
      }

      for (const id of [healthy, uploading]) {
        expect((await readCapture(id))!.status).toBe(
          PacketCaptureStatus.Running,
        );
      }

      // A second run finds nothing more to fail.
      expect(await PacketCaptureService.failStaleCaptures()).toBe(0);
    });
  });

  describe("the retention sweep", () => {
    test("deletes captures past the retention period with their files, and keeps the rest", async () => {
      const oldFile: ObjectID = await insertFile();
      const newFile: ObjectID = await insertFile();
      const expired: ObjectID = await insertCapture({
        status: PacketCaptureStatus.Completed,
        createdMinutesAgo: 8 * 24 * 60,
        fileId: oldFile,
      });
      const expiredDeleted: ObjectID = await insertCapture({
        createdMinutesAgo: 8 * 24 * 60,
        deleted: true,
      });
      const kept: ObjectID = await insertCapture({
        status: PacketCaptureStatus.Completed,
        createdMinutesAgo: 6 * 24 * 60,
        fileId: newFile,
      });

      expect(await PacketCaptureService.deleteExpiredCaptures()).toBe(2);

      expect(await readCapture(expired)).toBeUndefined();
      expect(await readCapture(expiredDeleted)).toBeUndefined();
      expect(await readCapture(kept)).toBeDefined();

      const files: Array<{ _id: string }> = await database.query(
        `SELECT "_id" FROM "${schema}"."File"`,
      );

      expect(
        files.map((file: { _id: string }): string => {
          return file._id;
        }),
      ).toEqual([newFile.toString()]);
    });
  });

  describe("the probe's capability report", () => {
    test("is kept on a project's own probe, and a global probe's is dropped", async () => {
      const globalProbeId: ObjectID = ObjectID.generate();
      await insertProbe({
        id: globalProbeId,
        projectId: null,
        name: "Global",
        isGlobalProbe: true,
      });

      const report: {
        isEnabled: boolean;
        isToolAvailable: boolean;
        interfaces: Array<{ name: string; addresses: Array<string> }>;
        limits: {
          maxDurationInSeconds: number;
          maxPackets: number;
          maxFileSizeInMB: number;
        };
      } = {
        isEnabled: true,
        isToolAvailable: true,
        interfaces: [{ name: "eth0", addresses: ["10.0.0.2/24"] }],
        limits: {
          maxDurationInSeconds: 600,
          maxPackets: 1000000,
          maxFileSizeInMB: 5,
        },
      };

      expect(
        await PacketCaptureService.recordProbeCapability({
          probeId: probeId,
          capability: report,
        }),
      ).toBe(true);
      expect(
        await PacketCaptureService.recordProbeCapability({
          probeId: globalProbeId,
          capability: report,
        }),
      ).toBe(false);

      const rows: Array<{ _id: string; packetCaptureCapability: unknown }> =
        await database.query(
          `SELECT "_id", "packetCaptureCapability" FROM "${schema}"."Probe" WHERE "_id" = ANY($1::uuid[])`,
          [[probeId.toString(), globalProbeId.toString()]],
        );

      const byId: Map<string, unknown> = new Map(
        rows.map((row: { _id: string; packetCaptureCapability: unknown }) => {
          return [row._id, row.packetCaptureCapability];
        }),
      );

      expect(byId.get(probeId.toString())).toEqual(report);
      expect(byId.get(globalProbeId.toString())).toBeNull();
    });
  });

  /*
   * A capture as the people the docs name make one, through the whole
   * service against this Postgres - DatabaseService's create, its hooks, the
   * permission checks and the INSERT - and on through the probe's claim and
   * upload, a download, a viewer's list and a delete, with the audit trail
   * the docs promise. Every start was once refused, the project owner's
   * included ("User is not allowed to create on fileId column of Packet
   * Capture"), and nothing here made one: the rows above are written by hand.
   */
  describe("a capture, as the members the docs name make it", () => {
    const CAPABILITY: PacketCaptureCapability = {
      isEnabled: true,
      isToolAvailable: true,
      interfaces: [
        { name: "any", addresses: [], isUp: true },
        { name: "ens18", addresses: ["192.168.50.37/24"], isUp: true },
      ],
      limits: {
        maxDurationInSeconds: 1800,
        maxPackets: 1000000,
        maxFileSizeInMB: 25,
      },
    } as unknown as PacketCaptureCapability;

    function member(
      permissions: Array<Permission>,
    ): DatabaseCommonInteractionProps {
      return {
        ...customDomainCaller({ permissions: permissions, projectId: projectId }),
        ...ON_HIGHEST_PLAN,
      };
    }

    function customerCapture(): PacketCapture {
      return dashboardStartCapture({
        probeId: probeId,
        interfaceName: "ens18",
        bpfFilter: "net 192.168.50.0/24 and tcp",
        maxDurationInSeconds: 60,
        maxPackets: 100000,
        maxFileSizeInMB: 10,
      });
    }

    async function startedBy(id: ObjectID): Promise<{
      name: string | null;
      createdByUserId: string | null;
    }> {
      const rows: Array<{
        name: string | null;
        createdByUserId: string | null;
      }> = await database.query(
        `SELECT "name", "createdByUserId" FROM "${schema}"."PacketCapture" WHERE "_id" = $1`,
        [id.toString()],
      );

      return rows[0]!;
    }

    beforeEach(() => {
      getJestSpyOn(PacketCaptureService, "onTriggerWorkflow").mockResolvedValue(
        undefined,
      );
      getJestSpyOn(PacketCaptureService, "onTriggerRealtime").mockResolvedValue(
        undefined,
      );
    });

    test("one given Start Packet Capture starts it, the probe runs it, one given Download downloads it, a viewer sees it, one given Delete deletes it and its file", async () => {
      const recordCreate: jest.SpyInstance = getJestSpyOn(
        AuditLogService,
        "recordCreate",
      ).mockResolvedValue(undefined);
      const recordDownload: jest.SpyInstance = getJestSpyOn(
        AuditLogService,
        "recordDownload",
      ).mockResolvedValue(undefined);
      const recordDelete: jest.SpyInstance = getJestSpyOn(
        AuditLogService,
        "recordDelete",
      ).mockResolvedValue(undefined);

      // The probe says what it can capture on, as its report does.
      expect(
        await PacketCaptureService.recordProbeCapability({
          probeId: probeId,
          capability: CAPABILITY,
        }),
      ).toBe(true);

      // 1. Started from the probe's page by a member given Start Packet Capture.
      const starter: DatabaseCommonInteractionProps = member([
        Permission.ProjectMember,
        Permission.CreatePacketCapture,
      ]);

      const started: PacketCapture = await PacketCaptureService.create({
        data: customerCapture(),
        props: starter,
      });
      const id: ObjectID = started.id!;

      let row: CaptureRow = (await readCapture(id))!;

      expect(row.status).toBe(PacketCaptureStatus.Pending);
      expect(row.fileId).toBeNull();
      expect(await startedBy(id)).toEqual({
        name: "ens18: net 192.168.50.0/24 and tcp",
        createdByUserId: starter.userId!.toString(),
      });
      // Starting one is in the audit log, as a create by whoever started it.
      expect(recordCreate).toHaveBeenCalledTimes(1);
      expect(recordCreate.mock.calls[0]![0].props.userId?.toString()).toBe(
        starter.userId!.toString(),
      );

      // A member without the permission is refused, and nothing is stored.
      await expect(
        PacketCaptureService.create({
          data: customerCapture(),
          props: member([Permission.ProjectMember]),
        }),
      ).rejects.toThrow(
        "You do not have permissions to create Packet Capture. You need one of these permissions: Project Owner, Project Admin, Start Packet Capture",
      );
      expect(await countRows("PacketCapture")).toBe(1);

      // 2. The probe picks it up, captures, and uploads its file.
      const jobs: Array<PacketCaptureJob> =
        await PacketCaptureService.claimPendingForProbe({
          probeId: probeId,
          limit: 2,
        });

      expect(
        jobs.map((job: PacketCaptureJob): string => {
          return job.id;
        }),
      ).toEqual([id.toString()]);
      expect(jobs[0]!.bpfFilter).toBe("net 192.168.50.0/24 and tcp");

      const pcap: Buffer = makePcap({ packetLengths: [60, 98] });

      expect(
        await PacketCaptureService.recordCompletion({
          probeId: probeId,
          packetCaptureId: id,
          pcap: pcap,
          endReason: PacketCaptureEndReason.DurationReached,
        }),
      ).toBe(true);

      row = (await readCapture(id))!;

      expect(row.status).toBe(PacketCaptureStatus.Completed);
      expect(row.packetCount).toBe(2);
      expect(row.fileId).toBeTruthy();
      expect(await countRows("File")).toBe(1);

      // 3. Downloaded by a member given Download Packet Capture, and audited.
      const downloaded: PacketCaptureDownload =
        await PacketCaptureAPI.readDownload({
          packetCaptureId: id,
          projectId: projectId,
          props: member([
            Permission.ProjectMember,
            Permission.DownloadPacketCapture,
          ]),
        });

      expect(Buffer.from(downloaded.base64, "base64").equals(pcap)).toBe(true);
      expect(downloaded.fileType).toBe(MimeType.pcap);
      expect(recordDownload).toHaveBeenCalledTimes(1);

      // 4. A viewer sees it in the list; the file's id is never theirs to read.
      const viewer: DatabaseCommonInteractionProps = member([Permission.Viewer]);
      const listed: Array<PacketCapture> = await PacketCaptureService.findBy({
        query: { probeId: probeId },
        select: {
          _id: true,
          status: true,
          interfaceName: true,
          bpfFilter: true,
          packetCount: true,
          createdByUserId: true,
        },
        skip: 0,
        limit: 10,
        props: viewer,
      });

      expect(
        listed.map((capture: PacketCapture): string => {
          return capture.id!.toString();
        }),
      ).toEqual([id.toString()]);
      expect(listed[0]!.status).toBe(PacketCaptureStatus.Completed);
      expect(listed[0]!.fileId).toBeUndefined();

      await expect(
        PacketCaptureService.findBy({
          query: { probeId: probeId },
          select: { fileId: true },
          skip: 0,
          limit: 10,
          props: viewer,
        }),
      ).rejects.toThrow("You do not have permissions to select on - fileId.");

      // 5. Not deleted by the starter, who may not delete; then by one who may, with its file.
      await expect(
        PacketCaptureService.deleteOneById({ id: id, props: starter }),
      ).rejects.toThrow();
      expect(await countRows("PacketCapture")).toBe(1);

      expect(
        await PacketCaptureService.deleteOneById({
          id: id,
          props: member([
            Permission.ProjectMember,
            Permission.DeletePacketCapture,
          ]),
        }),
      ).toBe(1);

      expect(await readCapture(id)).toBeUndefined();
      expect(await countRows("File")).toBe(0);
      expect(recordDelete).toHaveBeenCalledTimes(1);

      /*
       * The audit log's snapshot of the deleted capture: what it ran, and
       * never the traffic itself. The delete reads every column for the
       * snapshot, the file's relation included, and gets its id alone - not
       * its bytes - which the audit recorder then leaves out as well, with
       * fileId (nobody may read either).
       */
      const deletedItem: PacketCapture = recordDelete.mock.calls[0]![0]
        .deletedItem as PacketCapture;

      expect(deletedItem.interfaceName).toBe("ens18");
      expect(deletedItem.bpfFilter).toBe("net 192.168.50.0/24 and tcp");
      expect(deletedItem.file?.file).toBeUndefined();
    });

    test("a capture started from a device's Traffic card is the device's, and a probe's limits hold", async () => {
      await PacketCaptureService.recordProbeCapability({
        probeId: probeId,
        capability: CAPABILITY,
      });
      getJestSpyOn(NetworkDeviceService, "findOneById").mockImplementation(
        async (): Promise<NetworkDevice> => {
          const device: NetworkDevice = new NetworkDevice(deviceId);
          device.projectId = projectId;
          return device;
        },
      );

      const started: PacketCapture = await PacketCaptureService.create({
        data: dashboardStartCapture({
          probeId: probeId,
          networkDeviceId: deviceId,
          interfaceName: "any",
          bpfFilter: "host 192.168.50.10",
          maxDurationInSeconds: 60,
          maxPackets: 100000,
          maxFileSizeInMB: 10,
        }),
        props: member([Permission.ProjectOwner]),
      });

      const rows: Array<{ networkDeviceId: string | null }> =
        await database.query(
          `SELECT "networkDeviceId" FROM "${schema}"."PacketCapture" WHERE "_id" = $1`,
          [started.id!.toString()],
        );

      expect(rows[0]!.networkDeviceId).toBe(deviceId.toString());

      // Past the probe's own maximum, refused in words that say so.
      await expect(
        PacketCaptureService.create({
          data: dashboardStartCapture({
            probeId: probeId,
            interfaceName: "ens18",
            bpfFilter: "",
            maxDurationInSeconds: 3600,
            maxPackets: 100000,
            maxFileSizeInMB: 10,
          }),
          props: member([Permission.ProjectOwner]),
        }),
      ).rejects.toThrow();
      expect(await countRows("PacketCapture")).toBe(1);
    });
  });

  describe("the migration", () => {
    test("indexes the claim and the per-project lists", async () => {
      const indexes: Array<{ indexdef: string }> = await database.query(
        `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'PacketCapture'`,
      );
      const definitions: string = indexes
        .map((index: { indexdef: string }): string => {
          return index.indexdef;
        })
        .join("\n");

      expect(definitions).toContain('("probeId", status, "createdAt")');
      expect(definitions).toContain('("projectId", "createdAt")');
    });

    test("a deleted file leaves its capture without one, and a deleted project takes its captures", async () => {
      const constraints: Array<{ definition: string }> = await database.query(
        `SELECT pg_get_constraintdef(c.oid) AS definition
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE n.nspname = 'public' AND t.relname = 'PacketCapture' AND c.contype = 'f'`,
      );
      const definitions: string = constraints
        .map((constraint: { definition: string }): string => {
          return constraint.definition;
        })
        .join("\n");

      // Qualified: the search path holds only this suite's schema.
      expect(definitions).toContain(
        'FOREIGN KEY ("fileId") REFERENCES public."File"(_id) ON DELETE SET NULL',
      );
      expect(definitions).toContain(
        'FOREIGN KEY ("projectId") REFERENCES public."Project"(_id) ON DELETE CASCADE',
      );
      expect(definitions).toContain(
        'FOREIGN KEY ("probeId") REFERENCES public."Probe"(_id) ON DELETE SET NULL',
      );
    });
  });
});
