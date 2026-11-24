import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import TelemetryException from "../../../../Models/DatabaseModels/TelemetryException";
import TelemetryExceptionMerge, {
  ExceptionMergeOutcome,
  ExceptionMergeResult,
} from "../../../../Server/Utils/Telemetry/TelemetryExceptionMerge";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../Types/ObjectID";

/*
 * ---------------------------------------------------------------------------
 * MERGING A PAIR A SCRUB RULE SPLIT, WITHOUT ONEUPTIME AI (#10618).
 *
 * The split exception's page offers Merge for the exception it was split
 * from. TelemetryExceptionMerge.mergeSplit keeps the older of the two and
 * merges the other into it through merge, so both need permission to edit
 * exceptions (readEditable, faked here as the caller's edit permission) and
 * nothing is merged that a person did not ask for.
 * ---------------------------------------------------------------------------
 */

const SPLIT_ID: string = "30000000-0000-4000-8000-0000000a0618";
const SPLIT_FROM_ID: string = "30000000-0000-4000-8000-0000000b0618";
const SURVIVOR_ID: string = "30000000-0000-4000-8000-0000000c0618";
const PROPS: DatabaseCommonInteractionProps = {
  userId: ObjectID.generate(),
  tenantId: ObjectID.generate(),
};

interface Row {
  id: string;
  firstSeenAt?: Date | undefined;
  splitFrom?: string | undefined;
  mergedInto?: string | undefined;
}

// What the caller may edit, by id.
let editable: Map<string, Row>;
let merged: Array<Parameters<typeof TelemetryExceptionMerge.merge>[0]>;

function model(row: Row): TelemetryException {
  const exception: TelemetryException = new TelemetryException(
    new ObjectID(row.id),
  );

  if (row.firstSeenAt) {
    exception.firstSeenAt = row.firstSeenAt;
  }
  if (row.splitFrom) {
    exception.splitFromTelemetryExceptionId = new ObjectID(row.splitFrom);
  }
  if (row.mergedInto) {
    exception.mergedIntoTelemetryExceptionId = new ObjectID(row.mergedInto);
  }

  return exception;
}

function mergeSplit(): Promise<ExceptionMergeResult> {
  return TelemetryExceptionMerge.mergeSplit({
    telemetryExceptionId: new ObjectID(SPLIT_ID),
    props: PROPS,
  });
}

beforeEach(() => {
  editable = new Map<string, Row>();
  merged = [];

  jest
    .spyOn(TelemetryExceptionMerge, "readEditable")
    .mockImplementation((async (data: { ids: Array<ObjectID> }) => {
      return data.ids
        .map((id: ObjectID): Row | undefined => {
          return editable.get(id.toString());
        })
        .filter((row: Row | undefined): row is Row => {
          return Boolean(row);
        })
        .map(model);
    }) as never);

  jest.spyOn(TelemetryExceptionMerge, "merge").mockImplementation((async (
    data: Parameters<typeof TelemetryExceptionMerge.merge>[0],
  ) => {
    merged.push(data);
    return {
      telemetryExceptionId: data.telemetryExceptionId.toString(),
      merged: data.mergedTelemetryExceptionIds.map((id: ObjectID) => {
        return {
          telemetryExceptionId: id.toString(),
          outcome: ExceptionMergeOutcome.Merged,
        };
      }),
    };
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function survivorAndMerged(): [string, Array<string>] {
  expect(merged).toHaveLength(1);
  return [
    merged[0]!.telemetryExceptionId.toString(),
    merged[0]!.mergedTelemetryExceptionIds.map((id: ObjectID): string => {
      return id.toString();
    }),
  ];
}

describe("merging an exception a scrub rule split with the one it was split from", () => {
  test("the older one survives: nearly always the one it was split from", async () => {
    editable.set(SPLIT_ID, {
      id: SPLIT_ID,
      firstSeenAt: new Date("2026-10-02T00:00:00Z"),
      splitFrom: SPLIT_FROM_ID,
    });
    editable.set(SPLIT_FROM_ID, {
      id: SPLIT_FROM_ID,
      firstSeenAt: new Date("2026-01-01T00:00:00Z"),
    });

    await mergeSplit();

    expect(survivorAndMerged()).toEqual([SPLIT_FROM_ID, [SPLIT_ID]]);
    // As the caller, so the merge checks their edit on both.
    expect(merged[0]!.props).toBe(PROPS);
  });

  test("the split one, when it was first seen before the other", async () => {
    editable.set(SPLIT_ID, {
      id: SPLIT_ID,
      firstSeenAt: new Date("2026-01-01T00:00:00Z"),
      splitFrom: SPLIT_FROM_ID,
    });
    editable.set(SPLIT_FROM_ID, {
      id: SPLIT_FROM_ID,
      firstSeenAt: new Date("2026-03-01T00:00:00Z"),
    });

    await mergeSplit();

    expect(survivorAndMerged()).toEqual([SPLIT_ID, [SPLIT_FROM_ID]]);
  });

  test("first seen at once, or not known: the one it was split from", async () => {
    const at: Date = new Date("2026-01-01T00:00:00Z");
    editable.set(SPLIT_ID, {
      id: SPLIT_ID,
      firstSeenAt: at,
      splitFrom: SPLIT_FROM_ID,
    });
    editable.set(SPLIT_FROM_ID, { id: SPLIT_FROM_ID, firstSeenAt: at });
    await mergeSplit();

    editable.set(SPLIT_FROM_ID, { id: SPLIT_FROM_ID });
    await mergeSplit();

    expect(
      merged.map(
        (data: Parameters<typeof TelemetryExceptionMerge.merge>[0]) => {
          return data.telemetryExceptionId.toString();
        },
      ),
    ).toEqual([SPLIT_FROM_ID, SPLIT_FROM_ID]);
  });

  test("the one it was split from, merged into another since: that one stands for it", async () => {
    editable.set(SPLIT_ID, {
      id: SPLIT_ID,
      firstSeenAt: new Date("2026-10-02T00:00:00Z"),
      splitFrom: SPLIT_FROM_ID,
    });
    editable.set(SPLIT_FROM_ID, {
      id: SPLIT_FROM_ID,
      firstSeenAt: new Date("2026-01-01T00:00:00Z"),
      mergedInto: SURVIVOR_ID,
    });
    editable.set(SURVIVOR_ID, {
      id: SURVIVOR_ID,
      firstSeenAt: new Date("2025-12-01T00:00:00Z"),
    });

    await mergeSplit();

    expect(survivorAndMerged()).toEqual([SURVIVOR_ID, [SPLIT_ID]]);
  });

  test("merged already, either way: nothing is merged again", async () => {
    editable.set(SPLIT_ID, {
      id: SPLIT_ID,
      splitFrom: SPLIT_FROM_ID,
      mergedInto: SPLIT_FROM_ID,
    });
    editable.set(SPLIT_FROM_ID, { id: SPLIT_FROM_ID });

    expect((await mergeSplit()).merged).toEqual([
      {
        telemetryExceptionId: SPLIT_ID,
        outcome: ExceptionMergeOutcome.AlreadyMerged,
      },
    ]);

    editable.set(SPLIT_ID, { id: SPLIT_ID, splitFrom: SPLIT_FROM_ID });
    editable.set(SPLIT_FROM_ID, { id: SPLIT_FROM_ID, mergedInto: SPLIT_ID });

    expect(await mergeSplit()).toEqual({
      telemetryExceptionId: SPLIT_ID,
      merged: [
        {
          telemetryExceptionId: SPLIT_FROM_ID,
          outcome: ExceptionMergeOutcome.AlreadyMerged,
        },
      ],
    });
    expect(merged).toEqual([]);
  });

  test("a caller who may not edit the split exception is refused, and nothing is merged", async () => {
    editable.set(SPLIT_FROM_ID, { id: SPLIT_FROM_ID });

    await expect(mergeSplit()).rejects.toBeInstanceOf(NotAuthorizedException);
    expect(merged).toEqual([]);
  });

  test("nor one who may not edit the one it was split from", async () => {
    editable.set(SPLIT_ID, { id: SPLIT_ID, splitFrom: SPLIT_FROM_ID });

    await expect(mergeSplit()).rejects.toBeInstanceOf(NotAuthorizedException);
    expect(merged).toEqual([]);
  });

  test("an exception no rule split has nothing to merge", async () => {
    editable.set(SPLIT_ID, { id: SPLIT_ID });

    await expect(mergeSplit()).rejects.toBeInstanceOf(BadDataException);
    expect(merged).toEqual([]);
  });
});
