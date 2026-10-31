import Entities from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import User from "../../../Models/DatabaseModels/User";
import Columns from "../../../Types/Database/Columns";
import Dictionary from "../../../Types/Dictionary";
import {
  TableColumnMetadata,
  TableColumnNames,
  getTableColumnNames,
  getTableColumns,
} from "../../../Types/Database/TableColumn";
import {
  ComparedRuns,
  FastestRun,
  fastestRunsCompared,
} from "../../Helpers/FastestRun";
import { describe, expect, test } from "@jest/globals";

/*
 * A model's column lists - all of them, the encrypted, hashed, unique and
 * required ones - are made once per class (getTableColumnNames). Every row
 * a read returns asks for its encrypted columns, and every read for its
 * column list, and each of those used to copy the class's whole column
 * dictionary and walk it.
 *
 * Held here, for every database model OneUptime has:
 *
 *  - each list, and each DatabaseBaseModel method that hands one out, is
 *    exactly what the code before made: master's methods, copied below,
 *    over getTableColumns;
 *  - each call hands out a list of its own, which its caller may change
 *    without changing the next one;
 *  - getTableColumns still hands out a copy of the dictionary;
 *  - an instance with no canonical instance of its class to read (a class
 *    that needs constructor arguments) is answered from itself, and never
 *    cached for the class;
 *  - a monitor's encrypted columns are many times faster to ask for.
 */

// master's DatabaseBaseModel methods, verbatim but for their names.
function masterHashedColumns(model: BaseModel): Columns {
  const dictionary: Dictionary<TableColumnMetadata> = getTableColumns(model);
  const columns: Array<string> = [];
  for (const key in dictionary) {
    if (dictionary[key]?.hashed) {
      columns.push(key);
    }
  }

  return new Columns(columns);
}

function masterEncryptedColumns(model: BaseModel): Columns {
  const dictionary: Dictionary<TableColumnMetadata> = getTableColumns(model);
  const columns: Array<string> = [];
  for (const key in dictionary) {
    if (dictionary[key]?.encrypted) {
      columns.push(key);
    }
  }

  return new Columns(columns);
}

function masterTableColumns(model: BaseModel): Columns {
  return new Columns(Object.keys(getTableColumns(model)));
}

function masterUniqueColumns(model: BaseModel): Columns {
  const dictionary: Dictionary<TableColumnMetadata> = getTableColumns(model);
  const columns: Array<string> = [];
  for (const key in dictionary) {
    if (dictionary[key]?.unique) {
      columns.push(key);
    }
  }

  return new Columns(columns);
}

function masterRequiredColumns(model: BaseModel): Columns {
  const dictionary: Dictionary<TableColumnMetadata> = getTableColumns(model);
  const columns: Array<string> = [];
  for (const key in dictionary) {
    if (dictionary[key]?.required) {
      columns.push(key);
    }
  }

  return new Columns(columns);
}

type ModelType = { new (): BaseModel; name: string };

const modelTypes: Array<ModelType> = Entities as unknown as Array<ModelType>;

describe("getTableColumnNames", () => {
  test("there are hundreds of models to hold", () => {
    expect(modelTypes.length).toBeGreaterThan(400);
  });

  test("every model's lists are exactly what master's methods made", () => {
    const differing: Array<string> = [];

    for (const modelType of modelTypes) {
      const model: BaseModel = new modelType();
      const expected: Record<string, Array<string>> = {
        all: masterTableColumns(model).columns,
        encrypted: masterEncryptedColumns(model).columns,
        hashed: masterHashedColumns(model).columns,
        unique: masterUniqueColumns(model).columns,
        required: masterRequiredColumns(model).columns,
      };
      const fromMethods: Record<string, Array<string>> = {
        all: model.getTableColumns().columns,
        encrypted: model.getEncryptedColumns().columns,
        hashed: model.getHashedColumns().columns,
        unique: model.getUniqueColumns().columns,
        required: model.getRequiredColumns().columns,
      };
      const names: TableColumnNames = getTableColumnNames(model);
      const fromNames: Record<string, Array<string>> = {
        all: [...names.all],
        encrypted: [...names.encrypted],
        hashed: [...names.hashed],
        unique: [...names.unique],
        required: [...names.required],
      };

      if (
        JSON.stringify(fromMethods) !== JSON.stringify(expected) ||
        JSON.stringify(fromNames) !== JSON.stringify(expected)
      ) {
        differing.push(modelType.name);
      }
    }

    expect(differing).toEqual([]);
  });

  test("the lists hold what the models declare", () => {
    const monitor: Monitor = new Monitor();

    expect(monitor.getTableColumns().columns).toEqual(
      expect.arrayContaining(["_id", "name", "projectId", "monitorSteps"]),
    );
    expect(monitor.getTableColumns().columns.length).toBeGreaterThan(50);

    const user: User = new User();

    expect(user.getHashedColumns().columns).toEqual(
      expect.arrayContaining(["password"]),
    );
    expect(user.getUniqueColumns().columns).toEqual(
      expect.arrayContaining(["email"]),
    );
  });

  test("each call hands out a list of its own", () => {
    const monitor: Monitor = new Monitor();
    const first: Columns = monitor.getTableColumns();
    const length: number = first.columns.length;

    first.addColumn("notAColumn");
    first.columns.splice(0, 5);

    const second: Columns = monitor.getTableColumns();

    expect(second.columns.length).toBe(length);
    expect(second.columns).not.toContain("notAColumn");
    expect(second.columns).not.toBe(first.columns);

    for (const read of [
      (): Columns => {
        return monitor.getEncryptedColumns();
      },
      (): Columns => {
        return monitor.getHashedColumns();
      },
      (): Columns => {
        return monitor.getUniqueColumns();
      },
      (): Columns => {
        return monitor.getRequiredColumns();
      },
    ]) {
      const once: Columns = read();
      const count: number = once.columns.length;

      once.addColumn("notAColumn");
      expect(read().columns.length).toBe(count);
      expect(read().columns).not.toBe(once.columns);
    }
  });

  test("getTableColumns still hands out a copy of the dictionary", () => {
    const monitor: Monitor = new Monitor();
    const dictionary: Dictionary<TableColumnMetadata> =
      getTableColumns(monitor);

    delete dictionary["name"];

    expect(getTableColumns(monitor)["name"]).toBeDefined();
    expect(getTableColumnNames(monitor).all).toContain("name");
    expect(monitor.getTableColumns().columns).toContain("name");
  });

  test("the lists of one class are made once, and shared by its instances", () => {
    expect(getTableColumnNames(new Monitor())).toBe(
      getTableColumnNames(new Monitor()),
    );
    expect(getTableColumnNames(new Monitor())).not.toBe(
      getTableColumnNames(new User()),
    );
  });

  test("an instance with no canonical instance of its class is answered from itself, and never cached", () => {
    /*
     * A class whose constructor needs an argument has no canonical
     * instance (CanonicalModelInstance): its columns are read off the
     * instance asked, every time.
     */
    class NeedsArgument extends Monitor {
      public constructor(required: string) {
        super();

        if (!required) {
          throw new Error("needs an argument");
        }
      }
    }

    const whole: NeedsArgument = new NeedsArgument("x");
    const withoutName: NeedsArgument = new NeedsArgument("x");

    delete (withoutName as unknown as Record<string, unknown>)["name"];

    expect(getTableColumnNames(whole).all).toContain("name");
    expect(getTableColumnNames(withoutName).all).not.toContain("name");
    expect(getTableColumnNames(whole).all).toContain("name");
    expect(getTableColumnNames(whole)).not.toBe(getTableColumnNames(whole));
    expect(withoutName.getTableColumns().columns).toEqual(
      masterTableColumns(withoutName).columns,
    );
  });

  test("a monitor's encrypted columns are many times faster to ask for", () => {
    const monitor: Monitor = new Monitor();
    const calls: number = 20000;

    /*
     * Timed in turns (fastestRunsCompared): the kept columns' attempts are
     * short, and one stall could cover them all.
     */
    const runs: ComparedRuns<number, number> = fastestRunsCompared({
      first: (): number => {
        let found: number = 0;

        for (let index: number = 0; index < calls; index++) {
          found += masterEncryptedColumns(monitor).columns.length;
        }

        return found;
      },
      second: (): number => {
        let found: number = 0;

        for (let index: number = 0; index < calls; index++) {
          found += monitor.getEncryptedColumns().columns.length;
        }

        return found;
      },
    });
    const before: FastestRun<number> = runs.first;
    const after: FastestRun<number> = runs.second;

    expect(after.result).toBe(before.result);
    // Measured about 50 times faster; five leaves room for a busy runner.
    expect(after.inMs * 5).toBeLessThan(before.inMs);
  });
});
