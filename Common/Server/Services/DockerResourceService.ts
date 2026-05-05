import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/DockerResource";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import logger from "../Utils/Logger";

/*
 * ------------------------------------------------------------------
 * DockerResourceService
 *
 * Writes and reads the Docker inventory table populated by the
 * telemetry ingest path. Container rows are upserted from the
 * docker_stats receiver metric stream — every container.* metric
 * carries container.id / container.name / container.image.name
 * resource attributes, which is enough to maintain a live inventory
 * of running containers per host without any agent-side change.
 *
 * Image / Network / Volume kinds are reserved for a follow-up agent
 * change that adds a snapshot poller; the schema is ready for them.
 *
 * Rows are hard-deleted once lastSeenAt falls behind the staleness
 * threshold (default: 15 min) so containers that stopped emitting
 * metrics fall off the list automatically.
 * ------------------------------------------------------------------
 */

export interface ParsedDockerContainer {
  containerName: string;
  containerId: string | null;
  imageName: string | null;
  state: string;
  cpuPercent: number | null;
  memoryBytes: number | null;
  observedAt: Date;
}

const UPSERT_BATCH_SIZE: number = 500;
const STALE_DELETE_WARN_THRESHOLD: number = 100;

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /**
   * Upsert a batch of Container rows for a single (project, host)
   * pair. Uses ON CONFLICT on the UNIQUE (projectId, dockerHostId,
   * kind, name) index with a dominance guard on lastSeenAt so
   * out-of-order ingest never regresses a newer observation.
   *
   * Containers are upserted from metric snapshots (no separate
   * inventory snapshot path), so this also writes
   * latestCpuPercent / latestMemoryBytes / metricsUpdatedAt in the
   * same statement — saves a round trip vs. the K8s pattern of
   * upsert-then-update.
   */
  @CaptureSpan()
  public async bulkUpsertContainers(data: {
    projectId: ObjectID;
    dockerHostId: ObjectID;
    containers: Array<ParsedDockerContainer>;
  }): Promise<void> {
    if (data.containers.length === 0) {
      return;
    }

    for (
      let i: number = 0;
      i < data.containers.length;
      i += UPSERT_BATCH_SIZE
    ) {
      const chunk: Array<ParsedDockerContainer> = data.containers.slice(
        i,
        i + UPSERT_BATCH_SIZE,
      );

      const valueFragments: Array<string> = [];
      const params: Array<unknown> = [];
      let p: number = 1;

      for (const c of chunk) {
        valueFragments.push(
          `($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}::numeric, $${p++}::bigint, $${p++}::timestamptz, $${p++}::timestamptz, $${p++})`,
        );
        params.push(
          data.projectId.toString(),
          data.dockerHostId.toString(),
          "Container",
          c.containerName,
          c.containerId,
          c.imageName,
          c.state,
          c.cpuPercent !== null && c.cpuPercent !== undefined
            ? c.cpuPercent
            : null,
          c.memoryBytes !== null && c.memoryBytes !== undefined
            ? Math.trunc(c.memoryBytes).toString()
            : null,
          c.observedAt,
          c.observedAt,
          0, // version (BaseModel @VersionColumn)
        );
      }

      const sql: string = `
        INSERT INTO "DockerResource" (
          "projectId", "dockerHostId", "kind", "name",
          "containerId", "imageName", "state",
          "latestCpuPercent", "latestMemoryBytes",
          "metricsUpdatedAt", "lastSeenAt", "version"
        )
        VALUES ${valueFragments.join(", ")}
        ON CONFLICT ("projectId", "dockerHostId", "kind", "name")
        DO UPDATE SET
          "containerId" = COALESCE(EXCLUDED."containerId", "DockerResource"."containerId"),
          "imageName" = COALESCE(EXCLUDED."imageName", "DockerResource"."imageName"),
          "state" = EXCLUDED."state",
          "latestCpuPercent" = COALESCE(EXCLUDED."latestCpuPercent", "DockerResource"."latestCpuPercent"),
          "latestMemoryBytes" = COALESCE(EXCLUDED."latestMemoryBytes", "DockerResource"."latestMemoryBytes"),
          "metricsUpdatedAt" = EXCLUDED."metricsUpdatedAt",
          "lastSeenAt" = EXCLUDED."lastSeenAt",
          "updatedAt" = now()
        WHERE EXCLUDED."lastSeenAt" >= "DockerResource"."lastSeenAt"
      `;

      await this.getRepository().manager.query(sql, params);
    }
  }

  /**
   * Hard-delete all resources on a host whose last observation is
   * older than olderThan. Returns the number of deleted rows.
   */
  @CaptureSpan()
  public async deleteStaleForHost(data: {
    dockerHostId: ObjectID;
    olderThan: Date;
  }): Promise<number> {
    const result: Array<{ affected?: number }> | { affected?: number } =
      await this.getRepository().manager.query(
        `DELETE FROM "DockerResource" WHERE "dockerHostId" = $1 AND "lastSeenAt" < $2`,
        [data.dockerHostId.toString(), data.olderThan],
      );

    let affected: number = 0;
    if (Array.isArray(result) && result.length >= 2) {
      const second: unknown = (result as Array<unknown>)[1];
      if (typeof second === "number") {
        affected = second;
      }
    }

    if (affected > STALE_DELETE_WARN_THRESHOLD) {
      logger.warn(
        `DockerResource cleanup deleted ${affected} stale rows for host ${data.dockerHostId.toString()} — larger than expected; investigate agent health.`,
      );
    }

    return affected;
  }

  public getStaleThresholdDate(nowOverride?: Date): Date {
    const minutes: number = this.getStaleThresholdMinutes();
    return OneUptimeDate.addRemoveMinutes(
      nowOverride || OneUptimeDate.getCurrentDate(),
      -minutes,
    );
  }

  public getStaleThresholdMinutes(): number {
    const raw: string | undefined =
      process.env["DOCKER_INVENTORY_STALE_MINUTES"];
    if (raw) {
      const parsed: number = parseInt(raw, 10);
      if (!isNaN(parsed) && parsed >= 5) {
        return parsed;
      }
    }
    return 15;
  }
}

export default new Service();
