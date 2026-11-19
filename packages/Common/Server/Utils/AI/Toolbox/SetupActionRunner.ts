import {
  AIActionSentence,
  describeAIActionSentence,
} from "../../../../Types/AI/AIActionWords";
import { AIToolRefusal } from "../../../../Types/AI/AIChatTypes";
import {
  SETUP_ACTIONS_RUN_OUTSIDE_CHAT,
  SetupActionRunResult,
  isSetupActionRunOutsideChat,
} from "../../../../Types/AI/AISetupActions";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ConflictException from "../../../../Types/Exception/ConflictException";
import Exception from "../../../../Types/Exception/Exception";
import ForbiddenException from "../../../../Types/Exception/ForbiddenException";
import PaymentRequiredException from "../../../../Types/Exception/PaymentRequiredException";
import { JSONObject } from "../../../../Types/JSON";
import logger from "../../Logger";
import AIToolbox, { ToolCallOutcome } from "./Index";
import {
  ObservabilityTool,
  PreparedMutation,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";

/*
 * ASK AI'S SETUP ACTIONS, ONE CALL EACH, OUTSIDE THE CHAT (#7241).
 *
 * The MCP server offers Ask AI's setup actions as tools of its own: "set up
 * website monitoring for example.com", "set up paging", "publish a status
 * page with these monitors", "add these monitors to that page", and "who
 * is told when it goes down". It runs them here, through the API
 * (Server/API/SetupActionAPI), with the very tools Ask AI runs - nothing of
 * what they read, check or make is written twice:
 *
 *   1. prepareMutation, as Ask AI's turn prepares a call before its card:
 *      the names it was handed resolved to the project's records, as the
 *      person, and what it will do in the card's words;
 *   2. AIToolbox.checkBeforeApproval, the checks Ask AI makes before a
 *      setup action's card is shown: the request is this project's, a
 *      person is signed in, they hold the permissions, the products are
 *      on, and the action's own check of what is missing (an address, a
 *      monitor that checks it already, paging the project has already, the
 *      plan's room). A refusal is thrown, with what is needed;
 *   3. AIToolbox.executeTool, as an approved card runs it: the same gates
 *      again, then the guided setups' records, written as the person
 *      (ToolboxWritesAsThePersonGuard).
 *
 * There is no approval card: an MCP client asks the person before a tool
 * that changes something, by itself, and the tool's description says what
 * it makes. The result says what was made in the card's words instead.
 *
 * Every write acts for a signed-in person, as Ask AI's do - the monitor is
 * theirs, a policy pages them - so a project API key is refused a setup
 * action, in words that say so; who_is_told only reads, and answers a key
 * too. A connection authorized as read-only is refused every setup action
 * before anything is read for it.
 */

// How a setup action's own check begins, before a card - and here instead.
const NOTHING_PROPOSED: string = "Nothing proposed:";
const NOTHING_SET_UP: string = "Nothing was set up:";

// The connection may read and not write: nothing is set up for it.
export const READ_ONLY_CONNECTION_REFUSAL: string =
  "This connection was authorized as read-only, and setting things up makes changes. Connect again with read and write access to set things up.";

// A project API key: setting things up acts as a person.
export const API_KEY_REFUSAL: (action: string) => string = (
  action: string,
): string => {
  return `${action} acts as the person who is signed in, as Ask AI's setup actions do: they own the monitor, and they are paged. A project API key is not a person, so it cannot set things up. Sign in to OneUptime from your MCP client instead, or create the records one by one with the create tools.`;
};

export default class SetupActionRunner {
  public static async run(data: {
    action: string;
    args: unknown;
    ctx: ToolContext;
  }): Promise<SetupActionRunResult> {
    if (!isSetupActionRunOutsideChat(data.action)) {
      throw new BadDataException(
        `Unknown setup action "${data.action}". It is one of: ${SETUP_ACTIONS_RUN_OUTSIDE_CHAT.join(", ")}.`,
      );
    }

    const tool: ObservabilityTool | undefined = AIToolbox.getToolByName(
      data.action,
    );

    if (!tool) {
      throw new BadDataException(`Unknown setup action "${data.action}".`);
    }

    if (
      data.args === null ||
      data.args === undefined ||
      typeof data.args !== "object" ||
      Array.isArray(data.args)
    ) {
      throw new BadDataException(
        `The arguments of ${data.action} must be a JSON object.`,
      );
    }

    const ctx: ToolContext = { ...data.ctx, isOutsideChat: true };

    if (tool.isMutation) {
      if (ctx.props.isReadOnlyCredential) {
        throw new ForbiddenException(READ_ONLY_CONNECTION_REFUSAL);
      }

      if (!ctx.props.userId && !ctx.props.isRoot) {
        throw new ForbiddenException(API_KEY_REFUSAL(data.action));
      }
    }

    let args: JSONObject = data.args as JSONObject;
    let title: AIActionSentence | undefined = undefined;
    let description: Array<AIActionSentence> = [];

    // What runs is what was prepared, as on Ask AI's card.
    if (tool.isMutation && tool.prepareMutation) {
      try {
        const prepared: PreparedMutation = await tool.prepareMutation(args, {
          ...ctx,
          plannedCalls: [{ name: data.action, arguments: args }],
        });

        args = prepared.arguments;
        title = prepared.title;
        description = prepared.description || [];
      } catch (error) {
        // As Ask AI's turn: it runs with the arguments as given.
        logger.error(
          `Setup action ${data.action} could not be prepared; it runs with the arguments as given: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    if (!title && tool.buildActionTitle) {
      title = tool.buildActionTitle(args);
    }

    // Nothing is made that would be refused, or that is missing something.
    const refused: ToolCallOutcome | null = await AIToolbox.checkBeforeApproval(
      {
        name: data.action,
        args: args,
        ctx: {
          ...ctx,
          plannedCalls: [{ name: data.action, arguments: args }],
        },
      },
    );

    if (refused) {
      throw this.toException(refused);
    }

    const outcome: ToolCallOutcome = await AIToolbox.executeTool({
      name: data.action,
      args: args,
      ctx: ctx,
    });

    if (!outcome.success || !outcome.result) {
      throw this.toException(outcome);
    }

    const result: ToolExecutionResult = outcome.result;

    return {
      action: data.action,
      ...(title && tool.isMutation
        ? { title: describeAIActionSentence(title) }
        : {}),
      details: description.map((sentence: AIActionSentence): string => {
        return describeAIActionSentence(sentence);
      }),
      message: result.dataForLlm,
      ...(result.citationTarget
        ? {
            record: {
              type: result.citationTarget.type,
              params: { ...(result.citationTarget.params || {}) },
            },
          }
        : {}),
    };
  }

  /*
   * A refusal or a failure as the error the API answers with: its status
   * says what kind - 403 a permission, a team's block, a switched-off
   * product or a caller who is not this project's person; 402 the plan;
   * 409 a record that moved on before it ran; 400 anything else, what is
   * missing included - and its message what is needed.
   */
  public static toException(outcome: ToolCallOutcome): Exception {
    const message: string = this.describeOutcome(outcome);

    switch (outcome.refusal) {
      case AIToolRefusal.Plan:
        return new PaymentRequiredException(message);
      case AIToolRefusal.ProductOff:
      case AIToolRefusal.Permission:
      case AIToolRefusal.TeamBlock:
      case AIToolRefusal.NotAllowed:
        return new ForbiddenException(message);
      default:
        break;
    }

    // executeTool's words for a ConflictException: the record moved on.
    if (
      outcome.errorMessage &&
      outcome.textForLlm === `Not done: ${outcome.errorMessage}`
    ) {
      return new ConflictException(message);
    }

    return new BadDataException(message);
  }

  /*
   * What the agent reads of a refusal: the words Ask AI's model is told,
   * which say what is needed and who can change it - with nothing
   * "proposed", since outside the chat there is no card to propose.
   */
  public static describeOutcome(outcome: ToolCallOutcome): string {
    const text: string = (
      outcome.textForLlm ||
      outcome.errorMessage ||
      "Not done."
    ).trim();

    return text.startsWith(NOTHING_PROPOSED)
      ? `${NOTHING_SET_UP}${text.substring(NOTHING_PROPOSED.length)}`
      : text;
  }
}
