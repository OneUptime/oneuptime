import { buildCloudAiAgentKey } from "../../../Types/CloudConnection/CloudAiAgentKey";
import {
  AWS_STACK_SET_DEFAULT_HOME_REGION,
  AWS_STACK_SET_PLACEHOLDER,
} from "../../../Types/CloudConnection/AwsStackSets";
import {
  AWS_CLOUD_AI_AGENT_ORGANIZATION_ACCOUNTS_FILE,
  AWS_CLOUD_AI_AGENT_ORGANIZATION_TEMPLATE_FILE,
  AWS_CLOUD_AI_AGENT_SUBNET_CIDR,
  AWS_CLOUD_AI_AGENT_VPC_CIDR,
  CLOUD_AI_AGENT_ORGANIZATION_ACCOUNT_FAILED_MESSAGE,
  CLOUD_AI_AGENT_ORGANIZATION_MAX_ACCOUNTS,
  CloudAiAgentOrganizationAccount,
  CloudAiAgentOrganizationSetupOptions,
  describeCloudAiAgentOrganizationSetupProblem,
  getAwsCloudAiAgentTemplate,
  getAwsOrganizationCloudAiAgentInstancesCommand,
  getAwsOrganizationCloudAiAgentRemoveCommand,
  getAwsOrganizationCloudAiAgentSetupCommand,
  getAwsOrganizationCloudAiAgentTemplate,
  getCloudAiAgentOrganizationStartedMessage,
  getCloudAiAgentOrganizationWrongAccountMessage,
} from "../../../Types/CloudConnection/CloudAiAgentSetupCommands";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import BadDataException from "../../../Types/Exception/BadDataException";
import {
  AWS_CLOUD_AI_AGENT_STACK_NAME,
  AWS_CLOUD_AI_AGENT_STACK_SET_NAME,
  getCloudAiAgentOwnTargets,
} from "../../../Types/ResourceAiAgent/CloudAiAgentNames";
import {
  RESOURCE_AI_AWS_WRITE_ROLE_ARN_ENV,
  RESOURCE_AI_CLOUD_ACCOUNT_ID_ENV,
} from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import { afterAll, describe, expect, test } from "@jest/globals";
import { SpawnSyncReturns, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

/*
 * Types/CloudConnection/CloudAiAgentSetupCommands - the Cloud AI agent in
 * every account of an AWS Organization, with one command in the management
 * account's CloudShell (a StackSet, through Types/CloudConnection/
 * AwsStackSets). What it must hold to:
 *
 *   - every account's agent registers with ITS OWN cloud account's key: a
 *     member's stack instance carries that member's key and cloud account
 *     id and no other's, and a key made for another cloud account is
 *     refused before any command is written;
 *   - the roles are one account's, least privilege unchanged: the
 *     organization's template differs from one account's only in where the
 *     task runs (a network of its own) and in naming its cloud account;
 *   - it runs only in the management account, in one home Region the same
 *     from any CloudShell Region, and runs again cleanly (an existing
 *     StackSet and instances are updated, not made twice);
 *   - the management account, which StackSets never deploys to, gets a
 *     stack of its own; a member StackSets refuses is named and the rest go
 *     on; the keys' file is removed.
 *
 * bash runs each command against a fake aws that records every call.
 */

type Json = any;

const MANAGEMENT: string = "111111111111";
const MEMBER_A: string = "222222222222";
const MEMBER_B: string = "333333333333";

const CLOUD_MANAGEMENT: string = "aaaaaaaa-1111-4111-8111-111111111111";
const CLOUD_A: string = "bbbbbbbb-2222-4222-8222-222222222222";
const CLOUD_B: string = "cccccccc-3333-4333-8333-333333333333";

function keyOf(cloudAccountId: string, digit: string): string {
  return buildCloudAiAgentKey({
    cloudAccountId,
    secret: digit.repeat(64),
  });
}

const KEY_MANAGEMENT: string = keyOf(CLOUD_MANAGEMENT, "1");
const KEY_A: string = keyOf(CLOUD_A, "a");
const KEY_B: string = keyOf(CLOUD_B, "b");

const ACCOUNTS: Array<CloudAiAgentOrganizationAccount> = [
  {
    accountId: MANAGEMENT,
    cloudAccountId: CLOUD_MANAGEMENT,
    agentKey: KEY_MANAGEMENT,
  },
  { accountId: MEMBER_A, cloudAccountId: CLOUD_A, agentKey: KEY_A },
  { accountId: MEMBER_B, cloudAccountId: CLOUD_B, agentKey: KEY_B },
];

const OPTIONS: CloudAiAgentOrganizationSetupOptions = {
  oneuptimeUrl: "https://oneuptime.com",
  fixesMode: "RequireApproval",
  managementAccountId: MANAGEMENT,
  accounts: ACCOUNTS,
};

// ---- A shell with a fake aws ------------------------------------------------------

const FAKE_AWS: string = String.raw`
record() {
  for arg in "$@"; do printf '%s\037' "$arg"; done >> "$CALLS"
  printf '\036' >> "$CALLS"
}
# The value after a flag among a call's words.
flag_value() {
  wanted="$1"; shift
  while [ "$#" -gt 0 ]; do
    if [ "$1" = "$wanted" ]; then printf '%s' "$2"; return 0; fi
    shift
  done
}
# The one account a call's deployment targets name.
target_account() {
  flag_value --deployment-targets "$@" | sed -n 's/.*Accounts=\([0-9]*\).*/\1/p'
}
listed() {
  for one in $2; do [ "$one" = "$1" ] && return 0; done
  return 1
}
aws() {
  record aws "$@"
  case "$1 $2" in
    "sts get-caller-identity") echo "$FAKE_ACCOUNT" ;;
    "organizations list-roots") echo r-root ;;
    "cloudformation create-stack-set")
      if [ "$FAKE_STACK_SET_EXISTS" = 1 ]; then echo "NameAlreadyExistsException" >&2; return 254; fi
      cp "$TEMPLATE_FILE" "$CAPTURED/stack-set-template.json" ;;
    "cloudformation update-stack-set")
      cp "$TEMPLATE_FILE" "$CAPTURED/stack-set-template.json" ;;
    "cloudformation update-stack-instances")
      listed "$(target_account "$@")" "$FAKE_INSTANCES" || { echo "StackInstanceNotFoundException" >&2; return 254; } ;;
    "cloudformation create-stack-instances")
      if listed "$(target_account "$@")" "$FAKE_REFUSED"; then echo "ValidationError" >&2; return 254; fi ;;
    "cloudformation describe-stacks")
      if [ -n "$FAKE_STACK_STATUS" ]; then echo "$FAKE_STACK_STATUS"; else echo "Stack does not exist" >&2; return 254; fi ;;
    "cloudformation deploy")
      cp "$TEMPLATE_FILE" "$CAPTURED/management-template.json"
      return "$FAKE_DEPLOY_EXIT" ;;
    "cloudformation delete-stack-instances") echo op-1 ;;
    "cloudformation describe-stack-set-operation") echo SUCCEEDED ;;
    "cloudformation list-stack-instances") echo "| $MEMBER_A | us-east-1 | SUCCEEDED | None |" ;;
  esac
  return 0
}
sleep() {
  record sleep "$@"
}
`;

interface Scenario {
  account?: string | undefined;
  // CloudShell's own Region.
  cloudShellRegion?: string | undefined;
  stackSetExists?: boolean | undefined;
  // The accounts that have a stack instance already.
  instances?: Array<string> | undefined;
  // The accounts StackSets refuses an instance in.
  refused?: Array<string> | undefined;
  stackStatus?: string | undefined;
  deployExit?: number | undefined;
}

interface ShellRun {
  output: Array<string>;
  calls: Array<Array<string>>;
  files: Array<string>;
  stackSetTemplate: string | null;
  managementTemplate: string | null;
}

const DIRECTORIES: Array<string> = [];

afterAll(() => {
  for (const directory of DIRECTORIES) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function run(command: string, scenario: Scenario = {}): ShellRun {
  const directory: string = fs.mkdtempSync(
    path.join(os.tmpdir(), "cloud-ai-agent-organization-"),
  );
  const work: string = path.join(directory, "home");
  const captured: string = path.join(directory, "captured");
  const calls: string = path.join(directory, "calls");

  DIRECTORIES.push(directory);
  fs.mkdirSync(work);
  fs.mkdirSync(captured);
  fs.writeFileSync(calls, "");

  const shell: SpawnSyncReturns<string> = spawnSync(
    "bash",
    ["-c", `${FAKE_AWS}\n${command}`],
    {
      cwd: work,
      encoding: "utf8",
      env: {
        PATH: process.env["PATH"] || "/usr/bin:/bin",
        CALLS: calls,
        CAPTURED: captured,
        TEMPLATE_FILE: AWS_CLOUD_AI_AGENT_ORGANIZATION_TEMPLATE_FILE,
        MEMBER_A,
        FAKE_ACCOUNT: scenario.account ?? MANAGEMENT,
        FAKE_STACK_SET_EXISTS: scenario.stackSetExists ? "1" : "0",
        FAKE_INSTANCES: (scenario.instances || []).join(" "),
        FAKE_REFUSED: (scenario.refused || []).join(" "),
        FAKE_STACK_STATUS: scenario.stackStatus ?? "",
        FAKE_DEPLOY_EXIT: String(scenario.deployExit ?? 0),
        ...(scenario.cloudShellRegion
          ? { AWS_REGION: scenario.cloudShellRegion }
          : {}),
      },
    },
  );

  expect(shell.error).toBeUndefined();

  const read: (file: string) => string | null = (
    file: string,
  ): string | null => {
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  };

  return {
    output: shell.stdout.split("\n").filter((line: string): boolean => {
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
    stackSetTemplate: read(path.join(captured, "stack-set-template.json")),
    managementTemplate: read(path.join(captured, "management-template.json")),
  };
}

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

function flag(call: Array<string>, name: string): string | undefined {
  const index: number = call.indexOf(name);

  return index >= 0 ? call[index + 1] : undefined;
}

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

// The account a StackSets instance call is for.
function accountOf(call: Array<string>): string {
  const targets: string = flag(call, "--deployment-targets") || "";
  const match: RegExpMatchArray | null = targets.match(/Accounts=(\d+)/);

  return match ? (match[1] as string) : "";
}

// ---- The command ------------------------------------------------------------------

describe("the organization's command, first run", () => {
  const shell: ShellRun = run(
    getAwsOrganizationCloudAiAgentSetupCommand(OPTIONS),
  );

  test("turns StackSets' access on and reads the organization's root", () => {
    expect(
      callsTo(shell, "aws", "cloudformation", "activate-organizations-access"),
    ).toHaveLength(1);
    expect(callsTo(shell, "aws", "organizations", "list-roots")).toHaveLength(
      1,
    );
  });

  test("creates the StackSet SERVICE_MANAGED, managed, without auto-deployment, in its home Region", () => {
    const [create] = callsTo(
      shell,
      "aws",
      "cloudformation",
      "create-stack-set",
    );

    expect(create).toBeDefined();
    expect(flag(create!, "--stack-set-name")).toBe(
      AWS_CLOUD_AI_AGENT_STACK_SET_NAME,
    );
    expect(flag(create!, "--region")).toBe(AWS_STACK_SET_DEFAULT_HOME_REGION);
    expect(flag(create!, "--permission-model")).toBe("SERVICE_MANAGED");
    expect(flag(create!, "--managed-execution")).toBe("Active=true");
    // New accounts have no key yet: they are set up by running the command again.
    expect(flag(create!, "--auto-deployment")).toBe("Enabled=false");
    expect(flag(create!, "--capabilities")).toBe("CAPABILITY_NAMED_IAM");
    expect(flag(create!, "--template-body")).toBe(
      `file://${AWS_CLOUD_AI_AGENT_ORGANIZATION_TEMPLATE_FILE}`,
    );
    // The StackSet's own values are placeholders no key reads like: every instance has its own.
    expect(flagWords(create!, "--parameters")).toEqual([
      `ParameterKey=AgentKey,ParameterValue=${AWS_STACK_SET_PLACEHOLDER}`,
      `ParameterKey=CloudAccountId,ParameterValue=${AWS_STACK_SET_PLACEHOLDER}`,
    ]);
    expect(
      callsTo(shell, "aws", "cloudformation", "update-stack-set"),
    ).toHaveLength(0);
  });

  test("each member account gets an instance carrying its own key and cloud account, and no other's", () => {
    const creates: Array<Array<string>> = callsTo(
      shell,
      "aws",
      "cloudformation",
      "create-stack-instances",
    );

    expect(creates.map(accountOf)).toEqual([MEMBER_A, MEMBER_B]);

    for (const [call, cloudAccountId, key] of [
      [creates[0]!, CLOUD_A, KEY_A],
      [creates[1]!, CLOUD_B, KEY_B],
    ] as Array<[Array<string>, string, string]>) {
      expect(flag(call, "--deployment-targets")).toBe(
        `OrganizationalUnitIds=r-root,Accounts=${accountOf(call)},AccountFilterType=INTERSECTION`,
      );
      expect(flagWords(call, "--regions")).toEqual([
        AWS_STACK_SET_DEFAULT_HOME_REGION,
      ]);
      expect(flagWords(call, "--parameter-overrides")).toEqual([
        `ParameterKey=AgentKey,ParameterValue=${key}`,
        `ParameterKey=CloudAccountId,ParameterValue=${cloudAccountId}`,
      ]);
    }

    // Each was tried as an update first: no instance yet, so each was created.
    expect(
      callsTo(shell, "aws", "cloudformation", "update-stack-instances").map(
        accountOf,
      ),
    ).toEqual([MEMBER_A, MEMBER_B]);
  });

  test("never makes an instance for the management account: it gets a stack of its own, with its own key", () => {
    const instanceAccounts: Array<string> = [
      ...callsTo(shell, "aws", "cloudformation", "create-stack-instances"),
      ...callsTo(shell, "aws", "cloudformation", "update-stack-instances"),
    ].map(accountOf);

    expect(instanceAccounts).not.toContain(MANAGEMENT);

    const [deploy] = callsTo(shell, "aws", "cloudformation", "deploy");

    expect(deploy).toBeDefined();
    expect(flag(deploy!, "--stack-name")).toBe(AWS_CLOUD_AI_AGENT_STACK_NAME);
    expect(flag(deploy!, "--region")).toBe(AWS_STACK_SET_DEFAULT_HOME_REGION);
    expect(flag(deploy!, "--template-file")).toBe(
      AWS_CLOUD_AI_AGENT_ORGANIZATION_TEMPLATE_FILE,
    );
    expect(flagWords(deploy!, "--parameter-overrides")).toEqual([
      `AgentKey=${KEY_MANAGEMENT}`,
      `CloudAccountId=${CLOUD_MANAGEMENT}`,
    ]);
  });

  test("the StackSet and the management account's stack run the same template", () => {
    expect(shell.stackSetTemplate).not.toBeNull();
    expect(shell.managementTemplate).toBe(shell.stackSetTemplate);
    // As the heredoc writes it: the template's one line, and its end.
    expect(shell.stackSetTemplate).toBe(
      `${getAwsOrganizationCloudAiAgentTemplate(OPTIONS)}\n`,
    );
  });

  test("says how many accounts it set up, and removes the keys' file", () => {
    expect(shell.output).toEqual([
      getCloudAiAgentOrganizationStartedMessage(3),
    ]);
    expect(shell.files).toEqual([
      AWS_CLOUD_AI_AGENT_ORGANIZATION_TEMPLATE_FILE,
    ]);
    expect(shell.files).not.toContain(
      AWS_CLOUD_AI_AGENT_ORGANIZATION_ACCOUNTS_FILE,
    );
  });

  test("no key is in the template, and none is printed", () => {
    for (const key of [KEY_MANAGEMENT, KEY_A, KEY_B]) {
      expect(shell.stackSetTemplate).not.toContain(key);
      expect(shell.output.join("\n")).not.toContain(key);
    }
  });
});

describe("the organization's command, run again", () => {
  const shell: ShellRun = run(
    getAwsOrganizationCloudAiAgentSetupCommand(OPTIONS),
    {
      stackSetExists: true,
      instances: [MEMBER_A, MEMBER_B],
      stackStatus: "UPDATE_COMPLETE",
    },
  );

  test("updates the StackSet, keeping each instance's own key and account", () => {
    const [update] = callsTo(
      shell,
      "aws",
      "cloudformation",
      "update-stack-set",
    );

    expect(update).toBeDefined();
    expect(flagWords(update!, "--parameters")).toEqual([
      "ParameterKey=AgentKey,UsePreviousValue=true",
      "ParameterKey=CloudAccountId,UsePreviousValue=true",
    ]);
    expect(flag(update!, "--region")).toBe(AWS_STACK_SET_DEFAULT_HOME_REGION);
    expect(flag(update!, "--operation-preferences")).toContain(
      "FailureTolerancePercentage=100",
    );
  });

  test("updates each member's instance with its new key, and creates none", () => {
    const updates: Array<Array<string>> = callsTo(
      shell,
      "aws",
      "cloudformation",
      "update-stack-instances",
    );

    expect(updates.map(accountOf)).toEqual([MEMBER_A, MEMBER_B]);
    expect(flagWords(updates[0]!, "--parameter-overrides")).toContain(
      `ParameterKey=AgentKey,ParameterValue=${KEY_A}`,
    );
    expect(
      callsTo(shell, "aws", "cloudformation", "create-stack-instances"),
    ).toHaveLength(0);
  });

  test("updates the management account's stack in place", () => {
    expect(
      callsTo(shell, "aws", "cloudformation", "delete-stack"),
    ).toHaveLength(0);
    expect(callsTo(shell, "aws", "cloudformation", "deploy")).toHaveLength(1);
  });
});

describe("the organization's command, elsewhere and when things fail", () => {
  test("in another account's shell, it says where to run it and does nothing", () => {
    const shell: ShellRun = run(
      getAwsOrganizationCloudAiAgentSetupCommand(OPTIONS),
      {
        account: MEMBER_A,
      },
    );

    expect(shell.output).toEqual([
      getCloudAiAgentOrganizationWrongAccountMessage(MANAGEMENT),
    ]);
    expect(
      shell.calls.filter((call: Array<string>): boolean => {
        return call[1] !== "sts";
      }),
    ).toEqual([]);
    // The keys' file is removed all the same.
    expect(shell.files).not.toContain(
      AWS_CLOUD_AI_AGENT_ORGANIZATION_ACCOUNTS_FILE,
    );
  });

  test("a member StackSets refuses is named, and the next member goes on", () => {
    const shell: ShellRun = run(
      getAwsOrganizationCloudAiAgentSetupCommand(OPTIONS),
      {
        refused: [MEMBER_A],
      },
    );

    expect(shell.output).toEqual([
      `${MEMBER_A}: ${CLOUD_AI_AGENT_ORGANIZATION_ACCOUNT_FAILED_MESSAGE}`,
      getCloudAiAgentOrganizationStartedMessage(3),
    ]);
    expect(
      callsTo(shell, "aws", "cloudformation", "create-stack-instances").map(
        accountOf,
      ),
    ).toEqual([MEMBER_A, MEMBER_B]);
  });

  test("a management account stack that rolled back is deleted first, then made again", () => {
    const shell: ShellRun = run(
      getAwsOrganizationCloudAiAgentSetupCommand(OPTIONS),
      {
        stackStatus: "ROLLBACK_COMPLETE",
      },
    );

    const names: Array<string> = shell.calls
      .filter((call: Array<string>): boolean => {
        return (
          call[2] === "delete-stack" ||
          call[2] === "wait" ||
          call[2] === "deploy"
        );
      })
      .map((call: Array<string>): string => {
        return call[2] as string;
      });

    expect(names).toEqual(["delete-stack", "wait", "deploy"]);
  });

  test("the management account's stack failing is named", () => {
    const shell: ShellRun = run(
      getAwsOrganizationCloudAiAgentSetupCommand(OPTIONS),
      {
        deployExit: 255,
      },
    );

    expect(shell.output).toContain(
      `${MANAGEMENT}: ${CLOUD_AI_AGENT_ORGANIZATION_ACCOUNT_FAILED_MESSAGE}`,
    );
  });

  test.each([
    ["eu-west-1", AWS_STACK_SET_DEFAULT_HOME_REGION],
    ["ap-south-1", AWS_STACK_SET_DEFAULT_HOME_REGION],
    ["us-gov-west-1", "us-gov-west-1"],
  ])(
    "from CloudShell in %s, every call is in %s: running again anywhere finds the same StackSet",
    (cloudShellRegion: string, home: string) => {
      const shell: ShellRun = run(
        getAwsOrganizationCloudAiAgentSetupCommand(OPTIONS),
        {
          cloudShellRegion,
        },
      );
      const regions: Array<string | undefined> = shell.calls
        .filter((call: Array<string>): boolean => {
          return (
            call[1] === "cloudformation" &&
            call[2] !== "activate-organizations-access"
          );
        })
        .map((call: Array<string>): string | undefined => {
          return flag(call, "--region");
        });

      expect(regions.length).toBeGreaterThan(0);
      expect(new Set(regions)).toEqual(new Set([home]));
    },
  );

  test("a Region chosen is where every agent runs and the StackSet lives", () => {
    const shell: ShellRun = run(
      getAwsOrganizationCloudAiAgentSetupCommand({
        ...OPTIONS,
        region: "eu-central-1",
      }),
      { cloudShellRegion: "us-west-2" },
    );

    for (const call of callsTo(
      shell,
      "aws",
      "cloudformation",
      "create-stack-instances",
    )) {
      expect(flag(call, "--region")).toBe("eu-central-1");
      expect(flagWords(call, "--regions")).toEqual(["eu-central-1"]);
    }
  });

  test("the management account alone: no StackSet, its own stack", () => {
    const shell: ShellRun = run(
      getAwsOrganizationCloudAiAgentSetupCommand({
        ...OPTIONS,
        accounts: [ACCOUNTS[0]!],
      }),
    );

    expect(
      callsTo(shell, "aws", "cloudformation", "create-stack-set"),
    ).toHaveLength(0);
    expect(callsTo(shell, "aws", "cloudformation", "deploy")).toHaveLength(1);
    expect(shell.output).toEqual([
      getCloudAiAgentOrganizationStartedMessage(1),
    ]);
  });

  test("members alone, without the management account: no stack of the management account's", () => {
    const shell: ShellRun = run(
      getAwsOrganizationCloudAiAgentSetupCommand({
        ...OPTIONS,
        accounts: [ACCOUNTS[1]!, ACCOUNTS[2]!],
      }),
    );

    expect(callsTo(shell, "aws", "cloudformation", "deploy")).toHaveLength(0);
    expect(
      callsTo(shell, "aws", "cloudformation", "create-stack-instances"),
    ).toHaveLength(2);
    expect(shell.output).toEqual([
      getCloudAiAgentOrganizationStartedMessage(2),
    ]);
  });
});

// ---- The template -----------------------------------------------------------------

describe("the organization's template", () => {
  const organization: Json = JSON.parse(
    getAwsOrganizationCloudAiAgentTemplate(OPTIONS),
  );
  const single: Json = JSON.parse(
    getAwsCloudAiAgentTemplate({
      provider: CloudProvider.AWS,
      oneuptimeUrl: OPTIONS.oneuptimeUrl,
      fixesMode: OPTIONS.fixesMode,
      agentKey: KEY_A,
      cloudAccountId: CLOUD_A,
      accountId: MEMBER_A,
    }),
  );

  test("the same roles as one account's: least privilege unchanged", () => {
    for (const role of ["TaskRole", "WriteRole", "ExecutionRole"]) {
      expect(organization.Resources[role]).toEqual(single.Resources[role]);
    }
  });

  test("its key is a NoEcho parameter, and the cloud account it is for a parameter too", () => {
    expect(organization.Parameters.AgentKey.NoEcho).toBe(true);
    expect(organization.Parameters.CloudAccountId.Type).toBe("String");
    expect(Object.keys(organization.Parameters).sort()).toEqual([
      "AgentKey",
      "CloudAccountId",
    ]);
  });

  test("the agent is told its cloud account from the parameter, and the write role from its own stack", () => {
    const environment: Array<{ Name: string; Value: Json }> =
      organization.Resources.TaskDefinition.Properties.ContainerDefinitions[0]
        .Environment;
    const byName: Map<string, Json> = new Map(
      environment.map(
        (variable: { Name: string; Value: Json }): [string, Json] => {
          return [variable.Name, variable.Value];
        },
      ),
    );

    expect(byName.get(RESOURCE_AI_CLOUD_ACCOUNT_ID_ENV)).toEqual({
      Ref: "CloudAccountId",
    });
    expect(byName.get(RESOURCE_AI_AWS_WRITE_ROLE_ARN_ENV)).toEqual({
      "Fn::GetAtt": ["WriteRole", "Arn"],
    });
    // No account of the organization is written into it.
    for (const id of [
      MANAGEMENT,
      MEMBER_A,
      MEMBER_B,
      CLOUD_A,
      CLOUD_B,
      CLOUD_MANAGEMENT,
    ]) {
      expect(JSON.stringify(organization)).not.toContain(id);
    }
  });

  test("runs in a small network of its own that lets nothing in", () => {
    expect(organization.Resources.Vpc.Properties.CidrBlock).toBe(
      AWS_CLOUD_AI_AGENT_VPC_CIDR,
    );
    expect(organization.Resources.Subnet.Properties.CidrBlock).toBe(
      AWS_CLOUD_AI_AGENT_SUBNET_CIDR,
    );
    expect(organization.Resources.Subnet.Properties.MapPublicIpOnLaunch).toBe(
      false,
    );
    expect(organization.Resources.SecurityGroup.Properties.VpcId).toEqual({
      Ref: "Vpc",
    });
    expect(
      organization.Resources.SecurityGroup.Properties.SecurityGroupIngress,
    ).toBeUndefined();
    expect(
      organization.Resources.Service.Properties.NetworkConfiguration
        .AwsvpcConfiguration.Subnets,
    ).toEqual([{ Ref: "Subnet" }]);
    expect(organization.Resources.Service.DependsOn).toEqual([
      "InternetRoute",
      "SubnetRoutes",
    ]);
    // One account's command looks the default VPC up instead.
    expect(single.Parameters.VpcId).toBeDefined();
    expect(single.Resources.Vpc).toBeUndefined();
  });

  test("apart from the network and the cloud account, it is one account's template", () => {
    const strip: (template: Json) => Json = (template: Json): Json => {
      const copy: Json = JSON.parse(JSON.stringify(template));
      for (const id of [
        "Vpc",
        "InternetGateway",
        "GatewayAttachment",
        "Subnet",
        "RouteTable",
        "InternetRoute",
        "SubnetRoutes",
        "SecurityGroup",
        "Service",
        "TaskDefinition",
      ]) {
        delete copy.Resources[id];
      }
      delete copy.Parameters;
      delete copy.Description;
      return copy;
    };

    expect(strip(organization)).toEqual(strip(single));
  });

  test("the agent protects the stacks the StackSet makes, as it does its own stack", () => {
    expect(
      getCloudAiAgentOwnTargets({ provider: "aws", accountId: MEMBER_A }),
    ).toContain(
      `arn:aws*:cloudformation:*:${MEMBER_A}:stack/StackSet-${AWS_CLOUD_AI_AGENT_STACK_SET_NAME}-*`,
    );
  });
});

// ---- What is refused --------------------------------------------------------------

describe("what the organization's options may not be", () => {
  test.each([
    [
      "a key made for another cloud account",
      {
        ...OPTIONS,
        accounts: [
          ACCOUNTS[0]!,
          // Member A's key, given as member B's.
          { accountId: MEMBER_B, cloudAccountId: CLOUD_B, agentKey: KEY_A },
        ],
      },
      "This key was made for another cloud account's agent",
    ],
    [
      "a management account that is not an account id",
      { ...OPTIONS, managementAccountId: "12345" },
      "is not the AWS account id (12 digits) of the organization's management account",
    ],
    [
      "no accounts",
      { ...OPTIONS, accounts: [] },
      "No account of the organization has a key for its agent yet",
    ],
    [
      "an account named twice",
      { ...OPTIONS, accounts: [ACCOUNTS[1]!, ACCOUNTS[1]!] },
      `AWS account ${MEMBER_A} is named twice`,
    ],
    [
      "an account id that is not one",
      {
        ...OPTIONS,
        accounts: [
          { accountId: "2222", cloudAccountId: CLOUD_A, agentKey: KEY_A },
        ],
      },
      "",
    ],
  ])(
    "%s",
    (
      _name: string,
      options: CloudAiAgentOrganizationSetupOptions,
      words: string,
    ) => {
      const problem: string | null =
        describeCloudAiAgentOrganizationSetupProblem(options);

      expect(problem).not.toBeNull();
      expect(problem).toContain(words);
      expect(() => {
        return getAwsOrganizationCloudAiAgentSetupCommand(options);
      }).toThrow(BadDataException);
      expect(() => {
        return getAwsOrganizationCloudAiAgentTemplate(options);
      }).toThrow(BadDataException);
    },
  );

  test(`more than ${CLOUD_AI_AGENT_ORGANIZATION_MAX_ACCOUNTS} accounts`, () => {
    const many: Array<CloudAiAgentOrganizationAccount> = [];

    for (
      let index: number = 0;
      index <= CLOUD_AI_AGENT_ORGANIZATION_MAX_ACCOUNTS;
      index++
    ) {
      many.push({ ...ACCOUNTS[1]!, accountId: String(100000000000 + index) });
    }

    expect(
      describeCloudAiAgentOrganizationSetupProblem({
        ...OPTIONS,
        accounts: many,
      }),
    ).toBe(
      `${CLOUD_AI_AGENT_ORGANIZATION_MAX_ACCOUNTS + 1} accounts are more than one command sets up: at most ${CLOUD_AI_AGENT_ORGANIZATION_MAX_ACCOUNTS}.`,
    );
  });

  test("options that are fine have no problem", () => {
    expect(describeCloudAiAgentOrganizationSetupProblem(OPTIONS)).toBeNull();
  });

  test("the choices one account's command checks are checked for the organization's too", () => {
    expect(
      describeCloudAiAgentOrganizationSetupProblem({
        ...OPTIONS,
        region: "mars-1",
      }),
    ).toContain("is not a");
    expect(
      describeCloudAiAgentOrganizationSetupProblem({
        ...OPTIONS,
        enabledOperations: ["not-an-operation"],
      }),
    ).not.toBeNull();
  });
});

// ---- Checking and removing --------------------------------------------------------

describe("the commands beside it", () => {
  test("each member account's stack, from the StackSet's home", () => {
    const shell: ShellRun = run(
      getAwsOrganizationCloudAiAgentInstancesCommand(),
      {
        cloudShellRegion: "eu-west-1",
      },
    );
    const [list] = callsTo(
      shell,
      "aws",
      "cloudformation",
      "list-stack-instances",
    );

    expect(list).toBeDefined();
    expect(flag(list!, "--stack-set-name")).toBe(
      AWS_CLOUD_AI_AGENT_STACK_SET_NAME,
    );
    expect(flag(list!, "--region")).toBe(AWS_STACK_SET_DEFAULT_HOME_REGION);
    expect(shell.output).toEqual([
      `| ${MEMBER_A} | us-east-1 | SUCCEEDED | None |`,
    ]);
  });

  test("with a Region chosen, from there; a Region that is not one is left out", () => {
    expect(
      getAwsOrganizationCloudAiAgentInstancesCommand("eu-central-1"),
    ).toContain("AGENT_REGION=eu-central-1\n");
    expect(
      getAwsOrganizationCloudAiAgentInstancesCommand("eu-central-1; rm -rf /"),
    ).not.toContain("rm -rf");
  });

  test("removing every agent: each member's stack, the StackSet, then the management account's stack", () => {
    const shell: ShellRun = run(getAwsOrganizationCloudAiAgentRemoveCommand());

    expect(
      shell.calls.map((call: Array<string>): string => {
        return call.slice(1, 3).join(" ");
      }),
    ).toEqual([
      "organizations list-roots",
      "cloudformation delete-stack-instances",
      "cloudformation describe-stack-set-operation",
      "cloudformation delete-stack-set",
      "cloudformation delete-stack",
    ]);

    const [instances] = callsTo(
      shell,
      "aws",
      "cloudformation",
      "delete-stack-instances",
    );

    expect(flag(instances!, "--deployment-targets")).toBe(
      "OrganizationalUnitIds=r-root",
    );
    expect(instances).toContain("--no-retain-stacks");
    expect(flagWords(instances!, "--regions")).toEqual([
      AWS_STACK_SET_DEFAULT_HOME_REGION,
    ]);

    const [stack] = callsTo(shell, "aws", "cloudformation", "delete-stack");

    expect(flag(stack!, "--stack-name")).toBe(AWS_CLOUD_AI_AGENT_STACK_NAME);
  });
});
