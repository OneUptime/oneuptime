import { spawnSync, SpawnSyncReturns } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, test } from "@jest/globals";
import { AWS_STREAM_TEMPLATE_VERSION } from "../../../Types/Cloud/CloudKeyMetrics";
import {
  CLOUD_STREAM_ORGANIZATION_UPDATING_MESSAGE,
  getAwsCloudStreamOrganizationUpdateCommand,
  getCloudStreamOrganizationWrongAccountMessage,
} from "../../../Types/CloudConnection/CloudStreamOrganization";
import {
  AwsStreamStack,
  CLOUD_STREAM_METRICS_ATTRIBUTE,
  CLOUD_STREAM_TEMPLATE_ATTRIBUTE,
  readAwsStreamStack,
} from "../../../Types/CloudConnection/CloudStreamStack";
import {
  CloudStreamLogsMode,
  CloudStreamMetricsMode,
  CloudStreamTemplateOptions,
  getAwsCloudStreamTemplate,
  getAwsCloudStreamUpdateCommand,
  getAwsCloudStreamUpdateProgram,
  getCloudStreamKeyMetricFilters,
  getCloudStreamNames,
} from "../../../Types/CloudConnection/CloudStreamTemplate";
import { JSONObject } from "../../../Types/JSON";

/*
 * #9693: a stack made from an older template is updated in place - its own
 * template read back from CloudFormation, its metric stream given today's
 * key-metric filters and its metrics Firehose stream today's common
 * attributes, then deployed with the parameters it has - so it keeps its
 * log groups and its key, and no new key is needed.
 *
 * The jq program and the commands are run here for real: jq on the
 * templates (AWS CloudShell has jq, and so does CI's runner), and the
 * commands in bash against a fake aws that keeps each Region's stack - and
 * the organization's StackSet - and answers as the AWS CLI does: get-template
 * with the template as JSON (the CLI decodes a JSON body), describe-stack-set
 * with it as a string.
 */

const CONNECTION: string = "6f1c3a2e-9b8d-4c7e-a1f0-2d3c4b5a6e7f";
const STACK: string = getCloudStreamNames(CONNECTION).stackName;
const MANAGEMENT: string = "111122223333";

function options(
  overrides: Partial<CloudStreamTemplateOptions> = {},
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

/*
 * Today's template as an older one was made: the key metrics of template 1,
 * and no common attributes - a stack made before templates said theirs.
 */
function olderTemplate(
  choices: CloudStreamTemplateOptions,
  templateAttributes?: Array<JSONObject>,
): JSONObject {
  const template: JSONObject = JSON.parse(
    JSON.stringify(getAwsCloudStreamTemplate(choices)),
  );
  const resources: JSONObject = template["Resources"] as JSONObject;
  const metricStream: JSONObject | undefined = resources["MetricStream"] as
    | JSONObject
    | undefined;
  const delivery: JSONObject | undefined = resources[
    "MetricsDeliveryStream"
  ] as JSONObject | undefined;

  if (
    metricStream &&
    (metricStream["Properties"] as JSONObject)["IncludeFilters"]
  ) {
    (metricStream["Properties"] as JSONObject)["IncludeFilters"] =
      getCloudStreamKeyMetricFilters(1) as unknown as JSONObject;
  }

  if (delivery) {
    const request: JSONObject = (
      (delivery["Properties"] as JSONObject)[
        "HttpEndpointDestinationConfiguration"
      ] as JSONObject
    )["RequestConfiguration"] as JSONObject;

    if (templateAttributes) {
      request["CommonAttributes"] = templateAttributes as unknown as JSONObject;
    } else {
      delete request["CommonAttributes"];
    }
  }

  return template;
}

// The program run by jq on a template as CloudFormation answers it.
function update(answer: string): JSONObject {
  const jq: SpawnSyncReturns<string> = spawnSync(
    "jq",
    ["-c", getAwsCloudStreamUpdateProgram()],
    { input: answer, encoding: "utf8" },
  );

  expect(jq.error).toBeUndefined();
  expect(jq.stderr).toBe("");
  expect(jq.status).toBe(0);

  return JSON.parse(jq.stdout) as JSONObject;
}

// What Firehose would say of the updated stack, from its metrics stream's attributes.
function stackSaid(template: JSONObject): AwsStreamStack {
  const delivery: JSONObject = (template["Resources"] as JSONObject)[
    "MetricsDeliveryStream"
  ] as JSONObject;
  const request: JSONObject = (
    (delivery["Properties"] as JSONObject)[
      "HttpEndpointDestinationConfiguration"
    ] as JSONObject
  )["RequestConfiguration"] as JSONObject;
  const common: Record<string, string> = {};

  for (const attribute of (request["CommonAttributes"] ||
    []) as unknown as Array<{
    AttributeName: string;
    AttributeValue: string;
  }>) {
    common[attribute.AttributeName] = attribute.AttributeValue;
  }

  return readAwsStreamStack(JSON.stringify({ commonAttributes: common }));
}

describe("the update's jq program", () => {
  const CHOICES: Array<[string, CloudStreamTemplateOptions]> = [
    ["the key metrics", options()],
    [
      "the key metrics and two named log groups, in two Regions",
      options({
        logs: CloudStreamLogsMode.Groups,
        logGroups: [
          { name: "/aws/lambda/checkout", region: "us-east-1" },
          { name: "/aws/lambda/billing", region: "eu-west-1" },
        ],
      }),
    ],
    [
      "the key metrics and every log group",
      options({ logs: CloudStreamLogsMode.All }),
    ],
  ];

  test.each(CHOICES)(
    "turns an older stack of %s into today's template for the same choices, its log subscriptions as they were",
    (_name: string, choices: CloudStreamTemplateOptions) => {
      const older: JSONObject = olderTemplate(choices);

      // get-template: the template as JSON. describe-stack-set: as a string.
      for (const answer of [
        JSON.stringify(older, null, 4),
        JSON.stringify(JSON.stringify(older)),
      ]) {
        expect(update(answer)).toEqual(getAwsCloudStreamTemplate(choices));
      }

      expect(stackSaid(update(JSON.stringify(older)))).toEqual({
        templateVersion: AWS_STREAM_TEMPLATE_VERSION,
        everyMetric: false,
      });
    },
  );

  test("gives a stream of every metric no filters, and says it streams every metric", () => {
    const choices: CloudStreamTemplateOptions = options({
      metrics: CloudStreamMetricsMode.All,
      logs: CloudStreamLogsMode.All,
    });
    const updated: JSONObject = update(JSON.stringify(olderTemplate(choices)));

    expect(updated).toEqual(getAwsCloudStreamTemplate(choices));
    expect(
      (
        ((updated["Resources"] as JSONObject)["MetricStream"] as JSONObject)[
          "Properties"
        ] as JSONObject
      )["IncludeFilters"],
    ).toBeUndefined();
    expect(stackSaid(updated)).toEqual({
      templateVersion: AWS_STREAM_TEMPLATE_VERSION,
      everyMetric: true,
    });
  });

  test("tells a stack of template 2 today's template", () => {
    const choices: CloudStreamTemplateOptions = options();
    const older: JSONObject = olderTemplate(choices, [
      { AttributeName: CLOUD_STREAM_TEMPLATE_ATTRIBUTE, AttributeValue: "2" },
      { AttributeName: CLOUD_STREAM_METRICS_ATTRIBUTE, AttributeValue: "key" },
    ]);

    expect(update(JSON.stringify(older))).toEqual(
      getAwsCloudStreamTemplate(choices),
    );
  });

  test("leaves a stack that streams no metrics as it was", () => {
    const logsOnly: JSONObject = getAwsCloudStreamTemplate(
      options({
        metrics: CloudStreamMetricsMode.Off,
        logs: CloudStreamLogsMode.All,
      }),
    );

    expect(update(JSON.stringify(logsOnly))).toEqual(logsOnly);
  });

  test("changes nothing else of the stack, however it was changed by hand", () => {
    const older: JSONObject = olderTemplate(options());
    const resources: JSONObject = older["Resources"] as JSONObject;
    ((resources["DeliveryLogGroup"] as JSONObject)["Properties"] as JSONObject)[
      "RetentionInDays"
    ] = 90;
    resources["SomethingOfTheirOwn"] = {
      Type: "AWS::SNS::Topic",
      Properties: { TopicName: "theirs" },
    };

    const updated: JSONObject = update(JSON.stringify(older));
    const updatedResources: JSONObject = updated["Resources"] as JSONObject;

    expect(updatedResources["SomethingOfTheirOwn"]).toEqual(
      resources["SomethingOfTheirOwn"],
    );
    expect(
      (
        (updatedResources["DeliveryLogGroup"] as JSONObject)[
          "Properties"
        ] as JSONObject
      )["RetentionInDays"],
    ).toBe(90);
    expect(
      (
        (updatedResources["MetricStream"] as JSONObject)[
          "Properties"
        ] as JSONObject
      )["IncludeFilters"],
    ).toEqual(getCloudStreamKeyMetricFilters());
  });
});

/*
 * The fake aws keeps each stack's template in $STACKS/<Region>.json and the
 * StackSet's in $STACKS/stack-set.json, records each call (arguments apart
 * by \037, calls by \036), and answers as the AWS CLI does.
 */
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
  case "$1 $2" in
    "sts get-caller-identity")
      echo "$FAKE_ACCOUNT"
      return 0 ;;
    "cloudformation get-template")
      if [ ! -f "$STACKS/$region.json" ]; then
        echo "An error occurred (ValidationError) when calling the GetTemplate operation: Stack with id $(flag_value --stack-name "$@") does not exist" >&2
        return 254
      fi
      jq . "$STACKS/$region.json"
      return 0 ;;
    "cloudformation deploy")
      for arg in "$@"; do case "$arg" in --parameter-overrides) echo "deploy was given parameters" >&2; return 255 ;; esac; done
      cp "$(flag_value --template-file "$@")" "$STACKS/$region.json"
      return 0 ;;
    "cloudformation describe-stack-set")
      if [ ! -f "$STACKS/stack-set.json" ]; then
        echo "An error occurred (StackSetNotFoundException) when calling the DescribeStackSet operation" >&2
        return 254
      fi
      jq -c . "$STACKS/stack-set.json" | jq -R .
      return 0 ;;
    "cloudformation update-stack-set")
      body=$(flag_value --template-body "$@")
      cp "${"$"}{body#file://}" "$STACKS/stack-set.json"
      echo '{"OperationId": "1"}'
      return 0 ;;
  esac
  echo "The fake aws does not answer $1 $2" >&2
  return 255
}
`;

const DIRECTORIES: Array<string> = [];

afterAll(() => {
  for (const directory of DIRECTORIES) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

interface UpdateRun {
  output: Array<string>;
  errors: string;
  calls: Array<Array<string>>;
  // What each Region's stack - and the StackSet - holds after the run.
  stacks: Record<string, JSONObject>;
}

function runUpdate(data: {
  command: string;
  // What each Region's stack - "stack-set" for the StackSet - holds before.
  stacks: Record<string, JSONObject>;
  account?: string;
}): UpdateRun {
  const directory: string = fs.mkdtempSync(
    path.join(os.tmpdir(), "cloud-stream-update-"),
  );
  const work: string = path.join(directory, "home");
  const stacks: string = path.join(directory, "stacks");
  const calls: string = path.join(directory, "calls");

  DIRECTORIES.push(directory);
  fs.mkdirSync(work);
  fs.mkdirSync(stacks);
  fs.writeFileSync(calls, "");

  for (const [name, template] of Object.entries(data.stacks)) {
    fs.writeFileSync(
      path.join(stacks, `${name}.json`),
      JSON.stringify(template),
    );
  }

  const shell: SpawnSyncReturns<string> = spawnSync(
    "bash",
    ["-c", `${FAKE_AWS}\n${data.command}`],
    {
      cwd: work,
      encoding: "utf8",
      env: {
        PATH: process.env["PATH"] || "/usr/bin:/bin",
        CALLS: calls,
        STACKS: stacks,
        FAKE_ACCOUNT: data.account || MANAGEMENT,
      },
    },
  );

  expect(shell.error).toBeUndefined();

  const after: Record<string, JSONObject> = {};

  for (const file of fs.readdirSync(stacks)) {
    after[file.replace(/\.json$/u, "")] = JSON.parse(
      fs.readFileSync(path.join(stacks, file), "utf8"),
    ) as JSONObject;
  }

  return {
    output: shell.stdout.split("\n").filter((line: string): boolean => {
      return line.length > 0;
    }),
    errors: shell.stderr,
    calls: fs
      .readFileSync(calls, "utf8")
      .split("\u001e")
      .filter((call: string): boolean => {
        return call.length > 0;
      })
      .map((call: string): Array<string> => {
        return call.split("\u001f").slice(0, -1);
      }),
    stacks: after,
  };
}

describe("the update command of one account", () => {
  test("updates each Region's stack in place: today's filters and attributes, its log groups as they were, no key given", () => {
    const choices: CloudStreamTemplateOptions = options({
      logs: CloudStreamLogsMode.Groups,
      logGroups: [{ name: "/aws/lambda/checkout", region: "us-east-1" }],
    });
    const run: UpdateRun = runUpdate({
      command: getAwsCloudStreamUpdateCommand({
        connectionId: CONNECTION,
        regions: ["us-east-1", "eu-west-1"],
      }),
      stacks: {
        "us-east-1": olderTemplate(choices),
        "eu-west-1": olderTemplate(choices),
      },
    });

    expect(run.errors).toBe("");
    expect(run.stacks).toEqual({
      "us-east-1": getAwsCloudStreamTemplate(choices),
      "eu-west-1": getAwsCloudStreamTemplate(choices),
    });

    const deploys: Array<Array<string>> = run.calls.filter(
      (call: Array<string>): boolean => {
        return call[2] === "deploy";
      },
    );

    expect(deploys).toHaveLength(2);

    for (const deploy of deploys) {
      expect(deploy).toContain(STACK);
      expect(deploy).toContain("CAPABILITY_IAM");
      expect(deploy).toContain("--no-fail-on-empty-changeset");
      // The stack keeps its key: no parameter is given.
      expect(deploy.join(" ")).not.toContain("StreamKey");
    }
  });

  test("a Region without the stack says so in AWS's words, deploys nothing, and the next goes on", () => {
    const run: UpdateRun = runUpdate({
      command: getAwsCloudStreamUpdateCommand({
        connectionId: CONNECTION,
        regions: ["ap-south-1", "us-east-1"],
      }),
      stacks: { "us-east-1": olderTemplate(options()) },
    });

    expect(run.errors).toContain(`Stack with id ${STACK} does not exist`);
    expect(Object.keys(run.stacks)).toEqual(["us-east-1"]);
    expect(run.stacks["us-east-1"]).toEqual(
      getAwsCloudStreamTemplate(options()),
    );
    expect(
      run.calls
        .filter((call: Array<string>): boolean => {
          return call[2] === "deploy";
        })
        .map((call: Array<string>): string => {
          return call[call.indexOf("--region") + 1]!;
        }),
    ).toEqual(["us-east-1"]);
  });

  test("names each Region once, and CloudShell's own when none is known", () => {
    const named: string = getAwsCloudStreamUpdateCommand({
      connectionId: CONNECTION,
      regions: ["us-east-1", " US-EAST-1 ", "not-a-region", "eu-west-1"],
    });

    expect(named).toContain("for REGION in us-east-1 eu-west-1; do");
    expect(
      getAwsCloudStreamUpdateCommand({ connectionId: CONNECTION, regions: [] }),
    ).toContain('for REGION in "${AWS_REGION:-us-east-1}"; do');
  });
});

describe("the update command of an organization", () => {
  test("updates the StackSet - every member account's stacks - with its key as it was, then the management account's own", () => {
    const choices: CloudStreamTemplateOptions = options({
      logs: CloudStreamLogsMode.All,
    });
    const run: UpdateRun = runUpdate({
      command: getAwsCloudStreamOrganizationUpdateCommand({
        connectionId: CONNECTION,
        regions: ["us-east-1"],
        managementAccountId: MANAGEMENT,
      }),
      stacks: {
        "stack-set": olderTemplate(choices),
        "us-east-1": olderTemplate(choices),
      },
    });

    expect(run.errors).toBe("");
    expect(run.stacks).toEqual({
      "stack-set": getAwsCloudStreamTemplate(choices),
      "us-east-1": getAwsCloudStreamTemplate(choices),
    });
    expect(run.output).toContain(CLOUD_STREAM_ORGANIZATION_UPDATING_MESSAGE);

    const stackSetUpdate: Array<string> = run.calls.find(
      (call: Array<string>): boolean => {
        return call[2] === "update-stack-set";
      },
    )!;

    expect(stackSetUpdate).toContain(
      "ParameterKey=StreamKey,UsePreviousValue=true",
    );
    expect(stackSetUpdate).toContain("CAPABILITY_IAM");
    expect(stackSetUpdate[stackSetUpdate.indexOf("--region") + 1]).toBe(
      "us-east-1",
    );
  });

  test("without the StackSet, updates the management account's own stacks only", () => {
    const run: UpdateRun = runUpdate({
      command: getAwsCloudStreamOrganizationUpdateCommand({
        connectionId: CONNECTION,
        regions: ["us-east-1"],
        managementAccountId: MANAGEMENT,
      }),
      stacks: { "us-east-1": olderTemplate(options()) },
    });

    expect(run.errors).toBe("");
    expect(run.stacks).toEqual({
      "us-east-1": getAwsCloudStreamTemplate(options()),
    });
    expect(run.output).not.toContain(
      CLOUD_STREAM_ORGANIZATION_UPDATING_MESSAGE,
    );
  });

  test("in another account's shell, says where to run it and changes nothing", () => {
    const older: JSONObject = olderTemplate(options());
    const run: UpdateRun = runUpdate({
      command: getAwsCloudStreamOrganizationUpdateCommand({
        connectionId: CONNECTION,
        regions: ["us-east-1"],
        managementAccountId: MANAGEMENT,
      }),
      stacks: { "stack-set": older, "us-east-1": older },
      account: "444455556666",
    });

    expect(run.output).toEqual([
      getCloudStreamOrganizationWrongAccountMessage(MANAGEMENT),
    ]);
    expect(run.stacks).toEqual({ "stack-set": older, "us-east-1": older });
  });
});
