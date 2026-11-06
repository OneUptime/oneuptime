import { spawnSync, SpawnSyncReturns } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { buildCloudStreamKey } from "../../../Types/CloudConnection/CloudStream";
import {
  AWS_SUBSCRIPTION_FILTERS_PER_LOG_GROUP,
  CLOUD_STREAM_COMMAND_STOPPED,
  CLOUD_STREAM_TEMPLATE_FILE,
  CloudStreamLogGroup,
  CloudStreamLogsMode,
  CloudStreamMetricsMode,
  CloudStreamTemplateOptions,
  getAwsCloudStreamCommand,
  getCloudStreamNames,
} from "../../../Types/CloudConnection/CloudStreamTemplate";
import { afterAll, describe, expect, test } from "@jest/globals";

/*
 * Two of AWS's limits fail a stream's stack mid-way and leave it rolled
 * back, to be deleted before it can be made again: an account has one
 * account-level log subscription policy per Region, so a SIEM that already
 * streams every log group leaves none for us; and a log group takes two
 * subscription filters at most. The command checks both before it deploys
 * anything, says each problem with its Region and log group, and then
 * deploys nothing.
 *
 * It is run here for real, in bash, against a fake aws: a function that
 * records each call (arguments apart by \037, calls by \036) and answers
 * from the scenario - the account's subscription policies and each log
 * group's subscription filters - honouring the query's own filter, which
 * leaves out the connection's own policy and filter, as AWS would.
 */

const CONNECTION: string = "6f1c3a2e-9b8d-4c7e-a1f0-2d3c4b5a6e7f";
const OURS: string = getCloudStreamNames(CONNECTION).accountPolicy;
const KEY: string = buildCloudStreamKey({
  connectionId: CONNECTION,
  secret: "0123456789abcdef".repeat(4),
});

const FAKE_AWS: string = String.raw`
record() {
  for arg in "$@"; do printf '%s\037' "$arg"; done >> "$CALLS"
  printf '\036' >> "$CALLS"
}
flag_value() {
  wanted="$1"; shift
  while [ "$#" -gt 0 ]; do
    if [ "$1" = "$wanted" ]; then printf '%s' "$2"; return 0; fi
    shift
  done
}
aws() {
  record aws "$@"
  region=$(flag_value --region "$@")
  query=$(flag_value --query "$@")
  case "$1 $2" in
    "logs describe-account-policies")
      if [ "$region" = "$FAKE_UNREADABLE_REGION" ]; then
        echo "An error occurred (AccessDeniedException) when calling the DescribeAccountPolicies operation" >&2
        return 254
      fi
      ours=$(printf '%s' "$query" | sed -n "s/.*policyName!='\([^']*\)'.*/\1/p")
      names=""
      while read -r policy_region policy_name; do
        if [ "$policy_region" = "$region" ] && [ -n "$policy_name" ] && [ "$policy_name" != "$ours" ]; then
          names="$names${"$"}{names:+	}$policy_name"
        fi
      done <<< "$FAKE_POLICIES"
      if [ -n "$names" ]; then printf '%s\n' "$names"; fi
      return 0 ;;
    "logs describe-subscription-filters")
      group=$(flag_value --log-group-name "$@")
      ours=$(printf '%s' "$query" | sed -n "s/.*filterName!='\([^']*\)'.*/\1/p")
      while read -r group_region group_name filters; do
        if [ "$group_region" = "$region" ] && [ "$group_name" = "$group" ]; then
          count=0
          for filter in $(printf '%s' "$filters" | tr ',' ' '); do
            if [ "$filter" != "-" ] && [ "$filter" != "$ours" ]; then count=$((count + 1)); fi
          done
          echo "$count"
          return 0
        fi
      done <<< "$FAKE_GROUPS"
      echo "An error occurred (ResourceNotFoundException) when calling the DescribeSubscriptionFilters operation: The specified log group does not exist." >&2
      return 254 ;;
    "cloudformation deploy")
      return 0 ;;
  esac
  return 0
}
`;

interface Scenario {
  // "<Region> <policy name>", one a line: the account's subscription policies.
  policies?: Array<string> | undefined;
  // "<Region> <log group> <filter,filter|->", one a line: each group's filters.
  groups?: Array<string> | undefined;
  // A Region whose policies cannot be read.
  unreadableRegion?: string | undefined;
}

interface ShellRun {
  output: Array<string>;
  calls: Array<Array<string>>;
  status: number | null;
}

const DIRECTORIES: Array<string> = [];

afterAll(() => {
  for (const directory of DIRECTORIES) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function run(command: string, scenario: Scenario = {}): ShellRun {
  const directory: string = fs.mkdtempSync(
    path.join(os.tmpdir(), "cloud-stream-command-"),
  );
  const work: string = path.join(directory, "home");
  const calls: string = path.join(directory, "calls");

  DIRECTORIES.push(directory);
  fs.mkdirSync(work);
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
        FAKE_POLICIES: (scenario.policies || []).join("\n"),
        FAKE_GROUPS: (scenario.groups || []).join("\n"),
        FAKE_UNREADABLE_REGION: scenario.unreadableRegion || "",
      },
    },
  );

  expect(shell.error).toBeUndefined();
  // Every file the command leaves is the template it deploys.
  expect(fs.readdirSync(work)).toEqual([CLOUD_STREAM_TEMPLATE_FILE]);

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
    status: shell.status,
  };
}

function options(
  overrides: Partial<CloudStreamTemplateOptions>,
): CloudStreamTemplateOptions {
  return {
    connectionId: CONNECTION,
    metricsUrl: "https://oneuptime.com/telemetry/aws-firehose/v1/metrics",
    logsUrl: "https://oneuptime.com/telemetry/aws-firehose/v1/logs",
    metrics: CloudStreamMetricsMode.Key,
    logs: CloudStreamLogsMode.Off,
    ...overrides,
  };
}

function command(
  overrides: Partial<CloudStreamTemplateOptions>,
  regions: Array<string> = ["us-east-1", "eu-west-1"],
): string {
  return getAwsCloudStreamCommand({
    options: options(overrides),
    regions,
    streamKey: KEY,
  });
}

function groups(
  ...entries: Array<[string, string]>
): Array<CloudStreamLogGroup> {
  return entries.map(
    ([region, name]: [string, string]): CloudStreamLogGroup => {
      return { region, name };
    },
  );
}

// The Regions each deploy ran in, in order.
function deployedRegions(shell: ShellRun): Array<string> {
  return shell.calls
    .filter((call: Array<string>): boolean => {
      return call[1] === "cloudformation" && call[2] === "deploy";
    })
    .map((call: Array<string>): string => {
      return call[call.indexOf("--region") + 1]!;
    });
}

function callsOf(shell: ShellRun, operation: string): Array<Array<string>> {
  return shell.calls.filter((call: Array<string>): boolean => {
    return call[1] === "logs" && call[2] === operation;
  });
}

function flag(call: Array<string>, name: string): string {
  return call[call.indexOf(name) + 1]!;
}

describe("streaming every log group", () => {
  const ALL: Partial<CloudStreamTemplateOptions> = {
    logs: CloudStreamLogsMode.All,
  };

  test("with no other tool's subscription policy, it checks each Region and deploys in each", () => {
    const shell: ShellRun = run(command(ALL));

    expect(
      callsOf(shell, "describe-account-policies").map(
        (call: Array<string>): string => {
          return flag(call, "--region");
        },
      ),
    ).toEqual(["us-east-1", "eu-west-1"]);
    expect(deployedRegions(shell)).toEqual(["us-east-1", "eu-west-1"]);
    expect(shell.output).toEqual([]);
  });

  test("asks for subscription filter policies only, leaving its own out of the answer", () => {
    const call: Array<string> = callsOf(
      run(command(ALL)),
      "describe-account-policies",
    )[0]!;

    expect(flag(call, "--policy-type")).toBe("SUBSCRIPTION_FILTER_POLICY");
    expect(flag(call, "--query")).toBe(
      `accountPolicies[?policyName!='${OURS}'].policyName`,
    );
    expect(flag(call, "--output")).toBe("text");
  });

  test("a SIEM's policy in one Region stops it everywhere, naming the Region and the policy, and nothing is deployed", () => {
    const shell: ShellRun = run(command(ALL), {
      policies: ["eu-west-1 DatadogLogsSubscription"],
    });

    expect(deployedRegions(shell)).toEqual([]);
    expect(shell.output).toEqual([
      "eu-west-1: AWS allows one account-wide log subscription per Region, and DatadogLogsSubscription already holds it. Name the log groups to stream instead, or remove DatadogLogsSubscription.",
      CLOUD_STREAM_COMMAND_STOPPED,
    ]);
  });

  test("a re-run finds its own policy and updates it", () => {
    const shell: ShellRun = run(command(ALL), {
      policies: [`us-east-1 ${OURS}`, `eu-west-1 ${OURS}`],
    });

    expect(deployedRegions(shell)).toEqual(["us-east-1", "eu-west-1"]);
    expect(shell.output).toEqual([]);
  });

  test("another OneUptime connection streaming the same account holds the one policy too", () => {
    const shell: ShellRun = run(command(ALL), {
      policies: ["us-east-1 OneUptime-0a1b2c3d"],
    });

    expect(deployedRegions(shell)).toEqual([]);
    expect(shell.output[0]).toContain(
      "us-east-1: AWS allows one account-wide log subscription per Region, and OneUptime-0a1b2c3d already holds it.",
    );
  });

  test("a Region whose policies cannot be read is said, and nothing is deployed", () => {
    const shell: ShellRun = run(command(ALL), {
      unreadableRegion: "us-east-1",
    });

    expect(deployedRegions(shell)).toEqual([]);
    expect(shell.output).toEqual([
      "us-east-1: the account's log subscription policies could not be read.",
      CLOUD_STREAM_COMMAND_STOPPED,
    ]);
  });

  test("every Region's problem is said, not only the first", () => {
    const shell: ShellRun = run(command(ALL), {
      policies: [
        "us-east-1 SplunkSubscription",
        "eu-west-1 ElasticSubscription",
      ],
    });

    expect(shell.output).toHaveLength(3);
    expect(shell.output[0]).toContain("us-east-1:");
    expect(shell.output[1]).toContain("eu-west-1:");
  });
});

describe("streaming named log groups", () => {
  test("each group is checked in its own Region, and with room in each, every Region deploys", () => {
    const shell: ShellRun = run(
      command({
        logs: CloudStreamLogsMode.Groups,
        logGroups: groups(
          ["us-east-1", "/aws/lambda/checkout"],
          ["eu-west-1", "/aws/rds/instance/orders/error"],
        ),
      }),
      {
        groups: [
          "us-east-1 /aws/lambda/checkout -",
          "eu-west-1 /aws/rds/instance/orders/error SplunkForwarder",
        ],
      },
    );

    expect(
      callsOf(shell, "describe-subscription-filters").map(
        (call: Array<string>): string => {
          return `${flag(call, "--region")} ${flag(call, "--log-group-name")}`;
        },
      ),
    ).toEqual([
      "us-east-1 /aws/lambda/checkout",
      "eu-west-1 /aws/rds/instance/orders/error",
    ]);
    expect(deployedRegions(shell)).toEqual(["us-east-1", "eu-west-1"]);
    expect(shell.output).toEqual([]);
  });

  test(`a group with ${AWS_SUBSCRIPTION_FILTERS_PER_LOG_GROUP} filters of other tools stops it, naming the group and its Region`, () => {
    const shell: ShellRun = run(
      command({
        logs: CloudStreamLogsMode.Groups,
        logGroups: groups(["us-east-1", "/aws/lambda/checkout"]),
      }),
      {
        groups: [
          "us-east-1 /aws/lambda/checkout SplunkForwarder,DatadogForwarder",
        ],
      },
    );

    expect(deployedRegions(shell)).toEqual([]);
    expect(shell.output).toEqual([
      "/aws/lambda/checkout in us-east-1 already has 2 subscription filters, the most AWS allows. Remove one, or leave the group out.",
      CLOUD_STREAM_COMMAND_STOPPED,
    ]);
  });

  test("a group's own filter from an earlier run does not count: a re-run updates it", () => {
    const shell: ShellRun = run(
      command({
        logs: CloudStreamLogsMode.Groups,
        logGroups: groups(["us-east-1", "/aws/lambda/checkout"]),
      }),
      {
        groups: [
          `us-east-1 /aws/lambda/checkout SplunkForwarder,${getCloudStreamNames(CONNECTION).subscriptionFilter}`,
        ],
      },
    );

    expect(deployedRegions(shell)).toEqual(["us-east-1", "eu-west-1"]);
    expect(
      flag(callsOf(shell, "describe-subscription-filters")[0]!, "--query"),
    ).toBe(
      `length(subscriptionFilters[?filterName!='${getCloudStreamNames(CONNECTION).subscriptionFilter}'])`,
    );
  });

  test("a group that is not there is said: the stack would fail on it the same way", () => {
    const shell: ShellRun = run(
      command({
        logs: CloudStreamLogsMode.Groups,
        logGroups: groups(["us-east-1", "/aws/lambda/chekout"]),
      }),
      { groups: ["us-east-1 /aws/lambda/checkout -"] },
    );

    expect(deployedRegions(shell)).toEqual([]);
    expect(shell.output).toEqual([
      "/aws/lambda/chekout in us-east-1: no such log group, or it could not be read.",
      CLOUD_STREAM_COMMAND_STOPPED,
    ]);
  });

  test("names with the characters a log group may hold reach aws intact", () => {
    const name: string = "/team.orders/api#v2_prod-1";
    const shell: ShellRun = run(
      command({
        logs: CloudStreamLogsMode.Groups,
        logGroups: groups(["ap-south-1", name]),
      }),
      { groups: [`ap-south-1 ${name} -`] },
    );

    expect(
      flag(
        callsOf(shell, "describe-subscription-filters")[0]!,
        "--log-group-name",
      ),
    ).toBe(name);
    expect(shell.output).toEqual([]);
  });

  test("each full or missing group is said before it stops", () => {
    const shell: ShellRun = run(
      command({
        logs: CloudStreamLogsMode.Groups,
        logGroups: groups(
          ["us-east-1", "/a"],
          ["us-east-1", "/b"],
          ["us-east-1", "/c"],
        ),
      }),
      { groups: ["us-east-1 /a x,y", "us-east-1 /c -"] },
    );

    expect(shell.output).toEqual([
      "/a in us-east-1 already has 2 subscription filters, the most AWS allows. Remove one, or leave the group out.",
      "/b in us-east-1: no such log group, or it could not be read.",
      CLOUD_STREAM_COMMAND_STOPPED,
    ]);
  });
});

describe("streaming metrics alone", () => {
  test("checks nothing and deploys at once, as before", () => {
    const text: string = command({ logs: CloudStreamLogsMode.Off });
    const shell: ShellRun = run(text);

    expect(callsOf(shell, "describe-account-policies")).toEqual([]);
    expect(callsOf(shell, "describe-subscription-filters")).toEqual([]);
    expect(deployedRegions(shell)).toEqual(["us-east-1", "eu-west-1"]);
    expect(text).not.toContain("BLOCKED");
  });
});

describe("the command as a whole", () => {
  test("never exits: pasted into CloudShell, an exit would close the shell", () => {
    for (const logs of [
      CloudStreamLogsMode.All,
      CloudStreamLogsMode.Groups,
      CloudStreamLogsMode.Off,
    ]) {
      const text: string = command({
        logs,
        logGroups: groups(["us-east-1", "/aws/lambda/checkout"]),
      });

      expect(text).not.toMatch(/\bexit\b/);
    }
  });

  test("a stop leaves the shell running and says what to do", () => {
    const shell: ShellRun = run(command({ logs: CloudStreamLogsMode.All }), {
      policies: ["us-east-1 Other"],
    });

    expect(shell.status).toBe(0);
    expect(shell.output[shell.output.length - 1]).toBe(
      CLOUD_STREAM_COMMAND_STOPPED,
    );
  });
});
