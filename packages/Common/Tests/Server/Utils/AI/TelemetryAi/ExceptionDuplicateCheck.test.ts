import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import ExceptionDuplicateChecker, {
  EXCEPTION_DUPLICATE_CHECK_FEATURE,
  ExceptionDuplicateCheckResult,
} from "../../../../../Server/Utils/AI/TelemetryAi/ExceptionDuplicateCheck";
import {
  buildExceptionDuplicateCheckPrompt,
  DuplicateCheckException,
  parseExceptionDuplicateCheckResponse,
} from "../../../../../Server/Utils/AI/TelemetryAi/ExceptionDuplicateCheckPrompt";
import SimilarExceptionsReader, {
  SimilarExceptionsWithEvidence,
} from "../../../../../Server/Utils/Telemetry/SimilarExceptionsReader";
import AIService, {
  AILogRequest,
  AILogResponse,
} from "../../../../../Server/Services/AIService";
import AiContextReader from "../../../../../Server/Utils/AI/AiContext/AiContextReader";
import TelemetryException from "../../../../../Models/DatabaseModels/TelemetryException";
import LlmLog from "../../../../../Models/DatabaseModels/LlmLog";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import {
  DuplicateVerdict,
  DuplicateVerdictKind,
  SimilarExceptionReason,
} from "../../../../../Types/Telemetry/SimilarExceptions";

/*
 * Are these the same bug? The prompt names the exception T and the
 * candidates C1, C2, ... (never ids), sends cut and scrubbed messages and
 * top frames, and the answer is mapped back through those references. The
 * checker finds the similar exceptions as the caller, asks no model when
 * there are none, asks the AI switch after the caller's reads, and goes
 * through executeWithLogging as an interactive call that keeps no previews.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const USER_ID: ObjectID = ObjectID.generate();
const TARGET_ID: string = "40000000-0000-4000-8000-000000000001";
const CANDIDATE_ID: string = "40000000-0000-4000-8000-000000000002";
const OTHER_ID: string = "40000000-0000-4000-8000-000000000003";
const CALLER: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: USER_ID,
};

const TRACE: string =
  "TypeError: x\n    at checkout (/app/src/cart.ts:42:17)\n    at run (/app/node_modules/x/index.js:1:1)";

function checkException(
  id: string,
  overrides: Partial<DuplicateCheckException> = {},
): DuplicateCheckException {
  return {
    telemetryExceptionId: id,
    exceptionType: "TypeError",
    message: "Cannot read properties of undefined (reading 'items')",
    stackTrace: TRACE,
    occurrenceCount: 4,
    isResolved: false,
    isArchived: false,
    ...overrides,
  };
}

describe("buildExceptionDuplicateCheckPrompt", () => {
  test("names the exception T and the candidates by reference, with their top frames, never their ids", () => {
    const prompt: string = buildExceptionDuplicateCheckPrompt({
      target: checkException(TARGET_ID),
      candidates: [
        checkException(CANDIDATE_ID, {
          isResolved: true,
          message: "Payment for priya@example.com failed",
        }),
      ],
    });

    expect(prompt).toContain("## T (unresolved)");
    expect(prompt).toContain("## C1 (resolved)");
    expect(prompt).toContain("- checkout (/app/src/cart.ts:42)");
    expect(prompt).toContain("[library]");
    expect(prompt).not.toContain(TARGET_ID);
    expect(prompt).not.toContain(CANDIDATE_ID);
    expect(prompt).not.toContain("priya@example.com");
  });
});

describe("parseExceptionDuplicateCheckResponse", () => {
  const candidates: Array<DuplicateCheckException> = [
    checkException(CANDIDATE_ID),
    checkException(OTHER_ID),
  ];

  test("maps each reference back; drops what it did not hold, a second answer, an unknown verdict", () => {
    const verdicts: Array<DuplicateVerdict> | null =
      parseExceptionDuplicateCheckResponse(
        JSON.stringify({
          items: [
            {
              ref: "C1",
              verdict: "duplicate",
              reason: "Same frame, same field.",
            },
            { ref: "C1", verdict: "different", reason: "Again." },
            { ref: "C2", verdict: "probably", reason: "?" },
            { ref: "C7", verdict: "duplicate", reason: "Invented." },
          ],
        }),
        candidates,
      );

    expect(verdicts).toEqual([
      {
        telemetryExceptionId: CANDIDATE_ID,
        verdict: DuplicateVerdictKind.Duplicate,
        reason: "Same frame, same field.",
      },
    ]);
  });

  test("an answer with no items is none", () => {
    expect(parseExceptionDuplicateCheckResponse("No idea.", candidates)).toBe(
      null,
    );
    expect(
      parseExceptionDuplicateCheckResponse(
        JSON.stringify({ x: 1 }),
        candidates,
      ),
    ).toBe(null);
  });
});

function row(id: string): TelemetryException {
  const exception: TelemetryException = new TelemetryException();
  exception._id = id;
  exception.projectId = PROJECT_ID;
  exception.exceptionType = "TypeError";
  exception.message = "Cannot read properties of undefined (reading 'items')";
  exception.stackTrace = TRACE;
  exception.occuranceCount = 4;
  return exception;
}

describe("ExceptionDuplicateChecker.check", () => {
  let order: Array<string>;
  let aiRequests: Array<AILogRequest>;
  let found: SimilarExceptionsWithEvidence;
  let readProps: Array<unknown>;

  beforeEach(() => {
    order = [];
    aiRequests = [];
    readProps = [];
    found = {
      target: row(TARGET_ID),
      similar: [
        {
          similar: {
            telemetryExceptionId: CANDIDATE_ID,
            exceptionType: "TypeError",
            message: "m",
            occurrenceCount: 4,
            isResolved: false,
            isArchived: false,
            reason: SimilarExceptionReason.SameCodeLocation,
          },
          exception: row(CANDIDATE_ID),
        },
      ],
    };

    jest
      .spyOn(SimilarExceptionsReader, "findWithEvidence")
      .mockImplementation((async (args: {
        props: DatabaseCommonInteractionProps;
      }) => {
        order.push("similar");
        readProps.push(args.props);
        return found;
      }) as never);
    jest
      .spyOn(AIService, "assertProjectAIEnabled")
      .mockImplementation((async () => {
        order.push("ai switch");
      }) as never);
    jest.spyOn(AiContextReader, "read").mockResolvedValue(null as never);
    jest.spyOn(AIService, "executeWithLogging").mockImplementation((async (
      request: AILogRequest,
    ) => {
      order.push("model");
      aiRequests.push(request);
      return {
        content: JSON.stringify({
          items: [{ ref: "C1", verdict: "duplicate", reason: "Same frame." }],
        }),
        llmLog: new LlmLog(),
      } as AILogResponse;
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("reads as the caller, then asks the AI switch, then the model; answers with the verdicts", async () => {
    const result: ExceptionDuplicateCheckResult =
      await ExceptionDuplicateChecker.check({
        telemetryExceptionId: new ObjectID(TARGET_ID),
        props: CALLER,
      });

    expect(order).toEqual(["similar", "ai switch", "model"]);
    expect(readProps).toEqual([CALLER]);
    expect(aiRequests[0]?.feature).toBe(EXCEPTION_DUPLICATE_CHECK_FEATURE);
    expect(aiRequests[0]?.userId).toBe(USER_ID);
    expect(aiRequests[0]?.requestRetries).toBe(0);
    expect(aiRequests[0]?.storeContentPreviews).toBe(false);
    expect(result.similar).toHaveLength(1);
    expect(result.verdicts).toEqual([
      {
        telemetryExceptionId: CANDIDATE_ID,
        verdict: DuplicateVerdictKind.Duplicate,
        reason: "Same frame.",
      },
    ]);
  });

  test("none similar: no model is asked", async () => {
    found = { target: row(TARGET_ID), similar: [] };

    const result: ExceptionDuplicateCheckResult =
      await ExceptionDuplicateChecker.check({
        telemetryExceptionId: new ObjectID(TARGET_ID),
        props: CALLER,
      });

    expect(result.verdicts).toEqual([]);
    expect(order).toEqual(["similar"]);
  });

  test("AI off: refused before the model", async () => {
    jest
      .spyOn(AIService, "assertProjectAIEnabled")
      .mockRejectedValue(new BadDataException("AI is off") as never);

    await expect(
      ExceptionDuplicateChecker.check({
        telemetryExceptionId: new ObjectID(TARGET_ID),
        props: CALLER,
      }),
    ).rejects.toThrow("AI is off");
    expect(aiRequests).toHaveLength(0);
  });

  test("an answer with no verdicts in it is an error to try again", async () => {
    jest.spyOn(AIService, "executeWithLogging").mockResolvedValue({
      content: "Cannot tell.",
      llmLog: new LlmLog(),
    } as AILogResponse as never);

    await expect(
      ExceptionDuplicateChecker.check({
        telemetryExceptionId: new ObjectID(TARGET_ID),
        props: CALLER,
      }),
    ).rejects.toThrow(
      "OneUptime AI did not return an answer. Please try again.",
    );
  });
});
