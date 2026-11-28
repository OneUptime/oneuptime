import Entities from "../../../../../Models/DatabaseModels/Index";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OwnedScopePermission from "../../../../../Server/Types/Database/Permissions/OwnedScopePermission";
import KindsWithOwners, {
  KINDS_WHOSE_READS_THE_OWNED_SCOPE_LEAVES_ALONE,
  KINDS_WITH_OWNER_TABLES,
} from "../../../../../Types/Database/AccessControl/KindsWithOwners";
import { describe, expect, test } from "@jest/globals";

/*
 * THE DASHBOARD'S KINDS WITH OWNERS ARE THE SERVER'S (#11436).
 *
 * Types/Database/AccessControl/KindsWithOwners writes down, for the
 * Dashboard, which kinds keep owner tables of their own (the kinds whose
 * pages ask who owns their records, and whose CRUD routes answer it), which
 * models the Owned scope narrows at all, and which kinds' reads it leaves
 * alone - because the Dashboard carries no server code. This works each
 * out again from every model by the server's own reading of them
 * (OwnedScopePermission, OwnerTableRegistry) and fails, naming what to add
 * or remove, whenever the two part.
 */

const MODELS: Array<{ new (): BaseModel }> = Entities as Array<{
  new (): BaseModel;
}>;

describe("KindsWithOwners agrees with the server's registry of owner tables", () => {
  test("every kind with owner tables is listed, and nothing else", () => {
    const registry: Array<string> = MODELS.filter(
      (modelType: { new (): BaseModel }): boolean => {
        return OwnedScopePermission.hasOwnerTables(modelType);
      },
    )
      .map((modelType: { new (): BaseModel }): string => {
        return new modelType().tableName || "";
      })
      .sort();

    expect([...KINDS_WITH_OWNER_TABLES].sort()).toEqual(registry);
  });

  test("every kind whose reads the Owned scope leaves alone is listed, and nothing else", () => {
    const leftAlone: Array<string> = MODELS.filter(
      (modelType: { new (): BaseModel }): boolean => {
        return (
          OwnedScopePermission.hasOwnerTables(modelType) &&
          OwnedScopePermission.leavesReadsAlone(modelType)
        );
      },
    )
      .map((modelType: { new (): BaseModel }): string => {
        return new modelType().tableName || "";
      })
      .sort();

    expect([...KINDS_WHOSE_READS_THE_OWNED_SCOPE_LEAVES_ALONE].sort()).toEqual(
      leftAlone,
    );
  });

  test("the Dashboard tells a model with owners as the server does, for every model", () => {
    const disagreements: Array<string> = [];

    for (const modelType of MODELS) {
      const model: BaseModel = new modelType();
      const server: boolean = OwnedScopePermission.hasOwners(modelType);

      // An owner table takes its owners from its resource: the server's own reading.
      if (OwnedScopePermission.isOwnerTable(modelType)) {
        continue;
      }

      if (KindsWithOwners.hasOwners(model) !== server) {
        disagreements.push(`${model.tableName}: server ${server}`);
      }
    }

    expect(disagreements).toEqual([]);
  });

  test("and whether the Owned scope leaves its reads alone, for every model with owners", () => {
    const disagreements: Array<string> = [];

    for (const modelType of MODELS) {
      const model: BaseModel = new modelType();

      if (
        !OwnedScopePermission.hasOwners(modelType) ||
        OwnedScopePermission.isOwnerTable(modelType)
      ) {
        continue;
      }

      const server: boolean = OwnedScopePermission.leavesReadsAlone(modelType);

      if (KindsWithOwners.leavesReadsAlone(model) !== server) {
        disagreements.push(`${model.tableName}: server ${server}`);
      }
    }

    expect(disagreements).toEqual([]);
  });
});
