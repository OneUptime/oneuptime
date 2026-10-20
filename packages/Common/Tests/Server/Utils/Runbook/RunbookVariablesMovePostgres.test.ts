import Entities from "../../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import Encryption from "../../../../Server/Utils/Encryption";
import logger from "../../../../Server/Utils/Logger";
import RunbookVariableService from "../../../../Server/Services/RunbookVariableService";
import RunbookVariablesMove, {
  LegacyQuery,
  RunbookVariablesMoveSummary,
} from "../../../../Server/Utils/Runbook/RunbookVariablesMove";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import RunbookCredentialType from "../../../../Types/Runbook/RunbookCredentialType";
import {
  KubernetesAction,
  KubernetesWorkloadKind,
} from "../../../../Types/Runbook/RunbookStep";
import RunbookStepType from "../../../../Types/Runbook/RunbookStepType";
import { getLegacyKubernetesStepForOlderRunner } from "../../../../Types/Runbook/RunbookLegacySteps";
import { DataSource } from "typeorm";

/*
 * RUNBOOK SECRETS AND CREDENTIALS BECOME VARIABLES, against a real Postgres:
 * the legacy statements read the tables the migrations made
 * ("RunbookSecret", "RunbookSecretRunner", "RunbookCredential"), the
 * variables are written through the real service - encrypted, with their
 * Runners in "RunbookVariableRunner" - and each runbook's steps are written
 * back in one statement. Run twice, the second run changes nothing.
 *
 * Opt in with RUN_POSTGRES_RUNBOOK_VARIABLES_TESTS=true against a Postgres
 * migrated to the current head - the Postgres Schema Drift workflow's
 * database right after its drift check. The tables' STRUCTURE is cloned
 * into a unique schema that is dropped afterwards. Credentials from
 * DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * RUNBOOK_VARIABLES_TEST_DATABASE_NAME or DATABASE_NAME, endpoint from
 * RUNBOOK_VARIABLES_TEST_DATABASE_HOST / _PORT (default localhost:5400).
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_RUNBOOK_VARIABLES_TESTS"] === "true"
    ? describe
    : describe.skip;

describePostgres(
  "moving runbook secrets and credentials to variables, in Postgres",
  () => {
    const schema: string = `runbook_variables_${ObjectID.generate()
      .toString()
      .split("-")
      .join("")}`;
    let database: DataSource;

    const TABLES: Array<string> = [
      "Project",
      "Runner",
      "Runbook",
      "RunbookSecret",
      "RunbookSecretRunner",
      "RunbookCredential",
      "RunbookCredentialRunner",
      "RunbookVariable",
      "RunbookVariableRunner",
    ];

    const PROJECT_ID: string = ObjectID.generate().toString();
    const RUNNER_ID: string = ObjectID.generate().toString();
    const AGENT_RUNNER_ID: string = ObjectID.generate().toString();
    const SECRET_ID: string = ObjectID.generate().toString();
    const SSH_CREDENTIAL_ID: string = ObjectID.generate().toString();
    const K8S_CREDENTIAL_ID: string = ObjectID.generate().toString();
    const RUNBOOK_ID: string = ObjectID.generate().toString();

    const PRIVATE_KEY: string =
      "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjE=\n-----END OPENSSH PRIVATE KEY-----\n";

    const query: LegacyQuery = async (
      sql: string,
      parameters?: Array<unknown>,
    ): Promise<unknown> => {
      return database.query(sql, parameters);
    };

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["RUNBOOK_VARIABLES_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["RUNBOOK_VARIABLES_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["RUNBOOK_VARIABLES_TEST_DATABASE_NAME"] ||
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
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );

        // A fixture names only what the statements touch: keys aside.
        const columns: Array<{ column_name: string }> = await database.query(
          `SELECT c.column_name FROM information_schema.columns c
        WHERE c.table_schema = $1 AND c.table_name = $2 AND c.is_nullable = 'NO'
        AND c.column_default IS NULL
        AND c.column_name NOT IN (
          SELECT k.column_name FROM information_schema.table_constraints t
          JOIN information_schema.key_column_usage k
            ON k.constraint_name = t.constraint_name AND k.table_schema = t.table_schema
          WHERE t.table_schema = $1 AND t.table_name = $2 AND t.constraint_type = 'PRIMARY KEY'
        )`,
          [schema, table],
        );

        for (const column of columns) {
          await database.query(
            `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
          );
        }
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
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);
      // A variable made starts no workflow here: no app to call.
      jest
        .spyOn(RunbookVariableService, "onTriggerWorkflow")
        .mockResolvedValue(undefined as never);

      await database.query(
        `INSERT INTO "Project" ("_id", "name", "version") VALUES ($1, 'Acme', 1)`,
        [PROJECT_ID],
      );
      await database.query(
        `INSERT INTO "Runner" ("_id", "projectId", "name", "version") VALUES ($1, $2, 'prod-bastion', 1), ($3, $2, 'kubernetes-agent/prod', 1)`,
        [RUNNER_ID, PROJECT_ID, AGENT_RUNNER_ID],
      );

      await database.query(
        `INSERT INTO "RunbookSecret" ("_id", "projectId", "name", "description", "secretValue", "isAvailableToGlobalRunners", "version") VALUES ($1, $2, 'API_TOKEN', 'the status page token', $3, true, 1)`,
        [SECRET_ID, PROJECT_ID, await Encryption.encrypt("tok-123")],
      );
      await database.query(
        `INSERT INTO "RunbookSecretRunner" ("runbookSecretId", "runnerId") VALUES ($1, $2), ($1, $3)`,
        [SECRET_ID, RUNNER_ID, AGENT_RUNNER_ID],
      );

      await database.query(
        `INSERT INTO "RunbookCredential" ("_id", "projectId", "name", "credentialType", "sshHostname", "sshPort", "sshUsername", "sshPrivateKey", "sshPassphrase", "version") VALUES ($1, $2, 'prod hosts', $3, '10.0.4.21', 2222, 'deploy', $4, $5, 1)`,
        [
          SSH_CREDENTIAL_ID,
          PROJECT_ID,
          RunbookCredentialType.SSH,
          await Encryption.encrypt(PRIVATE_KEY),
          await Encryption.encrypt("open sesame"),
        ],
      );
      await database.query(
        `INSERT INTO "RunbookCredential" ("_id", "projectId", "name", "credentialType", "kubernetesApiServerUrl", "kubernetesServiceAccountToken", "version") VALUES ($1, $2, 'prod cluster', $3, 'https://prod.example.com:6443', $4, 1)`,
        [
          K8S_CREDENTIAL_ID,
          PROJECT_ID,
          RunbookCredentialType.Kubernetes,
          await Encryption.encrypt("sa-token"),
        ],
      );
      await database.query(
        `INSERT INTO "RunbookCredentialRunner" ("runbookCredentialId", "runnerId") VALUES ($1, $3), ($2, $3)`,
        [SSH_CREDENTIAL_ID, K8S_CREDENTIAL_ID, RUNNER_ID],
      );

      await database.query(
        `INSERT INTO "Runbook" ("_id", "projectId", "name", "slug", "steps", "version") VALUES ($1, $2, 'Restart the web tier', 'restart-the-web-tier', $3::jsonb, 1)`,
        [
          RUNBOOK_ID,
          PROJECT_ID,
          JSON.stringify([
            {
              id: "a",
              order: 0,
              type: RunbookStepType.Bash,
              title: "Tell the status page",
              config: {
                script: "curl -H 'Authorization: {{runbookSecrets.API_TOKEN}}'",
                agentId: RUNNER_ID,
              },
            },
            {
              id: "b",
              order: 1,
              type: RunbookStepType.SSH,
              title: "Restart nginx",
              config: {
                credentialId: SSH_CREDENTIAL_ID,
                command: "sudo systemctl restart nginx",
                agentId: RUNNER_ID,
              },
            },
            {
              id: "c",
              order: 2,
              type: RunbookStepType.Kubernetes,
              title: "Restart the API",
              config: {
                credentialId: K8S_CREDENTIAL_ID,
                action: KubernetesAction.RestartWorkload,
                workloadKind: KubernetesWorkloadKind.Deployment,
                namespace: "web",
                workloadName: "api",
                agentId: RUNNER_ID,
              },
            },
          ]),
        ],
      );
    });

    afterEach(async () => {
      jest.restoreAllMocks();

      for (const table of TABLES) {
        await database.query(`DELETE FROM "${schema}"."${table}"`);
      }
    });

    async function variables(): Promise<
      Array<{
        _id: string;
        name: string;
        isSecret: boolean;
        value: string | null;
        secretValue: string;
        isAvailableToGlobalRunners: boolean;
        runbookId: string | null;
      }>
    > {
      return database.query(
        `SELECT "_id", "name", "isSecret", "value", "secretValue", "isAvailableToGlobalRunners", "runbookId" FROM "RunbookVariable" WHERE "projectId" = $1 ORDER BY "name"`,
        [PROJECT_ID],
      );
    }

    async function runnersOf(variableId: string): Promise<Array<string>> {
      const rows: Array<{ runnerId: string }> = await database.query(
        `SELECT "runnerId" FROM "RunbookVariableRunner" WHERE "runbookVariableId" = $1`,
        [variableId],
      );

      return rows.map((row: { runnerId: string }): string => {
        return String(row.runnerId);
      });
    }

    async function steps(): Promise<{
      steps: Array<JSONObject>;
      version: number;
    }> {
      const rows: Array<{ steps: Array<JSONObject>; version: number }> =
        await database.query(
          `SELECT "steps", "version" FROM "Runbook" WHERE "_id" = $1`,
          [RUNBOOK_ID],
        );

      return rows[0]!;
    }

    test("every secret and every credential a step names becomes an encrypted secret variable with its Runners", async () => {
      const summary: RunbookVariablesMoveSummary =
        await RunbookVariablesMove.moveAll(query);

      expect(summary).toMatchObject({
        secretsMoved: 1,
        credentialsMoved: 2,
        stepsMoved: 3,
        runbooksRewritten: 1,
        projectsFailed: 0,
      });

      const rows: Awaited<ReturnType<typeof variables>> = await variables();

      expect(
        rows.map((row: { name: string }): string => {
          return row.name;
        }),
      ).toEqual([
        "API_TOKEN",
        "prod_cluster-kubeconfig",
        "prod_hosts-ssh-key",
        "prod_hosts-ssh-key-passphrase",
      ]);

      for (const row of rows) {
        expect(row.isSecret).toBe(true);
        expect(row.value).toBeNull();
        expect(row.runbookId).toBeNull();
        // Encrypted at rest.
        expect(Encryption.looksEncrypted(row.secretValue)).toBe(true);
        // Its Runners, never the kubernetes-agent Runner.
        expect(await runnersOf(row._id)).toEqual([RUNNER_ID]);
      }

      const [token, kubeconfig, key, passphrase] = rows;

      expect(await Encryption.decrypt(token!.secretValue)).toBe("tok-123");
      expect(token!.isAvailableToGlobalRunners).toBe(true);
      expect(await Encryption.decrypt(key!.secretValue)).toBe(PRIVATE_KEY);
      expect(await Encryption.decrypt(passphrase!.secretValue)).toBe(
        "open sesame",
      );
      expect(await Encryption.decrypt(kubeconfig!.secretValue)).toContain(
        'token: "sa-token"',
      );
    });

    test("the runbook's steps are rewritten to use them, in one write", async () => {
      await RunbookVariablesMove.moveAll(query);

      const written: { steps: Array<JSONObject>; version: number } =
        await steps();

      expect(written.version).toBe(2);
      expect((written.steps[0]!["config"] as JSONObject)["script"]).toBe(
        "curl -H 'Authorization: {{global.variables.API_TOKEN}}'",
      );
      expect(written.steps[1]!["config"]).toEqual({
        host: "10.0.4.21",
        username: "deploy",
        port: 2222,
        signIn: "{{global.variables.prod_hosts-ssh-key}}",
        passphrase: "{{global.variables.prod_hosts-ssh-key-passphrase}}",
        script: "sudo systemctl restart nginx",
        agentId: RUNNER_ID,
      });
      expect((written.steps[2]!["config"] as JSONObject)["kubeconfig"]).toBe(
        "{{global.variables.prod_cluster-kubeconfig}}",
      );
      expect(
        String((written.steps[2]!["config"] as JSONObject)["script"]),
      ).toContain("kubectl patch deployment api --namespace web --patch");
      // ... and keeps its credential and action, for a Runner older than kubectl scripts.
      expect(
        getLegacyKubernetesStepForOlderRunner(written.steps[2]!["config"]),
      ).toEqual({
        credentialId: K8S_CREDENTIAL_ID,
        action: KubernetesAction.RestartWorkload,
        workloadKind: KubernetesWorkloadKind.Deployment,
        namespace: "web",
        workloadName: "api",
      });
      // Titles and order are as they were.
      expect(
        written.steps.map((step: JSONObject): unknown => {
          return step["title"];
        }),
      ).toEqual(["Tell the status page", "Restart nginx", "Restart the API"]);
    });

    test("run twice, the second run changes nothing", async () => {
      await RunbookVariablesMove.moveAll(query);
      const first: Awaited<ReturnType<typeof variables>> = await variables();

      const summary: RunbookVariablesMoveSummary =
        await RunbookVariablesMove.moveAll(query);

      expect(summary).toMatchObject({
        secretsMoved: 0,
        secretsAlreadyMoved: 1,
        // The moved Kubernetes step still names its credential: it is not read again.
        credentialsMoved: 0,
        stepsMoved: 0,
        runbooksRewritten: 0,
      });
      expect(await variables()).toEqual(first);
      expect((await steps()).version).toBe(2);
    });
  },
);
