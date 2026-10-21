import AIInvestigationEngine from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import ProjectService from "../../../../Server/Services/ProjectService";
import Project from "../../../../Models/DatabaseModels/Project";
import {
  AI_AGENT_RUNAWAY_MAX_LLM_CALLS,
  AI_AGENT_RUNAWAY_MAX_TOOL_CALLS,
  AIAgentRunLimits,
} from "../../../../Types/AI/AIAgentRunLimits";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * How far an incident or alert investigation may run, as the runners ask
 * it. The fix for "command did not run because of the time budget": no
 * time limit unless the project set one for that lane, and a project that
 * cannot be read runs unbounded rather than being cut short.
 */

afterEach(() => {
  jest.restoreAllMocks();
});

const PROJECT_ID: ObjectID = ObjectID.generate();

function project(data: {
  incident?: number | null;
  alert?: number | null;
}): Project {
  const model: Project = new Project(PROJECT_ID);
  if (data.incident !== undefined) {
    model.incidentAiInvestigationTimeLimitInMinutes = data.incident as number;
  }
  if (data.alert !== undefined) {
    model.alertAiInvestigationTimeLimitInMinutes = data.alert as number;
  }
  return model;
}

describe("AIInvestigationEngine.getRunLimitsForProject", () => {
  test("no time limit when the project set none", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(project({}) as never);

    const limits: AIAgentRunLimits =
      await AIInvestigationEngine.getRunLimitsForProject(
        PROJECT_ID,
        "Incident",
      );

    expect(limits).toEqual({
      maxWallClockMs: undefined,
      maxLlmCalls: AI_AGENT_RUNAWAY_MAX_LLM_CALLS,
      maxToolCalls: AI_AGENT_RUNAWAY_MAX_TOOL_CALLS,
    });
  });

  test("each lane uses its own configured limit", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(project({ incident: 15, alert: 5 }) as never);

    expect(
      (
        await AIInvestigationEngine.getRunLimitsForProject(
          PROJECT_ID,
          "Incident",
        )
      ).maxWallClockMs,
    ).toBe(15 * 60 * 1000);
    expect(
      (await AIInvestigationEngine.getRunLimitsForProject(PROJECT_ID, "Alert"))
        .maxWallClockMs,
    ).toBe(5 * 60 * 1000);
  });

  test("a zero limit means none, not 'stop immediately'", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(project({ incident: 0 }) as never);

    expect(
      (
        await AIInvestigationEngine.getRunLimitsForProject(
          PROJECT_ID,
          "Incident",
        )
      ).maxWallClockMs,
    ).toBeUndefined();
  });

  test("reads both lanes' columns as root", async () => {
    const find: jest.SpyInstance = jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(project({}) as never);

    await AIInvestigationEngine.getRunLimitsForProject(PROJECT_ID, "Alert");

    const args: { id: ObjectID; select: JSONObject; props: JSONObject } = find
      .mock.calls[0]![0] as never;
    expect(args.id).toBe(PROJECT_ID);
    expect(args.select).toEqual({
      incidentAiInvestigationTimeLimitInMinutes: true,
      alertAiInvestigationTimeLimitInMinutes: true,
    });
    expect(args.props).toEqual({ isRoot: true });
  });

  test("a missing project runs without a limit", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(null as never);

    expect(
      (
        await AIInvestigationEngine.getRunLimitsForProject(
          PROJECT_ID,
          "Incident",
        )
      ).maxWallClockMs,
    ).toBeUndefined();
  });

  test("fails open: an unreadable project runs without a limit", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockRejectedValue(new Error("db down") as never);

    await expect(
      AIInvestigationEngine.getRunLimitsForProject(PROJECT_ID, "Incident"),
    ).resolves.toEqual({
      maxWallClockMs: undefined,
      maxLlmCalls: AI_AGENT_RUNAWAY_MAX_LLM_CALLS,
      maxToolCalls: AI_AGENT_RUNAWAY_MAX_TOOL_CALLS,
    });
  });
});
