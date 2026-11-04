import {
  OpenStackApiError,
  OpenStackErrorContext,
  classifyOpenStackError,
} from "./OpenStackCollectionErrors";
import {
  findOpenStackEndpoint,
  toOpenStackServiceBaseUrl,
  OpenStackCatalogService,
} from "./OpenStackCatalog";
import {
  OpenStackAccessLevel,
  OpenStackAccessRead,
  OpenStackEndpointInterface,
  OpenStackReadAccess,
} from "Common/Types/OpenStack/OpenStackProbeCollection";
import { OpenStackServiceType } from "Common/Types/OpenStack/OpenStackResourceKind";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import OpenStackServiceClient, {
  OpenStackJsonAnswer,
} from "./OpenStackServiceClient";
import { OpenStackCertificateError } from "./OpenStackTls";

/*
 * What this credential can really read, read by read. It is the connection test's
 * answer to "what would be missing", and the words and the reads are those of the
 * agent's troubleshoot.sh, so a person gets the same answer from either.
 *
 * The trap: Neutron and Cinder answer a plain reader with a 200 and only its own
 * project, and quietly ignore all_tenants=1, which looks like it worked. So a list
 * earns "reads everything" only by showing rows it could not otherwise see: two
 * projects, or one that is not this credential's. A row anyone may see (a shared or
 * external network, a public image) is no such sign, whoever's it is: every reader sees
 * the `public` network, in the admin project. A list where every other row has one
 * project id, the credential's own, may be its own project only. An empty list proves
 * nothing, unless the credential has the admin role, when empty is the likely truth.
 */

export interface OpenStackAccessReadDefinition {
  service: OpenStackServiceType;
  read: string;
  path: string;
  query?: Record<string, string | Array<string>> | undefined;
  key: string;
  /*
   * The field naming each row's project. "-" for a list that is not per project, so a
   * 200 is the answer. "*" for one a project's own view of is empty, so any row proves
   * it: a plain reader's list of Neutron's agents is a 200 with nothing in it.
   */
  projectField: string;
  goesWithout: string;
  fix: string;
  /*
   * Which of the three levels this read tells apart. adminOnly is what only a full view
   * reads, whatever else is opened: Cinder's own code asks for an admin.
   */
  tells?: "infrastructure" | "projects" | "adminOnly" | undefined;
}

const USE_FULL_VIEW: string =
  'use a full-view credential (see "Full view" in the docs)';

const policyFix: (file: string, line: string) => string = (
  file: string,
  line: string,
): string => {
  return `To read it: ${USE_FULL_VIEW}, or give this account the oneuptime_monitoring role and add this to ${file}'s policy file on every controller: ${line}`;
};

const inCodeFix: (service: string) => string = (service: string): string => {
  return `${service} scopes this list to the credential's own project in its code, so no policy line opens it. To read every project: ${USE_FULL_VIEW}, or give this account a role on each project you want seen.`;
};

const NOVA_POLICY: string = "nova";

const CINDER_ADMIN_ONLY_FIX: string = `Cinder's own code asks for an admin here, after policy has already passed, so no policy line opens it. To read it: ${USE_FULL_VIEW}.`;

export const OPENSTACK_ACCESS_READS: ReadonlyArray<OpenStackAccessReadDefinition> =
  [
    {
      service: OpenStackServiceType.Identity,
      read: "projects",
      path: "/projects",
      key: "projects",
      projectField: "-",
      goesWithout:
        "the Projects page, and project names on instances, volumes and networks.",
      fix: policyFix(
        "keystone",
        '"identity:list_projects": "rule:admin_required or role:oneuptime_monitoring"',
      ),
    },
    {
      service: OpenStackServiceType.Identity,
      read: "domains",
      path: "/domains",
      key: "domains",
      projectField: "-",
      goesWithout: "domains on the Projects page.",
      fix: policyFix(
        "keystone",
        '"identity:list_domains": "rule:admin_required or role:oneuptime_monitoring"',
      ),
    },
    {
      service: OpenStackServiceType.Identity,
      read: "regions",
      path: "/regions",
      key: "regions",
      projectField: "-",
      goesWithout: "region names.",
      fix: "Any credential may read this, so look at this application credential's access rules.",
    },
    {
      service: OpenStackServiceType.Compute,
      read: "servers, all projects",
      path: "/servers/detail",
      query: { all_tenants: "1", limit: "100" },
      key: "servers",
      projectField: "tenant_id",
      tells: "projects",
      goesWithout:
        "instances in other projects on the Instances page, instance counts per hypervisor and project, and the alerts on instances.",
      fix: policyFix(
        NOVA_POLICY,
        '"os_compute_api:servers:detail:get_all_tenants": "rule:context_is_admin or role:oneuptime_monitoring"',
      ),
    },
    {
      service: OpenStackServiceType.Compute,
      read: "services",
      path: "/os-services",
      key: "services",
      projectField: "-",
      tells: "infrastructure",
      goesWithout:
        "Nova's services on the Services page and Needs attention, and the alerts on them.",
      fix: policyFix(
        NOVA_POLICY,
        '"os_compute_api:os-services:list": "rule:context_is_admin or role:oneuptime_monitoring"',
      ),
    },
    {
      service: OpenStackServiceType.Compute,
      read: "hypervisors",
      path: "/os-hypervisors/detail",
      key: "hypervisors",
      projectField: "-",
      tells: "infrastructure",
      goesWithout:
        "the Hypervisors page, capacity, and the alerts on hypervisors.",
      fix: policyFix(
        NOVA_POLICY,
        '"os_compute_api:os-hypervisors:list-detail": "rule:context_is_admin or role:oneuptime_monitoring"',
      ),
    },
    {
      service: OpenStackServiceType.Compute,
      read: "aggregates",
      path: "/os-aggregates",
      key: "aggregates",
      projectField: "-",
      goesWithout: "host aggregates on the Hypervisors page.",
      fix: policyFix(
        NOVA_POLICY,
        '"os_compute_api:os-aggregates:index": "rule:context_is_admin or role:oneuptime_monitoring"',
      ),
    },
    {
      service: OpenStackServiceType.Compute,
      read: "flavors",
      path: "/flavors/detail",
      query: { is_public: "None", limit: "100" },
      key: "flavors",
      projectField: "-",
      goesWithout: "flavors, and how many more of one fit.",
      fix: "Any credential may read this, so look at this application credential's access rules.",
    },
    {
      service: OpenStackServiceType.Placement,
      read: "resource providers",
      path: "/resource_providers",
      key: "resource_providers",
      projectField: "-",
      tells: "infrastructure",
      goesWithout:
        "how full the cloud really is, on the capacity pages and their alerts.",
      fix: policyFix(
        "placement",
        '"placement:resource_providers:list": "rule:admin_api or role:oneuptime_monitoring"',
      ),
    },
    {
      service: OpenStackServiceType.Network,
      read: "agents",
      path: "/agents",
      key: "agents",
      projectField: "*",
      tells: "infrastructure",
      goesWithout:
        "network agents on the Services page and Needs attention, and the alerts on them.",
      fix: policyFix(
        "neutron",
        '"get_agent": "role:admin or role:oneuptime_monitoring"',
      ),
    },
    {
      service: OpenStackServiceType.Network,
      read: "networks",
      path: "/networks",
      query: {
        limit: "100",
        fields: ["project_id", "shared", "router:external"],
      },
      key: "networks",
      projectField: "project_id",
      tells: "projects",
      goesWithout: "networks in other projects on the Networks page.",
      fix: inCodeFix("Neutron"),
    },
    {
      service: OpenStackServiceType.Network,
      read: "subnets",
      path: "/subnets",
      query: { limit: "100", fields: ["project_id"] },
      key: "subnets",
      projectField: "project_id",
      goesWithout: "subnets in other projects on the Networks page.",
      fix: inCodeFix("Neutron"),
    },
    {
      service: OpenStackServiceType.Network,
      read: "routers",
      path: "/routers",
      query: { limit: "100", fields: ["project_id"] },
      key: "routers",
      projectField: "project_id",
      tells: "projects",
      goesWithout:
        "routers in other projects on the Routers page, and the alerts on them.",
      fix: inCodeFix("Neutron"),
    },
    {
      service: OpenStackServiceType.Network,
      read: "floating IPs",
      path: "/floatingips",
      query: { limit: "100", fields: ["project_id"] },
      key: "floatingips",
      projectField: "project_id",
      tells: "projects",
      goesWithout: "floating IPs in other projects.",
      fix: inCodeFix("Neutron"),
    },
    {
      service: OpenStackServiceType.Network,
      read: "IP availabilities",
      path: "/network-ip-availabilities",
      key: "network_ip_availabilities",
      projectField: "project_id",
      goesWithout: "address pools, and the alerts on running out of addresses.",
      fix: policyFix(
        "neutron",
        '"get_network_ip_availability": "role:admin or role:oneuptime_monitoring"',
      ),
    },
    {
      service: OpenStackServiceType.Volume,
      read: "volumes, all projects",
      path: "/volumes/detail",
      query: { all_tenants: "1", limit: "100" },
      key: "volumes",
      projectField: "os-vol-tenant-attr:tenant_id",
      tells: "projects",
      goesWithout:
        "volumes in other projects on the Volumes page, and the alerts on them.",
      fix: inCodeFix("Cinder"),
    },
    {
      service: OpenStackServiceType.Volume,
      read: "services",
      path: "/os-services",
      key: "services",
      projectField: "-",
      tells: "adminOnly",
      goesWithout:
        "cinder-volume and cinder-scheduler state on the Services page and Needs attention, and the alerts on them.",
      fix: CINDER_ADMIN_ONLY_FIX,
    },
    {
      service: OpenStackServiceType.Volume,
      read: "pools",
      path: "/scheduler-stats/get_pools",
      query: { detail: "true" },
      key: "pools",
      projectField: "-",
      tells: "adminOnly",
      goesWithout: "storage pools, and the alerts on a filling pool.",
      fix: CINDER_ADMIN_ONLY_FIX,
    },
    {
      service: OpenStackServiceType.Volume,
      read: "snapshots, all projects",
      path: "/snapshots/detail",
      query: { all_tenants: "1", limit: "100" },
      key: "snapshots",
      projectField: "os-extended-snapshot-attributes:project_id",
      goesWithout: "snapshots in other projects.",
      fix: inCodeFix("Cinder"),
    },
    {
      service: OpenStackServiceType.Volume,
      read: "backups, all projects",
      path: "/backups/detail",
      query: { all_tenants: "1", limit: "100" },
      key: "backups",
      projectField: "os-backup-project-attr:project_id",
      goesWithout: "backups in other projects.",
      fix: inCodeFix("Cinder"),
    },
    {
      service: OpenStackServiceType.Image,
      read: "images",
      path: "/images",
      query: { limit: "100" },
      key: "images",
      projectField: "owner",
      goesWithout: "private images in other projects.",
      fix: `Glance shows any credential the public images and its own. To read every project's: ${USE_FULL_VIEW}.`,
    },
  ];

/*
 * What the credential's own project holds, which is the other half of what it can do.
 * Where Cinder has enforce_new_defaults off, which is Cinder's own default, any role on a
 * project can create that project's volumes, reader and oneuptime_monitoring included. So
 * a monitoring credential belongs on a project of its own that holds nothing and has zero
 * quota, and one on a real project may be able to write there. One row of each is all it
 * takes to know. The same questions as the agent's troubleshoot.sh.
 */
export const OPENSTACK_PROJECT_HOLDINGS: ReadonlyArray<{
  service: OpenStackServiceType;
  what: string;
  path: string;
  key: string;
  // Nova and Cinder list a project's own unless asked for more, and Neutron does not.
  isFilteredByProject: boolean;
}> = [
  {
    service: OpenStackServiceType.Compute,
    what: "instances",
    path: "/servers",
    key: "servers",
    isFilteredByProject: false,
  },
  {
    service: OpenStackServiceType.Volume,
    what: "volumes",
    path: "/volumes",
    key: "volumes",
    isFilteredByProject: false,
  },
  {
    service: OpenStackServiceType.Network,
    what: "networks",
    path: "/networks",
    key: "networks",
    isFilteredByProject: true,
  },
  {
    service: OpenStackServiceType.Network,
    what: "routers",
    path: "/routers",
    key: "routers",
    isFilteredByProject: true,
  },
  {
    service: OpenStackServiceType.Network,
    what: "floating IPs",
    path: "/floatingips",
    key: "floatingips",
    isFilteredByProject: true,
  },
];

// A row any credential may see, so it says nothing about how much this one can.
function isAnyonesRow(row: JSONObject): boolean {
  return (
    row["shared"] === true ||
    row["router:external"] === true ||
    (row["visibility"] !== undefined && row["visibility"] !== "private")
  );
}

// What a 200 says about how much this credential sees. Exported for tests.
export function classifyAccessList(data: {
  body: JSONObject;
  key: string;
  projectField: string;
  ownProjectId: string | null;
  hasAdminRole: boolean;
}): { access: OpenStackReadAccess; reason?: string | undefined } {
  if (data.projectField === "-") {
    return { access: "ReadsEverything" };
  }

  const rows: JSONValue | undefined = data.body[data.key];
  const projects: Set<string> = new Set();
  let rowCount: number = 0;

  if (Array.isArray(rows)) {
    for (const row of rows as Array<JSONObject>) {
      rowCount++;

      if (!row || isAnyonesRow(row)) {
        continue;
      }

      const project: JSONValue | undefined = row[data.projectField];

      if (typeof project === "string" && project) {
        projects.add(project);
      }
    }
  }

  if (data.projectField === "*" && rowCount > 0) {
    return { access: "ReadsEverything" };
  }

  if (projects.size >= 2) {
    return {
      access: "ReadsEverything",
      reason: `${projects.size} projects in ${rowCount} rows`,
    };
  }

  if (projects.size === 1) {
    if (data.ownProjectId && !projects.has(data.ownProjectId)) {
      return {
        access: "ReadsEverything",
        reason: "every row is in one project, and not this credential's",
      };
    }

    return { access: "OwnProjectOnly", reason: "every row is in one project" };
  }

  if (data.hasAdminRole) {
    return {
      access: "ReadsEverything",
      reason: "nothing here to tell by, and the credential has the admin role",
    };
  }

  return {
    access: "OwnProjectOnly",
    reason: "a 200 with nothing here to tell by",
  };
}

// What a read's failure says. A refusal is the credential's, the rest the cloud's.
export function classifyAccessFailure(error: unknown): {
  access: OpenStackReadAccess;
  reason: string;
} {
  if (error instanceof OpenStackApiError) {
    if (error.kind === "refused") {
      return { access: "Refused", reason: `HTTP ${error.status}` };
    }

    if (error.kind === "absent") {
      return {
        access: "NotDeployed",
        reason: "HTTP 404: this cloud has no such API",
      };
    }

    return { access: "Failing", reason: `HTTP ${error.status}` };
  }

  return { access: "Failing", reason: "no answer" };
}

function errorContextOf(url: string): OpenStackErrorContext {
  try {
    const parsed: globalThis.URL = new globalThis.URL(url);

    return {
      host: parsed.hostname,
      port: parsed.port ? Number.parseInt(parsed.port, 10) : 443,
    };
  } catch {
    return { host: url, port: 443 };
  }
}

export interface OpenStackAccessCheckResult {
  reads: Array<OpenStackAccessRead>;
  // The first certificate that stopped a read: a person has to decide about it.
  certificateError: OpenStackCertificateError | null;
  // What the catalog names per region, by the type OneUptime reads each as.
  servicesByRegion: Record<string, Array<OpenStackServiceType>>;
  // What the credential's own project was seen to hold, per region that holds anything.
  projectHoldings: Record<string, Array<string>>;
}

export async function runOpenStackAccessCheck(data: {
  authUrl: string;
  catalog: ReadonlyArray<OpenStackCatalogService>;
  regions: ReadonlyArray<string>;
  endpointInterface: OpenStackEndpointInterface;
  ownProjectId: string | null;
  hasAdminRole: boolean;
  hasAccessRules: boolean;
  createClient: (data: {
    service: OpenStackServiceType;
    regionName: string;
    baseUrl: string;
  }) => OpenStackServiceClient;
  headersFor: (
    client: OpenStackServiceClient,
  ) => Promise<Record<string, string>>;
}): Promise<OpenStackAccessCheckResult> {
  const reads: Array<OpenStackAccessRead> = [];
  const servicesByRegion: Record<string, Array<OpenStackServiceType>> = {};
  const projectHoldings: Record<string, Array<string>> = {};
  let certificateError: OpenStackCertificateError | null = null;

  for (let index: number = 0; index < data.regions.length; index++) {
    const regionName: string = data.regions[index] as string;
    const clients: Map<OpenStackServiceType, OpenStackServiceClient | null> =
      new Map();

    servicesByRegion[regionName] = [];

    for (const service of Object.values(OpenStackServiceType)) {
      const url: string | null =
        service === OpenStackServiceType.Identity
          ? `${data.authUrl}/v3`
          : findOpenStackEndpoint({
              catalog: data.catalog,
              service: service,
              regionName: regionName,
              endpointInterface: data.endpointInterface,
            });

      if (!url) {
        clients.set(service, null);
        continue;
      }

      const client: OpenStackServiceClient = data.createClient({
        service: service,
        regionName: regionName,
        baseUrl:
          service === OpenStackServiceType.Identity
            ? url
            : toOpenStackServiceBaseUrl(service, url),
      });

      clients.set(service, client);
      servicesByRegion[regionName]!.push(service);

      try {
        client.headers = await data.headersFor(client);
      } catch {
        // A service that will not say what it speaks is asked without saying.
      }
    }

    let networksAccess: OpenStackReadAccess | null = null;

    for (const definition of OPENSTACK_ACCESS_READS) {
      // Keystone is one for the whole cloud.
      if (definition.service === OpenStackServiceType.Identity && index > 0) {
        continue;
      }

      const client: OpenStackServiceClient | null | undefined = clients.get(
        definition.service,
      );

      const write: (result: {
        access: OpenStackReadAccess;
        reason?: string | undefined;
      }) => void = (result: {
        access: OpenStackReadAccess;
        reason?: string | undefined;
      }): void => {
        const hasGap: boolean =
          result.access === "OwnProjectOnly" || result.access === "Refused";

        let fix: string | undefined = hasGap ? definition.fix : undefined;

        if (
          result.access === "Refused" &&
          result.reason === "HTTP 401" &&
          data.hasAccessRules
        ) {
          fix =
            "With access rules, a 401 means they do not list this path, or this service's keystonemiddleware has no service_type set and has not been restarted.";
        }

        reads.push({
          regionName: regionName,
          service: definition.service,
          read: definition.read,
          access: result.access,
          reason: result.reason,
          goesWithout:
            hasGap || result.access === "NotDeployed"
              ? definition.goesWithout
              : undefined,
          fix: fix,
        });
      };

      if (!client) {
        write({
          access: "NotDeployed",
          reason: "not in this region's catalog",
        });
        continue;
      }

      try {
        const answer: OpenStackJsonAnswer = await client.get({
          read: definition.read,
          path: definition.path,
          query: definition.query,
        });

        let result: {
          access: OpenStackReadAccess;
          reason?: string | undefined;
        } = classifyAccessList({
          body: answer.body,
          key: definition.key,
          projectField: definition.projectField,
          ownProjectId: data.ownProjectId,
          hasAdminRole: data.hasAdminRole,
        });

        if (definition.read === "networks") {
          networksAccess = result.access;
        }

        /*
         * A subnet of a shared network is anyone's to see and carries no sign of it, so
         * the subnets tell nothing the networks did not.
         */
        if (
          definition.read === "subnets" &&
          result.access === "ReadsEverything" &&
          networksAccess === "OwnProjectOnly"
        ) {
          result = {
            access: "OwnProjectOnly",
            reason:
              "as for the networks: a subnet of a shared network is anyone's to see",
          };
        }

        write(result);
      } catch (error) {
        if (error instanceof OpenStackCertificateError && !certificateError) {
          certificateError = error;
        }

        const failure: { access: OpenStackReadAccess; reason: string } =
          classifyAccessFailure(error);

        write(
          failure.access === "Failing" && !(error instanceof OpenStackApiError)
            ? {
                access: "Failing",
                reason: classifyOpenStackError(
                  error,
                  errorContextOf(client.baseUrl),
                ).message,
              }
            : failure,
        );
      }
    }

    const holds: Array<string> = await readProjectHoldings({
      clients: clients,
      ownProjectId: data.ownProjectId,
    });

    if (holds.length > 0) {
      projectHoldings[regionName] = holds;
    }
  }

  return {
    reads: reads,
    certificateError: certificateError,
    servicesByRegion: servicesByRegion,
    projectHoldings: projectHoldings,
  };
}

/*
 * One row of each is all it takes. A read that does not answer tells nothing either way,
 * and has already been said to fail by what the reads above found of its service.
 */
async function readProjectHoldings(data: {
  clients: Map<OpenStackServiceType, OpenStackServiceClient | null>;
  ownProjectId: string | null;
}): Promise<Array<string>> {
  if (!data.ownProjectId) {
    return [];
  }

  const holds: Array<string> = [];

  for (const holding of OPENSTACK_PROJECT_HOLDINGS) {
    const client: OpenStackServiceClient | null | undefined = data.clients.get(
      holding.service,
    );

    if (!client) {
      continue;
    }

    try {
      const answer: OpenStackJsonAnswer = await client.get({
        read: `what its project holds: ${holding.what}`,
        path: holding.path,
        query: holding.isFilteredByProject
          ? { project_id: data.ownProjectId, limit: "1", fields: ["id"] }
          : { limit: "1" },
      });

      const rows: JSONValue | undefined = answer.body[holding.key];

      if (Array.isArray(rows) && rows.length > 0) {
        holds.push(holding.what);
      }
    } catch {
      // It says nothing either way.
    }
  }

  return holds;
}

// What the answers add up to: the three levels the docs give.
export function getOpenStackAccessLevel(
  reads: ReadonlyArray<OpenStackAccessRead>,
): OpenStackAccessLevel {
  const definitionOf: (
    read: OpenStackAccessRead,
  ) => OpenStackAccessReadDefinition | undefined = (
    read: OpenStackAccessRead,
  ): OpenStackAccessReadDefinition | undefined => {
    return OPENSTACK_ACCESS_READS.find(
      (definition: OpenStackAccessReadDefinition): boolean => {
        return (
          definition.service === read.service && definition.read === read.read
        );
      },
    );
  };

  const hasGap: (read: OpenStackAccessRead) => boolean = (
    read: OpenStackAccessRead,
  ): boolean => {
    return read.access === "OwnProjectOnly" || read.access === "Refused";
  };

  const infrastructure: Array<OpenStackAccessRead> = reads.filter(
    (read: OpenStackAccessRead): boolean => {
      return definitionOf(read)?.tells === "infrastructure";
    },
  );
  const projects: Array<OpenStackAccessRead> = reads.filter(
    (read: OpenStackAccessRead): boolean => {
      return definitionOf(read)?.tells === "projects";
    },
  );

  const infrastructureGaps: number = infrastructure.filter(hasGap).length;
  const projectGaps: number = projects.filter(hasGap).length;
  const adminOnlyGaps: number = reads.filter(
    (read: OpenStackAccessRead): boolean => {
      return definitionOf(read)?.tells === "adminOnly" && hasGap(read);
    },
  ).length;
  const ownOnly: number = reads.filter((read: OpenStackAccessRead): boolean => {
    return read.access === "OwnProjectOnly";
  }).length;

  if (infrastructure.length > 0 && infrastructureGaps === 0) {
    return projectGaps === 0 && adminOnlyGaps === 0
      ? "FullView"
      : "InfrastructureOnly";
  }

  if (infrastructureGaps === infrastructure.length && ownOnly > 0) {
    return "ProjectView";
  }

  return "Other";
}
