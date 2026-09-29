import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ProjectSCIM from "../../../Models/DatabaseModels/ProjectSCIM";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import UserEmail from "../../../Models/DatabaseModels/UserEmail";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import ColumnBillingAccessControl from "../../../Types/BaseDatabase/ColumnBillingAccessControl";
import { getColumnAccessControlForAllColumns } from "../../../Types/Database/AccessControl/ColumnAccessControl";
import { getColumnBillingAccessControlForAllColumns } from "../../../Types/Database/AccessControl/ColumnBillingAccessControl";
import { getOwnerOnlyColumns } from "../../../Types/Database/AccessControl/OwnerOnlyColumn";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";

/*
 * WHY THIS FILE EXISTS - do not delete these as "obvious" assertions.
 *
 * Every "which columns does this model have" lookup answers the question by
 * enumerating an INSTANCE's own keys, and caches the answer per CLASS, for the
 * whole process. So the FIRST instance to ask used to define what the class is
 * for everybody after it.
 *
 * BaseAPI.createItem deleted `_id` off the live model instance it handed to
 * the service, and DatabaseService.create asks that instance for its columns
 * (generateDefaultValues) before any permission check runs. One POST - even a
 * POST that was refused - could therefore teach the process that a model has
 * no `_id` column, and DatabaseBaseModel.toJSONObject serializes a row by
 * iterating exactly that cached list, so every response for that model lost
 * its id from then on. To any caller, on any route, including plain reads as
 * root: the row still carried its real `_id` in memory and the SQL projection
 * still selected it. The id was dropped on the way out, and it stayed a 200
 * because `_id` is in ColumnPermissions.getExcludedColumnNames().
 *
 * The tests below do the mutation on purpose. No caller in the tree does it
 * any more, and that is not what is being protected: the invariant is that it
 * CANNOT MATTER who asks first or what they did to their own instance. Each
 * test uses a different model class, because these caches are per class and
 * per process - a class another test has already asked about has a warm cache
 * and would pass vacuously.
 */

describe("column metadata does not depend on which instance asked first", () => {
  test("getTableColumns: a mutilated instance asking first cannot strip _id from the class", () => {
    const mutilated: ProjectSCIM = new ProjectSCIM();

    // exactly what BaseAPI.createItem used to do before calling the service
    delete (mutilated as unknown as Record<string, unknown>)["_id"];
    expect(Object.keys(mutilated)).not.toContain("_id");

    // the mutilated instance is the FIRST to ask, on a cold cache
    expect(mutilated.getTableColumns().columns).toContain("_id");

    // ...and a fresh instance of the same class is unharmed
    expect(new ProjectSCIM().getTableColumns().columns).toContain("_id");
  });

  test("getTableColumns: a row still serializes with its _id after such a create", () => {
    /*
     * The assertion that matches the reported symptom: POST /api/project-scim
     * answered 200 with every column except "_id", and a get-list selecting
     * {_id, name} came back as {name} alone.
     */
    const mutilated: Monitor = new Monitor();
    delete (mutilated as unknown as Record<string, unknown>)["_id"];
    mutilated.getTableColumns();

    const row: Monitor = new Monitor();
    row._id = "22222222-2222-4222-8222-222222222222";
    row.name = "a monitor";

    const json: JSONObject = BaseModel.toJSONObject(row, Monitor);

    expect(json["_id"]).toBe("22222222-2222-4222-8222-222222222222");
    expect(json["name"]).toBe("a monitor");
  });

  test("getColumnAccessControlForAllColumns is instance-independent", () => {
    const mutilated: StatusPage = new StatusPage();
    delete (mutilated as unknown as Record<string, unknown>)["name"];

    const fromMutilated: Dictionary<ColumnAccessControl> =
      getColumnAccessControlForAllColumns(mutilated);

    expect(fromMutilated["name"]).toBeDefined();
    expect(
      getColumnAccessControlForAllColumns(new StatusPage())["name"],
    ).toBeDefined();
  });

  test("getColumnBillingAccessControlForAllColumns is instance-independent", () => {
    const mutilated: StatusPage = new StatusPage();
    delete (mutilated as unknown as Record<string, unknown>)["customCSS"];

    const fromMutilated: Dictionary<ColumnBillingAccessControl> =
      getColumnBillingAccessControlForAllColumns(mutilated);

    expect(fromMutilated["customCSS"]).toBeDefined();
    expect(
      getColumnBillingAccessControlForAllColumns(new StatusPage())["customCSS"],
    ).toBeDefined();
  });

  test("getOwnerOnlyColumns is instance-independent", () => {
    /*
     * This one is a permission list, not a projection: a marked column that
     * goes unreported is a column OwnerOnlyColumnPermission stops protecting.
     */
    const mutilated: UserEmail = new UserEmail();
    delete (mutilated as unknown as Record<string, unknown>)["email"];

    expect(getOwnerOnlyColumns(mutilated)).toContain("email");
    expect(getOwnerOnlyColumns(new UserEmail())).toContain("email");
  });

  test("mutating an instance after the class has been read changes nothing either", () => {
    const first: UserEmail = new UserEmail();
    expect(first.getTableColumns().columns).toContain("_id");

    delete (first as unknown as Record<string, unknown>)["_id"];

    expect(first.getTableColumns().columns).toContain("_id");
    expect(new UserEmail().getTableColumns().columns).toContain("_id");
  });
});

/*
 * The premise of the fix: metadata enumeration reads a freshly constructed
 * instance of the caller's class, so every model must be no-arg constructible
 * and must expose every column it declares on a fresh instance (the class
 * bodies do that with `= undefined` initializers). If a model is ever added
 * that breaks either half, it would silently lose columns everywhere -
 * responses, selects, permissions - so assert it for all of them at once.
 */
describe("every database model supports canonical-instance enumeration", () => {
  test("all models are no-arg constructible and declare no column that a fresh instance lacks", () => {
    const columnsByTarget: Map<unknown, Array<string>> = new Map();

    const record: (target: unknown, propertyName: string) => void = (
      target: unknown,
      propertyName: string,
    ): void => {
      const list: Array<string> = columnsByTarget.get(target) || [];
      list.push(propertyName);
      columnsByTarget.set(target, list);
    };

    for (const column of getMetadataArgsStorage().columns) {
      record(column.target, column.propertyName);
    }

    for (const relation of getMetadataArgsStorage().relations) {
      record(relation.target, relation.propertyName);
    }

    const constructFailures: Array<string> = [];
    const missingKeys: Array<string> = [];

    for (const modelType of AllModelTypes) {
      let instance: BaseModel | null = null;

      try {
        instance = new modelType();
      } catch (err) {
        constructFailures.push(`${modelType.name}: ${(err as Error).message}`);
        continue;
      }

      const ownKeys: Set<string> = new Set(Object.keys(instance));

      // inherited columns count too, so walk the constructor chain
      let ctor: unknown = modelType;

      while (ctor && ctor !== Function.prototype) {
        for (const propertyName of columnsByTarget.get(ctor) || []) {
          if (!ownKeys.has(propertyName)) {
            missingKeys.push(`${modelType.name}.${propertyName}`);
          }
        }

        ctor = Object.getPrototypeOf(ctor);
      }
    }

    expect(constructFailures).toEqual([]);
    expect(missingKeys).toEqual([]);
    expect(AllModelTypes.length).toBeGreaterThan(400);
  });
});
