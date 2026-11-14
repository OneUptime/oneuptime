import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import { SecurityCaseFeedEventType } from "../../../../Models/DatabaseModels/SecurityCaseFeed";
import SecurityPlaybookActions, {
  PlaybookStepContext,
  PlaybookStepOutcome,
} from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookActions";
import WorkspaceUtil from "../../../../Server/Utils/Workspace/Workspace";
import { WorkspaceSendMessageResponse } from "../../../../Server/Utils/Workspace/WorkspaceBase";
import WorkspaceChannelNotFound from "../../../../Server/Utils/Workspace/WorkspaceChannelNotFound";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { SecurityPlaybookActionType } from "../../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import { SecurityPlaybookStepStatus } from "../../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import WorkspaceMessagePayload from "../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import { SecurityCaseTemplateValues } from "../../../../Utils/SecurityCase/SecurityCaseMarkdown";

jest.mock("../../../../Server/Utils/Logger");

/*
 * A SECURITY PLAYBOOK'S "POST TO SLACK" AND "POST TO MICROSOFT TEAMS" STEPS
 * SAY WHY THEY DID NOT POST (SecurityPlaybookActions.postToChannel).
 *
 * A step that posted nowhere failed with each channel's error as
 * "${channel}: ${error}" - and the channel is an object, so the case's
 * feed read "[object Object]: ...". Microsoft Teams answered a channel it
 * could not find so; Slack answered nothing, and the step said the
 * project was not connected or the channel was not found. Now Slack says
 * a channel it cannot find too (#7115), and the step says each error in
 * the workspace's words - which name the channel when it was not found -
 * or the channel first, then the words, when they do not name it. A
 * project that is not connected says so, as the workspace said it.
 *
 * The workspace is stood in for where the step hands it the message
 * (WorkspaceUtil.postMessageToAllWorkspaceChannelsAsBot); the case's
 * values are stubbed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "71150000-0000-4000-8000-0000000000c1",
);
const CASE_ID: ObjectID = new ObjectID("71150000-0000-4000-8000-0000000000c2");
const RUN_ID: ObjectID = new ObjectID("71150000-0000-4000-8000-0000000000c3");

const VALUES: SecurityCaseTemplateValues = {
  number: "SEC-12",
  title: "SQL injection from 203.0.113.9",
  priority: "High",
  status: "New",
  assignee: "Unassigned",
  url: "https://oneuptime.example/dashboard/p/security-events/cases/12",
  entities: "203.0.113.9",
  detections: "3",
};

function context(
  action: SecurityPlaybookActionType,
  config: JSONObject,
): PlaybookStepContext {
  const securityCase: SecurityCase = new SecurityCase();
  securityCase._id = CASE_ID.toString();
  securityCase.projectId = PROJECT_ID;
  securityCase.caseNumberWithPrefix = "SEC-12";
  securityCase.title = "SQL injection from 203.0.113.9";

  return {
    projectId: PROJECT_ID,
    runId: RUN_ID,
    playbookName: "Contain web attacks",
    stepNumber: 3,
    securityCase: securityCase,
    step: {
      id: "s3",
      action,
      config,
      requiresApproval: false,
      continueOnFailure: false,
      onlyIfThreatIntelMatched: false,
    },
  };
}

// What the workspace answers the step's message.
let answer: Array<WorkspaceSendMessageResponse> = [];
let post: SpyInstance<
  typeof WorkspaceUtil.postMessageToAllWorkspaceChannelsAsBot
>;

function postedPayloads(): Array<WorkspaceMessagePayload> {
  return post.mock.calls.flatMap(
    (call: Array<unknown>): Array<WorkspaceMessagePayload> => {
      return (
        call[0] as {
          messagePayloadsByWorkspace: Array<WorkspaceMessagePayload>;
        }
      ).messagePayloadsByWorkspace;
    },
  );
}

async function postToSlack(channelName: string): Promise<PlaybookStepOutcome> {
  return SecurityPlaybookActions.execute(
    context(SecurityPlaybookActionType.PostToSlack, {
      channelName: channelName,
    }),
  );
}

async function postToTeams(channelName: string): Promise<PlaybookStepOutcome> {
  return SecurityPlaybookActions.execute(
    context(SecurityPlaybookActionType.PostToMicrosoftTeams, {
      channelName: channelName,
      microsoftTeamsTeamId: "team-security",
    }),
  );
}

beforeEach(() => {
  answer = [];

  jest
    .spyOn(SecurityPlaybookActions, "getTemplateValues")
    .mockResolvedValue(VALUES as never);

  post = jest
    .spyOn(WorkspaceUtil, "postMessageToAllWorkspaceChannelsAsBot")
    .mockImplementation((async (): Promise<
      Array<WorkspaceSendMessageResponse>
    > => {
      return answer;
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Post to Slack", () => {
  test("a channel Slack cannot find: fails saying so, in the words the rules' logs use - never [object Object]", async () => {
    answer = [
      {
        workspaceType: WorkspaceType.Slack,
        threads: [],
        errors: [
          {
            channel: {
              id: "",
              name: "secops",
              workspaceType: WorkspaceType.Slack,
            },
            error: WorkspaceChannelNotFound.getReason({
              workspaceType: WorkspaceType.Slack,
              channelName: "secops",
            }),
          },
        ],
      },
    ];

    const outcome: PlaybookStepOutcome = await postToSlack("secops");

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Failed);
    expect(outcome.error).toBe(
      "The Slack channel #secops was not found. If it is a private channel, invite OneUptime's bot to it in Slack.",
    );
    expect(outcome.error).not.toContain("[object Object]");

    // The channel it was told, as Slack is asked for it.
    expect(postedPayloads()).toHaveLength(1);
    expect(postedPayloads()[0]!.workspaceType).toBe(WorkspaceType.Slack);
    expect(postedPayloads()[0]!.channelNames).toEqual(["secops"]);
  });

  test("a refusal that does not name the channel: the channel, then Slack's words", async () => {
    answer = [
      {
        workspaceType: WorkspaceType.Slack,
        threads: [],
        errors: [
          {
            channel: {
              id: "C0SEC",
              name: "secops",
              workspaceType: WorkspaceType.Slack,
            },
            error: "Error from Slack is_archived",
          },
        ],
      },
    ];

    const outcome: PlaybookStepOutcome = await postToSlack("#secops");

    expect(outcome.error).toBe("#secops: Error from Slack is_archived");
  });

  test("a project not connected to Slack: says so, as the workspace said it", async () => {
    const notConnected: string =
      "This project is not connected to Slack. Please ask a project admin to connect Slack in Project Settings > Workspace > Slack.";

    answer = [
      {
        workspaceType: WorkspaceType.Slack,
        threads: [],
        notSentReason: notConnected,
      },
    ];

    const outcome: PlaybookStepOutcome = await postToSlack("secops");

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Failed);
    expect(outcome.error).toBe(notConnected);
  });

  test("nothing said at all: the step's own words, as before", async () => {
    answer = [{ workspaceType: WorkspaceType.Slack, threads: [] }];

    const outcome: PlaybookStepOutcome = await postToSlack("secops");

    expect(outcome.error).toBe(
      "Nothing was posted: the project is not connected to Slack, or the channel #secops was not found.",
    );
  });

  test("posted: succeeds, naming the channel, as before", async () => {
    answer = [
      {
        workspaceType: WorkspaceType.Slack,
        threads: [
          {
            channel: {
              id: "C0SEC",
              name: "secops",
              workspaceType: WorkspaceType.Slack,
            },
            threadId: "1762851600.000100",
          },
        ],
        errors: [],
      },
    ];

    const outcome: PlaybookStepOutcome = await postToSlack("secops");

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(outcome.feedEventType).toBe(SecurityCaseFeedEventType.Notification);
    expect(outcome.summary.toString()).toBe(
      "Posted the case to Slack channel **#secops**.",
    );
  });
});

describe("Post to Microsoft Teams", () => {
  test("a channel the team does not have: fails saying so - never [object Object]", async () => {
    answer = [
      {
        workspaceType: WorkspaceType.MicrosoftTeams,
        threads: [],
        errors: [
          {
            channel: {
              id: "",
              name: "Security",
              workspaceType: WorkspaceType.MicrosoftTeams,
              teamId: "team-security",
            },
            error: WorkspaceChannelNotFound.getReason({
              workspaceType: WorkspaceType.MicrosoftTeams,
              channelName: "Security",
            }),
          },
        ],
      },
    ];

    const outcome: PlaybookStepOutcome = await postToTeams("Security");

    expect(outcome.error).toBe(
      'Channel "Security" was not found in this Microsoft Teams team. It may have been renamed or deleted.',
    );
    expect(postedPayloads()[0]!.teamId).toBe("team-security");
  });

  test("two errors: each said, one after the other", async () => {
    answer = [
      {
        workspaceType: WorkspaceType.MicrosoftTeams,
        threads: [],
        errors: [
          {
            channel: {
              id: "19:a@thread.tacv2",
              name: "Security",
              workspaceType: WorkspaceType.MicrosoftTeams,
            },
            error: "Forbidden",
          },
          {
            channel: {
              id: "19:a@thread.tacv2",
              name: "Security",
              workspaceType: WorkspaceType.MicrosoftTeams,
            },
            error: "",
          },
        ],
      },
    ];

    const outcome: PlaybookStepOutcome = await postToTeams("Security");

    expect(outcome.error).toBe(
      "#Security: Forbidden #Security: The message was not posted.",
    );
  });
});

describe("SecurityPlaybookActions.describeChannelError", () => {
  test("words that name the channel are said as they are", () => {
    expect(
      SecurityPlaybookActions.describeChannelError({
        channelName: "#secops",
        error:
          "The Slack channel #secops was not found. If it is a private channel, invite OneUptime's bot to it in Slack.",
      }),
    ).toBe(
      "The Slack channel #secops was not found. If it is a private channel, invite OneUptime's bot to it in Slack.",
    );
  });

  test("words that do not: the channel, with one #, then the words", () => {
    for (const channelName of ["secops", "#secops", "##secops", " secops "]) {
      expect(
        SecurityPlaybookActions.describeChannelError({
          channelName: channelName,
          error: "ratelimited",
        }),
      ).toBe("#secops: ratelimited");
    }
  });

  test("no channel: the words alone; no words: that the message was not posted", () => {
    expect(
      SecurityPlaybookActions.describeChannelError({
        channelName: "",
        error: "ratelimited",
      }),
    ).toBe("ratelimited");
    expect(
      SecurityPlaybookActions.describeChannelError({
        channelName: "secops",
        error: "  ",
      }),
    ).toBe("#secops: The message was not posted.");
  });
});
