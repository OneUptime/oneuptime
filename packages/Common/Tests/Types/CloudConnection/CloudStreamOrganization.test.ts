import { spawnSync, SpawnSyncReturns } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import {
  AWS_STACK_SET_DEFAULT_HOME_REGION,
  AWS_STACK_SET_OPERATION_PREFERENCES,
} from "../../../Types/CloudConnection/AwsStackSets";
import { buildCloudStreamKey } from "../../../Types/CloudConnection/CloudStream";
import {
  CLOUD_STREAM_ORGANIZATION_LOG_GROUPS_REFUSAL,
  CLOUD_STREAM_ORGANIZATION_STARTED_MESSAGE,
  getAwsCloudStreamOrganizationCommand,
  getAwsCloudStreamOrganizationDeleteCommand,
  getAwsCloudStreamOrganizationInstancesCommand,
  getCloudStreamOrganizationWrongAccountMessage,
  isCloudStreamOrganizationPossible,
} from "../../../Types/CloudConnection/CloudStreamOrganization";
import {
  CLOUD_STREAM_TEMPLATE_FILE,
  CloudStreamLogsMode,
  CloudStreamMetricsMode,
  CloudStreamTemplateOptions,
  getAwsCloudStreamCommand,
  getAwsCloudStreamTemplateBody,
  getCloudStreamNames,
} from "../../../Types/CloudConnection/CloudStreamTemplate";
import { afterAll, describe, expect, test } from "@jest/globals";

/*
 * Types/CloudConnection/CloudStreamOrganization - streaming every account
 * of an AWS Organization with one command in the management account's
 * CloudShell: the same template as one account's, as a StackSet in every
 * account under the organization's root (and accounts that join later),
 * through the StackSets helpers the Cloud AI agent's organization command
 * uses, plus the management account's own stacks. Run here in bash against
 * a fake aws that records every call.
 */

const CONNECTION: string = "6f1c3a2e-9b8d-4c7e-a1f0-2d3c4b5a6e7f";
const NAMES: ReturnType<typeof getCloudStreamNames> =
  getCloudStreamNames(CONNECTION);
const KEY: string = buildCloudStreamKey({
  connectionId: CONNECTION,
  secret: "0123456789abcdef".repeat(4),
});
const MANAGEMENT: string = "111111111111";

const OPTIONS: CloudStreamTemplateOptions = {
  connectionId: CONNECTION,
  metricsUrl: "https://oneuptime.com/firehose/metrics",
  logsUrl: "https://oneuptime.com/firehose/logs",
  metrics: CloudStreamMetricsMode.Key,
  logs: CloudStreamLogsMode.All,
};

const FAKE_AWS: string = String.raw`
record() {
  for arg in "$@"; do printf '%s\037' "$arg"; done >> "$CALLS"
  printf '\036' >> "$CALLS"
}
aws() {
  record aws "$@"
  case "$1 $2" in
    "sts get-caller-identity") echo "$FAKE_ACCOUNT" ;;
    "organizations list-roots") echo r-root ;;
    "cloudformation create-stack-set")
      if [ "$FAKE_STACK_SET_EXISTS" = 1 ]; then echo "NameAlreadyExistsException" >&2; return 254; fi
      cp "$TEMPLATE_FILE" "$CAPTURED/stack-set-template.json" ;;
    "cloudformation create-stack-instances")
      if [ "$FAKE_STACK_SET_EXISTS" = 1 ]; then echo "already there" >&2; return 254; fi ;;
    "cloudformation describe-stack-set")
      [ "$FAKE_STACK_SET_EXISTS" = 1 ] || { echo "StackSetNotFoundException" >&2; return 254; } ;;
    "cloudformation list-stack-instances")
      printf '%s\n' "$FAKE_INSTANCE_REGIONS" ;;
    "cloudformation delete-stack-instances") echo op-1 ;;
    "cloudformation describe-stack-set-operation") echo SUCCEEDED ;;
  esac
  return 0
}
sleep() {
  record sleep "$@"
}
`;

interface Scenario {
  account?: string | undefined;
  cloudShellRegion?: string | undefined;
  stackSetExists?: boolean | undefined;
  // What list-stack-instances prints: the StackSet's stacks' Regions, by tabs.
  instanceRegions?: string | undefined;
}

interface ShellRun {
  output: Array<string>;
  calls: Array<Array<string>>;
  stackSetTemplate: string | null;
}

const DIRECTORIES: Array<string> = [];

afterAll(() => {
  for (const directory of DIRECTORIES) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function run(command: string, scenario: Scenario = {}): ShellRun {
  const directory: string = fs.mkdtempSync(
    path.join(os.tmpdir(), "cloud-stream-organization-"),
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
        TEMPLATE_FILE: CLOUD_STREAM_TEMPLATE_FILE,
        FAKE_ACCOUNT: scenario.account ?? MANAGEMENT,
        FAKE_STACK_SET_EXISTS: scenario.stackSetExists ? "1" : "0",
        FAKE_INSTANCE_REGIONS: scenario.instanceRegions ?? "",
        ...(scenario.cloudShellRegion
          ? { AWS_REGION: scenario.cloudShellRegion }
          : {}),
      },
    },
  );

  expect(shell.error).toBeUndefined();

  const template: string = path.join(captured, "stack-set-template.json");

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
    stackSetTemplate: fs.existsSync(template)
      ? fs.readFileSync(template, "utf8")
      : null,
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

const COMMAND: string = getAwsCloudStreamOrganizationCommand({
  options: OPTIONS,
  regions: ["us-east-1", "eu-west-1"],
  streamKey: KEY,
  managementAccountId: MANAGEMENT,
});

describe("streaming every account of an organization, first run", () => {
  const shell: ShellRun = run(COMMAND, { cloudShellRegion: "eu-west-1" });

  test("the StackSet is named as the account's stack, auto-deploys, and holds the connection's key", () => {
    const [create] = callsTo(
      shell,
      "aws",
      "cloudformation",
      "create-stack-set",
    );

    expect(create).toBeDefined();
    expect(flag(create!, "--stack-set-name")).toBe(NAMES.stackName);
    expect(flag(create!, "--region")).toBe(AWS_STACK_SET_DEFAULT_HOME_REGION);
    expect(flag(create!, "--permission-model")).toBe("SERVICE_MANAGED");
    expect(flag(create!, "--capabilities")).toBe("CAPABILITY_IAM");
    // Accounts that join the organization later stream too: the key is the same in each.
    expect(flag(create!, "--auto-deployment")).toBe(
      "Enabled=true,RetainStacksOnAccountRemoval=false",
    );
    expect(flagWords(create!, "--parameters")).toEqual([
      `ParameterKey=StreamKey,ParameterValue=${KEY}`,
    ]);
  });

  test("the StackSet's template is one account's, byte for byte", () => {
    expect(shell.stackSetTemplate).toBe(
      `${getAwsCloudStreamTemplateBody(OPTIONS)}\n`,
    );
  });

  test("every account under the root, in each Region, and one failing account stops none", () => {
    const [instances] = callsTo(
      shell,
      "aws",
      "cloudformation",
      "create-stack-instances",
    );

    expect(instances).toBeDefined();
    expect(flag(instances!, "--deployment-targets")).toBe(
      "OrganizationalUnitIds=r-root",
    );
    expect(flagWords(instances!, "--regions")).toEqual([
      "us-east-1",
      "eu-west-1",
    ]);
    expect(flag(instances!, "--operation-preferences")).toBe(
      AWS_STACK_SET_OPERATION_PREFERENCES,
    );
  });

  test("the management account, which StackSets never deploys to, gets its own stack in each Region", () => {
    const deploys: Array<Array<string>> = callsTo(
      shell,
      "aws",
      "cloudformation",
      "deploy",
    );

    expect(
      deploys.map((call: Array<string>): string | undefined => {
        return flag(call, "--region");
      }),
    ).toEqual(["us-east-1", "eu-west-1"]);
    expect(flag(deploys[0]!, "--stack-name")).toBe(NAMES.stackName);
    expect(flagWords(deploys[0]!, "--parameter-overrides")).toEqual([
      `StreamKey=${KEY}`,
    ]);
  });

  test("says the streams are on their way", () => {
    expect(shell.output).toEqual([CLOUD_STREAM_ORGANIZATION_STARTED_MESSAGE]);
  });
});

describe("streaming every account of an organization, elsewhere and again", () => {
  test("in another account's shell, it says where to run it and sets nothing up", () => {
    const shell: ShellRun = run(COMMAND, { account: "222222222222" });

    expect(shell.output).toEqual([
      getCloudStreamOrganizationWrongAccountMessage(MANAGEMENT),
    ]);
    expect(
      shell.calls.filter((call: Array<string>): boolean => {
        return call[1] !== "sts";
      }),
    ).toEqual([]);
  });

  test("run again, it updates the StackSet with the new key and every account's stacks", () => {
    const shell: ShellRun = run(COMMAND, { stackSetExists: true });
    const [update] = callsTo(
      shell,
      "aws",
      "cloudformation",
      "update-stack-set",
    );

    expect(update).toBeDefined();
    // The key is a new one each run: written, not kept.
    expect(flagWords(update!, "--parameters")).toEqual([
      `ParameterKey=StreamKey,ParameterValue=${KEY}`,
    ]);
    expect(
      callsTo(shell, "aws", "cloudformation", "update-stack-instances"),
    ).toHaveLength(1);
  });

  test("an unknown management account never matches: nothing is set up", () => {
    const shell: ShellRun = run(
      getAwsCloudStreamOrganizationCommand({
        options: OPTIONS,
        regions: ["us-east-1"],
        streamKey: KEY,
        managementAccountId: "not-an-account",
      }),
    );

    expect(callsTo(shell, "aws", "cloudformation")).toEqual([]);
  });

  test("with no key yet, the placeholder stands where one account's command has it", () => {
    const command: string = getAwsCloudStreamOrganizationCommand({
      options: OPTIONS,
      regions: [],
      streamKey: null,
      managementAccountId: MANAGEMENT,
    });

    expect(command).toContain("STREAM_KEY='<YOUR_STREAM_KEY>'");
    expect(
      getAwsCloudStreamCommand({
        options: OPTIONS,
        regions: [],
        streamKey: null,
      }),
    ).toContain("STREAM_KEY='<YOUR_STREAM_KEY>'");
  });

  test("with no Region known, CloudShell's own, as one account's command", () => {
    const shell: ShellRun = run(
      getAwsCloudStreamOrganizationCommand({
        options: OPTIONS,
        regions: [],
        streamKey: KEY,
        managementAccountId: MANAGEMENT,
      }),
      { cloudShellRegion: "ap-south-1" },
    );
    const [instances] = callsTo(
      shell,
      "aws",
      "cloudformation",
      "create-stack-instances",
    );

    expect(flagWords(instances!, "--regions")).toEqual(["ap-south-1"]);
    // The StackSet itself lives in its home all the same.
    expect(flag(instances!, "--region")).toBe(
      AWS_STACK_SET_DEFAULT_HOME_REGION,
    );
  });
});

describe("what an organization can stream", () => {
  test("every log group, or metrics alone - never named log groups, which are one account's", () => {
    expect(
      isCloudStreamOrganizationPossible({ logs: CloudStreamLogsMode.All }),
    ).toBe(true);
    expect(
      isCloudStreamOrganizationPossible({ logs: CloudStreamLogsMode.Off }),
    ).toBe(true);
    expect(
      isCloudStreamOrganizationPossible({ logs: CloudStreamLogsMode.Groups }),
    ).toBe(false);
    expect(CLOUD_STREAM_ORGANIZATION_LOG_GROUPS_REFUSAL).toBe(
      "Named log groups are one account's. To stream every account of the organization, stream every log group, or metrics alone.",
    );
  });
});

describe("checking and stopping", () => {
  test("each account's stacks, from the StackSet's home", () => {
    const shell: ShellRun = run(
      getAwsCloudStreamOrganizationInstancesCommand(CONNECTION),
      { cloudShellRegion: "eu-west-1" },
    );
    const [list] = callsTo(
      shell,
      "aws",
      "cloudformation",
      "list-stack-instances",
    );

    expect(flag(list!, "--stack-set-name")).toBe(NAMES.stackName);
    expect(flag(list!, "--region")).toBe(AWS_STACK_SET_DEFAULT_HOME_REGION);
  });

  test("without the StackSet, stopping deletes the management account's stacks alone", () => {
    const shell: ShellRun = run(
      getAwsCloudStreamOrganizationDeleteCommand({
        connectionId: CONNECTION,
        regions: ["us-east-1", "eu-west-1", "us-east-1", "nowhere"],
      }),
    );

    expect(
      shell.calls.map((call: Array<string>): string => {
        return `${call[2]} ${flag(call, "--region")}`;
      }),
    ).toEqual([
      "delete-stack us-east-1",
      "delete-stack eu-west-1",
      `describe-stack-set ${AWS_STACK_SET_DEFAULT_HOME_REGION}`,
    ]);
  });

  test("with the StackSet, every member account's stacks in each of its Regions, then the StackSet", () => {
    const shell: ShellRun = run(
      getAwsCloudStreamOrganizationDeleteCommand({
        connectionId: CONNECTION,
        regions: ["us-east-1"],
      }),
      {
        stackSetExists: true,
        instanceRegions: "eu-west-1\tus-east-1\teu-west-1",
      },
    );
    const [instances] = callsTo(
      shell,
      "aws",
      "cloudformation",
      "delete-stack-instances",
    );

    expect(instances).toBeDefined();
    expect(flagWords(instances!, "--regions")).toEqual([
      "eu-west-1",
      "us-east-1",
    ]);
    expect(instances).toContain("--no-retain-stacks");
    expect(
      callsTo(shell, "aws", "cloudformation", "delete-stack-set"),
    ).toHaveLength(1);
  });
});
