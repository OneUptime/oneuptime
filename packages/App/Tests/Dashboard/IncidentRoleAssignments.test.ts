import {
  assignmentsToCriteriaRoles,
  assignmentsToEpisodeRoles,
  canPickAnotherPerson,
  criteriaRolesToAssignments,
  episodeRolesToAssignments,
  getPickedUserIds,
  keepKnownRoles,
  INCIDENT_ROLE_CHOICE_SELECT,
  IncidentRoleChoice,
  RoleAssignment,
  sortIncidentRoleChoices,
  toIncidentRoleChoice,
  withRoleUsers,
} from "../../FeatureSet/Dashboard/src/Components/IncidentRole/IncidentRoleAssignments";
import IncidentRole from "Common/Models/DatabaseModels/IncidentRole";
import { EpisodeMemberRoleAssignment } from "Common/Models/DatabaseModels/IncidentGroupingRule";
import Color from "Common/Types/Color";
import IconProp from "Common/Types/Icon/IconProp";
import { IncidentMemberRoleAssignment } from "Common/Types/Monitor/CriteriaIncident";
import ObjectID from "Common/Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * Incident roles are assigned with one picker everywhere
 * (Components/Incident/IncidentRoleFormField): Declare Incident, Create
 * Incident Episode, a monitor rule's incident and a grouping rule's
 * episodes. The rules it follows, and the converters that let a monitor
 * rule and a grouping rule keep the rows they always stored, live in a
 * React-free module and are pinned here:
 *
 *   - a monitor rule stores one { roleId, userId } row per person, with
 *     ObjectIDs (CriteriaIncident.incidentMemberRoles);
 *   - a grouping rule stores one { userId, incidentRoleId } row per person,
 *     with strings (episodeMemberRoleAssignments);
 *   - the picker holds, per role, the people picked (RoleAssignment).
 *
 * Read back, rows come in either shape a saved row can have, and a round
 * trip changes nothing, so the monitors, grouping rules and API that read
 * the same JSON see the same rows.
 */

const COMMANDER: string = "22222222-2222-4222-8222-000000000001";
const RESPONDER: string = "22222222-2222-4222-8222-000000000002";
const SCRIBE: string = "22222222-2222-4222-8222-000000000003";
const ALICE: string = "33333333-3333-4333-8333-000000000001";
const BOB: string = "33333333-3333-4333-8333-000000000002";
const CAROL: string = "33333333-3333-4333-8333-000000000003";

function criteriaRow(
  roleId: string,
  userId: string,
): IncidentMemberRoleAssignment {
  return { roleId: new ObjectID(roleId), userId: new ObjectID(userId) };
}

// Rows as plain { roleId, userId } strings, for comparing ObjectID rows.
function asStrings(
  rows: Array<IncidentMemberRoleAssignment>,
): Array<{ roleId: string; userId: string }> {
  return rows.map(
    (row: IncidentMemberRoleAssignment): { roleId: string; userId: string } => {
      return { roleId: row.roleId.toString(), userId: row.userId.toString() };
    },
  );
}

describe("a monitor rule's incident roles", () => {
  test("rows of one person each become one assignment per role, in the order the roles first appear", () => {
    expect(
      criteriaRolesToAssignments([
        criteriaRow(RESPONDER, ALICE),
        criteriaRow(COMMANDER, BOB),
        criteriaRow(RESPONDER, CAROL),
      ]),
    ).toEqual([
      { roleId: RESPONDER, userIds: [ALICE, CAROL] },
      { roleId: COMMANDER, userIds: [BOB] },
    ]);
  });

  test("nothing saved is nobody picked", () => {
    expect(criteriaRolesToAssignments(undefined)).toEqual([]);
    expect(criteriaRolesToAssignments([])).toEqual([]);
  });

  test("a person saved twice for a role is picked once", () => {
    expect(
      criteriaRolesToAssignments([
        criteriaRow(RESPONDER, ALICE),
        criteriaRow(RESPONDER, ALICE),
      ]),
    ).toEqual([{ roleId: RESPONDER, userIds: [ALICE] }]);
  });

  test("reads ids saved as strings and as the JSON an ObjectID is saved as", () => {
    const rows: Array<IncidentMemberRoleAssignment> = [
      {
        roleId: COMMANDER,
        userId: ALICE,
      } as unknown as IncidentMemberRoleAssignment,
      {
        roleId: { _type: "ObjectID", value: RESPONDER },
        userId: { _type: "ObjectID", value: BOB },
      } as unknown as IncidentMemberRoleAssignment,
    ];

    expect(criteriaRolesToAssignments(rows)).toEqual([
      { roleId: COMMANDER, userIds: [ALICE] },
      { roleId: RESPONDER, userIds: [BOB] },
    ]);
  });

  test("a row without its role or its person assigns nobody, and does not break the rest", () => {
    const rows: Array<IncidentMemberRoleAssignment> = [
      {
        roleId: new ObjectID(COMMANDER),
      } as unknown as IncidentMemberRoleAssignment,
      {
        userId: new ObjectID(ALICE),
      } as unknown as IncidentMemberRoleAssignment,
      null as unknown as IncidentMemberRoleAssignment,
      { roleId: "", userId: BOB } as unknown as IncidentMemberRoleAssignment,
      criteriaRow(RESPONDER, CAROL),
    ];

    expect(criteriaRolesToAssignments(rows)).toEqual([
      { roleId: RESPONDER, userIds: [CAROL] },
    ]);
  });

  test("assignments are saved back as one row per person, with ObjectIDs", () => {
    const rows: Array<IncidentMemberRoleAssignment> =
      assignmentsToCriteriaRoles([
        { roleId: COMMANDER, userIds: [ALICE] },
        { roleId: RESPONDER, userIds: [BOB, CAROL] },
      ]);

    expect(asStrings(rows)).toEqual([
      { roleId: COMMANDER, userId: ALICE },
      { roleId: RESPONDER, userId: BOB },
      { roleId: RESPONDER, userId: CAROL },
    ]);

    for (const row of rows) {
      expect(row.roleId).toBeInstanceOf(ObjectID);
      expect(row.userId).toBeInstanceOf(ObjectID);
    }
  });

  test("a role with nobody picked saves no row", () => {
    expect(
      assignmentsToCriteriaRoles([{ roleId: COMMANDER, userIds: [] }]),
    ).toEqual([]);
    expect(assignmentsToCriteriaRoles([])).toEqual([]);
  });

  test("a round trip keeps every row, grouped by role", () => {
    const saved: Array<IncidentMemberRoleAssignment> = [
      criteriaRow(COMMANDER, ALICE),
      criteriaRow(RESPONDER, BOB),
      criteriaRow(RESPONDER, CAROL),
    ];

    expect(
      asStrings(assignmentsToCriteriaRoles(criteriaRolesToAssignments(saved))),
    ).toEqual(asStrings(saved));
  });

  test("saved rows keep the JSON shape the server reads", () => {
    const json: unknown = JSON.parse(
      JSON.stringify(
        assignmentsToCriteriaRoles([{ roleId: COMMANDER, userIds: [ALICE] }]),
      ),
    );

    // MonitorIncident reads assignment.roleId and assignment.userId.
    expect(
      Object.keys((json as Array<Record<string, unknown>>)[0]!).sort(),
    ).toEqual(["roleId", "userId"]);
  });
});

describe("a grouping rule's episode roles", () => {
  test("rows of one person each become one assignment per role", () => {
    expect(
      episodeRolesToAssignments([
        { userId: ALICE, incidentRoleId: COMMANDER },
        { userId: BOB, incidentRoleId: SCRIBE },
        { userId: CAROL, incidentRoleId: SCRIBE },
      ]),
    ).toEqual([
      { roleId: COMMANDER, userIds: [ALICE] },
      { roleId: SCRIBE, userIds: [BOB, CAROL] },
    ]);
  });

  test("nothing saved is nobody picked, and a half row assigns nobody", () => {
    expect(episodeRolesToAssignments(undefined)).toEqual([]);
    expect(
      episodeRolesToAssignments([
        { userId: ALICE, incidentRoleId: "" },
        { userId: "", incidentRoleId: COMMANDER },
      ]),
    ).toEqual([]);
  });

  test("assignments are saved back as one { userId, incidentRoleId } row per person, with strings", () => {
    const rows: Array<EpisodeMemberRoleAssignment> = assignmentsToEpisodeRoles([
      { roleId: SCRIBE, userIds: [BOB, CAROL] },
      { roleId: COMMANDER, userIds: [ALICE] },
    ]);

    expect(rows).toEqual([
      { userId: BOB, incidentRoleId: SCRIBE },
      { userId: CAROL, incidentRoleId: SCRIBE },
      { userId: ALICE, incidentRoleId: COMMANDER },
    ]);

    for (const row of rows) {
      expect(typeof row.userId).toBe("string");
      expect(typeof row.incidentRoleId).toBe("string");
    }
  });

  test("a round trip keeps every row", () => {
    const saved: Array<EpisodeMemberRoleAssignment> = [
      { userId: ALICE, incidentRoleId: COMMANDER },
      { userId: BOB, incidentRoleId: SCRIBE },
      { userId: CAROL, incidentRoleId: SCRIBE },
    ];

    expect(assignmentsToEpisodeRoles(episodeRolesToAssignments(saved))).toEqual(
      saved,
    );
  });
});

describe("the picker's own rules", () => {
  const assignments: Array<RoleAssignment> = [
    { roleId: COMMANDER, userIds: [ALICE] },
    { roleId: RESPONDER, userIds: [BOB] },
  ];

  test("withRoleUsers replaces a role's people where the role is", () => {
    expect(withRoleUsers(assignments, COMMANDER, [CAROL])).toEqual([
      { roleId: COMMANDER, userIds: [CAROL] },
      { roleId: RESPONDER, userIds: [BOB] },
    ]);
  });

  test("withRoleUsers adds a role picked for the first time at the end", () => {
    expect(withRoleUsers(assignments, SCRIBE, [ALICE, CAROL])).toEqual([
      ...assignments,
      { roleId: SCRIBE, userIds: [ALICE, CAROL] },
    ]);
  });

  test("withRoleUsers drops a role left with nobody", () => {
    expect(withRoleUsers(assignments, COMMANDER, [])).toEqual([
      { roleId: RESPONDER, userIds: [BOB] },
    ]);
    expect(withRoleUsers(assignments, SCRIBE, [])).toEqual(assignments);
  });

  test("withRoleUsers leaves the list it was handed, and the list of people, as they were", () => {
    const people: Array<string> = [CAROL];
    const before: string = JSON.stringify(assignments);
    const after: Array<RoleAssignment> = withRoleUsers(
      assignments,
      COMMANDER,
      people,
    );

    expect(JSON.stringify(assignments)).toBe(before);

    people.push(BOB);

    expect(after[0]!.userIds).toEqual([CAROL]);
  });

  test("getPickedUserIds reads a role's people, and nobody for a role not picked", () => {
    expect(getPickedUserIds(assignments, RESPONDER)).toEqual([BOB]);
    expect(getPickedUserIds(assignments, SCRIBE)).toEqual([]);
  });

  test("a role that takes one person offers a picker until it has one; a role that takes several, always", () => {
    const single: IncidentRoleChoice = {
      id: COMMANDER,
      name: "Incident Commander",
    };
    const several: IncidentRoleChoice = {
      id: SCRIBE,
      name: "Scribe",
      canAssignMultipleUsers: true,
    };

    expect(canPickAnotherPerson(single, 0)).toBe(true);
    expect(canPickAnotherPerson(single, 1)).toBe(false);
    expect(canPickAnotherPerson(single, 2)).toBe(false);
    expect(canPickAnotherPerson(several, 0)).toBe(true);
    expect(canPickAnotherPerson(several, 5)).toBe(true);
  });

  test("primary roles come first, then the rest by name, whatever order they arrive in", () => {
    const sorted: Array<string> = sortIncidentRoleChoices([
      { id: SCRIBE, name: "Scribe" },
      { id: RESPONDER, name: "Communications Lead" },
      { id: COMMANDER, name: "Incident Commander", isPrimaryRole: true },
    ]).map((role: IncidentRoleChoice): string => {
      return role.name;
    });

    expect(sorted).toEqual([
      "Incident Commander",
      "Communications Lead",
      "Scribe",
    ]);
  });

  test("sorting leaves the list it was handed as it was", () => {
    const roles: Array<IncidentRoleChoice> = [
      { id: SCRIBE, name: "Scribe" },
      { id: COMMANDER, name: "Incident Commander", isPrimaryRole: true },
    ];

    sortIncidentRoleChoices(roles);

    expect(roles[0]!.name).toBe("Scribe");
  });
});

describe("roles the project no longer has", () => {
  const roles: Array<IncidentRoleChoice> = [
    { id: COMMANDER, name: "Incident Commander", isPrimaryRole: true },
    { id: RESPONDER, name: "Responder", canAssignMultipleUsers: true },
  ];

  test("are dropped from the value, and the rest keep their order", () => {
    expect(
      keepKnownRoles(
        [
          { roleId: RESPONDER, userIds: [BOB] },
          { roleId: SCRIBE, userIds: [ALICE] },
          { roleId: COMMANDER, userIds: [CAROL] },
        ],
        roles,
      ),
    ).toEqual([
      { roleId: RESPONDER, userIds: [BOB] },
      { roleId: COMMANDER, userIds: [CAROL] },
    ]);
  });

  test("a value for roles that all still exist is kept as it is", () => {
    const value: Array<RoleAssignment> = [
      { roleId: COMMANDER, userIds: [ALICE] },
      { roleId: RESPONDER, userIds: [BOB, CAROL] },
    ];

    expect(keepKnownRoles(value, roles)).toEqual(value);
  });

  test("a role with nobody in it is not kept either", () => {
    expect(keepKnownRoles([{ roleId: COMMANDER, userIds: [] }], roles)).toEqual(
      [],
    );
  });

  test("with no roles at all, nothing is kept", () => {
    expect(
      keepKnownRoles([{ roleId: COMMANDER, userIds: [ALICE] }], []),
    ).toEqual([]);
  });
});

describe("a role as the picker draws it", () => {
  test("reads the role's name, colour, icon and the two flags", () => {
    const role: IncidentRole = new IncidentRole();
    role._id = COMMANDER;
    role.name = "Incident Commander";
    role.color = new Color("#7c3aed");
    role.roleIcon = IconProp.ShieldCheck;
    role.isPrimaryRole = true;
    role.canAssignMultipleUsers = false;

    expect(toIncidentRoleChoice(role)).toEqual({
      id: COMMANDER,
      name: "Incident Commander",
      color: "#7c3aed",
      icon: IconProp.ShieldCheck,
      isPrimaryRole: true,
      canAssignMultipleUsers: false,
    });
  });

  test("a role without colour, icon or flags reads as a plain role that takes one person", () => {
    const role: IncidentRole = new IncidentRole();
    role._id = SCRIBE;
    role.name = "Scribe";

    expect(toIncidentRoleChoice(role)).toEqual({
      id: SCRIBE,
      name: "Scribe",
      isPrimaryRole: false,
      canAssignMultipleUsers: false,
    });
  });

  test("every form that loads roles for the picker reads what the picker shows", () => {
    expect(INCIDENT_ROLE_CHOICE_SELECT).toEqual({
      _id: true,
      name: true,
      color: true,
      roleIcon: true,
      canAssignMultipleUsers: true,
      isPrimaryRole: true,
    });
  });
});
