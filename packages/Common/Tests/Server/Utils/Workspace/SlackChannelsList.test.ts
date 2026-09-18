import { describe, expect, test, afterEach, beforeEach } from "@jest/globals";

/*
 * Extensive tests for SlackUtil.getAllWorkspaceChannels — the API behind the
 * new GET /slack/channels "browse channels" endpoint:
 *
 * - Cursor pagination over https://slack.com/api/conversations.list
 *   (POST form-urlencoded, limit 999, public+private non-archived channels,
 *   hard cap of 100 pages).
 * - Result dictionary keyed by ORIGINAL-case channel name.
 * - BadRequestException on ok !== true, HTTPErrorResponse rethrown as-is.
 * - Bulk write-through of miscData.channelCache (LOWERCASED keys) via
 *   WorkspaceProjectAuthTokenService.getProjectAuth + refreshAuthToken,
 *   with every cache-write failure swallowed.
 */

import SlackUtil from "../../../../Server/Utils/Workspace/Slack/Slack";
import WorkspaceProjectAuthTokenService from "../../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceProjectAuthToken, {
  SlackMiscData,
} from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import ObjectID from "../../../../Types/ObjectID";
import API from "../../../../Utils/API";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import BadRequestException from "../../../../Types/Exception/BadRequestException";
import { JSONObject } from "../../../../Types/JSON";
import Dictionary from "../../../../Types/Dictionary";
import { WorkspaceChannel } from "../../../../Server/Utils/Workspace/WorkspaceBase";
import URL from "../../../../Types/API/URL";

const AUTH_TOKEN: string = "xoxb-test-token";
const CONVERSATIONS_LIST_URL: string =
  "https://slack.com/api/conversations.list";

interface PostCallArgs {
  url: URL;
  data: JSONObject;
  headers: Dictionary<string>;
  options: {
    retries: number;
    exponentialBackoff: boolean;
  };
}

interface RefreshAuthTokenArgs {
  projectId: ObjectID;
  workspaceType: WorkspaceType;
  authToken: string;
  workspaceProjectId: string;
  miscData: SlackMiscData;
}

interface CachedChannelEntry {
  id: string;
  name: string;
  workspaceType: WorkspaceType;
  lastUpdated: string;
}

function slackChannel(id: string, name: string): JSONObject {
  return {
    id: id,
    name: name,
    is_archived: false,
  };
}

/*
 * The source only reads `.jsonData` off a successful response and only
 * branches on `instanceof HTTPErrorResponse` for failures, so a plain object
 * with jsonData pins exactly what the code depends on.
 */
function buildPage(data: {
  channels: Array<JSONObject>;
  nextCursor?: string | undefined;
}): HTTPResponse<JSONObject> {
  const jsonData: JSONObject = {
    ok: true,
    channels: data.channels,
  };

  if (data.nextCursor !== undefined) {
    jsonData["response_metadata"] = {
      next_cursor: data.nextCursor,
    };
  }

  return { jsonData: jsonData } as unknown as HTTPResponse<JSONObject>;
}

function buildRawResponse(jsonData: JSONObject): HTTPResponse<JSONObject> {
  return { jsonData: jsonData } as unknown as HTTPResponse<JSONObject>;
}

function buildAuthRow(data: {
  authToken?: string | undefined;
  workspaceProjectId?: string | undefined;
  miscData?: SlackMiscData | undefined;
}): WorkspaceProjectAuthToken {
  return {
    authToken: data.authToken ?? "existing-auth-token",
    workspaceProjectId: data.workspaceProjectId ?? "T0001",
    miscData: data.miscData,
  } as unknown as WorkspaceProjectAuthToken;
}

describe("SlackUtil.getAllWorkspaceChannels", () => {
  let projectId: ObjectID;
  let postSpy: jest.SpyInstance;
  let getProjectAuthSpy: jest.SpyInstance;
  let refreshAuthTokenSpy: jest.SpyInstance;

  beforeEach(() => {
    projectId = ObjectID.generate();
    postSpy = jest.spyOn(API, "post");
    getProjectAuthSpy = jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockResolvedValue(null);
    refreshAuthTokenSpy = jest
      .spyOn(WorkspaceProjectAuthTokenService, "refreshAuthToken")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function getAllChannels(): Promise<Dictionary<WorkspaceChannel>> {
    return SlackUtil.getAllWorkspaceChannels({
      authToken: AUTH_TOKEN,
      projectId: projectId,
    });
  }

  describe("pagination and response parsing", () => {
    test("single page: returns a dictionary keyed by ORIGINAL-case channel name", async () => {
      postSpy.mockResolvedValueOnce(
        buildPage({
          channels: [
            slackChannel("C001", "General"),
            slackChannel("C002", "Alerts-PROD"),
          ],
        }),
      );

      const channels: Dictionary<WorkspaceChannel> = await getAllChannels();

      expect(channels).toEqual({
        General: {
          id: "C001",
          name: "General",
          workspaceType: WorkspaceType.Slack,
        },
        "Alerts-PROD": {
          id: "C002",
          name: "Alerts-PROD",
          workspaceType: WorkspaceType.Slack,
        },
      });
      expect(postSpy).toHaveBeenCalledTimes(1);
    });

    test("sends the documented Slack request shape (url, bearer + form headers, retries, limit/types/exclude_archived)", async () => {
      postSpy.mockResolvedValueOnce(buildPage({ channels: [] }));

      await getAllChannels();

      expect(postSpy).toHaveBeenCalledTimes(1);
      const callArgs: PostCallArgs = postSpy.mock.calls[0]?.[0] as PostCallArgs;
      expect(callArgs.url.toString()).toBe(CONVERSATIONS_LIST_URL);
      expect(callArgs.data).toEqual({
        limit: 999,
        types: "public_channel,private_channel",
        exclude_archived: true,
      });
      expect(callArgs.headers).toEqual({
        Authorization: `Bearer ${AUTH_TOKEN}`,
        "Content-Type": "application/x-www-form-urlencoded",
      });
      expect(callArgs.options).toEqual({
        retries: 3,
        exponentialBackoff: true,
      });
    });

    test("two pages: follows next_cursor, merges results, and passes the cursor on the second call only", async () => {
      postSpy.mockResolvedValueOnce(
        buildPage({
          channels: [slackChannel("C001", "general")],
          nextCursor: "cursor-page-2",
        }),
      );
      postSpy.mockResolvedValueOnce(
        buildPage({
          channels: [slackChannel("C002", "random")],
          nextCursor: "",
        }),
      );

      const channels: Dictionary<WorkspaceChannel> = await getAllChannels();

      expect(postSpy).toHaveBeenCalledTimes(2);
      const firstCallArgs: PostCallArgs = postSpy.mock
        .calls[0]?.[0] as PostCallArgs;
      const secondCallArgs: PostCallArgs = postSpy.mock
        .calls[1]?.[0] as PostCallArgs;
      expect(firstCallArgs.data["cursor"]).toBeUndefined();
      expect(secondCallArgs.data).toEqual({
        limit: 999,
        types: "public_channel,private_channel",
        exclude_archived: true,
        cursor: "cursor-page-2",
      });
      expect(Object.keys(channels).sort()).toEqual(["general", "random"]);
      expect(channels["general"]).toEqual({
        id: "C001",
        name: "general",
        workspaceType: WorkspaceType.Slack,
      });
      expect(channels["random"]).toEqual({
        id: "C002",
        name: "random",
        workspaceType: WorkspaceType.Slack,
      });
    });

    test("an empty-string next_cursor terminates pagination after one call", async () => {
      postSpy.mockResolvedValueOnce(
        buildPage({
          channels: [slackChannel("C001", "general")],
          nextCursor: "",
        }),
      );

      const channels: Dictionary<WorkspaceChannel> = await getAllChannels();

      expect(postSpy).toHaveBeenCalledTimes(1);
      expect(Object.keys(channels)).toEqual(["general"]);
    });

    test("a missing response_metadata terminates pagination after one call", async () => {
      postSpy.mockResolvedValueOnce(
        buildPage({ channels: [slackChannel("C001", "general")] }),
      );

      const channels: Dictionary<WorkspaceChannel> = await getAllChannels();

      expect(postSpy).toHaveBeenCalledTimes(1);
      expect(Object.keys(channels)).toEqual(["general"]);
    });

    test("empty channels array resolves to an empty dictionary", async () => {
      postSpy.mockResolvedValueOnce(buildPage({ channels: [] }));

      const channels: Dictionary<WorkspaceChannel> = await getAllChannels();

      expect(channels).toEqual({});
    });

    test("channels missing id or name are SKIPPED (pinned current behavior, falsy check)", async () => {
      postSpy.mockResolvedValueOnce(
        buildPage({
          channels: [
            slackChannel("C001", "good-channel"),
            { name: "channel-without-id" },
            { id: "C-NO-NAME" },
            { id: "", name: "channel-with-empty-id" },
            { id: "C005", name: "" },
          ],
        }),
      );

      const channels: Dictionary<WorkspaceChannel> = await getAllChannels();

      expect(channels).toEqual({
        "good-channel": {
          id: "C001",
          name: "good-channel",
          workspaceType: WorkspaceType.Slack,
        },
      });
    });

    test("a duplicate channel name on a later page overwrites the earlier one (last page wins)", async () => {
      postSpy.mockResolvedValueOnce(
        buildPage({
          channels: [slackChannel("C-FIRST", "dupe")],
          nextCursor: "cursor-page-2",
        }),
      );
      postSpy.mockResolvedValueOnce(
        buildPage({ channels: [slackChannel("C-SECOND", "dupe")] }),
      );

      const channels: Dictionary<WorkspaceChannel> = await getAllChannels();

      expect(channels).toEqual({
        dupe: {
          id: "C-SECOND",
          name: "dupe",
          workspaceType: WorkspaceType.Slack,
        },
      });
    });

    test("stops at exactly 100 POST calls (maxPages cap) even if Slack returns a cursor forever", async () => {
      postSpy.mockResolvedValue(
        buildPage({
          channels: [slackChannel("C001", "general")],
          nextCursor: "there-is-always-more",
        }),
      );

      const channels: Dictionary<WorkspaceChannel> = await getAllChannels();

      expect(postSpy).toHaveBeenCalledTimes(100);
      expect(Object.keys(channels)).toEqual(["general"]);
    });
  });

  describe("error handling", () => {
    test("ok:false → throws BadRequestException containing the Slack error string, and no cache write is attempted", async () => {
      postSpy.mockResolvedValueOnce(
        buildRawResponse({ ok: false, error: "invalid_auth" }),
      );

      let caught: unknown = undefined;
      try {
        await getAllChannels();
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(BadRequestException);
      expect((caught as BadRequestException).message).toBe(
        "Error from Slack invalid_auth",
      );
      expect(getProjectAuthSpy).not.toHaveBeenCalled();
      expect(refreshAuthTokenSpy).not.toHaveBeenCalled();
    });

    test("a missing ok field is treated as failure (ok !== true, pinned 'undefined' message)", async () => {
      postSpy.mockResolvedValueOnce(buildRawResponse({ channels: [] }));

      let caught: unknown = undefined;
      try {
        await getAllChannels();
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(BadRequestException);
      expect((caught as BadRequestException).message).toBe(
        "Error from Slack undefined",
      );
    });

    test("HTTPErrorResponse from the API layer is rethrown as-is", async () => {
      const errorResponse: HTTPErrorResponse = new HTTPErrorResponse(
        500,
        { error: "slack_is_down" },
        {},
      );
      postSpy.mockResolvedValueOnce(errorResponse);

      await expect(getAllChannels()).rejects.toBe(errorResponse);
      expect(refreshAuthTokenSpy).not.toHaveBeenCalled();
    });

    test("ok:false on the SECOND page still throws — no partial results are returned", async () => {
      postSpy.mockResolvedValueOnce(
        buildPage({
          channels: [slackChannel("C001", "general")],
          nextCursor: "cursor-page-2",
        }),
      );
      postSpy.mockResolvedValueOnce(
        buildRawResponse({ ok: false, error: "ratelimited" }),
      );

      let caught: unknown = undefined;
      try {
        await getAllChannels();
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(BadRequestException);
      expect((caught as BadRequestException).message).toBe(
        "Error from Slack ratelimited",
      );
      expect(postSpy).toHaveBeenCalledTimes(2);
      expect(refreshAuthTokenSpy).not.toHaveBeenCalled();
    });
  });

  describe("channel cache write-through", () => {
    test("refreshAuthToken receives LOWERCASED keys merged over the existing cache, with authToken/workspaceProjectId passed through", async () => {
      const existingMiscData: SlackMiscData = {
        teamId: "T-team",
        teamName: "Acme",
        botUserId: "B001",
        channelCache: {
          "old-channel": {
            id: "C-OLD",
            name: "old-channel",
            lastUpdated: "2026-01-01T00:00:00.000Z",
          },
        },
      };
      getProjectAuthSpy.mockResolvedValue(
        buildAuthRow({
          authToken: "existing-auth-token",
          workspaceProjectId: "T0001",
          miscData: existingMiscData,
        }),
      );
      postSpy.mockResolvedValueOnce(
        buildPage({ channels: [slackChannel("C-NEW", "New-Channel")] }),
      );

      await getAllChannels();

      expect(getProjectAuthSpy).toHaveBeenCalledTimes(1);
      expect(getProjectAuthSpy).toHaveBeenCalledWith({
        projectId: projectId,
        workspaceType: WorkspaceType.Slack,
      });
      expect(refreshAuthTokenSpy).toHaveBeenCalledTimes(1);
      const refreshArgs: RefreshAuthTokenArgs = refreshAuthTokenSpy.mock
        .calls[0]?.[0] as RefreshAuthTokenArgs;
      expect(refreshArgs.projectId).toBe(projectId);
      expect(refreshArgs.workspaceType).toBe(WorkspaceType.Slack);
      expect(refreshArgs.authToken).toBe("existing-auth-token");
      expect(refreshArgs.workspaceProjectId).toBe("T0001");
      /*
       * Existing miscData fields are preserved and the cache is a merge —
       * the new entry is keyed LOWERCASE while its `name` keeps the
       * original case.
       */
      expect(refreshArgs.miscData.teamId).toBe("T-team");
      expect(refreshArgs.miscData.teamName).toBe("Acme");
      expect(refreshArgs.miscData.botUserId).toBe("B001");
      expect(
        Object.keys(refreshArgs.miscData.channelCache || {}).sort(),
      ).toEqual(["new-channel", "old-channel"]);
      const newEntry: CachedChannelEntry = (refreshArgs.miscData.channelCache ||
        {})["new-channel"] as unknown as CachedChannelEntry;
      expect(newEntry.id).toBe("C-NEW");
      expect(newEntry.name).toBe("New-Channel");
      expect(newEntry.workspaceType).toBe(WorkspaceType.Slack);
      expect(typeof newEntry.lastUpdated).toBe("string");
      expect(Number.isNaN(new Date(newEntry.lastUpdated).getTime())).toBe(
        false,
      );
      expect((refreshArgs.miscData.channelCache || {})["old-channel"]).toEqual({
        id: "C-OLD",
        name: "old-channel",
        lastUpdated: "2026-01-01T00:00:00.000Z",
      });
    });

    test("mixed-case names: returned dict key keeps ORIGINAL case while the cache key is lowercased", async () => {
      getProjectAuthSpy.mockResolvedValue(
        buildAuthRow({ miscData: undefined }),
      );
      postSpy.mockResolvedValueOnce(
        buildPage({ channels: [slackChannel("C010", "UPPER-Case")] }),
      );

      const channels: Dictionary<WorkspaceChannel> = await getAllChannels();

      expect(Object.keys(channels)).toEqual(["UPPER-Case"]);
      const refreshArgs: RefreshAuthTokenArgs = refreshAuthTokenSpy.mock
        .calls[0]?.[0] as RefreshAuthTokenArgs;
      expect(Object.keys(refreshArgs.miscData.channelCache || {})).toEqual([
        "upper-case",
      ]);
    });

    test("row with no miscData at all: cache write still works via the || {} fallbacks", async () => {
      getProjectAuthSpy.mockResolvedValue(
        buildAuthRow({ miscData: undefined }),
      );
      postSpy.mockResolvedValueOnce(
        buildPage({
          channels: [
            slackChannel("C001", "good-channel"),
            { name: "channel-without-id" },
          ],
        }),
      );

      await getAllChannels();

      expect(refreshAuthTokenSpy).toHaveBeenCalledTimes(1);
      const refreshArgs: RefreshAuthTokenArgs = refreshAuthTokenSpy.mock
        .calls[0]?.[0] as RefreshAuthTokenArgs;
      /*
       * Channels skipped in the result (missing id/name) are excluded from
       * the cache write too.
       */
      expect(Object.keys(refreshArgs.miscData.channelCache || {})).toEqual([
        "good-channel",
      ]);
    });

    test("no project auth row → refreshAuthToken is never called and the call still succeeds", async () => {
      getProjectAuthSpy.mockResolvedValue(null);
      postSpy.mockResolvedValueOnce(
        buildPage({ channels: [slackChannel("C001", "general")] }),
      );

      const channels: Dictionary<WorkspaceChannel> = await getAllChannels();

      expect(Object.keys(channels)).toEqual(["general"]);
      expect(getProjectAuthSpy).toHaveBeenCalledTimes(1);
      expect(refreshAuthTokenSpy).not.toHaveBeenCalled();
    });

    test("refreshAuthToken rejecting does NOT fail the overall call (errors swallowed)", async () => {
      getProjectAuthSpy.mockResolvedValue(
        buildAuthRow({ miscData: undefined }),
      );
      refreshAuthTokenSpy.mockRejectedValue(new Error("db write failed"));
      postSpy.mockResolvedValueOnce(
        buildPage({ channels: [slackChannel("C001", "general")] }),
      );

      const channels: Dictionary<WorkspaceChannel> = await getAllChannels();

      expect(channels).toEqual({
        general: {
          id: "C001",
          name: "general",
          workspaceType: WorkspaceType.Slack,
        },
      });
      expect(refreshAuthTokenSpy).toHaveBeenCalledTimes(1);
    });

    test("getProjectAuth rejecting is swallowed too", async () => {
      getProjectAuthSpy.mockRejectedValue(new Error("db read failed"));
      postSpy.mockResolvedValueOnce(
        buildPage({ channels: [slackChannel("C001", "general")] }),
      );

      const channels: Dictionary<WorkspaceChannel> = await getAllChannels();

      expect(Object.keys(channels)).toEqual(["general"]);
      expect(refreshAuthTokenSpy).not.toHaveBeenCalled();
    });

    test("zero channels still triggers the cache write attempt, preserving the existing cache", async () => {
      const existingMiscData: SlackMiscData = {
        teamId: "T-team",
        teamName: "Acme",
        botUserId: "B001",
        channelCache: {
          "kept-channel": {
            id: "C-KEPT",
            name: "kept-channel",
            lastUpdated: "2026-01-01T00:00:00.000Z",
          },
        },
      };
      getProjectAuthSpy.mockResolvedValue(
        buildAuthRow({ miscData: existingMiscData }),
      );
      postSpy.mockResolvedValueOnce(buildPage({ channels: [] }));

      const channels: Dictionary<WorkspaceChannel> = await getAllChannels();

      expect(channels).toEqual({});
      expect(refreshAuthTokenSpy).toHaveBeenCalledTimes(1);
      const refreshArgs: RefreshAuthTokenArgs = refreshAuthTokenSpy.mock
        .calls[0]?.[0] as RefreshAuthTokenArgs;
      expect(Object.keys(refreshArgs.miscData.channelCache || {})).toEqual([
        "kept-channel",
      ]);
    });
  });
});
