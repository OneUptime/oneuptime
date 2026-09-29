import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import Permission from "../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * Permission.ProjectUser is held by every member of a project — see
 * AccessTokenService, which adds it once the user's membership is resolved.
 * A model that names it in a read list is therefore saying "anyone in this
 * project may read this", which is right for the furniture of the dashboard
 * (saved views, labels, teams, member rows) and wrong for anything else.
 *
 * That makes the permission unusually easy to misuse: pasting it into one more
 * read list is a one-line change that opens a table to the whole project, and
 * nothing about it looks different from adding any other permission. These
 * sweeps are the review gate.
 *
 * They run over every model rather than over a list, because the failure mode
 * that produced issue #3305 was precisely a model nobody was looking at.
 */

type ModelType = { new (): BaseModel };

const MODEL_TYPES: Array<ModelType> = AllModelTypes as Array<ModelType>;

/*
 * Shared workspace furniture. Every ModelTable in the dashboard mounts its
 * saved views, its label filter and its owner picker, on every domain page —
 * so these four have to be readable by a member whatever their teams grant.
 * They are why issue #3305 happened: a member scoped to one domain got a
 * permission error over the page their role was supposed to give them.
 *
 * Growing this list is a deliberate act. It opens a table, and every column of
 * it an ordinary member can read, to everybody in the project.
 */
const PROJECT_SHARED_MODELS: Array<string> = [
  "Label",
  "TableView",
  "Team",
  "TeamMember",
];

/*
 * Models that named ProjectUser before it was granted to anyone, so these read
 * lists were dead branches until now. Each is load-bearing at sign-in or at app
 * boot: the SSO providers a member is redirected through, and the project
 * record itself.
 *
 * They are held apart from the list above because their columns are a mixed
 * bag - billing figures, SSO secrets and feature flags sit next to the name and
 * the sign-on URL - so the whole-model column rule does not apply to them.
 * Whatever ProjectUser reaches on one of these is what it already declared,
 * column by column.
 *
 * All five reach every member another way already: Project, ProjectSSO and
 * ProjectOIDC name UnAuthorizedSsoUser, which every principal in a project
 * holds, and the two status page providers name Public. Making the grant real
 * changed nothing about who can read them. The test below pins that, because
 * it is the only reason this list is safe to have.
 */
const LEGACY_PROJECT_USER_MODELS: Array<string> = [
  "Project",
  "ProjectOIDC",
  "ProjectSSO",
  "StatusPageOIDC",
  "StatusPageSSO",
];

/*
 * BillingPaymentMethod is the one model where ProjectUser really does open
 * something, and it is deliberate and minimal.
 *
 * The dashboard shell counts this project's payment methods on boot to decide
 * whether to warn that billing is unconfigured; a refusal there is not a
 * missing warning but a PageError in place of the whole app, for exactly the
 * domain-scoped members #3305 is about. A count needs the table and the column
 * it filters on. ProjectUser reaches those two and nothing else - not the card,
 * not the provider ids, not who added it.
 */
const BILLING_COUNT_MODEL: string = "BillingPaymentMethod";
const BILLING_COUNT_COLUMNS: Array<string> = ["projectId"];

/*
 * getColumnAccessControlForAllColumns mirrors the table's own lists onto these
 * four, and ColumnPermissions exempts them from the select check anyway, so
 * they carry whatever the table carries and say nothing about a model.
 */
const COLUMNS_THAT_MIRROR_THE_TABLE: Array<string> = [
  "_id",
  "createdAt",
  "deletedAt",
  "updatedAt",
];

type ModelNameFunction = (modelType: ModelType) => string;

const modelName: ModelNameFunction = (modelType: ModelType): string => {
  return new modelType().tableName || modelType.name;
};

type ColumnAccessControlEntry = {
  column: string;
  accessControl: ColumnAccessControl;
};

type ColumnAccessControlsFunction = (
  model: BaseModel,
) => Array<ColumnAccessControlEntry>;

const columnAccessControls: ColumnAccessControlsFunction = (
  model: BaseModel,
): Array<ColumnAccessControlEntry> => {
  const entries: Array<ColumnAccessControlEntry> = [];

  for (const column of model.getTableColumns().columns) {
    const accessControl: ColumnAccessControl | null =
      model.getColumnAccessControlFor(column);

    if (accessControl) {
      entries.push({ column, accessControl });
    }
  }

  return entries;
};

type HasFunction = (
  permissions: Array<Permission> | undefined,
  permission: Permission,
) => boolean;

const has: HasFunction = (
  permissions: Array<Permission> | undefined,
  permission: Permission,
): boolean => {
  return (permissions || []).includes(permission);
};

describe("Project-shared resources", () => {
  test("the set of models readable by every project member is the reviewed one", () => {
    const shared: Array<string> = [];

    for (const modelType of MODEL_TYPES) {
      const model: BaseModel = new modelType();

      if (has(model.readRecordPermissions, Permission.ProjectUser)) {
        shared.push(modelName(modelType));
      }
    }

    expect(shared.sort()).toEqual(
      [
        ...PROJECT_SHARED_MODELS,
        ...LEGACY_PROJECT_USER_MODELS,
        BILLING_COUNT_MODEL,
      ].sort(),
    );
  });

  /*
   * The legacy list earns its place by not mattering: every model on it is
   * already readable by any principal in the project through Public or
   * UnAuthorizedSsoUser, so ProjectUser changed nothing there. If one of them
   * ever loses that, it is no longer legacy - it is a new grant, and it belongs
   * in the reviewed list above with the column rule applied to it.
   */
  test("the legacy models were already readable by every member anyway", () => {
    const modelsByName: Map<string, ModelType> = new Map(
      MODEL_TYPES.map((modelType: ModelType): [string, ModelType] => {
        return [modelName(modelType), modelType];
      }),
    );

    const noLongerLegacy: Array<string> = [];

    for (const name of LEGACY_PROJECT_USER_MODELS) {
      const modelType: ModelType | undefined = modelsByName.get(name);

      if (!modelType) {
        noLongerLegacy.push(`${name} (no such model)`);
        continue;
      }

      const read: Array<Permission> =
        new modelType().readRecordPermissions || [];

      if (
        !read.includes(Permission.Public) &&
        !read.includes(Permission.UnAuthorizedSsoUser)
      ) {
        noLongerLegacy.push(name);
      }
    }

    expect(noLongerLegacy.sort()).toEqual([]);
  });

  test("ProjectUser reaches the payment-method count and nothing else", () => {
    const modelType: ModelType | undefined = MODEL_TYPES.find(
      (candidate: ModelType) => {
        return modelName(candidate) === BILLING_COUNT_MODEL;
      },
    );

    expect(modelType).toBeDefined();

    const model: BaseModel = new modelType!();

    expect(has(model.readRecordPermissions, Permission.ProjectUser)).toBe(true);

    const reachable: Array<string> = columnAccessControls(model)
      .filter(({ column, accessControl }: ColumnAccessControlEntry) => {
        return (
          !COLUMNS_THAT_MIRROR_THE_TABLE.includes(column) &&
          has(accessControl.read, Permission.ProjectUser)
        );
      })
      .map(({ column }: ColumnAccessControlEntry) => {
        return column;
      });

    expect(reachable.sort()).toEqual(BILLING_COUNT_COLUMNS.slice().sort());
  });

  /*
   * ProjectUser is a read grant and nothing else. If it ever reaches a create,
   * update or delete list, every member of the project can write that table —
   * roles included, since the permission is added on top of whatever the user's
   * teams grant rather than instead of it.
   */
  test("ProjectUser never appears in a create, update or delete list", () => {
    const offenders: Array<string> = [];

    for (const modelType of MODEL_TYPES) {
      const model: BaseModel = new modelType();

      for (const [operation, permissions] of [
        ["create", model.createRecordPermissions],
        ["update", model.updateRecordPermissions],
        ["delete", model.deleteRecordPermissions],
      ] as Array<[string, Array<Permission> | undefined]>) {
        if (has(permissions, Permission.ProjectUser)) {
          offenders.push(`${modelName(modelType)} ${operation}`);
        }
      }

      for (const { column, accessControl } of columnAccessControls(model)) {
        for (const [operation, permissions] of [
          ["create", accessControl.create],
          ["update", accessControl.update],
        ] as Array<[string, Array<Permission> | undefined]>) {
          if (has(permissions, Permission.ProjectUser)) {
            offenders.push(`${modelName(modelType)}.${column} ${operation}`);
          }
        }
      }
    }

    expect(offenders.sort()).toEqual([]);
  });

  /*
   * ProjectUser must never be the permission that makes a column readable. It
   * rides alongside ProjectMember, which means it shows domain-scoped members
   * exactly what an ordinary project member could already see and nothing more.
   *
   * This is the invariant a bulk edit gets wrong: adding the permission to
   * every read list on a model also opens the columns that were deliberately
   * left to administrators (TeamMember.invitationAcceptedAt) or to nobody at
   * all (the deletion audit columns, whose read list is empty on purpose).
   */
  test("ProjectUser only ever accompanies ProjectMember on a read list", () => {
    const offenders: Array<string> = [];

    for (const modelType of MODEL_TYPES) {
      const model: BaseModel = new modelType();

      if (
        has(model.readRecordPermissions, Permission.ProjectUser) &&
        !has(model.readRecordPermissions, Permission.ProjectMember) &&
        !has(model.readRecordPermissions, Permission.Public)
      ) {
        offenders.push(modelName(modelType));
      }

      for (const { column, accessControl } of columnAccessControls(model)) {
        if (
          has(accessControl.read, Permission.ProjectUser) &&
          !has(accessControl.read, Permission.ProjectMember) &&
          !has(accessControl.read, Permission.Public)
        ) {
          offenders.push(`${modelName(modelType)}.${column}`);
        }
      }
    }

    expect(offenders.sort()).toEqual([]);
  });

  /*
   * Passing the table gate is only half of a read. SelectPermission checks the
   * columns the caller asked for against their own read lists, so a shared
   * model whose columns were not brought along returns a permission error on
   * whichever field the page selects — the same failure, one layer down.
   *
   * The check is phrased as "every column an ordinary member can read", so a
   * column added to one of these models later fails here rather than in the
   * dashboard.
   */
  test("every column an ordinary member can read on a shared model is shared too", () => {
    const offenders: Array<string> = [];

    for (const modelType of MODEL_TYPES) {
      const model: BaseModel = new modelType();

      if (!PROJECT_SHARED_MODELS.includes(modelName(modelType))) {
        continue;
      }

      for (const { column, accessControl } of columnAccessControls(model)) {
        if (!has(accessControl.read, Permission.ProjectMember)) {
          continue;
        }

        if (!has(accessControl.read, Permission.ProjectUser)) {
          offenders.push(`${modelName(modelType)}.${column}`);
        }
      }
    }

    expect(offenders.sort()).toEqual([]);
  });

  /*
   * A member's ProjectUser row carries no labels, and AccessControlPermission
   * treats any unrestricted row matching a model's read list as "this caller is
   * not label-restricted here" and drops the label filter entirely. On a table
   * that narrows by label that would hand every member every record, so a
   * shared model must not be one.
   */
  test("no shared model narrows access by label", () => {
    const offenders: Array<string> = [];

    for (const modelType of MODEL_TYPES) {
      const model: BaseModel = new modelType();

      if (!has(model.readRecordPermissions, Permission.ProjectUser)) {
        continue;
      }

      if (model.getAccessControlColumn()) {
        offenders.push(
          `${modelName(modelType)} narrows by ${model.getAccessControlColumn()}`,
        );
      }
    }

    expect(offenders.sort()).toEqual([]);
  });

  /*
   * The dashboard decides whether to offer an affordance from the same declared
   * lists the API enforces (PermissionGate -> hasReadPermissions). Expanding the
   * grant only inside the server's permission check would leave the two
   * disagreeing: the request would succeed while the UI kept the control
   * hidden, which is the failure 836ea41f40 set out to end.
   */
  test("the client's permission gate agrees that a member can read them", () => {
    const disagreements: Array<string> = [];

    for (const modelType of MODEL_TYPES) {
      const model: BaseModel = new modelType();

      if (!has(model.readRecordPermissions, Permission.ProjectUser)) {
        continue;
      }

      if (!model.hasReadPermissions([Permission.ProjectUser])) {
        disagreements.push(modelName(modelType));
      }
    }

    expect(disagreements.sort()).toEqual([]);
  });
});
