import MailService from "../../../Server/Services/MailService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamPermissionService from "../../../Server/Services/TeamPermissionService";
import Label from "../../../Models/DatabaseModels/Label";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import TeamPermission from "../../../Models/DatabaseModels/TeamPermission";
import User from "../../../Models/DatabaseModels/User";
import Email from "../../../Types/Email";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";

/*
 * A project whose teams make every case of "who is an owner" at once, behind
 * fakes of the two tables ProjectService.getOwners reads (TeamPermission and
 * TeamMember) and of the mail service, so a test can drive a real owner email
 * path and read who it went to.
 *
 *   Owners       allows Project Owner
 *   Contractors  blocks Project Owner, with no labels
 *   EU only      blocks Project Owner, for one label
 *   Finance      allows Manage Billing (not an owner's row at all)
 *
 *   alice  Owners                              -> owner
 *   bob    Owners + Contractors                -> blocked from being one
 *   carol  Owners + EU only                    -> owner: a block with labels
 *                                                 limits records, and an
 *                                                 owner email names none
 *   dave   Owners, invitation not accepted     -> not a member yet
 *   erin   Owners + Contractors (not accepted) -> owner: an invitation not
 *                                                 accepted takes nothing away
 *   frank  Contractors                         -> never allowed
 *   grace  Finance                             -> not an owner
 *
 * The owner emails go to alice, carol and erin, and to nobody else.
 */

export interface RosterPerson {
  id: ObjectID;
  email: string;
}

function person(name: string, idSuffix: string): RosterPerson {
  return {
    id: new ObjectID(`7a000000-0000-4000-8000-0000000000${idSuffix}`),
    email: `${name}@acme.test`,
  };
}

export const ROSTER_PEOPLE: Record<
  "alice" | "bob" | "carol" | "dave" | "erin" | "frank" | "grace",
  RosterPerson
> = {
  alice: person("alice", "a1"),
  bob: person("bob", "b2"),
  carol: person("carol", "c3"),
  dave: person("dave", "d4"),
  erin: person("erin", "e5"),
  frank: person("frank", "f6"),
  grace: person("grace", "a7"),
};

export const ROSTER_TEAMS: Record<
  "owners" | "contractors" | "euOnly" | "finance",
  ObjectID
> = {
  owners: new ObjectID("7b000000-0000-4000-8000-0000000000a1"),
  contractors: new ObjectID("7b000000-0000-4000-8000-0000000000b2"),
  euOnly: new ObjectID("7b000000-0000-4000-8000-0000000000c3"),
  finance: new ObjectID("7b000000-0000-4000-8000-0000000000d4"),
};

const EU_LABEL: ObjectID = new ObjectID("7c000000-0000-4000-8000-0000000000e1");

// Whom the owner emails reach: the people who hold Project Owner.
export const ROSTER_OWNER_EMAILS: Array<string> = [
  ROSTER_PEOPLE.alice.email,
  ROSTER_PEOPLE.carol.email,
  ROSTER_PEOPLE.erin.email,
];

// Whom they must never reach.
export const ROSTER_NOT_OWNER_EMAILS: Array<string> = [
  ROSTER_PEOPLE.bob.email,
  ROSTER_PEOPLE.dave.email,
  ROSTER_PEOPLE.frank.email,
  ROSTER_PEOPLE.grace.email,
];

interface PermissionRow {
  teamId: ObjectID;
  permission: Permission;
  isBlockPermission: boolean;
  labelIds: Array<ObjectID>;
}

interface MembershipRow {
  teamId: ObjectID;
  person: RosterPerson;
  hasAcceptedInvitation: boolean;
}

const PERMISSION_ROWS: Array<PermissionRow> = [
  {
    teamId: ROSTER_TEAMS.owners,
    permission: Permission.ProjectOwner,
    isBlockPermission: false,
    labelIds: [],
  },
  {
    teamId: ROSTER_TEAMS.contractors,
    permission: Permission.ProjectOwner,
    isBlockPermission: true,
    labelIds: [],
  },
  {
    teamId: ROSTER_TEAMS.euOnly,
    permission: Permission.ProjectOwner,
    isBlockPermission: true,
    labelIds: [EU_LABEL],
  },
  {
    teamId: ROSTER_TEAMS.finance,
    permission: Permission.ManageProjectBilling,
    isBlockPermission: false,
    labelIds: [],
  },
];

const MEMBERSHIP_ROWS: Array<MembershipRow> = [
  {
    teamId: ROSTER_TEAMS.owners,
    person: ROSTER_PEOPLE.alice,
    hasAcceptedInvitation: true,
  },
  {
    teamId: ROSTER_TEAMS.owners,
    person: ROSTER_PEOPLE.bob,
    hasAcceptedInvitation: true,
  },
  {
    teamId: ROSTER_TEAMS.contractors,
    person: ROSTER_PEOPLE.bob,
    hasAcceptedInvitation: true,
  },
  {
    teamId: ROSTER_TEAMS.owners,
    person: ROSTER_PEOPLE.carol,
    hasAcceptedInvitation: true,
  },
  {
    teamId: ROSTER_TEAMS.euOnly,
    person: ROSTER_PEOPLE.carol,
    hasAcceptedInvitation: true,
  },
  {
    teamId: ROSTER_TEAMS.owners,
    person: ROSTER_PEOPLE.dave,
    hasAcceptedInvitation: false,
  },
  {
    teamId: ROSTER_TEAMS.owners,
    person: ROSTER_PEOPLE.erin,
    hasAcceptedInvitation: true,
  },
  {
    teamId: ROSTER_TEAMS.contractors,
    person: ROSTER_PEOPLE.erin,
    hasAcceptedInvitation: false,
  },
  {
    teamId: ROSTER_TEAMS.contractors,
    person: ROSTER_PEOPLE.frank,
    hasAcceptedInvitation: true,
  },
  {
    teamId: ROSTER_TEAMS.finance,
    person: ROSTER_PEOPLE.grace,
    hasAcceptedInvitation: true,
  },
];

// The ids a filter value names: one id, or a QueryHelper.any / in operator.
function idsIn(value: unknown): Array<string> | null {
  if (value === undefined || value === null) {
    return null;
  }

  const operator: { objectLiteralParameters?: Record<string, unknown> } =
    value as { objectLiteralParameters?: Record<string, unknown> };

  if (operator.objectLiteralParameters) {
    const values: unknown = Object.values(operator.objectLiteralParameters)[0];

    return (Array.isArray(values) ? values : [values]).map(
      (item: unknown): string => {
        return String(item);
      },
    );
  }

  return [String(value)];
}

function matches(value: unknown, actual: ObjectID | string): boolean {
  const ids: Array<string> | null = idsIn(value);

  return ids === null || ids.includes(actual.toString());
}

export interface ProjectOwnerRoster {
  // The addresses the mail service was handed, in order.
  sentTo: () => Array<string>;
  // The mail service, faked: it takes every email.
  sendMail: jest.SpyInstance;
}

/*
 * Installs the fakes (jest.spyOn: jest.restoreAllMocks() in the test's
 * afterEach takes them out) for `projectId`, the project the rows belong to.
 * A read of another project finds nothing.
 */
export function useProjectOwnerRoster(projectId: ObjectID): ProjectOwnerRoster {
  jest
    .spyOn(TeamPermissionService, "findBy")
    .mockImplementation((async (findBy: {
      query: Record<string, unknown>;
    }): Promise<Array<TeamPermission>> => {
      const query: Record<string, unknown> = findBy.query || {};

      return PERMISSION_ROWS.filter((row: PermissionRow): boolean => {
        return (
          matches(query["projectId"], projectId) &&
          matches(query["teamId"], row.teamId) &&
          (query["permission"] === undefined ||
            query["permission"] === row.permission)
        );
      }).map((row: PermissionRow): TeamPermission => {
        const permission: TeamPermission = new TeamPermission();
        permission.projectId = projectId;
        permission.teamId = row.teamId;
        permission.permission = row.permission;
        permission.isBlockPermission = row.isBlockPermission;
        permission.labels = row.labelIds.map((labelId: ObjectID): Label => {
          return new Label(labelId);
        });
        return permission;
      });
    }) as never);

  jest.spyOn(TeamMemberService, "findBy").mockImplementation((async (findBy: {
    query: Record<string, unknown>;
  }): Promise<Array<TeamMember>> => {
    const query: Record<string, unknown> = findBy.query || {};

    return MEMBERSHIP_ROWS.filter((row: MembershipRow): boolean => {
      return (
        matches(query["projectId"], projectId) &&
        matches(query["teamId"], row.teamId) &&
        matches(query["userId"], row.person.id) &&
        (query["hasAcceptedInvitation"] === undefined ||
          query["hasAcceptedInvitation"] === row.hasAcceptedInvitation)
      );
    }).map((row: MembershipRow): TeamMember => {
      const member: TeamMember = new TeamMember();
      member.projectId = projectId;
      member.teamId = row.teamId;
      member.userId = row.person.id;
      member.hasAcceptedInvitation = row.hasAcceptedInvitation;

      const user: User = new User(row.person.id);
      user.email = new Email(row.person.email);
      member.user = user;

      return member;
    });
  }) as never);

  const sendMail: jest.SpyInstance = jest
    .spyOn(MailService, "sendMail")
    .mockImplementation((async (): Promise<unknown> => {
      return {};
    }) as never);

  return {
    sendMail,
    sentTo: (): Array<string> => {
      return sendMail.mock.calls.map((call: Array<unknown>): string => {
        const message: { toEmail: Email | string } = call[0] as {
          toEmail: Email | string;
        };

        return message.toEmail.toString();
      });
    },
  };
}
