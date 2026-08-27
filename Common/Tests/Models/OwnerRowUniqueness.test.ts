import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AllModelTypes from "../../Models/DatabaseModels/Index";
import { getUniqueColumnBy } from "../../Types/Database/UniqueColumnBy";
import { describe, expect, test } from "@jest/globals";

/*
 * Issue #3394: owner rows were de-duplicated only in the dashboard picker.
 *
 * Nothing in the persistence layer enforced it — the indexes on
 * (<resource>Id, ownerId, projectId) exist but are not unique, and no owner
 * service carried an existence check. So every non-dashboard path (REST API,
 * workflow components, `addOwners`, the owner rule engines) could attach the
 * same team/user to the same resource any number of times. The duplicate was
 * not cosmetic: `onCreateSuccess` runs per row, so each one wrote its own
 * resource-feed entry and fired its own owner notification — an at-least-once
 * webhook or a retried workflow silently double-notified the on-call team.
 *
 * The fix declares the invariant on the model with `@UniqueColumnBy`, which
 * `DatabaseService.create()` already enforces for every write path.
 *
 * This test is the part that keeps it fixed. It walks EVERY owner model in
 * the registry rather than the handful the issue named, so a resource added
 * later — a new *OwnerTeam / *OwnerUser pair for some future page — cannot
 * quietly reintroduce the bug: forgetting the declaration fails CI here.
 *
 * Pure metadata. No Postgres connection anywhere.
 */

/*
 * Every id column an owner model carries that is not the resource it owns.
 * Whatever is left over must be the resource, and there must be exactly one.
 */
const NON_RESOURCE_ID_COLUMNS: Array<string> = [
  "projectId",
  "teamId",
  "userId",
  "createdByUserId",
  "deletedByUserId",
];

const OWNER_MODEL_NAME: RegExp = /Owner(Team|User)$/;

const OWNER_MODEL_TYPES: Array<{ new (): BaseModel }> = AllModelTypes.filter(
  (modelType: { new (): BaseModel }) => {
    return OWNER_MODEL_NAME.test(modelType.name);
  },
);

function ownerColumnOf(modelType: { new (): BaseModel }): string {
  return modelType.name.endsWith("OwnerTeam") ? "teamId" : "userId";
}

function resourceColumnsOf(model: BaseModel): Array<string> {
  return Object.keys(model).filter((columnName: string) => {
    return (
      columnName.endsWith("Id") && !NON_RESOURCE_ID_COLUMNS.includes(columnName)
    );
  });
}

describe("Owner row uniqueness", () => {
  test("the owner models are discoverable from the model registry", () => {
    /*
     * Guards the guard: if this filter ever stops matching, every assertion
     * below would vacuously pass over an empty list.
     */
    expect(OWNER_MODEL_TYPES.length).toBeGreaterThan(50);
  });

  test("every *OwnerTeam / *OwnerUser model scopes its owner column to the resource and project", () => {
    const offenders: Array<string> = [];

    for (const modelType of OWNER_MODEL_TYPES) {
      const model: BaseModel = new modelType();
      const ownerColumn: string = ownerColumnOf(modelType);
      const resourceColumns: Array<string> = resourceColumnsOf(model);

      if (resourceColumns.length !== 1) {
        offenders.push(
          `${modelType.name}: expected exactly one resource id column, found [${resourceColumns.join(", ")}]`,
        );
        continue;
      }

      const expectedScope: Array<string> = [resourceColumns[0]!, "projectId"];
      const declaredScope: unknown = getUniqueColumnBy(model, ownerColumn);

      if (JSON.stringify(declaredScope) !== JSON.stringify(expectedScope)) {
        offenders.push(
          `${modelType.name}.${ownerColumn} is scoped by ${JSON.stringify(declaredScope)}, expected ${JSON.stringify(expectedScope)}`,
        );
      }
    }

    expect(offenders).toEqual([]);
  });

  test("the scope is per resource and project, never global", () => {
    /*
     * A missing scope would make the owner column globally unique — the
     * ProjectCallSMSConfig failure mode (issue #3020), where one tenant
     * saving a value locked every other tenant out of it. Here that would
     * mean a team could own a single incident across the whole instance.
     */
    for (const modelType of OWNER_MODEL_TYPES) {
      const model: BaseModel = new modelType();
      const declaredScope: unknown = getUniqueColumnBy(
        model,
        ownerColumnOf(modelType),
      );

      expect(Array.isArray(declaredScope)).toBe(true);
      expect(declaredScope as Array<string>).toContain("projectId");
    }
  });
});
