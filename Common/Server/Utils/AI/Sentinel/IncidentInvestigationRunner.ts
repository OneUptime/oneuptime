import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import { Blue500 } from "../../../../Types/BrandColors";
import { AIChatCitation } from "../../../../Types/AI/AIChatTypes";
import AIRunType from "../../../../Types/AI/AIRunType";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIRunEventType from "../../../../Types/AI/AIRunEventType";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIRunEvent from "../../../../Models/DatabaseModels/AIRunEvent";
import Project from "../../../../Models/DatabaseModels/Project";
import LlmProvider from "../../../../Models/DatabaseModels/LlmProvider";
import { IncidentFeedEventType } from "../../../../Models/DatabaseModels/IncidentFeed";
import AIRunService from "../../../Services/AIRunService";
import AIRunEventService from "../../../Services/AIRunEventService";
import ProjectService from "../../../Services/ProjectService";
import LlmProviderService from "../../../Services/LlmProviderService";
import IncidentFeedService from "../../../Services/IncidentFeedService";
import IncidentAIContextBuilder, {
  IncidentContextData,
} from "../IncidentAIContextBuilder";
import ObservabilityAssistant, {
  ObservabilityAssistantResult,
} from "../Chat/ObservabilityAssistant";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * Sentinel — Phase 1 "Investigation Engine".
 *
 * When a new incident is declared, Sentinel (OneUptime's autonomous AI SRE)
 * wakes automatically, investigates the incident against the telemetry OneUptime
 * already owns (logs, metrics, traces, exceptions, recent changes) using the
 * existing read-only, tool-grounded, citation-minting agent loop
 * (ObservabilityAssistant), and posts a cited root-cause analysis into the
 * incident timeline + Slack/Teams — before the on-call engineer has finished
 * reading the page.
 *
 * The run is recorded as an AIRun(Investigation) with AIRunEvents so it shows up
 * in the same audit/glass-box trail as chat runs. The investigation is strictly
 * READ-ONLY: it can never mutate anything.
 *
 * This is deliberately built on the fire-and-forget async pattern already used
 * throughout IncidentService.onCreateSuccess. The durable, restart-safe claimable
 * AIRun queue is a later phase (see Internal/Roadmap/AISentinelReliabilityBrain.md).
 */

// Budgets — larger than an interactive chat-ops answer, small enough to stay cheap.
const MAX_LLM_CALLS: number = 8;
const MAX_TOOL_CALLS: number = 12;
const MAX_WALL_CLOCK_MS: number = 150 * 1000;
const MAX_OUTPUT_TOKENS: number = 2000;

const FEATURE_LABEL: string = "Sentinel Incident Investigation";

const INVESTIGATION_PERSONA: string = `You are "Sentinel", OneUptime's autonomous AI Site Reliability Engineer. You have been woken automatically because a NEW incident was just declared in this project — no human has asked you a question yet. Investigate it proactively and produce a first-pass root cause analysis that the on-call engineer will read the moment they are paged.

Investigate like a senior on-call engineer:
- Start from the affected monitors/services named in the incident.
- Use your read tools to inspect the telemetry AROUND the incident's creation time: recent exceptions and their trends, error/latency metrics versus their normal range, failing traces, relevant logs, and recent changes / deploys.
- Form the single most likely root-cause hypothesis. If the evidence is inconclusive, say so plainly and list what you checked — do NOT guess a cause the data does not support.

Write your final answer as a concise incident-response note with exactly these sections (use these markdown headings):
**Summary** — one or two sentences a paged engineer can read in five seconds.
**Most likely root cause** — your hypothesis, with only the confidence the evidence actually supports, each factual claim carrying its [C#] citation. If you could not determine it, write "Inconclusive — insufficient signal" and explain what is missing.
**Evidence** — the key findings that support or rule out the hypothesis, each cited.
**Suggested next steps** — concrete actions for the on-call engineer.

Keep it tight and skimmable. You are read-only: never claim to have changed anything.`;

export default class SentinelIncidentInvestigationRunner {
  /*
   * Entry point called (fire-and-forget) from IncidentService.onCreateSuccess.
   * Never throws — all failures are logged and recorded on the AIRun.
   */
  @CaptureSpan()
  public static async investigateNewIncident(data: {
    incidentId: ObjectID;
    projectId: ObjectID;
  }): Promise<void> {
    const { incidentId, projectId } = data;

    try {
      /*
       * Gate 1 — project opt-in. AI must be enabled AND the auto-investigation
       * toggle must be explicitly on (it is off by default).
       */
      const project: Project | null = await ProjectService.findOneById({
        id: projectId,
        select: {
          enableAi: true,
          enableAutomaticIncidentInvestigation: true,
        },
        props: { isRoot: true },
      });

      if (!project) {
        return;
      }

      if (project.enableAi === false) {
        return;
      }

      if (project.enableAutomaticIncidentInvestigation !== true) {
        // Feature not enabled for this project — nothing to do.
        return;
      }

      // Gate 2 — an LLM provider must be configured for the project (or globally).
      const llmProvider: LlmProvider | null =
        await LlmProviderService.getLLMProviderForProject(projectId);

      if (!llmProvider) {
        logger.debug(
          `Sentinel: skipping investigation for incident ${incidentId.toString()} — no LLM provider configured.`,
        );
        return;
      }

      await this.runInvestigation({ incidentId, projectId });
    } catch (error) {
      logger.error(
        `Sentinel: unexpected error investigating incident ${incidentId.toString()}: ${error}`,
      );
    }
  }

  private static async runInvestigation(data: {
    incidentId: ObjectID;
    projectId: ObjectID;
  }): Promise<void> {
    const { incidentId, projectId } = data;

    // Create the AIRun record up front so the run is auditable even if it fails.
    const run: AIRun = new AIRun();
    run.projectId = projectId;
    run.runType = AIRunType.Investigation;
    run.status = AIRunStatus.Running;
    run.startedAt = OneUptimeDate.getCurrentDate();
    run.lastHeartbeatAt = OneUptimeDate.getCurrentDate();

    const createdRun: AIRun = await AIRunService.create({
      data: run,
      props: { isRoot: true },
    });

    const aiRunId: ObjectID = createdRun.id!;
    let sequence: number = 0;

    await this.emitEvent({
      projectId,
      aiRunId,
      sequence: sequence++,
      eventType: AIRunEventType.RunStarted,
    });

    try {
      // Assemble the incident context (reuses the existing context builder).
      const contextData: IncidentContextData =
        await IncidentAIContextBuilder.buildIncidentContext({
          incidentId,
          includeWorkspaceMessages: false,
        });

      const incidentSummary: string = this.buildIncidentSummary(contextData);

      // Run the shared read-only, tool-grounded, cited agent loop as Sentinel.
      const result: ObservabilityAssistantResult =
        await ObservabilityAssistant.answerQuestion({
          projectId,
          // System run — full read access to the project's telemetry.
          props: { isRoot: true },
          feature: FEATURE_LABEL,
          systemInstructions: INVESTIGATION_PERSONA,
          question: `A new incident has just been declared and you have been woken to investigate it. Investigate now and produce your root cause analysis.\n\n${incidentSummary}`,
          maxLlmCalls: MAX_LLM_CALLS,
          maxToolCalls: MAX_TOOL_CALLS,
          maxWallClockMs: MAX_WALL_CLOCK_MS,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
        });

      // Mark the run completed (status-guarded to avoid clobbering a terminal state).
      await AIRunService.updateOneBy({
        query: {
          _id: aiRunId.toString(),
          status: AIRunStatus.Running,
        },
        data: {
          status: AIRunStatus.Completed,
          completedAt: OneUptimeDate.getCurrentDate(),
          lastHeartbeatAt: OneUptimeDate.getCurrentDate(),
          llmCallCount: result.llmCallCount,
          toolCallCount: result.toolCallCount,
          totalTokens: result.totalTokens,
        } as never,
        props: { isRoot: true },
      });

      await this.emitEvent({
        projectId,
        aiRunId,
        sequence: sequence++,
        eventType: AIRunEventType.RunCompleted,
      });

      const analysisMarkdown: string = (result.contentInMarkdown || "").trim();

      if (!analysisMarkdown) {
        logger.debug(
          `Sentinel: investigation for incident ${incidentId.toString()} produced no analysis; nothing posted.`,
        );
        return;
      }

      // Post the cited RCA to the incident timeline + Slack/Teams.
      await IncidentFeedService.createIncidentFeedItem({
        incidentId,
        projectId,
        incidentFeedEventType: IncidentFeedEventType.RootCause,
        displayColor: Blue500,
        feedInfoInMarkdown: this.buildFeedMarkdown(result, analysisMarkdown),
        workspaceNotification: {
          sendWorkspaceNotification: true,
        },
      });

      logger.debug(
        `Sentinel: posted root cause analysis for incident ${incidentId.toString()} (${result.llmCallCount} LLM calls, ${result.toolCallCount} tools, ${result.totalTokens} tokens).`,
      );
    } catch (error) {
      const message: string =
        error instanceof Error ? error.message : String(error);

      await AIRunService.updateOneBy({
        query: {
          _id: aiRunId.toString(),
          status: AIRunStatus.Running,
        },
        data: {
          status: AIRunStatus.Error,
          completedAt: OneUptimeDate.getCurrentDate(),
          errorMessage: message.substring(0, 480),
        } as never,
        props: { isRoot: true },
      });

      await this.emitEvent({
        projectId,
        aiRunId,
        sequence: sequence++,
        eventType: AIRunEventType.RunFailed,
      });

      logger.error(
        `Sentinel: investigation failed for incident ${incidentId.toString()}: ${message}`,
      );
    }
  }

  // Build a compact incident record to seed the investigation.
  private static buildIncidentSummary(
    contextData: IncidentContextData,
  ): string {
    const { incident, internalNotes } = contextData;

    const lines: Array<string> = [];
    lines.push("# Incident");
    lines.push(`Title: ${incident.title || "N/A"}`);

    if (incident.description) {
      lines.push(`Description: ${incident.description}`);
    }

    lines.push(`Severity: ${incident.incidentSeverity?.name || "N/A"}`);
    lines.push(
      `Current state: ${incident.currentIncidentState?.name || "N/A"}`,
    );
    lines.push(
      `Declared at: ${
        incident.createdAt
          ? OneUptimeDate.getDateAsFormattedString(incident.createdAt)
          : "N/A"
      }`,
    );

    if (incident.monitors && incident.monitors.length > 0) {
      lines.push(
        `Affected monitors: ${incident.monitors
          .map((m: { name?: string }) => {
            return m.name;
          })
          .filter(Boolean)
          .join(", ")}`,
      );
    }

    if (incident.labels && incident.labels.length > 0) {
      lines.push(
        `Labels: ${incident.labels
          .map((l: { name?: string }) => {
            return l.name;
          })
          .filter(Boolean)
          .join(", ")}`,
      );
    }

    if (incident.rootCause) {
      lines.push(`Root cause (as recorded so far): ${incident.rootCause}`);
    }

    // Include a few of the most recent internal notes for context.
    const recentNotes: Array<string> = (internalNotes || [])
      .slice(-5)
      .map((note: { note?: string }) => {
        return note.note ? `- ${note.note}` : "";
      })
      .filter(Boolean);

    if (recentNotes.length > 0) {
      lines.push("");
      lines.push("Recent internal notes:");
      lines.push(...recentNotes);
    }

    return lines.join("\n");
  }

  // Wrap the agent's analysis with Sentinel branding + an evidence list.
  private static buildFeedMarkdown(
    result: ObservabilityAssistantResult,
    analysisMarkdown: string,
  ): string {
    let markdown: string = `## 🧠 Sentinel — Automated Root Cause Analysis\n\n${analysisMarkdown}`;

    const citations: Array<AIChatCitation> = result.citations || [];

    if (citations.length > 0) {
      markdown += `\n\n**Evidence checked**`;
      for (const citation of citations.slice(0, 15)) {
        markdown += `\n- **[${citation.id}]** ${citation.label} — ${citation.rowCount} row(s)`;
      }
    }

    markdown += `\n\n---\n*Investigated automatically by OneUptime Sentinel — read-only, ${result.toolCallCount} quer${
      result.toolCallCount === 1 ? "y" : "ies"
    } run across your own telemetry${
      result.modelName ? ` using ${result.modelName}` : ""
    }. This is an AI-generated first pass; verify before acting.*`;

    return markdown;
  }

  private static async emitEvent(data: {
    projectId: ObjectID;
    aiRunId: ObjectID;
    sequence: number;
    eventType: AIRunEventType;
  }): Promise<void> {
    try {
      const event: AIRunEvent = new AIRunEvent();
      event.projectId = data.projectId;
      event.aiRunId = data.aiRunId;
      event.sequence = data.sequence;
      event.eventType = data.eventType;

      await AIRunEventService.create({
        data: event,
        props: { isRoot: true },
      });
    } catch (error) {
      // Events are best-effort telemetry — never fail the run because of them.
      logger.error(`Sentinel: failed to emit AIRunEvent: ${error}`);
    }
  }
}
