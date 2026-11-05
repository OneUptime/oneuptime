import { OpenStackReachAcrossProducts } from "./OpenStackLinks";
import { OpenStackResourceKind } from "./OpenStackResourceKind";

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
  // Its domain, when the inventory holds its project row and that row says.
  domainId?: string | undefined;
  instanceCount: number;
  volumeCount: number;
  routerCount: number;
  floatingIpCount: number;
  stackCount: number;
  containerClusterCount: number;
  shareCount: number;
  databaseInstanceCount: number;
  dnsZoneCount: number;
}

export interface OpenStackBlastRadius {
  instanceCount: number;
  volumeCount: number;
  routerCount: number;
  floatingIpCount: number;
  // Only a cloud running Heat or Magnum has these, so only there do they read anything but 0.
  stackCount: number;
  containerClusterCount: number;
  shareCount: number;
  databaseInstanceCount: number;
  dnsZoneCount: number;
  // The real number, which `projects` can be shorter than: see the cap.
  projectCount: number;
  // Most affected first, at most OPENSTACK_BLAST_RADIUS_PROJECT_LIMIT of them.
  projects: Array<OpenStackBlastRadiusProject>;
  /*
   * All of them, past the cap, when asked for: a rule on the sixtieth project has to reach
   * it even though a description stops naming projects at the fiftieth, and that project's
   * notice has to say what it holds there.
   */
  everyProject?: Array<OpenStackBlastRadiusProject> | undefined;
  /*
   * False when what was collected cannot say. The agent's exporter does not say which
   * pool a volume is on, so a pool's reach is only known from the probe's reads, and a
   * page says that rather than "0 volumes".
   */
  isKnown: boolean;
  /*
   * What it takes with it beyond the cloud: the hosts and Kubernetes nodes its instances
   * are, and the services on them. Only a hypervisor has one, and only when it was asked for.
   */
  acrossProducts?: OpenStackReachAcrossProducts | undefined;
  /*
   * What a failed part belongs to, where a source says so: the cluster a stack was built for, and
   * the stack a cluster is built with. A failure there is the same failure, seen from the other end.
   */
  belongsTo?: Array<OpenStackBlastRadiusOwner> | undefined;
  // The Magnum clusters with a server on this hypervisor, which its failure reaches.
  magnumClusters?: Array<OpenStackBlastRadiusOwner> | undefined;
}

export interface OpenStackBlastRadiusOwner {
  kind: OpenStackResourceKind;
  externalId: string;
  name: string | null;
  status: string | null;
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
    stackCount: 0,
    containerClusterCount: 0,
    shareCount: 0,
    databaseInstanceCount: 0,
    dnsZoneCount: 0,
    projectCount: 0,
    projects: [],
    isKnown,
  };
}

export type OpenStackBlastRadiusCount =
  | "instanceCount"
  | "volumeCount"
  | "routerCount"
  | "floatingIpCount"
  | "stackCount"
  | "containerClusterCount"
  | "shareCount"
  | "databaseInstanceCount"
  | "dnsZoneCount";

/*
 * Every count a radius holds and what it is called, which is all there is to adding one. What a page
 * says of a count is its own to translate (OpenStackBlastRadiusCard reads this list); these words are
 * what is read outside the Dashboard, in an alert's description and OneUptime AI's context.
 */
export const OPENSTACK_BLAST_RADIUS_COUNTS: ReadonlyArray<{
  count: OpenStackBlastRadiusCount;
  one: string;
  other: string;
}> = [
  { count: "instanceCount", one: "instance", other: "instances" },
  { count: "volumeCount", one: "volume", other: "volumes" },
  { count: "routerCount", one: "router", other: "routers" },
  { count: "floatingIpCount", one: "floating IP", other: "floating IPs" },
  { count: "stackCount", one: "stack", other: "stacks" },
  {
    count: "containerClusterCount",
    one: "Kubernetes cluster",
    other: "Kubernetes clusters",
  },
  { count: "shareCount", one: "share", other: "shares" },
  { count: "databaseInstanceCount", one: "database", other: "databases" },
  { count: "dnsZoneCount", one: "DNS zone", other: "DNS zones" },
];

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
  projectDomains?: Record<string, string> | undefined;
  isKnown?: boolean | undefined;
  includeEveryProject?: boolean | undefined;
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
      const domainId: string | undefined = data.projectDomains?.[projectId];
      const project: OpenStackBlastRadiusProject = projects.get(projectId) || {
        projectId,
        name: data.projectNames?.[projectId] || null,
        ...(domainId ? { domainId } : {}),
        instanceCount: 0,
        volumeCount: 0,
        routerCount: 0,
        floatingIpCount: 0,
        stackCount: 0,
        containerClusterCount: 0,
        shareCount: 0,
        databaseInstanceCount: 0,
        dnsZoneCount: 0,
      };
      project[count] += amount;
      projects.set(projectId, project);
    }
  }

  const reach: (project: OpenStackBlastRadiusProject) => number = (
    project: OpenStackBlastRadiusProject,
  ): number => {
    return OPENSTACK_BLAST_RADIUS_COUNTS.reduce(
      (total: number, entry: { count: OpenStackBlastRadiusCount }): number => {
        return total + project[entry.count];
      },
      0,
    );
  };

  radius.projectCount = projects.size;
  if (data.includeEveryProject) {
    radius.everyProject = Array.from(projects.values());
  }
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

/*
 * What several parts take with them, as one: a project on two hosts of a zone is one project, holding
 * what it holds on both. Known only when every part's reach is: a radius a page cannot trust as a whole
 * says so rather than reading low.
 */
export function mergeOpenStackBlastRadii(
  radii: ReadonlyArray<OpenStackBlastRadius>,
): OpenStackBlastRadius {
  const counts: Array<{
    count: OpenStackBlastRadiusCount;
    byProject: Array<{ projectId: string | null; count: number }>;
  }> = [];
  const projectNames: Record<string, string> = {};
  const projectDomains: Record<string, string> = {};

  for (const radius of radii) {
    for (const entry of OPENSTACK_BLAST_RADIUS_COUNTS) {
      const byProject: Array<{ projectId: string | null; count: number }> = (
        radius.everyProject || radius.projects
      ).map(
        (
          project: OpenStackBlastRadiusProject,
        ): { projectId: string | null; count: number } => {
          return { projectId: project.projectId, count: project[entry.count] };
        },
      );

      // What a radius counted of no project, or past what it names, stays in the total.
      const named: number = byProject.reduce(
        (total: number, one: { count: number }): number => {
          return total + one.count;
        },
        0,
      );
      if (radius[entry.count] > named) {
        byProject.push({
          projectId: null,
          count: radius[entry.count] - named,
        });
      }

      counts.push({ count: entry.count, byProject });
    }

    for (const project of radius.everyProject || radius.projects) {
      if (project.name) {
        projectNames[project.projectId] = project.name;
      }
      if (project.domainId) {
        projectDomains[project.projectId] = project.domainId;
      }
    }
  }

  return buildOpenStackBlastRadius({
    counts,
    projectNames,
    projectDomains,
    isKnown: radii.every((radius: OpenStackBlastRadius): boolean => {
      return radius.isKnown;
    }),
    includeEveryProject: true,
  });
}

export function isOpenStackBlastRadiusEmpty(
  radius: OpenStackBlastRadius,
): boolean {
  return OPENSTACK_BLAST_RADIUS_COUNTS.every(
    (entry: { count: OpenStackBlastRadiusCount }): boolean => {
      return radius[entry.count] === 0;
    },
  );
}

function countOf(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/*
 * What a radius holds, in English, for what is read outside the Dashboard: an alert's
 * description and OneUptime AI's starting context. "42 instances, 3 volumes in 7 projects".
 * The Dashboard words its own in the reader's language.
 */
export function describeOpenStackBlastRadiusCounts(
  counts: Partial<Pick<OpenStackBlastRadius, OpenStackBlastRadiusCount>>,
): string {
  const parts: Array<string> = [];
  for (const entry of OPENSTACK_BLAST_RADIUS_COUNTS) {
    const count: number = counts[entry.count] || 0;
    if (count > 0) {
      parts.push(countOf(count, entry.one, entry.other));
    }
  }
  return parts.join(", ");
}

export function describeOpenStackBlastRadius(
  radius: OpenStackBlastRadius,
): string {
  const things: string = describeOpenStackBlastRadiusCounts(radius);
  if (!things) {
    return "";
  }
  return radius.projectCount > 0
    ? `${things} in ${countOf(radius.projectCount, "project", "projects")}`
    : things;
}

/*
 * How an alert or an incident says which project and domain it reaches, by the IDs a
 * rename never changes. An owner or label rule on one project matches this text in the
 * description, which is what makes "this project's incidents reach this team" work with
 * the rules every alert and incident already goes through. The closing backtick ends the
 * match, so one ID that begins another is not mistaken for it.
 */
export function getOpenStackProjectMarker(projectId: string): string {
  return `OpenStack project \`${projectId}\``;
}

export function getOpenStackDomainMarker(domainId: string): string {
  return `OpenStack domain \`${domainId}\``;
}

export const OPENSTACK_PROJECT_MARKER_START: string = "OpenStack project `";
export const OPENSTACK_DOMAIN_MARKER_START: string = "OpenStack domain `";

/*
 * WHERE WHAT A FAILURE REACHES STARTS IN A DESCRIPTION, AND WHY A STATUS PAGE STOPS THERE.
 *
 * An incident's description is for two audiences. Whoever is working on it needs every project on the
 * host by name. A status page and its subscribers read the same column, and "ou-payments: 3 instances"
 * on a public page tells one customer who another is. So everything this adds to a description comes
 * after this line, whose words say so to whoever reads it, and everything that shows an incident
 * outside the team cuts the description here: IncidentStatusPageScope for a page's reads, and the
 * subscriber jobs for what they send. An operator's own edit above the line reaches a page as it always
 * did, and what is under the line never does.
 */
export const OPENSTACK_REACH_HEADING: string =
  "**In this cloud** (for your team, never shown on a status page):";

// In one scan, because a description can hold anything a template placed.
export function removeOpenStackReachFromDescription(
  description: string | null | undefined,
): string {
  const text: string = description || "";
  const start: number = text.indexOf(OPENSTACK_REACH_HEADING);

  return start < 0 ? text : text.substring(0, start).trimEnd();
}
