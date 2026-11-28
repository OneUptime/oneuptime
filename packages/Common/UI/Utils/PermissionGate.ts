import { CardButtonSchema } from "../Components/Card/Card";
import Dictionary from "../../Types/Dictionary";
import HeldPermissionsUtil, {
  HeldPermissions,
  HeldPermissionsOptions,
  TeamGrants,
} from "../../Types/HeldPermissions";
import ObjectID from "../../Types/ObjectID";
import Permission, {
  PermissionHelper,
  PermissionProps,
  UserPermission,
  UserTenantAccessPermission,
} from "../../Types/Permission";
import { isProductLevelPermission } from "../../Types/Product/ProductLevels";
import { ColumnAccessControl } from "../../Types/BaseDatabase/AccessControl";
import Select from "../../Types/BaseDatabase/Select";
import PermissionScope from "../../Types/Database/AccessControl/PermissionScope";
import RelationReadersUtil from "../../Types/Database/RelationReadersUtil";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import PermissionUtil from "./Permission";
import { getListSeparator } from "./ListSeparator";
import { joinSentences } from "./SentenceSeparator";
import PrivateRecordHeld from "../../Types/PrivateRecord/PrivateRecordHeld";
import LabelAccess, {
  LabelGrant,
  LabelReach,
  LabelRuleRows,
  LabelVerdict,
  RecordOwners,
  WeighedReach,
} from "../../Types/LabelAccess/LabelAccess";
import RecordParts, {
  RecordOfPart,
  RecordPartModel,
} from "../../Types/LabelAccess/RecordParts";
import RecordOwnership, {
  RecordOwnershipOperation,
  RecordOwnershipResult,
  RecordOwnershipTable,
} from "../../Types/RecordAccess/RecordOwnership";
import KindsWithOwners, {
  OwnedKindModel,
} from "../../Types/Database/AccessControl/KindsWithOwners";
import TeamOwnedRuleHeld from "../../Types/TeamOwnedRule/TeamOwnedRuleHeld";
import {
  getRecordAccessGateOptions,
  RecordAccessScope,
  RecordGateAccess,
  RecordGateOperation,
} from "./RecordAccessScope";
import {
  getGlobalTranslator,
  SentenceOptions,
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

/*
 * A LOCK IS DRAWN, NEVER STORED: ITS NAMES ARE SET APART.
 *
 * Every sentence of a lock - its first, the permissions or roles that
 * would allow it, the team block that refuses it - is a tooltip's, a
 * locked row's or a no-access state's words, and nothing else. So its
 * values are set apart from its words as a drawn sentence's are
 * (SentenceOptions' setsValuesApart): in a Persian sentence a permission's
 * English title - "Read Runbook Execution", "Manage Billing, Edit
 * Project" - is a value of its own, read left to right where the sentence
 * reads right to left, and a title that ends in a bracket or a digit keeps
 * it at its end. A name the sentence's language writes (a role's Persian
 * name) reads with the sentence, with no mark.
 */
const LOCK_SENTENCE_OPTIONS: SentenceOptions = { setsValuesApart: true };

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
  /*
   * Refused by what the server says of the record the page is open on
   * (PermissionGateOptions.recordAccess), not by the reader's own
   * permissions: they hold what the operation asks, and naming it again
   * would only puzzle them.
   */
  isRefusedOnRecord?: boolean | undefined;
}

/*
 * Structurally typed so that both DatabaseBaseModel and AnalyticsBaseModel
 * satisfy it without a union - the two class hierarchies are unrelated but
 * expose an identical permission API. (Same trick as canCreate in
 * DashboardCommandPaletteHelpers.)
 */
export interface PermissionCheckableModel {
  singularName: string | null;
  /*
   * A database model's table, by which the server's answer for the record
   * a page is open on is read (PermissionGateOptions.recordAccess).
   */
  tableName?: string | null | undefined;
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

/*
 * A model whose records may carry labels of their own: a database model
 * names its labels column (getAccessControlColumn); an analytics model has
 * none.
 */
export interface LabelledGateModel extends PermissionCheckableModel {
  getAccessControlColumn?: (() => string | null) | undefined;
}

// The writes a record's own labels can lock (PermissionGate.getLabelLock).
export type LabelLockAction = ModelAction.Update | ModelAction.Delete;

// The writes a record's labels and owners can lock on one of its parts.
export type PartLockAction =
  | ModelAction.Create
  | ModelAction.Update
  | ModelAction.Delete;

/*
 * WHO OWNS ONE RECORD, AND WHAT THEY DECIDE ON A TABLE (#11436): the
 * server's answer for the record (Types/RecordAccess/RecordOwnership) as a
 * lock weighs it - who owns it, and the operations of the table weighed the
 * Owned scope narrows. Left out of a weigh while it is not known: the owners
 * then decide, and nothing is refused by them.
 */
export interface RecordOwnershipFacts {
  owners: RecordOwners;
  /*
   * The answer for the kind and its parts: which tables take their owners
   * from the record, by which key, and which operations of each the owners
   * decide.
   */
  ownership: RecordOwnershipResult;
}

/*
 * WHAT A RECORD'S LABELS AND WHO OWNS IT LET THE READER DO TO IT
 * (PermissionGate.getRecordLock, #11259, #11436): ModelLabelLock for every
 * kind a grant limited to labels or scoped to Owned narrows - a label-less
 * kind with owners among them (a team) - weighing who owns the record when
 * that is known.
 */
export interface ModelRecordLock {
  tableName: string;
  // The records' labels column, or null for a kind that carries none.
  labelsColumn: string | null;
  // Every label a reach is limited to or blocked on: the names a reason reads.
  labelIds: Array<string>;
  /*
   * Whether who owns a record may decide something here - a grant scoped
   * to Owned beside labels, or every grant of an operation scoped to Owned:
   * only then is who owns the records on screen worth reading.
   */
  isDecidedByOwners: boolean;
  weigh: (
    action: LabelLockAction,
    recordLabelIds: ReadonlyArray<unknown>,
    ownership?: RecordOwnershipFacts | null | undefined,
  ) => LabelVerdict;
}

/*
 * WHAT A RECORD'S LABELS AND WHO OWNS IT LET THE READER DO TO A ROW OF ONE
 * OF ITS PARTS (PermissionGate.getPartLock, #11435): a part's rows on the
 * record's page name the record, and carry its labels and its owners.
 */
export interface ModelPartLock {
  // The part's table: "MonitorOwnerUser".
  tableName: string;
  // The record's table: "Monitor".
  recordTableName: string;
  labelIds: Array<string>;
  isDecidedByOwners: boolean;
  weigh: (
    action: PartLockAction,
    recordLabelIds: ReadonlyArray<unknown>,
    ownership?: RecordOwnershipFacts | null | undefined,
  ) => LabelVerdict;
}

// A model a part lock reads: its permissions, and what it is read through.
export interface PartGateModel extends LabelledGateModel, RecordPartModel {}

/*
 * Where a column whose read is granted limited to labels is read: on the
 * records carrying one of `labelIds` alone, while the model itself is read
 * further (PermissionGate.getColumnKeptToLabels, #11437).
 */
export interface ColumnKeptToLabelsOnClient {
  column: string;
  labelIds: Array<string>;
}

/*
 * WHAT A RECORD'S OWN LABELS LET THE READER DO TO IT, for one model
 * (PermissionGate.getLabelLock, #11259): the reach of the reader's read,
 * update and delete by labels, as the server weighs them
 * (Types/LabelAccess/LabelAccess), and the labels a refusal may name.
 */
export interface ModelLabelLock {
  // The model's records' label column: "labels".
  labelsColumn: string;
  reaches: Record<ModelAction.Read | LabelLockAction, LabelReach>;
  /*
   * Every label the reach is limited to or blocked on, in lower case: the
   * names a lock's reason reads (Utils/RecordLabelLock).
   */
  labelIds: Array<string>;
  // What the labels leave the reader of a record carrying `recordLabelIds`.
  weigh: (
    action: LabelLockAction,
    recordLabelIds: ReadonlyArray<unknown>,
  ) => LabelVerdict;
}

/*
 * Where the reader's grants of one model action reach, read off their
 * permission rows (PermissionGate.getActionReach).
 */
export interface PermissionGateActionReach {
  // A grant that reaches every record of the project.
  isProjectWide: boolean;
  // The labels a grant limited to labels reaches.
  labelIds: Array<string>;
  // A grant limited to owned records reaches the records the reader owns.
  reachesOwned: boolean;
  // The labels a block with labels takes away, whatever else grants them.
  blockedLabelIds: Array<string>;
  /*
   * The teams whose records a grant limited to owned records reaches: the
   * teams of the rows that grant it, never the reader's other teams
   * (UserPermission.scope).
   */
  ownedScopeTeamIds: Array<string>;
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
  /*
   * What the server says the reader may do on the record the page is open
   * on and on its parts (RecordAccessScope, #10272), read for the table of
   * the model asked about - so options a page built for its record serve
   * the gates of the record's parts too: an operation it refuses is
   * locked, with its reason after the lock's first sentence, though the
   * reader's own permissions allow it somewhere in the project - their
   * grant is limited to labels the record does not carry, to records they
   * do not own, a team blocks it on the record's labels. While it is read
   * for a reader it may narrow, nothing of the record is offered.
   */
  recordAccess?: RecordAccessScope | undefined;
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
   * What the user holds in one project, for a page that lists records of
   * several projects at once (Upcoming shifts): the snapshot this browser
   * keeps for that project (Utils/Permission keeps each project's apart),
   * with the user's global permissions - or null while it keeps none, as
   * for a project no tab has opened yet. Nothing honest can be said about
   * that project until its snapshot lands, and its own pages read it as
   * they open.
   */
  public static getHeldPermissionsInProject(
    projectId: ObjectID | string | null | undefined,
  ): HeldPermissions | null {
    const projectPermissions: UserTenantAccessPermission | null = projectId
      ? PermissionUtil.getProjectPermissions(projectId)
      : null;

    if (!projectPermissions) {
      return null;
    }

    return HeldPermissionsUtil.fromRows({
      rows: projectPermissions.permissions || [],
      globalPermissions:
        PermissionUtil.getGlobalPermissions()?.globalPermissions || [],
    });
  }

  /*
   * Whether the permission snapshot has landed - it arrives on an API
   * response header, so it is empty for the first paint after a fresh login
   * and for a moment after opening a project this browser has no snapshot
   * of yet (each project's is kept apart: Utils/Permission). Until it lands
   * there is nothing honest to say about what the user may do. Always true
   * for a master admin, who may do everything.
   */
  public static hasPermissionSnapshot(
    options?: PermissionGateOptions | undefined,
  ): boolean {
    return (
      User.isMasterAdmin() || this.isLoaded(this.getHeldPermissions(options))
    );
  }

  /*
   * Whether the reader's permissions may reach some records of the project
   * and not others: a grant limited to labels or to the records they own,
   * or a team's block on some labels (HeldPermissionsUtil.fromRows keeps
   * them apart from what reaches the whole project). Only then can what the
   * server says of one record (RecordAccessScope) lock what their own
   * permissions allow, so only then does a record's page hold its changes
   * back while it asks. A master admin's reach every record; a snapshot
   * not landed yet may hold anything, and nothing is offered on it anyway.
   */
  public static mayReachSomeRecordsOnly(
    options?: PermissionGateOptions | undefined,
  ): boolean {
    if (User.isMasterAdmin()) {
      return false;
    }

    const held: HeldPermissions = this.getHeldPermissions(options);

    if (!this.isLoaded(held)) {
      return true;
    }

    return (
      held.blockedForSomeLabels.length > 0 ||
      held.allowed.some((permission: Permission): boolean => {
        return !held.allowedProjectWide.includes(permission);
      })
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
     * the first paint after a fresh login and for a moment after opening a
     * project this browser has no snapshot of yet. Telling somebody they need
     * a permission they actually hold is worse than briefly not offering the
     * button, so this case stays hidden.
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
      return this.weighRecordAccess({
        model: model,
        action: action,
        options: options,
      });
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
        disabledReason: joinSentences([
          this.buildFirstSentence({
            singularName: options?.singularName || model.singularName || "item",
            verb: (options?.verb?.trim() || action).toLowerCase(),
            sentence: options?.sentence,
          }),
          options.privateRecordReason,
        ]),
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
   * An operation the reader's own permissions allow, weighed against what
   * the server says of it on the record the page is open on (#10272): held
   * back - not offered, nothing said - while that answer is read for a
   * reader it may narrow; locked, with the server's reason after the lock's
   * first sentence, where it refuses it; allowed otherwise. Only a write is
   * weighed: whoever opened the record's page reads it.
   */
  private static weighRecordAccess(data: {
    model: PermissionCheckableModel;
    action: ModelAction;
    options?: PermissionGateOptions | undefined;
  }): PermissionGateResult {
    const access: RecordGateAccess | undefined = getRecordAccessGateOptions(
      data.options?.recordAccess || null,
      data.model,
    );

    if (!access || data.action === ModelAction.Read) {
      return { isAllowed: true };
    }

    /*
     * Held back - the whole answer while it is read, or one operation while
     * who owns the record is (#11436): not offered, nothing said.
     */
    if (
      access.isHeldBack ||
      access.heldBackOperations?.includes(data.action as RecordGateOperation)
    ) {
      return { isAllowed: false };
    }

    const reason: string | undefined =
      access.refusals[data.action as RecordGateOperation];

    if (!reason) {
      return { isAllowed: true };
    }

    return {
      isAllowed: false,
      disabledReason: this.getRefusedOnRecordReason({
        model: data.model,
        action: data.action,
        reason: reason,
        options: data.options,
      }),
      isRefusedOnRecord: true,
    };
  }

  /*
   * A lock refused on one record - by what the server says of it, or by its
   * labels (Utils/RecordLabelLock) - worded as every such lock is: the
   * lock's first sentence ("You do not have permission to delete this
   * monitor."), then `reason`, which says why on this record.
   */
  public static getRefusedOnRecordReason(data: {
    model: PermissionCheckableModel;
    action: ModelAction;
    reason: string;
    options?: PermissionGateOptions | undefined;
  }): string {
    return joinSentences([
      this.buildFirstSentence({
        singularName:
          data.options?.singularName || data.model.singularName || "item",
        verb: (data.options?.verb?.trim() || data.action).toLowerCase(),
        sentence: data.options?.sentence,
      }),
      data.reason,
    ]);
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
   * WHAT THE READER HOLDS ON ONE RULE TEAMS OWN (TeamOwnedRuleHeld): null
   * when it is all they hold - a rule no team owns, a Project Owner or
   * Project Admin over the whole project, or a master admin - and otherwise
   * what their blocks and the rows of their teams that own it hold. Read
   * from the stored snapshot, as every gate reads it.
   */
  public static getHeldOnTeamOwnedRule(data: {
    owningTeamIds: ReadonlyArray<string>;
  }): HeldPermissions | null {
    if (User.isMasterAdmin()) {
      return null;
    }

    return TeamOwnedRuleHeld.getHeldOnRule({
      rows: PermissionUtil.getProjectPermissions()?.permissions || [],
      globalPermissions:
        PermissionUtil.getGlobalPermissions()?.globalPermissions || [],
      owningTeamIds: data.owningTeamIds,
    });
  }

  /*
   * Whether the reader changes every rule teams own, whichever teams own it:
   * a master admin, or a Project Owner or Project Admin over the whole
   * project (TeamOwnedRuleHeld). Who owns a rule locks nothing of theirs, so
   * a page has nothing to wait for before offering them its changes.
   */
  public static actsOnEveryTeamOwnedRule(): boolean {
    if (User.isMasterAdmin()) {
      return true;
    }

    return TeamOwnedRuleHeld.actsOnEveryTeamOwnedRule(
      HeldPermissionsUtil.fromRows({
        rows: PermissionUtil.getProjectPermissions()?.permissions || [],
        globalPermissions:
          PermissionUtil.getGlobalPermissions()?.globalPermissions || [],
      }),
    );
  }

  /*
   * A change of one rule teams own (TeamOwnedRuleHeld): allowed when the
   * reader's own permissions allow it and - on a rule some teams own - the
   * teams of theirs that own it allow it too, or they change every rule.
   * Refused by their own permissions, it says what check says. Refused only
   * by who owns the rule, it says so with `reason` (the teams named) after
   * the lock's first sentence - also for a reader on none of the teams that
   * own it, who holds nothing on the rule at all.
   *
   * Asked while the page is still reading who owns the rule (owningTeamIds
   * undefined), it holds the change back with nothing to say yet - as check
   * does while the permission snapshot loads - so the page offers no change
   * it may be about to lock. Unless who owns the rule cannot matter: the
   * reader's own permissions refuse the change, which it says as ever, or
   * they change every rule.
   */
  public static checkTeamOwnedRule(
    model: PermissionCheckableModel,
    action: ModelAction.Update | ModelAction.Delete,
    data: {
      owningTeamIds: ReadonlyArray<string> | undefined;
      reason: string;
      options?: PermissionGateOptions | undefined;
    },
  ): PermissionGateResult {
    const ownResult: PermissionGateResult = this.check(
      model,
      action,
      data.options,
    );

    if (!ownResult.isAllowed || User.isMasterAdmin()) {
      return ownResult;
    }

    if (data.owningTeamIds === undefined) {
      return this.actsOnEveryTeamOwnedRule() ? ownResult : { isAllowed: false };
    }

    const held: HeldPermissions | null = this.getHeldOnTeamOwnedRule({
      owningTeamIds: data.owningTeamIds,
    });

    if (
      !held ||
      (this.isLoaded(held) &&
        this.snapshotAllows(model, action, { ...data.options, held: held }))
    ) {
      return ownResult;
    }

    return {
      isAllowed: false,
      disabledReason: `${this.buildFirstSentence({
        singularName:
          data.options?.singularName || model.singularName || "item",
        verb: (data.options?.verb?.trim() || action).toLowerCase(),
        sentence: data.options?.sentence,
      })} ${data.reason}`,
    };
  }

  /*
   * The teams whose allow rows give the reader `permission`, as the stored
   * snapshot names them, by the one rule (HeldPermissionsUtil
   * .getTeamGrants) - each with whether one of its rows reaches the whole
   * project. For a permission that reaches the people of the team it is
   * given to (Manage On-Call Policy User Overrides for Own Team). Whether
   * the reader holds it at all, blocks weighed, is holdsAnyOf's to say.
   */
  public static getTeamGrants(
    permission: Permission,
    options?: { rows?: ReadonlyArray<UserPermission> | undefined },
  ): TeamGrants {
    return HeldPermissionsUtil.getTeamGrants(
      options?.rows ||
        PermissionUtil.getProjectPermissions()?.permissions ||
        [],
      permission,
    );
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
   * WHERE THE READER'S GRANTS OF ONE MODEL ACTION REACH (#7517), for a page
   * that offers records by whether the reader may act on each one - the
   * status page setup's list of the pages a person may change. The rows of
   * the action's own permissions, or its operational-resource wildcard,
   * that grant it and those that take it away, as the server counts them
   * (HeldPermissionsUtil), read for the reach each one gives
   * (PermissionGateActionReach). Whether the reader may take the action at
   * all is check's to say; this says where.
   */
  public static getActionReach(
    model: PermissionCheckableModel,
    action: ModelAction,
  ): PermissionGateActionReach {
    const modelPermissions: Array<Permission> = this.getModelPermissions(
      model,
      action,
    );
    const wildcard: Permission | null = HeldPermissionsUtil.getModelWildcard({
      isOperationalResource: model.isOperationalResource,
      operation: action,
    });
    const held: HeldPermissions = this.getHeldPermissions();
    const granting: Array<Permission> =
      HeldPermissionsUtil.getGrantingPermissions(held, {
        modelPermissions: modelPermissions,
        wildcard: wildcard,
      });
    const blocking: Array<Permission> =
      HeldPermissionsUtil.getLabelBlockingPermissions(held, {
        modelPermissions: modelPermissions,
        wildcard: wildcard,
      });
    const reach: PermissionGateActionReach = {
      isProjectWide: granting.some((permission: Permission): boolean => {
        return held.allowedProjectWide.includes(permission);
      }),
      labelIds: [],
      reachesOwned: false,
      blockedLabelIds: [],
      ownedScopeTeamIds: [],
    };

    const rows: Array<UserPermission> =
      PermissionUtil.getProjectPermissions()?.permissions || [];

    for (const row of rows) {
      if (!row || !row.permission) {
        continue;
      }

      const labelIds: Array<string> = (row.labelIds || [])
        .map(PermissionGate.idText)
        .filter(Boolean);

      if (HeldPermissionsUtil.isBlockRow(row)) {
        if (blocking.includes(row.permission)) {
          reach.blockedLabelIds.push(...labelIds);
        }
        continue;
      }

      // The team of a row that grants the action limited to owned records.
      const teamId: string = PermissionGate.idText(row.teamId);

      if (
        row.scope === PermissionScope.Owned &&
        (modelPermissions.includes(row.permission) ||
          row.permission === wildcard) &&
        teamId &&
        !reach.ownedScopeTeamIds.includes(teamId)
      ) {
        reach.ownedScopeTeamIds.push(teamId);
      }

      if (!granting.includes(row.permission)) {
        continue;
      }

      if (PermissionHelper.isLimitedToLabels(row)) {
        reach.labelIds.push(...labelIds);
      } else if (
        row.scope === PermissionScope.Owned &&
        PermissionHelper.isScopeApplicable(row.permission)
      ) {
        reach.reachesOwned = true;
      }
    }

    return reach;
  }

  /*
   * WHAT A RECORD'S OWN LABELS LET THE READER DO TO IT (#11259), by the
   * rule the server refuses by (Types/LabelAccess/LabelAccess, which
   * AccessControlPermission decides with too).
   *
   * check says whether the reader holds what an operation asks somewhere in
   * the project. A grant limited to labels holds it only on the records
   * carrying one of them: a Viewer over the whole project who is a Project
   * Member on the monitors labelled X was offered Edit and Delete on every
   * monitor, and refused by the server on each one outside X. This reads
   * the reader's rows - allow and block, with their labels and scopes, as
   * the server's request carries them - into the reach of their read, update
   * and delete of the model, and weighs a record's labels against it:
   * a change or a delete outside the labels a grant is limited to, or on a
   * label a team's block takes away, is refused (LabelVerdict). A grant
   * scoped to Owned beside the labels leaves a record outside them to its
   * owners, which the record's labels cannot tell: it is not refused here,
   * and the server keeps the last word.
   *
   * Null when the labels lock nothing: a master admin, a model that carries
   * no labels, a snapshot not landed yet, or a reader none of whose grants
   * of the model's read, update and delete is limited to labels or blocked
   * on some.
   */
  public static getLabelLock(model: LabelledGateModel): ModelLabelLock | null {
    if (User.isMasterAdmin()) {
      return null;
    }

    const labelsColumn: string | null =
      model.getAccessControlColumn?.() || null;

    if (!labelsColumn) {
      return null;
    }

    const rows: Array<UserPermission> = this.getSnapshotRows();

    const held: HeldPermissions = HeldPermissionsUtil.fromRows({
      rows: rows,
    });

    if (!this.isLoaded(held)) {
      return null;
    }

    const labelRows: LabelRuleRows = LabelAccess.readRows(rows);

    const reachOf: (action: ModelAction) => LabelReach = (
      action: ModelAction,
    ): LabelReach => {
      const modelPermissions: Array<Permission> = this.getModelPermissions(
        model,
        action,
      );
      const wildcard: Permission | null = HeldPermissionsUtil.getModelWildcard({
        isOperationalResource: model.isOperationalResource,
        operation: action,
      });

      return LabelAccess.getReach({
        rows: labelRows,
        grantingPermissions: HeldPermissionsUtil.getGrantingPermissions(held, {
          modelPermissions: modelPermissions,
          wildcard: wildcard,
        }),
        blockingPermissions: HeldPermissionsUtil.getLabelBlockingPermissions(
          held,
          { modelPermissions: modelPermissions, wildcard: wildcard },
        ),
        /*
         * Whether the Owned scope narrows the model is the server's to know
         * (its owner tables): taken as narrowing, an Owned grant beside the
         * labels leaves a record outside them to its owners - never
         * refused here - as it does where the scope narrows nothing.
         */
        ownedScopeNarrows: (): boolean => {
          return true;
        },
      });
    };

    const reaches: Record<ModelAction.Read | LabelLockAction, LabelReach> = {
      [ModelAction.Read]: reachOf(ModelAction.Read),
      [ModelAction.Update]: reachOf(ModelAction.Update),
      [ModelAction.Delete]: reachOf(ModelAction.Delete),
    };

    const labelIds: Array<string> = [];

    for (const reach of Object.values(reaches)) {
      for (const labelId of [
        ...reach.grant.labelIds,
        ...reach.blockedLabelIds,
      ]) {
        const id: string = LabelAccess.readId(labelId);

        if (id && !labelIds.includes(id)) {
          labelIds.push(id);
        }
      }
    }

    if (labelIds.length === 0) {
      return null;
    }

    return {
      labelsColumn: labelsColumn,
      reaches: reaches,
      labelIds: labelIds,
      weigh: (
        action: LabelLockAction,
        recordLabelIds: ReadonlyArray<unknown>,
      ): LabelVerdict => {
        return LabelAccess.weighLabelledRecord({
          recordLabelIds: recordLabelIds,
          read: reaches[ModelAction.Read],
          operation: reaches[action],
        });
      },
    };
  }

  /*
   * The reach of each action on `model`, read off the reader's rows as the
   * server reads them (LabelAccess.getReach), for a weigh that knows whether
   * the Owned scope narrows the action: `narrows` true when it does or when
   * that is not known yet - the owners then decide, and nothing is refused
   * by them - and false when it does not, where a grant scoped to Owned
   * reaches every record. Each worked out once.
   */
  private static getReachReader(
    model: PermissionCheckableModel,
    labelRows: LabelRuleRows,
    held: HeldPermissions,
  ): (action: ModelAction, narrows: boolean) => LabelReach {
    const reaches: Map<string, LabelReach> = new Map<string, LabelReach>();

    return (action: ModelAction, narrows: boolean): LabelReach => {
      const key: string = `${action}:${narrows ? "narrows" : "reaches"}`;
      const known: LabelReach | undefined = reaches.get(key);

      if (known) {
        return known;
      }

      const modelPermissions: Array<Permission> = this.getModelPermissions(
        model,
        action,
      );
      const wildcard: Permission | null = HeldPermissionsUtil.getModelWildcard({
        isOperationalResource: model.isOperationalResource,
        operation: action,
      });

      const reach: LabelReach = LabelAccess.getReach({
        rows: labelRows,
        grantingPermissions: HeldPermissionsUtil.getGrantingPermissions(held, {
          modelPermissions: modelPermissions,
          wildcard: wildcard,
        }),
        blockingPermissions: HeldPermissionsUtil.getLabelBlockingPermissions(
          held,
          { modelPermissions: modelPermissions, wildcard: wildcard },
        ),
        ownedScopeNarrows: (): boolean => {
          return narrows;
        },
      });

      reaches.set(key, reach);

      return reach;
    };
  }

  // Every label `reaches` are limited to or blocked on, in lower case, each once.
  private static getLabelIdsOfReaches(
    reaches: ReadonlyArray<LabelReach>,
  ): Array<string> {
    const labelIds: Array<string> = [];

    for (const reach of reaches) {
      for (const labelId of [
        ...reach.grant.labelIds,
        ...reach.blockedLabelIds,
      ]) {
        const id: string = LabelAccess.readId(labelId);

        if (id && !labelIds.includes(id)) {
          labelIds.push(id);
        }
      }
    }

    return labelIds;
  }

  /*
   * Whether the Owned scope narrows `action` on `tableName`'s rows, as the
   * server's answer about a record says (RecordOwnership): true while there
   * is no answer - the owners then decide, unknown - and, with one, only
   * for an operation the answer lists for a table that takes its owners from
   * the record by `key`.
   */
  private static isNarrowedByOwners(data: {
    ownership: RecordOwnershipFacts | null;
    tableName: string;
    key: string;
    action: ModelAction;
  }): boolean {
    if (!data.ownership) {
      return true;
    }

    const table: RecordOwnershipTable | null = RecordOwnership.getTable(
      data.ownership.ownership,
      data.tableName,
    );

    return Boolean(
      table &&
        table.key === data.key &&
        table.operations.includes(data.action as RecordOwnershipOperation),
    );
  }

  /*
   * WHAT A RECORD'S LABELS AND WHO OWNS IT LET THE READER DO TO IT (#11259,
   * #11436), by the rule the server refuses by (Types/LabelAccess
   * .weighRecord): getLabelLock's reach of the reader's read, update and
   * delete, and - for a grant scoped to Owned beside the labels, or an
   * operation every grant of which is scoped to Owned - who owns the record,
   * which the server answers for the records on screen
   * (RecordOwnershipFacts). Without that answer the owners decide, and
   * nothing is locked by them; with it, a change or a delete of a record
   * neither the reader nor the teams of those grants own is refused
   * (Owned, LabelsOrOwned), as the server's Owned scope refuses it.
   *
   * For every kind a scope narrows, labelled or not: a kind with no labels
   * (a team) is narrowed by its owners alone. Null when neither its labels
   * nor its owners lock anything: a master admin, a snapshot not landed
   * yet, a reader none of whose grants of the model's read, update and
   * delete is limited to labels, blocked on some, or scoped to Owned.
   */
  public static getRecordLock(
    model: LabelledGateModel,
  ): ModelRecordLock | null {
    if (User.isMasterAdmin()) {
      return null;
    }

    const rows: Array<UserPermission> = this.getSnapshotRows();
    const held: HeldPermissions = HeldPermissionsUtil.fromRows({ rows: rows });

    if (!this.isLoaded(held)) {
      return null;
    }

    const tableName: string = model.tableName || "";
    const labelsColumn: string | null =
      model.getAccessControlColumn?.() || null;
    const reachOf: (action: ModelAction, narrows: boolean) => LabelReach =
      this.getReachReader(model, LabelAccess.readRows(rows), held);

    const probes: Array<LabelReach> = [
      ModelAction.Read,
      ModelAction.Update,
      ModelAction.Delete,
    ].map((action: ModelAction): LabelReach => {
      return reachOf(action, true);
    });

    const labelIds: Array<string> = labelsColumn
      ? this.getLabelIdsOfReaches(probes)
      : [];
    const isDecidedByOwners: boolean = probes.some(
      (reach: LabelReach): boolean => {
        return LabelAccess.isDecidedByOwnersAnywhere(reach);
      },
    );

    if (labelIds.length === 0 && !isDecidedByOwners) {
      return null;
    }

    return {
      tableName: tableName,
      labelsColumn: labelsColumn,
      labelIds: labelIds,
      isDecidedByOwners: isDecidedByOwners,
      weigh: (
        action: LabelLockAction,
        recordLabelIds: ReadonlyArray<unknown>,
        ownership?: RecordOwnershipFacts | null | undefined,
      ): LabelVerdict => {
        const facts: RecordOwnershipFacts | null = ownership || null;

        const narrows: (operation: ModelAction) => boolean = (
          operation: ModelAction,
        ): boolean => {
          return this.isNarrowedByOwners({
            ownership: facts,
            tableName: tableName,
            key: "_id",
            action: operation,
          });
        };

        return LabelAccess.weighRecord({
          recordLabelIds: recordLabelIds,
          owners: facts ? facts.owners : null,
          reads: [
            {
              reach: reachOf(ModelAction.Read, narrows(ModelAction.Read)),
              labelsDecide: Boolean(labelsColumn),
            },
          ],
          operations: [
            {
              reach: reachOf(action, narrows(action)),
              labelsDecide: Boolean(labelsColumn),
            },
          ],
        });
      },
    };
  }

  /*
   * WHAT A RECORD'S LABELS AND WHO OWNS IT LET THE READER DO TO A ROW OF ONE
   * OF ITS PARTS (#11435): a monitor's owners, its probes, its status
   * timeline - a model with no labels of its own, read through the record
   * (RecordParts). On the record's page a part's rows name the record, and
   * the server weighs a part's create, change and delete as it weighs one of
   * its rows (BasePermission.addRecordScopeToQuery, CreateScopePermission):
   *
   *   - the part's own grants and blocks of the operation and - a change or
   *     a delete needs a read - of its read, against the labels its rows
   *     carry: the record's, where they name no other labelled record
   *     (RecordParts.namesOnlyItsRecord); only the record's labels' blocks
   *     where they do, since a grant may reach a row through the other
   *     record;
   *   - on a change, the record's own update (a part is changed only on a
   *     record the reader may change), by its labels and its blocks;
   *   - and, where the part takes its owners from the record (its owner
   *     tables, a part with @OwnedThrough it - the server's answer lists
   *     them, RecordOwnershipFacts), who owns the record, for a grant
   *     scoped to Owned.
   *
   * The record's read is not weighed: the page is open on it, so the reader
   * reads it. Null when nothing of the part is locked by the record's labels
   * or owners, for a model that is not one of `record`'s parts, and for a
   * master admin or a snapshot not landed yet.
   */
  public static getPartLock(
    part: PartGateModel,
    record: LabelledGateModel,
  ): ModelPartLock | null {
    if (User.isMasterAdmin()) {
      return null;
    }

    const recordTableName: string = record.tableName || "";
    const recordOf: RecordOfPart | null = RecordParts.getRecordOf(part);

    if (!recordOf || !recordTableName || recordOf.tableName !== recordTableName) {
      return null;
    }

    const rows: Array<UserPermission> = this.getSnapshotRows();
    const held: HeldPermissions = HeldPermissionsUtil.fromRows({ rows: rows });

    if (!this.isLoaded(held)) {
      return null;
    }

    const labelRows: LabelRuleRows = LabelAccess.readRows(rows);
    const partReachOf: (action: ModelAction, narrows: boolean) => LabelReach =
      this.getReachReader(part, labelRows, held);
    const recordReachOf: (
      action: ModelAction,
      narrows: boolean,
    ) => LabelReach = this.getReachReader(record, labelRows, held);

    const isRecordLabelled: boolean = Boolean(
      record.getAccessControlColumn?.(),
    );
    const partTableName: string = part.tableName || "";
    const labelsDecide: boolean =
      isRecordLabelled && RecordParts.namesOnlyItsRecord(part);

    const probes: Array<LabelReach> = [
      partReachOf(ModelAction.Create, true),
      partReachOf(ModelAction.Read, true),
      partReachOf(ModelAction.Update, true),
      partReachOf(ModelAction.Delete, true),
      recordReachOf(ModelAction.Update, true),
    ];

    const labelIds: Array<string> = isRecordLabelled
      ? this.getLabelIdsOfReaches(probes)
      : [];
    const isDecidedByOwners: boolean = probes.some(
      (reach: LabelReach): boolean => {
        return LabelAccess.isDecidedByOwnersAnywhere(reach);
      },
    );

    if (labelIds.length === 0 && !isDecidedByOwners) {
      return null;
    }

    return {
      tableName: partTableName,
      recordTableName: recordTableName,
      labelIds: labelIds,
      isDecidedByOwners: isDecidedByOwners,
      weigh: (
        action: PartLockAction,
        recordLabelIds: ReadonlyArray<unknown>,
        ownership?: RecordOwnershipFacts | null | undefined,
      ): LabelVerdict => {
        const facts: RecordOwnershipFacts | null = ownership || null;

        // Whether the record's owners are the part's rows' owners.
        const isOwnedThroughRecord: boolean =
          !recordOf.isList &&
          (!facts ||
            Boolean(
              RecordOwnership.getTable(facts.ownership, partTableName)?.key ===
                recordOf.key,
            ));

        const partNarrows: (operation: ModelAction) => boolean = (
          operation: ModelAction,
        ): boolean => {
          return (
            isOwnedThroughRecord &&
            this.isNarrowedByOwners({
              ownership: facts,
              tableName: partTableName,
              key: recordOf.key,
              action: operation,
            })
          );
        };

        const ofPart: (reach: LabelReach) => WeighedReach = (
          reach: LabelReach,
        ): WeighedReach => {
          return {
            reach: reach,
            labelsDecide: labelsDecide,
            ownersDecide: isOwnedThroughRecord,
          };
        };

        const reads: Array<WeighedReach> =
          action === ModelAction.Create
            ? []
            : [ofPart(partReachOf(ModelAction.Read, partNarrows(ModelAction.Read)))];

        const operations: Array<WeighedReach> = [
          ofPart(partReachOf(action, partNarrows(action))),
        ];

        if (action === ModelAction.Update) {
          operations.push({
            reach: recordReachOf(
              ModelAction.Update,
              this.isNarrowedByOwners({
                ownership: facts,
                tableName: recordTableName,
                key: "_id",
                action: ModelAction.Update,
              }),
            ),
            labelsDecide: isRecordLabelled && !recordOf.isList,
            ownersDecide: !recordOf.isList,
          });
        }

        return LabelAccess.weighRecord({
          recordLabelIds: recordLabelIds,
          owners: facts ? facts.owners : null,
          reads: reads,
          operations: operations,
        });
      },
    };
  }

  /*
   * What the reader's permission snapshot holds, as one string: a page that
   * keeps what it worked out from it (ModelPage's scope) works it out again
   * when it changes. Empty for a master admin, whose locks it never moves.
   */
  public static getSnapshotKey(): string {
    if (User.isMasterAdmin()) {
      return "";
    }

    return JSON.stringify(this.getSnapshotRows());
  }

  /*
   * Whether the reader holds a grant scoped to Owned at all - of a
   * permission a scope applies to: only then can who owns a record lock
   * anything of theirs, and only then is it read (RecordOwnership).
   */
  public static hasOwnedScopedGrants(): boolean {
    if (User.isMasterAdmin()) {
      return false;
    }

    return LabelAccess.readRows(this.getSnapshotRows()).owned.length > 0;
  }

  /*
   * Every label the reader's grants are limited to or their blocks are on,
   * in lower case: the names any lock's reason on a page may read - a part's
   * among them, which a page knows only when a gate asks.
   */
  public static getSnapshotLabelIds(): Array<string> {
    if (User.isMasterAdmin()) {
      return [];
    }

    const labelIds: Array<string> = [];

    for (const row of this.getSnapshotRows()) {
      if (!row || !HeldPermissionsUtil.hasLabels(row)) {
        continue;
      }

      if (
        !HeldPermissionsUtil.isBlockRow(row) &&
        !PermissionHelper.isLimitedToLabels(row)
      ) {
        continue;
      }

      for (const labelId of row.labelIds || []) {
        const id: string = LabelAccess.readId(labelId);

        if (id && !labelIds.includes(id)) {
          labelIds.push(id);
        }
      }
    }

    return labelIds;
  }

  /*
   * WHETHER THE READER READS ONE COLUMN ON FEWER OF A LABELLED MODEL'S
   * RECORDS THAN THE MODEL ITSELF (#11437) - a monitor's secret keys, a
   * runner's key, for a Viewer over the whole project who is a Project
   * Member on one label - by the rule the server leaves such a column out of
   * the other records by, and refuses an order by it
   * (AccessControlPermission.getColumnsKeptToLabels,
   * checkSortOnColumnsKeptToLabels): the column's read granted limited to
   * labels alone, and the model's read not kept to those labels already.
   * The labels it is read on, or null. A grant scoped to Owned beside the
   * column's labels leaves where it is read to the records' owners: null,
   * and the server keeps the last word.
   */
  public static getColumnKeptToLabels(
    model: ColumnPermissionCheckableModel & LabelledGateModel,
    column: string,
  ): ColumnKeptToLabelsOnClient | null {
    if (User.isMasterAdmin() || !model.getAccessControlColumn?.()) {
      return null;
    }

    const readPermissions: Array<Permission> =
      model.getColumnAccessControlForAllColumns()[column]?.read || [];

    if (readPermissions.length === 0 || !this.canReadColumn(model, column)) {
      return null;
    }

    const rows: Array<UserPermission> = this.getSnapshotRows();
    const held: HeldPermissions = HeldPermissionsUtil.fromRows({ rows: rows });

    if (!this.isLoaded(held)) {
      return null;
    }

    const labelRows: LabelRuleRows = LabelAccess.readRows(rows);

    const columnGrant: LabelGrant = LabelAccess.getGrant({
      rows: labelRows,
      permissions: HeldPermissionsUtil.getGrantingPermissions(held, {
        modelPermissions: readPermissions,
        wildcard: HeldPermissionsUtil.getColumnWildcard({
          isOperationalResource: model.isOperationalResource,
          operation: "read",
          tablePermissions: this.getTablePermissions(model, "read"),
          columnPermissions: readPermissions,
        }),
      }),
      ownedScopeNarrows: (): boolean => {
        return true;
      },
    });

    if (columnGrant.labelIds.length === 0 || columnGrant.ownedTeamIds) {
      return null;
    }

    const tableReadPermissions: Array<Permission> = this.getTablePermissions(
      model,
      "read",
    );

    const readGrant: LabelGrant = LabelAccess.getGrant({
      rows: labelRows,
      permissions: HeldPermissionsUtil.getGrantingPermissions(held, {
        modelPermissions: tableReadPermissions,
        wildcard: HeldPermissionsUtil.getModelWildcard({
          isOperationalResource: model.isOperationalResource,
          operation: ModelAction.Read,
        }),
      }),
      ownedScopeNarrows: (): boolean => {
        return true;
      },
    });

    if (
      readGrant.labelIds.length > 0 &&
      LabelAccess.isGrantWithin(readGrant, columnGrant)
    ) {
      return null;
    }

    return {
      column: column,
      labelIds: columnGrant.labelIds.map((labelId: ObjectID): string => {
        return LabelAccess.readId(labelId);
      }),
    };
  }

  /*
   * WHETHER THE READER READS ONE COLUMN ONLY ON THE RECORDS THEY OR THEIR
   * TEAMS OWN (#11437), however far their read of the model reaches - a
   * runner's key, for a Viewer over the whole project who is a Runbook
   * Admin scoped to Owned - by the rule the server leaves such a column out
   * of the other records by, and refuses an order or a filter by it
   * (OwnedScopePermission.getColumnsKeptToOwners): a kind with owners, a
   * column only those who may change the kind read, every grant that lets
   * the reader read it scoped to Owned, and the model's read not kept to
   * those grants' teams' records already.
   */
  public static isColumnKeptToOwners(
    model: ColumnPermissionCheckableModel &
      LabelledGateModel &
      OwnedKindModel,
    column: string,
  ): boolean {
    if (User.isMasterAdmin() || !KindsWithOwners.hasOwners(model)) {
      return false;
    }

    const readPermissions: Array<Permission> =
      model.getColumnAccessControlForAllColumns()[column]?.read || [];
    const changePermissions: Array<Permission> =
      model.getUpdatePermissions() || [];

    if (
      readPermissions.length === 0 ||
      !readPermissions.every((permission: Permission): boolean => {
        return changePermissions.includes(permission);
      }) ||
      !this.canReadColumn(model, column)
    ) {
      return false;
    }

    const rows: Array<UserPermission> = this.getSnapshotRows();
    const grantingRows: Array<UserPermission> = rows.filter(
      (row: UserPermission): boolean => {
        return (
          Boolean(row && row.permission) &&
          !HeldPermissionsUtil.isBlockRow(row) &&
          readPermissions.includes(row.permission)
        );
      },
    );

    if (
      grantingRows.length === 0 ||
      !grantingRows.every((row: UserPermission): boolean => {
        return (
          PermissionHelper.isScopeApplicable(row.permission) &&
          row.scope === PermissionScope.Owned
        );
      })
    ) {
      return false;
    }

    // The read keeps to owned records already, of teams that are all the column's.
    if (!KindsWithOwners.leavesReadsAlone(model)) {
      const held: HeldPermissions = HeldPermissionsUtil.fromRows({
        rows: rows,
      });
      const readOnlyOwned: Array<UserPermission> | null =
        LabelAccess.getOwnedOnlyRows(
          LabelAccess.readRows(rows),
          HeldPermissionsUtil.getGrantingPermissions(held, {
            modelPermissions: this.getTablePermissions(model, "read"),
            wildcard: HeldPermissionsUtil.getModelWildcard({
              isOperationalResource: model.isOperationalResource,
              operation: ModelAction.Read,
            }),
          }),
        );

      if (readOnlyOwned) {
        const columnTeams: Set<string> = new Set<string>(
          HeldPermissionsUtil.getTeamIdsOfRows(grantingRows).map(
            (teamId: ObjectID): string => {
              return LabelAccess.readId(teamId);
            },
          ),
        );

        if (
          HeldPermissionsUtil.getTeamIdsOfRows(readOnlyOwned).every(
            (teamId: ObjectID): boolean => {
              return columnTeams.has(LabelAccess.readId(teamId));
            },
          )
        ) {
          return false;
        }
      }
    }

    return true;
  }

  /*
   * WHETHER THE READER MAY READ ONE COLUMN OF A RECORD CARRYING
   * `recordLabelIds` (#11259): the column's read (canReadColumn) and, for a
   * column whose read is granted limited to labels - a monitor's secret
   * keys, for a Viewer who is a Project Member on one label - the record's
   * labels, by the rule the server leaves the column out of the records
   * outside them by (AccessControlPermission.getColumnsKeptToLabels). For a
   * page that shows what a column holds, to say it is hidden rather than
   * empty. Records read without their labels (null), and a grant scoped to
   * Owned beside the labels, which the record's owners decide, are taken as
   * read: the server keeps the last word.
   */
  public static mayReadColumnOnRecord(
    model: ColumnPermissionCheckableModel & LabelledGateModel,
    column: string,
    recordLabelIds: ReadonlyArray<unknown> | null,
  ): boolean {
    if (!this.canReadColumn(model, column)) {
      return false;
    }

    if (User.isMasterAdmin() || !recordLabelIds) {
      return true;
    }

    const readPermissions: Array<Permission> =
      model.getColumnAccessControlForAllColumns()[column]?.read || [];

    if (readPermissions.length === 0 || !model.getAccessControlColumn?.()) {
      return true;
    }

    const rows: Array<UserPermission> = this.getSnapshotRows();
    const held: HeldPermissions = HeldPermissionsUtil.fromRows({ rows: rows });

    const grant: LabelGrant = LabelAccess.getGrant({
      rows: LabelAccess.readRows(rows),
      permissions: HeldPermissionsUtil.getGrantingPermissions(held, {
        modelPermissions: readPermissions,
        wildcard: HeldPermissionsUtil.getColumnWildcard({
          isOperationalResource: model.isOperationalResource,
          operation: "read",
          tablePermissions: this.getTablePermissions(model, "read"),
          columnPermissions: readPermissions,
        }),
      }),
      ownedScopeNarrows: (): boolean => {
        return true;
      },
    });

    return (
      grant.labelIds.length === 0 ||
      grant.ownedTeamIds !== null ||
      LabelAccess.carriesAny(recordLabelIds, grant.labelIds)
    );
  }

  /*
   * The reader's rows in the project this tab shows, allow and block, with
   * their global permissions as rows with no labels - the rows the server's
   * request carries (DatabaseCommonInteractionPropsUtil.getPermissionRows).
   */
  private static getSnapshotRows(): Array<UserPermission> {
    return [
      ...(PermissionUtil.getProjectPermissions()?.permissions || []),
      ...(PermissionUtil.getGlobalPermissions()?.globalPermissions || []).map(
        (permission: Permission): UserPermission => {
          return {
            _type: "UserPermission",
            permission: permission,
            labelIds: [],
            isBlockPermission: false,
          };
        },
      ),
    ];
  }

  // An id as a permission row carries it, compared in any case.
  private static idText(value: unknown): string {
    if (!value) {
      return "";
    }

    // An ObjectID read back from storage without its type: { value }.
    if (
      typeof value === "object" &&
      "value" in (value as Record<string, unknown>)
    ) {
      return String((value as { value: unknown }).value).toLowerCase();
    }

    return String(value).toLowerCase();
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
    /*
     * Refused on the record the page is open on, the reader holds what the
     * column asks: the record's reason stands (weighRecordAccess).
     */
    if (
      !data.recordGate.disabledReason ||
      data.recordGate.isRefusedOnRecord ||
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

    const sentence: string =
      translator.translateText(options.sentence) || options.sentence;

    /*
     * Refused on a private record that the reader's own permissions would
     * allow: the teams of theirs that own it may not (PrivateRecordScope),
     * as check says it - naming a permission they hold would only puzzle
     * them. A fix OneUptime AI proposed for a private incident, say (#8913).
     */
    if (
      options.privateRecordReason &&
      HeldPermissionsUtil.holdsAnyOf(
        this.getHeldPermissions({
          ...options,
          held: undefined,
          permissions: undefined,
        }),
        permissions,
        options,
      )
    ) {
      return {
        isAllowed: false,
        // Two whole sentences, each looked up whole, run together as the reader's script runs them.
        disabledReason: joinSentences([sentence, options.privateRecordReason]),
      };
    }

    return {
      isAllowed: false,
      disabledReason: this.appendPermissionsToSentence({
        sentence: sentence,
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
        ? translator.translateTemplate(
            template,
            {
              itemName: translatableTerm(singularName),
            },
            LOCK_SENTENCE_OPTIONS,
          )
        : translator.translateTemplate(
            "You do not have permission to {{action}} this {{itemName}}.",
            {
              action: translatableTerm(verb),
              itemName: translatableTerm(singularName),
            },
            LOCK_SENTENCE_OPTIONS,
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
   * What would let the reader see or do what is refused, where the refusal
   * has a title of its own instead of a first sentence - a no-access
   * state's lock and "You don't have access to this list": the team block
   * that refuses it ("A team you are on blocks Read Runbook Execution."),
   * or else what would allow it ("You need this permission: Read Runbook
   * Execution.", getNeededPermissionsSentence). Empty when there is nothing
   * to name.
   */
  public static getAllowingSentence(data: {
    permissions: ReadonlyArray<Permission>;
    options?: PermissionGateOptions | undefined;
  }): string {
    return this.appendPermissionsToSentence({
      sentence: "",
      permissions: [...data.permissions],
      held: this.getHeldPermissions(data.options),
    }).trim();
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
        LOCK_SENTENCE_OPTIONS,
      )}`;
    }

    const needed: string = this.getNeededPermissionsSentence(
      data.permissions,
      translator,
    );

    return needed ? `${sentence} ${needed}` : sentence;
  }

  /*
   * A permission a lock names as a role: a built-in role, or a product's
   * level (Cloud Admin, Network Viewer: Types/Product/ProductLevels), which
   * is a project-wide role kept to one product's records.
   */
  private static isNamedAsRole(
    permissionProps: PermissionProps | undefined,
  ): boolean {
    return Boolean(
      permissionProps &&
        (permissionProps.isRolePermission ||
          isProductLevelPermission(permissionProps.permission)),
    );
  }

  // A permission of a list's own, which a team or a custom role can be given.
  private static isOwnPermission(
    permissionProps: PermissionProps | undefined,
  ): boolean {
    return Boolean(
      permissionProps &&
        !this.isNamedAsRole(permissionProps) &&
        permissionProps.isAssignableToTenant,
    );
  }

  /*
   * What a lock names of a list of permissions that would allow it, in the
   * list's order (see NEEDS_PERMISSION_TEMPLATE): the permissions of its
   * own that a team or a custom role can be given; the built-in roles and
   * the products' levels when it has none; and when it has neither
   * (Public, Logged in User), every title it has, as before. Unknown
   * permissions are skipped (getPermissionTitles).
   */
  public static getPermissionsToName(
    permissions: ReadonlyArray<Permission>,
  ): PermissionsToName {
    const props: Dictionary<PermissionProps> = getPermissionProps();

    const own: Array<Permission> = permissions.filter(
      (permission: Permission): boolean => {
        return this.isOwnPermission(props[permission]);
      },
    );

    if (own.length > 0) {
      return { titles: this.getPermissionTitles(own), areRoles: false };
    }

    const roles: Array<Permission> = permissions.filter(
      (permission: Permission): boolean => {
        return this.isNamedAsRole(props[permission]);
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
   * What a list of a model's records names to someone who may read none of
   * it (the table's no-access state): of the model's read list, the
   * permissions of its own kind - in the groups its create, edit and delete
   * permissions are in. Probe's read list holds 22 permissions a team can
   * be given, 21 of them a monitor's, a network device's, a discovery
   * scan's, a network site's or a vCenter's, which let a picker show the
   * project's probes; the one to ask for to read the Probes list is Read
   * Probe. Project User - held by every member - leaves the lists of teams
   * and labels the same way. The whole read list, as before, where the
   * model writes nothing of its own or none of its readers is of its kind.
   */
  public static getReadPermissionsOfItsKind(
    model: PermissionCheckableModel,
  ): Array<Permission> {
    const props: Dictionary<PermissionProps> = getPermissionProps();
    const read: Array<Permission> = model.getReadPermissions() || [];

    const isOwn: (permission: Permission) => boolean = (
      permission: Permission,
    ): boolean => {
      return this.isOwnPermission(props[permission]);
    };

    const kinds: Set<PermissionProps["group"]> = new Set(
      [
        ...(model.getCreatePermissions() || []),
        ...(model.getUpdatePermissions() || []),
        ...(model.getDeletePermissions() || []),
      ]
        .filter(isOwn)
        .map((permission: Permission): PermissionProps["group"] => {
          return (props[permission] as PermissionProps).group;
        }),
    );

    const ofItsKind: Array<Permission> = read.filter(
      (permission: Permission): boolean => {
        return (
          isOwn(permission) &&
          kinds.has((props[permission] as PermissionProps).group)
        );
      },
    );

    return ofItsKind.length > 0 ? ofItsKind : read;
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
        ? words.translateTemplate(
            NEEDS_ROLE_TEMPLATE,
            { role: titles },
            LOCK_SENTENCE_OPTIONS,
          )
        : words.translateTemplate(
            NEEDS_ONE_OF_ROLES_TEMPLATE,
            { roles: titles },
            LOCK_SENTENCE_OPTIONS,
          );
    }

    return named.titles.length === 1
      ? words.translateTemplate(
          NEEDS_PERMISSION_TEMPLATE,
          { permission: titles },
          LOCK_SENTENCE_OPTIONS,
        )
      : words.translateTemplate(
          NEEDS_ONE_OF_PERMISSIONS_TEMPLATE,
          { permissions: titles },
          LOCK_SENTENCE_OPTIONS,
        );
  }

  /*
   * Titles as a sentence lists them: each looked up (a built-in role's
   * name has a translation of its own; most permissions' titles do not and
   * read as given), joined with the commas of the script they are written
   * in (ListSeparator) - "مالک پروژه، مدیر پروژه" in Persian, where a Latin
   * comma stood between them.
   */
  private static translateTitles(
    titles: ReadonlyArray<string>,
    translator: Translator,
  ): string {
    const translated: Array<string> = titles.map((title: string): string => {
      return translator.translateText(title) || title;
    });

    return translated.join(getListSeparator(translated));
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
   * Whether the user may read one column of a record a relation reaches -
   * `{ dataStore: { sensitivity: true } }` on a data asset - as the server
   * decides a select through the relation (RelationReadersUtil
   * .mayReadThroughRelation, QueryPermission.checkRelationQueryPermission):
   * a label every reader of the relation reads; a column held to its own
   * read only when the user may read it on the related record (#10281); an
   * id or a time by the related record's read; nothing else. On a person's
   * own records CurrentUser is never counted, as the server never counts it
   * through a relation the read is not pinned to them by. A master admin
   * reads everything.
   *
   * Before the snapshot has landed nothing tells a column the user may read
   * from one they may not, so this answers yes and the server decides, as a
   * table asks for its secondary fields (BaseModelTable): answering no would
   * leave the column out of a read for the readers who may read it too,
   * with nothing to read it again once the snapshot lands.
   */
  public static canReadThroughRelation(
    relatedModel: BaseModel,
    column: string,
    options?: PermissionGateOptions | undefined,
  ): boolean {
    if (User.isMasterAdmin() || !this.hasPermissionSnapshot(options)) {
      return true;
    }

    const isPersonsOwnRecord: boolean =
      relatedModel.tableName === "User" ||
      Boolean(relatedModel.getUserColumn());

    return RelationReadersUtil.mayReadThroughRelation({
      relatedModel: relatedModel,
      column: column,
      held: this.getHeldPermissions(options),
      notCounted: isPersonsOwnRecord ? [Permission.CurrentUser] : [],
    });
  }

  /*
   * A select as this user sends it: every column of a related record that
   * a relation reads only for those who may read it on the record itself,
   * and this user may not (canReadThroughRelation), left out - so a page
   * reads the rest in one request, rather than being refused all of it for
   * one column (RelationReadersUtil.getSelectReadableThroughRelations,
   * #10281). The select handed in is never changed.
   */
  public static getSelectReadableThroughRelations<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    select: Select<TBaseModel>,
    options?: PermissionGateOptions | undefined,
  ): Select<TBaseModel> {
    return RelationReadersUtil.getSelectReadableThroughRelations<TBaseModel>({
      model: new modelType(),
      select: select,
      mayRead: (relatedModel: BaseModel, column: string): boolean => {
        return this.canReadThroughRelation(relatedModel, column, options);
      },
    });
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
