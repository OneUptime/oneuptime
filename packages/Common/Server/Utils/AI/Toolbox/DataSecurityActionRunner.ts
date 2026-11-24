import {
  AIActionEffects,
  AIActionSentence,
  describeAIActionSentence,
} from "../../../../Types/AI/AIActionWords";
import {
  ASKS_IN_EVERY_MODE_REFUSAL_PREFIX,
  DATA_SECURITY_ACTIONS_RUN_OUTSIDE_CHAT,
  DataSecurityActionRunResult,
  getDataSecurityActionApiKeyRefusal,
  isDataSecurityActionRunOutsideChat,
} from "../../../../Types/AI/AIDataSecurityActions";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ForbiddenException from "../../../../Types/Exception/ForbiddenException";
import { JSONObject } from "../../../../Types/JSON";
import logger from "../../Logger";
import { getDataSecurityPageUrl } from "../../DataSecurity/DataSecurityPages";
import AIToolbox, { ToolCallOutcome } from "./Index";
import SetupActionRunner, {
  readArgumentsTheSchemaTakes,
} from "./SetupActionRunner";
import {
  ObservabilityTool,
  PreparedMutation,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";

/*
 * ASK AI'S DATA SECURITY ACTIONS, ONE CALL EACH, OUTSIDE THE CHAT (#10378).
 *
 * The MCP server offers Ask AI's Data Security actions as tools of its own
 * - scrub a finding, judge one, change an issue, set a store's owners,
 * draft and save a rule from a sentence, respond on a store, Fix with AI,
 * approve or dismiss what OneUptime AI proposes, and read those proposals
 * (#10889). It runs them here, through the API
 * (Server/API/DataSecurityActionAPI), with the very tools Ask AI runs,
 * which call the very server code Data Security's buttons call - nothing of
 * what they read, check or change is written twice:
 *
 *   1. prepareMutation, as Ask AI's turn prepares a call before its card:
 *      what the call names, read as the person, and what it will change,
 *      what stops working and what it costs, in the card's words;
 *   2. AIToolbox.checkBeforeApproval, the checks Ask AI makes before the
 *      card is shown: the request is this project's, a person is signed
 *      in, they hold the permissions, Data Security is on, and the
 *      action's own check of what is missing or changed since;
 *   3. AIToolbox.asksInEveryMode: an action Ask AI asks about in every
 *      mode, Auto-run included - a response on a store, a finding marked
 *      not sensitive, a risk accepted, a rule from a sentence, a proposal
 *      approved or dismissed, a scrub that would blind what reads the
 *      attribute - is refused here. An MCP client asks its person before a
 *      tool that changes something only if it chooses to, and OneUptime
 *      cannot tell whether it did: there is no card here to wait on. The
 *      refusal says why, in the card's words, and the page in OneUptime
 *      where the person does it - its button, or Ask AI on that page.
 *      Nothing is changed;
 *   4. AIToolbox.executeTool, as an approved card runs it: the same gates
 *      again, then the button's own server code, as the person
 *      (ToolboxWritesAsThePersonGuard).
 *
 * Every change acts for a signed-in person, as Ask AI's do, so a project
 * API key is refused one, in words that say why; the two reads answer a
 * key. A connection authorized as read-only is refused every change before
 * anything is read for it.
 *
 * A caller hands an action only what its schema takes, as with the setup
 * actions (#10041): what its prepare works out - the findings like one a
 * decision also settles, the plan a fix was shown, the stores a rule
 * matches - is the action's own, read as the person.
 */

// The connection may read and not write: nothing is changed for it.
export const READ_ONLY_DATA_SECURITY_CONNECTION_REFUSAL: string =
  "This connection was authorized as read-only, and this changes Data Security. Connect again with read and write access to change it.";

/*
 * Why an action that asks in every mode is refused outside the chat, and
 * where to do it: the card's reason, then the page. Its opening is
 * ASKS_IN_EVERY_MODE_REFUSAL_PREFIX, which the MCP server reads to tell its
 * agent what to do next.
 */
export function getAsksInEveryModeRefusal(data: {
  action: string;
  reason: string | undefined;
  pageUrl: string | null;
}): string {
  const reason: string = data.reason ? ` ${data.reason}` : "";
  const where: string = data.pageUrl
    ? ` Do it in OneUptime, on ${data.pageUrl}, with the page's own button or with Ask AI there, which shows the change on a card for the person to approve.`
    : " Do it in OneUptime, with Data Security's own button or with Ask AI, which shows the change on a card for the person to approve.";

  return `${ASKS_IN_EVERY_MODE_REFUSAL_PREFIX}${reason} An MCP client shows no card OneUptime can wait on, so ${data.action} is not run here.${where}`;
}

// A card's sentences, in English.
function inEnglish(
  sentences: Array<AIActionSentence> | undefined,
): Array<string> {
  return (sentences || []).map((sentence: AIActionSentence): string => {
    return describeAIActionSentence(sentence);
  });
}

export default class DataSecurityActionRunner {
  public static async run(data: {
    action: string;
    args: unknown;
    ctx: ToolContext;
  }): Promise<DataSecurityActionRunResult> {
    if (!isDataSecurityActionRunOutsideChat(data.action)) {
      throw new BadDataException(
        `Unknown Data Security action "${data.action}". It is one of: ${DATA_SECURITY_ACTIONS_RUN_OUTSIDE_CHAT.join(", ")}.`,
      );
    }

    const tool: ObservabilityTool | undefined = AIToolbox.getToolByName(
      data.action,
    );

    if (!tool) {
      throw new BadDataException(
        `Unknown Data Security action "${data.action}".`,
      );
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
        throw new ForbiddenException(
          READ_ONLY_DATA_SECURITY_CONNECTION_REFUSAL,
        );
      }

      if (!ctx.props.userId && !ctx.props.isRoot) {
        throw new ForbiddenException(
          getDataSecurityActionApiKeyRefusal(data.action),
        );
      }
    }

    let args: JSONObject = readArgumentsTheSchemaTakes(
      tool,
      data.args as JSONObject,
    );
    let prepared: PreparedMutation | undefined = undefined;

    // What runs is what was prepared, as on Ask AI's card.
    if (tool.isMutation && tool.prepareMutation) {
      try {
        prepared = await tool.prepareMutation(args, ctx);
        args = prepared.arguments;
      } catch (error) {
        // As Ask AI's turn: it runs with the arguments as given, if it runs.
        logger.error(
          `Data Security action ${data.action} could not be prepared: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    const title: AIActionSentence | undefined =
      prepared?.title ||
      (tool.isMutation && tool.buildActionTitle
        ? tool.buildActionTitle(args)
        : undefined);

    // Nothing is changed that would be refused, or that is missing something.
    const refused: ToolCallOutcome | null = await AIToolbox.checkBeforeApproval(
      { name: data.action, args, ctx },
    );

    if (refused) {
      throw SetupActionRunner.toException(refused);
    }

    /*
     * An action Ask AI asks about in every mode is not run where nobody can
     * be asked: refused, with why and where - the person's own permissions
     * were checked first, so the refusal never sends them to a page whose
     * button they may not press.
     */
    if (AIToolbox.asksInEveryMode({ name: data.action, args, prepared })) {
      const reason: AIActionSentence | undefined =
        prepared?.effects?.asksBecause;

      throw new ForbiddenException(
        getAsksInEveryModeRefusal({
          action: data.action,
          reason: reason ? describeAIActionSentence(reason) : undefined,
          pageUrl: getDataSecurityPageUrl({
            projectId: ctx.projectId,
            target: prepared?.buttonPage,
          }),
        }),
      );
    }

    const outcome: ToolCallOutcome = await AIToolbox.executeTool({
      name: data.action,
      args,
      ctx,
    });

    if (!outcome.success || !outcome.result) {
      throw SetupActionRunner.toException(outcome);
    }

    const result: ToolExecutionResult = outcome.result;
    const effects: AIActionEffects = prepared?.effects || {};

    return {
      action: data.action,
      ...(title && tool.isMutation
        ? { title: describeAIActionSentence(title) }
        : {}),
      details: inEnglish(prepared?.description),
      changes: inEnglish(effects.changes),
      stopsWorking: inEnglish(effects.stopsWorking),
      costs: inEnglish(effects.costs),
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
}
