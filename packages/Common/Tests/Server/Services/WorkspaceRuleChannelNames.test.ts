import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import WorkspaceNotificationRule from "../../../Models/DatabaseModels/WorkspaceNotificationRule";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceNotificationLogService from "../../../Server/Services/WorkspaceNotificationLogService";
import WorkspaceNotificationRuleService, {
  RuleChannelToCreate,
  WorkspaceChannelsCreated,
} from "../../../Server/Services/WorkspaceNotificationRuleService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import logger from "../../../Server/Utils/Logger";
import MicrosoftTeamsUtil from "../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import SlackUtil from "../../../Server/Utils/Workspace/Slack/Slack";
import WorkspaceBase from "../../../Server/Utils/Workspace/WorkspaceBase";
import AlertWorkspaceMessages from "../../../Server/Utils/Workspace/WorkspaceMessages/Alert";
import AlertEpisodeWorkspaceMessages from "../../../Server/Utils/Workspace/WorkspaceMessages/AlertEpisode";
import IncidentWorkspaceMessages from "../../../Server/Utils/Workspace/WorkspaceMessages/Incident";
import IncidentEpisodeWorkspaceMessages from "../../../Server/Utils/Workspace/WorkspaceMessages/IncidentEpisode";
import MonitorWorkspaceMessages from "../../../Server/Utils/Workspace/WorkspaceMessages/Monitor";
import OnCallDutyPolicyWorkspaceMessages from "../../../Server/Utils/Workspace/WorkspaceMessages/OnCallDutyPolicy";
import ScheduledMaintenanceWorkspaceMessages from "../../../Server/Utils/Workspace/WorkspaceMessages/ScheduledMaintenance";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import BadRequestException from "../../../Types/Exception/BadRequestException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleWorkspaceChannel from "../../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import API from "../../../Utils/API";
import WorkspaceChannelName from "../../../Utils/Workspace/WorkspaceChannelName";

/*
 * THE CHANNELS A RECORD'S RULES CREATE, AS SLACK AND MICROSOFT TEAMS ARE
 * ASKED FOR THEM.
 *
 * The customer: "setting the prefix to foo- results in foo-inc-XXX. How can
 * we configure the channel name to simply be inc-XXX?" - and the same for
 * Microsoft Teams. Every record kind is created through its own workspace
 * messages class (the call each record's service makes), the real
 * WorkspaceNotificationRuleService and the real SlackUtil /
 * MicrosoftTeamsUtil.createChannel; only the far ends are fakes, and they
 * record every request: Slack's conversations.create and Microsoft Graph's
 * POST /teams/{team}/channels. A fake workspace refuses a name somebody has
 * already, as the real ones do (Slack: ok false, error name_taken; Graph:
 * 400 BadRequest, inner code NameAlreadyExists).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "b0000000-0000-4000-8000-000000000001",
);
const RECORD_ID: ObjectID = new ObjectID(
  "b0000000-0000-4000-8000-000000000002",
);
const TEAM_OPS: string = "a1b2c3d4-0000-4000-8000-0000000000aa";
const TEAM_WEB: string = "a1b2c3d4-0000-4000-8000-0000000000bb";

interface SlackCreate {
  name: string;
  is_private?: boolean;
}

interface TeamsCreate {
  teamId: string;
  displayName: string;
  description: string;
  membershipType: string;
}

let slackCreates: Array<SlackCreate>;
let teamsCreates: Array<TeamsCreate>;
// Names a channel has already, in Slack and in each Teams team.
let slackTaken: Set<string>;
let teamsTaken: Set<string>;
// What Slack answers every create with instead, when set.
let slackRefusal: string | null;
let rulesByWorkspace: Map<WorkspaceType, Array<WorkspaceNotificationRule>>;
let connected: Array<WorkspaceType>;

function projectAuth(workspaceType: WorkspaceType): WorkspaceProjectAuthToken {
  const token: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
  token.projectId = PROJECT_ID;
  token.workspaceType = workspaceType;
  token.authToken =
    workspaceType === WorkspaceType.Slack ? "xoxb-token" : "teams-token";
  token.miscData = (
    workspaceType === WorkspaceType.Slack
      ? { botUserId: "B0BOT", teamId: "T0WORKSPACE" }
      : { teamId: TEAM_OPS, tenantId: "tenant-1", botId: "28:bot" }
  ) as never;
  return token;
}

function rule(data: {
  workspaceType: WorkspaceType;
  eventType: NotificationRuleEventType;
  prefix?: string | undefined;
  teamToCreateChannelIn?: string | undefined;
  id?: ObjectID | undefined;
}): WorkspaceNotificationRule {
  const workspaceRule: WorkspaceNotificationRule =
    new WorkspaceNotificationRule();
  workspaceRule.id = data.id || ObjectID.generate();
  workspaceRule.projectId = PROJECT_ID;
  workspaceRule.workspaceType = data.workspaceType;
  workspaceRule.eventType = data.eventType;

  const notificationRule: JSONObject = {
    _type: "IncidentNotificationRule",
    filterCondition: "All",
    filters: [],
    shouldPostToExistingChannel: false,
    existingChannelNames: "",
    shouldCreateNewChannel: true,
    inviteUsersToNewChannel: [],
    inviteTeamsToNewChannel: [],
    shouldInviteOwnersToNewChannel: false,
  };

  if (data.prefix !== undefined) {
    notificationRule["newChannelTemplateName"] = data.prefix;
  }

  if (data.teamToCreateChannelIn) {
    notificationRule["teamToCreateChannelIn"] = data.teamToCreateChannelIn;
  }

  workspaceRule.notificationRule = notificationRule as never;
  return workspaceRule;
}

function useRules(
  workspaceType: WorkspaceType,
  rules: Array<WorkspaceNotificationRule>,
): void {
  rulesByWorkspace.set(workspaceType, rules);

  if (!connected.includes(workspaceType)) {
    connected.push(workspaceType);
  }
}

// A request to a fake workspace: Slack's Web API or Microsoft Graph.
function answer(options: {
  url: URL;
  data: JSONObject;
}): HTTPResponse<JSONObject> | HTTPErrorResponse {
  const address: globalThis.URL = new globalThis.URL(options.url.toString());

  if (
    address.origin === "https://slack.com" &&
    address.pathname === "/api/conversations.create"
  ) {
    const create: SlackCreate = options.data as unknown as SlackCreate;
    slackCreates.push({ ...create });

    if (slackRefusal) {
      return new HTTPResponse<JSONObject>(
        200,
        { ok: false, error: slackRefusal },
        {},
      );
    }

    if (slackTaken.has(create.name)) {
      return new HTTPResponse<JSONObject>(
        200,
        { ok: false, error: "name_taken" },
        {},
      );
    }

    slackTaken.add(create.name);

    return new HTTPResponse<JSONObject>(
      200,
      {
        ok: true,
        channel: { id: `C${slackCreates.length}`, name: create.name },
      },
      {},
    );
  }

  const teamsPath: Array<string> = address.pathname.split("/");

  // ["", "v1.0", "teams", "<team>", "channels"]
  if (
    address.origin === "https://graph.microsoft.com" &&
    teamsPath.length === 5 &&
    teamsPath[1] === "v1.0" &&
    teamsPath[2] === "teams" &&
    teamsPath[4] === "channels"
  ) {
    const body: JSONObject = options.data;
    const create: TeamsCreate = {
      teamId: teamsPath[3]!,
      displayName: body["displayName"] as string,
      description: body["description"] as string,
      membershipType: body["membershipType"] as string,
    };
    teamsCreates.push(create);

    // Microsoft Teams compares channel names without regard to case.
    const key: string = `${create.teamId}|${create.displayName.toLowerCase()}`;

    if (teamsTaken.has(key)) {
      return new HTTPErrorResponse(
        400,
        {
          error: {
            code: "BadRequest",
            message: "Channel name already existed, please use other name.",
            innerError: { code: "NameAlreadyExists" },
          },
        },
        {},
      );
    }

    teamsTaken.add(key);

    return new HTTPResponse<JSONObject>(
      201,
      {
        id: `19:channel-${teamsCreates.length}@thread.tacv2`,
        displayName: create.displayName,
      },
      {},
    );
  }

  throw new Error(`Unexpected request to ${options.url.toString()}`);
}

beforeEach(() => {
  slackCreates = [];
  teamsCreates = [];
  slackTaken = new Set<string>();
  teamsTaken = new Set<string>();
  slackRefusal = null;
  rulesByWorkspace = new Map();
  connected = [];

  jest.spyOn(API, "post").mockImplementation((async (options: {
    url: URL;
    data: JSONObject;
  }) => {
    return answer(options);
  }) as never);

  jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuths")
    .mockImplementation((async () => {
      return connected.map(projectAuth);
    }) as never);
  jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
    .mockImplementation((async (data: { workspaceType: WorkspaceType }) => {
      return projectAuth(data.workspaceType);
    }) as never);
  // Slack keeps the channels it creates in the project's channel cache.
  jest
    .spyOn(WorkspaceProjectAuthTokenService, "refreshAuthToken")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(MicrosoftTeamsUtil, "getValidAccessToken")
    .mockResolvedValue("graph-token");

  jest
    .spyOn(WorkspaceNotificationRuleService, "getMatchingNotificationRules")
    .mockImplementation((async (data: { workspaceType: WorkspaceType }) => {
      return rulesByWorkspace.get(data.workspaceType) || [];
    }) as never);
  // Who is invited is not what these tests are about.
  jest
    .spyOn(
      WorkspaceNotificationRuleService,
      "inviteUsersAndTeamsToChannelsBasedOnRules",
    )
    .mockResolvedValue([]);
  jest
    .spyOn(WorkspaceNotificationLogService, "logCreateChannel")
    .mockResolvedValue(undefined as never);

  jest.spyOn(logger, "error").mockImplementation((() => {}) as never);
  jest.spyOn(logger, "debug").mockImplementation((() => {}) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function createdNames(result: WorkspaceChannelsCreated | null): Array<string> {
  return (result?.channelsCreated || []).map(
    (channel: NotificationRuleWorkspaceChannel): string => {
      return channel.name;
    },
  );
}

function createIncident(data?: {
  number?: number;
  numberWithPrefix?: string | undefined;
  isPrivate?: boolean;
}): Promise<WorkspaceChannelsCreated | null> {
  return IncidentWorkspaceMessages.createChannelsAndInviteUsersToChannels({
    projectId: PROJECT_ID,
    incidentId: RECORD_ID,
    incidentNumber: data?.number || 123,
    ...(data && "numberWithPrefix" in data
      ? data.numberWithPrefix
        ? { incidentNumberWithPrefix: data.numberWithPrefix }
        : {}
      : { incidentNumberWithPrefix: "INC-123" }),
    ...(data?.isPrivate ? { isPrivate: true } : {}),
  });
}

describe("the customer's question: inc-123 instead of foo-inc-123", () => {
  test("Slack: no prefix makes conversations.create ask for inc-123", async () => {
    useRules(WorkspaceType.Slack, [
      rule({
        workspaceType: WorkspaceType.Slack,
        eventType: NotificationRuleEventType.Incident,
        prefix: "",
      }),
    ]);

    const result: WorkspaceChannelsCreated | null = await createIncident();

    expect(slackCreates).toEqual([{ name: "inc-123" }]);
    expect(createdNames(result)).toEqual(["inc-123"]);
    expect(result?.channelsCreated[0]).toEqual(
      expect.objectContaining({
        id: "C1",
        name: "inc-123",
        workspaceType: WorkspaceType.Slack,
      }),
    );
  });

  test("Slack: foo- still makes foo-inc-123", async () => {
    useRules(WorkspaceType.Slack, [
      rule({
        workspaceType: WorkspaceType.Slack,
        eventType: NotificationRuleEventType.Incident,
        prefix: "foo-",
      }),
    ]);

    expect(createdNames(await createIncident())).toEqual(["foo-inc-123"]);
    expect(slackCreates).toEqual([{ name: "foo-inc-123" }]);
  });

  test("Microsoft Teams: no prefix makes Graph create inc-123 in the team", async () => {
    useRules(WorkspaceType.MicrosoftTeams, [
      rule({
        workspaceType: WorkspaceType.MicrosoftTeams,
        eventType: NotificationRuleEventType.Incident,
        prefix: "",
        teamToCreateChannelIn: TEAM_WEB,
      }),
    ]);

    const result: WorkspaceChannelsCreated | null = await createIncident();

    expect(teamsCreates).toEqual([
      {
        teamId: TEAM_WEB,
        displayName: "inc-123",
        description: "OneUptime notifications for inc-123",
        membershipType: "standard",
      },
    ]);
    expect(result?.channelsCreated).toEqual([
      expect.objectContaining({
        name: "inc-123",
        teamId: TEAM_WEB,
        workspaceType: WorkspaceType.MicrosoftTeams,
      }),
    ]);
  });

  test("Microsoft Teams: foo- makes foo-inc-123, in the team the project connected when the rule names none", async () => {
    useRules(WorkspaceType.MicrosoftTeams, [
      rule({
        workspaceType: WorkspaceType.MicrosoftTeams,
        eventType: NotificationRuleEventType.Incident,
        prefix: "foo-",
      }),
    ]);

    await createIncident();

    expect(
      teamsCreates.map((create: TeamsCreate) => {
        return [create.teamId, create.displayName];
      }),
    ).toEqual([[TEAM_OPS, "foo-inc-123"]]);
  });

  test("both workspaces connected: each is asked for inc-123", async () => {
    useRules(WorkspaceType.Slack, [
      rule({
        workspaceType: WorkspaceType.Slack,
        eventType: NotificationRuleEventType.Incident,
      }),
    ]);
    useRules(WorkspaceType.MicrosoftTeams, [
      rule({
        workspaceType: WorkspaceType.MicrosoftTeams,
        eventType: NotificationRuleEventType.Incident,
      }),
    ]);

    const result: WorkspaceChannelsCreated | null = await createIncident();

    expect(slackCreates).toEqual([{ name: "inc-123" }]);
    expect(
      teamsCreates.map((create: TeamsCreate) => {
        return create.displayName;
      }),
    ).toEqual(["inc-123"]);
    expect(createdNames(result)).toEqual(["inc-123", "inc-123"]);
  });

  test("a private incident's channel is private, named the same", async () => {
    useRules(WorkspaceType.Slack, [
      rule({
        workspaceType: WorkspaceType.Slack,
        eventType: NotificationRuleEventType.Incident,
      }),
    ]);
    useRules(WorkspaceType.MicrosoftTeams, [
      rule({
        workspaceType: WorkspaceType.MicrosoftTeams,
        eventType: NotificationRuleEventType.Incident,
      }),
    ]);

    await createIncident({ isPrivate: true });

    expect(slackCreates).toEqual([{ name: "inc-123", is_private: true }]);
    expect(teamsCreates[0]?.membershipType).toBe("private");
    expect(teamsCreates[0]?.displayName).toBe("inc-123");
  });
});

describe("every kind of record that creates channels", () => {
  interface RecordCase {
    kind: string;
    eventType: NotificationRuleEventType;
    create: () => Promise<WorkspaceChannelsCreated | null>;
    withoutPrefix: string;
    withPrefix: string;
  }

  const CASES: Array<RecordCase> = [
    {
      kind: "incident INC-123",
      eventType: NotificationRuleEventType.Incident,
      create: () => {
        return createIncident();
      },
      withoutPrefix: "inc-123",
      withPrefix: "ops-inc-123",
    },
    {
      kind: "alert ALT-7",
      eventType: NotificationRuleEventType.Alert,
      create: () => {
        return AlertWorkspaceMessages.createChannelsAndInviteUsersToChannels({
          projectId: PROJECT_ID,
          alertId: RECORD_ID,
          alertNumber: 7,
          alertNumberWithPrefix: "ALT-7",
        });
      },
      withoutPrefix: "alt-7",
      withPrefix: "ops-alt-7",
    },
    {
      kind: "incident episode IE-3",
      eventType: NotificationRuleEventType.IncidentEpisode,
      create: () => {
        return IncidentEpisodeWorkspaceMessages.createChannelsAndInviteUsersToChannels(
          {
            projectId: PROJECT_ID,
            incidentEpisodeId: RECORD_ID,
            episodeNumber: 3,
            episodeNumberWithPrefix: "IE-3",
          },
        );
      },
      withoutPrefix: "ie-3",
      withPrefix: "ops-ie-3",
    },
    {
      kind: "alert episode AE-4",
      eventType: NotificationRuleEventType.AlertEpisode,
      create: () => {
        return AlertEpisodeWorkspaceMessages.createChannelsAndInviteUsersToChannels(
          {
            projectId: PROJECT_ID,
            alertEpisodeId: RECORD_ID,
            episodeNumber: 4,
            episodeNumberWithPrefix: "AE-4",
          },
        );
      },
      withoutPrefix: "ae-4",
      withPrefix: "ops-ae-4",
    },
    {
      // After a prefix, a maintenance event's channel has its bare number, as always.
      kind: "scheduled maintenance SM-5",
      eventType: NotificationRuleEventType.ScheduledMaintenance,
      create: () => {
        return ScheduledMaintenanceWorkspaceMessages.createChannelsAndInviteUsersToChannels(
          {
            projectId: PROJECT_ID,
            scheduledMaintenanceId: RECORD_ID,
            scheduledMaintenanceNumber: 5,
            scheduledMaintenanceNumberWithPrefix: "SM-5",
          },
        );
      },
      withoutPrefix: "sm-5",
      withPrefix: "ops-5",
    },
    {
      kind: "monitor API Health",
      eventType: NotificationRuleEventType.Monitor,
      create: () => {
        return MonitorWorkspaceMessages.createChannelsAndInviteUsersToChannels({
          projectId: PROJECT_ID,
          monitorId: RECORD_ID,
          monitorName: "API Health",
        });
      },
      withoutPrefix: "apihealth",
      withPrefix: "ops-apihealth",
    },
    {
      kind: "on-call policy Primary",
      eventType: NotificationRuleEventType.OnCallDutyPolicy,
      create: () => {
        return OnCallDutyPolicyWorkspaceMessages.createChannelsAndInviteUsersToChannels(
          {
            projectId: PROJECT_ID,
            onCallDutyPolicyId: RECORD_ID,
            onCallDutyPolicyName: "Primary",
          },
        );
      },
      withoutPrefix: "primary",
      withPrefix: "ops-primary",
    },
  ];

  // Each kind of record, in each workspace.
  const RECORDS_IN_WORKSPACES: Array<[string, RecordCase, WorkspaceType]> =
    CASES.flatMap(
      (recordCase: RecordCase): Array<[string, RecordCase, WorkspaceType]> => {
        return [WorkspaceType.Slack, WorkspaceType.MicrosoftTeams].map(
          (
            workspaceType: WorkspaceType,
          ): [string, RecordCase, WorkspaceType] => {
            return [
              `${recordCase.kind} in ${workspaceType}: ${recordCase.withoutPrefix} without a prefix, ${recordCase.withPrefix} with ops-`,
              recordCase,
              workspaceType,
            ];
          },
        );
      },
    );

  test.each(RECORDS_IN_WORKSPACES)(
    "%s",
    async (
      _title: string,
      recordCase: RecordCase,
      workspaceType: WorkspaceType,
    ) => {
      useRules(workspaceType, [
        rule({
          workspaceType,
          eventType: recordCase.eventType,
          prefix: "",
        }),
      ]);

      expect(createdNames(await recordCase.create())).toEqual([
        recordCase.withoutPrefix,
      ]);

      useRules(workspaceType, [
        rule({
          workspaceType,
          eventType: recordCase.eventType,
          prefix: "ops-",
        }),
      ]);

      expect(createdNames(await recordCase.create())).toEqual([
        recordCase.withPrefix,
      ]);

      const asked: Array<string> =
        workspaceType === WorkspaceType.Slack
          ? slackCreates.map((create: SlackCreate) => {
              return create.name;
            })
          : teamsCreates.map((create: TeamsCreate) => {
              return create.displayName;
            });

      expect(asked).toEqual([recordCase.withoutPrefix, recordCase.withPrefix]);
    },
  );

  test("a project that writes its incidents #42 gets incident-42, not a channel named 42", async () => {
    useRules(WorkspaceType.Slack, [
      rule({
        workspaceType: WorkspaceType.Slack,
        eventType: NotificationRuleEventType.Incident,
      }),
    ]);

    await createIncident({ number: 42, numberWithPrefix: "#42" });
    await createIncident({ number: 43, numberWithPrefix: undefined });

    expect(slackCreates).toEqual([
      { name: "incident-42" },
      { name: "incident-43" },
    ]);
  });
});

describe("existing rules keep their names", () => {
  test.each([
    [WorkspaceType.Slack, "oneuptime-incident-", "oneuptime-incident-inc-123"],
    [
      WorkspaceType.MicrosoftTeams,
      "oneuptime-incident-",
      "oneuptime-incident-inc-123",
    ],
    [WorkspaceType.Slack, "Prod Team #1/", "prodteam1inc-123"],
    [WorkspaceType.MicrosoftTeams, "Prod Team #1/", "Prod Team 1inc-123"],
    [WorkspaceType.MicrosoftTeams, "Incident ", "Incident inc-123"],
  ])(
    "%s, prefix %p: %s",
    async (workspaceType: WorkspaceType, prefix: string, expected: string) => {
      useRules(workspaceType, [
        rule({
          workspaceType,
          eventType: NotificationRuleEventType.Incident,
          prefix,
        }),
      ]);

      expect(createdNames(await createIncident())).toEqual([expected]);
    },
  );

  test("the migrated default of a maintenance rule names the channel as before", async () => {
    useRules(WorkspaceType.Slack, [
      rule({
        workspaceType: WorkspaceType.Slack,
        eventType: NotificationRuleEventType.ScheduledMaintenance,
        prefix: WorkspaceChannelName.getLegacyDefaultPrefix(
          NotificationRuleEventType.ScheduledMaintenance,
        ),
      }),
    ]);

    await ScheduledMaintenanceWorkspaceMessages.createChannelsAndInviteUsersToChannels(
      {
        projectId: PROJECT_ID,
        scheduledMaintenanceId: RECORD_ID,
        scheduledMaintenanceNumber: 9,
        scheduledMaintenanceNumberWithPrefix: "SM-9",
      },
    );

    expect(slackCreates).toEqual([
      { name: "oneuptime-scheduledmaintenance-9" },
    ]);
  });
});

describe("long names fit the workspace", () => {
  test("Slack: a long prefix is shortened to 80 characters, the record's part kept", async () => {
    useRules(WorkspaceType.Slack, [
      rule({
        workspaceType: WorkspaceType.Slack,
        eventType: NotificationRuleEventType.Incident,
        prefix: `${"long-".repeat(30)}`,
      }),
    ]);

    await createIncident();

    expect(slackCreates).toHaveLength(1);
    expect(slackCreates[0]!.name).toHaveLength(80);
    expect(slackCreates[0]!.name.endsWith("inc-123")).toBe(true);
  });

  test("Microsoft Teams: 50 characters", async () => {
    useRules(WorkspaceType.MicrosoftTeams, [
      rule({
        workspaceType: WorkspaceType.MicrosoftTeams,
        eventType: NotificationRuleEventType.Incident,
        prefix: `${"Long ".repeat(30)}`,
      }),
    ]);

    await createIncident();

    expect(teamsCreates[0]!.displayName).toHaveLength(50);
    expect(teamsCreates[0]!.displayName.endsWith("inc-123")).toBe(true);
  });

  test("a monitor's long name is cut to Slack's limit", async () => {
    useRules(WorkspaceType.Slack, [
      rule({
        workspaceType: WorkspaceType.Slack,
        eventType: NotificationRuleEventType.Monitor,
      }),
    ]);

    await MonitorWorkspaceMessages.createChannelsAndInviteUsersToChannels({
      projectId: PROJECT_ID,
      monitorId: RECORD_ID,
      monitorName: "Checkout ".repeat(20),
    });

    expect(slackCreates[0]!.name).toBe("checkout".repeat(10));
  });
});

describe("a name somebody has already", () => {
  test("Slack: inc-123 is taken (another project, an archived channel), so the channel is inc-123-2", async () => {
    slackTaken.add("inc-123");
    useRules(WorkspaceType.Slack, [
      rule({
        workspaceType: WorkspaceType.Slack,
        eventType: NotificationRuleEventType.Incident,
      }),
    ]);

    const result: WorkspaceChannelsCreated | null = await createIncident();

    expect(slackCreates).toEqual([{ name: "inc-123" }, { name: "inc-123-2" }]);
    expect(createdNames(result)).toEqual(["inc-123-2"]);
  });

  test("Slack: the first four are taken, the fifth name is used", async () => {
    for (const name of ["inc-123", "inc-123-2", "inc-123-3", "inc-123-4"]) {
      slackTaken.add(name);
    }
    useRules(WorkspaceType.Slack, [
      rule({
        workspaceType: WorkspaceType.Slack,
        eventType: NotificationRuleEventType.Incident,
      }),
    ]);

    expect(createdNames(await createIncident())).toEqual(["inc-123-5"]);
    expect(slackCreates).toHaveLength(5);
  });

  test("Slack: after five taken names it stops, and the record gets no channel", async () => {
    for (const name of [
      "inc-123",
      "inc-123-2",
      "inc-123-3",
      "inc-123-4",
      "inc-123-5",
    ]) {
      slackTaken.add(name);
    }
    useRules(WorkspaceType.Slack, [
      rule({
        workspaceType: WorkspaceType.Slack,
        eventType: NotificationRuleEventType.Incident,
      }),
    ]);

    const result: WorkspaceChannelsCreated | null = await createIncident();

    expect(slackCreates).toHaveLength(WorkspaceChannelName.MAX_NAME_ATTEMPTS);
    expect(createdNames(result)).toEqual([]);
  });

  test("Slack: any other refusal is not tried again under another name", async () => {
    slackRefusal = "restricted_action";
    useRules(WorkspaceType.Slack, [
      rule({
        workspaceType: WorkspaceType.Slack,
        eventType: NotificationRuleEventType.Incident,
      }),
    ]);

    expect(createdNames(await createIncident())).toEqual([]);
    expect(slackCreates).toEqual([{ name: "inc-123" }]);
  });

  test("Slack: a prefixed name that is taken gets -2 too", async () => {
    slackTaken.add("prod-inc-123");
    useRules(WorkspaceType.Slack, [
      rule({
        workspaceType: WorkspaceType.Slack,
        eventType: NotificationRuleEventType.Incident,
        prefix: "prod-",
      }),
    ]);

    expect(createdNames(await createIncident())).toEqual(["prod-inc-123-2"]);
  });

  test("Microsoft Teams: NameAlreadyExists (a channel, or one deleted in the last 30 days) makes inc-123-2", async () => {
    teamsTaken.add(`${TEAM_OPS}|inc-123`);
    useRules(WorkspaceType.MicrosoftTeams, [
      rule({
        workspaceType: WorkspaceType.MicrosoftTeams,
        eventType: NotificationRuleEventType.Incident,
      }),
    ]);

    const result: WorkspaceChannelsCreated | null = await createIncident();

    expect(
      teamsCreates.map((create: TeamsCreate) => {
        return create.displayName;
      }),
    ).toEqual(["inc-123", "inc-123-2"]);
    expect(createdNames(result)).toEqual(["inc-123-2"]);
  });

  test("two projects in one Slack workspace, both numbering INC-: the second project's INC-123 gets inc-123-2", async () => {
    useRules(WorkspaceType.Slack, [
      rule({
        workspaceType: WorkspaceType.Slack,
        eventType: NotificationRuleEventType.Incident,
      }),
    ]);

    // The first project's incident 123, then the second's: the same workspace.
    expect(createdNames(await createIncident())).toEqual(["inc-123"]);
    expect(createdNames(await createIncident())).toEqual(["inc-123-2"]);
  });
});

describe("rules that ask for the same channel", () => {
  test("Slack: two rules without a prefix share one channel", async () => {
    useRules(WorkspaceType.Slack, [
      rule({
        workspaceType: WorkspaceType.Slack,
        eventType: NotificationRuleEventType.Incident,
      }),
      rule({
        workspaceType: WorkspaceType.Slack,
        eventType: NotificationRuleEventType.Incident,
        prefix: "  ",
      }),
    ]);

    expect(createdNames(await createIncident())).toEqual(["inc-123"]);
    expect(slackCreates).toEqual([{ name: "inc-123" }]);
  });

  test("Slack: a rule with a prefix gets a channel of its own", async () => {
    useRules(WorkspaceType.Slack, [
      rule({
        workspaceType: WorkspaceType.Slack,
        eventType: NotificationRuleEventType.Incident,
      }),
      rule({
        workspaceType: WorkspaceType.Slack,
        eventType: NotificationRuleEventType.Incident,
        prefix: "exec-",
      }),
    ]);

    expect(createdNames(await createIncident())).toEqual([
      "inc-123",
      "exec-inc-123",
    ]);
  });

  test("Microsoft Teams: rules in two teams each get the channel in their team", async () => {
    useRules(WorkspaceType.MicrosoftTeams, [
      rule({
        workspaceType: WorkspaceType.MicrosoftTeams,
        eventType: NotificationRuleEventType.Incident,
        teamToCreateChannelIn: TEAM_OPS,
      }),
      rule({
        workspaceType: WorkspaceType.MicrosoftTeams,
        eventType: NotificationRuleEventType.Incident,
        teamToCreateChannelIn: TEAM_WEB,
      }),
    ]);

    await createIncident();

    expect(
      teamsCreates.map((create: TeamsCreate) => {
        return [create.teamId, create.displayName];
      }),
    ).toEqual([
      [TEAM_OPS, "inc-123"],
      [TEAM_WEB, "inc-123"],
    ]);
  });

  test("Microsoft Teams: a rule in the connected team and one naming that team share the channel", async () => {
    useRules(WorkspaceType.MicrosoftTeams, [
      rule({
        workspaceType: WorkspaceType.MicrosoftTeams,
        eventType: NotificationRuleEventType.Incident,
      }),
      rule({
        workspaceType: WorkspaceType.MicrosoftTeams,
        eventType: NotificationRuleEventType.Incident,
        teamToCreateChannelIn: TEAM_OPS,
      }),
    ]);

    await createIncident();

    expect(
      teamsCreates.map((create: TeamsCreate) => {
        return [create.teamId, create.displayName];
      }),
    ).toEqual([[TEAM_OPS, "inc-123"]]);
  });
});

describe("the channels a record's rules ask for (getnotificationChannelssFromNotificationRules)", () => {
  test("each rule's name, its rule, its team and its prefix", () => {
    const first: WorkspaceNotificationRule = rule({
      workspaceType: WorkspaceType.MicrosoftTeams,
      eventType: NotificationRuleEventType.Incident,
      prefix: "Ops-",
      teamToCreateChannelIn: TEAM_WEB,
    });
    const second: WorkspaceNotificationRule = rule({
      workspaceType: WorkspaceType.MicrosoftTeams,
      eventType: NotificationRuleEventType.Incident,
    });

    const channels: Array<RuleChannelToCreate> =
      WorkspaceNotificationRuleService.getnotificationChannelssFromNotificationRules(
        {
          notificationEventType: NotificationRuleEventType.Incident,
          notificationRules: [first, second],
          channelNameParts: WorkspaceChannelName.forNumberedRecord({
            eventType: NotificationRuleEventType.Incident,
            number: 123,
            numberWithPrefix: "INC-123",
          }),
          workspaceType: WorkspaceType.MicrosoftTeams,
        },
      );

    expect(channels).toEqual([
      {
        channelName: "Ops-inc-123",
        notificationRuleId: first.id!.toString(),
        teamId: TEAM_WEB,
        prefix: "Ops-",
      },
      {
        channelName: "inc-123",
        notificationRuleId: second.id!.toString(),
        prefix: "",
      },
    ]);
  });

  test("a rule that does not create channels asks for none", () => {
    const postsOnly: WorkspaceNotificationRule = rule({
      workspaceType: WorkspaceType.Slack,
      eventType: NotificationRuleEventType.Incident,
    });
    (postsOnly.notificationRule as unknown as JSONObject)[
      "shouldCreateNewChannel"
    ] = false;

    expect(
      WorkspaceNotificationRuleService.getnotificationChannelssFromNotificationRules(
        {
          notificationEventType: NotificationRuleEventType.Incident,
          notificationRules: [postsOnly],
          channelNameParts: { afterPrefix: "INC-1", ownName: "inc-1" },
          workspaceType: WorkspaceType.Slack,
        },
      ),
    ).toEqual([]);
  });
});

describe("which refusals mean the name is taken", () => {
  test("Slack: exactly name_taken", () => {
    expect(
      SlackUtil.isChannelNameTakenError(
        new BadRequestException("Error from Slack name_taken"),
      ),
    ).toBe(true);

    for (const other of [
      "Error from Slack invalid_name_specials",
      "Error from Slack restricted_action",
      "Error from Slack name_taken_by_someone",
      "name_taken",
    ]) {
      expect(SlackUtil.isChannelNameTakenError(new Error(other))).toBe(false);
    }

    expect(SlackUtil.isChannelNameTakenError(null)).toBe(false);
  });

  test("Microsoft Teams: 400 or 409 naming the name as taken, read off the fields", () => {
    const taken: HTTPErrorResponse = new HTTPErrorResponse(
      400,
      {
        error: {
          code: "BadRequest",
          message: "Channel name already existed, please use other name.",
          innerError: { code: "NameAlreadyExists" },
        },
      },
      {},
    );

    expect(MicrosoftTeamsUtil.isChannelNameTakenError(taken)).toBe(true);

    // An error from another realm (the botbuilder harness) is read the same way.
    expect(
      MicrosoftTeamsUtil.isChannelNameTakenError({
        statusCode: 409,
        data: { error: { innerError: { code: "NameAlreadyExists" } } },
      }),
    ).toBe(true);
    expect(
      MicrosoftTeamsUtil.isChannelNameTakenError({
        statusCode: 400,
        message: "Channel name already exists.",
      }),
    ).toBe(true);

    for (const other of [
      new HTTPErrorResponse(
        400,
        { error: { code: "BadRequest", message: "Invalid displayName." } },
        {},
      ),
      new HTTPErrorResponse(
        403,
        { error: { innerError: { code: "NameAlreadyExists" } } },
        {},
      ),
      new HTTPErrorResponse(500, { error: "Server error" }, {}),
      new Error("Channel name already existed"),
      null,
      undefined,
    ]) {
      expect(MicrosoftTeamsUtil.isChannelNameTakenError(other)).toBe(false);
    }
  });

  test("a workspace that does not say is never taken", () => {
    expect(
      WorkspaceBase.isChannelNameTakenError(
        new Error("Error from Slack name_taken"),
      ),
    ).toBe(false);
  });
});
