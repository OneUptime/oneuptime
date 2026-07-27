import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { Blue500 } from "../../../../Types/BrandColors";
import AIRemediationActionType from "../../../../Types/AI/AIRemediationActionType";
import AIRemediationActionStatus from "../../../../Types/AI/AIRemediationActionStatus";
import AIRemediationDecisionMode from "../../../../Types/AI/AIRemediationDecisionMode";
import { RunbookStep } from "../../../../Types/Runbook/RunbookStep";
import AIRemediationAction from "../../../../Models/DatabaseModels/AIRemediationAction";
import Project from "../../../../Models/DatabaseModels/Project";
import Runbook from "../../../../Models/DatabaseModels/Runbook";
import RunbookAgent from "../../../../Models/DatabaseModels/RunbookAgent";
import { IncidentFeedEventType } from "../../../../Models/DatabaseModels/IncidentFeed";
import { AlertFeedEventType } from "../../../../Models/DatabaseModels/AlertFeed";
import AIService, {
  AILogResponse,
  AI_REMEDIATION_PROPOSAL_FEATURE,
} from "../../../Services/AIService";
import ProjectService from "../../../Services/ProjectService";
import RunbookService from "../../../Services/RunbookService";
import RunbookAgentService from "../../../Services/RunbookAgentService";
import AIRemediationActionService from "../../../Services/AIRemediationActionService";
import IncidentFeedService from "../../../Services/IncidentFeedService";
import AlertFeedService from "../../../Services/AlertFeedService";
import AIConfidenceSignal, { ConfidenceSignal } from "./ConfidenceSignal";
import RemediationPolicy, {
  MAX_ACTIONS_PER_RUN,
  MAX_COMMAND_SCRIPT_CHARS,
  MAX_RATIONALE_CHARS,
  MAX_TITLE_CHARS,
  PROPOSAL_TTL_HOURS,
  RunbookAutonomyProfile,
} from "./RemediationPolicy";
import RemediationExecutor from "./RemediationExecutor";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * AI SRE — the remediation proposer.
 *
 * Called from both investigation runners' postAnalysis AFTER the RCA post
 * and the instrumentation trigger, inside its own try/catch — a proposal
 * failure can never fail (or duplicate) the investigation. Turns a CONFIDENT
 * completed RCA into 0-3 structured AIRemediationAction rows: "start this
 * existing runbook" or "run this command on that agent", each waiting for
 * the policy gate's decision mode (approval-first; auto-execution only for
 * non-production runbook actions on opted-in projects).
 *
 * The threat model (vision §6) shapes everything here:
 *   - Gates BEFORE the LLM spend: only a POSITIVE confident classification
 *     proposes (AIConfidenceSignal.shouldProposeRemediation — inconclusive
 *     or classifier-failed runs propose NOTHING), and only when the project
 *     enabled the lane (RemediationPolicy.isLaneEnabledForProject).
 *   - The target lists are SERVER-FETCHED allowlists: up to 25 enabled
 *     runbooks and the project's runbook agents. The model may only
 *     reference ids from those lists — parseProposals DROPS anything else,
 *     so adversarial telemetry steering the prose cannot mint targets.
 *   - ONE constrained call (temperature 0, small token cap, strict-JSON
 *     reply, no content previews persisted), metered under
 *     AI_REMEDIATION_PROPOSAL_FEATURE — an AUTONOMOUS_AI_FEATURES member,
 *     so the G4 daily token budget covers it.
 *   - Parsing NEVER throws; any malformed reply degrades to "no proposals".
 */

// Truncation cap keeps the proposal call cheap and inside context limits.
const MAX_ANALYSIS_CHARS: number = 8000;

// Runbook target-list caps: ids/names/descriptions the prompt carries.
const MAX_RUNBOOKS_IN_PROMPT: number = 25;
const MAX_RUNBOOK_DESCRIPTION_PROMPT_CHARS: number = 200;

// Agents are small rows; a project has few. Bounded for prompt sanity.
const MAX_AGENTS_IN_PROMPT: number = 50;

export interface ParsedRemediationProposal {
  actionType: AIRemediationActionType;
  title: string;
  rationale: string;
  // Runbook actions: an id from the server-fetched runbook allowlist.
  runbookId?: string | undefined;
  // Command actions: an id from the server-fetched agent allowlist.
  runbookAgentId?: string | undefined;
  // Command actions: the drafted script, capped at MAX_COMMAND_SCRIPT_CHARS.
  commandScript?: string | undefined;
}

export interface ProposalAllowlists {
  runbookIdAllowlist: Array<string>;
  agentIdAllowlist: Array<string>;
}

export default class RemediationProposer {
  /*
   * Defensive parse of the model's reply (pure, exported for tests). The
   * prompt demands a strict JSON array, but models editorialize — strip
   * accidental code fences, JSON.parse inside try/catch, validate every
   * field's type, DROP entries referencing ids outside the server-fetched
   * allowlists (prompt injection cannot mint targets), truncate title and
   * rationale, DROP over-long scripts (truncating a script could change
   * what it does — the one field where truncation is more dangerous than
   * dropping), and cap the count. NEVER throws; any failure → [].
   */
  public static parseProposals(
    raw: string | null | undefined,
    allowlists: ProposalAllowlists,
  ): Array<ParsedRemediationProposal> {
    if (!raw) {
      return [];
    }

    let text: string = raw.trim();

    // Strip accidental markdown code fences (```json ... ``` or ``` ... ```).
    if (text.startsWith("```")) {
      text = text.replace(/^```[a-zA-Z]*\s*/, "").replace(/```\s*$/, "");
      text = text.trim();
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return [];
    }

    if (!Array.isArray(parsed)) {
      return [];
    }

    const runbookIds: Set<string> = new Set(allowlists.runbookIdAllowlist);
    const agentIds: Set<string> = new Set(allowlists.agentIdAllowlist);

    const proposals: Array<ParsedRemediationProposal> = [];

    for (const entry of parsed) {
      if (proposals.length >= MAX_ACTIONS_PER_RUN) {
        break;
      }

      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        continue;
      }

      const record: Record<string, unknown> = entry as Record<string, unknown>;

      const type: unknown = record["type"];
      const rawTitle: unknown = record["title"];
      const rawRationale: unknown = record["rationale"];

      if (
        typeof type !== "string" ||
        typeof rawTitle !== "string" ||
        typeof rawRationale !== "string"
      ) {
        continue;
      }

      const title: string = rawTitle.trim().substring(0, MAX_TITLE_CHARS);
      const rationale: string = rawRationale
        .trim()
        .substring(0, MAX_RATIONALE_CHARS);

      if (!title || !rationale) {
        continue;
      }

      if (type.toLowerCase() === "runbook") {
        const runbookId: unknown = record["runbookId"];

        // Allowlist enforcement: unknown ids are dropped, never trusted.
        if (typeof runbookId !== "string" || !runbookIds.has(runbookId)) {
          continue;
        }

        proposals.push({
          actionType: AIRemediationActionType.Runbook,
          title,
          rationale,
          runbookId,
        });
        continue;
      }

      if (type.toLowerCase() === "command") {
        const script: unknown = record["script"];
        const runbookAgentId: unknown = record["runbookAgentId"];

        if (typeof script !== "string" || !script.trim()) {
          continue;
        }

        // Over-long scripts are dropped, not truncated (see the header).
        if (script.length > MAX_COMMAND_SCRIPT_CHARS) {
          continue;
        }

        // Allowlist enforcement: unknown agents are dropped, never trusted.
        if (
          typeof runbookAgentId !== "string" ||
          !agentIds.has(runbookAgentId)
        ) {
          continue;
        }

        proposals.push({
          actionType: AIRemediationActionType.Command,
          title,
          rationale,
          runbookAgentId,
          commandScript: script,
        });
        continue;
      }

      // Unknown action type — drop.
    }

    return proposals;
  }

  /*
   * The full proposal flow for a completed investigation. NEVER throws —
   * every failure is logged and swallowed, because this runs inside the
   * investigation's postAnalysis and must not fail it.
   */
  @CaptureSpan()
  public static async proposeForCompletedInvestigation(data: {
    projectId: ObjectID;
    aiRunId: ObjectID;
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
    analysisMarkdown: string;
    confidence: ConfidenceSignal;
  }): Promise<void> {
    const { projectId, aiRunId } = data;

    try {
      if (!data.incidentId && !data.alertId) {
        return;
      }

      /*
       * Gate 1: only a POSITIVE confident classification proposes. Fail
       * direction: inconclusive or classifier-failed → NOTHING (drafting
       * execution from an unverified analysis fails toward doing nothing).
       */
      if (!AIConfidenceSignal.shouldProposeRemediation(data.confidence)) {
        return;
      }

      // Gate 2: the lane opt-in (default off) + the enableAi master switch.
      if (!(await RemediationPolicy.isLaneEnabledForProject(projectId))) {
        return;
      }

      /*
       * Server-fetched allowlists: the ONLY targets the model may reference.
       * Steps ride along because the policy gate needs the autonomy profile
       * of any proposed runbook.
       */
      const runbooks: Array<Runbook> = await RunbookService.findBy({
        query: { projectId, isEnabled: true },
        select: {
          _id: true,
          name: true,
          description: true,
          steps: true,
        },
        sort: { createdAt: SortOrder.Descending },
        limit: MAX_RUNBOOKS_IN_PROMPT,
        skip: 0,
        props: { isRoot: true },
      });

      const agents: Array<RunbookAgent> = await RunbookAgentService.findBy({
        query: { projectId },
        select: {
          _id: true,
          name: true,
          environmentType: true,
          connectionStatus: true,
        },
        sort: { createdAt: SortOrder.Descending },
        limit: MAX_AGENTS_IN_PROMPT,
        skip: 0,
        props: { isRoot: true },
      });

      /*
       * Nothing to target means every proposal would be dropped anyway —
       * skip the LLM spend entirely.
       */
      if (runbooks.length === 0 && agents.length === 0) {
        logger.debug(
          `AI remediation: no runbooks or agents in project ${projectId.toString()} — nothing to propose against.`,
        );
        return;
      }

      const response: AILogResponse = await AIService.executeWithLogging({
        projectId,
        feature: AI_REMEDIATION_PROPOSAL_FEATURE,
        aiRunId,
        // The reply drives writes; no prompt previews in LlmLog.
        storeContentPreviews: false,
        temperature: 0,
        maxTokens: 700,
        messages: [
          {
            role: "system",
            content: this.buildSystemPrompt(),
          },
          {
            role: "user",
            content: this.buildUserPrompt({
              analysisMarkdown: data.analysisMarkdown,
              runbooks,
              agents,
            }),
          },
        ],
      });

      const proposals: Array<ParsedRemediationProposal> = this.parseProposals(
        response.content,
        {
          runbookIdAllowlist: runbooks.map((runbook: Runbook) => {
            return runbook._id?.toString() || "";
          }),
          agentIdAllowlist: agents.map((agent: RunbookAgent) => {
            return agent._id?.toString() || "";
          }),
        },
      );

      if (proposals.length === 0) {
        logger.debug(
          `AI remediation: no safe proposals for run ${aiRunId.toString()}.`,
        );
        return;
      }

      /*
       * The auto-remediation opt-in feeds the policy's decision mode; read
       * once for all proposals.
       */
      const project: Project | null = await ProjectService.findOneById({
        id: projectId,
        select: { enableAiAutoRemediationOnNonProduction: true },
        props: { isRoot: true },
      });

      const autoRemediationOnNonProductionEnabled: boolean =
        project?.enableAiAutoRemediationOnNonProduction === true;

      const agentEnvironmentById: Map<string, string | undefined> = new Map();
      for (const agent of agents) {
        if (agent._id) {
          agentEnvironmentById.set(agent._id.toString(), agent.environmentType);
        }
      }

      const runbooksById: Map<string, Runbook> = new Map();
      for (const runbook of runbooks) {
        if (runbook._id) {
          runbooksById.set(runbook._id.toString(), runbook);
        }
      }

      const createdActions: Array<{
        action: AIRemediationAction;
        proposal: ParsedRemediationProposal;
        decisionMode: AIRemediationDecisionMode;
      }> = [];

      for (const proposal of proposals) {
        const decisionMode: AIRemediationDecisionMode = this.decideModeFor({
          proposal,
          autoRemediationOnNonProductionEnabled,
          runbooksById,
          agentEnvironmentById,
        });

        const action: AIRemediationAction = new AIRemediationAction();
        action.projectId = projectId;
        action.aiRunId = aiRunId;
        if (data.incidentId) {
          action.incidentId = data.incidentId;
        }
        if (data.alertId) {
          action.alertId = data.alertId;
        }
        action.actionType = proposal.actionType;
        action.title = proposal.title;
        action.rationale = proposal.rationale;
        if (proposal.runbookId) {
          action.runbookId = new ObjectID(proposal.runbookId);
        }
        if (proposal.runbookAgentId) {
          action.runbookAgentId = new ObjectID(proposal.runbookAgentId);
        }
        if (proposal.commandScript) {
          action.commandScript = proposal.commandScript;
        }
        action.status = AIRemediationActionStatus.Proposed;
        action.decisionMode = decisionMode;
        action.expiresAt = OneUptimeDate.getSomeHoursAfter(PROPOSAL_TTL_HOURS);

        const created: AIRemediationAction =
          await AIRemediationActionService.create({
            data: action,
            props: { isRoot: true },
          });

        createdActions.push({ action: created, proposal, decisionMode });
      }

      /*
       * ONE feed item summarizing every proposal. The workspace ping fires
       * only when a human decision is needed — auto-approved actions stay
       * quiet here because their execution outcome will post (loudly) via
       * the status sweeper.
       */
      await this.postProposalsFeedItem({
        projectId,
        incidentId: data.incidentId,
        alertId: data.alertId,
        createdActions: createdActions.map(
          (entry: {
            action: AIRemediationAction;
            proposal: ParsedRemediationProposal;
            decisionMode: AIRemediationDecisionMode;
          }) => {
            return {
              title: entry.action.title || "",
              actionType: entry.proposal.actionType,
              target: this.describeTarget({
                proposal: entry.proposal,
                runbooksById,
                agents,
              }),
              decisionMode: entry.decisionMode,
            };
          },
        ),
      });

      // Unattended execution for whatever the policy gate cleared.
      for (const entry of createdActions) {
        if (
          entry.decisionMode === AIRemediationDecisionMode.AutoApproved &&
          entry.action.id
        ) {
          const actionId: ObjectID = entry.action.id;
          // Fire-and-forget: autoExecute swallows its own failures.
          RemediationExecutor.autoExecute({ actionId }).catch(
            (error: Error) => {
              logger.error(
                `AI remediation: auto-execution kickoff failed for action ${actionId.toString()}: ${error}`,
              );
            },
          );
        }
      }
    } catch (error) {
      logger.error(
        `AI remediation: proposer failed for run ${aiRunId.toString()}: ${error}`,
      );
    }
  }

  /*
   * Resolve the policy decision for one parsed proposal. Runbook actions
   * need the referenced runbook's autonomy profile plus every referenced
   * agent's environment tag — a missing agent contributes undefined so the
   * policy fails safe (unknown = Production). Command actions go through
   * the same gate, which returns RequireApproval unconditionally for them.
   */
  private static decideModeFor(data: {
    proposal: ParsedRemediationProposal;
    autoRemediationOnNonProductionEnabled: boolean;
    runbooksById: Map<string, Runbook>;
    agentEnvironmentById: Map<string, string | undefined>;
  }): AIRemediationDecisionMode {
    if (data.proposal.actionType === AIRemediationActionType.Command) {
      return RemediationPolicy.decideDecisionMode({
        actionType: AIRemediationActionType.Command,
        autoRemediationOnNonProductionEnabled:
          data.autoRemediationOnNonProductionEnabled,
      });
    }

    const runbook: Runbook | undefined = data.runbooksById.get(
      data.proposal.runbookId || "",
    );

    const steps: Array<RunbookStep> =
      (runbook?.steps as unknown as Array<RunbookStep>) || [];

    const profile: RunbookAutonomyProfile =
      RemediationPolicy.getRunbookAutonomyProfile(steps);

    const agentEnvironmentTypes: Array<string | undefined> =
      profile.agentIds.map((agentId: string) => {
        // Missing agents map to undefined → the policy reads Production.
        return data.agentEnvironmentById.get(agentId);
      });

    return RemediationPolicy.decideDecisionMode({
      actionType: AIRemediationActionType.Runbook,
      autoRemediationOnNonProductionEnabled:
        data.autoRemediationOnNonProductionEnabled,
      runbookProfile: profile,
      agentEnvironmentTypes,
    });
  }

  private static buildSystemPrompt(): string {
    return [
      "You are an SRE assistant drafting remediation for the root-cause analysis you are given.",
      "You may ONLY reference runbooks and agents from the lists provided — never invent ids.",
      `Reply with a STRICT JSON array (no prose, no code fences) of at most ${MAX_ACTIONS_PER_RUN} objects, each one of:`,
      '{"type":"runbook","runbookId":"...","title":"...","rationale":"..."}',
      '{"type":"command","script":"...","runbookAgentId":"...","title":"...","rationale":"..."}',
      "Reply with an empty array [] when nothing is safely automatable.",
      "Commands must be single-purpose diagnostics or safe mitigations, never destructive: no rm -rf, no data deletion, no credential or secret access.",
      "Prefer an existing runbook over a drafted command when one fits.",
      `Keep each title under ${MAX_TITLE_CHARS} characters and each script under ${MAX_COMMAND_SCRIPT_CHARS} characters.`,
    ].join("\n");
  }

  private static buildUserPrompt(data: {
    analysisMarkdown: string;
    runbooks: Array<Runbook>;
    agents: Array<RunbookAgent>;
  }): string {
    const lines: Array<string> = [];

    lines.push("Root-cause analysis:");
    lines.push('"""');
    lines.push(data.analysisMarkdown.substring(0, MAX_ANALYSIS_CHARS));
    lines.push('"""');
    lines.push("");

    lines.push("Available runbooks (id | name | description):");
    if (data.runbooks.length === 0) {
      lines.push("(none)");
    }
    for (const runbook of data.runbooks) {
      lines.push(
        `${runbook._id?.toString()} | ${runbook.name || "Unnamed"} | ${(
          runbook.description || ""
        ).substring(0, MAX_RUNBOOK_DESCRIPTION_PROMPT_CHARS)}`,
      );
    }
    lines.push("");

    lines.push(
      "Available runbook agents (id | name | environment | connection):",
    );
    if (data.agents.length === 0) {
      lines.push("(none)");
    }
    for (const agent of data.agents) {
      lines.push(
        `${agent._id?.toString()} | ${agent.name || "Unnamed"} | ${
          agent.environmentType || "Production"
        } | ${agent.connectionStatus || "unknown"}`,
      );
    }
    lines.push("");

    lines.push(
      "Draft the remediation actions as the strict JSON array described in your instructions.",
    );

    return lines.join("\n");
  }

  // Human-readable target for the feed item ("Runbook: X" / "Agent: Y (env)").
  private static describeTarget(data: {
    proposal: ParsedRemediationProposal;
    runbooksById: Map<string, Runbook>;
    agents: Array<RunbookAgent>;
  }): string {
    if (data.proposal.actionType === AIRemediationActionType.Runbook) {
      const runbook: Runbook | undefined = data.runbooksById.get(
        data.proposal.runbookId || "",
      );
      return `runbook "${runbook?.name || data.proposal.runbookId}"`;
    }

    const agent: RunbookAgent | undefined = data.agents.find(
      (candidate: RunbookAgent) => {
        return candidate._id?.toString() === data.proposal.runbookAgentId;
      },
    );

    return `agent "${agent?.name || data.proposal.runbookAgentId}" (${
      agent?.environmentType || "Production"
    })`;
  }

  /*
   * ONE feed item on the subject's timeline summarizing every proposed
   * action. Best-effort: a feed failure is logged, never thrown — the
   * action rows already exist and the panel lists them regardless.
   */
  private static async postProposalsFeedItem(data: {
    projectId: ObjectID;
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
    createdActions: Array<{
      title: string;
      actionType: AIRemediationActionType;
      target: string;
      decisionMode: AIRemediationDecisionMode;
    }>;
  }): Promise<void> {
    try {
      const lines: Array<string> = [];
      lines.push("## ⚡ AI — Proposed Remediation");
      lines.push("");

      for (const entry of data.createdActions) {
        const mode: string =
          entry.decisionMode === AIRemediationDecisionMode.AutoApproved
            ? "auto-approved (non-production)"
            : "requires approval";
        lines.push(
          `- **${entry.title}** — ${entry.actionType} action targeting ${entry.target} · ${mode}`,
        );
      }

      lines.push("");
      lines.push(
        `Review and approve or reject these on the ${
          data.incidentId ? "incident" : "alert"
        } page. Proposals expire after ${PROPOSAL_TTL_HOURS} hours.`,
      );

      const feedInfoInMarkdown: string = lines.join("\n");

      /*
       * The ping is "action needed": only when at least one action waits
       * for a human. All-auto proposals stay quiet — their execution
       * outcome posts loudly instead.
       */
      const sendWorkspaceNotification: boolean = data.createdActions.some(
        (entry: { decisionMode: AIRemediationDecisionMode }) => {
          return (
            entry.decisionMode === AIRemediationDecisionMode.RequireApproval
          );
        },
      );

      if (data.incidentId) {
        await IncidentFeedService.createIncidentFeedItem({
          incidentId: data.incidentId,
          projectId: data.projectId,
          incidentFeedEventType: IncidentFeedEventType.RemediationNotes,
          displayColor: Blue500,
          feedInfoInMarkdown,
          workspaceNotification: {
            sendWorkspaceNotification,
          },
        });
      } else if (data.alertId) {
        await AlertFeedService.createAlertFeedItem({
          alertId: data.alertId,
          projectId: data.projectId,
          alertFeedEventType: AlertFeedEventType.RemediationNotes,
          displayColor: Blue500,
          feedInfoInMarkdown,
          workspaceNotification: {
            sendWorkspaceNotification,
          },
        });
      }
    } catch (error) {
      logger.error(
        `AI remediation: failed to post proposals feed item for project ${data.projectId.toString()}: ${error}`,
      );
    }
  }
}
