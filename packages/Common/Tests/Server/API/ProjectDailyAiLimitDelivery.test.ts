import SlackAPI from "../../../Server/API/SlackAPI";
import AIService from "../../../Server/Services/AIService";
import LlmLogService from "../../../Server/Services/LlmLogService";
import ProjectService from "../../../Server/Services/ProjectService";
import Project from "../../../Models/DatabaseModels/Project";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Where a refusal by the project's own daily AI limits (Project Settings →
 * AI Features → More settings) reaches a person.
 *
 * AIService.executeWithLogging refuses every call past a limit, so every
 * lane is covered the moment it calls AI. But, as with the Enable AI kill
 * switch (AIKillSwitchBackstop.test.ts), HOW the refusal reaches someone
 * depends on the lane:
 *
 *   - "throw": the exception becomes a message a person reads - Ask AI,
 *     "Generate with AI" buttons, workflows, runbook steps, fix tasks;
 *   - "post": Slack and Microsoft Teams run detached work whose catch only
 *     logs, so a refusal thrown there would leave "Looking into it…"
 *     unanswered - they check first and post the limit sentence;
 *   - "skip": fire-and-forget work - on-resolve grading, the postmortem
 *     draft, investigations - where a limit someone set is a setting, not
 *     an error, and must not log one per incident until midnight UTC.
 *
 * This holds the "post" and "skip" lanes to that, next to every place they
 * check the Enable AI switch.
 */

const SERVER_ROOT: string = path.join(__dirname, "..", "..", "..", "Server");

function source(relative: string): string {
  return fs.readFileSync(path.join(SERVER_ROOT, relative), "utf8");
}

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the post lane: Slack and Microsoft Teams say the limit sentence", () => {
  test("every Slack AI question that checks the AI switch first checks the daily limits too", () => {
    const slack: string = source("API/SlackAPI.ts");

    // The thread mention and the slash command.
    expect(
      count(slack, "AIService.isProjectAIEnabled(context.projectId)"),
    ).toBe(2);
    expect(
      count(slack, "SlackAPI.getDailyLimitRefusal(context.projectId)"),
    ).toBe(2);
  });

  test("Microsoft Teams checks the daily limits before it acknowledges, and sends the sentence", () => {
    const teams: string = source(
      "Utils/Workspace/MicrosoftTeams/MicrosoftTeams.ts",
    );

    const switchCheck: number = teams.indexOf(
      "AIService.isProjectAIEnabled(projectId)",
    );
    const limitCheck: number = teams.indexOf(
      "AIService.getReachedProjectDailyLimit({ projectId })",
    );
    const acknowledgement: number = teams.indexOf(
      "turnContext.sendActivity(this.AI_OPS_ACK_TEXT)",
    );

    expect(switchCheck).toBeGreaterThan(-1);
    expect(limitCheck).toBeGreaterThan(switchCheck);
    expect(acknowledgement).toBeGreaterThan(limitCheck);
    expect(teams).toContain("getProjectDailyLimitMessage(reachedDailyLimit)");
  });

  test("Slack's refusal is the shared sentence once a limit is reached", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      id: PROJECT_ID,
      aiDailyTokenLimit: 1000,
    } as unknown as Project);
    jest.spyOn(LlmLogService, "getProjectUsageSince").mockResolvedValue({
      totalTokens: 1200,
      billedCostInUSDCents: 0,
    });

    const refusal: string | null = await (
      SlackAPI as unknown as {
        getDailyLimitRefusal: (projectId: ObjectID) => Promise<string | null>;
      }
    ).getDailyLimitRefusal(PROJECT_ID);

    expect(refusal).toBe(
      "This project has reached its daily AI token limit: 1,200 of 1,000 tokens used today. OneUptime AI starts again at midnight UTC. To raise or remove the limit, go to Project Settings → AI Features → More settings.",
    );
  });

  test("Slack says nothing while there is room, or with no limit", async () => {
    const usage: jest.SpyInstance = jest
      .spyOn(LlmLogService, "getProjectUsageSince")
      .mockResolvedValue({ totalTokens: 10, billedCostInUSDCents: 0 });
    const read: jest.SpyInstance = jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue({
        id: PROJECT_ID,
        aiDailyTokenLimit: 1000,
      } as unknown as Project);

    const getRefusal: (projectId: ObjectID) => Promise<string | null> = (
      SlackAPI as unknown as {
        getDailyLimitRefusal: (projectId: ObjectID) => Promise<string | null>;
      }
    ).getDailyLimitRefusal.bind(SlackAPI);

    expect(await getRefusal(PROJECT_ID)).toBeNull();

    read.mockResolvedValue({ id: PROJECT_ID } as unknown as Project);
    usage.mockClear();

    expect(await getRefusal(PROJECT_ID)).toBeNull();
    expect(usage).not.toHaveBeenCalled();
  });
});

describe("the skip lane: autonomous work skips quietly at the limit", () => {
  test.each([
    ["on-resolve grading", "Utils/AI/SRE/InvestigationGrader.ts"],
    ["the postmortem draft", "Utils/AI/SRE/IncidentPostmortemRunner.ts"],
    ["the investigation gate", "Utils/AI/SRE/AIInvestigationEngine.ts"],
    ["the investigation queue", "Utils/AI/SRE/InvestigationQueue.ts"],
  ])("%s asks before it starts", (_name: string, file: string) => {
    expect(source(file)).toContain("AIService.getReachedProjectDailyLimit(");
  });

  /*
   * The non-throwing form: a limit that cannot be read never stops these
   * (the model call still enforces it), and nothing here turns a setting
   * into an error.
   */
  test("they use the form that never throws", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockRejectedValue(new Error("database down"));

    await expect(
      AIService.getReachedProjectDailyLimit({ projectId: PROJECT_ID }),
    ).resolves.toBeNull();
  });
});
