/*
 * Index MUST be imported before anything that reaches a tool module (see
 * InvestigationEvidence.test.ts): it is the production import order.
 */
import AIToolbox from "../../../../Server/Utils/AI/Toolbox/Index";
import AIIncidentInvestigationRunner from "../../../../Server/Utils/AI/SRE/IncidentInvestigationRunner";
import AIAlertInvestigationRunner from "../../../../Server/Utils/AI/SRE/AlertInvestigationRunner";
import AIInvestigationQueue from "../../../../Server/Utils/AI/SRE/InvestigationQueue";
import AIMemory from "../../../../Server/Utils/AI/SRE/AIMemory";
import NetworkTransceiverContext from "../../../../Server/Utils/AI/SRE/NetworkTransceiverContext";
import IncidentAIContextBuilder, {
  IncidentContextData,
} from "../../../../Server/Utils/AI/IncidentAIContextBuilder";
import AlertAIContextBuilder, {
  AlertContextData,
} from "../../../../Server/Utils/AI/AlertAIContextBuilder";
import AIRunService from "../../../../Server/Services/AIRunService";
import AIRunEventService from "../../../../Server/Services/AIRunEventService";
import KubernetesClusterAiAccessService from "../../../../Server/Services/KubernetesClusterAiAccessService";
import LlmLogService from "../../../../Server/Services/LlmLogService";
import LlmProviderService from "../../../../Server/Services/LlmProviderService";
import ProjectService from "../../../../Server/Services/ProjectService";
import ResourceAiAccessService from "../../../../Server/Services/ResourceAiAccessService";
import LLMService from "../../../../Server/Utils/LLM/LLMService";
import logger from "../../../../Server/Utils/Logger";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertInternalNote from "../../../../Models/DatabaseModels/AlertInternalNote";
import AIRunEvent from "../../../../Models/DatabaseModels/AIRunEvent";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentInternalNote from "../../../../Models/DatabaseModels/IncidentInternalNote";
import LlmLog from "../../../../Models/DatabaseModels/LlmLog";
import LlmProvider from "../../../../Models/DatabaseModels/LlmProvider";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import Project from "../../../../Models/DatabaseModels/Project";
import API from "../../../../Utils/API";
import { MAX_PROMPT_FIELD_LENGTH } from "../../../../Utils/AI/PromptText";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import { AIPromptOmissions } from "../../../../Types/AI/AIChatTypes";
import AIRunEventType from "../../../../Types/AI/AIRunEventType";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import LlmType from "../../../../Types/LLM/LlmType";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import stubLLMEgressGuard from "./StubLLMEgressGuard";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ISSUE #4587, END TO END.
 *
 * A synthetic monitor's screenshot sits in an incident's description, placed
 * by the template the docs give:
 *
 *   ![](data:image/jpeg;base64,{{syntheticResponses.0.screenshots.<name>}})
 *
 * The investigation used to send that description, whole, in the seed of
 * every call to the model - a few hundred kilobytes of base64, well over a
 * hundred thousand tokens a call - and one investigation spent a customer's
 * whole daily AI limit.
 *
 * Here the runner, the engine, the agent loop, AIService and LLMService are
 * all real; only the database and the HTTP call to the model are not. What
 * is pinned is what reaches the provider: the words of the description and
 * a short note where the screenshot was, never its base64 - and the run's
 * activity saying what was left out.
 */

jest.mock("../../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  // A self-hosted install: the project's own provider, nothing billed.
  return { ...actual, IsBillingEnabled: false };
});

const PROVIDER: LlmProvider = {
  id: ObjectID.generate(),
  name: "Self-Hosted Ollama",
  llmType: LlmType.Ollama,
  baseUrl: "http://ollama.internal:11434",
  modelName: "qwen3.8",
  isGlobalLlm: false,
} as unknown as LlmProvider;

// A realistic screenshot: a JPEG's first bytes, then noise like a photo's.
function jpegScreenshot(kilobytes: number): string {
  const bytes: Buffer = Buffer.alloc(kilobytes * 1024);
  let seed: number = 3;

  for (let index: number = 0; index < bytes.length; index++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    bytes[index] = (seed >> 8) & 0xff;
  }

  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  bytes[3] = 0xe0;

  return bytes.toString("base64");
}

const SCREENSHOT: string = jpegScreenshot(256);
const SECOND_SCREENSHOT: string = jpegScreenshot(64);

// What the issue's template renders to, with the words a monitor puts around it.
const DESCRIPTION: string = [
  "Synthetic monitor **Checkout flow** failed on 3 probes.",
  "",
  "Error: Timeout 30000ms exceeded waiting for selector `#place-order`.",
  "",
  `![](data:image/jpeg;base64,${SCREENSHOT})`,
  "",
  "Last successful run: 4 minutes ago.",
].join("\n");

const NOTE_WITH_SCREENSHOT: string = `Same on my laptop:\n\n![Laptop](data:image/png;base64,${SECOND_SCREENSHOT})`;

// What the model answers: a finished report, no tool calls.
function ollamaFinalAnswer(): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(
    200,
    {
      message: {
        role: "assistant",
        content: "**Summary** The checkout button never rendered.",
      },
      done_reason: "stop",
      prompt_eval_count: 1_000,
      eval_count: 20,
    },
    {},
  );
}

/*
 * Rough tokens of text, as ChatAgentRunner estimates them: four characters
 * a token. It undercounts base64 - tokenizers take about three characters
 * of it a token - so the saving measured here is the least it is.
 */
function estimatedTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

describe("an investigation of an incident whose description carries a screenshot", () => {
  const aiRunId: ObjectID = ObjectID.generate();
  const projectId: ObjectID = ObjectID.generate();
  const incidentId: ObjectID = ObjectID.generate();
  const alertId: ObjectID = ObjectID.generate();

  let post: jest.SpyInstance;
  let createEvent: jest.SpyInstance;

  function sentMessages(callIndex: number = 0): Array<JSONObject> {
    const body: JSONObject = (
      post.mock.calls[callIndex]![0] as { data: JSONObject }
    ).data;

    return body["messages"] as JSONArray as Array<JSONObject>;
  }

  function sentText(callIndex: number = 0): string {
    return sentMessages(callIndex)
      .map((message: JSONObject): string => {
        return String(message["content"] || "");
      })
      .join("\n");
  }

  function recordedEvents(): Array<AIRunEvent> {
    return createEvent.mock.calls.map((call: Array<unknown>): AIRunEvent => {
      return (call[0] as { data: AIRunEvent }).data;
    });
  }

  function incidentContext(data: {
    description?: string | undefined;
    rootCause?: string | undefined;
    notes?: Array<string> | undefined;
  }): IncidentContextData {
    const monitor: Monitor = new Monitor(ObjectID.generate());
    monitor.name = "Checkout flow";

    const incident: Incident = new Incident(incidentId);
    incident.title = "Checkout flow is failing";
    incident.monitors = [monitor];

    if (data.description !== undefined) {
      incident.description = data.description;
    }

    if (data.rootCause !== undefined) {
      incident.rootCause = data.rootCause;
    }

    return {
      incident,
      stateTimeline: [],
      internalNotes: (data.notes || []).map(
        (text: string): IncidentInternalNote => {
          const note: IncidentInternalNote = new IncidentInternalNote();
          note.note = text;
          return note;
        },
      ),
      publicNotes: [],
      workspaceMessages: [],
    } as unknown as IncidentContextData;
  }

  async function investigateIncident(
    context: IncidentContextData,
  ): Promise<void> {
    jest
      .spyOn(IncidentAIContextBuilder, "buildIncidentContext")
      .mockResolvedValue(context);

    await AIIncidentInvestigationRunner.executeInvestigation({
      aiRunId,
      projectId,
      incidentId,
      attemptCount: 1,
    });
  }

  beforeEach(() => {
    expect(AIToolbox).toBeDefined();
    stubLLMEgressGuard();
    LLMService.clearRequestAdaptationCache();
    jest.spyOn(logger, "error").mockImplementation((): void => {});
    jest.spyOn(logger, "warn").mockImplementation((): void => {});

    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      id: projectId,
      enableAi: true,
    } as unknown as Project);
    jest
      .spyOn(LlmProviderService, "getProviderForChat")
      .mockResolvedValue(PROVIDER);
    jest.spyOn(LlmLogService, "create").mockResolvedValue(new LlmLog());

    jest.spyOn(AIMemory, "getPriorSimilarIncidentsContext").mockResolvedValue("");
    jest
      .spyOn(KubernetesClusterAiAccessService, "getStatusesForSubject")
      .mockResolvedValue([]);
    jest
      .spyOn(ResourceAiAccessService, "getStatusesForSubject")
      .mockResolvedValue([]);
    jest
      .spyOn(NetworkTransceiverContext, "buildContextSection")
      .mockResolvedValue("");

    jest
      .spyOn(AIRunEventService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    createEvent = jest
      .spyOn(AIRunEventService, "create")
      .mockResolvedValue({} as unknown as AIRunEvent);
    /*
     * The run "loses" its Completed transition, so the engine stops right
     * after the first call to the model: that call is what this is about.
     */
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(0);
    jest.spyOn(AIInvestigationQueue, "failOrRequeue").mockResolvedValue("noop");

    post = jest.spyOn(API, "post").mockResolvedValue(ollamaFinalAnswer());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the model reads the words around the screenshot, and a note where it was", async () => {
    await investigateIncident(incidentContext({ description: DESCRIPTION }));

    expect(post).toHaveBeenCalledTimes(1);

    const text: string = sentText();

    expect(text).toContain("Synthetic monitor **Checkout flow** failed on 3 probes.");
    expect(text).toContain("Timeout 30000ms exceeded waiting for selector");
    expect(text).toContain("![]([image omitted: JPEG, 256 KB])");
    expect(text).toContain("Last successful run: 4 minutes ago.");

    // Not one line of the screenshot's base64 reaches the provider.
    expect(text).not.toContain(SCREENSHOT.slice(1000, 1064));
    expect(text).not.toContain("data:image/jpeg;base64");
  });

  test("a screenshot in a note is left out too, and the root cause stays", async () => {
    await investigateIncident(
      incidentContext({
        description: DESCRIPTION,
        rootCause: "The payment provider's script failed to load.",
        notes: ["Rolled back the frontend at 10:02.", NOTE_WITH_SCREENSHOT],
      }),
    );

    const text: string = sentText();

    expect(text).toContain(
      "Root cause (as recorded so far): The payment provider's script failed to load.",
    );
    expect(text).toContain("- Rolled back the frontend at 10:02.");
    expect(text).toContain("![Laptop]([image omitted: JPEG, 64 KB])");
    expect(text).not.toContain(SECOND_SCREENSHOT.slice(500, 564));
  });

  test("the run's activity says what was left out, right after it starts", async () => {
    await investigateIncident(
      incidentContext({
        description: DESCRIPTION,
        notes: [NOTE_WITH_SCREENSHOT],
      }),
    );

    const events: Array<AIRunEvent> = recordedEvents();

    expect(events[0]!.eventType).toBe(AIRunEventType.RunStarted);
    expect(events[1]!.eventType).toBe(AIRunEventType.ProgressLog);
    expect(events[1]!.sequence).toBe(1);

    const omissions: AIPromptOmissions | undefined =
      events[1]!.resultSummary?.promptOmissions;

    expect(omissions).toEqual({
      imageCount: 2,
      imageBytes: (256 + 64) * 1024,
      encodedDataCount: 0,
      encodedDataBytes: 0,
      shortenedTextCount: 0,
      omittedCharacterCount: 0,
    });
    expect(events[1]!.resultSummary?.message).toBe(
      "Left out 2 embedded images (320 KB): AI reads text, not images.",
    );
    expect(events[1]!.resultSummary?.severity).toBe("Info");
  });

  test("a description too long for its field is cut, and the activity says so", async () => {
    const longDescription: string = "Payment request failed: upstream timed out. ".repeat(
      200,
    );

    await investigateIncident(
      incidentContext({ description: longDescription }),
    );

    const text: string = sentText();
    const omissions: AIPromptOmissions | undefined = recordedEvents().find(
      (event: AIRunEvent): boolean => {
        return event.eventType === AIRunEventType.ProgressLog;
      },
    )?.resultSummary?.promptOmissions;

    expect(text).toMatch(/more characters omitted\]/);
    expect(omissions?.shortenedTextCount).toBe(1);
    expect(omissions?.omittedCharacterCount).toBeGreaterThan(
      longDescription.length - MAX_PROMPT_FIELD_LENGTH - 1,
    );
  });

  test("an incident with nothing to leave out records no extra step, and reads as before", async () => {
    await investigateIncident(
      incidentContext({
        description: "Error rate above 5% on checkout.",
        rootCause: "Bad deploy.",
        notes: ["Rolled back."],
      }),
    );

    expect(
      recordedEvents().map((event: AIRunEvent): string | undefined => {
        return event.eventType;
      }),
    ).not.toContain(AIRunEventType.ProgressLog);

    expect(sentText()).toContain(
      [
        "# Incident",
        "Title: Checkout flow is failing",
        "Description: Error rate above 5% on checkout.",
      ].join("\n"),
    );
    expect(sentText()).toContain(
      "Root cause (as recorded so far): Bad deploy.\n\nRecent internal notes:\n- Rolled back.",
    );
  });

  test("tokens: the seed is a few hundred tokens, not a hundred thousand, on every call", async () => {
    await investigateIncident(incidentContext({ description: DESCRIPTION }));

    const sentTokens: number = estimatedTokens(sentText());
    // What the same call carried before: the description, base64 and all.
    const tokensBefore: number = sentTokens + estimatedTokens(DESCRIPTION);

    // 256 KB of JPEG is 349,528 characters of base64: 87,382 tokens at 4 a token.
    expect(estimatedTokens(DESCRIPTION)).toBeGreaterThan(87_000);
    expect(tokensBefore).toBeGreaterThan(90_000);

    /*
     * The whole first call - system prompt, persona and seed - is now a
     * small fraction of the description alone.
     */
    expect(sentTokens).toBeLessThan(15_000);
    expect(sentTokens / tokensBefore).toBeLessThan(0.15);

    // The seed itself: its part of the question is tiny.
    const question: string = String(
      sentMessages().find((message: JSONObject): boolean => {
        return message["role"] === "user";
      })!["content"],
    );

    expect(estimatedTokens(question)).toBeLessThan(500);

    /*
     * Over the 8 calls the issue counted, the screenshot alone would have
     * been 700,000 tokens of a run.
     */
    expect(8 * estimatedTokens(DESCRIPTION)).toBeGreaterThan(690_000);
  });

  test("an alert's investigation leaves its screenshot out the same way", async () => {
    const monitor: Monitor = new Monitor(ObjectID.generate());
    monitor.name = "Checkout flow";

    const alert: Alert = new Alert(alertId);
    alert.title = "Checkout flow is failing";
    alert.description = DESCRIPTION;
    alert.monitor = monitor;

    const note: AlertInternalNote = new AlertInternalNote();
    note.note = NOTE_WITH_SCREENSHOT;

    jest.spyOn(AlertAIContextBuilder, "buildAlertContext").mockResolvedValue({
      alert,
      stateTimeline: [],
      internalNotes: [note],
    } as unknown as AlertContextData);

    await AIAlertInvestigationRunner.executeInvestigation({
      aiRunId,
      projectId,
      alertId,
      attemptCount: 1,
    });

    const text: string = sentText();

    expect(text).toContain("![]([image omitted: JPEG, 256 KB])");
    expect(text).toContain("![Laptop]([image omitted: JPEG, 64 KB])");
    expect(text).not.toContain(SCREENSHOT.slice(1000, 1064));
    expect(
      recordedEvents().find((event: AIRunEvent): boolean => {
        return event.eventType === AIRunEventType.ProgressLog;
      })?.resultSummary?.promptOmissions?.imageCount,
    ).toBe(2);
  });
});
