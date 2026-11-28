import { JSONArray, JSONObject, JSONValue } from "../../../Types/JSON";

/*
 * A STREAMED ANSWER, READ WHOLE (issue #11255).
 *
 * OneUptime asks the OpenAI wire for one answer in one body: "stream" is
 * false unless a provider's Additional Parameters turn it on. Some
 * providers answer only as a stream - Alibaba Cloud Model Studio serves QwQ
 * and the open-source Qwen3 models streamed and nothing else, with their
 * reasoning in reasoning_content - and a gateway may stream whatever it is
 * asked. Such an answer arrives as server-sent events, each a
 * chat.completion.chunk with a piece of the message:
 *
 *   data: {"choices":[{"index":0,"delta":{"reasoning_content":"The user"}}]}
 *   data: {"choices":[{"index":0,"delta":{"content":"</th"}}]}
 *   data: {"choices":[{"index":0,"delta":{"content":"ink>The root"}}]}
 *   data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}
 *   data: {"choices":[],"usage":{"prompt_tokens":9,"completion_tokens":7}}
 *   data: [DONE]
 *
 * Read as one body, it said nothing OneUptime could read ("No response from
 * ..."), so a provider that streams could not be used at all. Its pieces are
 * put back together here into the message a non-streamed answer carries -
 * the content, the reasoning, the tool calls by their index, why it stopped,
 * what it used and which model answered - and LLMService reads that like
 * any other answer. A model's reasoning is taken out of the whole text, after
 * the last piece (ModelReasoning): a tag split across two pieces is one tag,
 * and a closing tag that comes last still makes everything before it
 * reasoning. No piece is judged on its own.
 *
 * Only the first choice is read: OneUptime asks for one (n is 1). An event
 * that is not JSON, a comment and the fields other than data are skipped,
 * as the event stream format has it.
 *
 * Pure, with no database or network imports.
 */

// The most tool calls one answer is read with; an index past it is skipped.
const MAX_STREAMED_TOOL_CALLS: number = 128;

export interface LLMStreamedAnswerReading {
  /*
   * The answer the stream sent, as a non-streamed one carries it:
   * { model, choices: [{ index, message, finish_reason }], usage }.
   */
  body: JSONObject;
  // What an error event of the stream said, when it sent one.
  errorMessage?: string | undefined;
}

interface StreamedToolCall {
  id: string;
  name: string;
  arguments: string;
}

interface StreamedMessage {
  content: Array<string>;
  reasoning: Array<string>;
  toolCalls: Array<StreamedToolCall | undefined>;
  // Whether any piece of content came, an empty one too.
  hasContent: boolean;
  finishReason: string | null;
  usage: JSONObject | null;
  model: string | null;
  errorMessage: string | null;
  // Whether an event was a chunk of an answer at all.
  readChunk: boolean;
}

const asObject: (value: JSONValue | undefined) => JSONObject | null = (
  value: JSONValue | undefined,
): JSONObject | null => {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : null;
};

export default class LLMStreamedAnswer {
  /**
   * The answer a body of server-sent events streamed, or null when the text
   * is no such stream (no event of it is a chunk of an answer).
   */
  public static read(text: string): LLMStreamedAnswerReading | null {
    const message: StreamedMessage = {
      content: [],
      reasoning: [],
      toolCalls: [],
      hasContent: false,
      finishReason: null,
      usage: null,
      model: null,
      errorMessage: null,
      readChunk: false,
    };

    for (const data of LLMStreamedAnswer.readEvents(text)) {
      if (data.trim() === "[DONE]") {
        break;
      }

      let event: JSONValue;

      try {
        event = JSON.parse(data) as JSONValue;
      } catch {
        continue;
      }

      const chunk: JSONObject | null = asObject(event);

      if (chunk) {
        LLMStreamedAnswer.addChunk(message, chunk);
      }
    }

    if (!message.readChunk) {
      return null;
    }

    const assembled: JSONObject = {
      role: "assistant",
      content: message.hasContent ? message.content.join("") : null,
    };

    if (message.reasoning.length > 0) {
      assembled["reasoning_content"] = message.reasoning.join("");
    }

    const toolCalls: Array<StreamedToolCall> = message.toolCalls.filter(
      (call: StreamedToolCall | undefined): call is StreamedToolCall => {
        return call !== undefined;
      },
    );

    if (toolCalls.length > 0) {
      assembled["tool_calls"] = toolCalls.map(
        (call: StreamedToolCall): JSONObject => {
          return {
            id: call.id,
            type: "function",
            function: { name: call.name, arguments: call.arguments },
          };
        },
      );
    }

    const body: JSONObject = {
      choices: [
        {
          index: 0,
          message: assembled,
          finish_reason: message.finishReason,
        },
      ],
    };

    if (message.usage) {
      body["usage"] = message.usage;
    }

    if (message.model) {
      body["model"] = message.model;
    }

    return {
      body: body,
      ...(message.errorMessage ? { errorMessage: message.errorMessage } : {}),
    };
  }

  /*
   * The data of each event, in order: the event's data lines joined with a
   * line break, dispatched at a blank line or at the end of the text.
   */
  private static readEvents(text: string): Array<string> {
    const events: Array<string> = [];
    let dataLines: Array<string> = [];
    let lineStart: number = 0;

    const dispatch: () => void = (): void => {
      if (dataLines.length > 0) {
        events.push(dataLines.join("\n"));
        dataLines = [];
      }
    };

    while (lineStart <= text.length) {
      const newLine: number = text.indexOf("\n", lineStart);
      const lineEnd: number = newLine === -1 ? text.length : newLine;
      let line: string = text.slice(lineStart, lineEnd);

      if (line.endsWith("\r")) {
        line = line.slice(0, -1);
      }

      if (!line) {
        dispatch();
      } else if (line.startsWith("data:")) {
        const value: string = line.slice("data:".length);

        dataLines.push(value.startsWith(" ") ? value.slice(1) : value);
      }

      if (newLine === -1) {
        break;
      }

      lineStart = newLine + 1;
    }

    dispatch();

    return events;
  }

  private static addChunk(message: StreamedMessage, chunk: JSONObject): void {
    const error: JSONObject | null = asObject(chunk["error"]);

    if (error || typeof chunk["error"] === "string") {
      message.readChunk = true;
      message.errorMessage =
        (typeof chunk["error"] === "string"
          ? chunk["error"]
          : typeof error?.["message"] === "string"
            ? (error["message"] as string)
            : "") || "the stream ended with an error";
      return;
    }

    if (typeof chunk["model"] === "string" && chunk["model"]) {
      message.model = chunk["model"];
    }

    const usage: JSONObject | null = asObject(chunk["usage"]);

    if (usage) {
      message.readChunk = true;
      message.usage = usage;
    }

    if (!Array.isArray(chunk["choices"])) {
      return;
    }

    message.readChunk = true;

    for (const rawChoice of chunk["choices"] as JSONArray) {
      const choice: JSONObject | null = asObject(rawChoice);

      // One answer is asked for: the first choice is the answer.
      if (!choice || (typeof choice["index"] === "number" && choice["index"])) {
        continue;
      }

      const delta: JSONObject | null =
        asObject(choice["delta"]) || asObject(choice["message"]);

      if (delta) {
        LLMStreamedAnswer.addDelta(message, delta);
      }

      if (
        typeof choice["finish_reason"] === "string" &&
        choice["finish_reason"]
      ) {
        message.finishReason = choice["finish_reason"];
      }
    }
  }

  private static addDelta(message: StreamedMessage, delta: JSONObject): void {
    const content: JSONValue | undefined = delta["content"];

    if (typeof content === "string") {
      message.hasContent = true;
      message.content.push(content);
    } else if (Array.isArray(content)) {
      /*
       * Mistral streams a Magistral model's thinking as a list of parts
       * ({ type: "thinking", thinking: [{ type: "text", text }] }), then
       * its answer as text.
       */
      for (const rawPart of content) {
        const part: JSONObject | null = asObject(rawPart);

        if (!part) {
          continue;
        }

        const type: JSONValue | undefined = part["type"];

        if (type === "thinking" || type === "reasoning") {
          message.reasoning.push(LLMStreamedAnswer.readPartText(part));
        } else if (typeof part["text"] === "string") {
          message.hasContent = true;
          message.content.push(part["text"]);
        }
      }
    }

    /*
     * DeepSeek, vLLM, SGLang and Model Studio send reasoning_content; newer
     * vLLM, Ollama and OpenRouter send reasoning.
     */
    for (const key of ["reasoning_content", "reasoning"]) {
      if (typeof delta[key] === "string" && delta[key]) {
        message.reasoning.push(delta[key] as string);
      }
    }

    if (Array.isArray(delta["tool_calls"])) {
      for (const rawCall of delta["tool_calls"] as JSONArray) {
        const call: JSONObject | null = asObject(rawCall);

        if (call) {
          LLMStreamedAnswer.addToolCallPiece(message, call);
        }
      }
    }
  }

  /*
   * One piece of a tool call. Pieces of one call share its index: the first
   * names its id and function, the rest carry more of its arguments. A
   * server that sends each call whole, without an index, gives it the next.
   */
  private static addToolCallPiece(
    message: StreamedMessage,
    piece: JSONObject,
  ): void {
    const id: string = typeof piece["id"] === "string" ? piece["id"] : "";
    let slot: number = -1;

    if (typeof piece["index"] === "number" && piece["index"] >= 0) {
      slot = Math.floor(piece["index"]);
    } else if (id) {
      slot = message.toolCalls.findIndex(
        (call: StreamedToolCall | undefined): boolean => {
          return call?.id === id;
        },
      );
    }

    if (slot === -1) {
      slot = message.toolCalls.length;
    }

    if (slot >= MAX_STREAMED_TOOL_CALLS) {
      return;
    }

    const call: StreamedToolCall = message.toolCalls[slot] || {
      id: "",
      name: "",
      arguments: "",
    };

    message.toolCalls[slot] = call;

    if (id && !call.id) {
      call.id = id;
    }

    const fn: JSONObject | null = asObject(piece["function"]);

    if (!fn) {
      return;
    }

    if (typeof fn["name"] === "string" && fn["name"] && !call.name) {
      call.name = fn["name"];
    }

    const args: JSONValue | undefined = fn["arguments"];

    if (typeof args === "string") {
      call.arguments += args;
    } else if (asObject(args)) {
      call.arguments = JSON.stringify(args);
    }
  }

  // The text of a thinking part: a string, or a list of text parts.
  private static readPartText(part: JSONObject): string {
    for (const key of ["thinking", "reasoning", "text"]) {
      const value: JSONValue | undefined = part[key];

      if (typeof value === "string") {
        return value;
      }

      if (Array.isArray(value)) {
        return value
          .map((inner: JSONValue): string => {
            const innerPart: JSONObject | null = asObject(inner);

            return typeof innerPart?.["text"] === "string"
              ? (innerPart["text"] as string)
              : typeof inner === "string"
                ? inner
                : "";
          })
          .join("");
      }
    }

    return "";
  }
}
