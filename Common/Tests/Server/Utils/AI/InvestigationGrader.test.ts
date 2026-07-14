import InvestigationGrader from "../../../../Server/Utils/AI/Sentinel/InvestigationGrader";
import AIRunService from "../../../../Server/Services/AIRunService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentFeedService from "../../../../Server/Services/IncidentFeedService";
import AIService, {
  AILogResponse,
} from "../../../../Server/Services/AIService";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentFeed from "../../../../Models/DatabaseModels/IncidentFeed";
import AIRunAutoGrade from "../../../../Types/AI/AIRunAutoGrade";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test, afterEach } from "@jest/globals";

/*
 * On-resolve investigation grading (Phase 2 measurement layer): when an
 * incident resolves with a human-recorded root cause and a completed
 * investigation exists, ONE constrained LLM call grades the posted analysis
 * MATCH / PARTIAL / MISMATCH. Under test: the pure gate
 * (shouldGradeInvestigation), the defensive one-token parse
 * (parseAutoGradeToken — including the MATCH-inside-MISMATCH trap), and the
 * end-to-end skip/store/swallow behavior of gradeInvestigationOnResolve.
 */

const incidentId: ObjectID = ObjectID.generate();
const projectId: ObjectID = ObjectID.generate();

function fakeRun(autoGrade?: AIRunAutoGrade): AIRun {
  return { id: ObjectID.generate(), autoGrade } as unknown as AIRun;
}

function fakeIncident(rootCause?: string | undefined): Incident {
  return { id: incidentId, rootCause } as unknown as Incident;
}

function fakeFeedItem(markdown: string): IncidentFeed {
  return { feedInfoInMarkdown: markdown } as unknown as IncidentFeed;
}

function fakeLlmResponse(content: string): AILogResponse {
  return { content } as unknown as AILogResponse;
}

describe("InvestigationGrader.shouldGradeInvestigation", () => {
  test("no run → false", () => {
    expect(
      InvestigationGrader.shouldGradeInvestigation({
        run: null,
        rootCause: "db down",
      }),
    ).toBe(false);
  });

  test("run without an id → false", () => {
    expect(
      InvestigationGrader.shouldGradeInvestigation({
        run: {},
        rootCause: "db down",
      }),
    ).toBe(false);
  });

  test("already graded → false (dedupe: a run is graded once)", () => {
    expect(
      InvestigationGrader.shouldGradeInvestigation({
        run: { id: ObjectID.generate(), autoGrade: AIRunAutoGrade.Match },
        rootCause: "db down",
      }),
    ).toBe(false);
  });

  test("missing / empty / whitespace root cause → false", () => {
    const run: { id: ObjectID } = { id: ObjectID.generate() };

    expect(
      InvestigationGrader.shouldGradeInvestigation({ run, rootCause: null }),
    ).toBe(false);
    expect(
      InvestigationGrader.shouldGradeInvestigation({
        run,
        rootCause: undefined,
      }),
    ).toBe(false);
    expect(
      InvestigationGrader.shouldGradeInvestigation({ run, rootCause: "" }),
    ).toBe(false);
    expect(
      InvestigationGrader.shouldGradeInvestigation({ run, rootCause: "   " }),
    ).toBe(false);
  });

  test("completed ungraded run + non-empty root cause → true", () => {
    expect(
      InvestigationGrader.shouldGradeInvestigation({
        run: { id: ObjectID.generate() },
        rootCause: "Connection pool exhausted",
      }),
    ).toBe(true);
  });
});

describe("InvestigationGrader.parseAutoGradeToken", () => {
  test("exact single tokens parse (case-insensitively)", () => {
    expect(InvestigationGrader.parseAutoGradeToken("MATCH")).toBe(
      AIRunAutoGrade.Match,
    );
    expect(InvestigationGrader.parseAutoGradeToken(" partial\n")).toBe(
      AIRunAutoGrade.Partial,
    );
    expect(InvestigationGrader.parseAutoGradeToken("mismatch")).toBe(
      AIRunAutoGrade.Mismatch,
    );
  });

  test("MISMATCH does not double-count as MATCH (word boundaries)", () => {
    expect(InvestigationGrader.parseAutoGradeToken("MISMATCH")).toBe(
      AIRunAutoGrade.Mismatch,
    );
  });

  test("a token embedded in editorializing prose still parses", () => {
    expect(
      InvestigationGrader.parseAutoGradeToken("The verdict is: MATCH."),
    ).toBe(AIRunAutoGrade.Match);
    expect(
      InvestigationGrader.parseAutoGradeToken(
        "I would grade this as PARTIAL, since only one of the two causes was found.",
      ),
    ).toBe(AIRunAutoGrade.Partial);
  });

  test("a token embedded inside a larger word does not parse", () => {
    expect(InvestigationGrader.parseAutoGradeToken("rematch")).toBeNull();
    expect(InvestigationGrader.parseAutoGradeToken("partially")).toBeNull();
  });

  test("ambiguous (several distinct tokens) → null", () => {
    expect(
      InvestigationGrader.parseAutoGradeToken(
        "Either MATCH or MISMATCH, hard to say.",
      ),
    ).toBeNull();
  });

  test("no token / empty / null → null", () => {
    expect(
      InvestigationGrader.parseAutoGradeToken("I cannot grade this."),
    ).toBeNull();
    expect(InvestigationGrader.parseAutoGradeToken("")).toBeNull();
    expect(InvestigationGrader.parseAutoGradeToken(null)).toBeNull();
    expect(InvestigationGrader.parseAutoGradeToken(undefined)).toBeNull();
  });
});

describe("InvestigationGrader.gradeInvestigationOnResolve", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("no completed investigation → skips before loading the incident, no LLM call", async () => {
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(null);
    const findOneById: jest.SpyInstance = jest.spyOn(
      IncidentService,
      "findOneById",
    );
    const executeWithLogging: jest.SpyInstance = jest.spyOn(
      AIService,
      "executeWithLogging",
    );

    await InvestigationGrader.gradeInvestigationOnResolve({
      incidentId,
      projectId,
    });

    expect(findOneById).not.toHaveBeenCalled();
    expect(executeWithLogging).not.toHaveBeenCalled();
  });

  test("already graded run → no LLM call, nothing written", async () => {
    jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValue(fakeRun(AIRunAutoGrade.Partial));
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(fakeIncident("db down"));
    const executeWithLogging: jest.SpyInstance = jest.spyOn(
      AIService,
      "executeWithLogging",
    );
    const updateOneById: jest.SpyInstance = jest.spyOn(
      AIRunService,
      "updateOneById",
    );

    await InvestigationGrader.gradeInvestigationOnResolve({
      incidentId,
      projectId,
    });

    expect(executeWithLogging).not.toHaveBeenCalled();
    expect(updateOneById).not.toHaveBeenCalled();
  });

  test("incident without a root cause → no LLM call", async () => {
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(fakeRun());
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(fakeIncident(undefined));
    const executeWithLogging: jest.SpyInstance = jest.spyOn(
      AIService,
      "executeWithLogging",
    );

    await InvestigationGrader.gradeInvestigationOnResolve({
      incidentId,
      projectId,
    });

    expect(executeWithLogging).not.toHaveBeenCalled();
  });

  test("no posted analysis (no RootCause feed item) → no LLM call", async () => {
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(fakeRun());
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(fakeIncident("db down"));
    jest.spyOn(IncidentFeedService, "findOneBy").mockResolvedValue(null);
    const executeWithLogging: jest.SpyInstance = jest.spyOn(
      AIService,
      "executeWithLogging",
    );

    await InvestigationGrader.gradeInvestigationOnResolve({
      incidentId,
      projectId,
    });

    expect(executeWithLogging).not.toHaveBeenCalled();
  });

  test("happy path: one budgeted, preview-less LLM call; grade + timestamp stored on the run", async () => {
    const run: AIRun = fakeRun();
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(run);
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(fakeIncident("The connection pool was exhausted."));
    jest
      .spyOn(IncidentFeedService, "findOneBy")
      .mockResolvedValue(
        fakeFeedItem("## Analysis\nThe db connection pool ran dry."),
      );
    const executeWithLogging: jest.SpyInstance = jest
      .spyOn(AIService, "executeWithLogging")
      .mockResolvedValue(fakeLlmResponse("MATCH"));
    const updateOneById: jest.SpyInstance = jest
      .spyOn(AIRunService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await InvestigationGrader.gradeInvestigationOnResolve({
      incidentId,
      projectId,
    });

    expect(executeWithLogging).toHaveBeenCalledTimes(1);
    expect(executeWithLogging).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId,
        incidentId,
        aiRunId: run.id,
        // Budget coverage: must be an AUTONOMOUS_AI_FEATURES member.
        feature: "Sentinel Investigation Grading",
        // Grades live on the run — no prompt previews in LlmLog.
        storeContentPreviews: false,
      }),
    );

    expect(updateOneById).toHaveBeenCalledWith(
      expect.objectContaining({
        id: run.id,
        data: expect.objectContaining({
          autoGrade: AIRunAutoGrade.Match,
          autoGradeAt: expect.any(Date),
        }),
        props: expect.objectContaining({ isRoot: true }),
      }),
    );
  });

  test("unparseable grade response → warn, no grade stored", async () => {
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(fakeRun());
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(fakeIncident("db down"));
    jest
      .spyOn(IncidentFeedService, "findOneBy")
      .mockResolvedValue(fakeFeedItem("Analysis text."));
    jest
      .spyOn(AIService, "executeWithLogging")
      .mockResolvedValue(fakeLlmResponse("Either MATCH or MISMATCH."));
    const updateOneById: jest.SpyInstance = jest.spyOn(
      AIRunService,
      "updateOneById",
    );

    await InvestigationGrader.gradeInvestigationOnResolve({
      incidentId,
      projectId,
    });

    expect(updateOneById).not.toHaveBeenCalled();
  });

  test("an LLM failure is swallowed — grading can never throw into the resolve path", async () => {
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(fakeRun());
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(fakeIncident("db down"));
    jest
      .spyOn(IncidentFeedService, "findOneBy")
      .mockResolvedValue(fakeFeedItem("Analysis text."));
    jest
      .spyOn(AIService, "executeWithLogging")
      .mockRejectedValue(new Error("provider down"));
    const updateOneById: jest.SpyInstance = jest.spyOn(
      AIRunService,
      "updateOneById",
    );

    await expect(
      InvestigationGrader.gradeInvestigationOnResolve({
        incidentId,
        projectId,
      }),
    ).resolves.toBeUndefined();

    expect(updateOneById).not.toHaveBeenCalled();
  });
});
