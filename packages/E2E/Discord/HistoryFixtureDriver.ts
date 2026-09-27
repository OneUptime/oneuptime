import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import Database from "../../Common/Server/Infrastructure/PostgresDatabase";
import WorkspaceUtil, {
  WorkspaceChannelMessage,
} from "../../Common/Server/Utils/Workspace/Workspace";
import WorkspaceProjectAuthTokenService from "../../Common/Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceProjectAuthToken from "../../Common/Models/DatabaseModels/WorkspaceProjectAuthToken";
import ObjectID from "../../Common/Types/ObjectID";
import WorkspaceType from "../../Common/Types/Workspace/WorkspaceType";
import { JSONArray, JSONObject } from "../../Common/Types/JSON";

/*
 * Test-only driver for a dedicated fixture stack with an OAuth-installed project.
 * It reads the persisted binding and uses real HTTPS, without a production route.
 */
async function main(): Promise<void> {
  const control: string | undefined =
    process.env["DISCORD_FIXTURE_CONTROL_TOKEN"];
  const project: string | undefined = process.env["DISCORD_HISTORY_PROJECT_ID"];
  const evidence: string | undefined = process.env["DISCORD_HISTORY_EVIDENCE"];
  if (
    process.env["DISCORD_HISTORY_FIXTURE"] !== "true" ||
    process.env["HOST"] !== "oneuptime.test" ||
    process.env["RUN_DATABASE_MIGRATIONS_ON_BOOT"] !== "false" ||
    !control ||
    !project ||
    !evidence
  ) {
    throw new Error(
      "A dedicated history fixture, disabled migrations, installed project, and evidence path are required.",
    );
  }
  const checks: Array<string> = [];
  let passed: boolean = false;
  const fixture: (
    path: string,
    body?: JSONObject,
  ) => Promise<JSONObject> = async (
    path: string,
    body?: JSONObject,
  ): Promise<JSONObject> => {
    const response: Response = await fetch(
      `https://discord.com/__fixture/${path}`,
      {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "content-type": "application/json",
          "x-fixture-control": control,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    assert.equal(response.status, 200);
    return (await response.json()) as JSONObject;
  };
  try {
    await Database.connect();
    const projectId: ObjectID = new ObjectID(project);
    const binding: WorkspaceProjectAuthToken | null =
      await WorkspaceProjectAuthTokenService.getProjectAuth({
        projectId,
        workspaceType: WorkspaceType.Discord,
      });
    assert.ok(binding?.authToken && binding.workspaceProjectId);
    const channelId: string = "222222222222222222";
    const baseTime: number = Date.parse("2026-09-25T00:00:00.000Z");
    const channel: JSONObject = {
      id: channelId,
      guild_id: binding.workspaceProjectId,
      name: "history-fixture",
      type: 11,
    };
    const rows: JSONArray = Array.from(
      { length: 520 },
      (_: unknown, index: number): JSONObject => {
        return {
          id: String(BigInt("333333333333333333") + BigInt(index)),
          channel_id: channelId,
          type: 0,
          content: `History fixture ${index}`,
          timestamp: new Date(baseTime + index * 1000).toISOString(),
          author: {
            id: "444444444444444444",
            username: "responder",
            global_name: "Responder",
            bot: index === 519,
          },
        };
      },
    );
    await fixture("scenario", { scenario: "valid" });
    await fixture("seed", { channels: [channel], messages: rows });
    const params: Parameters<typeof WorkspaceUtil.getChannelMessages>[0] = {
      projectId,
      channelId,
      authToken: binding.authToken,
      workspaceType: WorkspaceType.Discord,
      limit: 500,
    };
    const history: Array<WorkspaceChannelMessage> =
      await WorkspaceUtil.getChannelMessages(params);
    assert.equal(history.length, 500);
    assert.equal(history[0]?.text, "History fixture 20");
    assert.equal(history[499]?.text, "History fixture 519");
    assert.equal(
      new Set(
        history.map((message: WorkspaceChannelMessage): string => {
          return message.messageId;
        }),
      ).size,
      500,
    );
    assert.equal(history[0]?.username, "Responder");
    assert.equal(history[0]?.isBot, false);
    assert.equal(history[499]?.isBot, true);
    checks.push(
      "persisted binding, scoped HTTPS pagination, 500 unique chronological messages, author and bot flags",
    );

    const recent: Array<WorkspaceChannelMessage> =
      await WorkspaceUtil.getChannelMessages({
        ...params,
        oldestTimestamp: new Date(baseTime + 495000),
      });
    assert.equal(recent.length, 25);
    assert.equal(recent[0]?.text, "History fixture 495");
    checks.push("inclusive creation cutoff");

    await fixture("scenario", { scenario: "message-content-disabled" });
    const redacted: Array<WorkspaceChannelMessage> =
      await WorkspaceUtil.getChannelMessages(params);
    assert.deepEqual(
      redacted.map((message: WorkspaceChannelMessage): string => {
        return message.text;
      }),
      ["History fixture 519"],
    );
    checks.push("provider-redacted human content stays omitted");

    await assert.rejects(
      WorkspaceUtil.getChannelMessages({
        ...params,
        authToken: "not-the-installed-token",
      }),
    );
    await assert.rejects(
      WorkspaceUtil.getChannelMessages({
        ...params,
        projectId: ObjectID.generate(),
      }),
    );
    checks.push("persisted token and project isolation");

    await fixture("scenario", { scenario: "valid" });
    await fixture("seed", {
      channels: [{ ...channel, guild_id: "999999999999999999" }],
    });
    await assert.rejects(WorkspaceUtil.getChannelMessages(params));
    checks.push("foreign guild rejected");
    passed = true;
  } finally {
    writeFileSync(
      evidence,
      JSON.stringify(
        {
          kind: "postgres-and-https-fixture-history",
          passed,
          checks,
          completedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    await Database.disconnect();
  }
}

main().catch((): void => {
  // Do not print database connection details or provider tokens on failure.
  process.stderr.write(
    "History fixture failed; inspect the retained check artifact.\n",
  );
  process.exitCode = 1;
});
