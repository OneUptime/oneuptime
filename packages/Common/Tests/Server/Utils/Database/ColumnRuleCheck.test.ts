import { describe, expect, jest, test } from "@jest/globals";
import type { Mock } from "jest-mock";
import ColumnRuleCheck, {
  ColumnRule,
} from "../../../../Server/Utils/Database/ColumnRuleCheck";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";

/*
 * A RULE OVER A FEW COLUMNS OF A RECORD, HELD BY THE API AS THE FORM HOLDS IT.
 *
 * A create is judged as the record it makes; an update that writes one of
 * the rule's columns as each record it writes will be - what it writes over
 * the record as stored. A record stored before the rule held stays
 * editable: an update that leaves the rule's columns as they are saves.
 */

// A rule like the repeat rule: on with fewer than one time is refused.
const REFUSAL: string = "On needs a count of at least one.";

const RULE: ColumnRule = {
  columns: ["isOn", "count"],
  getRefusal: (values: Record<string, unknown>): string | null => {
    if (values["isOn"] !== true) {
      return null;
    }

    const count: number = Number(values["count"] ?? 0);

    return Number.isInteger(count) && count >= 1 ? null : REFUSAL;
  },
};

type FindRows = Mock<
  (...args: Array<unknown>) => Promise<Array<Record<string, unknown>>>
>;

interface UpdateRun {
  findRows: FindRows;
  updateBy: Record<string, unknown>;
  result: Promise<void>;
}

// An update against the records it names as they are stored.
function update(
  written: Record<string, unknown>,
  stored: Array<Record<string, unknown>>,
): UpdateRun {
  const findRows: FindRows = jest.fn<
    (...args: Array<unknown>) => Promise<Array<Record<string, unknown>>>
  >(async (): Promise<Array<Record<string, unknown>>> => {
    return stored;
  });

  const updateBy: Record<string, unknown> = {
    query: { _id: ObjectID.generate().toString() },
    data: written,
    props: { isRoot: true },
  };

  return {
    findRows,
    updateBy,
    result: ColumnRuleCheck.checkUpdate({
      service: {
        findRowsAndHoldUpdateToThem: findRows,
      } as unknown as DatabaseService<OnCallDutyPolicy>,
      updateBy: updateBy as never,
      rule: RULE,
    }),
  };
}

describe("a create", () => {
  test("is saved when its values keep the rule", () => {
    expect(() => {
      ColumnRuleCheck.checkCreate({ isOn: true, count: 2 }, RULE);
    }).not.toThrow();
    expect(() => {
      ColumnRuleCheck.checkCreate({ isOn: false, count: 0 }, RULE);
    }).not.toThrow();
  });

  test("is refused, in the rule's own words, when its values break it", () => {
    expect(() => {
      ColumnRuleCheck.checkCreate({ isOn: true, count: 0 }, RULE);
    }).toThrow(new BadDataException(REFUSAL));
  });

  test("leaves a column it does not write to the rule, as the column's default", () => {
    // count is not written: the rule reads it as its default, 0.
    expect(() => {
      ColumnRuleCheck.checkCreate({ isOn: true }, RULE);
    }).toThrow(new BadDataException(REFUSAL));
    expect(() => {
      ColumnRuleCheck.checkCreate({ name: "Payments" }, RULE);
    }).not.toThrow();
  });

  test("reads a model as it reads plain values", () => {
    const model: OnCallDutyPolicy = new OnCallDutyPolicy();
    (model as unknown as Record<string, unknown>)["isOn"] = true;

    expect(() => {
      ColumnRuleCheck.checkCreate(model, RULE);
    }).toThrow(new BadDataException(REFUSAL));
  });

  test("hands the rule only its own columns", () => {
    const seen: Array<Record<string, unknown>> = [];

    ColumnRuleCheck.checkCreate(
      { isOn: true, count: 3, name: "Payments", other: undefined },
      {
        columns: RULE.columns,
        getRefusal: (values: Record<string, unknown>): string | null => {
          seen.push(values);
          return null;
        },
      },
    );

    expect(seen).toEqual([{ isOn: true, count: 3 }]);
  });

  test("a refusal is a bad request, so the API answers 400 with it", () => {
    let thrown: unknown = null;

    try {
      ColumnRuleCheck.checkCreate({ isOn: true, count: -1 }, RULE);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(BadDataException);
    expect((thrown as BadDataException).message).toBe(REFUSAL);
  });
});

describe("an update", () => {
  test("that writes none of the rule's columns is not judged, and reads nothing", async () => {
    const run: UpdateRun = update({ name: "Payments" }, [
      { isOn: true, count: 0 },
    ]);

    await expect(run.result).resolves.toBeUndefined();
    expect(run.findRows).not.toHaveBeenCalled();
  });

  test("reads the records it writes, with the rule's columns, through the update's own hold", async () => {
    const run: UpdateRun = update({ count: 3 }, [{ isOn: true, count: 1 }]);

    await expect(run.result).resolves.toBeUndefined();
    expect(run.findRows).toHaveBeenCalledTimes(1);
    expect(run.findRows.mock.calls[0]![0]).toBe(run.updateBy);
    expect(run.findRows.mock.calls[0]![1]).toEqual({
      isOn: true,
      count: true,
    });
  });

  test("is judged as each record will be: what it writes over what is stored", async () => {
    // Turning the switch on over a stored count of 0 says on, 0 times.
    await expect(
      update({ isOn: true }, [{ isOn: false, count: 0 }]).result,
    ).rejects.toThrow(new BadDataException(REFUSAL));

    // The same over a stored count of 2 is on, twice.
    await expect(
      update({ isOn: true }, [{ isOn: false, count: 2 }]).result,
    ).resolves.toBeUndefined();

    // Setting the count to 0 under a switch that is on.
    await expect(
      update({ count: 0 }, [{ isOn: true, count: 3 }]).result,
    ).rejects.toThrow(new BadDataException(REFUSAL));

    // Setting it to 0 under a switch that is off: it means nothing then.
    await expect(
      update({ count: 0 }, [{ isOn: false, count: 3 }]).result,
    ).resolves.toBeUndefined();
  });

  test("of several records is refused when any one of them would break the rule", async () => {
    await expect(
      update({ isOn: true }, [
        { isOn: false, count: 2 },
        { isOn: false, count: 0 },
      ]).result,
    ).rejects.toThrow(new BadDataException(REFUSAL));
  });

  test("of no records - none it may write, or none matched - is saved", async () => {
    await expect(
      update({ isOn: true, count: 0 }, []).result,
    ).resolves.toBeUndefined();
  });

  describe("of a record stored before the rule held", () => {
    const BROKEN: Record<string, unknown> = { isOn: true, count: 0 };

    test("saves when it leaves the rule's columns as stored - Terraform sending back what it read", async () => {
      await expect(
        update({ isOn: true, count: 0, name: "Renamed" }, [BROKEN]).result,
      ).resolves.toBeUndefined();
      await expect(
        update({ isOn: true }, [BROKEN]).result,
      ).resolves.toBeUndefined();
    });

    test("saves when it writes the count as the text of the stored number", async () => {
      await expect(
        update({ count: "0" }, [BROKEN]).result,
      ).resolves.toBeUndefined();
    });

    test("is refused when it changes them into another pair that breaks the rule", async () => {
      await expect(update({ count: -2 }, [BROKEN]).result).rejects.toThrow(
        new BadDataException(REFUSAL),
      );
    });

    test("saves when it mends it", async () => {
      await expect(
        update({ count: 2 }, [BROKEN]).result,
      ).resolves.toBeUndefined();
      await expect(
        update({ isOn: false }, [BROKEN]).result,
      ).resolves.toBeUndefined();
    });
  });

  test("treats a column written as null as written: it does not fall back to what is stored", async () => {
    await expect(
      update({ count: null }, [{ isOn: true, count: 3 }]).result,
    ).rejects.toThrow(new BadDataException(REFUSAL));
  });
});

describe("the columns a write writes", () => {
  test("are the rule's columns present in it, null included", () => {
    expect(
      ColumnRuleCheck.getWrittenColumns(
        { isOn: null, name: "x", count: undefined },
        RULE,
      ),
    ).toEqual(["isOn"]);
    expect(ColumnRuleCheck.getWrittenColumns(undefined, RULE)).toEqual([]);
  });
});
