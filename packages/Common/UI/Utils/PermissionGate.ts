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
import PrivateRecordHeld from "../../Types/PrivateRecord/PrivateRecordHeld";
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
 * THE TOOLTIP'S SECOND SENTENCE: WHAT WOULD ALLOW IT, IN AS FEW NAMES AS
 * TELL THE READER WHAT TO ASK FOR.
 *
 * A model's list of what may do an operation names the built-in roles that
 * may - Project Owner, Project Admin, Project Member, Incident Admin,
 * Incident Member - and, in all but a few lists, one permission of its own:
 * Create Incident Team Owner. Every lock in the product used to recite the
 * whole list ("You need one of these permissions: Project Owner, Project
 * Admin, Project Member, Incident Admin, Incident Member, Create Incident
 * Team Owner."), a paragraph in a tooltip, the list of locked owner kinds
 * and a locked switch's line alike. The roles tell the reader nothing the
 * permission does not: a role holds every permission of its product, and
 * whoever gives the reader access gives the permission or a role that
 * holds it. So a lock names the list's own permissions - the ones a team
 * or a custom role can be given (isAssignableToTenant) - and the roles
 * only when the list has nothing else to name: an External MCP Server is
 * added by Project Owners and Project Admins alone.
 *
 * One name is worded as several are, after a colon ("You need this
 * permission: Create Incident Team Owner."): set apart from the sentence,
 * the name to ask for is easy to pick out, whatever it ends with ("Edit
 * Team Permissions"), and each language keeps the English title out of its
 * grammar, as its plural sentence already does.
 *
 * The API's refusals still name every permission (TablePermission on the
 * server): an API key's owner reads them to grant the key exactly what it
 * needs.
 */
export const NEEDS_PERMISSION_TEMPLATE: string = translationKey(
  "You need this permission: {{permission}}.",
);

export const NEEDS_ONE_OF_PERMISSIONS_TEMPLATE: string = translationKey(
  "You need one of these permissions: {{permissions}}.",
);

export const NEEDS_ROLE_TEMPLATE: string = translationKey(
  "You need this role: {{role}}.",
);

export const NEEDS_ONE_OF_ROLES_TEMPLATE: string = translationKey(
  "You need one of these roles: {{roles}}.",
);

// What a lock names: the permissions' titles in English, and of what kind.
export interface PermissionsToName {
  titles: Array<string>;
  // Built-in roles' names: the list named nothing of its own.
  areRoles: boolean;
}

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

/*
 * A form field, as far as what it writes goes (Forms/Types/Field and
 * ModelForm's ModelField): the column it edits, and the ways a field can
 * stand for something other than one column.
 */
export interface PermissionCheckableFormField {
  field?: Record<string, unknown> | undefined;
  overrideField?: unknown;
  peoplePicker?: unknown;
  showEvenIfPermissionDoesNotExist?: boolean | undefined;
}

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
  /*
   * Why the private record the page is open on refuses what the reader's
   * own permissions would allow, in their language (PrivateRecordScope):
   * `held` is then what they hold on that record, and a refusal of it that
   * their whole snapshot would allow says this instead of naming a
   * permission they hold.
   */
  privateRecordReason?: string | undefined;
  /*
   * The message's first sentence, whole - one translation key - when the
   * reader knows the operation by what it does rather than by its model: a
   * new row on an incident's state timeline is "change this incident's
   * state" to someone pressing Acknowledge. It takes the place of "You do
   * not have permission to <verb> this <item>."; the permissions that would
   * allow it, or the team block that refuses it, follow as usual.
   */
  sentence?: string | undefined;
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
   * Whether `held` is a snapshot at all (HeldPermissionsUtil.isLoaded):
   * anything in it, a block included - a member whose every row is a block
   * has a snapshot, and it refuses. An empty one has not landed yet.
   */
  private static isLoaded(held: HeldPermissions): boolean {
    return HeldPermissionsUtil.isLoaded(held);
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
     * Who reads a private record is its owners, with any read permission of
     * theirs: only its changes are held to the teams that own it. A read is
     * asked of the whole snapshot (PrivateRecordScope) - also while the page
     * is still reading who owns the record, when its scope has no reason yet.
     */
    if (
      action === ModelAction.Read &&
      options?.privateRecordReason !== undefined
    ) {
      options = {
        ...options,
        held: undefined,
        privateRecordReason: undefined,
      };
    }

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

    /*
     * Refused on a private record that the reader's own permissions would
     * allow: the teams of theirs that own it may not (PrivateRecordScope).
     * Said so - naming a permission they hold would only puzzle them.
     */
    if (
      options?.privateRecordReason &&
      this.snapshotAllows(model, action, {
        ...options,
        held: undefined,
        permissions: undefined,
      })
    ) {
      return {
        isAllowed: false,
        disabledReason: `${this.buildFirstSentence({
          singularName: options?.singularName || model.singularName || "item",
          verb: (options?.verb?.trim() || action).toLowerCase(),
          sentence: options?.sentence,
        })} ${options.privateRecordReason}`,
      };
    }

    return {
      isAllowed: false,
      disabledReason: this.buildMissingPermissionMessage({
        singularName: options?.singularName || model.singularName || "item",
        verb: (options?.verb?.trim() || action).toLowerCase(),
        sentence: options?.sentence,
        permissions: modelPermissions,
        held: held,
      }),
    };
  }

  /*
   * WHAT THE READER HOLDS ON ONE PRIVATE RECORD (PrivateRecordHeld): null
   * when it is all they hold - a record that is not private, one they are
   * named an owner of, a reader who acts on every private record of the
   * project or a master admin - and otherwise what the rows of the teams of
   * theirs that own it hold. Read from the stored snapshot, as every gate
   * reads it; the page open on the record hands it to its gates
   * (PrivateRecordScope).
   */
  public static getHeldOnPrivateRecord(data: {
    isPrivate: boolean;
    isOwnedByReader: boolean;
    owningTeamIds: ReadonlyArray<string>;
  }): HeldPermissions | null {
    if (User.isMasterAdmin()) {
      return null;
    }

    return PrivateRecordHeld.getHeldOnRecord({
      rows: PermissionUtil.getProjectPermissions()?.permissions || [],
      globalPermissions:
        PermissionUtil.getGlobalPermissions()?.globalPermissions || [],
      isPrivate: data.isPrivate,
      isOwnedByPerson: data.isOwnedByReader,
      owningTeamIds: data.owningTeamIds,
    });
  }

  /*
   * The ids of the teams the reader's permissions are granted on
   * (UserPermission.teamId), as the stored snapshot names them: the teams
   * whose permissions they act with.
   */
  public static getTeamIdsOfReader(): Array<string> {
    const teamIds: Array<string> = [];

    for (const row of PermissionUtil.getProjectPermissions()?.permissions ||
      []) {
      const teamId: string | null = PrivateRecordHeld.getId(row?.teamId);

      if (teamId && !teamIds.includes(teamId.toLowerCase())) {
        teamIds.push(teamId.toLowerCase());
      }
    }

    return teamIds;
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
    return HeldPermissionsUtil.holdsModelPermission(
      this.getHeldPermissions(options),
      {
        isOperationalResource: model.isOperationalResource,
        operation: action,
        modelPermissions: this.getModelPermissions(model, action),
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
   * server keeps the last word on it. Refused by the record's own gate, it
   * names the permissions that would open the column, not every one that
   * opens the record (narrowRecordRefusalToColumn).
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

    if (User.isMasterAdmin()) {
      return recordGate;
    }

    const columnPermissions: Array<Permission> =
      model.getColumnAccessControlForAllColumns()[columnName]?.update || [];

    if (!recordGate.isAllowed) {
      return this.narrowRecordRefusalToColumn({
        model: model,
        recordGate: recordGate,
        columnPermissions: columnPermissions,
        options: options,
      });
    }

    const held: HeldPermissions = this.getHeldPermissions(options);

    if (columnPermissions.length === 0 || !this.isLoaded(held)) {
      return recordGate;
    }

    if (
      HeldPermissionsUtil.holdsColumnPermission(held, {
        isOperationalResource: model.isOperationalResource,
        operation: "update",
        tablePermissions: this.getTablePermissions(model, "update"),
        columnPermissions: columnPermissions,
      })
    ) {
      return recordGate;
    }

    return {
      isAllowed: false,
      disabledReason: this.buildMissingPermissionMessage({
        singularName: options?.singularName || model.singularName || "item",
        verb: (options?.verb?.trim() || ModelAction.Update).toLowerCase(),
        sentence: options?.sentence,
        permissions: columnPermissions,
        held: held,
      }),
    };
  }

  /*
   * A column switch refused because the record's own gate refuses - a
   * Viewer, say - names what would let the reader change THIS column: the
   * column's update permissions that open the record too. A column is often
   * narrower than its record: "An incident can be in only one episode" is
   * for a project's owners and admins, while a project as a whole may also
   * be updated by its billing roles and Edit Project - and the lock under
   * that switch used to send a Viewer to Billing Admin, which would not have
   * let them flip it. A column whose permissions are its record's, or that
   * declares none, or whose permissions open no part of the record, keeps
   * the record's answer, as does one with nothing to say (no snapshot yet).
   */
  private static narrowRecordRefusalToColumn(data: {
    model: PermissionCheckableModel & ColumnPermissionCheckableModel;
    recordGate: PermissionGateResult;
    columnPermissions: Array<Permission>;
    options?: PermissionGateOptions | undefined;
  }): PermissionGateResult {
    if (
      !data.recordGate.disabledReason ||
      data.columnPermissions.length === 0
    ) {
      return data.recordGate;
    }

    const recordPermissions: Array<Permission> = this.getModelPermissions(
      data.model,
      ModelAction.Update,
    );

    const opening: Array<Permission> = data.columnPermissions.filter(
      (permission: Permission): boolean => {
        return recordPermissions.includes(permission);
      },
    );

    const isNarrower: boolean =
      opening.length > 0 &&
      recordPermissions.some((permission: Permission): boolean => {
        return !opening.includes(permission);
      });

    if (!isNarrower) {
      return data.recordGate;
    }

    return {
      isAllowed: false,
      disabledReason: this.buildMissingPermissionMessage({
        singularName:
          data.options?.singularName || data.model.singularName || "item",
        verb: (data.options?.verb?.trim() || ModelAction.Update).toLowerCase(),
        sentence: data.options?.sentence,
        permissions: opening,
        held: this.getHeldPermissions(data.options),
      }),
    };
  }

  /*
   * Whether an edit form over a record may be offered: the record's own
   * update gate (check), and then at least one of the form's columns. The
   * form leaves out every field its viewer may not update (ModelForm weighs
   * each by holdsColumnPermission), so a form none of whose columns the
   * viewer may change opens empty and saves nothing. Many records' columns
   * are narrower than the record: a project's name is for its owners,
   * Manage Billing and Edit Project, its retention settings for owners and
   * admins, its notification channels for owners, Billing Admins and Manage
   * Billing - while the Project's own list lets in all of them.
   *
   * Refused that way, the reason names every permission that would open at
   * least one of the columns. A form with a field that is not a plain
   * column (getFormUpdateColumns answers null) is left to the record gate,
   * and the server checks what is written. Like check, it never accuses
   * anyone before the permission snapshot has landed.
   */
  public static checkFormUpdate(
    model: PermissionCheckableModel & ColumnPermissionCheckableModel,
    fields: ReadonlyArray<PermissionCheckableFormField> | undefined,
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

    const columns: Array<string> | null = this.getFormUpdateColumns(fields);

    if (!columns || columns.length === 0) {
      return recordGate;
    }

    const held: HeldPermissions = this.getHeldPermissions(options);

    if (!this.isLoaded(held)) {
      return recordGate;
    }

    const mayChangeOne: boolean = columns.some((column: string): boolean => {
      return this.holdsColumnPermission(model, column, "update", {
        ...options,
        held: held,
      });
    });

    if (mayChangeOne) {
      return recordGate;
    }

    const opening: Array<Permission> = [];

    for (const column of columns) {
      for (const permission of model.getColumnAccessControlForAllColumns()[
        column
      ]?.update || []) {
        if (!opening.includes(permission)) {
          opening.push(permission);
        }
      }
    }

    return {
      isAllowed: false,
      disabledReason: this.buildMissingPermissionMessage({
        singularName: options?.singularName || model.singularName || "item",
        verb: (options?.verb?.trim() || ModelAction.Update).toLowerCase(),
        sentence: options?.sentence,
        permissions: opening,
        held: held,
      }),
    };
  }

  /*
   * The model columns an edit form writes, as ModelForm weighs them: the
   * key of each field's `field`. Null when a field is anything else - a
   * people picker, an overridden key, a field without a column, or one
   * shown whatever the permission - so the form cannot be judged by its
   * columns alone.
   */
  public static getFormUpdateColumns(
    fields: ReadonlyArray<PermissionCheckableFormField> | undefined,
  ): Array<string> | null {
    const columns: Array<string> = [];

    for (const field of fields || []) {
      if (
        field.peoplePicker ||
        field.overrideField ||
        field.showEvenIfPermissionDoesNotExist ||
        !field.field
      ) {
        return null;
      }

      const keys: Array<string> = Object.keys(field.field);

      if (keys.length !== 1) {
        return null;
      }

      if (!columns.includes(keys[0]!)) {
        columns.push(keys[0]!);
      }
    }

    return columns;
  }

  /*
   * A gate over a list somebody chose by hand rather than a model's own - a
   * custom route's permission list, such as who may run a workflow
   * (Types/Workflow/WorkflowRunPermissions) - read by the rule check follows:
   * an allow row for one of `permissions` (or for `options.wildcard`, when
   * the list is an operational resource's own) and no block with no labels
   * on any of them. A master admin is allowed; nobody is told they lack a
   * permission before the snapshot has landed.
   *
   * Refused, the reason is `sentence` - a whole sentence saying what the
   * user may not do, looked up as one translation key - followed by the
   * permissions that would let them, or by the team block that stops them,
   * as check words its own.
   */
  public static checkPermissions(
    permissions: ReadonlyArray<Permission>,
    options: PermissionGateOptions & { sentence: string },
  ): PermissionGateResult {
    if (User.isMasterAdmin()) {
      return { isAllowed: true };
    }

    if (permissions.length === 0) {
      return { isAllowed: false };
    }

    const held: HeldPermissions = this.getHeldPermissions(options);

    if (!this.isLoaded(held)) {
      return { isAllowed: false };
    }

    if (HeldPermissionsUtil.holdsAnyOf(held, permissions, options)) {
      return { isAllowed: true };
    }

    const translator: Translator = getGlobalTranslator();

    return {
      isAllowed: false,
      disabledReason: this.appendPermissionsToSentence({
        sentence:
          translator.translateText(options.sentence) || options.sentence,
        permissions: [...permissions],
        held: held,
      }),
    };
  }

  /*
   * The sentence shown in the tooltip. Its first sentence is the API's when
   * it refuses the same operation (see TablePermission on the server), so
   * that the two do not read like different products; its second names
   * fewer permissions than the API's (getPermissionsToName).
   */
  public static getMissingPermissionMessage(
    model: PermissionCheckableModel,
    action: ModelAction,
    options?: PermissionGateOptions | undefined,
  ): string {
    return this.buildMissingPermissionMessage({
      singularName: options?.singularName || model.singularName || "item",
      verb: (options?.verb?.trim() || action).toLowerCase(),
      sentence: options?.sentence,
      permissions: this.getModelPermissions(model, action),
      held: this.getHeldPermissions(options),
    });
  }

  /*
   * "You do not have permission to <verb> this <item>." - or the caller's
   * own whole sentence - and, when a team's block is what refuses, "A team
   * you are on blocks ..."; otherwise, when there are permissions to name,
   * what would allow it ("You need this permission: Create Monitor.").
   */
  private static buildMissingPermissionMessage(data: {
    singularName: string;
    verb: string;
    sentence?: string | undefined;
    permissions: Array<Permission>;
    held: HeldPermissions;
  }): string {
    return this.appendPermissionsToSentence({
      sentence: this.buildFirstSentence(data),
      permissions: data.permissions,
      held: data.held,
    });
  }

  /*
   * A refusal's first sentence, in the reader's language: "You do not have
   * permission to <verb> this <item>." - or the caller's own whole sentence.
   */
  private static buildFirstSentence(data: {
    singularName: string;
    verb: string;
    sentence?: string | undefined;
  }): string {
    const singularName: string = data.singularName;
    const verb: string = data.verb;

    const translator: Translator = getGlobalTranslator();
    const template: string | undefined = MISSING_PERMISSION_TEMPLATES[verb];
    const ownSentence: string = data.sentence?.trim() || "";

    return ownSentence
      ? translator.translateText(ownSentence) || ownSentence
      : template
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
  }

  /*
   * A refusal for a gate of a caller's own - a column a control writes
   * alone, the columns of a settings card - worded as every lock words its
   * own: the caller's first sentence (a translation key, looked up whole),
   * then the team block that refuses it, or what would allow it
   * (getNeededPermissionsSentence). The caller has decided the reader may
   * not; this only says why.
   */
  public static getRefusalReason(data: {
    sentence: string;
    permissions: ReadonlyArray<Permission>;
    options?: PermissionGateOptions | undefined;
  }): string {
    const translator: Translator = getGlobalTranslator();

    return this.appendPermissionsToSentence({
      sentence: translator.translateText(data.sentence) || data.sentence,
      permissions: [...data.permissions],
      held: this.getHeldPermissions(data.options),
    });
  }

  /*
   * A refusal's first sentence, already in the reader's language, then -
   * when a team's block is what refuses - "A team you are on blocks ...";
   * otherwise, when there are permissions to name, what would allow it
   * (getNeededPermissionsSentence).
   */
  private static appendPermissionsToSentence(data: {
    sentence: string;
    permissions: Array<Permission>;
    held: HeldPermissions;
  }): string {
    const sentence: string = data.sentence;
    const translator: Translator = getGlobalTranslator();

    const blockedPermissions: Array<Permission> = data.permissions.filter(
      (permission: Permission): boolean => {
        return data.held.blocked.includes(permission);
      },
    );

    if (blockedPermissions.length > 0) {
      return `${sentence} ${translator.translateTemplate(
        BLOCKED_PERMISSION_TEMPLATE,
        {
          permissions: this.translateTitles(
            this.getPermissionTitles(blockedPermissions),
            translator,
          ),
        },
      )}`;
    }

    const needed: string = this.getNeededPermissionsSentence(
      data.permissions,
      translator,
    );

    return needed ? `${sentence} ${needed}` : sentence;
  }

  /*
   * What a lock names of a list of permissions that would allow it, in the
   * list's order (see NEEDS_PERMISSION_TEMPLATE): the permissions of its
   * own that a team or a custom role can be given; the built-in roles when
   * it has none; and when it has neither (Public, Logged in User), every
   * title it has, as before. Unknown permissions are skipped
   * (getPermissionTitles).
   */
  public static getPermissionsToName(
    permissions: ReadonlyArray<Permission>,
  ): PermissionsToName {
    const props: Dictionary<PermissionProps> = getPermissionProps();

    const own: Array<Permission> = permissions.filter(
      (permission: Permission): boolean => {
        const permissionProps: PermissionProps | undefined = props[permission];

        return Boolean(
          permissionProps &&
            !permissionProps.isRolePermission &&
            permissionProps.isAssignableToTenant,
        );
      },
    );

    if (own.length > 0) {
      return { titles: this.getPermissionTitles(own), areRoles: false };
    }

    const roles: Array<Permission> = permissions.filter(
      (permission: Permission): boolean => {
        return Boolean(props[permission]?.isRolePermission);
      },
    );

    if (roles.length > 0) {
      return { titles: this.getPermissionTitles(roles), areRoles: true };
    }

    return {
      titles: this.getPermissionTitles([...permissions]),
      areRoles: false,
    };
  }

  /*
   * The sentence after a refusal's first that says what would allow it, in
   * the reader's language: "You need this permission: Create Incident Team
   * Owner.", "You need one of these permissions: Manage Billing, Edit
   * Project.", "You need one of these roles: Project Owner, Project Admin."
   * A built-in role's name reads as the role picker draws it; a
   * permission's own title as it is. Empty when there is nothing to name.
   */
  public static getNeededPermissionsSentence(
    permissions: ReadonlyArray<Permission>,
    translator?: Translator | undefined,
  ): string {
    const words: Translator = translator || getGlobalTranslator();
    const named: PermissionsToName = this.getPermissionsToName(permissions);

    if (named.titles.length === 0) {
      return "";
    }

    const titles: string = this.translateTitles(named.titles, words);

    if (named.areRoles) {
      return named.titles.length === 1
        ? words.translateTemplate(NEEDS_ROLE_TEMPLATE, { role: titles })
        : words.translateTemplate(NEEDS_ONE_OF_ROLES_TEMPLATE, {
            roles: titles,
          });
    }

    return named.titles.length === 1
      ? words.translateTemplate(NEEDS_PERMISSION_TEMPLATE, {
          permission: titles,
        })
      : words.translateTemplate(NEEDS_ONE_OF_PERMISSIONS_TEMPLATE, {
          permissions: titles,
        });
  }

  /*
   * Titles as a sentence lists them: each looked up (a built-in role's
   * name has a translation of its own; most permissions' titles do not and
   * read as given), joined with commas.
   */
  private static translateTitles(
    titles: ReadonlyArray<string>,
    translator: Translator,
  ): string {
    return titles
      .map((title: string): string => {
        return translator.translateText(title) || title;
      })
      .join(", ");
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
   * The table's own list for an operation, which decides whether a column
   * that lets in everyone it does accepts the table's operational-resource
   * wildcard (HeldPermissionsUtil.getColumnWildcard), as the server's column
   * check reads it.
   */
  private static getTablePermissions(
    model: ColumnPermissionCheckableModel,
    operation: ColumnOperation,
  ): Array<Permission> {
    if (operation === "create") {
      return model.getCreatePermissions?.() || [];
    }

    if (operation === "read") {
      return model.getReadPermissions?.() || [];
    }

    return model.getUpdatePermissions?.() || [];
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
   * Whether the signed-in user may SELECT a column - the one rule every
   * table, detail, form and page asks before building a select.
   *
   * Column access control is enforced differently from record access control:
   * asking for a column you cannot read is not degraded, it is fatal.
   * SelectPermission refuses the whole request for one column the caller may
   * not read, so one unreadable field in a select takes down the entire page
   * rather than blanking one value. That is why ModelAction has no
   * column-level members (see the comment on the enum) and why callers must
   * ask this BEFORE building the select, not after.
   *
   * Asked the way the server asks it (HeldPermissionsUtil.canSelectColumn):
   * a column the server never checks (_id, createdAt, updatedAt, deletedAt,
   * version) when the model declares no read rule for it - a database model
   * gives them its own read list, which is then followed - and any other
   * column by holdsColumnPermission: one of its read permissions held,
   * Public by everyone, no block with no labels on any of them, the table's
   * wildcard for a column that admits everyone its table does, and a column
   * that declares no read permission closed, as the server closes it.
   *
   * Deliberately fails closed. When the permission snapshot has not landed yet
   * only Public is held and the caller omits the rest: the page renders
   * without those values, which is recoverable. Failing open would send the
   * column anyway and hard-fail the request, which is not.
   */
  public static canReadColumn(
    model: ColumnPermissionCheckableModel,
    columnName: string,
    options?: PermissionGateOptions | undefined,
  ): boolean {
    if (User.isMasterAdmin()) {
      return true;
    }

    return HeldPermissionsUtil.canSelectColumn(
      this.getHeldPermissions(options),
      {
        column: columnName,
        isOperationalResource: model.isOperationalResource,
        tablePermissions: this.getTablePermissions(model, "read"),
        readPermissions:
          model.getColumnAccessControlForAllColumns()[columnName]?.read,
      },
    );
  }

  /*
   * Whether the user may read, create or update one column, exactly as the
   * server's column check decides it (HeldPermissionsUtil
   * .holdsColumnPermission, which ColumnPermission asks too): an allow row
   * for one of the column's permissions for the operation - Public counts
   * for everyone, as the server adds it - no block with no labels on any of
   * them, and the table's wildcard for a column that admits everyone its
   * table does. A column that names no permission for the operation is
   * closed to everyone. Before the snapshot has loaded only Public is held -
   * a public form still shows its fields to a visitor - so a caller that
   * wants the server to decide until then asks hasPermissionSnapshot first.
   * A select asks canReadColumn, which adds the columns every select may
   * name.
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

    return HeldPermissionsUtil.holdsColumnPermission(
      this.getHeldPermissions(options),
      {
        isOperationalResource: model.isOperationalResource,
        operation: operation,
        tablePermissions: this.getTablePermissions(model, operation),
        columnPermissions: columnPermissions,
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
