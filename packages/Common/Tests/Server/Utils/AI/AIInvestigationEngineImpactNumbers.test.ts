import AIInvestigationEngine, {
  INVESTIGATION_PERSONA,
  InvestigationRequest,
} from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import AIConfidenceSignal, {
  ConfidenceSignal,
} from "../../../../Server/Utils/AI/SRE/ConfidenceSignal";
import InvestigationTldr from "../../../../Server/Utils/AI/SRE/InvestigationTldr";
import ObservabilityAssistant, {
  ObservabilityAssistantResult,
} from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import LlmProviderChoice, {
  RuleLlmProviderChoice,
} from "../../../../Server/Utils/AI/LlmProviderChoice";
import AIRunEventService from "../../../../Server/Services/AIRunEventService";
import AIRunService from "../../../../Server/Services/AIRunService";
import logger from "../../../../Server/Utils/Logger";
import AIRunEvent from "../../../../Models/DatabaseModels/AIRunEvent";
import AIRunEventType from "../../../../Types/AI/AIRunEventType";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import {
  INVESTIGATION_IMPACT_NUMBERS_LANGUAGE,
  InvestigationImpactCounted,
  parseInvestigationImpactNumbers,
} from "../../../../Utils/AI/InvestigationImpactNumbers";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * WHO AND WHAT IT HURTS, IN NUMBERS, FROM THE RUN (AIInvestigationEngine.
 * executeRun, #5715's follow-up).
 *
 * The persona asks the answer to close with the Impact section's numbers in
 * one fenced block (impact-numbers). The engine takes the block off before
 * anything reads the answer - the TL;DR, the confidence classification, the
 * posted report and so the timeline and the chats never show it - and an
 * incident's or alert's run records the numbers as an InvestigationImpact
 * event before the report is posted, so the AI card's folded step draws
 * them from its first look. A run whose answer has no block that reads, or
 * that is no incident or alert investigation, records nothing.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

const FOUND_THE_CAUSE: ConfidenceSignal = {
  confident: true,
  source: "classification",
  codeFixRecommended: false,
};

const REPORT: string = [
  "**Summary** — checkout requests queued for a database connection [C1].",
  "",
  "**Impact** —",
  "- **Users:** about 1,240 failed requests between 17:58 and 18:11 UTC [C1].",
  "- **Services:** checkout-api and the storefront [C1].",
  "- **SLOs:** Checkout latency is at risk [C1].",
  "",
  "**Most likely root cause** — the pool was cut from 40 to 10 [C1].",
].join("\n");

const BLOCK: string = [
  `\`\`\`${INVESTIGATION_IMPACT_NUMBERS_LANGUAGE}`,
  '{"users": {"count": 1240, "counted": "requests"}, "services": {"count": 2}, "slos": {"affected": 1, "total": 2}}',
  "```",
].join("\n");

function noPick(): RuleLlmProviderChoice {
  return {
    provider: null,
    source: null,
    fallbackReason: null,
    pickedProviderId: "",
    activity: null,
  };
}

describe("AIInvestigationEngine.executeRun: the impact's numbers", () => {
  const aiRunId: ObjectID = ObjectID.generate();
  let events: Array<AIRunEvent>;
  let eventsWhenPosted: Array<AIRunEventType | undefined>;
  let posted: Array<string>;
  let answer: string;
  let tldr: SpyInstance<typeof InvestigationTldr.generateTldr>;
  let confidence: SpyInstance<
    typeof AIConfidenceSignal.computeConfidenceSignal
  >;

  function result(): ObservabilityAssistantResult {
    return {
      contentInMarkdown: answer,
      citations: [],
      totalTokens: 100,
      llmCallCount: 2,
      toolCallCount: 0,
    };
  }

  function request(
    overrides: Partial<InvestigationRequest> = {},
  ): InvestigationRequest {
    return {
      feature: "AI Incident Investigation",
      incidentId: INCIDENT_ID,
      contextSummary: "# Incident\nTitle: Checkout is slow",
      persistAnalysisTldr: true,
      recordImpactNumbers: true,
      postAnalysis: async (data: {
        analysisMarkdown: string;
      }): Promise<void> => {
        posted.push(data.analysisMarkdown);
        eventsWhenPosted = events.map((event: AIRunEvent) => {
          return event.eventType;
        });
      },
      ...overrides,
    };
  }

  async function run(
    overrides: Partial<InvestigationRequest> = {},
  ): Promise<void> {
    await AIInvestigationEngine.executeRun({
      aiRunId,
      projectId: PROJECT_ID,
      attemptCount: 1,
      request: request(overrides),
    });
  }

  function impacts(): Array<AIRunEvent> {
    return events.filter((event: AIRunEvent): boolean => {
      return event.eventType === AIRunEventType.InvestigationImpact;
    });
  }

  beforeEach(() => {
    events = [];
    eventsWhenPosted = [];
    posted = [];
    answer = `${REPORT}\n\n${BLOCK}`;
    jest
      .spyOn(AIRunEventService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(AIRunEventService, "create")
      .mockImplementation(async (data: unknown) => {
        const event: AIRunEvent = (data as { data: AIRunEvent }).data;
        events.push(event);
        return event;
      });
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);
    jest.spyOn(AIRunService, "updateOneBy").mockResolvedValue(1);
    tldr = jest
      .spyOn(InvestigationTldr, "generateTldr")
      .mockResolvedValue(null);
    confidence = jest
      .spyOn(AIConfidenceSignal, "computeConfidenceSignal")
      .mockResolvedValue(FOUND_THE_CAUSE);
    jest
      .spyOn(ObservabilityAssistant, "answerQuestion")
      .mockImplementation(async () => {
        return result();
      });
    jest.spyOn(LlmProviderChoice, "decideForRun").mockResolvedValue(noPick());
    jest.spyOn(logger, "debug").mockImplementation((): void => {});
    jest.spyOn(logger, "warn").mockImplementation((): void => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the numbers are recorded on the run, before the report is posted", async () => {
    await run();

    expect(impacts()).toHaveLength(1);
    const event: AIRunEvent = impacts()[0]!;

    expect(
      parseInvestigationImpactNumbers(event.resultSummary?.impactNumbers),
    ).toEqual({
      users: { count: 1240, counted: InvestigationImpactCounted.Requests },
      services: { count: 2 },
      slos: { affected: 1, total: 2 },
    });
    expect(event.resultSummary?.message).toBe(
      "Affected: 1240 requests, 2 services, 1 of 2 SLOs.",
    );

    // Before the report: the card reads them with the report's first look.
    expect(eventsWhenPosted).toContain(AIRunEventType.InvestigationImpact);
    expect(eventsWhenPosted).not.toContain(AIRunEventType.RunCompleted);
    expect(events[events.length - 1]!.eventType).toBe(
      AIRunEventType.RunCompleted,
    );
  });

  test("the report posted - to the timeline, the chats and the card - never shows the block", async () => {
    await run();

    expect(posted).toHaveLength(1);
    expect(posted[0]).not.toContain(INVESTIGATION_IMPACT_NUMBERS_LANGUAGE);
    expect(posted[0]).not.toContain('"counted"');
    // The report itself is posted whole.
    expect(posted[0]).toContain(
      "- **Users:** about 1,240 failed requests between 17:58 and 18:11 UTC [C1].",
    );
    expect(posted[0]).toContain(
      "**Most likely root cause** — the pool was cut from 40 to 10 [C1].",
    );
  });

  test("the TL;DR and the confidence classification read the answer without it", async () => {
    await run();

    const summarized: string = (
      tldr.mock.calls[0]![0] as { analysisMarkdown: string }
    ).analysisMarkdown;
    const classified: string = (
      confidence.mock.calls[0]![0] as { analysisMarkdown: string }
    ).analysisMarkdown;

    expect(summarized).toBe(REPORT);
    expect(classified).toBe(REPORT);
  });

  test("an answer with no block records nothing, and posts as ever", async () => {
    answer = REPORT;

    await run();

    expect(impacts()).toEqual([]);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain(REPORT.split("\n")[0]!);
  });

  test("a block that does not read records nothing, and comes off all the same", async () => {
    answer = `${REPORT}\n\n\`\`\`impact-numbers\n{"users": "lots"}\n\`\`\``;

    await run();

    expect(impacts()).toEqual([]);
    expect(posted[0]).not.toContain("impact-numbers");
  });

  test("a run that is no incident or alert investigation records nothing, and its report has no block either", async () => {
    await run({ recordImpactNumbers: undefined });

    expect(impacts()).toEqual([]);
    expect(posted[0]).not.toContain("impact-numbers");
  });

  test("an answer that was nothing but the block is no analysis: nothing is posted", async () => {
    answer = BLOCK;

    await run();

    expect(posted).toEqual([]);
    expect(impacts()).toEqual([]);
    expect(events[events.length - 1]!.eventType).toBe(
      AIRunEventType.RunCompleted,
    );
  });

  test("a failed write of the numbers is logged, and the report still posts", async () => {
    const error: SpyInstance<typeof logger.error> = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {});
    const create: SpyInstance<typeof AIRunEventService.create> = jest.spyOn(
      AIRunEventService,
      "create",
    );
    create.mockImplementation(async (data: unknown) => {
      const event: AIRunEvent = (data as { data: AIRunEvent }).data;

      if (event.eventType === AIRunEventType.InvestigationImpact) {
        throw new Error("Postgres is restarting");
      }

      events.push(event);
      return event;
    });

    await run();

    expect(posted).toHaveLength(1);
    expect(impacts()).toEqual([]);
    expect(events[events.length - 1]!.eventType).toBe(
      AIRunEventType.RunCompleted,
    );
    expect(error).toHaveBeenCalled();
  });
});

/*
 * What the persona asks for is what the engine takes: the block's language,
 * its three parts, the words for what was counted, and never a guessed
 * number.
 */
describe("the persona asks for the numbers the engine takes", () => {
  test("one fenced block in the block's own language, closing the answer", () => {
    expect(INVESTIGATION_PERSONA).toContain(
      `one fenced code block whose language is ${INVESTIGATION_IMPACT_NUMBERS_LANGUAGE}, holding one JSON object and nothing else`,
    );
    expect(INVESTIGATION_PERSONA).toContain(
      "OneUptime takes this block off the note: write nothing after it.",
    );

    // Its example reads as the engine reads a block.
    const example: string = INVESTIGATION_PERSONA.slice(
      INVESTIGATION_PERSONA.indexOf(
        `\`\`\`${INVESTIGATION_IMPACT_NUMBERS_LANGUAGE}`,
      ),
    );
    const firstLine: string = example.split("\n")[1]!;

    expect(parseInvestigationImpactNumbers(JSON.parse(firstLine))).toEqual({
      users: { count: 1240, counted: InvestigationImpactCounted.Requests },
      services: { count: 2 },
      slos: { affected: 1, total: 2 },
    });
  });

  test("what was counted is named with the words the engine reads, and nothing is guessed", () => {
    expect(INVESTIGATION_PERSONA).toContain(
      '"counted" says what you counted: "users", "sessions" or "requests".',
    );
    for (const counted of Object.values(InvestigationImpactCounted)) {
      expect(INVESTIGATION_PERSONA).toContain(`"${counted}"`);
    }
    expect(INVESTIGATION_PERSONA).toContain(
      "Leave out each one you did not measure - never guess a number - and write {} when you measured none.",
    );
  });

  test("the SLOs it counts are the ones the context lists", () => {
    expect(INVESTIGATION_PERSONA).toContain(
      '"slos" counts the SLOs it burns ("affected") of the SLOs the context lists under Impact ("total").',
    );
  });

  test("the block comes after the last section, so the report reads as before", () => {
    const nextSteps: number = INVESTIGATION_PERSONA.indexOf(
      "**Suggested next steps** —",
    );
    const block: number = INVESTIGATION_PERSONA.indexOf(
      `\`\`\`${INVESTIGATION_IMPACT_NUMBERS_LANGUAGE}`,
    );

    expect(nextSteps).toBeGreaterThan(0);
    expect(block).toBeGreaterThan(nextSteps);
  });
});
