import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import DatabaseConfig from "../../../../Server/DatabaseConfig";
import { MessageBlocksByWorkspaceType } from "../../../../Server/Services/WorkspaceNotificationRuleService";
import { getMicrosoftTeamsActionType } from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/ActionTypes";
import MicrosoftTeamsAlertActions from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Alert";
import MicrosoftTeamsAlertEpisodeActions from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/AlertEpisode";
import MicrosoftTeamsIncidentActions from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Incident";
import MicrosoftTeamsIncidentEpisodeActions from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/IncidentEpisode";
import MicrosoftTeamsAlertMessages from "../../../../Server/Utils/Workspace/MicrosoftTeams/Messages/Alert";
import MicrosoftTeamsIncidentMessages from "../../../../Server/Utils/Workspace/MicrosoftTeams/Messages/Incident";
import MicrosoftTeamsConnectPrompt from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsConnectPrompt";
import SlackActionType from "../../../../Server/Utils/Workspace/Slack/Actions/ActionTypes";
import SlackConnectPrompt from "../../../../Server/Utils/Workspace/Slack/Actions/ConnectPrompt";
import WorkspaceActionAuthorization from "../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import {
  WorkspaceConnectRequestAgainKind,
  WorkspacePressDescription,
} from "../../../../Server/Utils/Workspace/WorkspaceConnectRequest";
import AlertWorkspaceMessages from "../../../../Server/Utils/Workspace/WorkspaceMessages/Alert";
import AlertEpisodeWorkspaceMessages from "../../../../Server/Utils/Workspace/WorkspaceMessages/AlertEpisode";
import IncidentWorkspaceMessages from "../../../../Server/Utils/Workspace/WorkspaceMessages/Incident";
import IncidentEpisodeWorkspaceMessages from "../../../../Server/Utils/Workspace/WorkspaceMessages/IncidentEpisode";
import ScheduledMaintenanceWorkspaceMessages from "../../../../Server/Utils/Workspace/WorkspaceMessages/ScheduledMaintenance";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import Hostname from "../../../../Types/API/Hostname";
import Protocol from "../../../../Types/API/Protocol";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  WorkspaceMessageBlock,
  WorkspaceMessagePayloadButton,
  WorkspacePayloadButtons,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import fs from "fs";
import path from "path";

/*
 * EXECUTE ON-CALL POLICY, IN THE DASHBOARD'S WORDS, ON EVERY CHAT MESSAGE.
 *
 * The Actions menu of an incident's, an alert's or an episode's feed in the
 * Dashboard says "Execute On-Call Policy", and so does the form it opens,
 * Microsoft Teams' card, and the On Call docs. The button on every Slack and
 * Microsoft Teams message about those records said "📞 Execute On Call", the
 * Slack form it opened was titled "Execute On Call Policy", and a person
 * whose account was not connected was told to press "Execute On Call"
 * again (task on-call-product-texts, from the On Call docs audit, #4853).
 *
 * These hold every one of them to the Dashboard's words, read from the feeds'
 * source:
 *
 *   - the button on each message reads "📞 Execute On-Call Policy" - the
 *     action as the Dashboard names it, the 📞 kept - with the action id it
 *     always had, so the buttons on messages already posted keep working;
 *   - it fits Slack's 75 characters for a button's text;
 *   - the Connect prompt names every button that opens a form as the message
 *     draws it, without its emoji: "press Execute On-Call Policy again";
 *   - Microsoft Teams' card is titled the same, and asks for the On-Call
 *     Policy as the Dashboard's form does.
 *
 * The form Slack opens is held where its pickers are tested
 * (SlackNewIncidentModalScope).
 */

// The most a button's text may hold, in Slack's Block Kit.
const SLACK_BUTTON_TEXT_MAX_LENGTH: number = 75;

const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "../../../../../App/FeatureSet/Dashboard/src",
);

// A menu item's text, a modal's title.
const MENU_ITEM_TEXT: RegExp = /text="([^"]+)"/;
const MODAL_TITLE: RegExp = /title=\{"([^"]+)"\}/;
// The emoji a chat button's title starts with, and the space after it.
const LEADING_EMOJI: RegExp = /^\p{Extended_Pictographic}️?\s+/u;

interface DashboardFeed {
  record: string;
  file: string;
  // The Actions menu item's key.
  key: string;
}

const FEEDS: ReadonlyArray<DashboardFeed> = [
  {
    record: "incident",
    file: "Components/Incident/IncidentFeed.tsx",
    key: "incident-action-execute-policy",
  },
  {
    record: "alert",
    file: "Components/Alert/AlertFeed.tsx",
    key: "alert-action-execute-policy",
  },
  {
    record: "incident episode",
    file: "Components/IncidentEpisode/IncidentEpisodeFeed.tsx",
    key: "incident-episode-action-execute-policy",
  },
  {
    record: "alert episode",
    file: "Components/AlertEpisode/AlertEpisodeFeed.tsx",
    key: "alert-episode-action-execute-policy",
  },
];

// What a feed's Actions menu calls the action, and what its form is titled.
function dashboardWords(feed: DashboardFeed): {
  action: string;
  form: string;
} {
  const source: string = fs.readFileSync(
    path.join(DASHBOARD_SRC, feed.file),
    "utf8",
  );
  const item: number = source.indexOf(`key="${feed.key}"`);
  const modal: number = source.indexOf('name={"execute-on-call-policy"}');

  expect({ feed: feed.file, item: item >= 0, modal: modal >= 0 }).toEqual({
    feed: feed.file,
    item: true,
    modal: true,
  });

  return {
    action: MENU_ITEM_TEXT.exec(source.slice(item))?.[1] || "",
    form: MODAL_TITLE.exec(source.slice(modal))?.[1] || "",
  };
}

// The Dashboard's name for the action: the same on every record's feed.
const DASHBOARD_ACTION: string = dashboardWords(FEEDS[0]!).action;

// A chat button's title as a sentence names it: without its emoji.
function withoutEmoji(title: string): string {
  return title.replace(LEADING_EMOJI, "");
}

function buttonsOf(
  blocks: Array<WorkspaceMessageBlock>,
): Array<WorkspaceMessagePayloadButton> {
  return blocks
    .filter((block: WorkspaceMessageBlock): boolean => {
      return block._type === "WorkspacePayloadButtons";
    })
    .flatMap(
      (block: WorkspaceMessageBlock): Array<WorkspaceMessagePayloadButton> => {
        return (block as WorkspacePayloadButtons).buttons;
      },
    );
}

const projectId: ObjectID = ObjectID.generate();
const recordId: ObjectID = ObjectID.generate();

interface RecordMessage {
  record: string;
  // What OneUptime sends to each chat workspace when the record is created.
  build: () => Promise<Array<MessageBlocksByWorkspaceType>>;
  // The press that opens the form, on Slack and on Microsoft Teams.
  executeActionId: string;
  // The form's submission.
  submitActionId: string;
}

const RECORD_MESSAGES: ReadonlyArray<RecordMessage> = [
  {
    record: "incident",
    build: (): Promise<Array<MessageBlocksByWorkspaceType>> => {
      return IncidentWorkspaceMessages.getIncidentCreateMessageBlocks({
        incidentId: recordId,
        projectId,
      });
    },
    executeActionId: SlackActionType.ViewExecuteIncidentOnCallPolicy,
    submitActionId: SlackActionType.SubmitExecuteIncidentOnCallPolicy,
  },
  {
    record: "alert",
    build: (): Promise<Array<MessageBlocksByWorkspaceType>> => {
      return AlertWorkspaceMessages.getAlertCreateMessageBlocks({
        alertId: recordId,
        projectId,
      });
    },
    executeActionId: SlackActionType.ViewExecuteAlertOnCallPolicy,
    submitActionId: SlackActionType.SubmitExecuteAlertOnCallPolicy,
  },
  {
    record: "incident episode",
    build: (): Promise<Array<MessageBlocksByWorkspaceType>> => {
      return IncidentEpisodeWorkspaceMessages.getIncidentEpisodeCreateMessageBlocks(
        {
          incidentEpisodeId: recordId,
          projectId,
        },
      );
    },
    executeActionId: SlackActionType.ViewExecuteIncidentEpisodeOnCallPolicy,
    submitActionId: SlackActionType.SubmitExecuteIncidentEpisodeOnCallPolicy,
  },
  {
    record: "alert episode",
    build: (): Promise<Array<MessageBlocksByWorkspaceType>> => {
      return AlertEpisodeWorkspaceMessages.getAlertEpisodeCreateMessageBlocks({
        alertEpisodeId: recordId,
        projectId,
      });
    },
    executeActionId: SlackActionType.ViewExecuteAlertEpisodeOnCallPolicy,
    submitActionId: SlackActionType.SubmitExecuteAlertEpisodeOnCallPolicy,
  },
];

// What the Connect prompt answers a press with, on a workspace.
function describePress(
  workspaceType: WorkspaceType,
  actionId: string,
): WorkspacePressDescription {
  if (workspaceType === WorkspaceType.Slack) {
    return SlackConnectPrompt.describe({
      actionType: actionId as SlackActionType,
      actionValue: recordId.toString(),
    });
  }

  // Microsoft Teams reads a card's Slack ids as its own first.
  return MicrosoftTeamsConnectPrompt.describe({
    actionType: getMicrosoftTeamsActionType(actionId),
    actionValue: recordId.toString(),
  });
}

beforeEach(() => {
  jest
    .spyOn(DatabaseConfig, "getHost")
    .mockResolvedValue(new Hostname("oneuptime.test"));
  jest
    .spyOn(DatabaseConfig, "getHttpProtocol")
    .mockResolvedValue(Protocol.HTTPS);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the Dashboard names the action, the same on every record", () => {
  test.each(FEEDS)(
    "the $record feed's Actions menu says it, and its form is titled the same",
    (feed: DashboardFeed) => {
      expect(dashboardWords(feed)).toEqual({
        action: "Execute On-Call Policy",
        form: "Execute On-Call Policy",
      });
    },
  );
});

describe("the button on every message about a record is named as the Dashboard names the action", () => {
  test.each(RECORD_MESSAGES)(
    "$record: Slack's and Microsoft Teams' buttons read 📞 Execute On-Call Policy, with the action id they always had",
    async (message: RecordMessage) => {
      const sent: Array<MessageBlocksByWorkspaceType> = await message.build();

      expect(
        sent.map((byType: MessageBlocksByWorkspaceType): WorkspaceType => {
          return byType.workspaceType;
        }),
      ).toEqual([WorkspaceType.Slack, WorkspaceType.MicrosoftTeams]);

      for (const byType of sent) {
        const execute: Array<WorkspaceMessagePayloadButton> = buttonsOf(
          byType.messageBlocks,
        ).filter((button: WorkspaceMessagePayloadButton): boolean => {
          return button.actionId === message.executeActionId;
        });

        expect({
          workspace: byType.workspaceType,
          titles: execute.map((button: WorkspaceMessagePayloadButton) => {
            return button.title;
          }),
        }).toEqual({
          workspace: byType.workspaceType,
          titles: [`📞 ${DASHBOARD_ACTION}`],
        });
        expect(withoutEmoji(execute[0]!.title)).toBe(DASHBOARD_ACTION);
        expect(execute[0]!.value).toBe(recordId.toString());
        expect(execute[0]!.url).toBeUndefined();
      }
    },
  );

  test("the older Microsoft Teams message builders name it the same", async () => {
    const incident: Array<WorkspaceMessagePayloadButton> = buttonsOf(
      await MicrosoftTeamsIncidentMessages.getIncidentCreateMessageBlocks({
        incidentId: recordId,
        projectId,
      }),
    );
    const alert: Array<WorkspaceMessagePayloadButton> = buttonsOf(
      await MicrosoftTeamsAlertMessages.getAlertCreateMessageBlocks({
        alertId: recordId,
        projectId,
      }),
    );

    for (const buttons of [incident, alert]) {
      const titles: Array<string> = buttons.map(
        (button: WorkspaceMessagePayloadButton): string => {
          return button.title;
        },
      );

      expect(titles).toContain(`📞 ${DASHBOARD_ACTION}`);
      expect(
        titles.filter((title: string): boolean => {
          return title.includes("Execute On Call");
        }),
      ).toEqual([]);
    }
  });

  test.each(RECORD_MESSAGES)(
    "$record: every button fits the text Slack allows a button",
    async (message: RecordMessage) => {
      for (const byType of await message.build()) {
        for (const button of buttonsOf(byType.messageBlocks)) {
          expect({
            title: button.title,
            fits: button.title.length <= SLACK_BUTTON_TEXT_MAX_LENGTH,
          }).toEqual({ title: button.title, fits: true });
        }
      }
    },
  );

  test("a scheduled maintenance event has no on-call policy to execute", async () => {
    for (const byType of await ScheduledMaintenanceWorkspaceMessages.getScheduledMaintenanceCreateMessageBlocks(
      { scheduledMaintenanceId: recordId, projectId },
    )) {
      expect(
        buttonsOf(byType.messageBlocks)
          .map((button: WorkspaceMessagePayloadButton): string => {
            return button.title;
          })
          .filter((title: string): boolean => {
            return title.includes("Execute");
          }),
      ).toEqual([]);
    }
  });
});

describe("the Connect prompt names the button as the message draws it", () => {
  test.each(RECORD_MESSAGES)(
    "$record: Execute On-Call Policy, pressed or submitted, is to be pressed again by the Dashboard's name",
    (message: RecordMessage) => {
      for (const workspaceType of [
        WorkspaceType.Slack,
        WorkspaceType.MicrosoftTeams,
      ]) {
        for (const actionId of [
          message.executeActionId,
          message.submitActionId,
        ]) {
          expect({
            workspaceType,
            actionId,
            again: describePress(workspaceType, actionId).again,
          }).toEqual({
            workspaceType,
            actionId,
            again: {
              kind: WorkspaceConnectRequestAgainKind.Button,
              label: DASHBOARD_ACTION,
            },
          });
        }
      }
    },
  );

  test.each([
    ...RECORD_MESSAGES,
    {
      record: "scheduled maintenance event",
      build: (): Promise<Array<MessageBlocksByWorkspaceType>> => {
        return ScheduledMaintenanceWorkspaceMessages.getScheduledMaintenanceCreateMessageBlocks(
          { scheduledMaintenanceId: recordId, projectId },
        );
      },
    },
  ])(
    "$record: every button that opens a form is to be pressed again by its own title",
    async (message: {
      record: string;
      build: () => Promise<Array<MessageBlocksByWorkspaceType>>;
    }) => {
      let formButtons: number = 0;

      for (const byType of await message.build()) {
        for (const button of buttonsOf(byType.messageBlocks)) {
          const again: WorkspacePressDescription["again"] = describePress(
            byType.workspaceType,
            button.actionId,
          ).again;

          if (
            !again ||
            again.kind !== WorkspaceConnectRequestAgainKind.Button
          ) {
            continue;
          }

          formButtons++;
          expect({
            workspace: byType.workspaceType,
            button: button.title,
            pressAgain: again.label,
          }).toEqual({
            workspace: byType.workspaceType,
            button: button.title,
            pressAgain: withoutEmoji(button.title),
          });
        }
      }

      // Add Note and Change State on both workspaces, and Execute On-Call Policy on a record.
      expect(formButtons).toBeGreaterThanOrEqual(4);
    },
  );
});

describe("Microsoft Teams' card is titled the same, and asks for the On-Call Policy", () => {
  type CardBuilder = (
    recordId: string,
    projectId: ObjectID,
    props: DatabaseCommonInteractionProps,
  ) => Promise<JSONObject | null>;

  // The card each record's button opens, built by its own actions.
  const CARDS: ReadonlyArray<{
    record: string;
    actions: object;
    builder: string;
  }> = [
    {
      record: "incident",
      actions: MicrosoftTeamsIncidentActions,
      builder: "buildExecuteOnCallPolicyCard",
    },
    {
      record: "alert",
      actions: MicrosoftTeamsAlertActions,
      builder: "buildExecuteAlertOnCallPolicyCard",
    },
    {
      record: "incident episode",
      actions: MicrosoftTeamsIncidentEpisodeActions,
      builder: "buildExecuteIncidentEpisodeOnCallPolicyCard",
    },
    {
      record: "alert episode",
      actions: MicrosoftTeamsAlertEpisodeActions,
      builder: "buildExecuteAlertEpisodeOnCallPolicyCard",
    },
  ];

  test.each(CARDS)(
    "$record: the card is titled Execute On-Call Policy",
    async (card: { record: string; actions: object; builder: string }) => {
      const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
      policy._id = ObjectID.generate().toString();
      policy.name = "Primary on-call";
      jest
        .spyOn(WorkspaceActionAuthorization, "findReadable")
        .mockResolvedValue([policy] as never);

      const builder: unknown = (card.actions as Record<string, unknown>)[
        card.builder
      ];
      expect(typeof builder).toBe("function");

      const built: JSONObject | null = await (builder as CardBuilder).call(
        card.actions,
        recordId.toString(),
        projectId,
        {},
      );
      const body: Array<JSONObject> = (built?.["body"] ||
        []) as Array<JSONObject>;

      expect(body[0]).toMatchObject({
        type: "TextBlock",
        text: DASHBOARD_ACTION,
      });
      expect(body[1]).toMatchObject({
        type: "Input.ChoiceSet",
        id: "onCallPolicy",
        label: "On-Call Policy",
      });
    },
  );
});
