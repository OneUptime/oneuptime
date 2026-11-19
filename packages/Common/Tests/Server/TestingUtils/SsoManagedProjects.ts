import ProjectService from "../../../Server/Services/ProjectService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import FindBy from "../../../Server/Types/Database/FindBy";
import Project from "../../../Models/DatabaseModels/Project";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import { FindOperator } from "typeorm";

/*
 * THE PERSON'S PROJECTS, AS THE PROJECTS' RULE OF SSO-MANAGED SIGN-IN READS
 * THEM (issue #9763, Common/Server/Utils/SsoManagedSignIn).
 *
 * While the server does not require SSO, whether someone's sign-in is
 * managed by SSO is read from two tables: their memberships
 * (TeamMemberService.findBy, by user, a page at a time) and those projects'
 * rows (ProjectService.findBy, by id, with requireSsoForLogin and
 * manageSignInWithSso). A suite that drives a refused write, a sign-in or
 * the profile through the real rule stands both in with this, from the
 * person's projects as the suite describes them:
 *
 *   - one membership per team the person is on in a project (`teamCount`,
 *     one by default), each an invitation not accepted yet when
 *     `isPendingInvitation`;
 *   - a project that no longer exists keeps its memberships and has no row
 *     (`isDeleted`);
 *   - the projects' read answers only the ids it is asked for, as the
 *     query's QueryHelper.any names them;
 *   - the memberships' read pages as the real one does, by skip and limit.
 *
 * The person has no project unless the suite says so: the rule then covers
 * nobody, as it covers somebody in no project.
 */

export interface MemberProject {
  id: ObjectID;
  name: string;
  requireSsoForLogin: boolean;
  manageSignInWithSso: boolean;
  // Every membership in it an invitation the person has not accepted yet.
  isPendingInvitation?: boolean | undefined;
  // How many of its teams the person is on: one membership each.
  teamCount?: number | undefined;
  // Its memberships are there, its row is not.
  isDeleted?: boolean | undefined;
}

export interface MemberProjectsStandIn {
  memberships: jest.SpyInstance;
  projects: jest.SpyInstance;
  // Changes the person's projects from the next read on.
  setProjects: (projects: Array<MemberProject>) => void;
}

// A project that requires SSO and manages sign-in with it.
export const managingProject: (name: string, id?: string) => MemberProject = (
  name: string,
  id?: string,
): MemberProject => {
  return {
    id: id ? new ObjectID(id) : ObjectID.generate(),
    name: name,
    requireSsoForLogin: true,
    manageSignInWithSso: true,
  };
};

// A project that keeps its people's own sign-in: SSO not required.
export const passwordProject: (name: string, id?: string) => MemberProject = (
  name: string,
  id?: string,
): MemberProject => {
  return {
    id: id ? new ObjectID(id) : ObjectID.generate(),
    name: name,
    requireSsoForLogin: false,
    manageSignInWithSso: false,
  };
};

// The values a QueryHelper.any (or a plain value) in a query names.
export const readQueryValues: (predicate: unknown) => Array<string> = (
  predicate: unknown,
): Array<string> => {
  if (predicate instanceof FindOperator) {
    const parameters: Record<string, unknown> =
      (predicate.objectLiteralParameters as Record<string, unknown>) || {};

    return Object.values(parameters)
      .flatMap((value: unknown): Array<unknown> => {
        return Array.isArray(value) ? value : [value];
      })
      .map((value: unknown): string => {
        return String(value).toLowerCase();
      });
  }

  if (predicate === undefined || predicate === null) {
    return [];
  }

  return [String(predicate).toLowerCase()];
};

export const standInMemberProjects: (
  initial?: Array<MemberProject>,
) => MemberProjectsStandIn = (
  initial: Array<MemberProject> = [],
): MemberProjectsStandIn => {
  let current: Array<MemberProject> = initial;

  const memberships: jest.SpyInstance = getJestSpyOn(
    TeamMemberService,
    "findBy",
  ).mockImplementation(
    async (findBy: FindBy<TeamMember>): Promise<Array<TeamMember>> => {
      const rows: Array<TeamMember> = [];

      for (const project of current) {
        for (let team: number = 0; team < (project.teamCount || 1); team++) {
          const membership: TeamMember = new TeamMember();
          membership._id = ObjectID.generate().toString();
          membership.projectId = project.id;
          membership.hasAcceptedInvitation = !project.isPendingInvitation;
          rows.push(membership);
        }
      }

      const skip: number = Number(findBy.skip || 0);
      const limit: number = Number(findBy.limit || rows.length);

      return rows.slice(skip, skip + limit);
    },
  );

  const projects: jest.SpyInstance = getJestSpyOn(
    ProjectService,
    "findBy",
  ).mockImplementation(
    async (findBy: FindBy<Project>): Promise<Array<Project>> => {
      const asked: Array<string> = readQueryValues(
        (findBy.query as Record<string, unknown>)["_id"],
      );

      return current
        .filter((project: MemberProject): boolean => {
          return (
            !project.isDeleted &&
            asked.includes(project.id.toString().toLowerCase())
          );
        })
        .map((project: MemberProject): Project => {
          const row: Project = new Project();
          row._id = project.id.toString();
          row.name = project.name;
          row.requireSsoForLogin = project.requireSsoForLogin;
          row.manageSignInWithSso = project.manageSignInWithSso;
          return row;
        });
    },
  );

  return {
    memberships: memberships,
    projects: projects,
    setProjects: (projectsNow: Array<MemberProject>): void => {
      current = projectsNow;
    },
  };
};
