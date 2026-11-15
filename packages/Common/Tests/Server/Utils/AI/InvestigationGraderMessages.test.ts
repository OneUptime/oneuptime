import InvestigationGrader, {
  GRADING_MAX_TOKENS,
} from "../../../../Server/Utils/AI/SRE/InvestigationGrader";
import PostedRootCause from "../../../../Server/Utils/AI/SRE/PostedRootCause";
import AIRunService from "../../../../Server/Services/AIRunService";
import IncidentService from "../../../../Server/Services/IncidentService";
import ProjectService from "../../../../Server/Services/ProjectService";
import AIService, {
  AILogResponse,
} from "../../../../Server/Services/AIService";
import { LLMMessage } from "../../../../Server/Utils/LLM/LLMService";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Project from "../../../../Models/DatabaseModels/Project";
import ObjectID from "../../../../Types/ObjectID";
import PromptText from "../../../../Utils/AI/PromptText";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * THE GRADER'S WORDS, SHARED WITH THE EVALS (issue #6800).
 *
 * The question that grades a resolved incident's investigation moved into
 * InvestigationGrader.getGradingMessages, so a replayed investigation is
 * graded in the very same words (Eval/EvalJudge) and its grade means what
 * an AI card's grade means. Moving it must not change a word production
 * sends: the messages are pinned here as they were written in
 * gradeInvestigationOnResolve, and the on-resolve grade is checked to send
 * exactly them, with the same token cap.
 */

const SYSTEM_TEXT: string = [
  "You grade an AI incident investigation against the root cause humans recorded when they resolved the incident.",
  "Respond with EXACTLY one token and nothing else:",
  "MATCH — the investigation identified the same root cause.",
  "PARTIAL — the investigation identified part of the cause, or a closely related cause.",
  "MISMATCH — the investigation pointed somewhere else.",
].join("\n");

function userText(rootCause: string, analysis: string): string {
  return [
    "Human-recorded root cause:",
    '"""',
    rootCause,
    '"""',
    "",
    "AI investigation analysis:",
    '"""',
    analysis,
    '"""',
    "",
    "One token only: MATCH, PARTIAL, or MISMATCH.",
  ].join("\n");
}

describe("InvestigationGrader.getGradingMessages", () => {
  test("asks in the words production always asked, a system message and the two texts", () => {
    expect(
      InvestigationGrader.getGradingMessages({
        rootCause: "The connection pool was exhausted.",
        analysisMarkdown: "## Analysis\nThe db connection pool ran dry.",
      }),
    ).toEqual([
      { role: "system", content: SYSTEM_TEXT },
      {
        role: "user",
        content: userText(
          "The connection pool was exhausted.",
          "## Analysis\nThe db connection pool ran dry.",
        ),
      },
    ]);
  });

  test("the root cause goes in as a field: embedded data left out, held to 2,000 characters", () => {
    const longCause: string = `The pool was cut. ${"x".repeat(5000)}`;
    const withImage: string = `See the graph: data:image/png;base64,${"iVBORw0KGgo".repeat(300)}`;

    const [, longUser] = InvestigationGrader.getGradingMessages({
      rootCause: longCause,
      analysisMarkdown: "A",
    });
    const [, imageUser] = InvestigationGrader.getGradingMessages({
      rootCause: withImage,
      analysisMarkdown: "A",
    });

    expect(longUser!.content).toBe(
      userText(PromptText.field(longCause, { maxLength: 2000 }), "A"),
    );
    expect(longUser!.content.length).toBeLessThan(2000 + 400);
    expect(imageUser!.content).toBe(
      userText(PromptText.field(withImage, { maxLength: 2000 }), "A"),
    );
    expect(imageUser!.content).not.toContain("base64,");
  });

  test("the analysis is held to its first 8,000 characters", () => {
    const analysis: string = `${"a".repeat(8000)}TAIL`;

    const [, user] = InvestigationGrader.getGradingMessages({
      rootCause: "R",
      analysisMarkdown: analysis,
    });

    expect(user!.content).toBe(userText("R", "a".repeat(8000)));
    expect(user!.content).not.toContain("TAIL");
  });

  test("a new array each time: a caller that changes its messages changes nobody else's", () => {
    const first: Array<LLMMessage> = InvestigationGrader.getGradingMessages({
      rootCause: "R",
      analysisMarkdown: "A",
    });
    first[0]!.content = "changed";

    expect(
      InvestigationGrader.getGradingMessages({
        rootCause: "R",
        analysisMarkdown: "A",
      })[0]!.content,
    ).toBe(SYSTEM_TEXT);
  });

  test("the grade is one token, and the call is held to a few", () => {
    expect(GRADING_MAX_TOKENS).toBe(20);
  });
});

describe("gradeInvestigationOnResolve sends exactly those messages", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the trimmed root cause and the run's posted analysis, at temperature 0, held to the grader's token cap", async () => {
    const incidentId: ObjectID = ObjectID.generate();
    const projectId: ObjectID = ObjectID.generate();
    const run: AIRun = {
      id: ObjectID.generate(),
      completedAt: new Date("2026-08-07T12:00:00.000Z"),
    } as unknown as AIRun;

    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      id: projectId,
      enableAi: true,
    } as unknown as Project);
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(run);
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue({
      id: incidentId,
      rootCause: "  The connection pool was exhausted.\n",
    } as unknown as Incident);
    jest
      .spyOn(PostedRootCause, "getForInvestigation")
      .mockResolvedValue("## Analysis\nThe db connection pool ran dry.");
    const executeWithLogging: SpyInstance<typeof AIService.executeWithLogging> =
      jest.spyOn(AIService, "executeWithLogging").mockResolvedValue({
        content: "MATCH",
      } as unknown as AILogResponse);
    jest
      .spyOn(AIRunService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await InvestigationGrader.gradeInvestigationOnResolve({
      incidentId,
      projectId,
    });

    expect(executeWithLogging).toHaveBeenCalledTimes(1);

    const sent: Parameters<typeof AIService.executeWithLogging>[0] =
      executeWithLogging.mock.calls[0]![0];

    expect(sent.messages).toEqual([
      { role: "system", content: SYSTEM_TEXT },
      {
        role: "user",
        content: userText(
          "The connection pool was exhausted.",
          "## Analysis\nThe db connection pool ran dry.",
        ),
      },
    ]);
    expect(sent.messages).toEqual(
      InvestigationGrader.getGradingMessages({
        rootCause: "The connection pool was exhausted.",
        analysisMarkdown: "## Analysis\nThe db connection pool ran dry.",
      }),
    );
    expect(sent.maxTokens).toBe(20);
    expect(sent.temperature).toBe(0);
    expect(sent.storeContentPreviews).toBe(false);
  });
});
