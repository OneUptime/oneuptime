import "./Helpers/TestSupport";
import assert from "assert";
import { describe, test } from "node:test";
import {
  ExecResult,
  ResourcePostureProbe,
} from "../Executors/ResourceExecutor";
import { CloudHttpRequest } from "../Executors/Cloud/CloudHttp";
import {
  FakeAnswer,
  GCP_METADATA,
  GCP_PROJECT,
  GCP_PROJECT_NUMBER,
  GCP_SERVICE_ACCOUNT,
  GCP_TOKEN,
  GcpCall,
  jsonReply,
  reply,
} from "./Helpers/FakeCloud";
import {
  CloudHarness,
  assertChanged,
  assertNotRun,
  cloudHarness,
  outputLines,
  refusalOf,
  runCloud,
} from "./Helpers/CloudHarness";
import { readCloudReplacedValue } from "../Common/Utils/AiRemediation/Resource/CloudOperationCatalog";

/*
 * The Google Cloud AI agent against a fake metadata server and fake
 * Compute Engine, Cloud Run and Cloud SQL APIs: the service account's
 * token, each change as the ONE call it maps to (URL, update mask, body),
 * the operation it follows, and how each failure reads.
 */

const P: string = GCP_PROJECT;
const COMPUTE: string = "https://compute.googleapis.com/compute/v1";
const VM: string = `//compute.googleapis.com/projects/${P}/zones/us-central1-a/instances/vm-1`;
const VM_URL: string = `${COMPUTE}/projects/${P}/zones/us-central1-a/instances/vm-1`;
const ZONE_OP_URL: string = `${COMPUTE}/projects/${P}/zones/us-central1-a/operations/operation-1`;
const MIG: string = `//compute.googleapis.com/projects/${P}/zones/us-central1-a/instanceGroupManagers/web-mig`;
const MIG_URL: string = `${COMPUTE}/projects/${P}/zones/us-central1-a/instanceGroupManagers/web-mig`;
const RMIG: string = `//compute.googleapis.com/projects/${P}/regions/us-central1/instanceGroupManagers/web-rmig`;
const RMIG_URL: string = `${COMPUTE}/projects/${P}/regions/us-central1/instanceGroupManagers/web-rmig`;
const REGION_OP_URL: string = `${COMPUTE}/projects/${P}/regions/us-central1/operations/operation-1`;
const RUN: string = `//run.googleapis.com/projects/${P}/locations/us-central1/services/web`;
const RUN_URL: string = `https://run.googleapis.com/v2/projects/${P}/locations/us-central1/services/web`;
const RUN_OP: string = `projects/${P}/locations/us-central1/operations/op-1`;
const SQL: string = `//cloudsql.googleapis.com/projects/${P}/instances/orders`;
const SQL_URL: string = `https://sqladmin.googleapis.com/v1/projects/${P}/instances/orders`;
const SQL_OP_URL: string = `https://sqladmin.googleapis.com/v1/projects/${P}/operations/op-sql-1`;
const IDENTITY: string = `the service account ${GCP_SERVICE_ACCOUNT}`;

// A Compute operation that is RUNNING, then DONE (or failed) when polled.
function computeOperation(
  h: CloudHarness,
  pollUrl: string,
  error?: string,
): FakeAnswer {
  h.gcp.handle("GET", pollUrl, (): FakeAnswer => {
    return jsonReply({
      kind: "compute#operation",
      name: "operation-1",
      status: "DONE",
      ...(error
        ? {
            error: { errors: [{ code: "RESOURCE_NOT_READY", message: error }] },
          }
        : {}),
    });
  });

  return jsonReply({
    kind: "compute#operation",
    name: "operation-1",
    status: "RUNNING",
  });
}

function runOperation(h: CloudHarness): FakeAnswer {
  h.gcp.handle(
    "GET",
    `https://run.googleapis.com/v2/${RUN_OP}`,
    (): FakeAnswer => {
      return jsonReply({ name: RUN_OP, done: true, response: {} });
    },
  );

  return jsonReply({ name: RUN_OP, done: false, metadata: {} });
}

function runService(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name: `projects/${P}/locations/us-central1/services/web`,
    labels: {},
    scaling: { minInstanceCount: 1 },
    template: { scaling: { maxInstanceCount: 10 } },
    traffic: [{ type: "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST", percent: 100 }],
    trafficStatuses: [
      { type: "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST", percent: 100 },
    ],
    latestReadyRevision: `projects/${P}/locations/us-central1/services/web/revisions/web-00042-abc`,
    ...overrides,
  };
}

function withService(
  h: CloudHarness,
  overrides: Record<string, unknown> = {},
): void {
  h.gcp.handle("GET", RUN_URL, (): FakeAnswer => {
    return jsonReply(runService(overrides));
  });
  h.gcp.handle("PATCH", RUN_URL, (): FakeAnswer => {
    return runOperation(h);
  });
}

describe("Google Cloud: the metadata server", () => {
  test("the token is asked for with Metadata-Flavor: Google and reused; every call carries it", async () => {
    const h: CloudHarness = cloudHarness("gcp");

    h.gcp.handle("GET", VM_URL, (): FakeAnswer => {
      return jsonReply({ name: "vm-1", status: "RUNNING", labels: {} });
    });
    h.gcp.handle("POST", `${VM_URL}/reset`, (): FakeAnswer => {
      return computeOperation(h, ZONE_OP_URL);
    });

    await runCloud(h, "gcp", `cloud reboot-instance ${VM}`);
    await runCloud(h, "gcp", `cloud reboot-instance ${VM}`);

    const tokens: Array<CloudHttpRequest> = h.gcp.metadataRequests.filter(
      (request: CloudHttpRequest): boolean => {
        return request.url.endsWith("/token");
      },
    );

    assert.strictEqual(tokens.length, 1);
    assert.strictEqual(
      tokens[0]?.url,
      `${GCP_METADATA}/instance/service-accounts/default/token`,
    );
    assert.strictEqual(tokens[0]?.headers["Metadata-Flavor"], "Google");

    for (const call of h.gcp.calls) {
      assert.strictEqual(call.authorization, `Bearer ${GCP_TOKEN}`);
    }
  });

  test("an answer without Metadata-Flavor: Google is not believed", async () => {
    const h: CloudHarness = cloudHarness("gcp");

    h.cloud.on(
      "GET",
      `${GCP_METADATA}/instance/service-accounts/default/token`,
      (): FakeAnswer => {
        return jsonReply({ access_token: "spoofed", expires_in: 3600 });
      },
    );

    assertNotRun(
      await runCloud(h, "gcp", `cloud reboot-instance ${VM}`),
      /^The agent could not ask Google Cloud to sign the agent in \(the metadata server\), so nothing was changed: what answered instance\/service-accounts\/default\/token is not Google's metadata server \(no Metadata-Flavor: Google\), so the agent does not believe it\.$/,
    );
    assert.deepStrictEqual(h.gcp.calls, []);
  });

  test("no service account attached (404): never ran, and says so", async () => {
    const h: CloudHarness = cloudHarness("gcp");

    h.cloud.on(
      "GET",
      `${GCP_METADATA}/instance/service-accounts/default/token`,
      (): FakeAnswer => {
        return reply(404, "Not Found", { "Metadata-Flavor": "Google" });
      },
    );

    assertNotRun(
      await runCloud(h, "gcp", `cloud reboot-instance ${VM}`),
      /the metadata server answered instance\/service-accounts\/default\/token with HTTP 404: the agent has no service account attached/,
    );
  });
});

describe("Google Cloud: whoami", () => {
  test("the project, its number and the service account", async () => {
    const h: CloudHarness = cloudHarness("gcp");
    const result: ExecResult = await runCloud(h, "gcp", "cloud whoami", {
      origin: "AiInvestigation",
    });

    assert.deepStrictEqual(outputLines(result), [
      "Cloud: Google Cloud",
      `Project: ${P} (number ${GCP_PROJECT_NUMBER})`,
      `Signed in as: ${IDENTITY}`,
      "Changes: allowed (ONEUPTIME_AI_ALLOW_WRITES=true)",
      "Enabled changes: start-instance, scale-out, scale-in, reboot-instance, roll-back-service, set-concurrency, fail-over-database, stop-instance (every change of the catalog: ONEUPTIME_AI_CLOUD_OPERATIONS is not set)",
      "Required tag: none (ONEUPTIME_AI_CLOUD_REQUIRED_TAG is not set)",
    ]);
  });

  test("an agent serving another project than it runs in says where it runs", async () => {
    const h: CloudHarness = cloudHarness("gcp", {
      identity: "shop-staging-77",
    });
    const lines: Array<string> = outputLines(
      await runCloud(h, "gcp", "cloud whoami", {
        origin: "AiInvestigation",
        payload: { resourceIdentifier: "shop-staging-77" },
      }),
    );

    assert.strictEqual(lines[1], "Project: shop-staging-77");
    assert.strictEqual(
      lines[3],
      `Runs in: project ${P} (number ${GCP_PROJECT_NUMBER}); it changes project shop-staging-77, where its service account needs the roles of its changes`,
    );
  });
});

describe("Google Cloud: Compute Engine VMs", () => {
  const setup: (
    status: string,
    labels?: Record<string, string>,
  ) => CloudHarness = (
    status: string,
    labels: Record<string, string> = {},
  ): CloudHarness => {
    const h: CloudHarness = cloudHarness("gcp", {
      env: { ONEUPTIME_AI_CLOUD_REQUIRED_TAG: "OneUptime-AI=Allow" },
    });

    h.gcp.handle("GET", VM_URL, (): FakeAnswer => {
      return jsonReply({
        name: "vm-1",
        status,
        labels: { "oneuptime-ai": "allow", ...labels },
      });
    });

    for (const action of ["start", "stop", "reset"]) {
      h.gcp.handle("POST", `${VM_URL}/${action}`, (): FakeAnswer => {
        return computeOperation(h, ZONE_OP_URL);
      });
    }

    return h;
  };

  test("start-instance on a stopped VM: POST start, the zone's operation followed; labels compared lowercased", async () => {
    const h: CloudHarness = setup("TERMINATED");
    const lines: Array<string> = assertChanged(
      await runCloud(h, "gcp", `cloud start-instance ${VM}`),
      { state: "terminated" },
    );

    assert.deepStrictEqual(lines.slice(1), [
      "VM vm-1 (zone us-central1-a): TERMINATED → RUNNING.",
      `API call: compute.instances.start (POST start), as ${IDENTITY}.`,
      "Google Cloud carried the change out (operation operation-1).",
      `To undo it: cloud stop-instance ${VM}`,
    ]);
    assert.deepStrictEqual(
      h.gcp.calls.map((call: GcpCall): string => {
        return `${call.method} ${call.bare}`;
      }),
      [`GET ${VM_URL}`, `POST ${VM_URL}/start`, `GET ${ZONE_OP_URL}`],
    );
    assert.deepStrictEqual(h.clock.sleeps, [2000]);
  });

  test("stop-instance and reboot-instance (reset) on a running VM", async () => {
    const stop: CloudHarness = setup("RUNNING");

    assertChanged(await runCloud(stop, "gcp", `cloud stop-instance ${VM}`), {
      state: "running",
    });
    assert.strictEqual(stop.gcp.callsTo("POST", `${VM_URL}/stop`).length, 1);

    const reset: CloudHarness = setup("RUNNING");
    const lines: Array<string> = assertChanged(
      await runCloud(reset, "gcp", `cloud reboot-instance ${VM}`),
      {},
    );

    assert.strictEqual(
      lines[1],
      "VM vm-1 (zone us-central1-a): reset — a hard restart, like pressing its reset button.",
    );
    assert.strictEqual(reset.gcp.callsTo("POST", `${VM_URL}/reset`).length, 1);
  });

  test("the VM's status decides; a VM without the required label is refused", async () => {
    assertNotRun(
      await runCloud(setup("RUNNING"), "gcp", `cloud start-instance ${VM}`),
      /the VM vm-1 is RUNNING, and cloud start-instance needs it stopped \(TERMINATED\)/,
    );
    assertNotRun(
      await runCloud(
        setup("RUNNING", { "oneuptime-ai": "deny" }),
        "gcp",
        `cloud stop-instance ${VM}`,
      ),
      /the agent only changes resources that carry the label OneUptime-AI=Allow/,
    );
  });

  test("an operation that fails fails the command, as a change that ran", async () => {
    const h: CloudHarness = cloudHarness("gcp");

    h.gcp.handle("GET", VM_URL, (): FakeAnswer => {
      return jsonReply({ name: "vm-1", status: "TERMINATED" });
    });
    h.gcp.handle("POST", `${VM_URL}/start`, (): FakeAnswer => {
      return computeOperation(
        h,
        ZONE_OP_URL,
        "The zone does not have enough resources",
      );
    });

    const result: ExecResult = await runCloud(
      h,
      "gcp",
      `cloud start-instance ${VM}`,
    );

    assert.strictEqual(result.exitCode, 1);
    assert.deepStrictEqual(readCloudReplacedValue(result.output), {
      state: "terminated",
    });
    assert.strictEqual(
      result.errorMessage,
      "Exit code 1: Google Cloud accepted the change, then its operation operation-1 failed: The zone does not have enough resources.",
    );
  });

  test("a change the service account may not make: exit code 1, naming the permission and what the change needs", async () => {
    const h: CloudHarness = cloudHarness("gcp");

    h.gcp.handle("GET", VM_URL, (): FakeAnswer => {
      return jsonReply({ name: "vm-1", status: "RUNNING" });
    });
    h.gcp.handle("POST", `${VM_URL}/stop`, (): FakeAnswer => {
      return jsonReply(
        {
          error: {
            code: 403,
            message:
              "Required 'compute.instances.stop' permission for 'projects/shop-prod-1234/zones/us-central1-a/instances/vm-1'",
            status: "PERMISSION_DENIED",
          },
        },
        403,
      );
    });

    const result: ExecResult = await runCloud(
      h,
      "gcp",
      `cloud stop-instance ${VM}`,
    );

    assert.strictEqual(result.exitCode, 1);
    assert.match(
      String(result.errorMessage),
      /^Exit code 1: Google Cloud refused compute\.instances\.stop \(HTTP 403 PERMISSION_DENIED\): Required 'compute\.instances\.stop' permission .*\. The service account oneuptime-ai-agent@shop-prod-1234\.iam\.gserviceaccount\.com lacks compute\.instances\.stop on \/\/compute\.googleapis\.com\/projects\/shop-prod-1234\/zones\/us-central1-a\/instances\/vm-1: the setup command's custom role grants it when stop-instance is in ONEUPTIME_AI_CLOUD_OPERATIONS \(cloud stop-instance on a Compute Engine VM needs compute\.instances\.stop, compute\.instances\.get\)\.$/,
    );
  });
});

describe("Google Cloud: managed instance groups", () => {
  const setup: (
    url: string,
    group: Record<string, unknown>,
    opUrl: string,
  ) => CloudHarness = (
    url: string,
    group: Record<string, unknown>,
    opUrl: string,
  ): CloudHarness => {
    const h: CloudHarness = cloudHarness("gcp");

    h.gcp.handle("GET", url, (): FakeAnswer => {
      return jsonReply({
        name: "web-mig",
        targetSize: 3,
        status: { isStable: true },
        ...group,
      });
    });
    h.gcp.handle("POST", `${url}/resize`, (): FakeAnswer => {
      return computeOperation(h, opUrl);
    });
    return h;
  };

  test("scale-out of a zonal group: resize?size=N, at most double", async () => {
    const h: CloudHarness = setup(MIG_URL, {}, ZONE_OP_URL);
    const lines: Array<string> = assertChanged(
      await runCloud(h, "gcp", `cloud scale-out ${MIG} --count 6`),
      { count: "3" },
    );

    assert.strictEqual(
      lines[1],
      "Managed instance group web-mig (zone us-central1-a): target size 3 → 6.",
    );
    assert.strictEqual(
      lines[lines.length - 1],
      `To undo it: cloud scale-in ${MIG} --count 3`,
    );
    assert.deepStrictEqual(
      h.gcp.callsTo("POST", `${MIG_URL}/resize`)[0]?.query,
      { size: "6" },
    );

    assertNotRun(
      await runCloud(
        setup(MIG_URL, {}, ZONE_OP_URL),
        "gcp",
        `cloud scale-out ${MIG} --count 7`,
      ),
      /--count 7 is above 6, the most the managed instance group may run \(double its target size of 3/,
    );
  });

  test("a regional group is resized, and its operation followed, in its region", async () => {
    const h: CloudHarness = setup(RMIG_URL, {}, REGION_OP_URL);

    assertChanged(
      await runCloud(h, "gcp", `cloud scale-in ${RMIG} --count 2`),
      { count: "3" },
    );
    assert.deepStrictEqual(
      h.gcp.calls.map((call: GcpCall): string => {
        return `${call.method} ${call.bare}`;
      }),
      [`GET ${RMIG_URL}`, `POST ${RMIG_URL}/resize`, `GET ${REGION_OP_URL}`],
    );
  });

  test("a group its autoscaler sizes is left alone; a group carries no labels, so a required tag refuses it", async () => {
    assertNotRun(
      await runCloud(
        setup(
          MIG_URL,
          {
            status: {
              autoscaler: `${COMPUTE}/projects/${P}/zones/us-central1-a/autoscalers/web`,
            },
          },
          ZONE_OP_URL,
        ),
        "gcp",
        `cloud scale-out ${MIG} --count 4`,
      ),
      /is sized by its autoscaler, which would undo a resize: change the autoscaler's limits instead/,
    );

    const tagged: CloudHarness = cloudHarness("gcp", {
      env: { ONEUPTIME_AI_CLOUD_REQUIRED_TAG: "oneuptime-ai=allow" },
    });

    tagged.gcp.handle("GET", MIG_URL, (): FakeAnswer => {
      return jsonReply({ name: "web-mig", targetSize: 3 });
    });
    assertNotRun(
      await runCloud(tagged, "gcp", `cloud scale-out ${MIG} --count 4`),
      /and a managed instance group cannot carry one, so it does not change \/\/compute\.googleapis\.com\/projects\/shop-prod-1234\/zones\/us-central1-a\/instanceGroupManagers\/web-mig/,
    );
  });
});

describe("Google Cloud: Cloud Run", () => {
  test("scale-out raises the service's minimum instances, within its maximum", async () => {
    const h: CloudHarness = cloudHarness("gcp");

    withService(h);

    const lines: Array<string> = assertChanged(
      await runCloud(h, "gcp", `cloud scale-out ${RUN} --count 2`),
      { count: "1" },
    );

    assert.deepStrictEqual(lines.slice(1), [
      "Cloud Run service web (us-central1): minimum instances 1 → 2 (at most 10).",
      `API call: run.services.patch of scaling.minInstanceCount (updateMask=scaling.minInstanceCount, minInstanceCount=2), as ${IDENTITY}.`,
      `Google Cloud carried the change out (operation ${RUN_OP}).`,
      `To undo it: cloud scale-in ${RUN} --count 1`,
    ]);

    const patch: GcpCall | undefined = h.gcp.callsTo("PATCH", RUN_URL)[0];

    assert.deepStrictEqual(patch?.query, {
      updateMask: "scaling.minInstanceCount",
    });
    assert.deepStrictEqual(patch?.body, { scaling: { minInstanceCount: 2 } });
    assert.strictEqual(
      h.gcp.callsTo("GET", `https://run.googleapis.com/v2/${RUN_OP}`).length,
      1,
    );

    assertNotRun(
      await runCloud(h, "gcp", `cloud scale-out ${RUN} --count 11`),
      /--count 11 is above 10, the most the Cloud Run service may run \(its maximum instances\)/,
    );
  });

  test("scale-in lowers the minimum instances, never below 1", async () => {
    const h: CloudHarness = cloudHarness("gcp");

    withService(h, { scaling: { minInstanceCount: 4 } });

    const lines: Array<string> = assertChanged(
      await runCloud(h, "gcp", `cloud scale-in ${RUN} --count 1`),
      { count: "4" },
    );

    assert.strictEqual(
      lines[1],
      "Cloud Run service web (us-central1): minimum instances 4 → 1 (at most 10).",
    );
    assert.strictEqual(
      lines[lines.length - 1],
      `To undo it: cloud scale-out ${RUN} --count 4`,
    );
    assert.deepStrictEqual(h.gcp.callsTo("PATCH", RUN_URL)[0]?.body, {
      scaling: { minInstanceCount: 1 },
    });
  });

  test("from zero minimum instances the scale is bounded by the maximum, and cannot be undone exactly (scale-in never goes to 0)", async () => {
    const h: CloudHarness = cloudHarness("gcp");

    withService(h, { scaling: {} });

    const lines: Array<string> = assertChanged(
      await runCloud(h, "gcp", `cloud scale-out ${RUN} --count 3`),
      { count: "0" },
    );

    assert.match(
      lines[lines.length - 1] || "",
      /^It cannot be undone exactly: the undo of cloud scale-out could not be written: --count must be a whole number from 1 to 1000/,
    );

    const unbounded: CloudHarness = cloudHarness("gcp");

    withService(unbounded, { scaling: {}, template: {} });
    assertNotRun(
      await runCloud(unbounded, "gcp", `cloud scale-out ${RUN} --count 3`),
      /minimum instance count is 0, and nothing bounds a scale out from zero/,
    );

    const manual: CloudHarness = cloudHarness("gcp");

    withService(manual, {
      scaling: { scalingMode: "MANUAL", manualInstanceCount: 3 },
    });
    assertNotRun(
      await runCloud(manual, "gcp", `cloud scale-out ${RUN} --count 4`),
      /uses manual scaling, which has no minimum instance count to change/,
    );
  });

  test("set-concurrency sets the template's maximum instances (a new revision); none clears it", async () => {
    const h: CloudHarness = cloudHarness("gcp");

    withService(h, { template: { scaling: { maxInstanceCount: 100 } } });

    const lines: Array<string> = assertChanged(
      await runCloud(h, "gcp", `cloud set-concurrency ${RUN} --value 20`),
      { value: "100" },
    );

    assert.strictEqual(
      lines[1],
      "Cloud Run service web (us-central1): maximum instances 100 → 20, in a new revision.",
    );
    assert.strictEqual(
      lines[lines.length - 1],
      `To undo it: cloud set-concurrency ${RUN} --value 100`,
    );
    assert.deepStrictEqual(h.gcp.callsTo("PATCH", RUN_URL)[0]?.query, {
      updateMask: "template.scaling.maxInstanceCount",
    });
    assert.deepStrictEqual(h.gcp.callsTo("PATCH", RUN_URL)[0]?.body, {
      template: { scaling: { maxInstanceCount: 20 } },
    });

    const clear: CloudHarness = cloudHarness("gcp");

    withService(clear, {
      template: { scaling: { maxInstanceCount: 100 } },
      traffic: [
        {
          type: "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION",
          revision: "web-00041-xyz",
          percent: 100,
        },
      ],
    });

    const cleared: Array<string> = assertChanged(
      await runCloud(clear, "gcp", `cloud set-concurrency ${RUN} --value none`),
      { value: "100" },
    );

    assert.deepStrictEqual(clear.gcp.callsTo("PATCH", RUN_URL)[0]?.body, {
      template: { scaling: {} },
    });
    assert.ok(
      cleared.includes(
        "Its traffic goes to a named revision rather than the latest, so the new revision serves no traffic until traffic moves to it.",
      ),
    );

    const already: CloudHarness = cloudHarness("gcp");

    withService(already, { template: {} });
    assertNotRun(
      await runCloud(
        already,
        "gcp",
        `cloud set-concurrency ${RUN} --value none`,
      ),
      /maximum instances is already none/,
    );
  });

  const rollbackSetup: (overrides?: Record<string, unknown>) => CloudHarness = (
    overrides: Record<string, unknown> = {},
  ): CloudHarness => {
    const h: CloudHarness = cloudHarness("gcp");

    withService(h, overrides);
    h.gcp.handle("GET", `${RUN_URL}/revisions`, (call: GcpCall): FakeAnswer => {
      return call.query["pageToken"]
        ? jsonReply({
            revisions: [
              {
                name: `projects/${P}/locations/us-central1/services/web/revisions/web-00040-def`,
                createTime: "2026-10-20T10:00:00Z",
              },
            ],
          })
        : jsonReply({
            revisions: [
              {
                name: `projects/${P}/locations/us-central1/services/web/revisions/web-00042-abc`,
                createTime: "2026-10-27T10:00:00Z",
              },
              {
                name: `projects/${P}/locations/us-central1/services/web/revisions/web-00041-xyz`,
                createTime: "2026-10-25T10:00:00Z",
              },
            ],
            nextPageToken: "page-2",
          });
    });
    return h;
  };

  test("roll-back-service moves all traffic to the revision created before the serving one", async () => {
    const h: CloudHarness = rollbackSetup();
    const lines: Array<string> = assertChanged(
      await runCloud(h, "gcp", `cloud roll-back-service ${RUN}`),
      { version: "web-00042-abc" },
    );

    assert.strictEqual(
      lines[1],
      "Cloud Run service web (us-central1): traffic web-00042-abc → web-00041-xyz (100%). New deployments get no traffic until traffic moves back to the latest revision.",
    );
    assert.strictEqual(
      lines[lines.length - 1],
      `To undo it: cloud roll-back-service ${RUN} --to web-00042-abc`,
    );
    assert.deepStrictEqual(h.gcp.callsTo("PATCH", RUN_URL)[0]?.query, {
      updateMask: "traffic",
    });
    assert.deepStrictEqual(h.gcp.callsTo("PATCH", RUN_URL)[0]?.body, {
      traffic: [
        {
          type: "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION",
          revision: "web-00041-xyz",
          percent: 100,
        },
      ],
    });
    assert.deepStrictEqual(
      h.gcp
        .callsTo("GET", `${RUN_URL}/revisions`)
        .map((call: GcpCall): Record<string, string> => {
          return call.query;
        }),
      [{ pageSize: "100" }, { pageSize: "100", pageToken: "page-2" }],
    );
  });

  test("the serving revision is read from the traffic as it is (a pinned revision, the largest share)", async () => {
    const h: CloudHarness = rollbackSetup({
      trafficStatuses: [
        {
          type: "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION",
          revision: "web-00041-xyz",
          percent: 90,
        },
        { type: "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST", percent: 10 },
      ],
    });

    assertChanged(await runCloud(h, "gcp", `cloud roll-back-service ${RUN}`), {
      version: "web-00041-xyz",
    });
    assert.strictEqual(
      (
        h.gcp.callsTo("PATCH", RUN_URL)[0]?.body?.["traffic"] as Array<
          Record<string, unknown>
        >
      )[0]?.["revision"],
      "web-00040-def",
    );
  });

  test("--to: a revision of the same service, not the one serving", async () => {
    assertNotRun(
      await runCloud(
        rollbackSetup(),
        "gcp",
        `cloud roll-back-service ${RUN} --to api-00041-xyz`,
      ),
      /--to api-00041-xyz is not a revision of the Cloud Run service web/,
    );
    assertNotRun(
      await runCloud(
        rollbackSetup(),
        "gcp",
        `cloud roll-back-service ${RUN} --to web-00042-abc`,
      ),
      /already sends its traffic to web-00042-abc/,
    );

    const h: CloudHarness = rollbackSetup();

    assertChanged(
      await runCloud(
        h,
        "gcp",
        `cloud roll-back-service ${RUN} --to web-00040-def`,
      ),
      {
        version: "web-00042-abc",
      },
    );
  });
});

describe("Google Cloud: Cloud SQL", () => {
  const setup: (
    settings: Record<string, unknown>,
    state?: string,
  ) => CloudHarness = (
    settings: Record<string, unknown>,
    state: string = "RUNNABLE",
  ): CloudHarness => {
    const h: CloudHarness = cloudHarness("gcp");

    h.gcp.handle("GET", SQL_URL, (): FakeAnswer => {
      return jsonReply({
        name: "orders",
        state,
        gceZone: "us-central1-a",
        secondaryGceZone: "us-central1-c",
        settings: {
          activationPolicy: "ALWAYS",
          availabilityType: "REGIONAL",
          settingsVersion: "12",
          userLabels: {},
          ...settings,
        },
      });
    });

    for (const action of ["restart", "failover"]) {
      h.gcp.handle("POST", `${SQL_URL}/${action}`, (): FakeAnswer => {
        h.gcp.handle("GET", SQL_OP_URL, (): FakeAnswer => {
          return jsonReply({
            kind: "sql#operation",
            name: "op-sql-1",
            status: "DONE",
          });
        });
        return jsonReply({
          kind: "sql#operation",
          name: "op-sql-1",
          status: "PENDING",
        });
      });
    }

    return h;
  };

  test("reboot-instance restarts the instance, its operation followed", async () => {
    const h: CloudHarness = setup({});
    const lines: Array<string> = assertChanged(
      await runCloud(h, "gcp", `cloud reboot-instance ${SQL}`),
      {},
    );

    assert.deepStrictEqual(lines.slice(1), [
      "Cloud SQL instance orders: restarting; connections drop while it restarts.",
      `API call: Cloud SQL instances.restart (POST restart), as ${IDENTITY}.`,
      "Google Cloud carried the change out (operation op-sql-1).",
      "Nothing to undo.",
    ]);
    assert.strictEqual(h.gcp.callsTo("GET", SQL_OP_URL).length, 1);
  });

  test("fail-over-database on a highly available instance, with its settings version", async () => {
    const h: CloudHarness = setup({});
    const lines: Array<string> = assertChanged(
      await runCloud(h, "gcp", `cloud fail-over-database ${SQL}`),
      { primary: "us-central1-a" },
    );

    assert.strictEqual(
      lines[1],
      "Cloud SQL instance orders: failing over from its primary zone us-central1-a to its standby in us-central1-c.",
    );
    assert.deepStrictEqual(
      h.gcp.callsTo("POST", `${SQL_URL}/failover`)[0]?.body,
      {
        failoverContext: { kind: "sql#failoverContext", settingsVersion: "12" },
      },
    );
    assert.strictEqual(
      lines[lines.length - 1],
      `To undo it: cloud fail-over-database ${SQL}`,
    );
  });

  test("a zonal instance has no standby; a stopped one is not restarted", async () => {
    assertNotRun(
      await runCloud(
        setup({ availabilityType: "ZONAL" }),
        "gcp",
        `cloud fail-over-database ${SQL}`,
      ),
      /is not highly available \(its availability type is ZONAL\), so it has no standby to fail over to/,
    );
    assertNotRun(
      await runCloud(
        setup({ activationPolicy: "NEVER" }),
        "gcp",
        `cloud reboot-instance ${SQL}`,
      ),
      /the Cloud SQL instance orders is stopped, and cloud reboot-instance needs it running \(RUNNABLE\)/,
    );
    assertNotRun(
      await runCloud(
        setup({}, "MAINTENANCE"),
        "gcp",
        `cloud reboot-instance ${SQL}`,
      ),
      /is MAINTENANCE, and cloud reboot-instance needs it running/,
    );
  });
});

describe("Google Cloud: a project named by its number", () => {
  const BY_NUMBER: string = `//compute.googleapis.com/projects/${GCP_PROJECT_NUMBER}/zones/us-central1-a/instances/vm-1`;

  test("is checked against the metadata server before anything changes, then addressed by the project id", async () => {
    const h: CloudHarness = cloudHarness("gcp");

    h.gcp.handle("GET", VM_URL, (): FakeAnswer => {
      return jsonReply({ name: "vm-1", status: "RUNNING" });
    });
    h.gcp.handle("POST", `${VM_URL}/reset`, (): FakeAnswer => {
      return computeOperation(h, ZONE_OP_URL);
    });

    assertChanged(
      await runCloud(h, "gcp", `cloud reboot-instance ${BY_NUMBER}`),
      {},
    );
    assert.ok(
      h.gcp.metadataRequests.some((request: CloudHttpRequest): boolean => {
        return request.url.endsWith("/project/numeric-project-id");
      }),
    );
    assert.strictEqual(h.gcp.callsTo("POST", `${VM_URL}/reset`).length, 1);
  });

  test("another project's number is refused: in run() before the metadata server was read, in prepare() after", async () => {
    const h: CloudHarness = cloudHarness("gcp");
    const other: string =
      "//compute.googleapis.com/projects/111111111111/zones/us-central1-a/instances/vm-1";

    assertNotRun(
      await runCloud(h, "gcp", `cloud reboot-instance ${other}`),
      /^Refused by the Cloud AI agent: \/\/compute\.googleapis\.com\/projects\/111111111111\/.* is in Google Cloud project 111111111111, and this agent acts in project shop-prod-1234 only\.$/,
    );
    assert.deepStrictEqual(h.gcp.calls, []);
    // Now the agent knows its number: refused before anything is sent.
    assert.match(
      refusalOf(h, "gcp", `cloud reboot-instance ${other}`),
      /is in Google Cloud project 111111111111, and this agent acts in project shop-prod-1234 only/,
    );
  });

  test("the project an agent merely runs in is not one it may change", async () => {
    const h: CloudHarness = cloudHarness("gcp", {
      identity: "shop-staging-77",
    });

    // The metadata server is read (the project the agent runs in is shop-prod-1234).
    await h.executor.probePosture();

    assert.match(
      refusalOf(h, "gcp", `cloud reboot-instance ${VM}`, {
        payload: { resourceIdentifier: "shop-staging-77" },
      }),
      /is in Google Cloud project shop-prod-1234, and this agent acts in project shop-staging-77 only/,
    );
  });
});

describe("Google Cloud: identity and posture", () => {
  test("the project id from the metadata server", async () => {
    const h: CloudHarness = cloudHarness("gcp", { identity: null });

    assert.strictEqual(await h.executor.resolveResourceIdentifier(), P);
  });

  test("reachable: its project, number and service account; its own Cloud Run service protected by id and number", async () => {
    const h: CloudHarness = cloudHarness("gcp", {
      env: {
        K_SERVICE: "oneuptime-ai-agent-eu",
        ONEUPTIME_AI_CLOUD_OPERATIONS: "reboot-instance",
      },
    });
    const probe: ResourcePostureProbe = await h.executor.probePosture();

    assert.deepStrictEqual(probe, {
      toolVersion: "Google Cloud",
      reachable: true,
      reachError: null,
      details: {
        cloudProvider: "gcp",
        cloudAccountId: P,
        enabledOperations: "reboot-instance",
        requiredTag: null,
        gcpProjectNumber: GCP_PROJECT_NUMBER,
        gcpServiceAccount: GCP_SERVICE_ACCOUNT,
      },
      protectedTargets: [
        `//run.googleapis.com/projects/${P}/locations/*/services/oneuptime-ai-agent`,
        `//iam.googleapis.com/projects/${P}/serviceAccounts/oneuptime-ai-agent@*`,
        `//run.googleapis.com/projects/${GCP_PROJECT_NUMBER}/locations/*/services/oneuptime-ai-agent`,
        `//iam.googleapis.com/projects/${GCP_PROJECT_NUMBER}/serviceAccounts/oneuptime-ai-agent@*`,
        `//run.googleapis.com/projects/${P}/locations/us-central1/services/oneuptime-ai-agent-eu`,
        `//run.googleapis.com/projects/${GCP_PROJECT_NUMBER}/locations/us-central1/services/oneuptime-ai-agent-eu`,
      ],
    });

    // Its own service is protected by number too (the guard runs before the operations check).
    assert.match(
      refusalOf(
        h,
        "gcp",
        `cloud roll-back-service //run.googleapis.com/projects/${GCP_PROJECT_NUMBER}/locations/us-central1/services/oneuptime-ai-agent-eu`,
      ),
      /which the Cloud AI agent protects \(\/\/run\.googleapis\.com\/projects\/987654321012\/locations\/us-central1\/services\/oneuptime-ai-agent-eu\)/,
    );
  });

  test("unreachable without a service account", async () => {
    const h: CloudHarness = cloudHarness("gcp");

    h.cloud.on(
      "GET",
      `${GCP_METADATA}/instance/service-accounts/default/token`,
      (): FakeAnswer => {
        return reply(404, "Not Found", { "Metadata-Flavor": "Google" });
      },
    );

    const probe: ResourcePostureProbe = await h.executor.probePosture();

    assert.strictEqual(probe.reachable, false);
    assert.match(
      String(probe.reachError),
      /^The Google Cloud AI agent could not read its identity from the metadata server: the metadata server answered instance\/service-accounts\/default\/token with HTTP 404: the agent has no service account attached$/,
    );
  });
});
