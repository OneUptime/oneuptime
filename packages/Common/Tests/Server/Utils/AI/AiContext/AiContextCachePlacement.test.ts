import API from "../../../../../Utils/API";
import stubLLMEgressGuard from "../StubLLMEgressGuard";
import logger from "../../../../../Server/Utils/Logger";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../../../Types/JSON";
import LlmType from "../../../../../Types/LLM/LlmType";
import LLMService, {
  LLMMessage,
  LLMProviderConfig,
  LLMToolDefinition,
} from "../../../../../Server/Utils/LLM/LLMService";
import {
  AI_CONTEXT_PROMPT_HEADING,
  withAiContext,
} from "../../../../../Server/Utils/AI/AiContext/AiContextPrompt";
import {
  AiContextActivity,
  composeAiContext,
} from "../../../../../Types/AI/AiContext";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE AI CONTEXT IS INSIDE THE PREFIX EVERY PROVIDER CACHES (issue #5198):
 * "Placed before the system prompt's existing cache_control marker, so it's
 * part of the cached prefix. That keeps the cost of a few thousand tokens
 * of context negligible, even on small models."
 *
 * A run places its AI context first in its system prompt
 * (AiContextPrompt.withAiContext). What each wire then does with it, with
 * API.post mocked and the egress guard stubbed - never a real provider:
 *
 *  - Anthropic: the AI context is in the one system block, and that block
 *    carries the cache_control marker, so every call of a loop after the
 *    first reads it from the cache; none of it is in the conversation.
 *  - OpenAI, Groq, Mistral, OpenAI-compatible servers, Azure OpenAI and
 *    Ollama cache the longest prefix a request shares with the ones before
 *    it on their own: the AI context opens the first message, the system
 *    one, and the run's own data comes after it.
 *  - Every call of a run sends the same system prompt, byte for byte - what
 *    a prefix cache matches on.
 *  - With no AI context, a request is exactly the one it always was.
 */

type PostSpy = ReturnType<typeof jest.spyOn>;

const BASE_PROMPT: string =
  "You are OneUptime's observability copilot. Cite every fact as [C#].";
const QUESTION: string =
  "# Incident\nTitle: Checkout is down\nSeverity: Critical";
const NOTES: string =
  "## Symptom → owner\n- 502 on /checkout: payments team, check payments-db first.";

const TOOLS: Array<LLMToolDefinition> = [
  {
    name: "search_logs",
    description: "Search the project's logs.",
    inputSchema: { type: "object", properties: { query: { type: "string" } } },
  },
];

const AI_CONTEXT: AiContextActivity = composeAiContext({
  projectContext: NOTES,
  rules: [{ id: "r1", name: "Checkout", aiContext: "Checkout runs on k8s." }],
})!;

const SYSTEM_PROMPT: string = withAiContext(BASE_PROMPT, AI_CONTEXT);

function openAiReply(): HTTPResponse<JSONObject> {
  return {
    jsonData: {
      choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
    },
  } as unknown as HTTPResponse<JSONObject>;
}

function anthropicReply(): HTTPResponse<JSONObject> {
  return {
    jsonData: {
      content: [{ type: "text", text: "OK" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 2 },
    },
  } as unknown as HTTPResponse<JSONObject>;
}

function ollamaReply(): HTTPResponse<JSONObject> {
  return {
    jsonData: {
      message: { role: "assistant", content: "OK" },
      done: true,
      done_reason: "stop",
      prompt_eval_count: 5,
      eval_count: 1,
    },
  } as unknown as HTTPResponse<JSONObject>;
}

function bodyOf(spy: PostSpy, callIndex: number): JSONObject {
  return (spy.mock.calls[callIndex]![0] as { data: JSONObject }).data;
}

// The conversation of a loop: the system prompt, the run's data, then a step.
function conversation(
  systemPrompt: string,
  steps: number,
): Array<LLMMessage> {
  const messages: Array<LLMMessage> = [
    { role: "system", content: systemPrompt },
    { role: "user", content: QUESTION },
  ];

  for (let step: number = 1; step <= steps; step++) {
    messages.push({
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: `call_${step}`,
          name: "search_logs",
          arguments: { query: `checkout errors ${step}` },
        },
      ],
    });
    messages.push({
      role: "tool",
      toolCallId: `call_${step}`,
      content: `<tool_result citation="C${step}">rows</tool_result>`,
    });
  }

  return messages;
}

const OPENAI_WIRES: Array<{ label: string; config: LLMProviderConfig }> = [
  {
    label: "OpenAI",
    config: { llmType: LlmType.OpenAI, apiKey: "sk-test", modelName: "gpt-4o" },
  },
  {
    label: "Groq",
    config: {
      llmType: LlmType.Groq,
      apiKey: "gsk-test",
      modelName: "llama-3.3-70b-versatile",
    },
  },
  {
    label: "Mistral",
    config: {
      llmType: LlmType.Mistral,
      apiKey: "mistral-test",
      modelName: "mistral-large-latest",
    },
  },
  {
    label: "an OpenAI-compatible server (vLLM)",
    config: {
      llmType: LlmType.OpenAICompatible,
      baseUrl: "http://vllm.internal:8000/v1",
      modelName: "qwen2.5",
    },
  },
  {
    label: "Azure OpenAI",
    config: {
      llmType: LlmType.AzureOpenAI,
      apiKey: "azure-key",
      baseUrl:
        "https://example.openai.azure.com/openai/deployments/my-deployment",
      modelName: "my-deployment",
    },
  },
];

beforeEach(() => {
  // These hosts are placeholders; the SSRF guard is covered elsewhere.
  stubLLMEgressGuard();
  LLMService.clearRequestAdaptationCache();
  jest.spyOn(logger, "debug").mockImplementation((): void => {});
  jest.spyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Anthropic: the AI context is inside the system block's cache_control marker", () => {
  const ANTHROPIC: LLMProviderConfig = {
    llmType: LlmType.Anthropic,
    apiKey: "sk-ant-test",
    modelName: "claude-sonnet-5-5",
  };

  test("one system block, starting with the AI context, marked for the cache", async () => {
    const spy: PostSpy = (jest.spyOn(API, "post") as PostSpy).mockResolvedValue(
      anthropicReply(),
    );

    await LLMService.getCompletion({
      llmProviderConfig: ANTHROPIC,
      messages: conversation(SYSTEM_PROMPT, 0),
      tools: TOOLS,
    });

    const body: JSONObject = bodyOf(spy, 0);
    const system: Array<JSONObject> = body["system"] as Array<JSONObject>;

    expect(system).toHaveLength(1);
    expect(system[0]!["text"]).toBe(SYSTEM_PROMPT);
    expect(
      (system[0]!["text"] as string).startsWith(AI_CONTEXT_PROMPT_HEADING),
    ).toBe(true);
    expect(system[0]!["cache_control"]).toEqual({ type: "ephemeral" });
  });

  test("the notes sit before the marker's end and before the run's own data; none of them is in the conversation", async () => {
    const spy: PostSpy = (jest.spyOn(API, "post") as PostSpy).mockResolvedValue(
      anthropicReply(),
    );

    await LLMService.getCompletion({
      llmProviderConfig: ANTHROPIC,
      messages: conversation(SYSTEM_PROMPT, 1),
      tools: TOOLS,
    });

    const body: JSONObject = bodyOf(spy, 0);
    const systemText: string = (body["system"] as Array<JSONObject>)[0]![
      "text"
    ] as string;

    expect(systemText.indexOf(NOTES)).toBeGreaterThan(-1);
    expect(systemText.indexOf(NOTES)).toBeLessThan(
      systemText.indexOf(BASE_PROMPT),
    );
    expect(JSON.stringify(body["messages"])).not.toContain(NOTES);
    expect(JSON.stringify(body["messages"])).not.toContain(
      AI_CONTEXT_PROMPT_HEADING,
    );
    // The run's own data is the conversation's first message.
    expect(JSON.stringify((body["messages"] as Array<JSONObject>)[0])).toContain(
      "Checkout is down",
    );
  });

  test("every call of a loop sends the same marked system block: the cache matches it", async () => {
    const spy: PostSpy = (jest.spyOn(API, "post") as PostSpy).mockResolvedValue(
      anthropicReply(),
    );

    for (const steps of [0, 1, 2]) {
      await LLMService.getCompletion({
        llmProviderConfig: ANTHROPIC,
        messages: conversation(SYSTEM_PROMPT, steps),
        tools: TOOLS,
      });
    }

    const systems: Array<string> = [0, 1, 2].map((index: number): string => {
      return JSON.stringify(bodyOf(spy, index)["system"]);
    });

    expect(new Set(systems).size).toBe(1);
  });

  test("with no AI context, the request is the one it always was", async () => {
    const spy: PostSpy = (jest.spyOn(API, "post") as PostSpy).mockResolvedValue(
      anthropicReply(),
    );

    await LLMService.getCompletion({
      llmProviderConfig: ANTHROPIC,
      messages: conversation(withAiContext(BASE_PROMPT, null), 0),
      tools: TOOLS,
    });
    await LLMService.getCompletion({
      llmProviderConfig: ANTHROPIC,
      messages: conversation(BASE_PROMPT, 0),
      tools: TOOLS,
    });

    expect(bodyOf(spy, 0)).toEqual(bodyOf(spy, 1));
    expect(
      (bodyOf(spy, 0)["system"] as Array<JSONObject>)[0]!["text"],
    ).toBe(BASE_PROMPT);
  });
});

describe.each(OPENAI_WIRES)(
  "$label: the AI context opens the first message, the system one, which the provider caches as a prefix",
  ({ config }: { config: LLMProviderConfig }) => {
    test("the system message is first and starts with the AI context; the run's data follows it", async () => {
      const spy: PostSpy = (
        jest.spyOn(API, "post") as PostSpy
      ).mockResolvedValue(openAiReply());

      await LLMService.getCompletion({
        llmProviderConfig: config,
        messages: conversation(SYSTEM_PROMPT, 1),
        tools: TOOLS,
      });

      const messages: Array<JSONObject> = bodyOf(spy, 0)[
        "messages"
      ] as Array<JSONObject>;

      expect(messages[0]!["role"]).toBe("system");
      expect(messages[0]!["content"]).toBe(SYSTEM_PROMPT);
      expect(
        (messages[0]!["content"] as string).startsWith(
          AI_CONTEXT_PROMPT_HEADING,
        ),
      ).toBe(true);
      expect(messages[1]).toEqual({ role: "user", content: QUESTION });
      // The notes are in the system message only.
      expect(JSON.stringify(messages.slice(1))).not.toContain(NOTES);
      // These wires cache on their own: nothing is marked.
      expect(JSON.stringify(bodyOf(spy, 0))).not.toContain("cache_control");
    });

    test("every call of a loop starts with the same bytes", async () => {
      const spy: PostSpy = (
        jest.spyOn(API, "post") as PostSpy
      ).mockResolvedValue(openAiReply());

      for (const steps of [0, 1, 2]) {
        await LLMService.getCompletion({
          llmProviderConfig: config,
          messages: conversation(SYSTEM_PROMPT, steps),
          tools: TOOLS,
        });
      }

      const firsts: Array<string> = [0, 1, 2].map((index: number): string => {
        return JSON.stringify(
          (bodyOf(spy, index)["messages"] as Array<JSONObject>)[0],
        );
      });

      expect(new Set(firsts).size).toBe(1);
    });
  },
);

describe("Ollama: the AI context opens the system message, the prefix it keeps loaded", () => {
  const OLLAMA: LLMProviderConfig = {
    llmType: LlmType.Ollama,
    baseUrl: "http://ollama.internal:11434",
    modelName: "llama3.1",
  };

  test("first, and the same on every call", async () => {
    const spy: PostSpy = (jest.spyOn(API, "post") as PostSpy).mockResolvedValue(
      ollamaReply(),
    );

    await LLMService.getCompletion({
      llmProviderConfig: OLLAMA,
      messages: conversation(SYSTEM_PROMPT, 0),
      tools: TOOLS,
    });
    await LLMService.getCompletion({
      llmProviderConfig: OLLAMA,
      messages: conversation(SYSTEM_PROMPT, 2),
      tools: TOOLS,
    });

    const first: Array<JSONObject> = bodyOf(spy, 0)[
      "messages"
    ] as Array<JSONObject>;
    const second: Array<JSONObject> = bodyOf(spy, 1)[
      "messages"
    ] as Array<JSONObject>;

    expect(first[0]).toEqual({ role: "system", content: SYSTEM_PROMPT });
    expect(second[0]).toEqual(first[0]);
    expect(first[1]).toEqual({ role: "user", content: QUESTION });
  });
});
