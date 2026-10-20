/**
 * The sorts the dashboard templates ship their list widgets with (issue
 * #5082). A template is a wall screen's starting point, so a list whose
 * rows have a health ships worst first - the rows that need someone on top
 * - and every other widget keeps the order it always had. A template's
 * sorts are held to what each widget can be sorted by: a dashboard is
 * created from a template through the same write check every other
 * dashboard write goes through.
 */

import {
  DashboardTemplateType,
  getTemplateConfig,
} from "../../../Types/Dashboard/DashboardTemplates";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { JSONObject } from "../../../Types/JSON";
import { getDashboardViewConfigProblem } from "../../../Server/Services/DashboardService";
import {
  getDashboardWidgetSortSpec,
  readDashboardWidgetSavedSort,
} from "../../../Utils/Dashboard/DashboardWidgetSorts";
import { describe, expect, jest, test } from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

const TEMPLATE_TYPES: Array<DashboardTemplateType> = Object.values(
  DashboardTemplateType,
).filter((type: DashboardTemplateType) => {
  return type !== DashboardTemplateType.Blank;
});

function widgetsOf(
  type: DashboardTemplateType,
): Array<DashboardBaseComponent> {
  const config: DashboardViewConfig | null = getTemplateConfig(type);

  if (!config) {
    throw new Error(`No config for ${type}`);
  }

  return config.components;
}

function sortOf(widget: DashboardBaseComponent): unknown {
  return ((widget.arguments as JSONObject | undefined) || {})["sort"];
}

function widgetOfKind(
  type: DashboardTemplateType,
  componentType: DashboardComponentType,
): DashboardBaseComponent {
  const widget: DashboardBaseComponent | undefined = widgetsOf(type).find(
    (candidate: DashboardBaseComponent) => {
      return candidate.componentType === componentType;
    },
  );

  if (!widget) {
    throw new Error(`${type} has no ${componentType}`);
  }

  return widget;
}

describe("the templates' list sorts", () => {
  test.each(
    TEMPLATE_TYPES.map((type: DashboardTemplateType) => {
      return [type];
    }),
  )(
    "the %s template passes the write check every dashboard write goes through",
    (type: DashboardTemplateType) => {
      expect(getDashboardViewConfigProblem(getTemplateConfig(type))).toBeNull();
    },
  );

  test("every sort a template ships is one its widget can be sorted by", () => {
    let sorted: number = 0;

    for (const type of TEMPLATE_TYPES) {
      for (const widget of widgetsOf(type)) {
        const sort: unknown = sortOf(widget);

        if (sort === undefined) {
          continue;
        }

        sorted++;
        expect(getDashboardWidgetSortSpec(widget.componentType)).not.toBeNull();
        expect(
          readDashboardWidgetSavedSort(widget.componentType, widget.arguments),
        ).not.toBeNull();
      }
    }

    expect(sorted).toBe(7);
  });

  test.each([
    [
      DashboardTemplateType.Kubernetes,
      DashboardComponentType.KubernetesPodList,
      "phase:desc",
    ],
    [
      DashboardTemplateType.Kubernetes,
      DashboardComponentType.KubernetesNodeList,
      "status:desc",
    ],
    [
      DashboardTemplateType.Host,
      DashboardComponentType.HostList,
      "status:desc",
    ],
    [
      DashboardTemplateType.Proxmox,
      DashboardComponentType.ProxmoxNodeList,
      "status:desc",
    ],
    [
      DashboardTemplateType.DockerSwarm,
      DashboardComponentType.DockerSwarmNodeList,
      "status:desc",
    ],
    [
      DashboardTemplateType.DockerSwarm,
      DashboardComponentType.DockerSwarmServiceList,
      "status:desc",
    ],
    [
      DashboardTemplateType.Network,
      DashboardComponentType.MonitorList,
      "status:desc",
    ],
  ])(
    "the %s template's %s ships worst first (%s)",
    (
      type: DashboardTemplateType,
      componentType: DashboardComponentType,
      sort: string,
    ) => {
      expect(sortOf(widgetOfKind(type, componentType))).toBe(sort);
    },
  );

  test.each([
    // Walls of tiles keep each tile in its place: its colour is the news.
    [DashboardTemplateType.Ceph, DashboardComponentType.CephOsdList],
    [
      DashboardTemplateType.StorageArray,
      DashboardComponentType.StorageArrayHardwareList,
    ],
    // A stopped guest or a powered-off VM is often meant to be.
    [DashboardTemplateType.Proxmox, DashboardComponentType.ProxmoxGuestList],
    [
      DashboardTemplateType.VMware,
      DashboardComponentType.VMwareVirtualMachineList,
    ],
    // Already least error budget first.
    [DashboardTemplateType.Slo, DashboardComponentType.SloList],
  ])(
    "the %s template's %s keeps the order it always had",
    (type: DashboardTemplateType, componentType: DashboardComponentType) => {
      expect(sortOf(widgetOfKind(type, componentType))).toBeUndefined();
    },
  );

  test("a template's widgets come out new each time, each sort its own", () => {
    const first: DashboardBaseComponent = widgetOfKind(
      DashboardTemplateType.Host,
      DashboardComponentType.HostList,
    );
    const second: DashboardBaseComponent = widgetOfKind(
      DashboardTemplateType.Host,
      DashboardComponentType.HostList,
    );

    expect(first.componentId.toString()).not.toBe(
      second.componentId.toString(),
    );
    expect(first.arguments).not.toBe(second.arguments);
  });
});
