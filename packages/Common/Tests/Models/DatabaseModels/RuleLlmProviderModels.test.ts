import AIPostmortemRule from "../../../Models/DatabaseModels/AIPostmortemRule";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import AutoRemediationRule from "../../../Models/DatabaseModels/AutoRemediationRule";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import TableColumnType from "../../../Types/Database/TableColumnType";
import Permission from "../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import type { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";

/*
 * Where an AI rule keeps the LLM provider it picks, and where a run keeps the
 * pick of the rule that started it (Common/Types/AI/LlmProviderChoice):
 *
 *   - each rule kind - AI rule (investigation and auto remediation rules
 *     merged), postmortem - has
 *     "llmProvider" (the relation) and "llmProviderId" (its id), written and
 *     read by exactly whoever writes and reads the rule's own name: the pick
 *     is part of the rule;
 *   - the id is indexed, and the relation's key sets it to null when the
 *     provider is deleted: a deleted provider leaves its rules picking none
 *     - the project's default provider, else the global one;
 *   - a run's "llmProviderId" is written by OneUptime alone, when the run is
 *     created, and is read by whoever reads the run. It is a plain id with
 *     no relation, so no key: a run queued before its provider was deleted
 *     still knows it had one, and says why it used another.
 */

type RuleModel = { new (): BaseModel };

const RULE_MODELS: Array<[string, RuleModel]> = [
  ["AutoRemediationRule", AutoRemediationRule],
  ["AIPostmortemRule", AIPostmortemRule],
];

function accessOf(model: BaseModel, column: string): ColumnAccessControl {
  const access: ColumnAccessControl | null =
    model.getColumnAccessControlFor(column);
  expect(access).not.toBeNull();
  return access!;
}

function sortedPermissions(
  permissions: Array<Permission> | undefined,
): Array<string> {
  return [...(permissions || [])].map(String).sort();
}

describe.each(RULE_MODELS)(
  "%s and the LLM provider it picks",
  (_name: string, RuleType: RuleModel) => {
    const model: BaseModel = new RuleType();

    test("keeps it as a relation to LlmProvider and its id", () => {
      expect(model.getTableColumnMetadata("llmProvider").type).toBe(
        TableColumnType.Entity,
      );
      expect(model.getTableColumnMetadata("llmProvider").modelType).toBe(
        LlmProvider,
      );
      expect(
        model.getTableColumnMetadata("llmProvider").manyToOneRelationColumn,
      ).toBe("llmProviderId");
      expect(model.getTableColumnMetadata("llmProviderId").type).toBe(
        TableColumnType.ObjectID,
      );
      expect(model.getTableColumnMetadata("llmProviderId").title).toBe(
        "LLM Provider ID",
      );
      expect(model.getTableColumnMetadata("llmProvider").title).toBe(
        "LLM Provider",
      );
    });

    test("none picked is an answer of its own: the project's default provider, else the global one", () => {
      expect(model.getTableColumnMetadata("llmProviderId").required).toBe(
        false,
      );
      expect(
        model.getTableColumnMetadata("llmProviderId").canReadOnRelationQuery,
      ).toBe(true);
    });

    test("is written and read by exactly whoever writes and reads the rule", () => {
      const name: ColumnAccessControl = accessOf(model, "name");

      for (const column of ["llmProvider", "llmProviderId"]) {
        const access: ColumnAccessControl = accessOf(model, column);

        expect(sortedPermissions(access.create)).toEqual(
          sortedPermissions(name.create),
        );
        expect(sortedPermissions(access.read)).toEqual(
          sortedPermissions(name.read),
        );
        expect(sortedPermissions(access.update)).toEqual(
          sortedPermissions(name.update),
        );
      }
    });

    test("is indexed, and a deleted provider leaves the rule picking none", () => {
      const relation: RelationMetadataArgs | undefined =
        getMetadataArgsStorage().relations.find(
          (candidate: RelationMetadataArgs): boolean => {
            return (
              candidate.target === RuleType &&
              candidate.propertyName === "llmProvider"
            );
          },
        );

      expect(relation).toBeDefined();
      expect(relation!.relationType).toBe("many-to-one");
      expect(
        typeof relation!.type === "function"
          ? (relation!.type as () => unknown)()
          : relation!.type,
      ).toBe(LlmProvider);
      expect(relation!.options.onDelete).toBe("SET NULL");
      expect(relation!.options.nullable).toBe(true);

      expect(
        getMetadataArgsStorage().indices.some(
          (index: IndexMetadataArgs): boolean => {
            return (
              index.target === RuleType &&
              Array.isArray(index.columns) &&
              index.columns.length === 1 &&
              index.columns[0] === "llmProviderId"
            );
          },
        ),
      ).toBe(true);
    });
  },
);

describe("AIRun and the pick of the rule that started it", () => {
  const model: AIRun = new AIRun();

  test("is a plain id, kept with no relation - so no key - to outlive the provider", () => {
    expect(model.getTableColumnMetadata("llmProviderId").type).toBe(
      TableColumnType.ObjectID,
    );
    expect(model.getTableColumnMetadata("llmProviderId").required).toBe(false);
    expect(model.getTableColumns().columns).not.toContain("llmProvider");
    expect(
      getMetadataArgsStorage().relations.some(
        (relation: RelationMetadataArgs): boolean => {
          return (
            relation.target === AIRun && relation.propertyName === "llmProvider"
          );
        },
      ),
    ).toBe(false);
  });

  test("is written by OneUptime alone, when the run is created, and read by whoever reads the run", () => {
    const access: ColumnAccessControl = accessOf(model, "llmProviderId");

    expect(access.create).toEqual([]);
    expect(access.update).toEqual([]);
    expect(sortedPermissions(access.read)).toEqual(
      sortedPermissions([
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ProjectMember,
        Permission.Viewer,
      ]),
    );
  });
});
