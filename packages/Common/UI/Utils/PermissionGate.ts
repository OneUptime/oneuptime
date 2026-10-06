import { CardButtonSchema } from "../Components/Card/Card";
import Dictionary from "../../Types/Dictionary";
import HeldPermissionsUtil, {
  HeldPermissions,
  HeldPermissionsOptions,
} from "../../Types/HeldPermissions";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "../../Types/Permission";
import { ColumnAccessControl } from "../../Types/BaseDatabase/AccessControl";
import PermissionUtil from "./Permission";
import {
  getGlobalTranslator,
  translatableTerm,
  translationKey,
  Translator,
} from "./TranslateTemplate";
import User from "./User";

/*
 * The tooltip's first sentence for each operation, translated whole with the
 * model's name in it. A table that names its own verb ("unlink") gets the
 * verb-and-name template instead.
 */
const MISSING_PERMISSION_TEMPLATES: Record<string, string> = {
  create: translationKey(
    "You do not have permission to create this {{itemName}}.",
  ),
  read: translationKey("You do not have permission to read this {{itemName}}."),
  update: translationKey(
    "You do not have permission to update this {{itemName}}.",
  ),
  delete: translationKey(
    "You do not have permission to delete this {{itemName}}.",
  ),
};

/*
 * The tooltip's second sentence when a team's block is what refuses: the
 * user may well hold one of the permissions the operation asks for, so
 * listing them would only puzzle them.
 */
export const BLOCKED_PERMISSION_TEMPLATE: string = translationKey(
  "A team you are on blocks {{permissions}}.",
);

/*
 * The four record-level operations a user can be gated on. Deliberately not the
 * column-level equivalents: field access control stays hidden rather than
 * disabled, because selecting an unreadable column makes the whole list request
 * fail (see the comment on isPickableColumn in BaseModelTable).
 */
export enum ModelAction {
  Create = "create",
  Read = "read",
  Update = "update",
  Delete = "delete",
}

export interface PermissionGateResult {
  /* Whether the user may perform the operation. */
  isAllowed: boolean;
  /*
   * Why the button is disabled, ready to be shown in a tooltip - or undefined
   * when there is nothing useful to say. `undefined` with `isAllowed: false` is
   * the "do not accuse the user" case: the permission snapshot has not loaded
   * yet, or the model declares no permissions for this operation at all. The
   * caller must HIDE the affordance in that case rather than show a disabled
   * button with an empty reason.
   */
  disabledReason?: string | undefined;
}

/*
 * Structurally typed so that both DatabaseBaseModel and AnalyticsBaseModel
 * satisfy it without a union - the two class hierarchies are unrelated but
 * expose an identical permission API. (Same trick as canCreate in
 * DashboardCommandPaletteHelpers.)
 */
export interface PermissionCheckableModel {
  singularName: string | null;
  hasCreatePermissions: (permissions: Array<Permission>) => boolean;
  hasReadPermissions: (permissions: Array<Permission>) => boolean;
  hasUpdatePermissions: (permissions: Array<Permission>) => boolean;
  hasDeletePermissions: (permissions: Array<Permission>) => boolean;
  getCreatePermissions: () => Array<Permission>;
  getReadPermissions: () => Array<Permission>;
  getUpdatePermissions: () => Array<Permission>;
  getDeletePermissions: () => Array<Permission>;
  /*
   * Set by the @OperationalResource() decorator. Optional here because the
   * analytics models that are not decorated never define it at all.
   */
  isOperationalResource?: boolean | undefined;
}

/*
 * A model that declares column-level access control. Separate from
 * PermissionCheckableModel because column gating answers a different question
 * ("may this field be SELECTED?") and only the database models carry it. The
 * table's own lists, when the model has them, let a column that admits
 * everyone its table does accept the table's operational-resource wildcard,
 * as the server's column check does.
 */
export interface ColumnPermissionCheckableModel {
  getColumnAccessControlForAllColumns: () => Dictionary<ColumnAccessControl>;
  getCreatePermissions?: (() => Array<Permission>) | undefined;
  getReadPermissions?: (() => Array<Permission>) | undefined;
  getUpdatePermissions?: (() => Array<Permission>) | undefined;
  isOperationalResource?: boolean | undefined;
}

// The operations a column declares permissions for.
export type ColumnOperation = "create" | "read" | "update";

export interface PermissionGateOptions extends HeldPermissionsOptions {
  /*
   * Overrides the permissions read from storage with a flat list of
   * permissions held, nothing blocked. Only used by tests and by callers
   * that already hold a snapshot they want every gate on the screen to agree
   * with.
   */
  permissions?: Array<Permission> | undefined;
  /*
   * Overrides the permissions read from storage with a whole snapshot,
   * blocks included (HeldPermissionsUtil.fromRows). Wins over `permissions`.
   */
  held?: HeldPermissions | undefined;
  /*
   * The noun to use in the message when the model's own singularName is not
   * what the user sees on screen ("Monitor" vs "Monitor Template").
   */
  singularName?: string | undefined;
  /*
   * The verb to use in the message when the operation is presented as
   * something other than its own name - a table of links whose delete action
   * is labelled "Unlink", say. Only the wording changes: the permissions
   * checked and listed are still the ones for `action`.
   */
  verb?: string | undefined;
}

/*
 * PermissionHelper.getAllPermissionProps() rebuilds a ~2000 entry array literal
 * on every call, and a gate runs once per action button per render of every
 * table. Build the lookup once per page load instead.
 */
let permissionPropsCache: Dictionary<PermissionProps> | null = null;

type GetPermissionPropsFunction = () => Dictionary<PermissionProps>;

const getPermissionProps: GetPermissionPropsFunction =
  (): Dictionary<PermissionProps> => {
    if (!permissionPropsCache) {
      permissionPropsCache =
        PermissionHelper.getAllPermissionPropsAsDictionary();
    }

    return permissionPropsCache;
  };

/*
 * Decides whether a create / update / delete affordance should be offered, and
 * when it should not, produces the sentence that explains why.
 *
 * Before this existed, every gate in the UI was `if (allowed) { render() }`, so
 * a user without permission saw the button simply not be there - or, worse,
 * saw a fully working create page that only failed at submit with a validation
 * error about a field they never got to fill in (issue #3306). The button now
 * stays on screen, disabled, and says which permission is missing.
 *
 * It is the dashboard's one reader of the permission snapshot for "may the
 * user do this?", by the rule the server follows (Types/HeldPermissions): an
 * allow row grants and a block row never does, a block with no labels on any
 * permission an action accepts refuses it, and an operational resource's own
 * list accepts its *AllOperationalResources wildcard too. Anything that is not
 * a model operation asks holdsAnyOf.
 */
export default class PermissionGate {
  /*
   * What the user holds: the options' snapshot when one is given, else the
   * stored one. Read through PermissionUtil's getAllPermissions (the flat
   * list of what is held, blocks already taken out) and getProjectPermissions
   * (the rows, for the blocks) so a page that mocks the snapshot is read the
   * same way.
   */
  public static getHeldPermissions(
    options?: PermissionGateOptions | undefined,
  ): HeldPermissions {
    if (options?.held) {
      return options.held;
    }

    if (options?.permissions) {
      return HeldPermissionsUtil.fromPermissions(options.permissions);
    }

    const rows: HeldPermissions = HeldPermissionsUtil.fromRows({
      rows: PermissionUtil.getProjectPermissions()?.permissions || [],
    });

    const allowed: Array<Permission> = [
      ...new Set(PermissionUtil.getAllPermissions() || []),
    ].filter((permission: Permission): boolean => {
      return !rows.blocked.includes(permission);
    });

    return {
      allowed: allowed,
      allowedProjectWide: allowed.filter((permission: Permission): boolean => {
        // Held without a project row (globally) reaches the whole project.
        return (
          !rows.allowed.includes(permission) ||
          rows.allowedProjectWide.includes(permission)
        );
      }),
      blocked: rows.blocked,
      blockedForSomeLabels: rows.blockedForSomeLabels,
    };
  }

  /*
   * Whether the permission snapshot has landed - it arrives on an API
   * response header, so it is empty for the first paint after a fresh login
   * and for a moment after the project is switched. Until it lands there is
   * nothing honest to say about what the user may do. Always true for a
   * master admin, who may do everything.
   */
  public static hasPermissionSnapshot(
    options?: PermissionGateOptions | undefined,
  ): boolean {
    return (
      User.isMasterAdmin() || this.isLoaded(this.getHeldPermissions(options))
    );
  }

  /*
   * Whether `held` is a snapshot at all: anything in it, a block included -
   * a member whose every row is a block has a snapshot, and it refuses. An
   * empty one has not landed yet.
   */
  private static isLoaded(held: HeldPermissions): boolean {
    return (
      held.allowed.length > 0 ||
      held.blocked.length > 0 ||
      held.blockedForSomeLabels.length > 0
    );
  }

  /*
   * Whether the user holds one of `permissions`: an allow row for one of
   * them (or for `options.wildcard`) and no block with no labels on any of
   * them. A master admin holds everything; before the snapshot has loaded
   * nobody holds anything. For anything that is not a model operation - a
   * custom route's permission list, a role check.
   */
  public static holdsAnyOf(
    permissions: ReadonlyArray<Permission>,
    options?: PermissionGateOptions | undefined,
  ): boolean {
    if (User.isMasterAdmin()) {
      return true;
    }

    return HeldPermissionsUtil.holdsAnyOf(
      this.getHeldPermissions(options),
      permissions,
      options,
    );
  }

  public static check(
    model: PermissionCheckableModel,
    action: ModelAction,
    options?: PermissionGateOptions | undefined,
  ): PermissionGateResult {
    /*
     * A master admin is allowed everything, everywhere. Every gate in the UI
     * already ORs this in - except the bulk delete one, which is why that gate
     * used to disagree with the per-row Delete button next to it.
     */
    if (User.isMasterAdmin()) {
      return { isAllowed: true };
    }

    const modelPermissions: Array<Permission> = this.getModelPermissions(
      model,
      action,
    );

    /*
     * The model does not support this operation at all (an analytics model with
     * no declared access control reports exactly this). There is no permission
     * the user could be granted to make the button work, so there is nothing
     * worth showing them - hide it, as before.
     */
    if (modelPermissions.length === 0) {
      return { isAllowed: false };
    }

    const held: HeldPermissions = this.getHeldPermissions(options);

    /*
     * The permission snapshot arrives on a response header, so it is empty for
     * the first paint after a fresh login and for a moment after the project is
     * switched. Telling somebody they need a permission they actually hold is
     * worse than briefly not offering the button, so this case stays hidden.
     */
    if (!this.isLoaded(held)) {
      return { isAllowed: false };
    }

    /*
     * The server widens a model's declared permissions with the matching
     * *AllOperationalResources wildcard for anything marked
     * @OperationalResource (TablePermission, and its analytics twin). Without
     * the same step here, somebody granted "Edit All Operational Resources" -
     * and nothing else - was told by every gate in the UI that they could not
     * edit a monitor, an incident or a dashboard, while the API happily
     * accepted the write. The gate must not be stricter than the endpoint it
     * is standing in front of - nor, with a team's block, looser.
     */
    if (this.snapshotAllows(model, action, { ...options, held: held })) {
      return { isAllowed: true };
    }

    return {
      isAllowed: false,
      disabledReason: this.buildMissingPermissionMessage({
        singularName: options?.singularName || model.singularName || "item",
        verb: (options?.verb?.trim() || action).toLowerCase(),
        permissions: modelPermissions,
        held: held,
      }),
    };
  }

  /*
   * Whether the permission snapshot itself allows a model operation - the
   * rule check applies, without its master-admin short circuit: one of the
   * model's permissions (or its operational-resource wildcard) held, and no
   * block with no labels on any of them. For a caller whose layout must not
   * change for a master admin (the table's auto-added bulk Delete).
   */
  public static snapshotAllows(
    model: PermissionCheckableModel,
    action: ModelAction,
    options?: PermissionGateOptions | undefined,
  ): boolean {
    return HeldPermissionsUtil.holdsAnyOf(
      this.getHeldPermissions(options),
      this.getModelPermissions(model, action),
      {
        wildcard: this.getOperationalWildcard(model, action),
      },
    );
  }

  /*
   * Whether the user may change ONE column of a record - a switch that saves
   * that column alone, say. The record's own update gate first (check), and
   * then the column's update permissions, which the server holds every write
   * to as well (ColumnPermission refuses a column the user's permissions do
   * not cover, whatever the table allows). Many columns are narrower than
   * their table: a project's settings columns leave out Manage Billing, and
   * its billing columns leave out Edit Project. Gated on the table alone,
   * such a control works until the save, which the server then refuses.
   *
   * Like check, it never accuses on an empty permission snapshot: it then
   * answers what the record's gate answered (which, on its own, is "not
   * allowed, nothing to say"). A column that declares no update permissions
   * is not judged here either - there is no permission to name - and the
   * server keeps the last word on it.
   */
  public static checkColumnUpdate(
    model: PermissionCheckableModel & ColumnPermissionCheckableModel,
    columnName: string,
    options?: PermissionGateOptions | undefined,
  ): PermissionGateResult {
    const recordGate: PermissionGateResult = this.check(
      model,
      ModelAction.Update,
      options,
    );

    if (!recordGate.isAllowed || User.isMasterAdmin()) {
      return recordGate;
    }

    const columnPermissions: Array<Permission> =
      model.getColumnAccessControlForAllColumns()[columnName]?.update || [];

    const held: HeldPermissions = this.getHeldPermissions(options);

    if (columnPermissions.length === 0 || !this.isLoaded(held)) {
      return recordGate;
    }

    if (
      HeldPermissionsUtil.holdsAnyOf(held, columnPermissions, {
        wildcard: this.getColumnWildcard(model, "update", columnPermissions),
      })
    ) {
      return recordGate;
    }

    return {
      isAllowed: false,
      disabledReason: this.buildMissingPermissionMessage({
        singularName: options?.singularName || model.singularName || "item",
        verb: (options?.verb?.trim() || ModelAction.Update).toLowerCase(),
        permissions: columnPermissions,
        held: held,
      }),
    };
  }

  /*
   * The sentence shown in the tooltip. Deliberately the same phrasing the API
   * returns when it refuses the same operation (see TablePermission on the
   * server) so that the two do not read like different products.
   */
  public static getMissingPermissionMessage(
    model: PermissionCheckableModel,
    action: ModelAction,
    options?: PermissionGateOptions | undefined,
  ): string {
    return this.buildMissingPermissionMessage({
      singularName: options?.singularName || model.singularName || "item",
      verb: (options?.verb?.trim() || action).toLowerCase(),
      permissions: this.getModelPermissions(model, action),
      held: this.getHeldPermissions(options),
    });
  }

  /*
   * "You do not have permission to <verb> this <item>." and, when a team's
   * block is what refuses, "A team you are on blocks ..."; otherwise, when
   * there are permissions to name, "You need one of these permissions: ...".
   */
  private static buildMissingPermissionMessage(data: {
    singularName: string;
    verb: string;
    permissions: Array<Permission>;
    held: HeldPermissions;
  }): string {
    const singularName: string = data.singularName;
    const verb: string = data.verb;

    const translator: Translator = getGlobalTranslator();
    const template: string | undefined = MISSING_PERMISSION_TEMPLATES[verb];

    const sentence: string = template
      ? translator.translateTemplate(template, {
          itemName: translatableTerm(singularName),
        })
      : translator.translateTemplate(
          "You do not have permission to {{action}} this {{itemName}}.",
          {
            action: translatableTerm(verb),
            itemName: translatableTerm(singularName),
          },
        );

    const translateTitles: (permissions: Array<Permission>) => string = (
      permissions: Array<Permission>,
    ): string => {
      return this.getPermissionTitles(permissions)
        .map((title: string): string => {
          return translator.translateText(title) || title;
        })
        .join(", ");
    };

    const blockedPermissions: Array<Permission> = data.permissions.filter(
      (permission: Permission): boolean => {
        return data.held.blocked.includes(permission);
      },
    );

    if (blockedPermissions.length > 0) {
      return `${sentence} ${translator.translateTemplate(
        BLOCKED_PERMISSION_TEMPLATE,
        {
          permissions: translateTitles(blockedPermissions),
        },
      )}`;
    }

    if (this.getPermissionTitles(data.permissions).length === 0) {
      return sentence;
    }

    return `${sentence} ${translator.translateTemplate(
      "You need one of these permissions: {{permissions}}.",
      {
        permissions: translateTitles(data.permissions),
      },
    )}`;
  }

  public static getModelPermissions(
    model: PermissionCheckableModel,
    action: ModelAction,
  ): Array<Permission> {
    switch (action) {
      case ModelAction.Create:
        return model.getCreatePermissions() || [];
      case ModelAction.Read:
        return model.getReadPermissions() || [];
      case ModelAction.Update:
        return model.getUpdatePermissions() || [];
      case ModelAction.Delete:
        return model.getDeletePermissions() || [];
      default:
        return [];
    }
  }

  /*
   * Human titles for a permission list, skipping anything the props table does
   * not know about. PermissionHelper.getTitle throws on an unknown permission,
   * which would take down the whole table for one stale enum value.
   */
  public static getPermissionTitles(
    permissions: Array<Permission>,
  ): Array<string> {
    const props: Dictionary<PermissionProps> = getPermissionProps();
    const titles: Array<string> = [];

    for (const permission of permissions) {
      const permissionProp: PermissionProps | undefined = props[permission];

      if (permissionProp && !titles.includes(permissionProp.title)) {
        titles.push(permissionProp.title);
      }
    }

    return titles;
  }

  /*
   * The wildcard that covers this operation on this model, or null when the
   * model is not an operational resource. Kept out of getModelPermissions on
   * purpose: that list is what the "you need one of these permissions"
   * sentence is built from, and the server names only the model's own
   * permissions there too.
   */
  private static getOperationalWildcard(
    model: PermissionCheckableModel,
    action: ModelAction,
  ): Permission | null {
    return HeldPermissionsUtil.getModelWildcard({
      isOperationalResource: model.isOperationalResource,
      operation: action,
    });
  }

  /*
   * The wildcard a column accepts: the table's, when the column lets in
   * everyone the table does for the operation (HeldPermissionsUtil
   * .getColumnWildcard), as the server's column check reads it.
   */
  private static getColumnWildcard(
    model: ColumnPermissionCheckableModel,
    operation: ColumnOperation,
    columnPermissions: Array<Permission>,
  ): Permission | null {
    let tablePermissions: Array<Permission> = [];

    if (operation === "create") {
      tablePermissions = model.getCreatePermissions?.() || [];
    } else if (operation === "read") {
      tablePermissions = model.getReadPermissions?.() || [];
    } else {
      tablePermissions = model.getUpdatePermissions?.() || [];
    }

    return HeldPermissionsUtil.getColumnWildcard({
      isOperationalResource: model.isOperationalResource,
      operation: operation,
      tablePermissions: tablePermissions,
      columnPermissions: columnPermissions,
    });
  }

  /*
   * Applies a gate to a card button in one line. Several tables replace the
   * built in create modal with a button that routes to a dedicated create
   * page - those bypass ModelTable's own gate entirely, which is how a viewer
   * ended up walking through the whole "Create New Monitor" wizard before
   * being refused (issue #3306).
   *
   * Returns null when the button should not be rendered at all, which is only
   * the "nothing honest to say" case: the permission snapshot has not landed,
   * or the model declares no permissions for the operation.
   */
  public static gateCardButton(
    button: CardButtonSchema,
    model: PermissionCheckableModel,
    action: ModelAction,
    options?: PermissionGateOptions | undefined,
  ): CardButtonSchema | null {
    const result: PermissionGateResult = this.check(model, action, options);

    if (result.isAllowed) {
      return button;
    }

    if (!result.disabledReason) {
      return null;
    }

    return {
      ...button,
      disabled: true,
      tooltip: result.disabledReason,
      onClick: () => {
        // Locked. The tooltip says which permission is missing.
      },
    };
  }

  /*
   * Whether the signed-in user may SELECT a column.
   *
   * Column access control is enforced differently from record access control:
   * asking for a column you cannot read is not degraded, it is fatal.
   * ColumnPermission throws `User is not allowed to read on <column> column of
   * <model>` and the whole request fails, so one unreadable field in a select
   * takes down the entire page rather than blanking one value. That is why
   * ModelAction has no column-level members (see the comment on the enum) and
   * why callers must ask this BEFORE building the select, not after.
   *
   * Asked the way the server's column check asks it (ColumnPermission): an
   * allow row for one of the column's permissions, no block with no labels
   * on any of them, and the table's wildcard for a column that admits
   * everyone its table does.
   *
   * Deliberately fails closed. When the permission snapshot has not landed yet
   * this returns false and the caller omits the field: the page renders
   * without that one value, which is recoverable. Failing open would send the
   * column anyway and hard-fail the request, which is not.
   *
   * A column with no declared read ACL is readable - there is nothing to
   * enforce, and ColumnPermission agrees.
   */
  public static canReadColumn(
    model: ColumnPermissionCheckableModel,
    columnName: string,
    options?: PermissionGateOptions | undefined,
  ): boolean {
    if (User.isMasterAdmin()) {
      return true;
    }

    const accessControl: ColumnAccessControl | undefined =
      model.getColumnAccessControlForAllColumns()[columnName];

    const columnPermissions: Array<Permission> = accessControl?.read || [];

    if (columnPermissions.length === 0) {
      return true;
    }

    return HeldPermissionsUtil.holdsAnyOf(
      this.getHeldPermissions(options),
      columnPermissions,
      {
        wildcard: this.getColumnWildcard(model, "read", columnPermissions),
      },
    );
  }

  /*
   * Whether the user may read, create or update one column, exactly as the
   * server's column check decides it (ColumnPermission): an allow row for
   * one of the column's permissions for the operation - Public counts for
   * everyone, as the server adds it - no block with no labels on any of
   * them, and the table's wildcard for a column that admits everyone its
   * table does. A column that names no permission for the operation is
   * closed to everyone. Before the snapshot has loaded only Public is held -
   * a public form still shows its fields to a visitor - so a caller that
   * wants the server to decide until then asks hasPermissionSnapshot first.
   */
  public static holdsColumnPermission(
    model: ColumnPermissionCheckableModel,
    columnName: string,
    operation: ColumnOperation,
    options?: PermissionGateOptions | undefined,
  ): boolean {
    if (User.isMasterAdmin()) {
      return true;
    }

    const columnPermissions: Array<Permission> =
      model.getColumnAccessControlForAllColumns()[columnName]?.[operation] ||
      [];

    if (columnPermissions.length === 0) {
      return false;
    }

    const held: HeldPermissions = this.getHeldPermissions(options);

    return HeldPermissionsUtil.holdsAnyOf(
      {
        ...held,
        allowed: [...held.allowed, Permission.Public],
        allowedProjectWide: [...held.allowedProjectWide, Permission.Public],
      },
      columnPermissions,
      {
        wildcard: this.getColumnWildcard(model, operation, columnPermissions),
      },
    );
  }

  /*
   * Whether a form can offer a picker for a relation column: the user may
   * read the column (the picked record is shown and saved through it) AND
   * may list the records the picker offers, which takes reading that other
   * model. A column is read with its own record's permission, so reading it
   * does not mean the picker's list may be read: offered to somebody who may
   * not list the related records, the picker's request is refused and the
   * field can never be filled. Fails closed like canReadColumn.
   */
  public static canPickRelation(
    model: ColumnPermissionCheckableModel,
    columnName: string,
    relatedModel: PermissionCheckableModel,
    options?: PermissionGateOptions | undefined,
  ): boolean {
    return (
      this.canReadColumn(model, columnName, options) &&
      this.check(relatedModel, ModelAction.Read, options).isAllowed
    );
  }

  /* Test seam - the props lookup is memoized for the lifetime of the page. */
  public static clearPermissionPropsCache(): void {
    permissionPropsCache = null;
  }
}
