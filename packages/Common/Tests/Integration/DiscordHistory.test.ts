import WorkspaceUtil, {
  WorkspaceChannelMessage,
} from "../../Server/Utils/Workspace/Workspace";
import WorkspaceProjectAuthTokenService from "../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import ObjectID from "../../Types/ObjectID";
import { JSONObject, JSONArray } from "../../Types/JSON";
import API, { APIFetchOptions } from "../../Utils/API";
import HTTPResponse from "../../Types/API/HTTPResponse";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import Slack from "../../Server/Utils/Workspace/Slack/Slack";
import Teams from "../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import IncidentAIContextBuilder, {
  IncidentContextData,
} from "../../Server/Utils/AI/IncidentAIContextBuilder";
import IncidentEpisodeAIContextBuilder, {
  IncidentEpisodeContextData,
} from "../../Server/Utils/AI/IncidentEpisodeAIContextBuilder";
import Incident from "../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../Models/DatabaseModels/IncidentEpisode";
import IncidentService from "../../Server/Services/IncidentService";
import IncidentStateTimelineService from "../../Server/Services/IncidentStateTimelineService";
import IncidentInternalNoteService from "../../Server/Services/IncidentInternalNoteService";
import IncidentPublicNoteService from "../../Server/Services/IncidentPublicNoteService";
import IncidentEpisodeService from "../../Server/Services/IncidentEpisodeService";
import IncidentEpisodeStateTimelineService from "../../Server/Services/IncidentEpisodeStateTimelineService";
import IncidentEpisodeInternalNoteService from "../../Server/Services/IncidentEpisodeInternalNoteService";
import IncidentEpisodeMemberService from "../../Server/Services/IncidentEpisodeMemberService";

// Failure inventory: packages/E2E/Discord/HISTORY_FAILURES.md, written first.
const projectId: ObjectID = ObjectID.generate();
const guild: string = "111111111111111111";
const channelId: string = "222222222222222222";
const authToken: string = "isolated-history-fixture";
const baseTime: number = Date.parse("2026-09-25T00:00:00.000Z");
const transcript: Array<string> = [];
let rows: JSONArray = [];
let channelReads: number = 0;
let messageReads: number = 0;
let remoteGuild: string = guild;
let pageOverride: ((page: number) => JSONArray | JSONObject) | undefined;

function message(index: number, extra: JSONObject = {}): JSONObject {
  return {
    id: String(BigInt("333333333333333333") + BigInt(index)),
    channel_id: channelId,
    content: `Message ${index}`,
    timestamp: new Date(baseTime + index * 1000).toISOString(),
    type: 0,
    author: {
      id: "444444444444444444",
      username: "responder",
      global_name: "Responder",
    },
    ...extra,
  };
}

function read(
  options: { limit?: number; oldestTimestamp?: Date } = {},
): Promise<Array<WorkspaceChannelMessage>> {
  return WorkspaceUtil.getChannelMessages({
    projectId,
    channelId,
    authToken,
    workspaceType: WorkspaceType.Discord,
    ...options,
  });
}

beforeEach((): void => {
  rows = [];
  transcript.length = 0;
  channelReads = 0;
  messageReads = 0;
  remoteGuild = guild;
  pageOverride = undefined;
  jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
    .mockResolvedValue({
      authToken,
      workspaceProjectId: guild,
    } as never);
  jest
    .spyOn(API, "fetch")
    .mockImplementation(
      async (
        request: APIFetchOptions,
      ): Promise<HTTPResponse<JSONObject | JSONArray>> => {
        const url: globalThis.URL = new globalThis.URL(request.url.toString());
        transcript.push(url.pathname + url.search);
        if (url.pathname === `/api/v10/channels/${channelId}`) {
          channelReads++;
          return new HTTPResponse(
            200,
            { id: channelId, guild_id: remoteGuild, type: 11 },
            {},
          );
        }
        expect(url.pathname).toBe(`/api/v10/channels/${channelId}/messages`);
        messageReads++;
        const limit: number = Number(url.searchParams.get("limit"));
        expect(limit).toBeGreaterThan(0);
        expect(limit).toBeLessThanOrEqual(100);
        const before: string | null = url.searchParams.get("before");
        const page: JSONArray | JSONObject = pageOverride
          ? pageOverride(messageReads)
          : rows
              .filter((row: JSONObject): boolean => {
                return !before || BigInt(String(row["id"])) < BigInt(before);
              })
              .sort((a: JSONObject, b: JSONObject): number => {
                return BigInt(String(a["id"])) > BigInt(String(b["id"]))
                  ? -1
                  : 1;
              })
              .slice(0, limit);
        return new HTTPResponse(200, page, {});
      },
    );
});

afterEach((): void => {
  jest.restoreAllMocks();
});

test("dispatches 500 unique messages over five scoped pages in chronological order", async (): Promise<void> => {
  rows = Array.from(
    { length: 520 },
    (_: unknown, index: number): JSONObject => {
      return message(index);
    },
  );
  const result: Array<WorkspaceChannelMessage> = await read({ limit: 500 });
  expect(result).toHaveLength(500);
  expect(result[0]!.text).toBe("Message 20");
  expect(result[499]!.text).toBe("Message 519");
  expect(
    new Set(
      result.map((row: WorkspaceChannelMessage): string => {
        return row.messageId;
      }),
    ).size,
  ).toBe(500);
  expect(channelReads).toBe(5);
  expect(messageReads).toBe(5);
  expect(WorkspaceProjectAuthTokenService.getProjectAuth).toHaveBeenCalledTimes(
    5,
  );
});

test("caps excessive limits and defaults to 100", async (): Promise<void> => {
  rows = Array.from(
    { length: 600 },
    (_: unknown, index: number): JSONObject => {
      return message(index);
    },
  );
  expect(await read({ limit: 5000 })).toHaveLength(500);
  expect(await read()).toHaveLength(100);
});

test.each([0, -1, 1.5, NaN, Infinity])(
  "rejects invalid limit %s before transport",
  async (limit: number): Promise<void> => {
    await expect(read({ limit })).rejects.toThrow();
    expect(API.fetch).not.toHaveBeenCalled();
  },
);

test("rejects an invalid cutoff before transport", async (): Promise<void> => {
  await expect(
    read({ oldestTimestamp: new Date("invalid") }),
  ).rejects.toThrow();
  expect(API.fetch).not.toHaveBeenCalled();
});

test("includes the cutoff boundary and stops after the page crosses it", async (): Promise<void> => {
  rows = Array.from(
    { length: 250 },
    (_: unknown, index: number): JSONObject => {
      return message(index);
    },
  );
  const result: Array<WorkspaceChannelMessage> = await read({
    limit: 500,
    oldestTimestamp: new Date(baseTime + 175000),
  });
  expect(result).toHaveLength(75);
  expect(result[0]!.text).toBe("Message 175");
  expect(messageReads).toBe(1);
});

test("deduplicates overlapping pages and stops on a repeated cursor", async (): Promise<void> => {
  const page: JSONArray = Array.from(
    { length: 100 },
    (_: unknown, index: number): JSONObject => {
      return message(index);
    },
  );
  pageOverride = (): JSONArray => {
    return [...page].reverse();
  };
  const result: Array<WorkspaceChannelMessage> = await read({ limit: 500 });
  expect(result).toHaveLength(100);
  expect(messageReads).toBe(2);
});

test("uses the smallest snowflake cursor even when a provider page is unordered", async (): Promise<void> => {
  pageOverride = (page: number): JSONArray => {
    return page === 1 ? [message(2), message(4), message(3)] : [message(1)];
  };
  const result: Array<WorkspaceChannelMessage> = await read({ limit: 4 });
  expect(
    result.map((row: WorkspaceChannelMessage): string => {
      return row.text;
    }),
  ).toEqual(["Message 1", "Message 2", "Message 3", "Message 4"]);
  expect(
    transcript.some((path: string): boolean => {
      return path.includes(`before=${message(2)["id"]}`);
    }),
  ).toBe(true);
});

test("preserves text and author/bot flags without resolving extra identities", async (): Promise<void> => {
  rows = [
    message(1, { content: "  **raw** <@444444444444444444>  " }),
    message(2, {
      author: { id: "444444444444444445", username: "bot", bot: true },
    }),
    message(3, {
      webhook_id: "444444444444444446",
      author: { username: "hook" },
    }),
    message(4, { author: {} }),
  ];
  const result: Array<WorkspaceChannelMessage> = await read();
  expect(result).toHaveLength(4);
  expect(result[0]).toMatchObject({
    text: "  **raw** <@444444444444444444>  ",
    userId: "444444444444444444",
    username: "Responder",
    isBot: false,
  });
  expect(result[1]).toMatchObject({ username: "bot", isBot: true });
  expect(result[2]).toMatchObject({ username: "hook", isBot: true });
  expect(result[3]!.userId).toBeUndefined();
  expect(result[3]!.username).toBeUndefined();
  expect(
    transcript.every((path: string): boolean => {
      return !path.includes("/members/");
    }),
  ).toBe(true);
});

test("omits malformed, foreign-channel, system and redacted records without inventing content", async (): Promise<void> => {
  pageOverride = (): JSONArray => {
    return [
      message(1),
      message(2, {
        content: "",
        embeds: [{ description: "Do not reconstruct" }],
      }),
      message(3, { timestamp: "invalid" }),
      message(4, { channel_id: "999999999999999999" }),
      message(5, { type: 6 }),
      message(6, { id: "invalid" }),
      message(7, { content: "  " }),
    ];
  };
  const result: Array<WorkspaceChannelMessage> = await read();
  expect(
    result.map((row: WorkspaceChannelMessage): string => {
      return row.text;
    }),
  ).toEqual(["Message 1"]);
  expect(messageReads).toBeLessThanOrEqual(2);
});

test("returns an empty history and makes no extra requests for an empty page", async (): Promise<void> => {
  expect(await read()).toEqual([]);
  expect(messageReads).toBe(1);
});

test("bounds reads to 20 pages when all message content is redacted", async (): Promise<void> => {
  pageOverride = (page: number): JSONArray => {
    return Array.from(
      { length: 100 },
      (_: unknown, index: number): JSONObject => {
        return message(10000 - page * 100 - index, { content: "" });
      },
    );
  };
  expect(await read({ limit: 500 })).toEqual([]);
  expect(messageReads).toBe(20);
});

test.each([null, { authToken: "wrong", workspaceProjectId: guild }])(
  "rejects missing/mismatched project binding %s",
  async (
    binding: { authToken: string; workspaceProjectId: string } | null,
  ): Promise<void> => {
    jest
      .mocked(WorkspaceProjectAuthTokenService.getProjectAuth)
      .mockResolvedValue(binding as never);
    await expect(read()).rejects.toThrow();
    expect(API.fetch).not.toHaveBeenCalled();
  },
);

test("rejects a foreign guild before fetching messages", async (): Promise<void> => {
  remoteGuild = "999999999999999999";
  await expect(read()).rejects.toThrow("guild");
  expect(messageReads).toBe(0);
});

test("rechecks binding between pages and rejects accumulated context on disconnect", async (): Promise<void> => {
  rows = Array.from(
    { length: 150 },
    (_: unknown, index: number): JSONObject => {
      return message(index);
    },
  );
  jest
    .mocked(WorkspaceProjectAuthTokenService.getProjectAuth)
    .mockResolvedValueOnce({ authToken, workspaceProjectId: guild } as never)
    .mockResolvedValue(null);
  await expect(read({ limit: 150 })).rejects.toThrow();
  expect(messageReads).toBe(1);
});

test("rechecks remote guild between pages", async (): Promise<void> => {
  pageOverride = (): JSONArray => {
    remoteGuild = "999999999999999999";
    return Array.from(
      { length: 100 },
      (_: unknown, index: number): JSONObject => {
        return message(index);
      },
    );
  };
  await expect(read({ limit: 150 })).rejects.toThrow("guild");
  expect(messageReads).toBe(1);
});

test("rejects a malformed provider response", async (): Promise<void> => {
  pageOverride = (): JSONObject => {
    return { unexpected: true };
  };
  await expect(read()).rejects.toThrow();
});

test("rejects a provider refusal rather than claiming empty success", async (): Promise<void> => {
  jest.mocked(API.fetch).mockResolvedValue(new HTTPErrorResponse(403, {}, {}));
  await expect(read()).rejects.toThrow();
});

test("preserves Slack and Teams dispatcher contracts", async (): Promise<void> => {
  const slack: jest.SpyInstance = jest
    .spyOn(Slack, "getChannelMessages")
    .mockResolvedValue([]);
  const teams: jest.SpyInstance = jest
    .spyOn(Teams, "getChannelMessages")
    .mockResolvedValue([]);
  const oldestTimestamp: Date = new Date(baseTime);
  await WorkspaceUtil.getChannelMessages({
    projectId,
    channelId,
    authToken,
    workspaceType: WorkspaceType.Slack,
    limit: 12,
    oldestTimestamp,
  });
  await WorkspaceUtil.getChannelMessages({
    projectId,
    channelId,
    authToken,
    teamId: guild,
    workspaceType: WorkspaceType.MicrosoftTeams,
    limit: 12,
    oldestTimestamp,
  });
  expect(slack).toHaveBeenCalledWith({
    channelId,
    authToken,
    limit: 12,
    oldestTimestamp,
  });
  expect(teams).toHaveBeenCalledWith({
    projectId,
    channelId,
    teamId: guild,
    limit: 12,
    oldestTimestamp,
  });
});

test("incident AI history remains opt-in and applies the creation cutoff", async (): Promise<void> => {
  const incident: Incident = new Incident();
  incident.id = ObjectID.generate();
  incident.projectId = projectId;
  incident.createdAt = new Date(baseTime);
  incident.postUpdatesToWorkspaceChannels = [
    {
      id: channelId,
      name: "history",
      workspaceType: WorkspaceType.Discord,
      notificationRuleId: ObjectID.generate().toString(),
    },
  ];
  jest.spyOn(IncidentService, "findOneById").mockResolvedValue(incident);
  jest.spyOn(IncidentStateTimelineService, "findBy").mockResolvedValue([]);
  jest.spyOn(IncidentInternalNoteService, "findBy").mockResolvedValue([]);
  jest.spyOn(IncidentPublicNoteService, "findBy").mockResolvedValue([]);
  rows = [message(-1), message(0), message(1)];
  expect(
    (
      await IncidentAIContextBuilder.buildIncidentContext({
        incidentId: incident.id!,
      })
    ).workspaceMessages,
  ).toEqual([]);
  expect(API.fetch).not.toHaveBeenCalled();
  const context: IncidentContextData =
    await IncidentAIContextBuilder.buildIncidentContext({
      incidentId: incident.id!,
      includeWorkspaceMessages: true,
    });
  expect(
    context.workspaceMessages.map((row: WorkspaceChannelMessage): string => {
      return row.text;
    }),
  ).toEqual(["Message 0", "Message 1"]);
});

test("episode AI history remains opt-in and applies the creation cutoff", async (): Promise<void> => {
  const episode: IncidentEpisode = new IncidentEpisode();
  episode.id = ObjectID.generate();
  episode.projectId = projectId;
  episode.createdAt = new Date(baseTime);
  episode.postUpdatesToWorkspaceChannels = [
    {
      id: channelId,
      name: "history",
      workspaceType: WorkspaceType.Discord,
      notificationRuleId: ObjectID.generate().toString(),
    },
  ];
  jest.spyOn(IncidentEpisodeService, "findOneById").mockResolvedValue(episode);
  jest
    .spyOn(IncidentEpisodeStateTimelineService, "findBy")
    .mockResolvedValue([]);
  jest
    .spyOn(IncidentEpisodeInternalNoteService, "findBy")
    .mockResolvedValue([]);
  jest.spyOn(IncidentEpisodeMemberService, "findBy").mockResolvedValue([]);
  rows = [message(-1), message(0), message(1)];
  expect(
    (
      await IncidentEpisodeAIContextBuilder.buildEpisodeContext({
        episodeId: episode.id!,
        includeWorkspaceMessages: false,
      })
    ).workspaceMessages,
  ).toEqual([]);
  expect(API.fetch).not.toHaveBeenCalled();
  const context: IncidentEpisodeContextData =
    await IncidentEpisodeAIContextBuilder.buildEpisodeContext({
      episodeId: episode.id!,
      includeWorkspaceMessages: true,
    });
  expect(
    context.workspaceMessages.map((row: WorkspaceChannelMessage): string => {
      return row.text;
    }),
  ).toEqual(["Message 0", "Message 1"]);
});
