import Label from "../../../Models/DatabaseModels/Label";
import Team from "../../../Models/DatabaseModels/Team";
import TeamPermission from "../../../Models/DatabaseModels/TeamPermission";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";

/*
 * The project SsoTeamsGrantNote.test.tsx reads: its teams, oldest first, and
 * their permission rows, as the server stores them. A module of its own so
 * the suite's ModelAPI stand-in can answer from it too.
 */

export const PROJECT_ID: ObjectID = new ObjectID(
  "5f000000-0000-4000-8000-000000000001",
);

export const FRONTEND_LABEL_ID: ObjectID = new ObjectID(
  "5f000000-0000-4000-8000-000000000004",
);

export interface FixtureRow {
  permission: Permission;
  scope?: PermissionScope | undefined;
  labelIds?: Array<ObjectID> | undefined;
  isBlockPermission?: boolean | undefined;
}

export interface FixtureTeam {
  id: ObjectID;
  name: string;
  rows: Array<FixtureRow>;
}

function fixtureTeam(
  idSuffix: string,
  name: string,
  rows: Array<FixtureRow>,
): FixtureTeam {
  return {
    id: new ObjectID(`5f000000-0000-4000-8000-0000000001${idSuffix}`),
    name: name,
    rows: rows,
  };
}

export const OWNERS: FixtureTeam = fixtureTeam("10", "Owners", [
  { permission: Permission.ProjectOwner, scope: PermissionScope.All },
]);

export const ADMIN: FixtureTeam = fixtureTeam("11", "Admin", [
  { permission: Permission.ProjectAdmin, scope: PermissionScope.All },
]);

export const MEMBERS: FixtureTeam = fixtureTeam("12", "Members", [
  { permission: Permission.ProjectMember, scope: PermissionScope.All },
]);

// Project Member, for what carries the Frontend label only.
export const FRONTEND: FixtureTeam = fixtureTeam("13", "Frontend", [
  {
    permission: Permission.ProjectMember,
    scope: PermissionScope.Labels,
    labelIds: [FRONTEND_LABEL_ID],
  },
]);

// No permission rows: anyone may hand it on.
export const READERS: FixtureTeam = fixtureTeam("14", "Readers", []);

// A block row is handed on with the team, and weighed like an allow.
export const RESPONDERS: FixtureTeam = fixtureTeam("15", "Responders", [
  { permission: Permission.ProjectMember, scope: PermissionScope.All },
  {
    permission: Permission.DeleteProjectIncident,
    scope: PermissionScope.All,
    isBlockPermission: true,
  },
]);

export const PROJECT_TEAMS: Array<FixtureTeam> = [
  OWNERS,
  ADMIN,
  MEMBERS,
  FRONTEND,
  READERS,
  RESPONDERS,
];

export function toTeamModel(team: FixtureTeam): Team {
  const model: Team = new Team(team.id);
  model.projectId = PROJECT_ID;
  model.name = team.name;
  return model;
}

export function toPermissionModels(team: FixtureTeam): Array<TeamPermission> {
  return team.rows.map((row: FixtureRow): TeamPermission => {
    const model: TeamPermission = new TeamPermission();
    model.id = ObjectID.generate();
    model.teamId = team.id;
    model.projectId = PROJECT_ID;
    model.permission = row.permission;
    model.isBlockPermission = row.isBlockPermission || false;

    if (row.scope) {
      model.scope = row.scope;
    }

    model.labels = (row.labelIds || []).map((labelId: ObjectID): Label => {
      return new Label(labelId);
    });

    return model;
  });
}

// What a list read of the project answers, by the model it reads.
export function listFor(modelType: unknown): Array<unknown> {
  if (modelType === Team) {
    return PROJECT_TEAMS.map(toTeamModel);
  }

  if (modelType === TeamPermission) {
    return PROJECT_TEAMS.flatMap(toPermissionModels);
  }

  return [];
}
