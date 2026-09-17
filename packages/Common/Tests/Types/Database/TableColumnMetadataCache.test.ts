import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Project from "../../../Models/DatabaseModels/Project";
import {
  TableColumnMetadata,
  getTableColumn,
  getTableColumns,
} from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import Dictionary from "../../../Types/Dictionary";
import "reflect-metadata";

type ModelCtor = new () => DatabaseBaseModel;

const MODELS: Array<[string, ModelCtor]> = [
  ["Monitor", Monitor],
  ["Incident", Incident],
  ["Project", Project],
];

/*
 * Locate the module-private metadata symbol (e.g. Symbol(TableColumn)) by
 * scanning the metadata keys of every instance property, so the tests can
 * rebuild the dictionary from scratch exactly the way the pre-cache
 * implementation did — without importing any private state.
 */
function findMetadataSymbol(
  model: DatabaseBaseModel,
  symbolName: string,
): symbol | null {
  for (const key of Object.keys(model)) {
    const metadataKeys: Array<unknown> = Reflect.getMetadataKeys(
      model,
      key,
    ) as Array<unknown>;
    for (const metadataKey of metadataKeys) {
      if (
        typeof metadataKey === "symbol" &&
        metadataKey.toString() === `Symbol(${symbolName})`
      ) {
        return metadataKey;
      }
    }
  }
  return null;
}

// The exact algorithm getTableColumns() used before caching was introduced.
function rebuildFromReflect<T>(
  model: DatabaseBaseModel,
  symbolName: string,
): Dictionary<T> {
  const metadataSymbol: symbol | null = findMetadataSymbol(model, symbolName);
  const dictionary: Dictionary<T> = {};

  if (!metadataSymbol) {
    return dictionary;
  }

  for (const key of Object.keys(model)) {
    const metadata: T | undefined = Reflect.getMetadata(
      metadataSymbol,
      model,
      key,
    ) as T | undefined;
    if (metadata) {
      dictionary[key] = metadata;
    }
  }

  return dictionary;
}

function rebuildTableColumns(
  model: DatabaseBaseModel,
): Dictionary<TableColumnMetadata> {
  return rebuildFromReflect<TableColumnMetadata>(model, "TableColumn");
}

describe("getTableColumns caching", () => {
  for (const [name, ModelClass] of MODELS) {
    test(`matches a from-scratch Reflect rebuild for ${name} — keys, order, and value identity`, () => {
      const model: DatabaseBaseModel = new ModelClass();
      const expected: Dictionary<TableColumnMetadata> =
        rebuildTableColumns(model);
      const actual: Dictionary<TableColumnMetadata> = getTableColumns(model);

      // Sanity: real models have plenty of decorated columns.
      expect(Object.keys(expected).length).toBeGreaterThan(5);

      // Same keys in the same insertion order.
      expect(Object.keys(actual)).toEqual(Object.keys(expected));

      // Values are the exact same Reflect metadata singletons as before.
      for (const key of Object.keys(expected)) {
        expect(actual[key]).toBe(expected[key]);
      }
    });
  }

  test("second call for the same class performs zero Reflect metadata reads", () => {
    const monitor: Monitor = new Monitor();
    const expected: Dictionary<TableColumnMetadata> =
      rebuildTableColumns(monitor);

    getTableColumns(monitor); // warm the cache

    const spy: jest.SpyInstance = jest.spyOn(Reflect, "getMetadata");
    try {
      const result: Dictionary<TableColumnMetadata> = getTableColumns(monitor);
      expect(spy).not.toHaveBeenCalled();
      expect(Object.keys(result)).toEqual(Object.keys(expected));
    } finally {
      spy.mockRestore();
    }
  });

  test("cache is shared across different instances of the same class", () => {
    getTableColumns(new Monitor()); // warm the cache with one instance

    const spy: jest.SpyInstance = jest.spyOn(Reflect, "getMetadata");
    try {
      const result: Dictionary<TableColumnMetadata> = getTableColumns(
        new Monitor(),
      );
      expect(spy).not.toHaveBeenCalled();
      expect(result["name"]).toBeDefined();
    } finally {
      spy.mockRestore();
    }
  });

  test("different classes get distinct dictionaries", () => {
    const monitorColumns: Dictionary<TableColumnMetadata> = getTableColumns(
      new Monitor(),
    );
    const incidentColumns: Dictionary<TableColumnMetadata> = getTableColumns(
      new Incident(),
    );
    const projectColumns: Dictionary<TableColumnMetadata> = getTableColumns(
      new Project(),
    );

    expect(monitorColumns).not.toBe(incidentColumns);
    expect(monitorColumns).not.toBe(projectColumns);
    expect(incidentColumns).not.toBe(projectColumns);

    expect(Object.keys(monitorColumns)).not.toEqual(
      Object.keys(incidentColumns),
    );
    expect(monitorColumns["monitorType"]).toBeDefined();
    expect(incidentColumns["monitorType"]).toBeUndefined();
    expect(projectColumns["monitorType"]).toBeUndefined();
  });

  test("mutations by one caller never leak into later calls (API reference deletes entries)", () => {
    const expected: Dictionary<TableColumnMetadata> = rebuildTableColumns(
      new Monitor(),
    );

    const first: Dictionary<TableColumnMetadata> = getTableColumns(
      new Monitor(),
    );

    // The API reference docs page strips columns exactly like this.
    delete first["deletedAt"];
    delete first["version"];
    delete first["name"];
    first["monitorType"] = { type: TableColumnType.Phone };

    const second: Dictionary<TableColumnMetadata> = getTableColumns(
      new Monitor(),
    );

    expect(second).not.toBe(first);
    expect(Object.keys(second)).toEqual(Object.keys(expected));
    expect(second["deletedAt"]).toBe(expected["deletedAt"]);
    expect(second["version"]).toBe(expected["version"]);
    expect(second["name"]).toBe(expected["name"]);
    expect(second["monitorType"]).toBe(expected["monitorType"]);
    expect(second["monitorType"]!.type).not.toBe(TableColumnType.Phone);
  });

  test("Columns wrapper on the model still lists every decorated column", () => {
    for (const [, ModelClass] of MODELS) {
      const model: DatabaseBaseModel = new ModelClass();
      const expected: Dictionary<TableColumnMetadata> =
        rebuildTableColumns(model);
      expect(model.getTableColumns().columns).toEqual(Object.keys(expected));
    }
  });

  test("filter helpers derive from identical metadata after caching", () => {
    for (const [, ModelClass] of MODELS) {
      const model: DatabaseBaseModel = new ModelClass();
      const expected: Dictionary<TableColumnMetadata> =
        rebuildTableColumns(model);

      const expectedFor: (
        predicate: (metadata: TableColumnMetadata) => boolean,
      ) => Array<string> = (
        predicate: (metadata: TableColumnMetadata) => boolean,
      ): Array<string> => {
        return Object.keys(expected).filter((key: string) => {
          return predicate(expected[key] as TableColumnMetadata);
        });
      };

      expect(model.getRequiredColumns().columns).toEqual(
        expectedFor((metadata: TableColumnMetadata) => {
          return Boolean(metadata.required);
        }),
      );
      expect(model.getUniqueColumns().columns).toEqual(
        expectedFor((metadata: TableColumnMetadata) => {
          return Boolean(metadata.unique);
        }),
      );
      expect(model.getHashedColumns().columns).toEqual(
        expectedFor((metadata: TableColumnMetadata) => {
          return Boolean(metadata.hashed);
        }),
      );
      expect(model.getEncryptedColumns().columns).toEqual(
        expectedFor((metadata: TableColumnMetadata) => {
          return Boolean(metadata.encrypted);
        }),
      );
    }
  });
});

describe("getTableColumnMetadata", () => {
  for (const [name, ModelClass] of MODELS) {
    test(`returns the exact rebuild value for every instance key of ${name}`, () => {
      const model: DatabaseBaseModel = new ModelClass();
      const expected: Dictionary<TableColumnMetadata> =
        rebuildTableColumns(model);

      for (const key of Object.keys(model)) {
        const expectedValue: TableColumnMetadata | undefined = expected[key];
        const actualValue: TableColumnMetadata =
          model.getTableColumnMetadata(key);

        if (expectedValue) {
          expect(actualValue).toBe(expectedValue);
        } else {
          // Undecorated instance keys (e.g. isPermissionIf) stay undefined.
          expect(actualValue).toBeUndefined();
        }
      }
    });
  }

  test("returns undefined for unknown keys", () => {
    const monitor: Monitor = new Monitor();
    expect(monitor.getTableColumnMetadata("doesNotExist")).toBeUndefined();
    expect(monitor.getTableColumnMetadata("")).toBeUndefined();
    expect(monitor.getTableColumnMetadata("constructor")).toBeUndefined();
    expect(monitor.getTableColumnMetadata("isPermissionIf")).toBeUndefined();
  });

  test("agrees with the standalone single-column reader", () => {
    const monitor: Monitor = new Monitor();
    for (const key of Object.keys(monitor)) {
      expect(monitor.getTableColumnMetadata(key)).toBe(
        getTableColumn(monitor, key),
      );
    }
  });

  test("reads a single metadata entry instead of rebuilding the whole dictionary", () => {
    const monitor: Monitor = new Monitor();

    const spy: jest.SpyInstance = jest.spyOn(Reflect, "getMetadata");
    try {
      const metadata: TableColumnMetadata =
        monitor.getTableColumnMetadata("name");
      expect(metadata).toBeDefined();
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});
