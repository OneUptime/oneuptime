import AIInvestigationEngine from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import { ObservabilityAssistantResult } from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import ProjectService from "../../../../Server/Services/ProjectService";
import Project from "../../../../Models/DatabaseModels/Project";
import AIAgentRunLimitsHelper, {
  AIAgentRunLimits,
  AIRunStopReason,
  AIRunTimeLimitSource,
  PROJECT_AI_RUN_LIMITS_LOCATION,
} from "../../../../Types/AI/AIAgentRunLimits";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * How far an incident or alert investigation may run, as the runners ask
 * it (issue #6440): no cap on model calls, tool calls or tokens unless the
 * project set one in Limits per run, and a time limit - the lane's when the
 * project set one for that lane, else the project's, else the default 120
 * minutes. A project that cannot be read runs with the defaults rather than
 * not at all.
 */

afterEach(() => {
  jest.restoreAllMocks();
});

const PROJECT_ID: ObjectID = ObjectID.generate();
const MINUTE_MS: number = 60 * 1000;

function project(data: {
  incident?: number | null;
  alert?: number | null;
  runMinutes?: number;
  maxModelCalls?: number;
  maxToolCalls?: number;
  maxTokens?: number;
}): Project {
  const model: Project = new Project(PROJECT_ID);
  if (data.incident !== undefined) {
    model.incidentAiInvestigationTimeLimitInMinutes = data.incident as number;
  }
  if (data.alert !== undefined) {
    model.alertAiInvestigationTimeLimitInMinutes = data.alert as number;
  }
  if (data.runMinutes !== undefined) {
    model.aiRunTimeLimitInMinutes = data.runMinutes;
  }
  if (data.maxModelCalls !== undefined) {
    model.aiRunMaxModelCalls = data.maxModelCalls;
  }
  if (data.maxToolCalls !== undefined) {
    model.aiRunMaxToolCalls = data.maxToolCalls;
  }
  if (data.maxTokens !== undefined) {
    model.aiRunMaxTokens = data.maxTokens;
  }
  return model;
}

describe("AIInvestigationEngine.getRunLimitsForProject", () => {
  test("a project that set nothing: no caps, the default 120 minutes", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(project({}) as never);

    const limits: AIAgentRunLimits =
      await AIInvestigationEngine.getRunLimitsForProject(
        PROJECT_ID,
        "Incident",
      );

    expect(limits).toEqual({
      maxLlmCalls: undefined,
      maxToolCalls: undefined,
      maxTokens: undefined,
      maxWallClockMs: 120 * MINUTE_MS,
      timeLimitSource: AIRunTimeLimitSource.Default,
    });
  });

  test("each lane uses its own configured limit", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(project({ incident: 15, alert: 5 }) as never);

    expect(
      await AIInvestigationEngine.getRunLimitsForProject(
        PROJECT_ID,
        "Incident",
      ),
    ).toMatchObject({
      maxWallClockMs: 15 * MINUTE_MS,
      timeLimitSource: AIRunTimeLimitSource.IncidentInvestigation,
    });
    expect(
      await AIInvestigationEngine.getRunLimitsForProject(PROJECT_ID, "Alert"),
    ).toMatchObject({
      maxWallClockMs: 5 * MINUTE_MS,
      timeLimitSource: AIRunTimeLimitSource.AlertInvestigation,
    });
  });

  test("a lane with no limit of its own uses the project's time limit per run", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(project({ incident: 15, runMinutes: 40 }) as never);

    expect(
      await AIInvestigationEngine.getRunLimitsForProject(PROJECT_ID, "Alert"),
    ).toMatchObject({
      maxWallClockMs: 40 * MINUTE_MS,
      timeLimitSource: AIRunTimeLimitSource.Project,
    });
  });

  test("the project's caps hold in both lanes", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(
      project({
        incident: 15,
        maxModelCalls: 60,
        maxToolCalls: 250,
        maxTokens: 3_000_000,
      }) as never,
    );

    for (const lane of ["Incident", "Alert"] as const) {
      expect(
        await AIInvestigationEngine.getRunLimitsForProject(PROJECT_ID, lane),
      ).toMatchObject({
        maxLlmCalls: 60,
        maxToolCalls: 250,
        maxTokens: 3_000_000,
      });
    }
  });

  test("a zero lane limit means not set, not 'stop immediately'", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(project({ incident: 0 }) as never);

    expect(
      await AIInvestigationEngine.getRunLimitsForProject(
        PROJECT_ID,
        "Incident",
      ),
    ).toEqual(AIAgentRunLimitsHelper.getDefault());
  });

  test("reads the limits per run and both lanes' columns as root", async () => {
    const find: jest.SpyInstance = jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(project({}) as never);

    await AIInvestigationEngine.getRunLimitsForProject(PROJECT_ID, "Alert");

    const args: { id: ObjectID; select: JSONObject; props: JSONObject } = find
      .mock.calls[0]![0] as never;
    expect(args.id).toBe(PROJECT_ID);
    expect(args.select).toEqual({
      aiRunMaxModelCalls: true,
      aiRunMaxToolCalls: true,
      aiRunMaxTokens: true,
      aiRunTimeLimitInMinutes: true,
      incidentAiInvestigationTimeLimitInMinutes: true,
      alertAiInvestigationTimeLimitInMinutes: true,
    });
    expect(args.props).toEqual({ isRoot: true });
  });

  test("a missing project runs with the defaults", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(null as never);

    expect(
      await AIInvestigationEngine.getRunLimitsForProject(
        PROJECT_ID,
        "Incident",
      ),
    ).toEqual(AIAgentRunLimitsHelper.getDefault());
  });

  test("fails open: an unreadable project runs with the defaults", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockRejectedValue(new Error("db down") as never);

    await expect(
      AIInvestigationEngine.getRunLimitsForProject(PROJECT_ID, "Incident"),
    ).resolves.toEqual(AIAgentRunLimitsHelper.getDefault());
  });
});

/*
 * The report of an investigation a limit stopped, as the subject's feed,
 * its note and its Slack and Teams channels show it: the note OneUptime
 * wrote (AIRunLimitsReader.getStopNote) goes under the analysis as it was
 * written - its link to the setting a link, its italics italics - and
 * before the evidence. Placed as text, its Markdown would be escaped, and
 * the link would read as brackets and an address.
 */
describe("AIInvestigationEngine.buildBrandedMarkdown: a run a limit stopped", () => {
  const ANALYSIS: string = "**Summary** — checkout is failing.";
  const SETTINGS_URL: string = `https://oneuptime.example/dashboard/${PROJECT_ID.toString()}/settings/ai-features#LimitsPerRun`;

  function report(stopNoteInMarkdown?: string): string {
    const result: ObservabilityAssistantResult = {
      contentInMarkdown: ANALYSIS,
      citations: [
        {
          id: "C1",
          toolName: "search_logs",
          label: "Error logs of checkout",
          queryArguments: {},
          rowCount: 12,
        },
      ],
      totalTokens: 100,
      llmCallCount: 40,
      toolCallCount: 1,
      modelName: "gpt-test",
      ...(stopNoteInMarkdown ? { stopNoteInMarkdown } : {}),
    };

    return AIInvestigationEngine.buildBrandedMarkdown(result, ANALYSIS);
  }

  test("the note sits under the analysis as written, its link a link, before the evidence", () => {
    const note: string = AIAgentRunLimitsHelper.getStopNote({
      reason: AIRunStopReason.ModelCalls,
      limits: AIAgentRunLimitsHelper.fromSettings({ maxModelCalls: 40 }),
      settingsUrl: SETTINGS_URL,
    });

    expect(note).toBe(
      `_This run stopped at this project's limit of 40 model calls per run. Change it in [${PROJECT_AI_RUN_LIMITS_LOCATION}](${SETTINGS_URL})._`,
    );

    const markdown: string = report(note);

    expect(markdown).toContain(`\n\n${note}\n\n**Evidence checked**\n`);
    expect(markdown.indexOf(ANALYSIS)).toBeLessThan(markdown.indexOf(note));
    // Not escaped as text: no backslash before its brackets or italics.
    expect(markdown).not.toContain(`\\[${PROJECT_AI_RUN_LIMITS_LOCATION}`);
    expect(markdown).not.toContain("\\_This run stopped");
  });

  test("a loop's note, which links nowhere, is placed the same way", () => {
    const note: string = AIAgentRunLimitsHelper.getStopNote({
      reason: AIRunStopReason.Loop,
      limits: AIAgentRunLimitsHelper.getDefault(),
      settingsUrl: SETTINGS_URL,
    });

    expect(note).toBe(
      "_This run stopped early: it kept repeating calls that showed it nothing new._",
    );
    expect(report(note)).toContain(`\n\n${note}\n\n**Evidence checked**\n`);
  });

  test("a run no limit stopped has no note: the analysis is followed by the evidence", () => {
    const markdown: string = report();

    expect(markdown).not.toContain("stopped");
    expect(markdown).toContain(`${ANALYSIS}\n\n**Evidence checked**\n`);
  });
});
