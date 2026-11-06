import { recordingLogger } from "./Helpers/TestSupport";
import assert from "assert";
import { describe, test } from "node:test";
import {
  ExecResult,
  ResourcePostureProbe,
} from "../Executors/ResourceExecutor";
import AzureCloud from "../Executors/Cloud/AzureOperations";
import { CloudHttpRequest } from "../Executors/Cloud/CloudHttp";
import {
  CloudCommandRun,
  CloudNotRunError,
  CloudRuntime,
} from "../Executors/Cloud/CloudChange";
import {
  CloudAgentSettings,
  parseCloudAgentSettings,
} from "../Executors/Cloud/CloudSettings";
import {
  AZURE_IDENTITY_ENDPOINT,
  AZURE_IDENTITY_HEADER,
  AZURE_IMDS_URL,
  AZURE_OWN_PRINCIPAL_ID,
  AZURE_SUBSCRIPTION,
  AZURE_TOKEN,
  AZURE_WRITE_IDENTITY,
  AZURE_WRITE_PRINCIPAL_ID,
  ArmCall,
  FakeAnswer,
  azureJwt,
  azureWriteToken,
  jsonReply,
  reply,
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
import {
  AZURE_CLOUD_AI_AGENT_WRITE_IDENTITY_NAME,
  getAzureCloudAiAgentWriteIdentityId,
} from "../Common/Types/ResourceAiAgent/CloudAiAgentNames";
import {
  CloudCommandParse,
  parseCloudCommand,
  readCloudDryRunVerdict,
} from "../Common/Utils/AiRemediation/Resource/CloudOperationCatalog";

/*
 * The Azure Cloud AI agent's changes, as its setup command sets it up: the
 * Container App's own (system-assigned) identity only reads, and each
 * change runs as the write identity (ONEUPTIME_AI_AZURE_WRITE_IDENTITY), a
 * user-assigned managed identity attached to the same Container App, with a
 * token the agent asks the identity endpoint for, by the identity's
 * resource ID, for that one change. Pinned against the fake identity
 * endpoint, IMDS and Azure Resource Manager:
 *
 *  - the token is asked for by resource ID (mi_res_id on the identity
 *    endpoint, msi_res_id on IMDS), never kept: each change asks for its
 *    own, and the change's reads and its call carry it;
 *  - a token Azure will not give (the identity is not attached where the
 *    agent runs, or is gone) changes nothing, and says how to fix it;
 *  - a dry run reads as the agent's own identity, and asks for no token of
 *    the write identity;
 *  - a setting that is not a user-assigned identity's resource ID, or names
 *    one of another subscription, refuses every change - and never falls
 *    back to the agent's own identity, even past the executor's checks;
 *  - Test connection says which identity changes run as and whether the
 *    agent can sign in as it (only asking for its token tells), and uses
 *    that token for nothing;
 *  - the posture names the write identity, and its object id once a change
 *    or Test connection learned it, which marks its changes as the agent's
 *    own on the subscription's Changes page (CloudAiChangeAttribution);
 *  - an agent set up before (no write identity) changes as its own
 *    identity, as it did then.
 */

const SUB: string = AZURE_SUBSCRIPTION;
const PROVIDERS: string = `/subscriptions/${SUB}/resourceGroups/prod/providers`;
const VM: string = `${PROVIDERS}/Microsoft.Compute/virtualMachines/vm-1`;
const WRITE_ENV: Record<string, string> = {
  ONEUPTIME_AI_AZURE_WRITE_IDENTITY: AZURE_WRITE_IDENTITY,
};
const AS_WRITE_IDENTITY: string =
  "the write identity oneuptime-ai-agent-write, signed in for this change";
const OTHER_SUBSCRIPTION: string = "11111111-2222-4333-8444-555555555555";

// A deallocated VM a start can be sent to, which Azure carries out at once.
function withDeallocatedVm(h: CloudHarness): void {
  h.arm.handle("GET", VM, (): FakeAnswer => {
    return jsonReply({
      id: VM,
      name: "vm-1",
      tags: {},
      properties: {
        instanceView: {
          statuses: [{ code: "PowerState/deallocated" }],
        },
      },
    });
  });
  h.arm.handle("POST", `${VM}/start`, (): FakeAnswer => {
    return reply(200, "");
  });
  h.arm.handle("GET", `/subscriptions/${SUB}`, (): FakeAnswer => {
    return jsonReply({
      subscriptionId: SUB,
      displayName: "Shop production",
      state: "Enabled",
    });
  });
}

function writeHarness(env: Record<string, string> = WRITE_ENV): CloudHarness {
  const h: CloudHarness = cloudHarness("azure", { env });

  withDeallocatedVm(h);
  return h;
}

function authorizations(h: CloudHarness): Array<string | null> {
  return h.arm.calls.map((call: ArmCall): string | null => {
    return call.authorization;
  });
}

function urlOf(request: CloudHttpRequest | undefined): URL {
  return new URL(request?.url || "http://missing.invalid/");
}

describe("Azure: each change runs as the write identity", () => {
  test("a token of the write identity, asked for by its resource ID, signs the change's reads and its call", async () => {
    const h: CloudHarness = writeHarness();
    const lines: Array<string> = assertChanged(
      await runCloud(h, "azure", `cloud start-instance ${VM}`),
      { state: "deallocated" },
    );

    assert.strictEqual(
      lines[2],
      `API call: Microsoft.Compute/virtualMachines start (POST start), as ${AS_WRITE_IDENTITY}.`,
    );
    assert.deepStrictEqual(h.arm.paths(), [`GET ${VM}`, `POST ${VM}/start`]);
    assert.deepStrictEqual(authorizations(h), [
      `Bearer ${azureWriteToken(1)}`,
      `Bearer ${azureWriteToken(1)}`,
    ]);

    // Asked of the Container App's identity endpoint, with its header, by resource ID alone.
    assert.strictEqual(h.arm.writeTokenRequests.length, 1);

    const request: CloudHttpRequest | undefined = h.arm.writeTokenRequests[0];
    const url: URL = urlOf(request);

    assert.strictEqual(`${url.origin}${url.pathname}`, AZURE_IDENTITY_ENDPOINT);
    assert.strictEqual(url.searchParams.get("api-version"), "2019-08-01");
    assert.strictEqual(
      url.searchParams.get("resource"),
      "https://management.azure.com/",
    );
    assert.strictEqual(url.searchParams.get("mi_res_id"), AZURE_WRITE_IDENTITY);
    assert.strictEqual(url.searchParams.get("client_id"), null);
    assert.strictEqual(url.searchParams.get("msi_res_id"), null);
    assert.strictEqual(
      request?.headers["X-IDENTITY-HEADER"],
      AZURE_IDENTITY_HEADER,
    );

    // The agent's own identity signed nothing of the change.
    assert.deepStrictEqual(h.arm.tokenRequests, []);
  });

  test("no token is kept: each change asks for its own", async () => {
    const h: CloudHarness = writeHarness();

    await runCloud(h, "azure", `cloud start-instance ${VM}`);
    await runCloud(h, "azure", `cloud start-instance ${VM}`);

    assert.strictEqual(h.arm.writeTokenRequests.length, 2);
    assert.deepStrictEqual(
      h.arm.callsTo("POST", `${VM}/start`).map((call: ArmCall) => {
        return call.authorization;
      }),
      [`Bearer ${azureWriteToken(1)}`, `Bearer ${azureWriteToken(2)}`],
    );
  });

  test("on a VM, the Instance Metadata Service is asked, by msi_res_id", async () => {
    const h: CloudHarness = writeHarness({
      ...WRITE_ENV,
      IDENTITY_ENDPOINT: "",
      IDENTITY_HEADER: "",
    });

    assertChanged(await runCloud(h, "azure", `cloud start-instance ${VM}`), {
      state: "deallocated",
    });

    const request: CloudHttpRequest | undefined = h.arm.writeTokenRequests[0];
    const url: URL = urlOf(request);

    assert.strictEqual(`${url.origin}${url.pathname}`, AZURE_IMDS_URL);
    assert.strictEqual(url.searchParams.get("api-version"), "2018-02-01");
    assert.strictEqual(
      url.searchParams.get("msi_res_id"),
      AZURE_WRITE_IDENTITY,
    );
    assert.strictEqual(url.searchParams.get("mi_res_id"), null);
    assert.strictEqual(request?.headers["Metadata"], "true");
    assert.deepStrictEqual(authorizations(h), [
      `Bearer ${azureWriteToken(1)}`,
      `Bearer ${azureWriteToken(1)}`,
    ]);
  });

  test("an own identity picked with AZURE_CLIENT_ID changes nothing about the write identity's request", async () => {
    const h: CloudHarness = writeHarness({
      ...WRITE_ENV,
      AZURE_CLIENT_ID: "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d",
    });

    assertChanged(await runCloud(h, "azure", `cloud start-instance ${VM}`), {
      state: "deallocated",
    });

    const url: URL = urlOf(h.arm.writeTokenRequests[0]);

    assert.strictEqual(url.searchParams.get("mi_res_id"), AZURE_WRITE_IDENTITY);
    assert.strictEqual(url.searchParams.get("client_id"), null);
  });

  test("the write identity not attached where the agent runs: nothing is read or changed, and it says what to do", async () => {
    const h: CloudHarness = writeHarness();

    h.arm.attachedIdentities = [];

    assertNotRun(
      await runCloud(h, "azure", `cloud start-instance ${VM}`),
      /^The agent could not ask Azure to sign in as the write identity oneuptime-ai-agent-write for this change, so nothing was changed: the managed identity endpoint answered HTTP 400 and no token of the write identity oneuptime-ai-agent-write \(Unable to load the proper Managed Identity\.\)\. Attach that identity where the agent runs - the setup command attaches it to the agent's Container App - or run the setup command again, which makes it\.$/,
    );
    // Nothing was read or sent as anyone: not as the write identity, not as the agent's own.
    assert.deepStrictEqual(h.arm.calls, []);
    assert.deepStrictEqual(h.arm.tokenRequests, []);
  });

  test("an endpoint that does not answer changes nothing", async () => {
    const h: CloudHarness = writeHarness();

    h.cloud.on(
      "GET",
      AZURE_IDENTITY_ENDPOINT,
      (_request: CloudHttpRequest, url: URL): FakeAnswer => {
        return url.searchParams.get("mi_res_id")
          ? new Error("connect ECONNREFUSED 127.0.0.1:42356")
          : jsonReply({ access_token: AZURE_TOKEN, expires_in: "3600" });
      },
    );

    assertNotRun(
      await runCloud(h, "azure", `cloud start-instance ${VM}`),
      /so nothing was changed: the managed identity endpoint did not answer: connect ECONNREFUSED 127\.0\.0\.1:42356\.$/,
    );
    assert.deepStrictEqual(h.arm.calls, []);
  });

  test("a permission the write identity lacks is named for the write identity", async () => {
    const h: CloudHarness = writeHarness();

    h.arm.handle("POST", `${VM}/start`, (): FakeAnswer => {
      return jsonReply(
        {
          error: {
            code: "AuthorizationFailed",
            message:
              "The client does not have authorization to perform action 'Microsoft.Compute/virtualMachines/start/action'.",
          },
        },
        403,
      );
    });

    const result: ExecResult = await runCloud(
      h,
      "azure",
      `cloud start-instance ${VM}`,
    );

    assert.strictEqual(result.exitCode, 1);
    assert.match(
      String(result.errorMessage),
      /\. The write identity oneuptime-ai-agent-write lacks Microsoft\.Compute\/virtualMachines\/start\/action on \/subscriptions\/0b1c2d3e-4f50-4172-8394-a5b6c7d8e9f0\/resourcegroups\/prod\/providers\/microsoft\.compute\/virtualmachines\/vm-1: the setup command's role grants it when start-instance is in ONEUPTIME_AI_CLOUD_OPERATIONS/,
    );
  });

  test("a dry run reads as the agent's own identity, and asks for no token of the write identity", async () => {
    const h: CloudHarness = writeHarness();
    const result: ExecResult = await runCloud(
      h,
      "azure",
      `cloud dry-run start-instance ${VM}`,
    );

    assert.strictEqual(readCloudDryRunVerdict(result.output), "would-run");
    assert.deepStrictEqual(h.arm.paths(), [`GET ${VM}`]);
    assert.deepStrictEqual(authorizations(h), [`Bearer ${AZURE_TOKEN}`]);
    assert.deepStrictEqual(h.arm.writeTokenRequests, []);
  });

  test("an agent set up before (no write identity) changes as its own identity, as it did then", async () => {
    const h: CloudHarness = writeHarness({});

    assertChanged(await runCloud(h, "azure", `cloud start-instance ${VM}`), {
      state: "deallocated",
    });
    assert.deepStrictEqual(h.arm.writeTokenRequests, []);
    assert.deepStrictEqual(authorizations(h), [
      `Bearer ${AZURE_TOKEN}`,
      `Bearer ${AZURE_TOKEN}`,
    ]);
  });

  test("told to stop before its call: the write identity's token was asked for, the change never sent", async () => {
    const h: CloudHarness = writeHarness();
    const result: ExecResult = await prepared(
      h.executor.prepare(cloudRequest("azure", `cloud start-instance ${VM}`)),
    ).run({
      stopReason: (): string | null => {
        return "OneUptime AI was turned off for this project (Enable AI) while its agent held this command.";
      },
    });

    assertNotRun(
      result,
      /^The change was not sent, so nothing was changed: OneUptime AI was turned off for this project \(Enable AI\) while its agent held this command\.$/,
    );
    assert.deepStrictEqual(h.arm.callsTo("POST", `${VM}/start`), []);
  });
});

describe("Azure: the write identity setting", () => {
  test("a value that is not a user-assigned identity's resource ID refuses every change, and never falls back to the agent's own identity", async () => {
    for (const value of [
      // A client id, an object id: not what the agent asks for its token by.
      "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d",
      AZURE_CLOUD_AI_AGENT_WRITE_IDENTITY_NAME,
      // The Container App itself, whose identity is the agent's own.
      `/subscriptions/${SUB}/resourceGroups/oneuptime-ai-agent/providers/Microsoft.App/containerApps/oneuptime-ai-agent`,
      `${AZURE_WRITE_IDENTITY}/`,
      `${AZURE_WRITE_IDENTITY}/federatedIdentityCredentials/x`,
      `/subscriptions/not-a-subscription/resourceGroups/oneuptime-ai-agent/providers/Microsoft.ManagedIdentity/userAssignedIdentities/oneuptime-ai-agent-write`,
      `/subscriptions/${SUB}/resourceGroups/oneuptime-ai-agent/providers/Microsoft.ManagedIdentity/userAssignedIdentities/x`,
    ]) {
      const h: CloudHarness = writeHarness({
        ONEUPTIME_AI_AZURE_WRITE_IDENTITY: value,
      });

      assert.match(
        refusalOf(h, "azure", `cloud start-instance ${VM}`),
        /^Refused by the Cloud AI agent: ONEUPTIME_AI_AZURE_WRITE_IDENTITY=".*" is not the resource ID of a user-assigned managed identity \(\/subscriptions\/<subscription id>\/resourcegroups\/oneuptime-ai-agent\/providers\/microsoft\.managedidentity\/userassignedidentities\/oneuptime-ai-agent-write\), so the agent changes nothing until it is fixed\.$/,
        value,
      );
      assert.deepStrictEqual(h.cloud.requests, [], value);
    }
  });

  test("a long value is read in time in line with its length: the ID's pattern is anchored, its repeats bounded", () => {
    for (const value of [
      `/subscriptions/${"0".repeat(400_000)}`,
      `/subscriptions/${SUB}/resourceGroups/${"a".repeat(400_000)}`,
      `${AZURE_WRITE_IDENTITY}${"-".repeat(400_000)}`,
      "/".repeat(400_000),
    ]) {
      // The fastest of three attempts: one attempt on a busy runner can stall.
      let fastest: number = Number.POSITIVE_INFINITY;
      let settings: CloudAgentSettings | null = null;

      for (let attempt: number = 0; attempt < 3; attempt++) {
        const startedAt: number = Date.now();
        settings = parseCloudAgentSettings(
          { ONEUPTIME_AI_AZURE_WRITE_IDENTITY: value },
          "azure",
        );
        fastest = Math.min(fastest, Date.now() - startedAt);
      }

      assert.strictEqual(settings?.azureWriteIdentity, null);
      assert.ok(fastest < 2_000, `read in ${fastest} ms`);
      // What it shows of the value is short.
      assert.ok(String(settings?.azureWriteIdentityProblem).length < 600);
    }
  });

  test("the value is shown lowercased, so the output's redactor leaves it readable", () => {
    const settings: CloudAgentSettings = parseCloudAgentSettings(
      {
        ONEUPTIME_AI_AZURE_WRITE_IDENTITY: `/subscriptions/${SUB}/resourceGroups/Prod/providers/Microsoft.App/containerApps/Api`,
      },
      "azure",
    );

    assert.strictEqual(settings.azureWriteIdentity, null);
    assert.ok(
      String(settings.azureWriteIdentityProblem).startsWith(
        `ONEUPTIME_AI_AZURE_WRITE_IDENTITY="/subscriptions/${SUB}/resourcegroups/prod/providers/microsoft.app/containerapps/api" is not`,
      ),
      String(settings.azureWriteIdentityProblem),
    );
    assert.deepStrictEqual(settings.warnings, [
      settings.azureWriteIdentityProblem,
    ]);
  });

  test("a write identity of another subscription refuses every change, with no fall back", async () => {
    const h: CloudHarness = writeHarness({
      ONEUPTIME_AI_AZURE_WRITE_IDENTITY:
        getAzureCloudAiAgentWriteIdentityId(OTHER_SUBSCRIPTION),
    });
    const why: string = `ONEUPTIME_AI_AZURE_WRITE_IDENTITY names an identity of subscription ${OTHER_SUBSCRIPTION}, but the agent serves subscription ${SUB}, so it changes nothing.`;

    assert.strictEqual(
      refusalOf(h, "azure", `cloud start-instance ${VM}`),
      `Refused by the Cloud AI agent: ${why}`,
    );

    // A dry run of it says the change would be refused, for the same reason, and reads nothing.
    const dryRun: ExecResult = await runCloud(
      h,
      "azure",
      `cloud dry-run start-instance ${VM}`,
    );

    assert.strictEqual(
      readCloudDryRunVerdict(dryRun.output),
      "would-be-refused",
    );
    assert.match(
      dryRun.output,
      /would be refused: ONEUPTIME_AI_AZURE_WRITE_IDENTITY names an identity of subscription 11111111-2222-4333-8444-555555555555, but the agent serves subscription 0b1c2d3e-4f50-4172-8394-a5b6c7d8e9f0, so it changes nothing\./,
    );
    assert.deepStrictEqual(h.arm.calls, []);
    assert.deepStrictEqual(h.arm.writeTokenRequests, []);
    assert.deepStrictEqual(h.arm.tokenRequests, []);
  });

  test("an agent that does not know its subscription changes nothing, and says that, not the write identity, is why", () => {
    const h: CloudHarness = cloudHarness("azure", {
      env: WRITE_ENV,
      identity: null,
    });

    assert.strictEqual(
      refusalOf(h, "azure", `cloud start-instance ${VM}`),
      "Refused by the Cloud AI agent: it does not know which Azure subscription it serves, so it runs nothing.",
    );
    assert.deepStrictEqual(h.cloud.requests, []);
  });

  test("its subscription is compared without case, as Azure compares IDs", async () => {
    const h: CloudHarness = writeHarness({
      ONEUPTIME_AI_AZURE_WRITE_IDENTITY: AZURE_WRITE_IDENTITY.toUpperCase(),
    });

    h.arm.attachedIdentities = [AZURE_WRITE_IDENTITY];

    assertChanged(await runCloud(h, "azure", `cloud start-instance ${VM}`), {
      state: "deallocated",
    });
    // Asked for as written: Azure reads the ID without case.
    assert.strictEqual(
      urlOf(h.arm.writeTokenRequests[0]).searchParams.get("mi_res_id"),
      AZURE_WRITE_IDENTITY.toUpperCase(),
    );
  });

  test("handed a change past the executor's checks, an identity it will not use still refuses it, and nothing is sent", async () => {
    const runtime: CloudRuntime = {
      transport: async (): Promise<never> => {
        throw new Error("nothing may be sent");
      },
      nowMs: (): number => {
        return Date.parse("2026-11-06T12:00:00.000Z");
      },
      sleep: async (): Promise<void> => {
        // never waits
      },
      logger: recordingLogger(),
      userAgent: "oneuptime-resource-ai-agent/test",
    };
    const parse: CloudCommandParse = parseCloudCommand("azure", [
      "cloud",
      "start-instance",
      VM,
    ]);

    assert.ok(parse.ok);

    for (const value of [
      "not-an-identity",
      getAzureCloudAiAgentWriteIdentityId(OTHER_SUBSCRIPTION),
    ]) {
      const env: NodeJS.ProcessEnv = {
        IDENTITY_ENDPOINT: AZURE_IDENTITY_ENDPOINT,
        IDENTITY_HEADER: AZURE_IDENTITY_HEADER,
        ONEUPTIME_AI_AZURE_WRITE_IDENTITY: value,
      };
      const settings: CloudAgentSettings = parseCloudAgentSettings(
        env,
        "azure",
      );
      const azure: AzureCloud = new AzureCloud({ env, runtime });
      let refusal: unknown = null;

      try {
        await azure.change({
          run: new CloudCommandRun(runtime, parse.command, settings, 30_000),
          subscriptionId: SUB,
          checkTarget: (): null => {
            return null;
          },
        });
      } catch (err: unknown) {
        refusal = err;
      }

      assert.ok(refusal instanceof CloudNotRunError, value);
      assert.strictEqual((refusal as CloudNotRunError).isRefusal, true);
      assert.match(
        (refusal as CloudNotRunError).message,
        /ONEUPTIME_AI_AZURE_WRITE_IDENTITY/,
      );
    }
  });
});

describe("Azure: Test connection and the posture name the write identity", () => {
  test("Test connection: the identity, and that the agent can sign in as it, as its object id; the token is used for nothing", async () => {
    const h: CloudHarness = writeHarness();
    const lines: Array<string> = outputLines(
      await runCloud(h, "azure", "cloud whoami", { origin: "AiInvestigation" }),
    );

    assert.strictEqual(
      lines[3],
      `Write identity: oneuptime-ai-agent-write (${AZURE_WRITE_IDENTITY.toLowerCase()}), which the agent signs in as for each change (the agent can sign in as it, as object id ${AZURE_WRITE_PRINCIPAL_ID})`,
    );
    // Its one call reads the subscription, as the agent's own identity.
    assert.deepStrictEqual(h.arm.paths(), [`GET /subscriptions/${SUB}`]);
    assert.deepStrictEqual(authorizations(h), [`Bearer ${AZURE_TOKEN}`]);
    assert.strictEqual(h.arm.writeTokenRequests.length, 1);
  });

  test("Test connection: an identity the agent cannot sign in as is said, with every change failing", async () => {
    const h: CloudHarness = writeHarness();

    h.arm.attachedIdentities = [];

    const lines: Array<string> = outputLines(
      await runCloud(h, "azure", "cloud whoami", { origin: "AiInvestigation" }),
    );

    assert.match(
      lines[3] || "",
      /^Write identity: oneuptime-ai-agent-write \(\/subscriptions\/[0-9a-f-]+\/resourcegroups\/oneuptime-ai-agent\/providers\/microsoft\.managedidentity\/userassignedidentities\/oneuptime-ai-agent-write\), which the agent signs in as for each change \(the agent can NOT sign in as it, so every change fails: the managed identity endpoint answered HTTP 400 and no token of the write identity oneuptime-ai-agent-write \(Unable to load the proper Managed Identity\.\)\. Attach that identity where the agent runs/,
    );
  });

  test("Test connection: none, one it cannot read, and one of another subscription - never signing in as either", async () => {
    const none: Array<string> = outputLines(
      await runCloud(writeHarness({}), "azure", "cloud whoami", {
        origin: "AiInvestigation",
      }),
    );

    assert.strictEqual(
      none[3],
      "Write identity: none (ONEUPTIME_AI_AZURE_WRITE_IDENTITY is not set): changes use the agent's own identity, with whatever it allows",
    );

    const wrong: CloudHarness = writeHarness({
      ONEUPTIME_AI_AZURE_WRITE_IDENTITY: "nope",
    });

    assert.strictEqual(
      outputLines(
        await runCloud(wrong, "azure", "cloud whoami", {
          origin: "AiInvestigation",
        }),
      )[3],
      'Write identity: ONEUPTIME_AI_AZURE_WRITE_IDENTITY="nope" is not the resource ID of a user-assigned managed identity (/subscriptions/<subscription id>/resourcegroups/oneuptime-ai-agent/providers/microsoft.managedidentity/userassignedidentities/oneuptime-ai-agent-write), so the agent changes nothing until it is fixed.',
    );
    assert.deepStrictEqual(wrong.arm.writeTokenRequests, []);

    const elsewhere: CloudHarness = writeHarness({
      ONEUPTIME_AI_AZURE_WRITE_IDENTITY:
        getAzureCloudAiAgentWriteIdentityId(OTHER_SUBSCRIPTION),
    });

    assert.strictEqual(
      outputLines(
        await runCloud(elsewhere, "azure", "cloud whoami", {
          origin: "AiInvestigation",
        }),
      )[3],
      `Write identity: ONEUPTIME_AI_AZURE_WRITE_IDENTITY names an identity of subscription ${OTHER_SUBSCRIPTION}, but the agent serves subscription ${SUB}, so it changes nothing`,
    );
    assert.deepStrictEqual(elsewhere.arm.writeTokenRequests, []);
  });

  test("Test connection: where the write identity is all the agent has, it says the agent reads with it too", async () => {
    const h: CloudHarness = writeHarness();

    // A VM with only the write identity attached: its own token is the write identity's.
    h.arm.token = azureJwt({ oid: AZURE_WRITE_PRINCIPAL_ID });

    const lines: Array<string> = outputLines(
      await runCloud(h, "azure", "cloud whoami", { origin: "AiInvestigation" }),
    );

    assert.match(
      lines[3] || "",
      /\(the agent can sign in as it, as object id 6d5c4b3a-2f1e-4d0c-9b8a-7f6e5d4c3b2a, which is the agent's own identity as well: give the agent an identity of its own that only reads\)$/,
    );
  });

  test("the posture names the write identity, and its object id once a change or Test connection learned it - never asking for a token itself", async () => {
    const h: CloudHarness = writeHarness();

    h.arm.token = azureJwt({ oid: AZURE_OWN_PRINCIPAL_ID });

    const before: ResourcePostureProbe = await h.executor.probePosture();

    assert.strictEqual(
      before.details?.["azureWriteIdentity"],
      AZURE_WRITE_IDENTITY,
    );
    assert.strictEqual(before.details?.["azureWritePrincipalId"], null);
    assert.strictEqual(
      before.details?.["azurePrincipalId"],
      AZURE_OWN_PRINCIPAL_ID,
    );
    assert.deepStrictEqual(h.arm.writeTokenRequests, []);

    await runCloud(h, "azure", `cloud start-instance ${VM}`);

    const after: ResourcePostureProbe = await h.executor.probePosture();

    assert.strictEqual(
      after.details?.["azureWritePrincipalId"],
      AZURE_WRITE_PRINCIPAL_ID,
    );
    assert.strictEqual(
      after.details?.["azurePrincipalId"],
      AZURE_OWN_PRINCIPAL_ID,
    );
    // The probe itself asked for no token of the write identity: the change did, once.
    assert.strictEqual(h.arm.writeTokenRequests.length, 1);

    // Test connection teaches it as well.
    const tested: CloudHarness = writeHarness();

    await runCloud(tested, "azure", "cloud whoami", {
      origin: "AiInvestigation",
    });
    assert.strictEqual(
      (await tested.executor.probePosture()).details?.["azureWritePrincipalId"],
      AZURE_WRITE_PRINCIPAL_ID,
    );

    // Without one, the posture has none to name.
    const unset: ResourcePostureProbe = await writeHarness(
      {},
    ).executor.probePosture();

    for (const key of ["azureWriteIdentity", "azureWritePrincipalId"]) {
      assert.strictEqual(
        Object.prototype.hasOwnProperty.call(unset.details || {}, key),
        false,
        key,
      );
    }
  });

  test("a setting it cannot use, or one of another subscription, is the posture's settings problem", async () => {
    const wrong: ResourcePostureProbe = await writeHarness({
      ONEUPTIME_AI_AZURE_WRITE_IDENTITY: "nope",
    }).executor.probePosture();

    assert.match(
      String(wrong.details?.["settingsProblem"]),
      /^ONEUPTIME_AI_AZURE_WRITE_IDENTITY="nope" is not the resource ID of a user-assigned managed identity/,
    );

    const elsewhere: ResourcePostureProbe = await writeHarness({
      ONEUPTIME_AI_AZURE_WRITE_IDENTITY:
        getAzureCloudAiAgentWriteIdentityId(OTHER_SUBSCRIPTION),
    }).executor.probePosture();

    assert.strictEqual(
      elsewhere.details?.["settingsProblem"],
      `ONEUPTIME_AI_AZURE_WRITE_IDENTITY names an identity of subscription ${OTHER_SUBSCRIPTION}, but the agent serves subscription ${SUB}, so it changes nothing.`,
    );

    const fine: ResourcePostureProbe =
      await writeHarness().executor.probePosture();

    assert.strictEqual(fine.details?.["settingsProblem"], undefined);
  });

  test("the write identity is one of the agent's own, which it never changes: its resource group covers it, or its ID where a team keeps it elsewhere", async () => {
    const own: ResourcePostureProbe =
      await writeHarness().executor.probePosture();

    assert.deepStrictEqual(own.protectedTargets, [
      `/subscriptions/${SUB}/resourcegroups/oneuptime-ai-agent/*`,
    ]);

    const kept: string = `/subscriptions/${SUB}/resourceGroups/Identities/providers/Microsoft.ManagedIdentity/userAssignedIdentities/ai-changes`;
    const elsewhere: ResourcePostureProbe = await writeHarness({
      ONEUPTIME_AI_AZURE_WRITE_IDENTITY: kept,
    }).executor.probePosture();

    assert.deepStrictEqual(elsewhere.protectedTargets, [
      `/subscriptions/${SUB}/resourcegroups/oneuptime-ai-agent/*`,
      kept.toLowerCase(),
    ]);
  });

  test("set on an agent of another cloud, it is a warning and nothing more", () => {
    for (const provider of ["aws", "gcp"] as const) {
      const settings: CloudAgentSettings = parseCloudAgentSettings(
        WRITE_ENV,
        provider,
      );

      assert.strictEqual(settings.azureWriteIdentity, null);
      assert.strictEqual(settings.azureWriteIdentityProblem, null);
      assert.match(
        settings.warnings.join("\n"),
        /ONEUPTIME_AI_AZURE_WRITE_IDENTITY is set, but this agent serves (AWS|Google Cloud), so it is ignored\./,
      );
    }
  });
});
