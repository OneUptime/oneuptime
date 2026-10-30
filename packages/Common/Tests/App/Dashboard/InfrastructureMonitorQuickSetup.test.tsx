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
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import MonitorCriteria from "../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import { MonitorStepHostMonitorUtil } from "../../../Types/Monitor/MonitorStepHostMonitor";
import { MonitorStepDockerMonitorUtil } from "../../../Types/Monitor/MonitorStepDockerMonitor";
import { MonitorStepPodmanMonitorUtil } from "../../../Types/Monitor/MonitorStepPodmanMonitor";
import { MonitorStepDockerSwarmMonitorUtil } from "../../../Types/Monitor/MonitorStepDockerSwarmMonitor";
import { MonitorStepKubernetesMonitorUtil } from "../../../Types/Monitor/MonitorStepKubernetesMonitor";
import { MonitorStepProxmoxMonitorUtil } from "../../../Types/Monitor/MonitorStepProxmoxMonitor";
import { MonitorStepVMwareMonitorUtil } from "../../../Types/Monitor/MonitorStepVMwareMonitor";
import { MonitorStepCephMonitorUtil } from "../../../Types/Monitor/MonitorStepCephMonitor";
import { MonitorStepStorageArrayMonitorUtil } from "../../../Types/Monitor/MonitorStepStorageArrayMonitor";
import { MonitorStepIoTMonitorUtil } from "../../../Types/Monitor/MonitorStepIoTMonitor";
import {
  getAllHostAlertTemplates,
  getHostDefaultAlertTemplateId,
} from "../../../Types/Monitor/HostAlertTemplates";
import {
  getAllDockerAlertTemplates,
  getDockerDefaultAlertTemplateId,
} from "../../../Types/Monitor/DockerAlertTemplates";
import {
  getAllPodmanAlertTemplates,
  getPodmanDefaultAlertTemplateId,
} from "../../../Types/Monitor/PodmanAlertTemplates";
import {
  getAllDockerSwarmAlertTemplates,
  getDockerSwarmDefaultAlertTemplateId,
} from "../../../Types/Monitor/DockerSwarmAlertTemplates";
import {
  getAllKubernetesAlertTemplates,
  getKubernetesDefaultAlertTemplateId,
} from "../../../Types/Monitor/KubernetesAlertTemplates";
import {
  getAllProxmoxAlertTemplates,
  getProxmoxDefaultAlertTemplateId,
} from "../../../Types/Monitor/ProxmoxAlertTemplates";
import {
  getAllVMwareAlertTemplates,
  getVMwareDefaultAlertTemplateId,
} from "../../../Types/Monitor/VMwareAlertTemplates";
import {
  getAllCephAlertTemplates,
  getCephDefaultAlertTemplateId,
} from "../../../Types/Monitor/CephAlertTemplates";
import {
  getStorageArrayAlertTemplatesForSystem,
  getStorageArrayDefaultAlertTemplateId,
} from "../../../Types/Monitor/StorageArrayAlertTemplates";
import {
  getAllIoTAlertTemplates,
  getIoTDefaultAlertTemplateId,
} from "../../../Types/Monitor/IotAlertTemplates";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Quick Setup on each infrastructure monitor's criteria step, through the
 * real step forms: the shared picker lists the type's templates, a pick
 * fills in the monitor's queries and replaces the criteria, and the list
 * then folds into the picked template - its summary, its full description
 * behind Show more, and its Time Range right under it - instead of ten
 * copies of a blue box under every other row.
 *
 * A template and a Custom Metric pick each replace the monitor's query, so
 * each clears the other tab's pick: Quick Setup never claims a template the
 * monitor no longer uses, nor Custom Metric a metric.
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

// The query builder and its charts: not what this suite is about.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricView",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return React.createElement("div", { "data-testid": "metric-view" });
      },
    };
  },
);

import HostMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/HostMonitor/HostMonitorStepForm";
import DockerMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/DockerMonitor/DockerMonitorStepForm";
import PodmanMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/PodmanMonitor/PodmanMonitorStepForm";
import DockerSwarmMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/DockerSwarmMonitor/DockerSwarmMonitorStepForm";
import KubernetesMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/KubernetesMonitor/KubernetesMonitorStepForm";
import ProxmoxMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/ProxmoxMonitor/ProxmoxMonitorStepForm";
import VMwareMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/VMwareMonitor/VMwareMonitorStepForm";
import CephMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/CephMonitor/CephMonitorStepForm";
import StorageArrayMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/StorageArrayMonitor/StorageArrayMonitorStepForm";
import IoTMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/IoTMonitor/IoTMonitorStepForm";

interface Template {
  id: string;
  name: string;
  summary: string;
  description: string;
}

interface FormCase {
  name: string;
  templates: Array<Template>;
  // The template a new monitor of the type starts on.
  defaultTemplateId: string;
  render: (onChange: MockFunction, onCriteria: MockFunction) => void;
}

const FORM_CASES: Array<FormCase> = [
  {
    name: "Host",
    templates: getAllHostAlertTemplates(),
    defaultTemplateId: getHostDefaultAlertTemplateId(),
    render: (onChange: MockFunction, onCriteria: MockFunction): void => {
      render(
        <HostMonitorStepForm
          monitorStepHostMonitor={MonitorStepHostMonitorUtil.getDefault()}
          onChange={onChange}
          onMonitorCriteriaChange={onCriteria}
        />,
      );
    },
  },
  {
    name: "Docker",
    templates: getAllDockerAlertTemplates(),
    defaultTemplateId: getDockerDefaultAlertTemplateId(),
    render: (onChange: MockFunction, onCriteria: MockFunction): void => {
      render(
        <DockerMonitorStepForm
          monitorStepDockerMonitor={MonitorStepDockerMonitorUtil.getDefault()}
          onChange={onChange}
          onMonitorCriteriaChange={onCriteria}
        />,
      );
    },
  },
  {
    name: "Podman",
    templates: getAllPodmanAlertTemplates(),
    defaultTemplateId: getPodmanDefaultAlertTemplateId(),
    render: (onChange: MockFunction, onCriteria: MockFunction): void => {
      render(
        <PodmanMonitorStepForm
          monitorStepPodmanMonitor={MonitorStepPodmanMonitorUtil.getDefault()}
          onChange={onChange}
          onMonitorCriteriaChange={onCriteria}
        />,
      );
    },
  },
  {
    name: "Docker Swarm",
    templates: getAllDockerSwarmAlertTemplates(),
    defaultTemplateId: getDockerSwarmDefaultAlertTemplateId(),
    render: (onChange: MockFunction, onCriteria: MockFunction): void => {
      render(
        <DockerSwarmMonitorStepForm
          monitorStepDockerSwarmMonitor={MonitorStepDockerSwarmMonitorUtil.getDefault()}
          onChange={onChange}
          onMonitorCriteriaChange={onCriteria}
        />,
      );
    },
  },
  {
    name: "Kubernetes",
    templates: getAllKubernetesAlertTemplates(),
    defaultTemplateId: getKubernetesDefaultAlertTemplateId(),
    render: (onChange: MockFunction, onCriteria: MockFunction): void => {
      render(
        <KubernetesMonitorStepForm
          monitorStepKubernetesMonitor={MonitorStepKubernetesMonitorUtil.getDefault()}
          onChange={onChange}
          onMonitorCriteriaChange={onCriteria}
        />,
      );
    },
  },
  {
    name: "Proxmox",
    templates: getAllProxmoxAlertTemplates(),
    defaultTemplateId: getProxmoxDefaultAlertTemplateId(),
    render: (onChange: MockFunction, onCriteria: MockFunction): void => {
      render(
        <ProxmoxMonitorStepForm
          monitorStepProxmoxMonitor={MonitorStepProxmoxMonitorUtil.getDefault()}
          onChange={onChange}
          onMonitorCriteriaChange={onCriteria}
        />,
      );
    },
  },
  {
    name: "VMware",
    templates: getAllVMwareAlertTemplates(),
    defaultTemplateId: getVMwareDefaultAlertTemplateId(),
    render: (onChange: MockFunction, onCriteria: MockFunction): void => {
      render(
        <VMwareMonitorStepForm
          monitorStepVMwareMonitor={MonitorStepVMwareMonitorUtil.getDefault()}
          onChange={onChange}
          onMonitorCriteriaChange={onCriteria}
        />,
      );
    },
  },
  {
    name: "Ceph",
    templates: getAllCephAlertTemplates(),
    defaultTemplateId: getCephDefaultAlertTemplateId(),
    render: (onChange: MockFunction, onCriteria: MockFunction): void => {
      render(
        <CephMonitorStepForm
          monitorStepCephMonitor={MonitorStepCephMonitorUtil.getDefault()}
          onChange={onChange}
          onMonitorCriteriaChange={onCriteria}
        />,
      );
    },
  },
  {
    name: "Storage Array",
    templates: getStorageArrayAlertTemplatesForSystem(undefined),
    defaultTemplateId: getStorageArrayDefaultAlertTemplateId(undefined),
    render: (onChange: MockFunction, onCriteria: MockFunction): void => {
      render(
        <StorageArrayMonitorStepForm
          monitorStepStorageArrayMonitor={MonitorStepStorageArrayMonitorUtil.getDefault()}
          onChange={onChange}
          onMonitorCriteriaChange={onCriteria}
        />,
      );
    },
  },
  {
    name: "IoT",
    templates: getAllIoTAlertTemplates(),
    defaultTemplateId: getIoTDefaultAlertTemplateId(),
    render: (onChange: MockFunction, onCriteria: MockFunction): void => {
      render(
        <IoTMonitorStepForm
          monitorStepIoTMonitor={MonitorStepIoTMonitorUtil.getDefault()}
          onChange={onChange}
          onMonitorCriteriaChange={onCriteria}
        />,
      );
    },
  },
];

beforeEach(() => {
  getListMock.mockReset();
  getListMock.mockImplementation(() => {
    return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
  });
});

afterEach(() => {
  cleanup();
});

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

/*
 * More fields: Custom Metric and Advanced, folded under the alert
 * templates. Opened, the Custom Metric tab shows first.
 */
async function openMoreFields(): Promise<void> {
  const header: HTMLElement = within(
    screen.getByTestId("infrastructure-monitor-setup"),
  ).getByTestId("folded-section-header");

  if (header.getAttribute("aria-expanded") !== "true") {
    fireEvent.click(header);
    await settle();
  }
}

function moreFieldsIsOpen(): boolean {
  return (
    within(screen.getByTestId("infrastructure-monitor-setup"))
      .getByTestId("folded-section-header")
      .getAttribute("aria-expanded") === "true"
  );
}

// Change, so the picked template unfolds into the whole list again.
async function unfoldTemplates(): Promise<void> {
  if (screen.queryByTestId("alert-template-change")) {
    fireEvent.click(screen.getByTestId("alert-template-change"));
    await settle();
  }
}

function otherThanDefault(formCase: FormCase): Template {
  return formCase.templates.find((template: Template) => {
    return template.id !== formCase.defaultTemplateId;
  })!;
}

describe("an infrastructure monitor's setup starts on its default alert", () => {
  test.each(FORM_CASES)(
    "$name opens on its default alert, folded, with More fields closed",
    async (formCase: FormCase) => {
      const onChange: MockFunction = getJestMockFunction();
      const onCriteria: MockFunction = getJestMockFunction();
      formCase.render(onChange, onCriteria);
      await settle();

      // The default built the monitor's query and its criteria.
      expect(onChange).toHaveBeenCalled();
      expect(onCriteria).toHaveBeenCalledTimes(1);
      expect(
        (onCriteria.mock.calls[0]![0] as MonitorCriteria).data
          ?.monitorCriteriaInstanceArray.length,
      ).toBeGreaterThan(0);

      expect(screen.getByTestId("alert-template-picked")).toHaveAttribute(
        "data-alert-template-id",
        formCase.defaultTemplateId,
      );
      expect(
        screen.getByTestId("alert-template-configuration"),
      ).toBeInTheDocument();

      // The do-it-yourself ways wait, folded (mounted, out of sight).
      expect(moreFieldsIsOpen()).toBe(false);
      expect(
        within(screen.getByTestId("infrastructure-monitor-setup")).getByTestId(
          "folded-section-body",
        ).className,
      ).toContain("invisible");

      // Every template is one Change away.
      await unfoldTemplates();
      expect(
        within(
          screen.getByRole("radiogroup", { name: "Alert templates" }),
        ).getAllByRole("radio"),
      ).toHaveLength(formCase.templates.length);
    },
  );

  test.each(FORM_CASES)(
    "$name: another pick fills in the monitor and its criteria, then the list folds into it, its Time Range under it",
    async (formCase: FormCase) => {
      const onChange: MockFunction = getJestMockFunction();
      const onCriteria: MockFunction = getJestMockFunction();
      formCase.render(onChange, onCriteria);
      await settle();

      const template: Template = otherThanDefault(formCase);

      await unfoldTemplates();
      fireEvent.click(screen.getByTestId(`alert-template-${template.id}`));
      await settle();

      // The template built the monitor's query config and its criteria.
      expect(onCriteria).toHaveBeenCalledTimes(2);

      // The list is folded into the picked template.
      expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();

      const picked: HTMLElement = screen.getByTestId("alert-template-picked");

      expect(picked).toHaveAttribute("data-alert-template-id", template.id);
      expect(
        within(picked).getByTestId("alert-template-picked-name"),
      ).toHaveTextContent(template.name);
      expect(
        within(picked).getByTestId("alert-template-picked-summary"),
      ).toHaveTextContent(template.summary);

      // Its full description is one press away.
      fireEvent.click(
        within(picked).getByTestId("alert-template-description-toggle"),
      );
      expect(
        within(picked).getByTestId("alert-template-description"),
      ).toHaveTextContent(template.description);

      // And its Time Range is right under it.
      const timeRange: HTMLElement = screen.getByTestId(
        "alert-template-configuration",
      );

      expect(within(timeRange).getByText("Time Range")).toBeInTheDocument();
      expect(
        picked.compareDocumentPosition(timeRange) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    },
  );

  test.each(FORM_CASES)(
    "$name: Change, then the same template: the criteria are not rebuilt",
    async (formCase: FormCase) => {
      const onChange: MockFunction = getJestMockFunction();
      const onCriteria: MockFunction = getJestMockFunction();
      formCase.render(onChange, onCriteria);
      await settle();

      const changesAfterTheDefault: number = onChange.mock.calls.length;

      await unfoldTemplates();
      expect(
        screen.getByTestId(`alert-template-${formCase.defaultTemplateId}`),
      ).toHaveAttribute("aria-checked", "true");

      fireEvent.click(
        screen.getByTestId(`alert-template-${formCase.defaultTemplateId}`),
      );
      await settle();

      // Whatever was changed in the criteria since the pick is kept.
      expect(onCriteria).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledTimes(changesAfterTheDefault);
      expect(screen.getByTestId("alert-template-picked")).toHaveAttribute(
        "data-alert-template-id",
        formCase.defaultTemplateId,
      );
    },
  );
});

/*
 * The Custom Metric tab's metric picker, under More fields: the first
 * combobox of its panel.
 */
async function pickFirstCustomMetric(): Promise<void> {
  await openMoreFields();
  fireEvent.click(screen.getByRole("tab", { name: "Custom Metric" }));
  await settle();

  const metricPicker: HTMLElement = within(
    screen.getByRole("tabpanel"),
  ).getAllByRole("combobox")[0]!;

  fireEvent.keyDown(metricPicker, { key: "ArrowDown" });
  await settle();
  fireEvent.keyDown(metricPicker, { key: "Enter" });
  await settle();
}

describe("the Time Range reads the same in every way", () => {
  test.each(FORM_CASES)(
    "$name: Custom Metric's Time Range says what the template's does",
    async (formCase: FormCase) => {
      formCase.render(getJestMockFunction(), getJestMockFunction());
      await settle();

      expect(
        within(screen.getByTestId("alert-template-configuration")).getByText(
          "How far back each check looks.",
        ),
      ).toBeInTheDocument();

      await pickFirstCustomMetric();

      const panel: HTMLElement = screen.getByRole("tabpanel");

      expect(within(panel).getByText("Time Range")).toBeInTheDocument();
      expect(
        within(panel).getByText("How far back each check looks."),
      ).toBeInTheDocument();
    },
  );
});

function customMetricFieldsShown(): boolean {
  return (
    within(screen.getByRole("tabpanel")).queryByText("Aggregation") !== null
  );
}

describe("a template and a custom metric each replace the other's pick", () => {
  test.each(FORM_CASES)(
    "$name: a metric of your own unfolds the templates with none checked, and starts on the out-of-the-box criteria",
    async (formCase: FormCase) => {
      const onCriteria: MockFunction = getJestMockFunction();
      formCase.render(getJestMockFunction(), onCriteria);
      await settle();

      expect(screen.getByTestId("alert-template-picked")).toBeInTheDocument();

      await pickFirstCustomMetric();
      expect(customMetricFieldsShown()).toBe(true);

      expect(
        screen.queryByTestId("alert-template-picked"),
      ).not.toBeInTheDocument();

      const rows: Array<HTMLElement> = within(
        screen.getByRole("radiogroup", { name: "Alert templates" }),
      ).getAllByRole("radio");

      expect(rows).toHaveLength(formCase.templates.length);
      for (const row of rows) {
        expect(row).toHaveAttribute("aria-checked", "false");
      }

      /*
       * Regression: the template's criteria were kept, and judged the new
       * metric by the template's threshold under the template's incident.
       */
      const criteria: MonitorCriteria = onCriteria.mock.calls[
        onCriteria.mock.calls.length - 1
      ]![0] as MonitorCriteria;
      const names: Array<string> = (
        criteria.data?.monitorCriteriaInstanceArray || []
      ).map((instance: MonitorCriteriaInstance): string => {
        return instance.data?.name || "";
      });

      expect(names).toHaveLength(2);
      expect(names[0]).toMatch(/^Check if .* is offline$/);
      expect(names[1]).toMatch(/^Check if .* is online$/);
    },
  );

  test.each(FORM_CASES)(
    "$name: a template picked after a custom metric clears the Custom Metric pick",
    async (formCase: FormCase) => {
      formCase.render(getJestMockFunction(), getJestMockFunction());
      await settle();

      await pickFirstCustomMetric();
      expect(customMetricFieldsShown()).toBe(true);

      fireEvent.click(
        screen.getByTestId(`alert-template-${formCase.templates[0]!.id}`),
      );
      await settle();

      fireEvent.click(screen.getByRole("tab", { name: "Custom Metric" }));
      await settle();

      // No metric picked: no Aggregation or Time Range for one.
      expect(customMetricFieldsShown()).toBe(false);
    },
  );
});

describe("the picked template's Time Range", () => {
  test("a new Time Range is handed back with the rest of the monitor", async () => {
    const onChange: MockFunction = getJestMockFunction();
    render(
      <KubernetesMonitorStepForm
        monitorStepKubernetesMonitor={{
          ...MonitorStepKubernetesMonitorUtil.getDefault(),
          rollingTime: RollingTime.Past5Minutes,
        }}
        onChange={onChange}
        onMonitorCriteriaChange={getJestMockFunction()}
      />,
    );
    await settle();

    fireEvent.click(screen.getByTestId("alert-template-change"));
    await settle();
    fireEvent.click(screen.getByTestId("alert-template-k8s-high-cpu"));
    await settle();
    onChange.mockClear();

    const panel: HTMLElement = screen.getByTestId(
      "alert-template-configuration",
    );
    const timeRange: HTMLElement = within(panel).getByRole("combobox");

    fireEvent.keyDown(timeRange, { key: "ArrowDown" });
    fireEvent.click(await screen.findByText("Past 15 Minutes"));
    await settle();

    expect(onChange).toHaveBeenCalled();
    expect(
      (
        onChange.mock.calls[onChange.mock.calls.length - 1]![0] as {
          rollingTime: RollingTime;
        }
      ).rollingTime,
    ).toBe(RollingTime.Past15Minutes);
  });
});
