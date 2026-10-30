import "./Helpers/TestSupport";
import assert from "assert";
import { describe, test } from "node:test";
import {
  ExecResult,
  ResourcePostureProbe,
} from "../Executors/ResourceExecutor";
import { CloudHttpRequest } from "../Executors/Cloud/CloudHttp";
import {
  AZURE_IDENTITY_ENDPOINT,
  AZURE_IDENTITY_HEADER,
  AZURE_IMDS_URL,
  AZURE_SUBSCRIPTION,
  AZURE_TOKEN,
  ArmCall,
  FakeAnswer,
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
 * The Azure Cloud AI agent against a fake Azure Resource Manager: the
 * managed identity's token (the Container Apps endpoint, IMDS), each
 * change as the ONE ARM call it maps to — with its api-version, its body
 * and the reads before it — the long-running operations it follows, and
 * how each failure reads.
 */

const SUB: string = AZURE_SUBSCRIPTION;
const PROVIDERS: string = `/subscriptions/${SUB}/resourceGroups/prod/providers`;
const SITE: string = `${PROVIDERS}/Microsoft.Web/sites/web`;
const PLAN: string = `${PROVIDERS}/Microsoft.Web/serverfarms/web-plan`;
const APP: string = `${PROVIDERS}/Microsoft.App/containerApps/api`;
const VM: string = `${PROVIDERS}/Microsoft.Compute/virtualMachines/vm-1`;
const VMSS: string = `${PROVIDERS}/Microsoft.Compute/virtualMachineScaleSets/workers`;
const PG: string = `${PROVIDERS}/Microsoft.DBforPostgreSQL/flexibleServers/orders-pg`;
const MYSQL: string = `${PROVIDERS}/Microsoft.DBforMySQL/flexibleServers/orders-mysql`;
const FOG: string = `${PROVIDERS}/Microsoft.Sql/servers/orders-east/failoverGroups/orders-fog`;
const PARTNER: string = `/subscriptions/${SUB}/resourceGroups/dr/providers/Microsoft.Sql/servers/orders-west`;
const OPERATION_PATH: string = `/subscriptions/${SUB}/providers/Microsoft.Compute/locations/eastus/operations/op-1`;
const OPERATION_URL: string = `https://management.azure.com${OPERATION_PATH}?api-version=2024-07-01`;
const IDENTITY: string =
  "the Container App's managed identity, system-assigned";

// A 202 whose operation reports these states, one per poll.
function acceptedWith(
  h: CloudHarness,
  states: Array<string>,
  error?: string,
): FakeAnswer {
  let poll: number = 0;

  h.arm.handle("GET", OPERATION_PATH, (): FakeAnswer => {
    const status: string =
      states[Math.min(poll, states.length - 1)] || "InProgress";
    poll++;

    return jsonReply({
      status,
      ...(error ? { error: { code: "Conflict", message: error } } : {}),
    });
  });

  return reply(202, "", {
    "Azure-AsyncOperation": OPERATION_URL,
    "Retry-After": "3",
  });
}

function vm(
  power: string,
  tags: Record<string, string> = {},
): Record<string, unknown> {
  return {
    id: VM,
    name: "vm-1",
    tags,
    properties: {
      instanceView: {
        statuses: [
          { code: "ProvisioningState/succeeded" },
          { code: `PowerState/${power}`, displayStatus: `VM ${power}` },
        ],
      },
    },
  };
}

describe("Azure: the managed identity's token", () => {
  test("the Container Apps identity endpoint, with its header, for Resource Manager; reused while it is fresh", async () => {
    const h: CloudHarness = cloudHarness("azure");

    h.arm.handle("GET", `/subscriptions/${SUB}`, (): FakeAnswer => {
      return jsonReply({
        subscriptionId: SUB,
        displayName: "Shop production",
        state: "Enabled",
      });
    });

    await runCloud(h, "azure", "cloud whoami", { origin: "AiInvestigation" });
    await runCloud(h, "azure", "cloud whoami", { origin: "AiInvestigation" });

    assert.strictEqual(h.arm.tokenRequests.length, 1);

    const request: CloudHttpRequest | undefined = h.arm.tokenRequests[0];
    const url: URL = new URL(request?.url || "");

    assert.strictEqual(`${url.origin}${url.pathname}`, AZURE_IDENTITY_ENDPOINT);
    assert.strictEqual(url.searchParams.get("api-version"), "2019-08-01");
    assert.strictEqual(
      url.searchParams.get("resource"),
      "https://management.azure.com/",
    );
    assert.strictEqual(url.searchParams.get("client_id"), null);
    assert.strictEqual(
      request?.headers["X-IDENTITY-HEADER"],
      AZURE_IDENTITY_HEADER,
    );

    for (const call of h.arm.calls) {
      assert.strictEqual(call.authorization, `Bearer ${AZURE_TOKEN}`);
    }

    // An hour later it has expired: asked again.
    h.clock.nowMs += 3600 * 1000;
    await runCloud(h, "azure", "cloud whoami", { origin: "AiInvestigation" });
    assert.strictEqual(h.arm.tokenRequests.length, 2);
  });

  test("a user-assigned identity is picked with AZURE_CLIENT_ID; IMDS answers where there is no identity endpoint", async () => {
    const h: CloudHarness = cloudHarness("azure", {
      env: {
        IDENTITY_ENDPOINT: "",
        IDENTITY_HEADER: "",
        AZURE_CLIENT_ID: "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d",
      },
    });

    h.arm.handle("GET", `/subscriptions/${SUB}`, (): FakeAnswer => {
      return jsonReply({
        subscriptionId: SUB,
        displayName: "Shop production",
        state: "Enabled",
      });
    });

    const result: ExecResult = await runCloud(h, "azure", "cloud whoami", {
      origin: "AiInvestigation",
    });

    assert.strictEqual(result.success, true, String(result.errorMessage));

    const request: CloudHttpRequest | undefined = h.arm.tokenRequests[0];
    const url: URL = new URL(request?.url || "");

    assert.strictEqual(`${url.origin}${url.pathname}`, AZURE_IMDS_URL);
    assert.strictEqual(url.searchParams.get("api-version"), "2018-02-01");
    assert.strictEqual(
      url.searchParams.get("resource"),
      "https://management.azure.com/",
    );
    assert.strictEqual(
      url.searchParams.get("client_id"),
      "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d",
    );
    assert.strictEqual(request?.headers["Metadata"], "true");
    assert.ok(
      outputLines(result).includes(
        "Signed in as: the managed identity of the machine it runs on (IMDS), user-assigned (client id 5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d, AZURE_CLIENT_ID)",
      ),
    );
  });

  test("an identity endpoint without its header, or one off the platform, is refused before anything is sent", async () => {
    const noHeader: CloudHarness = cloudHarness("azure", {
      env: { IDENTITY_HEADER: "" },
    });

    assertNotRun(
      await runCloud(noHeader, "azure", `cloud restart-service ${SITE}`),
      /IDENTITY_ENDPOINT is set but IDENTITY_HEADER is not: the managed identity endpoint needs both/,
    );

    const offPlatform: CloudHarness = cloudHarness("azure", {
      env: { IDENTITY_ENDPOINT: "http://identity.example.com/msi/token" },
    });

    assertNotRun(
      await runCloud(offPlatform, "azure", `cloud restart-service ${SITE}`),
      /IDENTITY_ENDPOINT must be the platform's identity endpoint/,
    );
    assert.deepStrictEqual(offPlatform.cloud.requests, []);
  });

  test("an endpoint that hands out no token: never ran, and says why", async () => {
    const h: CloudHarness = cloudHarness("azure");

    h.cloud.on("GET", AZURE_IDENTITY_ENDPOINT, (): FakeAnswer => {
      return jsonReply(
        { error: "invalid_request", error_description: "Identity not found" },
        400,
      );
    });

    assertNotRun(
      await runCloud(h, "azure", `cloud restart-service ${SITE}`),
      /^The agent could not ask Azure to sign the agent in \(its managed identity\), so nothing was changed: the managed identity endpoint answered HTTP 400 and no token \(Identity not found\)\. Check that the agent has a managed identity\.$/,
    );
  });
});

describe("Azure: whoami", () => {
  test("the subscription, its name and state, and the identity", async () => {
    const h: CloudHarness = cloudHarness("azure");

    h.arm.handle("GET", `/subscriptions/${SUB}`, (): FakeAnswer => {
      return jsonReply({
        subscriptionId: SUB,
        displayName: "Shop production",
        state: "Enabled",
      });
    });

    const result: ExecResult = await runCloud(h, "azure", "cloud whoami", {
      origin: "AiInvestigation",
    });

    assert.deepStrictEqual(outputLines(result), [
      "Cloud: Azure",
      `Subscription: ${SUB} (Shop production), Enabled`,
      `Signed in as: ${IDENTITY}`,
      "Changes: allowed (ONEUPTIME_AI_ALLOW_WRITES=true)",
      "Enabled changes: restart-service, start-instance, scale-out, scale-in, reboot-instance, roll-back-service, fail-over-database, stop-instance (every change of the catalog: ONEUPTIME_AI_CLOUD_OPERATIONS is not set)",
      "Required tag: none (ONEUPTIME_AI_CLOUD_REQUIRED_TAG is not set)",
    ]);
    assert.strictEqual(h.arm.calls[0]?.apiVersion, "2022-12-01");
  });
});

describe("Azure: App Service and Container Apps", () => {
  test("restart-service on a running app: POST restart, api-version 2023-12-01", async () => {
    const h: CloudHarness = cloudHarness("azure");

    h.arm.handle("GET", SITE, (): FakeAnswer => {
      return jsonReply({
        id: SITE,
        tags: {},
        properties: { state: "Running" },
      });
    });
    h.arm.handle("POST", `${SITE}/restart`, (): FakeAnswer => {
      return reply(200, "");
    });

    const lines: Array<string> = assertChanged(
      await runCloud(h, "azure", `cloud restart-service ${SITE}`),
      {},
    );

    assert.deepStrictEqual(lines.slice(1), [
      "App web (resource group prod): restarted on the version it runs now; requests may fail while its workers restart.",
      `API call: Microsoft.Web/sites restart (POST restart), as ${IDENTITY}.`,
      "Azure carried the change out.",
      "Nothing to undo: the same version runs again.",
    ]);
    assert.deepStrictEqual(h.arm.paths(), [
      `GET ${SITE}`,
      `POST ${SITE}/restart`,
    ]);
    assert.deepStrictEqual(
      h.arm.calls.map((call: ArmCall): string | null => {
        return call.apiVersion;
      }),
      ["2023-12-01", "2023-12-01"],
    );
    assert.strictEqual(h.arm.callsTo("POST", `${SITE}/restart`)[0]?.body, null);
  });

  test("a stopped app is not restarted", async () => {
    const h: CloudHarness = cloudHarness("azure");

    h.arm.handle("GET", SITE, (): FakeAnswer => {
      return jsonReply({ id: SITE, properties: { state: "Stopped" } });
    });

    assertNotRun(
      await runCloud(h, "azure", `cloud restart-service ${SITE}`),
      /the app web is Stopped: restart-service restarts a running app/,
    );
  });

  test("restart-service on a Container App restarts its latest ready revision", async () => {
    const h: CloudHarness = cloudHarness("azure");

    h.arm.handle("GET", APP, (): FakeAnswer => {
      return jsonReply({
        id: APP,
        properties: { latestReadyRevisionName: "api--rev3" },
      });
    });
    h.arm.handle(
      "POST",
      `${APP}/revisions/api--rev3/restart`,
      (): FakeAnswer => {
        return reply(200, "");
      },
    );

    const lines: Array<string> = assertChanged(
      await runCloud(h, "azure", `cloud restart-service ${APP}`),
      {},
    );

    assert.strictEqual(
      lines[1],
      "Container App api (resource group prod): restarted its latest ready revision, api--rev3, on the image it runs now.",
    );
    assert.strictEqual(
      h.arm.callsTo("POST", `${APP}/revisions/api--rev3/restart`)[0]
        ?.apiVersion,
      "2024-03-01",
    );
  });

  test("roll-back-service swaps the slot with production; the same swap undoes it", async () => {
    const h: CloudHarness = cloudHarness("azure");

    h.arm.handle("GET", `${SITE}/slots/staging`, (): FakeAnswer => {
      return jsonReply({ id: `${SITE}/slots/staging`, name: "web/staging" });
    });
    h.arm.handle("POST", `${SITE}/slotsswap`, (): FakeAnswer => {
      return reply(200, "");
    });

    const lines: Array<string> = assertChanged(
      await runCloud(
        h,
        "azure",
        `cloud roll-back-service ${SITE} --slot staging`,
      ),
      {},
    );

    assert.strictEqual(
      lines[1],
      "App web (resource group prod): swapped its staging slot with production — what ran in staging now serves production, and what served production is in staging.",
    );
    assert.strictEqual(
      lines[lines.length - 1],
      `To undo it: cloud roll-back-service ${SITE.toLowerCase()} --slot staging`,
    );
    assert.deepStrictEqual(
      h.arm.callsTo("POST", `${SITE}/slotsswap`)[0]?.body,
      {
        targetSlot: "staging",
        preserveVnet: true,
      },
    );
    // Without a required tag the site itself is not read.
    assert.deepStrictEqual(h.arm.paths(), [
      `GET ${SITE}/slots/staging`,
      `POST ${SITE}/slotsswap`,
    ]);
  });

  test("a slot that does not exist: never ran", async () => {
    const h: CloudHarness = cloudHarness("azure");

    assertNotRun(
      await runCloud(
        h,
        "azure",
        `cloud roll-back-service ${SITE} --slot staging`,
      ),
      /The agent could not ask Azure about the app's slot staging \(Microsoft\.Web\/sites\/slots\/read\), so nothing was changed: Azure refused Microsoft\.Web\/sites\/slots\/read \(HTTP 404 ResourceNotFound\)/,
    );
  });

  test("a required tag makes the slot swap read the site's tags first", async () => {
    const h: CloudHarness = cloudHarness("azure", {
      env: { ONEUPTIME_AI_CLOUD_REQUIRED_TAG: "OneUptime-AI=allow" },
    });

    h.arm.handle("GET", SITE, (): FakeAnswer => {
      // Azure tag names are case-insensitive; values are not.
      return jsonReply({ id: SITE, tags: { "oneuptime-ai": "allow" } });
    });
    h.arm.handle("GET", `${SITE}/slots/staging`, (): FakeAnswer => {
      return jsonReply({ id: `${SITE}/slots/staging` });
    });
    h.arm.handle("POST", `${SITE}/slotsswap`, (): FakeAnswer => {
      return reply(200, "");
    });

    assertChanged(
      await runCloud(
        h,
        "azure",
        `cloud roll-back-service ${SITE} --slot staging`,
      ),
      {},
    );
    assert.deepStrictEqual(h.arm.paths(), [
      `GET ${SITE}`,
      `GET ${SITE}/slots/staging`,
      `POST ${SITE}/slotsswap`,
    ]);

    const untagged: CloudHarness = cloudHarness("azure", {
      env: { ONEUPTIME_AI_CLOUD_REQUIRED_TAG: "oneuptime-ai=allow" },
    });

    untagged.arm.handle("GET", SITE, (): FakeAnswer => {
      return jsonReply({ id: SITE, tags: { "oneuptime-ai": "Allow" } });
    });

    assertNotRun(
      await runCloud(
        untagged,
        "azure",
        `cloud roll-back-service ${SITE} --slot staging`,
      ),
      /only changes resources that carry the tag oneuptime-ai=allow/,
    );
  });

  const revisions: Array<Record<string, unknown>> = [
    {
      name: "api--rev1",
      properties: {
        createdTime: "2026-10-20T10:00:00Z",
        active: true,
        trafficWeight: 0,
      },
    },
    {
      name: "api--rev2",
      properties: {
        createdTime: "2026-10-24T10:00:00Z",
        active: false,
        trafficWeight: 0,
      },
    },
    {
      name: "api--rev3",
      properties: {
        createdTime: "2026-10-26T10:00:00Z",
        active: true,
        trafficWeight: 0,
      },
    },
    {
      name: "api--rev4",
      properties: {
        createdTime: "2026-10-27T10:00:00Z",
        active: true,
        trafficWeight: 100,
      },
    },
  ];

  const appSetup: (configuration: Record<string, unknown>) => CloudHarness = (
    configuration: Record<string, unknown>,
  ): CloudHarness => {
    const h: CloudHarness = cloudHarness("azure");

    h.arm.handle("GET", APP, (): FakeAnswer => {
      return jsonReply({
        id: APP,
        properties: {
          latestRevisionName: "api--rev4",
          latestReadyRevisionName: "api--rev4",
          configuration: {
            activeRevisionsMode: "Multiple",
            ingress: {
              external: true,
              targetPort: 8080,
              traffic: [{ latestRevision: true, weight: 100 }],
            },
            ...configuration,
          },
        },
      });
    });
    h.arm.handle("GET", `${APP}/revisions`, (): FakeAnswer => {
      return jsonReply({ value: revisions });
    });
    h.arm.handle("PATCH", APP, (): FakeAnswer => {
      return acceptedWith(h, ["InProgress", "Succeeded"]);
    });
    return h;
  };

  test("roll-back-service on a Container App moves all traffic to the newest active revision before the serving one", async () => {
    const h: CloudHarness = appSetup({});
    const lines: Array<string> = assertChanged(
      await runCloud(h, "azure", `cloud roll-back-service ${APP}`),
      { version: "api--rev4" },
    );

    assert.deepStrictEqual(lines.slice(1), [
      "Container App api (resource group prod): traffic api--rev4 → api--rev3 (100%).",
      `API call: Microsoft.App/containerApps update of its traffic weights (a revision of the same app) (traffic api--rev3=100), as ${IDENTITY}.`,
      "Azure carried the change out (its operation succeeded).",
      `To undo it: cloud roll-back-service ${APP.toLowerCase()} --to api--rev4`,
    ]);
    assert.deepStrictEqual(h.arm.callsTo("PATCH", APP)[0]?.body, {
      properties: {
        configuration: {
          ingress: { traffic: [{ revisionName: "api--rev3", weight: 100 }] },
        },
      },
    });
    assert.strictEqual(
      h.arm.callsTo("PATCH", APP)[0]?.apiVersion,
      "2024-03-01",
    );
    // Two polls, at the Retry-After the answer asked for.
    assert.deepStrictEqual(h.clock.sleeps, [3000, 3000]);
    assert.strictEqual(h.arm.callsTo("GET", OPERATION_PATH).length, 2);
  });

  test("--to: a revision of the same app that is active; single revision mode and no ingress are refused", async () => {
    assertNotRun(
      await runCloud(
        appSetup({}),
        "azure",
        `cloud roll-back-service ${APP} --to web--rev1`,
      ),
      /--to web--rev1 is not a revision of the Container App api/,
    );
    assertNotRun(
      await runCloud(
        appSetup({}),
        "azure",
        `cloud roll-back-service ${APP} --to api--rev2`,
      ),
      /the revision api--rev2 is inactive, so it cannot take traffic: activate it first/,
    );
    assertNotRun(
      await runCloud(
        appSetup({ activeRevisionsMode: "Single" }),
        "azure",
        `cloud roll-back-service ${APP}`,
      ),
      /runs in single revision mode, where only its latest revision serves traffic/,
    );
    assertNotRun(
      await runCloud(
        appSetup({ ingress: null }),
        "azure",
        `cloud roll-back-service ${APP}`,
      ),
      /has no ingress, so there is no traffic to move/,
    );

    const h: CloudHarness = appSetup({});

    assertChanged(
      await runCloud(
        h,
        "azure",
        `cloud roll-back-service ${APP} --to api--rev1`,
      ),
      {
        version: "api--rev4",
      },
    );
  });
});

describe("Azure: virtual machines", () => {
  const setup: (power: string) => CloudHarness = (
    power: string,
  ): CloudHarness => {
    const h: CloudHarness = cloudHarness("azure");

    h.arm.handle("GET", VM, (): FakeAnswer => {
      return jsonReply(vm(power));
    });

    for (const action of ["start", "deallocate", "restart"]) {
      h.arm.handle("POST", `${VM}/${action}`, (): FakeAnswer => {
        return acceptedWith(h, ["InProgress", "Succeeded"]);
      });
    }

    return h;
  };

  test("start-instance on a deallocated VM, followed until its operation succeeds", async () => {
    const h: CloudHarness = setup("deallocated");
    const lines: Array<string> = assertChanged(
      await runCloud(h, "azure", `cloud start-instance ${VM}`),
      { state: "deallocated" },
    );

    assert.deepStrictEqual(lines.slice(1), [
      "Virtual machine vm-1 (resource group prod): deallocated → running.",
      `API call: Microsoft.Compute/virtualMachines start (POST start), as ${IDENTITY}.`,
      "Azure carried the change out (its operation succeeded).",
      `To undo it: cloud stop-instance ${VM.toLowerCase()}`,
    ]);

    const read: ArmCall | undefined = h.arm.callsTo("GET", VM)[0];

    assert.strictEqual(read?.apiVersion, "2024-07-01");
    assert.strictEqual(read?.query["$expand"], "instanceView");
    assert.strictEqual(h.arm.callsTo("POST", `${VM}/start`).length, 1);
  });

  test("stop-instance deallocates a running VM; reboot-instance restarts it", async () => {
    const stop: CloudHarness = setup("running");
    const stopLines: Array<string> = assertChanged(
      await runCloud(stop, "azure", `cloud stop-instance ${VM}`),
      { state: "running" },
    );

    assert.strictEqual(
      stopLines[1],
      "Virtual machine vm-1 (resource group prod): running → deallocated (deallocated: its compute is released and no longer billed).",
    );
    assert.strictEqual(stop.arm.callsTo("POST", `${VM}/deallocate`).length, 1);

    const reboot: CloudHarness = setup("running");

    assertChanged(
      await runCloud(reboot, "azure", `cloud reboot-instance ${VM}`),
      {},
    );
    assert.strictEqual(reboot.arm.callsTo("POST", `${VM}/restart`).length, 1);
  });

  test("the power state decides", async () => {
    assertNotRun(
      await runCloud(setup("running"), "azure", `cloud start-instance ${VM}`),
      /the virtual machine vm-1 is running, and cloud start-instance needs it deallocated or stopped/,
    );
    assertNotRun(
      await runCloud(
        setup("deallocated"),
        "azure",
        `cloud reboot-instance ${VM}`,
      ),
      /is deallocated, and cloud reboot-instance needs it running/,
    );
  });
});

describe("Azure: instance counts", () => {
  const planSetup: (capacity: number, maxWorkers: number) => CloudHarness = (
    capacity: number,
    maxWorkers: number,
  ): CloudHarness => {
    const h: CloudHarness = cloudHarness("azure");

    h.arm.handle("GET", PLAN, (): FakeAnswer => {
      return jsonReply({
        id: PLAN,
        sku: {
          name: "P1v3",
          tier: "PremiumV3",
          size: "P1v3",
          family: "Pv3",
          capacity,
        },
        properties: {
          maximumNumberOfWorkers: maxWorkers,
          numberOfWorkers: capacity,
        },
      });
    });
    h.arm.handle("PATCH", PLAN, (): FakeAnswer => {
      return jsonReply({ id: PLAN });
    });
    return h;
  };

  test("scale-out of an App Service plan: PATCH sku.capacity, at most double", async () => {
    const h: CloudHarness = planSetup(2, 30);
    const lines: Array<string> = assertChanged(
      await runCloud(h, "azure", `cloud scale-out ${PLAN} --count 4`),
      { count: "2" },
    );

    assert.strictEqual(
      lines[1],
      "App Service plan web-plan (resource group prod): instance count 2 → 4.",
    );
    assert.strictEqual(
      lines[lines.length - 1],
      `To undo it: cloud scale-in ${PLAN.toLowerCase()} --count 2`,
    );
    assert.deepStrictEqual(h.arm.callsTo("PATCH", PLAN)[0]?.body, {
      sku: {
        name: "P1v3",
        tier: "PremiumV3",
        size: "P1v3",
        family: "Pv3",
        capacity: 4,
      },
    });
    assert.strictEqual(
      h.arm.callsTo("PATCH", PLAN)[0]?.apiVersion,
      "2023-12-01",
    );

    assertNotRun(
      await runCloud(
        planSetup(2, 30),
        "azure",
        `cloud scale-out ${PLAN} --count 5`,
      ),
      /--count 5 is above 4, the most the App Service plan may run \(double its instance count of 2/,
    );
  });

  test("scale-in of an App Service plan, never to 0", async () => {
    const h: CloudHarness = planSetup(3, 30);
    const lines: Array<string> = assertChanged(
      await runCloud(h, "azure", `cloud scale-in ${PLAN} --count 1`),
      { count: "3" },
    );

    assert.strictEqual(
      lines[1],
      "App Service plan web-plan (resource group prod): instance count 3 → 1.",
    );
    assert.strictEqual(
      lines[lines.length - 1],
      `To undo it: cloud scale-out ${PLAN.toLowerCase()} --count 3`,
    );
    assert.deepStrictEqual(
      (
        h.arm.callsTo("PATCH", PLAN)[0]?.body?.["sku"] as Record<
          string,
          unknown
        >
      )["capacity"],
      1,
    );
  });

  test("the pricing tier's worker limit bounds a scale out below double", async () => {
    assertNotRun(
      await runCloud(
        planSetup(2, 3),
        "azure",
        `cloud scale-out ${PLAN} --count 4`,
      ),
      /--count 4 is above 3, the most the App Service plan may run \(the most workers its pricing tier allows\)/,
    );
  });

  test("scale-in of a VM scale set, followed as a long-running operation", async () => {
    const h: CloudHarness = cloudHarness("azure");

    h.arm.handle("GET", VMSS, (): FakeAnswer => {
      return jsonReply({
        id: VMSS,
        sku: { name: "Standard_D2s_v5", tier: "Standard", capacity: 3 },
      });
    });
    h.arm.handle("PATCH", VMSS, (): FakeAnswer => {
      return acceptedWith(h, ["Succeeded"]);
    });

    const lines: Array<string> = assertChanged(
      await runCloud(h, "azure", `cloud scale-in ${VMSS} --count 1`),
      { count: "3" },
    );

    assert.deepStrictEqual(lines.slice(1), [
      "VM scale set workers (resource group prod): instance count 3 → 1.",
      `API call: Microsoft.Compute/virtualMachineScaleSets update of sku.capacity (sku.capacity=1), as ${IDENTITY}.`,
      "Azure carried the change out (its operation succeeded).",
      "An autoscale setting on the scale set may change the count again.",
      `To undo it: cloud scale-out ${VMSS.toLowerCase()} --count 3`,
    ]);
    assert.deepStrictEqual(h.arm.callsTo("PATCH", VMSS)[0]?.body, {
      sku: { name: "Standard_D2s_v5", tier: "Standard", capacity: 1 },
    });
    assert.strictEqual(
      h.arm.callsTo("PATCH", VMSS)[0]?.apiVersion,
      "2024-07-01",
    );
  });
});

describe("Azure: databases", () => {
  test("reboot-instance restarts a PostgreSQL flexible server in place", async () => {
    const h: CloudHarness = cloudHarness("azure");

    h.arm.handle("GET", PG, (): FakeAnswer => {
      return jsonReply({ id: PG, properties: { state: "Ready" } });
    });
    h.arm.handle("POST", `${PG}/restart`, (): FakeAnswer => {
      return acceptedWith(h, ["Succeeded"]);
    });

    const lines: Array<string> = assertChanged(
      await runCloud(h, "azure", `cloud reboot-instance ${PG}`),
      {},
    );

    assert.strictEqual(
      lines[1],
      "PostgreSQL flexible server orders-pg (resource group prod): restarting in place, without failover; connections drop while it restarts.",
    );
    assert.deepStrictEqual(h.arm.callsTo("POST", `${PG}/restart`)[0]?.body, {
      restartWithFailover: false,
    });
    assert.strictEqual(
      h.arm.callsTo("POST", `${PG}/restart`)[0]?.apiVersion,
      "2022-12-01",
    );
  });

  test("reboot-instance restarts a MySQL flexible server with failover disabled", async () => {
    const h: CloudHarness = cloudHarness("azure");

    h.arm.handle("GET", MYSQL, (): FakeAnswer => {
      return jsonReply({ id: MYSQL, properties: { state: "Ready" } });
    });
    h.arm.handle("POST", `${MYSQL}/restart`, (): FakeAnswer => {
      return reply(200, "");
    });

    assertChanged(
      await runCloud(h, "azure", `cloud reboot-instance ${MYSQL}`),
      {},
    );
    assert.deepStrictEqual(h.arm.callsTo("POST", `${MYSQL}/restart`)[0]?.body, {
      restartWithFailover: "Disabled",
    });
    assert.strictEqual(
      h.arm.callsTo("GET", MYSQL)[0]?.apiVersion,
      "2023-12-30",
    );

    const stopped: CloudHarness = cloudHarness("azure");

    stopped.arm.handle("GET", MYSQL, (): FakeAnswer => {
      return jsonReply({ id: MYSQL, properties: { state: "Stopped" } });
    });
    assertNotRun(
      await runCloud(stopped, "azure", `cloud reboot-instance ${MYSQL}`),
      /the server orders-mysql is Stopped, and a restart needs it Ready/,
    );
  });

  const fogSetup: (role: string, partnerId?: string) => CloudHarness = (
    role: string,
    partnerId: string = PARTNER,
  ): CloudHarness => {
    const h: CloudHarness = cloudHarness("azure");

    h.arm.handle("GET", FOG, (): FakeAnswer => {
      return jsonReply({
        id: FOG,
        properties: {
          replicationRole: role,
          replicationState: "CATCH_UP",
          partnerServers: [
            {
              id: partnerId,
              location: "westus",
              replicationRole: role === "Primary" ? "Secondary" : "Primary",
            },
          ],
        },
      });
    });

    for (const path of [FOG, `${PARTNER}/failoverGroups/orders-fog`]) {
      h.arm.handle("POST", `${path}/failover`, (): FakeAnswer => {
        return acceptedWith(h, ["Succeeded"]);
      });
    }

    return h;
  };

  test("fail-over-database on the secondary's side of a failover group: a planned failover there", async () => {
    const h: CloudHarness = fogSetup("Secondary");
    const lines: Array<string> = assertChanged(
      await runCloud(h, "azure", `cloud fail-over-database ${FOG}`),
      { primary: "orders-west" },
    );

    assert.strictEqual(
      lines[1],
      "SQL failover group orders-fog: failing over from its primary server orders-west to orders-east (a planned failover, without data loss).",
    );
    assert.strictEqual(
      lines[lines.length - 1],
      `To undo it: cloud fail-over-database ${FOG.toLowerCase()}`,
    );
    assert.strictEqual(
      h.arm.callsTo("POST", `${FOG}/failover`)[0]?.apiVersion,
      "2021-11-01",
    );
  });

  test("named from the primary's side, the failover is asked of the partner server's side of the same group", async () => {
    const h: CloudHarness = fogSetup("Primary");
    const lines: Array<string> = assertChanged(
      await runCloud(h, "azure", `cloud fail-over-database ${FOG}`),
      { primary: "orders-east" },
    );

    assert.strictEqual(
      lines[1],
      "SQL failover group orders-fog: failing over from its primary server orders-east to orders-west (a planned failover, without data loss).",
    );
    assert.deepStrictEqual(h.arm.paths().slice(0, 2), [
      `GET ${FOG}`,
      `POST ${PARTNER}/failoverGroups/orders-fog/failover`,
    ]);
  });

  test("a partner in another subscription, or a protected one, is refused", async () => {
    assertNotRun(
      await runCloud(
        fogSetup(
          "Primary",
          "/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/dr/providers/Microsoft.Sql/servers/orders-west",
        ),
        "azure",
        `cloud fail-over-database ${FOG}`,
      ),
      /the failover group orders-fog's partner server is not in this subscription/,
    );

    // The other side of the group is held to the same write scope as the side named.
    const h: CloudHarness = cloudHarness("azure", {
      env: { ONEUPTIME_AI_PROTECTED_TARGETS: "*/servers/orders-west/*" },
    });

    h.arm.handle("GET", FOG, (): FakeAnswer => {
      return jsonReply({
        id: FOG,
        properties: {
          replicationRole: "Primary",
          partnerServers: [{ id: PARTNER }],
        },
      });
    });

    assertNotRun(
      await runCloud(h, "azure", `cloud fail-over-database ${FOG}`),
      /would change \/subscriptions\/.*\/servers\/orders-west\/failovergroups\/orders-fog, which the Cloud AI agent protects \(\*\/servers\/orders-west\/\*\)/,
    );
    assert.deepStrictEqual(
      h.arm.callsTo("POST", `${PARTNER}/failoverGroups/orders-fog/failover`),
      [],
    );
  });
});

describe("Azure: long-running operations and failures", () => {
  test("an operation that fails fails the command, as a change that ran", async () => {
    const h: CloudHarness = cloudHarness("azure");

    h.arm.handle("GET", VM, (): FakeAnswer => {
      return jsonReply(vm("running"));
    });
    h.arm.handle("POST", `${VM}/restart`, (): FakeAnswer => {
      return acceptedWith(
        h,
        ["InProgress", "Failed"],
        "The VM agent did not respond",
      );
    });

    const result: ExecResult = await runCloud(
      h,
      "azure",
      `cloud reboot-instance ${VM}`,
    );

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.exitCode, 1);
    assert.deepStrictEqual(readCloudReplacedValue(result.output), {});
    assert.strictEqual(
      result.errorMessage,
      "Exit code 1: Azure accepted the change, then its operation failed: The VM agent did not respond.",
    );
  });

  test("an operation still running when the budget ends is reported as accepted and still running", async () => {
    const h: CloudHarness = cloudHarness("azure");

    h.arm.handle("GET", VM, (): FakeAnswer => {
      return jsonReply(vm("running"));
    });
    h.arm.handle("POST", `${VM}/restart`, (): FakeAnswer => {
      return acceptedWith(h, ["InProgress"]);
    });

    const result: ExecResult = await runCloud(
      h,
      "azure",
      `cloud reboot-instance ${VM}`,
      {
        timeoutInMs: 10_000,
      },
    );
    const lines: Array<string> = assertChanged(result, {});

    assert.strictEqual(
      lines[3],
      "Azure accepted the change and was still carrying it out when the agent stopped waiting; read the resource's state to see it finish.",
    );
    // Never past the budget (less its headroom).
    assert.ok(
      h.clock.sleeps.reduce((sum: number, ms: number): number => {
        return sum + ms;
      }, 0) <=
        10_000 - 1_500,
    );
  });

  test("a Location operation is done once it stops answering 202", async () => {
    const h: CloudHarness = cloudHarness("azure");
    let polls: number = 0;

    h.arm.handle("GET", VMSS, (): FakeAnswer => {
      return jsonReply({
        id: VMSS,
        sku: { name: "Standard_D2s_v5", tier: "Standard", capacity: 2 },
      });
    });
    h.arm.handle("PATCH", VMSS, (): FakeAnswer => {
      return reply(202, "", {
        Location: `https://management.azure.com${OPERATION_PATH}?api-version=2024-07-01&monitor=true`,
      });
    });
    h.arm.handle("GET", OPERATION_PATH, (): FakeAnswer => {
      polls++;
      return polls < 2 ? reply(202, "") : reply(200, "{}");
    });

    const lines: Array<string> = assertChanged(
      await runCloud(h, "azure", `cloud scale-out ${VMSS} --count 3`),
      { count: "2" },
    );

    assert.strictEqual(lines[3], "Azure carried the change out.");
    assert.strictEqual(polls, 2);
    assert.strictEqual(
      h.arm.callsTo("GET", OPERATION_PATH)[0]?.query["monitor"],
      "true",
    );
  });

  test("a polling URL off Resource Manager is never followed (the token stays home)", async () => {
    const h: CloudHarness = cloudHarness("azure");

    h.arm.handle("GET", VM, (): FakeAnswer => {
      return jsonReply(vm("running"));
    });
    h.arm.handle("POST", `${VM}/restart`, (): FakeAnswer => {
      return reply(202, "", {
        "Azure-AsyncOperation": "https://attacker.example.com/operations/1",
      });
    });

    const lines: Array<string> = assertChanged(
      await runCloud(h, "azure", `cloud reboot-instance ${VM}`),
      {},
    );

    assert.match(
      lines[3] || "",
      /^Azure accepted the change; the agent could not follow it \(Azure pointed the agent at https:\/\/attacker\.example\.com, which is not Azure Resource Manager, so the agent did not follow it\.\)\.$/,
    );
    assert.ok(
      !h.cloud.requests.some((request: CloudHttpRequest): boolean => {
        return new URL(request.url).hostname === "attacker.example.com";
      }),
    );
  });

  test("a change the role may not make: exit code 1, naming the RBAC action and what the change needs", async () => {
    const h: CloudHarness = cloudHarness("azure");

    h.arm.handle("GET", SITE, (): FakeAnswer => {
      return jsonReply({ id: SITE, properties: { state: "Running" } });
    });
    h.arm.handle("POST", `${SITE}/restart`, (): FakeAnswer => {
      return jsonReply(
        {
          error: {
            code: "AuthorizationFailed",
            message: `The client 'x' with object id 'y' does not have authorization to perform action 'Microsoft.Web/sites/restart/action' over scope '${SITE}'`,
          },
        },
        403,
      );
    });

    const result: ExecResult = await runCloud(
      h,
      "azure",
      `cloud restart-service ${SITE}`,
    );

    assert.strictEqual(result.exitCode, 1);
    assert.match(
      String(result.errorMessage),
      /^Exit code 1: Azure refused Microsoft\.Web\/sites\/restart\/action \(HTTP 403 AuthorizationFailed\): The client 'x' .*\. The agent's identity \(the Container App's managed identity, system-assigned\) lacks Microsoft\.Web\/sites\/restart\/action on \/subscriptions\/0b1c2d3e-4f50-4172-8394-a5b6c7d8e9f0\/resourcegroups\/prod\/providers\/microsoft\.web\/sites\/web: the setup command's role grants it when restart-service is in ONEUPTIME_AI_CLOUD_OPERATIONS \(cloud restart-service on an App Service or Function App needs Microsoft\.Web\/sites\/restart\/action, Microsoft\.Web\/sites\/read\)\.$/,
    );
  });

  test("Azure ids are compared without case; the agent's own resource group is protected under any spelling", () => {
    const h: CloudHarness = cloudHarness("azure");

    assert.match(
      refusalOf(
        h,
        "azure",
        `cloud reboot-instance /subscriptions/${SUB.toUpperCase()}/resourceGroups/ONEUPTIME-AI-AGENT/providers/Microsoft.Compute/virtualMachines/vm-1`,
      ),
      /which the Cloud AI agent protects/,
    );
  });
});

describe("Azure: identity and posture", () => {
  test("the one subscription the identity may read, lowercased; several are no answer", async () => {
    const one: CloudHarness = cloudHarness("azure", { identity: null });

    one.arm.handle("GET", "/subscriptions", (): FakeAnswer => {
      return jsonReply({
        value: [{ subscriptionId: SUB.toUpperCase(), displayName: "Shop" }],
      });
    });

    assert.strictEqual(await one.executor.resolveResourceIdentifier(), SUB);
    assert.strictEqual(one.arm.calls[0]?.apiVersion, "2022-12-01");

    const several: CloudHarness = cloudHarness("azure", { identity: null });

    several.arm.handle("GET", "/subscriptions", (): FakeAnswer => {
      return jsonReply({
        value: [
          { subscriptionId: SUB },
          { subscriptionId: "11111111-2222-3333-4444-555555555555" },
        ],
      });
    });

    assert.strictEqual(
      await several.executor.resolveResourceIdentifier(),
      null,
    );
    assert.match(
      several.logger.records[0]?.message || "",
      /can read 2 subscriptions, so it cannot tell which one it serves\. Set AZURE_SUBSCRIPTION_ID/,
    );
  });

  test("reachable: its subscription, its identity; its own resource group and Container App protected", async () => {
    const h: CloudHarness = cloudHarness("azure", {
      env: { CONTAINER_APP_NAME: "oneuptime-ai-agent-2" },
    });

    h.arm.handle("GET", `/subscriptions/${SUB}`, (): FakeAnswer => {
      return jsonReply({
        subscriptionId: SUB,
        displayName: "Shop production",
        state: "Enabled",
      });
    });

    const probe: ResourcePostureProbe = await h.executor.probePosture();

    assert.deepStrictEqual(probe, {
      toolVersion: "Azure Resource Manager",
      reachable: true,
      reachError: null,
      details: {
        cloudProvider: "azure",
        cloudAccountId: SUB,
        enabledOperations:
          "restart-service,start-instance,scale-out,scale-in,reboot-instance,roll-back-service,fail-over-database,stop-instance",
        requiredTag: null,
        azureSubscriptionName: "Shop production",
        azureSubscriptionState: "Enabled",
        azureIdentity: IDENTITY,
      },
      protectedTargets: [
        `/subscriptions/${SUB}/resourcegroups/oneuptime-ai-agent/*`,
        `/subscriptions/${SUB}/resourcegroups/*/providers/microsoft.app/containerapps/oneuptime-ai-agent-2`,
      ],
    });
  });

  test("unreachable when the subscription cannot be read", async () => {
    const h: CloudHarness = cloudHarness("azure");

    h.arm.handle("GET", `/subscriptions/${SUB}`, (): FakeAnswer => {
      return jsonReply(
        { error: { code: "SubscriptionNotFound", message: "not found" } },
        404,
      );
    });

    const probe: ResourcePostureProbe = await h.executor.probePosture();

    assert.strictEqual(probe.reachable, false);
    assert.match(
      String(probe.reachError),
      /^The Azure Cloud AI agent could not read its subscription .* with the Container App's managed identity, system-assigned: Azure refused Microsoft\.Resources\/subscriptions\/read \(HTTP 404 SubscriptionNotFound\): not found\.$/,
    );
  });
});
