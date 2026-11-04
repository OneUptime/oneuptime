import { describe, expect, test } from "@jest/globals";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DataAsset from "../../../../Models/DatabaseModels/DataAsset";
import DataAssetFeed from "../../../../Models/DatabaseModels/DataAssetFeed";
import DataAssetOwnerTeam from "../../../../Models/DatabaseModels/DataAssetOwnerTeam";
import DataAssetOwnerUser from "../../../../Models/DatabaseModels/DataAssetOwnerUser";
import DataAssetUsage from "../../../../Models/DatabaseModels/DataAssetUsage";
import DataCheck from "../../../../Models/DatabaseModels/DataCheck";
import DataIssueReport from "../../../../Models/DatabaseModels/DataIssueReport";
import OwnedScopePermission from "../../../../Server/Types/Database/Permissions/OwnedScopePermission";
import OwnerTableRegistry, {
  OwnerTablePair,
} from "../../../../Server/Types/Database/Permissions/OwnerTableRegistry";
import { OwnedThroughMetadata } from "../../../../Types/Database/AccessControl/OwnedThrough";

/*
 * A TABLE'S OWNERS ARE WHAT AN `OWNED` PERMISSION READS.
 *
 * A table has owners of its own, so a permission scoped to Owned reaches only
 * the tables its holder or their teams own. The registry is what says so: a kind
 * with owner tables that is missing from it is not narrowed at all. And what
 * belongs to a table goes with it, so its checks and the problems reported on
 * it are not read around it. Every kind in the registry is held to the scope's
 * behaviour in OwnedScopeEveryKindWithOwners.
 */

describe("A table and the Owned scope", () => {
  test("the scope reads a table's owners from both of its owner tables", () => {
    const pair: OwnerTablePair | undefined =
      OwnerTableRegistry.get("DataAsset");

    expect(pair?.fkColumn).toBe("dataAssetId");
    expect(pair?.ownerUserService.modelType).toBe(DataAssetOwnerUser);
    expect(pair?.ownerTeamService.modelType).toBe(DataAssetOwnerTeam);
  });

  test("the scope narrows reads of tables as well as changes", () => {
    expect(OwnerTableRegistry.get("DataAsset")?.ownedScopeLeavesReads).not.toBe(
      true,
    );
  });

  test("a table owns no telemetry: its metrics are named after its store", () => {
    expect(OwnerTableRegistry.get("DataAsset")?.canOwnTelemetry).toBe(false);
  });

  test.each([
    ["its checks", DataCheck],
    ["its activity", DataAssetFeed],
    ["its usage", DataAssetUsage],
    ["the problems reported on it", DataIssueReport],
  ] as Array<[string, { new (): BaseModel }]>)(
    "%s take their owners from the table",
    (_name: string, modelType: { new (): BaseModel }) => {
      const through: OwnedThroughMetadata | null | undefined =
        OwnedScopePermission.getOwnedThrough(modelType);

      expect(through?.fkColumn).toBe("dataAssetId");
      expect(through?.parentModels).toEqual([DataAsset]);
    },
  );
});
