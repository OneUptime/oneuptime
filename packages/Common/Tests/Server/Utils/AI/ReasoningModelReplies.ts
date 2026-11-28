import { JSONObject } from "../../../../Types/JSON";

/*
 * ---------------------------------------------------------------------------
 * REPLIES OF REASONING MODELS, AS THEIR SERVERS SEND THEM (issue #11255).
 *
 * Each stream below is written the way its server writes one: the same
 * chunk fields (id, object, created, model, choices[].index, delta,
 * logprobs, finish_reason), the empty first delta, a null content beside
 * reasoning_content, the usage chunk with no choices that stream_options
 * asks for, and the tags split across chunks where the model's tokens split
 * them. They are what OneUptime reads from:
 *
 *  - vLLM serving DeepSeek-R1-Distill without --reasoning-parser: the chat
 *    template opens <think>, so the text holds the reasoning and only its
 *    closing tag, here split as "</th" + "ink>";
 *  - a server whose reasoning parser takes the reasoning out but leaves the
 *    closing tag at the start of the answer - the "</think>I now have..."
 *    of the issue;
 *  - Qwen3 writing its own "<think>", split as "<" + "think" + ">";
 *  - DeepSeek's API and Alibaba Cloud Model Studio (QwQ, streamed only):
 *    the reasoning in reasoning_content, the answer in content;
 *  - Ollama's OpenAI-compatible endpoint: the reasoning in reasoning;
 *  - Mistral's Magistral: thinking parts in content, then text;
 *  - a reasoning model calling a tool, its arguments in pieces;
 *  - a reply cut off by the output limit inside its reasoning;
 *  - a stream that ends with an error event.
 * ---------------------------------------------------------------------------
 */

// One server-sent event per chunk, then the stream's end.
export const toEventStream: (
  chunks: ReadonlyArray<JSONObject | string>,
  options?: { lineEnding?: string; done?: boolean },
) => string = (
  chunks: ReadonlyArray<JSONObject | string>,
  options?: { lineEnding?: string; done?: boolean },
): string => {
  const lineEnding: string = options?.lineEnding ?? "\n";
  const events: Array<string> = chunks.map(
    (chunk: JSONObject | string): string => {
      return `data: ${typeof chunk === "string" ? chunk : JSON.stringify(chunk)}${lineEnding}${lineEnding}`;
    },
  );

  if (options?.done !== false) {
    events.push(`data: [DONE]${lineEnding}${lineEnding}`);
  }

  return events.join("");
};

// A chat.completion.chunk with one choice, as vLLM and OpenAI write one.
export const contentChunk: (data: {
  model: string;
  delta: JSONObject;
  finishReason?: string | null;
  id?: string;
}) => JSONObject = (data: {
  model: string;
  delta: JSONObject;
  finishReason?: string | null;
  id?: string;
}): JSONObject => {
  return {
    id: data.id ?? "chatcmpl-11255",
    object: "chat.completion.chunk",
    created: 1764150815,
    model: data.model,
    choices: [
      {
        index: 0,
        delta: data.delta,
        logprobs: null,
        finish_reason: data.finishReason ?? null,
      },
    ],
  };
};

// The last chunk stream_options.include_usage asks for: no choices, the usage.
export const usageChunk: (data: {
  model: string;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens?: number;
}) => JSONObject = (data: {
  model: string;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens?: number;
}): JSONObject => {
  return {
    id: "chatcmpl-11255",
    object: "chat.completion.chunk",
    created: 1764150815,
    model: data.model,
    choices: [],
    usage: {
      prompt_tokens: data.promptTokens,
      completion_tokens: data.completionTokens,
      total_tokens: data.promptTokens + data.completionTokens,
      ...(data.reasoningTokens !== undefined
        ? {
            completion_tokens_details: {
              reasoning_tokens: data.reasoningTokens,
            },
          }
        : {}),
    },
  };
};

// Content pieces of one model, each its own chunk.
const contentPieces: (
  model: string,
  pieces: ReadonlyArray<string>,
) => Array<JSONObject> = (
  model: string,
  pieces: ReadonlyArray<string>,
): Array<JSONObject> => {
  return pieces.map((piece: string): JSONObject => {
    return contentChunk({ model: model, delta: { content: piece } });
  });
};

export const DEEPSEEK_DISTILL_MODEL: string =
  "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B";

// What every answer below says, after its reasoning.
export const ROOT_CAUSE_ANSWER: string =
  "## Most likely root cause\n\nDeploy 4f1c to **checkout-api** at 02:38 [C1], which exhausted the connection pool.";

export const ROOT_CAUSE_REASONING: string =
  "Okay, so the user wants the most likely root cause. The error rate rose at 02:38, right after deploy 4f1c, and the pool hit its limit.";

/*
 * vLLM, DeepSeek-R1-Distill, no reasoning parser: the template opened the
 * block, so the text is the reasoning, "</think>" (split in two) and the
 * answer.
 */
export const VLLM_TEMPLATE_OPENED_STREAM: string = toEventStream([
  contentChunk({
    model: DEEPSEEK_DISTILL_MODEL,
    delta: { role: "assistant", content: "" },
  }),
  ...contentPieces(DEEPSEEK_DISTILL_MODEL, [
    "Okay",
    ", so the user wants the most likely root cause.",
    " The error rate rose at 02:38, right after deploy 4f1c,",
    " and the pool hit its limit.",
    "\n</th",
    "ink>\n\n",
    "## Most likely",
    " root cause\n\nDeploy 4f1c to **checkout-api** at 02:38 [C1],",
    " which exhausted the connection pool.",
  ]),
  contentChunk({
    model: DEEPSEEK_DISTILL_MODEL,
    delta: { content: "" },
    finishReason: "stop",
  }),
  usageChunk({
    model: DEEPSEEK_DISTILL_MODEL,
    promptTokens: 1840,
    completionTokens: 96,
  }),
]);

/*
 * A server whose reasoning parser took the reasoning out into
 * reasoning_content but left the closing tag at the start of the answer:
 * what the issue's Ask AI showed, streamed.
 */
export const STRAY_CLOSING_TAG_STREAM: string = toEventStream([
  contentChunk({
    model: "internal-llm",
    delta: { role: "assistant", content: null, reasoning_content: "" },
  }),
  contentChunk({
    model: "internal-llm",
    delta: { content: null, reasoning_content: "The incident's timeline" },
  }),
  contentChunk({
    model: "internal-llm",
    delta: { content: null, reasoning_content: " shows the deploy first." },
  }),
  ...contentPieces("internal-llm", [
    "</",
    "think>",
    "I now have a comprehensive picture of this incident.",
    " Let me summarize my findings.",
  ]),
  contentChunk({
    model: "internal-llm",
    delta: {},
    finishReason: "stop",
  }),
]);

export const STRAY_CLOSING_TAG_ANSWER: string =
  "I now have a comprehensive picture of this incident. Let me summarize my findings.";

export const QWEN3_MODEL: string = "Qwen/Qwen3-32B";

// Qwen3 writing its own block, the opening tag split in three.
export const QWEN3_OWN_BLOCK_STREAM: string = toEventStream([
  contentChunk({
    model: QWEN3_MODEL,
    delta: { role: "assistant", content: "" },
  }),
  ...contentPieces(QWEN3_MODEL, [
    "<",
    "think",
    ">\n",
    "Okay, so the user wants the most likely root cause.",
    " The error rate rose at 02:38, right after deploy 4f1c,",
    " and the pool hit its limit.\n",
    "</think",
    ">",
    "\n\n## Most likely root cause\n\n",
    "Deploy 4f1c to **checkout-api** at 02:38 [C1], which exhausted the connection pool.",
  ]),
  contentChunk({
    model: QWEN3_MODEL,
    delta: {},
    finishReason: "stop",
  }),
]);

export const DEEPSEEK_REASONER_MODEL: string = "deepseek-reasoner";

// DeepSeek's API: reasoning_content first, then content.
export const DEEPSEEK_API_STREAM: string = toEventStream([
  contentChunk({
    model: DEEPSEEK_REASONER_MODEL,
    delta: { role: "assistant", content: null, reasoning_content: "" },
  }),
  contentChunk({
    model: DEEPSEEK_REASONER_MODEL,
    delta: { content: null, reasoning_content: "Okay, so the user wants" },
  }),
  contentChunk({
    model: DEEPSEEK_REASONER_MODEL,
    delta: { content: null, reasoning_content: " the most likely root cause." },
  }),
  contentChunk({
    model: DEEPSEEK_REASONER_MODEL,
    delta: {
      content: "## Most likely root cause\n\n",
      reasoning_content: null,
    },
  }),
  contentChunk({
    model: DEEPSEEK_REASONER_MODEL,
    delta: {
      content:
        "Deploy 4f1c to **checkout-api** at 02:38 [C1], which exhausted the connection pool.",
      reasoning_content: null,
    },
  }),
  contentChunk({
    model: DEEPSEEK_REASONER_MODEL,
    delta: { content: "", reasoning_content: null },
    finishReason: "stop",
  }),
  usageChunk({
    model: DEEPSEEK_REASONER_MODEL,
    promptTokens: 1840,
    completionTokens: 120,
    reasoningTokens: 64,
  }),
]);

/*
 * Alibaba Cloud Model Studio's QwQ, which answers streamed only: its chunks
 * name the model last and carry usage: null until the usage chunk.
 */
export const MODEL_STUDIO_QWQ_STREAM: string = toEventStream([
  {
    choices: [
      {
        delta: { content: null, role: "assistant", reasoning_content: "" },
        index: 0,
        logprobs: null,
        finish_reason: null,
      },
    ],
    object: "chat.completion.chunk",
    usage: null,
    created: 1764150815,
    system_fingerprint: null,
    model: "qwq-plus",
    id: "chatcmpl-qwq",
  },
  {
    choices: [
      {
        finish_reason: null,
        delta: { content: null, reasoning_content: "嗯，用户想知道" },
        index: 0,
        logprobs: null,
      },
    ],
    object: "chat.completion.chunk",
    usage: null,
    created: 1764150815,
    system_fingerprint: null,
    model: "qwq-plus",
    id: "chatcmpl-qwq",
  },
  {
    choices: [
      {
        finish_reason: null,
        delta: { content: "根本原因是部署 4f1c。", reasoning_content: null },
        index: 0,
        logprobs: null,
      },
    ],
    object: "chat.completion.chunk",
    usage: null,
    created: 1764150815,
    system_fingerprint: null,
    model: "qwq-plus",
    id: "chatcmpl-qwq",
  },
  {
    choices: [
      {
        finish_reason: "stop",
        delta: { content: "", reasoning_content: null },
        index: 0,
        logprobs: null,
      },
    ],
    object: "chat.completion.chunk",
    usage: null,
    created: 1764150815,
    system_fingerprint: null,
    model: "qwq-plus",
    id: "chatcmpl-qwq",
  },
  {
    choices: [],
    object: "chat.completion.chunk",
    usage: {
      prompt_tokens: 22,
      completion_tokens: 310,
      total_tokens: 332,
      completion_tokens_details: { reasoning_tokens: 298 },
    },
    created: 1764150815,
    system_fingerprint: null,
    model: "qwq-plus",
    id: "chatcmpl-qwq",
  },
]);

export const MODEL_STUDIO_QWQ_ANSWER: string = "根本原因是部署 4f1c。";

// Ollama's OpenAI-compatible endpoint: the reasoning in reasoning.
export const OLLAMA_OPENAI_COMPATIBLE_STREAM: string = toEventStream([
  {
    id: "chatcmpl-542",
    object: "chat.completion.chunk",
    created: 1764150815,
    model: "qwen3:8b",
    system_fingerprint: "fp_ollama",
    choices: [
      {
        index: 0,
        delta: { role: "assistant", content: "", reasoning: "Okay, the user" },
        finish_reason: null,
      },
    ],
  },
  {
    id: "chatcmpl-542",
    object: "chat.completion.chunk",
    created: 1764150815,
    model: "qwen3:8b",
    system_fingerprint: "fp_ollama",
    choices: [
      {
        index: 0,
        delta: { role: "assistant", content: "", reasoning: " wants a cause." },
        finish_reason: null,
      },
    ],
  },
  {
    id: "chatcmpl-542",
    object: "chat.completion.chunk",
    created: 1764150815,
    model: "qwen3:8b",
    system_fingerprint: "fp_ollama",
    choices: [
      {
        index: 0,
        delta: { role: "assistant", content: "The deploy is the cause." },
        finish_reason: null,
      },
    ],
  },
  {
    id: "chatcmpl-542",
    object: "chat.completion.chunk",
    created: 1764150815,
    model: "qwen3:8b",
    system_fingerprint: "fp_ollama",
    choices: [
      {
        index: 0,
        delta: { role: "assistant", content: "" },
        finish_reason: "stop",
      },
    ],
  },
]);

// Mistral's Magistral: thinking parts in content, then text.
export const MAGISTRAL_STREAM: string = toEventStream([
  contentChunk({
    model: "magistral-medium-2509",
    delta: {
      role: "assistant",
      content: [
        {
          type: "thinking",
          thinking: [{ type: "text", text: "Okay, the user wants" }],
        },
      ],
    },
  }),
  contentChunk({
    model: "magistral-medium-2509",
    delta: {
      content: [
        {
          type: "thinking",
          thinking: [{ type: "text", text: " a root cause." }],
        },
      ],
    },
  }),
  contentChunk({
    model: "magistral-medium-2509",
    delta: { content: "The deploy" },
  }),
  contentChunk({
    model: "magistral-medium-2509",
    delta: { content: " is the cause." },
  }),
  contentChunk({
    model: "magistral-medium-2509",
    delta: { content: "" },
    finishReason: "stop",
  }),
]);

// A reasoning model calling a tool: its id and name first, the arguments in pieces.
export const TOOL_CALL_STREAM: string = toEventStream([
  contentChunk({
    model: DEEPSEEK_DISTILL_MODEL,
    delta: { role: "assistant", content: "" },
  }),
  ...contentPieces(DEEPSEEK_DISTILL_MODEL, [
    "I should look at the incident first.",
    "\n</think>\n\n",
  ]),
  contentChunk({
    model: DEEPSEEK_DISTILL_MODEL,
    delta: {
      tool_calls: [
        {
          index: 0,
          id: "chatcmpl-tool-7f",
          type: "function",
          function: { name: "query_incidents", arguments: "" },
        },
      ],
    },
  }),
  contentChunk({
    model: DEEPSEEK_DISTILL_MODEL,
    delta: {
      tool_calls: [{ index: 0, function: { arguments: '{"incident' } }],
    },
  }),
  contentChunk({
    model: DEEPSEEK_DISTILL_MODEL,
    delta: {
      tool_calls: [{ index: 0, function: { arguments: 'Id": "abc"}' } }],
    },
  }),
  contentChunk({
    model: DEEPSEEK_DISTILL_MODEL,
    delta: {
      tool_calls: [
        {
          index: 1,
          id: "chatcmpl-tool-8a",
          type: "function",
          function: { name: "query_logs", arguments: '{"limit": 5}' },
        },
      ],
    },
  }),
  contentChunk({
    model: DEEPSEEK_DISTILL_MODEL,
    delta: {},
    finishReason: "tool_calls",
  }),
]);

// Cut off by the output limit while it still thought.
export const CUT_OFF_INSIDE_REASONING_STREAM: string = toEventStream([
  contentChunk({
    model: QWEN3_MODEL,
    delta: { role: "assistant", content: "" },
  }),
  ...contentPieces(QWEN3_MODEL, [
    "<think>",
    "\nOkay, so the user wants the root cause. Let me look at",
  ]),
  contentChunk({
    model: QWEN3_MODEL,
    delta: { content: " the" },
    finishReason: "length",
  }),
]);

// A stream that ends with an error event after part of an answer.
export const ERROR_EVENT_STREAM: string = toEventStream(
  [
    ...contentPieces("internal-llm", ["The root cause", " is"]),
    {
      error: {
        object: "error",
        message: "The model is overloaded. Please try again later.",
        type: "ServiceUnavailableError",
        code: 503,
      },
    },
  ],
  { done: false },
);
