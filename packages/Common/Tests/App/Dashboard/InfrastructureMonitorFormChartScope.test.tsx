import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #6264: an infrastructure monitor's step form charts its metrics as
 * the monitor will read them - narrowed to the cluster, host, vCenter,
 * array or fleet it watches and its resource filters, which the worker adds
 * before each check - and follows a change to either, while what the form
 * saves stays the queries as written. Before, the chart under Select
 * Metrics charted the queries as saved: the metric for every cluster or
 * host in the project.
 *
 * The step forms are real; their MetricView is a stand-in that records the
 * queries it is handed for its editor and its charts (MetricView itself is
 * held to fetching and drawing its chart queries in MetricViewChartQueries).
 */

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

interface ViewProps {
  data: MetricViewData;
  chartQueryConfigs?: Array<MetricQueryConfigData> | undefined;
  onChange: (data: MetricViewData) => void;
}

let lastView: ViewProps | null = null;

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricView",
  () => {
    return {
      __esModule: true,
      default: (props: ViewProps): React.ReactElement => {
        lastView = props;
        return React.createElement("div", { "data-testid": "metric-view" });
      },
    };
  },
);

import CephMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/CephMonitor/CephMonitorStepForm";
import DockerMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/DockerMonitor/DockerMonitorStepForm";
import DockerSwarmMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/DockerSwarmMonitor/DockerSwarmMonitorStepForm";
import HostMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/HostMonitor/HostMonitorStepForm";
import IoTMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/IoTMonitor/IoTMonitorStepForm";
import KubernetesMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/KubernetesMonitor/KubernetesMonitorStepForm";
import OpenStackMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/OpenStackMonitor/OpenStackMonitorStepForm";
import PodmanMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/PodmanMonitor/PodmanMonitorStepForm";
import ProxmoxMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/ProxmoxMonitor/ProxmoxMonitorStepForm";
import StorageArrayMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/StorageArrayMonitor/StorageArrayMonitorStepForm";
import VMwareMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/VMwareMonitor/VMwareMonitorStepForm";
import Wildcard from "../../../Types/BaseDatabase/Wildcard";
import Dictionary from "../../../Types/Dictionary";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MetricsViewConfig from "../../../Types/Metrics/MetricsViewConfig";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import { MonitorStepCephMonitorUtil } from "../../../Types/Monitor/MonitorStepCephMonitor";
import { MonitorStepDockerMonitorUtil } from "../../../Types/Monitor/MonitorStepDockerMonitor";
import { MonitorStepDockerSwarmMonitorUtil } from "../../../Types/Monitor/MonitorStepDockerSwarmMonitor";
import { MonitorStepHostMonitorUtil } from "../../../Types/Monitor/MonitorStepHostMonitor";
import { MonitorStepIoTMonitorUtil } from "../../../Types/Monitor/MonitorStepIoTMonitor";
import MonitorStepKubernetesMonitor, {
  KubernetesResourceScope,
  MonitorStepKubernetesMonitorUtil,
} from "../../../Types/Monitor/MonitorStepKubernetesMonitor";
import { MonitorStepOpenStackMonitorUtil } from "../../../Types/Monitor/MonitorStepOpenStackMonitor";
import { MonitorStepPodmanMonitorUtil } from "../../../Types/Monitor/MonitorStepPodmanMonitor";
import MonitorStepProxmoxMonitor, {
  MonitorStepProxmoxMonitorUtil,
} from "../../../Types/Monitor/MonitorStepProxmoxMonitor";
import { MonitorStepStorageArrayMonitorUtil } from "../../../Types/Monitor/MonitorStepStorageArrayMonitor";
import { MonitorStepVMwareMonitorUtil } from "../../../Types/Monitor/MonitorStepVMwareMonitor";
import MonitorType from "../../../Types/Monitor/MonitorType";
import MonitorStepMetricQueries, {
  MetricMonitorStepSettings,
} from "../../../Utils/Monitor/MonitorStepMetricQueries";

// A query of someone's own, with a filter of its own.
const OWN_FILTER: Dictionary<unknown> = { "own.key": "kept" };

const QUERY: MetricQueryConfigData = {
  metricAliasData: {
    metricVariable: "a",
    title: "Usage",
    description: "",
    legend: "",
    legendUnit: "",
  },
  metricQueryData: {
    filterData: {
      metricName: "a.custom.metric",
      aggegationType: MetricsAggregationType.Avg,
      attributes: { ...OWN_FILTER },
    } as never,
  },
};

const VIEW: MetricsViewConfig = { queryConfigs: [QUERY], formulaConfigs: [] };

type Settings = MetricMonitorStepSettings & Record<string, unknown>;

interface FormCase {
  name: string;
  monitorType: MonitorType;
  settings: Settings;
  // What the chart's query is read with: its own filter and the scope.
  charted: Dictionary<unknown>;
  // The settings watching another resource.
  elsewhere: (settings: Settings) => Settings;
  // The scope attribute that names the resource, and its value elsewhere.
  resourceKey: string;
  resourceElsewhere: unknown;
  renderForm: (
    settings: Settings,
    onChange: (settings: Settings) => void,
  ) => React.ReactElement;
}

const FORM_CASES: Array<FormCase> = [
  {
    name: "Host",
    monitorType: MonitorType.Host,
    settings: {
      ...MonitorStepHostMonitorUtil.getDefault(),
      hostIdentifier: "Web-01",
      metricViewConfig: VIEW,
    } as Settings,
    charted: { ...OWN_FILTER, "resource.host.name": "web-01" },
    elsewhere: (settings: Settings): Settings => {
      return { ...settings, hostIdentifier: "db-01" };
    },
    resourceKey: "resource.host.name",
    resourceElsewhere: "db-01",
    renderForm: (
      settings: Settings,
      onChange: (settings: Settings) => void,
    ): React.ReactElement => {
      return (
        <HostMonitorStepForm
          monitorStepHostMonitor={settings as never}
          onChange={onChange as never}
        />
      );
    },
  },
  {
    name: "Kubernetes",
    monitorType: MonitorType.Kubernetes,
    settings: {
      ...MonitorStepKubernetesMonitorUtil.getDefault(),
      clusterIdentifier: "prod",
      resourceScope: KubernetesResourceScope.Workload,
      resourceFilters: {
        namespace: "payments",
        workloadType: "deployment",
        workloadName: "checkout",
      },
      metricViewConfig: VIEW,
    } as Settings,
    charted: {
      ...OWN_FILTER,
      "resource.k8s.cluster.name": "prod",
      "resource.k8s.namespace.name": "payments",
      "resource.k8s.deployment.name": "checkout",
    },
    elsewhere: (settings: Settings): Settings => {
      return { ...settings, clusterIdentifier: "staging" };
    },
    resourceKey: "resource.k8s.cluster.name",
    resourceElsewhere: "staging",
    renderForm: (
      settings: Settings,
      onChange: (settings: Settings) => void,
    ): React.ReactElement => {
      return (
        <KubernetesMonitorStepForm
          monitorStepKubernetesMonitor={settings as never}
          onChange={onChange as never}
        />
      );
    },
  },
  {
    name: "Docker",
    monitorType: MonitorType.Docker,
    settings: {
      ...MonitorStepDockerMonitorUtil.getDefault(),
      hostIdentifier: "docker-1",
      containerFilters: { containerName: "api" },
      metricViewConfig: VIEW,
    } as Settings,
    charted: {
      ...OWN_FILTER,
      "resource.host.name": "docker-1",
      "resource.container.runtime": "docker",
      "resource.container.name": "api",
    },
    elsewhere: (settings: Settings): Settings => {
      return { ...settings, hostIdentifier: "docker-2" };
    },
    resourceKey: "resource.host.name",
    resourceElsewhere: "docker-2",
    renderForm: (
      settings: Settings,
      onChange: (settings: Settings) => void,
    ): React.ReactElement => {
      return (
        <DockerMonitorStepForm
          monitorStepDockerMonitor={settings as never}
          onChange={onChange as never}
        />
      );
    },
  },
  {
    name: "Podman",
    monitorType: MonitorType.Podman,
    settings: {
      ...MonitorStepPodmanMonitorUtil.getDefault(),
      hostIdentifier: "podman-1",
      containerFilters: { containerImage: "nginx" },
      metricViewConfig: VIEW,
    } as Settings,
    charted: {
      ...OWN_FILTER,
      "resource.host.name": "podman-1",
      "resource.container.runtime": "podman",
      "resource.container.image.name": "nginx",
    },
    elsewhere: (settings: Settings): Settings => {
      return { ...settings, hostIdentifier: "podman-2" };
    },
    resourceKey: "resource.host.name",
    resourceElsewhere: "podman-2",
    renderForm: (
      settings: Settings,
      onChange: (settings: Settings) => void,
    ): React.ReactElement => {
      return (
        <PodmanMonitorStepForm
          monitorStepPodmanMonitor={settings as never}
          onChange={onChange as never}
        />
      );
    },
  },
  {
    name: "Docker Swarm",
    monitorType: MonitorType.DockerSwarm,
    settings: {
      ...MonitorStepDockerSwarmMonitorUtil.getDefault(),
      clusterIdentifier: "swarm-1",
      resourceFilters: { serviceName: "web" },
      metricViewConfig: VIEW,
    } as Settings,
    charted: {
      ...OWN_FILTER,
      "resource.docker.swarm.cluster.name": "swarm-1",
      "resource.docker.swarm.service.name": "web",
    },
    elsewhere: (settings: Settings): Settings => {
      return { ...settings, clusterIdentifier: "swarm-2" };
    },
    resourceKey: "resource.docker.swarm.cluster.name",
    resourceElsewhere: "swarm-2",
    renderForm: (
      settings: Settings,
      onChange: (settings: Settings) => void,
    ): React.ReactElement => {
      return (
        <DockerSwarmMonitorStepForm
          monitorStepDockerSwarmMonitor={settings as never}
          onChange={onChange as never}
        />
      );
    },
  },
  {
    name: "Proxmox",
    monitorType: MonitorType.Proxmox,
    settings: {
      ...MonitorStepProxmoxMonitorUtil.getDefault(),
      clusterIdentifier: "pve-prod",
      resourceFilters: { nodeName: "pve1" },
      metricViewConfig: VIEW,
    } as Settings,
    charted: {
      ...OWN_FILTER,
      "resource.proxmox.cluster.name": "pve-prod",
      "pve.scope": "node",
      "pve.id": "pve1",
    },
    elsewhere: (settings: Settings): Settings => {
      return { ...settings, clusterIdentifier: "pve-lab" };
    },
    resourceKey: "resource.proxmox.cluster.name",
    resourceElsewhere: "pve-lab",
    renderForm: (
      settings: Settings,
      onChange: (settings: Settings) => void,
    ): React.ReactElement => {
      return (
        <ProxmoxMonitorStepForm
          monitorStepProxmoxMonitor={settings as never}
          onChange={onChange as never}
        />
      );
    },
  },
  {
    name: "OpenStack",
    monitorType: MonitorType.OpenStack,
    settings: {
      ...MonitorStepOpenStackMonitorUtil.getDefault(),
      cloudIdentifier: "cloud-1",
      resourceFilters: { regionName: "RegionOne" },
      metricViewConfig: VIEW,
    } as Settings,
    charted: {
      ...OWN_FILTER,
      "resource.openstack.cloud.name": "cloud-1",
      "openstack.region.name": "RegionOne",
    },
    elsewhere: (settings: Settings): Settings => {
      return { ...settings, cloudIdentifier: "cloud-2" };
    },
    resourceKey: "resource.openstack.cloud.name",
    resourceElsewhere: "cloud-2",
    renderForm: (
      settings: Settings,
      onChange: (settings: Settings) => void,
    ): React.ReactElement => {
      return (
        <OpenStackMonitorStepForm
          monitorStepOpenStackMonitor={settings as never}
          onChange={onChange as never}
        />
      );
    },
  },
  {
    name: "VMware",
    monitorType: MonitorType.VMware,
    settings: {
      ...MonitorStepVMwareMonitorUtil.getDefault(),
      vcenterIdentifier: "vc-1",
      resourceFilters: { hostName: "esx-1" },
      metricViewConfig: VIEW,
    } as Settings,
    charted: {
      ...OWN_FILTER,
      "resource.vmware.vcenter.name": "vc-1",
      "resource.vcenter.host.name": "esx-1",
    },
    elsewhere: (settings: Settings): Settings => {
      return { ...settings, vcenterIdentifier: "vc-2" };
    },
    resourceKey: "resource.vmware.vcenter.name",
    resourceElsewhere: "vc-2",
    renderForm: (
      settings: Settings,
      onChange: (settings: Settings) => void,
    ): React.ReactElement => {
      return (
        <VMwareMonitorStepForm
          monitorStepVMwareMonitor={settings as never}
          onChange={onChange as never}
        />
      );
    },
  },
  {
    name: "Ceph",
    monitorType: MonitorType.Ceph,
    settings: {
      ...MonitorStepCephMonitorUtil.getDefault(),
      clusterIdentifier: "ceph-1",
      resourceFilters: { osdId: "osd.3" },
      metricViewConfig: VIEW,
    } as Settings,
    charted: {
      ...OWN_FILTER,
      "resource.ceph.cluster.name": "ceph-1",
      ceph_daemon: "osd.3",
    },
    elsewhere: (settings: Settings): Settings => {
      return { ...settings, clusterIdentifier: "ceph-2" };
    },
    resourceKey: "resource.ceph.cluster.name",
    resourceElsewhere: "ceph-2",
    renderForm: (
      settings: Settings,
      onChange: (settings: Settings) => void,
    ): React.ReactElement => {
      return (
        <CephMonitorStepForm
          monitorStepCephMonitor={settings as never}
          onChange={onChange as never}
        />
      );
    },
  },
  {
    name: "Storage Array",
    monitorType: MonitorType.StorageArray,
    settings: {
      ...MonitorStepStorageArrayMonitorUtil.getDefault(),
      arrayIdentifier: "array-1",
      metricViewConfig: VIEW,
    } as Settings,
    charted: { ...OWN_FILTER, "resource.storage.array.name": "array-1" },
    elsewhere: (settings: Settings): Settings => {
      return { ...settings, arrayIdentifier: "array-2" };
    },
    resourceKey: "resource.storage.array.name",
    resourceElsewhere: "array-2",
    renderForm: (
      settings: Settings,
      onChange: (settings: Settings) => void,
    ): React.ReactElement => {
      return (
        <StorageArrayMonitorStepForm
          monitorStepStorageArrayMonitor={settings as never}
          onChange={onChange as never}
        />
      );
    },
  },
  {
    name: "IoT Device",
    monitorType: MonitorType.IoTDevice,
    settings: {
      ...MonitorStepIoTMonitorUtil.getDefault(),
      fleetIdentifier: "Sensors",
      resourceFilters: { deviceId: "sensor-001" },
      metricViewConfig: VIEW,
    } as Settings,
    charted: {
      ...OWN_FILTER,
      // The fleet whatever its case, as the worker reads it.
      "resource.iot.fleet.name": new Wildcard<string>(["Sensors"]),
      "device.id": "sensor-001",
    },
    elsewhere: (settings: Settings): Settings => {
      return { ...settings, fleetIdentifier: "Trucks" };
    },
    resourceKey: "resource.iot.fleet.name",
    resourceElsewhere: new Wildcard<string>(["Trucks"]),
    renderForm: (
      settings: Settings,
      onChange: (settings: Settings) => void,
    ): React.ReactElement => {
      return (
        <IoTMonitorStepForm
          monitorStepIoTMonitor={settings as never}
          onChange={onChange as never}
        />
      );
    },
  },
];

// The form as the monitor page holds it: each change is handed back.
function StatefulForm(props: {
  formCase: FormCase;
  initial: Settings;
  onChange: MockFunction;
}): React.ReactElement {
  const [settings, setSettings] = React.useState<Settings>(props.initial);

  return props.formCase.renderForm(settings, (next: Settings) => {
    setSettings(next);
    props.onChange(next);
  });
}

function stepOf(formCase: FormCase, settings: Settings): MonitorStep {
  const step: MonitorStep = new MonitorStep();
  step.data = {
    id: "step-1",
    monitorCriteria: { data: undefined },
    [MonitorStepMetricQueries.getStepKey(formCase.monitorType)!]: settings,
  } as unknown as MonitorStep["data"];
  return step;
}

function view(): ViewProps {
  expect(lastView).not.toBeNull();
  return lastView!;
}

function chartedAttributes(): unknown {
  return view().chartQueryConfigs?.[0]?.metricQueryData.filterData.attributes;
}

function lastSaved(onChange: MockFunction): Settings {
  const calls: Array<Array<unknown>> = onChange.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]![0] as Settings;
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

async function openQueryBuilder(): Promise<void> {
  const tab: HTMLElement | null = screen.queryByRole("tab", {
    name: "Advanced",
  });
  if (tab) {
    fireEvent.click(tab);
  }
  await settle();
}

beforeEach(() => {
  lastView = null;
  getListMock.mockReset();
  getListMock.mockImplementation(() => {
    return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
  });
});

afterEach(() => {
  cleanup();
});

describe.each(FORM_CASES)(
  "$name monitor form: the chart under Select Metrics",
  (formCase: FormCase) => {
    test("charts the queries as the monitor reads them: its own filters and the resource it watches", async () => {
      render(formCase.renderForm(formCase.settings, (): void => {}));
      await openQueryBuilder();

      expect(chartedAttributes()).toEqual(formCase.charted);

      // Exactly what the monitor reads (MonitorStepMetricQueries, held to the worker).
      expect(view().chartQueryConfigs).toEqual(
        MonitorStepMetricQueries.getReads({
          monitorType: formCase.monitorType,
          monitorStep: stepOf(formCase, formCase.settings),
        })!.queryConfigs,
      );
    });

    test("its query editor edits the queries as the step saves them", async () => {
      render(formCase.renderForm(formCase.settings, (): void => {}));
      await openQueryBuilder();

      expect(view().data.queryConfigs).toEqual([QUERY]);
      expect(
        view().data.queryConfigs[0]!.metricQueryData.filterData.attributes,
      ).toEqual(OWN_FILTER);
    });

    test("an edit is saved as written: no scope in the saved queries", async () => {
      const onChange: MockFunction = getJestMockFunction();

      render(
        <StatefulForm
          formCase={formCase}
          initial={formCase.settings}
          onChange={onChange}
        />,
      );
      await openQueryBuilder();

      const edited: MetricQueryConfigData = {
        ...view().data.queryConfigs[0]!,
        metricQueryData: {
          ...view().data.queryConfigs[0]!.metricQueryData,
          filterData: {
            ...view().data.queryConfigs[0]!.metricQueryData.filterData,
            aggegationType: MetricsAggregationType.Max,
          },
        },
      };

      act(() => {
        view().onChange({ ...view().data, queryConfigs: [edited] });
      });

      const saved: Settings = lastSaved(onChange);
      expect(saved.metricViewConfig?.queryConfigs).toEqual([edited]);
      expect(
        saved.metricViewConfig?.queryConfigs[0]?.metricQueryData.filterData
          .attributes,
      ).toEqual(OWN_FILTER);

      // And the chart reads the edited query, narrowed again.
      expect(
        view().chartQueryConfigs?.[0]?.metricQueryData.filterData
          .aggegationType,
      ).toBe(MetricsAggregationType.Max);
      expect(chartedAttributes()).toEqual(formCase.charted);
    });

    test("follows the resource when another is picked", async () => {
      const result: RenderResult = render(
        formCase.renderForm(formCase.settings, (): void => {}),
      );
      await openQueryBuilder();

      result.rerender(
        formCase.renderForm(
          formCase.elsewhere(formCase.settings),
          (): void => {},
        ),
      );
      await settle();

      expect(
        (chartedAttributes() as Dictionary<unknown>)[formCase.resourceKey],
      ).toEqual(formCase.resourceElsewhere);
      // The editor's queries did not change with it.
      expect(view().data.queryConfigs).toEqual([QUERY]);
    });
  },
);

describe("the chart follows the resource filters as they are typed", () => {
  test("Proxmox: a node name narrows the chart to that node's own series", async () => {
    const onChange: MockFunction = getJestMockFunction();
    const proxmox: FormCase = FORM_CASES.find((formCase: FormCase) => {
      return formCase.monitorType === MonitorType.Proxmox;
    })!;

    render(
      <StatefulForm
        formCase={proxmox}
        initial={{
          ...proxmox.settings,
          resourceFilters: {},
        } as unknown as Settings}
        onChange={onChange}
      />,
    );
    await openQueryBuilder();

    expect(chartedAttributes()).toEqual({
      ...OWN_FILTER,
      "resource.proxmox.cluster.name": "pve-prod",
    });

    fireEvent.change(screen.getByPlaceholderText("e.g. pve1"), {
      target: { value: "pve2" },
    });
    await settle();

    expect(chartedAttributes()).toEqual({
      ...OWN_FILTER,
      "resource.proxmox.cluster.name": "pve-prod",
      "pve.scope": "node",
      "pve.id": "pve2",
    });

    // Saved as a filter of the step, not of its query.
    const saved: MonitorStepProxmoxMonitor = lastSaved(
      onChange,
    ) as unknown as MonitorStepProxmoxMonitor;
    expect(saved.resourceFilters.nodeName).toBe("pve2");
    expect(saved.metricViewConfig.queryConfigs).toEqual([QUERY]);
  });

  test("Kubernetes: a namespace narrows the chart to it", async () => {
    const onChange: MockFunction = getJestMockFunction();
    const kubernetes: FormCase = FORM_CASES.find((formCase: FormCase) => {
      return formCase.monitorType === MonitorType.Kubernetes;
    })!;

    render(
      <StatefulForm
        formCase={kubernetes}
        initial={{
          ...kubernetes.settings,
          resourceScope: KubernetesResourceScope.Namespace,
          resourceFilters: {},
        } as unknown as Settings}
        onChange={onChange}
      />,
    );
    await openQueryBuilder();

    expect(chartedAttributes()).toEqual({
      ...OWN_FILTER,
      "resource.k8s.cluster.name": "prod",
    });

    fireEvent.change(screen.getByPlaceholderText("e.g. default, production"), {
      target: { value: "checkout" },
    });
    await settle();

    expect(chartedAttributes()).toEqual({
      ...OWN_FILTER,
      "resource.k8s.cluster.name": "prod",
      "resource.k8s.namespace.name": "checkout",
    });

    const saved: MonitorStepKubernetesMonitor = lastSaved(
      onChange,
    ) as unknown as MonitorStepKubernetesMonitor;
    expect(saved.resourceFilters.namespace).toBe("checkout");
    expect(saved.metricViewConfig.queryConfigs).toEqual([QUERY]);
  });

  test("Host: a host picked from the list narrows the chart to it, as ingest stores its name", async () => {
    const onChange: MockFunction = getJestMockFunction();
    const host: FormCase = FORM_CASES.find((formCase: FormCase) => {
      return formCase.monitorType === MonitorType.Host;
    })!;

    getListMock.mockImplementation(() => {
      return Promise.resolve({
        data: [
          { hostIdentifier: "Web-01", name: "Web 01" },
          { hostIdentifier: "DB-01", name: "Database 01" },
        ],
        count: 2,
        skip: 0,
        limit: 2,
      });
    });

    render(
      <StatefulForm formCase={host} initial={host.settings} onChange={onChange} />,
    );
    await settle();
    await openQueryBuilder();

    expect(chartedAttributes()).toEqual({
      ...OWN_FILTER,
      "resource.host.name": "web-01",
    });

    // The Host field is the setup's first list.
    const list: HTMLElement = screen.getAllByRole("combobox")[0]!;
    fireEvent.keyDown(list, { key: "ArrowDown" });
    const option: HTMLElement | undefined = (
      await screen.findAllByTestId("dropdown-option-label")
    ).find((element: HTMLElement) => {
      return element.textContent === "Database 01";
    });
    expect(option).toBeDefined();
    fireEvent.click(option!);
    await settle();

    expect(lastSaved(onChange)["hostIdentifier"]).toBe("DB-01");
    expect(chartedAttributes()).toEqual({
      ...OWN_FILTER,
      "resource.host.name": "db-01",
    });
    expect(lastSaved(onChange).metricViewConfig?.queryConfigs).toEqual([
      QUERY,
    ]);
  });
});
