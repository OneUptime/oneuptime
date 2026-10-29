import { AIChatCitation } from "../../../../Types/AI/AIChatTypes";
import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import {
  decideInvestigationLogStall,
  getInvestigationLogSearches,
  getInvestigationLogWindow,
  InvestigationLogSearches,
  InvestigationLogStall,
  InvestigationLogStallReason,
} from "../../../../Utils/AI/InvestigationLogStall";
import LogAggregationService from "../../../Services/LogAggregationService";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import AIConfidenceSignal, { ConfidenceSignal } from "./ConfidenceSignal";

/*
 * Whether an incident's or alert's investigation could not tell the cause
 * for lack of logs (Utils/AI/InvestigationLogStall): decided once the run
 * has its verdict, before its report is posted, so the AI card reads the
 * stall beside the report. Never throws: a read that fails leaves only the
 * investigation's own searches to speak, and a check that fails says
 * nothing - the report is posted either way.
 */
export default class InvestigationLogStallCheck {
  @CaptureSpan()
  public static async check(data: {
    projectId: ObjectID;
    confidence: ConfidenceSignal;
    citations: ReadonlyArray<AIChatCitation>;
    subjectStartedAt: Date | null | undefined;
    now?: Date | undefined;
  }): Promise<InvestigationLogStall | null> {
    try {
      /*
       * A positive "could not tell" only (the evidence floor or the
       * constrained classification): a failed classification is no verdict,
       * and a found cause needs no way forward.
       */
      const isInconclusive: boolean =
        AIConfidenceSignal.shouldEnqueueInstrumentationTask(data.confidence);

      const searches: InvestigationLogSearches = getInvestigationLogSearches(
        data.citations.map(
          (
            citation: AIChatCitation,
          ): { toolName: string; rowCount: number } => {
            return {
              toolName: citation.toolName,
              rowCount: citation.rowCount,
            };
          },
        ),
      );

      if (!isInconclusive || searches.searchesWithLines > 0) {
        return null;
      }

      const window: { startTime: Date; endTime: Date } =
        getInvestigationLogWindow({
          subjectStartedAt: data.subjectStartedAt,
          now: data.now || OneUptimeDate.getCurrentDate(),
        });

      let hasLogs: boolean | null = null;

      try {
        hasLogs = await LogAggregationService.hasLogsInWindow({
          projectId: data.projectId,
          startTime: window.startTime,
          endTime: window.endTime,
        });
      } catch (error) {
        logger.warn(
          `AI: could not tell whether logs reached project ${data.projectId.toString()} for an inconclusive investigation: ${error}`,
        );
        hasLogs = null;
      }

      const reason: InvestigationLogStallReason | null =
        decideInvestigationLogStall({ isInconclusive, searches, hasLogs });

      if (!reason) {
        return null;
      }

      return {
        reason,
        logSearchCount: searches.searchCount,
        windowStart: window.startTime.toISOString(),
        windowEnd: window.endTime.toISOString(),
      };
    } catch (error) {
      logger.error(
        `AI: the log check of an inconclusive investigation failed: ${error}`,
      );

      return null;
    }
  }
}
