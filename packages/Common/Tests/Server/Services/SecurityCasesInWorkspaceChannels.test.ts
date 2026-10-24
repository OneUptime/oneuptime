import Label from "../../../Models/DatabaseModels/Label";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import WorkspaceNotificationRule from "../../../Models/DatabaseModels/WorkspaceNotificationRule";
import SecurityCaseService from "../../../Server/Services/SecurityCaseService";
import WorkspaceNotificationLogService from "../../../Server/Services/WorkspaceNotificationLogService";
import WorkspaceNotificationRuleService from "../../../Server/Services/WorkspaceNotificationRuleService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUtil from "../../../Server/Utils/Workspace/Workspace";
import { WorkspaceSendMessageResponse } from "../../../Server/Utils/Workspace/WorkspaceBase";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import ObjectID from "../../../Types/ObjectID";
import SecurityCasePriorityLevel from "../../../Types/SecurityCase/SecurityCasePriorityLevel";
import SecurityCaseStage from "../../../Types/SecurityCase/SecurityCaseStage";
import {
  TEST_PRIORITY_IDS,
  TEST_STATUS_IDS,
  testPriorityId,
  testStatusId,
} from "../../Helpers/SecurityCaseValues";
import SecurityDetectionSource from "../../../Types/SecurityCase/SecurityDetectionSource";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import {
  ConditionType,
  NotificationRuleConditionCheckOn,
} from "../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import WorkspaceMessagePayload from "../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * SECURITY CASES IN SLACK AND MICROSOFT TEAMS.
 *
 * A project's Security Case rules name the channels (and Teams chats) its
 * cases are posted to, and the cases they are for. Matching reads the case's
 * title, description, priority, status, source and labels - the priority
 * and status as the project's own, by id; posting goes to
 * the existing channels of the rules that match the case as it is, and never
 * opens a channel of its own.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const CASE_ID: ObjectID = ObjectID.generate();
const LABEL_ID: ObjectID = ObjectID.generate();

function rule(data: {
  checkOn: NotificationRuleConditionCheckOn;
  conditionType: ConditionType;
  value: string | Array<string>;
  channel: string;
  workspaceType?: WorkspaceType | undefined;
}): WorkspaceNotificationRule {
  const model: WorkspaceNotificationRule = new WorkspaceNotificationRule();
  model.id = ObjectID.generate();
  model.workspaceType = data.workspaceType || WorkspaceType.Slack;
  model.eventType = NotificationRuleEventType.SecurityCase;
  model.notificationRule = {
    _type: "SecurityCaseNotificationRule",
    filterCondition: FilterCondition.All,
    filters: [
      {
        checkOn: data.checkOn,
        conditionType: data.conditionType,
        value: data.value,
      },
    ],
    shouldPostToExistingChannel: true,
    existingChannelNames: data.channel,
  } as never;
  return model;
}

let rules: Array<WorkspaceNotificationRule>;

beforeEach(() => {
  rules = [];

  const securityCase: SecurityCase = new SecurityCase();
  securityCase.id = CASE_ID;
  securityCase.title = "Brute force against admin";
  securityCase.description = "Ten failed sign-ins in a minute.";
  securityCase.securityCasePriorityId = testPriorityId(
    SecurityCasePriorityLevel.Critical,
  );
  securityCase.securityCaseStatusId = testStatusId(SecurityCaseStage.New);
  securityCase.source = SecurityDetectionSource.DetectionRule;
  const label: Label = new Label();
  label._id = LABEL_ID.toString();
  securityCase.labels = [label];

  jest
    .spyOn(SecurityCaseService, "findOneById")
    .mockResolvedValue(securityCase);

  jest
    .spyOn(WorkspaceNotificationRuleService, "findBy")
    .mockImplementation((async (args: {
      query: { workspaceType: WorkspaceType; eventType: string };
    }): Promise<Array<WorkspaceNotificationRule>> => {
      return rules.filter((model: WorkspaceNotificationRule): boolean => {
        return (
          model.workspaceType === args.query.workspaceType &&
          model.eventType === args.query.eventType
        );
      });
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a security case's workspace rules match", () => {
  async function matching(): Promise<Array<string>> {
    return (
      await WorkspaceNotificationRuleService.getMatchingNotificationRules({
        projectId: PROJECT_ID,
        workspaceType: WorkspaceType.Slack,
        notificationRuleEventType: NotificationRuleEventType.SecurityCase,
        notificationFor: { securityCaseId: CASE_ID },
      })
    ).map((model: WorkspaceNotificationRule): string => {
      return (
        model.notificationRule as unknown as { existingChannelNames: string }
      ).existingChannelNames;
    });
  }

  test("on the case's priority, title, description, status, source and labels", async () => {
    rules = [
      rule({
        checkOn: NotificationRuleConditionCheckOn.SecurityCasePriority,
        conditionType: ConditionType.ContainsAny,
        value: [
          TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Critical],
          TEST_PRIORITY_IDS[SecurityCasePriorityLevel.High],
        ],
        channel: "by-priority",
      }),
      rule({
        checkOn: NotificationRuleConditionCheckOn.SecurityCaseTitle,
        conditionType: ConditionType.Contains,
        value: "Brute force",
        channel: "by-title",
      }),
      rule({
        checkOn: NotificationRuleConditionCheckOn.SecurityCaseDescription,
        conditionType: ConditionType.Contains,
        value: "sign-ins",
        channel: "by-description",
      }),
      rule({
        checkOn: NotificationRuleConditionCheckOn.SecurityCaseStatus,
        conditionType: ConditionType.ContainsAny,
        value: [TEST_STATUS_IDS[SecurityCaseStage.New]],
        channel: "by-status",
      }),
      rule({
        checkOn: NotificationRuleConditionCheckOn.SecurityCaseSource,
        conditionType: ConditionType.NotContains,
        value: [SecurityDetectionSource.Manual],
        channel: "by-source",
      }),
      rule({
        checkOn: NotificationRuleConditionCheckOn.SecurityCaseLabels,
        conditionType: ConditionType.ContainsAny,
        value: [LABEL_ID.toString()],
        channel: "by-label",
      }),
      rule({
        checkOn: NotificationRuleConditionCheckOn.SecurityCasePriority,
        conditionType: ConditionType.ContainsAny,
        value: [TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Low]],
        channel: "low-only",
      }),
    ];

    expect(await matching()).toEqual([
      "by-priority",
      "by-title",
      "by-description",
      "by-status",
      "by-source",
      "by-label",
    ]);
  });

  test("a case that no longer exists is refused, as for every other record", async () => {
    jest.spyOn(SecurityCaseService, "findOneById").mockResolvedValue(null);

    await expect(matching()).rejects.toThrow("Security Case ID not found");
  });
});

describe("a security case posted to its channels", () => {
  let payloads: Array<WorkspaceMessagePayload>;
  let logged: number;

  beforeEach(() => {
    payloads = [];
    logged = 0;

    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuths")
      .mockResolvedValue([] as never);

    jest
      .spyOn(WorkspaceUtil, "postMessageToAllWorkspaceChannelsAsBot")
      .mockImplementation((async (data: {
        messagePayloadsByWorkspace: Array<WorkspaceMessagePayload>;
      }): Promise<Array<WorkspaceSendMessageResponse>> => {
        payloads.push(...data.messagePayloadsByWorkspace);
        return [];
      }) as never);

    jest
      .spyOn(WorkspaceNotificationLogService, "create")
      .mockImplementation((async () => {
        logged++;
      }) as never);
  });

  test("goes to the existing channels of the rules it matches, in each workspace, and opens none", async () => {
    rules = [
      rule({
        checkOn: NotificationRuleConditionCheckOn.SecurityCasePriority,
        conditionType: ConditionType.ContainsAny,
        value: [TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Critical]],
        channel: "soc",
      }),
      rule({
        checkOn: NotificationRuleConditionCheckOn.SecurityCasePriority,
        conditionType: ConditionType.ContainsAny,
        value: [TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Low]],
        channel: "noise",
      }),
      rule({
        checkOn: NotificationRuleConditionCheckOn.SecurityCasePriority,
        conditionType: ConditionType.ContainsAny,
        value: [TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Critical]],
        channel: "Security",
        workspaceType: WorkspaceType.MicrosoftTeams,
      }),
    ];

    await WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification({
      projectId: PROJECT_ID,
      notificationFor: { securityCaseId: CASE_ID },
      feedInfoInMarkdown: "🛡️ **New Critical security case**",
      notificationText: "New Critical security case CASE-12",
      workspaceNotification: {
        sendWorkspaceNotification: true,
      },
    });

    expect(
      payloads.map((payload: WorkspaceMessagePayload) => {
        return {
          workspaceType: payload.workspaceType,
          channelNames: payload.channelNames,
          channelIds: payload.channelIds,
          text: payload.text,
        };
      }),
    ).toEqual([
      {
        workspaceType: WorkspaceType.Slack,
        channelNames: ["soc"],
        channelIds: [],
        text: "New Critical security case CASE-12",
      },
      {
        workspaceType: WorkspaceType.MicrosoftTeams,
        channelNames: ["Security"],
        channelIds: [],
        text: "New Critical security case CASE-12",
      },
    ]);
    // Nothing was sent back, so there is nothing to log.
    expect(logged).toBe(0);
  });
});
