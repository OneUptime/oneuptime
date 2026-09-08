import "@testing-library/jest-dom";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import VmwareMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/VmwareMonitor/VmwareMonitorStepForm";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import ObjectID from "../../../Types/ObjectID";
import VMwareSource from "../../../Models/DatabaseModels/VMwareSource";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MonitorStepVmwareMonitor, {
  MonitorStepVmwareMonitorUtil,
  VmwareResourceType,
  VMWARE_RESOURCE_ATTRIBUTE,
} from "../../../Types/Monitor/MonitorStepVmwareMonitor";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  getVmwareAlertTemplates,
  VmwareAlertTemplate,
  VmwareAlertTemplateArgs,
} from "../../../Types/Monitor/VmwareAlertTemplates";

jest.mock("Common/Models/DatabaseModels/VMwareSource", () => {
  return {
    __esModule: true,
    default: class VMwareSource {},
  };
});
jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: { getList: jest.fn() },
  };
});
jest.mock("Common/UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: { getQueryStringByName: jest.fn() },
  };
});
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricView",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return <div>Advanced metric editor</div>;
      },
    };
  },
);

const templateDefaults: Omit<
  VmwareAlertTemplateArgs,
  "sourceIdentifier" | "monitorName"
> = {
  onlineMonitorStatusId: new ObjectID("12345678-1234-1234-1234-123456789abc"),
  offlineMonitorStatusId: new ObjectID("22345678-1234-1234-1234-123456789abc"),
  defaultIncidentSeverityId: new ObjectID(
    "32345678-1234-1234-1234-123456789abc",
  ),
  defaultAlertSeverityId: new ObjectID("42345678-1234-1234-1234-123456789abc"),
};

describe("VMware monitor setup", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(ModelAPI.getList).mockResolvedValue({
      data: [
        Object.assign(new VMwareSource(), {
          _id: "source-db-id",
          name: "Production",
          sourceIdentifier: "prod",
        }),
      ],
      count: 1,
      skip: 0,
      limit: 100,
    } as never);
    jest.mocked(Navigation.getQueryStringByName).mockReturnValue(null);
  });
  test("a source/resource link preselects stable identities, rather than display names", async () => {
    jest
      .mocked(Navigation.getQueryStringByName)
      .mockImplementation((key: string) => {
        return (
          (
            {
              vmwareSource: "prod",
              vmwareResource: "vm-42",
              vmwareResourceType: "vm",
            } as Record<string, string>
          )[key] || null
        );
      });
    const onChange: MockFunction = getJestMockFunction();
    render(
      <VmwareMonitorStepForm
        {...templateDefaults}
        monitorStepVmwareMonitor={MonitorStepVmwareMonitorUtil.getDefault()}
        onChange={onChange}
      />,
    );
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceIdentifier: "prod",
          resourceFilters: { resourceIdentifier: "vm-42", resourceType: "vm" },
        }),
      );
    });
  });
  test("templates remain disabled until a source is selected", async () => {
    render(
      <VmwareMonitorStepForm
        {...templateDefaults}
        monitorStepVmwareMonitor={MonitorStepVmwareMonitorUtil.getDefault()}
        onChange={jest.fn()}
      />,
    );
    await screen.findByRole("option", { name: "Production (prod)" });
    const buttons: Array<HTMLElement> = screen
      .getAllByRole("button")
      .filter((button: HTMLElement) => {
        return button.hasAttribute("aria-pressed");
      });
    expect(buttons).toHaveLength(getVmwareAlertTemplates().length);
    for (const button of buttons) {
      expect(button).toBeDisabled();
    }
  });
  test("a VM template keeps a selected VM and emits alert criteria", async () => {
    const onChange: MockFunction = getJestMockFunction();
    const onCriteria: MockFunction = getJestMockFunction();
    const template: VmwareAlertTemplate = getVmwareAlertTemplates().find(
      (item: VmwareAlertTemplate) => {
        return item.category === "VM";
      },
    )!;
    const config: MonitorStepVmwareMonitor = {
      ...MonitorStepVmwareMonitorUtil.getDefault(),
      sourceIdentifier: "prod",
      resourceFilters: {
        resourceType: VmwareResourceType.VM,
        resourceIdentifier: "vm-42",
      },
    };
    render(
      <VmwareMonitorStepForm
        {...templateDefaults}
        monitorStepVmwareMonitor={config}
        onChange={onChange}
        onMonitorCriteriaChange={onCriteria}
      />,
    );
    await waitFor(() => {
      expect(screen.getByLabelText("VMware source")).not.toBeDisabled();
    });
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(template.name) }),
    );
    const changed: MonitorStepVmwareMonitor = onChange.mock.calls[0]![0];
    expect(changed.resourceFilters).toEqual({
      resourceType: VmwareResourceType.VM,
      resourceIdentifier: "vm-42",
    });
    expect(
      changed.metricViewConfig.queryConfigs[0]?.metricQueryData.filterData
        .attributes,
    ).toEqual(
      expect.objectContaining({ [VMWARE_RESOURCE_ATTRIBUTE]: "vm-42" }),
    );
    expect(changed.metricViewConfig.queryConfigs).toHaveLength(2);
    expect(
      changed.metricViewConfig.queryConfigs.map(
        (query: MetricQueryConfigData): string | undefined => {
          return query.metricAliasData?.metricVariable;
        },
      ),
    ).toEqual(["A", "B"]);
    expect(
      changed.metricViewConfig.queryConfigs[1]?.metricQueryData.filterData
        .attributes,
    ).toEqual(
      expect.objectContaining({ [VMWARE_RESOURCE_ATTRIBUTE]: "vm-42" }),
    );
    expect(
      changed.metricViewConfig.queryConfigs[0]?.metricQueryData.filterData
        .aggegationType,
    ).not.toEqual(
      changed.metricViewConfig.queryConfigs[1]?.metricQueryData.filterData
        .aggegationType,
    );
    expect(onCriteria).toHaveBeenCalledTimes(1);
  });
  test("collection templates discard resource scope even when entered from a VM", async () => {
    const onChange: MockFunction = getJestMockFunction();
    const template: VmwareAlertTemplate = getVmwareAlertTemplates().find(
      (item: VmwareAlertTemplate) => {
        return item.category === "Collection";
      },
    )!;
    render(
      <VmwareMonitorStepForm
        {...templateDefaults}
        monitorStepVmwareMonitor={{
          ...MonitorStepVmwareMonitorUtil.getDefault(),
          sourceIdentifier: "prod",
          resourceFilters: {
            resourceType: VmwareResourceType.VM,
            resourceIdentifier: "vm-42",
          },
        }}
        onChange={onChange}
      />,
    );
    await waitFor(() => {
      expect(screen.getByLabelText("VMware source")).not.toBeDisabled();
    });
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(template.name) }),
    );
    const changed: MonitorStepVmwareMonitor = onChange.mock.calls[0]![0];
    expect(MonitorStepVmwareMonitorUtil.isSourceMonitor(changed)).toBe(true);
    expect(changed.resourceFilters.resourceIdentifier).toBeUndefined();
  });
  test("changing source clears the previously scoped resource", async () => {
    const onChange: MockFunction = getJestMockFunction();
    render(
      <VmwareMonitorStepForm
        {...templateDefaults}
        monitorStepVmwareMonitor={{
          ...MonitorStepVmwareMonitorUtil.getDefault(),
          sourceIdentifier: "old-source",
          resourceFilters: {
            resourceType: VmwareResourceType.VM,
            resourceIdentifier: "vm-42",
          },
        }}
        onChange={onChange}
      />,
    );
    await screen.findByRole("option", { name: "Production (prod)" });
    fireEvent.change(screen.getByLabelText("VMware source"), {
      target: { value: "prod" },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceIdentifier: "prod",
        resourceFilters: { resourceType: VmwareResourceType.VM },
      }),
    );
  });
  test("an existing monitor configuration takes precedence over a resource link", async () => {
    jest
      .mocked(Navigation.getQueryStringByName)
      .mockReturnValue("other-source");
    const onChange: MockFunction = getJestMockFunction();
    render(
      <VmwareMonitorStepForm
        {...templateDefaults}
        monitorStepVmwareMonitor={{
          ...MonitorStepVmwareMonitorUtil.getDefault(),
          sourceIdentifier: "prod",
          resourceFilters: {
            resourceType: VmwareResourceType.VM,
            resourceIdentifier: "vm-42",
          },
        }}
        onChange={onChange}
      />,
    );
    await screen.findByRole("option", { name: "Production (prod)" });
    expect(screen.getByLabelText("VMware source")).toHaveValue("prod");
    expect(onChange).not.toHaveBeenCalled();
  });
  test("an invalid linked resource type does not become a monitor filter", async () => {
    jest
      .mocked(Navigation.getQueryStringByName)
      .mockImplementation((key: string) => {
        return key === "vmwareSource" ? "prod" : "invalid-resource-type";
      });
    const onChange: MockFunction = getJestMockFunction();
    render(
      <VmwareMonitorStepForm
        {...templateDefaults}
        monitorStepVmwareMonitor={MonitorStepVmwareMonitorUtil.getDefault()}
        onChange={onChange}
      />,
    );
    await screen.findByRole("option", { name: "Production (prod)" });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceIdentifier: "prod",
        resourceFilters: {
          resourceIdentifier: "invalid-resource-type",
          resourceType: undefined,
        },
      }),
    );
  });
  test("templates wait for project status and severity defaults", async () => {
    const onChange: MockFunction = getJestMockFunction();
    const onCriteria: MockFunction = getJestMockFunction();
    render(
      <VmwareMonitorStepForm
        monitorStepVmwareMonitor={{
          ...MonitorStepVmwareMonitorUtil.getDefault(),
          sourceIdentifier: "prod",
        }}
        onChange={onChange}
        onMonitorCriteriaChange={onCriteria}
      />,
    );
    await screen.findByRole("option", { name: "Production (prod)" });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Waiting for project status and severity settings",
    );
    const templates: Array<HTMLElement> = screen
      .getAllByRole("button")
      .filter((button: HTMLElement): boolean => {
        return button.hasAttribute("aria-pressed");
      });
    expect(templates).toHaveLength(getVmwareAlertTemplates().length);
    for (const template of templates) {
      expect(template).toBeDisabled();
      fireEvent.click(template);
    }
    expect(onChange).not.toHaveBeenCalled();
    expect(onCriteria).not.toHaveBeenCalled();
  });
  test("a host template clears an incompatible VM identity from every query", async () => {
    const onChange: MockFunction = getJestMockFunction();
    render(
      <VmwareMonitorStepForm
        {...templateDefaults}
        monitorStepVmwareMonitor={{
          ...MonitorStepVmwareMonitorUtil.getDefault(),
          sourceIdentifier: "prod",
          resourceFilters: {
            resourceType: VmwareResourceType.VM,
            resourceIdentifier: "vm-42",
          },
        }}
        onChange={onChange}
      />,
    );
    await screen.findByRole("option", { name: "Production (prod)" });
    fireEvent.click(
      screen.getByRole("button", { name: /ESXi host unavailable/ }),
    );
    const changed: MonitorStepVmwareMonitor = onChange.mock.calls[0]![0];
    expect(changed.resourceFilters.resourceType).toBe(VmwareResourceType.Host);
    expect(changed.resourceFilters.resourceIdentifier).toBeUndefined();
    expect(changed.metricViewConfig.queryConfigs.length).toBeGreaterThan(0);
    for (const query of changed.metricViewConfig.queryConfigs) {
      expect(query.metricQueryData.filterData.attributes).not.toEqual(
        expect.objectContaining({ [VMWARE_RESOURCE_ATTRIBUTE]: "vm-42" }),
      );
    }
  });
});
