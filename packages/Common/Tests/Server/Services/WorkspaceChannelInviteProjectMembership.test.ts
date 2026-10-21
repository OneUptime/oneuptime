import WorkspaceNotificationRule from "../../../Models/DatabaseModels/WorkspaceNotificationRule";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceNotificationLogService from "../../../Server/Services/WorkspaceNotificationLogService";
import WorkspaceNotificationRuleService from "../../../Server/Services/WorkspaceNotificationRuleService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import logger from "../../../Server/Utils/Logger";
import ProjectMembership from "../../../Server/Utils/TeamMember/ProjectMembership";
import WorkspaceUtil from "../../../Server/Utils/Workspace/Workspace";
import ObjectID from "../../../Types/ObjectID";
import NotificationRuleWorkspaceChannel from "../../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";

/*
 * Incident, alert and on-call channels invite the people involved - owners,
 * team rosters, whoever was paged. Any of those lists can still name
 * somebody who has left the project, so the ids are narrowed to members of
 * the project, in one read, before anybody is looked up or invited: a
 * former member is neither invited nor named in the channel.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-000000000001",
);
const RULE_ID: ObjectID = new ObjectID("bbbbbbbb-0000-4000-8000-000000000001");
const MEMBER_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const LEAVER_ID: ObjectID = new ObjectID(
  "20000000-0000-4000-8000-000000000002",
);

describe("workspace channel invites reach project members only", () => {
  let members: Set<string>;
  let membershipReads: Array<Array<string>>;
  let invite: Mock<(data: unknown) => Promise<void>>;
  let sendMessage: Mock<(data: unknown) => Promise<void>>;
  let workspaceUserLookups: Array<string>;
  let projectAuthRead: SpyInstance<
    typeof WorkspaceProjectAuthTokenService.findOneBy
  >;

  async function inviteBoth(): Promise<void> {
    const rule: WorkspaceNotificationRule = new WorkspaceNotificationRule();
    rule.id = RULE_ID;
    rule.workspaceType = WorkspaceType.Slack;

    await WorkspaceNotificationRuleService.inviteUsersBasedOnRulesAndWorkspaceChannels(
      {
        projectId: PROJECT_ID,
        notificationRules: [rule],
        workspaceChannels: [
          {
            id: "C0001",
            name: "incident-42",
            notificationRuleId: RULE_ID.toString(),
          } as NotificationRuleWorkspaceChannel,
        ],
        userIds: [MEMBER_ID, LEAVER_ID],
      },
    );
  }

  beforeEach(() => {
    members = new Set<string>([MEMBER_ID.toString()]);
    membershipReads = [];
    workspaceUserLookups = [];

    for (const level of ["debug", "info", "warn", "error"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }

    jest
      .spyOn(ProjectMembership, "getMemberUserIds")
      .mockImplementation(
        async (data: {
          projectId: ObjectID;
          userIds: Array<ObjectID | string>;
        }): Promise<Set<string>> => {
          const asked: Array<string> = data.userIds.map(
            (userId: ObjectID | string): string => {
              return userId.toString();
            },
          );

          membershipReads.push(asked);

          return new Set<string>(
            asked.filter((userId: string): boolean => {
              return members.has(userId);
            }),
          );
        },
      );

    projectAuthRead = jest
      .spyOn(WorkspaceProjectAuthTokenService, "findOneBy")
      .mockResolvedValue({
        authToken: "xoxb-project",
        workspaceProjectId: "T0001",
      } as unknown as WorkspaceProjectAuthToken);

    jest
      .spyOn(
        WorkspaceNotificationRuleService,
        "getWorkspaceUserIdFromOneUptimeUserId",
      )
      .mockImplementation(async (data: { oneuptimeUserId: ObjectID }) => {
        workspaceUserLookups.push(data.oneuptimeUserId.toString());
        return `U-${data.oneuptimeUserId.toString()}`;
      });

    invite = jest.fn(async (): Promise<void> => {
      return undefined;
    });
    sendMessage = jest.fn(async (): Promise<void> => {
      return undefined;
    });

    jest.spyOn(WorkspaceUtil, "getWorkspaceTypeUtil").mockReturnValue({
      inviteUsersToChannels: invite,
      sendMessage: sendMessage,
    } as never);

    jest
      .spyOn(WorkspaceNotificationLogService, "logInviteUser")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a former member is not invited, looked up, or named in the channel", async () => {
    await inviteBoth();

    expect(invite).toHaveBeenCalledTimes(1);
    expect(invite.mock.calls[0]![0]).toMatchObject({
      workspaceChannelInvitationPayload: {
        channelNames: ["incident-42"],
        workspaceUserIds: [`U-${MEMBER_ID.toString()}`],
      },
    });

    expect(workspaceUserLookups).toEqual([MEMBER_ID.toString()]);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  test("membership is read once for everybody the channel would invite", async () => {
    await inviteBoth();

    expect(membershipReads).toEqual([
      [MEMBER_ID.toString(), LEAVER_ID.toString()],
    ]);
  });

  test("nobody left to invite: the workspace is not contacted at all", async () => {
    members.clear();

    await inviteBoth();

    expect(projectAuthRead).not.toHaveBeenCalled();
    expect(invite).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
