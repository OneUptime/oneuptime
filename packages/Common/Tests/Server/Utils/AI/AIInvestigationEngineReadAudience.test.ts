import AIInvestigationEngine, {
  InvestigationRequest,
} from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import AIConfidenceSignal from "../../../../Server/Utils/AI/SRE/ConfidenceSignal";
import InvestigationTldr from "../../../../Server/Utils/AI/SRE/InvestigationTldr";
import ObservabilityAssistant, {
  ObservabilityAssistantResult,
} from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import LlmProviderChoice from "../../../../Server/Utils/AI/LlmProviderChoice";
import AIRunEventService from "../../../../Server/Services/AIRunEventService";
import AIRunService from "../../../../Server/Services/AIRunService";
import AIRunEvent from "../../../../Models/DatabaseModels/AIRunEvent";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ReadAudience from "../../../../Types/BaseDatabase/ReadAudience";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import PositiveNumber from "../../../../Types/PositiveNumber";
import {
  readAudienceOf,
  readAudienceProps,
} from "../../../Helpers/ReadAudienceFixtures";
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
 * AN INVESTIGATION'S TOOLS READ FOR EVERYONE WHO MAY SEE ITS SUBJECT
 * (#9576). The engine hands every tool the run's props: an investigation
 * of an incident or an alert - and a follow-up check - carries its readers
 * (InvestigationRequest.readAudience), so the props read as OneUptime, held
 * to the project, and narrowed by them in the permission layer: every
 * tool's read leaves out what one of them may not read. A run that carries
 * none - remediation, triage - reads the project as OneUptime, as before.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

describe("AIInvestigationEngine.executeRun: who the tools read for", () => {
  const aiRunId: ObjectID = ObjectID.generate();
  let answer: SpyInstance<typeof ObservabilityAssistant.answerQuestion>;

  function result(): ObservabilityAssistantResult {
    return {
      contentInMarkdown:
        "**Summary** — shop-api saturated the CPU of web-1.\n\n**Most likely root cause** — a CPU-bound container.",
      citations: [],
      totalTokens: 100,
      llmCallCount: 2,
      toolCallCount: 3,
    };
  }

  function request(readAudience?: ReadAudience): InvestigationRequest {
    return {
      feature: "AI Incident Investigation",
      incidentId: INCIDENT_ID,
      contextSummary: "# Incident\nTitle: Shop is down",
      postAnalysis: async (): Promise<void> => {
        return undefined;
      },
      ...(readAudience ? { readAudience } : {}),
    };
  }

  async function run(readAudience?: ReadAudience): Promise<void> {
    await AIInvestigationEngine.executeRun({
      aiRunId,
      projectId: PROJECT_ID,
      attemptCount: 1,
      request: request(readAudience),
    });
  }

  function toolProps(): DatabaseCommonInteractionProps {
    return (answer.mock.calls[0]![0] as { props: DatabaseCommonInteractionProps })
      .props;
  }

  beforeEach(() => {
    jest
      .spyOn(AIRunEventService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(AIRunEventService, "create")
      .mockImplementation(async (data: unknown) => {
        return (data as { data: AIRunEvent }).data;
      });
    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);
    jest.spyOn(AIRunService, "updateOneBy").mockResolvedValue(1);
    jest
      .spyOn(AIConfidenceSignal, "computeConfidenceSignal")
      .mockResolvedValue({
        confident: true,
        codeFixRecommended: false,
        source: "classification",
      });
    jest.spyOn(InvestigationTldr, "generateTldr").mockResolvedValue(null);
    jest.spyOn(LlmProviderChoice, "decideForRun").mockResolvedValue({
      provider: null,
      source: null,
      fallbackReason: null,
      pickedProviderId: "",
      activity: null,
    });
    answer = jest
      .spyOn(ObservabilityAssistant, "answerQuestion")
      .mockResolvedValue(result());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("an investigation's tools read for its readers: as OneUptime, held to the project, narrowed by them", async () => {
    const readers: ReadAudience = readAudienceOf({
      projectId: PROJECT_ID,
      labelledPermissions: [Permission.ProjectMember],
      named: { Incident: [INCIDENT_ID.toString()] },
    });

    await run(readers);

    expect(toolProps()).toEqual(readAudienceProps(readers));
    expect(toolProps().isRoot).toBe(true);
    expect(toolProps().tenantId?.toString()).toBe(PROJECT_ID.toString());
    expect(toolProps().readAudience).toBe(readers);
  });

  test("a project whose roles narrow nobody still reads for its readers: private incidents and alerts stay out", async () => {
    const readers: ReadAudience = readAudienceOf({ projectId: PROJECT_ID });

    await run(readers);

    expect(toolProps().readAudience).toBe(readers);
  });

  test("a run that carries no readers reads the project as OneUptime, as before", async () => {
    await run();

    expect(toolProps()).toEqual({ isRoot: true, tenantId: PROJECT_ID });
  });
});
