import DuplicateRowMerge, {
  ColumnWithoutForeignKey,
  ColumnsTakenTogether,
  DuplicateRowMergeOptions,
} from "../DuplicateRowMerge";
import OnlineDdl from "../OnlineDdl";
import logger from "../../../Utils/Logger";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * One host per host name in a project: Docker hosts, Podman hosts and hosts
 * get a unique index on what ingest finds them by, after the duplicates a
 * project already has are merged.
 *
 * WHY
 *
 * Ingest creates a host the first time telemetry names it
 * (findOrCreateByHostIdentifier): it looks the host name up, and creates the
 * host when nothing answers. Nothing in the database held that to one row,
 * so two batches that met a new host at once - an agent's metrics beside its
 * logs, two ingest workers, the Docker AI agent registering beside the
 * collector - could both create it (issue #5214: re-installing a Docker
 * agent after a restart made two "test01"). Every other kind of resource
 * ingest discovers - Kubernetes clusters, Proxmox and Ceph clusters,
 * vCenters, fleets, arrays, functions, cloud resources, RUM applications,
 * databases, services - has a unique index on what it is found by already.
 *
 * WHAT IT DOES, FOR EACH OF THE THREE TABLES
 *
 *   1. Merges the duplicates (DuplicateRowMerge): rows of one project whose
 *      host names are the same but for case - the comparison the lookup
 *      makes (QueryHelper.findWithSameText) - among rows not deleted. The
 *      oldest is kept. Everything that refers to the others - containers,
 *      labels, owners, the feed, incidents, alerts, monitors, maintenance
 *      events and templates that name them, the hosts a Docker host runs,
 *      a database found on it, its AI agent, AI suggestions, dismissed
 *      recommendations, inventory links, exceptions and usage rows - refers
 *      to the kept host instead; where the kept host already has the twin of
 *      a row (the same container, label, owner or incident), the kept one
 *      stays and the twin's own references are handed to it. The kept host
 *      takes the last-seen time, status and what the agent reports from the
 *      duplicate the agent wrote to last, and a description or retention it
 *      lacks from the others. It stays archived only if every copy was: a
 *      person who archived one of two hosts named test01 hid the extra copy,
 *      not the host, so a host whose agent still reports never moves to the
 *      Archived page because its oldest copy was the one archived. AI
 *      settings an operator chose for a copy (investigation, fixes, the
 *      allowlist) are kept where no one chose any for the kept host, so an
 *      operator's "off" never turns back into a default. Then the
 *      duplicates are deleted.
 *   2. Builds the unique index online (OnlineDdl.createIndex: CREATE UNIQUE
 *      INDEX CONCURRENTLY), so ingest keeps writing hosts while it builds.
 *
 * A worker of the version before this one can create a new duplicate in
 * between - a build that finds one fails with unique_violation (23505), and
 * the merge and the build run again, up to MAX_ATTEMPTS times. From then on
 * the database refuses the second row: the create that loses the race fails,
 * and findOrCreateByHostIdentifier reads the row that won (insert-or-read).
 *
 * WHY THIS IS HAND-WRITTEN
 *
 * An index on LOWER("hostIdentifier") is not something @Index() can say, so
 * the generator can neither write nor round-trip it (as for
 * 1786100000000-RestoreServiceLowerNameIndex). The entities declare each
 * index by name with synchronize: false (Types/Database/UnsynchronizedIndex),
 * so the schema builder leaves it alone in both directions. The merge is
 * data, which no generator writes.
 *
 * `transaction = false`: CREATE INDEX CONCURRENTLY cannot run inside a
 * transaction, and each duplicate group is merged in a transaction of its
 * own. Safe to run again from the start: merged groups are gone, and an index
 * already valid is left as it is.
 *
 * down() drops the indexes. The merged rows stay merged.
 */

export const MAX_ATTEMPTS: number = 5;

// Where a host's id is kept without a foreign key; a uuid names one row.
export const HOST_ID_COLUMNS_WITHOUT_FOREIGN_KEY: ReadonlyArray<ColumnWithoutForeignKey> =
  [
    { table: "ResourceAiAgent", column: "resourceId" },
    { table: "AutoRemediationSuggestion", column: "resourceId" },
    { table: "RecommendationDismissal", column: "resourceId" },
    { table: "RunnerJob", column: "resourceId" },
    { table: "InventoryItem", column: "resourceId" },
    { table: "TelemetryException", column: "primaryEntityId" },
    { table: "TelemetryUsageBilling", column: "primaryEntityId" },
  ];

// What the agent reports: the kept host takes it from the newest duplicate.
const REPORTED_BY_EVERY_HOST_AGENT: ReadonlyArray<string> = [
  "lastSeenAt",
  "otelCollectorStatus",
  "agentVersion",
  "osType",
  "osVersion",
];

// What a person sets: the kept host keeps its own, or takes a duplicate's.
const SET_BY_A_PERSON: ReadonlyArray<string> = [
  "description",
  "retainTelemetryDataForDays",
  "telemetryRetentionConfig",
];

/*
 * What a person sets that has no empty value to tell "not set" by, each
 * taken from one host: the kept host's own when they are what is wanted,
 * else the copy seen last where they are.
 */
export const SET_BY_A_PERSON_TOGETHER: ReadonlyArray<ColumnsTakenTogether> = [
  // Archived only if every copy was: one copy left on the list keeps it there.
  {
    columns: ["isArchived", "archivedAt", "archivedByUserId"],
    where: `member."isArchived" IS NOT TRUE`,
  },
  // The AI settings an operator chose (aiAccessConfiguredAt says when).
  {
    columns: [
      "isAiInvestigationEnabled",
      "aiRemediationMode",
      "aiCommandAllowlist",
      "aiAccessConfiguredAt",
    ],
    where: `member."aiAccessConfiguredAt" IS NOT NULL`,
  },
];

// How one table's duplicates are found and merged.
export const HOST_TABLE_MERGES: ReadonlyArray<DuplicateRowMergeOptions> = [
  {
    table: "DockerHost",
    duplicateKey: `"projectId", LOWER("hostIdentifier")`,
    where: `"deletedAt" IS NULL`,
    columnsWithoutForeignKey: HOST_ID_COLUMNS_WITHOUT_FOREIGN_KEY,
    latestOf: REPORTED_BY_EVERY_HOST_AGENT,
    keptOrFirstOf: SET_BY_A_PERSON,
    takenTogether: SET_BY_A_PERSON_TOGETHER,
    latestBy: "lastSeenAt",
  },
  {
    table: "PodmanHost",
    duplicateKey: `"projectId", LOWER("hostIdentifier")`,
    where: `"deletedAt" IS NULL`,
    columnsWithoutForeignKey: HOST_ID_COLUMNS_WITHOUT_FOREIGN_KEY,
    latestOf: REPORTED_BY_EVERY_HOST_AGENT,
    keptOrFirstOf: SET_BY_A_PERSON,
    takenTogether: SET_BY_A_PERSON_TOGETHER,
    latestBy: "lastSeenAt",
  },
  {
    table: "Host",
    duplicateKey: `"projectId", LOWER("hostIdentifier")`,
    where: `"deletedAt" IS NULL`,
    columnsWithoutForeignKey: HOST_ID_COLUMNS_WITHOUT_FOREIGN_KEY,
    latestOf: [
      ...REPORTED_BY_EVERY_HOST_AGENT,
      "hostId",
      "hostArch",
      "hostType",
      "hostIpAddresses",
      "cpuCores",
      "totalMemoryBytes",
      "processCount",
      "containerRuntime",
      "dockerHostId",
      "kubernetesClusterId",
      "proxmoxClusterId",
      "deploymentEnvironment",
      "runtimeName",
      "runtimeVersion",
      "cloudProvider",
      "cloudPlatform",
      "cloudRegion",
      "cloudAccountId",
      // The collector OneUptime manages on the host, as it last checked in.
      "collectorInstanceUid",
      "collectorLastContactAt",
      "collectorRegisteredAt",
      "collectorConfigId",
      "collectorConfigVersionId",
      "collectorConfigHash",
      "collectorConfigStatus",
      "collectorConfigError",
      "collectorFailedConfigHash",
      "isCollectorHealthy",
      "collectorHealthError",
      "collectorHostFeatures",
    ],
    keptOrFirstOf: SET_BY_A_PERSON,
    takenTogether: SET_BY_A_PERSON_TOGETHER,
    latestBy: "lastSeenAt",
  },
];

const UNIQUE_VIOLATION: string = "23505";

export class MergeDuplicateHostsAndAddUniqueHostIdentifier1806700000000
  implements MigrationInterface
{
  public name: string =
    "MergeDuplicateHostsAndAddUniqueHostIdentifier1806700000000";

  // CREATE INDEX CONCURRENTLY cannot run in a transaction; each merge has its own.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.mergeAndBuild(queryRunner, HOST_TABLE_MERGES[0]!, async () => {
      await OnlineDdl.createIndex(
        queryRunner,
        `CREATE UNIQUE INDEX "IDX_docker_host_project_lower_host_identifier" ON "DockerHost" ("projectId", LOWER("hostIdentifier")) WHERE "deletedAt" IS NULL`,
      );
    });

    await this.mergeAndBuild(queryRunner, HOST_TABLE_MERGES[1]!, async () => {
      await OnlineDdl.createIndex(
        queryRunner,
        `CREATE UNIQUE INDEX "IDX_podman_host_project_lower_host_identifier" ON "PodmanHost" ("projectId", LOWER("hostIdentifier")) WHERE "deletedAt" IS NULL`,
      );
    });

    await this.mergeAndBuild(queryRunner, HOST_TABLE_MERGES[2]!, async () => {
      await OnlineDdl.createIndex(
        queryRunner,
        `CREATE UNIQUE INDEX "IDX_host_project_lower_host_identifier" ON "Host" ("projectId", LOWER("hostIdentifier")) WHERE "deletedAt" IS NULL`,
      );
    });
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_host_project_lower_host_identifier"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_podman_host_project_lower_host_identifier"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_docker_host_project_lower_host_identifier"`,
    );
  }

  /*
   * Merges the table's duplicates, then builds its index - again, while a
   * build finds a duplicate created in between.
   */
  private async mergeAndBuild(
    queryRunner: QueryRunner,
    merge: DuplicateRowMergeOptions,
    build: () => Promise<void>,
  ): Promise<void> {
    for (let attempt: number = 1; ; attempt++) {
      await DuplicateRowMerge.merge(queryRunner, merge);

      try {
        await build();
        return;
      } catch (error) {
        if (
          getErrorCode(error) !== UNIQUE_VIOLATION ||
          attempt >= MAX_ATTEMPTS
        ) {
          throw error;
        }

        logger.warn(
          `${merge.table}: a duplicate host was created while its unique index was being built; merging again (attempt ${attempt + 1} of ${MAX_ATTEMPTS}).`,
        );
      }
    }
  }
}

function getErrorCode(error: unknown): string | undefined {
  const code: unknown =
    (error as { code?: unknown } | null)?.code ??
    (error as { driverError?: { code?: unknown } } | null)?.driverError?.code;

  return typeof code === "string" ? code : undefined;
}
