import { SecurityCaseFeedEventType } from "../../../../Models/DatabaseModels/SecurityCaseFeed";
import { Indigo500 } from "../../../../Types/BrandColors";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import { getSecurityCaseAiVerdictDescription } from "../../../../Types/SecurityCase/SecurityCaseAiVerdict";
import { InstructionLikeTextScan } from "../../../../Utils/AI/InstructionLikeText";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../../Utils/Markdown/FeedMarkdown";
import { AI_SECURITY_CASE_TRIAGE_FEATURE } from "../../../Services/AIService";
import SecurityCaseFeedService from "../../../Services/SecurityCaseFeedService";
import SecurityCaseService from "../../../Services/SecurityCaseService";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import ToolOutputPager from "../Chat/ToolOutputPager";
import { ObservabilityAssistantExtraTool } from "../Chat/ObservabilityAssistant";
import McpInvestigationTools from "../Mcp/McpInvestigationTools";
import McpRunToolkit from "../Mcp/McpRunToolkit";
import AIInvestigationEngine from "../SRE/AIInvestigationEngine";
import AIInvestigationQueue from "../SRE/InvestigationQueue";
import SecurityCaseAIContextBuilder, {
  SecurityCaseTriageContext,
  SecurityCaseTriageData,
} from "./SecurityCaseAIContextBuilder";
import {
  SecurityCaseTriageDecision,
  readSecurityCaseTriageDecision,
  removeSecurityCaseTriageDecisionLines,
} from "./SecurityCaseTriageDecision";
import {
  SECURITY_CASE_TRIAGE_PERSONA,
  SECURITY_CASE_TRIAGE_QUESTION,
  SECURITY_CASE_TRIAGE_REPORT_HEADING,
} from "./SecurityCaseTriagePrompt";

/*
 * ONEUPTIME AI TRIAGES A SECURITY CASE.
 *
 * The AI queue claims a triage run (InvestigationQueue, subject: the case)
 * and hands it here. The runner reads the case and what is around it
 * (SecurityCaseAIContextBuilder), runs the shared investigation engine with
 * the security persona and every read-only tool - the security tools, the
 * telemetry and infrastructure tools the rest of OneUptime uses, and the
 * project's external MCP servers' read-only tools - and records what it
 * concluded:
 *
 *   - on the case: OneUptime AI's verdict, the priority and playbook it
 *     suggests, its report, and when (each a suggestion: the case's own
 *     verdict and priority change only when a person sets them, and a
 *     playbook runs only when a person runs it);
 *   - on the case's timeline: an AI Triage entry with the report.
 *
 * Read-only from start to finish: the engine runs the toolbox in its
 * read-only mode, and nothing here changes the case's status, priority,
 * assignee or verdict.
 *
 * Every text the model reads - the context and every tool result - goes
 * through an InstructionLikeTextScan. When the case's data held text written
 * to steer an AI, a benign or false-positive read is set aside for
 * Inconclusive (SecurityCaseTriageDecision), the case records it, and the
 * report says so first.
 */

export const PROMPT_INJECTION_REPORT_LEAD: string =
  "**Heads up:** some text in this case's data reads like instructions to an AI - a sign of an attempt to steer the triage. OneUptime AI treated it as data and leaves the call to a person.";

export default class SecurityCaseTriageRunner {
  @CaptureSpan()
  public static async executeTriage(data: {
    aiRunId: ObjectID;
    projectId: ObjectID;
    securityCaseId: ObjectID;
    attemptCount: number;
  }): Promise<void> {
    const { aiRunId, projectId, securityCaseId, attemptCount } = data;
    const scan: InstructionLikeTextScan = new InstructionLikeTextScan();

    let context: SecurityCaseTriageContext;

    try {
      const triage: SecurityCaseTriageData =
        await SecurityCaseAIContextBuilder.read({
          projectId,
          securityCaseId,
        });

      context = SecurityCaseAIContextBuilder.buildContext({ triage, scan });
    } catch (error) {
      const message: string =
        error instanceof Error ? error.message : String(error);

      /*
       * The run is claimed: hand it to the retry policy rather than leave
       * it Running until the stale sweep. A case that is gone will not come
       * back on a retry.
       */
      await AIInvestigationQueue.failOrRequeue({
        aiRunId,
        attemptCount,
        errorMessage: `Failed to build the security case context: ${message}`,
        isPermanent: message.includes("Security case not found"),
      });
      return;
    }

    // One pager for the run, so read_tool_output reads every toolkit's output.
    const outputPager: ToolOutputPager = new ToolOutputPager();
    const extraTools: Array<ObservabilityAssistantExtraTool> = [];
    const additionalInstructions: Array<string> = [];

    const mcpToolkit: McpRunToolkit | null =
      await McpInvestigationTools.forSecurityCase({
        projectId,
        securityCaseId,
        aiRunId,
        outputPager,
      });

    if (mcpToolkit) {
      extraTools.push(...mcpToolkit.buildTools());
      extraTools.push(outputPager.buildReadTool());
      additionalInstructions.push(mcpToolkit.buildPersonaAddendum());
    }

    try {
      await AIInvestigationEngine.executeRun({
        aiRunId,
        projectId,
        attemptCount,
        request: {
          feature: AI_SECURITY_CASE_TRIAGE_FEATURE,
          contextSummary: context.contextSummary,
          promptOmissions: context.promptOmissions,
          personaOverride: SECURITY_CASE_TRIAGE_PERSONA,
          additionalInstructions:
            additionalInstructions.length > 0
              ? additionalInstructions.join("\n\n")
              : undefined,
          questionOverride: SECURITY_CASE_TRIAGE_QUESTION,
          reportHeading: SECURITY_CASE_TRIAGE_REPORT_HEADING,
          extraTools: extraTools.length > 0 ? extraTools : undefined,
          // Everything the model reads is looked over for text written to steer it.
          onToolResult: (result: { toolName: string; textForLlm: string }) => {
            scan.record(result.textForLlm);
          },
          postAnalysis: async (posted: {
            analysisMarkdown: string;
          }): Promise<void> => {
            await this.recordTriage({
              projectId,
              securityCaseId,
              aiRunId,
              analysisMarkdown: posted.analysisMarkdown,
              offeredPlaybookIds: context.offeredPlaybookIds,
              scan,
            });
          },
        },
      });
    } finally {
      // Every session the run opened ends with it.
      await mcpToolkit?.close();
    }
  }

  /*
   * What the triage concluded, on the case and its timeline. The decision
   * is read from the model's closing lines; the report people read is the
   * analysis without them, led by the heads-up when the case's data held
   * text written to steer an AI.
   */
  public static async recordTriage(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    aiRunId: ObjectID;
    analysisMarkdown: string;
    offeredPlaybookIds: Array<string>;
    scan: InstructionLikeTextScan;
  }): Promise<SecurityCaseTriageDecision> {
    const decision: SecurityCaseTriageDecision =
      readSecurityCaseTriageDecision({
        analysisMarkdown: data.analysisMarkdown,
        offeredPlaybookIds: data.offeredPlaybookIds,
        instructionLikeTextFound: data.scan.found(),
      });

    const report: string = this.buildReport({
      analysisMarkdown: data.analysisMarkdown,
      promptInjectionSuspected: data.scan.found(),
    });

    await SecurityCaseService.updateOneById({
      id: data.securityCaseId,
      data: {
        aiVerdict: decision.verdict,
        aiSuggestedPriority: decision.suggestedPriority || null,
        aiSuggestedPlaybookId: decision.suggestedPlaybookId
          ? new ObjectID(decision.suggestedPlaybookId)
          : null,
        aiTriageReport: report,
        aiTriagedAt: OneUptimeDate.getCurrentDate(),
        aiTriagePromptInjectionSuspected: data.scan.found(),
      } as never,
      props: { isRoot: true },
    });

    await SecurityCaseFeedService.createSecurityCaseFeedItem({
      projectId: data.projectId,
      securityCaseId: data.securityCaseId,
      feedInfoInMarkdown: this.buildFeedHeadline(decision).toString(),
      moreInformationInMarkdown: report,
      eventType: SecurityCaseFeedEventType.AiTriage,
      displayColor: Indigo500,
    });

    logger.debug(
      `AI: security case ${data.securityCaseId.toString()} triaged (run ${data.aiRunId.toString()}): ${decision.verdict}${
        decision.verdictSetAside
          ? " (a dismissing read set aside: text written to steer an AI)"
          : ""
      }.`,
    );

    return decision;
  }

  /*
   * The report as posted: the branded analysis without the decision lines,
   * and, when the case's data held text written to steer an AI, the
   * heads-up straight under the heading - the first thing a reader sees.
   */
  public static buildReport(data: {
    analysisMarkdown: string;
    promptInjectionSuspected: boolean;
  }): string {
    const report: string = removeSecurityCaseTriageDecisionLines(
      data.analysisMarkdown,
    );

    if (!data.promptInjectionSuspected) {
      return report;
    }

    const lines: Array<string> = report.split("\n");
    const headingIndex: number = lines.findIndex((line: string): boolean => {
      return line.startsWith("## ");
    });

    if (headingIndex === -1) {
      return `${PROMPT_INJECTION_REPORT_LEAD}\n\n${report}`;
    }

    lines.splice(headingIndex + 1, 0, "", PROMPT_INJECTION_REPORT_LEAD);

    return lines.join("\n");
  }

  // The timeline entry's line: OneUptime AI's read, and what it suggests.
  public static buildFeedHeadline(
    decision: SecurityCaseTriageDecision,
  ): MarkdownText {
    const verdict: string =
      getSecurityCaseAiVerdictDescription(decision.verdict)?.verdict ||
      decision.verdict;

    const suggestions: Array<MarkdownText> = [];

    if (decision.suggestedPriority) {
      suggestions.push(
        mdText`suggests priority **${decision.suggestedPriority}**`,
      );
    }

    if (decision.suggestedPlaybookId) {
      suggestions.push(mdText`suggests a playbook`);
    }

    return suggestions.length > 0
      ? mdText`**OneUptime AI triaged this case: ${verdict}.** It ${FeedMarkdown.join(suggestions, " and ")}.`
      : mdText`**OneUptime AI triaged this case: ${verdict}.**`;
  }
}
