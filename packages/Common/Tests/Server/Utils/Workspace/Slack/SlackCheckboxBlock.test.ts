import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import logger from "../../../../../Server/Utils/Logger";
import SlackUtil from "../../../../../Server/Utils/Workspace/Slack/Slack";
import { JSONObject } from "../../../../../Types/JSON";
import {
  WORKSPACE_CHECKBOX_TICKED_VALUE,
  WorkspaceCheckboxBlock,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";

/*
 * A BOX TO TICK IN A SLACK FORM (#7917).
 *
 * Declare Incident's Notify Status Page Subscribers is the first checkbox a
 * Slack form shows. Before it, a checkbox could not have shown at all: the
 * shared block dispatcher had no case for it and dropped it with an error,
 * and its block had no block_id, no optional flag - Slack refuses to submit
 * a required box left unticked - and the same words above the box and
 * beside it. These pin the block Slack is sent.
 */

let errorSpy: SpyInstance<typeof logger.error>;

beforeEach(() => {
  jest.spyOn(logger, "debug").mockImplementation((): void => {});
  errorSpy = jest.spyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

const NOTIFY_BOX: WorkspaceCheckboxBlock = {
  _type: "WorkspaceCheckboxBlock",
  label: "Status Page Subscribers",
  optionLabel: "Notify Status Page Subscribers",
  blockId: "notifyStatusPageSubscribers",
  initialValue: true,
  description:
    "Should status page subscribers be notified when this incident is created?",
  optional: true,
};

const NOTIFY_OPTION: JSONObject = {
  text: { type: "plain_text", text: "Notify Status Page Subscribers" },
  value: WORKSPACE_CHECKBOX_TICKED_VALUE,
};

describe("SlackUtil.getCheckboxBlock", () => {
  test("ticked: named for its submission, optional, its own words beside the box, the field's name above and its help under it", () => {
    expect(
      SlackUtil.getCheckboxBlock({ payloadCheckboxBlock: NOTIFY_BOX }),
    ).toEqual({
      type: "input",
      block_id: "notifyStatusPageSubscribers",
      optional: true,
      element: {
        type: "checkboxes",
        action_id: "notifyStatusPageSubscribers",
        options: [NOTIFY_OPTION],
        initial_options: [NOTIFY_OPTION],
      },
      label: { type: "plain_text", text: "Status Page Subscribers" },
      hint: {
        type: "plain_text",
        text: "Should status page subscribers be notified when this incident is created?",
      },
    });
  });

  test("unticked: no option is ticked as it opens", () => {
    const block: JSONObject = SlackUtil.getCheckboxBlock({
      payloadCheckboxBlock: { ...NOTIFY_BOX, initialValue: false },
    });

    expect(block["element"] as JSONObject).not.toHaveProperty(
      "initial_options",
    );
  });

  test("with no words of its own, the field's name goes beside the box too; with no help, no hint", () => {
    const block: JSONObject = SlackUtil.getCheckboxBlock({
      payloadCheckboxBlock: {
        _type: "WorkspaceCheckboxBlock",
        label: "Notify subscribers",
        blockId: "notify",
      },
    });

    expect(block).toEqual({
      type: "input",
      block_id: "notify",
      optional: false,
      element: {
        type: "checkboxes",
        action_id: "notify",
        options: [
          {
            text: { type: "plain_text", text: "Notify subscribers" },
            value: WORKSPACE_CHECKBOX_TICKED_VALUE,
          },
        ],
      },
      label: { type: "plain_text", text: "Notify subscribers" },
    });
  });
});

describe("a form's blocks", () => {
  test("a checkbox is drawn where it stands among the other fields, and nothing is dropped", () => {
    const blocks: Array<JSONObject> =
      SlackUtil.getBlocksFromWorkspaceMessagePayload({
        messageBlocks: [
          {
            _type: "WorkspaceTextBoxBlock",
            label: "Incident Title",
            blockId: "incidentTitle",
            placeholder: "Incident Title",
          } as never,
          NOTIFY_BOX,
          {
            _type: "WorkspaceTextAreaBlock",
            label: "Incident Description",
            blockId: "incidentDescription",
            placeholder: "Incident Description",
          } as never,
        ],
      });

    expect(
      blocks.map((block: JSONObject): string => {
        return String(block["block_id"]);
      }),
    ).toEqual([
      "incidentTitle",
      "notifyStatusPageSubscribers",
      "incidentDescription",
    ]);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test("a submitted box is read as its ticked options: its one option, or none", () => {
    const values: JSONObject = SlackUtil.getValuesFromView({
      view: {
        state: {
          values: {
            notifyStatusPageSubscribers: {
              notifyStatusPageSubscribers: {
                type: "checkboxes",
                selected_options: [NOTIFY_OPTION],
              },
            },
            otherBox: {
              otherBox: { type: "checkboxes", selected_options: [] },
            },
          },
        },
      },
    }) as JSONObject;

    expect(values["notifyStatusPageSubscribers"]).toEqual([
      WORKSPACE_CHECKBOX_TICKED_VALUE,
    ]);
    expect(values["otherBox"]).toEqual([]);
  });
});
