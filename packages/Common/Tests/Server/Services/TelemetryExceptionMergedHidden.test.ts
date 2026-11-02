import TelemetryExceptionService, {
  Service as TelemetryExceptionServiceClass,
} from "../../../Server/Services/TelemetryExceptionService";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { FindOperator } from "typeorm";
import fs from "fs";
import path from "path";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A MERGED EXCEPTION IS NOT LISTED.
 *
 * An exception merged into another (TelemetryExceptionMerge) is part of it,
 * so every read and count of exception groups leaves merged rows out - the
 * list, its counts, the monitors' new and regressed groups, What's new,
 * Similar exceptions, the AI's detectors - unless the query names them: by
 * id (an exception's own page), or by the column (the exceptions merged into
 * one). The exception monitor's resolved and archived fingerprints count a
 * merged exception's with the one it was merged into.
 */

const projectId: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const ROOT: DatabaseCommonInteractionProps = { isRoot: true };

afterEach(() => {
  jest.restoreAllMocks();
});

// QueryHelper.isNull(): a raw operator that renders "(column IS NULL)".
function isNullOperator(value: unknown): boolean {
  if (!(value instanceof FindOperator)) {
    return false;
  }

  const getSql: ((alias: string) => string) | undefined = (
    value as unknown as { getSql?: (alias: string) => string }
  ).getSql;

  return (
    value.type === "raw" &&
    typeof getSql === "function" &&
    getSql("column") === "(column IS NULL)"
  );
}

describe("which reads leave merged exceptions out", () => {
  test("a list or a count of exceptions does", () => {
    for (const query of [
      {},
      { projectId },
      { projectId, isResolved: false, isArchived: false },
      { projectId, fingerprint: "fp-1" },
      { projectId, exceptionType: "TypeError" },
    ]) {
      const hidden: Record<string, unknown> =
        TelemetryExceptionServiceClass.hideMergedExceptions(query);

      expect(isNullOperator(hidden["mergedIntoTelemetryExceptionId"])).toBe(
        true,
      );
      // The rest of the query is kept, and the caller's own is not changed.
      expect({ ...hidden, mergedIntoTelemetryExceptionId: undefined }).toEqual({
        ...query,
        mergedIntoTelemetryExceptionId: undefined,
      });
      expect(query).not.toHaveProperty("mergedIntoTelemetryExceptionId");
    }
  });

  test("a read by id does not: a merged exception's own page opens", () => {
    for (const query of [
      { _id: ObjectID.generate().toString() },
      { id: ObjectID.generate() },
    ]) {
      expect(TelemetryExceptionServiceClass.hideMergedExceptions(query)).toBe(
        query,
      );
    }
  });

  test("a read of the merged exceptions themselves does not", () => {
    const query: Record<string, unknown> = {
      projectId,
      mergedIntoTelemetryExceptionId: ObjectID.generate(),
    };

    expect(TelemetryExceptionServiceClass.hideMergedExceptions(query)).toBe(
      query,
    );
  });

  test("an empty query reads as one with nothing named", () => {
    expect(
      isNullOperator(
        (
          TelemetryExceptionServiceClass.hideMergedExceptions(
            undefined as unknown as Record<string, unknown>,
          ) as Record<string, unknown>
        )["mergedIntoTelemetryExceptionId"],
      ),
    ).toBe(true);
  });
});

describe("every find and count goes through it, for root too", () => {
  test("a find", async () => {
    const result: { findBy: { query: Record<string, unknown> } } = await (
      TelemetryExceptionService as unknown as {
        onBeforeFind: (findBy: unknown) => Promise<{
          findBy: { query: Record<string, unknown> };
        }>;
      }
    ).onBeforeFind({ query: { projectId }, props: ROOT });

    expect(
      isNullOperator(result.findBy.query["mergedIntoTelemetryExceptionId"]),
    ).toBe(true);
  });

  test("a count", async () => {
    const parent: { countBy: (countBy: unknown) => Promise<PositiveNumber> } =
      Object.getPrototypeOf(Object.getPrototypeOf(TelemetryExceptionService));
    const counted: Array<Record<string, unknown>> = [];
    jest.spyOn(parent, "countBy").mockImplementation((async (countBy: {
      query: Record<string, unknown>;
    }) => {
      counted.push(countBy.query);
      return new PositiveNumber(0);
    }) as never);

    await TelemetryExceptionService.countBy({
      query: { projectId, isResolved: false },
      props: ROOT,
    });

    expect(counted).toHaveLength(1);
    expect(isNullOperator(counted[0]!["mergedIntoTelemetryExceptionId"])).toBe(
      true,
    );
  });

  test("the Exceptions overview's per-service counts leave them out too", () => {
    const source: string = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "Server",
        "Services",
        "TelemetryExceptionService.ts",
      ),
      "utf8",
    );

    expect(source).toContain(
      '.andWhere(`"TelemetryException"."mergedIntoTelemetryExceptionId" IS NULL`)',
    );
  });
});

describe("the exception monitor's resolved and archived fingerprints", () => {
  function model(
    id: string,
    fingerprint: string,
    mergedIntoId?: string,
  ): TelemetryException {
    const row: TelemetryException = new TelemetryException();
    row._id = id;
    row.fingerprint = fingerprint;
    row.lastSeenAt = new Date("2026-10-30T10:00:00.000Z");
    if (mergedIntoId) {
      row.mergedIntoTelemetryExceptionId = new ObjectID(mergedIntoId);
    }
    return row;
  }

  const A: string = "30000000-0000-4000-8000-00000000000a";
  const B: string = "30000000-0000-4000-8000-00000000000b";

  test("count a merged exception's fingerprint with the resolved one it was merged into", async () => {
    const queries: Array<Record<string, unknown>> = [];

    jest
      .spyOn(TelemetryExceptionService, "findBy")
      .mockImplementation((async (args: { query: Record<string, unknown> }) => {
        queries.push(args.query);
        if ("mergedIntoTelemetryExceptionId" in args.query) {
          return [model(B, "fp-b", A)];
        }
        return args.query["isResolved"] ? [model(A, "fp-a")] : [];
      }) as never);

    const fingerprints: Array<string> =
      await TelemetryExceptionService.getResolvedOrArchivedFingerprints({
        projectId,
        resolved: true,
        archived: false,
      });

    expect(fingerprints).toEqual(["fp-a", "fp-b"]);
    // The members of exactly the resolved ones are read.
    expect(queries[queries.length - 1]!["projectId"]).toBe(projectId);
  });

  test("no resolved or archived exception: no members are read", async () => {
    const queries: Array<Record<string, unknown>> = [];

    jest
      .spyOn(TelemetryExceptionService, "findBy")
      .mockImplementation((async (args: { query: Record<string, unknown> }) => {
        queries.push(args.query);
        return [];
      }) as never);

    expect(
      await TelemetryExceptionService.getResolvedOrArchivedFingerprints({
        projectId,
        resolved: true,
        archived: true,
      }),
    ).toEqual([]);
    expect(
      queries.some((query: Record<string, unknown>): boolean => {
        return "mergedIntoTelemetryExceptionId" in query;
      }),
    ).toBe(false);
  });
});
