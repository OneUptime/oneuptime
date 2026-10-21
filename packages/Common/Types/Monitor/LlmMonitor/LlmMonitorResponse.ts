import Span from "../../../Models/AnalyticsModels/Span";
import Query from "../../BaseDatabase/Query";
import ObjectID from "../../ObjectID";
import MonitorEvaluationSummary from "../MonitorEvaluationSummary";

/*
 * One check of an AI / LLM monitor: the answers in its window and how many
 * of them were bad (MonitorStepLlmMonitor says what bad means).
 *
 * llmAnswerCount is the payload discriminator: DataToProcess payloads are
 * matched by marker field (see MonitorCriteriaDataExtractor), so this field
 * name must stay unique across every monitor response type.
 */
export default interface LlmMonitorResponse {
  projectId: ObjectID;
  llmAnswerCount: number;
  llmBadAnswerCount: number;
  // The bad answers' share of all answers, 0..100; 0 when there were none.
  llmBadAnswerPercent: number;
  // The AI calls the check looked at, for "view the AI calls" links.
  llmSpanQuery: Query<Span>;
  monitorId: ObjectID;
  evaluationSummary?: MonitorEvaluationSummary | undefined;
}

export class LlmMonitorResponseUtil {
  /*
   * The bad answers' share of all answers, as a percentage rounded to two
   * decimals. No answers is 0%, never a division by zero: a quiet window
   * is not a window of bad answers.
   */
  public static getBadAnswerPercent(data: {
    answerCount: number;
    badAnswerCount: number;
  }): number {
    const answers: number = Number(data.answerCount);
    const bad: number = Number(data.badAnswerCount);

    if (!Number.isFinite(answers) || answers <= 0 || !Number.isFinite(bad)) {
      return 0;
    }

    const percent: number =
      (Math.max(0, Math.min(bad, answers)) / answers) * 100;

    return Math.round(percent * 100) / 100;
  }
}
