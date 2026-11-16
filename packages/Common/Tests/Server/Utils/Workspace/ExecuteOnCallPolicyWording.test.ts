import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { EXECUTE_ON_CALL_POLICY_WORDS } from "../../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ExecutePolicy/ExecuteOnCallPolicyWords";
import DatabaseConfig from "../../../../Server/DatabaseConfig";
import { MessageBlocksByWorkspaceType } from "../../../../Server/Services/WorkspaceNotificationRuleService";
import Response from "../../../../Server/Utils/Response";
import MattermostUtil from "../../../../Server/Utils/Workspace/Mattermost/Mattermost";
import MattermostActions, {
  MATTERMOST_ON_CALL_POLICY_FIELD,
} from "../../../../Server/Utils/Workspace/Mattermost/MattermostActions";
import {
  MattermostPress,
  MattermostRecordType,
} from "../../../../Server/Utils/Workspace/Mattermost/MattermostActionTypes";
import { getMicrosoftTeamsActionType } from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/ActionTypes";
import MicrosoftTeamsAlertActions from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Alert";
import MicrosoftTeamsAlertEpisodeActions from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/AlertEpisode";
import MicrosoftTeamsIncidentActions from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Incident";
import MicrosoftTeamsIncidentEpisodeActions from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/IncidentEpisode";
import MicrosoftTeamsAlertMessages from "../../../../Server/Utils/Workspace/MicrosoftTeams/Messages/Alert";
import MicrosoftTeamsIncidentMessages from "../../../../Server/Utils/Workspace/MicrosoftTeams/Messages/Incident";
import MicrosoftTeamsCardChoices from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsCardChoices";
import MicrosoftTeamsConnectPrompt from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsConnectPrompt";
import SlackActionType from "../../../../Server/Utils/Workspace/Slack/Actions/ActionTypes";
import SlackAlertActions from "../../../../Server/Utils/Workspace/Slack/Actions/Alert";
import SlackAlertEpisodeActions from "../../../../Server/Utils/Workspace/Slack/Actions/AlertEpisode";
import SlackActionAnswer from "../../../../Server/Utils/Workspace/Slack/Actions/Answer";
import SlackActionAuthorization from "../../../../Server/Utils/Workspace/Slack/Actions/Authorization";
import SlackConnectPrompt from "../../../../Server/Utils/Workspace/Slack/Actions/ConnectPrompt";
import SlackIncidentActions from "../../../../Server/Utils/Workspace/Slack/Actions/Incident";
import SlackIncidentEpisodeActions from "../../../../Server/Utils/Workspace/Slack/Actions/IncidentEpisode";
import SlackUtil from "../../../../Server/Utils/Workspace/Slack/Slack";
import WorkspaceActionAuthorization from "../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import {
  getExecuteOnCallPolicyFormDescription,
  WORKSPACE_EXECUTE_ON_CALL_POLICY_DESCRIPTIONS,
} from "../../../../Server/Utils/Workspace/WorkspaceExecuteOnCallPolicyForm";
import { OnCallPageRecordType } from "../../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
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
  WorkspaceDropdownBlock,
  WorkspaceMessageBlock,
  WorkspaceMessagePayloadButton,
  WorkspaceModalBlock,
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
 *
 * An incident's message no longer carries the button: its menu (⋯) has
 * Page Someone, which pages the incident's on-call policies and people,
 * teams and schedules too (WorkspaceIncidentActions). A message posted
 * before keeps its button, which still opens the Dashboard's form, and is
 * still named as the Dashboard names it when it asks somebody to connect.
 * Every item of that menu that opens a form is held to the same rule as a
 * button: pressed again by its own title.
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

// A message's buttons, and the items of its menu (⋯): each is pressed alike.
function buttonsOf(
  blocks: Array<WorkspaceMessageBlock>,
): Array<WorkspaceMessagePayloadButton> {
  return blocks
    .filter((block: WorkspaceMessageBlock): boolean => {
      return block._type === "WorkspacePayloadButtons";
    })
    .flatMap(
      (block: WorkspaceMessageBlock): Array<WorkspaceMessagePayloadButton> => {
        return [
          ...(block as WorkspacePayloadButtons).buttons,
          ...((block as WorkspacePayloadButtons).menuButtons || []),
        ];
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
  /*
   * Whether a new message carries the button. An incident's pages from its
   * menu's Page Someone instead; its older messages still carry it.
   */
  carriesButton: boolean;
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
    carriesButton: false,
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
    carriesButton: true,
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
    carriesButton: true,
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
    carriesButton: true,
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
  test.each(
    RECORD_MESSAGES.filter((message: RecordMessage): boolean => {
      return message.carriesButton;
    }),
  )(
    "$record: Slack's, Microsoft Teams' and Mattermost's buttons read 📞 Execute On-Call Policy, with the action id they always had",
    async (message: RecordMessage) => {
      const sent: Array<MessageBlocksByWorkspaceType> = await message.build();

      expect(
        sent.map((byType: MessageBlocksByWorkspaceType): WorkspaceType => {
          return byType.workspaceType;
        }),
      ).toEqual([
        WorkspaceType.Slack,
        WorkspaceType.MicrosoftTeams,
        WorkspaceType.Mattermost,
      ]);

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

  test("an incident's message pages from its menu's Page Someone, not with an Execute On-Call Policy button", async () => {
    for (const byType of await IncidentWorkspaceMessages.getIncidentCreateMessageBlocks(
      { incidentId: recordId, projectId },
    )) {
      const pressed: Array<string> = buttonsOf(byType.messageBlocks).map(
        (button: WorkspaceMessagePayloadButton): string => {
          return button.actionId;
        },
      );

      expect(pressed).not.toContain(
        SlackActionType.ViewExecuteIncidentOnCallPolicy,
      );
      expect(pressed).toContain(SlackActionType.ViewPageAboutIncident);
    }
  });

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

      /*
       * Add Note and Change State on both workspaces, and Execute On-Call
       * Policy (an incident: the four other forms of its menu) on a record.
       */
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

  // The card a record's button opens, built by the record's own actions.
  interface TeamsCard {
    record: string;
    actions: unknown;
    // The private method that builds it.
    builder: string;
  }

  const CARDS: ReadonlyArray<TeamsCard> = [
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
    async (card: TeamsCard) => {
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

/*
 * HOW LONG THE POLICY PAGES, SAID UNDER EVERY CHAT'S POLICY DROPDOWN (#9006).
 *
 * A policy started by hand pages its people, level by level, until one of
 * them answers or the record is resolved: somebody else acknowledging the
 * record does not stop it. The Dashboard's form says so (#7839); Slack's
 * modal, Microsoft Teams' card and Mattermost's dialog had a label and a
 * placeholder only. Each now says it under the dropdown, in the sentence
 * the Dashboard shows on a record nobody acknowledged yet - one sentence
 * that holds whatever the record's state - from one table
 * (WorkspaceExecuteOnCallPolicyForm), so the three chats say the same.
 */
describe("the chats' Execute On-Call Policy forms say how long the policy pages (#9006)", () => {
  interface FormRecord {
    record: string;
    recordType: OnCallPageRecordType;
    slack: {
      viewExecuteOnCallPolicy: (data: unknown) => Promise<void>;
    };
    teams: unknown;
    teamsBuilder: string;
    mattermost: MattermostRecordType;
  }

  const FORM_RECORDS: ReadonlyArray<FormRecord> = [
    {
      record: "incident",
      recordType: OnCallPageRecordType.Incident,
      slack: SlackIncidentActions as never,
      teams: MicrosoftTeamsIncidentActions,
      teamsBuilder: "buildExecuteOnCallPolicyCard",
      mattermost: MattermostRecordType.Incident,
    },
    {
      record: "alert",
      recordType: OnCallPageRecordType.Alert,
      slack: SlackAlertActions as never,
      teams: MicrosoftTeamsAlertActions,
      teamsBuilder: "buildExecuteAlertOnCallPolicyCard",
      mattermost: MattermostRecordType.Alert,
    },
    {
      record: "incident episode",
      recordType: OnCallPageRecordType.IncidentEpisode,
      slack: SlackIncidentEpisodeActions as never,
      teams: MicrosoftTeamsIncidentEpisodeActions,
      teamsBuilder: "buildExecuteIncidentEpisodeOnCallPolicyCard",
      mattermost: MattermostRecordType.IncidentEpisode,
    },
    {
      record: "alert episode",
      recordType: OnCallPageRecordType.AlertEpisode,
      slack: SlackAlertEpisodeActions as never,
      teams: MicrosoftTeamsAlertEpisodeActions,
      teamsBuilder: "buildExecuteAlertEpisodeOnCallPolicyCard",
      mattermost: MattermostRecordType.AlertEpisode,
    },
  ];

  // The policies the member may read: what each form offers.
  function offerOnePolicy(): void {
    const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
    policy._id = ObjectID.generate().toString();
    policy.name = "Primary on-call";

    jest
      .spyOn(WorkspaceActionAuthorization, "findReadable")
      .mockResolvedValue([policy] as never);
  }

  test("the table holds every record's sentence, and only those", () => {
    expect(
      Object.keys(WORKSPACE_EXECUTE_ON_CALL_POLICY_DESCRIPTIONS).sort(),
    ).toEqual(Object.values(OnCallPageRecordType).sort());
  });

  test.each(FORM_RECORDS)(
    "$record: the chats say the Dashboard's own sentence for a record nobody acknowledged",
    (form: FormRecord) => {
      const sentence: string = getExecuteOnCallPolicyFormDescription(
        form.recordType,
      );

      expect(sentence).toBe(EXECUTE_ON_CALL_POLICY_WORDS[form.recordType].open);
      // It names the record, and when the paging ends.
      expect(sentence).toContain(`about this ${form.record},`);
      expect(sentence).toContain("until one of them answers or the ");
      expect(sentence).toMatch(/is resolved\.$/);
    },
  );

  test.each(FORM_RECORDS)(
    "$record: the sentence holds on an acknowledged record too - it never says the record is open",
    (form: FormRecord) => {
      const sentence: string = getExecuteOnCallPolicyFormDescription(
        form.recordType,
      );

      expect(sentence).not.toMatch(/acknowledged|nobody|not yet/i);
      // The Dashboard's acknowledged sentence says the same about paging.
      expect(
        EXECUTE_ON_CALL_POLICY_WORDS[form.recordType].acknowledged,
      ).toContain(sentence.slice(sentence.indexOf("level by level")));
    },
  );

  test("every sentence fits Mattermost's help text whole, and Slack's hint", () => {
    for (const sentence of Object.values(
      WORKSPACE_EXECUTE_ON_CALL_POLICY_DESCRIPTIONS,
    )) {
      expect({
        sentence,
        fits: sentence.length <= MattermostUtil.DIALOG_HELP_TEXT_MAX_LENGTH,
      }).toEqual({ sentence, fits: true });
      expect(sentence.length).toBeLessThanOrEqual(2000);
    }
  });

  test.each(FORM_RECORDS)(
    "$record: Slack's modal says it as the policy dropdown's hint",
    async (form: FormRecord) => {
      offerOnePolicy();
      // Slack is answered at once, before the form is read.
      for (const answer of [
        "sendJsonObjectResponse",
        "sendTextResponse",
      ] as const) {
        jest.spyOn(Response, answer).mockImplementation((() => {
          return undefined;
        }) as never);
      }
      jest
        .spyOn(SlackActionAuthorization, "authorize")
        .mockResolvedValue({} as never);

      const shown: Array<WorkspaceModalBlock> = [];

      jest
        .spyOn(SlackActionAnswer, "showModal")
        .mockImplementation((async (data: {
          modalBlock: WorkspaceModalBlock;
        }) => {
          shown.push(data.modalBlock);
        }) as never);

      await form.slack.viewExecuteOnCallPolicy({
        slackRequest: {
          isAuthorized: true,
          projectId: projectId,
          userId: ObjectID.generate(),
        },
        action: { actionValue: recordId.toString() },
        req: {},
        res: {},
      });

      expect(shown).toHaveLength(1);

      const dropdown: WorkspaceDropdownBlock = shown[0]!
        .blocks[0] as WorkspaceDropdownBlock;

      expect(dropdown).toMatchObject({
        _type: "WorkspaceDropdownBlock",
        label: "On-Call Policy",
        description: getExecuteOnCallPolicyFormDescription(form.recordType),
      });

      // Drawn as the select's hint, in plain text.
      expect(
        SlackUtil.getDropdownBlock({ payloadDropdownBlock: dropdown })["hint"],
      ).toEqual({
        type: "plain_text",
        text: getExecuteOnCallPolicyFormDescription(form.recordType),
      });
    },
  );

  test.each(FORM_RECORDS)(
    "$record: Microsoft Teams' card says it in a note under the dropdown",
    async (form: FormRecord) => {
      offerOnePolicy();

      const builder: unknown = (form.teams as Record<string, unknown>)[
        form.teamsBuilder
      ];

      const built: JSONObject | null = await (
        builder as (
          recordId: string,
          projectId: ObjectID,
          props: DatabaseCommonInteractionProps,
        ) => Promise<JSONObject | null>
      ).call(form.teams, recordId.toString(), projectId, {});

      const body: Array<JSONObject> = (built?.["body"] ||
        []) as Array<JSONObject>;

      expect(body[1]).toMatchObject({
        type: "Input.ChoiceSet",
        id: "onCallPolicy",
      });
      expect(body[2]).toEqual(
        MicrosoftTeamsCardChoices.buildNoteElement(
          getExecuteOnCallPolicyFormDescription(form.recordType),
        ),
      );
      expect(body).toHaveLength(3);
    },
  );

  test.each(FORM_RECORDS)(
    "$record: Mattermost's dialog says it as the policy field's help text, whole",
    async (form: FormRecord) => {
      offerOnePolicy();
      jest
        .spyOn(WorkspaceActionAuthorization, "assertCanCreate")
        .mockResolvedValue(undefined as never);

      const modalBlock: WorkspaceModalBlock = await (
        MattermostActions as unknown as {
          getForm: (data: unknown) => Promise<WorkspaceModalBlock>;
        }
      ).getForm({
        requester: {
          projectId: projectId,
          userId: ObjectID.generate(),
          mattermostUserId: "mm-user",
          props: {},
          authToken: "token",
          channelId: "channel",
        },
        spec: {
          recordType: form.mattermost,
          press: MattermostPress.OpenOnCallPolicyForm,
          submitActionId: "submit",
        },
        recordId: recordId,
      });

      const dialog: JSONObject = MattermostUtil.getDialog({
        modalBlock: modalBlock,
        // A Mattermost id: 26 lower-case letters and digits.
        teamId: "abcdefghijklmnopqrstuvwxyz",
      });
      const elements: Array<JSONObject> = dialog[
        "elements"
      ] as Array<JSONObject>;

      expect(elements).toHaveLength(1);
      expect(elements[0]).toMatchObject({
        name: MATTERMOST_ON_CALL_POLICY_FIELD,
        display_name: "On-Call Policy",
        help_text: getExecuteOnCallPolicyFormDescription(form.recordType),
      });
    },
  );
});
