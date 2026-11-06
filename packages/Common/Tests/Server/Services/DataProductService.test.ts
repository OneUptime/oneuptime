import DataProductService from "../../../Server/Services/DataProductService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import logger from "../../../Server/Utils/Logger";
import DataProduct from "../../../Models/DatabaseModels/DataProduct";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
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
 * A DATA PRODUCT'S SLA IS CHECKED ON EVERY PRODUCT AN UPDATE WRITES.
 *
 * A change of a product's SLA - its time of day, its maximum age, its
 * target - is checked against what each product it writes will hold. The
 * update hook read the products by the update's own query, as root, the
 * first ten of them: an eleventh was written unchecked, and a product past
 * the update's window - one it would never write - was judged and could
 * refuse the change. It reads the rows the update writes now, every one,
 * with findRowsAndHoldUpdateToThem (UpdateChecksReadHeldRows).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const NO_SLA: string =
  "A data product needs a freshness SLA: a time of day its data lands by, a maximum age, or both.";

// Twelve products fresh by 06:00, one of them fresh by its maximum age alone.
const IDS: Array<string> = Array.from(
  { length: 12 },
  (_value: unknown, index: number): string => {
    return `33333333-3333-4333-8333-${String(index + 1).padStart(12, "0")}`;
  },
);

// The SLA of a product fresh by its maximum age alone.
const MAX_AGE_ONLY: StoredRow = {
  freshByTimeOfDay: null,
  maxDataAgeInMinutes: 60,
};

function productRow(id: string, more: StoredRow = {}): StoredRow {
  return {
    _id: id,
    projectId: PROJECT_ID.toString(),
    name: `Product ${id}`,
    freshByTimeOfDay: "06:00",
    maxDataAgeInMinutes: null,
    slaTargetPercentage: 99,
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
    updateBy: UpdateBy<DataProduct>,
  ): Promise<OnUpdate<DataProduct>>;
}

let table: InMemoryTable;

// The project's products, the one at `maxAgeOnlyAt` fresh by its maximum age alone.
function useProducts(maxAgeOnlyAt: number): void {
  table = useInMemoryTable(
    DataProductService,
    IDS.map((id: string, index: number): StoredRow => {
      return productRow(id, index === maxAgeOnlyAt ? MAX_AGE_ONLY : {});
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

describe("an update of many data products", () => {
  test("checks every product it writes: one it leaves without an SLA refuses them all, past the tenth too", async () => {
    useProducts(IDS.length - 1);

    const error: unknown = await refusalOf(
      DataProductService.updateBy({
        query: { projectId: PROJECT_ID },
        data: { maxDataAgeInMinutes: null } as never,
        limit: 50,
        skip: 0,
        props: EDITOR,
      }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toBe(NO_SLA);
    expect(table.get(IDS[IDS.length - 1]!)?.["maxDataAgeInMinutes"]).toBe(60);
  });

  test("checks only the products it writes: one past its window refuses nothing, and is left as it is", async () => {
    useProducts(2);

    await DataProductService.updateBy({
      query: { projectId: PROJECT_ID },
      data: { maxDataAgeInMinutes: null } as never,
      limit: 2,
      skip: 0,
      props: EDITOR,
    });

    expect(table.get(IDS[0]!)?.["maxDataAgeInMinutes"]).toBeNull();
    expect(table.get(IDS[1]!)?.["maxDataAgeInMinutes"]).toBeNull();
    expect(table.get(IDS[2]!)?.["maxDataAgeInMinutes"]).toBe(60);
  });

  test("writes all of them when each keeps an SLA", async () => {
    useProducts(IDS.length - 1);

    await DataProductService.updateBy({
      query: { projectId: PROJECT_ID },
      data: { slaTargetPercentage: 95 } as never,
      limit: 50,
      skip: 0,
      props: EDITOR,
    });

    for (const id of IDS) {
      expect(Number(table.get(id)?.["slaTargetPercentage"])).toBe(95);
    }
  });

  test("a change that is no change of the SLA reads no product", async () => {
    useProducts(IDS.length - 1);

    const held: SpyInstance<
      typeof DataProductService.findRowsAndHoldUpdateToThem
    > = jest.spyOn(DataProductService, "findRowsAndHoldUpdateToThem");

    await DataProductService.updateOneById({
      id: new ObjectID(IDS[1]!),
      data: { description: "The finance team's dashboards" } as never,
      props: EDITOR,
    });

    expect(table.get(IDS[1]!)?.["description"]).toBe(
      "The finance team's dashboards",
    );
    expect(held).not.toHaveBeenCalled();
  });

  test("the hook reads the products it checks as the rows the update writes, once", async () => {
    useProducts(IDS.length - 1);

    const hooks: UpdateHooks = DataProductService as unknown as UpdateHooks;
    const held: SpyInstance<
      typeof DataProductService.findRowsAndHoldUpdateToThem
    > = jest.spyOn(DataProductService, "findRowsAndHoldUpdateToThem");
    const updateBy: UpdateBy<DataProduct> = {
      query: { _id: IDS[1]! },
      data: { freshByTimeOfDay: "7:30" },
      props: { isRoot: true },
      limit: 1,
      skip: 0,
    } as unknown as UpdateBy<DataProduct>;

    await hooks.onBeforeUpdate(updateBy);

    // The update itself, so it is held to the products checked.
    expect(held).toHaveBeenCalledTimes(1);
    expect(held.mock.calls[0]![0]).toBe(updateBy);
    // A time is kept as HH:MM.
    expect(
      (updateBy.data as unknown as Record<string, unknown>)["freshByTimeOfDay"],
    ).toBe("07:30");
  });
});
