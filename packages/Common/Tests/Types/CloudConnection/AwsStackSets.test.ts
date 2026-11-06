import {
  AWS_ORGANIZATION_ROOT_VARIABLE,
  AWS_STACK_SET_DEFAULT_HOME_REGION,
  AWS_STACK_SET_OPERATION_PREFERENCES,
  AWS_STACK_SET_OPERATION_UNFINISHED,
  AWS_STACK_SET_PLACEHOLDER,
  formatAwsStackSetParameters,
  getAwsOrganizationStartLines,
  getAwsStackSetDeleteLines,
  getAwsStackSetDeployLine,
  getAwsStackSetEveryAccountLine,
  getAwsStackSetHomeRegionLine,
  getAwsStackSetInstancesCommand,
  getAwsStackSetOneAccountLine,
  quoteForShell,
} from "../../../Types/CloudConnection/AwsStackSets";
import { afterAll, describe, expect, test } from "@jest/globals";
import { SpawnSyncReturns, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

/*
 * Types/CloudConnection/AwsStackSets - the shell lines the Cloud AI agent's
 * and the CloudWatch stream's organization commands both write, so the two
 * StackSets paths are one. Each line is read here as text (what it asks
 * StackSets for) and, where the shell decides something, run in bash with
 * a fake aws that records its argv.
 */

const DIRECTORIES: Array<string> = [];

afterAll(() => {
  for (const directory of DIRECTORIES) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

/*
 * What bash prints, and the argv of each aws call (and each sleep) in
 * order, for a script: the fake records to a file, so a call whose output
 * the line sends to /dev/null, or reads into a variable, is recorded too.
 * `answers` is bash run inside the fake aws, to answer a call.
 */
function runInBash(
  script: string,
  options: { env?: Record<string, string>; answers?: string } = {},
): { output: string; calls: Array<Array<string>> } {
  const directory: string = fs.mkdtempSync(
    path.join(os.tmpdir(), "aws-stack-sets-"),
  );
  const callsFile: string = path.join(directory, "calls");

  DIRECTORIES.push(directory);
  fs.writeFileSync(callsFile, "");

  const fake: string = String.raw`
record() {
  for arg in "$@"; do printf '%s\037' "$arg"; done >> "$CALLS"
  printf '\036' >> "$CALLS"
}
aws() {
  record "$@"
  ${options.answers || ""}
  return 0
}
# Nothing waits; a loop that never ends stops the script at its 20th wait.
sleep() {
  record sleep "$@"
  SLEPT=$(( $(cat "$CALLS.slept" 2> /dev/null || echo 0) + 1 ))
  echo "$SLEPT" > "$CALLS.slept"
  [ "$SLEPT" -lt 20 ] || exit 3
}
`;
  const shell: SpawnSyncReturns<string> = spawnSync(
    "bash",
    ["-c", `${fake}\n${script}`],
    {
      encoding: "utf8",
      env: {
        PATH: process.env["PATH"] || "/usr/bin:/bin",
        CALLS: callsFile,
        ...(options.env || {}),
      },
    },
  );

  expect(shell.error).toBeUndefined();

  return {
    output: shell.stdout,
    calls: fs
      .readFileSync(callsFile, "utf8")
      .split("\u001e")
      .filter((call: string): boolean => {
        return call.length > 0;
      })
      .map((call: string): Array<string> => {
        return call.split("\u001f").slice(0, -1);
      }),
  };
}

describe("quoteForShell", () => {
  test.each([
    ["plain", "'plain'"],
    ["it's", "'it'\\''s'"],
    ["$HOME `id` $(id)", "'$HOME `id` $(id)'"],
    ["", "''"],
  ])(
    "%j is one word the shell never reads inside",
    (value: string, quoted: string) => {
      expect(quoteForShell(value)).toBe(quoted);

      const run: SpawnSyncReturns<string> = spawnSync(
        "bash",
        ["-c", `printf '%s' ${quoted}`],
        { encoding: "utf8" },
      );

      expect(run.stdout).toBe(value);
    },
  );
});

describe("formatAwsStackSetParameters", () => {
  test("a value is quoted, a kept one says so, and a shell variable is expanded in double quotes", () => {
    expect(
      formatAwsStackSetParameters([
        { key: "Name", value: "it's" },
        { key: "AgentKey", value: null },
        { key: "StreamKey", value: null, shellVariable: "STREAM_KEY" },
      ]),
    ).toBe(
      `'ParameterKey=Name,ParameterValue=it'\\''s' ParameterKey=AgentKey,UsePreviousValue=true "ParameterKey=StreamKey,ParameterValue=$STREAM_KEY"`,
    );
  });

  test("none is nothing", () => {
    expect(formatAwsStackSetParameters([])).toBe("");
  });

  test("bash reads each as one word, with the variable's value", () => {
    const { calls } = runInBash(
      `STREAM_KEY='ouc_abc def'\naws cloudformation x --parameters ${formatAwsStackSetParameters(
        [
          { key: "Name", value: "a b" },
          { key: "StreamKey", value: null, shellVariable: "STREAM_KEY" },
        ],
      )}`,
    );

    expect(calls[0]).toEqual([
      "cloudformation",
      "x",
      "--parameters",
      "ParameterKey=Name,ParameterValue=a b",
      "ParameterKey=StreamKey,ParameterValue=ouc_abc def",
    ]);
  });
});

describe("getAwsStackSetHomeRegionLine", () => {
  test("a Region given is the home", () => {
    expect(
      getAwsStackSetHomeRegionLine({
        variable: "HOME_REGION",
        region: "eu-west-1",
      }),
    ).toBe("HOME_REGION=eu-west-1");
  });

  test.each([
    ["eu-west-1", AWS_STACK_SET_DEFAULT_HOME_REGION],
    ["ap-southeast-2", AWS_STACK_SET_DEFAULT_HOME_REGION],
    ["", AWS_STACK_SET_DEFAULT_HOME_REGION],
    ["us-gov-west-1", "us-gov-west-1"],
    ["cn-north-1", "cn-north-1"],
  ])(
    "none given: CloudShell in %j makes the home %s - the same from any Region of a partition",
    (cloudShellRegion: string, home: string) => {
      const { output } = runInBash(
        `${getAwsStackSetHomeRegionLine({ variable: "HOME_REGION", region: null })}\nprintf '%s' "$HOME_REGION"`,
        { env: cloudShellRegion ? { AWS_REGION: cloudShellRegion } : {} },
      );

      expect(output).toBe(home);
    },
  );

  test("the default home is US East (N. Virginia)", () => {
    expect(AWS_STACK_SET_DEFAULT_HOME_REGION).toBe("us-east-1");
  });
});

describe("getAwsOrganizationStartLines", () => {
  test("trusted access for StackSets, quietly, then the organization's root", () => {
    expect(getAwsOrganizationStartLines()).toEqual([
      "aws cloudformation activate-organizations-access > /dev/null 2>&1 || true",
      `${AWS_ORGANIZATION_ROOT_VARIABLE}=$(aws organizations list-roots --query "Roots[0].Id" --output text)`,
    ]);
  });
});

describe("getAwsStackSetDeployLine", () => {
  const line: (autoDeployment: boolean) => string = (
    autoDeployment: boolean,
  ): string => {
    return getAwsStackSetDeployLine({
      stackSetName: "OneUptimeThing",
      homeRegion: '"$HOME_REGION"',
      templateFile: "thing.json",
      stackSetDescription: "OneUptime's thing",
      capabilities: "CAPABILITY_NAMED_IAM",
      parameters: [
        { key: "AgentKey", value: null },
        { key: "Fixed", value: "yes" },
        { key: "StreamKey", value: null, shellVariable: "STREAM_KEY" },
      ],
      autoDeployment,
    });
  };

  test("created SERVICE_MANAGED with managed execution, or else updated", () => {
    const [create, update] = line(false).split(" || ");

    expect(create).toBe(
      `aws cloudformation create-stack-set --stack-set-name OneUptimeThing --region "$HOME_REGION" --template-body file://thing.json --description 'OneUptime'\\''s thing' --capabilities CAPABILITY_NAMED_IAM --permission-model SERVICE_MANAGED --auto-deployment Enabled=false --managed-execution Active=true --parameters 'ParameterKey=AgentKey,ParameterValue=${AWS_STACK_SET_PLACEHOLDER}' 'ParameterKey=Fixed,ParameterValue=yes' "ParameterKey=StreamKey,ParameterValue=$STREAM_KEY" > /dev/null 2>&1`,
    );
    expect(update).toBe(
      `aws cloudformation update-stack-set --stack-set-name OneUptimeThing --region "$HOME_REGION" --template-body file://thing.json --description 'OneUptime'\\''s thing' --capabilities CAPABILITY_NAMED_IAM --auto-deployment Enabled=false --managed-execution Active=true --operation-preferences ${AWS_STACK_SET_OPERATION_PREFERENCES} --parameters ParameterKey=AgentKey,UsePreviousValue=true 'ParameterKey=Fixed,ParameterValue=yes' "ParameterKey=StreamKey,ParameterValue=$STREAM_KEY" > /dev/null`,
    );
  });

  test("auto-deployment, for a template whose parameters are the same in every account", () => {
    expect(line(true)).toContain(
      "--auto-deployment Enabled=true,RetainStacksOnAccountRemoval=false",
    );
    expect(line(true)).not.toContain("Enabled=false");
  });

  test("no parameters: no --parameters", () => {
    const text: string = getAwsStackSetDeployLine({
      stackSetName: "S",
      homeRegion: "us-east-1",
      templateFile: "t.json",
      stackSetDescription: "d",
      capabilities: "CAPABILITY_IAM",
      parameters: [],
      autoDeployment: true,
    });

    expect(text).not.toContain("--parameters");
  });

  test("an operation that fails in one account does not stop the others", () => {
    expect(AWS_STACK_SET_OPERATION_PREFERENCES).toBe(
      "FailureTolerancePercentage=100,MaxConcurrentPercentage=100,RegionConcurrencyType=PARALLEL",
    );
  });
});

describe("getAwsStackSetEveryAccountLine", () => {
  test("every account under the root, in the Regions: created, or else updated", () => {
    const text: string = getAwsStackSetEveryAccountLine({
      stackSetName: "OneUptimeStream-abc",
      homeRegion: '"$STREAM_HOME"',
      regions: "us-east-1 eu-west-1",
    });

    expect(text.split(" || ")).toEqual([
      `aws cloudformation create-stack-instances --stack-set-name OneUptimeStream-abc --region "$STREAM_HOME" --deployment-targets OrganizationalUnitIds="$${AWS_ORGANIZATION_ROOT_VARIABLE}" --regions us-east-1 eu-west-1 --operation-preferences ${AWS_STACK_SET_OPERATION_PREFERENCES} > /dev/null 2>&1`,
      `aws cloudformation update-stack-instances --stack-set-name OneUptimeStream-abc --region "$STREAM_HOME" --deployment-targets OrganizationalUnitIds="$${AWS_ORGANIZATION_ROOT_VARIABLE}" --regions us-east-1 eu-west-1 --operation-preferences ${AWS_STACK_SET_OPERATION_PREFERENCES} > /dev/null`,
    ]);
  });
});

describe("getAwsStackSetOneAccountLine", () => {
  const text: string = getAwsStackSetOneAccountLine({
    stackSetName: "OneUptimeAiAgent",
    homeRegion: '"$AGENT_REGION"',
    accountVariable: "MEMBER",
    region: '"$AGENT_REGION"',
    overrides: [
      { key: "AgentKey", shellVariable: "KEY" },
      { key: "CloudAccountId", shellVariable: "CLOUD_ACCOUNT" },
    ],
    failedMessage: "did not take",
  });

  test("one account as the root's intersection with it, its own overrides: updated, or else created, or else said", () => {
    expect(text).toBe(
      `aws cloudformation update-stack-instances --stack-set-name OneUptimeAiAgent --region "$AGENT_REGION" --deployment-targets OrganizationalUnitIds="$ORGANIZATION_ROOT",Accounts="$MEMBER",AccountFilterType=INTERSECTION --regions "$AGENT_REGION" --parameter-overrides "ParameterKey=AgentKey,ParameterValue=$KEY" "ParameterKey=CloudAccountId,ParameterValue=$CLOUD_ACCOUNT" > /dev/null 2>&1 || aws cloudformation create-stack-instances --stack-set-name OneUptimeAiAgent --region "$AGENT_REGION" --deployment-targets OrganizationalUnitIds="$ORGANIZATION_ROOT",Accounts="$MEMBER",AccountFilterType=INTERSECTION --regions "$AGENT_REGION" --parameter-overrides "ParameterKey=AgentKey,ParameterValue=$KEY" "ParameterKey=CloudAccountId,ParameterValue=$CLOUD_ACCOUNT" > /dev/null || echo "$MEMBER: did not take"`,
    );
  });

  test("bash gives each call the account's own values", () => {
    const { calls } = runInBash(
      `ORGANIZATION_ROOT=r-abcd\nAGENT_REGION=eu-west-1\nMEMBER=111111111111\nKEY=ouca_one\nCLOUD_ACCOUNT=cloud-one\n${text}`,
    );

    // The fake update succeeds, so the instance is updated and not created.
    expect(calls).toEqual([
      [
        "cloudformation",
        "update-stack-instances",
        "--stack-set-name",
        "OneUptimeAiAgent",
        "--region",
        "eu-west-1",
        "--deployment-targets",
        "OrganizationalUnitIds=r-abcd,Accounts=111111111111,AccountFilterType=INTERSECTION",
        "--regions",
        "eu-west-1",
        "--parameter-overrides",
        "ParameterKey=AgentKey,ParameterValue=ouca_one",
        "ParameterKey=CloudAccountId,ParameterValue=cloud-one",
      ],
    ]);
  });
});

describe("getAwsStackSetInstancesCommand", () => {
  test("each account's stack: account, Region, status and why", () => {
    expect(
      getAwsStackSetInstancesCommand({
        stackSetName: "OneUptimeAiAgent",
        homeRegion: "us-east-1",
      }),
    ).toBe(
      'aws cloudformation list-stack-instances --stack-set-name OneUptimeAiAgent --region us-east-1 --query "Summaries[].[Account,Region,StackInstanceStatus.DetailedStatus,StatusReason]" --output table',
    );
  });
});

describe("getAwsStackSetDeleteLines", () => {
  const lines: Array<string> = getAwsStackSetDeleteLines({
    stackSetName: "OneUptimeStream-abc",
    homeRegion: '"$STREAM_HOME"',
    regions: "us-east-1 eu-west-1",
  });

  test("the root, every instance removed with its stack, a wait, then the StackSet", () => {
    expect(lines).toEqual([
      `${AWS_ORGANIZATION_ROOT_VARIABLE}=$(aws organizations list-roots --query "Roots[0].Id" --output text)`,
      `OPERATION=$(aws cloudformation delete-stack-instances --stack-set-name OneUptimeStream-abc --region "$STREAM_HOME" --deployment-targets OrganizationalUnitIds="$ORGANIZATION_ROOT" --regions us-east-1 eu-west-1 --no-retain-stacks --operation-preferences ${AWS_STACK_SET_OPERATION_PREFERENCES} --query OperationId --output text)`,
      `while [ -n "$OPERATION" ]; do case "$(aws cloudformation describe-stack-set-operation --stack-set-name OneUptimeStream-abc --region "$STREAM_HOME" --operation-id "$OPERATION" --query StackSetOperation.Status --output text)" in QUEUED|RUNNING|STOPPING) sleep 10 ;; *) break ;; esac; done`,
      'aws cloudformation delete-stack-set --stack-set-name OneUptimeStream-abc --region "$STREAM_HOME"',
    ]);
  });

  test("waits while the operation is queued, running or stopping, and not once it is over", () => {
    expect(AWS_STACK_SET_OPERATION_UNFINISHED).toEqual([
      "QUEUED",
      "RUNNING",
      "STOPPING",
    ]);

    // The operation is queued, then running, then succeeded: two waits.
    const { calls } = runInBash(`STREAM_HOME=us-east-1\n${lines.join("\n")}`, {
      answers: String.raw`case "$1 $2" in
    "organizations list-roots") echo r-abcd ;;
    "cloudformation delete-stack-instances") echo op-1 ;;
    "cloudformation describe-stack-set-operation")
      READS=$(( $(cat "$CALLS.reads" 2> /dev/null || echo 0) + 1 ))
      echo "$READS" > "$CALLS.reads"
      case "$READS" in 1) echo QUEUED ;; 2) echo RUNNING ;; *) echo SUCCEEDED ;; esac ;;
  esac`,
    });

    expect(
      calls.map((call: Array<string>): string => {
        return call.slice(0, 2).join(" ");
      }),
    ).toEqual([
      "organizations list-roots",
      "cloudformation delete-stack-instances",
      "cloudformation describe-stack-set-operation",
      "sleep 10",
      "cloudformation describe-stack-set-operation",
      "sleep 10",
      "cloudformation describe-stack-set-operation",
      "cloudformation delete-stack-set",
    ]);
    // Each status read names the operation the removal started.
    expect(
      calls
        .filter((call: Array<string>): boolean => {
          return call[1] === "describe-stack-set-operation";
        })
        .map((call: Array<string>): string | undefined => {
          return call[call.indexOf("--operation-id") + 1];
        }),
    ).toEqual(["op-1", "op-1", "op-1"]);
  });

  test("no operation started (no instances, no StackSet): no wait", () => {
    const { calls } = runInBash(`STREAM_HOME=us-east-1\n${lines.join("\n")}`);

    expect(
      calls.map((call: Array<string>): string => {
        return call.slice(0, 2).join(" ");
      }),
    ).toEqual([
      "organizations list-roots",
      "cloudformation delete-stack-instances",
      "cloudformation delete-stack-set",
    ]);
  });
});
