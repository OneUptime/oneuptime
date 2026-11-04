/*
 * WHAT A FAILED PART TAKES WITH IT, AND WHOSE IT IS.
 *
 * "What runs on it?" and "whose is it?" are the first two questions when a part of a
 * cloud fails, and OpenStack answers them with several lists joined by hand. Needs
 * attention, a part's page, an incident's description, OneUptime AI and the notices
 * all read this one answer (OpenStackResourceService.getBlastRadius), so none of them
 * can count differently.
 *
 * Pure, so a page, a test and the server can all read it.
 */

export interface OpenStackBlastRadiusProject {
  // Keystone's ID, because a project can be renamed.
  projectId: string;
  // Its name when the inventory holds its project row.
  name: string | null;
  instanceCount: number;
  volumeCount: number;
  routerCount: number;
  floatingIpCount: number;
}

export interface OpenStackBlastRadius {
  instanceCount: number;
  volumeCount: number;
  routerCount: number;
  floatingIpCount: number;
  // The real number, which `projects` can be shorter than: see the cap.
  projectCount: number;
  // Most affected first, at most OPENSTACK_BLAST_RADIUS_PROJECT_LIMIT of them.
  projects: Array<OpenStackBlastRadiusProject>;
  /*
   * False when what was collected cannot say. The agent's exporter does not say which
   * pool a volume is on, so a pool's reach is only known from the probe's reads, and a
   * page says that rather than "0 volumes".
   */
  isKnown: boolean;
}

export const OPENSTACK_BLAST_RADIUS_PROJECT_LIMIT: number = 50;

export function getEmptyOpenStackBlastRadius(
  isKnown: boolean = true,
): OpenStackBlastRadius {
  return {
    instanceCount: 0,
    volumeCount: 0,
    routerCount: 0,
    floatingIpCount: 0,
    projectCount: 0,
    projects: [],
    isKnown,
  };
}

export type OpenStackBlastRadiusCount =
  | "instanceCount"
  | "volumeCount"
  | "routerCount"
  | "floatingIpCount";

/*
 * A radius from each kind of thing's counts per project. A project with no ID in the
 * inventory cannot be told to anyone, so it counts towards the totals and is not named.
 */
export function buildOpenStackBlastRadius(data: {
  counts: Array<{
    count: OpenStackBlastRadiusCount;
    byProject: Array<{ projectId: string | null; count: number }>;
  }>;
  projectNames?: Record<string, string> | undefined;
  isKnown?: boolean | undefined;
}): OpenStackBlastRadius {
  const radius: OpenStackBlastRadius = getEmptyOpenStackBlastRadius(
    data.isKnown ?? true,
  );
  const projects: Map<string, OpenStackBlastRadiusProject> = new Map();

  for (const { count, byProject } of data.counts) {
    for (const { projectId, count: amount } of byProject) {
      radius[count] += amount;
      if (!projectId) {
        continue;
      }
      const project: OpenStackBlastRadiusProject = projects.get(projectId) || {
        projectId,
        name: data.projectNames?.[projectId] || null,
        instanceCount: 0,
        volumeCount: 0,
        routerCount: 0,
        floatingIpCount: 0,
      };
      project[count] += amount;
      projects.set(projectId, project);
    }
  }

  const reach = (project: OpenStackBlastRadiusProject): number => {
    return (
      project.instanceCount +
      project.volumeCount +
      project.routerCount +
      project.floatingIpCount
    );
  };

  radius.projectCount = projects.size;
  radius.projects = Array.from(projects.values())
    .sort(
      (
        first: OpenStackBlastRadiusProject,
        second: OpenStackBlastRadiusProject,
      ) => {
        return (
          reach(second) - reach(first) ||
          first.projectId.localeCompare(second.projectId)
        );
      },
    )
    .slice(0, OPENSTACK_BLAST_RADIUS_PROJECT_LIMIT);

  return radius;
}

export function isOpenStackBlastRadiusEmpty(
  radius: OpenStackBlastRadius,
): boolean {
  return (
    radius.instanceCount === 0 &&
    radius.volumeCount === 0 &&
    radius.routerCount === 0 &&
    radius.floatingIpCount === 0
  );
}
