import IconProp from "Common/Types/Icon/IconProp";
import { ResourceOwnerEntry } from "../Components/ResourceOwners/OwnerEntry";

/*
 * Who runs an incident, an alert or an episode, as the top of its overview
 * says it: the person in the project's primary incident role (Incident
 * Commander, unless the project renamed it) and the record's owners, teams
 * first. Pure and free of React, so the App suite, which has no renderer,
 * holds the rules; the header draws what these return.
 */

// One of the project's incident roles, as the record's roles card reads it.
export interface EventRole {
  id: string;
  name: string;
  /*
   * The project's primary role. A new project starts with one, Incident
   * Commander, and nobody can make another (IncidentRole.isPrimaryRole takes
   * no writes); it takes one person at a time (IncidentRoleService).
   */
  isPrimaryRole: boolean;
  icon?: IconProp | undefined;
}

// Somebody holding one of those roles on the record.
export interface EventRoleMember {
  roleId: string;
  userId: string;
  name: string;
  email?: string | undefined;
  // Whether the person uploaded a picture, so the avatar asks for it.
  hasProfilePicture: boolean;
}

// What the roles card reports each time it has read the record's roles.
export interface EventRolesSnapshot {
  roles: Array<EventRole>;
  members: Array<EventRoleMember>;
}

/*
 * A row of the record's role assignments (IncidentMember for an incident,
 * IncidentEpisodeRoleMember for an incident episode), as the roles card
 * reads it.
 */
export interface EventRoleMemberRow {
  incidentRoleId?: { toString: () => string } | undefined | null;
  userId?: { toString: () => string } | undefined | null;
  user?:
    | {
        name?: { toString: () => string } | string | undefined | null;
        email?: { toString: () => string } | string | undefined | null;
        profilePictureId?: unknown;
      }
    | undefined
    | null;
}

// The person a role assignment names, as the header draws them.
export const toEventRoleMember: (row: EventRoleMemberRow) => EventRoleMember = (
  row: EventRoleMemberRow,
): EventRoleMember => {
  return {
    roleId: row.incidentRoleId?.toString() || "",
    userId: row.userId?.toString() || "",
    name: row.user?.name?.toString().trim() || "",
    email: row.user?.email?.toString().trim() || undefined,
    hasProfilePicture: Boolean(row.user?.profilePictureId),
  };
};

export interface PrimaryRoleHolding {
  role: EventRole;
  // Who holds it on the record: empty while nobody does.
  members: Array<EventRoleMember>;
}

/*
 * The project's primary role and who holds it on the record, or null when
 * the project has no primary role (a project from before roles were seeded),
 * in which case the header names no commander at all rather than one that
 * cannot be assigned.
 */
export const getPrimaryRoleHolding: (
  snapshot: EventRolesSnapshot | null | undefined,
) => PrimaryRoleHolding | null = (
  snapshot: EventRolesSnapshot | null | undefined,
): PrimaryRoleHolding | null => {
  if (!snapshot) {
    return null;
  }

  const role: EventRole | undefined = snapshot.roles.find(
    (candidate: EventRole): boolean => {
      return candidate.isPrimaryRole;
    },
  );

  if (!role) {
    return null;
  }

  return {
    role: role,
    members: snapshot.members.filter((member: EventRoleMember): boolean => {
      return member.roleId === role.id;
    }),
  };
};

// A person picked from a people list, as the people picker hands them over.
export interface PickedEventPerson {
  id: string;
  name: string;
  // The line under a person's name in the list: their email.
  description?: string | undefined;
  hasProfilePicture?: boolean | undefined;
}

/*
 * The roles as they are once the header's Assign gave one to `person`: the
 * same, with them holding it - so the header names them the moment the
 * role is given, before the roles card has read the record again and says
 * the same. Another record's roles are left as they are.
 */
export const withRoleGiven: (data: {
  snapshot: EventRolesSnapshot | undefined;
  roleId: string;
  person: PickedEventPerson;
}) => EventRolesSnapshot | undefined = (data: {
  snapshot: EventRolesSnapshot | undefined;
  roleId: string;
  person: PickedEventPerson;
}): EventRolesSnapshot | undefined => {
  if (!data.snapshot) {
    return data.snapshot;
  }

  const alreadyHolds: boolean = data.snapshot.members.some(
    (member: EventRoleMember): boolean => {
      return (
        member.roleId === data.roleId &&
        member.userId.toLowerCase() === data.person.id.toLowerCase()
      );
    },
  );

  if (alreadyHolds) {
    return data.snapshot;
  }

  const email: string | undefined =
    data.person.description?.trim() || undefined;
  const name: string = data.person.name.trim();

  return {
    roles: data.snapshot.roles,
    members: [
      ...data.snapshot.members,
      {
        roleId: data.roleId,
        userId: data.person.id,
        // A person without a name is listed by their email: named by it.
        name: name && name !== email ? name : "",
        email: email,
        hasProfilePicture: Boolean(data.person.hasProfilePicture),
      },
    ],
  };
};

/*
 * How many owners the header names before "+N more". Three keeps the people
 * row to one line beside the commander on a laptop, and a record with more
 * owners than that has its Owners page for the rest.
 */
export const MAX_HEADER_OWNERS: number = 3;

// The name an owner goes by: a team's name, a person's name or email.
export const getEventOwnerName: (owner: ResourceOwnerEntry) => string = (
  owner: ResourceOwnerEntry,
): string => {
  if (owner.kind === "team") {
    return owner.team.name?.toString().trim() || "";
  }

  return (
    owner.user.name?.toString().trim() ||
    owner.user.email?.toString().trim() ||
    ""
  );
};

/*
 * The record's owners in the order the header names them: teams first - a
 * team is who the response belongs to, the customer's "Team(s)" - then
 * people, each group by name, so the same owners always read the same way
 * whatever order the two reads came back in.
 */
export const orderEventOwners: (
  owners: Array<ResourceOwnerEntry>,
) => Array<ResourceOwnerEntry> = (
  owners: Array<ResourceOwnerEntry>,
): Array<ResourceOwnerEntry> => {
  return [...owners].sort(
    (first: ResourceOwnerEntry, second: ResourceOwnerEntry): number => {
      if (first.kind !== second.kind) {
        return first.kind === "team" ? -1 : 1;
      }

      return getEventOwnerName(first).localeCompare(
        getEventOwnerName(second),
        undefined,
        { sensitivity: "base", numeric: true },
      );
    },
  );
};
