import RunbookVariablesMove, {
  LEGACY_CREDENTIALS_SQL,
  LEGACY_CREDENTIAL_RUNNERS_SQL,
  LEGACY_CREDENTIAL_TABLE_SQL,
  LEGACY_KUBERNETES_CREDENTIAL_TYPE,
  LEGACY_SECRETS_SQL,
  LEGACY_SECRET_RUNNERS_SQL,
  LEGACY_SECRET_TABLE_SQL,
  LEGACY_SSH_CREDENTIAL_TYPE,
  MOVED_FROM_CREDENTIAL_DESCRIPTION,
  MovedCredential,
  PROJECT_GLOBAL_VARIABLE_NAMES_SQL,
  RUNBOOKS_TO_MOVE_SQL,
  RunbookVariablesMoveSummary,
  UPDATE_RUNBOOK_STEPS_SQL,
  VariableNames,
  getCredentialIdsInSteps,
  moveStep,
  toVariableName,
} from "../../../../Server/Utils/Runbook/RunbookVariablesMove";
import RunbookVariableService from "../../../../Server/Services/RunbookVariableService";
import RunnerService from "../../../../Server/Services/RunnerService";
import Encryption from "../../../../Server/Utils/Encryption";
import logger from "../../../../Server/Utils/Logger";
import RunbookVariable from "../../../../Models/DatabaseModels/RunbookVariable";
import Runner from "../../../../Models/DatabaseModels/Runner";
import { JSONObject } from "../../../../Types/JSON";
import {
  KubernetesAction,
  KubernetesWorkloadKind,
  isLegacyKubernetesStepConfig,
} from "../../../../Types/Runbook/RunbookStep";
import {
  LEGACY_KUBERNETES_STEP_FIELDS,
  getKubectlScriptForLegacyKubernetesStep,
  isMovedKubernetesStepConfig,
} from "../../../../Types/Runbook/RunbookLegacySteps";
import RunbookStepType from "../../../../Types/Runbook/RunbookStepType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * RUNBOOK SECRETS AND THE CREDENTIALS RUNBOOK STEPS USED BECOME VARIABLES -
 * once, so every runbook keeps running as it did (RunbookVariablesMove).
 *
 * Read with statements against the legacy tables (a fake that answers them
 * here; RunbookVariablesMovePostgres runs the real ones) - the credentials'
 * too, since their model went with runbook credentials - written through
 * the variable service (stubbed here, so what it is asked to write is the
 * contract).
 */

const PROJECT_A: string = "aaaaaaaa-0000-4000-8000-000000000001";
const PROJECT_B: string = "bbbbbbbb-0000-4000-8000-000000000001";
const RUNNER_1: string = "eeeeeeee-0000-4000-8000-000000000001";
const AGENT_RUNNER: string = "eeeeeeee-0000-4000-8000-000000000002";
const SSH_CREDENTIAL: string = "cccccccc-0000-4000-8000-000000000001";
const K8S_CREDENTIAL: string = "cccccccc-0000-4000-8000-000000000002";
const GONE_CREDENTIAL: string = "cccccccc-0000-4000-8000-000000000003";
const USER_ID: string = "dddddddd-0000-4000-8000-000000000001";

describe("toVariableName", () => {
  test("a name a variable can have is kept", () => {
    expect(toVariableName("API_TOKEN", "x")).toBe("API_TOKEN");
    expect(toVariableName("  prod-key  ", "x")).toBe("prod-key");
  });

  test("every character a variable cannot hold becomes _", () => {
    expect(toVariableName("db password", "x")).toBe("db_password");
    expect(toVariableName("prod.db/key", "x")).toBe("prod_db_key");
    expect(toVariableName("clé", "x")).toBe("cl_");
  });

  test("cut to the longest name, and the fallback for nothing", () => {
    expect(toVariableName("a".repeat(150), "x")).toBe("a".repeat(100));
    expect(toVariableName("   ", "secret-12345678")).toBe("secret-12345678");
  });
});

describe("VariableNames", () => {
  test("knows the names that were there before, whatever their case", () => {
    const names: VariableNames = new VariableNames(["API_TOKEN"]);

    expect(names.existedBefore("api_token")).toBe(true);
    expect(names.existedBefore("OTHER")).toBe(false);
  });

  test("gives a new thing a free name: -2, -3 when it is taken", () => {
    const names: VariableNames = new VariableNames(["prod-ssh-key"]);

    expect(names.allocate("prod-ssh-key")).toBe("prod-ssh-key-2");
    expect(names.allocate("PROD-SSH-KEY")).toBe("PROD-SSH-KEY-3");
    expect(names.allocate("other")).toBe("other");
    expect(names.allocate("other")).toBe("other-2");
  });

  test("keeps a long name within the longest a name may be", () => {
    const long: string = "n".repeat(100);
    const names: VariableNames = new VariableNames([long]);

    const allocated: string = names.allocate(long);
    expect(allocated).toHaveLength(100);
    expect(allocated.endsWith("-2")).toBe(true);
  });

  test("a name taken as it is is not given out again", () => {
    const names: VariableNames = new VariableNames([]);
    names.take("KEY");

    expect(names.allocate("KEY")).toBe("KEY-2");
  });
});

describe("moveStep", () => {
  const credentials: Map<string, MovedCredential> = new Map<
    string,
    MovedCredential
  >([
    [
      SSH_CREDENTIAL,
      {
        credentialType: LEGACY_SSH_CREDENTIAL_TYPE,
        host: "10.0.4.21",
        username: "deploy",
        port: 2222,
        signInVariable: "prod-ssh-key",
        passphraseVariable: "prod-ssh-key-passphrase",
      },
    ],
    [
      K8S_CREDENTIAL,
      {
        credentialType: LEGACY_KUBERNETES_CREDENTIAL_TYPE,
        kubeconfigVariable: "prod-cluster-kubeconfig",
      },
    ],
  ]);

  const secretNames: Map<string, string> = new Map<string, string>([
    ["API_TOKEN", "API_TOKEN"],
  ]);

  function move(step: JSONObject): JSONObject | null {
    return moveStep({ step, credentials, secretNames });
  }

  test("an SSH step signs in with its credential's variables and runs its command as its script", () => {
    expect(
      move({
        id: "s1",
        type: RunbookStepType.SSH,
        title: "Restart nginx",
        config: {
          credentialId: SSH_CREDENTIAL.toUpperCase(),
          command: "sudo systemctl restart nginx",
          agentId: RUNNER_1,
          timeoutInMs: 60_000,
        },
      }),
    ).toEqual({
      id: "s1",
      type: RunbookStepType.SSH,
      title: "Restart nginx",
      config: {
        host: "10.0.4.21",
        username: "deploy",
        port: 2222,
        signIn: "{{global.variables.prod-ssh-key}}",
        passphrase: "{{global.variables.prod-ssh-key-passphrase}}",
        script: "sudo systemctl restart nginx",
        agentId: RUNNER_1,
        timeoutInMs: 60_000,
      },
    });
  });

  test("a Kubernetes step runs the kubectl command its action made, with the kubeconfig", () => {
    const moved: JSONObject | null = move({
      id: "k1",
      type: RunbookStepType.Kubernetes,
      config: {
        credentialId: K8S_CREDENTIAL,
        action: KubernetesAction.ScaleWorkload,
        workloadKind: KubernetesWorkloadKind.Deployment,
        namespace: "web",
        workloadName: "api",
        replicas: 3,
        agentId: RUNNER_1,
      },
    });

    const config: JSONObject = moved!["config"] as JSONObject;
    expect(config["kubeconfig"]).toBe(
      "{{global.variables.prod-cluster-kubeconfig}}",
    );
    expect(config["script"]).toContain(
      `kubectl patch deployment api --namespace web --subresource scale --patch '{"spec":{"replicas":3}}'`,
    );
    expect(config["agentId"]).toBe(RUNNER_1);
    // A script step now, keeping nothing of the old one: it is not moved again.
    expect(isLegacyKubernetesStepConfig(config)).toBe(false);
    expect(isMovedKubernetesStepConfig(config)).toBe(false);
  });

  /*
   * The first release of this move kept a Kubernetes step's credential and
   * action beside its script, for a Runner older than kubectl scripts.
   * Runbook credentials are gone, and that with them: a step is moved to
   * its script and kubeconfig alone, and one moved with them kept has them
   * taken off.
   */
  describe("a Kubernetes step is moved to its script and kubeconfig alone", () => {
    const SHAPES: Array<[string, JSONObject]> = [
      [
        "a Deployment restarted",
        {
          credentialId: K8S_CREDENTIAL,
          action: KubernetesAction.RestartWorkload,
          workloadKind: KubernetesWorkloadKind.Deployment,
          namespace: "web",
          workloadName: "api",
        },
      ],
      [
        "a StatefulSet restarted",
        {
          credentialId: K8S_CREDENTIAL,
          action: KubernetesAction.RestartWorkload,
          workloadKind: KubernetesWorkloadKind.StatefulSet,
          namespace: "db",
          workloadName: "postgres",
        },
      ],
      [
        "a DaemonSet restarted",
        {
          credentialId: K8S_CREDENTIAL,
          action: KubernetesAction.RestartWorkload,
          workloadKind: KubernetesWorkloadKind.DaemonSet,
          namespace: "monitoring",
          workloadName: "node-exporter",
        },
      ],
      [
        "a restart with no action named",
        {
          credentialId: K8S_CREDENTIAL,
          workloadKind: KubernetesWorkloadKind.Deployment,
          namespace: "web",
          workloadName: "api",
        },
      ],
      [
        "a Deployment scaled",
        {
          credentialId: K8S_CREDENTIAL,
          action: KubernetesAction.ScaleWorkload,
          workloadKind: KubernetesWorkloadKind.Deployment,
          namespace: "web",
          workloadName: "api",
          replicas: 3,
        },
      ],
      [
        "a StatefulSet scaled to zero",
        {
          credentialId: K8S_CREDENTIAL,
          action: KubernetesAction.ScaleWorkload,
          workloadKind: KubernetesWorkloadKind.StatefulSet,
          namespace: "jobs",
          workloadName: "workers",
          replicas: 0,
        },
      ],
      [
        "a DaemonSet scaled, which never could be",
        {
          credentialId: K8S_CREDENTIAL,
          action: KubernetesAction.ScaleWorkload,
          workloadKind: KubernetesWorkloadKind.DaemonSet,
          namespace: "n",
          workloadName: "w",
          replicas: 2,
        },
      ],
      [
        "a scale with no replica count",
        {
          credentialId: K8S_CREDENTIAL,
          action: KubernetesAction.ScaleWorkload,
          workloadKind: KubernetesWorkloadKind.Deployment,
          namespace: "n",
          workloadName: "w",
        },
      ],
      [
        "a step with no namespace",
        {
          credentialId: K8S_CREDENTIAL,
          action: KubernetesAction.RestartWorkload,
          workloadKind: KubernetesWorkloadKind.Deployment,
          workloadName: "w",
        },
      ],
      [
        "an action it never had",
        {
          credentialId: K8S_CREDENTIAL,
          action: "delete-workload",
          workloadKind: KubernetesWorkloadKind.Deployment,
          namespace: "n",
          workloadName: "w",
        },
      ],
    ];

    test.each(SHAPES)(
      "%s: the script and the kubeconfig, and nothing of the old step",
      (_label: string, legacy: JSONObject) => {
        const moved: JSONObject | null = move({
          id: "k1",
          type: RunbookStepType.Kubernetes,
          title: "Act on the cluster",
          config: {
            ...legacy,
            agentId: RUNNER_1,
            timeoutInMs: 60_000,
            claimTimeoutInMs: 90_000,
          },
        });

        expect(moved).toEqual({
          id: "k1",
          type: RunbookStepType.Kubernetes,
          title: "Act on the cluster",
          config: {
            kubeconfig: "{{global.variables.prod-cluster-kubeconfig}}",
            script: getKubectlScriptForLegacyKubernetesStep(legacy as never),
            agentId: RUNNER_1,
            timeoutInMs: 60_000,
            claimTimeoutInMs: 90_000,
          },
        });
      },
    );

    test.each([SHAPES[6]!, SHAPES[9]!])(
      "%s: the script fails it, saying why, as the old step failed",
      (_label: string, legacy: JSONObject) => {
        const config: JSONObject = move({
          type: RunbookStepType.Kubernetes,
          config: { ...legacy, agentId: RUNNER_1 },
        })!["config"] as JSONObject;

        expect(String(config["script"])).toContain("exit 1");
      },
    );

    test("a step moved with its credential and action kept has them taken off, and nothing else", () => {
      const kept: JSONObject = {
        kubeconfig: "{{global.variables.prod-cluster-kubeconfig}}",
        script: "kubectl patch deployment api --namespace web ...",
        agentId: RUNNER_1,
        timeoutInMs: 60_000,
        ...SHAPES[0]![1],
      };

      expect(
        move({
          id: "k1",
          type: RunbookStepType.Kubernetes,
          title: "Restart the API",
          config: kept,
        }),
      ).toEqual({
        id: "k1",
        type: RunbookStepType.Kubernetes,
        title: "Restart the API",
        config: {
          kubeconfig: "{{global.variables.prod-cluster-kubeconfig}}",
          script: "kubectl patch deployment api --namespace web ...",
          agentId: RUNNER_1,
          timeoutInMs: 60_000,
        },
      });
      for (const field of LEGACY_KUBERNETES_STEP_FIELDS) {
        expect(field in kept).toBe(field !== "replicas");
      }
    });

    test("a moved step is not moved again", () => {
      const once: JSONObject = move({
        type: RunbookStepType.Kubernetes,
        config: { ...SHAPES[0]![1], agentId: RUNNER_1 },
      })!;

      expect(move(once)).toBeNull();
    });
  });

  test("a Bash or JavaScript step names variables where it named runbook secrets", () => {
    expect(
      move({
        type: RunbookStepType.Bash,
        config: { script: "curl -H 'X: {{runbookSecrets.API_TOKEN}}'" },
      }),
    ).toEqual({
      type: RunbookStepType.Bash,
      config: { script: "curl -H 'X: {{global.variables.API_TOKEN}}'" },
    });
  });

  test.each([
    [
      "a step whose credential is gone",
      {
        type: RunbookStepType.SSH,
        config: { credentialId: GONE_CREDENTIAL, command: "ls" },
      },
    ],
    [
      "a step whose credential is of the other kind",
      {
        type: RunbookStepType.SSH,
        config: { credentialId: K8S_CREDENTIAL, command: "ls" },
      },
    ],
    [
      "a step that takes a script already",
      {
        type: RunbookStepType.SSH,
        config: { host: "h", username: "u", script: "ls" },
      },
    ],
    [
      "a Bash step that names no secret",
      { type: RunbookStepType.Bash, config: { script: "ls" } },
    ],
    ["a step with no config", { type: RunbookStepType.SSH }],
  ])("%s is left as it is", (_label: string, step: JSONObject) => {
    expect(move(step)).toBeNull();
  });
});

describe("getCredentialIdsInSteps", () => {
  test("the credentials SSH and Kubernetes steps name, each once, in lower case", () => {
    expect(
      getCredentialIdsInSteps([
        { type: RunbookStepType.SSH, config: { credentialId: SSH_CREDENTIAL } },
        {
          type: RunbookStepType.Kubernetes,
          config: { credentialId: ` ${K8S_CREDENTIAL.toUpperCase()} ` },
        },
        { type: RunbookStepType.SSH, config: { credentialId: SSH_CREDENTIAL } },
        {
          type: RunbookStepType.Bash,
          config: { credentialId: GONE_CREDENTIAL },
        },
        { type: RunbookStepType.SSH, config: { credentialId: "not-a-uuid" } },
      ]),
    ).toEqual([SSH_CREDENTIAL, K8S_CREDENTIAL]);
  });

  test("not those of a step moved already, which keeps its credential beside its script", () => {
    const OTHER: string = "cccccccc-0000-4000-8000-000000000005";

    expect(
      getCredentialIdsInSteps([
        {
          type: RunbookStepType.Kubernetes,
          config: {
            kubeconfig: "{{global.variables.prod-cluster-kubeconfig}}",
            script: "kubectl patch deployment api --namespace web ...",
            credentialId: K8S_CREDENTIAL,
            action: KubernetesAction.RestartWorkload,
            namespace: "web",
            workloadName: "api",
          },
        },
        {
          type: RunbookStepType.SSH,
          config: { credentialId: OTHER, script: "uptime", host: "h" },
        },
        {
          type: RunbookStepType.Kubernetes,
          config: { credentialId: OTHER, action: "RestartWorkload" },
        },
      ]),
    ).toEqual([OTHER]);
  });
});

describe("moveAll", () => {
  interface Statement {
    sql: string;
    parameters: Array<unknown> | undefined;
  }

  let statements: Array<Statement>;
  let created: Array<RunbookVariable>;
  let existingNames: Record<string, Array<string>>;
  let legacySecrets: Array<Record<string, unknown>>;
  let runbooks: Array<Record<string, unknown>>;
  let hasSecretTable: boolean;
  let hasCredentialTable: boolean;
  let failCreateFor: string | null;
  // The credentials as the legacy table holds them, and whom they reach.
  let legacyCredentials: Array<Record<string, unknown>>;
  let credentialRunners: Array<Record<string, unknown>>;
  // The credential ids each read of the legacy table asked for.
  let credentialReads: Array<Array<string>>;

  const ENCRYPTED_TOKEN: string = "U2FsdGVkX1-encrypted-token";

  function query(sql: string, parameters?: Array<unknown>): Promise<unknown> {
    statements.push({ sql, parameters });

    if (sql === LEGACY_SECRET_TABLE_SQL) {
      return Promise.resolve([
        { hasSecretTable, hasSecretRunnerTable: hasSecretTable },
      ]);
    }

    if (sql === LEGACY_SECRETS_SQL) {
      return Promise.resolve(legacySecrets);
    }

    if (sql === LEGACY_SECRET_RUNNERS_SQL) {
      return Promise.resolve([
        {
          runbookSecretId: "f0000000-0000-4000-8000-000000000001",
          runnerId: RUNNER_1,
        },
        {
          runbookSecretId: "f0000000-0000-4000-8000-000000000001",
          runnerId: AGENT_RUNNER,
        },
      ]);
    }

    if (sql === LEGACY_CREDENTIAL_TABLE_SQL) {
      return Promise.resolve([
        {
          hasCredentialTable,
          hasCredentialRunnerTable: hasCredentialTable,
        },
      ]);
    }

    if (sql === LEGACY_CREDENTIALS_SQL) {
      // As the database answers: the project's credentials asked for.
      const projectId: string = String(parameters![0]);
      const asked: Array<string> = (parameters![1] as Array<string>).map(
        (id: string): string => {
          return id.toLowerCase();
        },
      );
      credentialReads.push(asked);

      return Promise.resolve(
        legacyCredentials.filter(
          (credential: Record<string, unknown>): boolean => {
            return (
              String(credential["projectId"]) === projectId &&
              asked.includes(String(credential["_id"]).toLowerCase())
            );
          },
        ),
      );
    }

    if (sql === LEGACY_CREDENTIAL_RUNNERS_SQL) {
      const asked: Array<string> = parameters![0] as Array<string>;

      return Promise.resolve(
        credentialRunners.filter((row: Record<string, unknown>): boolean => {
          return asked.includes(String(row["runbookCredentialId"]));
        }),
      );
    }

    if (sql === RUNBOOKS_TO_MOVE_SQL) {
      return Promise.resolve(runbooks);
    }

    if (sql === PROJECT_GLOBAL_VARIABLE_NAMES_SQL) {
      return Promise.resolve(
        (existingNames[String(parameters![0])] || []).map((name: string) => {
          return { name };
        }),
      );
    }

    if (sql === UPDATE_RUNBOOK_STEPS_SQL) {
      return Promise.resolve([]);
    }

    throw new Error(`Unexpected statement: ${sql}`);
  }

  beforeEach(() => {
    statements = [];
    created = [];
    existingNames = {};
    hasSecretTable = true;
    hasCredentialTable = true;
    failCreateFor = null;
    credentialReads = [];

    legacyCredentials = [
      {
        _id: SSH_CREDENTIAL,
        projectId: PROJECT_A,
        name: "prod hosts",
        credentialType: LEGACY_SSH_CREDENTIAL_TYPE,
        sshHostname: "10.0.4.21",
        sshPort: 22,
        sshUsername: "deploy",
        sshPrivateKey: "-----BEGIN OPENSSH PRIVATE KEY-----\nk\n",
        sshPassphrase: "open sesame",
      },
      {
        _id: K8S_CREDENTIAL,
        projectId: PROJECT_A,
        name: "prod cluster",
        credentialType: LEGACY_KUBERNETES_CREDENTIAL_TYPE,
        kubernetesApiServerUrl: "https://prod.example.com:6443",
        kubernetesServiceAccountToken: "sa-token",
      },
    ];
    credentialRunners = [
      { runbookCredentialId: SSH_CREDENTIAL, runnerId: RUNNER_1 },
      { runbookCredentialId: K8S_CREDENTIAL, runnerId: RUNNER_1 },
    ];

    legacySecrets = [
      {
        _id: "f0000000-0000-4000-8000-000000000001",
        projectId: PROJECT_A,
        name: "API_TOKEN",
        description: "the status page token",
        secretValue: ENCRYPTED_TOKEN,
        isAvailableToGlobalRunners: true,
        createdByUserId: USER_ID,
      },
      {
        _id: "f0000000-0000-4000-8000-000000000002",
        projectId: PROJECT_A,
        name: "db password",
        description: null,
        secretValue: "plain-written-before-encryption",
        isAvailableToGlobalRunners: false,
        createdByUserId: null,
      },
      {
        _id: "f0000000-0000-4000-8000-000000000003",
        projectId: PROJECT_A,
        name: "EMPTY",
        description: null,
        secretValue: "",
        isAvailableToGlobalRunners: false,
        createdByUserId: null,
      },
    ];

    runbooks = [
      {
        _id: "90000000-0000-4000-8000-000000000001",
        projectId: PROJECT_A,
        steps: JSON.stringify([
          {
            id: "a",
            type: RunbookStepType.Bash,
            config: {
              script:
                "curl -H 'Authorization: {{runbookSecrets.API_TOKEN}}' && psql -W '{{runbookSecrets.db password}}'",
            },
          },
          {
            id: "b",
            type: RunbookStepType.SSH,
            config: {
              credentialId: SSH_CREDENTIAL,
              command: "uptime",
              agentId: RUNNER_1,
            },
          },
          {
            id: "c",
            type: RunbookStepType.Kubernetes,
            config: {
              credentialId: K8S_CREDENTIAL,
              action: KubernetesAction.RestartWorkload,
              workloadKind: KubernetesWorkloadKind.Deployment,
              namespace: "web",
              workloadName: "api",
              agentId: RUNNER_1,
            },
          },
          {
            id: "d",
            type: RunbookStepType.SSH,
            config: { credentialId: GONE_CREDENTIAL, command: "ls" },
          },
        ]),
      },
      {
        _id: "90000000-0000-4000-8000-000000000002",
        projectId: PROJECT_B,
        steps: [
          {
            id: "e",
            type: RunbookStepType.JavaScript,
            config: { script: "return '{{runbookSecrets.UNKNOWN}}';" },
          },
        ],
      },
    ];

    jest.spyOn(logger, "error").mockImplementation((() => {
      return undefined;
    }) as never);

    jest
      .spyOn(Encryption, "decrypt")
      .mockImplementation(async (value: string): Promise<string> => {
        return value === ENCRYPTED_TOKEN ? "tok-123" : "?";
      });

    jest
      .spyOn(RunnerService, "findKubernetesAgentRunners")
      .mockImplementation(async (): Promise<Array<Runner>> => {
        return [
          Object.assign(new Runner(), {
            _id: AGENT_RUNNER,
            name: "kubernetes-agent/prod",
          }),
        ];
      });

    jest
      .spyOn(RunbookVariableService, "create")
      .mockImplementation(async (args: unknown): Promise<never> => {
        const variable: RunbookVariable = (args as { data: RunbookVariable })
          .data;

        if (failCreateFor && String(variable.projectId) === failCreateFor) {
          throw new Error("the database went away");
        }

        created.push(variable);
        return variable as never;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function variableNamed(name: string): RunbookVariable {
    const found: RunbookVariable | undefined = created.find(
      (variable: RunbookVariable): boolean => {
        return variable.name === name;
      },
    );

    if (!found) {
      throw new Error(
        `No variable "${name}" was made; made: ${created
          .map((variable: RunbookVariable) => {
            return variable.name;
          })
          .join(", ")}`,
      );
    }

    return found;
  }

  function stepsWritten(runbookId: string): Array<JSONObject> {
    const update: Statement | undefined = statements.find(
      (statement: Statement): boolean => {
        return (
          statement.sql === UPDATE_RUNBOOK_STEPS_SQL &&
          statement.parameters![1] === runbookId
        );
      },
    );

    if (!update) {
      throw new Error(`The steps of ${runbookId} were not written.`);
    }

    return JSON.parse(update.parameters![0] as string) as Array<JSONObject>;
  }

  test("each runbook secret becomes a secret global variable of its name, value, Runners and switch", async () => {
    const summary: RunbookVariablesMoveSummary =
      await RunbookVariablesMove.moveAll(query);

    const token: RunbookVariable = variableNamed("API_TOKEN");
    expect(String(token.projectId)).toBe(PROJECT_A);
    expect(token.isSecret).toBe(true);
    expect(token.secretValue).toBe("tok-123");
    expect(token.description).toBe("the status page token");
    expect(token.isAvailableToGlobalRunners).toBe(true);
    expect(String(token.createdByUserId)).toBe(USER_ID);
    // Its Runners, never a kubernetes-agent Runner.
    expect(
      (token.runners || []).map((runner: Runner): string => {
        return String(runner._id);
      }),
    ).toEqual([RUNNER_1]);

    // A name a variable cannot have, written with _; a value from before encryption, as it was.
    expect(variableNamed("db_password").secretValue).toBe(
      "plain-written-before-encryption",
    );
    expect(variableNamed("db_password").isAvailableToGlobalRunners).toBe(false);

    expect(summary.secretsMoved).toBe(2);
    // A secret with no value filled nothing in: nothing to move.
    expect(summary.secretsSkipped).toBe(1);
  });

  test("each credential a step names becomes secret variables with its Runners", async () => {
    const summary: RunbookVariablesMoveSummary =
      await RunbookVariablesMove.moveAll(query);

    const key: RunbookVariable = variableNamed("prod_hosts-ssh-key");
    expect(key.secretValue).toBe("-----BEGIN OPENSSH PRIVATE KEY-----\nk\n");
    expect(key.isAvailableToGlobalRunners).toBe(false);
    expect(key.description).toBe(
      MOVED_FROM_CREDENTIAL_DESCRIPTION.replace("{{name}}", "prod hosts"),
    );
    expect(variableNamed("prod_hosts-ssh-key-passphrase").secretValue).toBe(
      "open sesame",
    );

    const kubeconfig: string = variableNamed("prod_cluster-kubeconfig")
      .secretValue as string;
    expect(kubeconfig).toContain('server: "https://prod.example.com:6443"');
    expect(kubeconfig).toContain('token: "sa-token"');
    // Their Runners, read from the legacy join table.
    expect(
      (key.runners || []).map((runner: Runner): string => {
        return String(runner._id);
      }),
    ).toEqual([RUNNER_1]);

    expect(summary.credentialsMoved).toBe(2);
    // One read of the legacy table, for the credentials the steps name.
    expect(credentialReads).toEqual([
      [SSH_CREDENTIAL, K8S_CREDENTIAL, GONE_CREDENTIAL],
    ]);
  });

  /*
   * A credential's password was written inside a HashedString envelope for a
   * while (issue #3807): the value inside it is what the variable holds.
   */
  test("a credential's password inside a HashedString envelope is the value inside it", async () => {
    legacyCredentials = [
      {
        _id: SSH_CREDENTIAL,
        projectId: PROJECT_A,
        name: "prod hosts",
        credentialType: LEGACY_SSH_CREDENTIAL_TYPE,
        sshHostname: "10.0.4.21",
        sshUsername: "deploy",
        sshPassword: JSON.stringify({
          _type: "HashedString",
          value: ENCRYPTED_TOKEN,
        }),
      },
    ];

    await RunbookVariablesMove.moveAll(query);

    expect(variableNamed("prod_hosts-ssh-password").secretValue).toBe(
      "tok-123",
    );
  });

  test("every runbook's steps are written once, moved, and keep running as they did", async () => {
    const summary: RunbookVariablesMoveSummary =
      await RunbookVariablesMove.moveAll(query);

    const steps: Array<JSONObject> = stepsWritten(
      "90000000-0000-4000-8000-000000000001",
    );

    expect((steps[0]!["config"] as JSONObject)["script"]).toBe(
      "curl -H 'Authorization: {{global.variables.API_TOKEN}}' && psql -W '{{global.variables.db_password}}'",
    );
    expect(steps[1]!["config"]).toEqual({
      host: "10.0.4.21",
      username: "deploy",
      signIn: "{{global.variables.prod_hosts-ssh-key}}",
      passphrase: "{{global.variables.prod_hosts-ssh-key-passphrase}}",
      script: "uptime",
      agentId: RUNNER_1,
    });
    // The kubectl script its action became, and nothing of the old step.
    expect(steps[2]!["config"]).toEqual({
      kubeconfig: "{{global.variables.prod_cluster-kubeconfig}}",
      script: getKubectlScriptForLegacyKubernetesStep({
        action: KubernetesAction.RestartWorkload,
        workloadKind: KubernetesWorkloadKind.Deployment,
        namespace: "web",
        workloadName: "api",
      }),
      agentId: RUNNER_1,
    });
    // A step whose credential is gone is left as it was: it fails as it would have.
    expect(steps[3]!["config"]).toEqual({
      credentialId: GONE_CREDENTIAL,
      command: "ls",
    });

    // The other project's runbook named a secret it never had: nothing to change.
    expect(
      statements.filter((statement: Statement): boolean => {
        return statement.sql === UPDATE_RUNBOOK_STEPS_SQL;
      }),
    ).toHaveLength(1);

    expect(summary.stepsMoved).toBe(3);
    expect(summary.runbooksRewritten).toBe(1);
    expect(summary.projectsFailed).toBe(0);
  });

  test("run twice, it moves nothing again", async () => {
    existingNames[PROJECT_A] = [
      "API_TOKEN",
      "db_password",
      "prod_hosts-ssh-key",
      "prod_hosts-ssh-key-passphrase",
      "prod_cluster-kubeconfig",
    ];

    const summary: RunbookVariablesMoveSummary =
      await RunbookVariablesMove.moveAll(query);

    expect(created).toEqual([]);
    expect(summary.secretsAlreadyMoved).toBe(2);

    // Steps still named the old way are pointed at the variables already there.
    const steps: Array<JSONObject> = stepsWritten(
      "90000000-0000-4000-8000-000000000001",
    );
    expect((steps[1]!["config"] as JSONObject)["signIn"]).toBe(
      "{{global.variables.prod_hosts-ssh-key}}",
    );
  });

  test("run again over the steps it moved, it changes nothing, and reads no credential but the one a step still names", async () => {
    await RunbookVariablesMove.moveAll(query);

    const movedSteps: Array<JSONObject> = stepsWritten(
      "90000000-0000-4000-8000-000000000001",
    );

    // The moved Kubernetes step names no credential.
    expect(
      (movedSteps[2]!["config"] as JSONObject)["credentialId"],
    ).toBeUndefined();

    /*
     * The secrets' variables are there; the credentials' were deleted since,
     * by someone who no longer wanted them: a run again makes none of them.
     */
    existingNames[PROJECT_A] = ["API_TOKEN", "db_password"];
    runbooks = [
      {
        _id: "90000000-0000-4000-8000-000000000001",
        projectId: PROJECT_A,
        steps: JSON.stringify(movedSteps),
      },
    ];
    statements = [];
    created = [];
    credentialReads = [];

    const summary: RunbookVariablesMoveSummary =
      await RunbookVariablesMove.moveAll(query);

    expect(created).toEqual([]);
    expect(
      statements.filter((statement: Statement): boolean => {
        return statement.sql === UPDATE_RUNBOOK_STEPS_SQL;
      }),
    ).toHaveLength(0);
    expect(summary).toMatchObject({
      secretsAlreadyMoved: 2,
      credentialsMoved: 0,
      stepsMoved: 0,
      runbooksRewritten: 0,
      projectsFailed: 0,
    });

    // Only the step whose credential is gone still names one the old way.
    expect(credentialReads).toEqual([[GONE_CREDENTIAL]]);
  });

  /*
   * What the first release of this move wrote: the Kubernetes step's
   * credential and action kept beside its script. The removal of runbook
   * credentials runs this again: they are taken off, and the credential is
   * not read for it.
   */
  test("a Kubernetes step moved with its credential and action kept has them taken off, reading no credential", async () => {
    hasSecretTable = false;
    runbooks = [
      {
        _id: "90000000-0000-4000-8000-000000000005",
        projectId: PROJECT_A,
        steps: [
          {
            id: "c",
            type: RunbookStepType.Kubernetes,
            config: {
              kubeconfig: "{{global.variables.prod_cluster-kubeconfig}}",
              script: "kubectl rollout restart deployment/api --namespace web",
              agentId: RUNNER_1,
              credentialId: K8S_CREDENTIAL,
              action: KubernetesAction.RestartWorkload,
              workloadKind: KubernetesWorkloadKind.Deployment,
              namespace: "web",
              workloadName: "api",
            },
          },
        ],
      },
    ];

    const summary: RunbookVariablesMoveSummary =
      await RunbookVariablesMove.moveAll(query, { moveSecrets: false });

    expect(
      stepsWritten("90000000-0000-4000-8000-000000000005")[0]!["config"],
    ).toEqual({
      kubeconfig: "{{global.variables.prod_cluster-kubeconfig}}",
      script: "kubectl rollout restart deployment/api --namespace web",
      agentId: RUNNER_1,
    });
    expect(summary).toMatchObject({
      credentialsMoved: 0,
      stepsMoved: 1,
      runbooksRewritten: 1,
    });
    expect(credentialReads).toEqual([]);
    expect(created).toEqual([]);
  });

  /*
   * The removal of runbook credentials moves the steps that still name one
   * without the secrets: every one of them moved the first time, and a
   * secret variable deleted since must not be made again.
   */
  test("without the secrets, only the credentials steps name are moved", async () => {
    const summary: RunbookVariablesMoveSummary =
      await RunbookVariablesMove.moveAll(query, { moveSecrets: false });

    expect(
      statements.some((statement: Statement): boolean => {
        return (
          statement.sql === LEGACY_SECRET_TABLE_SQL ||
          statement.sql === LEGACY_SECRETS_SQL ||
          statement.sql === LEGACY_SECRET_RUNNERS_SQL
        );
      }),
    ).toBe(false);
    expect(
      created.map((variable: RunbookVariable): string => {
        return String(variable.name);
      }),
    ).toEqual([
      "prod_hosts-ssh-key",
      "prod_hosts-ssh-key-passphrase",
      "prod_cluster-kubeconfig",
    ]);
    expect(summary.secretsMoved).toBe(0);
    expect(summary.credentialsMoved).toBe(2);
  });

  test("with the credential table gone, a step that names a credential is left as it was", async () => {
    hasCredentialTable = false;

    const summary: RunbookVariablesMoveSummary =
      await RunbookVariablesMove.moveAll(query);

    expect(
      statements.some((statement: Statement): boolean => {
        return (
          statement.sql === LEGACY_CREDENTIALS_SQL ||
          statement.sql === LEGACY_CREDENTIAL_RUNNERS_SQL
        );
      }),
    ).toBe(false);
    expect(summary.credentialsMoved).toBe(0);
    const steps: Array<JSONObject> = stepsWritten(
      "90000000-0000-4000-8000-000000000001",
    );
    expect(steps[1]!["config"]).toEqual({
      credentialId: SSH_CREDENTIAL,
      command: "uptime",
      agentId: RUNNER_1,
    });
  });

  test("two things one run moves never share a name: the second takes the next free one", async () => {
    const OTHER_SSH_CREDENTIAL: string = "cccccccc-0000-4000-8000-000000000004";

    // "prod/hosts" is written "prod_hosts" too.
    legacyCredentials = [SSH_CREDENTIAL, OTHER_SSH_CREDENTIAL].map(
      (id: string, index: number): Record<string, unknown> => {
        return {
          _id: id,
          projectId: PROJECT_A,
          name: index === 0 ? "prod hosts" : "prod/hosts",
          credentialType: LEGACY_SSH_CREDENTIAL_TYPE,
          sshHostname: `10.0.4.${21 + index}`,
          sshUsername: "deploy",
          sshPassword: `password-${index}`,
        };
      },
    );
    credentialRunners = [];
    runbooks = [
      {
        _id: "90000000-0000-4000-8000-000000000004",
        projectId: PROJECT_A,
        steps: [SSH_CREDENTIAL, OTHER_SSH_CREDENTIAL].map((id: string) => {
          return {
            type: RunbookStepType.SSH,
            config: { credentialId: id, command: "uptime" },
          };
        }),
      },
    ];

    await RunbookVariablesMove.moveAll(query);

    expect(variableNamed("prod_hosts-ssh-password").secretValue).toBe(
      "password-0",
    );
    expect(variableNamed("prod_hosts-ssh-password-2").secretValue).toBe(
      "password-1",
    );

    const steps: Array<JSONObject> = stepsWritten(
      "90000000-0000-4000-8000-000000000004",
    );
    expect((steps[0]!["config"] as JSONObject)["signIn"]).toBe(
      "{{global.variables.prod_hosts-ssh-password}}",
    );
    expect((steps[1]!["config"] as JSONObject)["signIn"]).toBe(
      "{{global.variables.prod_hosts-ssh-password-2}}",
    );
    expect((steps[1]!["config"] as JSONObject)["host"]).toBe("10.0.4.22");
  });

  test("one project's failure is logged, and the others go on", async () => {
    failCreateFor = PROJECT_A;
    runbooks.push({
      _id: "90000000-0000-4000-8000-000000000003",
      projectId: PROJECT_B,
      steps: [
        {
          type: RunbookStepType.Bash,
          config: { script: "echo {{runbookSecrets.B_TOKEN}}" },
        },
      ],
    });
    legacySecrets.push({
      _id: "f0000000-0000-4000-8000-000000000009",
      projectId: PROJECT_B,
      name: "B_TOKEN",
      description: null,
      secretValue: "b-token-value",
      isAvailableToGlobalRunners: false,
      createdByUserId: null,
    });

    const summary: RunbookVariablesMoveSummary =
      await RunbookVariablesMove.moveAll(query);

    expect(summary.projectsFailed).toBe(1);
    expect(variableNamed("B_TOKEN").secretValue).toBe("b-token-value");
    expect(
      (
        stepsWritten("90000000-0000-4000-8000-000000000003")[0]![
          "config"
        ] as JSONObject
      )["script"],
    ).toBe("echo {{global.variables.B_TOKEN}}");
    expect(logger.error).toHaveBeenCalled();
  });

  test("with no secrets table, only the credentials steps name are moved", async () => {
    hasSecretTable = false;

    await RunbookVariablesMove.moveAll(query);

    expect(
      statements.some((statement: Statement): boolean => {
        return (
          statement.sql === LEGACY_SECRETS_SQL ||
          statement.sql === LEGACY_SECRET_RUNNERS_SQL
        );
      }),
    ).toBe(false);
    expect(variableNamed("prod_hosts-ssh-key")).toBeDefined();
  });
});
