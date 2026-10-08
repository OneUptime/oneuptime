import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * THE BUILT-IN ROLES KEEP WORKING UNDER "A WRITE NEEDS A READ".
 *
 * The record rule (BasePermission.addRecordScopeToQuery) lets an update or a
 * delete reach only the records its caller may read, and a record read
 * through another one (@CanAccessIfCanReadOn - an incident's note) only
 * through a parent the caller may read. Both hold through what the caller
 * holds, so a role that may change a table but not read it would change
 * nothing at all, and a role that may read a note but not its incident would
 * read no note.
 *
 * Custom roles built from single permissions are told so in the docs: give
 * the read permission with the edit permission, and the incident's read
 * permission with the note's. The roles OneUptime ships must hold together
 * on their own, so this sweeps every model:
 *
 *   - every role that may update or delete a table's records may read them;
 *   - every role that may read, update or delete the records of a model read
 *     through another one may read that other one - unless the model says
 *     its own readers read it without that other one (CanAccessIfCanReadOn's
 *     isParentReadOptional), which only the models in
 *     PARENT_READ_OPTIONAL do;
 *   - every role that may create such records may read that other one too:
 *     a record read through another one is created only under a parent its
 *     creator may read (CreatePermission.checkParentPermission).
 *
 * Anything that legitimately does not is listed below with the reason, and
 * the lists may only shrink: each entry is the exact line the sweep
 * produces, so an entry nothing produces any more fails the test too.
 */

type ModelType = { new (): BaseModel };

const MODEL_TYPES: Array<ModelType> = AllModelTypes as Array<ModelType>;

// The roles OneUptime ships: Project Owner, Admin, Member, Viewer and the domain tiers.
const BUILT_IN_ROLES: Set<string> = new Set<string>(
  PermissionHelper.getRolePermissionProps().map(
    (props: PermissionProps): string => {
      return props.permission.toString();
    },
  ),
);

/*
 * The permissions every member, or anyone at all, holds without a role:
 * listed on a table, they say who may read it in general, and are held to the
 * same rule as a role.
 */
const AUTOMATIC_PERMISSIONS: Set<string> = new Set<string>([
  Permission.ProjectUser,
  Permission.Public,
  Permission.CurrentUser,
]);

// Lines of the write sweep that are deliberate. May only shrink.
const WRITES_WITHOUT_READ: Array<string> = [];

/*
 * Lines of the parent sweep that are deliberate. May only shrink - and is
 * empty: a status page's single sign-on providers no longer list ProjectUser
 * and Public on their read lists (the status page's own sign-in page reads
 * them as root), so every model read through another one is read only by
 * roles that may read that other one.
 */
const READS_WITHOUT_PARENT: Array<string> = [];

/*
 * Lines of the create sweep that are deliberate. May only shrink.
 *
 * A status page subscriber lists Public among who may create it: a visitor
 * subscribes on the status page, whose sign-up route creates the subscriber
 * as root (StatusPageSubscriberService.createFromStatusPageSignUp). Through
 * the API, an anonymous create can read no status page and is answered with
 * a 401.
 */
const CREATES_WITHOUT_PARENT: Array<string> = [
  "StatusPageSubscriber (read through StatusPage) create: Public",
];

/*
 * The models whose shipped readers do not read the record they are read
 * through, so reading it is optional for them (isParentReadOptional): a
 * responder who works alerts reads which incidents their alerts are linked
 * to, the Telemetry tiers read the telemetry configuration of services they
 * do not read in the catalogue, and a person reads the log of the
 * notifications sent to them. A caller who may read the parent is still held
 * to the parents they may read. May only shrink.
 */
const PARENT_READ_OPTIONAL: Array<string> = [
  "IncidentAlert",
  "MetricPipelineRule",
  "TelemetrySourceMap",
  "UserOnCallLog",
  "UserOnCallLogTimeline",
];

const nameOf: (modelType: ModelType) => string = (
  modelType: ModelType,
): string => {
  return new modelType().tableName || modelType.name;
};

const isHeldToTheRule: (permission: Permission) => boolean = (
  permission: Permission,
): boolean => {
  return (
    BUILT_IN_ROLES.has(permission.toString()) ||
    AUTOMATIC_PERMISSIONS.has(permission.toString())
  );
};

// The model a model's rows are read through, if any.
const parentOf: (modelType: ModelType) => ModelType | null = (
  modelType: ModelType,
): ModelType | null => {
  const model: BaseModel = new modelType();

  if (!model.canAccessIfCanReadOn) {
    return null;
  }

  const column: TableColumnMetadata | undefined = model.getTableColumnMetadata(
    model.canAccessIfCanReadOn,
  );

  if (
    !column ||
    !column.modelType ||
    (column.type !== TableColumnType.Entity &&
      column.type !== TableColumnType.EntityArray)
  ) {
    return null;
  }

  return column.modelType as unknown as ModelType;
};

describe("Built-in roles under a write needs a read", () => {
  test("the sweeps cover the shipped roles and the models read through others", () => {
    for (const role of [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentMember,
      Permission.AlertViewer,
      Permission.TelemetryAdmin,
    ]) {
      expect(BUILT_IN_ROLES.has(role.toString())).toBe(true);
    }

    const readThroughParent: Array<string> = MODEL_TYPES.filter(
      (modelType: ModelType): boolean => {
        return Boolean(parentOf(modelType));
      },
    ).map(nameOf);

    // A sweep over nothing would pass while covering nothing.
    expect(readThroughParent.length).toBeGreaterThan(50);
    expect(readThroughParent).toContain("IncidentInternalNote");
    expect(readThroughParent).toContain("StatusPageAnnouncement");
  });

  test("every built-in role that may change or delete a table's records may read them", () => {
    const lines: Array<string> = [];

    for (const modelType of MODEL_TYPES) {
      const model: BaseModel = new modelType();
      const read: Array<string> = (model.readRecordPermissions || []).map(
        String,
      );

      for (const [operation, permissions] of [
        ["update", model.updateRecordPermissions || []],
        ["delete", model.deleteRecordPermissions || []],
      ] as Array<[string, Array<Permission>]>) {
        for (const permission of permissions) {
          if (
            BUILT_IN_ROLES.has(permission.toString()) &&
            !read.includes(permission.toString())
          ) {
            lines.push(`${nameOf(modelType)} ${operation}: ${permission}`);
          }
        }
      }
    }

    expect(lines.sort()).toEqual([...WRITES_WITHOUT_READ].sort());
  });

  test("every built-in role that reaches a model read through another one may read that other one", () => {
    const lines: Array<string> = [];

    for (const modelType of MODEL_TYPES) {
      const parentType: ModelType | null = parentOf(modelType);
      const model: BaseModel = new modelType();

      // Read without the parent by its own readers: the next test.
      if (!parentType || model.isParentReadOptional) {
        continue;
      }

      const parentRead: Array<string> = (
        new parentType().readRecordPermissions || []
      ).map(String);

      for (const [operation, permissions] of [
        ["read", model.readRecordPermissions || []],
        ["update", model.updateRecordPermissions || []],
        ["delete", model.deleteRecordPermissions || []],
      ] as Array<[string, Array<Permission>]>) {
        for (const permission of permissions) {
          if (
            isHeldToTheRule(permission) &&
            !parentRead.includes(permission.toString())
          ) {
            lines.push(
              `${nameOf(modelType)} (read through ${nameOf(
                parentType,
              )}) ${operation}: ${permission}`,
            );
          }
        }
      }
    }

    expect(Array.from(new Set<string>(lines)).sort()).toEqual(
      [...READS_WITHOUT_PARENT].sort(),
    );
  });

  test("every built-in role that may create a model read through another one may read that other one", () => {
    const lines: Array<string> = [];

    for (const modelType of MODEL_TYPES) {
      const parentType: ModelType | null = parentOf(modelType);
      const model: BaseModel = new modelType();

      // Created without the parent by its own creators, as it is read.
      if (!parentType || model.isParentReadOptional) {
        continue;
      }

      const parentRead: Array<string> = (
        new parentType().readRecordPermissions || []
      ).map(String);

      for (const permission of model.createRecordPermissions || []) {
        if (
          isHeldToTheRule(permission) &&
          !parentRead.includes(permission.toString())
        ) {
          lines.push(
            `${nameOf(modelType)} (read through ${nameOf(
              parentType,
            )}) create: ${permission}`,
          );
        }
      }
    }

    expect(Array.from(new Set<string>(lines)).sort()).toEqual(
      [...CREATES_WITHOUT_PARENT].sort(),
    );
  });

  test("only the listed models are read without a read of the record they are read through", () => {
    const optional: Array<string> = MODEL_TYPES.filter(
      (modelType: ModelType): boolean => {
        return Boolean(new modelType().isParentReadOptional);
      },
    ).map(nameOf);

    expect(optional.sort()).toEqual([...PARENT_READ_OPTIONAL].sort());

    // Each is still read through its parent, by whoever may read the parent.
    for (const modelType of MODEL_TYPES) {
      if (PARENT_READ_OPTIONAL.includes(nameOf(modelType))) {
        expect([nameOf(modelType), Boolean(parentOf(modelType))]).toEqual([
          nameOf(modelType),
          true,
        ]);
      }
    }
  });
});
