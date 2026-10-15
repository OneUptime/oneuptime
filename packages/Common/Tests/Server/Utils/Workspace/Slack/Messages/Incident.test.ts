import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import DatabaseConfig from "../../../../../../Server/DatabaseConfig";
import IncidentService from "../../../../../../Server/Services/IncidentService";
import { MessageBlocksByWorkspaceType } from "../../../../../../Server/Services/WorkspaceNotificationRuleService";
import MicrosoftTeamsUtil from "../../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import SlackActionType from "../../../../../../Server/Utils/Workspace/Slack/Actions/ActionTypes";
import SlackIncidentMessages, {
  SLACK_INCIDENT_ACTION_IDS,
} from "../../../../../../Server/Utils/Workspace/Slack/Messages/Incident";
import SlackUtil from "../../../../../../Server/Utils/Workspace/Slack/Slack";
import { SLACK_OVERFLOW_MENU_ACTION_ID } from "../../../../../../Server/Utils/Workspace/Slack/SlackOverflowMenu";
import { WORKSPACE_INCIDENT_BUTTONS } from "../../../../../../Server/Utils/Workspace/WorkspaceIncidentActions";
import IncidentWorkspaceMessages from "../../../../../../Server/Utils/Workspace/WorkspaceMessages/Incident";
import Hostname from "../../../../../../Types/API/Hostname";
import Protocol from "../../../../../../Types/API/Protocol";
import BadDataException from "../../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../../Types/JSON";
import ObjectID from "../../../../../../Types/ObjectID";
import {
  SLACK_OVERFLOW_MENU_MAX_ITEMS,
  WorkspaceMessageBlock,
  WorkspaceMessagePayloadButton,
  WorkspacePayloadButtons,
} from "../../../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../../../Types/Workspace/WorkspaceType";

/*
 * AN INCIDENT'S MESSAGE: WHAT RESPONDERS PRESS MOST, AND A MENU OF THE REST.
 *
 * The message used to end in six buttons - View, Execute On-Call Policy,
 * Acknowledge, Resolve, Change State, Add Note - with nothing to set an
 * incident's severity, its roles or its custom fields, or to page anybody
 * but an on-call policy (customer feedback). It ends in four buttons and a
 * menu (⋯) of five: Slack's overflow menu, Microsoft Teams' card overflow
 * menu, drawn from the same blocks. These pin the blocks, the exact Slack
 * blocks they draw, and the exact Microsoft Teams card.
 */

const projectId: ObjectID = new ObjectID(
  "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
);
const incidentId: ObjectID = new ObjectID(
  "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a",
);

const INCIDENT_LINK: string = `https://oneuptime.test/dashboard/${projectId.toString()}/incidents/${incidentId.toString()}`;

function buttonsBlockOf(
  blocks: Array<WorkspaceMessageBlock>,
): WorkspacePayloadButtons {
  return blocks[1] as WorkspacePayloadButtons;
}

function buttonsOf(
  blocks: Array<WorkspaceMessageBlock>,
): Array<WorkspaceMessagePayloadButton> {
  return buttonsBlockOf(blocks).buttons;
}

function menuOf(
  blocks: Array<WorkspaceMessageBlock>,
): Array<WorkspaceMessagePayloadButton> {
  return buttonsBlockOf(blocks).menuButtons || [];
}

describe("SlackIncidentMessages.getIncidentCreateMessageBlocks", () => {
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

  test("returns a divider followed by a single buttons block", async () => {
    const blocks: Array<WorkspaceMessageBlock> =
      await SlackIncidentMessages.getIncidentCreateMessageBlocks({
        incidentId,
        projectId,
      });

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ _type: "WorkspacePayloadDivider" });
    expect(blocks[1]!._type).toBe("WorkspacePayloadButtons");
  });

  test("four buttons - what responders press most - in order, with their action ids and titles", async () => {
    const buttons: Array<WorkspaceMessagePayloadButton> = buttonsOf(
      await SlackIncidentMessages.getIncidentCreateMessageBlocks({
        incidentId,
        projectId,
      }),
    );

    expect(
      buttons.map((button: WorkspaceMessagePayloadButton) => {
        return [button.actionId, button.title];
      }),
    ).toEqual([
      [SlackActionType.AcknowledgeIncident, "👀 Acknowledge Incident"],
      [SlackActionType.ResolveIncident, "✅ Resolve Incident"],
      [SlackActionType.ViewAddIncidentNote, "📄 Add Note"],
      [SlackActionType.ViewIncident, "🔗 View Incident"],
    ]);
  });

  test("a menu of five - the rest of what can be done to an incident from chat - in order", async () => {
    const menu: Array<WorkspaceMessagePayloadButton> = menuOf(
      await SlackIncidentMessages.getIncidentCreateMessageBlocks({
        incidentId,
        projectId,
      }),
    );

    expect(
      menu.map((item: WorkspaceMessagePayloadButton) => {
        return [item.actionId, item.title];
      }),
    ).toEqual([
      [SlackActionType.ViewChangeIncidentSeverity, "⚠️ Change Severity"],
      [SlackActionType.ViewChangeIncidentState, "➡️ Change Incident State"],
      [SlackActionType.ViewAssignIncidentRole, "👤 Assign Role"],
      [SlackActionType.ViewPageAboutIncident, "📟 Page Someone"],
      [SlackActionType.ViewEditIncidentCustomFields, "📝 Edit Custom Fields"],
    ]);

    // Slack's overflow menu holds five at most: one more breaks the message.
    expect(menu.length).toBeLessThanOrEqual(SLACK_OVERFLOW_MENU_MAX_ITEMS);
  });

  test("Execute On-Call Policy is no longer on the message: Page Someone pages policies too", async () => {
    const blocks: Array<WorkspaceMessageBlock> =
      await SlackIncidentMessages.getIncidentCreateMessageBlocks({
        incidentId,
        projectId,
      });

    expect(
      [...buttonsOf(blocks), ...menuOf(blocks)].map(
        (button: WorkspaceMessagePayloadButton) => {
          return button.actionId;
        },
      ),
    ).not.toContain(SlackActionType.ViewExecuteIncidentOnCallPolicy);
  });

  test("the titles are the shared ones both chats draw (WORKSPACE_INCIDENT_BUTTONS)", async () => {
    const blocks: Array<WorkspaceMessageBlock> =
      await SlackIncidentMessages.getIncidentCreateMessageBlocks({
        incidentId,
        projectId,
      });

    expect(
      [...buttonsOf(blocks), ...menuOf(blocks)].map(
        (button: WorkspaceMessagePayloadButton) => {
          return button.title;
        },
      ),
    ).toEqual([
      WORKSPACE_INCIDENT_BUTTONS.acknowledge,
      WORKSPACE_INCIDENT_BUTTONS.resolve,
      WORKSPACE_INCIDENT_BUTTONS.addNote,
      WORKSPACE_INCIDENT_BUTTONS.view,
      WORKSPACE_INCIDENT_BUTTONS.changeSeverity,
      WORKSPACE_INCIDENT_BUTTONS.changeState,
      WORKSPACE_INCIDENT_BUTTONS.assignRole,
      WORKSPACE_INCIDENT_BUTTONS.pageSomeone,
      WORKSPACE_INCIDENT_BUTTONS.editCustomFields,
    ]);
  });

  test("the action ids are SLACK_INCIDENT_ACTION_IDS, which Microsoft Teams' card presses too", async () => {
    const blocks: Array<WorkspaceMessageBlock> =
      await SlackIncidentMessages.getIncidentCreateMessageBlocks({
        incidentId,
        projectId,
      });

    expect(
      [...buttonsOf(blocks), ...menuOf(blocks)].map(
        (button: WorkspaceMessagePayloadButton) => {
          return button.actionId;
        },
      ),
    ).toEqual([
      SLACK_INCIDENT_ACTION_IDS.acknowledge,
      SLACK_INCIDENT_ACTION_IDS.resolve,
      SLACK_INCIDENT_ACTION_IDS.addNote,
      SLACK_INCIDENT_ACTION_IDS.view,
      SLACK_INCIDENT_ACTION_IDS.changeSeverity,
      SLACK_INCIDENT_ACTION_IDS.changeState,
      SLACK_INCIDENT_ACTION_IDS.assignRole,
      SLACK_INCIDENT_ACTION_IDS.pageSomeone,
      SLACK_INCIDENT_ACTION_IDS.editCustomFields,
    ]);
  });

  test("every button and every menu item carries the incident id as its value", async () => {
    const blocks: Array<WorkspaceMessageBlock> =
      await SlackIncidentMessages.getIncidentCreateMessageBlocks({
        incidentId,
        projectId,
      });

    const pressed: Array<WorkspaceMessagePayloadButton> = [
      ...buttonsOf(blocks),
      ...menuOf(blocks),
    ];

    expect(pressed).toHaveLength(9);

    for (const button of pressed) {
      expect(button._type).toBe("WorkspaceMessagePayloadButton");
      expect(button.value).toBe(incidentId.toString());
      expect(button.value).not.toBe(projectId.toString());
    }
  });

  test("only the View button links to the incident page in the dashboard", async () => {
    const blocks: Array<WorkspaceMessageBlock> =
      await SlackIncidentMessages.getIncidentCreateMessageBlocks({
        incidentId,
        projectId,
      });

    const view: WorkspaceMessagePayloadButton | undefined = buttonsOf(
      blocks,
    ).find((button: WorkspaceMessagePayloadButton) => {
      return button.actionId === SlackActionType.ViewIncident;
    });

    expect(view?.url?.toString()).toBe(INCIDENT_LINK);

    for (const button of [...buttonsOf(blocks), ...menuOf(blocks)]) {
      if (button.actionId !== SlackActionType.ViewIncident) {
        expect(button.url).toBeUndefined();
      }
    }
  });

  test("asks IncidentService for the link with the project and incident ids", async () => {
    const linkSpy: jest.SpiedFunction<
      typeof IncidentService.getIncidentLinkInDashboard
    > = jest.spyOn(IncidentService, "getIncidentLinkInDashboard");

    await SlackIncidentMessages.getIncidentCreateMessageBlocks({
      incidentId,
      projectId,
    });

    expect(linkSpy).toHaveBeenCalledTimes(1);
    expect(linkSpy).toHaveBeenCalledWith(projectId, incidentId);
  });

  test("throws BadDataException when the incident id is missing", async () => {
    const linkSpy: jest.SpiedFunction<
      typeof IncidentService.getIncidentLinkInDashboard
    > = jest.spyOn(IncidentService, "getIncidentLinkInDashboard");

    await expect(
      SlackIncidentMessages.getIncidentCreateMessageBlocks({
        incidentId: undefined as unknown as ObjectID,
        projectId,
      }),
    ).rejects.toThrow(new BadDataException("Incident ID is required"));

    expect(linkSpy).not.toHaveBeenCalled();
  });

  test("throws when the project id is missing (no dashboard link can be built)", async () => {
    await expect(
      SlackIncidentMessages.getIncidentCreateMessageBlocks({
        incidentId,
        projectId: undefined as unknown as ObjectID,
      }),
    ).rejects.toThrow();
  });

  test("propagates a failure while building the dashboard link", async () => {
    jest
      .spyOn(IncidentService, "getIncidentLinkInDashboard")
      .mockRejectedValue(new Error("dashboard url unavailable"));

    await expect(
      SlackIncidentMessages.getIncidentCreateMessageBlocks({
        incidentId,
        projectId,
      }),
    ).rejects.toThrow("dashboard url unavailable");
  });

  test("builds a fresh block list for each incident", async () => {
    const otherId: ObjectID = ObjectID.generate();

    const first: Array<WorkspaceMessageBlock> =
      await SlackIncidentMessages.getIncidentCreateMessageBlocks({
        incidentId,
        projectId,
      });
    const second: Array<WorkspaceMessageBlock> =
      await SlackIncidentMessages.getIncidentCreateMessageBlocks({
        incidentId: otherId,
        projectId,
      });

    expect(first).not.toBe(second);
    expect(buttonsOf(first)[0]!.value).toBe(incidentId.toString());
    expect(buttonsOf(second)[0]!.value).toBe(otherId.toString());
    expect(menuOf(second)[0]!.value).toBe(otherId.toString());
    expect(buttonsOf(second)[3]!.url?.toString()).toContain(
      `/incidents/${otherId.toString()}`,
    );
  });
});

describe("the incident's message as Slack draws it: one actions block, four buttons and an overflow menu", () => {
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

  test("the exact blocks Slack is sent", async () => {
    const blocks: Array<JSONObject> =
      SlackUtil.getBlocksFromWorkspaceMessagePayload({
        messageBlocks:
          await SlackIncidentMessages.getIncidentCreateMessageBlocks({
            incidentId,
            projectId,
          }),
      });

    const id: string = incidentId.toString();

    const button: (
      title: string,
      actionId: string,
      url?: string | undefined,
    ) => JSONObject = (
      title: string,
      actionId: string,
      url?: string | undefined,
    ): JSONObject => {
      return {
        type: "button",
        text: { type: "plain_text", text: title, emoji: true },
        value: id,
        action_id: actionId,
        url: url,
      };
    };

    const option: (title: string, actionId: string) => JSONObject = (
      title: string,
      actionId: string,
    ): JSONObject => {
      return {
        text: { type: "plain_text", text: title, emoji: true },
        value: `${actionId}:${id}`,
      };
    };

    expect(blocks).toEqual([
      { type: "divider" },
      {
        type: "actions",
        elements: [
          button("👀 Acknowledge Incident", "AcknowledgeIncident"),
          button("✅ Resolve Incident", "ResolveIncident"),
          button("📄 Add Note", "ViewAddIncidentNote"),
          button("🔗 View Incident", "ViewIncident", INCIDENT_LINK),
          {
            type: "overflow",
            action_id: SLACK_OVERFLOW_MENU_ACTION_ID,
            options: [
              option("⚠️ Change Severity", "ViewChangeIncidentSeverity"),
              option("➡️ Change Incident State", "ViewChangeIncidentState"),
              option("👤 Assign Role", "ViewAssignIncidentRole"),
              option("📟 Page Someone", "ViewPageAboutIncident"),
              option("📝 Edit Custom Fields", "ViewEditIncidentCustomFields"),
            ],
          },
        ],
      },
    ]);
  });

  test("every option's value fits Slack's 150 characters, and its text Slack's 75", async () => {
    const blocks: Array<JSONObject> =
      SlackUtil.getBlocksFromWorkspaceMessagePayload({
        messageBlocks:
          await SlackIncidentMessages.getIncidentCreateMessageBlocks({
            incidentId,
            projectId,
          }),
      });

    const overflow: JSONObject = (
      (blocks[1] as JSONObject)["elements"] as Array<JSONObject>
    )[4]!;

    for (const option of overflow["options"] as Array<JSONObject>) {
      expect((option["value"] as string).length).toBeLessThanOrEqual(150);
      expect(
        ((option["text"] as JSONObject)["text"] as string).length,
      ).toBeLessThanOrEqual(75);
    }
  });
});

describe("the incident's card as Microsoft Teams draws it: the buttons, then the menu as the card's overflow menu", () => {
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

  test("the exact actions of the card: four, then five secondary actions Teams draws in its overflow menu", async () => {
    const byType: Array<MessageBlocksByWorkspaceType> =
      await IncidentWorkspaceMessages.getIncidentCreateMessageBlocks({
        incidentId,
        projectId,
      });

    const teams: MessageBlocksByWorkspaceType = byType.find(
      (entry: MessageBlocksByWorkspaceType): boolean => {
        return entry.workspaceType === WorkspaceType.MicrosoftTeams;
      },
    )!;

    const card: JSONObject = MicrosoftTeamsUtil.buildAdaptiveCardFromMessageBlocks(
      {
        messageBlocks: teams.messageBlocks,
      },
    );

    const id: string = incidentId.toString();

    const submit: (title: string, action: string) => JSONObject = (
      title: string,
      action: string,
    ): JSONObject => {
      return {
        type: "Action.Submit",
        title: title,
        data: { action: action, actionValue: id },
      };
    };

    expect(card["actions"]).toEqual([
      submit("👀 Acknowledge Incident", "AcknowledgeIncident"),
      submit("✅ Resolve Incident", "ResolveIncident"),
      submit("📄 Add Note", "ViewAddIncidentNote"),
      {
        type: "Action.OpenUrl",
        title: "🔗 View Incident",
        url: INCIDENT_LINK,
      },
      {
        ...submit("⚠️ Change Severity", "ViewChangeIncidentSeverity"),
        mode: "secondary",
      },
      {
        ...submit("➡️ Change Incident State", "ViewChangeIncidentState"),
        mode: "secondary",
      },
      {
        ...submit("👤 Assign Role", "ViewAssignIncidentRole"),
        mode: "secondary",
      },
      {
        ...submit("📟 Page Someone", "ViewPageAboutIncident"),
        mode: "secondary",
      },
      {
        ...submit("📝 Edit Custom Fields", "ViewEditIncidentCustomFields"),
        mode: "secondary",
      },
    ]);
  });

  test("Slack and Microsoft Teams get the same blocks: one menu, one set of action ids", async () => {
    const byType: Array<MessageBlocksByWorkspaceType> =
      await IncidentWorkspaceMessages.getIncidentCreateMessageBlocks({
        incidentId,
        projectId,
      });

    expect(
      byType.map((entry: MessageBlocksByWorkspaceType) => {
        return entry.workspaceType;
      }),
    ).toEqual([WorkspaceType.Slack, WorkspaceType.MicrosoftTeams]);
    expect(byType[0]!.messageBlocks).toEqual(byType[1]!.messageBlocks);
  });
});
