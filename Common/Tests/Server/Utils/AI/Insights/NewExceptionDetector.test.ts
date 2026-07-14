import { afterEach, describe, expect, test } from "@jest/globals";
import NewExceptionDetector, {
  NEW_EXCEPTION_CANDIDATE_LIMIT,
  NEW_EXCEPTION_HIGH_SEVERITY_OCCURRENCE_COUNT,
  NEW_EXCEPTION_MIN_OCCURRENCE_COUNT,
  NEW_EXCEPTION_TITLE_MESSAGE_MAX_LENGTH,
  NewExceptionDecision,
} from "../../../../../Server/Utils/AI/SRE/Insights/Detectors/NewExceptionDetector";
import { InsightCandidate } from "../../../../../Server/Utils/AI/SRE/Insights/Types";
import TelemetryExceptionService from "../../../../../Server/Services/TelemetryExceptionService";
import ServiceService from "../../../../../Server/Services/ServiceService";
import TelemetryException from "../../../../../Models/DatabaseModels/TelemetryException";
import Service from "../../../../../Models/DatabaseModels/Service";
import AIInsightSeverity from "../../../../../Types/AI/AIInsightSeverity";
import AIInsightType from "../../../../../Types/AI/AIInsightType";
import ObjectID from "../../../../../Types/ObjectID";

/*
 * Invariant under test: the NewException detector deterministically turns
 * "an exception group born in the last 24h that is already recurring" into
 * exactly one insight candidate per group — qualifying at >= 3 lifetime
 * occurrences, escalating to High at >= 50, fingerprinted on the group id
 * — and reads Postgres as root with an explicit projectId (never user
 * ACL). No LLM is ever involved.
 */

const projectId: ObjectID = ObjectID.generate();
const exceptionId: ObjectID = ObjectID.generate();
const serviceId: ObjectID = ObjectID.generate();
const now: Date = new Date("2026-07-14T12:00:00.000Z");

type FakeExceptionOverrides = {
  id?: ObjectID | undefined;
  message?: string | undefined;
  exceptionType?: string | undefined;
  occuranceCount?: number | undefined;
  firstSeenAt?: Date | undefined;
  primaryEntityId?: ObjectID | undefined;
};

function fakeException(
  overrides: FakeExceptionOverrides = {},
): TelemetryException {
  return {
    id: exceptionId,
    message: "Cannot read properties of undefined (reading 'user')",
    exceptionType: "TypeError",
    occuranceCount: 57,
    firstSeenAt: new Date("2026-07-14T02:00:00.000Z"),
    primaryEntityId: serviceId,
    ...overrides,
  } as unknown as TelemetryException;
}

describe("NewExceptionDetector.evaluateNewException (pure decision matrix)", () => {
  test("below the minimum occurrence count does not qualify", () => {
    const decision: NewExceptionDecision =
      NewExceptionDetector.evaluateNewException(
        NEW_EXCEPTION_MIN_OCCURRENCE_COUNT - 1,
      );
    expect(decision.qualifies).toBe(false);
  });

  test("exactly the minimum occurrence count qualifies at Medium", () => {
    const decision: NewExceptionDecision =
      NewExceptionDetector.evaluateNewException(
        NEW_EXCEPTION_MIN_OCCURRENCE_COUNT,
      );
    expect(decision.qualifies).toBe(true);
    expect(decision.severity).toBe(AIInsightSeverity.Medium);
  });

  test("one below the High threshold stays Medium", () => {
    const decision: NewExceptionDecision =
      NewExceptionDetector.evaluateNewException(
        NEW_EXCEPTION_HIGH_SEVERITY_OCCURRENCE_COUNT - 1,
      );
    expect(decision.qualifies).toBe(true);
    expect(decision.severity).toBe(AIInsightSeverity.Medium);
  });

  test("exactly the High threshold escalates to High", () => {
    const decision: NewExceptionDecision =
      NewExceptionDetector.evaluateNewException(
        NEW_EXCEPTION_HIGH_SEVERITY_OCCURRENCE_COUNT,
      );
    expect(decision.qualifies).toBe(true);
    expect(decision.severity).toBe(AIInsightSeverity.High);
  });

  test("zero occurrences does not qualify", () => {
    const decision: NewExceptionDecision =
      NewExceptionDetector.evaluateNewException(0);
    expect(decision.qualifies).toBe(false);
  });
});

describe("NewExceptionDetector.buildExceptionLabel (pure)", () => {
  test("prefers the exception type when present", () => {
    expect(
      NewExceptionDetector.buildExceptionLabel("TypeError", "some message"),
    ).toBe("TypeError");
  });

  test("falls back to the message when the type is empty/whitespace", () => {
    expect(NewExceptionDetector.buildExceptionLabel("   ", "boom")).toBe(
      "boom",
    );
    expect(NewExceptionDetector.buildExceptionLabel(undefined, "boom")).toBe(
      "boom",
    );
  });

  test("truncates long messages to the title cap with an ellipsis", () => {
    const longMessage: string = "x".repeat(
      NEW_EXCEPTION_TITLE_MESSAGE_MAX_LENGTH + 20,
    );
    const label: string = NewExceptionDetector.buildExceptionLabel(
      undefined,
      longMessage,
    );
    expect(label).toBe(
      `${"x".repeat(NEW_EXCEPTION_TITLE_MESSAGE_MAX_LENGTH)}…`,
    );
  });

  test("a message exactly at the cap is not truncated", () => {
    const exactMessage: string = "y".repeat(
      NEW_EXCEPTION_TITLE_MESSAGE_MAX_LENGTH,
    );
    expect(
      NewExceptionDetector.buildExceptionLabel(undefined, exactMessage),
    ).toBe(exactMessage);
  });

  test("no type and no message yields a stable placeholder", () => {
    expect(NewExceptionDetector.buildExceptionLabel(undefined, undefined)).toBe(
      "Unknown exception",
    );
    expect(NewExceptionDetector.buildExceptionLabel("", "   ")).toBe(
      "Unknown exception",
    );
  });
});

describe("NewExceptionDetector.buildFingerprint (pure)", () => {
  test("wire-contract fingerprint format", () => {
    expect(NewExceptionDetector.buildFingerprint("abc123")).toBe(
      "new-exception:abc123",
    );
  });
});

describe("NewExceptionDetector.detect (IO wiring)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("queries Postgres as root scoped to the project and maps a candidate", async () => {
    const findBySpy: jest.SpyInstance = jest
      .spyOn(TelemetryExceptionService, "findBy")
      .mockResolvedValue([
        fakeException(),
      ] as unknown as Array<TelemetryException>);
    jest
      .spyOn(ServiceService, "findOneById")
      .mockResolvedValue({ name: "web-api" } as unknown as Service);

    const detector: NewExceptionDetector = new NewExceptionDetector();
    const candidates: Array<InsightCandidate> = await detector.detect({
      projectId,
      now,
    });

    expect(findBySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          projectId: projectId,
          isResolved: false,
          isArchived: false,
          firstSeenAt: expect.anything(),
          occuranceCount: expect.anything(),
        }),
        limit: NEW_EXCEPTION_CANDIDATE_LIMIT,
        props: expect.objectContaining({ isRoot: true }),
      }),
    );

    expect(candidates).toHaveLength(1);
    const candidate: InsightCandidate = candidates[0]!;
    expect(candidate.insightType).toBe(AIInsightType.NewException);
    expect(candidate.fingerprint).toBe(
      `new-exception:${exceptionId.toString()}`,
    );
    expect(candidate.title).toBe("New exception: TypeError in web-api");
    expect(candidate.severity).toBe(AIInsightSeverity.High);
    expect(candidate.serviceName).toBe("web-api");
    expect(candidate.telemetryServiceId).toBe(serviceId);
    expect(candidate.telemetryExceptionId).toBe(exceptionId);
    expect(candidate.evidence.exception).toEqual(
      expect.objectContaining({
        exceptionType: "TypeError",
        totalOccurrenceCount: 57,
        firstSeenAt: "2026-07-14T02:00:00.000Z",
      }),
    );
    expect(candidate.detailMarkdown).toContain("Occurrences so far: 57");
    expect(candidate.detailMarkdown).toContain("web-api");
  });

  test("unresolvable service (host/cluster entity) ships without a service name", async () => {
    jest
      .spyOn(TelemetryExceptionService, "findBy")
      .mockResolvedValue([
        fakeException({ occuranceCount: 5 }),
      ] as unknown as Array<TelemetryException>);
    jest.spyOn(ServiceService, "findOneById").mockResolvedValue(null);

    const detector: NewExceptionDetector = new NewExceptionDetector();
    const candidates: Array<InsightCandidate> = await detector.detect({
      projectId,
      now,
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.title).toBe("New exception: TypeError");
    expect(candidates[0]!.serviceName).toBeUndefined();
    expect(candidates[0]!.telemetryServiceId).toBeUndefined();
    expect(candidates[0]!.severity).toBe(AIInsightSeverity.Medium);
  });

  test("no candidates from the query yields no insights (and no service lookups)", async () => {
    jest.spyOn(TelemetryExceptionService, "findBy").mockResolvedValue([]);
    const findOneByIdSpy: jest.SpyInstance = jest.spyOn(
      ServiceService,
      "findOneById",
    );

    const detector: NewExceptionDetector = new NewExceptionDetector();
    const candidates: Array<InsightCandidate> = await detector.detect({
      projectId,
      now,
    });

    expect(candidates).toEqual([]);
    expect(findOneByIdSpy).not.toHaveBeenCalled();
  });

  test("detect propagates storage errors — the scanner isolates detectors, not the detector itself", async () => {
    jest
      .spyOn(TelemetryExceptionService, "findBy")
      .mockRejectedValue(new Error("db down"));

    const detector: NewExceptionDetector = new NewExceptionDetector();
    await expect(detector.detect({ projectId, now })).rejects.toThrow(
      "db down",
    );
  });
});
