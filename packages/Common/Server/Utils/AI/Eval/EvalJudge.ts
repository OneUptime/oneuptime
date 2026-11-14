import AIRunAutoGrade from "../../../../Types/AI/AIRunAutoGrade";
import { ObservabilityAssistantModelReply } from "../Chat/ObservabilityAssistant";
import InvestigationGrader, {
  GRADING_MAX_TOKENS,
} from "../SRE/InvestigationGrader";
import { PinnedModelCall } from "./PinnedModel";

/*
 * Grades an investigation's analysis against a root cause, in the very words
 * production grades a resolved incident's investigation with
 * (InvestigationGrader.getGradingMessages): MATCH, PARTIAL or MISMATCH. A
 * replay grades the original analysis and the replayed one with the same
 * judge, and the benchmark grades against the cause it planted, so every
 * grade an eval reports means what an AI card's grade means.
 */
export default class EvalJudge {
  // Null when there is nothing to grade, or the judge's answer cannot be read.
  public static async grade(data: {
    rootCause: string;
    analysisMarkdown: string;
    callModel: PinnedModelCall;
  }): Promise<AIRunAutoGrade | null> {
    const rootCause: string = (data.rootCause || "").trim();
    const analysisMarkdown: string = (data.analysisMarkdown || "").trim();

    if (!rootCause || !analysisMarkdown) {
      return null;
    }

    const reply: ObservabilityAssistantModelReply = await data.callModel({
      messages: InvestigationGrader.getGradingMessages({
        rootCause,
        analysisMarkdown,
      }),
      tools: undefined,
      maxTokens: GRADING_MAX_TOKENS,
      temperature: 0,
    });

    return InvestigationGrader.parseAutoGradeToken(reply.content);
  }
}
