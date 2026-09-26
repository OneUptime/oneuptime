import {
  WorkspaceChannel,
  WorkspaceSendMessageResponse,
} from "../../Server/Utils/Workspace/WorkspaceBase";
import Discord from "../../Server/Utils/Workspace/Discord/Discord";
import API, { APIFetchOptions } from "../../Utils/API";
import HTTPResponse from "../../Types/API/HTTPResponse";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPMethod from "../../Types/API/HTTPMethod";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import WorkspaceProjectAuthTokenService from "../../Server/Services/WorkspaceProjectAuthTokenService";
import GlobalCache from "../../Server/Infrastructure/GlobalCache";
import { writeFileSync } from "fs";
jest.mock("../../Utils/API", () => {
  return { __esModule: true, default: { fetch: jest.fn() } };
});
jest.mock("../../Server/Services/WorkspaceProjectAuthTokenService", () => {
  return { __esModule: true, default: { getProjectAuth: jest.fn() } };
});
jest.mock("../../Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: { setStringIfNotExists: jest.fn(), deleteKeyIfValue: jest.fn() },
  };
});

test("simulated HTTP lifecycle creates, delivers and archives an explicit incident thread", async () => {
  const guild: string = "111111111111111111";
  const parent: string = "222222222222222222";
  const thread: string = "333333333333333333";
  const foreign: string = "555555555555555555";
  const authToken: string = "simulation-only";
  const projectId: ObjectID = new ObjectID(
    "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  );
  const transcript: Array<JSONObject> = [];
  let exists: boolean = false;
  let archived: boolean = false;
  let locked: boolean = false;
  const messages: Array<JSONObject> = [];
  const raw: () => JSONObject = (): JSONObject => {
    return {
      id: thread,
      guild_id: guild,
      parent_id: parent,
      type: 11,
      name: "incident-1",
      thread_metadata: {
        archived,
        locked,
        archive_timestamp: "2026-09-25T00:00:00.000Z",
      },
    };
  };
  (
    WorkspaceProjectAuthTokenService.getProjectAuth as jest.Mock
  ).mockResolvedValue({
    authToken,
    workspaceProjectId: guild,
    miscData: { incidentChannelId: parent },
  });
  (GlobalCache.setStringIfNotExists as jest.Mock).mockResolvedValue(true);
  (GlobalCache.deleteKeyIfValue as jest.Mock).mockResolvedValue(true);
  (API.fetch as jest.Mock).mockImplementation(
    async (request: APIFetchOptions) => {
      const path: string = request.url
        .toString()
        .replace("https://discord.com/api/v10", "");
      const body: JSONObject = (request.data || {}) as JSONObject;
      transcript.push({ method: request.method, path, body });
      const ok: (
        value: JSONObject | Array<JSONObject>,
      ) => HTTPResponse<JSONObject | Array<JSONObject>> = (
        value: JSONObject | Array<JSONObject>,
      ): HTTPResponse<JSONObject | Array<JSONObject>> => {
        return new HTTPResponse(200, value, {});
      };
      if (path === "/guilds/" + guild + "/channels") {
        return ok([
          { id: parent, guild_id: guild, name: "incidents", type: 0 },
        ]);
      }
      if (path === "/guilds/" + guild + "/threads/active") {
        return ok({ threads: exists && !archived ? [raw()] : [] });
      }
      if (path.includes("/threads/archived/")) {
        return ok({
          threads:
            exists && archived && path.endsWith("/public") ? [raw()] : [],
          has_more: false,
        });
      }
      if (path === "/channels/" + parent) {
        return ok({ id: parent, guild_id: guild, type: 0, name: "incidents" });
      }
      if (path === "/channels/" + foreign) {
        return ok({ id: foreign, guild_id: "999999999999999999", type: 0 });
      }
      if (
        path === "/channels/" + parent + "/threads" &&
        request.method === HTTPMethod.POST
      ) {
        expect(exists).toBe(false);
        exists = true;
        return ok(raw());
      }
      if (path === "/channels/" + thread) {
        if (request.method === HTTPMethod.PATCH) {
          archived = Boolean(body["archived"]);
          locked = Boolean(body["locked"]);
        }
        return ok(raw());
      }
      if (
        path === "/channels/" + thread + "/messages" &&
        request.method === HTTPMethod.POST
      ) {
        expect(archived).toBe(false);
        const message: JSONObject = {
          ...body,
          id: String(444444444444444440n + BigInt(messages.length)),
        };
        messages.push(message);
        return ok(message);
      }
      if (path === "/channels/" + thread + "/messages?limit=100") {
        return ok(messages);
      }
      return new HTTPErrorResponse(
        400,
        { message: "unexpected simulated route" },
        {},
      );
    },
  );
  const first: WorkspaceChannel = await Discord.createChannel({
    authToken,
    projectId,
    channelName: "incident-1",
  });
  const sent: WorkspaceSendMessageResponse = await Discord.sendMessage({
    authToken,
    projectId,
    userId: "actor",
    workspaceMessagePayload: {
      _type: "WorkspaceMessagePayload",
      workspaceType: WorkspaceType.Discord,
      channelIds: [foreign, thread, thread],
      channelNames: [],
      messageBlocks: [
        {
          _type: "WorkspacePayloadMarkdown",
          text: "@everyone " + "😀".repeat(2100),
        } as never,
      ],
    },
  });
  expect(sent.errors).toHaveLength(1);
  expect(sent.threads).toHaveLength(1);
  for (const message of messages) {
    expect(message["allowed_mentions"]).toEqual({
      parse: [],
      replied_user: false,
    });
    expect(String(message["content"]).length).toBeLessThanOrEqual(2000);
  }
  expect(
    (
      await Discord.getMessageHistory({
        authToken,
        projectId,
        channelId: thread,
      })
    ).length,
  ).toBe(3);
  await Discord.archiveChannels({
    authToken,
    projectId,
    channelIds: [thread],
    userId: "actor",
    sendMessageBeforeArchiving: {
      _type: "WorkspacePayloadMarkdown",
      text: "Resolved",
    },
  });
  expect(archived && locked).toBe(true);
  expect(first.id).toBe(thread);
  expect(
    transcript.filter((entry: JSONObject) => {
      return entry["method"] === HTTPMethod.DELETE;
    }),
  ).toHaveLength(0);
  expect(
    transcript.filter((entry: JSONObject) => {
      return (
        entry["method"] === HTTPMethod.POST &&
        entry["path"] === "/channels/" + parent + "/threads"
      );
    }),
  ).toHaveLength(1);
  if (process.env["DISCORD_CONTRACT_ARTIFACT"]) {
    writeFileSync(
      process.env["DISCORD_CONTRACT_ARTIFACT"],
      JSON.stringify({ kind: "simulated-http-contract", transcript }, null, 2),
    );
  }
});
