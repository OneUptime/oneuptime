import { describe, expect, test } from "@jest/globals";
import MattermostUtil, {
  MATTERMOST_DIALOG_PATH,
  MATTERMOST_INTERACTIVE_PATH,
  MattermostRequestError,
} from "../../../../../Server/Utils/Workspace/Mattermost/Mattermost";
import MattermostActionContext, {
  MattermostPressedAction,
} from "../../../../../Server/Utils/Workspace/Mattermost/MattermostActionContext";
import { isMattermostAction } from "../../../../../Server/Utils/Workspace/Mattermost/MattermostActionTypes";
import SlackActionType from "../../../../../Server/Utils/Workspace/Slack/Actions/ActionTypes";
import URL from "../../../../../Types/API/URL";
import { JSONArray, JSONObject } from "../../../../../Types/JSON";
import {
  WorkspaceMessageBlock,
  WorkspaceModalBlock,
  WorkspacePayloadButtons,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import { TRUNCATED_TEXT_NOTE } from "../../../../../Utils/MessageFit";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import { FastestRun, fastestRun } from "../../../../Helpers/FastestRun";

/*
 * How OneUptime's messages - built once for every chat, with Slack's action
 * ids on their buttons - are drawn as Mattermost posts: Markdown as the
 * message, which Mattermost reads as OneUptime writes it, and the buttons
 * in an attachment under it, each with a context signed for the team.
 */

const TEAM_ID: string = "t".repeat(26);
const INCIDENT_ID: string = "5a1d8e1c-6b2f-4e36-9c1e-0f2a3b4c5d6e";
const WORD_JOINER: string = "⁠";

function post(
  messageBlocks: Array<WorkspaceMessageBlock>,
  text?: string,
): JSONObject {
  return MattermostUtil.toPost({
    blocks: MattermostUtil.getBlocksFromWorkspaceMessagePayload({
      messageBlocks: messageBlocks,
    }),
    teamId: TEAM_ID,
    text: text,
  });
}

function attachment(of: JSONObject): JSONObject {
  return ((of["props"] as JSONObject)["attachments"] as JSONArray)[0]!;
}

function actions(of: JSONObject): JSONArray {
  return (attachment(of)["actions"] as JSONArray) || [];
}

function pressOf(
  action: JSONObject,
  selectedOption?: string,
): MattermostPressedAction | null {
  const integration: JSONObject = action["integration"] as JSONObject;
  const context: JSONObject = { ...(integration["context"] as JSONObject) };

  if (selectedOption !== undefined) {
    context["selected_option"] = selectedOption;
  }

  return MattermostActionContext.readPress({
    context: context,
    teamId: TEAM_ID,
  });
}

const incidentButtons: WorkspacePayloadButtons = {
  _type: "WorkspacePayloadButtons",
  buttons: [
    {
      _type: "WorkspaceMessagePayloadButton",
      title: "Acknowledge",
      value: INCIDENT_ID,
      actionId: SlackActionType.AcknowledgeIncident,
      isPrimary: true,
    },
    {
      _type: "WorkspaceMessagePayloadButton",
      title: "Resolve",
      value: INCIDENT_ID,
      actionId: SlackActionType.ResolveIncident,
    },
    {
      _type: "WorkspaceMessagePayloadButton",
      title: "View Incident",
      value: "",
      actionId: SlackActionType.ViewIncident,
      url: URL.fromString("https://oneuptime.com/dashboard/p/incidents/1"),
    },
  ],
  menuButtons: [
    {
      _type: "WorkspaceMessagePayloadButton",
      title: "Change Severity",
      value: INCIDENT_ID,
      actionId: SlackActionType.ViewChangeIncidentSeverity,
    },
    {
      _type: "WorkspaceMessagePayloadButton",
      title: "Assign Role",
      value: INCIDENT_ID,
      actionId: SlackActionType.ViewAssignIncidentRole,
    },
    {
      _type: "WorkspaceMessagePayloadButton",
      title: "Change State",
      value: INCIDENT_ID,
      actionId: SlackActionType.ViewChangeIncidentState,
    },
  ],
};

describe("MattermostUtil.toPost: the message", () => {
  test("Markdown is the post's message, blocks a blank line apart", () => {
    const created: JSONObject = post([
      { _type: "WorkspacePayloadMarkdown", text: "**Incident created**" },
      { _type: "WorkspacePayloadMarkdown", text: "Checkout is down." },
    ] as unknown as Array<WorkspaceMessageBlock>);

    expect(created["message"]).toBe(
      "**Incident created**\n\nCheckout is down.",
    );
    expect(created["props"]).toBeUndefined();
  });

  test("a header is a heading, its text escaped as text", () => {
    const created: JSONObject = post([
      { _type: "WorkspacePayloadHeader", text: "INC-42 *Checkout* down" },
    ] as unknown as Array<WorkspaceMessageBlock>);

    expect(created["message"]).toMatch(/^#### /);
    expect(created["message"]).toContain("INC-42 \\*Checkout\\* down");
  });

  test("a divider is a thematic break, on lines of its own", () => {
    const created: JSONObject = post([
      { _type: "WorkspacePayloadMarkdown", text: "Above" },
      { _type: "WorkspacePayloadDivider" },
      { _type: "WorkspacePayloadMarkdown", text: "Below" },
    ] as unknown as Array<WorkspaceMessageBlock>);

    expect(created["message"]).toBe("Above\n\n---\n\nBelow");
  });

  test("context text reads as part of the message", () => {
    const created: JSONObject = post([
      { _type: "WorkspacePayloadContext", text: "_Sent by OneUptime_" },
    ] as unknown as Array<WorkspaceMessageBlock>);

    expect(created["message"]).toBe("_Sent by OneUptime_");
  });

  test("an image is a Markdown image with its alt text escaped", () => {
    const created: JSONObject = post([
      {
        _type: "WorkspacePayloadImage",
        imageUrl: URL.fromString("https://example.com/graph.png"),
        altText: "Latency [p99]",
      },
    ] as unknown as Array<WorkspaceMessageBlock>);

    expect(created["message"]).toBe(
      "![Latency \\[p99\\]](https://example.com/graph.png)",
    );
  });

  test("a screenshot carried in the Markdown is its alt text, never its base64", () => {
    const base64: string = "iVBORw0KGgo" + "A".repeat(4000);

    const created: JSONObject = MattermostUtil.toPost({
      blocks: MattermostUtil.getBlocksFromWorkspaceMessagePayload({
        messageBlocks: [
          {
            _type: "WorkspacePayloadInlineImage",
            altText: "Screenshot",
            fallbackMarkdown: "[Screenshot]",
            image: { mimeType: "image/png", base64: base64 },
          } as unknown as WorkspaceMessageBlock,
        ],
      }),
      teamId: TEAM_ID,
    });

    expect(created["message"]).toBe("[Screenshot]");
    expect(created["message"]).not.toContain(base64.substring(0, 20));
  });

  test("a post with no Markdown of its own reads its notification text", () => {
    const created: JSONObject = post(
      [incidentButtons],
      "Incident INC-42 created",
    );

    expect(created["message"]).toBe("Incident INC-42 created");
  });

  test("a message longer than a post takes is cut, ending with the note", () => {
    const long: string = "line of a log\n".repeat(3000);

    const created: JSONObject = post([
      { _type: "WorkspacePayloadMarkdown", text: long },
    ] as unknown as Array<WorkspaceMessageBlock>);

    const message: string = created["message"] as string;

    expect(message.length).toBeLessThanOrEqual(
      MattermostUtil.MESSAGE_MAX_LENGTH,
    );
    expect(message.endsWith(TRUNCATED_TEXT_NOTE)).toBe(true);
  });

  test("a message of exactly the limit is posted as it is", () => {
    const exact: string = "a".repeat(MattermostUtil.MESSAGE_MAX_LENGTH);

    const created: JSONObject = post([
      { _type: "WorkspacePayloadMarkdown", text: exact },
    ] as unknown as Array<WorkspaceMessageBlock>);

    expect(created["message"]).toBe(exact);
  });
});

describe("MattermostUtil.neutralizeMentions", () => {
  test.each([
    [
      "@channel the database is down",
      `@${WORD_JOINER}channel the database is down`,
    ],
    [
      "ping @alice and @bob.smith",
      `ping @${WORD_JOINER}alice and @${WORD_JOINER}bob.smith`,
    ],
    ["(@here)", `(@${WORD_JOINER}here)`],
    ["**@all**", `**@${WORD_JOINER}all**`],
    ["@1234", `@${WORD_JOINER}1234`],
  ])("%j notifies nobody", (text: string, expected: string) => {
    expect(MattermostUtil.neutralizeMentions(text)).toBe(expected);
  });

  test.each([
    "write to alice@example.com",
    "https://medium.com/@alice/post",
    "[profile](https://example.com/@alice)",
    "an @ alone",
    "trailing @",
    "no mentions at all",
    "",
  ])("%j keeps its characters", (text: string) => {
    expect(MattermostUtil.neutralizeMentions(text)).toBe(text);
  });

  test("a web address ends at white space: a mention after it is broken", () => {
    expect(
      MattermostUtil.neutralizeMentions("see https://x.com/@a then @bob"),
    ).toBe(`see https://x.com/@a then @${WORD_JOINER}bob`);
  });

  test("every mention in a post's message is broken, the text reading the same", () => {
    const created: JSONObject = post([
      {
        _type: "WorkspacePayloadMarkdown",
        text: "Incident title: @channel help",
      },
    ] as unknown as Array<WorkspaceMessageBlock>);

    expect(created["message"]).toBe(
      `Incident title: @${WORD_JOINER}channel help`,
    );
    expect((created["message"] as string).split(WORD_JOINER).join("")).toBe(
      "Incident title: @channel help",
    );
  });

  test("runs in one pass over a long text of mentions", () => {
    const text: string = "@a ".repeat(200000);

    const timed: FastestRun<string> = fastestRun({
      run: (): string => {
        return MattermostUtil.neutralizeMentions(text);
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
    expect(timed.result.length).toBe(text.length + 200000);
  });

  // A request can send anything: an object's length must not bound the scan.
  test.each([
    [{ length: 1000000000 }],
    [["@alice"]],
    [42],
    [null],
    [undefined],
  ])("anything but text (%j) reads as nothing", (value: unknown) => {
    expect(MattermostUtil.neutralizeMentions(value as string)).toBe("");
  });

  test("text with no mention comes back as it is, and no text as nothing", () => {
    expect(MattermostUtil.neutralizeMentions("No mention here")).toBe(
      "No mention here",
    );
    expect(MattermostUtil.neutralizeMentions("")).toBe("");
  });
});

describe("MattermostUtil.toPost: buttons", () => {
  test("each button OneUptime acts on in Mattermost is a button of the attachment", () => {
    const created: JSONObject = post([incidentButtons]);
    const buttons: JSONArray = actions(created).filter((action: JSONObject) => {
      return action["type"] === "button";
    });

    expect(
      buttons.map((button: JSONObject) => {
        return button["name"];
      }),
    ).toEqual(["Acknowledge", "Resolve"]);
  });

  test("the primary button is drawn as primary", () => {
    const created: JSONObject = post([incidentButtons]);

    expect(actions(created)[0]!["style"]).toBe("primary");
    expect(actions(created)[1]!["style"]).toBe("default");
  });

  test("action ids are letters and digits only, unique in the post", () => {
    const created: JSONObject = post([incidentButtons, incidentButtons]);
    const ids: Array<string> = actions(created).map((action: JSONObject) => {
      return action["id"] as string;
    });

    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9]+$/i);
    }

    expect(new Set(ids).size).toBe(ids.length);
  });

  test("each button POSTs to OneUptime's interactive endpoint", () => {
    const created: JSONObject = post([incidentButtons]);

    for (const action of actions(created)) {
      expect((action["integration"] as JSONObject)["url"]).toBe(
        MattermostUtil.getIntegrationUrl(MATTERMOST_INTERACTIVE_PATH),
      );
    }
  });

  test("a button's context is signed for the team and reads back as its action", () => {
    const created: JSONObject = post([incidentButtons]);

    expect(pressOf(actions(created)[0]!)).toEqual({
      teamId: TEAM_ID,
      actionId: SlackActionType.AcknowledgeIncident,
      value: INCIDENT_ID,
    });

    expect(pressOf(actions(created)[1]!)).toEqual({
      teamId: TEAM_ID,
      actionId: SlackActionType.ResolveIncident,
      value: INCIDENT_ID,
    });
  });

  test("a link button is a Markdown link beside the buttons", () => {
    const created: JSONObject = post([incidentButtons]);

    expect(attachment(created)["text"]).toBe(
      "[View Incident](https://oneuptime.com/dashboard/p/incidents/1)",
    );
  });

  test("the menu's actions OneUptime acts on in Mattermost are one select, in order", () => {
    const created: JSONObject = post([incidentButtons]);
    const menu: JSONObject = actions(created).find((action: JSONObject) => {
      return action["type"] === "select";
    })!;

    expect(menu["options"]).toEqual([
      { text: "Change Severity", value: "0" },
      { text: "Change State", value: "1" },
    ]);

    expect(pressOf(menu, "0")?.actionId).toBe(
      SlackActionType.ViewChangeIncidentSeverity,
    );
    expect(pressOf(menu, "1")?.actionId).toBe(
      SlackActionType.ViewChangeIncidentState,
    );
    expect(pressOf(menu, "2")).toBeNull();
  });

  test("a button Mattermost has no action for is left out: Assign Role", () => {
    expect(isMattermostAction(SlackActionType.ViewAssignIncidentRole)).toBe(
      false,
    );

    const created: JSONObject = post([incidentButtons]);
    const names: Array<string> = [];

    for (const action of actions(created)) {
      names.push(action["name"] as string);

      for (const option of (action["options"] as JSONArray) || []) {
        names.push(option["text"] as string);
      }
    }

    expect(names).not.toContain("Assign Role");
  });

  test("a message whose buttons are all unsupported keeps only its links", () => {
    const created: JSONObject = post([
      {
        _type: "WorkspacePayloadButtons",
        buttons: [
          {
            _type: "WorkspaceMessagePayloadButton",
            title: "Page Someone",
            value: INCIDENT_ID,
            actionId: SlackActionType.ViewPageAboutIncident,
          },
          {
            _type: "WorkspaceMessagePayloadButton",
            title: "Open",
            value: "",
            actionId: SlackActionType.ViewIncident,
            url: URL.fromString("https://oneuptime.com/x"),
          },
        ],
      } as WorkspacePayloadButtons,
    ]);

    expect(attachment(created)["actions"]).toBeUndefined();
    expect(attachment(created)["text"]).toBe("[Open](https://oneuptime.com/x)");
  });

  test("a long button title is cut short", () => {
    const created: JSONObject = post([
      {
        _type: "WorkspacePayloadButtons",
        buttons: [
          {
            _type: "WorkspaceMessagePayloadButton",
            title: "Acknowledge ".repeat(20),
            value: INCIDENT_ID,
            actionId: SlackActionType.AcknowledgeIncident,
          },
        ],
      } as WorkspacePayloadButtons,
    ]);

    const name: string = actions(created)[0]!["name"] as string;

    expect(name.length).toBeLessThanOrEqual(
      MattermostUtil.BUTTON_TITLE_MAX_LENGTH,
    );
    expect(name.endsWith("…")).toBe(true);
  });

  test("the attachment's fallback is the notification text, held short", () => {
    const created: JSONObject = post([incidentButtons], "x".repeat(1000));

    expect(
      (attachment(created)["fallback"] as string).length,
    ).toBeLessThanOrEqual(MattermostUtil.NOTIFICATION_TEXT_MAX_LENGTH);
  });
});

describe("MattermostUtil: forms are interactive dialogs", () => {
  const modal: WorkspaceModalBlock = {
    _type: "WorkspaceModalBlock",
    title: "Add a Note to This Incident Please",
    actionId: SlackActionType.SubmitIncidentNote,
    actionValue: INCIDENT_ID,
    submitButtonTitle: "Submit",
    cancelButtonTitle: "Cancel",
    blocks: [
      {
        _type: "WorkspacePayloadMarkdown",
        text: "🔒 This incident is private.",
      },
      {
        _type: "WorkspaceDropdownBlock",
        label: "Note Type",
        blockId: "noteType",
        placeholder: "Select note type",
        options: [
          { label: "Public Note", value: "public" },
          { label: "Private Note", value: "private" },
        ],
        initialValue: "private",
      },
      {
        _type: "WorkspaceTextAreaBlock",
        label: "Note",
        blockId: "note",
        placeholder: "Note",
        description: "Please type in plain text or markdown.",
      },
      {
        _type: "WorkspaceCheckboxBlock",
        label: "Notify subscribers",
        blockId: "notify",
        initialValue: true,
      },
      {
        _type: "WorkspaceNumberInputBlock",
        label: "Minutes",
        blockId: "minutes",
        initialValue: "15",
      },
      {
        _type: "WorkspaceDatePickerBlock",
        label: "Day",
        blockId: "day",
        initialDate: "2026-10-15",
      },
      {
        _type: "WorkspaceDateTimePickerBlock",
        label: "Starts",
        blockId: "starts",
        initialDateTime: new Date("2026-10-15T14:30:00.000Z"),
      },
      {
        _type: "WorkspaceTextBoxBlock",
        label: "A label much longer than Mattermost shows",
        blockId: "title",
        placeholder: "Title",
      },
    ] as unknown as Array<WorkspaceMessageBlock>,
  };

  test("the dialog has its title, submit label and callback id", () => {
    const dialog: JSONObject = MattermostUtil.getDialog({
      modalBlock: modal,
      teamId: TEAM_ID,
    });

    expect(dialog["callback_id"]).toBe(SlackActionType.SubmitIncidentNote);
    expect(dialog["submit_label"]).toBe("Submit");
    expect((dialog["title"] as string).length).toBeLessThanOrEqual(
      MattermostUtil.DIALOG_TITLE_MAX_LENGTH,
    );
    expect(dialog["notify_on_cancel"]).toBe(false);
  });

  test("its state is signed for the team and names the form's action and record", () => {
    const dialog: JSONObject = MattermostUtil.getDialog({
      modalBlock: modal,
      teamId: TEAM_ID,
    });

    expect(
      MattermostActionContext.readDialogState({
        state: dialog["state"],
        teamId: TEAM_ID,
      }),
    ).toEqual({
      teamId: TEAM_ID,
      actionId: SlackActionType.SubmitIncidentNote,
      value: INCIDENT_ID,
    });
  });

  test("Markdown above the fields is its introduction", () => {
    const dialog: JSONObject = MattermostUtil.getDialog({
      modalBlock: modal,
      teamId: TEAM_ID,
    });

    expect(dialog["introduction_text"]).toBe("🔒 This incident is private.");
  });

  test("each field is an element of the type Mattermost draws it with", () => {
    const elements: JSONArray = MattermostUtil.getDialog({
      modalBlock: modal,
      teamId: TEAM_ID,
    })["elements"] as JSONArray;

    const byName: Record<string, JSONObject> = {};

    for (const element of elements) {
      byName[element["name"] as string] = element;
    }

    expect(byName["noteType"]).toMatchObject({
      type: "select",
      display_name: "Note Type",
      default: "private",
      options: [
        { text: "Public Note", value: "public" },
        { text: "Private Note", value: "private" },
      ],
    });
    expect(byName["note"]).toMatchObject({
      type: "textarea",
      display_name: "Note",
      help_text: "Please type in plain text or markdown.",
      max_length: MattermostUtil.DIALOG_TEXTAREA_MAX_LENGTH,
    });
    expect(byName["notify"]).toMatchObject({ type: "bool", default: "true" });
    expect(byName["minutes"]).toMatchObject({
      type: "text",
      subtype: "number",
      default: "15",
    });
    expect(byName["day"]).toMatchObject({
      type: "text",
      default: "2026-10-15",
    });
    expect(byName["starts"]).toMatchObject({
      type: "text",
      default: "2026-10-15 14:30",
    });
  });

  test("a label longer than Mattermost shows is cut, and shown whole as help", () => {
    const elements: JSONArray = MattermostUtil.getDialog({
      modalBlock: modal,
      teamId: TEAM_ID,
    })["elements"] as JSONArray;

    const title: JSONObject = elements.find((element: JSONObject) => {
      return element["name"] === "title";
    })!;

    expect((title["display_name"] as string).length).toBeLessThanOrEqual(
      MattermostUtil.DIALOG_LABEL_MAX_LENGTH,
    );
    expect(title["help_text"]).toBe(
      "A label much longer than Mattermost shows",
    );
  });

  test("a menu holds at most the options a dialog takes, groups named in front", () => {
    const elements: JSONArray = MattermostUtil.getDialog({
      modalBlock: {
        ...modal,
        blocks: [
          {
            _type: "WorkspaceDropdownBlock",
            label: "Who",
            blockId: "who",
            placeholder: "Pick",
            options: [],
            optionGroups: [
              {
                label: "People",
                options: Array.from(
                  { length: 150 },
                  (_: unknown, i: number) => {
                    return { label: `Person ${i}`, value: `p${i}` };
                  },
                ),
              },
            ],
          },
        ] as unknown as Array<WorkspaceMessageBlock>,
      },
      teamId: TEAM_ID,
    })["elements"] as JSONArray;

    const options: JSONArray = elements[0]!["options"] as JSONArray;

    expect(options.length).toBe(MattermostUtil.DIALOG_MAX_OPTIONS);
    expect(options[0]).toEqual({ text: "People: Person 0", value: "p0" });
  });

  test("the dialog is submitted to OneUptime's dialog endpoint", () => {
    expect(MattermostUtil.getIntegrationUrl(MATTERMOST_DIALOG_PATH)).toMatch(
      /\/mattermost\/dialog$/,
    );
  });
});

describe("MattermostUtil: channel names", () => {
  test.each([
    ["inc-42", "inc-42"],
    ["#Incidents INC-9", "incidents-inc-9"],
    ["prod-", "prod"],
    ["--inc-42__", "inc-42"],
    ["!!!", "oneuptime"],
    ["a", "a-channel"],
    ["x".repeat(100), "x".repeat(64)],
    ["Ünïcode Name", "ncode-name"],
  ])("%j is created as %j", (asked: string, created: string) => {
    expect(MattermostUtil.getChannelNameToCreate(asked)).toBe(created);
  });

  test("two names Mattermost creates alike are one channel", () => {
    expect(
      MattermostUtil.isSameChannelToCreate(
        { channelName: "INC-42" },
        { channelName: "inc-42" },
      ),
    ).toBe(true);

    expect(
      MattermostUtil.isSameChannelToCreate(
        { channelName: "inc-42" },
        { channelName: "inc-43" },
      ),
    ).toBe(false);
  });

  test("a name that exists is taken; any other refusal is not", () => {
    expect(
      MattermostUtil.isChannelNameTakenError(
        new MattermostRequestError({
          message: "A channel with that name already exists on the same team.",
          statusCode: 400,
          errorId: "store.sql_channel.save_channel.exists.app_error",
        }),
      ),
    ).toBe(true);

    expect(
      MattermostUtil.isChannelNameTakenError(
        new MattermostRequestError({
          message: "Invalid name",
          statusCode: 400,
          errorId: "model.channel.is_valid.name.app_error",
        }),
      ),
    ).toBe(false);

    expect(MattermostUtil.isChannelNameTakenError(new Error("exists"))).toBe(
      false,
    );
  });

  test("a post that is gone is answered as not found", () => {
    expect(
      MattermostUtil.isMessageGoneError(
        new MattermostRequestError({
          message: "Not found",
          statusCode: 404,
          errorId: "app.post.get.app_error",
        }),
      ),
    ).toBe(true);

    expect(
      MattermostUtil.isMessageGoneError(
        new MattermostRequestError({
          message: "Forbidden",
          statusCode: 403,
          errorId: "api.context.permissions.app_error",
        }),
      ),
    ).toBe(false);
  });

  test("channels read from Mattermost are Mattermost channels", () => {
    expect(
      MattermostUtil.readChannel({
        id: "c".repeat(26),
        name: "town-square",
        display_name: "Town Square",
        type: "O",
      }),
    ).toEqual({
      id: "c".repeat(26),
      name: "town-square",
      displayName: "Town Square",
      type: "O",
      workspaceType: WorkspaceType.Mattermost,
    });
  });
});
