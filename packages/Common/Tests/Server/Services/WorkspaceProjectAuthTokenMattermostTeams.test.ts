import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import WorkspaceProjectAuthToken, {
  MattermostMiscData,
} from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import MattermostConnection, {
  MattermostConnectionData,
} from "../../../Server/Utils/Workspace/Mattermost/MattermostConnection";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";

/*
 * A MATTERMOST CONNECTION'S TEAMS, AND ITS DEFAULT TEAM
 * (WorkspaceProjectAuthTokenService.updateMattermostTeams).
 *
 * The teams the server lists the bot in are kept in the connection's
 * miscData, with when they were listed; "Make default" writes the default
 * team there and into the server-only authToken, where every call that
 * names no team reads it (MattermostConnection). Only the connection
 * stored under the team it was made for is written, and every field of it
 * that is not the teams is carried over.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "d7000000-0000-4000-8000-000000000001",
);
const ROW_ID: ObjectID = new ObjectID("d7000000-0000-4000-8000-000000000002");

const ENGINEERING: string = "e".repeat(26);
const SUPPORT: string = "s".repeat(26);
const BOT_ID: string = "b".repeat(26);
const ACCESS_TOKEN: string = "abcdefghijklmnopqrstuvwxyz";

const LISTED_AT: Date = new Date("2026-11-11T09:00:00.000Z");

const STORED_AUTH_TOKEN: string = MattermostConnection.toAuthToken({
  serverUrl: "https://chat.example.com",
  accessToken: ACCESS_TOKEN,
  teamId: ENGINEERING,
  botUserId: BOT_ID,
});

const STORED_MISC_DATA: MattermostMiscData = {
  serverUrl: "https://chat.example.com",
  teamId: ENGINEERING,
  teamName: "engineering",
  teamDisplayName: "Engineering",
  botUserId: BOT_ID,
  botUsername: "oneuptime",
};

let stored: WorkspaceProjectAuthToken | null;
let findOneBy: SpyInstance<typeof WorkspaceProjectAuthTokenService.findOneBy>;
let written: Array<JSONObject>;

function writtenData(): JSONObject {
  expect(written).toHaveLength(1);
  expect(written[0]!["id"]).toEqual(ROW_ID);
  expect(written[0]!["props"]).toEqual({ isRoot: true });

  return written[0]!["data"] as JSONObject;
}

function writtenMiscData(): MattermostMiscData {
  return writtenData()["miscData"] as unknown as MattermostMiscData;
}

beforeEach(() => {
  written = [];

  const row: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
  row.id = ROW_ID;
  row.miscData = { ...STORED_MISC_DATA };
  row.authToken = STORED_AUTH_TOKEN;
  stored = row;

  findOneBy = jest
    .spyOn(WorkspaceProjectAuthTokenService, "findOneBy")
    .mockImplementation((async () => {
      return stored;
    }) as never);

  jest
    .spyOn(WorkspaceProjectAuthTokenService, "updateOneById")
    .mockImplementation((async (data: JSONObject) => {
      written.push(data);
      return 1;
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the teams the server listed", () => {
  test("are kept with when they were listed, every other field carried over", async () => {
    await WorkspaceProjectAuthTokenService.updateMattermostTeams({
      projectId: PROJECT_ID,
      workspaceProjectId: ENGINEERING,
      teams: [
        { id: ENGINEERING, name: "engineering", displayName: "Engineering" },
        { id: SUPPORT, name: "support", displayName: "" },
      ],
      teamsReadAt: LISTED_AT,
    });

    expect(writtenMiscData()).toEqual({
      ...STORED_MISC_DATA,
      teams: [
        { id: ENGINEERING, name: "engineering", displayName: "Engineering" },
        // No display name: its name stands for it.
        { id: SUPPORT, name: "support", displayName: "support" },
      ],
      teamsReadAt: "2026-11-11T09:00:00.000Z",
    });
    // The bot's token is not touched.
    expect("authToken" in writtenData()).toBe(false);
  });

  test("the connection is read by its project, Mattermost and the team it was made for", async () => {
    await WorkspaceProjectAuthTokenService.updateMattermostTeams({
      projectId: PROJECT_ID,
      workspaceProjectId: ENGINEERING,
      teams: [],
    });

    expect(findOneBy).toHaveBeenCalledTimes(1);
    expect(findOneBy.mock.calls[0]![0]).toMatchObject({
      query: {
        projectId: PROJECT_ID,
        workspaceType: WorkspaceType.Mattermost,
        workspaceProjectId: ENGINEERING,
      },
      props: { isRoot: true },
    });
  });

  test("the default team renamed in Mattermost is kept under its new name", async () => {
    await WorkspaceProjectAuthTokenService.updateMattermostTeams({
      projectId: PROJECT_ID,
      workspaceProjectId: ENGINEERING,
      teams: [
        {
          id: ENGINEERING,
          name: "product-engineering",
          displayName: "Product Engineering",
        },
      ],
      teamsReadAt: LISTED_AT,
    });

    expect(writtenMiscData()).toMatchObject({
      teamId: ENGINEERING,
      teamName: "product-engineering",
      teamDisplayName: "Product Engineering",
    });
  });

  test("a default team the server listed without a name keeps the name it had", async () => {
    await WorkspaceProjectAuthTokenService.updateMattermostTeams({
      projectId: PROJECT_ID,
      workspaceProjectId: ENGINEERING,
      teams: [{ id: ENGINEERING, name: "", displayName: "" }],
    });

    expect(writtenMiscData()).toMatchObject({
      teamName: "engineering",
      teamDisplayName: "Engineering",
    });
  });

  test("a default team the server no longer lists the bot in stays the default", async () => {
    await WorkspaceProjectAuthTokenService.updateMattermostTeams({
      projectId: PROJECT_ID,
      workspaceProjectId: ENGINEERING,
      teams: [{ id: SUPPORT, name: "support", displayName: "Support" }],
    });

    expect(writtenMiscData()).toMatchObject({
      teamId: ENGINEERING,
      teamName: "engineering",
    });
  });

  test("no time given: now", async () => {
    const before: number = Date.now();

    await WorkspaceProjectAuthTokenService.updateMattermostTeams({
      projectId: PROJECT_ID,
      workspaceProjectId: ENGINEERING,
      teams: [],
    });

    const readAt: number = new Date(
      writtenMiscData().teamsReadAt as string,
    ).getTime();

    expect(readAt).toBeGreaterThanOrEqual(before - 1000);
    expect(readAt).toBeLessThanOrEqual(Date.now() + 1000);
  });
});

describe("the default team", () => {
  test("is written into miscData and into the bot's token, its server, token and bot kept", async () => {
    await WorkspaceProjectAuthTokenService.updateMattermostTeams({
      projectId: PROJECT_ID,
      workspaceProjectId: ENGINEERING,
      defaultTeam: { id: SUPPORT, name: "support", displayName: "Support" },
    });

    expect(writtenMiscData()).toEqual({
      ...STORED_MISC_DATA,
      teamId: SUPPORT,
      teamName: "support",
      teamDisplayName: "Support",
    });

    const connection: MattermostConnectionData =
      MattermostConnection.fromAuthToken(writtenData()["authToken"] as string);

    expect(connection).toEqual({
      serverUrl: "https://chat.example.com",
      accessToken: ACCESS_TOKEN,
      teamId: SUPPORT,
      botUserId: BOT_ID,
    });
  });

  test("a team without a display name is shown by its name", async () => {
    await WorkspaceProjectAuthTokenService.updateMattermostTeams({
      projectId: PROJECT_ID,
      workspaceProjectId: ENGINEERING,
      defaultTeam: { id: SUPPORT, name: "support", displayName: "" },
    });

    expect(writtenMiscData().teamDisplayName).toBe("support");
  });

  test("with the teams listed in one write: both kept", async () => {
    await WorkspaceProjectAuthTokenService.updateMattermostTeams({
      projectId: PROJECT_ID,
      workspaceProjectId: ENGINEERING,
      teams: [
        { id: ENGINEERING, name: "engineering", displayName: "Engineering" },
        { id: SUPPORT, name: "support", displayName: "Support" },
      ],
      teamsReadAt: LISTED_AT,
      defaultTeam: { id: SUPPORT, name: "support", displayName: "Support" },
    });

    expect(writtenMiscData()).toMatchObject({
      teamId: SUPPORT,
      teamName: "support",
      teams: [
        { id: ENGINEERING, name: "engineering", displayName: "Engineering" },
        { id: SUPPORT, name: "support", displayName: "Support" },
      ],
      teamsReadAt: "2026-11-11T09:00:00.000Z",
    });
  });

  test("a team id Mattermost did not make is refused before anything is read", async () => {
    await expect(
      WorkspaceProjectAuthTokenService.updateMattermostTeams({
        projectId: PROJECT_ID,
        workspaceProjectId: ENGINEERING,
        defaultTeam: { id: "../users/me", name: "evil", displayName: "Evil" },
      }),
    ).rejects.toThrow("The Mattermost team id is not valid.");

    expect(findOneBy).not.toHaveBeenCalled();
    expect(written).toHaveLength(0);
  });
});

describe("what is not written", () => {
  test("a connection removed or replaced meanwhile is left alone", async () => {
    stored = null;

    await WorkspaceProjectAuthTokenService.updateMattermostTeams({
      projectId: PROJECT_ID,
      workspaceProjectId: ENGINEERING,
      defaultTeam: { id: SUPPORT, name: "support", displayName: "Support" },
    });

    expect(written).toHaveLength(0);
  });

  test("without the project or the team the connection was made for, nothing is asked", async () => {
    await expect(
      WorkspaceProjectAuthTokenService.updateMattermostTeams({
        projectId: undefined as unknown as ObjectID,
        workspaceProjectId: ENGINEERING,
        teams: [],
      }),
    ).rejects.toBeInstanceOf(BadDataException);

    await expect(
      WorkspaceProjectAuthTokenService.updateMattermostTeams({
        projectId: PROJECT_ID,
        workspaceProjectId: "",
        teams: [],
      }),
    ).rejects.toThrow("workspaceProjectId is required");

    expect(findOneBy).not.toHaveBeenCalled();
  });
});
