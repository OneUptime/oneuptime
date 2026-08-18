import DatabaseBaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import Project from "../../../../Models/DatabaseModels/Project";
import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import { ColumnAccessControl } from "../../../../Types/BaseDatabase/AccessControl";
import ColumnBillingAccessControl from "../../../../Types/BaseDatabase/ColumnBillingAccessControl";
import { getColumnAccessControlForAllColumns } from "../../../../Types/Database/AccessControl/ColumnAccessControl";
import { getColumnBillingAccessControlForAllColumns } from "../../../../Types/Database/AccessControl/ColumnBillingAccessControl";
import Dictionary from "../../../../Types/Dictionary";
import "reflect-metadata";

type ModelCtor = new () => DatabaseBaseModel;

const MODELS: Array<[string, ModelCtor]> = [
  ["Monitor", Monitor],
  ["Incident", Incident],
  ["Project", Project],
];

// Monitor and Incident have no billing-decorated columns; StatusPage does.
const BILLING_MODELS: Array<[string, ModelCtor]> = [["StatusPage", StatusPage]];

const DEFAULT_COLUMNS: Array<string> = [
  "_id",
  "createdAt",
  "deletedAt",
  "updatedAt",
];

/*
 * Locate the module-private metadata symbol (e.g. Symbol(ColumnAccessControl))
 * by scanning the metadata keys of every instance property, so the tests can
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

// The exact algorithm both helpers used before caching was introduced.
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

function rebuildAccessControl(
  model: DatabaseBaseModel,
): Dictionary<ColumnAccessControl> {
  return rebuildFromReflect<ColumnAccessControl>(model, "ColumnAccessControl");
}

function rebuildBillingAccessControl(
  model: DatabaseBaseModel,
): Dictionary<ColumnBillingAccessControl> {
  return rebuildFromReflect<ColumnBillingAccessControl>(
    model,
    "ColumnBillingAccessControl",
  );
}

describe("getColumnAccessControlForAllColumns helper caching", () => {
  for (const [name, ModelClass] of MODELS) {
    test(`matches a from-scratch Reflect rebuild for ${name} — keys, order, and value identity`, () => {
      const model: DatabaseBaseModel = new ModelClass();
      const expected: Dictionary<ColumnAccessControl> =
        rebuildAccessControl(model);
      const actual: Dictionary<ColumnAccessControl> =
        getColumnAccessControlForAllColumns(model);

      // Sanity: real models have plenty of decorated columns.
      expect(Object.keys(expected).length).toBeGreaterThan(5);

      expect(Object.keys(actual)).toEqual(Object.keys(expected));
      for (const key of Object.keys(expected)) {
        expect(actual[key]).toBe(expected[key]);
      }
    });
  }

  test("repeated calls return the same dictionary object", () => {
    const monitor: Monitor = new Monitor();
    const first: Dictionary<ColumnAccessControl> =
      getColumnAccessControlForAllColumns(monitor);
    const second: Dictionary<ColumnAccessControl> =
      getColumnAccessControlForAllColumns(monitor);

    expect(second).toBe(first);
  });

  test("different instances of the same class share the cached dictionary", () => {
    const first: Dictionary<ColumnAccessControl> =
      getColumnAccessControlForAllColumns(new Monitor());
    const second: Dictionary<ColumnAccessControl> =
      getColumnAccessControlForAllColumns(new Monitor());

    expect(second).toBe(first);
  });

  test("second call performs zero Reflect metadata reads", () => {
    const incident: Incident = new Incident();
    getColumnAccessControlForAllColumns(incident); // warm the cache

    const spy: jest.SpyInstance = jest.spyOn(Reflect, "getMetadata");
    try {
      getColumnAccessControlForAllColumns(incident);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  test("different classes get distinct dictionaries", () => {
    const monitorAccessControl: Dictionary<ColumnAccessControl> =
      getColumnAccessControlForAllColumns(new Monitor());
    const incidentAccessControl: Dictionary<ColumnAccessControl> =
      getColumnAccessControlForAllColumns(new Incident());
    const projectAccessControl: Dictionary<ColumnAccessControl> =
      getColumnAccessControlForAllColumns(new Project());

    expect(monitorAccessControl).not.toBe(incidentAccessControl);
    expect(monitorAccessControl).not.toBe(projectAccessControl);
    expect(incidentAccessControl).not.toBe(projectAccessControl);

    expect(monitorAccessControl["monitorType"]).toBeDefined();
    expect(incidentAccessControl["monitorType"]).toBeUndefined();
  });
});

describe("DatabaseBaseModel.getColumnAccessControlForAllColumns override", () => {
  test("adds default columns with record-level permissions, exactly as before", () => {
    const monitor: Monitor = new Monitor();
    const raw: Dictionary<ColumnAccessControl> = rebuildAccessControl(monitor);
    const merged: Dictionary<ColumnAccessControl> =
      monitor.getColumnAccessControlForAllColumns();

    for (const key of DEFAULT_COLUMNS) {
      expect(merged[key]).toEqual({
        read: monitor.readRecordPermissions,
        create: monitor.createRecordPermissions,
        update: monitor.updateRecordPermissions,
      });
    }

    // Decorated columns flow through as the exact same Reflect singletons.
    for (const key of Object.keys(raw)) {
      if (!DEFAULT_COLUMNS.includes(key)) {
        expect(merged[key]).toBe(raw[key]);
      }
    }

    expect(Object.keys(merged).sort()).toEqual(
      [...Object.keys(raw), ...DEFAULT_COLUMNS].sort(),
    );
  });

  test("never pollutes the raw helper dictionary with default columns", () => {
    const monitor: Monitor = new Monitor();

    const rawKeysBefore: Array<string> = Object.keys(
      getColumnAccessControlForAllColumns(monitor),
    );
    for (const key of DEFAULT_COLUMNS) {
      expect(rawKeysBefore).not.toContain(key);
    }

    monitor.getColumnAccessControlForAllColumns();
    monitor.getColumnAccessControlForAllColumns();

    /*
     * AuditLogService.getRedactedFields consumes the raw helper result and
     * must never see the record-level defaults the model override adds.
     */
    const rawAfter: Dictionary<ColumnAccessControl> =
      getColumnAccessControlForAllColumns(new Monitor());
    expect(Object.keys(rawAfter)).toEqual(rawKeysBefore);
    for (const key of DEFAULT_COLUMNS) {
      expect(rawAfter[key]).toBeUndefined();
    }
  });

  test("mutating one override result does not affect the next call", () => {
    const monitor: Monitor = new Monitor();

    const first: Dictionary<ColumnAccessControl> =
      monitor.getColumnAccessControlForAllColumns();
    const originalName: ColumnAccessControl = first[
      "name"
    ] as ColumnAccessControl;
    expect(originalName).toBeDefined();

    delete first["name"];
    first["_id"] = { read: [], create: [], update: [] };
    first["injected"] = { read: [], create: [], update: [] };

    const second: Dictionary<ColumnAccessControl> =
      monitor.getColumnAccessControlForAllColumns();

    expect(second).not.toBe(first);
    expect(second["name"]).toBe(originalName);
    expect(second["injected"]).toBeUndefined();
    expect(second["_id"]).toEqual({
      read: monitor.readRecordPermissions,
      create: monitor.createRecordPermissions,
      update: monitor.updateRecordPermissions,
    });
  });

  test("getColumnAccessControlFor still resolves decorated, default, and unknown columns", () => {
    const monitor: Monitor = new Monitor();
    const raw: Dictionary<ColumnAccessControl> = rebuildAccessControl(monitor);

    expect(monitor.getColumnAccessControlFor("name")).toBe(raw["name"]);
    expect(monitor.getColumnAccessControlFor("_id")).toEqual({
      read: monitor.readRecordPermissions,
      create: monitor.createRecordPermissions,
      update: monitor.updateRecordPermissions,
    });
    expect(monitor.getColumnAccessControlFor("doesNotExist")).toBeNull();
  });
});

describe("getColumnBillingAccessControlForAllColumns helper caching", () => {
  for (const [name, ModelClass] of [...MODELS, ...BILLING_MODELS]) {
    test(`matches a from-scratch Reflect rebuild for ${name} — keys, order, and value identity`, () => {
      const model: DatabaseBaseModel = new ModelClass();
      const expected: Dictionary<ColumnBillingAccessControl> =
        rebuildBillingAccessControl(model);
      const actual: Dictionary<ColumnBillingAccessControl> =
        getColumnBillingAccessControlForAllColumns(model);

      expect(Object.keys(actual)).toEqual(Object.keys(expected));
      for (const key of Object.keys(expected)) {
        expect(actual[key]).toBe(expected[key]);
      }
    });
  }

  test("Project and StatusPage carry billing-decorated columns; Monitor's dictionary is empty", () => {
    expect(
      Object.keys(getColumnBillingAccessControlForAllColumns(new Project()))
        .length,
    ).toBeGreaterThan(0);
    expect(
      Object.keys(getColumnBillingAccessControlForAllColumns(new StatusPage()))
        .length,
    ).toBeGreaterThan(0);
    expect(getColumnBillingAccessControlForAllColumns(new Monitor())).toEqual(
      {},
    );
  });

  test("repeated calls return the same dictionary object", () => {
    const project: Project = new Project();
    const first: Dictionary<ColumnBillingAccessControl> =
      getColumnBillingAccessControlForAllColumns(project);
    const second: Dictionary<ColumnBillingAccessControl> =
      getColumnBillingAccessControlForAllColumns(new Project());

    expect(second).toBe(first);
  });

  test("second call performs zero Reflect metadata reads", () => {
    const project: Project = new Project();
    getColumnBillingAccessControlForAllColumns(project); // warm the cache

    const spy: jest.SpyInstance = jest.spyOn(Reflect, "getMetadata");
    try {
      getColumnBillingAccessControlForAllColumns(project);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  test("different classes get distinct dictionaries", () => {
    const statusPageBilling: Dictionary<ColumnBillingAccessControl> =
      getColumnBillingAccessControlForAllColumns(new StatusPage());
    const projectBilling: Dictionary<ColumnBillingAccessControl> =
      getColumnBillingAccessControlForAllColumns(new Project());

    expect(statusPageBilling).not.toBe(projectBilling);
    expect(Object.keys(statusPageBilling)).not.toEqual(
      Object.keys(projectBilling),
    );
  });

  test("model getColumnBillingAccessControl reads without mutating the cached dictionary", () => {
    const project: Project = new Project();
    const expected: Dictionary<ColumnBillingAccessControl> =
      rebuildBillingAccessControl(project);
    const keysBefore: Array<string> = Object.keys(
      getColumnBillingAccessControlForAllColumns(project),
    );

    for (const key of keysBefore) {
      expect(project.getColumnBillingAccessControl(key)).toBe(expected[key]);
    }
    expect(project.getColumnBillingAccessControl("doesNotExist")).toBe(
      undefined,
    );

    expect(
      Object.keys(getColumnBillingAccessControlForAllColumns(new Project())),
    ).toEqual(keysBefore);
  });
});
