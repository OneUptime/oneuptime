import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import ExceptionMissingStackTraceDetector from "../../../../../Server/Utils/AI/SRE/Insights/Detectors/ExceptionMissingStackTraceDetector";
import { InsightCandidate } from "../../../../../Server/Utils/AI/SRE/Insights/Types";
import TelemetryExceptionService from "../../../../../Server/Services/TelemetryExceptionService";
import ServiceService from "../../../../../Server/Services/ServiceService";
import TelemetryException from "../../../../../Models/DatabaseModels/TelemetryException";
import Service from "../../../../../Models/DatabaseModels/Service";
import AIInsightSeverity from "../../../../../Types/AI/AIInsightSeverity";
import AIInsightType from "../../../../../Types/AI/AIInsightType";
import IncludesNone from "../../../../../Types/BaseDatabase/IncludesNone";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import PositiveNumber from "../../../../../Types/PositiveNumber";
import {
  EXCEPTION_STACK_TRACE_GROUP_SCAN_LIMIT,
  getExceptionStackTraceFingerprint,
} from "../../../../../Utils/Exceptions/ExceptionInsight";

/*
 * ExceptionMissingStackTrace: a service whose exceptions over the last day
 * were recorded with no stack trace, 20 or more times together - filed for
 * the Exceptions product's AI section, whose pull request makes the
 * service record stack traces. Pinned here: the root read of the day's
 * stackless, unresolved, unarchived, real failures (not user errors or
 * expected denials), loudest first; only services count; the loudest
 * three; the count of the service's exceptions that did carry one; and
 * the finding's identity, words and evidence - naming no exception of its
 * own, so the investigation's verdict is never stamped onto one.
 */

const projectId: ObjectID = ObjectID.generate();
const checkout: ObjectID = new ObjectID("aaaaaaaa-0000-4000-8000-00000000000a");
const payments: ObjectID = new ObjectID("bbbbbbbb-0000-4000-8000-00000000000b");
const someHost: ObjectID = new ObjectID("cccccccc-0000-4000-8000-00000000000c");
const now: Date = new Date("2026-10-24T09:00:00.000Z");

// The SQL a raw query operator writes for a column.
function sqlOf(operator: unknown, column: string): string {
  const raw: { getSql?: (alias: string) => string } = operator as {
    getSql?: (alias: string) => string;
  };

  return raw.getSql ? raw.getSql(column) : "";
}

// A record's fields to set - any of them left empty (undefined) on purpose.
type Fields<T> = { [K in keyof T]?: T[K] | undefined };

function stackless(
  overrides: Fields<TelemetryException> = {},
): TelemetryException {
  return {
    id: ObjectID.generate(),
    message: "context deadline exceeded",
    exceptionType: "TimeoutError",
    occuranceCount: 30,
    lastSeenAt: new Date("2026-10-24T08:50:00.000Z"),
    primaryEntityId: checkout,
    ...overrides,
  } as unknown as TelemetryException;
}

function mockServices(): SpyInstance<typeof ServiceService.findBy> {
  return jest.spyOn(ServiceService, "findBy").mockResolvedValue([
    { id: checkout, name: "checkout" },
    { id: payments, name: "payments" },
  ] as unknown as Array<Service>);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ExceptionMissingStackTraceDetector", () => {
  test("files Exceptions' missing stack traces", () => {
    expect(new ExceptionMissingStackTraceDetector().insightType).toBe(
      AIInsightType.ExceptionMissingStackTrace,
    );
  });

  test("reads the day's stackless real failures as root, loudest first", async () => {
    const findBy: SpyInstance<typeof TelemetryExceptionService.findBy> = jest
      .spyOn(TelemetryExceptionService, "findBy")
      .mockResolvedValue([]);

    await new ExceptionMissingStackTraceDetector().detect({ projectId, now });

    const call: JSONObject = findBy.mock.calls[0]![0] as unknown as JSONObject;
    const query: JSONObject = call["query"] as JSONObject;

    expect(query["projectId"]).toBe(projectId);
    expect(query["isResolved"]).toBe(false);
    expect(query["isArchived"]).toBe(false);
    expect(query["errorClass"]).toBeInstanceOf(IncludesNone);
    expect(JSON.stringify(query["errorClass"])).toContain("user-error");
    expect(JSON.stringify(query["errorClass"])).toContain("expected-denial");
    // An empty stack trace or none at all: never one from any occurrence.
    expect(sqlOf(query["stackTrace"], "stackTrace")).toMatch(
      /^\(stackTrace = :\w+ or stackTrace IS NULL\)$/,
    );
    expect(JSON.stringify(query["stackTrace"])).toContain('""');
    expect(JSON.stringify(query["lastSeenAt"])).toContain(
      "2026-10-23T09:00:00.000Z",
    );
    expect(call["sort"]).toEqual({
      occuranceCount: SortOrder.Descending,
      firstSeenAt: SortOrder.Ascending,
    });
    expect(call["limit"]).toBe(EXCEPTION_STACK_TRACE_GROUP_SCAN_LIMIT);
    expect((call["props"] as JSONObject)["isRoot"]).toBe(true);
  });

  test("nothing stackless: no service is looked up and nothing is filed", async () => {
    jest.spyOn(TelemetryExceptionService, "findBy").mockResolvedValue([]);
    const services: SpyInstance<typeof ServiceService.findBy> = mockServices();

    expect(
      await new ExceptionMissingStackTraceDetector().detect({ projectId, now }),
    ).toEqual([]);
    expect(services).not.toHaveBeenCalled();
  });

  test("a service whose every exception of the day had no stack trace: one finding", async () => {
    jest.spyOn(TelemetryExceptionService, "findBy").mockResolvedValue([
      stackless({ occuranceCount: 900 }),
      stackless({
        exceptionType: "*errors.errorString",
        message: "",
        occuranceCount: 340,
      }),
    ] as unknown as Array<TelemetryException>);
    const services: SpyInstance<typeof ServiceService.findBy> = mockServices();
    const countBy: SpyInstance<typeof TelemetryExceptionService.countBy> = jest
      .spyOn(TelemetryExceptionService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));

    const candidates: Array<InsightCandidate> =
      await new ExceptionMissingStackTraceDetector().detect({ projectId, now });

    expect(candidates).toHaveLength(1);
    const candidate: InsightCandidate = candidates[0]!;

    expect(candidate.insightType).toBe(
      AIInsightType.ExceptionMissingStackTrace,
    );
    expect(candidate.fingerprint).toBe(
      getExceptionStackTraceFingerprint(checkout.toString()),
    );
    expect(candidate.title).toBe("Exceptions in checkout have no stack trace");
    expect(candidate.severity).toBe(AIInsightSeverity.Medium);
    expect(candidate.serviceName).toBe("checkout");
    expect(candidate.telemetryServiceId?.toString()).toBe(checkout.toString());
    // About a service, not one exception: no verdict is ever stamped onto one.
    expect(candidate.telemetryExceptionId).toBeUndefined();
    expect(candidate.evidence.exceptionStackTrace).toEqual(
      expect.objectContaining({
        serviceId: checkout.toString(),
        windowStartTime: "2026-10-23T09:00:00.000Z",
        windowEndTime: "2026-10-24T09:00:00.000Z",
        exceptionCount: 2,
        occurrenceCount: 1240,
        withStackTraceCount: 0,
      }),
    );
    expect(candidate.evidence.exceptionStackTrace?.exceptions[0]).toEqual(
      expect.objectContaining({
        exceptionType: "TimeoutError",
        exceptionMessage: "context deadline exceeded",
        occurrenceCount: 900,
        lastSeenAt: "2026-10-24T08:50:00.000Z",
      }),
    );
    expect(candidate.detailMarkdown.split("\n")[0]).toBe(
      "**Missing stack traces in checkout**",
    );

    // The services, in one read of the ids the exceptions name.
    expect(services).toHaveBeenCalledTimes(1);
    const servicesQuery: JSONObject = (
      services.mock.calls[0]![0] as unknown as JSONObject
    )["query"] as JSONObject;
    expect(servicesQuery["projectId"]).toBe(projectId);

    // The service's other exceptions of the day that did carry one.
    const countQuery: JSONObject = (
      countBy.mock.calls[0]![0] as unknown as JSONObject
    )["query"] as JSONObject;
    expect(String(countQuery["primaryEntityId"])).toBe(checkout.toString());
    expect(sqlOf(countQuery["stackTrace"], "stackTrace")).toMatch(
      /^\(stackTrace != :\w+\)$/,
    );
  });

  test("only some of its exceptions lack one: says how many, and others carried one", async () => {
    jest
      .spyOn(TelemetryExceptionService, "findBy")
      .mockResolvedValue([
        stackless({ occuranceCount: 25 }),
      ] as unknown as Array<TelemetryException>);
    mockServices();
    jest
      .spyOn(TelemetryExceptionService, "countBy")
      .mockResolvedValue(new PositiveNumber(14));

    const candidate: InsightCandidate = (
      await new ExceptionMissingStackTraceDetector().detect({ projectId, now })
    )[0]!;

    expect(candidate.title).toBe("An exception in checkout has no stack trace");
    expect(candidate.severity).toBe(AIInsightSeverity.Low);
    expect(candidate.evidence.exceptionStackTrace?.withStackTraceCount).toBe(
      14,
    );
    expect(candidate.detailMarkdown).toContain(
      "- 14 of its other exceptions seen that day carried a stack trace",
    );
  });

  test("a host's exceptions, or too few, file nothing", async () => {
    jest
      .spyOn(TelemetryExceptionService, "findBy")
      .mockResolvedValue([
        stackless({ primaryEntityId: someHost, occuranceCount: 5000 }),
        stackless({ primaryEntityId: payments, occuranceCount: 19 }),
        stackless({ primaryEntityId: undefined, occuranceCount: 5000 }),
      ] as unknown as Array<TelemetryException>);
    mockServices();
    const countBy: SpyInstance<typeof TelemetryExceptionService.countBy> =
      jest.spyOn(TelemetryExceptionService, "countBy");

    expect(
      await new ExceptionMissingStackTraceDetector().detect({ projectId, now }),
    ).toEqual([]);
    expect(countBy).not.toHaveBeenCalled();
  });

  test("several services: the loudest first, each its own finding", async () => {
    jest
      .spyOn(TelemetryExceptionService, "findBy")
      .mockResolvedValue([
        stackless({ primaryEntityId: checkout, occuranceCount: 40 }),
        stackless({ primaryEntityId: payments, occuranceCount: 300 }),
      ] as unknown as Array<TelemetryException>);
    mockServices();
    jest
      .spyOn(TelemetryExceptionService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));

    const candidates: Array<InsightCandidate> =
      await new ExceptionMissingStackTraceDetector().detect({ projectId, now });

    expect(
      candidates.map((candidate: InsightCandidate): string | undefined => {
        return candidate.serviceName;
      }),
    ).toEqual(["payments", "checkout"]);
    const fingerprints: Set<string> = new Set(
      candidates.map((candidate: InsightCandidate): string => {
        return candidate.fingerprint;
      }),
    );

    expect(fingerprints.size).toBe(2);
  });

  test("the exceptions' words are sanitized: no secret rides along", async () => {
    jest.spyOn(TelemetryExceptionService, "findBy").mockResolvedValue([
      stackless({
        occuranceCount: 50,
        message:
          "auth failed for token=ghp_0123456789abcdefghijklmnopqrstuvwxyzAB",
      }),
    ] as unknown as Array<TelemetryException>);
    mockServices();
    jest
      .spyOn(TelemetryExceptionService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));

    const candidate: InsightCandidate = (
      await new ExceptionMissingStackTraceDetector().detect({ projectId, now })
    )[0]!;

    expect(JSON.stringify(candidate)).not.toContain(
      "ghp_0123456789abcdefghijklmnopqrstuvwxyzAB",
    );
  });

  test("a failed read is the scanner's to isolate: the detector does not swallow it", async () => {
    jest
      .spyOn(TelemetryExceptionService, "findBy")
      .mockRejectedValue(new Error("db down"));

    await expect(
      new ExceptionMissingStackTraceDetector().detect({ projectId, now }),
    ).rejects.toThrow("db down");
  });
});
