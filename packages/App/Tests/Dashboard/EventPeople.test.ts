import { describe, expect, test } from "@jest/globals";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Email from "Common/Types/Email";
import Name from "Common/Types/Name";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import { ResourceOwnerEntry } from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/OwnerEntry";
import {
  EventRole,
  EventRoleMember,
  EventRolesSnapshot,
  MAX_HEADER_OWNERS,
  PrimaryRoleHolding,
  getEventOwnerName,
  getPrimaryRoleHolding,
  orderEventOwners,
  toEventRoleMember,
} from "../../FeatureSet/Dashboard/src/Utils/EventPeople";

/*
 * Who runs an incident, an alert or an episode, as the top of its overview
 * says it (the customer's "Easy to see Incident Commander and Team(s)"):
 * the person holding the project's primary incident role, and the owners,
 * teams first. These are the rules the header draws from.
 */

const COMMANDER_ROLE_ID: string = "76000000-0000-4000-8000-000000000001";
const SCRIBE_ROLE_ID: string = "76000000-0000-4000-8000-000000000002";
const MAYA_ID: string = "80000000-0000-4000-8000-000000000001";
const SAM_ID: string = "80000000-0000-4000-8000-000000000002";

const commanderRole: EventRole = {
  id: COMMANDER_ROLE_ID,
  name: "Incident Commander",
  isPrimaryRole: true,
  icon: IconProp.ShieldCheck,
};

const scribeRole: EventRole = {
  id: SCRIBE_ROLE_ID,
  name: "Scribe",
  isPrimaryRole: false,
};

function member(roleId: string, userId: string, name: string): EventRoleMember {
  return {
    roleId: roleId,
    userId: userId,
    name: name,
    hasProfilePicture: false,
  };
}

function team(name: string, id: string): ResourceOwnerEntry {
  const record: Team = new Team();
  record._id = id;
  record.name = name;
  return { kind: "team", team: record };
}

function person(
  name: string | undefined,
  email: string,
  id: string,
): ResourceOwnerEntry {
  const record: User = new User();
  record._id = id;
  if (name) {
    record.name = new Name(name);
  }
  record.email = new Email(email);
  return { kind: "user", user: record };
}

function names(owners: Array<ResourceOwnerEntry>): Array<string> {
  return owners.map((owner: ResourceOwnerEntry): string => {
    return `${owner.kind}:${getEventOwnerName(owner)}`;
  });
}

describe("getPrimaryRoleHolding", () => {
  test("names the primary role and who holds it on the record", () => {
    const snapshot: EventRolesSnapshot = {
      roles: [scribeRole, commanderRole],
      members: [
        member(SCRIBE_ROLE_ID, SAM_ID, "Sam Rivera"),
        member(COMMANDER_ROLE_ID, MAYA_ID, "Maya Chen"),
      ],
    };

    const holding: PrimaryRoleHolding | null = getPrimaryRoleHolding(snapshot);

    expect(holding?.role).toEqual(commanderRole);
    // Only the primary role's holder: a Scribe is no commander.
    expect(holding?.members).toEqual([
      member(COMMANDER_ROLE_ID, MAYA_ID, "Maya Chen"),
    ]);
  });

  test("says nobody holds it, rather than naming no role, while it is unassigned", () => {
    const holding: PrimaryRoleHolding | null = getPrimaryRoleHolding({
      roles: [commanderRole, scribeRole],
      members: [member(SCRIBE_ROLE_ID, SAM_ID, "Sam Rivera")],
    });

    expect(holding?.role.name).toBe("Incident Commander");
    expect(holding?.members).toEqual([]);
  });

  test("keeps the project's own name for the role", () => {
    const holding: PrimaryRoleHolding | null = getPrimaryRoleHolding({
      roles: [{ ...commanderRole, name: "Incident Lead" }],
      members: [],
    });

    expect(holding?.role.name).toBe("Incident Lead");
  });

  test("names no commander for a project without a primary role", () => {
    expect(
      getPrimaryRoleHolding({
        roles: [scribeRole],
        members: [member(SCRIBE_ROLE_ID, SAM_ID, "Sam Rivera")],
      }),
    ).toBeNull();
    expect(getPrimaryRoleHolding({ roles: [], members: [] })).toBeNull();
  });

  test("names no commander until the roles have been read", () => {
    expect(getPrimaryRoleHolding(undefined)).toBeNull();
    expect(getPrimaryRoleHolding(null)).toBeNull();
  });
});

describe("toEventRoleMember", () => {
  test("reads an assignment row's role, person and picture", () => {
    expect(
      toEventRoleMember({
        incidentRoleId: new ObjectID(COMMANDER_ROLE_ID),
        userId: new ObjectID(MAYA_ID),
        user: {
          name: new Name("  Maya Chen "),
          email: new Email("maya.chen@acme-commerce.example"),
          profilePictureId: new ObjectID(SAM_ID),
        },
      }),
    ).toEqual({
      roleId: COMMANDER_ROLE_ID,
      userId: MAYA_ID,
      name: "Maya Chen",
      email: "maya.chen@acme-commerce.example",
      hasProfilePicture: true,
    });
  });

  test("a person with no picture gets initials, and a row with no person reads empty", () => {
    expect(
      toEventRoleMember({
        incidentRoleId: COMMANDER_ROLE_ID,
        userId: MAYA_ID,
        user: { name: "Maya Chen", email: undefined, profilePictureId: null },
      }),
    ).toEqual({
      roleId: COMMANDER_ROLE_ID,
      userId: MAYA_ID,
      name: "Maya Chen",
      email: undefined,
      hasProfilePicture: false,
    });

    expect(toEventRoleMember({})).toEqual({
      roleId: "",
      userId: "",
      name: "",
      email: undefined,
      hasProfilePicture: false,
    });
  });
});

describe("getEventOwnerName", () => {
  test("a team by its name, a person by name and then by email", () => {
    expect(getEventOwnerName(team("Checkout SRE", "t1"))).toBe("Checkout SRE");
    expect(
      getEventOwnerName(person("Maya Chen", "maya@acme.example", "u1")),
    ).toBe("Maya Chen");
    expect(getEventOwnerName(person(undefined, "sam@acme.example", "u2"))).toBe(
      "sam@acme.example",
    );
  });
});

describe("orderEventOwners", () => {
  test("teams first, then people, each by name, whatever order they were read in", () => {
    const owners: Array<ResourceOwnerEntry> = [
      person("Sam Rivera", "sam@acme.example", "u2"),
      team("Platform", "t3"),
      person("Alex Kim", "alex@acme.example", "u4"),
      team("checkout SRE", "t1"),
      team("Database Reliability", "t2"),
    ];

    expect(names(orderEventOwners(owners))).toEqual([
      "team:checkout SRE",
      "team:Database Reliability",
      "team:Platform",
      "user:Alex Kim",
      "user:Sam Rivera",
    ]);
  });

  test("sorts numbers in names the way people count", () => {
    expect(
      names(
        orderEventOwners([
          team("Team 10", "a"),
          team("Team 2", "b"),
          team("Team 1", "c"),
        ]),
      ),
    ).toEqual(["team:Team 1", "team:Team 2", "team:Team 10"]);
  });

  test("leaves the list it was given as it was", () => {
    const owners: Array<ResourceOwnerEntry> = [
      person("Sam Rivera", "sam@acme.example", "u2"),
      team("Checkout SRE", "t1"),
    ];
    const before: Array<string> = names(owners);

    orderEventOwners(owners);

    expect(names(owners)).toEqual(before);
  });

  test("an empty list stays empty", () => {
    expect(orderEventOwners([])).toEqual([]);
  });
});

describe("the header names a few owners", () => {
  test("three before +N more: one line beside the commander on a laptop", () => {
    expect(MAX_HEADER_OWNERS).toBe(3);
  });
});
