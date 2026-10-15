import { JSONObject } from "../../../../Types/JSON";
import {
  SLACK_OVERFLOW_MENU_MAX_ITEMS,
  WorkspaceMessagePayloadButton,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";

/*
 * A MESSAGE'S OVERFLOW MENU (⋯) IN SLACK.
 *
 * Slack draws the actions few people need on a message - Change Severity,
 * Assign Role, Page Someone on an incident - in an overflow menu after its
 * buttons. An overflow menu is one element with one action id, and Slack
 * reports which of its options was chosen by that option's value. So each
 * option's value carries the action it stands for and that action's value
 * (the record's id): a choice is read back as the press of a button with
 * that action id and value (SlackAuthAction), and every handler, the
 * Connect prompt included, takes it as it takes the button.
 *
 * Slack holds at most five options in an overflow menu, of at most 75
 * characters of text and 150 of value each.
 */

// The menu's action id: what Slack reports a choice under.
export const SLACK_OVERFLOW_MENU_ACTION_ID: string = "MoreActions";

// Slack's limits for an option of an overflow menu.
export const SLACK_OVERFLOW_OPTION_TEXT_MAX_LENGTH: number = 75;
export const SLACK_OVERFLOW_OPTION_VALUE_MAX_LENGTH: number = 150;

// Between an option's action id and the action's value.
const SEPARATOR: string = ":";

// A choice of a menu, read back as the press it stands for.
export interface SlackOverflowChoice {
  actionType: string;
  actionValue: string;
}

export default class SlackOverflowMenu {
  // An option's value: the action it stands for, and that action's value.
  public static encode(button: WorkspaceMessagePayloadButton): string {
    return `${button.actionId}${SEPARATOR}${button.value}`;
  }

  /*
   * The press an option's value stands for; null for a value no menu of
   * OneUptime's writes - one without an action id.
   */
  public static decode(value: unknown): SlackOverflowChoice | null {
    if (typeof value !== "string") {
      return null;
    }

    const separator: number = value.indexOf(SEPARATOR);

    if (separator <= 0) {
      return null;
    }

    return {
      actionType: value.substring(0, separator),
      actionValue: value.substring(separator + 1),
    };
  }

  /*
   * The overflow element for an actions block. A menu holds at most five
   * options in Slack, which refuses the whole message for a sixth: one
   * past that is a mistake of whoever built the menu, and is thrown.
   */
  public static getElement(
    buttons: Array<WorkspaceMessagePayloadButton>,
  ): JSONObject {
    if (buttons.length > SLACK_OVERFLOW_MENU_MAX_ITEMS) {
      throw new Error(
        `Slack's overflow menu holds at most ${SLACK_OVERFLOW_MENU_MAX_ITEMS} options, not ${buttons.length}.`,
      );
    }

    return {
      type: "overflow",
      action_id: SLACK_OVERFLOW_MENU_ACTION_ID,
      options: buttons.map((button: WorkspaceMessagePayloadButton) => {
        const value: string = SlackOverflowMenu.encode(button);

        /*
         * Both are OneUptime's own - an action's title, an action id and a
         * record's id - so one too long is a mistake, not a person's text.
         */
        if (value.length > SLACK_OVERFLOW_OPTION_VALUE_MAX_LENGTH) {
          throw new Error(
            `An overflow menu option's value is at most ${SLACK_OVERFLOW_OPTION_VALUE_MAX_LENGTH} characters in Slack.`,
          );
        }

        if (button.title.length > SLACK_OVERFLOW_OPTION_TEXT_MAX_LENGTH) {
          throw new Error(
            `An overflow menu option's text is at most ${SLACK_OVERFLOW_OPTION_TEXT_MAX_LENGTH} characters in Slack.`,
          );
        }

        return {
          text: {
            type: "plain_text",
            text: button.title,
            emoji: true,
          },
          value: value,
        };
      }),
    };
  }
}
