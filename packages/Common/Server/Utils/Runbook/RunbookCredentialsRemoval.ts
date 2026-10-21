import RunbookVariablesMove, {
  LEGACY_CREDENTIAL_TABLE_SQL,
  LegacyQuery,
  RunbookVariablesMoveSummary,
} from "./RunbookVariablesMove";
import { Service as RunnerServiceClass } from "../../Services/RunnerService";
import RunbookVariableService from "../../Services/RunbookVariableService";
import logger from "../Logger";
import ObjectID from "../../../Types/ObjectID";

/*
 * RUNBOOK CREDENTIALS ARE REMOVED.
 *
 * Runbook credentials (Runbooks > Runners > AI Access) were what OneUptime
 * AI's own commands reached through a Runner: an SSH host, or the API server
 * of a Kubernetes cluster bound to a Runner outside it. Hosts and clusters
 * have AI agents of their own now, which never take a credential from
 * OneUptime, and runbook steps sign in with runbook variables - so the
 * credentials went, and with them everything that used them. This removes
 * what they left, once:
 *
 *   1. the runbook steps that still name a credential (written through the
 *      API since the first move) are moved to variables the way the first
 *      move moved the rest, and the Kubernetes steps that move kept a
 *      credential and an action on for an older Runner have them taken off
 *      (RunbookVariablesMove, without the secrets: every one of them moved
 *      the first time);
 *   2. every Kubernetes cluster bound to a Runner that is not a
 *      kubernetes-agent Runner - one that reached the cluster with a
 *      Kubernetes credential - has the binding cleared: OneUptime AI then
 *      reaches the cluster through its Kubernetes AI agent, when it has one;
 *   3. every credential is deleted, with the Runners it was assigned to:
 *      its encrypted SSH key, password, passphrase or service account token
 *      is no longer kept anywhere. The empty legacy tables stay, as the
 *      runbook secrets' do.
 *
 * The cluster column that bound a credential (aiAccessCredentialId) is
 * dropped by the schema migration RemoveRunbookCredentials; schema
 * migrations run before data migrations, so nothing here reads it.
 *
 * Statements run against the legacy tables, as the migrations made them
 * (the model is gone). Idempotent: a second run finds nothing to move,
 * clear or delete. Never throws: a step that fails is logged, and the
 * steps after it still run.
 *
 * Run once by the Workers' data migration RemoveRunbookCredentials, and
 * tested against a migrated Postgres
 * (Tests/Server/Utils/Runbook/RunbookCredentialsRemovalPostgres.test.ts).
 */

/*
 * Every Kubernetes cluster bound to a Runner, with what tells whether that
 * Runner is a kubernetes-agent Runner (its name and posture).
 */
export const CLUSTERS_BOUND_TO_RUNNERS_SQL: string = `SELECT c."_id" AS "clusterId", c."aiAccessRunnerId" AS "runnerId", r."name" AS "runnerName", r."hostInfo" AS "runnerHostInfo" FROM "KubernetesCluster" c JOIN "Runner" r ON r."_id" = c."aiAccessRunnerId" WHERE c."aiAccessRunnerId" IS NOT NULL`;

// Clears one cluster's binding, only while it is still to that Runner.
export const CLEAR_CLUSTER_RUNNER_BINDING_SQL: string = `UPDATE "KubernetesCluster" SET "aiAccessRunnerId" = NULL, "updatedAt" = now() WHERE "_id" = $1 AND "aiAccessRunnerId" = $2`;

export const DELETE_CREDENTIAL_RUNNERS_SQL: string = `DELETE FROM "RunbookCredentialRunner"`;

export const DELETE_CREDENTIALS_SQL: string = `DELETE FROM "RunbookCredential"`;

export interface RunbookCredentialsRemovalSummary {
  // What moving the steps that still named a credential did.
  move: RunbookVariablesMoveSummary | null;
  clusterBindingsCleared: number;
  credentialsDeleted: number;
  // Which of the three steps failed (logged); empty when none did.
  failedSteps: Array<"move" | "cluster_bindings" | "delete">;
}

// A cluster bound to a Runner, as the driver returns the join.
interface BoundClusterRow {
  clusterId: unknown;
  runnerId: unknown;
  runnerName: unknown;
  runnerHostInfo: unknown;
}

function readRows<T>(rows: unknown): Array<T> {
  return Array.isArray(rows) ? (rows as Array<T>) : [];
}

/*
 * How many rows a DELETE or UPDATE through the driver touched: node-postgres
 * answers [rows, count] through TypeORM's query().
 */
function readAffectedCount(result: unknown): number {
  if (Array.isArray(result) && typeof result[1] === "number") {
    return result[1];
  }

  return 0;
}

export default class RunbookCredentialsRemoval {
  public static async removeAll(
    query: LegacyQuery = RunbookCredentialsRemoval.defaultQuery(),
  ): Promise<RunbookCredentialsRemovalSummary> {
    const summary: RunbookCredentialsRemovalSummary = {
      move: null,
      clusterBindingsCleared: 0,
      credentialsDeleted: 0,
      failedSteps: [],
    };

    try {
      summary.move = await RunbookVariablesMove.moveAll(query, {
        moveSecrets: false,
      });
    } catch (err) {
      summary.failedSteps.push("move");
      logger.error(
        "RunbookCredentialsRemoval: the runbook steps that still name a credential could not be moved to variables:",
      );
      logger.error(err);
    }

    try {
      summary.clusterBindingsCleared =
        await RunbookCredentialsRemoval.clearOutsideRunnerBindings(query);
    } catch (err) {
      summary.failedSteps.push("cluster_bindings");
      logger.error(
        "RunbookCredentialsRemoval: the Kubernetes clusters bound to a Runner outside them could not be cleared:",
      );
      logger.error(err);
    }

    try {
      summary.credentialsDeleted =
        await RunbookCredentialsRemoval.deleteCredentials(query);
    } catch (err) {
      summary.failedSteps.push("delete");
      logger.error(
        "RunbookCredentialsRemoval: the runbook credentials could not be deleted:",
      );
      logger.error(err);
    }

    return summary;
  }

  /*
   * Clears the binding of every cluster bound to a Runner that is not a
   * kubernetes-agent Runner (RunnerService.isKubernetesAgentRunnerRow, the
   * one rule: its name marker or an agent posture). Such a Runner ran
   * OneUptime AI's kubectl outside the cluster with a Kubernetes runbook
   * credential, and can reach the cluster no more. The previous in-cluster
   * Runner of a cluster keeps its binding. Returns how many were cleared.
   */
  public static async clearOutsideRunnerBindings(
    query: LegacyQuery,
  ): Promise<number> {
    let cleared: number = 0;

    for (const row of readRows<BoundClusterRow>(
      await query(CLUSTERS_BOUND_TO_RUNNERS_SQL),
    )) {
      const clusterId: string = String(row.clusterId || "");
      const runnerId: string = String(row.runnerId || "");

      if (!ObjectID.isValidUUID(clusterId) || !ObjectID.isValidUUID(runnerId)) {
        continue;
      }

      if (
        RunnerServiceClass.isKubernetesAgentRunnerRow({
          name: row.runnerName,
          hostInfo: RunbookCredentialsRemoval.readHostInfo(row.runnerHostInfo),
        })
      ) {
        continue;
      }

      const affected: number = readAffectedCount(
        await query(CLEAR_CLUSTER_RUNNER_BINDING_SQL, [clusterId, runnerId]),
      );

      if (affected > 0) {
        cleared++;
        logger.info(
          `RunbookCredentialsRemoval: Kubernetes cluster ${clusterId} was bound to Runner ${runnerId}, which ran OneUptime AI's kubectl from outside the cluster with a runbook credential; the binding was cleared, so OneUptime AI reaches the cluster through its Kubernetes AI agent.`,
        );
      }
    }

    return cleared;
  }

  /*
   * Deletes every runbook credential and its Runner assignments. Nothing to
   * do when the legacy tables are gone. Returns how many credentials were
   * deleted.
   */
  public static async deleteCredentials(query: LegacyQuery): Promise<number> {
    const tables: Record<string, unknown> | undefined = readRows<
      Record<string, unknown>
    >(await query(LEGACY_CREDENTIAL_TABLE_SQL))[0];

    if (tables?.["hasCredentialRunnerTable"] === true) {
      await query(DELETE_CREDENTIAL_RUNNERS_SQL);
    }

    if (tables?.["hasCredentialTable"] !== true) {
      return 0;
    }

    return readAffectedCount(await query(DELETE_CREDENTIALS_SQL));
  }

  // A Runner's hostInfo as the driver returns it: jsonb parsed, or text.
  private static readHostInfo(value: unknown): unknown {
    if (typeof value !== "string") {
      return value;
    }

    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }

  private static defaultQuery(): LegacyQuery {
    return async (
      sql: string,
      parameters?: Array<unknown>,
    ): Promise<unknown> => {
      return await RunbookVariableService.getRepository().manager.query(
        sql,
        parameters,
      );
    };
  }
}
