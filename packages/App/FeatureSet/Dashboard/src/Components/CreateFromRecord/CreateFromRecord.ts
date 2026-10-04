import Dictionary from "Common/Types/Dictionary";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import PageMap from "../../Utils/PageMap";

/*
 * CREATING FROM A RECORD'S OWN TAB KEEPS THAT RECORD PICKED.
 *
 * The maintainer, closing the feedback document: "make software as simple
 * as possible to use and reduce decision paralysis".
 *
 * A monitor's Incidents tab lists the monitor's incidents, and its Declare
 * Incident button opened the project's Declare Incident page with nothing
 * picked: whoever had just been looking at the monitor searched for it again
 * on the Resources Affected step - or forgot to, and declared an incident
 * that never showed on the tab they came from. Create Alert on the monitor's
 * Alerts tab did the same (the tab handed the table the monitor as create
 * values that no form ever read), and so did the Incidents and Alerts tabs of
 * hosts, clusters, container hosts, databases, services and inventory items.
 * Their Scheduled Maintenance tabs offered no create at all, as an event
 * made there would not have been theirs either.
 *
 * One way carries the record for every one of them - Create Announcement on
 * a status page's tab has worked this way since #4338, and reads it here too:
 *
 *   - the tab's create buttons put the record in the create page's address,
 *     one parameter per kind of record: ?monitorId=, ?hostId=, ...;
 *   - the create page reads it - a UUID, or nothing - and looks the record up
 *     with the viewer's own permissions (useRecordToCreateFrom). A record
 *     that is gone, in another project or not theirs to read leaves the form
 *     as the project's list opens it, without a word;
 *   - the record is picked where the form names it - Resources Affected,
 *     Create Alert's Monitor, the announcement's status pages - first, with a
 *     template's own picks after it;
 *   - the breadcrumbs go back through the record's tab.
 *
 * Where Create lands does not change. A new incident, alert or maintenance
 * event opens on its own page, as it does from the project's lists: that is
 * where it is worked on, and it links back to the record. A new announcement
 * goes back to the status page's tab while it still shows there
 * (AnnouncementForm.getStatusPageToReturnTo).
 *
 * React-free, so App's tests can read it.
 */

// The records a create page can be opened from, by the tab they list on.
export enum CreateFromRecordKind {
  Monitor = "Monitor",
  Host = "Host",
  KubernetesCluster = "KubernetesCluster",
  DockerHost = "DockerHost",
  PodmanHost = "PodmanHost",
  ProxmoxCluster = "ProxmoxCluster",
  VMwareVCenter = "VMwareVCenter",
  CephCluster = "CephCluster",
  DockerSwarmCluster = "DockerSwarmCluster",
  IoTFleet = "IoTFleet",
  DatabaseServer = "DatabaseServer",
  NetworkSite = "NetworkSite",
  Service = "Service",
  StatusPage = "StatusPage",
}

// What is being created.
export enum CreatedRecordKind {
  Incident = "Incident",
  Alert = "Alert",
  ScheduledMaintenance = "ScheduledMaintenance",
  Announcement = "Announcement",
}

// What the form field that names the record holds.
export enum RecordFieldValue {
  // A resource picker's records, each with its name: [{ _id, name }].
  NamedRecords = "named-records",
  // A multi-select's IDs.
  RecordIds = "record-ids",
  // A dropdown's one ID.
  RecordId = "record-id",
}

// Where a new record names the record it was created from.
export interface CreateFromRecordField {
  key: string;
  holds: RecordFieldValue;
}

// A record's own tab, listing one kind of record it can create.
export interface RecordTab {
  page: PageMap;
  // Its breadcrumb, as the tab's own trail ends.
  title: string;
  // The field a record created from it is picked in, when not the kind's own.
  field?: CreateFromRecordField | undefined;
}

export interface CreateFromRecordKindDefinition {
  kind: CreateFromRecordKind;
  // The create page's query parameter that carries it.
  queryParam: string;
  /*
   * The trail to its tabs, as their own breadcrumbs read: Project > list >
   * view > tab. Each is a page of its own, linked.
   */
  listTitle: string;
  listPage: PageMap;
  viewTitle: string;
  viewPage: PageMap;
  // Where a new incident, alert or event names it.
  field: CreateFromRecordField;
  // The tabs it lists those on - and so the records it can be created from.
  tabs: Partial<Record<CreatedRecordKind, RecordTab>>;
}

// Each relation an incident, alert and maintenance event shares has one key.
const namedRecords: (key: string) => CreateFromRecordField = (
  key: string,
): CreateFromRecordField => {
  return { key: key, holds: RecordFieldValue.NamedRecords };
};

const INCIDENTS_TAB_TITLE: string = "Incidents";
const ALERTS_TAB_TITLE: string = "Alerts";
const SCHEDULED_MAINTENANCE_TAB_TITLE: string = "Scheduled Maintenance";

/*
 * In the order a create page reads them: should an address carry more than
 * one (no button writes that), the first wins.
 */
export const CREATE_FROM_RECORD_KINDS: ReadonlyArray<CreateFromRecordKindDefinition> =
  [
    {
      kind: CreateFromRecordKind.Monitor,
      queryParam: "monitorId",
      listTitle: "Monitors",
      listPage: PageMap.MONITORS,
      viewTitle: "View Monitor",
      viewPage: PageMap.MONITOR_VIEW,
      field: namedRecords("monitors"),
      tabs: {
        [CreatedRecordKind.Incident]: {
          page: PageMap.MONITOR_VIEW_INCIDENTS,
          title: INCIDENTS_TAB_TITLE,
        },
        // An alert is raised on one monitor: Create Alert's Monitor dropdown.
        [CreatedRecordKind.Alert]: {
          page: PageMap.MONITOR_VIEW_ALERTS,
          title: ALERTS_TAB_TITLE,
          field: { key: "monitor", holds: RecordFieldValue.RecordId },
        },
      },
    },
    {
      kind: CreateFromRecordKind.Host,
      queryParam: "hostId",
      listTitle: "Hosts",
      listPage: PageMap.HOSTS,
      viewTitle: "View Host",
      viewPage: PageMap.HOST_VIEW,
      field: namedRecords("hosts"),
      tabs: {
        [CreatedRecordKind.Incident]: {
          page: PageMap.HOST_VIEW_INCIDENTS,
          title: INCIDENTS_TAB_TITLE,
        },
        [CreatedRecordKind.Alert]: {
          page: PageMap.HOST_VIEW_ALERTS,
          title: ALERTS_TAB_TITLE,
        },
        [CreatedRecordKind.ScheduledMaintenance]: {
          page: PageMap.HOST_VIEW_SCHEDULED_MAINTENANCE,
          title: SCHEDULED_MAINTENANCE_TAB_TITLE,
        },
      },
    },
    {
      kind: CreateFromRecordKind.KubernetesCluster,
      queryParam: "kubernetesClusterId",
      listTitle: "Kubernetes",
      listPage: PageMap.KUBERNETES_CLUSTERS,
      viewTitle: "View Cluster",
      viewPage: PageMap.KUBERNETES_CLUSTER_VIEW,
      field: namedRecords("kubernetesClusters"),
      tabs: {
        [CreatedRecordKind.Incident]: {
          page: PageMap.KUBERNETES_CLUSTER_VIEW_INCIDENTS,
          title: INCIDENTS_TAB_TITLE,
        },
        [CreatedRecordKind.Alert]: {
          page: PageMap.KUBERNETES_CLUSTER_VIEW_ALERTS,
          title: ALERTS_TAB_TITLE,
        },
        [CreatedRecordKind.ScheduledMaintenance]: {
          page: PageMap.KUBERNETES_CLUSTER_VIEW_SCHEDULED_MAINTENANCE,
          title: SCHEDULED_MAINTENANCE_TAB_TITLE,
        },
      },
    },
    {
      kind: CreateFromRecordKind.DockerHost,
      queryParam: "dockerHostId",
      listTitle: "Docker",
      listPage: PageMap.DOCKER_HOSTS,
      viewTitle: "View Host",
      viewPage: PageMap.DOCKER_HOST_VIEW,
      field: namedRecords("dockerHosts"),
      tabs: {
        [CreatedRecordKind.Incident]: {
          page: PageMap.DOCKER_HOST_VIEW_INCIDENTS,
          title: INCIDENTS_TAB_TITLE,
        },
        [CreatedRecordKind.Alert]: {
          page: PageMap.DOCKER_HOST_VIEW_ALERTS,
          title: ALERTS_TAB_TITLE,
        },
        [CreatedRecordKind.ScheduledMaintenance]: {
          page: PageMap.DOCKER_HOST_VIEW_SCHEDULED_MAINTENANCE,
          title: SCHEDULED_MAINTENANCE_TAB_TITLE,
        },
      },
    },
    {
      kind: CreateFromRecordKind.PodmanHost,
      queryParam: "podmanHostId",
      listTitle: "Podman",
      listPage: PageMap.PODMAN_HOSTS,
      viewTitle: "View Host",
      viewPage: PageMap.PODMAN_HOST_VIEW,
      field: namedRecords("podmanHosts"),
      tabs: {
        [CreatedRecordKind.Incident]: {
          page: PageMap.PODMAN_HOST_VIEW_INCIDENTS,
          title: INCIDENTS_TAB_TITLE,
        },
        [CreatedRecordKind.Alert]: {
          page: PageMap.PODMAN_HOST_VIEW_ALERTS,
          title: ALERTS_TAB_TITLE,
        },
        [CreatedRecordKind.ScheduledMaintenance]: {
          page: PageMap.PODMAN_HOST_VIEW_SCHEDULED_MAINTENANCE,
          title: SCHEDULED_MAINTENANCE_TAB_TITLE,
        },
      },
    },
    {
      kind: CreateFromRecordKind.ProxmoxCluster,
      queryParam: "proxmoxClusterId",
      listTitle: "Proxmox",
      listPage: PageMap.PROXMOX_CLUSTERS,
      viewTitle: "View Cluster",
      viewPage: PageMap.PROXMOX_CLUSTER_VIEW,
      field: namedRecords("proxmoxClusters"),
      tabs: {
        [CreatedRecordKind.Incident]: {
          page: PageMap.PROXMOX_CLUSTER_VIEW_INCIDENTS,
          title: INCIDENTS_TAB_TITLE,
        },
        [CreatedRecordKind.Alert]: {
          page: PageMap.PROXMOX_CLUSTER_VIEW_ALERTS,
          title: ALERTS_TAB_TITLE,
        },
        [CreatedRecordKind.ScheduledMaintenance]: {
          page: PageMap.PROXMOX_CLUSTER_VIEW_SCHEDULED_MAINTENANCE,
          title: SCHEDULED_MAINTENANCE_TAB_TITLE,
        },
      },
    },
    {
      kind: CreateFromRecordKind.VMwareVCenter,
      queryParam: "vmwareVCenterId",
      listTitle: "VMware",
      listPage: PageMap.VMWARE_VCENTERS,
      viewTitle: "View vCenter",
      viewPage: PageMap.VMWARE_VCENTER_VIEW,
      field: namedRecords("vmwareVCenters"),
      tabs: {
        [CreatedRecordKind.Incident]: {
          page: PageMap.VMWARE_VCENTER_VIEW_INCIDENTS,
          title: INCIDENTS_TAB_TITLE,
        },
        [CreatedRecordKind.Alert]: {
          page: PageMap.VMWARE_VCENTER_VIEW_ALERTS,
          title: ALERTS_TAB_TITLE,
        },
        [CreatedRecordKind.ScheduledMaintenance]: {
          page: PageMap.VMWARE_VCENTER_VIEW_SCHEDULED_MAINTENANCE,
          title: SCHEDULED_MAINTENANCE_TAB_TITLE,
        },
      },
    },
    {
      kind: CreateFromRecordKind.CephCluster,
      queryParam: "cephClusterId",
      listTitle: "Ceph",
      listPage: PageMap.CEPH_CLUSTERS,
      viewTitle: "View Cluster",
      viewPage: PageMap.CEPH_CLUSTER_VIEW,
      field: namedRecords("cephClusters"),
      tabs: {
        [CreatedRecordKind.Incident]: {
          page: PageMap.CEPH_CLUSTER_VIEW_INCIDENTS,
          title: INCIDENTS_TAB_TITLE,
        },
        [CreatedRecordKind.Alert]: {
          page: PageMap.CEPH_CLUSTER_VIEW_ALERTS,
          title: ALERTS_TAB_TITLE,
        },
        [CreatedRecordKind.ScheduledMaintenance]: {
          page: PageMap.CEPH_CLUSTER_VIEW_SCHEDULED_MAINTENANCE,
          title: SCHEDULED_MAINTENANCE_TAB_TITLE,
        },
      },
    },
    {
      kind: CreateFromRecordKind.DockerSwarmCluster,
      queryParam: "dockerSwarmClusterId",
      listTitle: "DockerSwarm",
      listPage: PageMap.DOCKER_SWARM_CLUSTERS,
      viewTitle: "View Cluster",
      viewPage: PageMap.DOCKER_SWARM_CLUSTER_VIEW,
      field: namedRecords("dockerSwarmClusters"),
      tabs: {
        [CreatedRecordKind.Incident]: {
          page: PageMap.DOCKER_SWARM_CLUSTER_VIEW_INCIDENTS,
          title: INCIDENTS_TAB_TITLE,
        },
        [CreatedRecordKind.Alert]: {
          page: PageMap.DOCKER_SWARM_CLUSTER_VIEW_ALERTS,
          title: ALERTS_TAB_TITLE,
        },
        [CreatedRecordKind.ScheduledMaintenance]: {
          page: PageMap.DOCKER_SWARM_CLUSTER_VIEW_SCHEDULED_MAINTENANCE,
          title: SCHEDULED_MAINTENANCE_TAB_TITLE,
        },
      },
    },
    {
      kind: CreateFromRecordKind.IoTFleet,
      queryParam: "iotFleetId",
      listTitle: "IoT",
      listPage: PageMap.IOT_FLEETS,
      viewTitle: "View Fleet",
      viewPage: PageMap.IOT_FLEET_VIEW,
      field: namedRecords("iotFleets"),
      tabs: {
        [CreatedRecordKind.Incident]: {
          page: PageMap.IOT_FLEET_VIEW_INCIDENTS,
          title: INCIDENTS_TAB_TITLE,
        },
        [CreatedRecordKind.Alert]: {
          page: PageMap.IOT_FLEET_VIEW_ALERTS,
          title: ALERTS_TAB_TITLE,
        },
        [CreatedRecordKind.ScheduledMaintenance]: {
          page: PageMap.IOT_FLEET_VIEW_SCHEDULED_MAINTENANCE,
          title: SCHEDULED_MAINTENANCE_TAB_TITLE,
        },
      },
    },
    {
      kind: CreateFromRecordKind.DatabaseServer,
      queryParam: "databaseServerId",
      listTitle: "Databases",
      listPage: PageMap.DATABASE_SERVERS,
      viewTitle: "View Database",
      viewPage: PageMap.DATABASE_SERVER_VIEW,
      field: namedRecords("databaseServers"),
      tabs: {
        [CreatedRecordKind.Incident]: {
          page: PageMap.DATABASE_SERVER_VIEW_INCIDENTS,
          title: INCIDENTS_TAB_TITLE,
        },
        [CreatedRecordKind.Alert]: {
          page: PageMap.DATABASE_SERVER_VIEW_ALERTS,
          title: ALERTS_TAB_TITLE,
        },
        [CreatedRecordKind.ScheduledMaintenance]: {
          page: PageMap.DATABASE_SERVER_VIEW_SCHEDULED_MAINTENANCE,
          title: SCHEDULED_MAINTENANCE_TAB_TITLE,
        },
      },
    },
    // Only maintenance is attached to a site: incidents and alerts are not.
    {
      kind: CreateFromRecordKind.NetworkSite,
      queryParam: "networkSiteId",
      listTitle: "Network",
      listPage: PageMap.NETWORK_SITES,
      viewTitle: "View Site",
      viewPage: PageMap.NETWORK_SITE_VIEW,
      field: namedRecords("networkSites"),
      tabs: {
        [CreatedRecordKind.ScheduledMaintenance]: {
          page: PageMap.NETWORK_SITE_VIEW_SCHEDULED_MAINTENANCE,
          title: SCHEDULED_MAINTENANCE_TAB_TITLE,
        },
      },
    },
    {
      kind: CreateFromRecordKind.Service,
      queryParam: "serviceId",
      listTitle: "Services",
      listPage: PageMap.SERVICES,
      viewTitle: "View Service",
      viewPage: PageMap.SERVICE_VIEW,
      field: namedRecords("services"),
      tabs: {
        [CreatedRecordKind.Incident]: {
          page: PageMap.SERVICE_VIEW_INCIDENTS,
          title: INCIDENTS_TAB_TITLE,
        },
        [CreatedRecordKind.Alert]: {
          page: PageMap.SERVICE_VIEW_ALERTS,
          title: ALERTS_TAB_TITLE,
        },
        [CreatedRecordKind.ScheduledMaintenance]: {
          page: PageMap.SERVICE_VIEW_SCHEDULED_MAINTENANCE,
          title: SCHEDULED_MAINTENANCE_TAB_TITLE,
        },
      },
    },
    {
      kind: CreateFromRecordKind.StatusPage,
      queryParam: "statusPageId",
      listTitle: "Status Pages",
      listPage: PageMap.STATUS_PAGES,
      viewTitle: "View Status Page",
      viewPage: PageMap.STATUS_PAGE_VIEW,
      // The announcement's status pages, a multi-select of IDs.
      field: { key: "statusPages", holds: RecordFieldValue.RecordIds },
      tabs: {
        [CreatedRecordKind.Announcement]: {
          page: PageMap.STATUS_PAGE_VIEW_ANNOUNCEMENTS,
          title: "Announcements",
        },
      },
    },
  ];

// The create pages, and the breadcrumb each one's own trail ends on.
export interface CreatePageDefinition {
  created: CreatedRecordKind;
  page: PageMap;
  title: string;
}

export const CREATE_PAGES: Readonly<
  Record<CreatedRecordKind, CreatePageDefinition>
> = {
  [CreatedRecordKind.Incident]: {
    created: CreatedRecordKind.Incident,
    page: PageMap.INCIDENT_CREATE,
    title: "Declare New Incident",
  },
  [CreatedRecordKind.Alert]: {
    created: CreatedRecordKind.Alert,
    page: PageMap.ALERT_CREATE,
    title: "Create Alert",
  },
  [CreatedRecordKind.ScheduledMaintenance]: {
    created: CreatedRecordKind.ScheduledMaintenance,
    page: PageMap.SCHEDULED_MAINTENANCE_EVENT_CREATE,
    title: "New Scheduled Maintenance Event",
  },
  [CreatedRecordKind.Announcement]: {
    created: CreatedRecordKind.Announcement,
    page: PageMap.ANNOUNCEMENT_CREATE,
    title: "Create Announcement",
  },
};

// The first crumb of every trail: the project's home.
export const PROJECT_CRUMB_TITLE: string = "Project";

// A record, as a tab hands it to its create buttons.
export interface CreateFromRecordAddress {
  kind: CreateFromRecordKind;
  id: ObjectID | string;
}

// The record, once the create page has looked it up.
export interface RecordToCreateFrom {
  kind: CreateFromRecordKind;
  id: string;
  // As the picker shows it; empty for an unnamed record.
  name: string;
}

// One breadcrumb of the trail back through the record.
export interface CreateFromRecordCrumb {
  title: string;
  page: PageMap;
  modelId?: string | undefined;
}

export const getCreateFromRecordDefinition: (
  kind: CreateFromRecordKind,
) => CreateFromRecordKindDefinition = (
  kind: CreateFromRecordKind,
): CreateFromRecordKindDefinition => {
  return CREATE_FROM_RECORD_KINDS.find(
    (definition: CreateFromRecordKindDefinition): boolean => {
      return definition.kind === kind;
    },
  )!;
};

// The kinds of record a create page can be opened from: those with a tab for it.
export const getCreateFromRecordKinds: (
  created: CreatedRecordKind,
) => Array<CreateFromRecordKind> = (
  created: CreatedRecordKind,
): Array<CreateFromRecordKind> => {
  return CREATE_FROM_RECORD_KINDS.filter(
    (definition: CreateFromRecordKindDefinition): boolean => {
      return Boolean(definition.tabs[created]);
    },
  ).map((definition: CreateFromRecordKindDefinition): CreateFromRecordKind => {
    return definition.kind;
  });
};

const getTab: (
  kind: CreateFromRecordKind,
  created: CreatedRecordKind,
) => RecordTab | null = (
  kind: CreateFromRecordKind,
  created: CreatedRecordKind,
): RecordTab | null => {
  return getCreateFromRecordDefinition(kind)?.tabs[created] || null;
};

/*
 * An ID read off the address: a real UUID, or null. Anything else - a
 * half-copied link, a value someone typed - is ignored rather than handed to
 * the form, which would send it to the server.
 */
export const readCreateFromRecordId: (
  value: string | null | undefined,
) => string | null = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }

  const trimmed: string = value.trim();

  return ObjectID.isValidUUID(trimmed) ? trimmed : null;
};

/*
 * The query a tab's create button adds to the create page's address: the
 * record, when the page can be created from its kind. Anything else - no
 * record, an ID that is not one, a kind the page has no use for - adds
 * nothing, and the page opens as the project's list opens it.
 */
export const getCreateFromRecordQuery: (
  created: CreatedRecordKind,
  address: CreateFromRecordAddress | null | undefined,
) => Dictionary<string> = (
  created: CreatedRecordKind,
  address: CreateFromRecordAddress | null | undefined,
): Dictionary<string> => {
  if (!address || !getTab(address.kind, created)) {
    return {};
  }

  const id: string | null = readCreateFromRecordId(address.id?.toString());

  if (!id) {
    return {};
  }

  return {
    [getCreateFromRecordDefinition(address.kind).queryParam]: id,
  };
};

/*
 * The record a create page was opened from, read off its address with
 * `getParam` (Navigation.getQueryStringByName): the first kind the page can
 * be created from whose parameter holds a UUID.
 */
export const readCreateFromRecord: (
  created: CreatedRecordKind,
  getParam: (name: string) => string | null | undefined,
) => CreateFromRecordAddress | null = (
  created: CreatedRecordKind,
  getParam: (name: string) => string | null | undefined,
): CreateFromRecordAddress | null => {
  for (const kind of getCreateFromRecordKinds(created)) {
    const id: string | null = readCreateFromRecordId(
      getParam(getCreateFromRecordDefinition(kind).queryParam),
    );

    if (id) {
      return { kind: kind, id: id };
    }
  }

  return null;
};

// Where a record created from `kind`'s tab names it, or null when it cannot.
export const getCreateFromRecordField: (
  kind: CreateFromRecordKind,
  created: CreatedRecordKind,
) => CreateFromRecordField | null = (
  kind: CreateFromRecordKind,
  created: CreatedRecordKind,
): CreateFromRecordField | null => {
  const tab: RecordTab | null = getTab(kind, created);

  if (!tab) {
    return null;
  }

  return tab.field || getCreateFromRecordDefinition(kind).field;
};

// One related record's ID, however the form or the model holds it.
const readRecordId: (item: unknown) => string | null = (
  item: unknown,
): string | null => {
  if (typeof item === "string") {
    return item || null;
  }

  if (item instanceof ObjectID) {
    return item.toString();
  }

  if (item && typeof item === "object") {
    const record: Record<string, unknown> = item as Record<string, unknown>;
    const recordId: unknown = record["_id"] || record["id"];

    return recordId ? String(recordId) : null;
  }

  return null;
};

/*
 * The IDs a list of related records holds, as a form value or a model has
 * it: bare ID strings (what a picker writes), ObjectIDs, or records with an
 * ID (a template's monitors, a model's statusPages). Each once, in order.
 */
export const readRecordIds: (value: unknown) => Array<string> = (
  value: unknown,
): Array<string> => {
  if (!Array.isArray(value)) {
    return [];
  }

  const ids: Array<string> = [];

  for (const item of value) {
    const id: string | null = readRecordId(item);

    if (id && !ids.includes(id)) {
      ids.push(id);
    }
  }

  return ids;
};

/*
 * The form's starting values with the record picked: first in its field,
 * ahead of what a template or the alerts being declared from put there, and
 * once. A dropdown that takes one record takes it, unless something already
 * filled it in.
 */
export const pickRecordToCreateFrom: (data: {
  values: JSONObject;
  record: RecordToCreateFrom | null | undefined;
  created: CreatedRecordKind;
}) => JSONObject = (data: {
  values: JSONObject;
  record: RecordToCreateFrom | null | undefined;
  created: CreatedRecordKind;
}): JSONObject => {
  if (!data.record) {
    return data.values;
  }

  const field: CreateFromRecordField | null = getCreateFromRecordField(
    data.record.kind,
    data.created,
  );

  if (!field) {
    return data.values;
  }

  const recordId: string = data.record.id;
  const current: unknown = data.values[field.key];

  if (field.holds === RecordFieldValue.RecordId) {
    return current
      ? data.values
      : {
          ...data.values,
          [field.key]: recordId,
        };
  }

  const others: Array<unknown> = (Array.isArray(current) ? current : []).filter(
    (item: unknown): boolean => {
      return readRecordId(item) !== recordId;
    },
  );

  const picked: unknown =
    field.holds === RecordFieldValue.NamedRecords
      ? { _id: recordId, name: data.record.name }
      : recordId;

  return {
    ...data.values,
    [field.key]: [picked, ...others] as Array<JSONValue>,
  };
};

/*
 * The breadcrumbs of a create page opened from a record: the record's tab's
 * own trail - Project > Hosts > View Host > Incidents - and the create page
 * after it. Null when the page cannot be created from that kind.
 */
export const getCreateFromRecordTrail: (
  record: CreateFromRecordAddress,
  created: CreatedRecordKind,
) => Array<CreateFromRecordCrumb> | null = (
  record: CreateFromRecordAddress,
  created: CreatedRecordKind,
): Array<CreateFromRecordCrumb> | null => {
  const tab: RecordTab | null = getTab(record.kind, created);

  if (!tab) {
    return null;
  }

  const definition: CreateFromRecordKindDefinition =
    getCreateFromRecordDefinition(record.kind);
  const modelId: string = record.id.toString();
  const createPage: CreatePageDefinition = CREATE_PAGES[created];

  return [
    { title: PROJECT_CRUMB_TITLE, page: PageMap.HOME },
    { title: definition.listTitle, page: definition.listPage },
    { title: definition.viewTitle, page: definition.viewPage, modelId },
    { title: tab.title, page: tab.page, modelId },
    { title: createPage.title, page: createPage.page },
  ];
};
