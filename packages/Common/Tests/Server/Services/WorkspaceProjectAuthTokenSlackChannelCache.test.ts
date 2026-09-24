import { describe, expect, test, afterEach, beforeEach } from "@jest/globals";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceProjectAuthToken, {
  SlackChannelCache,
  SlackMiscData,
} from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import ObjectID from "../../../Types/ObjectID";
import BadDataException from "../../../Types/Exception/BadDataException";

/*
 * WorkspaceProjectAuthTokenService.replaceSlackChannelCache backs
 * PUT /slack/channel-cache, the dashboard's only way to change miscData now
 * that the column is server-only in the CRUD API. It must replace the
 * channel cache and carry every other miscData field over from the stored
 * row.
 */

let findOneBy: jest.SpyInstance;
let updateOneById: jest.SpyInstance;

const projectId: ObjectID = ObjectID.generate();
const rowId: ObjectID = ObjectID.generate();

const newCache: SlackChannelCache = {
  "incident-updates": {
    id: "C0NEW00001",
    name: "incident-updates",
    lastUpdated: "2026-09-23T00:00:00.000Z",
  },
};

function storedMiscData(): SlackMiscData {
  return {
    teamId: "T0AAAAAAA",
    teamName: "Acme",
    botUserId: "U0BOT",
    userAccessToken: "stored-user-token",
    channelCache: {
      general: {
        id: "C0OLD00001",
        name: "general",
        lastUpdated: "2026-01-01T00:00:00.000Z",
      },
    },
  };
}

beforeEach(() => {
  findOneBy = jest.spyOn(
    WorkspaceProjectAuthTokenService,
    "findOneBy",
  ) as jest.SpyInstance;
  updateOneById = jest.spyOn(
    WorkspaceProjectAuthTokenService,
    "updateOneById",
  ) as jest.SpyInstance;

  updateOneById.mockResolvedValue(1);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("WorkspaceProjectAuthTokenService.replaceSlackChannelCache", () => {
  test("replaces the channel cache and keeps every other stored field", async () => {
    findOneBy.mockResolvedValue({
      id: rowId,
      miscData: storedMiscData(),
    } as unknown as WorkspaceProjectAuthToken);

    await WorkspaceProjectAuthTokenService.replaceSlackChannelCache({
      projectId,
      channelCache: newCache,
    });

    expect(updateOneById).toHaveBeenCalledTimes(1);
    expect(updateOneById.mock.calls[0]![0]).toEqual({
      id: rowId,
      data: {
        miscData: {
          ...storedMiscData(),
          channelCache: newCache,
        },
      },
      props: { isRoot: true },
    });
  });

  test("looks up this project's Slack row only", async () => {
    findOneBy.mockResolvedValue({
      id: rowId,
      miscData: storedMiscData(),
    } as unknown as WorkspaceProjectAuthToken);

    await WorkspaceProjectAuthTokenService.replaceSlackChannelCache({
      projectId,
      channelCache: newCache,
    });

    expect(findOneBy.mock.calls[0]![0]).toMatchObject({
      query: {
        projectId: projectId,
        workspaceType: WorkspaceType.Slack,
      },
      select: { _id: true, miscData: true },
      props: { isRoot: true },
    });
  });

  test("an empty cache clears the channels and nothing else", async () => {
    findOneBy.mockResolvedValue({
      id: rowId,
      miscData: storedMiscData(),
    } as unknown as WorkspaceProjectAuthToken);

    await WorkspaceProjectAuthTokenService.replaceSlackChannelCache({
      projectId,
      channelCache: {},
    });

    const miscData: SlackMiscData = updateOneById.mock.calls[0]![0].data
      .miscData as SlackMiscData;

    expect(miscData.channelCache).toEqual({});
    expect(miscData.teamId).toBe("T0AAAAAAA");
    expect(miscData["userAccessToken"]).toBe("stored-user-token");
  });

  test("refuses when the project has no Slack connection, without writing", async () => {
    findOneBy.mockResolvedValue(null);

    await expect(
      WorkspaceProjectAuthTokenService.replaceSlackChannelCache({
        projectId,
        channelCache: newCache,
      }),
    ).rejects.toThrow(BadDataException);

    expect(updateOneById).not.toHaveBeenCalled();
  });
});
