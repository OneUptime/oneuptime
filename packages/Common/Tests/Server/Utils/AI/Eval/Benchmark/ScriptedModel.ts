import {
  readToolResultFrame,
  ToolResultFrame,
} from "../../../../../../Server/Utils/AI/Chat/AgentContextCompactor";
import {
  ObservabilityAssistantModelCall,
  ObservabilityAssistantModelReply,
} from "../../../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import { PinnedModelCall } from "../../../../../../Server/Utils/AI/Eval/PinnedModel";
import {
  LLMMessage,
  LLMToolCall,
} from "../../../../../../Server/Utils/LLM/LLMService";
import { JSONObject } from "../../../../../../Types/JSON";

/*
 * A model for the benchmark's tests (issue #6800). It makes the tool calls
 * it is told to, one round per model call, and then answers with what
 * `answer` writes from the citations the loop minted for those calls - read
 * from each result's frame, as a model reads them. Nothing is guessed: an
 * answer cites only what the real loop handed it.
 */

export interface PlannedToolCall {
  toolName: string;
  arguments: JSONObject;
}

export interface ScriptedModel {
  callModel: PinnedModelCall;
  // Every call the loop made, in order.
  calls: Array<ObservabilityAssistantModelCall>;
}

// What each model call costs, unless a test says otherwise.
export const SCRIPTED_CALL_TOKENS: number = 1000;

// The citation the loop minted for one tool call, as its result's frame names it.
export function citationOf(
  messages: Array<LLMMessage>,
  toolCallId: string,
): string | null {
  const message: LLMMessage | undefined = messages.find(
    (candidate: LLMMessage): boolean => {
      return candidate.role === "tool" && candidate.toolCallId === toolCallId;
    },
  );
  const frame: ToolResultFrame | null = message
    ? readToolResultFrame(message.content)
    : null;

  return frame ? frame.citationId : null;
}

export function scriptedModel(data: {
  rounds: Array<Array<PlannedToolCall>>;
  // The answer, from each planned call's citation (null: none was minted).
  answer: (citationIds: Array<string | null>) => string;
  tokenCount?: number | undefined;
}): ScriptedModel {
  const calls: Array<ObservabilityAssistantModelCall> = [];
  const plannedCallIds: Array<string> = [];
  const tokenCount: number = data.tokenCount ?? SCRIPTED_CALL_TOKENS;
  let roundIndex: number = 0;

  const callModel: PinnedModelCall = async (
    call: ObservabilityAssistantModelCall,
  ): Promise<ObservabilityAssistantModelReply> => {
    calls.push(call);

    const round: Array<PlannedToolCall> | undefined = data.rounds[roundIndex];

    if (call.tools && round) {
      roundIndex++;

      const toolCalls: Array<LLMToolCall> = round.map(
        (planned: PlannedToolCall, index: number): LLMToolCall => {
          const id: string = `call-${roundIndex}-${index + 1}`;
          plannedCallIds.push(id);

          return { id, name: planned.toolName, arguments: planned.arguments };
        },
      );

      return { content: "", toolCalls, tokenCount };
    }

    return {
      content: data.answer(
        plannedCallIds.map((id: string): string | null => {
          return citationOf(call.messages, id);
        }),
      ),
      tokenCount,
    };
  };

  return { callModel, calls };
}

// A judge that always answers the same words: a grade token, or anything else.
export function judgeSaying(content: string): ScriptedModel {
  const calls: Array<ObservabilityAssistantModelCall> = [];

  return {
    calls,
    callModel: async (
      call: ObservabilityAssistantModelCall,
    ): Promise<ObservabilityAssistantModelReply> => {
      calls.push(call);

      return { content, tokenCount: 20 };
    },
  };
}

// A judge whose call fails, as a provider that is down fails it.
export function judgeFailingWith(message: string): ScriptedModel {
  const calls: Array<ObservabilityAssistantModelCall> = [];

  return {
    calls,
    callModel: async (
      call: ObservabilityAssistantModelCall,
    ): Promise<ObservabilityAssistantModelReply> => {
      calls.push(call);

      throw new Error(message);
    },
  };
}
