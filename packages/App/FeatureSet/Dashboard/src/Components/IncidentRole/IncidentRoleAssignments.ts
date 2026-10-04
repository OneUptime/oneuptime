import IncidentRole from "Common/Models/DatabaseModels/IncidentRole";
import type { EpisodeMemberRoleAssignment } from "Common/Models/DatabaseModels/IncidentGroupingRule";
import Select from "Common/Types/BaseDatabase/Select";
import IconProp from "Common/Types/Icon/IconProp";
import type { IncidentMemberRoleAssignment } from "Common/Types/Monitor/CriteriaIncident";
import ObjectID from "Common/Types/ObjectID";

/*
 * Who takes each incident role, the way the one role picker
 * (Incident/IncidentRoleFormField) holds it: per role, the people picked for
 * it.
 *
 * The maintainer, closing the feedback document: "find similar issues across
 * the project and fix them as well. The idea is to make software as simple
 * as possible to use and reduce decision paralysis." Incident roles were
 * picked four ways: Declare Incident's cards, a monitor rule's dropdowns -
 * a multi-select tagged "Multiple" for some roles, a single one for the
 * rest - a grouping rule's cards tagged "Primary" and "Multiple", and the
 * incident's Roles card. Now every form draws the declare form's cards, and
 * whether a role takes more than one person shows the one way it matters:
 * a role that takes one person drops its picker once it has one.
 *
 * Each form still stores what it stored before, so monitors, grouping rules
 * and the API read the same JSON: a monitor rule keeps one
 * { roleId, userId } row per person (CriteriaIncident.incidentMemberRoles),
 * a grouping rule one { userId, incidentRoleId } row per person
 * (episodeMemberRoleAssignments). The converters below turn those rows into
 * the picker's value and back.
 *
 * Kept free of React, so App/Tests/Dashboard/IncidentRoleAssignments reads
 * these exact rules.
 */

// Per role, the people picked for it: the picker's value.
export interface RoleAssignment {
  roleId: string;
  userIds: Array<string>;
}

// A role as the picker draws it.
export interface IncidentRoleChoice {
  id: string;
  name: string;
  // The role's colour, as a hex string.
  color?: string | undefined;
  icon?: IconProp | undefined;
  // Unset, the role takes one person.
  canAssignMultipleUsers?: boolean | undefined;
  /*
   * Incident Commander and any other primary role: tagged Primary, and
   * listed first. Declaring an incident, you take one you leave empty.
   */
  isPrimaryRole?: boolean | undefined;
}

/*
 * What the picker reads of each role. A form that loads the roles itself,
 * for the picker to draw (the monitor criteria, once for all their
 * incidents), reads the same.
 */
export const INCIDENT_ROLE_CHOICE_SELECT: Select<IncidentRole> = {
  _id: true,
  name: true,
  color: true,
  roleIcon: true,
  canAssignMultipleUsers: true,
  isPrimaryRole: true,
};

export const toIncidentRoleChoice: (
  role: IncidentRole,
) => IncidentRoleChoice = (role: IncidentRole): IncidentRoleChoice => {
  const choice: IncidentRoleChoice = {
    id: role._id?.toString() || "",
    name: role.name || "",
    canAssignMultipleUsers: Boolean(role.canAssignMultipleUsers),
    isPrimaryRole: Boolean(role.isPrimaryRole),
  };

  if (role.color) {
    choice.color = role.color.toString();
  }

  if (role.roleIcon) {
    choice.icon = role.roleIcon;
  }

  return choice;
};

// Primary roles first, then by name - whatever order they arrive in.
export const sortIncidentRoleChoices: (
  roles: Array<IncidentRoleChoice>,
) => Array<IncidentRoleChoice> = (
  roles: Array<IncidentRoleChoice>,
): Array<IncidentRoleChoice> => {
  return [...roles].sort(
    (a: IncidentRoleChoice, b: IncidentRoleChoice): number => {
      if (Boolean(a.isPrimaryRole) !== Boolean(b.isPrimaryRole)) {
        return a.isPrimaryRole ? -1 : 1;
      }

      return a.name.localeCompare(b.name);
    },
  );
};

/*
 * Whether the picker offers one more person for a role: always for a role
 * that takes several, and for one that takes one person until it has one.
 */
export const canPickAnotherPerson: (
  role: IncidentRoleChoice,
  pickedCount: number,
) => boolean = (role: IncidentRoleChoice, pickedCount: number): boolean => {
  return Boolean(role.canAssignMultipleUsers) || pickedCount === 0;
};

// The people picked for a role, in the order they were picked.
export const getPickedUserIds: (
  assignments: Array<RoleAssignment>,
  roleId: string,
) => Array<string> = (
  assignments: Array<RoleAssignment>,
  roleId: string,
): Array<string> => {
  return (
    assignments.find((assignment: RoleAssignment): boolean => {
      return assignment.roleId === roleId;
    })?.userIds || []
  );
};

/*
 * The assignments with one role's people replaced: the role keeps its
 * place, a role picked for the first time goes last, and a role left with
 * nobody is dropped. The list handed in is not changed.
 */
export const withRoleUsers: (
  assignments: Array<RoleAssignment>,
  roleId: string,
  userIds: Array<string>,
) => Array<RoleAssignment> = (
  assignments: Array<RoleAssignment>,
  roleId: string,
  userIds: Array<string>,
): Array<RoleAssignment> => {
  if (userIds.length === 0) {
    return assignments.filter((assignment: RoleAssignment): boolean => {
      return assignment.roleId !== roleId;
    });
  }

  const isPicked: boolean = assignments.some(
    (assignment: RoleAssignment): boolean => {
      return assignment.roleId === roleId;
    },
  );

  if (!isPicked) {
    return [...assignments, { roleId: roleId, userIds: [...userIds] }];
  }

  return assignments.map((assignment: RoleAssignment): RoleAssignment => {
    return assignment.roleId === roleId
      ? { roleId: roleId, userIds: [...userIds] }
      : assignment;
  });
};

/*
 * The assignments to roles the project still has. A monitor rule or a
 * grouping rule can name someone for a role that was deleted since: no card
 * shows it, so nobody could take it off, and nobody is ever assigned it. The
 * picker drops it from the value it hands on, and the monitor rule does not
 * count it as set.
 */
export const keepKnownRoles: (
  assignments: Array<RoleAssignment>,
  roles: Array<IncidentRoleChoice>,
) => Array<RoleAssignment> = (
  assignments: Array<RoleAssignment>,
  roles: Array<IncidentRoleChoice>,
): Array<RoleAssignment> => {
  const roleIds: Set<string> = new Set<string>(
    roles.map((role: IncidentRoleChoice): string => {
      return role.id;
    }),
  );

  return assignments.filter((assignment: RoleAssignment): boolean => {
    return roleIds.has(assignment.roleId) && assignment.userIds.length > 0;
  });
};

/*
 * An id as a saved row holds it: an ObjectID once the monitor's JSON is
 * read back, a plain string in a grouping rule - or, read raw, the
 * { _type: "ObjectID", value } JSON an ObjectID is saved as. Both object
 * forms carry the id in `value` (an ObjectID through its getter). Null when
 * the row has none.
 */
const idOf: (value: unknown) => string | null = (
  value: unknown,
): string | null => {
  if (typeof value === "string") {
    return value || null;
  }

  if (value && typeof value === "object") {
    const id: unknown = (value as { value?: unknown }).value;

    if (typeof id === "string") {
      return id || null;
    }
  }

  return null;
};

/*
 * Rows of one person each, grouped by role: roles in the order they first
 * appear, people in their order, each person once per role. A row missing
 * its role or its person is left out - it assigns nobody.
 */
const groupByRole: <TRow>(
  rows: Array<TRow> | undefined,
  roleOf: (row: TRow) => unknown,
  userOf: (row: TRow) => unknown,
) => Array<RoleAssignment> = <TRow>(
  rows: Array<TRow> | undefined,
  roleOf: (row: TRow) => unknown,
  userOf: (row: TRow) => unknown,
): Array<RoleAssignment> => {
  let assignments: Array<RoleAssignment> = [];

  for (const row of rows || []) {
    const roleId: string | null = idOf(roleOf(row));
    const userId: string | null = idOf(userOf(row));

    if (!roleId || !userId) {
      continue;
    }

    const picked: Array<string> = getPickedUserIds(assignments, roleId);

    if (!picked.includes(userId)) {
      assignments = withRoleUsers(assignments, roleId, [...picked, userId]);
    }
  }

  return assignments;
};

// Each person picked, in order, as one pair.
const eachPick: (
  assignments: Array<RoleAssignment>,
) => Array<{ roleId: string; userId: string }> = (
  assignments: Array<RoleAssignment>,
): Array<{ roleId: string; userId: string }> => {
  const picks: Array<{ roleId: string; userId: string }> = [];

  for (const assignment of assignments) {
    for (const userId of assignment.userIds) {
      picks.push({ roleId: assignment.roleId, userId: userId });
    }
  }

  return picks;
};

// A monitor rule's incident roles (CriteriaIncident.incidentMemberRoles).
export const criteriaRolesToAssignments: (
  rows: Array<IncidentMemberRoleAssignment> | undefined,
) => Array<RoleAssignment> = (
  rows: Array<IncidentMemberRoleAssignment> | undefined,
): Array<RoleAssignment> => {
  return groupByRole<IncidentMemberRoleAssignment>(
    rows,
    (row: IncidentMemberRoleAssignment): unknown => {
      return row?.roleId;
    },
    (row: IncidentMemberRoleAssignment): unknown => {
      return row?.userId;
    },
  );
};

export const assignmentsToCriteriaRoles: (
  assignments: Array<RoleAssignment>,
) => Array<IncidentMemberRoleAssignment> = (
  assignments: Array<RoleAssignment>,
): Array<IncidentMemberRoleAssignment> => {
  return eachPick(assignments).map(
    (pick: {
      roleId: string;
      userId: string;
    }): IncidentMemberRoleAssignment => {
      return {
        roleId: new ObjectID(pick.roleId),
        userId: new ObjectID(pick.userId),
      };
    },
  );
};

// A grouping rule's episode roles (episodeMemberRoleAssignments).
export const episodeRolesToAssignments: (
  rows: Array<EpisodeMemberRoleAssignment> | undefined,
) => Array<RoleAssignment> = (
  rows: Array<EpisodeMemberRoleAssignment> | undefined,
): Array<RoleAssignment> => {
  return groupByRole<EpisodeMemberRoleAssignment>(
    rows,
    (row: EpisodeMemberRoleAssignment): unknown => {
      return row?.incidentRoleId;
    },
    (row: EpisodeMemberRoleAssignment): unknown => {
      return row?.userId;
    },
  );
};

export const assignmentsToEpisodeRoles: (
  assignments: Array<RoleAssignment>,
) => Array<EpisodeMemberRoleAssignment> = (
  assignments: Array<RoleAssignment>,
): Array<EpisodeMemberRoleAssignment> => {
  return eachPick(assignments).map(
    (pick: { roleId: string; userId: string }): EpisodeMemberRoleAssignment => {
      return { userId: pick.userId, incidentRoleId: pick.roleId };
    },
  );
};
