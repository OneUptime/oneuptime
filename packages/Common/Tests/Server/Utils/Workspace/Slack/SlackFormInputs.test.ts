import { describe, expect, test } from "@jest/globals";
import SlackUtil from "../../../../../Server/Utils/Workspace/Slack/Slack";
import SlackPageActions from "../../../../../Server/Utils/Workspace/Slack/Actions/Page";
import { JSONObject } from "../../../../../Types/JSON";
import {
  WorkspaceDropdownBlock,
  WorkspaceModalBlock,
  WorkspaceTextAreaBlock,
  WorkspaceTextBoxBlock,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import { WorkspacePageTargetKind } from "../../../../../Server/Utils/Workspace/WorkspacePage";

/*
 * A SLACK FORM'S FIELDS, AS SLACK IS SENT THEM.
 *
 * The Page someone form (`/oneuptime page`) lists who to page under
 * headings - on-call schedules, people, teams, on-call policies - picks the
 * people typed after the command already, and answers a submission that is
 * not right on the field it is about. So a select can carry its options in
 * groups (Slack's option_groups), a multi-select its picks (initial_options,
 * each the option itself), and every input names its block (block_id), which
 * Slack's `response_action: errors` addresses.
 */

function dropdown(block: Partial<WorkspaceDropdownBlock>): JSONObject {
  return SlackUtil.getDropdownBlock({
    payloadDropdownBlock: {
      _type: "WorkspaceDropdownBlock",
      label: "Who to page",
      blockId: "pageTargets",
      placeholder: "Pick",
      options: [],
      ...block,
    },
  });
}

describe("a select with its options in groups", () => {
  test("each group under its heading, in order; no options beside them - Slack takes one or the other", () => {
    const block: JSONObject = dropdown({
      multiSelect: true,
      optionGroups: [
        {
          label: "On-call schedules",
          options: [
            { label: "Primary (Ana on call now)", value: "schedule:1" },
          ],
        },
        {
          label: "People",
          options: [
            { label: "Ana Ruiz", value: "user:1" },
            { label: "Nawaz Dhandala", value: "user:2" },
          ],
        },
      ],
    });
    const element: JSONObject = block["element"] as JSONObject;

    expect(element["type"]).toBe("multi_static_select");
    expect(element["options"]).toBeUndefined();
    expect(element["option_groups"]).toEqual([
      {
        label: { type: "plain_text", text: "On-call schedules" },
        options: [
          {
            text: { type: "plain_text", text: "Primary (Ana on call now)" },
            value: "schedule:1",
          },
        ],
      },
      {
        label: { type: "plain_text", text: "People" },
        options: [
          { text: { type: "plain_text", text: "Ana Ruiz" }, value: "user:1" },
          {
            text: { type: "plain_text", text: "Nawaz Dhandala" },
            value: "user:2",
          },
        ],
      },
    ]);
  });

  test("an empty group is left out: Slack refuses a group with no options", () => {
    const element: JSONObject = dropdown({
      optionGroups: [
        { label: "Teams", options: [] },
        { label: "People", options: [{ label: "Ana", value: "user:1" }] },
      ],
    })["element"] as JSONObject;

    expect(
      (element["option_groups"] as Array<JSONObject>).map(
        (group: JSONObject) => {
          return (group["label"] as JSONObject)["text"];
        },
      ),
    ).toEqual(["People"]);
  });

  test("no group with an option: the plain options, as every other form", () => {
    const element: JSONObject = dropdown({
      options: [{ label: "Critical", value: "1" }],
      optionGroups: [{ label: "Teams", options: [] }],
    })["element"] as JSONObject;

    expect(element["option_groups"]).toBeUndefined();
    expect(element["options"]).toEqual([
      { text: { type: "plain_text", text: "Critical" }, value: "1" },
    ]);
  });
});

describe("a multi-select's picks as it opens", () => {
  test("each the option itself, from the groups or the plain options, in the order given", () => {
    const element: JSONObject = dropdown({
      multiSelect: true,
      options: [{ label: "Loose", value: "loose:1" }],
      optionGroups: [
        {
          label: "People",
          options: [
            { label: "Ana Ruiz", value: "user:1" },
            { label: "Nawaz Dhandala", value: "user:2" },
          ],
        },
      ],
      initialValues: ["user:2", "loose:1"],
    })["element"] as JSONObject;

    expect(element["initial_options"]).toEqual([
      {
        text: { type: "plain_text", text: "Nawaz Dhandala" },
        value: "user:2",
      },
      { text: { type: "plain_text", text: "Loose" }, value: "loose:1" },
    ]);
  });

  test("a pick no list holds is left out - Slack refuses an initial option it does not offer", () => {
    const element: JSONObject = dropdown({
      multiSelect: true,
      optionGroups: [
        { label: "People", options: [{ label: "Ana Ruiz", value: "user:1" }] },
      ],
      initialValues: ["user:9"],
    })["element"] as JSONObject;

    expect(element["initial_options"]).toBeUndefined();
  });

  test("a single select takes no initial_options", () => {
    const element: JSONObject = dropdown({
      options: [{ label: "Ana Ruiz", value: "user:1" }],
      initialValues: ["user:1"],
    })["element"] as JSONObject;

    expect(element["type"]).toBe("static_select");
    expect(element["initial_options"]).toBeUndefined();
  });
});

describe("every input names its block, so a submission can be answered on it", () => {
  test("a select, a text area and a text box: block_id is the field's own id", () => {
    expect(dropdown({})["block_id"]).toBe("pageTargets");
    expect(
      SlackUtil.getTextAreaBlock({
        payloadTextAreaBlock: {
          _type: "WorkspaceTextAreaBlock",
          label: "Message",
          blockId: "pageMessage",
          placeholder: "",
        } as WorkspaceTextAreaBlock,
      })["block_id"],
    ).toBe("pageMessage");
    expect(
      SlackUtil.getTextBoxBlock({
        payloadTextBoxBlock: {
          _type: "WorkspaceTextBoxBlock",
          label: "Incident Title",
          blockId: "incidentTitle",
          placeholder: "",
        } as WorkspaceTextBoxBlock,
      })["block_id"],
    ).toBe("incidentTitle");
  });

  test("its value is still read by its id (SlackUtil.getValuesFromView)", () => {
    expect(
      SlackUtil.getValuesFromView({
        view: {
          state: {
            values: {
              pageTargets: {
                pageTargets: {
                  type: "multi_static_select",
                  selected_options: [{ value: "user:1" }, { value: "team:2" }],
                },
              },
              pageMessage: {
                pageMessage: { type: "plain_text_input", value: "db down" },
              },
            },
          },
        },
      }),
    ).toEqual({ pageTargets: ["user:1", "team:2"], pageMessage: "db down" });
  });
});

describe("the Page someone form, as Slack is sent it", () => {
  const modal: WorkspaceModalBlock = SlackPageActions.getFormModal({
    choices: [
      {
        kind: WorkspacePageTargetKind.Schedule,
        label: "On-call schedules",
        choices: [
          {
            value: "schedule:1",
            name: "Primary",
            label: "Primary (Ana Ruiz on call now)",
          },
        ],
      },
      {
        kind: WorkspacePageTargetKind.Person,
        label: "People",
        choices: [{ value: "user:1", name: "Ana Ruiz", label: "Ana Ruiz" }],
      },
    ],
    prefill: {
      values: ["user:1"],
      message: "db down",
      notes: ["OneUptime can't tell who @x is. Pick them below."],
    },
  });

  const view: JSONObject = SlackUtil.getModalBlock({
    payloadModalBlock: modal,
  });
  const blocks: Array<JSONObject> = view["blocks"] as Array<JSONObject>;

  test("its title, its buttons, and the action its submission is", () => {
    expect(view["title"]).toEqual({ type: "plain_text", text: "Page someone" });
    expect(view["submit"]).toEqual({ type: "plain_text", text: "Page" });
    expect(view["close"]).toEqual({ type: "plain_text", text: "Cancel" });
    expect(view["callback_id"]).toBe("SubmitPageSomeone");
    // Slack takes a modal title of 24 characters at most.
    expect(SlackPageActions.FORM_TITLE.length).toBeLessThanOrEqual(24);
  });

  test("a note first, then who to page, then the message - each filled in", () => {
    expect(
      blocks.map((block: JSONObject) => {
        return block["type"];
      }),
    ).toEqual(["section", "input", "input"]);
    expect(
      String((blocks[0]!["text"] as JSONObject)["text"])
        .split(String.fromCharCode(0x200b))
        .join(""),
    ).toBe("⚠️ OneUptime can't tell who @x is. Pick them below.\n");

    const who: JSONObject = blocks[1]!["element"] as JSONObject;
    expect(who["initial_options"]).toEqual([
      { text: { type: "plain_text", text: "Ana Ruiz" }, value: "user:1" },
    ]);
    expect(blocks[1]!["optional"]).toBe(false);

    const message: JSONObject = blocks[2]!["element"] as JSONObject;
    expect(message["multiline"]).toBe(true);
    expect(message["initial_value"]).toBe("db down");
    // Who reads the message, and that it becomes a new alert's title.
    expect(blocks[2]!["hint"]).toEqual({
      type: "plain_text",
      text: "The people you page get this as the title of a new alert.",
    });
    expect(blocks[1]!["hint"]).toEqual({
      type: "plain_text",
      text: "A schedule pages whoever is on call in it now. A policy pages through its escalation rules.",
    });
  });

  test("a project with more people than the list holds: the hint says so, and how to page them anyway", () => {
    const crowded: WorkspaceModalBlock = SlackPageActions.getFormModal({
      choices: [
        {
          kind: WorkspacePageTargetKind.Person,
          label: "People",
          choices: [{ value: "user:1", name: "Ana Ruiz", label: "Ana Ruiz" }],
          notShownCount: 52,
        },
      ],
      prefill: { values: [], message: "", notes: [] },
    });
    const crowdedBlocks: Array<JSONObject> = SlackUtil.getModalBlock({
      payloadModalBlock: crowded,
    })["blocks"] as Array<JSONObject>;

    expect(crowdedBlocks[0]!["hint"]).toEqual({
      type: "plain_text",
      text: "A schedule pages whoever is on call in it now. A policy pages through its escalation rules. 52 more people aren't listed. @mention anyone to page them at once.",
    });
  });

  test("with nothing to say first, the form opens on who to page", () => {
    const plain: WorkspaceModalBlock = SlackPageActions.getFormModal({
      choices: [],
      prefill: { values: [], message: "", notes: [] },
    });

    expect(
      plain.blocks.map((block: { _type: string }) => {
        return block._type;
      }),
    ).toEqual(["WorkspaceDropdownBlock", "WorkspaceTextAreaBlock"]);
    expect(
      (plain.blocks[1] as WorkspaceTextAreaBlock).initialValue,
    ).toBeUndefined();
  });
});
