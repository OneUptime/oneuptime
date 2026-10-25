import { afterEach, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import AIService, {
  AI_AUTO_RECHARGE_FAILED_MESSAGE,
  AI_BALANCE_INSUFFICIENT_MESSAGE,
  AI_DISABLED_MESSAGE,
  getProjectDailyLimitMessage,
} from "../../../../Server/Services/AIService";
import WorkspaceAiRefusal from "../../../../Server/Utils/Workspace/WorkspaceAiRefusal";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import { ProjectAiDailyLimit } from "../../../../Types/AI/ProjectAiDailyLimits";
import { PROJECT_AI_CREDITS_USED_UP_MESSAGE } from "../../../../Utils/Project/ProjectBalance";

/*
 * Why OneUptime AI did not answer a question asked in Slack or Microsoft
 * Teams (WorkspaceAiRefusal). Microsoft's reviewers asked the Teams app a
 * question in the project they had just created to test it, whose AI
 * credits - like every new project's - were used up: AIService refused
 * each call with "This project's AI credits are used up. A project owner or
 * someone with Manage Billing can add AI credits in ...", and the bot said
 * "Sorry, I ran into a problem answering that question. Please try again
 * later." These hold the chats to saying the refusal, and to checking the
 * credits before they acknowledge a question, as they check the AI switch
 * and the daily limits.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "c1000000-0000-4000-8000-000000000001",
);

const SERVER_ROOT: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "Server",
);

function source(relative: string): string {
  return fs.readFileSync(path.join(SERVER_ROOT, relative), "utf8");
}

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("getCreditsRefusal: the credits, before a question is acknowledged", () => {
  test.each([
    ["used up, Auto Recharge off", AI_BALANCE_INSUFFICIENT_MESSAGE],
    [
      "used up, Auto Recharge's last charge failed",
      AI_AUTO_RECHARGE_FAILED_MESSAGE,
    ],
  ])(
    "%s: the sentence that says who can add them, and where",
    async (_label: string, blocker: string) => {
      const read: ReturnType<typeof jest.spyOn> = jest
        .spyOn(AIService, "getAiBalanceBlocker")
        .mockResolvedValue(blocker);

      expect(await WorkspaceAiRefusal.getCreditsRefusal(PROJECT_ID)).toBe(
        PROJECT_AI_CREDITS_USED_UP_MESSAGE,
      );
      expect(read).toHaveBeenCalledWith({ projectId: PROJECT_ID });
    },
  );

  test("the sentence names who can add credits, and where", () => {
    expect(PROJECT_AI_CREDITS_USED_UP_MESSAGE).toBe(
      "This project's AI credits are used up. A project owner or someone with Manage Billing can add AI credits in Project Settings → AI → AI Credits.",
    );
  });

  test("nothing in the way: null, and the question is answered", async () => {
    jest.spyOn(AIService, "getAiBalanceBlocker").mockResolvedValue(null);

    expect(await WorkspaceAiRefusal.getCreditsRefusal(PROJECT_ID)).toBeNull();
  });
});

describe("getRefusalMessage: a refusal raised while the answer was written", () => {
  test("the credits used up: said as AIService wrote it", () => {
    expect(
      WorkspaceAiRefusal.getRefusalMessage(
        new BadDataException(PROJECT_AI_CREDITS_USED_UP_MESSAGE),
      ),
    ).toBe(PROJECT_AI_CREDITS_USED_UP_MESSAGE);
  });

  test("AI switched off: said as AIService wrote it", () => {
    expect(
      WorkspaceAiRefusal.getRefusalMessage(
        new BadDataException(AI_DISABLED_MESSAGE),
      ),
    ).toBe(AI_DISABLED_MESSAGE);
  });

  test("the project's own daily limit reached: said as AIService wrote it", () => {
    const limit: string = getProjectDailyLimitMessage({
      reachedLimit: ProjectAiDailyLimit.Tokens,
      tokenLimit: 1000,
      spendLimitInUSD: null,
      usage: { usedTokensToday: 1200, spentTodayInUSDCents: 0 },
    } as Parameters<typeof getProjectDailyLimitMessage>[0]);

    expect(limit).toMatch(/^This project has reached its daily AI token limit/);

    expect(
      WorkspaceAiRefusal.getRefusalMessage(new BadDataException(limit)),
    ).toBe(limit);
  });

  test.each([
    [
      "a provider's error",
      new BadDataException("Provider returned 500: upstream"),
    ],
    [
      "no provider configured",
      new BadDataException(
        "No LLM provider configured for this project. Please configure an LLM provider in Project Settings > AI > LLM Providers.",
      ),
    ],
    ["a timeout", new Error("the model timed out")],
    [
      "an Error with a refusal's words",
      new Error(PROJECT_AI_CREDITS_USED_UP_MESSAGE),
    ],
    ["a string", PROJECT_AI_CREDITS_USED_UP_MESSAGE],
    ["nothing", undefined],
  ])(
    "%s: no refusal - the chat says it could not answer",
    (_label: string, error: unknown) => {
      expect(WorkspaceAiRefusal.getRefusalMessage(error)).toBeNull();
    },
  );
});

describe("the chats check the credits where they check the AI switch and the daily limits", () => {
  test("Microsoft Teams checks them after the daily limits and before it acknowledges, and says the refusal", () => {
    const teams: string = source(
      "Utils/Workspace/MicrosoftTeams/MicrosoftTeams.ts",
    );

    const limitCheck: number = teams.indexOf(
      "AIService.getReachedProjectDailyLimit({ projectId })",
    );
    const creditsCheck: number = teams.indexOf(
      "WorkspaceAiRefusal.getCreditsRefusal(projectId)",
    );
    const acknowledgement: number = teams.indexOf(
      "this.sendAnswerPlaceholder(turnContext)",
    );

    expect(limitCheck).toBeGreaterThan(-1);
    expect(creditsCheck).toBeGreaterThan(limitCheck);
    expect(acknowledgement).toBeGreaterThan(creditsCheck);
    expect(teams).toContain("WorkspaceAiRefusal.getRefusalMessage(error)");
  });

  test("every Slack AI question that checks the daily limits checks the credits too, and a refusal while answering is said", () => {
    const slack: string = source("API/SlackAPI.ts");

    // The thread mention and the slash command.
    expect(
      count(slack, "SlackAPI.getDailyLimitRefusal(context.projectId)"),
    ).toBe(2);
    expect(
      count(slack, "WorkspaceAiRefusal.getCreditsRefusal(context.projectId)"),
    ).toBe(2);
    expect(slack).toContain(
      "WorkspaceAiRefusal.getRefusalMessage(err) || SlackAPI.AI_FAILED_TEXT",
    );
  });
});
