import { OpenStackToken } from "../OpenStackKeystone";

/*
 * WHAT STANDS BETWEEN A LIFECYCLE RUN AND A CUSTOMER'S CLOUD.
 *
 * The lifecycle check creates and deletes things, and a credential that could do so anywhere
 * else is one a mistake here could cost someone their instances. So before each run, and before
 * each write, a token has to be for exactly the project a person gave this check, with nothing
 * that reaches further than that project:
 *
 *   - a project-scoped token. Keystone's other two scopes, system and domain, act across projects;
 *   - the project named for this check, by name, and by id once a run has verified it. So a
 *     credential swapped for one scoped elsewhere, or a project someone renamed, is refused rather
 *     than written to;
 *   - no admin in any role's name, whatever the case or spelling, and not `service`, which is
 *     what the cloud's own services run as. A role can be renamed, so behaviour is asked too:
 *     see OPENSTACK_CHECK_ADMIN_ONLY_READS;
 *   - not Keystone's admin project, which policy treats as acting for the whole cloud;
 *   - an application credential that cannot make more credentials.
 *
 * Pure, because this is what the tests of a refusal read, and a refusal has to be the same on the
 * thousandth run as the first.
 */

export interface OpenStackCheckGuardInput {
  token: OpenStackToken;
  expectedProjectName: string;
  pinnedProjectId?: string | undefined;
}

// A word in a role's name that means more than one project: compared without case.
const ROLE_WORDS_REFUSED: ReadonlyArray<string> = ["admin", "service"];

// Project names that are the cloud's own, however a person has set this check up.
const PROJECT_NAMES_REFUSED: ReadonlyArray<string> = ["admin", "service"];

export function isOpenStackRoleRefused(roleName: string): boolean {
  const name: string = roleName.toLowerCase();

  return ROLE_WORDS_REFUSED.some((word: string): boolean => {
    return name.includes(word);
  });
}

/*
 * Why this token may not write, or null when it may. Read by name and scope alone, so it costs
 * nothing, and is asked again before every write.
 */
export function getOpenStackCheckTokenRefusal(
  data: OpenStackCheckGuardInput,
): string | null {
  const { token } = data;

  if (!token.projectId) {
    return "This credential's token is not scoped to a project, so it could act across the cloud. The lifecycle check only runs on a credential scoped to the one project it has to itself.";
  }

  const expected: string = data.expectedProjectName.trim();

  if (!expected) {
    return "This check names no project of its own, so there is nothing to hold the credential to.";
  }

  if (PROJECT_NAMES_REFUSED.includes(expected.toLowerCase())) {
    return `Project ${expected} is the cloud's own, and the lifecycle check only runs in a project it has to itself. Create one with its own quota and give this check a credential on it.`;
  }

  if (token.projectName !== expected) {
    return `This credential is scoped to project ${
      token.projectName || token.projectId
    }, and this check was given project ${expected}. Nothing was written. Give it a credential on ${expected}, or say which project it has to itself.`;
  }

  if (data.pinnedProjectId && token.projectId !== data.pinnedProjectId) {
    return `This credential is scoped to a project called ${expected} with id ${token.projectId}, and earlier runs were on id ${data.pinnedProjectId}. A project of that name is not the same project. Nothing was written. To run on this one, enter the credential again.`;
  }

  if (token.isAdminProject) {
    return `Keystone says project ${expected} is its admin project, which policy treats as acting for the whole cloud. Nothing was written. Give this check a project of its own.`;
  }

  const refusedRoles: Array<string> = token.roleNames.filter(
    (role: string): boolean => {
      return isOpenStackRoleRefused(role);
    },
  );

  if (refusedRoles.length > 0) {
    return `This credential has the ${refusedRoles.join(
      ", ",
    )} role, so it could act beyond its project. Nothing was written. The lifecycle check only runs on a credential with the member role on the project it has to itself.`;
  }

  if (token.isUnrestricted) {
    return "This application credential was created --unrestricted: it can make more credentials. Nothing was written. Replace it with one that is not.";
  }

  return null;
}

/*
 * Reads only an admin gets an answer to, in each of three services, because a role can be called
 * anything. Asked before each run in each region. A credential that gets rows back from any of them
 * can see further than its project, so it is refused whatever its roles are called.
 *
 * Rows, and not a 200, because that is what the recordings say: a project's reader is refused
 * Keystone's projects and Nova's hypervisors with a 403, and Neutron answers its agents with a 200
 * and an empty list (Common/Tests/Fixtures/OpenStack/<release>/access, which
 * OpenStackCheckGuard.test.ts holds this to on every release).
 */
export type OpenStackCheckAdminRead = {
  service: "identity" | "compute" | "network";
  read: string;
  path: string;
  // The list in its answer, which is empty or refused for anyone but an admin.
  key: string;
  query?: Record<string, string> | undefined;
};

export const OPENSTACK_CHECK_ADMIN_ONLY_READS: ReadonlyArray<OpenStackCheckAdminRead> =
  [
    {
      service: "identity",
      read: "every project",
      path: "/projects",
      key: "projects",
    },
    {
      service: "compute",
      read: "every hypervisor",
      path: "/os-hypervisors",
      key: "hypervisors",
      query: { limit: "1" },
    },
    {
      service: "network",
      read: "every network agent",
      path: "/agents",
      key: "agents",
      query: { limit: "1" },
    },
  ];

export function getOpenStackCheckReachRefusal(reads: Array<string>): string {
  return `This credential can read ${reads.join(
    " and ",
  )}, which a project's member cannot, so it can see further than its project. Nothing was written. The lifecycle check only runs on a credential with the member role on the project it has to itself.`;
}
