import { afterEach, describe, expect, test } from "@jest/globals";
import NewExceptionDetector, {
  NEW_EXCEPTION_CANDIDATE_LIMIT,
  NEW_EXCEPTION_GROUP_SCAN_LIMIT,
  NEW_EXCEPTION_HIGH_SEVERITY_OCCURRENCE_COUNT,
  NEW_EXCEPTION_MIN_OCCURRENCE_COUNT,
  NEW_EXCEPTION_TITLE_MESSAGE_MAX_LENGTH,
  NewExceptionDecision,
} from "../../../../../Server/Utils/AI/SRE/Insights/Detectors/NewExceptionDetector";
import { buildExceptionFailureModeKey } from "../../../../../Server/Utils/AI/SRE/Insights/Detectors/ExceptionIdentity";
import { InsightCandidate } from "../../../../../Server/Utils/AI/SRE/Insights/Types";
import TelemetryExceptionService from "../../../../../Server/Services/TelemetryExceptionService";
import ServiceService from "../../../../../Server/Services/ServiceService";
import TelemetryException from "../../../../../Models/DatabaseModels/TelemetryException";
import Service from "../../../../../Models/DatabaseModels/Service";
import AIInsightSeverity from "../../../../../Types/AI/AIInsightSeverity";
import AIInsightType from "../../../../../Types/AI/AIInsightType";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../../../Types/ObjectID";

/*
 * Invariant under test: the NewException detector deterministically turns
 * "an exception group born in the last 24h that is already recurring" into
 * exactly one insight candidate per FAILURE MODE — (entity, exception type,
 * normalized message), NOT per exception group, because group identity at
 * ingest includes the stack trace and one throw site reached from several
 * call paths is several groups. Occurrences are summed across the member
 * groups, the candidate qualifies at >= 3 and escalates to High at >= 50,
 * the fingerprint is the failure-mode key (never the group id, which would
 * file one insight per call path), and Postgres is read as root with an
 * explicit projectId (never user ACL). No LLM is ever involved.
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
  test("carries the type AND the message — the type alone collides", () => {
    expect(
      NewExceptionDetector.buildExceptionLabel("TypeError", "some message"),
    ).toBe("TypeError: some message");
  });

  /*
   * The reported symptom: instrumentation that types every failure by HTTP
   * status turns a whole service's unrelated exceptions into one string.
   */
  test("a low-signal type is disambiguated by the message", () => {
    expect(
      NewExceptionDetector.buildExceptionLabel(
        "401",
        "Authenticated user or a valid API key is needed to read record of Monitor.",
      ),
    ).not.toBe(
      NewExceptionDetector.buildExceptionLabel(
        "401",
        "Authenticated user or a valid API key is needed to read record of Incident.",
      ),
    );
  });

  test("does not repeat a type the runtime already prefixed onto the message", () => {
    expect(
      NewExceptionDetector.buildExceptionLabel("Error", "Error: boom"),
    ).toBe("Error: boom");
    expect(
      NewExceptionDetector.buildExceptionLabel("TypeError", "typeerror: boom"),
    ).toBe("typeerror: boom");
  });

  test("falls back to the type alone when there is no message", () => {
    expect(NewExceptionDetector.buildExceptionLabel("TypeError", "")).toBe(
      "TypeError",
    );
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

/*
 * The failure-mode key IS the insight's identity. Two properties matter and
 * both are load-bearing: it must ignore the stack trace (so one throw site
 * reached from many call paths is one insight), and it must be stable across
 * ticks and releases (a key that drifts files a duplicate on every drift).
 */
describe("buildExceptionFailureModeKey (pure identity)", () => {
  test("same entity + type + message → same key, whatever the stack trace", () => {
    const a: string = buildExceptionFailureModeKey({
      primaryEntityId: serviceId,
      exceptionType: "401",
      message: "Unauthorized",
    });
    const b: string = buildExceptionFailureModeKey({
      primaryEntityId: serviceId,
      exceptionType: "401",
      message: "Unauthorized",
    });
    expect(a).toBe(b);
  });

  test("interpolated ids do not split one failure mode", () => {
    expect(
      buildExceptionFailureModeKey({
        primaryEntityId: serviceId,
        exceptionType: "BadDataException",
        message:
          "invalid input syntax for type uuid: 550e8400-e29b-41d4-a716-446655440000",
      }),
    ).toBe(
      buildExceptionFailureModeKey({
        primaryEntityId: serviceId,
        exceptionType: "BadDataException",
        message:
          "invalid input syntax for type uuid: 6ba7b810-9dad-11d1-80b4-00c04fd430c8",
      }),
    );
  });

  test("a different message, type or entity is a different failure mode", () => {
    const base: string = buildExceptionFailureModeKey({
      primaryEntityId: serviceId,
      exceptionType: "401",
      message: "read record of Monitor",
    });

    expect(
      buildExceptionFailureModeKey({
        primaryEntityId: serviceId,
        exceptionType: "401",
        message: "read record of Incident",
      }),
    ).not.toBe(base);

    expect(
      buildExceptionFailureModeKey({
        primaryEntityId: serviceId,
        exceptionType: "403",
        message: "read record of Monitor",
      }),
    ).not.toBe(base);

    expect(
      buildExceptionFailureModeKey({
        primaryEntityId: ObjectID.generate(),
        exceptionType: "401",
        message: "read record of Monitor",
      }),
    ).not.toBe(base);
  });

  test("an unattributed entity still yields a stable key", () => {
    expect(
      buildExceptionFailureModeKey({
        primaryEntityId: undefined,
        exceptionType: "Error",
        message: "boom",
      }),
    ).toBe(
      buildExceptionFailureModeKey({
        primaryEntityId: undefined,
        exceptionType: "Error",
        message: "boom",
      }),
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
        limit: NEW_EXCEPTION_GROUP_SCAN_LIMIT,
        props: expect.objectContaining({ isRoot: true }),
      }),
    );

    /*
     * The ORDER BY carries a tie-break. occuranceCount climbs with every
     * ingested event, so the long tail sits densely tied right at the LIMIT
     * and an untie-broken sort hands back a different arbitrary subset every
     * tick.
     */
    expect(findBySpy.mock.calls[0]![0]!.sort).toEqual({
      occuranceCount: SortOrder.Descending,
      firstSeenAt: SortOrder.Ascending,
    });

    expect(candidates).toHaveLength(1);
    const candidate: InsightCandidate = candidates[0]!;
    expect(candidate.insightType).toBe(AIInsightType.NewException);
    expect(candidate.fingerprint).toBe(
      `new-exception:${buildExceptionFailureModeKey({
        primaryEntityId: serviceId,
        exceptionType: "TypeError",
        message: "Cannot read properties of undefined (reading 'user')",
      })}`,
    );
    expect(candidate.title).toBe(
      "New exception: TypeError: Cannot read properties of undefined (reading 'user') in web-api",
    );
    expect(candidate.severity).toBe(AIInsightSeverity.High);
    expect(candidate.serviceName).toBe("web-api");
    expect(candidate.telemetryServiceId).toBe(serviceId);
    expect(candidate.telemetryExceptionId).toBe(exceptionId);
    expect(candidate.evidence.exception).toEqual(
      expect.objectContaining({
        exceptionType: "TypeError",
        totalOccurrenceCount: 57,
        distinctExceptionGroupCount: 1,
        firstSeenAt: "2026-07-14T02:00:00.000Z",
      }),
    );
    expect(candidate.detailMarkdown).toContain("Occurrences so far: 57");
    expect(candidate.detailMarkdown).toContain("web-api");
    // A single group says nothing about stack variants.
    expect(candidate.detailMarkdown).not.toContain("distinct stack traces");
  });

  /*
   * THE REGRESSION THIS DETECTOR EXISTS TO PREVENT. The ingest fingerprint
   * hashes the normalized stack trace, so one throw site reached from three
   * call paths is three TelemetryException groups. Filing one insight per
   * group is what produced a wall of identical "New exception: 401 in api"
   * rows.
   */
  test("stack-trace variants of one failure mode collapse into ONE candidate", async () => {
    const variantIds: Array<ObjectID> = [
      ObjectID.generate(),
      ObjectID.generate(),
      ObjectID.generate(),
    ];

    jest.spyOn(TelemetryExceptionService, "findBy").mockResolvedValue([
      fakeException({
        id: variantIds[0]!,
        exceptionType: "401",
        message: "Unauthorized",
        occuranceCount: 12,
        firstSeenAt: new Date("2026-07-14T06:00:00.000Z"),
      }),
      fakeException({
        id: variantIds[1]!,
        exceptionType: "401",
        message: "Unauthorized",
        occuranceCount: 30,
        firstSeenAt: new Date("2026-07-14T04:00:00.000Z"),
      }),
      fakeException({
        id: variantIds[2]!,
        exceptionType: "401",
        message: "Unauthorized",
        occuranceCount: 9,
        firstSeenAt: new Date("2026-07-14T02:00:00.000Z"),
      }),
    ] as unknown as Array<TelemetryException>);
    jest
      .spyOn(ServiceService, "findOneById")
      .mockResolvedValue({ name: "api" } as unknown as Service);

    const detector: NewExceptionDetector = new NewExceptionDetector();
    const candidates: Array<InsightCandidate> = await detector.detect({
      projectId,
      now,
    });

    expect(candidates).toHaveLength(1);
    const candidate: InsightCandidate = candidates[0]!;

    // Counts are summed, so severity reflects the whole failure mode.
    expect(candidate.evidence.exception?.totalOccurrenceCount).toBe(51);
    expect(candidate.evidence.exception?.distinctExceptionGroupCount).toBe(3);
    expect(candidate.severity).toBe(AIInsightSeverity.High);
    // The earliest member dates the finding.
    expect(candidate.evidence.exception?.firstSeenAt).toBe(
      "2026-07-14T02:00:00.000Z",
    );
    // The loudest member is what the insight links to.
    expect(candidate.telemetryExceptionId).toBe(variantIds[1]!);
    expect(candidate.detailMarkdown).toContain(
      "Raised from 3 distinct stack traces",
    );
  });

  test("the fingerprint does not move when the loudest member changes", async () => {
    const quiet: ObjectID = ObjectID.generate();
    const loud: ObjectID = ObjectID.generate();

    jest
      .spyOn(ServiceService, "findOneById")
      .mockResolvedValue({ name: "api" } as unknown as Service);

    type FingerprintForOrderFunction = (
      order: Array<[ObjectID, number]>,
    ) => Promise<string>;

    const fingerprintForOrder: FingerprintForOrderFunction = async (
      order: Array<[ObjectID, number]>,
    ): Promise<string> => {
      jest.spyOn(TelemetryExceptionService, "findBy").mockResolvedValue(
        order.map(([id, count]: [ObjectID, number]) => {
          return fakeException({
            id: id,
            exceptionType: "401",
            message: "Unauthorized",
            occuranceCount: count,
          });
        }) as unknown as Array<TelemetryException>,
      );

      const detector: NewExceptionDetector = new NewExceptionDetector();
      const candidates: Array<InsightCandidate> = await detector.detect({
        projectId,
        now,
      });
      return candidates[0]!.fingerprint;
    };

    const before: string = await fingerprintForOrder([
      [quiet, 40],
      [loud, 5],
    ]);
    const after: string = await fingerprintForOrder([
      [loud, 900],
      [quiet, 40],
    ]);

    expect(before).toBe(after);
  });

  test("distinct failure modes stay distinct, and the loudest is first", async () => {
    jest.spyOn(TelemetryExceptionService, "findBy").mockResolvedValue([
      fakeException({
        id: ObjectID.generate(),
        exceptionType: "401",
        message: "read record of Monitor",
        occuranceCount: 8,
      }),
      fakeException({
        id: ObjectID.generate(),
        exceptionType: "401",
        message: "read record of Incident",
        occuranceCount: 60,
      }),
    ] as unknown as Array<TelemetryException>);
    jest
      .spyOn(ServiceService, "findOneById")
      .mockResolvedValue({ name: "api" } as unknown as Service);

    const detector: NewExceptionDetector = new NewExceptionDetector();
    const candidates: Array<InsightCandidate> = await detector.detect({
      projectId,
      now,
    });

    expect(candidates).toHaveLength(2);
    expect(candidates[0]!.fingerprint).not.toBe(candidates[1]!.fingerprint);
    expect(candidates[0]!.title).not.toBe(candidates[1]!.title);
    expect(candidates[0]!.evidence.exception?.totalOccurrenceCount).toBe(60);
  });

  test("caps emitted candidates at the candidate limit, not the scan limit", async () => {
    const groups: Array<TelemetryException> = [];
    for (let i: number = 0; i < NEW_EXCEPTION_GROUP_SCAN_LIMIT; i++) {
      groups.push(
        fakeException({
          id: ObjectID.generate(),
          exceptionType: "Error",
          message: `distinct failure ${i}`,
          occuranceCount: 5,
        }),
      );
    }

    jest
      .spyOn(TelemetryExceptionService, "findBy")
      .mockResolvedValue(groups as unknown as Array<TelemetryException>);
    jest.spyOn(ServiceService, "findOneById").mockResolvedValue(null);

    const detector: NewExceptionDetector = new NewExceptionDetector();
    const candidates: Array<InsightCandidate> = await detector.detect({
      projectId,
      now,
    });

    expect(candidates).toHaveLength(NEW_EXCEPTION_CANDIDATE_LIMIT);
  });

  test("resolves each service name once, however many groups share it", async () => {
    jest.spyOn(TelemetryExceptionService, "findBy").mockResolvedValue([
      fakeException({
        id: ObjectID.generate(),
        message: "first failure",
        occuranceCount: 10,
      }),
      fakeException({
        id: ObjectID.generate(),
        message: "second failure",
        occuranceCount: 9,
      }),
      fakeException({
        id: ObjectID.generate(),
        message: "third failure",
        occuranceCount: 8,
      }),
    ] as unknown as Array<TelemetryException>);
    const findOneByIdSpy: jest.SpyInstance = jest
      .spyOn(ServiceService, "findOneById")
      .mockResolvedValue({ name: "web-api" } as unknown as Service);

    const detector: NewExceptionDetector = new NewExceptionDetector();
    const candidates: Array<InsightCandidate> = await detector.detect({
      projectId,
      now,
    });

    expect(candidates).toHaveLength(3);
    expect(findOneByIdSpy).toHaveBeenCalledTimes(1);
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
    expect(candidates[0]!.title).toBe(
      "New exception: TypeError: Cannot read properties of undefined (reading 'user')",
    );
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
