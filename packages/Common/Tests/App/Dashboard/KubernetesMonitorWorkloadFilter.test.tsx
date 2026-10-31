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
import MonitorStepKubernetesMonitor, {
  KUBERNETES_WORKLOAD_KINDS,
  KubernetesResourceScope,
  MonitorStepKubernetesMonitorUtil,
} from "../../../Types/Monitor/MonitorStepKubernetesMonitor";
import {
  KubernetesAlertTemplate,
  getAllKubernetesAlertTemplates,
  getKubernetesAlertTemplateById,
} from "../../../Types/Monitor/KubernetesAlertTemplates";
import ObjectID from "../../../Types/ObjectID";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A Kubernetes monitor scoped to one workload. The form asked only for the
 * Workload Name and never set its kind, and the worker applied the filter
 * only when both were set: a monitor scoped to "checkout" watched every
 * workload in the cluster. The form now asks for the kind beside the name,
 * starting on the kind the chosen template watches (else Deployment), and
 * the name always travels with a kind.
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

import KubernetesMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/KubernetesMonitor/KubernetesMonitorStepForm";

function openAdvanced(
  resourceFilters: MonitorStepKubernetesMonitor["resourceFilters"],
  onChange: (value: MonitorStepKubernetesMonitor) => void = (): void => {},
): void {
  render(
    <KubernetesMonitorStepForm
      monitorStepKubernetesMonitor={{
        ...MonitorStepKubernetesMonitorUtil.getDefault(),
        clusterIdentifier: "prod",
        resourceScope: KubernetesResourceScope.Workload,
        resourceFilters: resourceFilters,
      }}
      onChange={onChange}
    />,
  );

  fireEvent.click(screen.getByRole("tab", { name: "Advanced" }));
}

function lastChange(onChange: MockFunction): MonitorStepKubernetesMonitor {
  const calls: Array<Array<unknown>> = onChange.mock.calls;

  expect(calls.length).toBeGreaterThan(0);

  return calls[calls.length - 1]![0] as MonitorStepKubernetesMonitor;
}

beforeEach(() => {
  getListMock.mockReset();
  getListMock.mockImplementation(() => {
    return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
  });
});

afterEach(() => {
  cleanup();
});

describe("Kubernetes monitor form - a workload is named with its kind", () => {
  test("Workload Kind sits beside Workload Name and starts on Deployment", () => {
    openAdvanced({});

    expect(screen.getByText("Workload Kind")).toBeInTheDocument();
    expect(screen.getByText("Workload Name")).toBeInTheDocument();
    expect(screen.getByText("Deployment")).toBeInTheDocument();
  });

  test("typing a name saves it with the kind, Deployment unless one was picked", () => {
    const onChange: MockFunction = getJestMockFunction();

    openAdvanced({}, onChange);

    fireEvent.change(screen.getByPlaceholderText("e.g. my-deployment"), {
      target: { value: "checkout" },
    });

    expect(lastChange(onChange).resourceFilters).toEqual({
      workloadName: "checkout",
      workloadType: "deployment",
    });
  });

  test("a kind already picked stays with the name", () => {
    const onChange: MockFunction = getJestMockFunction();

    openAdvanced({ workloadType: "statefulset" }, onChange);

    fireEvent.change(screen.getByPlaceholderText("e.g. my-deployment"), {
      target: { value: "postgres" },
    });

    expect(lastChange(onChange).resourceFilters).toEqual({
      workloadName: "postgres",
      workloadType: "statefulset",
    });
    expect(screen.getByText("StatefulSet")).toBeInTheDocument();
  });
});

/*
 * Workload Kind follows the chosen template. Job Failures reads a Job's own
 * metric, which carries the Job's name and no Deployment's, so a Job
 * Failures monitor scoped to "nightly-export" read nothing while the kind
 * started on Deployment. A template that watches one kind now starts the
 * field on it; a kind the person picked stays theirs; a template that
 * watches no one kind, and a monitor already saved, are as they were.
 */

// The form as the monitor page holds it: each change is handed back.
function StatefulForm(props: {
  initial: MonitorStepKubernetesMonitor;
  onChange: MockFunction;
  initialTemplateId?: string | undefined;
}): React.ReactElement {
  const [value, setValue] = React.useState<MonitorStepKubernetesMonitor>(
    props.initial,
  );

  return (
    <KubernetesMonitorStepForm
      monitorStepKubernetesMonitor={value}
      initialTemplateId={props.initialTemplateId}
      onChange={(next: MonitorStepKubernetesMonitor) => {
        setValue(next);
        props.onChange(next);
      }}
      onMonitorCriteriaChange={(): void => {}}
    />
  );
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

async function renderNewMonitor(
  onChange: MockFunction,
  initialTemplateId?: string,
): Promise<void> {
  render(
    <StatefulForm
      initial={{
        ...MonitorStepKubernetesMonitorUtil.getDefault(),
        clusterIdentifier: "prod",
      }}
      onChange={onChange}
      initialTemplateId={initialTemplateId}
    />,
  );
  await settle();
}

async function pickTemplate(id: string): Promise<void> {
  if (screen.queryByTestId("alert-template-change")) {
    fireEvent.click(screen.getByTestId("alert-template-change"));
    await settle();
  }

  fireEvent.click(screen.getByTestId(`alert-template-${id}`));
  await settle();
}

async function openAdvancedTab(): Promise<void> {
  fireEvent.click(screen.getByRole("tab", { name: "Advanced" }));
  await settle();
}

function workloadKindList(): HTMLElement {
  return screen.getByRole("combobox", { name: "Workload Kind" });
}

// The kind the Workload Kind field shows.
function shownWorkloadKind(): string {
  const control: HTMLElement | null = workloadKindList().closest(
    ".ou-select__control",
  );

  expect(control).not.toBeNull();

  return within(control!).getByTestId("dropdown-value-label").textContent || "";
}

async function pickFromList(list: HTMLElement, label: string): Promise<void> {
  fireEvent.keyDown(list, { key: "ArrowDown" });

  const option: HTMLElement | undefined = (
    await screen.findAllByTestId("dropdown-option-label")
  ).find((element: HTMLElement) => {
    return element.textContent === label;
  });

  expect(option).toBeDefined();
  fireEvent.click(option!);
  await settle();
}

function kindLabel(kind: string | undefined): string {
  return KUBERNETES_WORKLOAD_KINDS.find((entry: { value: string }) => {
    return entry.value === (kind || "deployment");
  })!.label;
}

function templateMonitor(id: string): MonitorStepKubernetesMonitor {
  return getKubernetesAlertTemplateById(id)!.getMonitorStep({
    clusterIdentifier: "prod",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Kubernetes",
  }).data!.kubernetesMonitor!;
}

describe("Kubernetes monitor form - Workload Kind follows the chosen template", () => {
  test.each(getAllKubernetesAlertTemplates())(
    "$name starts Workload Kind on the kind it watches",
    async (template: KubernetesAlertTemplate) => {
      const onChange: MockFunction = getJestMockFunction();

      await renderNewMonitor(onChange);
      await pickTemplate(template.id);

      const monitor: MonitorStepKubernetesMonitor = lastChange(onChange);

      // A template that watches no one kind sets none, as before.
      expect(monitor.resourceFilters).toEqual(
        template.workloadKind ? { workloadType: template.workloadKind } : {},
      );

      if (monitor.resourceScope === KubernetesResourceScope.Workload) {
        await openAdvancedTab();
        expect(shownWorkloadKind()).toBe(kindLabel(template.workloadKind));
      }
    },
  );

  test("Job Failures: a Workload Name is saved as a Job's name", async () => {
    const onChange: MockFunction = getJestMockFunction();

    await renderNewMonitor(onChange);
    await pickTemplate("k8s-job-failures");
    await openAdvancedTab();

    expect(shownWorkloadKind()).toBe("Job");

    fireEvent.change(screen.getByPlaceholderText("e.g. my-deployment"), {
      target: { value: "nightly-export" },
    });

    expect(lastChange(onChange).resourceFilters).toEqual({
      workloadName: "nightly-export",
      workloadType: "job",
    });
    expect(
      MonitorStepKubernetesMonitorUtil.getWorkloadNameAttributeKey(
        lastChange(onChange).resourceFilters,
      ),
    ).toBe("resource.k8s.job.name");
  });

  test("a link that names Job Failures starts the kind on Job", async () => {
    const onChange: MockFunction = getJestMockFunction();

    await renderNewMonitor(onChange, "k8s-job-failures");

    expect(lastChange(onChange).resourceFilters).toEqual({
      workloadType: "job",
    });
  });

  test("switching templates: the kind follows the new template", async () => {
    const onChange: MockFunction = getJestMockFunction();

    await renderNewMonitor(onChange);
    await openAdvancedTab();

    await pickTemplate("k8s-job-failures");
    expect(shownWorkloadKind()).toBe("Job");

    await pickTemplate("k8s-daemonset-unavailable");
    expect(shownWorkloadKind()).toBe("DaemonSet");
    expect(lastChange(onChange).resourceFilters).toEqual({
      workloadType: "daemonset",
    });

    // No kind of its own: Deployment, as before.
    await pickTemplate("k8s-hpa-at-max-replicas");
    expect(shownWorkloadKind()).toBe("Deployment");
    expect(lastChange(onChange).resourceFilters).toEqual({});

    await pickTemplate("k8s-job-failures");
    expect(shownWorkloadKind()).toBe("Job");

    await pickTemplate("k8s-deployment-replica-mismatch");
    expect(shownWorkloadKind()).toBe("Deployment");
    expect(lastChange(onChange).resourceFilters).toEqual({
      workloadType: "deployment",
    });
  });

  test("a kind the person picked survives a template switch", async () => {
    const onChange: MockFunction = getJestMockFunction();

    await renderNewMonitor(onChange);
    await pickTemplate("k8s-job-failures");
    await openAdvancedTab();

    await pickFromList(workloadKindList(), "CronJob");
    expect(shownWorkloadKind()).toBe("CronJob");

    await pickTemplate("k8s-daemonset-unavailable");
    expect(shownWorkloadKind()).toBe("CronJob");
    expect(lastChange(onChange).resourceFilters).toEqual({
      workloadType: "cronjob",
    });

    await pickTemplate("k8s-hpa-at-max-replicas");
    expect(shownWorkloadKind()).toBe("CronJob");

    fireEvent.change(screen.getByPlaceholderText("e.g. my-deployment"), {
      target: { value: "nightly" },
    });
    expect(lastChange(onChange).resourceFilters).toEqual({
      workloadName: "nightly",
      workloadType: "cronjob",
    });
  });

  test("leaving the Workload scope and coming back starts on the template's kind again", async () => {
    const onChange: MockFunction = getJestMockFunction();

    await renderNewMonitor(onChange);
    await pickTemplate("k8s-job-failures");
    await openAdvancedTab();

    const resourceScopeList: () => HTMLElement = (): HTMLElement => {
      return within(screen.getByRole("tabpanel")).getAllByRole("combobox")[0]!;
    };

    await pickFromList(resourceScopeList(), "Namespace");
    expect(lastChange(onChange).resourceFilters).toEqual({});
    expect(
      screen.queryByRole("combobox", { name: "Workload Kind" }),
    ).not.toBeInTheDocument();

    await pickFromList(resourceScopeList(), "Workload");
    expect(shownWorkloadKind()).toBe("Job");
    expect(lastChange(onChange).resourceFilters).toEqual({
      workloadType: "job",
    });
  });

  test("an existing monitor opens with its saved kind, unchanged", async () => {
    const onChange: MockFunction = getJestMockFunction();

    // A Job Failures monitor saved with the kind the form used to start on.
    render(
      <StatefulForm
        initial={{
          ...templateMonitor("k8s-job-failures"),
          resourceFilters: {
            workloadType: "deployment",
            workloadName: "nightly-export",
          },
        }}
        onChange={onChange}
      />,
    );
    await settle();
    await openAdvancedTab();

    expect(shownWorkloadKind()).toBe("Deployment");
    expect(onChange).not.toHaveBeenCalled();
  });

  test("an existing monitor saved without a kind shows what its name is read as", async () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <StatefulForm
        initial={{
          ...templateMonitor("k8s-daemonset-unavailable"),
          resourceFilters: { workloadName: "node-exporter" },
        }}
        onChange={onChange}
      />,
    );
    await settle();
    await openAdvancedTab();

    // The worker reads a name with no kind as a Deployment's.
    expect(shownWorkloadKind()).toBe("Deployment");
    expect(onChange).not.toHaveBeenCalled();
  });
});
