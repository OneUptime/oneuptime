import { CardButtonSchema } from "../Components/Card/Card";
import Dictionary from "../../Types/Dictionary";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "../../Types/Permission";
import { ColumnAccessControl } from "../../Types/BaseDatabase/AccessControl";
import PermissionUtil from "./Permission";
import User from "./User";

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
}

/*
 * A model that declares column-level access control. Separate from
 * PermissionCheckableModel because column gating answers a different question
 * ("may this field be SELECTED?") and only the database models carry it.
 */
export interface ColumnPermissionCheckableModel {
  getColumnAccessControlForAllColumns: () => Dictionary<ColumnAccessControl>;
}

export interface PermissionGateOptions {
  /*
   * Overrides the permissions read from storage. Only used by tests and by
   * callers that already hold a snapshot they want every gate on the screen to
   * agree with.
   */
  permissions?: Array<Permission> | undefined;
  /*
   * The noun to use in the message when the model's own singularName is not
   * what the user sees on screen ("Monitor" vs "Monitor Template").
   */
  singularName?: string | undefined;
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
 */
export default class PermissionGate {
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

    const userPermissions: Array<Permission> =
      options?.permissions ?? PermissionUtil.getAllPermissions();

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

    /*
     * The permission snapshot arrives on a response header, so it is empty for
     * the first paint after a fresh login and for a moment after the project is
     * switched. Telling somebody they need a permission they actually hold is
     * worse than briefly not offering the button, so this case stays hidden.
     */
    if (userPermissions.length === 0) {
      return { isAllowed: false };
    }

    if (this.hasPermission(model, action, userPermissions)) {
      return { isAllowed: true };
    }

    return {
      isAllowed: false,
      disabledReason: this.getMissingPermissionMessage(model, action, options),
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
    const singularName: string =
      options?.singularName || model.singularName || "item";

    const titles: Array<string> = this.getPermissionTitles(
      this.getModelPermissions(model, action),
    );

    if (titles.length === 0) {
      return `You do not have permission to ${action} this ${singularName}.`;
    }

    return `You do not have permission to ${action} this ${singularName}. You need one of these permissions: ${titles.join(
      ", ",
    )}.`;
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

  private static hasPermission(
    model: PermissionCheckableModel,
    action: ModelAction,
    userPermissions: Array<Permission>,
  ): boolean {
    switch (action) {
      case ModelAction.Create:
        return model.hasCreatePermissions(userPermissions);
      case ModelAction.Read:
        return model.hasReadPermissions(userPermissions);
      case ModelAction.Update:
        return model.hasUpdatePermissions(userPermissions);
      case ModelAction.Delete:
        return model.hasDeletePermissions(userPermissions);
      default:
        return false;
    }
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

    const userPermissions: Array<Permission> =
      options?.permissions ?? PermissionUtil.getAllPermissions();

    return PermissionHelper.doesPermissionsIntersect(
      userPermissions,
      columnPermissions,
    );
  }

  /* Test seam - the props lookup is memoized for the lifetime of the page. */
  public static clearPermissionPropsCache(): void {
    permissionPropsCache = null;
  }
}
