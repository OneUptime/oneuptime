import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import TelemetryReadScopeUtil, {
  TelemetryReadScope,
  TelemetryServiceFilter,
} from "../../Telemetry/TelemetryReadScope";
import LlmConversationPrivacy from "../../LlmObservability/LlmConversationPrivacy";
import OneUptimeDate from "../../../../Types/Date";
import Permission from "../../../../Types/Permission";
import {
  AIChatCitationTarget,
  AIChatWidget,
  AIToolRefusal,
} from "../../../../Types/AI/AIChatTypes";
import { CodeRepositoryAllowance } from "../../../../Types/CodeRepository/CodeRepositoryAllowance";
import { AIChatPageContext } from "../../../../Types/AI/AIChatPageContext";
import { AIActionSentence } from "../../../../Types/AI/AIActionWords";
import { AIChatRecordSeen } from "../../../../Types/AI/AIChatRecordSeen";

/*
 * The execution context for a tool call. projectId is ALWAYS the tenant from
 * the authenticated request props — it is never a tool argument, so the model
 * cannot point a tool at another project.
 */
export interface ToolContext {
  projectId: ObjectID;
  props: DatabaseCommonInteractionProps;
  /*
   * The code repositories this run may read (CodeRepositoryAllowance): an
   * investigation or a fix reads only the ones the rules that matched its
   * incident (or alert) name. Left out - a person's own question - every
   * repository the caller may read. Every code tool finds its repositories
   * through findReadableRepositories, which holds them to it.
   */
  codeRepositoryAllowance?: CodeRepositoryAllowance | undefined;
  /*
   * What the conversation is about: the page Ask AI was asked from, else
   * the subject the conversation kept (ChatAgentRunner.resolvePageContext),
   * or the incident or alert of its shared thread. A hint for the tools
   * that act from a page - an incident declared on a host's page is linked
   * to that host (create_incident) - never a permission: every read and
   * write is still the person's own. Left out where a run has no page:
   * Slack, Microsoft Teams, an autonomous investigation.
   */
  pageContext?: AIChatPageContext | undefined;
  /*
   * What the model had been shown of records it may change when it asked
   * for the call being prepared, oldest first (Types/AI/AIChatRecordSeen):
   * the citations of this turn's earlier results and of the history it
   * replays - never one of a result the call was asked for alongside,
   * which the model had not seen yet. Handed to a prepare only
   * (ChatAgentRunner), so the card can say what the change would undo that
   * was saved since (issue #6291). Never a permission, and never what a
   * change is saved by.
   */
  recordsSeen?: ReadonlyArray<AIChatRecordSeen> | undefined;
  /*
   * The setup actions the model asked for in the same answer as the call
   * being prepared or checked, itself included, in the order it asked
   * (#6829): one plan, approved on one card. A status page that shows a
   * monitor the same plan sets up first names it as new, rather than as a
   * monitor the project does not have. Handed to a prepare and a check
   * only, never to a run: by then the monitor exists, or was skipped.
   */
  plannedCalls?: ReadonlyArray<PlannedToolCall> | undefined;
  /*
   * The language the person reads the Dashboard in, as the request that
   * started or approved the turn said it (ChatTurnRequest.language): one of
   * the codes OneUptime writes in (Types/ReaderLanguage), never anything
   * else. Read by a tool that writes OneUptime's words into a record it
   * makes - a new monitor's criteria names, the incident and alert they
   * open (SetupTools) - so the record is the one the Dashboard would make
   * for this person (#7247). Left out - Slack, Microsoft Teams, an older
   * Dashboard - such a tool falls back to the person's saved language,
   * else English. Never a permission, and never the model's language.
   */
  language?: string | undefined;
}

// A tool call of the answer being prepared (ToolContext.plannedCalls).
export interface PlannedToolCall {
  name: string;
  arguments: JSONObject;
}

/*
 * Why a setup action is not proposed at all (ObservabilityTool.
 * checkBeforeApproval): what is missing - a permission, an address that is
 * not one, monitors the project does not have, paging the project has set
 * up already - said before a card is shown, never after the person approved
 * it.
 */
export interface SetupActionRefusal {
  // What the model is told instead of a card: what is needed, plainly.
  toldModel: string;
  // Set when it is the person's permissions or the project's plan.
  refusal?: AIToolRefusal | undefined;
}

/*
 * A setup action (#6829): it makes something that pages people or that
 * customers see, so it waits for a person's approval in every permission
 * mode, Auto-run included (ChatAgentRunner), and is checked before its card
 * is shown (checkBeforeApproval).
 */
export interface SetupActionInfo {
  /*
   * Where the action runs in its plan once approved, lowest first: who is
   * paged, then what is checked, then where it is shown - so a status page
   * finds the monitor the same plan set up, whatever order the model asked
   * in.
   */
  planOrder: number;
}

/*
 * What a mutation will do, settled before it is shown for approval and run
 * (ObservabilityTool.prepareMutation).
 */
export interface PreparedMutation {
  /*
   * The arguments that run once approved: the model's, with what the tool
   * fills in from the conversation written out, so the person approves
   * exactly what runs.
   */
  arguments: JSONObject;
  /*
   * The approval card's title, when the prepare names the record better
   * than buildActionTitle can from the arguments alone: "Link incident
   * #42 to affected resources", by the number the person knows it by,
   * never its ID. Read with the person's own permissions; left out,
   * buildActionTitle's title stands. A sentence of Types/AI/AIActionWords,
   * which the card says in the reader's language.
   */
  title?: AIActionSentence | undefined;
  /*
   * The approval card's line, under its title, naming what the arguments
   * name by ID: "Linked to host "test01"." - and what the prepare chose
   * for the person, which the argument line, cut at two lines, may hide:
   * "Severity: High." (create_alert). Sentences of Types/AI/AIActionWords,
   * read in that order; read with the person's own permissions. Left out,
   * or empty, the card has no line.
   */
  description?: Array<AIActionSentence> | undefined;
  /*
   * The arguments the title names by name - incidentId, once it says
   * "INC-42" - which the card's line of arguments then leaves out: their
   * IDs would only repeat the title, unreadably.
   */
  namedArguments?: Array<string> | undefined;
  /*
   * The arguments the description says in words - the severity a new
   * incident takes, where it starts - which the card's line of arguments
   * then leaves out: it would only say them again.
   */
  describedArguments?: Array<string> | undefined;
  /*
   * Set when the action would undo what was saved after the model last saw
   * the record - a workflow saved after Ask AI read it (issue #6291), a
   * file pushed to after Ask AI read it (issue #6313) - so it is made only
   * once a person approves it. Asked for approval, the card
   * says so (description). In a conversation that runs actions without
   * asking (Auto-run) nobody would, so it is not run: the model is told
   * this instead, and reads the record again before it changes it.
   */
  notRunWithoutApproval?:
    | {
        // What the model is told instead of the action's result.
        toldModel: string;
        // What the action's record says of it (resultSummary), in English.
        summary: string;
      }
    | undefined;
}

export interface ToolExecutionResult {
  // Serialized, truncated and redacted data that goes into the LLM prompt.
  dataForLlm: string;
  rowCount: number;
  citationLabel: string;
  citationTarget?: AIChatCitationTarget | undefined;
  redactionCount: number;
  isTruncated: boolean;
  /*
   * Optional structured widget (chart, table, trace waterfall, resource card)
   * rendered inline in the chat. Built from the RAW rows the tool fetched — not
   * the redacted LLM payload — because it is rendered back to the same user who
   * already has RBAC access to this data.
   */
  widget?: AIChatWidget | undefined;
  /*
   * What the result showed the model of a record it may change from it
   * later (Types/AI/AIChatRecordSeen): a workflow's steps, read or as Ask AI
   * saved them, or a repository's file on a branch, read or as a commit of
   * Ask AI's own wrote it - a list for a commit's files. Built by the tool
   * from its own read, never from the model's arguments, and kept with the
   * citation (issues #6291 and #6313).
   */
  recordSeen?: AIChatRecordSeen | Array<AIChatRecordSeen> | undefined;
}

export interface ObservabilityTool {
  name: string;
  description: string;
  // JSON Schema for the tool arguments, handed to the LLM.
  inputSchema: JSONObject;
  /*
   * The user must hold at least one of these permissions for the tool to
   * execute. For tools that call permission-checked services this is
   * defense-in-depth; for tools that call raw-SQL aggregation services it is
   * the authorization.
   */
  requiredPermissions: Array<Permission>;
  /*
   * Argument-dependent reads (for example, one infrastructure kind and one
   * telemetry signal) require EVERY group, with alternatives inside a group.
   * Only permissions for the selected arguments participate in block checks.
   * Returning an empty group/list fails closed. The static permissions above
   * remain the default for existing tools and callers without arguments.
   */
  getRequiredPermissionGroups?:
    | ((args: JSONObject) => Array<Array<Permission>>)
    | undefined;
  /*
   * True for tools that MUTATE project data (create/acknowledge/resolve, etc).
   * These are gated by the conversation's permission mode: paused for approval
   * in AskForApproval mode, run immediately in AutoRun, and not offered to the
   * model at all in ReadOnly. Undefined/false = a read-only tool that always
   * runs.
   */
  isMutation?: boolean | undefined;
  /*
   * The approval card's title, derived from the (already validated) tool
   * arguments - "Create incident: Checkout down" - as a sentence of
   * Types/AI/AIActionWords: the card says it in the reader's language, and
   * the action keeps its English for the model and the exports. Every
   * mutation has one (AIActionCardsGuard); the card would otherwise name
   * the tool.
   */
  buildActionTitle?: ((args: JSONObject) => AIActionSentence) | undefined;
  /*
   * For a mutation: what it will do, settled from the conversation before
   * the person approves it (ChatAgentRunner calls it as the model asks for
   * the action, in every permission mode). It writes out what the tool
   * would otherwise fill in when it runs - the page's resource of an
   * incident declared from it - so the approval card and the run agree,
   * and names what the IDs stand for. Reads only, with ctx.props; never
   * throws for the model's mistakes - execute reports those.
   */
  prepareMutation?:
    | ((args: JSONObject, ctx: ToolContext) => Promise<PreparedMutation>)
    | undefined;
  /*
   * Set on Ask AI's setup actions (#6829, SetupTools): they ask for
   * approval in every mode, and run in their plan's order once approved.
   */
  setupAction?: SetupActionInfo | undefined;
  /*
   * For a setup action: why it cannot be proposed, read with the person's
   * props from the prepared arguments, before any card is shown - null
   * when nothing stops it. The toolbox's own gates (the person, the
   * project, the permissions) are checked first
   * (AIToolbox.checkBeforeApproval). Never throws: a read that fails lets
   * the card show, and running the action says what went wrong.
   */
  checkBeforeApproval?:
    | ((
        args: JSONObject,
        ctx: ToolContext,
      ) => Promise<SetupActionRefusal | null>)
    | undefined;
  execute(args: JSONObject, ctx: ToolContext): Promise<ToolExecutionResult>;
}

/*
 * Defensive argument readers. Tool arguments come from the LLM and are
 * untrusted: everything is type-checked, defaulted and clamped.
 */
export class ToolArgs {
  public static getString(args: JSONObject, key: string): string | undefined {
    const value: unknown = args[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    return undefined;
  }

  public static getStringArray(
    args: JSONObject,
    key: string,
  ): Array<string> | undefined {
    const value: unknown = args[key];
    if (Array.isArray(value)) {
      const strings: Array<string> = value.filter((item: unknown) => {
        return typeof item === "string" && item.trim().length > 0;
      }) as Array<string>;
      if (strings.length > 0) {
        return strings;
      }
    }
    return undefined;
  }

  public static getNumber(
    args: JSONObject,
    key: string,
    options: { defaultValue: number; min: number; max: number },
  ): number {
    const value: unknown = args[key];
    let parsed: number = options.defaultValue;

    if (typeof value === "number" && Number.isFinite(value)) {
      parsed = value;
    } else if (typeof value === "string" && value.trim().length > 0) {
      const fromString: number = Number(value);
      if (Number.isFinite(fromString)) {
        parsed = fromString;
      }
    }

    return Math.min(options.max, Math.max(options.min, Math.floor(parsed)));
  }

  public static getBoolean(args: JSONObject, key: string): boolean | undefined {
    const value: unknown = args[key];
    if (typeof value === "boolean") {
      return value;
    }
    if (value === "true") {
      return true;
    }
    if (value === "false") {
      return false;
    }
    return undefined;
  }

  public static getObjectID(
    args: JSONObject,
    key: string,
  ): ObjectID | undefined {
    const value: string | undefined = this.getString(args, key);
    if (!value) {
      return undefined;
    }
    return new ObjectID(value);
  }

  /*
   * Combines the tool's optional serviceId argument with whose telemetry the
   * user may read (TelemetryReadAccess.getScope) into the serviceIds and
   * excludedServiceIds to hand an aggregation service
   * (TelemetryReadScope.toServiceFilter):
   *
   *   - project-wide access: only the requested service, or no filter;
   *   - label / Owned access with no service requested: every service the
   *     user may read;
   *   - a requested service the user may not read: a list that matches
   *     nothing (the no-match sentinel) - NEVER undefined or an empty list,
   *     which the aggregation services read as "the whole project", and
   *     never the user's other services either;
   *   - a block with labels: those services are left out either way.
   */
  public static scopeServiceIds(
    scope: TelemetryReadScope,
    requested: ObjectID | undefined,
  ): TelemetryServiceFilter {
    return TelemetryReadScopeUtil.toServiceFilter(
      scope,
      requested ? [requested] : undefined,
    );
  }

  /*
   * The scope a tool reads spans in, from the one TelemetryReadAccess gave
   * it. A person's run (Ask AI, Slack, Teams) reads with that person's
   * props, which the permission layer already holds to the company AI
   * tools' privacy setting. A system run - an automatic AI investigation,
   * which reads as OneUptime and writes what it finds onto the incident or
   * alert - is root, which that layer leaves alone: its span reads leave
   * out here the services whose chats only owners and admins may read
   * (LlmConversationPrivacy).
   */
  public static async spanScope(
    ctx: ToolContext,
    scope: TelemetryReadScope,
  ): Promise<TelemetryReadScope> {
    if (!ctx.props.isRoot) {
      return scope;
    }

    return await LlmConversationPrivacy.restrictSystemScope({
      scope: scope,
      projectId: ctx.projectId,
    });
  }

  /*
   * Time range for a tool call: explicit ISO startTime/endTime arguments,
   * clamped to a maximum window, defaulting to the last hour.
   */
  public static getTimeRange(
    args: JSONObject,
    options?: { defaultHours?: number; maxDays?: number },
  ): { startTime: Date; endTime: Date } {
    const defaultHours: number = options?.defaultHours ?? 1;
    const maxDays: number = options?.maxDays ?? 30;

    const endTimeString: string | undefined = this.getString(args, "endTime");
    const startTimeString: string | undefined = this.getString(
      args,
      "startTime",
    );

    /*
     * Reject unparseable timestamps instead of silently falling back to the
     * default window — a silent fallback answers a different question than the
     * one asked. Throwing lets the model see the error and retry with a valid
     * ISO 8601 value.
     */
    let endTime: Date = OneUptimeDate.getCurrentDate();
    if (endTimeString) {
      const parsed: Date = new Date(endTimeString);
      if (isNaN(parsed.getTime())) {
        throw new BadDataException(
          `endTime "${endTimeString}" is not a valid ISO 8601 timestamp (e.g. 2024-01-31T14:00:00Z).`,
        );
      }
      endTime = parsed;
    }

    let startTime: Date = OneUptimeDate.addRemoveHours(
      endTime,
      -1 * defaultHours,
    );
    if (startTimeString) {
      const parsed: Date = new Date(startTimeString);
      if (isNaN(parsed.getTime())) {
        throw new BadDataException(
          `startTime "${startTimeString}" is not a valid ISO 8601 timestamp (e.g. 2024-01-31T13:00:00Z).`,
        );
      }
      startTime = parsed;
    }

    if (startTime.getTime() >= endTime.getTime()) {
      throw new BadDataException("startTime must be before endTime.");
    }

    const maxWindowMs: number = maxDays * 24 * 60 * 60 * 1000;
    if (endTime.getTime() - startTime.getTime() > maxWindowMs) {
      startTime = new Date(endTime.getTime() - maxWindowMs);
    }

    return { startTime, endTime };
  }
}

// Shared JSON-Schema fragments for tool input schemas.
export const TimeRangeSchemaProperties: JSONObject = {
  startTime: {
    type: "string",
    description:
      "Start of the time range as an ISO 8601 timestamp. Defaults to one hour before endTime.",
  },
  endTime: {
    type: "string",
    description:
      "End of the time range as an ISO 8601 timestamp. Defaults to now.",
  },
};
