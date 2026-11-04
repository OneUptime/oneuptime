import { getOpenStackShortHostName } from "../../Types/OpenStack/OpenStackHealthRules";
import {
  OpenStackResourceKind,
  OpenStackServiceType,
} from "../../Types/OpenStack/OpenStackResourceKind";
import { ChangeEventAttribute } from "../Telemetry/ChangeEventFields";
import { OpenStackAuditAttribute } from "../SecurityEvent/LogParsers/OpenStackAuditLogParser";
import {
  OPENSTACK_EVENT_HOST_ATTRIBUTE,
  OPENSTACK_EVENT_SERVICE_ATTRIBUTE,
} from "./OpenStackNotifications";
import { OpenStackLogAttribute } from "./OpenStackLogs";

/*
 * WHICH OF A CLOUD'S LOGS, CHANGES AND AUDIT EVENTS ARE ONE PART'S.
 *
 * An instance's are what names its UUID, a hypervisor's what came from it, and a service's
 * its own. Pure, so the pages and the tests read one answer. Hosts are compared by their
 * short name, as everything else about a host is (OpenStackHealthRules): Nova's services
 * say compute-01 where its hypervisors say compute-01.example.internal.
 */

export interface OpenStackPartLogFacts {
  kind: OpenStackResourceKind | string;
  externalId: string;
  name?: string | null | undefined;
  hypervisorName?: string | null | undefined;
  // What the row's facts say a worker's host is.
  workerHost?: string | null | undefined;
}

/*
 * The project an API's logs go by, from the service type its row is named for. A worker has
 * a binary of its own to go by, and an API serves requests in processes that say so.
 */
const COMPONENT_OF_API: Readonly<Record<string, string>> = {
  [OpenStackServiceType.Compute]: "nova",
  [OpenStackServiceType.Network]: "neutron",
  [OpenStackServiceType.Volume]: "cinder",
  [OpenStackServiceType.Image]: "glance",
  [OpenStackServiceType.Identity]: "keystone",
  [OpenStackServiceType.Placement]: "placement",
};

/*
 * A worker's host, without the backend a cinder-volume keeps after an @, as the machine
 * its lines came from calls itself.
 */
function workerMachine(host: string | null | undefined): string {
  const name: string = (host || "").trim();
  const at: number = name.indexOf("@");

  return getOpenStackShortHostName(at > 0 ? name.slice(0, at) : name);
}

/*
 * The log attributes that make a line this part's, beside the cloud's own. Null for a
 * kind no line can be said to be about.
 */
export function getOpenStackPartLogAttributes(
  part: OpenStackPartLogFacts,
): Record<string, string> | null {
  switch (part.kind) {
    case OpenStackResourceKind.Instance:
      return { [OpenStackLogAttribute.InstanceId]: part.externalId };
    case OpenStackResourceKind.Hypervisor: {
      const host: string = getOpenStackShortHostName(
        part.hypervisorName || part.name,
      );

      return host ? { [OpenStackLogAttribute.Host]: host } : null;
    }
    case OpenStackResourceKind.Service: {
      const host: string = workerMachine(part.workerHost);

      if (!part.name) {
        return null;
      }

      return host
        ? {
            [OpenStackLogAttribute.Service]: part.name,
            [OpenStackLogAttribute.Host]: host,
          }
        : { [OpenStackLogAttribute.Service]: part.name };
    }
    case OpenStackResourceKind.Api: {
      const component: string | undefined =
        COMPONENT_OF_API[(part.name || "").toLowerCase()];

      return component
        ? { [OpenStackLogAttribute.Component]: component }
        : null;
    }
    default:
      return null;
  }
}

/*
 * The kinds with a Feed tab: those a notification names by the id their row goes by. A
 * flavor's row holds its region as well, and has no page.
 */
const KINDS_WITH_THEIR_OWN_EVENTS: ReadonlySet<string> = new Set<string>([
  OpenStackResourceKind.Instance,
  OpenStackResourceKind.Volume,
  OpenStackResourceKind.Snapshot,
  OpenStackResourceKind.Backup,
  OpenStackResourceKind.Image,
  OpenStackResourceKind.Network,
  OpenStackResourceKind.Subnet,
  OpenStackResourceKind.Router,
  OpenStackResourceKind.FloatingIp,
]);

/*
 * The change-event attributes that make a change this part's, beside the cloud's own.
 * A hypervisor's are everything that happened on the machine: what is running there is
 * the first thing to look at when it misbehaves.
 */
export function getOpenStackPartChangeAttributes(
  part: OpenStackPartLogFacts,
): Record<string, string> | null {
  if (KINDS_WITH_THEIR_OWN_EVENTS.has(String(part.kind))) {
    return { [ChangeEventAttribute.CloudResourceId]: part.externalId };
  }

  if (part.kind === OpenStackResourceKind.Hypervisor) {
    const host: string = getOpenStackShortHostName(
      part.hypervisorName || part.name,
    );

    return host ? { [OPENSTACK_EVENT_HOST_ATTRIBUTE]: host } : null;
  }

  if (part.kind === OpenStackResourceKind.Service) {
    const host: string = workerMachine(part.workerHost);

    return part.name && host
      ? {
          [OPENSTACK_EVENT_SERVICE_ATTRIBUTE]: part.name,
          [OPENSTACK_EVENT_HOST_ATTRIBUTE]: host,
        }
      : null;
  }

  return null;
}

/*
 * The audit-event attributes that say someone did something to this part: its id as the
 * API call's target. A Service's calls name the service record, which this cannot know, so
 * they are read from its change events' actor instead.
 */
export function getOpenStackPartAuditAttributes(
  part: OpenStackPartLogFacts,
): Record<string, string> | null {
  if (KINDS_WITH_THEIR_OWN_EVENTS.has(String(part.kind))) {
    return { [OpenStackAuditAttribute.TargetId]: part.externalId };
  }

  return null;
}
