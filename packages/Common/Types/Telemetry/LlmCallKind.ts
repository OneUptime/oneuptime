/*
 * What one AI call DID, in words a person reads without knowing the
 * conventions.
 *
 * Instrumentations name the operation three different ways - the GenAI
 * semantic conventions' gen_ai.operation.name ("chat", "execute_tool",
 * "invoke_agent", ...), OpenLLMetry's llm.request.type ("chat",
 * "completion", "embedding", "rerank") and OpenInference's
 * openinference.span.kind ("LLM", "TOOL", "AGENT", "CHAIN", ...). The
 * product needs one answer to "is this the model answering, a tool, an agent
 * run or a search?", for three readers:
 *
 *   - the answer checks at ingest (LlmAnswerIssue), which only judge calls
 *     that produce an answer - an embedding has no answer to be empty;
 *   - the AI / LLM monitor, whose "bad answers as a share of answers" would
 *     be diluted by every embedding and tool run a RAG or agent app makes;
 *   - the conversation view, which draws a tool run as a tool card and an
 *     embedding as a quiet "searched documents" line.
 *
 * So the kind is decided once, at ingest, and stored in the Span's
 * llmCallKind column. Rows written before that column existed read "".
 *
 * These values are persisted - never rename one.
 */
export enum LlmCallKind {
  // A model generating a response: chat, text completion, generate content.
  Answer = "answer",
  // An agent, chain or workflow run that wraps the calls it makes.
  Agent = "agent",
  // A tool the model asked the app to run.
  Tool = "tool",
  // Turning text into vectors.
  Embedding = "embedding",
  // Searching: a vector store, a retriever, a reranker, a memory search.
  Retrieval = "retrieval",
  // Anything else an instrumentation reports (memory writes, guardrails...).
  Other = "other",
}

/*
 * Operation names, lower-cased, by kind. A name absent from every list falls
 * through to the model/tool/agent fields in getKind.
 */
const ANSWER_OPERATIONS: ReadonlySet<string> = new Set<string>([
  // GenAI semantic conventions.
  "chat",
  "text_completion",
  "generate_content",
  // OpenLLMetry (llm.request.type).
  "completion",
  // OpenInference (openinference.span.kind = "LLM").
  "llm",
  // Spellings seen from frameworks and gateways.
  "completions",
  "chat_completion",
  "chat.completions",
  "generate",
  "generation",
  "responses",
  "response",
]);

const AGENT_OPERATIONS: ReadonlySet<string> = new Set<string>([
  "invoke_agent",
  "create_agent",
  "invoke_workflow",
  "plan",
  // OpenInference.
  "agent",
  "chain",
  // OpenLLMetry span kinds (traceloop.span.kind).
  "workflow",
  "task",
]);

const TOOL_OPERATIONS: ReadonlySet<string> = new Set<string>([
  "execute_tool",
  // OpenInference.
  "tool",
  "tool_call",
  "function",
  "function_call",
]);

const EMBEDDING_OPERATIONS: ReadonlySet<string> = new Set<string>([
  "embeddings",
  "embedding",
  "embed",
]);

const RETRIEVAL_OPERATIONS: ReadonlySet<string> = new Set<string>([
  "retrieval",
  "search_memory",
  // OpenInference.
  "retriever",
  "reranker",
  // OpenLLMetry.
  "rerank",
  "retrieve",
  "vector_search",
]);

export interface LlmCallKindInput {
  // The raw operation, as denormalized into Span.llmOperation.
  operation: string;
  // Requested or served model; "" when none.
  model: string;
  toolName: string;
  agentName: string;
}

export interface LlmCallKindDisplay {
  kind: LlmCallKind;
  // One or two words: "AI answer", "Tool", "Agent run".
  title: string;
}

const KIND_TITLES: Record<LlmCallKind, string> = {
  [LlmCallKind.Answer]: "AI answer",
  [LlmCallKind.Agent]: "Agent run",
  [LlmCallKind.Tool]: "Tool",
  [LlmCallKind.Embedding]: "Embedding",
  [LlmCallKind.Retrieval]: "Search",
  [LlmCallKind.Other]: "Other",
};

export class LlmCallKindUtil {
  public static getKind(input: LlmCallKindInput): LlmCallKind {
    const operation: string = (input.operation || "").trim().toLowerCase();

    if (ANSWER_OPERATIONS.has(operation)) {
      return LlmCallKind.Answer;
    }

    if (TOOL_OPERATIONS.has(operation)) {
      return LlmCallKind.Tool;
    }

    if (AGENT_OPERATIONS.has(operation)) {
      return LlmCallKind.Agent;
    }

    if (EMBEDDING_OPERATIONS.has(operation)) {
      return LlmCallKind.Embedding;
    }

    if (RETRIEVAL_OPERATIONS.has(operation)) {
      return LlmCallKind.Retrieval;
    }

    if (operation) {
      /*
       * An operation we do not know. A model on it still says a model was
       * called - but an unknown verb next to a tool name (memory writes,
       * guardrails) is not an answer the checks should judge.
       */
      if (input.toolName.trim()) {
        return LlmCallKind.Tool;
      }

      return LlmCallKind.Other;
    }

    /*
     * No operation at all: the older instrumentations. Decide from what the
     * call carries - a tool name is a tool run, an agent name without a model
     * is the agent's own span, and a model is a model call.
     */
    if (input.toolName.trim()) {
      return LlmCallKind.Tool;
    }

    if (input.model.trim()) {
      return LlmCallKind.Answer;
    }

    if (input.agentName.trim()) {
      return LlmCallKind.Agent;
    }

    return LlmCallKind.Other;
  }

  /*
   * A stored value read back. "" (rows written before the column existed)
   * and anything unknown read as undefined, so a caller decides what an old
   * row means instead of it silently becoming one kind.
   */
  public static fromStoredValue(value: unknown): LlmCallKind | undefined {
    if (typeof value !== "string") {
      return undefined;
    }

    const kinds: Array<string> = Object.values(LlmCallKind);

    return kinds.includes(value) ? (value as LlmCallKind) : undefined;
  }

  public static isAnswer(kind: LlmCallKind | undefined): boolean {
    return kind === LlmCallKind.Answer;
  }

  public static getTitle(kind: LlmCallKind): string {
    return KIND_TITLES[kind];
  }

  public static getAllKinds(): Array<LlmCallKindDisplay> {
    return Object.values(LlmCallKind).map(
      (kind: LlmCallKind): LlmCallKindDisplay => {
        return { kind: kind, title: KIND_TITLES[kind] };
      },
    );
  }
}
