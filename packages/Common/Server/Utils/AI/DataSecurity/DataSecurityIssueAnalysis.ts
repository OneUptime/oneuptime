import DataSecurityIssue from "../../../../Models/DatabaseModels/DataSecurityIssue";
import { DataSecurityIssueFeedEventType } from "../../../../Models/DatabaseModels/DataSecurityIssueFeed";
import { AiContextActivity } from "../../../../Types/AI/AiContext";
import { Purple500 } from "../../../../Types/BrandColors";
import { DataSecurityAiDecisionReason } from "../../../../Types/DataSecurity/DataSecurityAiDecision";
import DataTypeNamer from "../../../../Types/DataSecurity/DataTypeNamer";
import ObjectID from "../../../../Types/ObjectID";
import FeedMarkdown from "../../../../Utils/Markdown/FeedMarkdown";
import AIService from "../../../Services/AIService";
import DataSecurityIssueFeedService from "../../../Services/DataSecurityIssueFeedService";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import AiContextReader from "../AiContext/AiContextReader";
import AIInvestigationEngine from "../SRE/AIInvestigationEngine";
import DataSecurityAiCall from "./DataSecurityAiCall";
import DataSecurityAiReads from "./DataSecurityAiReads";
import {
  buildAnalyzeIssuePrompt,
  DATA_SECURITY_EXPLAIN_TEMPERATURE,
} from "./DataSecurityIssuePrompt";

/*
 * ONEUPTIME AI'S OWN ANALYSIS OF A NEW DATA SECURITY ISSUE (#10364): the
 * explanation Explain with AI writes - what is wrong, what could happen,
 * the exact steps to fix it - written when the issue opens, with no one
 * pressing it, as the project's Data Security AI rules say (out of the box,
 * for every Critical and High issue). It is the Analyze work until #10369's
 * analyst replaces what it writes: the engine calls analyze(), whatever
 * writes it.
 *
 * It changes nothing: the analysis goes on the issue's timeline, as
 * OneUptime AI's. What is sent is what Explain sends, built by #10365's
 * input builder (DataSecurityAiInput, as the AnalyzeIssue feature of
 * DATA_SECURITY_AI_FEATURES) - the issue as its check saw it, and where a
 * telemetry issue's data sits, never a sample or a record - and asked
 * through the one Data Security model call (DataSecurityAiCall), which
 * keeps nothing of it in the AI Logs (#10361) and runs on the provider the
 * deciding AI rule picks. Its AI Logs label is autonomous
 * (AUTONOMOUS_AI_FEATURES), so the daily budget covers it, and the
 * project's AI switch, credits and limits hold as for every model call.
 */

export type DataSecurityIssueAnalysisOutcome =
  | { analyzed: true }
  | { analyzed: false; reason: DataSecurityAiDecisionReason };

// The most the analysis may be, and the most of it a timeline keeps.
export const DATA_SECURITY_ANALYSIS_MAX_TOKENS: number = 900;
const MAX_ANALYSIS_LENGTH: number = 20000;

export default class DataSecurityIssueAnalysis {
  /*
   * Analyze the issue now, as OneUptime AI, and write the analysis on its
   * timeline. Never throws: what stopped it is the outcome's reason, which
   * Why AI did not act says.
   */
  @CaptureSpan()
  public static async analyze(data: {
    projectId: ObjectID;
    issue: DataSecurityIssue;
    dataTypeNamer: DataTypeNamer;
    // The Data Security AI rule's pick, when one picks a provider.
    llmProviderId?: ObjectID | undefined;
  }): Promise<DataSecurityIssueAnalysisOutcome> {
    if (!data.issue.id) {
      return {
        analyzed: false,
        reason: DataSecurityAiDecisionReason.AnalysisFailed,
      };
    }

    try {
      const blocker: "provider_missing" | "insufficient_ai_balance" | null =
        await AIInvestigationEngine.getProviderOrBalanceReason(
          data.projectId,
          data.llmProviderId,
        );

      if (blocker === "provider_missing") {
        return {
          analyzed: false,
          reason: DataSecurityAiDecisionReason.NoLlmProvider,
        };
      }

      if (blocker === "insufficient_ai_balance") {
        return {
          analyzed: false,
          reason: DataSecurityAiDecisionReason.NoAiCredits,
        };
      }

      if (
        await AIService.getReachedProjectDailyLimit({
          projectId: data.projectId,
        })
      ) {
        return {
          analyzed: false,
          reason: DataSecurityAiDecisionReason.AiDailyLimitReached,
        };
      }

      /*
       * What OneUptime AI is sent about the issue: Explain's instructions,
       * after the project's AI context, and the issue as the builder reads
       * it - each data type by the project's name for it.
       */
      const aiContext: AiContextActivity | null = await AiContextReader.read({
        projectId: data.projectId,
      });
      const issue: Awaited<ReturnType<typeof DataSecurityAiReads.readIssue>> =
        await DataSecurityAiReads.readIssue({
          projectId: data.projectId,
          issueId: data.issue.id,
        });
      const findings: Awaited<
        ReturnType<typeof DataSecurityAiReads.readPlaces>
      > = await DataSecurityAiReads.readPlaces({
        projectId: data.projectId,
        issue,
      });

      const response: { content: string } = await DataSecurityAiCall.ask({
        projectId: data.projectId,
        prompt: buildAnalyzeIssuePrompt({
          issue,
          findings,
          dataTypeNamer: data.dataTypeNamer,
          aiContext,
        }),
        maxTokens: DATA_SECURITY_ANALYSIS_MAX_TOKENS,
        temperature: DATA_SECURITY_EXPLAIN_TEMPERATURE,
        // No person started it: the call's own messages and bounds hold.
        protectRequestParameters: true,
        rulePickedProviderId: data.llmProviderId,
      });

      const content: string = (response.content || "").trim();

      if (!content) {
        return {
          analyzed: false,
          reason: DataSecurityAiDecisionReason.AnalysisFailed,
        };
      }

      await DataSecurityIssueFeedService.createDataSecurityIssueFeedItem({
        projectId: data.projectId,
        dataSecurityIssueId: data.issue.id,
        eventType: DataSecurityIssueFeedEventType.AiExplanation,
        displayColor: Purple500,
        feedInfoInMarkdown: "OneUptime AI analyzed this issue on its own.",
        // OneUptime AI's Markdown, with nothing in it that acts on its own.
        moreInformationInMarkdown: FeedMarkdown.aiWritten(
          content.slice(0, MAX_ANALYSIS_LENGTH),
        ).toString(),
      });

      return { analyzed: true };
    } catch (error) {
      logger.error(
        `DataSecurity AI: could not analyze issue ${data.issue.id.toString()} of project ${data.projectId.toString()}: ${error}`,
      );

      return {
        analyzed: false,
        reason: DataSecurityAiDecisionReason.AnalysisFailed,
      };
    }
  }
}
