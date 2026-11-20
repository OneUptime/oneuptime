import DataSecurityIssue from "../../../../Models/DatabaseModels/DataSecurityIssue";
import DataStoreFinding from "../../../../Models/DatabaseModels/DataStoreFinding";
import { DataSecurityIssueFeedEventType } from "../../../../Models/DatabaseModels/DataSecurityIssueFeed";
import { Purple500 } from "../../../../Types/BrandColors";
import { DataSecurityAiDecisionReason } from "../../../../Types/DataSecurity/DataSecurityAiDecision";
import DataTypeNamer from "../../../../Types/DataSecurity/DataTypeNamer";
import ObjectID from "../../../../Types/ObjectID";
import FeedMarkdown from "../../../../Utils/Markdown/FeedMarkdown";
import AIService, {
  AI_DATA_SECURITY_ISSUE_ANALYSIS_FEATURE,
} from "../../../Services/AIService";
import DataSecurityIssueFeedService from "../../../Services/DataSecurityIssueFeedService";
import { readCountedTelemetryFindings } from "../../DataSecurity/DataSecurityIssueFindings";
import { LLMMessage } from "../../LLM/LLMService";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import { withAiContext } from "../AiContext/AiContextPrompt";
import AiContextReader from "../AiContext/AiContextReader";
import { AiContextActivity } from "../../../../Types/AI/AiContext";
import AIInvestigationEngine from "../SRE/AIInvestigationEngine";
import {
  DataSecurityFindingForAi,
  MAX_ISSUE_FINDINGS_FOR_AI,
  describeDataSecurityIssueForAi,
  getDataSecurityExplainSystemPrompt,
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
 * OneUptime AI's. What is sent is what Explain sends - the issue as its
 * check saw it, and where a telemetry issue's data sits, never a sample or
 * a record (DataSecurityIssuePrompt). Until #10365's input builder lands,
 * buildMessages is the one place it is written, to switch over. Nothing of
 * it is kept in the AI Logs (#10361): no previews, and no provider error
 * that could quote the prompt. Its feature is autonomous
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
   * What OneUptime AI is sent about the issue: the system prompt Explain
   * uses, after the project's AI context, and the issue as its check saw
   * it - each data type by the project's name for it.
   */
  public static async buildMessages(data: {
    projectId: ObjectID;
    issue: DataSecurityIssue;
    dataTypeNamer: DataTypeNamer;
  }): Promise<Array<LLMMessage>> {
    const aiContext: AiContextActivity | null = await AiContextReader.read({
      projectId: data.projectId,
    });
    const findings: Array<DataSecurityFindingForAi> = (
      await readCountedTelemetryFindings({
        projectId: data.projectId,
        dataStoreId: data.issue.dataStoreId,
        checkId: data.issue.checkId,
      })
    )
      .slice(0, MAX_ISSUE_FINDINGS_FOR_AI)
      .map((finding: DataStoreFinding): DataSecurityFindingForAi => {
        return {
          dataTypeId: finding.dataTypeId,
          dataTypeName: finding.dataTypeName,
          location: finding.location,
          locationKind: finding.locationKind,
        };
      });

    return [
      {
        role: "system",
        content: withAiContext(
          getDataSecurityExplainSystemPrompt(data.issue.checkId),
          aiContext,
        ),
      },
      {
        role: "user",
        content: describeDataSecurityIssueForAi(
          data.issue,
          undefined,
          findings,
          data.dataTypeNamer,
        ),
      },
    ];
  }

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

      const response: { content: string } = await AIService.executeWithLogging(
        {
          projectId: data.projectId,
          feature: AI_DATA_SECURITY_ISSUE_ANALYSIS_FEATURE,
          ...(data.llmProviderId ? { llmProviderId: data.llmProviderId } : {}),
          /*
           * Neither the issue nor the analysis in the AI Logs, which every
           * Project Member and Viewer reads (#10361), nor a provider's
           * error, which can quote the prompt.
           */
          storeContentPreviews: false,
          storeErrorDetails: false,
          messages: await DataSecurityIssueAnalysis.buildMessages(data),
          maxTokens: DATA_SECURITY_ANALYSIS_MAX_TOKENS,
        },
      );

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
