import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import {
  getPeoplePickerOptionKey,
  PeoplePickerKind,
  PeoplePickerOption,
  PeopleSearchLockedKind,
} from "Common/UI/Components/PeoplePicker/PeoplePickerTypes";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionCheckableModel,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { ResourceOwnerEntry } from "../ResourceOwners/OwnerEntry";

/*
 * Adding an owner to one record - an incident, an alert, an episode, a
 * scheduled maintenance event, a monitor, an SLO - wherever the record is
 * on screen: its Owners page, and the places that name its owners (an
 * overview's header, a postmortem). One set of rules for all of them, so an
 * owner is added the same way whichever "Add" was pressed:
 *
 *   - who may add: the create permission on the record's two owner tables,
 *     one for people and one for teams; a kind the reader may not add is
 *     locked in the list with the reason, and the server keeps the last
 *     word (an Owned-only role adds owners only to what it owns);
 *   - who can be picked: the project's own people and teams - the people
 *     picker's search (PeoplePickerKinds);
 *   - no duplicates: whoever owns the record already is left out of the
 *     list, and the server refuses a second row for the same person or team;
 *   - the notifications: an owner is added as the Owners page always added
 *     one - one owner row, and nothing else - so the server tells the new
 *     owner they were added (the owner-added notification jobs), writes the
 *     record's feed, and invites them to its chat channels as it always has.
 */

// The record's two owner tables, and the column of theirs that names it.
export interface OwnerTables {
  ownerUserModelType: { new (): BaseModel };
  ownerTeamModelType: { new (): BaseModel };
  // The owner rows' column naming the record: "incidentId", "monitorId", ...
  resourceIdField: string;
}

// One record's owners, to add to.
export interface OwnersTarget extends OwnerTables {
  resourceId: ObjectID;
}

// What a pick came to, for the place that shows the owners.
export interface OwnersChange {
  // An owner was added; false when the server refused the pick.
  wasAdded: boolean;
}

// What the controls that open the list say, and what the list is named.
export const ADD_OWNERS_TEXT: string = translationKey("Add owners");

// Said under the list after a pick: what it did, by name.
export const OWNER_ADDED_NOTICE: string = translationKey("Added {{name}}.");

/*
 * What the list says once everybody it would offer owns the record already
 * - the last team of a small project just added - rather than "No people
 * or teams available.", which reads as if the project had nobody.
 */
export const NO_ONE_ELSE_TO_ADD_TEXT: string = translationKey(
  "No one else to add.",
);

// Why the reader may add no owner at all, before the permissions that would.
export const ADD_OWNERS_REFUSED_SENTENCE: string = translationKey(
  "You do not have permission to add owners.",
);

// Why one kind is locked in the list, before the permissions that would open it.
export const ADD_OWNER_KIND_REFUSED_SENTENCES: Record<
  PeoplePickerKind.User | PeoplePickerKind.Team,
  string
> = {
  [PeoplePickerKind.User]: translationKey(
    "You do not have permission to add people as owners.",
  ),
  [PeoplePickerKind.Team]: translationKey(
    "You do not have permission to add teams as owners.",
  ),
};

type OwnerKind = PeoplePickerKind.User | PeoplePickerKind.Team;

// People first, then teams: the order the Owners page and the list use.
const OWNER_KINDS: Array<OwnerKind> = [
  PeoplePickerKind.User,
  PeoplePickerKind.Team,
];

const getOwnerTable: (
  tables: OwnerTables,
  kind: OwnerKind,
) => { new (): BaseModel } = (
  tables: OwnerTables,
  kind: OwnerKind,
): { new (): BaseModel } => {
  return kind === PeoplePickerKind.User
    ? tables.ownerUserModelType
    : tables.ownerTeamModelType;
};

/*
 * Whether the reader may add an owner of `kind`: PermissionGate's answer,
 * with the reason, worded for owners, when they may not.
 */
export const getAddOwnerKindGate: (
  tables: OwnerTables,
  kind: OwnerKind,
) => PermissionGateResult = (
  tables: OwnerTables,
  kind: OwnerKind,
): PermissionGateResult => {
  const OwnerTable: { new (): BaseModel } = getOwnerTable(tables, kind);

  return PermissionGate.check(new OwnerTable(), ModelAction.Create, {
    sentence: ADD_OWNER_KIND_REFUSED_SENTENCES[kind],
  });
};

/*
 * Whether the reader may add an owner of either kind, known from the
 * permission snapshot: false until it has landed, so a control that adds
 * owners is offered only to someone the server will let add one.
 */
export const canAddOwners: (tables: OwnerTables) => boolean = (
  tables: OwnerTables,
): boolean => {
  return OWNER_KINDS.some((kind: OwnerKind): boolean => {
    return getAddOwnerKindGate(tables, kind).isAllowed;
  });
};

/*
 * The record's two owner tables as one, for the reason a control that adds
 * owners of either kind is locked: either table's create permission would
 * open it, so the reason names the permissions of both - a reader asking
 * for "Create Incident Team Owner" may add owners too.
 */
export const getEitherOwnerTable: (
  tables: OwnerTables,
) => PermissionCheckableModel = (
  tables: OwnerTables,
): PermissionCheckableModel => {
  const people: BaseModel = new tables.ownerUserModelType();
  const teams: BaseModel = new tables.ownerTeamModelType();
  const createPermissions: Array<Permission> = [];

  for (const permission of [
    ...people.getCreatePermissions(),
    ...teams.getCreatePermissions(),
  ]) {
    if (!createPermissions.includes(permission)) {
      createPermissions.push(permission);
    }
  }

  return {
    singularName: people.singularName,
    isOperationalResource: people.isOperationalResource,
    hasCreatePermissions: (permissions: Array<Permission>): boolean => {
      return (
        people.hasCreatePermissions(permissions) ||
        teams.hasCreatePermissions(permissions)
      );
    },
    hasReadPermissions: (permissions: Array<Permission>): boolean => {
      return people.hasReadPermissions(permissions);
    },
    hasUpdatePermissions: (permissions: Array<Permission>): boolean => {
      return people.hasUpdatePermissions(permissions);
    },
    hasDeletePermissions: (permissions: Array<Permission>): boolean => {
      return people.hasDeletePermissions(permissions);
    },
    getCreatePermissions: (): Array<Permission> => {
      return createPermissions;
    },
    getReadPermissions: (): Array<Permission> => {
      return people.getReadPermissions();
    },
    getUpdatePermissions: (): Array<Permission> => {
      return people.getUpdatePermissions();
    },
    getDeletePermissions: (): Array<Permission> => {
      return people.getDeletePermissions();
    },
  };
};

/*
 * The gate on a control that adds owners and stays on screen for everyone
 * (the Owners page's Add owner): open when the reader may add either kind,
 * or before the permissions are known (the server decides); locked, with
 * why, when they may add neither.
 */
export const getAddOwnersGate: (tables: OwnerTables) => PermissionGateResult = (
  tables: OwnerTables,
): PermissionGateResult => {
  if (canAddOwners(tables)) {
    return { isAllowed: true };
  }

  const gate: PermissionGateResult = PermissionGate.check(
    getEitherOwnerTable(tables),
    ModelAction.Create,
    { sentence: ADD_OWNERS_REFUSED_SENTENCE },
  );

  // Not known yet: nothing honest to say, so the control stays open.
  if (!gate.disabledReason) {
    return { isAllowed: true };
  }

  return gate;
};

export interface OwnerKindAccess {
  // The kinds the list offers, people first.
  kinds: Array<PeoplePickerKind>;
  // The kinds it names locked, with why.
  locked: Array<PeopleSearchLockedKind>;
}

/*
 * What the list offers the reader: each kind they may add - or whose answer
 * is not known yet, for the server to decide - and, locked with the reason,
 * each kind they may not.
 */
export const getOwnerKindAccess: (tables: OwnerTables) => OwnerKindAccess = (
  tables: OwnerTables,
): OwnerKindAccess => {
  const access: OwnerKindAccess = { kinds: [], locked: [] };

  for (const kind of OWNER_KINDS) {
    const gate: PermissionGateResult = getAddOwnerKindGate(tables, kind);

    if (gate.isAllowed || !gate.disabledReason) {
      access.kinds.push(kind);
      continue;
    }

    access.locked.push({ kind: kind, reason: gate.disabledReason });
  }

  return access;
};

/*
 * The owner row for a pick, as the Owners page has always written it: the
 * record, the project, and the person or the team - nothing else, so the
 * row starts as an owner nobody has told yet and the server tells them.
 */
export const buildOwnerRow: (data: {
  target: OwnersTarget;
  option: PeoplePickerOption;
  projectId: ObjectID;
}) => { model: BaseModel; modelType: { new (): BaseModel } } = (data: {
  target: OwnersTarget;
  option: PeoplePickerOption;
  projectId: ObjectID;
}): { model: BaseModel; modelType: { new (): BaseModel } } => {
  if (
    data.option.kind !== PeoplePickerKind.User &&
    data.option.kind !== PeoplePickerKind.Team
  ) {
    throw new BadDataException("Only a person or a team can be an owner.");
  }

  const modelType: { new (): BaseModel } = getOwnerTable(
    data.target,
    data.option.kind,
  );
  const model: BaseModel = new modelType();
  const fields: Record<string, unknown> = model as unknown as Record<
    string,
    unknown
  >;

  fields[data.target.resourceIdField] = data.target.resourceId;
  fields["projectId"] = data.projectId;
  fields[data.option.kind === PeoplePickerKind.User ? "userId" : "teamId"] =
    new ObjectID(data.option.id);

  return { model, modelType };
};

// Adds the pick as an owner of the record. Rejects with the server's reason.
export const addOwner: (
  target: OwnersTarget,
  option: PeoplePickerOption,
) => Promise<void> = async (
  target: OwnersTarget,
  option: PeoplePickerOption,
): Promise<void> => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId) {
    throw new BadDataException("Project not found");
  }

  const row: { model: BaseModel; modelType: { new (): BaseModel } } =
    buildOwnerRow({ target, option, projectId });

  await ModelAPI.create<BaseModel>({
    model: row.model,
    modelType: row.modelType,
  });
};

// The owners as the list's keys (getPeoplePickerOptionKey): who it leaves out.
export const getOwnerKeys: (
  owners: Array<ResourceOwnerEntry> | undefined,
) => Set<string> = (
  owners: Array<ResourceOwnerEntry> | undefined,
): Set<string> => {
  const keys: Set<string> = new Set<string>();

  for (const owner of owners || []) {
    const id: string =
      owner.kind === "team"
        ? owner.team._id?.toString() || ""
        : owner.user._id?.toString() || "";

    if (!id) {
      continue;
    }

    keys.add(
      getPeoplePickerOptionKey(
        owner.kind === "team" ? PeoplePickerKind.Team : PeoplePickerKind.User,
        id,
      ),
    );
  }

  return keys;
};
