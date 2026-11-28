import LLMStreamedAnswer, {
  LLMStreamedAnswerReading,
} from "../../../../Server/Utils/LLM/LLMStreamedAnswer";
import { JSONObject } from "../../../../Types/JSON";
import ModelReasoning from "../../../../Utils/LLM/ModelReasoning";
import {
  CUT_OFF_INSIDE_REASONING_STREAM,
  DEEPSEEK_API_STREAM,
  DEEPSEEK_DISTILL_MODEL,
  ERROR_EVENT_STREAM,
  MAGISTRAL_STREAM,
  MODEL_STUDIO_QWQ_ANSWER,
  MODEL_STUDIO_QWQ_STREAM,
  OLLAMA_OPENAI_COMPATIBLE_STREAM,
  QWEN3_OWN_BLOCK_STREAM,
  ROOT_CAUSE_ANSWER,
  ROOT_CAUSE_REASONING,
  STRAY_CLOSING_TAG_ANSWER,
  STRAY_CLOSING_TAG_STREAM,
  TOOL_CALL_STREAM,
  VLLM_TEMPLATE_OPENED_STREAM,
  contentChunk,
  toEventStream,
} from "./ReasoningModelReplies";
import { describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * A STREAMED ANSWER IS PUT BACK TOGETHER BEFORE ANYTHING IS READ OF IT.
 *
 * A provider that streams (Alibaba Cloud Model Studio serves QwQ streamed
 * only; a gateway may stream whatever it is asked) sends its answer in
 * pieces, and a model's tag can be split across two of them. The pieces are
 * joined into the message a non-streamed answer carries, and only then is
 * the reasoning read out of it (issue #11255): no piece is judged alone.
 * ---------------------------------------------------------------------------
 */

const readStream: (text: string) => LLMStreamedAnswerReading = (
  text: string,
): LLMStreamedAnswerReading => {
  const reading: LLMStreamedAnswerReading | null = LLMStreamedAnswer.read(text);

  expect(reading).not.toBeNull();

  return reading as LLMStreamedAnswerReading;
};

const messageOf: (reading: LLMStreamedAnswerReading) => JSONObject = (
  reading: LLMStreamedAnswerReading,
): JSONObject => {
  const choices: Array<JSONObject> = reading.body[
    "choices"
  ] as Array<JSONObject>;

  return choices[0]!["message"] as JSONObject;
};

const finishReasonOf: (reading: LLMStreamedAnswerReading) => unknown = (
  reading: LLMStreamedAnswerReading,
): unknown => {
  return (reading.body["choices"] as Array<JSONObject>)[0]!["finish_reason"];
};

describe("the streams of reasoning models", () => {
  test("vLLM with a template-opened block: the text whole, its closing tag rejoined", () => {
    const reading: LLMStreamedAnswerReading = readStream(
      VLLM_TEMPLATE_OPENED_STREAM,
    );
    const content: string = messageOf(reading)["content"] as string;

    expect(content).toContain("</think>");
    expect(content).not.toContain("</th\n");
    expect(ModelReasoning.read(content).answer).toBe(ROOT_CAUSE_ANSWER);
    expect(ModelReasoning.read(content).reasoning).toBe(ROOT_CAUSE_REASONING);
    expect(finishReasonOf(reading)).toBe("stop");
    expect(reading.body["model"]).toBe(DEEPSEEK_DISTILL_MODEL);
    expect(reading.body["usage"]).toEqual({
      prompt_tokens: 1840,
      completion_tokens: 96,
      total_tokens: 1936,
    });
    expect(reading.errorMessage).toBeUndefined();
  });

  test("a parser's stray closing tag, split in two, before the answer", () => {
    const message: JSONObject = messageOf(readStream(STRAY_CLOSING_TAG_STREAM));

    expect(message["reasoning_content"]).toBe(
      "The incident's timeline shows the deploy first.",
    );
    expect(ModelReasoning.read(message["content"] as string).answer).toBe(
      STRAY_CLOSING_TAG_ANSWER,
    );
  });

  test("Qwen3's own block, its opening tag in three pieces", () => {
    const message: JSONObject = messageOf(readStream(QWEN3_OWN_BLOCK_STREAM));

    expect(ModelReasoning.read(message["content"] as string).answer).toBe(
      ROOT_CAUSE_ANSWER,
    );
  });

  test("DeepSeek's API: reasoning_content apart, the answer in content", () => {
    const reading: LLMStreamedAnswerReading = readStream(DEEPSEEK_API_STREAM);
    const message: JSONObject = messageOf(reading);

    expect(message["content"]).toBe(ROOT_CAUSE_ANSWER);
    expect(message["reasoning_content"]).toBe(
      "Okay, so the user wants the most likely root cause.",
    );
    expect(reading.body["usage"]).toEqual({
      prompt_tokens: 1840,
      completion_tokens: 120,
      total_tokens: 1960,
      completion_tokens_details: { reasoning_tokens: 64 },
    });
  });

  test("Model Studio's QwQ: usage null until its own chunk", () => {
    const reading: LLMStreamedAnswerReading = readStream(
      MODEL_STUDIO_QWQ_STREAM,
    );

    expect(messageOf(reading)["content"]).toBe(MODEL_STUDIO_QWQ_ANSWER);
    expect(messageOf(reading)["reasoning_content"]).toBe("嗯，用户想知道");
    expect((reading.body["usage"] as JSONObject)["total_tokens"]).toBe(332);
    expect(reading.body["model"]).toBe("qwq-plus");
  });

  test("Ollama's OpenAI-compatible endpoint: reasoning apart", () => {
    const message: JSONObject = messageOf(
      readStream(OLLAMA_OPENAI_COMPATIBLE_STREAM),
    );

    expect(message["content"]).toBe("The deploy is the cause.");
    expect(message["reasoning_content"]).toBe("Okay, the user wants a cause.");
  });

  test("Magistral: thinking parts are reasoning, text is the answer", () => {
    const message: JSONObject = messageOf(readStream(MAGISTRAL_STREAM));

    expect(message["content"]).toBe("The deploy is the cause.");
    expect(message["reasoning_content"]).toBe(
      "Okay, the user wants a root cause.",
    );
  });

  test("tool calls by their index, their arguments in pieces", () => {
    const reading: LLMStreamedAnswerReading = readStream(TOOL_CALL_STREAM);
    const message: JSONObject = messageOf(reading);

    expect(message["tool_calls"]).toEqual([
      {
        id: "chatcmpl-tool-7f",
        type: "function",
        function: {
          name: "query_incidents",
          arguments: '{"incidentId": "abc"}',
        },
      },
      {
        id: "chatcmpl-tool-8a",
        type: "function",
        function: { name: "query_logs", arguments: '{"limit": 5}' },
      },
    ]);
    expect(finishReasonOf(reading)).toBe("tool_calls");
    expect(ModelReasoning.read(message["content"] as string).answer).toBe("");
  });

  test("a reply cut off inside its reasoning says so", () => {
    const reading: LLMStreamedAnswerReading = readStream(
      CUT_OFF_INSIDE_REASONING_STREAM,
    );

    expect(finishReasonOf(reading)).toBe("length");
    expect(
      ModelReasoning.read(messageOf(reading)["content"] as string)
        .endedInsideReasoning,
    ).toBe(true);
  });

  test("an error event is reported with what the stream sent before it", () => {
    const reading: LLMStreamedAnswerReading = readStream(ERROR_EVENT_STREAM);

    expect(reading.errorMessage).toBe(
      "The model is overloaded. Please try again later.",
    );
    expect(messageOf(reading)["content"]).toBe("The root cause is");
  });
});

/*
 * However the server cuts the text into pieces - in the middle of a tag, a
 * character at a time - the message is the same, and so is its answer.
 */
describe("a tag split across pieces is one tag", () => {
  const REPLIES: ReadonlyArray<[string, string, string]> = [
    [
      "a template-opened block",
      "Okay, the deploy did it.\n</think>\n\nThe deploy is the cause.",
      "The deploy is the cause.",
    ],
    [
      "the model's own block",
      "<think>\nOkay, the deploy did it.\n</think>\n\nThe deploy is the cause.",
      "The deploy is the cause.",
    ],
    [
      "a parser's stray closing tag",
      "</think>I now have a comprehensive picture.",
      "I now have a comprehensive picture.",
    ],
    [
      "an answer with a tag in code",
      "Remove `</think>` and what comes before it.",
      "Remove `</think>` and what comes before it.",
    ],
    [
      "an answer that says the word",
      "I think the deploy is the cause.",
      "I think the deploy is the cause.",
    ],
  ];

  const streamOf: (pieces: ReadonlyArray<string>) => string = (
    pieces: ReadonlyArray<string>,
  ): string => {
    return toEventStream(
      pieces.map((piece: string): JSONObject => {
        return contentChunk({ model: "m", delta: { content: piece } });
      }),
    );
  };

  const answerOf: (stream: string) => string = (stream: string): string => {
    return ModelReasoning.read(
      messageOf(readStream(stream))["content"] as string,
    ).answer;
  };

  test.each(REPLIES)(
    "%s, cut in two and in three at every place",
    (_reply: string, text: string, answer: string) => {
      for (let first: number = 0; first <= text.length; first++) {
        expect(
          answerOf(streamOf([text.slice(0, first), text.slice(first)])),
        ).toBe(answer);

        for (let second: number = first; second <= text.length; second += 3) {
          expect(
            answerOf(
              streamOf([
                text.slice(0, first),
                text.slice(first, second),
                text.slice(second),
              ]),
            ),
          ).toBe(answer);
        }
      }
    },
  );

  test.each(REPLIES)(
    "%s, a character at a time",
    (_reply: string, text: string, answer: string) => {
      expect(answerOf(streamOf(Array.from(text)))).toBe(answer);
    },
  );
});

describe("the event stream format", () => {
  test("CRLF line endings, comments and data without a space", () => {
    const stream: string = [
      ": OPENROUTER PROCESSING",
      "",
      `data:${JSON.stringify(contentChunk({ model: "m", delta: { content: "<think>x</th" } }))}`,
      "",
      "event: message",
      `data: ${JSON.stringify(contentChunk({ model: "m", delta: { content: "ink>Hi" } }))}`,
      "id: 2",
      "",
      "data: [DONE]",
      "",
    ].join("\r\n");

    const message: JSONObject = messageOf(readStream(stream));

    expect(message["content"]).toBe("<think>x</think>Hi");
    expect(ModelReasoning.read(message["content"] as string).answer).toBe("Hi");
  });

  test("an event's data split over lines is one JSON value", () => {
    const chunk: string = JSON.stringify(
      contentChunk({ model: "m", delta: { content: "Hello" } }),
      null,
      2,
    );
    const stream: string = `${chunk
      .split("\n")
      .map((line: string): string => {
        return `data: ${line}`;
      })
      .join("\n")}\n\ndata: [DONE]\n\n`;

    expect(messageOf(readStream(stream))["content"]).toBe("Hello");
  });

  test("an event that is not JSON is skipped, and nothing after [DONE] is read", () => {
    const stream: string = [
      `data: ${JSON.stringify(contentChunk({ model: "m", delta: { content: "A" } }))}`,
      "",
      "data: {not json",
      "",
      `data: ${JSON.stringify(contentChunk({ model: "m", delta: { content: "B" } }))}`,
      "",
      "data: [DONE]",
      "",
      `data: ${JSON.stringify(contentChunk({ model: "m", delta: { content: "C" } }))}`,
      "",
    ].join("\n");

    expect(messageOf(readStream(stream))["content"]).toBe("AB");
  });

  test("the last event needs no blank line after it", () => {
    const stream: string = `data: ${JSON.stringify(
      contentChunk({
        model: "m",
        delta: { content: "end" },
        finishReason: "stop",
      }),
    )}`;

    expect(messageOf(readStream(stream))["content"]).toBe("end");
  });

  test("only the first choice is the answer", () => {
    const stream: string = toEventStream([
      {
        choices: [
          { index: 0, delta: { content: "first" } },
          { index: 1, delta: { content: "second" } },
        ],
      },
    ]);

    expect(messageOf(readStream(stream))["content"]).toBe("first");
  });

  test("the last finish reason, usage and model win", () => {
    const stream: string = toEventStream([
      contentChunk({
        model: "a",
        delta: { content: "x" },
        finishReason: "length",
      }),
      contentChunk({ model: "b", delta: {}, finishReason: "stop" }),
      {
        choices: [],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      },
      {
        choices: [],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      },
    ]);
    const reading: LLMStreamedAnswerReading = readStream(stream);

    expect(finishReasonOf(reading)).toBe("stop");
    expect(reading.body["model"]).toBe("b");
    expect((reading.body["usage"] as JSONObject)["total_tokens"]).toBe(3);
  });

  test("a message that brought no content says null, as a non-streamed one does", () => {
    const stream: string = toEventStream([
      contentChunk({ model: "m", delta: { role: "assistant" } }),
      contentChunk({ model: "m", delta: {}, finishReason: "stop" }),
    ]);

    expect(messageOf(readStream(stream))["content"]).toBeNull();
    expect(messageOf(readStream(stream))["reasoning_content"]).toBeUndefined();
  });

  test("text that is no event stream is read as nothing", () => {
    expect(LLMStreamedAnswer.read("")).toBeNull();
    expect(
      LLMStreamedAnswer.read("<html><body>Bad gateway</body></html>"),
    ).toBeNull();
    expect(LLMStreamedAnswer.read("data: [DONE]\n\n")).toBeNull();
    expect(LLMStreamedAnswer.read('data: {"hello": "world"}\n\n')).toBeNull();
  });
});

describe("tool calls in pieces", () => {
  test("a server that sends each call whole, with no index, gives each the next place", () => {
    const stream: string = toEventStream([
      contentChunk({
        model: "m",
        delta: {
          tool_calls: [
            { id: "a", function: { name: "one", arguments: "{}" } },
            { id: "b", function: { name: "two", arguments: '{"x":1}' } },
          ],
        },
        finishReason: "tool_calls",
      }),
    ]);

    expect(messageOf(readStream(stream))["tool_calls"]).toEqual([
      { id: "a", type: "function", function: { name: "one", arguments: "{}" } },
      {
        id: "b",
        type: "function",
        function: { name: "two", arguments: '{"x":1}' },
      },
    ]);
  });

  test("pieces of a call without an index find it by its id", () => {
    const stream: string = toEventStream([
      contentChunk({
        model: "m",
        delta: {
          tool_calls: [
            { id: "a", function: { name: "one", arguments: '{"x"' } },
          ],
        },
      }),
      contentChunk({
        model: "m",
        delta: { tool_calls: [{ id: "a", function: { arguments: ":1}" } }] },
      }),
    ]);

    expect(messageOf(readStream(stream))["tool_calls"]).toEqual([
      {
        id: "a",
        type: "function",
        function: { name: "one", arguments: '{"x":1}' },
      },
    ]);
  });

  test("arguments sent as an object are kept as their JSON, and a name only once", () => {
    const stream: string = toEventStream([
      contentChunk({
        model: "m",
        delta: {
          tool_calls: [
            {
              index: 0,
              id: "a",
              function: { name: "one", arguments: { x: 1 } },
            },
          ],
        },
      }),
      contentChunk({
        model: "m",
        delta: { tool_calls: [{ index: 0, function: { name: "one" } }] },
      }),
    ]);

    expect(messageOf(readStream(stream))["tool_calls"]).toEqual([
      {
        id: "a",
        type: "function",
        function: { name: "one", arguments: '{"x":1}' },
      },
    ]);
  });

  test("an index past the most calls an answer is read with is skipped", () => {
    const stream: string = toEventStream([
      contentChunk({
        model: "m",
        delta: {
          tool_calls: [
            {
              index: 100000,
              id: "far",
              function: { name: "x", arguments: "{}" },
            },
            { index: 0, id: "near", function: { name: "y", arguments: "{}" } },
          ],
        },
      }),
    ]);

    expect(messageOf(readStream(stream))["tool_calls"]).toEqual([
      {
        id: "near",
        type: "function",
        function: { name: "y", arguments: "{}" },
      },
    ]);
  });
});

describe("error events", () => {
  test("an error given as text", () => {
    expect(
      readStream(
        toEventStream([{ error: "upstream timed out" }], { done: false }),
      ).errorMessage,
    ).toBe("upstream timed out");
  });

  test("an error with no message still says the stream failed", () => {
    expect(
      readStream(toEventStream([{ error: { code: 500 } }], { done: false }))
        .errorMessage,
    ).toBe("the stream ended with an error");
  });
});
