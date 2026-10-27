import {
  AGENT_AI_FIXES_SETTING_VALUES,
  AI_FIXES_ENV,
  AI_INVESTIGATION_ENV,
  ResolvedAgentAiSettings,
  parseAgentAiFixesSetting,
  resolveAgentAiSettings,
} from "../../../Types/AI/AgentAiSettings";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  AWS_CLOUD_AI_AGENT_LOG_RETENTION_DAYS,
  AWS_CLOUD_AI_AGENT_TEMPLATE_FILE,
  AZURE_CLOUD_AI_AGENT_SECRET_NAME,
  AzureCloudAiAgentRoleDefinition,
  CLOUD_AI_AGENT_DEFAULT_FIXES_MODE,
  CLOUD_AI_AGENT_DEFAULT_REGIONS,
  CLOUD_AI_AGENT_FIXES_MODES,
  CLOUD_AI_AGENT_HEALTH_HOST_ENV,
  CLOUD_AI_AGENT_IMAGE_TAG,
  CLOUD_AI_AGENT_INGESTION_KEY_ENV,
  CLOUD_AI_AGENT_ONEUPTIME_URL_ENV,
  CLOUD_AI_AGENT_SIZES,
  CLOUD_AI_AGENT_STARTED_MESSAGE,
  CloudAiAgentEnvironmentVariable,
  CloudAiAgentFixesMode,
  CloudAiAgentSetupOptions,
  GCP_CLOUD_AI_AGENT_ENV_FILE,
  describeCloudAiAgentSetupProblem,
  getAwsCloudAiAgentSetupCommand,
  getAwsCloudAiAgentTemplate,
  getAwsCloudAiAgentWriteRoleArn,
  getAzureCloudAiAgentRoleDefinition,
  getAzureCloudAiAgentRoleName,
  getAzureCloudAiAgentSetupCommand,
  getCloudAiAgentChangeOperations,
  getCloudAiAgentEnvironment,
  getCloudAiAgentImage,
  getCloudAiAgentRolePermissions,
  getCloudAiAgentSetupCommand,
  getGcpCloudAiAgentServices,
  getGcpCloudAiAgentSetupCommand,
} from "../../../Types/CloudConnection/CloudAiAgentSetupCommands";
import BadDataException from "../../../Types/Exception/BadDataException";
import AiResourceType, {
  AI_RESOURCE_TYPE_INFO,
  parseAiResourceType,
} from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  AWS_CLOUD_AI_AGENT_CLUSTER_NAME,
  AWS_CLOUD_AI_AGENT_LOG_GROUP_NAME,
  AWS_CLOUD_AI_AGENT_SERVICE_NAME,
  AWS_CLOUD_AI_AGENT_STACK_NAME,
  AWS_CLOUD_AI_AGENT_TASK_ROLE_NAME,
  AWS_CLOUD_AI_AGENT_WRITE_ROLE_NAME,
  AZURE_CLOUD_AI_AGENT_APP_NAME,
  AZURE_CLOUD_AI_AGENT_ENVIRONMENT_NAME,
  AZURE_CLOUD_AI_AGENT_RESOURCE_GROUP,
  AZURE_CLOUD_AI_AGENT_ROLE_NAME,
  CLOUD_AI_AGENT_NAME,
  GCP_CLOUD_AI_AGENT_ROLE_ID,
  GCP_CLOUD_AI_AGENT_SERVICE_ACCOUNT_ID,
  GCP_CLOUD_AI_AGENT_SERVICE_NAME,
  getCloudAiAgentOwnTargets,
} from "../../../Types/ResourceAiAgent/CloudAiAgentNames";
import {
  CLOUD_AI_DEFAULT_REQUIRED_TAG,
  MAX_POSTURE_LIST_ENTRIES,
  MAX_POSTURE_STRING_LENGTH,
  RESOURCE_AI_AGENT_API_KEY_ENVS,
  RESOURCE_AI_AGENT_DEFAULT_HEALTH_PORT,
  RESOURCE_AI_AGENT_IMAGE_REPOSITORY,
  RESOURCE_AI_AGENT_RESOURCE_TYPE_ENV,
  RESOURCE_AI_ALLOW_WRITES_ENV,
  RESOURCE_AI_AWS_WRITE_ROLE_ARN_ENV,
  RESOURCE_AI_CLOUD_ACCOUNT_ID_ENV,
  RESOURCE_AI_CLOUD_OPERATIONS_ENV,
  RESOURCE_AI_CLOUD_REQUIRED_TAG_ENV,
  RESOURCE_AI_PROTECTED_TARGETS_ENV,
  ResourceCommandTier,
} from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import {
  CLOUD_CHANGE_OPERATION_NAMES,
  CloudOperationKindSpec,
  CloudOperationSpec,
  getCloudOperation,
} from "../../../Utils/AiRemediation/Resource/CloudOperationCatalog";
import { globMatchesTarget } from "../../../Utils/AiRemediation/Resource/ResourceCommandPolicyCore";
import { afterAll, describe, expect, test } from "@jest/globals";
import { SpawnSyncReturns, spawnSync } from "child_process";
import fs from "fs";
import yaml from "js-yaml";
import os from "os";
import path from "path";

/*
 * The one command per cloud that lets OneUptime AI fix problems in an
 * account, held to what it must do: it creates exactly the resources
 * CloudAiAgentNames names (and the agent protects); the role holds exactly
 * the permissions of the changes turned on, so turning one off takes its
 * permissions out; on AWS the changes need the required tag, the reads do
 * not, and the agent's own cluster and service are never the role's; the
 * agent gets exactly the variables it needs, the key as the one secret;
 * every value from the options is checked, and the ones that reach the
 * shell are quoted - bash runs each command against fake aws, az and
 * gcloud functions and every value arrives as it was given; and each
 * command can be run again.
 */

type Json = any;

const CLOUD_ACCOUNT_ID: string = "33333333-3333-4333-8333-333333333333";
const KEY: string = "0b5f2c1e-1111-4111-8111-222233334444";
const AWS_ACCOUNT: string = "123456789012";
const AZURE_SUBSCRIPTION: string = "0b1f6471-1bf0-4dda-aec3-111122223333";
const GCP_PROJECT: string = "my-project-123";

const BASE: Omit<CloudAiAgentSetupOptions, "provider" | "accountId"> = {
  oneuptimeUrl: "https://oneuptime.com",
  ingestionKey: KEY,
  cloudAccountId: CLOUD_ACCOUNT_ID,
  fixesMode: "RequireApproval",
};

const AWS: CloudAiAgentSetupOptions = {
  ...BASE,
  provider: CloudProvider.AWS,
  accountId: AWS_ACCOUNT,
};
const AZURE: CloudAiAgentSetupOptions = {
  ...BASE,
  provider: CloudProvider.Azure,
  accountId: AZURE_SUBSCRIPTION,
};
const GCP: CloudAiAgentSetupOptions = {
  ...BASE,
  provider: CloudProvider.GCP,
  accountId: GCP_PROJECT,
};

const ALL_CLOUDS: Array<CloudAiAgentSetupOptions> = [AWS, AZURE, GCP];

const REPOSITORY_DIRECTORY: string = path.resolve(__dirname, "../../../../..");

// ---- Helpers --------------------------------------------------------------------

// The catalog's own permissions of these changes on this cloud, and whoami's.
function catalogPermissions(
  provider: CloudProvider,
  operations: Array<string>,
): Array<string> {
  const permissions: Set<string> = new Set<string>();

  for (const name of [...operations, "whoami"]) {
    const operation: CloudOperationSpec | null = getCloudOperation(name);

    for (const kind of operation ? operation.kinds : []) {
      if ((kind.provider as string) === (provider as string)) {
        kind.permissions.forEach((permission: string) => {
          permissions.add(permission);
        });
      }
    }
  }

  // A Google Cloud change's long-running operation is read by its service.
  const named: Array<string> = Array.from(permissions);
  if (
    named.some((permission: string): boolean => {
      return permission.startsWith("compute.");
    })
  ) {
    permissions.add("compute.zoneOperations.get");
    permissions.add("compute.regionOperations.get");
  }
  if (
    named.some((permission: string): boolean => {
      return permission.startsWith("run.");
    })
  ) {
    permissions.add("run.operations.get");
  }

  return Array.from(permissions).sort();
}

function environmentOf(
  options: CloudAiAgentSetupOptions,
): Record<string, string> {
  const environment: Record<string, string> = {};

  for (const variable of getCloudAiAgentEnvironment(options)) {
    environment[variable.name] = variable.value;
  }

  return environment;
}

// The lines of a heredoc that starts with this line.
function heredocBody(command: string, opening: string): Array<string> {
  const lines: Array<string> = command.split("\n");
  const start: number = lines.indexOf(opening);
  const delimiter: string = opening.substring(
    opening.indexOf("<<'") + 3,
    opening.length - 1,
  );
  const end: number = lines.indexOf(delimiter, start + 1);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return lines.slice(start + 1, end);
}

// The command outside its heredocs: what the shell itself reads as words.
function shellLines(command: string): Array<string> {
  const lines: Array<string> = command.split("\n");
  const result: Array<string> = [];
  let delimiter: string | null = null;

  for (const line of lines) {
    if (delimiter !== null) {
      if (line === delimiter) {
        delimiter = null;
      }
      continue;
    }

    const opening: number = line.indexOf("<<'");

    if (opening >= 0) {
      delimiter = line.substring(opening + 3, line.length - 1);
    }

    result.push(line);
  }

  return result;
}

function template(options: CloudAiAgentSetupOptions): Json {
  return JSON.parse(getAwsCloudAiAgentTemplate(options));
}

function writePolicy(options: CloudAiAgentSetupOptions): Json {
  return template(options).Resources.WriteRole.Properties.Policies[0]
    .PolicyDocument;
}

function statement(policy: Json, sid: string): Json {
  return policy.Statement.find((entry: Json): boolean => {
    return entry.Sid === sid;
  });
}

const AWS_READ_ACTION: RegExp = /^[a-z0-9-]+:(Describe|List|Get)/;

function isAwsRead(action: string): boolean {
  return AWS_READ_ACTION.test(action);
}

// ---- A shell to run the commands in, with fake cloud CLIs -----------------------

/*
 * aws, az and gcloud as bash functions: each records its argv (arguments
 * apart by \037, calls by \036, characters no checked value may hold) and
 * answers as the scenario's FAKE_ variables say. A function wins over any
 * real CLI on PATH, so nothing reaches a cloud.
 */
const FAKE_CLIS: string = String.raw`
record() {
  for arg in "$@"; do printf '%s\037' "$arg"; done >> "$CALLS"
  printf '\036' >> "$CALLS"
}
aws() {
  record aws "$@"
  case "$1 $2" in
    "sts get-caller-identity") echo "$FAKE_ACCOUNT" ;;
    "ec2 describe-vpcs") echo "$FAKE_VPC" ;;
    "ec2 describe-subnets") printf '%s\n' "$FAKE_SUBNETS" ;;
    "cloudformation describe-stacks")
      if [ -n "$FAKE_STACK_STATUS" ]; then echo "$FAKE_STACK_STATUS"; else echo "Stack does not exist" >&2; return 254; fi ;;
    "cloudformation deploy")
      cp "$TEMPLATE_FILE" "$CAPTURED/template.json"
      return "$FAKE_DEPLOY_EXIT" ;;
  esac
  return 0
}
az() {
  record az "$@"
  case "$1 $2" in
    "role definition")
      if [ "$3" = create ] && [ "$FAKE_EXISTS" = 1 ]; then echo "RoleDefinitionWithSameNameExists" >&2; return 1; fi
      echo "$FAKE_ROLE_ID" ;;
    "group show") [ "$FAKE_EXISTS" = 1 ] || return 3 ;;
    "containerapp env")
      if [ "$3" = show ] && [ "$FAKE_EXISTS" != 1 ]; then return 3; fi ;;
    "containerapp show") echo "$FAKE_PRINCIPAL" ;;
    "containerapp create") return "$FAKE_DEPLOY_EXIT" ;;
  esac
  return 0
}
gcloud() {
  record gcloud "$@"
  case "$1 $2 $3" in
    "iam roles create")
      if [ "$FAKE_EXISTS" = 1 ]; then echo "ALREADY_EXISTS" >&2; return 1; fi ;;
    "iam service-accounts create")
      if [ "$FAKE_EXISTS" = 1 ]; then echo "ALREADY_EXISTS" >&2; return 1; fi ;;
    "run deploy $GCP_SERVICE")
      cp "$ENV_FILE" "$CAPTURED/env.yaml"
      return "$FAKE_DEPLOY_EXIT" ;;
  esac
  return 0
}
`;

interface Scenario {
  account?: string | undefined;
  vpc?: string | undefined;
  subnets?: string | undefined;
  stackStatus?: string | undefined;
  deployExit?: number | undefined;
  // The role, group, environment and service account are there already.
  exists?: boolean | undefined;
}

interface ShellRun {
  // What the command printed, line by line.
  output: Array<string>;
  // The argv of every aws, az and gcloud call, in order.
  calls: Array<Array<string>>;
  // The files the command left in its directory.
  files: Array<string>;
  // The AWS template and the Google Cloud variables as the deploy read them.
  template: string | null;
  envFile: string | null;
}

const ROLE_ID: string = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PRINCIPAL: string = "99999999-8888-4777-8666-555555555555";

const SHELL_DIRECTORIES: Array<string> = [];

afterAll(() => {
  for (const directory of SHELL_DIRECTORIES) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function run(command: string, scenario: Scenario = {}): ShellRun {
  const directory: string = fs.mkdtempSync(
    path.join(os.tmpdir(), "cloud-ai-agent-"),
  );
  const work: string = path.join(directory, "home");
  const captured: string = path.join(directory, "captured");
  const calls: string = path.join(directory, "calls");

  SHELL_DIRECTORIES.push(directory);
  fs.mkdirSync(work);
  fs.mkdirSync(captured);
  fs.writeFileSync(calls, "");

  // A failed step can leave a non-zero status: what was printed is what counts.
  const shell: SpawnSyncReturns<string> = spawnSync(
    "bash",
    ["-c", `${FAKE_CLIS}\n${command}`],
    {
      cwd: work,
      encoding: "utf8",
      env: {
        PATH: process.env["PATH"] || "/usr/bin:/bin",
        CALLS: calls,
        CAPTURED: captured,
        TEMPLATE_FILE: AWS_CLOUD_AI_AGENT_TEMPLATE_FILE,
        ENV_FILE: GCP_CLOUD_AI_AGENT_ENV_FILE,
        GCP_SERVICE: GCP_CLOUD_AI_AGENT_SERVICE_NAME,
        FAKE_ACCOUNT: scenario.account ?? AWS_ACCOUNT,
        FAKE_VPC: scenario.vpc ?? "vpc-0123456789abcdef0",
        FAKE_SUBNETS: scenario.subnets ?? "subnet-1\tsubnet-2\tsubnet-3",
        FAKE_STACK_STATUS: scenario.stackStatus ?? "",
        FAKE_DEPLOY_EXIT: String(scenario.deployExit ?? 0),
        FAKE_EXISTS: scenario.exists ? "1" : "0",
        FAKE_ROLE_ID: ROLE_ID,
        FAKE_PRINCIPAL: PRINCIPAL,
      },
    },
  );

  expect(shell.error).toBeUndefined();

  const output: string = shell.stdout;
  const read: (file: string) => string | null = (
    file: string,
  ): string | null => {
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  };

  return {
    output: output.split("\n").filter((line: string): boolean => {
      return line.length > 0;
    }),
    calls: fs
      .readFileSync(calls, "utf8")
      .split("\u001e")
      .filter((call: string): boolean => {
        return call.length > 0;
      })
      .map((call: string): Array<string> => {
        return call.split("\u001f").slice(0, -1);
      }),
    files: fs.readdirSync(work).sort(),
    template: read(path.join(captured, "template.json")),
    envFile: read(path.join(captured, "env.yaml")),
  };
}

// The calls whose argv starts with these words.
function callsTo(
  shell: ShellRun,
  ...words: Array<string>
): Array<Array<string>> {
  return shell.calls.filter((call: Array<string>): boolean => {
    return words.every((word: string, index: number): boolean => {
      return call[index] === word;
    });
  });
}

// The value after a flag in an argv.
function flag(call: Array<string>, name: string): string | undefined {
  const index: number = call.indexOf(name);

  return index >= 0 ? call[index + 1] : undefined;
}

// The words after a flag, up to the next flag.
function flagWords(call: Array<string>, name: string): Array<string> {
  const index: number = call.indexOf(name);
  const words: Array<string> = [];

  for (let at: number = index + 1; at > 0 && at < call.length; at++) {
    if ((call[at] as string).startsWith("--")) {
      break;
    }
    words.push(call[at] as string);
  }

  return words;
}

// ---- The changes each cloud has -------------------------------------------------

describe("the changes each cloud has", () => {
  test("AWS has every change of the catalog, Azure and Google Cloud the ones they support", () => {
    expect(getCloudAiAgentChangeOperations(CloudProvider.AWS)).toEqual([
      "restart-service",
      "start-instance",
      "scale-out",
      "scale-in",
      "reboot-instance",
      "roll-back-service",
      "set-concurrency",
      "fail-over-database",
      "stop-instance",
      "redrive-queue",
    ]);
    expect(getCloudAiAgentChangeOperations(CloudProvider.Azure)).toEqual([
      "restart-service",
      "start-instance",
      "scale-out",
      "scale-in",
      "reboot-instance",
      "roll-back-service",
      "fail-over-database",
      "stop-instance",
    ]);
    expect(getCloudAiAgentChangeOperations(CloudProvider.GCP)).toEqual([
      "start-instance",
      "scale-out",
      "scale-in",
      "reboot-instance",
      "roll-back-service",
      "set-concurrency",
      "fail-over-database",
      "stop-instance",
    ]);
  });

  test("they are the catalog's changes, in its order, each with a kind of resource on that cloud - never a read", () => {
    for (const options of ALL_CLOUDS) {
      const changes: Array<string> = getCloudAiAgentChangeOperations(
        options.provider,
      );

      expect(
        CLOUD_CHANGE_OPERATION_NAMES.filter((name: string): boolean => {
          return changes.includes(name);
        }),
      ).toEqual(changes);

      for (const name of changes) {
        const operation: CloudOperationSpec = getCloudOperation(
          name,
        ) as CloudOperationSpec;

        expect(operation.runsOn).toBe("agent");
        expect(
          operation.kinds.some((kind: CloudOperationKindSpec): boolean => {
            return (
              (kind.provider as string) === (options.provider as string) &&
              kind.tier !== ResourceCommandTier.Read
            );
          }),
        ).toBe(true);
      }

      for (const read of [
        "describe",
        "recent-events",
        "quota-usage",
        "read-logs",
        "whoami",
      ]) {
        expect(changes).not.toContain(read);
      }
    }
  });

  test("every change of the catalog is one some cloud's agent can make", () => {
    const everywhere: Set<string> = new Set<string>(
      ALL_CLOUDS.flatMap((options: CloudAiAgentSetupOptions): Array<string> => {
        return getCloudAiAgentChangeOperations(options.provider);
      }),
    );

    expect(Array.from(everywhere).sort()).toEqual(
      [...CLOUD_CHANGE_OPERATION_NAMES].sort(),
    );
  });
});

// ---- The role -------------------------------------------------------------------

describe("the role's permissions", () => {
  test.each(ALL_CLOUDS)(
    "on $provider, every change by default: the catalog's permissions for each kind of resource, and whoami's",
    (options: CloudAiAgentSetupOptions) => {
      const permissions: Array<string> = getCloudAiAgentRolePermissions(
        options.provider,
      );

      expect(permissions).toEqual(
        catalogPermissions(
          options.provider,
          getCloudAiAgentChangeOperations(options.provider),
        ),
      );
      expect(permissions).toEqual([...permissions].sort());
      expect(new Set(permissions).size).toBe(permissions.length);
      expect(
        getCloudAiAgentRolePermissions(
          options.provider,
          getCloudAiAgentChangeOperations(options.provider),
        ),
      ).toEqual(permissions);
    },
  );

  test.each(ALL_CLOUDS)(
    "on $provider, turning a change off takes out exactly the permissions only it needed",
    (options: CloudAiAgentSetupOptions) => {
      const all: Array<string> = getCloudAiAgentChangeOperations(
        options.provider,
      );

      for (const off of all) {
        const others: Array<string> = all.filter((name: string): boolean => {
          return name !== off;
        });
        const permissions: Array<string> = getCloudAiAgentRolePermissions(
          options.provider,
          others,
        );
        const onlyItsOwn: Array<string> = catalogPermissions(options.provider, [
          off,
        ]).filter((permission: string): boolean => {
          return !catalogPermissions(options.provider, others).includes(
            permission,
          );
        });

        expect({ off, permissions }).toEqual({
          off,
          permissions: catalogPermissions(options.provider, others),
        });

        for (const permission of onlyItsOwn) {
          expect({
            off,
            permission,
            kept: permissions.includes(permission),
          }).toEqual({ off, permission, kept: false });
        }
      }
    },
  );

  test("one change's role holds that change's calls and the read of what it replaces, and nothing else", () => {
    expect(
      getCloudAiAgentRolePermissions(CloudProvider.AWS, ["restart-service"]),
    ).toEqual(["ecs:DescribeServices", "ecs:UpdateService"]);
    expect(
      getCloudAiAgentRolePermissions(CloudProvider.AWS, ["redrive-queue"]),
    ).toEqual([
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
      "sqs:ListDeadLetterSourceQueues",
      "sqs:ReceiveMessage",
      "sqs:SendMessage",
      "sqs:StartMessageMoveTask",
    ]);
    // Azure's whoami reads the subscription; it is always there.
    expect(
      getCloudAiAgentRolePermissions(CloudProvider.Azure, ["start-instance"]),
    ).toEqual([
      "Microsoft.Compute/virtualMachines/read",
      "Microsoft.Compute/virtualMachines/start/action",
      "Microsoft.Resources/subscriptions/read",
    ]);
    // With the read of the operation the start returns, to see how it ended.
    expect(
      getCloudAiAgentRolePermissions(CloudProvider.GCP, ["start-instance"]),
    ).toEqual([
      "compute.instances.get",
      "compute.instances.start",
      "compute.regionOperations.get",
      "compute.zoneOperations.get",
    ]);
  });

  test("a required tag adds the reads of the tags a Lambda function's or an SQS queue's own read does not return", () => {
    const policy: (requiredTag: string | null) => string = (
      requiredTag: string | null,
    ): string => {
      return JSON.stringify(
        JSON.parse(getAwsCloudAiAgentTemplate({ ...AWS, requiredTag }))[
          "Resources"
        ]["WriteRole"],
      );
    };

    expect(policy(CLOUD_AI_DEFAULT_REQUIRED_TAG)).toContain("lambda:ListTags");
    expect(policy(CLOUD_AI_DEFAULT_REQUIRED_TAG)).toContain(
      "sqs:ListQueueTags",
    );
    expect(policy(null)).not.toContain("lambda:ListTags");
    expect(policy(null)).not.toContain("sqs:ListQueueTags");
  });

  test("the order and repeats of the list do not matter", () => {
    expect(
      getCloudAiAgentRolePermissions(CloudProvider.AWS, [
        "scale-out",
        "restart-service",
        "scale-out",
      ]),
    ).toEqual(
      getCloudAiAgentRolePermissions(CloudProvider.AWS, [
        "restart-service",
        "scale-out",
      ]),
    );
  });

  test("each cloud's permissions are written as that cloud writes them", () => {
    for (const permission of getCloudAiAgentRolePermissions(
      CloudProvider.AWS,
    )) {
      expect(permission).toMatch(/^[a-z0-9-]+:[A-Z][A-Za-z]+$/);
    }

    for (const permission of getCloudAiAgentRolePermissions(
      CloudProvider.Azure,
    )) {
      expect(permission).toMatch(/^Microsoft\.[A-Za-z]+\/[A-Za-z/]+$/);
      expect(permission).toMatch(/\/(read|write|action)$/);
    }

    for (const permission of getCloudAiAgentRolePermissions(
      CloudProvider.GCP,
    )) {
      expect(permission).toMatch(/^[a-z]+\.[A-Za-z]+\.[a-z]+$/);
    }
  });

  test("no role can delete anything, touch IAM or hold a wildcard", () => {
    for (const options of ALL_CLOUDS) {
      for (const permission of getCloudAiAgentRolePermissions(
        options.provider,
      )) {
        expect(permission).not.toContain("*");
        expect(permission).not.toMatch(
          /^(iam|sts|kms|secretsmanager|s3)[:.]|Microsoft\.Authorization|Microsoft\.KeyVault|delete|Delete(?!FunctionConcurrency|Message)|Terminate/,
        );
      }
    }
  });

  test("refuses a change it does not know, a read, an alias, another cloud's change and an empty list", () => {
    const refusals: Array<[CloudProvider, Array<string>]> = [
      [CloudProvider.AWS, ["restart-everything"]],
      [CloudProvider.AWS, ["describe"]],
      [CloudProvider.AWS, ["whoami"]],
      [CloudProvider.AWS, ["rollback-service"]],
      [CloudProvider.Azure, ["redrive-queue"]],
      [CloudProvider.Azure, ["set-concurrency"]],
      [CloudProvider.GCP, ["restart-service"]],
      [CloudProvider.GCP, []],
    ];

    for (const [provider, operations] of refusals) {
      expect(() => {
        return getCloudAiAgentRolePermissions(provider, operations);
      }).toThrow(BadDataException);
    }

    expect(() => {
      return getCloudAiAgentRolePermissions("ibm" as CloudProvider);
    }).toThrow(BadDataException);
  });
});

// ---- The environment ------------------------------------------------------------

describe("the agent's environment", () => {
  test("AWS: what the agent is, where OneUptime is, the key, the account it was set up for, what AI may do and the write role", () => {
    expect(getCloudAiAgentEnvironment(AWS)).toEqual([
      {
        name: RESOURCE_AI_AGENT_RESOURCE_TYPE_ENV,
        value: "aws",
        isSecret: false,
      },
      {
        name: CLOUD_AI_AGENT_ONEUPTIME_URL_ENV,
        value: "https://oneuptime.com",
        isSecret: false,
      },
      { name: CLOUD_AI_AGENT_INGESTION_KEY_ENV, value: KEY, isSecret: true },
      {
        name: RESOURCE_AI_CLOUD_ACCOUNT_ID_ENV,
        value: CLOUD_ACCOUNT_ID,
        isSecret: false,
      },
      { name: RESOURCE_AI_ALLOW_WRITES_ENV, value: "true", isSecret: false },
      { name: AI_INVESTIGATION_ENV, value: "true", isSecret: false },
      { name: AI_FIXES_ENV, value: "ask-for-approval", isSecret: false },
      {
        name: RESOURCE_AI_AWS_WRITE_ROLE_ARN_ENV,
        value: `arn:aws:iam::${AWS_ACCOUNT}:role/${AWS_CLOUD_AI_AGENT_WRITE_ROLE_NAME}`,
        isSecret: false,
      },
    ]);
    expect(getAwsCloudAiAgentWriteRoleArn(AWS_ACCOUNT)).toBe(
      `arn:aws:iam::${AWS_ACCOUNT}:role/OneUptimeAiAgentWrite`,
    );
  });

  test("Azure: the subscription the agent acts in, as Azure writes it, and no AWS role", () => {
    const environment: Record<string, string> = environmentOf({
      ...AZURE,
      accountId: AZURE_SUBSCRIPTION.toUpperCase(),
    });

    expect(environment["AZURE_SUBSCRIPTION_ID"]).toBe(AZURE_SUBSCRIPTION);
    expect(
      AI_RESOURCE_TYPE_INFO[AiResourceType.AzureSubscription].identityEnvVars,
    ).toEqual(["AZURE_SUBSCRIPTION_ID"]);
    expect(environment[RESOURCE_AI_AGENT_RESOURCE_TYPE_ENV]).toBe("azure");
    expect(environment[RESOURCE_AI_AWS_WRITE_ROLE_ARN_ENV]).toBeUndefined();
    expect(environment[CLOUD_AI_AGENT_HEALTH_HOST_ENV]).toBeUndefined();
  });

  test("Google Cloud: the health server on every interface, on the PORT Cloud Run sets", () => {
    const environment: Record<string, string> = environmentOf(GCP);

    expect(environment[RESOURCE_AI_AGENT_RESOURCE_TYPE_ENV]).toBe("gcp");
    expect(environment[CLOUD_AI_AGENT_HEALTH_HOST_ENV]).toBe("0.0.0.0");
    // Cloud Run keeps PORT for itself and sets it from --port.
    expect(environment["PORT"]).toBeUndefined();
    expect(environment[RESOURCE_AI_AWS_WRITE_ROLE_ARN_ENV]).toBeUndefined();
    expect(environment["AZURE_SUBSCRIPTION_ID"]).toBeUndefined();
  });

  test.each(ALL_CLOUDS)(
    "on $provider, the resource type is the cloud's agent alias, which the agent reads back as the cloud's type",
    (options: CloudAiAgentSetupOptions) => {
      const type: AiResourceType | null = parseAiResourceType(
        environmentOf(options)[RESOURCE_AI_AGENT_RESOURCE_TYPE_ENV],
      );

      expect(type).toBe(
        {
          [CloudProvider.AWS]: AiResourceType.AwsAccount,
          [CloudProvider.Azure]: AiResourceType.AzureSubscription,
          [CloudProvider.GCP]: AiResourceType.GoogleCloudProject,
        }[options.provider],
      );
    },
  );

  test("how far AI may go is the agent's own fixes setting, which the agent reads back as that mode with writes on", () => {
    expect(CLOUD_AI_AGENT_FIXES_MODES).toEqual([
      "RequireApproval",
      "Automatic",
      "BypassApproval",
    ]);
    expect(CLOUD_AI_AGENT_DEFAULT_FIXES_MODE).toBe("RequireApproval");

    const written: Record<CloudAiAgentFixesMode, string> = {
      RequireApproval: "ask-for-approval",
      Automatic: "automatic",
      BypassApproval: "bypass-approval",
    };

    for (const mode of CLOUD_AI_AGENT_FIXES_MODES) {
      const environment: Record<string, string> = environmentOf({
        ...AWS,
        fixesMode: mode,
      });
      const resolved: ResolvedAgentAiSettings = resolveAgentAiSettings({
        investigationSetting: environment[AI_INVESTIGATION_ENV],
        fixesSetting: environment[AI_FIXES_ENV],
        allowWrites: environment[RESOURCE_AI_ALLOW_WRITES_ENV] === "true",
        allowWritesName: RESOURCE_AI_ALLOW_WRITES_ENV,
      });

      expect(environment[AI_FIXES_ENV]).toBe(written[mode]);
      expect(environment[AI_FIXES_ENV]).toBe(
        AGENT_AI_FIXES_SETTING_VALUES[mode],
      );
      expect(parseAgentAiFixesSetting(environment[AI_FIXES_ENV])).toBe(mode);
      expect(resolved).toEqual({
        settings: { investigation: true, fixes: mode, isConfigured: true },
        allowWrites: true,
        warnings: [],
      });
    }
  });

  test("names the changes only when they are not every change, in the catalog's order", () => {
    for (const options of ALL_CLOUDS) {
      const all: Array<string> = getCloudAiAgentChangeOperations(
        options.provider,
      );

      expect(environmentOf(options)[RESOURCE_AI_CLOUD_OPERATIONS_ENV]).toBe(
        undefined,
      );
      expect(
        environmentOf({
          ...options,
          enabledOperations: [...all].reverse().concat(all),
        })[RESOURCE_AI_CLOUD_OPERATIONS_ENV],
      ).toBe(undefined);
      expect(
        environmentOf({
          ...options,
          enabledOperations: [all[3] as string, all[0] as string],
        })[RESOURCE_AI_CLOUD_OPERATIONS_ENV],
      ).toBe(`${all[0]},${all[3]}`);
    }
  });

  test("names the required tag and the protected resources only when there are some", () => {
    const plain: Record<string, string> = environmentOf(AWS);
    const narrowed: Record<string, string> = environmentOf({
      ...AWS,
      requiredTag: ` ${CLOUD_AI_DEFAULT_REQUIRED_TAG} `,
      protectedTargets: [
        " arn:aws:rds:*:123456789012:db:prod-* ",
        "",
        "arn:aws:ecs:us-east-1:123456789012:service/prod/*",
        "arn:aws:rds:*:123456789012:db:prod-*",
      ],
    });

    expect(plain[RESOURCE_AI_CLOUD_REQUIRED_TAG_ENV]).toBeUndefined();
    expect(plain[RESOURCE_AI_PROTECTED_TARGETS_ENV]).toBeUndefined();
    expect(environmentOf({ ...AWS, requiredTag: null })).toEqual(plain);
    expect(environmentOf({ ...AWS, requiredTag: "  " })).toEqual(plain);
    expect(environmentOf({ ...AWS, protectedTargets: [" "] })).toEqual(plain);
    expect(narrowed[RESOURCE_AI_CLOUD_REQUIRED_TAG_ENV]).toBe(
      "oneuptime-ai=allow",
    );
    expect(narrowed[RESOURCE_AI_PROTECTED_TARGETS_ENV]).toBe(
      "arn:aws:rds:*:123456789012:db:prod-*,arn:aws:ecs:us-east-1:123456789012:service/prod/*",
    );
  });

  test("the key is the one secret, and the URL is written without the slashes it ended with", () => {
    for (const options of ALL_CLOUDS) {
      const environment: Array<CloudAiAgentEnvironmentVariable> =
        getCloudAiAgentEnvironment({
          ...options,
          oneuptimeUrl: " https://oneuptime.example.com:8443/// ",
          ingestionKey: ` ${KEY} `,
        });

      expect(
        environment.filter((variable: CloudAiAgentEnvironmentVariable) => {
          return variable.isSecret;
        }),
      ).toEqual([
        { name: CLOUD_AI_AGENT_INGESTION_KEY_ENV, value: KEY, isSecret: true },
      ]);
      expect(
        environment.find((variable: CloudAiAgentEnvironmentVariable) => {
          return variable.name === CLOUD_AI_AGENT_ONEUPTIME_URL_ENV;
        })?.value,
      ).toBe("https://oneuptime.example.com:8443");
      expect(
        new Set(
          environment.map((variable: CloudAiAgentEnvironmentVariable) => {
            return variable.name;
          }),
        ).size,
      ).toBe(environment.length);
    }
  });

  test("names the variables the agent reads: the shared constants, and the agent's own Config", () => {
    const config: string = fs.readFileSync(
      path.join(REPOSITORY_DIRECTORY, "agents/ResourceAIAgent/Config.ts"),
      "utf8",
    );

    expect(RESOURCE_AI_AGENT_API_KEY_ENVS).toContain(
      CLOUD_AI_AGENT_INGESTION_KEY_ENV,
    );
    expect(CLOUD_AI_AGENT_INGESTION_KEY_ENV).toBe(
      "ONEUPTIME_TELEMETRY_INGESTION_KEY",
    );
    expect(config).toContain(
      `export const ONEUPTIME_URL_ENV: string = "${CLOUD_AI_AGENT_ONEUPTIME_URL_ENV}";`,
    );
    expect(config).toContain(
      `export const HEALTH_HOST_ENV: string = "${CLOUD_AI_AGENT_HEALTH_HOST_ENV}";`,
    );
    expect(config).toContain(
      `export const PROTECTED_TARGETS_ENV: string = "${RESOURCE_AI_PROTECTED_TARGETS_ENV}";`,
    );
    expect(config).toContain('port: parsePort(env["PORT"])');
  });
});

// ---- AWS ------------------------------------------------------------------------

describe("AWS: the template", () => {
  test("creates exactly the named resources: the cluster, its log group, the roles, the security group, the task and the service", () => {
    const resources: Json = template(AWS).Resources;

    expect(
      Object.keys(resources).map((name: string): [string, string] => {
        return [name, resources[name].Type];
      }),
    ).toEqual([
      ["Cluster", "AWS::ECS::Cluster"],
      ["LogGroup", "AWS::Logs::LogGroup"],
      ["ExecutionRole", "AWS::IAM::Role"],
      ["TaskRole", "AWS::IAM::Role"],
      ["WriteRole", "AWS::IAM::Role"],
      ["SecurityGroup", "AWS::EC2::SecurityGroup"],
      ["TaskDefinition", "AWS::ECS::TaskDefinition"],
      ["Service", "AWS::ECS::Service"],
    ]);
    expect(resources.Cluster.Properties.ClusterName).toBe(
      AWS_CLOUD_AI_AGENT_CLUSTER_NAME,
    );
    expect(resources.LogGroup.Properties).toEqual({
      LogGroupName: AWS_CLOUD_AI_AGENT_LOG_GROUP_NAME,
      RetentionInDays: AWS_CLOUD_AI_AGENT_LOG_RETENTION_DAYS,
    });
    expect(AWS_CLOUD_AI_AGENT_LOG_RETENTION_DAYS).toBe(7);
    expect(resources.TaskRole.Properties.RoleName).toBe(
      AWS_CLOUD_AI_AGENT_TASK_ROLE_NAME,
    );
    expect(resources.WriteRole.Properties.RoleName).toBe(
      AWS_CLOUD_AI_AGENT_WRITE_ROLE_NAME,
    );
    expect(resources.Service.Properties.ServiceName).toBe(
      AWS_CLOUD_AI_AGENT_SERVICE_NAME,
    );
    expect(resources.TaskDefinition.Properties.Family).toBe(
      CLOUD_AI_AGENT_NAME,
    );
    // Container Insights costs money; the agent needs none of it.
    expect(resources.Cluster.Properties.ClusterSettings).toEqual([
      { Name: "containerInsights", Value: "disabled" },
    ]);
  });

  test("takes the VPC, the subnets and the key as parameters, the key never shown back", () => {
    expect(template(AWS).Parameters).toEqual({
      VpcId: expect.objectContaining({ Type: "AWS::EC2::VPC::Id" }),
      SubnetIds: expect.objectContaining({
        Type: "List<AWS::EC2::Subnet::Id>",
      }),
      IngestionKey: expect.objectContaining({
        Type: "String",
        NoEcho: true,
        MinLength: 1,
      }),
    });
    expect(getAwsCloudAiAgentTemplate(AWS)).not.toContain(KEY);
  });

  test("ECS pulls the image and writes the logs with a role of its own", () => {
    const role: Json = template(AWS).Resources.ExecutionRole.Properties;

    expect(role.AssumeRolePolicyDocument).toEqual({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: { Service: "ecs-tasks.amazonaws.com" },
          Action: "sts:AssumeRole",
        },
      ],
    });
    expect(role.ManagedPolicyArns).toEqual([
      {
        "Fn::Sub":
          "arn:${AWS::Partition}:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
      },
    ]);
    expect(role.Policies).toBeUndefined();
  });

  test("the task role is this account's ECS tasks' only, and may only assume the write role", () => {
    const role: Json = template(AWS).Resources.TaskRole.Properties;

    expect(role.AssumeRolePolicyDocument.Statement).toEqual([
      {
        Effect: "Allow",
        Principal: { Service: "ecs-tasks.amazonaws.com" },
        Action: "sts:AssumeRole",
        Condition: {
          ArnLike: {
            "aws:SourceArn": {
              "Fn::Sub":
                "arn:${AWS::Partition}:ecs:${AWS::Region}:${AWS::AccountId}:*",
            },
          },
          StringEquals: { "aws:SourceAccount": { Ref: "AWS::AccountId" } },
        },
      },
    ]);
    expect(role.ManagedPolicyArns).toBeUndefined();
    expect(role.Policies).toEqual([
      {
        PolicyName: "AssumeTheWriteRole",
        PolicyDocument: {
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Action: "sts:AssumeRole",
              Resource: {
                "Fn::Sub": `arn:\${AWS::Partition}:iam::\${AWS::AccountId}:role/${AWS_CLOUD_AI_AGENT_WRITE_ROLE_NAME}`,
              },
            },
          ],
        },
      },
    ]);
  });

  test("the write role trusts the task role alone, and holds exactly the permissions of the changes turned on", () => {
    const role: Json = template(AWS).Resources.WriteRole.Properties;
    const policy: Json = writePolicy(AWS);

    expect(role.AssumeRolePolicyDocument.Statement).toEqual([
      {
        Effect: "Allow",
        Principal: { AWS: { "Fn::GetAtt": ["TaskRole", "Arn"] } },
        Action: "sts:AssumeRole",
      },
    ]);
    expect(role.Policies).toHaveLength(1);
    expect(role.ManagedPolicyArns).toBeUndefined();
    expect(
      policy.Statement.filter((entry: Json): boolean => {
        return entry.Effect === "Allow";
      })
        .flatMap((entry: Json): Array<string> => {
          return entry.Action;
        })
        .sort(),
    ).toEqual(getCloudAiAgentRolePermissions(CloudProvider.AWS));

    for (const operations of [
      ["restart-service"],
      ["scale-out", "scale-in"],
      ["redrive-queue", "set-concurrency"],
    ]) {
      expect(
        writePolicy({ ...AWS, enabledOperations: operations })
          .Statement.filter((entry: Json): boolean => {
            return entry.Effect === "Allow";
          })
          .flatMap((entry: Json): Array<string> => {
            return entry.Action;
          })
          .sort(),
      ).toEqual(getCloudAiAgentRolePermissions(CloudProvider.AWS, operations));
    }
  });

  test("the reads go on everything; the changes too, unless a tag is required, then only on resources that carry it", () => {
    const open: Json = writePolicy(AWS);
    const tagged: Json = writePolicy({
      ...AWS,
      requiredTag: CLOUD_AI_DEFAULT_REQUIRED_TAG,
    });

    for (const policy of [open, tagged]) {
      const reads: Json = statement(policy, "ReadWhatAChangeReplaces");
      const changes: Json = statement(policy, "MakeTheChangesTurnedOn");

      expect(reads.Resource).toBe("*");
      expect(reads.Condition).toBeUndefined();
      expect(changes.Resource).toBe("*");
      expect(reads.Action.every(isAwsRead)).toBe(true);
      expect(changes.Action.some(isAwsRead)).toBe(false);
      expect(changes.Action).toEqual(
        expect.arrayContaining([
          "ecs:UpdateService",
          "autoscaling:SetDesiredCapacity",
          "ec2:StartInstances",
          // Reading a queue's messages moves them too: it needs the tag.
          "sqs:ReceiveMessage",
        ]),
      );
    }

    expect(statement(open, "MakeTheChangesTurnedOn").Condition).toBeUndefined();
    expect(statement(tagged, "MakeTheChangesTurnedOn").Condition).toEqual({
      StringEquals: { "aws:ResourceTag/oneuptime-ai": "allow" },
    });
    expect(
      statement(
        writePolicy({ ...AWS, requiredTag: "team:owner=sre@example.com" }),
        "MakeTheChangesTurnedOn",
      ).Condition,
    ).toEqual({
      StringEquals: { "aws:ResourceTag/team:owner": "sre@example.com" },
    });
  });

  test("whatever a session policy allows, the write role never changes the agent's own cluster or service", () => {
    expect(statement(writePolicy(AWS), "NeverChangeTheAgentItself")).toEqual({
      Sid: "NeverChangeTheAgentItself",
      Effect: "Deny",
      Action: "*",
      Resource: [
        {
          "Fn::Sub": `arn:\${AWS::Partition}:ecs:*:\${AWS::AccountId}:cluster/${AWS_CLOUD_AI_AGENT_CLUSTER_NAME}`,
        },
        {
          "Fn::Sub": `arn:\${AWS::Partition}:ecs:*:\${AWS::AccountId}:service/${AWS_CLOUD_AI_AGENT_CLUSTER_NAME}/*`,
        },
      ],
    });
    expect(writePolicy(AWS).Statement).toHaveLength(3);
  });

  test("the policy fits a role's inline policies with room to spare", () => {
    expect(
      JSON.stringify(
        writePolicy({ ...AWS, requiredTag: CLOUD_AI_DEFAULT_REQUIRED_TAG }),
      ).length,
    ).toBeLessThan(4000);
  });

  test("lets nothing in: a security group in the default VPC with no inbound rule", () => {
    const group: Json = template(AWS).Resources.SecurityGroup.Properties;

    expect(group.VpcId).toEqual({ Ref: "VpcId" });
    expect(group.SecurityGroupIngress).toBeUndefined();
    expect(group.SecurityGroupEgress).toEqual([
      expect.objectContaining({ IpProtocol: "-1", CidrIp: "0.0.0.0/0" }),
    ]);
    // The characters EC2 takes in a group's description.
    expect(group.GroupDescription).toMatch(
      /^[A-Za-z0-9 ._:/()#,@[\]+=&;{}$*-]+$/,
    );
  });

  test("runs one small Fargate task of the image, with the agent's environment and its logs in the log group", () => {
    const task: Json = template({ ...AWS, imageTag: "7.1.2" }).Resources
      .TaskDefinition.Properties;
    const container: Json = task.ContainerDefinitions[0];

    expect(task).toEqual(
      expect.objectContaining({
        RequiresCompatibilities: ["FARGATE"],
        NetworkMode: "awsvpc",
        Cpu: "256",
        Memory: "512",
        RuntimePlatform: {
          OperatingSystemFamily: "LINUX",
          CpuArchitecture: "X86_64",
        },
        ExecutionRoleArn: { "Fn::GetAtt": ["ExecutionRole", "Arn"] },
        TaskRoleArn: { "Fn::GetAtt": ["TaskRole", "Arn"] },
      }),
    );
    expect(task.ContainerDefinitions).toHaveLength(1);
    expect(container.Name).toBe(CLOUD_AI_AGENT_NAME);
    expect(container.Image).toBe(
      `docker.io/${RESOURCE_AI_AGENT_IMAGE_REPOSITORY}:7.1.2`,
    );
    expect(container.Essential).toBe(true);
    expect(container.PortMappings).toBeUndefined();
    expect(container.LogConfiguration).toEqual({
      LogDriver: "awslogs",
      Options: {
        "awslogs-group": { Ref: "LogGroup" },
        "awslogs-region": { Ref: "AWS::Region" },
        "awslogs-stream-prefix": "agent",
      },
    });
  });

  test("the task's environment is the agent's, with the key from its parameter and the write role's own ARN", () => {
    const options: CloudAiAgentSetupOptions = {
      ...AWS,
      fixesMode: "Automatic",
      enabledOperations: ["restart-service", "scale-out"],
      requiredTag: CLOUD_AI_DEFAULT_REQUIRED_TAG,
      protectedTargets: ["arn:aws:ecs:*:123456789012:service/prod/*"],
    };
    const container: Json =
      template(options).Resources.TaskDefinition.Properties
        .ContainerDefinitions[0];

    expect(container.Environment).toEqual(
      getCloudAiAgentEnvironment(options).map(
        (variable: CloudAiAgentEnvironmentVariable): Json => {
          if (variable.name === CLOUD_AI_AGENT_INGESTION_KEY_ENV) {
            return { Name: variable.name, Value: { Ref: "IngestionKey" } };
          }

          if (variable.name === RESOURCE_AI_AWS_WRITE_ROLE_ARN_ENV) {
            return {
              Name: variable.name,
              Value: { "Fn::GetAtt": ["WriteRole", "Arn"] },
            };
          }

          return { Name: variable.name, Value: variable.value };
        },
      ),
    );
  });

  test("one agent, always on, reaching out through a public IP in the default subnets", () => {
    const service: Json = template(AWS).Resources.Service.Properties;

    expect(service).toEqual({
      ServiceName: AWS_CLOUD_AI_AGENT_SERVICE_NAME,
      Cluster: { Ref: "Cluster" },
      TaskDefinition: { Ref: "TaskDefinition" },
      LaunchType: "FARGATE",
      DesiredCount: 1,
      DeploymentConfiguration: {
        MinimumHealthyPercent: 0,
        MaximumPercent: 100,
        DeploymentCircuitBreaker: { Enable: true, Rollback: true },
      },
      NetworkConfiguration: {
        AwsvpcConfiguration: {
          AssignPublicIp: "ENABLED",
          Subnets: { Ref: "SubnetIds" },
          SecurityGroups: [{ "Fn::GetAtt": ["SecurityGroup", "GroupId"] }],
        },
      },
    });
  });

  test("every reference names a resource or parameter of the template, and nothing refers to itself in a loop", () => {
    const body: Json = template(AWS);
    const known: Set<string> = new Set<string>([
      ...Object.keys(body.Resources),
      ...Object.keys(body.Parameters),
      "AWS::Region",
      "AWS::AccountId",
      "AWS::Partition",
    ]);
    const references: (value: Json) => Array<string> = (
      value: Json,
    ): Array<string> => {
      if (Array.isArray(value)) {
        return value.flatMap(references);
      }

      if (!value || typeof value !== "object") {
        return [];
      }

      const own: Array<string> = [];

      if (typeof value.Ref === "string") {
        own.push(value.Ref);
      }

      if (Array.isArray(value["Fn::GetAtt"])) {
        own.push(value["Fn::GetAtt"][0]);
      }

      return [...own, ...Object.values(value).flatMap(references)];
    };

    for (const name of Object.keys(body.Resources)) {
      for (const reference of references(body.Resources[name])) {
        expect({ name, reference, known: known.has(reference) }).toEqual({
          name,
          reference,
          known: true,
        });
      }
    }

    // The write role trusts the task role, so the task role names it by its ARN, not GetAtt.
    expect(references(body.Resources.TaskRole)).not.toContain("WriteRole");
    expect(references(body.Resources.WriteRole)).toContain("TaskRole");
  });
});

describe("AWS: the command", () => {
  test("reads top to bottom: the shell's account, the default VPC and subnets, the template, then the stack in the right account only", () => {
    const lines: Array<string> =
      getAwsCloudAiAgentSetupCommand(AWS).split("\n");

    expect(lines[0]).toBe(
      "ACCOUNT=$(aws sts get-caller-identity --query Account --output text)",
    );
    expect(lines[1]).toBe(
      'VPC=$(aws ec2 describe-vpcs --filters Name=is-default,Values=true --query "Vpcs[0].VpcId" --output text)',
    );
    expect(lines[2]).toBe(
      `SUBNETS=$(aws ec2 describe-subnets --filters Name=vpc-id,Values="$VPC" Name=default-for-az,Values=true --query "Subnets[].SubnetId" --output text | tr '\\t' ',')`,
    );
    expect(lines[3]).toBe(
      `cat > ${AWS_CLOUD_AI_AGENT_TEMPLATE_FILE} <<'TEMPLATE'`,
    );
    expect(JSON.parse(lines[4] as string)).toEqual(template(AWS));
    expect(lines[5]).toBe("TEMPLATE");
    expect(lines[6]).toBe(`if [ "$ACCOUNT" != ${AWS_ACCOUNT} ]; then`);
    expect(lines[8]).toBe(`elif [ "$VPC" = None ] || [ -z "$SUBNETS" ]; then`);
    expect(lines[10]).toBe("else");
    expect(lines[13]).toBe("fi");
    expect(lines).toHaveLength(14);
  });

  test("creates the stack or updates it - and does nothing when nothing changed - and says the agent is starting only when that worked", () => {
    const deploy: string = getAwsCloudAiAgentSetupCommand(AWS).split("\n")[12]!;

    expect(deploy).toBe(
      `  aws cloudformation deploy --stack-name ${AWS_CLOUD_AI_AGENT_STACK_NAME} --template-file ${AWS_CLOUD_AI_AGENT_TEMPLATE_FILE} --capabilities CAPABILITY_NAMED_IAM --no-fail-on-empty-changeset --parameter-overrides VpcId="$VPC" SubnetIds="$SUBNETS" IngestionKey=${KEY} && echo "${CLOUD_AI_AGENT_STARTED_MESSAGE}"`,
    );
  });

  test("a run in the account it was written for deploys the template it wrote, with the default VPC, its subnets and the key", () => {
    const shell: ShellRun = run(getAwsCloudAiAgentSetupCommand(AWS));
    const deploys: Array<Array<string>> = callsTo(
      shell,
      "aws",
      "cloudformation",
      "deploy",
    );

    expect(
      shell.calls.map((call: Array<string>): string => {
        return call.slice(0, 3).join(" ");
      }),
    ).toEqual([
      "aws sts get-caller-identity",
      "aws ec2 describe-vpcs",
      "aws ec2 describe-subnets",
      "aws cloudformation describe-stacks",
      "aws cloudformation deploy",
    ]);
    expect(deploys).toHaveLength(1);
    expect(flagWords(deploys[0]!, "--parameter-overrides")).toEqual([
      "VpcId=vpc-0123456789abcdef0",
      "SubnetIds=subnet-1,subnet-2,subnet-3",
      `IngestionKey=${KEY}`,
    ]);
    expect(flag(deploys[0]!, "--capabilities")).toBe("CAPABILITY_NAMED_IAM");
    expect(deploys[0]).toContain("--no-fail-on-empty-changeset");
    expect(flag(deploys[0]!, "--template-file")).toBe(
      AWS_CLOUD_AI_AGENT_TEMPLATE_FILE,
    );
    expect(JSON.parse(shell.template as string)).toEqual(template(AWS));
    expect(
      flag(callsTo(shell, "aws", "ec2", "describe-subnets")[0]!, "--filters"),
    ).toBe("Name=vpc-id,Values=vpc-0123456789abcdef0");
    expect(shell.output).toEqual([CLOUD_AI_AGENT_STARTED_MESSAGE]);
  });

  test("a shell signed in to another account makes nothing, and says where to run it", () => {
    const shell: ShellRun = run(getAwsCloudAiAgentSetupCommand(AWS), {
      account: "999999999999",
    });

    expect(callsTo(shell, "aws", "cloudformation")).toEqual([]);
    expect(shell.output).toEqual([
      `This command is for AWS account ${AWS_ACCOUNT}, and this shell is signed in to another one. Open CloudShell in AWS account ${AWS_ACCOUNT} and run the command there.`,
    ]);
  });

  test("a Region with no default VPC, or none of its default subnets, makes nothing and says so", () => {
    for (const scenario of [{ vpc: "None", subnets: "" }, { subnets: "" }]) {
      const shell: ShellRun = run(
        getAwsCloudAiAgentSetupCommand(AWS),
        scenario,
      );

      expect(callsTo(shell, "aws", "cloudformation")).toEqual([]);
      expect(shell.output).toHaveLength(1);
      expect(shell.output[0]).toContain("no default VPC");
    }
  });

  test("a first attempt that rolled back is deleted before the stack is made again", () => {
    const shell: ShellRun = run(getAwsCloudAiAgentSetupCommand(AWS), {
      stackStatus: "ROLLBACK_COMPLETE",
    });

    expect(
      callsTo(shell, "aws", "cloudformation").map(
        (call: Array<string>): string => {
          return call.slice(0, 4).join(" ");
        },
      ),
    ).toEqual([
      "aws cloudformation describe-stacks --stack-name",
      "aws cloudformation delete-stack --stack-name",
      "aws cloudformation wait stack-delete-complete",
      "aws cloudformation deploy --stack-name",
    ]);

    // A stack that is there and fine is updated in place.
    expect(
      callsTo(
        run(getAwsCloudAiAgentSetupCommand(AWS), {
          stackStatus: "UPDATE_COMPLETE",
        }),
        "aws",
        "cloudformation",
        "delete-stack",
      ),
    ).toEqual([]);
  });

  test("a failed deploy never says the agent is starting", () => {
    const shell: ShellRun = run(getAwsCloudAiAgentSetupCommand(AWS), {
      deployExit: 255,
    });

    expect(shell.output).not.toContain(CLOUD_AI_AGENT_STARTED_MESSAGE);
  });

  test("runs where the shell is unless a Region is given, then every regional call names it", () => {
    const command: string = getAwsCloudAiAgentSetupCommand({
      ...AWS,
      region: "eu-west-1",
    });
    const shell: ShellRun = run(command, { stackStatus: "ROLLBACK_COMPLETE" });

    expect(CLOUD_AI_AGENT_DEFAULT_REGIONS[CloudProvider.AWS]).toBeNull();
    expect(getAwsCloudAiAgentSetupCommand(AWS)).not.toContain("--region");

    for (const call of shell.calls) {
      if (call[1] === "sts") {
        expect(call).not.toContain("--region");
        continue;
      }

      expect({
        call: call.slice(0, 3),
        region: flag(call, "--region"),
      }).toEqual({ call: call.slice(0, 3), region: "eu-west-1" });
    }
  });
});

// ---- Azure ----------------------------------------------------------------------

describe("Azure: the role", () => {
  test("is the changes' actions on the one subscription, named for it", () => {
    const definition: AzureCloudAiAgentRoleDefinition =
      getAzureCloudAiAgentRoleDefinition({
        ...AZURE,
        enabledOperations: ["restart-service", "scale-out"],
      });

    expect(definition).toEqual({
      Name: `OneUptime AI Agent (${AZURE_SUBSCRIPTION})`,
      IsCustom: true,
      Description: expect.any(String),
      Actions: getCloudAiAgentRolePermissions(CloudProvider.Azure, [
        "restart-service",
        "scale-out",
      ]),
      NotActions: [],
      DataActions: [],
      NotDataActions: [],
      AssignableScopes: [`/subscriptions/${AZURE_SUBSCRIPTION}`],
    });
  });

  test("a custom role's name is the whole tenant's, so each subscription's has its own", () => {
    expect(getAzureCloudAiAgentRoleName(AZURE_SUBSCRIPTION)).toBe(
      `${AZURE_CLOUD_AI_AGENT_ROLE_NAME} (${AZURE_SUBSCRIPTION})`,
    );
    expect(
      getAzureCloudAiAgentRoleName(` ${AZURE_SUBSCRIPTION.toUpperCase()} `),
    ).toBe(getAzureCloudAiAgentRoleName(AZURE_SUBSCRIPTION));
    expect(
      getAzureCloudAiAgentRoleName("11111111-2222-4333-8444-555555555555"),
    ).not.toBe(getAzureCloudAiAgentRoleName(AZURE_SUBSCRIPTION));
  });

  test("has no tag condition: Azure has none for these actions, so the agent checks the tag", () => {
    const command: string = getAzureCloudAiAgentSetupCommand({
      ...AZURE,
      requiredTag: CLOUD_AI_DEFAULT_REQUIRED_TAG,
    });

    expect(command).not.toContain("Condition");
    expect(command).not.toContain("ResourceTag");
    expect(
      environmentOf({ ...AZURE, requiredTag: CLOUD_AI_DEFAULT_REQUIRED_TAG })[
        RESOURCE_AI_CLOUD_REQUIRED_TAG_ENV
      ],
    ).toBe(CLOUD_AI_DEFAULT_REQUIRED_TAG);
  });
});

describe("Azure: the command", () => {
  test("works in the subscription it was written for: every call but the extension's names it", () => {
    const command: string = getAzureCloudAiAgentSetupCommand(AZURE);
    const lines: Array<string> = command.split("\n");

    expect(lines[0]).toBe(`SUBSCRIPTION=${AZURE_SUBSCRIPTION}`);

    for (const call of run(command).calls) {
      if (call[1] === "extension") {
        expect(call).toEqual([
          "az",
          "extension",
          "add",
          "--name",
          "containerapp",
          "--upgrade",
          "-y",
          "--only-show-errors",
        ]);
        continue;
      }

      expect({
        call: call.slice(0, 3),
        subscription: flag(call, "--subscription"),
      }).toEqual({ call: call.slice(0, 3), subscription: AZURE_SUBSCRIPTION });
    }
  });

  test("a first run makes the role, the group, the environment and the app, and gives the app's identity the role", () => {
    const shell: ShellRun = run(getAzureCloudAiAgentSetupCommand(AZURE));

    expect(
      shell.calls.map((call: Array<string>): string => {
        return call.slice(0, 4).join(" ");
      }),
    ).toEqual([
      "az extension add --name",
      "az role definition create",
      "az provider register --subscription",
      "az group show --subscription",
      "az group create --subscription",
      "az containerapp env show",
      "az containerapp env create",
      "az containerapp create --subscription",
      "az containerapp show --subscription",
      "az role assignment create",
    ]);

    const definition: Json = JSON.parse(
      flag(
        callsTo(shell, "az", "role", "definition")[0]!,
        "--role-definition",
      )!,
    );
    const assignment: Array<string> = callsTo(
      shell,
      "az",
      "role",
      "assignment",
    )[0]!;

    expect(definition).toEqual(getAzureCloudAiAgentRoleDefinition(AZURE));
    expect(flag(assignment, "--assignee-object-id")).toBe(PRINCIPAL);
    expect(flag(assignment, "--assignee-principal-type")).toBe(
      "ServicePrincipal",
    );
    expect(flag(assignment, "--role")).toBe(ROLE_ID);
    expect(flag(assignment, "--scope")).toBe(
      `/subscriptions/${AZURE_SUBSCRIPTION}`,
    );
    expect(flag(callsTo(shell, "az", "group", "create")[0]!, "--name")).toBe(
      AZURE_CLOUD_AI_AGENT_RESOURCE_GROUP,
    );
    expect(
      flag(callsTo(shell, "az", "containerapp", "env", "create")[0]!, "--name"),
    ).toBe(AZURE_CLOUD_AI_AGENT_ENVIRONMENT_NAME);
    expect(
      flag(
        callsTo(shell, "az", "containerapp", "env", "create")[0]!,
        "--logs-destination",
      ),
    ).toBe("none");
    expect(
      flag(callsTo(shell, "az", "provider", "register")[0]!, "--namespace"),
    ).toBe("Microsoft.App");
    expect(shell.output).toEqual([CLOUD_AI_AGENT_STARTED_MESSAGE]);
  });

  test("the app: one replica of the image, always on, with a system identity, the key as a secret and the agent's variables", () => {
    const options: CloudAiAgentSetupOptions = {
      ...AZURE,
      fixesMode: "BypassApproval",
      enabledOperations: ["restart-service"],
      protectedTargets: [
        `/subscriptions/${AZURE_SUBSCRIPTION}/resourcegroups/prod/*`,
      ],
    };
    const app: Array<string> = callsTo(
      run(getAzureCloudAiAgentSetupCommand(options)),
      "az",
      "containerapp",
      "create",
    )[0]!;

    expect(flag(app, "--name")).toBe(AZURE_CLOUD_AI_AGENT_APP_NAME);
    expect(flag(app, "--resource-group")).toBe(
      AZURE_CLOUD_AI_AGENT_RESOURCE_GROUP,
    );
    expect(flag(app, "--environment")).toBe(
      AZURE_CLOUD_AI_AGENT_ENVIRONMENT_NAME,
    );
    expect(flag(app, "--image")).toBe(getCloudAiAgentImage());
    expect(flag(app, "--cpu")).toBe("0.25");
    expect(flag(app, "--memory")).toBe("0.5Gi");
    expect(flag(app, "--min-replicas")).toBe("1");
    expect(flag(app, "--max-replicas")).toBe("1");
    expect(app).toContain("--system-assigned");
    // Nothing comes in: the agent asks OneUptime for its work.
    expect(app).not.toContain("--ingress");
    expect(app).not.toContain("--target-port");
    expect(flagWords(app, "--secrets")).toEqual([
      `${AZURE_CLOUD_AI_AGENT_SECRET_NAME}=${KEY}`,
    ]);
    expect(flagWords(app, "--env-vars")).toEqual(
      getCloudAiAgentEnvironment(options).map(
        (variable: CloudAiAgentEnvironmentVariable): string => {
          return variable.isSecret
            ? `${variable.name}=secretref:${AZURE_CLOUD_AI_AGENT_SECRET_NAME}`
            : `${variable.name}=${variable.value}`;
        },
      ),
    );
  });

  test("running it again updates the role, keeps the group and the environment, and writes the app whole again", () => {
    const first: ShellRun = run(getAzureCloudAiAgentSetupCommand(AZURE));
    const again: ShellRun = run(getAzureCloudAiAgentSetupCommand(AZURE), {
      exists: true,
    });

    expect(
      again.calls.map((call: Array<string>): string => {
        return call.slice(0, 4).join(" ");
      }),
    ).toEqual([
      "az extension add --name",
      "az role definition create",
      "az role definition update",
      "az provider register --subscription",
      "az group show --subscription",
      "az containerapp env show",
      "az containerapp create --subscription",
      "az containerapp show --subscription",
      "az role assignment create",
    ]);
    expect(
      flag(
        callsTo(again, "az", "role", "definition", "update")[0]!,
        "--role-definition",
      ),
    ).toBe(
      flag(
        callsTo(first, "az", "role", "definition", "create")[0]!,
        "--role-definition",
      ),
    );
    expect(callsTo(again, "az", "containerapp", "create")).toEqual(
      callsTo(first, "az", "containerapp", "create"),
    );
    expect(again.output).toEqual([CLOUD_AI_AGENT_STARTED_MESSAGE]);
  });

  test("turning a change off and running it again takes its actions out of the role", () => {
    const definition: (operations: Array<string>) => Json = (
      operations: Array<string>,
    ): Json => {
      return JSON.parse(
        flag(
          callsTo(
            run(
              getAzureCloudAiAgentSetupCommand({
                ...AZURE,
                enabledOperations: operations,
              }),
            ),
            "az",
            "role",
            "definition",
          )[0]!,
          "--role-definition",
        )!,
      );
    };

    expect(definition(["restart-service", "stop-instance"]).Actions).toContain(
      "Microsoft.Compute/virtualMachines/deallocate/action",
    );
    expect(definition(["restart-service"]).Actions).not.toContain(
      "Microsoft.Compute/virtualMachines/deallocate/action",
    );
    expect(definition(["restart-service"]).Actions).toEqual(
      getCloudAiAgentRolePermissions(CloudProvider.Azure, ["restart-service"]),
    );
  });

  test("runs in East US unless a region is given", () => {
    expect(CLOUD_AI_AGENT_DEFAULT_REGIONS[CloudProvider.Azure]).toBe("eastus");

    for (const [region, expected] of [
      [undefined, "eastus"],
      ["westeurope", "westeurope"],
    ] as Array<[string | undefined, string]>) {
      const shell: ShellRun = run(
        getAzureCloudAiAgentSetupCommand({ ...AZURE, region }),
      );

      expect(
        flag(callsTo(shell, "az", "group", "create")[0]!, "--location"),
      ).toBe(expected);
      expect(
        flag(
          callsTo(shell, "az", "containerapp", "env", "create")[0]!,
          "--location",
        ),
      ).toBe(expected);
    }
  });

  test("an app that could not be written gets no role and never says the agent is starting", () => {
    const shell: ShellRun = run(getAzureCloudAiAgentSetupCommand(AZURE), {
      deployExit: 1,
    });

    expect(callsTo(shell, "az", "containerapp", "create")).toHaveLength(1);
    expect(callsTo(shell, "az", "containerapp", "show")).toEqual([]);
    expect(callsTo(shell, "az", "role", "assignment")).toEqual([]);
    expect(shell.output).toEqual([]);
  });
});

// ---- Google Cloud ---------------------------------------------------------------

describe("Google Cloud: the APIs", () => {
  test("Cloud Run, IAM and Resource Manager always, and the changes' own", () => {
    expect(getGcpCloudAiAgentServices()).toEqual([
      "run.googleapis.com",
      "iam.googleapis.com",
      "cloudresourcemanager.googleapis.com",
      "sqladmin.googleapis.com",
      "compute.googleapis.com",
    ]);
    expect(getGcpCloudAiAgentServices(["roll-back-service"])).toEqual([
      "run.googleapis.com",
      "iam.googleapis.com",
      "cloudresourcemanager.googleapis.com",
    ]);
    expect(getGcpCloudAiAgentServices(["start-instance"])).toEqual([
      "run.googleapis.com",
      "iam.googleapis.com",
      "cloudresourcemanager.googleapis.com",
      "compute.googleapis.com",
    ]);
    expect(getGcpCloudAiAgentServices(["fail-over-database"])).toEqual([
      "run.googleapis.com",
      "iam.googleapis.com",
      "cloudresourcemanager.googleapis.com",
      "sqladmin.googleapis.com",
    ]);
  });

  test("every permission of every change is a service whose API is turned on", () => {
    const services: Array<string> = getGcpCloudAiAgentServices();

    for (const permission of getCloudAiAgentRolePermissions(
      CloudProvider.GCP,
    )) {
      const service: string = permission.substring(0, permission.indexOf("."));

      expect(services).toContain(
        service === "cloudsql"
          ? "sqladmin.googleapis.com"
          : `${service}.googleapis.com`,
      );
    }
  });
});

describe("Google Cloud: the command", () => {
  test("works in the project it was written for: every call names it", () => {
    const command: string = getGcpCloudAiAgentSetupCommand(GCP);

    expect(command.split("\n")[0]).toBe(`PROJECT_ID=${GCP_PROJECT}`);

    for (const call of run(command).calls) {
      expect(
        flag(call, "--project") === GCP_PROJECT ||
          (call[1] === "projects" && call[3] === GCP_PROJECT),
      ).toBe(true);
    }
  });

  test("a first run turns on the APIs, makes the role, the service account and its binding, then deploys the service", () => {
    const shell: ShellRun = run(getGcpCloudAiAgentSetupCommand(GCP));
    const role: Array<string> = callsTo(
      shell,
      "gcloud",
      "iam",
      "roles",
      "create",
    )[0]!;
    const binding: Array<string> = callsTo(
      shell,
      "gcloud",
      "projects",
      "add-iam-policy-binding",
    )[0]!;

    expect(
      shell.calls.map((call: Array<string>): string => {
        return call.slice(0, 4).join(" ");
      }),
    ).toEqual([
      "gcloud services enable run.googleapis.com",
      "gcloud iam roles create",
      "gcloud iam service-accounts create",
      `gcloud projects add-iam-policy-binding ${GCP_PROJECT}`,
      `gcloud run deploy ${GCP_CLOUD_AI_AGENT_SERVICE_NAME}`,
    ]);
    expect(role[4]).toBe(GCP_CLOUD_AI_AGENT_ROLE_ID);
    expect(
      callsTo(shell, "gcloud", "iam", "service-accounts", "create")[0]![4],
    ).toBe(GCP_CLOUD_AI_AGENT_SERVICE_ACCOUNT_ID);
    expect(shell.calls[0]!.slice(3, -2)).toEqual(getGcpCloudAiAgentServices());
    expect(flag(role, "--permissions")).toBe(
      getCloudAiAgentRolePermissions(CloudProvider.GCP).join(","),
    );
    expect(flag(role, "--stage")).toBe("GA");
    expect(flag(binding, "--member")).toBe(
      `serviceAccount:${GCP_CLOUD_AI_AGENT_SERVICE_ACCOUNT_ID}@${GCP_PROJECT}.iam.gserviceaccount.com`,
    );
    expect(flag(binding, "--role")).toBe(
      `projects/${GCP_PROJECT}/roles/${GCP_CLOUD_AI_AGENT_ROLE_ID}`,
    );
    expect(binding).toContain("--condition=None");
    expect(shell.output).toEqual([CLOUD_AI_AGENT_STARTED_MESSAGE]);
  });

  test("the service: CPU always allocated on one instance of the image, never reachable from outside, as the agent's service account", () => {
    const deploy: Array<string> = callsTo(
      run(getGcpCloudAiAgentSetupCommand({ ...GCP, imageTag: "7.1.2" })),
      "gcloud",
      "run",
      "deploy",
    )[0]!;

    expect(flag(deploy, "--image")).toBe(
      `docker.io/${RESOURCE_AI_AGENT_IMAGE_REPOSITORY}:7.1.2`,
    );
    expect(flag(deploy, "--region")).toBe("us-central1");
    expect(flag(deploy, "--service-account")).toBe(
      `${GCP_CLOUD_AI_AGENT_SERVICE_ACCOUNT_ID}@${GCP_PROJECT}.iam.gserviceaccount.com`,
    );
    expect(deploy).toContain("--no-cpu-throttling");
    expect(flag(deploy, "--min-instances")).toBe("1");
    expect(flag(deploy, "--max-instances")).toBe("1");
    // CPU stays allocated only for a whole vCPU or more.
    expect(flag(deploy, "--cpu")).toBe("1");
    expect(flag(deploy, "--memory")).toBe("512Mi");
    expect(deploy).toContain("--no-allow-unauthenticated");
    expect(flag(deploy, "--ingress")).toBe("internal");
    expect(flag(deploy, "--port")).toBe(
      String(RESOURCE_AI_AGENT_DEFAULT_HEALTH_PORT),
    );
    expect(flag(deploy, "--env-vars-file")).toBe(GCP_CLOUD_AI_AGENT_ENV_FILE);
    expect(deploy).not.toContain("--set-env-vars");
    expect(deploy).toContain("--quiet");
  });

  test("the variables reach Cloud Run exactly through a file the shell does not expand, removed after the deploy", () => {
    const options: CloudAiAgentSetupOptions = {
      ...GCP,
      fixesMode: "Automatic",
      enabledOperations: ["scale-out", "start-instance"],
      requiredTag: CLOUD_AI_DEFAULT_REQUIRED_TAG,
      protectedTargets: [
        `//run.googleapis.com/projects/${GCP_PROJECT}/locations/*/services/payments`,
      ],
    };
    const command: string = getGcpCloudAiAgentSetupCommand(options);

    for (const deployExit of [0, 1]) {
      const shell: ShellRun = run(command, { deployExit });

      expect(yaml.load(shell.envFile as string)).toEqual(
        environmentOf(options),
      );
      expect(shell.files).toEqual([]);
      expect(shell.output.includes(CLOUD_AI_AGENT_STARTED_MESSAGE)).toBe(
        deployExit === 0,
      );
    }

    // The key is in the file, never on a command line.
    expect(
      shellLines(command).filter((line: string): boolean => {
        return line.includes(KEY);
      }),
    ).toEqual([]);
    expect(
      heredocBody(command, `cat > ${GCP_CLOUD_AI_AGENT_ENV_FILE} <<'ENV'`),
    ).toContain(`${CLOUD_AI_AGENT_INGESTION_KEY_ENV}: "${KEY}"`);
  });

  test("running it again updates the role to exactly these permissions and moves the service to a new revision", () => {
    const first: ShellRun = run(getGcpCloudAiAgentSetupCommand(GCP));
    const again: ShellRun = run(
      getGcpCloudAiAgentSetupCommand({
        ...GCP,
        enabledOperations: ["start-instance"],
      }),
      { exists: true },
    );
    const update: Array<string> = callsTo(
      again,
      "gcloud",
      "iam",
      "roles",
      "update",
    )[0]!;

    expect(callsTo(first, "gcloud", "iam", "roles", "update")).toEqual([]);
    expect(update.slice(4)).toEqual(
      callsTo(again, "gcloud", "iam", "roles", "create")[0]!.slice(4),
    );
    expect(flag(update, "--permissions")).toBe(
      "compute.instances.get,compute.instances.start,compute.regionOperations.get,compute.zoneOperations.get",
    );
    expect(callsTo(again, "gcloud", "run", "deploy")).toHaveLength(1);
    expect(again.output).toEqual([CLOUD_AI_AGENT_STARTED_MESSAGE]);
  });

  test("runs in us-central1 unless a region is given", () => {
    expect(CLOUD_AI_AGENT_DEFAULT_REGIONS[CloudProvider.GCP]).toBe(
      "us-central1",
    );
    expect(
      flag(
        callsTo(
          run(
            getGcpCloudAiAgentSetupCommand({ ...GCP, region: "europe-west4" }),
          ),
          "gcloud",
          "run",
          "deploy",
        )[0]!,
        "--region",
      ),
    ).toBe("europe-west4");
  });

  test("has no tag condition: the agent checks the label", () => {
    const command: string = getGcpCloudAiAgentSetupCommand({
      ...GCP,
      requiredTag: CLOUD_AI_DEFAULT_REQUIRED_TAG,
    });

    expect(command).not.toContain("--condition=resource");
    expect(command).not.toContain("expression");
  });
});

// ---- The names the commands create, and the agent protects ----------------------

describe("the names", () => {
  test("what each command creates is what the agent protects", () => {
    const protects: (
      provider: "aws" | "azure" | "gcp",
      accountId: string,
      target: string,
    ) => boolean = (
      provider: "aws" | "azure" | "gcp",
      accountId: string,
      target: string,
    ): boolean => {
      return getCloudAiAgentOwnTargets({ provider, accountId }).some(
        (pattern: string): boolean => {
          return globMatchesTarget(pattern, target);
        },
      );
    };

    expect(
      protects(
        "aws",
        AWS_ACCOUNT,
        `arn:aws:ecs:us-east-1:${AWS_ACCOUNT}:service/${AWS_CLOUD_AI_AGENT_CLUSTER_NAME}/${AWS_CLOUD_AI_AGENT_SERVICE_NAME}`,
      ),
    ).toBe(true);
    expect(
      protects(
        "azure",
        AZURE_SUBSCRIPTION,
        `/subscriptions/${AZURE_SUBSCRIPTION}/resourcegroups/${AZURE_CLOUD_AI_AGENT_RESOURCE_GROUP}/providers/microsoft.app/containerapps/${AZURE_CLOUD_AI_AGENT_APP_NAME}`,
      ),
    ).toBe(true);
    expect(
      protects(
        "gcp",
        GCP_PROJECT,
        `//run.googleapis.com/projects/${GCP_PROJECT}/locations/${CLOUD_AI_AGENT_DEFAULT_REGIONS[CloudProvider.GCP]}/services/${GCP_CLOUD_AI_AGENT_SERVICE_NAME}`,
      ),
    ).toBe(true);
  });

  test("the commands use the shared names and no others of their own", () => {
    const aws: string = getAwsCloudAiAgentSetupCommand(AWS);
    const azure: string = getAzureCloudAiAgentSetupCommand(AZURE);
    const gcp: string = getGcpCloudAiAgentSetupCommand(GCP);

    expect(aws).toContain(`--stack-name ${AWS_CLOUD_AI_AGENT_STACK_NAME} `);
    expect(azure).toContain(`--name ${AZURE_CLOUD_AI_AGENT_APP_NAME} `);
    expect(azure).toContain(
      `--resource-group ${AZURE_CLOUD_AI_AGENT_RESOURCE_GROUP}`,
    );
    expect(azure).toContain(`--name ${AZURE_CLOUD_AI_AGENT_ENVIRONMENT_NAME} `);
    expect(gcp).toContain(
      `gcloud iam roles create ${GCP_CLOUD_AI_AGENT_ROLE_ID} `,
    );
    expect(gcp).toContain(
      `gcloud iam service-accounts create ${GCP_CLOUD_AI_AGENT_SERVICE_ACCOUNT_ID} `,
    );
    expect(gcp).toContain(
      `gcloud run deploy ${GCP_CLOUD_AI_AGENT_SERVICE_NAME} `,
    );
    expect(getCloudAiAgentImage()).toBe(
      `docker.io/${RESOURCE_AI_AGENT_IMAGE_REPOSITORY}:${CLOUD_AI_AGENT_IMAGE_TAG}`,
    );
    expect(CLOUD_AI_AGENT_IMAGE_TAG).toBe("release");
  });

  test("each cloud's command is the dispatcher's for it", () => {
    expect(getCloudAiAgentSetupCommand(AWS)).toBe(
      getAwsCloudAiAgentSetupCommand(AWS),
    );
    expect(getCloudAiAgentSetupCommand(AZURE)).toBe(
      getAzureCloudAiAgentSetupCommand(AZURE),
    );
    expect(getCloudAiAgentSetupCommand(GCP)).toBe(
      getGcpCloudAiAgentSetupCommand(GCP),
    );
  });

  test("the sizes are the ones the commands ask for", () => {
    expect(CLOUD_AI_AGENT_SIZES).toEqual({
      [CloudProvider.AWS]: { vcpu: 0.25, memoryGiB: 0.5 },
      [CloudProvider.Azure]: { vcpu: 0.25, memoryGiB: 0.5 },
      [CloudProvider.GCP]: { vcpu: 1, memoryGiB: 0.5 },
    });
  });
});

// ---- Checks and quoting ---------------------------------------------------------

describe("what the options are checked for", () => {
  test.each(ALL_CLOUDS)(
    "$provider's usual options have no problem, with or without the extras",
    (options: CloudAiAgentSetupOptions) => {
      expect(describeCloudAiAgentSetupProblem(options)).toBeNull();
      expect(
        describeCloudAiAgentSetupProblem({
          ...options,
          oneuptimeUrl: "http://10.0.0.5:8080/oneuptime/",
          fixesMode: "BypassApproval",
          enabledOperations: ["scale-out"],
          protectedTargets: ["*prod*"],
          requiredTag: CLOUD_AI_DEFAULT_REQUIRED_TAG,
          imageTag: "7.1.2",
        }),
      ).toBeNull();
    },
  );

  const refused: Array<[string, Partial<CloudAiAgentSetupOptions>]> = [
    ["a cloud it does not know", { provider: "ibm" as CloudProvider }],
    ["no URL", { oneuptimeUrl: "" }],
    ["a URL without a scheme", { oneuptimeUrl: "oneuptime.com" }],
    ["an ftp URL", { oneuptimeUrl: "ftp://oneuptime.com" }],
    ["a javascript: URL", { oneuptimeUrl: "javascript:alert(1)" }],
    ["a URL with a space", { oneuptimeUrl: "https://one uptime.com" }],
    ["a URL with a line break", { oneuptimeUrl: "https://oneuptime.com\nrm" }],
    ["a URL with a double quote", { oneuptimeUrl: 'https://oneuptime.com/"x' }],
    ["a URL with a backtick", { oneuptimeUrl: "https://oneuptime.com/`id`" }],
    ["a URL with a !", { oneuptimeUrl: "https://oneuptime.com/!!" }],
    ["a URL with a <", { oneuptimeUrl: "https://oneuptime.com/<x>" }],
    ["no key", { ingestionKey: " " }],
    ["a key with a space", { ingestionKey: "abc def" }],
    ["a key with a line break", { ingestionKey: "abc\ndef" }],
    ["a key with a quote", { ingestionKey: "abc'def" }],
    ["a key with $(...)", { ingestionKey: "$(reboot)" }],
    ["a key with a backtick", { ingestionKey: "`id`" }],
    ["a key too long", { ingestionKey: "a".repeat(257) }],
    ["a OneUptime id that is not one", { cloudAccountId: "account-1" }],
    ["fixes off", { fixesMode: "Disabled" as CloudAiAgentFixesMode }],
    [
      "a fixes mode it does not know",
      { fixesMode: "Yolo" as CloudAiAgentFixesMode },
    ],
    ["no change turned on", { enabledOperations: [] }],
    ["a change it does not know", { enabledOperations: ["delete-everything"] }],
    ["a read", { enabledOperations: ["read-logs"] }],
    ["an alias", { enabledOperations: ["failover-database"] }],
    ["a protected resource with a comma", { protectedTargets: ["a,b"] }],
    ["a protected resource with a space", { protectedTargets: ["prod db"] }],
    ["a protected resource with a quote", { protectedTargets: ["prod'"] }],
    ["a protected resource with a line break", { protectedTargets: ["a\nb"] }],
    ["a protected resource with a backtick", { protectedTargets: ["`id`"] }],
    [
      "a protected resource too long",
      { protectedTargets: ["a".repeat(MAX_POSTURE_STRING_LENGTH + 1)] },
    ],
    ["a tag without a value", { requiredTag: "oneuptime-ai" }],
    ["a tag with an empty key", { requiredTag: "=allow" }],
    ["a tag with an empty value", { requiredTag: "oneuptime-ai=" }],
    ["a tag with a space", { requiredTag: "oneuptime ai=allow" }],
    ["a tag with a quote", { requiredTag: "oneuptime-ai='allow'" }],
    ["a tag with $(...)", { requiredTag: "oneuptime-ai=$(id)" }],
    ["a tag with a line break", { requiredTag: "oneuptime-ai=allow\nx=y" }],
    ["an image tag with a slash", { imageTag: "release/../x" }],
    ["an image tag with a space", { imageTag: "re lease" }],
  ];

  test.each(ALL_CLOUDS)(
    "$provider refuses every value it cannot write, in words, and writes nothing from it",
    (options: CloudAiAgentSetupOptions) => {
      for (const [what, change] of refused) {
        const bad: CloudAiAgentSetupOptions = { ...options, ...change };
        const problem: string | null = describeCloudAiAgentSetupProblem(bad);

        expect({ what, refused: typeof problem === "string" }).toEqual({
          what,
          refused: true,
        });
        expect((problem as string).length).toBeGreaterThan(10);

        for (const write of [
          getCloudAiAgentSetupCommand,
          getCloudAiAgentEnvironment,
        ]) {
          expect(() => {
            return write(bad);
          }).toThrow(problem as string);
          expect(() => {
            return write(bad);
          }).toThrow(BadDataException);
        }
      }
    },
  );

  test("each cloud's own account ids, regions and changes", () => {
    const problems: Array<[CloudAiAgentSetupOptions, boolean]> = [
      [{ ...AWS, accountId: "12345678901" }, true],
      [{ ...AWS, accountId: AZURE_SUBSCRIPTION }, true],
      [{ ...AZURE, accountId: AWS_ACCOUNT }, true],
      [{ ...AZURE, accountId: AZURE_SUBSCRIPTION.toUpperCase() }, false],
      [{ ...GCP, accountId: "My-Project" }, true],
      [{ ...GCP, accountId: "p" }, true],
      [{ ...AWS, region: "us-east-1" }, false],
      [{ ...AWS, region: "us-gov-west-1" }, false],
      [{ ...AWS, region: "eastus" }, true],
      [{ ...AWS, region: "us-east-1; reboot" }, true],
      [{ ...AZURE, region: "westeurope" }, false],
      [{ ...AZURE, region: "West Europe" }, true],
      [{ ...GCP, region: "europe-west4" }, false],
      [{ ...GCP, region: "us-east-1" }, true],
      [{ ...AZURE, enabledOperations: ["redrive-queue"] }, true],
      [{ ...GCP, enabledOperations: ["restart-service"] }, true],
      [{ ...AWS, enabledOperations: ["redrive-queue"] }, false],
      // AWS keeps tags that start with aws: for itself.
      [{ ...AWS, requiredTag: "aws:team=sre" }, true],
      [{ ...AZURE, requiredTag: "aws:team=sre" }, false],
      // Google Cloud labels are lowercase: no resource could carry these.
      [{ ...GCP, requiredTag: "Team=SRE" }, true],
      [{ ...GCP, requiredTag: "team:owner=sre" }, true],
      [{ ...AWS, requiredTag: "Team=SRE" }, false],
      [{ ...AZURE, requiredTag: "team/owner=sre" }, true],
    ];

    for (const [options, isProblem] of problems) {
      expect({
        options,
        problem: describeCloudAiAgentSetupProblem(options) !== null,
      }).toEqual({ options, problem: isProblem });
    }
  });

  test("takes as many protected resources as the agent can report beside its own, and no more", () => {
    for (const options of ALL_CLOUDS) {
      const most: number =
        MAX_POSTURE_LIST_ENTRIES -
        getCloudAiAgentOwnTargets({
          provider: options.provider as "aws" | "azure" | "gcp",
          accountId: options.accountId,
        }).length;
      const patterns: (count: number) => Array<string> = (
        count: number,
      ): Array<string> => {
        return Array.from({ length: count }, (_: unknown, index: number) => {
          return `*-${index}`;
        });
      };

      expect(
        describeCloudAiAgentSetupProblem({
          ...options,
          protectedTargets: patterns(most),
        }),
      ).toBeNull();
      expect(
        describeCloudAiAgentSetupProblem({
          ...options,
          protectedTargets: patterns(most + 1),
        }),
      ).toContain(`at most ${most}`);
    }
  });

  test("a cloud's own writer takes only that cloud's options", () => {
    expect(() => {
      return getAwsCloudAiAgentSetupCommand(AZURE);
    }).toThrow(BadDataException);
    expect(() => {
      return getAzureCloudAiAgentSetupCommand(GCP);
    }).toThrow("These options are for Google Cloud, not Azure.");
    expect(() => {
      return getGcpCloudAiAgentSetupCommand(AWS);
    }).toThrow(BadDataException);
    expect(() => {
      return getAwsCloudAiAgentTemplate(GCP);
    }).toThrow(BadDataException);
    expect(() => {
      return getAzureCloudAiAgentRoleDefinition(AWS);
    }).toThrow(BadDataException);
  });
});

describe("quoting", () => {
  // Values every check lets through that a shell would read if they were not quoted.
  const HOSTILE: Partial<CloudAiAgentSetupOptions> = {
    oneuptimeUrl: "https://oneuptime.example.com/a'b/$(id)/c;d&e*f?g=h#i",
    ingestionKey: "key+/=:~._-without-spaces",
    protectedTargets: [
      "arn:aws:lambda:us-east-1:123456789012:function:f:$LATEST",
      "$(reboot)*",
      "rg(prod)*",
    ],
  };

  test.each(ALL_CLOUDS)(
    "on $provider, the values reach the cloud exactly as given",
    (options: CloudAiAgentSetupOptions) => {
      const hostile: CloudAiAgentSetupOptions = { ...options, ...HOSTILE };
      const expected: Record<string, string> = environmentOf(hostile);
      const shell: ShellRun = run(getCloudAiAgentSetupCommand(hostile));

      expect(expected[CLOUD_AI_AGENT_ONEUPTIME_URL_ENV]).toBe(
        HOSTILE.oneuptimeUrl,
      );

      if (options.provider === CloudProvider.AWS) {
        const environment: Record<string, Json> = {};

        for (const entry of JSON.parse(shell.template as string).Resources
          .TaskDefinition.Properties.ContainerDefinitions[0].Environment) {
          environment[entry.Name] = entry.Value;
        }

        expect(environment[CLOUD_AI_AGENT_ONEUPTIME_URL_ENV]).toBe(
          HOSTILE.oneuptimeUrl,
        );
        expect(environment[RESOURCE_AI_PROTECTED_TARGETS_ENV]).toBe(
          expected[RESOURCE_AI_PROTECTED_TARGETS_ENV],
        );
        expect(
          flagWords(
            callsTo(shell, "aws", "cloudformation", "deploy")[0]!,
            "--parameter-overrides",
          ),
        ).toContain(`IngestionKey=${HOSTILE.ingestionKey}`);
      }

      if (options.provider === CloudProvider.Azure) {
        const app: Array<string> = callsTo(
          shell,
          "az",
          "containerapp",
          "create",
        )[0]!;

        expect(flagWords(app, "--env-vars")).toEqual(
          expect.arrayContaining([
            `${CLOUD_AI_AGENT_ONEUPTIME_URL_ENV}=${HOSTILE.oneuptimeUrl}`,
            `${RESOURCE_AI_PROTECTED_TARGETS_ENV}=${expected[RESOURCE_AI_PROTECTED_TARGETS_ENV]}`,
          ]),
        );
        expect(flagWords(app, "--secrets")).toEqual([
          `${AZURE_CLOUD_AI_AGENT_SECRET_NAME}=${HOSTILE.ingestionKey}`,
        ]);
      }

      if (options.provider === CloudProvider.GCP) {
        expect(yaml.load(shell.envFile as string)).toEqual(expected);
      }

      expect(shell.output).toEqual([CLOUD_AI_AGENT_STARTED_MESSAGE]);
    },
  );

  test.each(ALL_CLOUDS)(
    "$provider's command holds nothing an interactive shell reads on its own: no history expansion, no tab, no line that starts with ^, no placeholder",
    (options: CloudAiAgentSetupOptions) => {
      const command: string = getCloudAiAgentSetupCommand({
        ...options,
        ...HOSTILE,
        requiredTag: CLOUD_AI_DEFAULT_REQUIRED_TAG,
      });

      // A "!" expands, even in a heredoc, unless a space or "=" follows it ("!=").
      expect(command).not.toMatch(/![^=\s]|!$/m);
      expect(command).not.toContain("\t");
      expect(command).not.toMatch(/^\^/m);
      expect(command).not.toMatch(/<[A-Z_]+>/);
      expect(command).not.toContain("undefined");
      expect(command).not.toContain("[object Object]");
      // The shell's own lines never start a substitution of a template's.
      expect(shellLines(command).join("\n")).not.toContain("${");
    },
  );

  test("each heredoc ends where it should: no line of its body is its delimiter", () => {
    const aws: string = getAwsCloudAiAgentSetupCommand({ ...AWS, ...HOSTILE });
    const gcp: string = getGcpCloudAiAgentSetupCommand({ ...GCP, ...HOSTILE });

    expect(
      heredocBody(
        aws,
        `cat > ${AWS_CLOUD_AI_AGENT_TEMPLATE_FILE} <<'TEMPLATE'`,
      ),
    ).toHaveLength(1);
    expect(
      aws.split("\n").filter((line: string): boolean => {
        return line === "TEMPLATE";
      }),
    ).toHaveLength(1);
    expect(
      heredocBody(gcp, `cat > ${GCP_CLOUD_AI_AGENT_ENV_FILE} <<'ENV'`),
    ).toHaveLength(getCloudAiAgentEnvironment({ ...GCP, ...HOSTILE }).length);
    expect(
      gcp.split("\n").filter((line: string): boolean => {
        return line === "ENV";
      }),
    ).toHaveLength(1);
  });

  test("every command ends by saying the agent is starting and connects on its own", () => {
    expect(CLOUD_AI_AGENT_STARTED_MESSAGE).toBe(
      "The Cloud AI agent is starting. It connects to OneUptime on its own, so there is nothing to paste back.",
    );

    for (const options of ALL_CLOUDS) {
      const shell: ShellRun = run(getCloudAiAgentSetupCommand(options));

      expect(shell.output[shell.output.length - 1]).toBe(
        CLOUD_AI_AGENT_STARTED_MESSAGE,
      );
    }
  });
});
