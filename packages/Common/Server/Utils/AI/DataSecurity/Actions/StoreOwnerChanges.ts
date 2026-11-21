import DataStoreOwnerRule from "../../../../../Models/DatabaseModels/DataStoreOwnerRule";
import DataStoreOwnerTeam from "../../../../../Models/DatabaseModels/DataStoreOwnerTeam";
import DataStoreOwnerUser from "../../../../../Models/DatabaseModels/DataStoreOwnerUser";
import Team from "../../../../../Models/DatabaseModels/Team";
import User from "../../../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  DataStoreOwnerKind,
  DataStoreOwnerRef,
  MAX_PROPOSED_DATA_STORE_OWNERS,
  readDataStoreOwnerRef,
} from "../../../../../Types/DataSecurity/DataStoreOwnerProposal";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import TeamService from "../../../../Services/TeamService";
import UserService from "../../../../Services/UserService";
import { DataStoreOwnerRow } from "../../../DataSecurity/Owners/DataStoreOwnerWrites";
import CallerPermission from "../../../Permission/CallerPermission";

/*
 * WHAT APPROVING, CHANGING AND UNDOING OWNERS TAKES (#10374), shared by a
 * store's owners (SetStoreOwnersAction) and an owner rule
 * (CreateOwnerRuleAction).
 *
 * Approving owners takes what adding them on a store's Owners page takes -
 * the permission to create its user owners, its team owners, or both - and
 * a rule, what creating an owner rule takes besides. Undoing takes what
 * removing them takes. Each refusal names the permission to ask for. The
 * change itself is made with the person's own props, so these never widen
 * what they may do: they say why before anything is claimed.
 */

const OWNER_PERMISSIONS: Readonly<
  Record<
    DataStoreOwnerKind,
    {
      create: Array<Permission>;
      delete: Array<Permission>;
      what: string;
      createTitle: string;
      deleteTitle: string;
    }
  >
> = {
  [DataStoreOwnerKind.User]: {
    create: new DataStoreOwnerUser().createRecordPermissions,
    delete: new DataStoreOwnerUser().deleteRecordPermissions,
    what: "people",
    createTitle: "Create Data Store User Owner",
    deleteTitle: "Delete Data Store User Owner",
  },
  [DataStoreOwnerKind.Team]: {
    create: new DataStoreOwnerTeam().createRecordPermissions,
    delete: new DataStoreOwnerTeam().deleteRecordPermissions,
    what: "teams",
    createTitle: "Create Data Store Team Owner",
    deleteTitle: "Delete Data Store Team Owner",
  },
};

export const OWNER_RULE_PERMISSIONS: {
  create: Array<Permission>;
  delete: Array<Permission>;
} = {
  create: new DataStoreOwnerRule().createRecordPermissions,
  delete: new DataStoreOwnerRule().deleteRecordPermissions,
};

export function holdsAnyOf(
  props: DatabaseCommonInteractionProps,
  permissions: Array<Permission>,
): boolean {
  return (
    props.isRoot === true ||
    props.isMasterAdmin === true ||
    CallerPermission.holdsAnyOf(props, permissions)
  );
}

function kindsOf(
  owners: ReadonlyArray<{ kind: DataStoreOwnerKind }>,
): Array<DataStoreOwnerKind> {
  return [DataStoreOwnerKind.Team, DataStoreOwnerKind.User].filter(
    (kind: DataStoreOwnerKind): boolean => {
      return owners.some((owner: { kind: DataStoreOwnerKind }): boolean => {
        return owner.kind === kind;
      });
    },
  );
}

// Why this person may not add these owners, or null.
export function getAddOwnersRefusal(
  props: DatabaseCommonInteractionProps,
  owners: ReadonlyArray<{ kind: DataStoreOwnerKind }>,
): string | null {
  for (const kind of kindsOf(owners)) {
    if (!holdsAnyOf(props, OWNER_PERMISSIONS[kind].create)) {
      return `Approving this adds ${OWNER_PERMISSIONS[kind].what} as owners of data stores, and you do not have permission to add them. Ask a Project Owner or Project Admin, or for ${OWNER_PERMISSIONS[kind].createTitle}.`;
    }
  }

  return null;
}

// Why this person may not remove the owners a change added, or null.
export function getRemoveOwnersRefusal(
  props: DatabaseCommonInteractionProps,
  rows: ReadonlyArray<DataStoreOwnerRow>,
): string | null {
  for (const kind of kindsOf(rows)) {
    if (!holdsAnyOf(props, OWNER_PERMISSIONS[kind].delete)) {
      return `Undoing this removes ${OWNER_PERMISSIONS[kind].what} as owners of data stores, and you do not have permission to remove them. Ask a Project Owner or Project Admin, or for ${OWNER_PERMISSIONS[kind].deleteTitle}.`;
    }
  }

  return null;
}

/*
 * The owners a person picked instead of the proposed ones: {"owners":
 * [{"kind": "Team", "id": "..."}]}, at least one, each once, at most
 * MAX_PROPOSED_DATA_STORE_OWNERS.
 */
export function readOwnerChanges(changes: unknown): Array<DataStoreOwnerRef> {
  const raw: JSONObject =
    changes && typeof changes === "object" && !Array.isArray(changes)
      ? (changes as JSONObject)
      : {};
  const items: Array<unknown> = Array.isArray(raw["owners"])
    ? (raw["owners"] as Array<unknown>)
    : [];
  const owners: Array<DataStoreOwnerRef> = [];

  for (const item of items) {
    const ref: DataStoreOwnerRef | null = readDataStoreOwnerRef(item);

    if (!ref || !ObjectID.isValidUUID(ref.id)) {
      throw new BadDataException(
        "An owner you picked is no person or team, so nothing was done. Pick the owners again.",
      );
    }

    if (
      !owners.some((owner: DataStoreOwnerRef): boolean => {
        return (
          owner.kind === ref.kind &&
          owner.id.toLowerCase() === ref.id.toLowerCase()
        );
      })
    ) {
      owners.push({ kind: ref.kind, id: ref.id.toLowerCase() });
    }
  }

  if (owners.length === 0) {
    throw new BadDataException(
      "Pick at least one owner, or dismiss the proposal instead.",
    );
  }

  if (owners.length > MAX_PROPOSED_DATA_STORE_OWNERS) {
    throw new BadDataException(
      `Pick at most ${MAX_PROPOSED_DATA_STORE_OWNERS} owners at once, so nothing was done.`,
    );
  }

  return owners;
}

// The owners with their names: a team's, a person's name or email.
export async function nameOwners(data: {
  projectId: ObjectID;
  owners: ReadonlyArray<DataStoreOwnerRef>;
}): Promise<Array<DataStoreOwnerRef & { name: string }>> {
  const named: Array<DataStoreOwnerRef & { name: string }> = [];

  for (const owner of data.owners) {
    if (owner.kind === DataStoreOwnerKind.Team) {
      const team: Team | null = await TeamService.findOneBy({
        query: { _id: new ObjectID(owner.id), projectId: data.projectId },
        select: { _id: true, name: true },
        props: { isRoot: true },
      });

      named.push({ ...owner, name: team?.name || "" });
      continue;
    }

    const user: User | null = await UserService.findOneById({
      id: new ObjectID(owner.id),
      select: { _id: true, name: true, email: true },
      props: { isRoot: true },
    });

    named.push({
      ...owner,
      name: user?.name?.toString() || user?.email?.toString() || "",
    });
  }

  return named;
}
