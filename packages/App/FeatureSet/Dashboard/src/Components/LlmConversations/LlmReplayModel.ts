import {
  LlmTranscriptStep,
  LlmTranscriptStepType,
} from "Common/Utils/Telemetry/LlmConversationTranscript";
import { LlmAnswerIssueUtil } from "Common/Types/Telemetry/LlmAnswerIssue";
import { LlmReplayTimeline } from "Common/Utils/Telemetry/LlmConversationReplay";

/*
 * What the replay draws besides the messages, decided from the transcript
 * and the clock: the marks on the scrubber, and the "AI is answering" bubble
 * that holds the place of an answer still on its way.
 */

export type LlmReplayMarkerTone =
  | "user"
  | "answer"
  | "tool"
  | "activity"
  | "problem";

export interface LlmReplayMarker {
  index: number;
  // Where on the scrubber, 0..1.
  position: number;
  tone: LlmReplayMarkerTone;
}

// Scrubber dot colours (mid-tone hues read the same in both themes).
export const LLM_REPLAY_MARKER_CLASS_NAMES: Record<
  LlmReplayMarkerTone,
  string
> = {
  user: "bg-indigo-500",
  answer: "bg-violet-500",
  tool: "bg-cyan-500",
  activity: "bg-gray-400",
  problem: "bg-red-500",
};

function hasProblem(step: LlmTranscriptStep): boolean {
  return LlmAnswerIssueUtil.fromValues(step.call.issues).length > 0;
}

export function getLlmReplayMarkerTone(
  step: LlmTranscriptStep,
): LlmReplayMarkerTone {
  switch (step.type) {
    case LlmTranscriptStepType.UserMessage:
      return "user";
    case LlmTranscriptStepType.Failure:
      return "problem";
    case LlmTranscriptStepType.ToolCall:
    case LlmTranscriptStepType.ToolResult:
      return "tool";
    case LlmTranscriptStepType.Activity:
    case LlmTranscriptStepType.Instructions:
      return "activity";
    case LlmTranscriptStepType.AssistantMessage:
    case LlmTranscriptStepType.SilentAnswer:
    default:
      return !step.fromHistory && hasProblem(step) ? "problem" : "answer";
  }
}

/*
 * One mark per step. Marks closer than a pixel or so would draw on top of
 * each other anyway, but they are all kept: the scrubber shows where the
 * messages are, and a dense burst of tool calls should look dense.
 */
export function buildLlmReplayMarkers(
  steps: ReadonlyArray<LlmTranscriptStep>,
  timeline: LlmReplayTimeline,
): Array<LlmReplayMarker> {
  if (timeline.durationMs <= 0) {
    return [];
  }

  return steps.map(
    (step: LlmTranscriptStep, index: number): LlmReplayMarker => {
      const point: number = timeline.points[index] ?? 0;

      return {
        index: index,
        position: Math.min(1, Math.max(0, point / timeline.durationMs)),
        tone: getLlmReplayMarkerTone(step),
      };
    },
  );
}

export interface LlmPendingAnswer {
  // How long the AI has been working on it, in real time.
  elapsedMs: number;
  // The AI is running a tool rather than writing.
  isTool: boolean;
  model: string;
}

/*
 * The answer on its way at this moment of the replay: the next step is
 * something the AI produces (an answer, a tool request, a failure), and the
 * call that produces it has already started. Between a question and its
 * answer the replay then shows "AI is answering… 1.2 s" counting up, the way
 * the person waited for it.
 */
export function getLlmPendingAnswer(
  steps: ReadonlyArray<LlmTranscriptStep>,
  visibleCount: number,
  realTimeMs: number,
): LlmPendingAnswer | null {
  if (visibleCount <= 0 || visibleCount >= steps.length) {
    return null;
  }

  const next: LlmTranscriptStep = steps[visibleCount] as LlmTranscriptStep;

  const producedByAi: boolean =
    next.type === LlmTranscriptStepType.AssistantMessage ||
    next.type === LlmTranscriptStepType.SilentAnswer ||
    next.type === LlmTranscriptStepType.Failure ||
    (next.type === LlmTranscriptStepType.ToolCall && !next.fromHistory) ||
    next.type === LlmTranscriptStepType.ToolResult;

  if (!producedByAi || next.fromHistory) {
    return null;
  }

  const started: number = next.call.startMs;

  if (!started || started > realTimeMs || realTimeMs >= next.atMs) {
    return null;
  }

  return {
    elapsedMs: Math.max(0, realTimeMs - started),
    isTool: next.type === LlmTranscriptStepType.ToolResult,
    model: next.call.model,
  };
}

/*
 * The index of the step a ?step= link names, or null for anything that is
 * not a step of this conversation.
 */
export function readLlmStepParam(
  value: string | null,
  stepCount: number,
): number | null {
  if (value === null || value.trim() === "") {
    return null;
  }

  const index: number = Number(value);

  if (!Number.isInteger(index) || index < 0 || index >= stepCount) {
    return null;
  }

  return index;
}
