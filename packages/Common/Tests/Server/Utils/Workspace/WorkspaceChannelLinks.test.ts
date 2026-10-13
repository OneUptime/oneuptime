import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import WorkspaceChannelLinks from "../../../../Server/Utils/Workspace/WorkspaceChannelLinks";
import NotFoundException from "../../../../Types/Exception/NotFoundException";
import ObjectID from "../../../../Types/ObjectID";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotificationRuleWorkspaceChannel from "../../../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import {
  WorkspaceChannelLink,
  WorkspaceChannelRecordType,
} from "../../../../Types/Workspace/WorkspaceChannelLink";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import logger from "../../../../Server/Utils/Logger";

/*
 * Which links an incident's, alert's, episode's or scheduled maintenance
 * event's "Open in Slack" / "Open in Microsoft Teams" button gets: the
 * record is read with the caller's own permissions first, and only then its
 * channels (a column no API reads) as OneUptime; each link is built from the
 * channel and the project's connection, Slack first, never twice, and never
 * from an id of the wrong shape.
 */

type FindOneById = (data: {
  id: ObjectID;
  select: Record<string, boolean>;
  props: DatabaseCommonInteractionProps;
}) => Promise<unknown>;

const mockFinders: Record<
  WorkspaceChannelRecordType,
  jest.Mock<FindOneById>
> = {
  [WorkspaceChannelRecordType.Incident]: jest.fn<FindOneById>(),
  [WorkspaceChannelRecordType.Alert]: jest.fn<FindOneById>(),
  [WorkspaceChannelRecordType.IncidentEpisode]: jest.fn<FindOneById>(),
  [WorkspaceChannelRecordType.AlertEpisode]: jest.fn<FindOneById>(),
  [WorkspaceChannelRecordType.ScheduledMaintenance]: jest.fn<FindOneById>(),
};

type GetProjectAuth = (data: {
  projectId: ObjectID;
  workspaceType: WorkspaceType;
}) => Promise<unknown>;

const mockGetProjectAuth: jest.Mock<GetProjectAuth> = jest.fn<GetProjectAuth>();

jest.mock("../../../../Server/Services/IncidentService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: (...args: Array<unknown>) => {
        return (mockFinders.incident as jest.Mock)(...args);
      },
    },
  };
});

jest.mock("../../../../Server/Services/AlertService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: (...args: Array<unknown>) => {
        return (mockFinders.alert as jest.Mock)(...args);
      },
    },
  };
});

jest.mock("../../../../Server/Services/IncidentEpisodeService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: (...args: Array<unknown>) => {
        return (mockFinders["incident-episode"] as jest.Mock)(...args);
      },
    },
  };
});

jest.mock("../../../../Server/Services/AlertEpisodeService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: (...args: Array<unknown>) => {
        return (mockFinders["alert-episode"] as jest.Mock)(...args);
      },
    },
  };
});

jest.mock("../../../../Server/Services/ScheduledMaintenanceService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: (...args: Array<unknown>) => {
        return (mockFinders["scheduled-maintenance"] as jest.Mock)(...args);
      },
    },
  };
});

jest.mock(
  "../../../../Server/Services/WorkspaceProjectAuthTokenService",
  () => {
    return {
      __esModule: true,
      default: {
        getProjectAuth: (...args: Array<unknown>) => {
          return (mockGetProjectAuth as jest.Mock)(...args);
        },
      },
    };
  },
);

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RECORD_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const TEAM_GUID: string = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";
const OTHER_TEAM_GUID: string = "4f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5c";
const TENANT_GUID: string = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const TEAMS_CHANNEL_ID: string =
  "19:3bb6a2a1b5e64c2a9d0d8f2d1c0e8f2b@thread.tacv2";

const CALLER: DatabaseCommonInteractionProps = {
  userId: new ObjectID("44444444-4444-4444-8444-444444444444"),
  tenantId: PROJECT_ID,
};

const slackChannel: (
  id: string,
  name: string,
) => NotificationRuleWorkspaceChannel = (
  id: string,
  name: string,
): NotificationRuleWorkspaceChannel => {
  return {
    id,
    name,
    workspaceType: WorkspaceType.Slack,
    notificationRuleId: "rule-1",
  };
};

const teamsChannel: (data: {
  id?: string;
  name: string;
  teamId?: string;
}) => NotificationRuleWorkspaceChannel = (data: {
  id?: string;
  name: string;
  teamId?: string;
}): NotificationRuleWorkspaceChannel => {
  const channel: NotificationRuleWorkspaceChannel = {
    id: data.id || TEAMS_CHANNEL_ID,
    name: data.name,
    workspaceType: WorkspaceType.MicrosoftTeams,
    notificationRuleId: "rule-2",
  };

  if (data.teamId) {
    channel.teamId = data.teamId;
  }

  return channel;
};

/*
 * The record as each read sees it: the caller's read gets the record (or
 * nothing), the root read gets its channels.
 */
const givenRecord: (data: {
  recordType: WorkspaceChannelRecordType;
  visibleToCaller: boolean;
  channels: Array<NotificationRuleWorkspaceChannel>;
  projectId?: ObjectID | undefined;
}) => void = (data: {
  recordType: WorkspaceChannelRecordType;
  visibleToCaller: boolean;
  channels: Array<NotificationRuleWorkspaceChannel>;
  projectId?: ObjectID | undefined;
}): void => {
  mockFinders[data.recordType].mockImplementation(
    async (read: Parameters<FindOneById>[0]): Promise<unknown> => {
      if (read.props.isRoot) {
        return { postUpdatesToWorkspaceChannels: data.channels };
      }

      if (!data.visibleToCaller) {
        return null;
      }

      return {
        _id: RECORD_ID.toString(),
        projectId: "projectId" in data ? data.projectId : PROJECT_ID,
      };
    },
  );
};

const givenConnections: (data: {
  slack?: unknown;
  teams?: unknown;
}) => void = (data: { slack?: unknown; teams?: unknown }): void => {
  mockGetProjectAuth.mockImplementation(
    async (read: Parameters<GetProjectAuth>[0]): Promise<unknown> => {
      if (read.workspaceType === WorkspaceType.Slack) {
        return data.slack ?? null;
      }

      return data.teams ?? null;
    },
  );
};

const SLACK_CONNECTION: unknown = {
  miscData: { teamId: "T0123ABCD", teamName: "Acme", botUserId: "U1" },
  workspaceProjectId: "T0123ABCD",
};

const TEAMS_CONNECTION: unknown = {
  miscData: { tenantId: TENANT_GUID, teamId: TEAM_GUID, teamName: "Ops" },
  workspaceProjectId: TENANT_GUID,
};

const getLinks: (
  recordType?: WorkspaceChannelRecordType,
) => Promise<Array<WorkspaceChannelLink>> = (
  recordType?: WorkspaceChannelRecordType,
): Promise<Array<WorkspaceChannelLink>> => {
  return WorkspaceChannelLinks.getLinks({
    recordType: recordType || WorkspaceChannelRecordType.Incident,
    recordId: RECORD_ID,
    props: CALLER,
  });
};

beforeEach(() => {
  for (const finder of Object.values(mockFinders)) {
    finder.mockReset();
  }
  mockGetProjectAuth.mockReset();
  givenConnections({ slack: SLACK_CONNECTION, teams: TEAMS_CONNECTION });
});

describe("who may ask", () => {
  test.each(Object.values(WorkspaceChannelRecordType))(
    "%s: the record is read with the caller's own props first, its channels as OneUptime after",
    async (recordType: WorkspaceChannelRecordType) => {
      givenRecord({
        recordType,
        visibleToCaller: true,
        channels: [slackChannel("C0456EFGH", "incident-42")],
      });

      const links: Array<WorkspaceChannelLink> = await getLinks(recordType);

      expect(links).toEqual([
        {
          workspaceType: WorkspaceType.Slack,
          channelName: "incident-42",
          url: "https://slack.com/app_redirect?channel=C0456EFGH&team=T0123ABCD",
        },
      ]);

      const finder: jest.Mock<FindOneById> = mockFinders[recordType];
      expect(finder).toHaveBeenCalledTimes(2);

      const [callerRead, rootRead] = finder.mock.calls.map(
        (call: Parameters<FindOneById>) => {
          return call[0];
        },
      );

      // First the caller's read: their own props, nothing but the record.
      expect(callerRead!.props).toBe(CALLER);
      expect(callerRead!.id.toString()).toBe(RECORD_ID.toString());
      expect(callerRead!.select).toEqual({ _id: true, projectId: true });

      // Then the channels, which no API reads.
      expect(rootRead!.props).toEqual({ isRoot: true });
      expect(rootRead!.select).toEqual({
        postUpdatesToWorkspaceChannels: true,
      });

      // Each record type reads only its own table.
      for (const other of Object.values(WorkspaceChannelRecordType)) {
        if (other !== recordType) {
          expect(mockFinders[other]).not.toHaveBeenCalled();
        }
      }
    },
  );

  test.each(Object.values(WorkspaceChannelRecordType))(
    "%s: a record the caller cannot read is not found, and its channels are never read",
    async (recordType: WorkspaceChannelRecordType) => {
      givenRecord({
        recordType,
        visibleToCaller: false,
        channels: [slackChannel("C0456EFGH", "incident-42")],
      });

      await expect(getLinks(recordType)).rejects.toBeInstanceOf(
        NotFoundException,
      );

      expect(mockFinders[recordType]).toHaveBeenCalledTimes(1);
      expect(mockGetProjectAuth).not.toHaveBeenCalled();
    },
  );

  test("a read that comes back without its project is not found either", async () => {
    givenRecord({
      recordType: WorkspaceChannelRecordType.Alert,
      visibleToCaller: true,
      projectId: undefined,
      channels: [slackChannel("C0456EFGH", "alert-7")],
    });

    await expect(
      getLinks(WorkspaceChannelRecordType.Alert),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(mockGetProjectAuth).not.toHaveBeenCalled();
  });

  test("a read that fails is the caller's error, not an empty list", async () => {
    mockFinders.incident.mockImplementation(async () => {
      throw new Error("You do not have permission to read Incident.");
    });

    await expect(getLinks()).rejects.toThrow(
      "You do not have permission to read Incident.",
    );
  });
});

describe("which links", () => {
  test("a record without a channel has none, and the connections are not read", async () => {
    givenRecord({
      recordType: WorkspaceChannelRecordType.Incident,
      visibleToCaller: true,
      channels: [],
    });

    expect(await getLinks()).toEqual([]);
    expect(mockGetProjectAuth).not.toHaveBeenCalled();
  });

  test("Slack first, then Microsoft Teams, each in the order the record got them", async () => {
    givenRecord({
      recordType: WorkspaceChannelRecordType.Incident,
      visibleToCaller: true,
      channels: [
        teamsChannel({ name: "Incident 42", teamId: TEAM_GUID }),
        slackChannel("C0456EFGH", "incident-42"),
        slackChannel("C0999ZZZZ", "sre-war-room"),
      ],
    });

    const links: Array<WorkspaceChannelLink> = await getLinks();

    expect(
      links.map((link: WorkspaceChannelLink) => {
        return `${link.workspaceType}:${link.channelName}`;
      }),
    ).toEqual([
      "Slack:incident-42",
      "Slack:sre-war-room",
      "MicrosoftTeams:Incident 42",
    ]);

    const teamsLink: URL = new URL(links[2]!.url);
    expect(teamsLink.host).toBe("teams.microsoft.com");
    expect(teamsLink.searchParams.get("groupId")).toBe(TEAM_GUID);
    expect(teamsLink.searchParams.get("tenantId")).toBe(TENANT_GUID);
  });

  test("a channel the record holds twice is one button", async () => {
    givenRecord({
      recordType: WorkspaceChannelRecordType.Incident,
      visibleToCaller: true,
      channels: [
        slackChannel("C0456EFGH", "incident-42"),
        {
          ...slackChannel("C0456EFGH", "incident-42"),
          notificationRuleId: "2",
        },
        teamsChannel({ name: "Incident 42", teamId: TEAM_GUID }),
        teamsChannel({ name: "Incident 42", teamId: TEAM_GUID }),
      ],
    });

    expect(await getLinks()).toHaveLength(2);
  });

  test("the same Teams channel id in another team is another channel", async () => {
    givenRecord({
      recordType: WorkspaceChannelRecordType.Incident,
      visibleToCaller: true,
      channels: [
        teamsChannel({ name: "Ops", teamId: TEAM_GUID }),
        teamsChannel({ name: "Ops", teamId: OTHER_TEAM_GUID }),
      ],
    });

    expect(await getLinks()).toHaveLength(2);
  });

  test("a channel whose link cannot be built is left out, not offered as a button that goes nowhere", async () => {
    givenRecord({
      recordType: WorkspaceChannelRecordType.Incident,
      visibleToCaller: true,
      channels: [
        slackChannel("not a slack id", "broken"),
        slackChannel("C0456EFGH&team=TEVIL", "injected"),
        teamsChannel({ name: "no team" }),
        teamsChannel({ name: "not a team", teamId: "my-team" }),
        teamsChannel({
          id: "C0456EFGH",
          name: "a Slack id",
          teamId: TEAM_GUID,
        }),
        slackChannel("C0456EFGH", "incident-42"),
      ],
    });

    expect(
      (await getLinks()).map((link: WorkspaceChannelLink) => {
        return link.channelName;
      }),
    ).toEqual(["incident-42"]);
  });

  test("a channel of a type with no button is left out", async () => {
    givenRecord({
      recordType: WorkspaceChannelRecordType.Incident,
      visibleToCaller: true,
      channels: [
        {
          id: "C0456EFGH",
          name: "elsewhere",
          workspaceType: "Discord" as WorkspaceType,
          notificationRuleId: "r",
        },
        null as unknown as NotificationRuleWorkspaceChannel,
      ],
    });

    expect(await getLinks()).toEqual([]);
  });

  test("a name is shown without the spaces around it", async () => {
    givenRecord({
      recordType: WorkspaceChannelRecordType.Incident,
      visibleToCaller: true,
      channels: [slackChannel("C0456EFGH", "  incident-42 ")],
    });

    expect((await getLinks())[0]!.channelName).toBe("incident-42");
  });
});

describe("the project's connection", () => {
  test("Slack disconnected since: no Slack button, the Teams one stays", async () => {
    givenConnections({ slack: null, teams: TEAMS_CONNECTION });
    givenRecord({
      recordType: WorkspaceChannelRecordType.Incident,
      visibleToCaller: true,
      channels: [
        slackChannel("C0456EFGH", "incident-42"),
        teamsChannel({ name: "Incident 42", teamId: TEAM_GUID }),
      ],
    });

    expect(
      (await getLinks()).map((link: WorkspaceChannelLink) => {
        return link.workspaceType;
      }),
    ).toEqual([WorkspaceType.MicrosoftTeams]);
  });

  test("the Slack workspace is the one the bot was installed into, else the connection's own id", async () => {
    givenRecord({
      recordType: WorkspaceChannelRecordType.Incident,
      visibleToCaller: true,
      channels: [slackChannel("C0456EFGH", "incident-42")],
    });

    givenConnections({
      slack: {
        miscData: { teamId: "T0FROMMISC" },
        workspaceProjectId: "T0ROW",
      },
    });
    expect(new URL((await getLinks())[0]!.url).searchParams.get("team")).toBe(
      "T0FROMMISC",
    );

    givenConnections({ slack: { miscData: {}, workspaceProjectId: "T0ROW" } });
    expect(new URL((await getLinks())[0]!.url).searchParams.get("team")).toBe(
      "T0ROW",
    );

    givenConnections({ slack: { miscData: {}, workspaceProjectId: "" } });
    expect(await getLinks()).toEqual([]);
  });

  test("the Teams tenant is the one the app was connected in, else the connection's own id, else none", async () => {
    givenRecord({
      recordType: WorkspaceChannelRecordType.Incident,
      visibleToCaller: true,
      channels: [teamsChannel({ name: "Incident 42", teamId: TEAM_GUID })],
    });

    const otherTenant: string = "b1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

    givenConnections({
      teams: {
        miscData: { tenantId: TENANT_GUID },
        workspaceProjectId: otherTenant,
      },
    });
    expect(
      new URL((await getLinks())[0]!.url).searchParams.get("tenantId"),
    ).toBe(TENANT_GUID);

    givenConnections({
      teams: { miscData: {}, workspaceProjectId: otherTenant },
    });
    expect(
      new URL((await getLinks())[0]!.url).searchParams.get("tenantId"),
    ).toBe(otherTenant);

    // Teams finds a channel by its team alone; the tenant only helps.
    givenConnections({ teams: null });
    const url: URL = new URL((await getLinks())[0]!.url);
    expect(url.searchParams.get("tenantId")).toBeNull();
    expect(url.searchParams.get("groupId")).toBe(TEAM_GUID);
  });

  test("only the connections the record has channels in are read", async () => {
    givenRecord({
      recordType: WorkspaceChannelRecordType.Incident,
      visibleToCaller: true,
      channels: [slackChannel("C0456EFGH", "incident-42")],
    });

    await getLinks();

    expect(mockGetProjectAuth).toHaveBeenCalledTimes(1);
    expect(mockGetProjectAuth.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      workspaceType: WorkspaceType.Slack,
    });
  });

  test("the record's own project's connection, never the caller's tenant header", async () => {
    const recordProject: ObjectID = new ObjectID(
      "55555555-5555-4555-8555-555555555555",
    );
    givenRecord({
      recordType: WorkspaceChannelRecordType.Incident,
      visibleToCaller: true,
      projectId: recordProject,
      channels: [slackChannel("C0456EFGH", "incident-42")],
    });

    await getLinks();

    expect(mockGetProjectAuth.mock.calls[0]![0].projectId.toString()).toBe(
      recordProject.toString(),
    );
  });

  test("a connection that cannot be read leaves its buttons out and does not fail the page", async () => {
    const loggedError: jest.SpiedFunction<typeof logger.error> = jest
      .spyOn(logger, "error")
      .mockImplementation(() => {
        return undefined;
      });

    mockGetProjectAuth.mockImplementation(async () => {
      throw new Error("connection refused");
    });
    givenRecord({
      recordType: WorkspaceChannelRecordType.Incident,
      visibleToCaller: true,
      channels: [
        slackChannel("C0456EFGH", "incident-42"),
        teamsChannel({ name: "Incident 42", teamId: TEAM_GUID }),
      ],
    });

    const links: Array<WorkspaceChannelLink> = await getLinks();

    // Slack needs its workspace; Teams finds the channel by its team.
    expect(
      links.map((link: WorkspaceChannelLink) => {
        return link.workspaceType;
      }),
    ).toEqual([WorkspaceType.MicrosoftTeams]);
    expect(loggedError).toHaveBeenCalledTimes(2);

    loggedError.mockRestore();
  });
});
