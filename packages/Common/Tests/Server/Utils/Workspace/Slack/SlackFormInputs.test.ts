import { describe, expect, test } from "@jest/globals";
import SlackUtil from "../../../../../Server/Utils/Workspace/Slack/Slack";
import SlackPageActions from "../../../../../Server/Utils/Workspace/Slack/Actions/Page";
import { JSONObject } from "../../../../../Types/JSON";
import {
  WorkspaceDatePickerBlock,
  WorkspaceDateTimePickerBlock,
  WorkspaceDropdownBlock,
  WorkspaceModalBlock,
  WorkspaceNumberInputBlock,
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

/*
 * AN INCIDENT'S CUSTOM FIELDS, AS SLACK DRAWS THEM (Edit Custom Fields, on
 * the incident message's menu): a day, a number, a date and time, and a
 * pick that opens on the option the incident holds - each optional, named
 * by its block so a value that does not fit is answered under it, with its
 * description as the hint.
 */
describe("a custom field's inputs", () => {
  test("a Date field: Slack's date picker, opening on the day the incident holds", () => {
    expect(
      SlackUtil.getDatePickerBlock({
        payloadDatePickerBlock: {
          _type: "WorkspaceDatePickerBlock",
          label: "Due",
          blockId: "customField_due",
          initialDate: "2026-10-20",
          optional: true,
          description: "When the fix is due.",
        } as WorkspaceDatePickerBlock,
      }),
    ).toEqual({
      type: "input",
      block_id: "customField_due",
      optional: true,
      element: {
        type: "datepicker",
        action_id: "customField_due",
        initial_date: "2026-10-20",
      },
      label: { type: "plain_text", text: "Due" },
      hint: { type: "plain_text", text: "When the fix is due." },
    });
  });

  test("a Date field holding nothing opens empty, with no hint when it has no description", () => {
    expect(
      SlackUtil.getDatePickerBlock({
        payloadDatePickerBlock: {
          _type: "WorkspaceDatePickerBlock",
          label: "Due",
          blockId: "customField_due",
        } as WorkspaceDatePickerBlock,
      }),
    ).toEqual({
      type: "input",
      block_id: "customField_due",
      optional: false,
      element: { type: "datepicker", action_id: "customField_due" },
      label: { type: "plain_text", text: "Due" },
    });
  });

  test("a Number field: Slack's number input, decimals allowed, opening on the number held", () => {
    expect(
      SlackUtil.getNumberInputBlock({
        payloadNumberInputBlock: {
          _type: "WorkspaceNumberInputBlock",
          label: "Affected Users",
          blockId: "customField_users",
          initialValue: "1200",
          optional: true,
        } as WorkspaceNumberInputBlock,
      }),
    ).toEqual({
      type: "input",
      block_id: "customField_users",
      optional: true,
      element: {
        type: "number_input",
        is_decimal_allowed: true,
        action_id: "customField_users",
        initial_value: "1200",
      },
      label: { type: "plain_text", text: "Affected Users" },
    });
  });

  test("a Date and time field: Slack's date and time picker, opening on the moment held, as seconds since 1970", () => {
    const block: JSONObject = SlackUtil.getDateTimePickerBlock({
      payloadDateTimePickerBlock: {
        _type: "WorkspaceDateTimePickerBlock",
        label: "Started",
        blockId: "customField_started",
        initialDateTime: new Date("2026-10-15T09:30:45.000Z"),
        optional: true,
        description: "When customers first noticed.",
      } as WorkspaceDateTimePickerBlock,
    });

    expect(JSON.parse(JSON.stringify(block))).toEqual({
      type: "input",
      block_id: "customField_started",
      optional: true,
      element: {
        type: "datetimepicker",
        action_id: "customField_started",
        initial_date_time: 1792056645,
      },
      label: { type: "plain_text", text: "Started" },
      hint: { type: "plain_text", text: "When customers first noticed." },
    });
  });

  test("a date and time picker given an ISO time opens on it; one given no time, or text that is none, opens empty", () => {
    const opensOn: (initialValue: string | undefined) => unknown = (
      initialValue: string | undefined,
    ): unknown => {
      const block: JSONObject = SlackUtil.getDateTimePickerBlock({
        payloadDateTimePickerBlock: {
          _type: "WorkspaceDateTimePickerBlock",
          label: "Starts",
          blockId: "startsAt",
          initialValue: initialValue,
        } as WorkspaceDateTimePickerBlock,
      });

      return (block["element"] as JSONObject)["initial_date_time"];
    };

    expect(opensOn("2026-10-15T09:30:00.000Z")).toBe(1792056600);
    expect(opensOn(undefined)).toBeUndefined();
    expect(opensOn("soon")).toBeUndefined();
  });

  test("a pick that opens on its option - the option itself, its text and all, found by its value", () => {
    const element: JSONObject = dropdown({
      label: "Incident Severity",
      blockId: "incidentSeverity",
      options: [
        { label: "Critical", value: "sev-1" },
        { label: "Minor", value: "sev-2" },
      ],
      initialValue: "sev-2",
    })["element"] as JSONObject;

    expect(element["initial_option"]).toEqual({
      text: { type: "plain_text", text: "Minor" },
      value: "sev-2",
    });
  });

  test("a value no option has opens on nothing: Slack refuses an initial option it does not offer", () => {
    const element: JSONObject = dropdown({
      options: [{ label: "Critical", value: "sev-1" }],
      initialValue: "sev-9",
    })["element"] as JSONObject;

    expect(element["initial_option"]).toBeUndefined();
  });

  test("a multi-select opens on its picks, never on one initial option", () => {
    const element: JSONObject = dropdown({
      multiSelect: true,
      options: [
        { label: "eu-west", value: "o0_aaaaaaaa" },
        { label: "us-east", value: "o1_bbbbbbbb" },
      ],
      initialValue: "o0_aaaaaaaa",
      initialValues: ["o1_bbbbbbbb"],
    })["element"] as JSONObject;

    expect(element["initial_option"]).toBeUndefined();
    expect(element["initial_options"]).toEqual([
      { text: { type: "plain_text", text: "us-east" }, value: "o1_bbbbbbbb" },
    ]);
  });

  test("the form's values, as Slack sends them back: a day as written, a moment as a Date, a number as text", () => {
    const values: Record<string, unknown> = SlackUtil.getValuesFromView({
      view: {
        state: {
          values: {
            customField_cleared: {
              customField_cleared: { type: "datepicker", selected_date: null },
            },
          },
        },
      },
    });

    // A day picked and then cleared is sent - as nothing - so it is cleared.
    expect(Object.keys(values)).toEqual(["customField_cleared"]);
    expect(values["customField_cleared"]).toBeUndefined();

    expect(
      SlackUtil.getValuesFromView({
        view: {
          state: {
            values: {
              customField_due: {
                customField_due: {
                  type: "datepicker",
                  selected_date: "2026-10-20",
                },
              },
              customField_started: {
                customField_started: {
                  type: "datetimepicker",
                  selected_date_time: 1792056600,
                },
              },
              customField_users: {
                customField_users: { type: "number_input", value: "12.5" },
              },
              customField_cleared: {
                customField_cleared: {
                  type: "datepicker",
                  selected_date: null,
                },
              },
            },
          },
        },
      }),
    ).toEqual({
      customField_due: "2026-10-20",
      customField_started: new Date("2026-10-15T09:30:00.000Z"),
      customField_users: "12.5",
      customField_cleared: undefined,
    });
  });

  test("a form's blocks: each kind of field is drawn, none dropped", () => {
    const blocks: Array<JSONObject> =
      SlackUtil.getBlocksFromWorkspaceMessagePayload({
        messageBlocks: [
          {
            _type: "WorkspaceDatePickerBlock",
            label: "Due",
            blockId: "customField_due",
          } as WorkspaceDatePickerBlock,
          {
            _type: "WorkspaceNumberInputBlock",
            label: "Affected Users",
            blockId: "customField_users",
          } as WorkspaceNumberInputBlock,
        ],
      });

    expect(
      blocks.map((block: JSONObject): unknown => {
        return (block["element"] as JSONObject)["type"];
      }),
    ).toEqual(["datepicker", "number_input"]);
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
