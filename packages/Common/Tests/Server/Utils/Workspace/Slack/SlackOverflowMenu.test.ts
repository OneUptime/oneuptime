import { describe, expect, test } from "@jest/globals";
import SlackOverflowMenu, {
  SLACK_OVERFLOW_MENU_ACTION_ID,
  SlackOverflowChoice,
} from "../../../../../Server/Utils/Workspace/Slack/SlackOverflowMenu";
import SlackUtil from "../../../../../Server/Utils/Workspace/Slack/Slack";
import { JSONObject } from "../../../../../Types/JSON";
import {
  SLACK_OVERFLOW_MENU_MAX_ITEMS,
  WorkspaceMessagePayloadButton,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";

/*
 * A MESSAGE'S OVERFLOW MENU (⋯) IN SLACK.
 *
 * One element, one action id: Slack reports which option was chosen by its
 * value, so each option's value carries the action it stands for and that
 * action's value - read back as the press of a button with that action id
 * and value (SlackAuthAction), which every handler and the Connect prompt
 * take as they take the button.
 */

const INCIDENT_ID: string = "7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d";

function item(title: string, actionId: string): WorkspaceMessagePayloadButton {
  return {
    _type: "WorkspaceMessagePayloadButton",
    title: title,
    value: INCIDENT_ID,
    actionId: actionId,
  };
}

describe("SlackOverflowMenu.encode and decode", () => {
  test("an option's value is the action and its value, read back as the press it stands for", () => {
    const value: string = SlackOverflowMenu.encode(
      item("⚠️ Change Severity", "ViewChangeIncidentSeverity"),
    );

    expect(value).toBe(`ViewChangeIncidentSeverity:${INCIDENT_ID}`);
    expect(SlackOverflowMenu.decode(value)).toEqual({
      actionType: "ViewChangeIncidentSeverity",
      actionValue: INCIDENT_ID,
    });
  });

  test("a value with more colons keeps them in the action's value", () => {
    expect(SlackOverflowMenu.decode("SomeAction:a:b:c")).toEqual({
      actionType: "SomeAction",
      actionValue: "a:b:c",
    });
  });

  test("an action with no value of its own", () => {
    expect(SlackOverflowMenu.decode("SomeAction:")).toEqual({
      actionType: "SomeAction",
      actionValue: "",
    });
  });

  test.each([
    [undefined, "nothing"],
    [null, "null"],
    [42, "a number"],
    ["", "an empty value"],
    ["NoSeparator", "no separator"],
    [":value", "no action"],
  ])(
    "%p is no choice of a menu of OneUptime's (%s)",
    (value: unknown, _description: string) => {
      const choice: SlackOverflowChoice | null =
        SlackOverflowMenu.decode(value);
      expect(choice).toBeNull();
    },
  );
});

describe("SlackOverflowMenu.getElement", () => {
  test("an overflow element: one action id, an option for each item, with its text and value", () => {
    expect(
      SlackOverflowMenu.getElement([
        item("⚠️ Change Severity", "ViewChangeIncidentSeverity"),
        item("👤 Assign Role", "ViewAssignIncidentRole"),
      ]),
    ).toEqual({
      type: "overflow",
      action_id: SLACK_OVERFLOW_MENU_ACTION_ID,
      options: [
        {
          text: { type: "plain_text", text: "⚠️ Change Severity", emoji: true },
          value: `ViewChangeIncidentSeverity:${INCIDENT_ID}`,
        },
        {
          text: { type: "plain_text", text: "👤 Assign Role", emoji: true },
          value: `ViewAssignIncidentRole:${INCIDENT_ID}`,
        },
      ],
    });
  });

  test("Slack holds five options at most: a sixth is a mistake, thrown before Slack refuses the message", () => {
    const six: Array<WorkspaceMessagePayloadButton> = [1, 2, 3, 4, 5, 6].map(
      (index: number) => {
        return item(`Item ${index}`, `Action${index}`);
      },
    );

    expect(SLACK_OVERFLOW_MENU_MAX_ITEMS).toBe(5);
    expect(() => {
      return SlackOverflowMenu.getElement(six.slice(0, 5));
    }).not.toThrow();
    expect(() => {
      return SlackOverflowMenu.getElement(six);
    }).toThrow("Slack's overflow menu holds at most 5 options, not 6.");
  });

  test("an option's text over 75 characters, or its value over 150, is a mistake too", () => {
    expect(() => {
      return SlackOverflowMenu.getElement([item("x".repeat(76), "Action")]);
    }).toThrow("An overflow menu option's text is at most 75 characters");

    expect(() => {
      return SlackOverflowMenu.getElement([
        {
          ...item("Title", "Action"),
          value: "v".repeat(150),
        },
      ]);
    }).toThrow("An overflow menu option's value is at most 150 characters");
  });
});

describe("a buttons block with a menu, as Slack draws it", () => {
  test("the buttons, then the overflow menu, in one actions block", () => {
    const blocks: Array<JSONObject> =
      SlackUtil.getBlocksFromWorkspaceMessagePayload({
        messageBlocks: [
          {
            _type: "WorkspacePayloadButtons",
            buttons: [item("👀 Acknowledge Incident", "AcknowledgeIncident")],
            menuButtons: [
              item("⚠️ Change Severity", "ViewChangeIncidentSeverity"),
            ],
          } as never,
        ],
      });

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!["type"]).toBe("actions");

    const elements: Array<JSONObject> = blocks[0]![
      "elements"
    ] as Array<JSONObject>;

    expect(
      elements.map((element: JSONObject) => {
        return element["type"];
      }),
    ).toEqual(["button", "overflow"]);
  });

  test("a buttons block with no menu - every other record's message - is drawn as before: buttons only", () => {
    const blocks: Array<JSONObject> =
      SlackUtil.getBlocksFromWorkspaceMessagePayload({
        messageBlocks: [
          {
            _type: "WorkspacePayloadButtons",
            buttons: [item("👀 Acknowledge Alert", "AcknowledgeAlert")],
          } as never,
          {
            _type: "WorkspacePayloadButtons",
            buttons: [item("👀 Acknowledge Alert", "AcknowledgeAlert")],
            menuButtons: [],
          } as never,
        ],
      });

    for (const block of blocks) {
      expect(
        (block["elements"] as Array<JSONObject>).map((element: JSONObject) => {
          return element["type"];
        }),
      ).toEqual(["button"]);
    }
  });
});
