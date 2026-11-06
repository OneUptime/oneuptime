import DataReconciliationService from "../../../Server/Services/DataReconciliationService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import logger from "../../../Server/Utils/Logger";
import DataReconciliation from "../../../Models/DatabaseModels/DataReconciliation";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  DataReconciliationMeasure,
  DataReconciliationToleranceType,
} from "../../../Types/DataObservability/DataReconciliation";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { customDomainCaller } from "../API/CustomDomainCallers";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * A RECONCILIATION IS CHECKED ON EVERY ONE AN UPDATE WRITES.
 *
 * A change of what a reconciliation compares - a side's measure, its
 * column or query, the tolerance - is checked against what each
 * reconciliation it writes will hold. The update hook read them by the
 * update's own query, as root, the first ten of them: an eleventh was
 * written unchecked, and one past the update's window - one it would never
 * write - was judged and could refuse the change. It reads the rows the
 * update writes now, every one, with findRowsAndHoldUpdateToThem
 * (UpdateChecksReadHeldRows).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const SUM_NEEDS_A_COLUMN: string = "The source's Sum needs a column.";

// Twelve reconciliations of row counts, one of them of a column's sum.
const IDS: Array<string> = Array.from(
  { length: 12 },
  (_value: unknown, index: number): string => {
    return `33333333-3333-4333-8333-${String(index + 1).padStart(12, "0")}`;
  },
);

// A source that sums a column: it needs the column.
const SUM_OF_TOTAL: StoredRow = {
  sourceMeasure: DataReconciliationMeasure.Sum,
  sourceColumnName: "total",
};

function reconciliationRow(id: string, more: StoredRow = {}): StoredRow {
  return {
    _id: id,
    projectId: PROJECT_ID.toString(),
    name: `Reconciliation ${id}`,
    intervalInMinutes: 60,
    toleranceType: DataReconciliationToleranceType.Absolute,
    tolerance: 0,
    sourceMeasure: DataReconciliationMeasure.RowCount,
    sourceColumnName: null,
    targetMeasure: DataReconciliationMeasure.RowCount,
    targetColumnName: null,
    version: 1,
    ...more,
  };
}

function member(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions: permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

const EDITOR: DatabaseCommonInteractionProps = member([
  Permission.EditDataAsset,
  Permission.ReadDataAsset,
]);

async function refusalOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("Expected the write to be refused, but it went through.");
}

// The update's hook, reached through a cast as every service suite does.
interface UpdateHooks {
  onBeforeUpdate(
    updateBy: UpdateBy<DataReconciliation>,
  ): Promise<OnUpdate<DataReconciliation>>;
}

let table: InMemoryTable;

// The project's reconciliations, the one at `sumAt` of a column's sum.
function useReconciliations(sumAt: number): void {
  table = useInMemoryTable(
    DataReconciliationService,
    IDS.map((id: string, index: number): StoredRow => {
      return reconciliationRow(id, index === sumAt ? SUM_OF_TOTAL : {});
    }),
  );
}

beforeEach(() => {
  for (const silenced of ["debug", "info", "warn", "error"]) {
    getJestSpyOn(logger, silenced).mockImplementation((): void => {
      return undefined;
    });
  }

  stubProjectDirectory({});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an update of many reconciliations", () => {
  test("checks every one it writes: one it leaves unable to compare refuses them all, past the tenth too", async () => {
    useReconciliations(IDS.length - 1);

    const error: unknown = await refusalOf(
      DataReconciliationService.updateBy({
        query: { projectId: PROJECT_ID },
        data: { sourceColumnName: null } as never,
        limit: 50,
        skip: 0,
        props: EDITOR,
      }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toBe(SUM_NEEDS_A_COLUMN);
    expect(table.get(IDS[IDS.length - 1]!)?.["sourceColumnName"]).toBe("total");
  });

  test("checks only the ones it writes: one past its window refuses nothing, and is left as it is", async () => {
    useReconciliations(2);

    await DataReconciliationService.updateBy({
      query: { projectId: PROJECT_ID },
      data: { sourceColumnName: null } as never,
      limit: 2,
      skip: 0,
      props: EDITOR,
    });

    expect(table.get(IDS[0]!)?.["sourceColumnName"]).toBeNull();
    expect(table.get(IDS[1]!)?.["sourceColumnName"]).toBeNull();
    expect(table.get(IDS[2]!)?.["sourceColumnName"]).toBe("total");
  });

  test("writes all of them when each can compare", async () => {
    useReconciliations(IDS.length - 1);

    await DataReconciliationService.updateBy({
      query: { projectId: PROJECT_ID },
      data: { tolerance: 5 } as never,
      limit: 50,
      skip: 0,
      props: EDITOR,
    });

    for (const id of IDS) {
      expect(Number(table.get(id)?.["tolerance"])).toBe(5);
    }
  });

  test("a rename is no change of what it compares: no reconciliation is read", async () => {
    useReconciliations(IDS.length - 1);

    const held: SpyInstance<
      typeof DataReconciliationService.findRowsAndHoldUpdateToThem
    > = jest.spyOn(DataReconciliationService, "findRowsAndHoldUpdateToThem");

    await DataReconciliationService.updateOneById({
      id: new ObjectID(IDS[1]!),
      data: { name: "Orders against the warehouse" } as never,
      props: EDITOR,
    });

    expect(table.get(IDS[1]!)?.["name"]).toBe("Orders against the warehouse");
    expect(held).not.toHaveBeenCalled();
  });

  test("the hook reads the reconciliations it checks as the rows the update writes, once", async () => {
    useReconciliations(IDS.length - 1);

    const hooks: UpdateHooks =
      DataReconciliationService as unknown as UpdateHooks;
    const held: SpyInstance<
      typeof DataReconciliationService.findRowsAndHoldUpdateToThem
    > = jest.spyOn(DataReconciliationService, "findRowsAndHoldUpdateToThem");
    const updateBy: UpdateBy<DataReconciliation> = {
      query: { _id: IDS[1]! },
      data: { tolerance: 2 },
      props: { isRoot: true },
      limit: 1,
      skip: 0,
    } as unknown as UpdateBy<DataReconciliation>;

    await hooks.onBeforeUpdate(updateBy);

    // The update itself, so it is held to the reconciliations checked.
    expect(held).toHaveBeenCalledTimes(1);
    expect(held.mock.calls[0]![0]).toBe(updateBy);
  });
});
