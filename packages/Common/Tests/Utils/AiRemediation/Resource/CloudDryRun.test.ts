import {
  CLOUD_DRY_RUN_OPERATION,
  CLOUD_DRY_RUN_OPERATION_NAME,
  CLOUD_DRY_RUN_PREFIX,
  CLOUD_OPERATIONS,
  CLOUD_OPERATION_NAMES,
  CLOUD_PROGRAM,
  CloudCatalogProvider,
  CloudCommandParse,
  ParsedCloudCommand,
  formatCloudDryRunVerdict,
  formatCloudReplacedValue,
  getCloudReadCommandGuide,
  getCloudUndoCommand,
  getCloudWriteCommandGuide,
  isCloudChangeOperation,
  isCloudDryRun,
  parseCloudCommand,
  readCloudDryRunVerdict,
  readCloudReplacedValue,
  withoutCloudDryRunVerdict,
} from "../../../../Utils/AiRemediation/Resource/CloudOperationCatalog";
import {
  ResourceCommandPolicyResult,
  tokenizeResourceCommand,
} from "../../../../Utils/AiRemediation/Resource/ResourceCommandPolicyCore";
import ResourceCommandPolicy from "../../../../Utils/AiRemediation/Resource/ResourceCommandPolicy";
import AiResourceType from "../../../../Types/ResourceAiAgent/AiResourceType";
import { ResourceCommandTier } from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test — a DRY RUN of a cloud change, `cloud dry-run <change>
 * RESOURCE [--flag value]`, as the catalog's grammar, the cloud command
 * policy and the verdict lines read it:
 *
 *  - the change after "dry-run" is read by the same grammar, so a dry run
 *    is refused for every reason the change would be, and its canonical
 *    argv is "dry-run" and the change's own, re-parsing to itself;
 *  - it is CLOUD_DRY_RUN_OPERATION, a Read that runs on the agent and is no
 *    change: nothing that does not know dry runs can take it for one (no
 *    undo, no write target), and it is not in CLOUD_OPERATIONS, so every
 *    list of what the agent can do stays as it was;
 *  - a dry run of a read, of whoami or of another dry run is refused, and
 *    so is a --dry-run flag written out of CLI habit, saying how to write it;
 *  - the verdict line is the first line of a dry run's answer, read with
 *    indexOf and strictly;
 *  - the guides tell OneUptime AI to check a change with a dry run first.
 */

const ECS: string = "arn:aws:ecs:us-east-1:123456789012:service/prod/web";
const EC2: string =
  "arn:aws:ec2:us-east-1:123456789012:instance/i-0abc1234def567890";
const ASG: string =
  "arn:aws:autoscaling:us-east-1:123456789012:autoScalingGroup:0e9d8c7b-6a5f-4e3d-2c1b-0a9f8e7d6c5b:autoScalingGroupName/web-asg";
const SITE: string =
  "/subscriptions/00000000-0000-0000-0000-0000000000ab/resourceGroups/prod/providers/Microsoft.Web/sites/web";
const RUN: string =
  "//run.googleapis.com/projects/my-project/locations/us-central1/services/web";

const TYPES: Readonly<Record<CloudCatalogProvider, AiResourceType>> = {
  aws: AiResourceType.AwsAccount,
  azure: AiResourceType.AzureSubscription,
  gcp: AiResourceType.GoogleCloudProject,
};

function argv(command: string): Array<string> {
  const words: Array<string> | undefined =
    tokenizeResourceCommand(command).argv;

  if (!words) {
    throw new Error(`could not tokenize ${command}`);
  }

  return words;
}

function parsed(
  provider: CloudCatalogProvider,
  command: string,
): ParsedCloudCommand {
  const parse: CloudCommandParse = parseCloudCommand(provider, argv(command));

  if (!parse.ok) {
    throw new Error(`expected ${command} to parse: ${parse.errorMessage}`);
  }

  return parse.command;
}

function refusal(provider: CloudCatalogProvider, command: string): string {
  const parse: CloudCommandParse = parseCloudCommand(provider, argv(command));

  if (parse.ok) {
    throw new Error(`expected ${command} to be refused`);
  }

  return parse.errorMessage;
}

describe("the dry-run operation", () => {
  test("is a Read that runs on the agent, takes the change's resource, and is no change", () => {
    expect(CLOUD_DRY_RUN_OPERATION.name).toBe("dry-run");
    expect(CLOUD_DRY_RUN_OPERATION_NAME).toBe("dry-run");
    expect(CLOUD_DRY_RUN_OPERATION.runsOn).toBe("agent");
    expect(CLOUD_DRY_RUN_OPERATION.takesResource).toBe(true);
    expect(CLOUD_DRY_RUN_OPERATION.undo).toBeNull();
    expect(isCloudChangeOperation(CLOUD_DRY_RUN_OPERATION)).toBe(false);
  });

  test("is not one of the catalog's operations: every list of what the agent can do is unchanged", () => {
    expect(CLOUD_OPERATION_NAMES).not.toContain("dry-run");
    expect(
      CLOUD_OPERATIONS.some((operation: { name: string }): boolean => {
        return operation.name === "dry-run";
      }),
    ).toBe(false);
  });
});

describe("the grammar of a dry run", () => {
  test("reads the change after dry-run with the same grammar, as a Read on its resource", () => {
    const command: ParsedCloudCommand = parsed(
      "aws",
      `cloud dry-run scale-out ${ECS} --count 4`,
    );

    expect(isCloudDryRun(command)).toBe(true);
    expect(command.operation).toBe(CLOUD_DRY_RUN_OPERATION);
    expect(command.kindSpec.tier).toBe(ResourceCommandTier.Read);
    expect(command.kindSpec.requiresHuman).toBe(false);
    expect(command.kindSpec.kind).toBe("ecs-service");
    expect(command.kindSpec.apiCall).toContain(
      "the agent stops before ecs:UpdateService",
    );
    expect(command.resource?.id).toBe(ECS);
    expect(command.flags).toEqual({ count: 4 });
    expect(command.canonicalArgs).toEqual([
      "dry-run",
      "scale-out",
      ECS,
      "--count",
      "4",
    ]);

    const change: ParsedCloudCommand = command.dryRunOf!;

    expect(change.operation.name).toBe("scale-out");
    expect(change.kindSpec.tier).toBe(ResourceCommandTier.SafeWrite);
    expect(change.canonicalArgs).toEqual(["scale-out", ECS, "--count", "4"]);
  });

  test("keeps the change's tier and its always-a-person on the change, never on the dry run", () => {
    const command: ParsedCloudCommand = parsed(
      "aws",
      `cloud dry-run stop-instance ${EC2}`,
    );

    expect(command.kindSpec.tier).toBe(ResourceCommandTier.Read);
    expect(command.kindSpec.requiresHuman).toBe(false);
    expect(command.dryRunOf?.kindSpec.tier).toBe(
      ResourceCommandTier.RiskyWrite,
    );
    expect(command.dryRunOf?.kindSpec.requiresHuman).toBe(true);
  });

  test("its canonical argv re-parses to itself, on every cloud", () => {
    for (const [provider, command] of [
      ["aws", `cloud dry-run scale-in ${ASG} --count=2`],
      ["aws", `cloud dry-run roll-back-service ${ECS} --to web:41`],
      ["azure", `cloud dry-run roll-back-service ${SITE} --slot staging`],
      ["azure", `cloud dry-run restart-service ${SITE}`],
      ["gcp", `cloud dry-run scale-out ${RUN} --count 3`],
    ] as Array<[CloudCatalogProvider, string]>) {
      const first: ParsedCloudCommand = parsed(provider, command);
      const again: ParsedCloudCommand = parsed(
        provider,
        [CLOUD_PROGRAM, ...first.canonicalArgs].join(" "),
      );

      expect(again.canonicalArgs).toEqual(first.canonicalArgs);
      expect(again.dryRunOf?.canonicalArgs).toEqual(
        first.dryRunOf?.canonicalArgs,
      );
    }
  });

  test("is refused for every reason its change would be", () => {
    expect(refusal("aws", `cloud dry-run scale-out ${ECS}`)).toMatch(
      /^the dry run's change is refused: cloud scale-out needs --count N/,
    );
    expect(refusal("aws", `cloud dry-run scale-out ${ECS} --count 0`)).toMatch(
      /^the dry run's change is refused: --count must be a whole number/,
    );
    expect(refusal("aws", "cloud dry-run delete-instance i-123")).toMatch(
      /^the dry run's change is refused: "delete-instance" is not available: deleting, terminating or purging anything is never available/,
    );
    expect(refusal("aws", `cloud dry-run scale-out ${EC2} --count 2`)).toMatch(
      /^the dry run's change is refused: cloud scale-out is not available for a EC2 instance/,
    );
    expect(refusal("aws", `cloud dry-run restart-service ${SITE}`)).toMatch(
      /^the dry run's change is refused: an AWS resource is named by its ARN/,
    );
  });

  test("names the change to check when none is given, with the cloud's changes", () => {
    expect(refusal("aws", "cloud dry-run")).toMatch(
      /^name the change to check: "cloud dry-run <change> RESOURCE \[--flag value\]", the change exactly as it would run; the changes on AWS are restart-service, start-instance, scale-out, scale-in, reboot-instance, roll-back-service, set-concurrency, fail-over-database, stop-instance, redrive-queue$/,
    );
    expect(refusal("gcp", "cloud dry-run")).not.toMatch(/redrive-queue/);
  });

  test("a read, whoami or another dry run has nothing to dry-run", () => {
    expect(refusal("aws", `cloud dry-run describe ${ECS}`)).toBe(
      "cloud describe changes nothing, so it has nothing to dry-run: run it as it is",
    );
    expect(refusal("aws", "cloud dry-run whoami")).toBe(
      "cloud whoami changes nothing, so it has nothing to dry-run: run it as it is",
    );
    expect(
      refusal("aws", `cloud dry-run dry-run scale-out ${ECS} --count 4`),
    ).toMatch(/^a dry run checks one change, never another dry run/);
    expect(refusal("aws", `cloud dry-run --count 4 scale-out ${ECS}`)).toMatch(
      /^the change comes right after "dry-run", before any flag/,
    );
  });

  test("--dry-run out of CLI habit says how a dry run is written", () => {
    expect(
      refusal("aws", `cloud scale-out ${ECS} --count 4 --dry-run true`),
    ).toBe(
      'a dry run is a command of its own: write "cloud dry-run scale-out RESOURCE ...", the change exactly as it would run, without --dry-run',
    );
    expect(refusal("aws", `cloud describe ${ECS} --dry-run true`)).toBe(
      "cloud describe changes nothing, so it has nothing to dry-run: run it without --dry-run",
    );
  });

  test("a dry run has no undo of its own", () => {
    expect(
      getCloudUndoCommand({
        command: parsed("aws", `cloud dry-run scale-out ${ECS} --count 4`),
        replaced: { count: "2" },
      }).kind,
    ).toBe("nothing");
  });
});

describe("the cloud command policy reads a dry run as a Read", () => {
  test.each([
    ["aws", `cloud dry-run scale-out ${ECS} --count 4`],
    ["aws", `cloud dry-run stop-instance ${EC2}`],
    ["azure", `cloud dry-run restart-service ${SITE}`],
    ["gcp", `cloud dry-run scale-out ${RUN} --count 3`],
  ] as Array<[CloudCatalogProvider, string]>)(
    "%s: %s",
    (provider: CloudCatalogProvider, command: string) => {
      const result: ResourceCommandPolicyResult =
        ResourceCommandPolicy.evaluateCommand({
          resourceType: TYPES[provider],
          command,
        });

      expect(result.tier).toBe(ResourceCommandTier.Read);
      expect(result.verb).toBe("dry-run");
      // No write target: a dry run changes nothing anywhere.
      expect(result.targets).toEqual([]);
      expect(result.requiresHuman).toBeUndefined();
      expect(result.reason).toMatch(
        /^cloud dry-run [a-z-]+ changes nothing: the Cloud AI agent checks that change on one .+ as it would make it and reads the value it would replace, then stops before .+$/,
      );
      expect(result.displayCommand.startsWith("cloud dry-run ")).toBe(true);
    },
  );

  test("a dry run of a change the policy denies is Denied, with the change's reason", () => {
    const result: ResourceCommandPolicyResult =
      ResourceCommandPolicy.evaluateCommand({
        resourceType: AiResourceType.AwsAccount,
        command: "cloud dry-run terminate i-0abc1234def567890",
      });

    expect(result.tier).toBe(ResourceCommandTier.Denied);
    expect(result.reason).toMatch(/"terminate" is not available/);
  });

  test("an investigation may run it: it is Read on every cloud", () => {
    for (const provider of [
      "aws",
      "azure",
      "gcp",
    ] as Array<CloudCatalogProvider>) {
      const command: string =
        provider === "aws"
          ? `cloud dry-run restart-service ${ECS}`
          : provider === "azure"
            ? `cloud dry-run restart-service ${SITE}`
            : `cloud dry-run scale-out ${RUN} --count 2`;

      expect(
        ResourceCommandPolicy.evaluateCommand({
          resourceType: TYPES[provider],
          command,
        }).tier,
      ).toBe(ResourceCommandTier.Read);
    }
  });
});

describe("a dry run's verdict line", () => {
  test("is written as JSON after its prefix, and read back", () => {
    expect(formatCloudDryRunVerdict("would-run")).toBe(
      'oneuptime-dry-run: {"verdict":"would-run"}',
    );
    expect(CLOUD_DRY_RUN_PREFIX).toBe("oneuptime-dry-run: ");
    expect(
      readCloudDryRunVerdict(
        `${formatCloudDryRunVerdict("would-be-refused")}\nwhy`,
      ),
    ).toBe("would-be-refused");
    expect(readCloudDryRunVerdict(formatCloudDryRunVerdict("would-run"))).toBe(
      "would-run",
    );
  });

  test("is read from the FIRST line only, and strictly", () => {
    expect(
      readCloudDryRunVerdict(`ok\n${formatCloudDryRunVerdict("would-run")}`),
    ).toBeNull();
    expect(
      readCloudDryRunVerdict('oneuptime-dry-run: {"verdict":"maybe"}'),
    ).toBeNull();
    expect(readCloudDryRunVerdict("oneuptime-dry-run: not json")).toBeNull();
    expect(
      readCloudDryRunVerdict('oneuptime-dry-run: ["would-run"]'),
    ).toBeNull();
    expect(readCloudDryRunVerdict(undefined)).toBeNull();
    expect(readCloudDryRunVerdict(42)).toBeNull();
    expect(
      readCloudDryRunVerdict(
        `oneuptime-dry-run: {"verdict":"would-run","x":"${"y".repeat(3000)}"}`,
      ),
    ).toBeNull();
  });

  test("withoutCloudDryRunVerdict leaves the replaced value first, as the undo reads it", () => {
    const output: string = [
      formatCloudDryRunVerdict("would-run"),
      formatCloudReplacedValue({ count: "2" }),
      "Dry run: nothing was changed.",
    ].join("\n");

    expect(readCloudReplacedValue(output)).toEqual({});
    expect(readCloudReplacedValue(withoutCloudDryRunVerdict(output))).toEqual({
      count: "2",
    });
    expect(withoutCloudDryRunVerdict("plain output")).toBe("plain output");
    expect(
      withoutCloudDryRunVerdict(formatCloudDryRunVerdict("would-run")),
    ).toBe("");
  });

  test("reads a long answer in time that grows with it (indexOf, no regex)", () => {
    const output: string = `${formatCloudDryRunVerdict("would-run")}\n${"x".repeat(400_000)}`;
    const timed: FastestRun<string | null> = fastestRun({
      run: (): string | null => {
        withoutCloudDryRunVerdict(output);
        return readCloudDryRunVerdict(output);
      },
      limitInMs: 2000,
    });

    expect(timed.result).toBe("would-run");
    expect(timed.inMs).toBeLessThan(2000);
    expect(withoutCloudDryRunVerdict(output).length).toBe(400_000);
  });
});

describe("the guides", () => {
  test.each(["aws", "azure", "gcp"] as Array<CloudCatalogProvider>)(
    "%s: the read guide offers the dry run, and the write guide asks for it before a change",
    (provider: CloudCatalogProvider) => {
      expect(getCloudReadCommandGuide(provider)).toContain(
        "`cloud dry-run <change> RESOURCE [--flag value]`: checks one change the way the agent would make it and reads the value it would replace, without making it. It asks the Cloud AI agent and changes nothing",
      );
      expect(getCloudWriteCommandGuide(provider)).toContain(
        "Before you propose or make a change, check it with `cloud dry-run <change> RESOURCE [--flag value]`, a read that changes nothing",
      );
    },
  );
});
