import {
  AIActionSentence,
  describeAIActionSentence,
} from "../../../../Types/AI/AIActionWords";
import { AIToolRefusal } from "../../../../Types/AI/AIChatTypes";
import {
  SETUP_ACTIONS_RUN_OUTSIDE_CHAT,
  SetupActionRunResult,
  getSetupActionApiKeyRefusal,
  isSetupActionRunOutsideChat,
} from "../../../../Types/AI/AISetupActions";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ConflictException from "../../../../Types/Exception/ConflictException";
import Exception from "../../../../Types/Exception/Exception";
import ForbiddenException from "../../../../Types/Exception/ForbiddenException";
import PaymentRequiredException from "../../../../Types/Exception/PaymentRequiredException";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import logger from "../../Logger";
import AIToolbox, { ToolCallOutcome } from "./Index";
import {
  ObservabilityTool,
  PreparedMutation,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";

/*
 * ASK AI'S SETUP ACTIONS, ONE CALL EACH, OUTSIDE THE CHAT (#7241, #10041).
 *
 * The MCP server offers Ask AI's setup actions as tools of its own: "set up
 * website monitoring for example.com", "monitor the checkout service",
 * "set up paging", "page Ana too", "invite ana@acme.com", "text me, then
 * call me after five minutes", "publish a status page with these
 * monitors", "add these monitors to that page", and "who is told when it
 * goes down". It runs them here, through the API
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
 * theirs, a policy pages them, an invitation names them, How to Reach Me
 * is their own - so a project API key is refused a setup action, in words
 * that say why for that action (getSetupActionApiKeyRefusal); who_is_told
 * only reads, and answers a key too. A connection authorized as read-only
 * is refused every setup action before anything is read for it.
 *
 * A caller hands an action only what its schema takes (#10041): an
 * address, the names of people, a policy and a level. What its prepare
 * works out from them - the records each name stands for, by id, the
 * team an invitation joins, who a level pages already - is the action's
 * own, read as the person, as Ask AI's card shows it before anyone
 * approves it. A key the caller sent beside them is dropped before the
 * prepare reads anything, so where a prepare leaves a key as it was
 * handed, the caller's own id never runs unseen.
 */

// How a setup action's own check begins, before a card - and here instead.
const NOTHING_PROPOSED: string = "Nothing proposed:";
const NOTHING_SET_UP: string = "Nothing was set up:";

// The connection may read and not write: nothing is set up for it.
export const READ_ONLY_CONNECTION_REFUSAL: string =
  "This connection was authorized as read-only, and setting things up makes changes. Connect again with read and write access to set things up.";

/*
 * The arguments of a call that the action's schema takes, and nothing
 * else: what its prepare fills in is never the caller's to hand it.
 */
export function readArgumentsTheSchemaTakes(
  tool: ObservabilityTool,
  args: JSONObject,
): JSONObject {
  const properties: unknown = tool.inputSchema["properties"];
  const taken: JSONObject = {};

  if (!properties || typeof properties !== "object") {
    return taken;
  }

  for (const key of Object.keys(properties as JSONObject)) {
    if (Object.prototype.hasOwnProperty.call(args, key)) {
      taken[key] = args[key] as JSONValue;
    }
  }

  return taken;
}

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
        throw new ForbiddenException(getSetupActionApiKeyRefusal(data.action));
      }
    }

    let args: JSONObject = readArgumentsTheSchemaTakes(
      tool,
      data.args as JSONObject,
    );
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
