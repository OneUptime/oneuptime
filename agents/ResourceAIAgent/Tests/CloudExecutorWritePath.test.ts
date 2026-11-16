import "./Helpers/TestSupport";
import assert from "assert";
import { describe, test } from "node:test";
import { ExecResult } from "../Executors/ResourceExecutor";
import { GCP_GET_ACCESS_TOKEN_PERMISSION } from "../Executors/Cloud/GcpIdentity";
import {
  AWS_WRITE_ROLE_ARN,
  AZURE_SUBSCRIPTION,
  AZURE_WRITE_IDENTITY,
  FakeAnswer,
  GCP_PROJECT,
  GCP_TEST_IAM_PERMISSIONS_URL,
  GCP_WRITE_SERVICE_ACCOUNT,
  awsQueryError,
  jsonReply,
} from "./Helpers/FakeCloud";
import {
  CloudHarness,
  cloudHarness,
  outputLines,
  runCloud,
} from "./Helpers/CloudHarness";
import { getAzureCloudAiAgentWriteIdentityId } from "../Common/Types/ResourceAiAgent/CloudAiAgentNames";
import {
  CLOUD_WRITE_PATH_PREFIX,
  CloudWritePath,
  readCloudDryRunVerdict,
  readCloudWritePath,
} from "../Common/Utils/AiRemediation/Resource/CloudOperationCatalog";

/*
 * `cloud whoami` - Test connection on a cloud account - starts its output
 * with one line the server reads: whether a change can run as the agent is
 * set up, through the write role (AWS), write identity (Azure) or write
 * account (Google Cloud) each change signs in as. Test connection used to
 * say "The connection works" whenever the read worked, though the whoami
 * line itself said every change fails; the server now says that in amber,
 * with what to fix (#6212). Pinned on each cloud, against the fake cloud:
 *
 *  - usable: the agent may sign in as it (the role assumed with a policy
 *    that allows nothing, the identity's token, testIamPermissions);
 *  - unset: there is none, and changes run as the agent's own identity, as
 *    an agent set up before does;
 *  - unusable, with why: the cloud refused it (cannot-sign-in), the
 *    setting names nothing the agent can use (unreadable-setting), or it
 *    names one of another account, subscription or project
 *    (another-account) - which the agent refuses every change for;
 *  - the line is the output's first, and the rest of whoami is as before;
 *    no other command's output starts with it.
 */

const SUB: string = AZURE_SUBSCRIPTION;
const OTHER_SUBSCRIPTION: string = "11111111-2222-4333-8444-555555555555";

async function whoami(
  h: CloudHarness,
  cloud: "aws" | "azure" | "gcp",
): Promise<{ result: ExecResult; lines: Array<string> }> {
  const result: ExecResult = await runCloud(h, cloud, "cloud whoami", {
    origin: "AiInvestigation",
  });

  assert.strictEqual(
    result.success,
    true,
    `whoami failed: ${String(result.errorMessage)}`,
  );
  assert.strictEqual(result.exitCode, 0);

  return { result, lines: outputLines(result) };
}

function assertWritePath(
  result: ExecResult,
  expected: CloudWritePath,
  lines: Array<string>,
): void {
  // The first line, and only the first, says it.
  assert.ok(
    (lines[0] || "").startsWith(CLOUD_WRITE_PATH_PREFIX),
    lines.join("\n"),
  );
  assert.strictEqual(
    lines.filter((line: string): boolean => {
      return line.startsWith(CLOUD_WRITE_PATH_PREFIX);
    }).length,
    1,
  );
  assert.deepStrictEqual(readCloudWritePath(result.output), expected);
  // What a person reads follows it, as whoami always wrote it.
  assert.match(lines[1] || "", /^Cloud: (AWS|Azure|Google Cloud)$/);
}

function lineStarting(lines: Array<string>, start: string): string {
  return (
    lines.find((line: string): boolean => {
      return line.startsWith(start);
    }) || ""
  );
}

function subscription(h: CloudHarness): CloudHarness {
  h.arm.handle("GET", `/subscriptions/${SUB}`, (): FakeAnswer => {
    return jsonReply({
      subscriptionId: SUB,
      displayName: "Shop production",
      state: "Enabled",
    });
  });

  return h;
}

describe("AWS: whoami's write-path line", () => {
  test("a write role it can assume: usable", async () => {
    const h: CloudHarness = cloudHarness("aws", { randomIds: ["aaaa1111"] });
    const { result, lines } = await whoami(h, "aws");

    assertWritePath(result, { state: "usable" }, lines);
  });

  test("one it may not assume: unusable, cannot-sign-in", async () => {
    const h: CloudHarness = cloudHarness("aws");

    h.aws.handle("sts:AssumeRole", (): FakeAnswer => {
      return awsQueryError("AccessDenied", "not authorized to assume it");
    });

    const { result, lines } = await whoami(h, "aws");

    assertWritePath(
      result,
      { state: "unusable", problem: "cannot-sign-in" },
      lines,
    );
    assert.match(
      lineStarting(lines, "Write role:"),
      /the agent could NOT assume it, so every change fails/,
    );
  });

  test("a setting that is not a role ARN: unusable, unreadable-setting, and nothing assumed", async () => {
    const h: CloudHarness = cloudHarness("aws", {
      env: { ONEUPTIME_AI_AWS_WRITE_ROLE_ARN: "nope" },
    });
    const { result, lines } = await whoami(h, "aws");

    assertWritePath(
      result,
      { state: "unusable", problem: "unreadable-setting" },
      lines,
    );
    assert.deepStrictEqual(h.aws.assumed, []);
  });

  test("a role of another account: unusable, another-account - said, and never assumed, as every change is refused", async () => {
    const other: string = AWS_WRITE_ROLE_ARN.replace(
      "123456789012",
      "210987654321",
    );
    const h: CloudHarness = cloudHarness("aws", {
      env: { ONEUPTIME_AI_AWS_WRITE_ROLE_ARN: other },
    });
    const { result, lines } = await whoami(h, "aws");

    assertWritePath(
      result,
      { state: "unusable", problem: "another-account" },
      lines,
    );
    assert.strictEqual(
      lineStarting(lines, "Write role:"),
      `Write role: ${other}, a role of account 210987654321: the agent serves account 123456789012, so it changes nothing. Set ONEUPTIME_AI_AWS_WRITE_ROLE_ARN to a role of account 123456789012`,
    );
    assert.deepStrictEqual(h.aws.assumed, []);
  });

  test("none: unset - its own credentials make the changes", async () => {
    const h: CloudHarness = cloudHarness("aws", {
      env: { ONEUPTIME_AI_AWS_WRITE_ROLE_ARN: "" },
    });
    const { result, lines } = await whoami(h, "aws");

    assertWritePath(result, { state: "unset" }, lines);
  });

  test("none, and credentials of another account: unusable, another-account", async () => {
    const h: CloudHarness = cloudHarness("aws", {
      env: { ONEUPTIME_AI_AWS_WRITE_ROLE_ARN: "" },
    });

    h.aws.callerAccount = "210987654321";

    const { result, lines } = await whoami(h, "aws");

    assertWritePath(
      result,
      { state: "unusable", problem: "another-account" },
      lines,
    );
  });
});

describe("Azure: whoami's write-path line", () => {
  test("a write identity it can sign in as: usable", async () => {
    const h: CloudHarness = subscription(
      cloudHarness("azure", {
        env: { ONEUPTIME_AI_AZURE_WRITE_IDENTITY: AZURE_WRITE_IDENTITY },
      }),
    );
    const { result, lines } = await whoami(h, "azure");

    assertWritePath(result, { state: "usable" }, lines);
  });

  test("one not attached where the agent runs: unusable, cannot-sign-in", async () => {
    const h: CloudHarness = subscription(
      cloudHarness("azure", {
        env: { ONEUPTIME_AI_AZURE_WRITE_IDENTITY: AZURE_WRITE_IDENTITY },
      }),
    );

    h.arm.attachedIdentities = [];

    const { result, lines } = await whoami(h, "azure");

    assertWritePath(
      result,
      { state: "unusable", problem: "cannot-sign-in" },
      lines,
    );
  });

  test("a setting that is not an identity's resource ID: unusable, unreadable-setting, and no token asked for", async () => {
    const h: CloudHarness = subscription(
      cloudHarness("azure", {
        env: { ONEUPTIME_AI_AZURE_WRITE_IDENTITY: "nope" },
      }),
    );
    const { result, lines } = await whoami(h, "azure");

    assertWritePath(
      result,
      { state: "unusable", problem: "unreadable-setting" },
      lines,
    );
    assert.deepStrictEqual(h.arm.writeTokenRequests, []);
  });

  test("an identity of another subscription: unusable, another-account, and no token asked for", async () => {
    const h: CloudHarness = subscription(
      cloudHarness("azure", {
        env: {
          ONEUPTIME_AI_AZURE_WRITE_IDENTITY:
            getAzureCloudAiAgentWriteIdentityId(OTHER_SUBSCRIPTION),
        },
      }),
    );
    const { result, lines } = await whoami(h, "azure");

    assertWritePath(
      result,
      { state: "unusable", problem: "another-account" },
      lines,
    );
    assert.deepStrictEqual(h.arm.writeTokenRequests, []);
  });

  test("none (an agent set up before): unset", async () => {
    const h: CloudHarness = subscription(cloudHarness("azure"));
    const { result, lines } = await whoami(h, "azure");

    assertWritePath(result, { state: "unset" }, lines);
  });
});

describe("Google Cloud: whoami's write-path line", () => {
  function gcpHarness(env: Record<string, string>): CloudHarness {
    return cloudHarness("gcp", { env });
  }

  test("a write account it may ask a token of: usable", async () => {
    const h: CloudHarness = gcpHarness({
      ONEUPTIME_AI_GCP_WRITE_SERVICE_ACCOUNT: GCP_WRITE_SERVICE_ACCOUNT,
    });

    h.gcp.handle("POST", GCP_TEST_IAM_PERMISSIONS_URL, (): FakeAnswer => {
      return jsonReply({ permissions: [GCP_GET_ACCESS_TOKEN_PERMISSION] });
    });

    const { result, lines } = await whoami(h, "gcp");

    assertWritePath(result, { state: "usable" }, lines);
  });

  test("one it may not: unusable, cannot-sign-in", async () => {
    const h: CloudHarness = gcpHarness({
      ONEUPTIME_AI_GCP_WRITE_SERVICE_ACCOUNT: GCP_WRITE_SERVICE_ACCOUNT,
    });

    h.gcp.handle("POST", GCP_TEST_IAM_PERMISSIONS_URL, (): FakeAnswer => {
      return jsonReply({});
    });

    const { result, lines } = await whoami(h, "gcp");

    assertWritePath(
      result,
      { state: "unusable", problem: "cannot-sign-in" },
      lines,
    );
  });

  test("a setting that is not a service account: unusable, unreadable-setting", async () => {
    const h: CloudHarness = gcpHarness({
      ONEUPTIME_AI_GCP_WRITE_SERVICE_ACCOUNT: "nope",
    });
    const { result, lines } = await whoami(h, "gcp");

    assertWritePath(
      result,
      { state: "unusable", problem: "unreadable-setting" },
      lines,
    );
  });

  test("a service account of another project: unusable, another-account - said, and never asked about", async () => {
    const other: string = GCP_WRITE_SERVICE_ACCOUNT.replace(
      GCP_PROJECT,
      "shop-staging-77",
    );
    const h: CloudHarness = gcpHarness({
      ONEUPTIME_AI_GCP_WRITE_SERVICE_ACCOUNT: other,
    });
    const { result, lines } = await whoami(h, "gcp");

    assertWritePath(
      result,
      { state: "unusable", problem: "another-account" },
      lines,
    );
    assert.strictEqual(
      lineStarting(lines, "Write service account:"),
      `Write service account: ${other}, a service account of project shop-staging-77: the agent serves project ${GCP_PROJECT}, so it changes nothing. Set ONEUPTIME_AI_GCP_WRITE_SERVICE_ACCOUNT to a service account of project ${GCP_PROJECT}`,
    );
    assert.strictEqual(
      h.gcp.calls.filter((call: { bare: string }): boolean => {
        return call.bare === GCP_TEST_IAM_PERMISSIONS_URL;
      }).length,
      0,
    );
  });

  test("none (an agent set up before): unset", async () => {
    const { result, lines } = await whoami(gcpHarness({}), "gcp");

    assertWritePath(result, { state: "unset" }, lines);
  });
});

describe("only whoami's output starts with it", () => {
  const VM: string = `/subscriptions/${SUB}/resourceGroups/prod/providers/Microsoft.Compute/virtualMachines/vm-1`;

  function withDeallocatedVm(h: CloudHarness): CloudHarness {
    h.arm.handle("GET", VM, (): FakeAnswer => {
      return jsonReply({
        id: VM,
        name: "vm-1",
        tags: {},
        properties: {
          instanceView: { statuses: [{ code: "PowerState/deallocated" }] },
        },
      });
    });
    h.arm.handle("POST", `${VM}/start`, (): FakeAnswer => {
      return jsonReply({});
    });

    return subscription(h);
  }

  test("a change starts with the value it replaced, and a dry run with its verdict: neither holds a write-path line", async () => {
    const env: Record<string, string> = {
      ONEUPTIME_AI_AZURE_WRITE_IDENTITY: AZURE_WRITE_IDENTITY,
    };
    const dryRun: ExecResult = await runCloud(
      withDeallocatedVm(cloudHarness("azure", { env })),
      "azure",
      `cloud dry-run start-instance ${VM}`,
    );
    const change: ExecResult = await runCloud(
      withDeallocatedVm(cloudHarness("azure", { env })),
      "azure",
      `cloud start-instance ${VM}`,
    );

    assert.strictEqual(readCloudDryRunVerdict(dryRun.output), "would-run");
    assert.strictEqual(change.success, true, change.errorMessage || "");
    assert.match(change.output, /^oneuptime-replaced-value: /);

    for (const result of [dryRun, change]) {
      assert.strictEqual(readCloudWritePath(result.output), null);
      assert.ok(!result.output.includes(CLOUD_WRITE_PATH_PREFIX));
    }
  });
});
