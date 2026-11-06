import "./Helpers/TestSupport";
import assert from "assert";
import { describe, test } from "node:test";
import {
  ExecResult,
  ResourcePostureProbe,
} from "../Executors/ResourceExecutor";
import {
  GCP_CLOUD_PLATFORM_SCOPE,
  GCP_GET_ACCESS_TOKEN_PERMISSION,
  GCP_WRITE_TOKEN_LIFETIME_SECONDS,
} from "../Executors/Cloud/GcpIdentity";
import {
  FakeAnswer,
  GCP_GENERATE_ACCESS_TOKEN_URL,
  GCP_PROJECT,
  GCP_PROJECT_NUMBER,
  GCP_SERVICE_ACCOUNT,
  GCP_TEST_IAM_PERMISSIONS_URL,
  GCP_TOKEN,
  GCP_WRITE_SERVICE_ACCOUNT,
  GcpCall,
  jsonReply,
} from "./Helpers/FakeCloud";
import {
  CloudHarness,
  assertChanged,
  assertNotRun,
  cloudHarness,
  cloudRequest,
  outputLines,
  prepared,
  refusalOf,
  runCloud,
} from "./Helpers/CloudHarness";
import { readCloudDryRunVerdict } from "../Common/Utils/AiRemediation/Resource/CloudOperationCatalog";

/*
 * The Google Cloud AI agent's changes, as its setup command sets it up: the
 * agent's own service account (the one the metadata server signs in) only
 * reads, and each change runs as the write service account
 * (ONEUPTIME_AI_GCP_WRITE_SERVICE_ACCOUNT), with a token the agent asks IAM
 * Credentials for that one change and that lasts 15 minutes. Pinned against
 * the fake metadata server and Google's APIs:
 *
 *  - the token is asked for with the agent's own token, for the
 *    cloud-platform scope and 900 seconds, and never kept: each change asks
 *    for its own, and the change's reads and call carry it;
 *  - a token Google will not give (no Token Creator on the write account,
 *    or no write account) changes nothing, and says how to fix it;
 *  - a dry run reads as the agent's own account, and asks for no token;
 *  - a setting that is not a service account, or names another project's,
 *    refuses every change;
 *  - Test connection says which account changes run as, and whether the
 *    agent may ask for its token (testIamPermissions, which asks for none);
 *  - the posture names the write account, which marks its changes as the
 *    agent's own in the account's feed (CloudAiChangeAttribution);
 *  - an agent set up before (no write account) changes as its own account,
 *    as it did then.
 */

const P: string = GCP_PROJECT;
const COMPUTE: string = "https://compute.googleapis.com/compute/v1";
const VM: string = `//compute.googleapis.com/projects/${P}/zones/us-central1-a/instances/vm-1`;
const VM_URL: string = `${COMPUTE}/projects/${P}/zones/us-central1-a/instances/vm-1`;
const ZONE_OP_URL: string = `${COMPUTE}/projects/${P}/zones/us-central1-a/operations/operation-1`;
const WRITE_ENV: Record<string, string> = {
  ONEUPTIME_AI_GCP_WRITE_SERVICE_ACCOUNT: GCP_WRITE_SERVICE_ACCOUNT,
};
const AS_WRITE_ACCOUNT: string = `the write service account ${GCP_WRITE_SERVICE_ACCOUNT}, with a token for this change alone`;

/*
 * A stopped VM a start can be sent to, its operation RUNNING when started
 * and DONE when polled.
 */
function withStoppedVm(h: CloudHarness): void {
  h.gcp.handle("GET", VM_URL, (): FakeAnswer => {
    return jsonReply({ name: "vm-1", status: "TERMINATED", labels: {} });
  });
  h.gcp.handle("POST", `${VM_URL}/start`, (): FakeAnswer => {
    return jsonReply({
      kind: "compute#operation",
      name: "operation-1",
      status: "RUNNING",
    });
  });
  h.gcp.handle("GET", ZONE_OP_URL, (): FakeAnswer => {
    return jsonReply({
      kind: "compute#operation",
      name: "operation-1",
      status: "DONE",
    });
  });
}

function writeHarness(env: Record<string, string> = WRITE_ENV): CloudHarness {
  const h: CloudHarness = cloudHarness("gcp", { env });

  withStoppedVm(h);
  h.gcp.issueWriteTokens();
  return h;
}

function callsIn(h: CloudHarness): Array<string> {
  return h.gcp.calls.map((call: GcpCall): string => {
    return `${call.method} ${call.bare}`;
  });
}

describe("Google Cloud: each change runs as the write service account", () => {
  test("a 15-minute token of the write account, asked for with the agent's own token, signs the change's reads and its call", async () => {
    const h: CloudHarness = writeHarness();
    const lines: Array<string> = assertChanged(
      await runCloud(h, "gcp", `cloud start-instance ${VM}`),
      { state: "terminated" },
    );

    assert.strictEqual(
      lines[2],
      `API call: compute.instances.start (POST start), as ${AS_WRITE_ACCOUNT}.`,
    );
    assert.deepStrictEqual(callsIn(h), [
      `POST ${GCP_GENERATE_ACCESS_TOKEN_URL}`,
      `GET ${VM_URL}`,
      `POST ${VM_URL}/start`,
      `GET ${ZONE_OP_URL}`,
    ]);

    const [ask, ...change] = h.gcp.calls;

    // Asked with the token the metadata server gave the agent's own account.
    assert.strictEqual(ask!.authorization, `Bearer ${GCP_TOKEN}`);
    assert.deepStrictEqual(ask!.body, {
      scope: [GCP_CLOUD_PLATFORM_SCOPE],
      lifetime: "900s",
    });
    assert.strictEqual(GCP_WRITE_TOKEN_LIFETIME_SECONDS, 15 * 60);
    assert.strictEqual(
      GCP_CLOUD_PLATFORM_SCOPE,
      "https://www.googleapis.com/auth/cloud-platform",
    );

    for (const call of change) {
      assert.strictEqual(call.authorization, "Bearer ya29.write-1");
    }
  });

  test("no token is kept: each change asks for its own", async () => {
    const h: CloudHarness = writeHarness();

    await runCloud(h, "gcp", `cloud start-instance ${VM}`);
    await runCloud(h, "gcp", `cloud start-instance ${VM}`);

    assert.strictEqual(
      h.gcp.callsTo("POST", GCP_GENERATE_ACCESS_TOKEN_URL).length,
      2,
    );
    assert.deepStrictEqual(
      h.gcp.callsTo("POST", `${VM_URL}/start`).map((call: GcpCall) => {
        return call.authorization;
      }),
      ["Bearer ya29.write-1", "Bearer ya29.write-2"],
    );
    // The agent's own token is reused: the metadata server was asked once.
    assert.strictEqual(
      h.gcp.metadataRequests.filter((request: { url: string }): boolean => {
        return request.url.endsWith("/token");
      }).length,
      1,
    );
  });

  test("the agent's own account may not act as the write account (403): nothing is changed, and it says what grants it", async () => {
    const h: CloudHarness = writeHarness();

    h.gcp.handle("POST", GCP_GENERATE_ACCESS_TOKEN_URL, (): FakeAnswer => {
      return jsonReply(
        {
          error: {
            code: 403,
            message:
              "Permission 'iam.serviceAccounts.getAccessToken' denied on resource (or it may not exist).",
            status: "PERMISSION_DENIED",
          },
        },
        403,
      );
    });

    assertNotRun(
      await runCloud(h, "gcp", `cloud start-instance ${VM}`),
      /^The agent could not ask Google Cloud to sign in as the write service account oneuptime-ai-agent-write@shop-prod-1234\.iam\.gserviceaccount\.com for this change \(15 minutes\), so nothing was changed: Google Cloud refused to let the agent's own service account act as oneuptime-ai-agent-write@shop-prod-1234\.iam\.gserviceaccount\.com \(HTTP 403: Permission 'iam\.serviceAccounts\.getAccessToken' denied on resource \(or it may not exist\)\.\): the setup command grants it Service Account Token Creator \(roles\/iam\.serviceAccountTokenCreator\) on that account alone\. Run the setup command again\.$/,
    );
    // Nothing was read or sent as anyone else.
    assert.deepStrictEqual(callsIn(h), [
      `POST ${GCP_GENERATE_ACCESS_TOKEN_URL}`,
    ]);
  });

  test("a write account that is gone (404): nothing is changed, and the setup command makes it again", async () => {
    const h: CloudHarness = writeHarness();

    h.gcp.handle("POST", GCP_GENERATE_ACCESS_TOKEN_URL, (): FakeAnswer => {
      return jsonReply({ error: { code: 404, status: "NOT_FOUND" } }, 404);
    });

    assertNotRun(
      await runCloud(h, "gcp", `cloud start-instance ${VM}`),
      /so nothing was changed: the write service account oneuptime-ai-agent-write@shop-prod-1234\.iam\.gserviceaccount\.com does not exist \(HTTP 404\)\. Run the setup command again, which makes it\.$/,
    );
    assert.deepStrictEqual(h.gcp.callsTo("POST", `${VM_URL}/start`), []);
  });

  test("IAM failing to answer changes nothing, and says what it answered", async () => {
    const h: CloudHarness = writeHarness();

    h.gcp.handle("POST", GCP_GENERATE_ACCESS_TOKEN_URL, (): FakeAnswer => {
      return jsonReply(
        { error: { code: 500, message: "Internal error encountered." } },
        500,
      );
    });

    assertNotRun(
      await runCloud(h, "gcp", `cloud start-instance ${VM}`),
      /so nothing was changed: IAM answered HTTP 500: Internal error encountered\.$/,
    );
    assert.deepStrictEqual(h.gcp.callsTo("POST", `${VM_URL}/start`), []);
  });

  test("an answer without a usable token changes nothing", async () => {
    for (const body of [{}, { accessToken: "" }, { accessToken: "a\nb" }]) {
      const h: CloudHarness = writeHarness();

      h.gcp.handle("POST", GCP_GENERATE_ACCESS_TOKEN_URL, (): FakeAnswer => {
        return jsonReply(body);
      });

      assertNotRun(
        await runCloud(h, "gcp", `cloud start-instance ${VM}`),
        /so nothing was changed: IAM answered without a token of oneuptime-ai-agent-write@shop-prod-1234\.iam\.gserviceaccount\.com\.$/,
      );
      assert.deepStrictEqual(h.gcp.callsTo("POST", `${VM_URL}/start`), []);
    }
  });

  test("a permission the write account lacks is named for the write account", async () => {
    const h: CloudHarness = writeHarness();

    h.gcp.handle("POST", `${VM_URL}/start`, (): FakeAnswer => {
      return jsonReply(
        {
          error: {
            code: 403,
            message: "Required 'compute.instances.start' permission",
            status: "PERMISSION_DENIED",
          },
        },
        403,
      );
    });

    const result: ExecResult = await runCloud(
      h,
      "gcp",
      `cloud start-instance ${VM}`,
    );

    assert.strictEqual(result.exitCode, 1);
    assert.match(
      String(result.errorMessage),
      /\. The write service account oneuptime-ai-agent-write@shop-prod-1234\.iam\.gserviceaccount\.com lacks compute\.instances\.start on \/\/compute\.googleapis\.com\/projects\/shop-prod-1234\/zones\/us-central1-a\/instances\/vm-1: /,
    );
  });

  test("a dry run reads as the agent's own account, and asks for no token of the write account", async () => {
    const h: CloudHarness = writeHarness();
    const result: ExecResult = await runCloud(
      h,
      "gcp",
      `cloud dry-run start-instance ${VM}`,
    );

    assert.strictEqual(readCloudDryRunVerdict(result.output), "would-run");
    assert.deepStrictEqual(callsIn(h), [`GET ${VM_URL}`]);
    assert.strictEqual(h.gcp.calls[0]!.authorization, `Bearer ${GCP_TOKEN}`);
  });

  test("an agent set up before (no write account) changes as its own account, as it did then", async () => {
    const h: CloudHarness = writeHarness({});

    assertChanged(await runCloud(h, "gcp", `cloud start-instance ${VM}`), {
      state: "terminated",
    });
    assert.deepStrictEqual(
      h.gcp.callsTo("POST", GCP_GENERATE_ACCESS_TOKEN_URL),
      [],
    );

    for (const call of h.gcp.calls) {
      assert.strictEqual(call.authorization, `Bearer ${GCP_TOKEN}`);
    }
  });
});

describe("Google Cloud: the write account setting", () => {
  test("a value that is not a service account refuses every change, and never falls back to the agent's own account", async () => {
    for (const value of [
      "oneuptime-ai-agent-write",
      "oneuptime-ai-agent-write@shop-prod-1234.example.com",
      `${"a".repeat(40)}@shop-prod-1234.iam.gserviceaccount.com`,
    ]) {
      const h: CloudHarness = writeHarness({
        ONEUPTIME_AI_GCP_WRITE_SERVICE_ACCOUNT: value,
      });

      assert.match(
        refusalOf(h, "gcp", `cloud start-instance ${VM}`),
        /^Refused by the Cloud AI agent: ONEUPTIME_AI_GCP_WRITE_SERVICE_ACCOUNT=".*" is not a service account \(oneuptime-ai-agent-write@my-project\.iam\.gserviceaccount\.com\), so the agent changes nothing until it is fixed\.$/,
        value,
      );
      assert.deepStrictEqual(h.gcp.calls, [], value);
    }
  });

  test("a write account of another project refuses every change", () => {
    const h: CloudHarness = writeHarness({
      ONEUPTIME_AI_GCP_WRITE_SERVICE_ACCOUNT:
        "oneuptime-ai-agent-write@shop-staging-77.iam.gserviceaccount.com",
    });

    assert.strictEqual(
      refusalOf(h, "gcp", `cloud start-instance ${VM}`),
      "Refused by the Cloud AI agent: ONEUPTIME_AI_GCP_WRITE_SERVICE_ACCOUNT names a service account of project shop-staging-77, but the agent serves project shop-prod-1234, so it changes nothing. Set it to a service account of project shop-prod-1234.",
    );
  });

  test("an agent that serves its project by number: the write account of that project, by its id, is its own", async () => {
    const h: CloudHarness = cloudHarness("gcp", {
      env: WRITE_ENV,
      identity: GCP_PROJECT_NUMBER,
    });
    const byNumber: string = `//compute.googleapis.com/projects/${GCP_PROJECT_NUMBER}/zones/us-central1-a/instances/vm-1`;
    const byNumberUrl: string = `${COMPUTE}/projects/${GCP_PROJECT_NUMBER}/zones/us-central1-a/instances/vm-1`;

    h.gcp.handle("GET", byNumberUrl, (): FakeAnswer => {
      return jsonReply({ name: "vm-1", status: "TERMINATED", labels: {} });
    });
    h.gcp.handle("POST", `${byNumberUrl}/start`, (): FakeAnswer => {
      return jsonReply({ name: "operation-1", status: "DONE" });
    });
    h.gcp.issueWriteTokens();

    assertChanged(
      await runCloud(h, "gcp", `cloud start-instance ${byNumber}`, {
        payload: { resourceIdentifier: GCP_PROJECT_NUMBER },
      }),
      { state: "terminated" },
    );
    assert.strictEqual(
      h.gcp.callsTo("POST", GCP_GENERATE_ACCESS_TOKEN_URL).length,
      1,
    );
  });

  test("served by number, the write account of a project it does not run in is refused once the metadata server says so", async () => {
    const h: CloudHarness = cloudHarness("gcp", {
      env: {
        ONEUPTIME_AI_GCP_WRITE_SERVICE_ACCOUNT:
          "oneuptime-ai-agent-write@shop-staging-77.iam.gserviceaccount.com",
      },
      identity: GCP_PROJECT_NUMBER,
    });
    const byNumber: string = `//compute.googleapis.com/projects/${GCP_PROJECT_NUMBER}/zones/us-central1-a/instances/vm-1`;

    h.gcp.issueWriteTokens();

    assertNotRun(
      await runCloud(h, "gcp", `cloud start-instance ${byNumber}`, {
        payload: { resourceIdentifier: GCP_PROJECT_NUMBER },
      }),
      /^Refused by the Cloud AI agent: ONEUPTIME_AI_GCP_WRITE_SERVICE_ACCOUNT names a service account of project shop-staging-77, but the agent serves project 987654321012, so it changes nothing\. Set it to a service account of project 987654321012\.$/,
    );
    assert.deepStrictEqual(h.gcp.calls, []);
  });
});

describe("Google Cloud: Test connection and the posture name the write account", () => {
  test("Test connection: the account, its 15 minutes, and that the agent may ask for its token, asked without asking for one", async () => {
    const h: CloudHarness = writeHarness();

    h.gcp.handle("POST", GCP_TEST_IAM_PERMISSIONS_URL, (): FakeAnswer => {
      return jsonReply({ permissions: [GCP_GET_ACCESS_TOKEN_PERMISSION] });
    });

    const lines: Array<string> = outputLines(
      await runCloud(h, "gcp", "cloud whoami", { origin: "AiInvestigation" }),
    );

    assert.strictEqual(
      lines[3],
      `Write service account: ${GCP_WRITE_SERVICE_ACCOUNT}, whose token the agent asks for each change, for 15 minutes (the agent may ask for one: the agent's own account holds iam.serviceAccounts.getAccessToken on it)`,
    );
    assert.deepStrictEqual(callsIn(h), [`POST ${GCP_TEST_IAM_PERMISSIONS_URL}`]);
    assert.strictEqual(h.gcp.calls[0]!.authorization, `Bearer ${GCP_TOKEN}`);
    assert.deepStrictEqual(h.gcp.calls[0]!.body, {
      permissions: ["iam.serviceAccounts.getAccessToken"],
    });
  });

  test("Test connection: an agent that may not ask for it is told every change fails", async () => {
    for (const answer of [
      jsonReply({}),
      jsonReply({ error: { code: 404, message: "Not found" } }, 404),
    ]) {
      const h: CloudHarness = writeHarness();

      h.gcp.handle("POST", GCP_TEST_IAM_PERMISSIONS_URL, (): FakeAnswer => {
        return answer;
      });

      const lines: Array<string> = outputLines(
        await runCloud(h, "gcp", "cloud whoami", {
          origin: "AiInvestigation",
        }),
      );

      assert.match(
        lines[3] || "",
        /^Write service account: oneuptime-ai-agent-write@shop-prod-1234\.iam\.gserviceaccount\.com, whose token the agent asks for each change, for 15 minutes \(the agent may NOT ask for one, so every change fails: /,
      );
    }
  });

  test("Test connection without one, or with one that is not a service account", async () => {
    const none: Array<string> = outputLines(
      await runCloud(writeHarness({}), "gcp", "cloud whoami", {
        origin: "AiInvestigation",
      }),
    );

    assert.strictEqual(
      none[3],
      "Write service account: none (ONEUPTIME_AI_GCP_WRITE_SERVICE_ACCOUNT is not set): changes use the agent's own service account, with whatever it allows",
    );

    const wrong: Array<string> = outputLines(
      await runCloud(
        writeHarness({ ONEUPTIME_AI_GCP_WRITE_SERVICE_ACCOUNT: "nope" }),
        "gcp",
        "cloud whoami",
        { origin: "AiInvestigation" },
      ),
    );

    assert.strictEqual(
      wrong[3],
      'Write service account: ONEUPTIME_AI_GCP_WRITE_SERVICE_ACCOUNT="nope" is not a service account (oneuptime-ai-agent-write@my-project.iam.gserviceaccount.com), so the agent changes nothing until it is fixed.',
    );
  });

  test("the posture names the write account, and protects it as the agent's own", async () => {
    const h: CloudHarness = writeHarness();
    const probe: ResourcePostureProbe = await h.executor.probePosture();

    assert.strictEqual(
      probe.details?.["gcpWriteServiceAccount"],
      GCP_WRITE_SERVICE_ACCOUNT,
    );
    assert.strictEqual(probe.details?.["gcpServiceAccount"], GCP_SERVICE_ACCOUNT);
    assert.ok(
      (probe.protectedTargets || []).includes(
        `//iam.googleapis.com/projects/${P}/serviceAccounts/oneuptime-ai-agent-write@*`,
      ),
    );

    // Without one, the posture has none to name.
    const before: ResourcePostureProbe = await writeHarness(
      {},
    ).executor.probePosture();

    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(
        before.details || {},
        "gcpWriteServiceAccount",
      ),
      false,
    );
  });

  test("a setting that is not a service account is the posture's settings problem", async () => {
    const probe: ResourcePostureProbe = await writeHarness({
      ONEUPTIME_AI_GCP_WRITE_SERVICE_ACCOUNT: "nope",
    }).executor.probePosture();

    assert.match(
      String(probe.details?.["settingsProblem"]),
      /^ONEUPTIME_AI_GCP_WRITE_SERVICE_ACCOUNT="nope" is not a service account/,
    );
  });
});

/*
 * OneUptime said to stop (Enable AI was turned off while the agent held the
 * job): the job loop hands the command a stop reason (RunControl).
 */
describe("Google Cloud: a change told to stop", () => {
  test("before its call: the change is never sent, and nothing was changed", async () => {
    const h: CloudHarness = writeHarness();
    const result: ExecResult = await prepared(
      h.executor.prepare(cloudRequest("gcp", `cloud start-instance ${VM}`)),
    ).run({
      stopReason: (): string | null => {
        return "OneUptime AI was turned off for this project (Enable AI) while its agent held this command.";
      },
    });

    assertNotRun(
      result,
      /^The change was not sent, so nothing was changed: OneUptime AI was turned off for this project \(Enable AI\) while its agent held this command\.$/,
    );
    assert.deepStrictEqual(h.gcp.callsTo("POST", `${VM_URL}/start`), []);
  });

  test("after its call: the agent stops waiting for it, and says the change was sent", async () => {
    const h: CloudHarness = writeHarness();
    let stop: string | null = null;

    h.gcp.handle("POST", `${VM_URL}/start`, (): FakeAnswer => {
      // Told while the call was on its way: it was sent.
      stop = "Enable AI is off.";

      return jsonReply({ name: "operation-1", status: "RUNNING" });
    });

    const lines: Array<string> = assertChanged(
      await prepared(
        h.executor.prepare(cloudRequest("gcp", `cloud start-instance ${VM}`)),
      ).run({
        stopReason: (): string | null => {
          return stop;
        },
      }),
      { state: "terminated" },
    );

    assert.ok(
      lines.includes(
        "Google Cloud accepted the change and was still carrying it out when the agent stopped waiting (operation operation-1, RUNNING).",
      ),
      lines.join("\n"),
    );
    assert.deepStrictEqual(h.gcp.callsTo("GET", ZONE_OP_URL), []);
  });

  test("never told: the change runs and is followed as before", async () => {
    const h: CloudHarness = writeHarness();

    assertChanged(
      await prepared(
        h.executor.prepare(cloudRequest("gcp", `cloud start-instance ${VM}`)),
      ).run({
        stopReason: (): string | null => {
          return null;
        },
      }),
      { state: "terminated" },
    );
    assert.strictEqual(h.gcp.callsTo("GET", ZONE_OP_URL).length, 1);
  });
});
