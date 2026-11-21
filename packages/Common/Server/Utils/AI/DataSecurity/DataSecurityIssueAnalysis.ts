import DataSecurityIssue from "../../../../Models/DatabaseModels/DataSecurityIssue";
import { DataSecurityIssueFeedEventType } from "../../../../Models/DatabaseModels/DataSecurityIssueFeed";
import { AiContextActivity } from "../../../../Types/AI/AiContext";
import { Purple500 } from "../../../../Types/BrandColors";
import OneUptimeDate from "../../../../Types/Date";
import { DataSecurityAiDecisionReason } from "../../../../Types/DataSecurity/DataSecurityAiDecision";
import { DataSecurityAiFeature } from "../../../../Types/DataSecurity/DataSecurityAiFeatures";
import {
  DATA_SECURITY_AI_VERDICT_TITLES,
  DataSecurityAnalysisAnswer,
  DataSecurityIssueAnalysisRecord,
  getAnalysisInputHash,
  holdAnalysisToFacts,
  readDataSecurityIssueAnalysis,
  toDataSecurityIssueAnalysisJson,
} from "../../../../Types/DataSecurity/DataSecurityIssueAnalysis";
import DataTypeNamer from "../../../../Types/DataSecurity/DataTypeNamer";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import { mdText } from "../../../../Utils/Markdown/FeedMarkdown";
import AIService, { AILogResponse } from "../../../Services/AIService";
import DataSecurityIssueFeedService from "../../../Services/DataSecurityIssueFeedService";
import DataSecurityIssueService from "../../../Services/DataSecurityIssueService";
import ProjectDataTypeNames from "../../DataSecurity/ProjectDataTypeNames";
import logger from "../../Logger";
import ProjectLanguage from "../../Notification/ProjectLanguage";
import UserLanguage from "../../Notification/UserLanguage";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import AiContextReader from "../AiContext/AiContextReader";
import AIInvestigationEngine from "../SRE/AIInvestigationEngine";
import DataSecurityAiCall from "./DataSecurityAiCall";
import DataSecurityAiInput, {
  AiAnalysisFacts,
  AiIssueDossier,
} from "./DataSecurityAiInput";
import DataSecurityIssueDossier from "./DataSecurityIssueDossier";
import {
  buildIssueAnalysisPrompt,
  DATA_SECURITY_ANALYSIS_MAX_TOKENS,
  DATA_SECURITY_ANALYSIS_TEMPERATURE,
  readDataSecurityAnalysisAnswer,
} from "./DataSecurityIssuePrompt";

/*
 * ONEUPTIME AI'S ANALYSIS OF A DATA SECURITY ISSUE (#10369): IS IT REAL,
 * WHAT IT PUTS AT RISK, WHAT THE FIX WOULD BREAK, THE SHORTEST PATH TO
 * FIXED - READY BEFORE ANYONE OPENS THE ISSUE.
 *
 * Written two ways, the same way:
 *
 *   - on its own, as #10364's engine's Analyze work, for every new and
 *     reopened issue the project's Data Security AI rules say (out of the
 *     box, Critical and High): analyze(), which never throws - what stopped
 *     it is the reason Why AI did not act says;
 *   - when a person asks - Explain with AI on the API and the MCP, Analyse
 *     on an issue it never analysed, Analyse Again - analyzeForPerson(),
 *     which says in words what stopped it.
 *
 * Each reads what OneUptime knows about the issue (DataSecurityIssueDossier),
 * makes its facts (DataSecurityAiInput.analysisFacts), and hashes what
 * OneUptime AI would be sent. Kept for what it was written from: when the
 * hash is the one the issue keeps, nothing is asked - opening the page, or
 * the issue being evaluated again with nothing changed, makes no model call.
 * Analyse Again asks anyway.
 *
 * What is sent is the builder's (the AnalyzeIssue or ExplainIssue feature of
 * DATA_SECURITY_AI_FEATURES) - names, counts and configuration, never a
 * value, a sample or a record - asked through the one Data Security call
 * (DataSecurityAiCall), which keeps nothing of it in the AI Logs (#10361)
 * and runs on the provider the deciding AI rule picks, else the project's
 * own. The answer is read strictly (StrictAnswer) and held to its facts
 * (holdAnalysisToFacts): a line naming no fact is dropped, a verdict with no
 * reason that rests on one is Cannot tell.
 *
 * It changes nothing but the analysis: the issue keeps it (aiVerdict,
 * aiAnalysis, aiAnalyzedAt, aiAnalysisInputHash, aiAnalysisLlmLogId), and
 * its timeline gets one entry per analysis written - its verdict - never
 * one per view. Never its status, never its severity: checks decide.
 */

// An analysis as the issue keeps it.
export interface StoredDataSecurityIssueAnalysis {
  record: DataSecurityIssueAnalysisRecord;
  analyzedAt: Date | null;
  // What it was written from, hashed (getAnalysisInputHash).
  inputHash: string;
  // The AI Logs row of the call that wrote it.
  llmLogId?: ObjectID | undefined;
}

export type DataSecurityIssueAnalysisOutcome =
  | { analyzed: true; analysis: StoredDataSecurityIssueAnalysis }
  | {
      analyzed: false;
      reason: DataSecurityAiDecisionReason;
      // The analysis the issue keeps, when it keeps one.
      analysis: StoredDataSecurityIssueAnalysis | null;
    };

// What an analysis is written from, read and hashed once.
interface AnalysisInput {
  dossier: AiIssueDossier;
  built: AiAnalysisFacts;
  inputHash: string;
  language: string;
  dataTypeNamer: DataTypeNamer;
}

export default class DataSecurityIssueAnalysis {
  // The analysis an issue keeps, or null: none, or one this build cannot read.
  @CaptureSpan()
  public static async readStored(data: {
    projectId: ObjectID;
    issueId: ObjectID;
  }): Promise<StoredDataSecurityIssueAnalysis | null> {
    const issue: DataSecurityIssue | null =
      await DataSecurityIssueService.findOneBy({
        query: { _id: data.issueId, projectId: data.projectId },
        select: {
          _id: true,
          aiAnalysis: true,
          aiAnalyzedAt: true,
          aiAnalysisInputHash: true,
          aiAnalysisLlmLogId: true,
        },
        props: { isRoot: true },
      });
    const record: DataSecurityIssueAnalysisRecord | null =
      readDataSecurityIssueAnalysis(issue?.aiAnalysis);

    if (!issue || !record) {
      return null;
    }

    return {
      record,
      analyzedAt: issue.aiAnalyzedAt || null,
      inputHash: issue.aiAnalysisInputHash || "",
      llmLogId: issue.aiAnalysisLlmLogId || undefined,
    };
  }

  /*
   * The engine's Analyze (#10364): the issue's analysis, written as
   * OneUptime AI when what it is written from changed - or it has none.
   * Never throws: what stopped it is the outcome's reason.
   */
  @CaptureSpan()
  public static async analyze(data: {
    projectId: ObjectID;
    issue: DataSecurityIssue;
    dataTypeNamer: DataTypeNamer;
    // The Data Security AI rule's pick, when one picks a provider.
    llmProviderId?: ObjectID | undefined;
    now?: Date | undefined;
  }): Promise<DataSecurityIssueAnalysisOutcome> {
    if (!data.issue.id) {
      return {
        analyzed: false,
        reason: DataSecurityAiDecisionReason.AnalysisFailed,
        analysis: null,
      };
    }

    let stored: StoredDataSecurityIssueAnalysis | null = null;

    try {
      stored = await this.readStored({
        projectId: data.projectId,
        issueId: data.issue.id,
      });

      /*
       * The language it keeps, else the project's: an analysis is never
       * written again only to change its language.
       */
      const input: AnalysisInput = await this.readInput({
        projectId: data.projectId,
        issueId: data.issue.id,
        language:
          stored?.record.language ||
          (await ProjectLanguage.getLanguage(data.projectId)),
        dataTypeNamer: data.dataTypeNamer,
        now: data.now,
      });

      if (stored && stored.inputHash === input.inputHash) {
        return {
          analyzed: false,
          reason: DataSecurityAiDecisionReason.AlreadyAnalyzed,
          analysis: stored,
        };
      }

      const blocker: "provider_missing" | "insufficient_ai_balance" | null =
        await AIInvestigationEngine.getProviderOrBalanceReason(
          data.projectId,
          data.llmProviderId,
        );

      if (blocker === "provider_missing") {
        return {
          analyzed: false,
          reason: DataSecurityAiDecisionReason.NoLlmProvider,
          analysis: stored,
        };
      }

      if (blocker === "insufficient_ai_balance") {
        return {
          analyzed: false,
          reason: DataSecurityAiDecisionReason.NoAiCredits,
          analysis: stored,
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
          analysis: stored,
        };
      }

      const written: StoredDataSecurityIssueAnalysis | null = await this.write({
        feature: DataSecurityAiFeature.AnalyzeIssue,
        projectId: data.projectId,
        issueId: data.issue.id,
        input,
        previous: stored,
        llmProviderId: data.llmProviderId,
      });

      return written
        ? { analyzed: true, analysis: written }
        : {
            analyzed: false,
            reason: DataSecurityAiDecisionReason.AnalysisFailed,
            analysis: stored,
          };
    } catch (error) {
      logger.error(
        `DataSecurity AI: could not analyze issue ${data.issue.id.toString()} of project ${data.projectId.toString()}: ${error}`,
      );

      return {
        analyzed: false,
        reason: DataSecurityAiDecisionReason.AnalysisFailed,
        analysis: stored,
      };
    }
  }

  /*
   * A person asked: Explain with AI, Analyse, Analyse Again. The analysis
   * the issue keeps when its input did not change - no model call - else a
   * new one, written in the language of the person who asked; `force` (Analyse
   * Again) writes a new one whatever changed. With the project's AI off it is
   * refused before anything is read.
   */
  @CaptureSpan()
  public static async analyzeForPerson(data: {
    projectId: ObjectID;
    issueId: ObjectID;
    userId?: ObjectID | undefined;
    force?: boolean | undefined;
    now?: Date | undefined;
  }): Promise<{ analysis: StoredDataSecurityIssueAnalysis; isNew: boolean }> {
    await AIService.assertProjectAIEnabled(data.projectId);

    const stored: StoredDataSecurityIssueAnalysis | null =
      await this.readStored({
        projectId: data.projectId,
        issueId: data.issueId,
      });
    const keepsLanguage: boolean = Boolean(stored) && data.force !== true;
    const input: AnalysisInput = await this.readInput({
      projectId: data.projectId,
      issueId: data.issueId,
      language:
        keepsLanguage && stored
          ? stored.record.language
          : data.userId
            ? await UserLanguage.getLanguage(data.userId)
            : await ProjectLanguage.getLanguage(data.projectId),
      dataTypeNamer: await ProjectDataTypeNames.read({
        projectId: data.projectId,
      }),
      now: data.now,
    });

    if (stored && data.force !== true && stored.inputHash === input.inputHash) {
      return { analysis: stored, isNew: false };
    }

    const written: StoredDataSecurityIssueAnalysis | null = await this.write({
      feature: DataSecurityAiFeature.ExplainIssue,
      projectId: data.projectId,
      issueId: data.issueId,
      userId: data.userId,
      input,
      previous: stored,
    });

    if (!written) {
      throw new BadDataException(
        "OneUptime AI's answer could not be read as an analysis. Try again in a moment.",
      );
    }

    return { analysis: written, isNew: true };
  }

  // What the analysis is written from: the issue's facts, and their hash.
  private static async readInput(data: {
    projectId: ObjectID;
    issueId: ObjectID;
    language: string;
    dataTypeNamer: DataTypeNamer;
    now?: Date | undefined;
  }): Promise<AnalysisInput> {
    const dossier: AiIssueDossier = await DataSecurityIssueDossier.read({
      projectId: data.projectId,
      issueId: data.issueId,
      now: data.now,
    });
    const built: AiAnalysisFacts = DataSecurityAiInput.analysisFacts({
      dossier,
      dataTypeNamer: data.dataTypeNamer,
    });

    return {
      dossier,
      built,
      language: data.language,
      dataTypeNamer: data.dataTypeNamer,
      inputHash: getAnalysisInputHash({
        data: built.data,
        language: data.language,
      }),
    };
  }

  /*
   * One model call, its answer held to the facts, and the analysis kept on
   * the issue with its timeline's entry. Null when the answer could not be
   * read as an analysis: nothing is kept then.
   */
  private static async write(data: {
    feature:
      | DataSecurityAiFeature.ExplainIssue
      | DataSecurityAiFeature.AnalyzeIssue;
    projectId: ObjectID;
    issueId: ObjectID;
    // The person who asked, when a person did.
    userId?: ObjectID | undefined;
    input: AnalysisInput;
    previous: StoredDataSecurityIssueAnalysis | null;
    llmProviderId?: ObjectID | undefined;
  }): Promise<StoredDataSecurityIssueAnalysis | null> {
    /*
     * The project's AI context first: the team's notes on its systems - how
     * its stores are managed, in which repository - so the path to fixed is
     * the team's own.
     */
    const aiContext: AiContextActivity | null = await AiContextReader.read({
      projectId: data.projectId,
    });

    const response: AILogResponse = await DataSecurityAiCall.ask({
      projectId: data.projectId,
      userId: data.userId,
      prompt: buildIssueAnalysisPrompt({
        feature: data.feature,
        dossier: data.input.dossier,
        language: data.input.language,
        dataTypeNamer: data.input.dataTypeNamer,
        aiContext,
      }),
      maxTokens: DATA_SECURITY_ANALYSIS_MAX_TOKENS,
      temperature: DATA_SECURITY_ANALYSIS_TEMPERATURE,
      // No person started it: the call's own messages and bounds hold.
      protectRequestParameters: !data.userId,
      rulePickedProviderId: data.llmProviderId,
    });

    const answer: DataSecurityAnalysisAnswer | null =
      readDataSecurityAnalysisAnswer(response.content);
    const record: DataSecurityIssueAnalysisRecord | null = answer
      ? holdAnalysisToFacts({
          answer,
          facts: data.input.built.facts,
          language: data.input.language,
        })
      : null;

    if (!record) {
      logger.error(
        `DataSecurity AI: the analysis of issue ${data.issueId.toString()} of project ${data.projectId.toString()} could not be read; nothing was kept.`,
      );
      return null;
    }

    const analyzedAt: Date = OneUptimeDate.getCurrentDate();
    const llmLogId: ObjectID | undefined = response.llmLog?.id || undefined;

    await DataSecurityIssueService.updateColumnsByIdWithoutHooks({
      id: data.issueId,
      data: {
        aiVerdict: record.verdict,
        aiAnalysis: toDataSecurityIssueAnalysisJson(record),
        aiAnalyzedAt: analyzedAt,
        aiAnalysisInputHash: data.input.inputHash,
        aiAnalysisLlmLogId: llmLogId || null,
      } as never,
    });

    const verdict: string = DATA_SECURITY_AI_VERDICT_TITLES[record.verdict];
    const previous: string | null =
      data.previous && data.previous.record.verdict !== record.verdict
        ? DATA_SECURITY_AI_VERDICT_TITLES[data.previous.record.verdict]
        : null;

    await DataSecurityIssueFeedService.createDataSecurityIssueFeedItem({
      projectId: data.projectId,
      dataSecurityIssueId: data.issueId,
      eventType: DataSecurityIssueFeedEventType.AiAnalysis,
      displayColor: Purple500,
      feedInfoInMarkdown: (previous
        ? mdText`OneUptime AI analysed this issue again: **${verdict}**. It said **${previous}** before.`
        : data.previous
          ? mdText`OneUptime AI analysed this issue again: **${verdict}**.`
          : mdText`OneUptime AI analysed this issue: **${verdict}**.`
      ).toString(),
      userId: data.userId,
    });

    return {
      record,
      analyzedAt,
      inputHash: data.input.inputHash,
      llmLogId,
    };
  }
}
