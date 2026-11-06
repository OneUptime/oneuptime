import crypto from "crypto";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import TokenSigningKey from "../../TokenSigningKey";
import MattermostConnection from "./MattermostConnection";

/*
 * WHAT A PRESS OF A MATTERMOST BUTTON CARRIES.
 *
 * A button on a Mattermost message is an "integration action": Mattermost
 * keeps a URL and a `context` OneUptime gave it, and when somebody presses
 * the button the Mattermost server POSTs that context - with who pressed,
 * in which team, channel and post - to the URL. Mattermost signs nothing:
 * whoever can reach OneUptime's URL could POST any user id and any context.
 *
 * So the context is signed. OneUptime writes it as it posts the message,
 * with the action, its value and the team the message is posted in, and an
 * HMAC of them under a key derived for this purpose alone from the
 * installation's signing key (TokenSigningKey.deriveKey). A press is acted
 * on only when its context verifies and names the team the press came
 * from. Mattermost never shows a post's integration context to the people
 * reading it (it strips it before a post leaves the server), so a context
 * can only come from the Mattermost server OneUptime posted to.
 *
 * What a press may then do is decided again when it is acted on: whose
 * Mattermost account pressed, which OneUptime member that is, and what that
 * member may do in the project of the record the action is about.
 *
 * A menu (Mattermost's "select" action: the actions fewer people need)
 * carries several actions in one context. Mattermost adds the chosen
 * option's value to the context as `selected_option`, which is only an
 * index into the signed list.
 *
 * A form (an interactive dialog) carries its context in the dialog's
 * `state`, a string Mattermost hands back with the submission: the same
 * fields, as a signed token (toDialogState / readDialogState).
 */
export interface MattermostAction {
  // The action, by the ids Slack and Microsoft Teams press: AcknowledgeIncident.
  actionId: string;
  // What it acts on: the incident's id.
  value: string;
}

export interface MattermostSignedActions {
  teamId: string;
  actions: Array<MattermostAction>;
}

// What Mattermost hands back: the context OneUptime wrote, and what was chosen.
export interface MattermostPressedAction extends MattermostAction {
  teamId: string;
}

const CONTEXT_VERSION: number = 1;

// A menu option's value: its place in the menu.
const OPTION_INDEX_PATTERN: RegExp = /^\d{1,3}$/;

const SIGNING_KEY_LABEL: string = "mattermost-integration-action-context";

// The most actions one context (one menu) carries.
export const MAX_ACTIONS_PER_CONTEXT: number = 25;

// The longest action id and value a context carries; ids and values are short.
const MAX_ACTION_ID_LENGTH: number = 100;
const MAX_ACTION_VALUE_LENGTH: number = 2000;

export default class MattermostActionContext {
  /*
   * The context of a button (one action) or a menu (several): what
   * Mattermost keeps with the action and POSTs back when it is pressed.
   */
  public static toContext(data: MattermostSignedActions): JSONObject {
    const actions: Array<MattermostAction> = MattermostActionContext.check(
      data.actions,
    );

    const teamId: string = MattermostConnection.assertMattermostId(
      data.teamId,
      "team",
    );

    return {
      v: CONTEXT_VERSION,
      teamId: teamId,
      actions: actions.map((action: MattermostAction): JSONObject => {
        return { actionId: action.actionId, value: action.value };
      }),
      signature: MattermostActionContext.sign({
        teamId: teamId,
        actions: actions,
      }),
    };
  }

  /*
   * The action a press is for, read from the context Mattermost POSTed:
   * null when the context is not one OneUptime signed, was signed for
   * another team, or names an option it does not hold.
   */
  public static readPress(data: {
    context: unknown;
    // The team Mattermost says the press came from.
    teamId: unknown;
  }): MattermostPressedAction | null {
    if (
      !data.context ||
      typeof data.context !== "object" ||
      Array.isArray(data.context)
    ) {
      return null;
    }

    const context: JSONObject = data.context as JSONObject;

    const signed: MattermostSignedActions | null =
      MattermostActionContext.readSigned({
        version: context["v"],
        teamId: context["teamId"],
        actions: context["actions"],
        signature: context["signature"],
      });

    if (!signed) {
      return null;
    }

    if (signed.teamId !== data.teamId) {
      return null;
    }

    let action: MattermostAction | undefined = undefined;

    if (signed.actions.length === 1) {
      action = signed.actions[0];
    } else {
      // A menu: the option chosen is the place of its action in the list.
      const selectedOption: JSONValue | undefined = context["selected_option"];
      const index: number =
        typeof selectedOption === "string" &&
        OPTION_INDEX_PATTERN.test(selectedOption)
          ? parseInt(selectedOption, 10)
          : -1;

      action = index >= 0 ? signed.actions[index] : undefined;
    }

    if (!action) {
      return null;
    }

    return {
      teamId: signed.teamId,
      actionId: action.actionId,
      value: action.value,
    };
  }

  /*
   * A form's context, as the `state` of the interactive dialog it opens:
   * Mattermost hands it back with the form's submission.
   */
  public static toDialogState(data: MattermostPressedAction): string {
    const context: JSONObject = MattermostActionContext.toContext({
      teamId: data.teamId,
      actions: [{ actionId: data.actionId, value: data.value }],
    });

    return Buffer.from(JSON.stringify(context), "utf8").toString("base64url");
  }

  // The form a submission is for, from its `state`, or null.
  public static readDialogState(data: {
    state: unknown;
    teamId: unknown;
  }): MattermostPressedAction | null {
    if (typeof data.state !== "string" || !data.state) {
      return null;
    }

    let context: unknown;

    try {
      context = JSON.parse(
        Buffer.from(data.state, "base64url").toString("utf8"),
      );
    } catch {
      return null;
    }

    if (
      !context ||
      typeof context !== "object" ||
      Array.isArray(context) ||
      ((context as JSONObject)["actions"] as Array<JSONValue> | undefined)
        ?.length !== 1
    ) {
      return null;
    }

    return MattermostActionContext.readPress({
      context: context,
      teamId: data.teamId,
    });
  }

  private static readSigned(data: {
    version: unknown;
    teamId: unknown;
    actions: unknown;
    signature: unknown;
  }): MattermostSignedActions | null {
    if (data.version !== CONTEXT_VERSION) {
      return null;
    }

    if (!MattermostConnection.isMattermostId(data.teamId)) {
      return null;
    }

    if (!Array.isArray(data.actions) || typeof data.signature !== "string") {
      return null;
    }

    let actions: Array<MattermostAction>;

    try {
      actions = MattermostActionContext.check(
        data.actions.map((action: unknown): MattermostAction => {
          const json: JSONObject =
            action && typeof action === "object" && !Array.isArray(action)
              ? (action as JSONObject)
              : {};

          return {
            actionId: json["actionId"] as string,
            value: json["value"] as string,
          };
        }),
      );
    } catch {
      return null;
    }

    const expected: string = MattermostActionContext.sign({
      teamId: data.teamId,
      actions: actions,
    });

    if (!MattermostActionContext.signaturesMatch(expected, data.signature)) {
      return null;
    }

    return { teamId: data.teamId, actions: actions };
  }

  // The actions, refused when one could not have been written by toContext.
  private static check(
    actions: Array<MattermostAction>,
  ): Array<MattermostAction> {
    if (actions.length === 0 || actions.length > MAX_ACTIONS_PER_CONTEXT) {
      throw new Error("A Mattermost action context holds 1 to 25 actions.");
    }

    for (const action of actions) {
      if (
        typeof action.actionId !== "string" ||
        !action.actionId ||
        action.actionId.length > MAX_ACTION_ID_LENGTH ||
        typeof action.value !== "string" ||
        action.value.length > MAX_ACTION_VALUE_LENGTH
      ) {
        throw new Error("A Mattermost action is not valid.");
      }
    }

    return actions;
  }

  private static sign(data: MattermostSignedActions): string {
    // One canonical string per context: JSON of fields in a fixed order.
    const payload: string = JSON.stringify([
      CONTEXT_VERSION,
      data.teamId,
      data.actions.map((action: MattermostAction): Array<string> => {
        return [action.actionId, action.value];
      }),
    ]);

    return crypto
      .createHmac("sha256", TokenSigningKey.deriveKey(SIGNING_KEY_LABEL))
      .update(payload, "utf8")
      .digest("base64url");
  }

  private static signaturesMatch(expected: string, given: string): boolean {
    const expectedBuffer: Buffer = Buffer.from(expected, "utf8");
    const givenBuffer: Buffer = Buffer.from(given, "utf8");

    return (
      expectedBuffer.length === givenBuffer.length &&
      crypto.timingSafeEqual(expectedBuffer, givenBuffer)
    );
  }
}
