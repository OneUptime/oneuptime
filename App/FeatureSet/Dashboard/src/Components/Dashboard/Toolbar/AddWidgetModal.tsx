import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import Icon from "Common/UI/Components/Icon/Icon";
import useTranslateValue from "Common/UI/Utils/Translation";
import IconProp from "Common/Types/Icon/IconProp";
import DashboardComponentType from "Common/Types/Dashboard/DashboardComponentType";

interface CatalogItem {
  type: DashboardComponentType;
  label: string;
  icon: IconProp;
  description: string;
}

interface CatalogCategory {
  name: string;
  description: string;
  items: Array<CatalogItem>;
}

const WIDGET_CATALOG: ReadonlyArray<CatalogCategory> = [
  {
    name: "Visualization",
    description: "Charts, values, tables, and other generic visualizations.",
    items: [
      {
        type: DashboardComponentType.Chart,
        label: "Chart",
        icon: IconProp.ChartBar,
        description: "Time-series chart from a metrics query.",
      },
      {
        type: DashboardComponentType.Value,
        label: "Value",
        icon: IconProp.Hashtag,
        description: "Single big-number stat, ideal for KPIs.",
      },
      {
        type: DashboardComponentType.Gauge,
        label: "Gauge",
        icon: IconProp.Gauge,
        description: "Radial gauge for a percent or threshold.",
      },
      {
        type: DashboardComponentType.Table,
        label: "Table",
        icon: IconProp.TableCells,
        description:
          "Tabular metric values — set a Group By (e.g. host.name) for one row per entity, or none for time-bucketed rows. Add formulas for derived columns like availability %.",
      },
      {
        type: DashboardComponentType.Text,
        label: "Text",
        icon: IconProp.Text,
        description: "Free-form Markdown text for headers and notes.",
      },
    ],
  },
  {
    name: "Telemetry",
    description: "Live streams from your logs and traces.",
    items: [
      {
        type: DashboardComponentType.LogStream,
        label: "Log Stream",
        icon: IconProp.Logs,
        description: "Tail recent log records matching a filter.",
      },
      {
        type: DashboardComponentType.TraceList,
        label: "Trace List",
        icon: IconProp.Waterfall,
        description: "Most recent traces for a service or operation.",
      },
      {
        type: DashboardComponentType.TraceChart,
        label: "Trace Chart",
        icon: IconProp.ChartBar,
        description:
          "Span counts or response-time percentiles over time, optionally split by an attribute (e.g. per tenant).",
      },
    ],
  },
  {
    name: "Alerts & Status",
    description: "OneUptime incidents, alerts, and monitor status.",
    items: [
      {
        type: DashboardComponentType.IncidentList,
        label: "Incident List",
        icon: IconProp.Alert,
        description: "Filtered list of incidents with state and severity.",
      },
      {
        type: DashboardComponentType.AlertList,
        label: "Alert List",
        icon: IconProp.Bell,
        description: "Recent alerts with state and severity.",
      },
      {
        type: DashboardComponentType.MonitorList,
        label: "Monitor List",
        icon: IconProp.AltGlobe,
        description: "Monitors with current operational status.",
      },
    ],
  },
  {
    name: "Hosts",
    description:
      "Hosts auto-discovered from the host.name OTel resource attribute.",
    items: [
      {
        type: DashboardComponentType.HostList,
        label: "Hosts",
        icon: IconProp.Server,
        description:
          "Hosts with connection status, OS, CPU/memory, and last-seen.",
      },
    ],
  },
  {
    name: "Kubernetes",
    description:
      "Live inventory from any connected Kubernetes cluster — populated by the OneUptime Kubernetes Agent.",
    items: [
      {
        type: DashboardComponentType.KubernetesPodList,
        label: "Pods",
        icon: IconProp.Cube,
        description: "Pods with phase, namespace, and cluster.",
      },
      {
        type: DashboardComponentType.KubernetesNodeList,
        label: "Nodes",
        icon: IconProp.Server,
        description: "Nodes with readiness and pressure conditions.",
      },
      {
        type: DashboardComponentType.KubernetesNamespaceList,
        label: "Namespaces",
        icon: IconProp.Folder,
        description: "All namespaces across selected clusters.",
      },
      {
        type: DashboardComponentType.KubernetesDeploymentList,
        label: "Deployments",
        icon: IconProp.ServerStack,
        description: "Deployments in selected clusters or namespaces.",
      },
      {
        type: DashboardComponentType.KubernetesStatefulSetList,
        label: "StatefulSets",
        icon: IconProp.ServerStack,
        description: "StatefulSets in selected clusters or namespaces.",
      },
      {
        type: DashboardComponentType.KubernetesDaemonSetList,
        label: "DaemonSets",
        icon: IconProp.ServerStack,
        description: "DaemonSets in selected clusters or namespaces.",
      },
      {
        type: DashboardComponentType.KubernetesJobList,
        label: "Jobs",
        icon: IconProp.Clock,
        description: "Jobs in selected clusters or namespaces.",
      },
      {
        type: DashboardComponentType.KubernetesCronJobList,
        label: "CronJobs",
        icon: IconProp.Clock,
        description: "CronJobs in selected clusters or namespaces.",
      },
    ],
  },
  {
    name: "Docker",
    description:
      "Live inventory from any connected Docker host — populated by the OneUptime Docker Agent.",
    items: [
      {
        type: DashboardComponentType.DockerHostList,
        label: "Hosts",
        icon: IconProp.Server,
        description:
          "Docker hosts with connection status and container counts.",
      },
      {
        type: DashboardComponentType.DockerContainerList,
        label: "Containers",
        icon: IconProp.Cube,
        description: "Containers with state, image, and CPU/memory.",
      },
      {
        type: DashboardComponentType.DockerImageList,
        label: "Images",
        icon: IconProp.Cube,
        description: "Images present on selected hosts.",
      },
      {
        type: DashboardComponentType.DockerNetworkList,
        label: "Networks",
        icon: IconProp.Globe,
        description: "Networks defined on selected hosts.",
      },
      {
        type: DashboardComponentType.DockerVolumeList,
        label: "Volumes",
        icon: IconProp.Database,
        description: "Volumes defined on selected hosts.",
      },
    ],
  },
  {
    name: "Podman",
    description:
      "Live inventory from any connected Podman host — populated by the OneUptime Podman Agent.",
    items: [
      {
        type: DashboardComponentType.PodmanHostList,
        label: "Hosts",
        icon: IconProp.Server,
        description:
          "Podman hosts with connection status and container counts.",
      },
      {
        type: DashboardComponentType.PodmanContainerList,
        label: "Containers",
        icon: IconProp.Cube,
        description: "Containers with state, image, and CPU/memory.",
      },
      {
        type: DashboardComponentType.PodmanImageList,
        label: "Images",
        icon: IconProp.Cube,
        description: "Images present on selected hosts.",
      },
      {
        type: DashboardComponentType.PodmanNetworkList,
        label: "Networks",
        icon: IconProp.Globe,
        description: "Networks defined on selected hosts.",
      },
      {
        type: DashboardComponentType.PodmanVolumeList,
        label: "Volumes",
        icon: IconProp.Database,
        description: "Volumes defined on selected hosts.",
      },
    ],
  },
  {
    name: "Proxmox",
    description:
      "Live inventory from any connected Proxmox VE cluster — populated by the OneUptime Proxmox Agent.",
    items: [
      {
        type: DashboardComponentType.ProxmoxNodeList,
        label: "Nodes",
        icon: IconProp.ServerStack,
        description: "PVE nodes with online status and CPU/memory.",
      },
      {
        type: DashboardComponentType.ProxmoxGuestList,
        label: "Guests",
        icon: IconProp.Cube,
        description:
          "QEMU VMs and LXC containers with run state, HA state, and node.",
      },
    ],
  },
  {
    name: "Ceph",
    description:
      "Live inventory from any connected Ceph cluster — populated by the OneUptime Ceph Agent.",
    items: [
      {
        type: DashboardComponentType.CephOsdList,
        label: "OSDs",
        icon: IconProp.SquareStack,
        description:
          "The OSD wall — a honeycomb of OSDs colored by up/in state.",
      },
      {
        type: DashboardComponentType.CephPoolList,
        label: "Pools",
        icon: IconProp.Database,
        description:
          "Pools with stored bytes, capacity-used bars, and object counts.",
      },
    ],
  },
];

export interface ComponentProps {
  onAddComponentClick: (type: DashboardComponentType) => void;
  onClose: () => void;
}

const AddWidgetModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const [searchTerm, setSearchTerm] = useState<string>("");
  const trimmedSearch: string = searchTerm.trim().toLowerCase();

  const filteredCatalog: ReadonlyArray<CatalogCategory> = useMemo(() => {
    if (!trimmedSearch) {
      return WIDGET_CATALOG;
    }
    const out: Array<CatalogCategory> = [];
    for (const category of WIDGET_CATALOG) {
      const items: Array<CatalogItem> = category.items.filter(
        (item: CatalogItem) => {
          return (
            item.label.toLowerCase().includes(trimmedSearch) ||
            item.description.toLowerCase().includes(trimmedSearch) ||
            category.name.toLowerCase().includes(trimmedSearch)
          );
        },
      );
      if (items.length > 0) {
        out.push({ ...category, items });
      }
    }
    return out;
  }, [trimmedSearch]);

  const totalMatches: number = filteredCatalog.reduce(
    (acc: number, c: CatalogCategory) => {
      return acc + c.items.length;
    },
    0,
  );

  return (
    <Modal
      title="Add Widget"
      description="Pick a widget to add to your dashboard."
      modalWidth={ModalWidth.Large}
      onClose={props.onClose}
      closeButtonText="Cancel"
    >
      <div className="flex flex-col gap-4">
        {/* Search bar */}
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <Icon icon={IconProp.Search} className="h-4 w-4 text-gray-400" />
          </div>
          <input
            type="text"
            value={searchTerm}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              setSearchTerm(e.target.value);
            }}
            placeholder="Search widgets..."
            className="block w-full rounded-md border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm text-gray-700 placeholder-gray-400 focus:border-indigo-300 focus:outline-none focus:ring-1 focus:ring-indigo-300"
            autoFocus={true}
          />
        </div>

        {/* Empty search state */}
        {totalMatches === 0 && (
          <div className="py-12 flex flex-col items-center justify-center text-center text-gray-400">
            <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center mb-2">
              <Icon icon={IconProp.Search} className="h-5 w-5 text-gray-300" />
            </div>
            <p className="text-sm">
              No widgets match &ldquo;{searchTerm}&rdquo;.
            </p>
          </div>
        )}

        {/* Categorized grid — single scroll container so the modal
            footer (close button) is always reachable. */}
        <div className="max-h-[60vh] overflow-y-auto pr-1 -mr-1 space-y-6">
          {filteredCatalog.map((category: CatalogCategory) => {
            return (
              <div key={category.name}>
                <div className="mb-2">
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    {translateString(category.name)}
                  </h4>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {translateString(category.description)}
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {category.items.map((item: CatalogItem) => {
                    return (
                      <button
                        key={item.type}
                        type="button"
                        onClick={() => {
                          props.onAddComponentClick(item.type);
                          props.onClose();
                        }}
                        className="group flex items-start gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50/30 focus:outline-none focus:ring-1 focus:ring-indigo-300"
                      >
                        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-gray-50 text-gray-500 group-hover:bg-indigo-50 group-hover:text-indigo-500 transition-colors">
                          <Icon icon={item.icon} className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-gray-800 truncate">
                            {translateString(item.label)}
                          </div>
                          <div className="text-xs text-gray-500 mt-0.5 line-clamp-2">
                            {translateString(item.description)}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
};

export default AddWidgetModal;
