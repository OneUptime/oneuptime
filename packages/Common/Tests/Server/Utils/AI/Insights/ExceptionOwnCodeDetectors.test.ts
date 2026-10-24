import { afterEach, describe, expect, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import ExceptionOwnCode, {
  ExceptionOwnCodeReading,
} from "../../../../../Server/Utils/AI/SRE/Insights/Detectors/ExceptionOwnCode";
import NewExceptionDetector from "../../../../../Server/Utils/AI/SRE/Insights/Detectors/NewExceptionDetector";
import ExceptionSpikeDetector from "../../../../../Server/Utils/AI/SRE/Insights/Detectors/ExceptionSpikeDetector";
import { InsightCandidate } from "../../../../../Server/Utils/AI/SRE/Insights/Types";
import TelemetryExceptionService from "../../../../../Server/Services/TelemetryExceptionService";
import ExceptionInstanceService from "../../../../../Server/Services/ExceptionInstanceService";
import ServiceService from "../../../../../Server/Services/ServiceService";
import TelemetryException from "../../../../../Models/DatabaseModels/TelemetryException";
import Service from "../../../../../Models/DatabaseModels/Service";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import PositiveNumber from "../../../../../Types/PositiveNumber";

/*
 * Where an exception was raised in the application's own code
 * (ExceptionOwnCode), as the two exception detectors keep it on a finding
 * for the Exceptions product's AI section: the frames of your code, read
 * from the exception's sanitized stack trace, innermost first - a stack of
 * library and runtime frames only says none, a missing one says it was
 * recorded without one. Read in one query for the findings a tick files
 * only, and best-effort: a failed read files the finding without it.
 */

const projectId: ObjectID = ObjectID.generate();
const serviceId: ObjectID = ObjectID.generate();
const now: Date = new Date("2026-10-24T12:00:00.000Z");

const NODE_STACK: string = [
  "TypeError: Cannot read properties of undefined (reading 'id')",
  "    at Object.parse (node:internal/json:12:3)",
  "    at getOrder (/app/src/orders.ts:42:17)",
  "    at Layer.handle (/app/node_modules/express/lib/router/layer.js:95:5)",
  "    at handleRequest (/app/src/routes.ts:10:3)",
].join("\n");

const LIBRARY_ONLY_STACK: string = [
  "Error: socket hang up",
  "    at connResetException (node:internal/errors:720:14)",
  "    at TLSSocket.socketOnEnd (node:_http_client:525:23)",
].join("\n");

const PYTHON_STACK: string = [
  "Traceback (most recent call last):",
  '  File "/app/main.py", line 5, in <module>',
  "    run()",
  '  File "/app/views.py", line 20, in view',
  "    load()",
  '  File "/app/models.py", line 88, in load',
  "    raise ValueError('bad')",
  "ValueError: bad",
].join("\n");

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ExceptionOwnCode.read", () => {
  test("a Node stack: your frames innermost first, library and runtime frames left out", () => {
    const reading: ExceptionOwnCodeReading = ExceptionOwnCode.read(NODE_STACK);

    expect(reading.stackFrameCount).toBe(4);
    expect(reading.ownCodeFrames).toEqual([
      {
        functionName: "getOrder",
        fileName: "/app/src/orders.ts",
        lineNumber: 42,
      },
      {
        functionName: "handleRequest",
        fileName: "/app/src/routes.ts",
        lineNumber: 10,
      },
    ]);
  });

  test("a Python traceback: its last frame is the innermost", () => {
    const reading: ExceptionOwnCodeReading =
      ExceptionOwnCode.read(PYTHON_STACK);

    expect(reading.stackFrameCount).toBe(3);
    expect(reading.ownCodeFrames[0]).toEqual({
      functionName: "load",
      fileName: "/app/models.py",
      lineNumber: 88,
    });
  });

  test("library and runtime frames only: frames, but none of your code", () => {
    const reading: ExceptionOwnCodeReading =
      ExceptionOwnCode.read(LIBRARY_ONLY_STACK);

    expect(reading.stackFrameCount).toBeGreaterThan(0);
    expect(reading.ownCodeFrames).toEqual([]);
  });

  test("no stack trace: no frames at all", () => {
    for (const stackTrace of ["", "   ", null, undefined]) {
      expect(ExceptionOwnCode.read(stackTrace)).toEqual({
        stackFrameCount: 0,
        ownCodeFrames: [],
      });
    }
  });

  test("a secret in a frame line's text is redacted before anything is kept", () => {
    const reading: ExceptionOwnCodeReading = ExceptionOwnCode.read(
      [
        "Error: failed for token=ghp_0123456789abcdefghijklmnopqrstuvwxyzAB",
        "    at getOrder (/app/src/orders.ts:42:17)",
      ].join("\n"),
    );

    expect(JSON.stringify(reading)).not.toContain(
      "ghp_0123456789abcdefghijklmnopqrstuvwxyzAB",
    );
  });
});

describe("ExceptionOwnCode.readMany", () => {
  test("one root read of the stack traces, scoped to the project and the ids", async () => {
    const first: ObjectID = ObjectID.generate();
    const second: ObjectID = ObjectID.generate();
    const findBy: SpyInstance<typeof TelemetryExceptionService.findBy> = jest
      .spyOn(TelemetryExceptionService, "findBy")
      .mockResolvedValue([
        { id: first, stackTrace: NODE_STACK },
        { id: second, stackTrace: "" },
        // Not asked for: never read into the map.
        { id: ObjectID.generate(), stackTrace: NODE_STACK },
      ] as unknown as Array<TelemetryException>);

    const readings: Map<string, ExceptionOwnCodeReading> =
      await ExceptionOwnCode.readMany({
        projectId,
        telemetryExceptionIds: [first, second, first],
      });

    expect(findBy).toHaveBeenCalledTimes(1);
    const call: JSONObject = findBy.mock.calls[0]![0] as unknown as JSONObject;
    expect((call["query"] as JSONObject)["projectId"]).toBe(projectId);
    expect(JSON.stringify((call["query"] as JSONObject)["_id"])).toContain(
      first.toString(),
    );
    expect(call["select"]).toEqual({ _id: true, stackTrace: true });
    expect(call["limit"]).toBe(2);
    expect((call["props"] as JSONObject)["isRoot"]).toBe(true);

    expect(readings.size).toBe(2);
    expect(readings.get(first.toString())?.ownCodeFrames).toHaveLength(2);
    expect(readings.get(second.toString())).toEqual({
      stackFrameCount: 0,
      ownCodeFrames: [],
    });
  });

  test("nothing asked: nothing read", async () => {
    const findBy: SpyInstance<typeof TelemetryExceptionService.findBy> =
      jest.spyOn(TelemetryExceptionService, "findBy");

    expect(
      (
        await ExceptionOwnCode.readMany({
          projectId,
          telemetryExceptionIds: [],
        })
      ).size,
    ).toBe(0);
    expect(findBy).not.toHaveBeenCalled();
  });

  test("a failed read never throws: the findings are filed without it", async () => {
    jest
      .spyOn(TelemetryExceptionService, "findBy")
      .mockRejectedValue(new Error("db down"));

    expect(
      (
        await ExceptionOwnCode.readMany({
          projectId,
          telemetryExceptionIds: [ObjectID.generate()],
        })
      ).size,
    ).toBe(0);
  });
});

describe("NewExceptionDetector: where your code raised it", () => {
  function fakeGroup(
    overrides: Partial<TelemetryException> = {},
  ): TelemetryException {
    return {
      id: ObjectID.generate(),
      message: "Cannot read properties of undefined (reading 'id')",
      exceptionType: "TypeError",
      occuranceCount: 57,
      firstSeenAt: new Date("2026-10-24T02:00:00.000Z"),
      primaryEntityId: serviceId,
      ...overrides,
    } as unknown as TelemetryException;
  }

  test("the representative's stack trace is read once, and the finding says where your code is", async () => {
    const representative: TelemetryException = fakeGroup({
      occuranceCount: 80,
    });
    const variant: TelemetryException = fakeGroup({ occuranceCount: 9 });
    const findBy: SpyInstance<typeof TelemetryExceptionService.findBy> = jest
      .spyOn(TelemetryExceptionService, "findBy")
      .mockResolvedValueOnce([
        representative,
        variant,
      ] as unknown as Array<TelemetryException>)
      .mockResolvedValueOnce([
        { id: representative.id, stackTrace: NODE_STACK },
      ] as unknown as Array<TelemetryException>);
    jest
      .spyOn(ServiceService, "findOneById")
      .mockResolvedValue({ name: "checkout" } as unknown as Service);

    const candidates: Array<InsightCandidate> =
      await new NewExceptionDetector().detect({ projectId, now });

    expect(candidates).toHaveLength(1);
    expect(findBy).toHaveBeenCalledTimes(2);

    // Only the representative's: the one the finding links and fixes.
    const stackRead: JSONObject = findBy.mock
      .calls[1]![0] as unknown as JSONObject;
    expect(JSON.stringify((stackRead["query"] as JSONObject)["_id"])).toContain(
      representative.id!.toString(),
    );
    expect(
      JSON.stringify((stackRead["query"] as JSONObject)["_id"]),
    ).not.toContain(variant.id!.toString());

    const candidate: InsightCandidate = candidates[0]!;
    expect(candidate.evidence.exception?.serviceId).toBe(serviceId.toString());
    expect(candidate.evidence.exception?.stackFrameCount).toBe(4);
    expect(candidate.evidence.exception?.ownCodeFrames?.[0]).toEqual({
      functionName: "getOrder",
      fileName: "/app/src/orders.ts",
      lineNumber: 42,
    });
    expect(candidate.detailMarkdown).toContain(
      "**Your code in its stack trace**",
    );
    expect(candidate.detailMarkdown).toContain(
      "- `getOrder` at `/app/src/orders.ts:42`",
    );
  });

  test("a stack of library frames only says so", async () => {
    const representative: TelemetryException = fakeGroup();
    jest
      .spyOn(TelemetryExceptionService, "findBy")
      .mockResolvedValueOnce([
        representative,
      ] as unknown as Array<TelemetryException>)
      .mockResolvedValueOnce([
        { id: representative.id, stackTrace: LIBRARY_ONLY_STACK },
      ] as unknown as Array<TelemetryException>);
    jest.spyOn(ServiceService, "findOneById").mockResolvedValue(null);

    const candidate: InsightCandidate = (
      await new NewExceptionDetector().detect({ projectId, now })
    )[0]!;

    expect(candidate.evidence.exception?.ownCodeFrames).toEqual([]);
    expect(candidate.detailMarkdown).toContain(
      "Its stack trace shows only library and runtime code",
    );
    // No service resolved: no service id either.
    expect(candidate.evidence.exception?.serviceId).toBeUndefined();
  });

  test("a stack trace that could not be read: the finding is filed, saying nothing of the code", async () => {
    jest
      .spyOn(TelemetryExceptionService, "findBy")
      .mockResolvedValueOnce([
        fakeGroup(),
      ] as unknown as Array<TelemetryException>)
      .mockRejectedValueOnce(new Error("db hiccup"));
    jest.spyOn(ServiceService, "findOneById").mockResolvedValue(null);

    const candidates: Array<InsightCandidate> =
      await new NewExceptionDetector().detect({ projectId, now });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.evidence.exception?.ownCodeFrames).toBeUndefined();
    expect(candidates[0]!.evidence.exception?.stackFrameCount).toBeUndefined();
    expect(candidates[0]!.detailMarkdown).not.toContain("stack trace shows");
  });

  test("nothing qualifies: no stack trace is read", async () => {
    const findBy: SpyInstance<typeof TelemetryExceptionService.findBy> = jest
      .spyOn(TelemetryExceptionService, "findBy")
      .mockResolvedValue([
        fakeGroup({ occuranceCount: 1 }),
      ] as unknown as Array<TelemetryException>);

    expect(await new NewExceptionDetector().detect({ projectId, now })).toEqual(
      [],
    );
    expect(findBy).toHaveBeenCalledTimes(1);
  });
});

describe("ExceptionSpikeDetector: where your code raised it", () => {
  test("only the spiking exceptions' stack traces are read", async () => {
    const spiking: ObjectID = ObjectID.generate();
    const quiet: ObjectID = ObjectID.generate();
    const findBy: SpyInstance<typeof TelemetryExceptionService.findBy> = jest
      .spyOn(TelemetryExceptionService, "findBy")
      .mockResolvedValueOnce([
        {
          id: spiking,
          message: "connection reset by peer",
          exceptionType: "ConnectionError",
          fingerprint: "fp-1",
          occuranceCount: 900,
          firstSeenAt: new Date("2026-09-01T00:00:00.000Z"),
          primaryEntityId: serviceId,
        },
        {
          id: quiet,
          message: "x",
          exceptionType: "Error",
          fingerprint: "fp-2",
          occuranceCount: 800,
          firstSeenAt: new Date("2026-09-01T00:00:00.000Z"),
          primaryEntityId: serviceId,
        },
      ] as unknown as Array<TelemetryException>)
      .mockResolvedValueOnce([
        { id: spiking, stackTrace: NODE_STACK },
      ] as unknown as Array<TelemetryException>);
    jest
      .spyOn(ExceptionInstanceService, "countBy")
      // fp-1: 50 in the last hour against 24 over the day before - a spike.
      .mockResolvedValueOnce(new PositiveNumber(50))
      .mockResolvedValueOnce(new PositiveNumber(24))
      // fp-2: 5 against 100 - no spike.
      .mockResolvedValueOnce(new PositiveNumber(5))
      .mockResolvedValueOnce(new PositiveNumber(100));
    jest
      .spyOn(ServiceService, "findOneById")
      .mockResolvedValue({ name: "payments" } as unknown as Service);

    const candidates: Array<InsightCandidate> =
      await new ExceptionSpikeDetector().detect({ projectId, now });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.telemetryExceptionId).toBe(spiking);

    const stackRead: JSONObject = findBy.mock
      .calls[1]![0] as unknown as JSONObject;
    expect(JSON.stringify((stackRead["query"] as JSONObject)["_id"])).toContain(
      spiking.toString(),
    );
    expect(
      JSON.stringify((stackRead["query"] as JSONObject)["_id"]),
    ).not.toContain(quiet.toString());

    expect(candidates[0]!.evidence.exception).toEqual(
      expect.objectContaining({
        recentOccurrenceCount: 50,
        serviceId: serviceId.toString(),
        stackFrameCount: 4,
      }),
    );
    expect(candidates[0]!.detailMarkdown).toContain(
      "- `getOrder` at `/app/src/orders.ts:42`",
    );
  });

  test("no spike: no stack trace is read", async () => {
    const findBy: SpyInstance<typeof TelemetryExceptionService.findBy> = jest
      .spyOn(TelemetryExceptionService, "findBy")
      .mockResolvedValue([
        {
          id: ObjectID.generate(),
          fingerprint: "fp-1",
          firstSeenAt: new Date("2026-09-01T00:00:00.000Z"),
        },
      ] as unknown as Array<TelemetryException>);
    jest
      .spyOn(ExceptionInstanceService, "countBy")
      .mockResolvedValue(new PositiveNumber(1));

    expect(
      await new ExceptionSpikeDetector().detect({ projectId, now }),
    ).toEqual([]);
    expect(findBy).toHaveBeenCalledTimes(1);
  });
});
