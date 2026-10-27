import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import fs from "fs";
import path from "path";

/*
 * The press a Connect button carries (WorkspaceConnectRequest) is kept in
 * the cache: in memory here.
 */
jest.mock("../../../../../Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: (
      jest.requireActual("../../../API/WorkspaceOAuthTestHelpers") as Record<
        string,
        () => unknown
      >
    )["createInMemoryGlobalCache"]!(),
  };
});

import DatabaseConfig from "../../../../../Server/DatabaseConfig";
import URL from "../../../../../Types/API/URL";
import DatabaseBaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import ScheduledMaintenance from "../../../../../Models/DatabaseModels/ScheduledMaintenance";
import TeamMember from "../../../../../Models/DatabaseModels/TeamMember";
import WorkspaceProjectAuthToken from "../../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import AccessTokenService from "../../../../../Server/Services/AccessTokenService";
import AlertEpisodeService from "../../../../../Server/Services/AlertEpisodeService";
import AlertService from "../../../../../Server/Services/AlertService";
import IncidentEpisodeService from "../../../../../Server/Services/IncidentEpisodeService";
import IncidentService from "../../../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../../../Server/Services/IncidentSeverityService";
import LabelService from "../../../../../Server/Services/LabelService";
import MonitorService from "../../../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../../../Server/Services/MonitorStatusService";
import OnCallDutyPolicyService from "../../../../../Server/Services/OnCallDutyPolicyService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import UserService from "../../../../../Server/Services/UserService";
import ScheduledMaintenanceService from "../../../../../Server/Services/ScheduledMaintenanceService";
import TeamMemberService from "../../../../../Server/Services/TeamMemberService";
import WorkspaceProjectAuthTokenService from "../../../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../../../Server/Services/WorkspaceUserAuthTokenService";
import {
  ExpressRequest,
  ExpressResponse,
} from "../../../../../Server/Utils/Express";
import Response from "../../../../../Server/Utils/Response";
import SlackActionType from "../../../../../Server/Utils/Workspace/Slack/Actions/ActionTypes";
import SlackAlertActions from "../../../../../Server/Utils/Workspace/Slack/Actions/Alert";
import SlackAlertEpisodeActions from "../../../../../Server/Utils/Workspace/Slack/Actions/AlertEpisode";
import SlackAuthAction, {
  SlackAuthRefusalReason,
  SlackRequest,
} from "../../../../../Server/Utils/Workspace/Slack/Actions/Auth";
import SlackIncidentActions from "../../../../../Server/Utils/Workspace/Slack/Actions/Incident";
import SlackIncidentEpisodeActions from "../../../../../Server/Utils/Workspace/Slack/Actions/IncidentEpisode";
import SlackScheduledMaintenanceActions from "../../../../../Server/Utils/Workspace/Slack/Actions/ScheduledMaintenance";
import SlackUtil from "../../../../../Server/Utils/Workspace/Slack/Slack";
import WorkspaceActionAuthorization from "../../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../../../Types/Billing/SubscriptionPlan";
import Dictionary from "../../../../../Types/Dictionary";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../../Types/Permission";
import {
  WorkspaceDropdownBlock,
  WorkspaceMessageBlock,
  WorkspaceModalBlock,
  WorkspacePayloadButtons,
  WorkspacePayloadMarkdown,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";

/*
 * Slack's New Incident and New Scheduled Maintenance forms (/incident,
 * /maintenance) and the Execute On-Call Policy pickers are filled in as the
 * OneUptime member the Slack account is connected to:
 *
 *  - /incident and its submit need a connected account of a current member,
 *    like every other Slack action: someone who never connected one is
 *    asked to, where they asked (a message only they see, in the channel),
 *    with a Connect button, and nothing is created by nobody. (They used to
 *    be open to anyone in the workspace; no project setting asks for that.)
 *  - The member must be allowed to declare an incident (create an event,
 *    execute a policy): one who may not is told so, where they asked,
 *    before any form opens, and before anything is created.
 *  - Every list a form offers - severities, monitors, monitor statuses,
 *    on-call policies, labels - is read with the member's own props, never as
 *    root, so a form offers only what they may read; a list they may not read
 *    at all is left off the form.
 *  - The submit creates the record with the member's own props, so every id
 *    it names is held to what they may name (WorkspaceCreateProjectReferences
 *    pins the refusals; the Postgres suite WorkspaceCreateFormsScopePostgres
 *    reads real label-limited lists).
 *
 * The permission and membership checks are the real ones, over the rows a
 * member really holds; the reads under them and Slack itself are stubbed.
 */

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();
const slackUserId: string = "U0MEMBER";
const slackTeamId: string = "T0WORKSPACE";
const projectAuthToken: string = "xoxb-project-token";

let directMessageSpy: SpyInstance<typeof SlackUtil.sendDirectMessageToUser>;
let ephemeralSpy: SpyInstance<typeof SlackUtil.sendEphemeralMessageToChannel>;
let showModalSpy: SpyInstance<typeof SlackUtil.showModalToUser>;

function createTenantPermission(
  permissions: Array<Permission>,
): UserTenantAccessPermission {
  return {
    _type: "UserTenantAccessPermission",
    projectId: projectId,
    permissions: permissions.map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        isBlockPermission: false,
        labelIds: [],
      };
    }),
  };
}

// A current member of the project holding exactly `permissions`.
function mockMember(permissions: Array<Permission>): void {
  const member: TeamMember = new TeamMember();
  member.teamId = ObjectID.generate();
  jest.spyOn(TeamMemberService, "findBy").mockResolvedValue([member]);
  jest
    .spyOn(AccessTokenService, "getUserTenantAccessPermission")
    .mockResolvedValue(createTenantPermission(permissions));
  jest
    .spyOn(AccessTokenService, "getUserGlobalAccessPermission")
    .mockResolvedValue(null);
}

function createSlackRequest(
  viewValues: Dictionary<string | number | Array<string | number> | Date> = {},
): SlackRequest {
  return {
    isAuthorized: true,
    userId: userId,
    projectId: projectId,
    projectAuthToken: projectAuthToken,
    botUserId: "B0BOT",
    slackUserId: slackUserId,
    slackUsername: "jane",
    slackChannelId: "C0CHANNEL",
    triggerId: "trigger-1",
    viewValues: viewValues,
  };
}

function handlerArgs(
  actionType: SlackActionType,
  actionValue: string,
  viewValues?: Dictionary<string | number | Array<string | number> | Date>,
): {
  slackRequest: SlackRequest;
  action: { actionType: SlackActionType; actionValue: string };
  req: ExpressRequest;
  res: ExpressResponse;
} {
  return {
    slackRequest: createSlackRequest(viewValues),
    action: { actionType: actionType, actionValue: actionValue },
    req: {} as ExpressRequest,
    res: {} as ExpressResponse,
  };
}

// An answer only the person sees, in the channel they asked in.
interface ChannelAnswer {
  channelId: string;
  userId: string;
  text: string;
  // The Connect button's link, when the answer has one.
  connectUrl: string | null;
}

function channelAnswers(): Array<ChannelAnswer> {
  return ephemeralSpy.mock.calls.map(
    (
      call: Parameters<typeof SlackUtil.sendEphemeralMessageToChannel>,
    ): ChannelAnswer => {
      const blocks: Array<WorkspaceMessageBlock> = call[0].messageBlocks;
      const buttons: WorkspacePayloadButtons | undefined = blocks.find(
        (block: WorkspaceMessageBlock): boolean => {
          return block._type === "WorkspacePayloadButtons";
        },
      ) as WorkspacePayloadButtons | undefined;

      return {
        channelId: call[0].channelId,
        userId: call[0].userId,
        text: (blocks[0] as WorkspacePayloadMarkdown).text,
        connectUrl: buttons?.buttons[0]?.url?.toString() || null,
      };
    },
  );
}

function channelAnswerTexts(): Array<string> {
  return channelAnswers().map((answer: ChannelAnswer): string => {
    return answer.text;
  });
}

// The one form Slack was asked to show.
function shownModal(): WorkspaceModalBlock {
  expect(showModalSpy).toHaveBeenCalledTimes(1);
  return showModalSpy.mock.calls[0]![0].modalBlock;
}

function dropdownsOf(modal: WorkspaceModalBlock): Dictionary<Array<string>> {
  const dropdowns: Dictionary<Array<string>> = {};

  for (const block of modal.blocks) {
    if (block._type !== "WorkspaceDropdownBlock") {
      continue;
    }

    const dropdown: WorkspaceDropdownBlock = block as WorkspaceDropdownBlock;
    dropdowns[dropdown.blockId] = dropdown.options.map(
      (option: { label: string }) => {
        return option.label;
      },
    );
  }

  return dropdowns;
}

interface ListRead {
  list: string;
  props: DatabaseCommonInteractionProps;
  query: Dictionary<unknown>;
}

type ListService = {
  findBy: (findBy: unknown) => Promise<Array<DatabaseBaseModel>>;
};

const LISTS: Array<{
  list: string;
  service: ListService;
  rowNames: Array<string>;
}> = [
  {
    list: "severities",
    service: IncidentSeverityService as unknown as ListService,
    rowNames: ["Critical", "Minor"],
  },
  {
    list: "monitors",
    service: MonitorService as unknown as ListService,
    rowNames: ["Checkout API"],
  },
  {
    list: "monitorStatuses",
    service: MonitorStatusService as unknown as ListService,
    rowNames: ["Operational", "Offline"],
  },
  {
    list: "onCallPolicies",
    service: OnCallDutyPolicyService as unknown as ListService,
    rowNames: ["Primary on-call"],
  },
  {
    list: "labels",
    service: LabelService as unknown as ListService,
    rowNames: ["team:payments"],
  },
];

/*
 * The lists a form reads, recorded with the props and query each was read
 * with. A list named in `refused` answers as a member who may not read it
 * does: a NotAuthorizedException.
 */
function stubLists(refused: Array<string> = []): Array<ListRead> {
  const reads: Array<ListRead> = [];

  for (const entry of LISTS) {
    jest
      .spyOn(entry.service, "findBy")
      .mockImplementation(async (findBy: unknown) => {
        const read: { props: DatabaseCommonInteractionProps; query: unknown } =
          findBy as { props: DatabaseCommonInteractionProps; query: unknown };

        reads.push({
          list: entry.list,
          props: read.props,
          query: read.query as Dictionary<unknown>,
        });

        if (refused.includes(entry.list)) {
          throw new NotAuthorizedException(
            `You do not have permissions to read ${entry.list}.`,
          );
        }

        return entry.rowNames.map((name: string): DatabaseBaseModel => {
          const row: DatabaseBaseModel = new (
            entry.service as unknown as {
              modelType: new () => DatabaseBaseModel;
            }
          ).modelType();
          row._id = ObjectID.generate().toString();
          row.setValue("name", name);
          return row;
        });
      });
  }

  return reads;
}

// Every read was the member's, in their project: never root.
function expectReadAsTheMember(reads: Array<ListRead>): void {
  expect(reads.length).toBeGreaterThan(0);

  for (const read of reads) {
    expect(read.props.isRoot).toBeFalsy();
    expect(read.props.userId?.toString()).toBe(userId.toString());
    expect(read.props.tenantId?.toString()).toBe(projectId.toString());
    expect(String(read.query["projectId"])).toBe(projectId.toString());
  }
}

beforeEach((): void => {
  // Not a blocked project: that refusal has suites of its own (BlockedProject*).
  jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);
  // Nor a blocked person (WorkspaceActionAuthorization asks that too).
  jest.spyOn(UserService, "isUserBlocked").mockResolvedValue(false);
  // The project's plan, as the checks read it where a plan decides (CallerPlan).
  jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
    plan: PlanType.Enterprise,
    isSubscriptionUnpaid: false,
  });
  jest.spyOn(Response, "sendJsonObjectResponse").mockImplementation(() => {});
  jest.spyOn(Response, "sendTextResponse").mockImplementation(() => {});
  jest.spyOn(Response, "sendErrorResponse").mockImplementation(() => {});
  directMessageSpy = jest
    .spyOn(SlackUtil, "sendDirectMessageToUser")
    .mockResolvedValue();
  ephemeralSpy = jest
    .spyOn(SlackUtil, "sendEphemeralMessageToChannel")
    .mockResolvedValue();
  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockResolvedValue(URL.fromString("https://oneuptime.test/dashboard"));
  showModalSpy = jest.spyOn(SlackUtil, "showModalToUser").mockResolvedValue();
  jest.spyOn(SlackUtil, "sendMessage").mockResolvedValue({
    channelsPosted: [],
    threadPosted: false,
  } as never);
});

afterEach((): void => {
  jest.restoreAllMocks();
});

describe("/incident and its form need a connected account of a current member", (): void => {
  function mockConnectedWorkspace(
    userAuth: WorkspaceUserAuthToken | null,
  ): void {
    const projectAuth: WorkspaceProjectAuthToken =
      new WorkspaceProjectAuthToken();
    projectAuth.projectId = projectId;
    projectAuth.authToken = projectAuthToken;
    projectAuth.miscData = { botUserId: "B0BOT" } as never;
    // The workspace's one connection (WorkspaceProjectResolution reads them all).
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "findBy")
      .mockResolvedValue([projectAuth]);
    jest
      .spyOn(WorkspaceUserAuthTokenService, "findOneBy")
      .mockResolvedValue(userAuth);
  }

  function connectedAccount(): WorkspaceUserAuthToken {
    const userAuth: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
    userAuth.userId = userId;
    userAuth.authToken = "xoxp-user-token";
    return userAuth;
  }

  // "/incident Checkout is down", as Slack posts a slash command.
  function slashCommand(): ExpressRequest {
    return {
      body: {
        command: SlackActionType.NewIncident,
        text: "Checkout is down",
        user_id: slackUserId,
        user_name: "jane",
        team_id: slackTeamId,
        channel_id: "C0CHANNEL",
        trigger_id: "trigger-1",
      },
    } as unknown as ExpressRequest;
  }

  // The New Incident form submitted, as Slack posts a view submission.
  function formSubmission(): ExpressRequest {
    return {
      body: {
        payload: JSON.stringify({
          type: "view_submission",
          user: { id: slackUserId, username: "jane" },
          team: { id: slackTeamId },
          view: {
            callback_id: SlackActionType.SubmitNewIncident,
            private_metadata: "C0CHANNEL",
            state: { values: {} },
          },
        }),
      },
    } as unknown as ExpressRequest;
  }

  test.each([
    /*
     * An app created from an older manifest still has /incident: run again
     * what the app has.
     */
    { name: "/incident", request: slashCommand, again: "/incident" },
    /*
     * A form's submission names no command: run again the one every app
     * has from now on.
     */
    {
      name: "the New Incident form's submit",
      request: formSubmission,
      again: "/oneuptime incident",
    },
  ])(
    "$name from a Slack user who never connected an account: refused, and asked in the channel to connect it, with a Connect button",
    async (row: {
      name: string;
      request: () => ExpressRequest;
      again: string;
    }) => {
      mockConnectedWorkspace(null);

      const result: SlackRequest = await SlackAuthAction.isAuthorized({
        req: row.request(),
      });

      expect(result.isAuthorized).toBe(false);
      expect(result.refusal?.reason).toBe(SlackAuthRefusalReason.NotConnected);
      // Nothing is said before the press is acknowledged to Slack.
      expect(ephemeralSpy).not.toHaveBeenCalled();
      expect(directMessageSpy).not.toHaveBeenCalled();

      await SlackAuthAction.answerRefusal(result);

      /*
       * master: "Unfortunately your slack account is not connected to
       * OneUptime. Please log into your OneUptime account, click on User
       * Settings and then connect your Slack account." in a direct message.
       */
      expect(directMessageSpy).not.toHaveBeenCalled();
      const answers: Array<ChannelAnswer> = channelAnswers();
      expect(answers).toHaveLength(1);
      expect(answers[0]).toMatchObject({
        channelId: "C0CHANNEL",
        userId: slackUserId,
        text: `🔗 **Connect your Slack account to declare an incident.** It takes one click. Then run **${row.again}** again.`,
      });

      const url: globalThis.URL = new globalThis.URL(
        answers[0]!.connectUrl || "",
      );
      expect(`${url.origin}${url.pathname}`).toBe(
        `https://oneuptime.test/dashboard/${projectId.toString()}/user-settings/slack-integration`,
      );
      expect(url.searchParams.get("connect")).toHaveLength(43);
    },
  );

  test.each([
    { name: "/incident", request: slashCommand },
    { name: "the New Incident form's submit", request: formSubmission },
  ])(
    "$name from someone removed from the project: refused as not a member, in the channel",
    async (row: { name: string; request: () => ExpressRequest }) => {
      mockConnectedWorkspace(connectedAccount());
      jest.spyOn(TeamMemberService, "findBy").mockResolvedValue([]);

      const result: SlackRequest = await SlackAuthAction.isAuthorized({
        req: row.request(),
      });

      expect(result.isAuthorized).toBe(false);
      expect(result.refusal?.reason).toBe(SlackAuthRefusalReason.NotAMember);

      await SlackAuthAction.answerRefusal(result);

      expect(channelAnswers()).toEqual([
        {
          channelId: "C0CHANNEL",
          userId: slackUserId,
          text: WorkspaceActionAuthorization.NOT_A_PROJECT_MEMBER_MESSAGE,
          connectUrl: null,
        },
      ]);
      expect(directMessageSpy).not.toHaveBeenCalled();
    },
  );

  test("/incident from a connected member: let through as their OneUptime user", async () => {
    mockConnectedWorkspace(connectedAccount());
    mockMember([Permission.IncidentMember]);

    const result: SlackRequest = await SlackAuthAction.isAuthorized({
      req: slashCommand(),
    });

    expect(result.isAuthorized).toBe(true);
    expect(result.userId).toBe(userId);
    expect(result.refusal).toBeUndefined();
    expect(directMessageSpy).not.toHaveBeenCalled();
    expect(ephemeralSpy).not.toHaveBeenCalled();
  });
});

describe("the New Incident form is filled in as the member", (): void => {
  test("a member who may not declare an incident is told so in the channel they asked in, and no form opens", async () => {
    mockMember([Permission.Viewer]);
    const reads: Array<ListRead> = stubLists();

    await SlackIncidentActions.viewNewIncidentModal(
      handlerArgs(SlackActionType.NewIncident, "Checkout is down"),
    );

    expect(showModalSpy).not.toHaveBeenCalled();
    expect(reads).toEqual([]);
    expect(channelAnswerTexts()).toHaveLength(1);
    expect(channelAnswerTexts()[0]).toContain(
      "You do not have permission to declare an incident.",
    );
    expect(directMessageSpy).not.toHaveBeenCalled();
  });

  test.each([
    Permission.IncidentMember,
    Permission.CreateProjectIncident,
    Permission.ProjectMember,
  ])(
    "a member with %s gets the form, every list read with their own props",
    async (permission: Permission) => {
      mockMember([permission]);
      const reads: Array<ListRead> = stubLists();

      await SlackIncidentActions.viewNewIncidentModal(
        handlerArgs(SlackActionType.NewIncident, "Checkout is down"),
      );

      const modal: WorkspaceModalBlock = shownModal();
      expect(modal.actionId).toBe(SlackActionType.SubmitNewIncident);
      expect(dropdownsOf(modal)).toEqual({
        incidentSeverity: ["Critical", "Minor"],
        incidentMonitors: ["Checkout API"],
        monitorStatus: ["Operational", "Offline"],
        onCallDutyPolicies: ["Primary on-call"],
        labels: ["team:payments"],
      });

      expect(
        reads
          .map((read: ListRead) => {
            return read.list;
          })
          .sort(),
      ).toEqual([
        "labels",
        "monitorStatuses",
        "monitors",
        "onCallPolicies",
        "severities",
      ]);
      expectReadAsTheMember(reads);

      // Archived policies page no one, so they are not offered.
      const policyRead: ListRead | undefined = reads.find((read: ListRead) => {
        return read.list === "onCallPolicies";
      });
      expect(policyRead?.query["isArchived"]).toBe(false);
      expect(directMessageSpy).not.toHaveBeenCalled();
    },
  );

  /*
   * The policies to page when the incident is created, named as Microsoft
   * Teams' create card names them ("Execute On-Call Policies (Optional)":
   * Slack marks an optional field itself) and as the Dashboard names the
   * action, not "Execute On Call Policy".
   */
  test("the form's on-call policies are named as Microsoft Teams' card names them", async () => {
    mockMember([Permission.ProjectMember]);
    stubLists();

    await SlackIncidentActions.viewNewIncidentModal(
      handlerArgs(SlackActionType.NewIncident, "Checkout is down"),
    );

    const policies: WorkspaceDropdownBlock | undefined = shownModal()
      .blocks.filter((block: WorkspaceMessageBlock): boolean => {
        return block._type === "WorkspaceDropdownBlock";
      })
      .map((block: WorkspaceMessageBlock): WorkspaceDropdownBlock => {
        return block as WorkspaceDropdownBlock;
      })
      .find((dropdown: WorkspaceDropdownBlock): boolean => {
        return dropdown.blockId === "onCallDutyPolicies";
      });

    expect(policies).toMatchObject({
      label: "Execute On-Call Policies",
      placeholder:
        "Select on-call policies to execute when this incident is created",
      multiSelect: true,
      optional: true,
    });
    expect(
      fs.readFileSync(
        path.resolve(
          __dirname,
          "../../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Incident.ts",
        ),
        "utf8",
      ),
    ).toContain(`label: "${policies!.label} (Optional)"`);
  });

  test("a list the member may not read is left off the form, and the rest are offered", async () => {
    mockMember([Permission.IncidentMember]);
    stubLists(["monitors", "labels", "onCallPolicies"]);

    await SlackIncidentActions.viewNewIncidentModal(
      handlerArgs(SlackActionType.NewIncident, ""),
    );

    // No monitors: nothing for a status change to apply to either.
    expect(dropdownsOf(shownModal())).toEqual({
      incidentSeverity: ["Critical", "Minor"],
    });
    expect(directMessageSpy).not.toHaveBeenCalled();
  });

  test("a read that fails for another reason is not taken for a refusal", async () => {
    mockMember([Permission.IncidentMember]);
    stubLists();
    jest
      .spyOn(MonitorService, "findBy")
      .mockRejectedValue(new Error("Connection terminated unexpectedly"));

    await expect(
      SlackIncidentActions.viewNewIncidentModal(
        handlerArgs(SlackActionType.NewIncident, ""),
      ),
    ).rejects.toThrow("Connection terminated unexpectedly");
    expect(showModalSpy).not.toHaveBeenCalled();
  });
});

describe("submitting the New Incident form", (): void => {
  const viewValues: Dictionary<string | number | Array<string | number>> = {
    incidentTitle: "Checkout is down",
    incidentDescription: "Every payment fails.",
    incidentSeverity: ObjectID.generate().toString(),
  };

  test("a member who may not declare an incident is told so, and nothing is created", async () => {
    mockMember([Permission.Viewer]);
    const createSpy: SpyInstance<typeof IncidentService.create> = jest
      .spyOn(IncidentService, "create")
      .mockResolvedValue(new Incident());

    await SlackIncidentActions.submitNewIncident(
      handlerArgs(SlackActionType.SubmitNewIncident, "", viewValues),
    );

    expect(createSpy).not.toHaveBeenCalled();
    expect(channelAnswerTexts()[0]).toContain(
      "You do not have permission to declare an incident.",
    );
  });

  test("a member who may: the incident is created with their own props, and credited by the create", async () => {
    mockMember([Permission.IncidentMember]);
    const created: Incident = new Incident();
    created.id = ObjectID.generate();
    const createSpy: SpyInstance<typeof IncidentService.create> = jest
      .spyOn(IncidentService, "create")
      .mockResolvedValue(created);

    await SlackIncidentActions.submitNewIncident(
      handlerArgs(SlackActionType.SubmitNewIncident, "", viewValues),
    );

    expect(createSpy).toHaveBeenCalledTimes(1);
    const props: DatabaseCommonInteractionProps =
      createSpy.mock.calls[0]![0].props;
    expect(props.isRoot).toBeFalsy();
    expect(props.userId?.toString()).toBe(userId.toString());
    expect(props.tenantId?.toString()).toBe(projectId.toString());
    expect(createSpy.mock.calls[0]![0].data.createdByUserId).toBeUndefined();
    expect(directMessageSpy).not.toHaveBeenCalled();
  });
});

describe("the New Scheduled Maintenance form is filled in as the member", (): void => {
  test("a member who may not create events is told so, and no form opens", async () => {
    mockMember([Permission.Viewer]);
    const reads: Array<ListRead> = stubLists();

    await SlackScheduledMaintenanceActions.viewNewScheduledMaintenanceModal(
      handlerArgs(SlackActionType.NewScheduledMaintenance, "Upgrade"),
    );

    expect(showModalSpy).not.toHaveBeenCalled();
    expect(reads).toEqual([]);
    expect(channelAnswerTexts()[0]).toContain(
      "You do not have permission to create a scheduled maintenance event.",
    );
  });

  test("a member who may gets the form, its monitors, statuses and labels read with their own props", async () => {
    mockMember([Permission.ScheduledMaintenanceMember]);
    const reads: Array<ListRead> = stubLists(["labels"]);

    await SlackScheduledMaintenanceActions.viewNewScheduledMaintenanceModal(
      handlerArgs(SlackActionType.NewScheduledMaintenance, "Upgrade"),
    );

    expect(dropdownsOf(shownModal())).toEqual({
      scheduledMaintenanceMonitors: ["Checkout API"],
      monitorStatus: ["Operational", "Offline"],
    });
    expect(
      reads
        .map((read: ListRead) => {
          return read.list;
        })
        .sort(),
    ).toEqual(["labels", "monitorStatuses", "monitors"]);
    expectReadAsTheMember(reads);
  });

  test("its submit creates the event with the member's own props", async () => {
    mockMember([Permission.ScheduledMaintenanceMember]);
    const created: ScheduledMaintenance = new ScheduledMaintenance();
    created.id = ObjectID.generate();
    const createSpy: SpyInstance<typeof ScheduledMaintenanceService.create> =
      jest
        .spyOn(ScheduledMaintenanceService, "create")
        .mockResolvedValue(created);

    await SlackScheduledMaintenanceActions.submitNewScheduledMaintenance(
      handlerArgs(SlackActionType.SubmitNewScheduledMaintenance, "", {
        scheduledMaintenanceTitle: "Upgrade",
        scheduledMaintenanceDescription: "Postgres 17.",
        startDate: "2099-01-01T10:00:00.000Z",
        endDate: "2099-01-01T11:00:00.000Z",
      }),
    );

    expect(createSpy).toHaveBeenCalledTimes(1);
    const props: DatabaseCommonInteractionProps =
      createSpy.mock.calls[0]![0].props;
    expect(props.isRoot).toBeFalsy();
    expect(props.userId?.toString()).toBe(userId.toString());
  });
});

describe("Execute On-Call Policy pickers ask first, then offer what the member may read", (): void => {
  interface PickerCase {
    name: string;
    resourceService: { findOneBy: unknown };
    refusal: string;
    open: (id: string) => Promise<void>;
    // The form's submission, as it always was.
    submit: SlackActionType;
  }

  const PICKERS: Array<PickerCase> = [
    {
      name: "an incident",
      resourceService: IncidentService,
      refusal: "execute an on-call policy for this incident",
      open: (id: string): Promise<void> => {
        return SlackIncidentActions.handleIncidentAction(
          handlerArgs(SlackActionType.ViewExecuteIncidentOnCallPolicy, id),
        );
      },
      submit: SlackActionType.SubmitExecuteIncidentOnCallPolicy,
    },
    {
      name: "an alert",
      resourceService: AlertService,
      refusal: "execute an on-call policy for this alert",
      open: (id: string): Promise<void> => {
        return SlackAlertActions.handleAlertAction(
          handlerArgs(SlackActionType.ViewExecuteAlertOnCallPolicy, id),
        );
      },
      submit: SlackActionType.SubmitExecuteAlertOnCallPolicy,
    },
    {
      name: "an incident episode",
      resourceService: IncidentEpisodeService,
      refusal: "execute an on-call policy for this incident episode",
      open: (id: string): Promise<void> => {
        return SlackIncidentEpisodeActions.handleIncidentEpisodeAction(
          handlerArgs(
            SlackActionType.ViewExecuteIncidentEpisodeOnCallPolicy,
            id,
          ),
        );
      },
      submit: SlackActionType.SubmitExecuteIncidentEpisodeOnCallPolicy,
    },
    {
      name: "an alert episode",
      resourceService: AlertEpisodeService,
      refusal: "execute an on-call policy for this alert episode",
      open: (id: string): Promise<void> => {
        return SlackAlertEpisodeActions.handleAlertEpisodeAction(
          handlerArgs(SlackActionType.ViewExecuteAlertEpisodeOnCallPolicy, id),
        );
      },
      submit: SlackActionType.SubmitExecuteAlertEpisodeOnCallPolicy,
    },
  ];

  test.each(PICKERS)(
    "on $name: a member who may not execute a policy is told so, and no picker opens",
    async (picker: PickerCase) => {
      mockMember([Permission.Viewer]);
      const reads: Array<ListRead> = stubLists();

      await picker.open(ObjectID.generate().toString());

      expect(showModalSpy).not.toHaveBeenCalled();
      expect(reads).toEqual([]);
      expect(channelAnswerTexts()[0]).toContain(
        `You do not have permission to ${picker.refusal}.`,
      );
    },
  );

  test.each(PICKERS)(
    "on $name: a member who may gets the picker, its policies read with their own props",
    async (picker: PickerCase) => {
      mockMember([Permission.OnCallMember]);
      const reads: Array<ListRead> = stubLists();
      // The record the picker is for, readable by the member.
      jest
        .spyOn(picker.resourceService as never, "findOneBy" as never)
        .mockResolvedValue({ _id: ObjectID.generate().toString() } as never);

      await picker.open(ObjectID.generate().toString());

      expect(dropdownsOf(shownModal())).toEqual({
        onCallPolicy: ["Primary on-call"],
      });
      expect(
        reads.map((read: ListRead) => {
          return read.list;
        }),
      ).toEqual(["onCallPolicies"]);
      expectReadAsTheMember(reads);
      expect(reads[0]!.query["isArchived"]).toBe(false);
    },
  );

  /*
   * Titled as the Dashboard's form and Microsoft Teams' card are, within the
   * 24 characters Slack allows a modal's title, and asking for the On-Call
   * Policy as they do. Only the words changed: the press and the form's
   * submission carry the ids they always did.
   */
  test.each(PICKERS)(
    "on $name: the picker is the Dashboard's Execute On-Call Policy, in words Slack takes",
    async (picker: PickerCase) => {
      mockMember([Permission.OnCallMember]);
      stubLists();
      jest
        .spyOn(picker.resourceService as never, "findOneBy" as never)
        .mockResolvedValue({ _id: ObjectID.generate().toString() } as never);

      await picker.open(ObjectID.generate().toString());

      const modal: WorkspaceModalBlock = shownModal();

      expect(modal.title).toBe("Execute On-Call Policy");
      expect(modal.title.length).toBeLessThanOrEqual(
        SlackUtil.MODAL_TITLE_MAX_LENGTH,
      );
      expect(modal.actionId).toBe(picker.submit);
      expect(modal.blocks).toHaveLength(1);
      expect(modal.blocks[0]).toMatchObject({
        _type: "WorkspaceDropdownBlock",
        blockId: "onCallPolicy",
        label: "On-Call Policy",
        placeholder: "Select On-Call Policy",
      });
    },
  );

  test.each(PICKERS)(
    "on $name: when no policy is open to the member, they are told how to get one",
    async (picker: PickerCase) => {
      mockMember([Permission.OnCallMember]);
      stubLists(["onCallPolicies"]);
      jest
        .spyOn(picker.resourceService as never, "findOneBy" as never)
        .mockResolvedValue({ _id: ObjectID.generate().toString() } as never);
      const ephemeral: SpyInstance<
        typeof SlackUtil.sendEphemeralMessageToChannel
      > = jest
        .spyOn(SlackUtil, "sendEphemeralMessageToChannel")
        .mockResolvedValue();

      await picker.open(ObjectID.generate().toString());

      expect(showModalSpy).not.toHaveBeenCalled();
      expect(ephemeral).toHaveBeenCalledTimes(1);
      expect(
        (
          ephemeral.mock.calls[0]![0]
            .messageBlocks[0] as WorkspacePayloadMarkdown
        ).text,
      ).toBe(
        "No on-call policies are available to you in this project yet. Add one in the OneUptime Dashboard under On-Call Duty > Policies, or ask a project admin for access to one.",
      );
    },
  );
});
