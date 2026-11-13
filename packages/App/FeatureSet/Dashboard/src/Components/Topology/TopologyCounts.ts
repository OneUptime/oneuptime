import { formatReaderNumber } from "Common/Types/DateLanguage";
import EntityType from "Common/Types/Telemetry/EntityType";
import {
  ReadingDirection,
  getReadingDirection,
  setApartInSentence,
} from "Common/Types/ReadingDirection";
import {
  PluralTemplate,
  Translator,
  createTranslator,
  formatInline,
  translatableTerm,
} from "Common/Types/Translator";
import { metaForEntityType } from "./TopologyMeta";

/*
 * HOW MANY OF A KIND OF RESOURCE, IN THE READER'S LANGUAGE (#7658).
 *
 * Topology's count lines - where a service runs ("12 pods · 3 Docker
 * hosts"), what a cluster holds ("3 namespaces · 48 pods"), how big a
 * collection is ("4,200 IoT devices") - were a figure and an English noun
 * from a table of English words, or a type's label with an English "s"
 * where the table had no row ("ceph clusters", "processs"). Every language
 * read them in English, and Persian beside Latin digits.
 *
 * Every entity type has a count sentence of its own here - the server counts
 * what a service runs on whatever its type - worded in every locale with the
 * words the type's own pages use ("{{count}} pods" on the Kubernetes pages,
 * "{{count}} ESXi hosts" on VMware's). Each language puts the count where
 * its grammar does ("Pod 12 個", "Подов: 12"), in the form its count
 * takes and in the reader's digits ("۱۲ پاد"). A type this version does not
 * know - one a newer server reports - reads as its label and its count
 * ("Other: 3"), never as a plural made up from its label.
 *
 * Without a translator a line is in English words, its counts written the
 * way the page writes its numbers (the reader's digits), as the
 * infrastructure model's lines were: the infrastructure map card's English
 * line reads it so until that line is worded (#6690), and the
 * infrastructure search matches it.
 */
const COUNT_TEMPLATES: Readonly<Record<EntityType, PluralTemplate>> = {
  [EntityType.Service]: {
    one: "{{count}} service",
    other: "{{count}} services",
  },
  [EntityType.ServiceInstance]: {
    one: "{{count}} service instance",
    other: "{{count}} service instances",
  },
  [EntityType.Host]: { one: "{{count}} host", other: "{{count}} hosts" },
  [EntityType.Container]: {
    one: "{{count}} container",
    other: "{{count}} containers",
  },
  [EntityType.Process]: {
    one: "{{count}} process",
    other: "{{count}} processes",
  },
  [EntityType.KubernetesCluster]: {
    one: "{{count}} cluster",
    other: "{{count}} clusters",
  },
  [EntityType.KubernetesNamespace]: {
    one: "{{count}} namespace",
    other: "{{count}} namespaces",
  },
  [EntityType.KubernetesNode]: {
    one: "{{count}} node",
    other: "{{count}} nodes",
  },
  [EntityType.KubernetesPod]: {
    one: "{{count}} pod",
    other: "{{count}} pods",
  },
  [EntityType.KubernetesDeployment]: {
    one: "{{count}} deployment",
    other: "{{count}} deployments",
  },
  [EntityType.ProxmoxCluster]: {
    one: "{{count}} Proxmox cluster",
    other: "{{count}} Proxmox clusters",
  },
  [EntityType.OpenStackCloud]: {
    one: "{{count}} OpenStack cloud",
    other: "{{count}} OpenStack clouds",
  },
  [EntityType.ProxmoxNode]: {
    one: "{{count}} Proxmox node",
    other: "{{count}} Proxmox nodes",
  },
  [EntityType.OpenStackHypervisor]: {
    one: "{{count}} hypervisor",
    other: "{{count}} hypervisors",
  },
  [EntityType.ProxmoxGuest]: {
    one: "{{count}} guest",
    other: "{{count}} guests",
  },
  [EntityType.OpenStackInstance]: {
    one: "{{count}} instance",
    other: "{{count}} instances",
  },
  [EntityType.CephCluster]: {
    one: "{{count}} Ceph cluster",
    other: "{{count}} Ceph clusters",
  },
  [EntityType.StorageArray]: {
    one: "{{count}} storage array",
    other: "{{count}} storage arrays",
  },
  [EntityType.VMwareVCenter]: {
    one: "{{count}} vCenter",
    other: "{{count}} vCenters",
  },
  [EntityType.VMwareCluster]: {
    one: "{{count}} vSphere cluster",
    other: "{{count}} vSphere clusters",
  },
  [EntityType.VMwareHost]: {
    one: "{{count}} ESXi host",
    other: "{{count}} ESXi hosts",
  },
  [EntityType.VMwareVirtualMachine]: {
    one: "{{count}} VM",
    other: "{{count}} VMs",
  },
  [EntityType.VMwareDatastore]: {
    one: "{{count}} datastore",
    other: "{{count}} datastores",
  },
  [EntityType.DockerSwarmCluster]: {
    one: "{{count}} swarm cluster",
    other: "{{count}} swarm clusters",
  },
  [EntityType.DockerSwarmNode]: {
    one: "{{count}} swarm node",
    other: "{{count}} swarm nodes",
  },
  [EntityType.DockerSwarmService]: {
    one: "{{count}} swarm service",
    other: "{{count}} swarm services",
  },
  [EntityType.DockerSwarmTask]: {
    one: "{{count}} task",
    other: "{{count}} tasks",
  },
  [EntityType.TelemetrySdk]: {
    one: "{{count}} telemetry SDK",
    other: "{{count}} telemetry SDKs",
  },
  [EntityType.Database]: {
    one: "{{count}} database",
    other: "{{count}} databases",
  },
  [EntityType.RemoteService]: {
    one: "{{count}} remote service",
    other: "{{count}} remote services",
  },
  [EntityType.DatabaseServer]: {
    one: "{{count}} database endpoint",
    other: "{{count}} database endpoints",
  },
  [EntityType.MessageQueue]: {
    one: "{{count}} message queue",
    other: "{{count}} message queues",
  },
  [EntityType.OpenStackResource]: {
    one: "{{count}} OpenStack resource",
    other: "{{count}} OpenStack resources",
  },
  [EntityType.NetworkDevice]: {
    one: "{{count}} device",
    other: "{{count}} devices",
  },
  [EntityType.CloudResource]: {
    one: "{{count}} cloud resource",
    other: "{{count}} cloud resources",
  },
  [EntityType.ServerlessFunction]: {
    one: "{{count}} serverless function",
    other: "{{count}} serverless functions",
  },
  [EntityType.RumApplication]: {
    one: "{{count}} RUM application",
    other: "{{count}} RUM applications",
  },
  [EntityType.IoTDevice]: {
    one: "{{count}} IoT device",
    other: "{{count}} IoT devices",
  },
  [EntityType.DockerHost]: {
    one: "{{count}} Docker host",
    other: "{{count}} Docker hosts",
  },
  [EntityType.PodmanHost]: {
    one: "{{count}} Podman host",
    other: "{{count}} Podman hosts",
  },
  [EntityType.ExternalService]: {
    one: "{{count}} external service",
    other: "{{count}} external services",
  },
  [EntityType.ExternalDatabase]: {
    one: "{{count}} external database",
    other: "{{count}} external databases",
  },
  [EntityType.Appliance]: {
    one: "{{count}} appliance",
    other: "{{count}} appliances",
  },
};

const ENGLISH: Translator = createTranslator(undefined);

// A type's count sentence; undefined for a type this version does not know.
export function getCountTemplate(
  entityType: string,
): PluralTemplate | undefined {
  return Object.prototype.hasOwnProperty.call(COUNT_TEMPLATES, entityType)
    ? COUNT_TEMPLATES[entityType as EntityType]
    : undefined;
}

/** "12 pods", "1 Docker host", "Pod 12 個", "۱۲ پاد", "المضيفون: 12". */
export function countOfType(
  entityType: string,
  count: number,
  translator?: Translator,
): string {
  const reader: Translator = translator || ENGLISH;
  // English words without a translator, but the page's own digits.
  const written: string = translator
    ? translator.formatNumber(count)
    : formatReaderNumber(count);
  const template: PluralTemplate | undefined = getCountTemplate(entityType);

  if (template) {
    return reader.translatePlural(template, count, { count: written });
  }

  return reader.translateTemplate("{{label}}: {{count}}", {
    label: translatableTerm(metaForEntityType(entityType).label),
    count: written,
  });
}

/*
 * Counts on one line, set off from each other the way the reader's
 * language sets off facts on a line: "12 pods · 3 Docker hosts", "۱۲ پاد •
 * ۳ میزبان Docker". On a page read from the right each count is set apart
 * in an isolate. Without it a noun left in Latin letters ("میزبان Docker")
 * took the separator and the next count's digits into its left-to-right
 * run, and "۳ میزبان Docker • ۲ پاد" was drawn "۳ میزبان ۲ • Docker پاد".
 */
export function formatCountLine(
  counts: ReadonlyArray<string>,
  translator: Translator = ENGLISH,
): string {
  const direction: ReadingDirection = getReadingDirection(translator.language);

  return formatInline(
    counts.map((count: string): string => {
      return setApartInSentence(count, direction);
    }),
    translator,
  );
}
