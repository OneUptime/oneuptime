import RunbookCredentialsRemoval, {
  CLEAR_CLUSTER_RUNNER_BINDING_SQL,
  CLUSTERS_BOUND_TO_RUNNERS_SQL,
  DELETE_CREDENTIALS_SQL,
  DELETE_CREDENTIAL_RUNNERS_SQL,
  RunbookCredentialsRemovalSummary,
} from "../../../../Server/Utils/Runbook/RunbookCredentialsRemoval";
import RunbookVariablesMove, {
  LEGACY_CREDENTIAL_TABLE_SQL,
  RunbookVariablesMoveSummary,
} from "../../../../Server/Utils/Runbook/RunbookVariablesMove";
import logger from "../../../../Server/Utils/Logger";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * RUNBOOK CREDENTIALS ARE REMOVED, ONCE (RunbookCredentialsRemoval, run by
 * the Workers' data migration RemoveRunbookCredentials):
 *
 *   1. the steps that still name a credential are moved to variables -
 *      RunbookVariablesMove without the secrets, which every one of them
 *      moved the first time;
 *   2. a Kubernetes cluster bound to a Runner outside it (one that reached
 *      it with a Kubernetes credential) has the binding cleared; a cluster's
 *      own in-cluster Runner - by its name marker or its posture - keeps it;
 *   3. every credential is deleted, with the Runners it was assigned to.
 *
 * A step that fails is logged, and the steps after it still run. The
 * statements are answered by a fake here; RunbookVariablesMovePostgres runs
 * them against a migrated Postgres.
 */

const OUTSIDE_CLUSTER: string = "c0000000-0000-4000-8000-000000000001";
const AGENT_CLUSTER: string = "c0000000-0000-4000-8000-000000000002";
const POSTURE_CLUSTER: string = "c0000000-0000-4000-8000-000000000003";
const OUTSIDE_RUNNER: string = "e0000000-0000-4000-8000-000000000001";
const AGENT_RUNNER: string = "e0000000-0000-4000-8000-000000000002";
const POSTURE_RUNNER: string = "e0000000-0000-4000-8000-000000000003";

const MOVED: RunbookVariablesMoveSummary = {
  secretsMoved: 0,
  secretsAlreadyMoved: 0,
  secretsSkipped: 0,
  credentialsMoved: 1,
  stepsMoved: 1,
  runbooksRewritten: 1,
  projectsFailed: 0,
};

interface Statement {
  sql: string;
  parameters: Array<unknown> | undefined;
}

describe("RunbookCredentialsRemoval.removeAll", () => {
  let statements: Array<Statement>;
  let boundClusters: Array<Record<string, unknown>>;
  let tables: Record<string, unknown>;
  let credentialsLeft: number;
  let failOn: string | null;
  let moveAll: jest.SpyInstance;

  // The legacy tables and the clusters, as the driver answers for them.
  async function query(
    sql: string,
    parameters?: Array<unknown>,
  ): Promise<unknown> {
    statements.push({ sql, parameters });

    if (failOn === sql) {
      throw new Error("the database went away");
    }

    if (sql === CLUSTERS_BOUND_TO_RUNNERS_SQL) {
      return boundClusters;
    }

    if (sql === CLEAR_CLUSTER_RUNNER_BINDING_SQL) {
      const cluster: Record<string, unknown> | undefined = boundClusters.find(
        (row: Record<string, unknown>): boolean => {
          return (
            row["clusterId"] === parameters![0] &&
            row["runnerId"] === parameters![1]
          );
        },
      );

      // node-postgres through TypeORM: [rows, affected].
      return [[], cluster ? 1 : 0];
    }

    if (sql === LEGACY_CREDENTIAL_TABLE_SQL) {
      return [tables];
    }

    if (sql === DELETE_CREDENTIAL_RUNNERS_SQL) {
      return [[], 3];
    }

    if (sql === DELETE_CREDENTIALS_SQL) {
      const deleted: number = credentialsLeft;
      credentialsLeft = 0;
      return [[], deleted];
    }

    throw new Error(`Unexpected statement: ${sql}`);
  }

  function ran(sql: string): Array<Statement> {
    return statements.filter((statement: Statement): boolean => {
      return statement.sql === sql;
    });
  }

  beforeEach(() => {
    statements = [];
    failOn = null;
    credentialsLeft = 2;
    tables = { hasCredentialTable: true, hasCredentialRunnerTable: true };
    boundClusters = [
      {
        clusterId: OUTSIDE_CLUSTER,
        runnerId: OUTSIDE_RUNNER,
        runnerName: "prod-bastion",
        runnerHostInfo: { hostname: "bastion-1" },
      },
      {
        clusterId: AGENT_CLUSTER,
        runnerId: AGENT_RUNNER,
        runnerName: "kubernetes-agent/prod-us",
        runnerHostInfo: null,
      },
      /*
       * An agent row renamed out of the marker keeps its posture - which a
       * driver may hand over as text.
       */
      {
        clusterId: POSTURE_CLUSTER,
        runnerId: POSTURE_RUNNER,
        runnerName: "prod-eu in-cluster runner",
        runnerHostInfo: JSON.stringify({
          kubernetes: { inCluster: true, clusterIdentifier: "prod-eu" },
        }),
      },
    ];

    moveAll = jest
      .spyOn(RunbookVariablesMove, "moveAll")
      .mockResolvedValue({ ...MOVED });

    for (const level of ["info", "error"] as const) {
      jest.spyOn(logger, level).mockImplementation((): void => {
        return undefined;
      });
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("moves the steps without the secrets, clears the outside Runner's binding, and deletes every credential", async () => {
    const summary: RunbookCredentialsRemovalSummary =
      await RunbookCredentialsRemoval.removeAll(query);

    expect(summary).toEqual({
      move: MOVED,
      clusterBindingsCleared: 1,
      credentialsDeleted: 2,
      failedSteps: [],
    });

    // The move runs over the same statements, never moving a secret again.
    expect(moveAll).toHaveBeenCalledTimes(1);
    expect(moveAll.mock.calls[0]![0]).toBe(query);
    expect(moveAll.mock.calls[0]![1]).toEqual({ moveSecrets: false });

    // Only the Runner outside its cluster loses the binding.
    expect(
      ran(CLEAR_CLUSTER_RUNNER_BINDING_SQL).map(
        (statement: Statement): Array<unknown> | undefined => {
          return statement.parameters;
        },
      ),
    ).toEqual([[OUTSIDE_CLUSTER, OUTSIDE_RUNNER]]);

    // The Runners they were assigned to go first, then the credentials.
    const deletes: Array<string> = statements
      .map((statement: Statement): string => {
        return statement.sql;
      })
      .filter((sql: string): boolean => {
        return sql.startsWith("DELETE");
      });
    expect(deletes).toEqual([
      DELETE_CREDENTIAL_RUNNERS_SQL,
      DELETE_CREDENTIALS_SQL,
    ]);
  });

  test("the steps run in order: the move, the bindings, the delete", async () => {
    const order: Array<string> = [];
    moveAll.mockImplementation(
      async (): Promise<RunbookVariablesMoveSummary> => {
        order.push("move");
        return { ...MOVED };
      },
    );

    await RunbookCredentialsRemoval.removeAll(
      async (sql: string, parameters?: Array<unknown>): Promise<unknown> => {
        if (sql === CLUSTERS_BOUND_TO_RUNNERS_SQL) {
          order.push("bindings");
        }
        if (sql === DELETE_CREDENTIALS_SQL) {
          order.push("delete");
        }
        return query(sql, parameters);
      },
    );

    // The credentials are read by the move before they are deleted.
    expect(order).toEqual(["move", "bindings", "delete"]);
  });

  test("the binding is cleared only while it is still to that Runner", async () => {
    /*
     * The cluster was re-bound between the read and the write: the update,
     * conditioned on the Runner it read, touches nothing.
     */
    const answered: (
      sql: string,
      parameters?: Array<unknown>,
    ) => Promise<unknown> = async (
      sql: string,
      parameters?: Array<unknown>,
    ): Promise<unknown> => {
      if (sql === CLEAR_CLUSTER_RUNNER_BINDING_SQL) {
        statements.push({ sql, parameters });
        return [[], 0];
      }
      return query(sql, parameters);
    };

    const summary: RunbookCredentialsRemovalSummary =
      await RunbookCredentialsRemoval.removeAll(answered);

    expect(summary.clusterBindingsCleared).toBe(0);
    expect(CLEAR_CLUSTER_RUNNER_BINDING_SQL).toContain(
      `WHERE "_id" = $1 AND "aiAccessRunnerId" = $2`,
    );
  });

  test("a row with an id that is not one is passed over", async () => {
    boundClusters = [
      {
        clusterId: "not-a-uuid",
        runnerId: OUTSIDE_RUNNER,
        runnerName: "prod-bastion",
        runnerHostInfo: null,
      },
      {
        clusterId: OUTSIDE_CLUSTER,
        runnerId: null,
        runnerName: "prod-bastion",
        runnerHostInfo: null,
      },
    ];

    const summary: RunbookCredentialsRemovalSummary =
      await RunbookCredentialsRemoval.removeAll(query);

    expect(summary.clusterBindingsCleared).toBe(0);
    expect(ran(CLEAR_CLUSTER_RUNNER_BINDING_SQL)).toEqual([]);
  });

  test("with the legacy tables gone, nothing is deleted", async () => {
    tables = { hasCredentialTable: false, hasCredentialRunnerTable: false };

    const summary: RunbookCredentialsRemovalSummary =
      await RunbookCredentialsRemoval.removeAll(query);

    expect(summary.credentialsDeleted).toBe(0);
    expect(ran(DELETE_CREDENTIALS_SQL)).toEqual([]);
    expect(ran(DELETE_CREDENTIAL_RUNNERS_SQL)).toEqual([]);
    expect(summary.failedSteps).toEqual([]);
  });

  test("run twice, the second run finds nothing to clear or delete", async () => {
    await RunbookCredentialsRemoval.removeAll(query);
    // What the first run left: the outside binding cleared.
    boundClusters = boundClusters.filter(
      (row: Record<string, unknown>): boolean => {
        return row["clusterId"] !== OUTSIDE_CLUSTER;
      },
    );
    moveAll.mockResolvedValue({
      ...MOVED,
      credentialsMoved: 0,
      stepsMoved: 0,
      runbooksRewritten: 0,
    });

    const summary: RunbookCredentialsRemovalSummary =
      await RunbookCredentialsRemoval.removeAll(query);

    expect(summary.clusterBindingsCleared).toBe(0);
    expect(summary.credentialsDeleted).toBe(0);
    expect(summary.failedSteps).toEqual([]);
  });

  test.each([
    ["the move", "move", null],
    ["the bindings", "cluster_bindings", CLUSTERS_BOUND_TO_RUNNERS_SQL],
    ["the delete", "delete", DELETE_CREDENTIALS_SQL],
  ] as Array<[string, string, string | null]>)(
    "a failure of %s is logged, and the other steps still run",
    async (_label: string, step: string, failingSql: string | null) => {
      if (failingSql) {
        failOn = failingSql;
      } else {
        moveAll.mockRejectedValue(new Error("the database went away"));
      }

      const summary: RunbookCredentialsRemovalSummary =
        await RunbookCredentialsRemoval.removeAll(query);

      expect(summary.failedSteps).toEqual([step]);
      expect(logger.error).toHaveBeenCalled();
      expect(summary.move).toEqual(step === "move" ? null : MOVED);
      expect(summary.clusterBindingsCleared).toBe(
        step === "cluster_bindings" ? 0 : 1,
      );
      expect(summary.credentialsDeleted).toBe(step === "delete" ? 0 : 2);
    },
  );
});
