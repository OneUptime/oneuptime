import AIInvestigationEngine, {
  INVESTIGATION_PERSONA,
  InvestigationRequest,
} from "../../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import AIConfidenceSignal from "../../../../../Server/Utils/AI/SRE/ConfidenceSignal";
import InvestigationTldr from "../../../../../Server/Utils/AI/SRE/InvestigationTldr";
import ObservabilityAssistant, {
  ObservabilityAssistantRequest,
  ObservabilityAssistantResult,
} from "../../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import LlmProviderChoice, {
  RuleLlmProviderChoice,
} from "../../../../../Server/Utils/AI/LlmProviderChoice";
import AIRunEventService from "../../../../../Server/Services/AIRunEventService";
import AIRunService from "../../../../../Server/Services/AIRunService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import logger from "../../../../../Server/Utils/Logger";
import AIRunEvent from "../../../../../Models/DatabaseModels/AIRunEvent";
import Project from "../../../../../Models/DatabaseModels/Project";
import AIRunEventType from "../../../../../Types/AI/AIRunEventType";
import {
  AiContextActivity,
  AiContextSource,
} from "../../../../../Types/AI/AiContext";
import ObjectID from "../../../../../Types/ObjectID";
import PositiveNumber from "../../../../../Types/PositiveNumber";
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
 * EVERY RUN OF THE ENGINE READS ITS PROJECT'S AI CONTEXT (issue #5198):
 * investigations of incidents and alerts, follow-up checks, AI insight
 * triage, security case triage and every fix (planning, commands, MCP) go
 * through AIInvestigationEngine.executeRun. It reads the project's notes
 * itself, adds the rules' its caller hands it, records exactly what it read
 * in the run's activity before the model starts, and hands the same to the
 * agent loop, which places it first in the system prompt. Nothing to read:
 * nothing recorded, and the loop told so (null) - it reads nothing again.
 */

const PROJECT_A: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const PROJECT_B: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const NOTES_A: string =
  "## Symptom → owner\n- 502 on /checkout: payments team, check payments-db.";
const NOTES_B: string = "## Project B's own notes";

const NO_PICK: RuleLlmProviderChoice = {
  provider: null,
  source: null,
  fallbackReason: null,
  pickedProviderId: "",
  activity: null,
};

function result(): ObservabilityAssistantResult {
  return {
    contentInMarkdown:
      "**Summary** — payments-db saturated.\n\n**Most likely root cause** — connections.",
    citations: [],
    totalTokens: 100,
    llmCallCount: 2,
    toolCallCount: 3,
  };
}

function request(
  overrides: Partial<InvestigationRequest> = {},
): InvestigationRequest {
  return {
    feature: "AI Incident Investigation",
    incidentId: INCIDENT_ID,
    contextSummary: "# Incident\nTitle: Checkout is down",
    postAnalysis: async (): Promise<void> => {
      return undefined;
    },
    ...overrides,
  };
}

describe("AIInvestigationEngine.executeRun: the project's AI context", () => {
  let events: Array<AIRunEvent>;
  let answer: SpyInstance<typeof ObservabilityAssistant.answerQuestion>;
  let projectRead: SpyInstance<typeof ProjectService.findOneById>;
  let projectNotes: Record<string, string | undefined>;

  async function run(
    projectId: ObjectID,
    overrides: Partial<InvestigationRequest> = {},
  ): Promise<void> {
    await AIInvestigationEngine.executeRun({
      aiRunId: ObjectID.generate(),
      projectId,
      attemptCount: 1,
      request: request(overrides),
    });
  }

  function aiContextEvents(): Array<AIRunEvent> {
    return events.filter((event: AIRunEvent): boolean => {
      return Boolean(event.resultSummary?.aiContext);
    });
  }

  function loopRequest(index: number = 0): ObservabilityAssistantRequest {
    return answer.mock.calls[index]![0] as ObservabilityAssistantRequest;
  }

  beforeEach(() => {
    events = [];
    projectNotes = {
      [PROJECT_A.toString()]: NOTES_A,
      [PROJECT_B.toString()]: NOTES_B,
    };

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
    jest.spyOn(AIConfidenceSignal, "computeConfidenceSignal").mockResolvedValue({
      confident: true,
      codeFixRecommended: false,
      source: "classification",
    });
    jest.spyOn(InvestigationTldr, "generateTldr").mockResolvedValue(null);
    jest.spyOn(LlmProviderChoice, "decideForRun").mockResolvedValue(NO_PICK);
    answer = jest
      .spyOn(ObservabilityAssistant, "answerQuestion")
      .mockResolvedValue(result());
    projectRead = jest
      .spyOn(ProjectService, "findOneById")
      .mockImplementation(async (data: { id: ObjectID }) => {
        const project: Project = new Project(data.id);
        const notes: string | undefined = projectNotes[data.id.toString()];

        if (notes !== undefined) {
          project.aiContext = notes;
        }

        return project;
      });
    jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("records what it read, word for word, before the model starts", async () => {
    await run(PROJECT_A);

    const recorded: Array<AIRunEvent> = aiContextEvents();

    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.eventType).toBe(AIRunEventType.ProgressLog);
    expect(recorded[0]!.projectId?.toString()).toBe(PROJECT_A.toString());
    expect(recorded[0]!.resultSummary!.aiContext!.parts).toEqual([
      { source: AiContextSource.Project, text: NOTES_A },
    ]);
    expect(recorded[0]!.resultSummary!.message).toContain(
      "Read the project's AI context",
    );

    // After the run started, before the loop's first step.
    const types: Array<AIRunEventType | undefined> = events.map(
      (event: AIRunEvent) => {
        return event.eventType;
      },
    );
    expect(types[0]).toBe(AIRunEventType.RunStarted);
    expect(events.indexOf(recorded[0]!)).toBe(1);
  });

  test("hands the loop exactly what it recorded, and keeps the persona as it was", async () => {
    await run(PROJECT_A);

    const given: AiContextActivity | null | undefined =
      loopRequest().aiContext;

    expect(given).toEqual(aiContextEvents()[0]!.resultSummary!.aiContext);
    expect(loopRequest().systemInstructions).toBe(INVESTIGATION_PERSONA);
  });

  test("reads its own project's notes by the run's project id, as root", async () => {
    await run(PROJECT_A);

    expect(projectRead).toHaveBeenCalledWith({
      id: PROJECT_A,
      select: { aiContext: true },
      props: { isRoot: true },
    });
  });

  test("the rules its caller names are read after the project's, by name", async () => {
    await run(PROJECT_A, {
      aiContextRules: [
        { id: "r2", name: "Payments", aiContext: "Payments notes" },
        { id: "r1", name: "Checkout", aiContext: "Checkout notes" },
      ],
    });

    expect(
      loopRequest().aiContext!.parts.map((part: { text: string }) => {
        return part.text;
      }),
    ).toEqual([NOTES_A, "Checkout notes", "Payments notes"]);
    expect(aiContextEvents()[0]!.resultSummary!.aiContext!.parts).toHaveLength(
      3,
    );
  });

  test("a fix's own persona reads the same notes: every run of the engine does", async () => {
    await run(PROJECT_A, {
      feature: "AI Remediation Execution",
      personaOverride: "You are OneUptime AI's remediation agent.",
      aiContextRules: [
        { id: "r1", name: "Checkout", aiContext: "Restart checkout first." },
      ],
    });

    expect(loopRequest().systemInstructions).toBe(
      "You are OneUptime AI's remediation agent.",
    );
    expect(loopRequest().aiContext!.parts[1]!.text).toBe(
      "Restart checkout first.",
    );
  });

  test("a project with no notes: nothing recorded, and the loop told there is none", async () => {
    projectNotes[PROJECT_A.toString()] = undefined;

    await run(PROJECT_A);

    expect(aiContextEvents()).toHaveLength(0);
    expect(loopRequest().aiContext).toBeNull();
  });

  test("notes that cannot be read never fail the run", async () => {
    projectRead.mockRejectedValue(new Error("database is down"));

    await run(PROJECT_A);

    expect(answer).toHaveBeenCalledTimes(1);
    expect(loopRequest().aiContext).toBeNull();
    expect(
      events.some((event: AIRunEvent): boolean => {
        return event.eventType === AIRunEventType.RunCompleted;
      }),
    ).toBe(true);
  });

  test("one project's notes never reach another project's run", async () => {
    await run(PROJECT_A);
    await run(PROJECT_B);

    const runA: string = JSON.stringify(loopRequest(0).aiContext);
    const runB: string = JSON.stringify(loopRequest(1).aiContext);

    expect(runA).toContain("payments team");
    expect(runA).not.toContain("Project B");
    expect(runB).toContain("Project B");
    expect(runB).not.toContain("payments team");

    const recorded: Array<AIRunEvent> = aiContextEvents();
    expect(recorded[0]!.projectId?.toString()).toBe(PROJECT_A.toString());
    expect(recorded[1]!.projectId?.toString()).toBe(PROJECT_B.toString());
    expect(JSON.stringify(recorded[1]!.resultSummary)).not.toContain(
      "payments team",
    );
  });
});
