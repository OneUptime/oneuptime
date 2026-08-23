import { describe, expect, test } from "@jest/globals";
import DashboardComponentType from "../../../../Types/Dashboard/DashboardComponentType";
import DashboardBaseComponent from "../../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import ObjectID from "../../../../Types/ObjectID";
import { ObjectType } from "../../../../Types/JSON";
import DashboardAlertListComponentUtil from "../../../../Utils/Dashboard/Components/DashboardAlertListComponent";
import DashboardCephOsdListComponentUtil from "../../../../Utils/Dashboard/Components/DashboardCephOsdListComponent";
import DashboardCephPoolListComponentUtil from "../../../../Utils/Dashboard/Components/DashboardCephPoolListComponent";
import DashboardChartComponentUtil from "../../../../Utils/Dashboard/Components/DashboardChartComponent";
import DashboardClockComponentUtil from "../../../../Utils/Dashboard/Components/DashboardClockComponent";
import DashboardDataSourceChartComponentUtil from "../../../../Utils/Dashboard/Components/DashboardDataSourceChartComponent";
import DashboardDataSourceGaugeComponentUtil from "../../../../Utils/Dashboard/Components/DashboardDataSourceGaugeComponent";
import DashboardDataSourceTableComponentUtil from "../../../../Utils/Dashboard/Components/DashboardDataSourceTableComponent";
import DashboardDataSourceValueComponentUtil from "../../../../Utils/Dashboard/Components/DashboardDataSourceValueComponent";
import DashboardDockerContainerListComponentUtil from "../../../../Utils/Dashboard/Components/DashboardDockerContainerListComponent";
import DashboardDockerHostListComponentUtil from "../../../../Utils/Dashboard/Components/DashboardDockerHostListComponent";
import DashboardDockerImageListComponentUtil from "../../../../Utils/Dashboard/Components/DashboardDockerImageListComponent";
import DashboardDockerNetworkListComponentUtil from "../../../../Utils/Dashboard/Components/DashboardDockerNetworkListComponent";
import DashboardDockerSwarmNodeListComponentUtil from "../../../../Utils/Dashboard/Components/DashboardDockerSwarmNodeListComponent";
import DashboardDockerSwarmServiceListComponentUtil from "../../../../Utils/Dashboard/Components/DashboardDockerSwarmServiceListComponent";
import DashboardDockerVolumeListComponentUtil from "../../../../Utils/Dashboard/Components/DashboardDockerVolumeListComponent";
import DashboardGaugeComponentUtil from "../../../../Utils/Dashboard/Components/DashboardGaugeComponent";
import DashboardHostListComponentUtil from "../../../../Utils/Dashboard/Components/DashboardHostListComponent";
import DashboardHtmlComponentUtil from "../../../../Utils/Dashboard/Components/DashboardHtmlComponent";
import DashboardIncidentListComponentUtil from "../../../../Utils/Dashboard/Components/DashboardIncidentListComponent";
import DashboardKubernetesCronJobListComponentUtil from "../../../../Utils/Dashboard/Components/DashboardKubernetesCronJobListComponent";
import DashboardKubernetesDaemonSetListComponentUtil from "../../../../Utils/Dashboard/Components/DashboardKubernetesDaemonSetListComponent";
import DashboardKubernetesDeploymentListComponentUtil from "../../../../Utils/Dashboard/Components/DashboardKubernetesDeploymentListComponent";
import DashboardKubernetesJobListComponentUtil from "../../../../Utils/Dashboard/Components/DashboardKubernetesJobListComponent";
import DashboardKubernetesNamespaceListComponentUtil from "../../../../Utils/Dashboard/Components/DashboardKubernetesNamespaceListComponent";
import DashboardKubernetesNodeListComponentUtil from "../../../../Utils/Dashboard/Components/DashboardKubernetesNodeListComponent";
import DashboardKubernetesPodListComponentUtil from "../../../../Utils/Dashboard/Components/DashboardKubernetesPodListComponent";
import DashboardKubernetesStatefulSetListComponentUtil from "../../../../Utils/Dashboard/Components/DashboardKubernetesStatefulSetListComponent";
import DashboardLogChartComponentUtil from "../../../../Utils/Dashboard/Components/DashboardLogChartComponent";
import DashboardLogStreamComponentUtil from "../../../../Utils/Dashboard/Components/DashboardLogStreamComponent";
import DashboardMonitorListComponentUtil from "../../../../Utils/Dashboard/Components/DashboardMonitorListComponent";
import DashboardNetworkMapComponentUtil from "../../../../Utils/Dashboard/Components/DashboardNetworkMapComponent";
import DashboardPodmanContainerListComponentUtil from "../../../../Utils/Dashboard/Components/DashboardPodmanContainerListComponent";
import DashboardPodmanHostListComponentUtil from "../../../../Utils/Dashboard/Components/DashboardPodmanHostListComponent";
import DashboardPodmanImageListComponentUtil from "../../../../Utils/Dashboard/Components/DashboardPodmanImageListComponent";
import DashboardPodmanNetworkListComponentUtil from "../../../../Utils/Dashboard/Components/DashboardPodmanNetworkListComponent";
import DashboardPodmanVolumeListComponentUtil from "../../../../Utils/Dashboard/Components/DashboardPodmanVolumeListComponent";
import DashboardProxmoxGuestListComponentUtil from "../../../../Utils/Dashboard/Components/DashboardProxmoxGuestListComponent";
import DashboardProxmoxNodeListComponentUtil from "../../../../Utils/Dashboard/Components/DashboardProxmoxNodeListComponent";
import DashboardSecurityEventsFlowComponentUtil from "../../../../Utils/Dashboard/Components/DashboardSecurityEventsFlowComponent";
import DashboardSecurityEventsListComponentUtil from "../../../../Utils/Dashboard/Components/DashboardSecurityEventsListComponent";
import DashboardSloComponentUtil from "../../../../Utils/Dashboard/Components/DashboardSloComponent";
import DashboardTableComponentUtil from "../../../../Utils/Dashboard/Components/DashboardTableComponent";
import DashboardTextComponentUtil from "../../../../Utils/Dashboard/Components/DashboardTextComponent";
import DashboardTraceChartComponentUtil from "../../../../Utils/Dashboard/Components/DashboardTraceChartComponent";
import DashboardTraceListComponentUtil from "../../../../Utils/Dashboard/Components/DashboardTraceListComponent";
import DashboardTraceTableComponentUtil from "../../../../Utils/Dashboard/Components/DashboardTraceTableComponent";
import DashboardValueComponentUtil from "../../../../Utils/Dashboard/Components/DashboardValueComponent";
import DashboardBaseComponentUtil from "../../../../Utils/Dashboard/Components/DashboardBaseComponent";

/*
 * Every dashboard widget type ships a getDefaultComponent() that returns the
 * seed component the editor drops onto the canvas when a user first adds that
 * widget. Unlike getComponentSettingsArguments (dispatched through Index.ts and
 * already covered by DashboardComponentsUtil.test.ts), these defaults have no
 * central dispatcher — each util overrides the method independently. That makes
 * them easy to get subtly wrong in ways the compiler cannot catch:
 *
 *   - copy-pasting a util and forgetting to change the componentType field, so
 *     two widget types seed the same type and the editor renders the wrong one;
 *   - a min dimension larger than the default dimension, so the widget is born
 *     smaller than its own minimum and the resize logic clamps it on drop;
 *   - a zero/negative width or height, so the widget is invisible on the grid;
 *   - a shared componentId constant instead of a freshly generated ObjectID, so
 *     two widgets on the same dashboard collide on id.
 *
 * This suite pins those invariants for all widget types at once. The TYPE_TO_UTIL
 * map below must stay in lockstep with the enum; the exhaustiveness test fails
 * loudly if a new widget type is added without a default to guard here.
 */

type ComponentUtil = {
  getDefaultComponent: () => DashboardBaseComponent;
};

const TYPE_TO_UTIL: Record<DashboardComponentType, ComponentUtil> = {
  [DashboardComponentType.Chart]: DashboardChartComponentUtil,
  [DashboardComponentType.Text]: DashboardTextComponentUtil,
  [DashboardComponentType.Clock]: DashboardClockComponentUtil,
  [DashboardComponentType.Value]: DashboardValueComponentUtil,
  [DashboardComponentType.Table]: DashboardTableComponentUtil,
  [DashboardComponentType.Gauge]: DashboardGaugeComponentUtil,
  [DashboardComponentType.DataSourceChart]:
    DashboardDataSourceChartComponentUtil,
  [DashboardComponentType.DataSourceValue]:
    DashboardDataSourceValueComponentUtil,
  [DashboardComponentType.DataSourceGauge]:
    DashboardDataSourceGaugeComponentUtil,
  [DashboardComponentType.DataSourceTable]:
    DashboardDataSourceTableComponentUtil,
  [DashboardComponentType.LogStream]: DashboardLogStreamComponentUtil,
  [DashboardComponentType.LogChart]: DashboardLogChartComponentUtil,
  [DashboardComponentType.SecurityEventsList]:
    DashboardSecurityEventsListComponentUtil,
  [DashboardComponentType.SecurityEventsFlow]:
    DashboardSecurityEventsFlowComponentUtil,
  [DashboardComponentType.TraceList]: DashboardTraceListComponentUtil,
  [DashboardComponentType.TraceChart]: DashboardTraceChartComponentUtil,
  [DashboardComponentType.TraceTable]: DashboardTraceTableComponentUtil,
  [DashboardComponentType.IncidentList]: DashboardIncidentListComponentUtil,
  [DashboardComponentType.AlertList]: DashboardAlertListComponentUtil,
  [DashboardComponentType.MonitorList]: DashboardMonitorListComponentUtil,
  [DashboardComponentType.Slo]: DashboardSloComponentUtil,
  [DashboardComponentType.KubernetesPodList]:
    DashboardKubernetesPodListComponentUtil,
  [DashboardComponentType.KubernetesNodeList]:
    DashboardKubernetesNodeListComponentUtil,
  [DashboardComponentType.KubernetesNamespaceList]:
    DashboardKubernetesNamespaceListComponentUtil,
  [DashboardComponentType.KubernetesDeploymentList]:
    DashboardKubernetesDeploymentListComponentUtil,
  [DashboardComponentType.KubernetesStatefulSetList]:
    DashboardKubernetesStatefulSetListComponentUtil,
  [DashboardComponentType.KubernetesDaemonSetList]:
    DashboardKubernetesDaemonSetListComponentUtil,
  [DashboardComponentType.KubernetesJobList]:
    DashboardKubernetesJobListComponentUtil,
  [DashboardComponentType.KubernetesCronJobList]:
    DashboardKubernetesCronJobListComponentUtil,
  [DashboardComponentType.DockerHostList]: DashboardDockerHostListComponentUtil,
  [DashboardComponentType.DockerContainerList]:
    DashboardDockerContainerListComponentUtil,
  [DashboardComponentType.DockerImageList]:
    DashboardDockerImageListComponentUtil,
  [DashboardComponentType.DockerNetworkList]:
    DashboardDockerNetworkListComponentUtil,
  [DashboardComponentType.DockerVolumeList]:
    DashboardDockerVolumeListComponentUtil,
  [DashboardComponentType.PodmanHostList]: DashboardPodmanHostListComponentUtil,
  [DashboardComponentType.PodmanContainerList]:
    DashboardPodmanContainerListComponentUtil,
  [DashboardComponentType.PodmanImageList]:
    DashboardPodmanImageListComponentUtil,
  [DashboardComponentType.PodmanNetworkList]:
    DashboardPodmanNetworkListComponentUtil,
  [DashboardComponentType.PodmanVolumeList]:
    DashboardPodmanVolumeListComponentUtil,
  [DashboardComponentType.HostList]: DashboardHostListComponentUtil,
  [DashboardComponentType.ProxmoxNodeList]:
    DashboardProxmoxNodeListComponentUtil,
  [DashboardComponentType.ProxmoxGuestList]:
    DashboardProxmoxGuestListComponentUtil,
  [DashboardComponentType.DockerSwarmNodeList]:
    DashboardDockerSwarmNodeListComponentUtil,
  [DashboardComponentType.DockerSwarmServiceList]:
    DashboardDockerSwarmServiceListComponentUtil,
  [DashboardComponentType.CephOsdList]: DashboardCephOsdListComponentUtil,
  [DashboardComponentType.CephPoolList]: DashboardCephPoolListComponentUtil,
  [DashboardComponentType.NetworkMap]: DashboardNetworkMapComponentUtil,
  [DashboardComponentType.Html]: DashboardHtmlComponentUtil,
};

const ALL_TYPES: Array<DashboardComponentType> = Object.values(
  DashboardComponentType,
);

describe("Dashboard component getDefaultComponent()", () => {
  test("every DashboardComponentType has a default component guarded here", () => {
    // If a new widget type is added to the enum, this fails until it is mapped.
    for (const type of ALL_TYPES) {
      expect(TYPE_TO_UTIL[type]).toBeDefined();
    }
    // And nothing stale: the map must not carry keys the enum dropped.
    expect(Object.keys(TYPE_TO_UTIL).sort()).toEqual([...ALL_TYPES].sort());
  });

  test.each(ALL_TYPES)(
    "%s default is a well-formed dashboard component",
    (type: DashboardComponentType) => {
      const component: DashboardBaseComponent =
        TYPE_TO_UTIL[type].getDefaultComponent();

      // It must be tagged as a dashboard component so serialization routes it right.
      expect(component._type).toBe(ObjectType.DashboardComponent);

      /*
       * The seeded componentType must match the type the editor asked for; a
       * copy-paste that leaves the wrong type here makes the widget render as a
       * different kind than the one the user picked.
       */
      expect(component.componentType).toBe(type);

      // A zero/negative footprint means the widget is invisible on the grid.
      expect(component.widthInDashboardUnits).toBeGreaterThan(0);
      expect(component.heightInDashboardUnits).toBeGreaterThan(0);
      expect(component.minWidthInDashboardUnits).toBeGreaterThan(0);
      expect(component.minHeightInDashboardUnits).toBeGreaterThan(0);

      /*
       * The default size must not start below its own minimum, or the resize
       * clamp shrinks the widget the instant it is dropped.
       */
      expect(component.widthInDashboardUnits).toBeGreaterThanOrEqual(
        component.minWidthInDashboardUnits,
      );
      expect(component.heightInDashboardUnits).toBeGreaterThanOrEqual(
        component.minHeightInDashboardUnits,
      );

      // A widget is dropped at the origin; negative offsets place it off-grid.
      expect(component.topInDashboardUnits).toBeGreaterThanOrEqual(0);
      expect(component.leftInDashboardUnits).toBeGreaterThanOrEqual(0);

      // The id must be a real, generated ObjectID (UUID), not a placeholder.
      expect(component.componentId).toBeInstanceOf(ObjectID);
      expect(ObjectID.isValidUUID(component.componentId.toString())).toBe(true);
    },
  );

  test("no two widget types seed the same componentType", () => {
    /*
     * Guards the classic copy-paste bug: duplicating a util and forgetting to
     * change componentType. Every default must report a distinct type.
     */
    const seededTypes: Array<DashboardComponentType> = ALL_TYPES.map(
      (type: DashboardComponentType) => {
        return TYPE_TO_UTIL[type].getDefaultComponent().componentType;
      },
    );
    expect(new Set<DashboardComponentType>(seededTypes).size).toBe(
      seededTypes.length,
    );
  });

  test("each call generates a fresh componentId so widgets never collide", () => {
    /*
     * Two of the same widget added to one dashboard must not share an id, or
     * selection/deletion in the editor would act on both at once. This only
     * holds if getDefaultComponent() calls ObjectID.generate() per call rather
     * than reusing a module-level constant.
     */
    for (const type of ALL_TYPES) {
      const first: DashboardBaseComponent =
        TYPE_TO_UTIL[type].getDefaultComponent();
      const second: DashboardBaseComponent =
        TYPE_TO_UTIL[type].getDefaultComponent();
      expect(first.componentId.toString()).not.toBe(
        second.componentId.toString(),
      );
    }
  });

  test("the base component util refuses to seed a component", () => {
    /*
     * The base class intentionally throws so a util that forgets to override
     * getDefaultComponent() fails fast instead of returning a typeless stub.
     */
    expect(() => {
      return DashboardBaseComponentUtil.getDefaultComponent();
    }).toThrow();
  });
});
