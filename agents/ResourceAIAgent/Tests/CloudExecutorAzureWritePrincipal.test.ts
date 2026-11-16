import assert from "assert";
import { describe, test } from "node:test";
import {
  ExecResult,
  ResourcePostureProbe,
} from "../Executors/ResourceExecutor";
import {
  CloudAgentSettings,
  parseAzureObjectId,
  parseCloudAgentSettings,
} from "../Executors/Cloud/CloudSettings";
import {
  AZURE_OWN_PRINCIPAL_ID,
  AZURE_SUBSCRIPTION,
  AZURE_WRITE_IDENTITY,
  AZURE_WRITE_PRINCIPAL_ID,
  FakeAnswer,
  azureJwt,
  jsonReply,
  reply,
} from "./Helpers/FakeCloud";
import {
  CloudHarness,
  assertChanged,
  cloudHarness,
  outputLines,
  runCloud,
} from "./Helpers/CloudHarness";
import { RESOURCE_AI_AZURE_WRITE_PRINCIPAL_ID_ENV } from "../Common/Types/ResourceAiAgent/ResourceAiAccess";

/*
 * The Azure write identity's object id, as its setup command passes it
 * (ONEUPTIME_AI_AZURE_WRITE_PRINCIPAL_ID, read from Azure as the command
 * makes or finds the identity): the caller the Activity Log names for the
 * agent's changes, which the subscription's Changes page marks as OneUptime
 * AI's (CloudAiChangeAttribution reads the posture's azureWritePrincipalId).
 *
 *  - the posture names it from the start: before the agent's first change
 *    or Test connection, and after a restart, which forgets what a token
 *    taught it - and the posture still asks for no token itself;
 *  - a token of the write identity names its object id, and that wins: a
 *    setting that names another one is said once in the log and on Test
 *    connection's Write identity line, and the posture names Azure's;
 *  - it is a hint and nothing more: a value that is not an object id, one
 *    beside no write identity, or one on another cloud is a warning, the
 *    posture falls back to what a token says, and no change is refused.
 */

const SUB: string = AZURE_SUBSCRIPTION;
const VM: string = `/subscriptions/${SUB}/resourceGroups/prod/providers/Microsoft.Compute/virtualMachines/vm-1`;
// What a setting typed by hand might name: an object id that is not this identity's.
const OTHER_OBJECT_ID: string = "0f0e0d0c-0b0a-4908-8706-050403020100";

function harness(env: Record<string, string>): CloudHarness {
  const h: CloudHarness = cloudHarness("azure", {
    env: {
      ONEUPTIME_AI_AZURE_WRITE_IDENTITY: AZURE_WRITE_IDENTITY,
      ...env,
    },
  });

  h.arm.token = azureJwt({ oid: AZURE_OWN_PRINCIPAL_ID });
  h.arm.handle("GET", `/subscriptions/${SUB}`, (): FakeAnswer => {
    return jsonReply({
      subscriptionId: SUB,
      displayName: "Shop production",
      state: "Enabled",
    });
  });
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
    return reply(200, "");
  });

  return h;
}

function writeIdentityLine(result: ExecResult): string {
  return (
    outputLines(result).find((line: string): boolean => {
      return line.startsWith("Write identity:");
    }) || ""
  );
}

function warningsOf(h: CloudHarness): Array<string> {
  return h.logger.records
    .filter((record: { level: string; message: string }): boolean => {
      return record.level === "warn";
    })
    .map((record: { level: string; message: string }): string => {
      return record.message;
    });
}

describe("Azure: the write identity's object id from its setup command", () => {
  test("the posture names it from the start - no change, no Test connection, no token asked for", async () => {
    const h: CloudHarness = harness({
      [RESOURCE_AI_AZURE_WRITE_PRINCIPAL_ID_ENV]: AZURE_WRITE_PRINCIPAL_ID,
    });
    const posture: ResourcePostureProbe = await h.executor.probePosture();

    assert.strictEqual(
      posture.details?.["azureWritePrincipalId"],
      AZURE_WRITE_PRINCIPAL_ID,
    );
    assert.strictEqual(
      posture.details?.["azureWriteIdentity"],
      AZURE_WRITE_IDENTITY,
    );
    assert.strictEqual(
      posture.details?.["azurePrincipalId"],
      AZURE_OWN_PRINCIPAL_ID,
    );
    assert.deepStrictEqual(h.arm.writeTokenRequests, []);
    // Nothing wrong with the setting: no problem, no warning.
    assert.strictEqual(posture.details?.["settingsProblem"], undefined);
    assert.deepStrictEqual(warningsOf(h), []);
  });

  test("after a restart, which forgets every token, it still names it", async () => {
    const before: CloudHarness = harness({
      [RESOURCE_AI_AZURE_WRITE_PRINCIPAL_ID_ENV]: AZURE_WRITE_PRINCIPAL_ID,
    });

    assertChanged(
      await runCloud(before, "azure", `cloud start-instance ${VM}`),
      {
        state: "deallocated",
      },
    );

    // A new agent: what the last one learned from a token is gone.
    const restarted: CloudHarness = harness({
      [RESOURCE_AI_AZURE_WRITE_PRINCIPAL_ID_ENV]: AZURE_WRITE_PRINCIPAL_ID,
    });

    assert.strictEqual(
      (await restarted.executor.probePosture()).details?.[
        "azureWritePrincipalId"
      ],
      AZURE_WRITE_PRINCIPAL_ID,
    );
    assert.deepStrictEqual(restarted.arm.writeTokenRequests, []);
  });

  test("without it, as before: none until a token teaches it", async () => {
    const h: CloudHarness = harness({});

    assert.strictEqual(
      (await h.executor.probePosture()).details?.["azureWritePrincipalId"],
      null,
    );

    await runCloud(h, "azure", "cloud whoami", { origin: "AiInvestigation" });

    assert.strictEqual(
      (await h.executor.probePosture()).details?.["azureWritePrincipalId"],
      AZURE_WRITE_PRINCIPAL_ID,
    );
  });

  test("the same object id as Azure's token: Test connection says nothing more about it", async () => {
    const h: CloudHarness = harness({
      [RESOURCE_AI_AZURE_WRITE_PRINCIPAL_ID_ENV]: AZURE_WRITE_PRINCIPAL_ID,
    });
    const line: string = writeIdentityLine(
      await runCloud(h, "azure", "cloud whoami", { origin: "AiInvestigation" }),
    );

    assert.strictEqual(
      line,
      `Write identity: oneuptime-ai-agent-write (resource group oneuptime-ai-agent), which the agent signs in as for each change (the agent can sign in as it, as object id ${AZURE_WRITE_PRINCIPAL_ID})`,
    );
    assert.deepStrictEqual(warningsOf(h), []);
  });

  test("another object id than Azure's token names: the token wins, and Test connection and the log say so - the log once", async () => {
    const h: CloudHarness = harness({
      [RESOURCE_AI_AZURE_WRITE_PRINCIPAL_ID_ENV]: OTHER_OBJECT_ID,
    });

    // Before any token: the setting is all the agent has.
    assert.strictEqual(
      (await h.executor.probePosture()).details?.["azureWritePrincipalId"],
      OTHER_OBJECT_ID,
    );

    const line: string = writeIdentityLine(
      await runCloud(h, "azure", "cloud whoami", { origin: "AiInvestigation" }),
    );

    assert.strictEqual(
      line,
      `Write identity: oneuptime-ai-agent-write (resource group oneuptime-ai-agent), which the agent signs in as for each change (the agent can sign in as it, as object id ${AZURE_WRITE_PRINCIPAL_ID}; ${RESOURCE_AI_AZURE_WRITE_PRINCIPAL_ID_ENV} says ${OTHER_OBJECT_ID}, which is not its object id, so the agent goes by what Azure says)`,
    );
    // The verdict first; the setting's note after it.
    assert.ok(
      line.indexOf("the agent can sign in as it") <
        line.indexOf(RESOURCE_AI_AZURE_WRITE_PRINCIPAL_ID_ENV),
      line,
    );
    // Azure's object id from now on.
    assert.strictEqual(
      (await h.executor.probePosture()).details?.["azureWritePrincipalId"],
      AZURE_WRITE_PRINCIPAL_ID,
    );
    assert.deepStrictEqual(warningsOf(h), [
      `Azure's token of the write identity names object id ${AZURE_WRITE_PRINCIPAL_ID}, but ${RESOURCE_AI_AZURE_WRITE_PRINCIPAL_ID_ENV} says ${OTHER_OBJECT_ID}: the agent goes by what Azure says. Run the setup command again to set it right.`,
    ]);

    // A change, and Test connection again: said once.
    assertChanged(await runCloud(h, "azure", `cloud start-instance ${VM}`), {
      state: "deallocated",
    });
    await runCloud(h, "azure", "cloud whoami", { origin: "AiInvestigation" });
    assert.strictEqual(warningsOf(h).length, 1);
  });

  test("read without case, as Azure's tokens name object ids", async () => {
    const h: CloudHarness = harness({
      [RESOURCE_AI_AZURE_WRITE_PRINCIPAL_ID_ENV]: ` ${AZURE_WRITE_PRINCIPAL_ID.toUpperCase()} `,
    });

    assert.strictEqual(
      (await h.executor.probePosture()).details?.["azureWritePrincipalId"],
      AZURE_WRITE_PRINCIPAL_ID,
    );

    await runCloud(h, "azure", "cloud whoami", { origin: "AiInvestigation" });
    assert.deepStrictEqual(warningsOf(h), []);
  });
});

describe("Azure: an object id it cannot use is a warning, never a refusal", () => {
  for (const value of [
    "not-a-guid",
    "6d5c4b3a2f1e4d0c9b8a7f6e5d4c3b2a",
    `${AZURE_WRITE_PRINCIPAL_ID}-extra`,
    "{6d5c4b3a-2f1e-4d0c-9b8a-7f6e5d4c3b2a}",
  ]) {
    test(`"${value}": ignored, said, and every change still runs as the write identity`, async () => {
      const settings: CloudAgentSettings = parseCloudAgentSettings(
        {
          ONEUPTIME_AI_AZURE_WRITE_IDENTITY: AZURE_WRITE_IDENTITY,
          [RESOURCE_AI_AZURE_WRITE_PRINCIPAL_ID_ENV]: value,
        },
        "azure",
      );

      assert.strictEqual(settings.azureWritePrincipalId, null);
      assert.ok(
        settings.warnings.includes(
          `${RESOURCE_AI_AZURE_WRITE_PRINCIPAL_ID_ENV}="${value.toLowerCase()}" is not an object id (a GUID), so the agent ignores it and learns the write identity's object id from its first token.`,
        ),
        settings.warnings.join("\n"),
      );

      const h: CloudHarness = harness({
        [RESOURCE_AI_AZURE_WRITE_PRINCIPAL_ID_ENV]: value,
      });
      const posture: ResourcePostureProbe = await h.executor.probePosture();

      assert.strictEqual(posture.details?.["azureWritePrincipalId"], null);
      assert.strictEqual(posture.details?.["settingsProblem"], undefined);
      assertChanged(await runCloud(h, "azure", `cloud start-instance ${VM}`), {
        state: "deallocated",
      });
      assert.strictEqual(
        (await h.executor.probePosture()).details?.["azureWritePrincipalId"],
        AZURE_WRITE_PRINCIPAL_ID,
      );
    });
  }

  test("a long value is shown cut short", () => {
    const settings: CloudAgentSettings = parseCloudAgentSettings(
      {
        ONEUPTIME_AI_AZURE_WRITE_IDENTITY: AZURE_WRITE_IDENTITY,
        [RESOURCE_AI_AZURE_WRITE_PRINCIPAL_ID_ENV]: "a".repeat(400),
      },
      "azure",
    );

    assert.ok(
      settings.warnings.some((warning: string): boolean => {
        return (
          warning.startsWith(
            `${RESOURCE_AI_AZURE_WRITE_PRINCIPAL_ID_ENV}="${"a".repeat(64)}"`,
          ) && !warning.includes("a".repeat(65))
        );
      }),
      settings.warnings.join("\n"),
    );
  });

  test("beside no write identity: there is nothing for it to name, so it is ignored, and the posture names none", async () => {
    const settings: CloudAgentSettings = parseCloudAgentSettings(
      { [RESOURCE_AI_AZURE_WRITE_PRINCIPAL_ID_ENV]: AZURE_WRITE_PRINCIPAL_ID },
      "azure",
    );

    assert.strictEqual(settings.azureWritePrincipalId, null);
    assert.ok(
      settings.warnings.includes(
        `${RESOURCE_AI_AZURE_WRITE_PRINCIPAL_ID_ENV} is set, but there is no write identity (ONEUPTIME_AI_AZURE_WRITE_IDENTITY) for it to be the object id of, so it is ignored.`,
      ),
      settings.warnings.join("\n"),
    );

    const h: CloudHarness = harness({
      ONEUPTIME_AI_AZURE_WRITE_IDENTITY: "",
      [RESOURCE_AI_AZURE_WRITE_PRINCIPAL_ID_ENV]: AZURE_WRITE_PRINCIPAL_ID,
    });
    const posture: ResourcePostureProbe = await h.executor.probePosture();

    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(
        posture.details || {},
        "azureWritePrincipalId",
      ),
      false,
    );
  });

  test("beside a write identity it cannot read: ignored too, and the identity's problem is the one said", () => {
    const settings: CloudAgentSettings = parseCloudAgentSettings(
      {
        ONEUPTIME_AI_AZURE_WRITE_IDENTITY: "nope",
        [RESOURCE_AI_AZURE_WRITE_PRINCIPAL_ID_ENV]: AZURE_WRITE_PRINCIPAL_ID,
      },
      "azure",
    );

    assert.strictEqual(settings.azureWritePrincipalId, null);
    assert.ok(settings.azureWriteIdentityProblem);
  });

  test("set on an agent of another cloud, it is a warning and nothing more", () => {
    for (const provider of ["aws", "gcp"] as const) {
      const settings: CloudAgentSettings = parseCloudAgentSettings(
        {
          [RESOURCE_AI_AZURE_WRITE_PRINCIPAL_ID_ENV]: AZURE_WRITE_PRINCIPAL_ID,
        },
        provider,
      );

      assert.strictEqual(settings.azureWritePrincipalId, null);
      assert.match(
        settings.warnings.join("\n"),
        /ONEUPTIME_AI_AZURE_WRITE_PRINCIPAL_ID is set, but this agent serves (AWS|Google Cloud), so it is ignored\./,
      );
    }
  });

  test("an object id is a GUID in any case, read lowercased; nothing else is one", () => {
    assert.strictEqual(
      parseAzureObjectId(AZURE_WRITE_PRINCIPAL_ID.toUpperCase()),
      AZURE_WRITE_PRINCIPAL_ID,
    );

    for (const value of [
      "",
      "not-a-guid",
      `${AZURE_WRITE_PRINCIPAL_ID}\n`,
      ` ${AZURE_WRITE_PRINCIPAL_ID}`,
      AZURE_WRITE_PRINCIPAL_ID.replace(/-/g, ""),
    ]) {
      assert.strictEqual(parseAzureObjectId(value), null, value);
    }
  });
});
