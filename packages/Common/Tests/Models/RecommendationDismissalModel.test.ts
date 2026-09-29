/**
 * RecommendationDismissal model wiring.
 *
 * Everything that makes this model work is decorator metadata, and decorator
 * metadata has no runtime that would ever exercise it in a unit test. It is
 * read by the generic CRUD API, by BaseModelTable and by the team-permissions
 * screen — all of which fail *quietly* when a decorator is wrong:
 *
 * - a wrong @TenantColumn does not throw, it drops the automatic projectId
 *   filter, so one project's dismissals start hiding another project's cards
 * - a changed @CrudApiEndpoint does not throw, it 404s the dismiss button in
 *   the browser while every server test still passes
 * - a @TableColumn added to resourceId with a modelType would turn a
 *   deliberately polymorphic pointer into a relation, and TypeORM would then
 *   try to join against a table that does not exist for seven of the eight
 *   resource kinds
 * - a Permission enum member with no entry in the permission-description
 *   table throws BadDataException from PermissionHelper.getDescription, which
 *   is only ever called when someone opens Project Settings > Teams
 *
 * None of these are caught by tsc, and none are caught by any test that
 * exercises the service. So they are pinned here.
 */

import Project from "../../Models/DatabaseModels/Project";
import RecommendationDismissal from "../../Models/DatabaseModels/RecommendationDismissal";
import Columns from "../../Types/Database/Columns";
import { TableColumnMetadata } from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "../../Types/Permission";
import RecommendationType from "../../Types/Recommendation/RecommendationType";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";

const RECOMMENDATION_DISMISSAL_PERMISSIONS: Array<Permission> = [
  Permission.CreateRecommendationDismissal,
  Permission.ReadRecommendationDismissal,
  Permission.EditRecommendationDismissal,
  Permission.DeleteRecommendationDismissal,
];

function model(): RecommendationDismissal {
  return new RecommendationDismissal();
}

function relationArgs(propertyName: string): RelationMetadataArgs | undefined {
  return getMetadataArgsStorage().relations.find(
    (relation: RelationMetadataArgs) => {
      return (
        relation.target === RecommendationDismissal &&
        relation.propertyName === propertyName
      );
    },
  );
}

function permissionProps(permission: Permission): PermissionProps | undefined {
  return PermissionHelper.getAllPermissionProps().find(
    (props: PermissionProps) => {
      return props.permission === permission;
    },
  );
}

describe("RecommendationDismissal table wiring", () => {
  test("is tenant-scoped by projectId", () => {
    /*
     * DatabaseService reads this string to inject the tenant filter on every
     * read, update and delete. If it is null or names a column that does not
     * exist, queries stop being scoped and a dismissal made in one project
     * starts hiding recommendations in another.
     */
    expect(model().getTenantColumn()).toBe("projectId");
  });

  test("is served at /recommendation-dismissal", () => {
    /*
     * The dashboard calls this path through ModelAPI. It is a string on both
     * sides with no shared constant, so a rename here breaks Dismiss in the
     * browser and nothing else.
     */
    expect(model().getCrudApiPath()?.toString()).toBe(
      "/recommendation-dismissal",
    );
  });

  test("maps to the RecommendationDismissal table", () => {
    expect(model().tableName).toBe("RecommendationDismissal");
  });

  test("declares every column the dismissal flow writes and reads", () => {
    const columns: Columns = model().getTableColumns();

    for (const columnName of [
      "recommendationType",
      "recommendationId",
      "resourceType",
      "resourceId",
      "dismissalReason",
      "projectId",
    ]) {
      expect(columns.hasColumn(columnName)).toBe(true);
    }
  });

  test("requires the two columns that identify what was dismissed", () => {
    /*
     * required: true is what makes DatabaseService reject a create that omits
     * them. It is the layer underneath RecommendationDismissalService's own
     * validation; both exist because a row missing either field hides nothing
     * yet still consumes the unique slot for its (project, type, resource).
     */
    const columns: RecommendationDismissal = model();

    expect(columns.getTableColumnMetadata("recommendationType").required).toBe(
      true,
    );
    expect(columns.getTableColumnMetadata("recommendationId").required).toBe(
      true,
    );
  });

  test("keeps resourceType and resourceId optional for unscoped recommendations", () => {
    /*
     * A future project-wide recommendation kind has no resource to point at.
     * Marking either column required would make that kind undismissable.
     */
    const columns: RecommendationDismissal = model();

    expect(columns.getTableColumnMetadata("resourceType").required).toBeFalsy();
    expect(columns.getTableColumnMetadata("resourceId").required).toBeFalsy();
  });

  test("documents recommendationType with a value that is actually in the enum", () => {
    /*
     * The example feeds the generated API documentation, and it is the only
     * place an integrator learns what this free-text column accepts. Since the
     * service rejects anything outside the enum — case-sensitively — an
     * example that has drifted from the enum documents a request that always
     * 400s.
     */
    const example: unknown =
      model().getTableColumnMetadata("recommendationType").example;

    expect(Object.values(RecommendationType)).toContain(example);
  });
});

describe("RecommendationDismissal.resourceId is a polymorphic pointer", () => {
  test("carries no relation metadata, unlike the project relation", () => {
    /*
     * resourceId points at a KubernetesCluster, a Host, a DockerHost or five
     * other tables depending on resourceType, so there is no single table a
     * foreign key could name. The contrast with `project` below is the point:
     * a relation column declares modelType and manyToOneRelationColumn, and
     * anything reading this metadata (the API docs generator, the populate
     * logic, BaseModelTable) branches on their presence. Give resourceId a
     * modelType and those readers will start trying to join it.
     */
    const resourceId: TableColumnMetadata =
      model().getTableColumnMetadata("resourceId");

    expect(resourceId.type).toBe(TableColumnType.ObjectID);
    expect(resourceId.modelType).toBeUndefined();
    expect(resourceId.manyToOneRelationColumn).toBeUndefined();

    const project: TableColumnMetadata =
      model().getTableColumnMetadata("project");

    expect(project.type).toBe(TableColumnType.Entity);
    expect(project.modelType).toBe(Project);
    expect(project.manyToOneRelationColumn).toBe("projectId");
  });

  test("has no sibling entity property and no TypeORM relation", () => {
    /*
     * The relation-column convention in this schema is a pair: an ObjectID
     * column plus an entity property carrying the @ManyToOne (projectId +
     * project). resourceId deliberately has no partner, and there must be no
     * @ManyToOne registered against it either — TypeORM would resolve the FK
     * at connection time and fail to start, or worse, join every dismissal to
     * one arbitrary table.
     */
    expect(model().getTableColumns().hasColumn("resource")).toBe(false);
    expect(relationArgs("resourceId")).toBeUndefined();
    expect(relationArgs("resource")).toBeUndefined();

    // The project relation is registered, so the assertions above mean something.
    expect(relationArgs("project")).toBeDefined();
  });
});

describe("RecommendationDismissal permissions", () => {
  test("every granular permission has a description entry", () => {
    /*
     * PermissionHelper.getDescription throws BadDataException for a permission
     * that is missing from getAllPermissionProps. Project Settings > Teams
     * calls it for every permission it renders, so one missing entry does not
     * hide a checkbox — it breaks the whole permissions screen, and only for
     * whoever opens it after the model ships.
     */
    for (const permission of RECOMMENDATION_DISMISSAL_PERMISSIONS) {
      const props: PermissionProps | undefined = permissionProps(permission);

      expect(props).toBeDefined();
      expect(props?.title.length).toBeGreaterThan(0);
      expect(props?.description.length).toBeGreaterThan(0);

      expect(() => {
        return PermissionHelper.getDescription(permission);
      }).not.toThrow();
      expect(() => {
        return PermissionHelper.getTitle(permission);
      }).not.toThrow();
    }
  });

  test("granular permissions are assignable to a team", () => {
    /*
     * A permission that is not assignable to a tenant never appears in the
     * team permission picker, which makes it unreachable for anyone who is not
     * already a project owner or admin.
     */
    for (const permission of RECOMMENDATION_DISMISSAL_PERMISSIONS) {
      expect(permissionProps(permission)?.isAssignableToTenant).toBe(true);
    }
  });

  test("each granular permission is wired into the matching table access control", () => {
    /*
     * Declaring the permissions without attaching them to the table would
     * leave four checkboxes in the UI that grant nothing at all.
     */
    const dismissal: RecommendationDismissal = model();

    expect(dismissal.createRecordPermissions).toContain(
      Permission.CreateRecommendationDismissal,
    );
    expect(dismissal.readRecordPermissions).toContain(
      Permission.ReadRecommendationDismissal,
    );
    expect(dismissal.updateRecordPermissions).toContain(
      Permission.EditRecommendationDismissal,
    );
    expect(dismissal.deleteRecordPermissions).toContain(
      Permission.DeleteRecommendationDismissal,
    );
  });

  test("allows delete, because un-dismissing is a delete and not a flag", () => {
    /*
     * There is no isDismissed column to flip back. Restoring a recommendation
     * removes the row, so without delete permission for ordinary project
     * members a dismissal made by mistake is permanent for everyone.
     */
    const dismissal: RecommendationDismissal = model();

    expect(dismissal.deleteRecordPermissions).toContain(
      Permission.ProjectMember,
    );
    expect(dismissal.createRecordPermissions).toContain(
      Permission.ProjectMember,
    );
  });
});
