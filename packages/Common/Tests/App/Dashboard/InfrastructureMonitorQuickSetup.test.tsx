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
import { getAllHostAlertTemplates } from "../../../Types/Monitor/HostAlertTemplates";
import { getAllDockerAlertTemplates } from "../../../Types/Monitor/DockerAlertTemplates";
import { getAllPodmanAlertTemplates } from "../../../Types/Monitor/PodmanAlertTemplates";
import { getAllDockerSwarmAlertTemplates } from "../../../Types/Monitor/DockerSwarmAlertTemplates";
import { getAllKubernetesAlertTemplates } from "../../../Types/Monitor/KubernetesAlertTemplates";
import { getAllProxmoxAlertTemplates } from "../../../Types/Monitor/ProxmoxAlertTemplates";
import { getAllVMwareAlertTemplates } from "../../../Types/Monitor/VMwareAlertTemplates";
import { getAllCephAlertTemplates } from "../../../Types/Monitor/CephAlertTemplates";
import { getStorageArrayAlertTemplatesForSystem } from "../../../Types/Monitor/StorageArrayAlertTemplates";
import { getAllIoTAlertTemplates } from "../../../Types/Monitor/IotAlertTemplates";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Quick Setup on each infrastructure monitor's criteria step, through the
 * real step forms: the shared picker lists the type's templates, a pick
 * fills in the monitor's queries and replaces the criteria, and Template
 * Configuration then explains the picked template and keeps its Time Range
 * editable - in one shared panel instead of ten copies of a blue box.
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
  render: (onChange: MockFunction, onCriteria: MockFunction) => void;
}

const FORM_CASES: Array<FormCase> = [
  {
    name: "Host",
    templates: getAllHostAlertTemplates(),
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

describe("Quick Setup on an infrastructure monitor's criteria step", () => {
  test.each(FORM_CASES)(
    "$name opens on Quick Setup with every template and no panel yet",
    async (formCase: FormCase) => {
      formCase.render(getJestMockFunction(), getJestMockFunction());
      await settle();

      expect(
        screen.getByRole("tab", { name: "Quick Setup" }),
      ).toBeInTheDocument();
      expect(
        within(
          screen.getByRole("radiogroup", { name: "Alert templates" }),
        ).getAllByRole("radio"),
      ).toHaveLength(formCase.templates.length);
      expect(
        screen.queryByTestId("alert-template-configuration"),
      ).not.toBeInTheDocument();
    },
  );

  test.each(FORM_CASES)(
    "$name: a pick fills in the monitor and its criteria, then explains the template",
    async (formCase: FormCase) => {
      const onChange: MockFunction = getJestMockFunction();
      const onCriteria: MockFunction = getJestMockFunction();
      formCase.render(onChange, onCriteria);
      await settle();

      const template: Template = formCase.templates[0]!;

      fireEvent.click(screen.getByTestId(`alert-template-${template.id}`));
      await settle();

      // The template built the monitor's query config and its criteria.
      expect(onChange).toHaveBeenCalled();
      expect(onCriteria).toHaveBeenCalledTimes(1);

      const criteria: MonitorCriteria = onCriteria.mock
        .calls[0]![0] as MonitorCriteria;

      expect(
        criteria.data?.monitorCriteriaInstanceArray.length,
      ).toBeGreaterThan(0);

      // The row is the picked one, and the panel explains it in full.
      expect(
        screen.getByTestId(`alert-template-${template.id}`),
      ).toHaveAttribute("aria-checked", "true");

      const panel: HTMLElement = screen.getByTestId(
        "alert-template-configuration",
      );

      expect(
        within(panel).getByTestId("alert-template-description"),
      ).toHaveTextContent(template.description);
      expect(within(panel).getByText("Time Range")).toBeInTheDocument();
    },
  );

  test.each(FORM_CASES)(
    "$name: picking another template explains that one instead",
    async (formCase: FormCase) => {
      formCase.render(getJestMockFunction(), getJestMockFunction());
      await settle();

      const first: Template = formCase.templates[0]!;
      const second: Template = formCase.templates[1]!;

      fireEvent.click(screen.getByTestId(`alert-template-${first.id}`));
      await settle();
      fireEvent.click(screen.getByTestId(`alert-template-${second.id}`));
      await settle();

      expect(
        screen.getAllByTestId("alert-template-configuration"),
      ).toHaveLength(1);
      expect(
        screen.getByTestId("alert-template-description"),
      ).toHaveTextContent(second.description);
      expect(screen.getByTestId(`alert-template-${first.id}`)).toHaveAttribute(
        "aria-checked",
        "false",
      );
    },
  );
});

describe("Template Configuration's Time Range", () => {
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
