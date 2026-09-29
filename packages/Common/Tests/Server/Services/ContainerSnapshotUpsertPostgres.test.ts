import DockerResourceService from "../../../Server/Services/DockerResourceService";
import PodmanResourceService from "../../../Server/Services/PodmanResourceService";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import { Client } from "pg";

/*
 * The metrics snapshot's Container upsert (bulkUpsertContainers) EXECUTED
 * on Postgres, with the inventory snapshot's bulkUpsert beside it: the
 * Compose / Testcontainers labels the agents copy onto their metrics are
 * MERGED into a row's labels (never wiping what the inventory wrote), the
 * container's start time fills resourceCreationTimestamp and only moves
 * forward on a restart or a recreation, and a row without them is left
 * alone. Values are the end-to-end run's (compose-postgres-1, started
 * 23:26:39.057 on the 24th).
 *
 * Opt in with RUN_POSTGRES_DATABASE_SERVER_SQL_TESTS=true, as for
 * DatabaseContainerCommandPostgres (any database will do: the tables are
 * session TEMP tables shadowing public). Credentials from
 * DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * DATABASE_SERVER_SQL_TEST_DATABASE_NAME or DATABASE_NAME, endpoint from
 * DATABASE_SERVER_SQL_TEST_DATABASE_HOST / _PORT (default localhost:5400).
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_DATABASE_SERVER_SQL_TESTS"] === "true"
    ? describe
    : describe.skip;

const PROJECT_ID: ObjectID = ObjectID.generate();
const HOST_ID: ObjectID = ObjectID.generate();

const CONTAINER_ID: string =
  "1b09d4df414d90f1c3afc18ed6076e56d0f27e8b18cca4c18e1776ae7e8ad107";
const RECREATED_ID: string =
  "9f0e2d4c6b8a0f1e3d5c7b9a1f3e5d7c9b1a3f5e7d9c1b3a5f7e9d1c3b5a7f9e";
const STARTED_AT: Date = new Date("2026-09-24T23:26:39.057Z");
const SCRAPE_AT: Date = new Date("2026-09-25T01:10:20.523Z");
const MINUTE_MS: number = 60 * 1000;

const COMPOSE_LABELS: JSONObject = {
  "com.docker.compose.service": "postgres",
  "com.docker.compose.oneoff": "False",
  "com.docker.compose.project": "e2e-docker-spans-compose",
};

interface StoredRow {
  containerId: string | null;
  labels: JSONObject | null;
  resourceCreationTimestamp: Date | null;
  lastSeenAt: Date;
}

function tableDdl(table: string, parentColumn: string): string {
  return `CREATE TEMP TABLE "${table}" (
    "_id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "createdAt" timestamptz NOT NULL DEFAULT now(),
    "updatedAt" timestamptz NOT NULL DEFAULT now(),
    "deletedAt" timestamptz,
    "version" integer NOT NULL,
    "projectId" uuid NOT NULL,
    "${parentColumn}" uuid NOT NULL,
    "kind" varchar(100) NOT NULL,
    "name" varchar(500) NOT NULL,
    "containerId" varchar(100),
    "imageName" varchar(500),
    "state" varchar(100),
    "labels" jsonb,
    "latestCpuPercent" numeric,
    "latestMemoryBytes" bigint,
    "metricsUpdatedAt" timestamptz,
    "lastSeenAt" timestamptz NOT NULL,
    "resourceCreationTimestamp" timestamptz
  );
  CREATE UNIQUE INDEX ON "${table}" ("projectId", "${parentColumn}", "kind", "name");`;
}

describePostgres("the container snapshot upsert on Postgres", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({
      host:
        process.env["DATABASE_SERVER_SQL_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["DATABASE_SERVER_SQL_TEST_DATABASE_PORT"] || "5400",
      ),
      user: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["DATABASE_SERVER_SQL_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
    });
    await client.connect();
    await client.query(tableDdl("DockerResource", "dockerHostId"));
    await client.query(tableDdl("PodmanResource", "podmanHostId"));
  });

  afterAll(async () => {
    await client.end();
  });

  beforeEach(async () => {
    await client.query(`DELETE FROM "DockerResource"`);
    await client.query(`DELETE FROM "PodmanResource"`);
    const manager: {
      query: (sql: string, params: Array<unknown>) => Promise<unknown>;
    } = {
      query: async (sql: string, params: Array<unknown>): Promise<unknown> => {
        return (await client.query(sql, params)).rows;
      },
    };
    for (const service of [DockerResourceService, PodmanResourceService]) {
      jest
        .spyOn(service, "getRepository")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .mockReturnValue({ manager } as any);
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function scrape(data: {
    service: "docker" | "podman";
    at: Date;
    containerId?: string;
    labels?: JSONObject | null;
    startedAt?: Date | null;
  }): Promise<void> {
    const container: {
      containerName: string;
      containerId: string;
      imageName: string;
      state: string;
      cpuPercent: number;
      memoryBytes: number;
      observedAt: Date;
      labels: JSONObject | null;
      startedAt: Date | null;
    } = {
      containerName: "e2e-docker-spans-compose-postgres-1",
      containerId: data.containerId ?? CONTAINER_ID,
      imageName: "postgres:16",
      state: "running",
      cpuPercent: 0.53,
      memoryBytes: 24289280,
      observedAt: data.at,
      labels: data.labels === undefined ? COMPOSE_LABELS : data.labels,
      startedAt: data.startedAt === undefined ? STARTED_AT : data.startedAt,
    };
    if (data.service === "docker") {
      await DockerResourceService.bulkUpsertContainers({
        projectId: PROJECT_ID,
        dockerHostId: HOST_ID,
        containers: [container],
      });
    } else {
      await PodmanResourceService.bulkUpsertContainers({
        projectId: PROJECT_ID,
        podmanHostId: HOST_ID,
        containers: [container],
      });
    }
  }

  async function stored(service: "docker" | "podman"): Promise<StoredRow> {
    const table: string =
      service === "docker" ? "DockerResource" : "PodmanResource";
    const result: { rows: Array<StoredRow> } = await client.query(
      `SELECT "containerId", "labels", "resourceCreationTimestamp", "lastSeenAt" FROM "${table}"`,
    );
    expect(result.rows).toHaveLength(1);
    return result.rows[0]!;
  }

  describe.each(["docker", "podman"] as Array<"docker" | "podman">)(
    "%s",
    (service: "docker" | "podman") => {
      test("regression: a new row gets the labels and the start time the agent reported", async () => {
        await scrape({ service, at: SCRAPE_AT });

        const row: StoredRow = await stored(service);
        expect(row.labels).toEqual(COMPOSE_LABELS);
        expect(row.resourceCreationTimestamp).toEqual(STARTED_AT);
      });

      test("an existing row without them (written before the fix) is filled in", async () => {
        await scrape({
          service,
          at: new Date(SCRAPE_AT.getTime() - MINUTE_MS),
          labels: null,
          startedAt: null,
        });
        expect((await stored(service)).labels).toBeNull();

        await scrape({ service, at: SCRAPE_AT });

        const row: StoredRow = await stored(service);
        expect(row.labels).toEqual(COMPOSE_LABELS);
        expect(row.resourceCreationTimestamp).toEqual(STARTED_AT);
      });

      test("labels the inventory snapshot wrote are merged into, never wiped", async () => {
        const inventoryLabels: JSONObject = {
          ...COMPOSE_LABELS,
          "com.docker.compose.config-hash": "abc123",
          maintainer: "PostgreSQL Docker Maintainers",
        };
        const upsert: {
          projectId: ObjectID;
          resources: Array<{
            kind: string;
            name: string;
            containerId: string;
            imageName: string;
            state: string;
            labels: JSONObject;
            resourceCreationTimestamp: Date;
            lastSeenAt: Date;
          }>;
        } = {
          projectId: PROJECT_ID,
          resources: [
            {
              kind: "Container",
              name: "e2e-docker-spans-compose-postgres-1",
              containerId: CONTAINER_ID,
              imageName: "postgres:16",
              state: "running",
              labels: inventoryLabels,
              resourceCreationTimestamp: new Date(STARTED_AT.getTime() - 2000),
              lastSeenAt: new Date(SCRAPE_AT.getTime() - MINUTE_MS),
            },
          ],
        };
        if (service === "docker") {
          await DockerResourceService.bulkUpsert({
            ...upsert,
            dockerHostId: HOST_ID,
          });
        } else {
          await PodmanResourceService.bulkUpsert({
            ...upsert,
            podmanHostId: HOST_ID,
          });
        }

        await scrape({ service, at: SCRAPE_AT });

        const row: StoredRow = await stored(service);
        expect(row.labels).toEqual(inventoryLabels);
        // The inventory's own creation time stands (the start is 2 s later).
        expect(row.resourceCreationTimestamp).toEqual(
          new Date(STARTED_AT.getTime() - 2000),
        );
      });

      test("scrape jitter never rewrites the start time; a restart moves it forward", async () => {
        await scrape({ service, at: SCRAPE_AT });
        await scrape({
          service,
          at: new Date(SCRAPE_AT.getTime() + 30000),
          startedAt: new Date(STARTED_AT.getTime() + 800),
        });
        expect((await stored(service)).resourceCreationTimestamp).toEqual(
          STARTED_AT,
        );

        const restartedAt: Date = new Date(SCRAPE_AT.getTime() + 5 * MINUTE_MS);
        await scrape({
          service,
          at: new Date(SCRAPE_AT.getTime() + 6 * MINUTE_MS),
          startedAt: restartedAt,
        });
        expect((await stored(service)).resourceCreationTimestamp).toEqual(
          restartedAt,
        );
      });

      test("a container recreated under the same name replaces the labels and the start time", async () => {
        await scrape({
          service,
          at: SCRAPE_AT,
          labels: { ...COMPOSE_LABELS, "org.testcontainers": "true" },
        });

        const recreatedAt: Date = new Date(SCRAPE_AT.getTime() + 20000);
        await scrape({
          service,
          at: new Date(SCRAPE_AT.getTime() + 30000),
          containerId: RECREATED_ID,
          startedAt: recreatedAt,
        });

        const row: StoredRow = await stored(service);
        expect(row.containerId).toBe(RECREATED_ID);
        expect(row.labels).toEqual(COMPOSE_LABELS);
        expect(row.resourceCreationTimestamp).toEqual(recreatedAt);
      });

      test("an out-of-order older scrape changes nothing", async () => {
        await scrape({ service, at: SCRAPE_AT });
        await scrape({
          service,
          at: new Date(SCRAPE_AT.getTime() - 5 * MINUTE_MS),
          labels: { "com.docker.compose.project": "other" },
          startedAt: new Date(SCRAPE_AT.getTime() - MINUTE_MS),
        });

        const row: StoredRow = await stored(service);
        expect(row.labels).toEqual(COMPOSE_LABELS);
        expect(row.resourceCreationTimestamp).toEqual(STARTED_AT);
        expect(row.lastSeenAt).toEqual(SCRAPE_AT);
      });
    },
  );
});
