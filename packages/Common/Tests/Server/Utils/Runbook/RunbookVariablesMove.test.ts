import RunbookVariablesMove, {
  LEGACY_SECRETS_SQL,
  LEGACY_SECRET_RUNNERS_SQL,
  LEGACY_SECRET_TABLE_SQL,
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
import RunbookCredentialService from "../../../../Server/Services/RunbookCredentialService";
import RunbookVariableService from "../../../../Server/Services/RunbookVariableService";
import RunnerService from "../../../../Server/Services/RunnerService";
import Encryption from "../../../../Server/Utils/Encryption";
import logger from "../../../../Server/Utils/Logger";
import RunbookCredential from "../../../../Models/DatabaseModels/RunbookCredential";
import RunbookVariable from "../../../../Models/DatabaseModels/RunbookVariable";
import Runner from "../../../../Models/DatabaseModels/Runner";
import { JSONObject } from "../../../../Types/JSON";
import RunbookCredentialType from "../../../../Types/Runbook/RunbookCredentialType";
import {
  KubernetesAction,
  KubernetesWorkloadKind,
} from "../../../../Types/Runbook/RunbookStep";
import RunbookStepType from "../../../../Types/Runbook/RunbookStepType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * RUNBOOK SECRETS AND THE CREDENTIALS RUNBOOK STEPS USED BECOME VARIABLES -
 * once, so every runbook keeps running as it did (RunbookVariablesMove).
 *
 * Read with statements against the legacy tables (a fake that answers them
 * here; RunbookVariablesMovePostgres runs the real ones), written through
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
        credentialType: RunbookCredentialType.SSH,
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
        credentialType: RunbookCredentialType.Kubernetes,
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
    expect(config).not.toHaveProperty("credentialId");
    expect(config).not.toHaveProperty("action");
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
  let failCreateFor: string | null;

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
    failCreateFor = null;

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

    jest
      .spyOn(RunbookCredentialService, "findBy")
      .mockImplementation(async (): Promise<Array<RunbookCredential>> => {
        return [
          Object.assign(new RunbookCredential(), {
            _id: SSH_CREDENTIAL,
            name: "prod hosts",
            credentialType: RunbookCredentialType.SSH,
            sshHostname: "10.0.4.21",
            sshPort: 22,
            sshUsername: "deploy",
            sshPrivateKey: "-----BEGIN OPENSSH PRIVATE KEY-----\nk\n",
            sshPassphrase: "open sesame",
            runners: [Object.assign(new Runner(), { _id: RUNNER_1 })],
          }),
          Object.assign(new RunbookCredential(), {
            _id: K8S_CREDENTIAL,
            name: "prod cluster",
            credentialType: RunbookCredentialType.Kubernetes,
            kubernetesApiServerUrl: "https://prod.example.com:6443",
            kubernetesServiceAccountToken: "sa-token",
            runners: [Object.assign(new Runner(), { _id: RUNNER_1 })],
          }),
        ];
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

    expect(summary.credentialsMoved).toBe(2);
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
    expect((steps[2]!["config"] as JSONObject)["kubeconfig"]).toBe(
      "{{global.variables.prod_cluster-kubeconfig}}",
    );
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

  test("two things one run moves never share a name: the second takes the next free one", async () => {
    const OTHER_SSH_CREDENTIAL: string = "cccccccc-0000-4000-8000-000000000004";

    // "prod/hosts" is written "prod_hosts" too.
    (
      RunbookCredentialService.findBy as unknown as jest.Mock
    ).mockImplementation(async (): Promise<Array<RunbookCredential>> => {
      return [SSH_CREDENTIAL, OTHER_SSH_CREDENTIAL].map(
        (id: string, index: number): RunbookCredential => {
          return Object.assign(new RunbookCredential(), {
            _id: id,
            name: index === 0 ? "prod hosts" : "prod/hosts",
            credentialType: RunbookCredentialType.SSH,
            sshHostname: `10.0.4.${21 + index}`,
            sshUsername: "deploy",
            sshPassword: `password-${index}`,
            runners: [],
          });
        },
      );
    });
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
