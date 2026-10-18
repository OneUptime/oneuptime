import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
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
import {
  CephAlertTemplate,
  getAllCephAlertTemplates,
} from "../../../Types/Monitor/CephAlertTemplates";
import {
  DockerAlertTemplate,
  getAllDockerAlertTemplates,
} from "../../../Types/Monitor/DockerAlertTemplates";
import {
  DockerSwarmAlertTemplate,
  getAllDockerSwarmAlertTemplates,
} from "../../../Types/Monitor/DockerSwarmAlertTemplates";
import {
  HostAlertTemplate,
  getAllHostAlertTemplates,
} from "../../../Types/Monitor/HostAlertTemplates";
import {
  IoTAlertTemplate,
  getAllIoTAlertTemplates,
} from "../../../Types/Monitor/IotAlertTemplates";
import {
  KubernetesAlertTemplate,
  getAllKubernetesAlertTemplates,
} from "../../../Types/Monitor/KubernetesAlertTemplates";
import {
  PodmanAlertTemplate,
  getAllPodmanAlertTemplates,
} from "../../../Types/Monitor/PodmanAlertTemplates";
import {
  ProxmoxAlertTemplate,
  getAllProxmoxAlertTemplates,
} from "../../../Types/Monitor/ProxmoxAlertTemplates";
import {
  StorageArrayAlertTemplate,
  getAllStorageArrayAlertTemplates,
  getStorageArrayAlertTemplatesForSystem,
} from "../../../Types/Monitor/StorageArrayAlertTemplates";
import {
  VMwareAlertTemplate,
  getAllVMwareAlertTemplates,
} from "../../../Types/Monitor/VMwareAlertTemplates";
import StorageSystem from "../../../Types/StorageArray/StorageSystem";
import getJestMockFunction, { MockFunction } from "../../MockType";
import AlertTemplatePicker from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/AlertTemplatePicker/AlertTemplatePicker";
import AlertTemplateConfiguration from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/AlertTemplatePicker/AlertTemplateConfiguration";
import { AlertTemplatePickerTemplate } from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/AlertTemplatePicker/AlertTemplateGroups";
import {
  CEPH_TEMPLATE_CATEGORIES,
  KUBERNETES_TEMPLATE_CATEGORIES,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/AlertTemplatePicker/AlertTemplateCategories";
import HostTemplatePicker from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/HostMonitor/HostTemplatePicker";
import DockerTemplatePicker from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/DockerMonitor/DockerTemplatePicker";
import PodmanTemplatePicker from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/PodmanMonitor/PodmanTemplatePicker";
import DockerSwarmTemplatePicker from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/DockerSwarmMonitor/DockerSwarmTemplatePicker";
import KubernetesTemplatePicker from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/KubernetesMonitor/KubernetesTemplatePicker";
import ProxmoxTemplatePicker from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/ProxmoxMonitor/ProxmoxTemplatePicker";
import VMwareTemplatePicker from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/VMwareMonitor/VMwareTemplatePicker";
import CephTemplatePicker from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/CephMonitor/CephTemplatePicker";
import StorageArrayTemplatePicker from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/StorageArrayMonitor/StorageArrayTemplatePicker";
import IoTTemplatePicker from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/IoTMonitor/IoTTemplatePicker";

/*
 * Quick Setup's alert templates on the ten infrastructure monitor types.
 *
 * Each picker used to be its own copy of a list of cards carrying the
 * template's whole description - up to 509 characters of metric names and
 * formulas in grey, seventeen cards to a screen - in a blue that is not the
 * product's. One shared picker now draws a compact radio row per template:
 * its name, its severity and the one line that says when it fires. The full
 * description is the picked template's, under Template Configuration.
 */

afterEach(() => {
  cleanup();
});

function rows(): Array<HTMLElement> {
  return within(screen.getByRole("radiogroup")).getAllByRole("radio");
}

function rowOf(template: { id: string }): HTMLElement {
  return screen.getByTestId(`alert-template-${template.id}`);
}

interface PickerCase {
  name: string;
  templates: Array<AlertTemplatePickerTemplate>;
  render: (onTemplateSelected: MockFunction) => void;
  headings: Array<string>;
}

const PICKER_CASES: Array<PickerCase> = [
  {
    name: "Host",
    templates: getAllHostAlertTemplates(),
    render: (onTemplateSelected: MockFunction): void => {
      render(<HostTemplatePicker onTemplateSelected={onTemplateSelected} />);
    },
    headings: [],
  },
  {
    name: "Docker",
    templates: getAllDockerAlertTemplates(),
    render: (onTemplateSelected: MockFunction): void => {
      render(<DockerTemplatePicker onTemplateSelected={onTemplateSelected} />);
    },
    headings: [],
  },
  {
    name: "Podman",
    templates: getAllPodmanAlertTemplates(),
    render: (onTemplateSelected: MockFunction): void => {
      render(<PodmanTemplatePicker onTemplateSelected={onTemplateSelected} />);
    },
    headings: [],
  },
  {
    name: "Docker Swarm",
    templates: getAllDockerSwarmAlertTemplates(),
    render: (onTemplateSelected: MockFunction): void => {
      render(
        <DockerSwarmTemplatePicker onTemplateSelected={onTemplateSelected} />,
      );
    },
    headings: ["Availability", "Resource", "Container"],
  },
  {
    name: "Kubernetes",
    templates: getAllKubernetesAlertTemplates(),
    render: (onTemplateSelected: MockFunction): void => {
      render(
        <KubernetesTemplatePicker onTemplateSelected={onTemplateSelected} />,
      );
    },
    headings: ["Workload", "Node", "Control Plane", "Storage", "Scheduling"],
  },
  {
    name: "Proxmox",
    templates: getAllProxmoxAlertTemplates(),
    render: (onTemplateSelected: MockFunction): void => {
      render(<ProxmoxTemplatePicker onTemplateSelected={onTemplateSelected} />);
    },
    headings: [
      "Availability",
      "Node",
      "Guest",
      "Storage",
      "High Availability",
      "Backup",
      "Replication",
    ],
  },
  {
    name: "VMware",
    templates: getAllVMwareAlertTemplates(),
    render: (onTemplateSelected: MockFunction): void => {
      render(<VMwareTemplatePicker onTemplateSelected={onTemplateSelected} />);
    },
    headings: [
      "ESXi Host",
      "Virtual Machine",
      "Datastore",
      "Cluster",
      "Datacenter",
      "vSAN",
    ],
  },
  {
    name: "Ceph",
    templates: getAllCephAlertTemplates(),
    render: (onTemplateSelected: MockFunction): void => {
      render(<CephTemplatePicker onTemplateSelected={onTemplateSelected} />);
    },
    headings: ["Cluster Health", "OSD", "Placement Groups", "Capacity"],
  },
  {
    name: "Storage Array (platform not known yet)",
    // Every template, each named with its platform (FlashArray, FlashBlade).
    templates: getStorageArrayAlertTemplatesForSystem(undefined),
    render: (onTemplateSelected: MockFunction): void => {
      render(
        <StorageArrayTemplatePicker onTemplateSelected={onTemplateSelected} />,
      );
    },
    headings: [
      "Array Health",
      "Capacity",
      "Performance",
      "Hardware",
      "Hosts",
      "Replication",
      "File Systems",
    ],
  },
  {
    name: "IoT",
    templates: getAllIoTAlertTemplates(),
    render: (onTemplateSelected: MockFunction): void => {
      render(<IoTTemplatePicker onTemplateSelected={onTemplateSelected} />);
    },
    headings: [
      "Availability",
      "Power",
      "Connectivity",
      "Environment",
      "System",
    ],
  },
];

describe("each infrastructure type's Quick Setup picker", () => {
  test.each(PICKER_CASES)(
    "$name offers every template of its catalog once, with its summary",
    (pickerCase: PickerCase) => {
      pickerCase.render(getJestMockFunction());

      expect(rows()).toHaveLength(pickerCase.templates.length);

      for (const template of pickerCase.templates) {
        const row: HTMLElement = rowOf(template);

        expect(row).toHaveAttribute("role", "radio");
        expect(within(row).getByText(template.name)).toBeInTheDocument();
        expect(
          within(row).getByTestId(`alert-template-summary-${template.id}`),
        ).toHaveTextContent(template.summary);
        expect(
          within(row).getByTestId(`alert-template-severity-${template.id}`),
        ).toHaveTextContent(template.severity);
      }
    },
  );

  test.each(PICKER_CASES)(
    "$name keeps every long description off the list",
    (pickerCase: PickerCase) => {
      pickerCase.render(getJestMockFunction());

      const listText: string =
        screen.getByTestId("alert-template-picker").textContent || "";

      for (const template of pickerCase.templates) {
        if (template.description !== template.summary) {
          expect(listText).not.toContain(template.description);
        }
      }

      expect(
        screen.queryByTestId("alert-template-configuration"),
      ).not.toBeInTheDocument();
    },
  );

  test.each(PICKER_CASES)(
    "$name lists its templates under its headings, in order",
    (pickerCase: PickerCase) => {
      pickerCase.render(getJestMockFunction());

      const headings: Array<string> = screen
        .queryAllByRole("heading", { level: 4 })
        .map((heading: HTMLElement): string => {
          return heading.textContent || "";
        });

      expect(headings).toEqual(pickerCase.headings);

      // Each heading names the group of rows under it.
      for (const group of screen.queryAllByRole("group")) {
        expect(group).toHaveAccessibleName();
      }
    },
  );

  test.each(PICKER_CASES)(
    "$name hands back the template a row stands for",
    (pickerCase: PickerCase) => {
      const onTemplateSelected: MockFunction = getJestMockFunction();
      pickerCase.render(onTemplateSelected);

      const last: AlertTemplatePickerTemplate =
        pickerCase.templates[pickerCase.templates.length - 1]!;

      fireEvent.click(rowOf(last));

      expect(onTemplateSelected).toHaveBeenCalledTimes(1);
      expect(
        (onTemplateSelected.mock.calls[0]![0] as AlertTemplatePickerTemplate)
          .id,
      ).toBe(last.id);
    },
  );
});

describe("the storage array picker", () => {
  test.each([
    StorageSystem.PureStorageFlashArray,
    StorageSystem.PureStorageFlashBlade,
  ])("offers only %s templates for an array of that platform", (system) => {
    render(
      <StorageArrayTemplatePicker
        storageSystem={system}
        onTemplateSelected={getJestMockFunction()}
      />,
    );

    const offered: Array<StorageArrayAlertTemplate> =
      getStorageArrayAlertTemplatesForSystem(system);

    expect(offered.length).toBeGreaterThan(0);
    expect(offered.length).toBeLessThan(
      getAllStorageArrayAlertTemplates().length,
    );
    expect(rows()).toHaveLength(offered.length);

    for (const template of offered) {
      expect(rowOf(template)).toBeInTheDocument();
    }
  });
});

describe("the shared picker", () => {
  const kubernetes: Array<KubernetesAlertTemplate> =
    getAllKubernetesAlertTemplates();

  function renderKubernetes(
    selectedTemplateId?: string | undefined,
    onTemplateSelected: MockFunction = getJestMockFunction(),
  ): void {
    render(
      <AlertTemplatePicker<KubernetesAlertTemplate>
        templates={kubernetes}
        categories={KUBERNETES_TEMPLATE_CATEGORIES}
        {...(selectedTemplateId ? { selectedTemplateId } : {})}
        onTemplateSelected={onTemplateSelected}
      />,
    );
  }

  test("says in one line what a template does, as one named radio group", () => {
    renderKubernetes();

    expect(
      screen.getByText(
        "Pick a template. It fills in the metric, thresholds and criteria below.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radiogroup", { name: "Alert templates" }),
    ).toBeInTheDocument();
  });

  test("nothing is picked until a template is", () => {
    renderKubernetes();

    for (const row of rows()) {
      expect(row).toHaveAttribute("aria-checked", "false");
    }
  });

  test("the group is one tab stop: the first row until one is picked", () => {
    renderKubernetes();

    const tabStops: Array<HTMLElement> = rows().filter(
      (row: HTMLElement): boolean => {
        return row.tabIndex === 0;
      },
    );

    expect(tabStops).toEqual([rows()[0]]);

    for (const row of rows().slice(1)) {
      expect(row.tabIndex).toBe(-1);
    }
  });

  test("the picked row is checked, ticked and takes the tab stop", () => {
    const picked: KubernetesAlertTemplate = kubernetes.find(
      (template: KubernetesAlertTemplate): boolean => {
        return template.id === "k8s-etcd-no-leader";
      },
    )!;
    renderKubernetes(picked.id);

    const row: HTMLElement = rowOf(picked);

    expect(row).toHaveAttribute("aria-checked", "true");
    expect(row.tabIndex).toBe(0);
    expect(row.className).toContain("border-indigo-500");
    expect(row.querySelector("svg")).not.toBeNull();

    for (const other of rows()) {
      if (other !== row) {
        expect(other).toHaveAttribute("aria-checked", "false");
        expect(other.tabIndex).toBe(-1);
        expect(other.className).not.toContain("border-indigo-500");
      }
    }
  });

  test("arrow keys move between rows without picking any", () => {
    const onTemplateSelected: MockFunction = getJestMockFunction();
    renderKubernetes(undefined, onTemplateSelected);

    const all: Array<HTMLElement> = rows();

    act(() => {
      all[0]!.focus();
    });

    fireEvent.keyDown(all[0]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(all[1]);

    fireEvent.keyDown(all[1]!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(all[2]);

    fireEvent.keyDown(all[2]!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(all[1]);

    fireEvent.keyDown(all[1]!, { key: "End" });
    expect(document.activeElement).toBe(all[all.length - 1]);

    // Clamped at the end: no wrapping round to the top.
    fireEvent.keyDown(all[all.length - 1]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(all[all.length - 1]);

    fireEvent.keyDown(all[all.length - 1]!, { key: "Home" });
    expect(document.activeElement).toBe(all[0]);

    fireEvent.keyDown(all[0]!, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(all[0]);

    expect(onTemplateSelected).not.toHaveBeenCalled();
  });

  test("the arrows cross the headings in the order the rows are drawn", () => {
    renderKubernetes();

    const all: Array<HTMLElement> = rows();
    const drawnIds: Array<string> = all.map((row: HTMLElement): string => {
      return row.getAttribute("data-alert-template-id") || "";
    });

    // Every Workload template first, then every Node one, and so on.
    const expectedIds: Array<string> = KUBERNETES_TEMPLATE_CATEGORIES.flatMap(
      (category: { category: string }): Array<string> => {
        return kubernetes
          .filter((template: KubernetesAlertTemplate): boolean => {
            return template.category === category.category;
          })
          .map((template: KubernetesAlertTemplate): string => {
            return template.id;
          });
      },
    );

    expect(drawnIds).toEqual(expectedIds);
  });

  test("Enter and Space pick the row that has focus", () => {
    const onTemplateSelected: MockFunction = getJestMockFunction();
    renderKubernetes(undefined, onTemplateSelected);

    const all: Array<HTMLElement> = rows();

    fireEvent.keyDown(all[3]!, { key: "Enter" });
    fireEvent.keyDown(all[4]!, { key: " " });

    expect(
      onTemplateSelected.mock.calls.map((call: Array<unknown>): string => {
        return (call[0] as KubernetesAlertTemplate).id;
      }),
    ).toEqual([
      all[3]!.getAttribute("data-alert-template-id"),
      all[4]!.getAttribute("data-alert-template-id"),
    ]);
  });

  test("a template whose category has no heading is still offered, last", () => {
    const ceph: Array<CephAlertTemplate> = getAllCephAlertTemplates();
    const stray: CephAlertTemplate = {
      ...ceph[0]!,
      id: "ceph-stray-template",
      name: "Stray Template",
      summary: "A template in a category the picker does not name.",
      category: "Unlisted" as CephAlertTemplate["category"],
    };

    render(
      <AlertTemplatePicker<CephAlertTemplate>
        templates={[...ceph, stray]}
        categories={CEPH_TEMPLATE_CATEGORIES}
        onTemplateSelected={getJestMockFunction()}
      />,
    );

    expect(rowOf(stray)).toBeInTheDocument();
    expect(rows()[rows().length - 1]).toBe(rowOf(stray));
    expect(
      screen.getByTestId("alert-template-group-Unlisted"),
    ).toHaveTextContent("Unlisted");
  });

  test("Critical and Warning look different", () => {
    renderKubernetes();

    const critical: KubernetesAlertTemplate = kubernetes.find(
      (template: KubernetesAlertTemplate): boolean => {
        return template.severity === "Critical";
      },
    )!;
    const warning: KubernetesAlertTemplate = kubernetes.find(
      (template: KubernetesAlertTemplate): boolean => {
        return template.severity === "Warning";
      },
    )!;

    expect(
      screen.getByTestId(`alert-template-severity-${critical.id}`).className,
    ).toContain("bg-red-100");
    expect(
      screen.getByTestId(`alert-template-severity-${warning.id}`).className,
    ).toContain("bg-yellow-100");
  });

  test("no blue that is not the product's", () => {
    renderKubernetes("k8s-crashloopbackoff");

    const html: string = screen.getByTestId("alert-template-picker").innerHTML;

    expect(html).not.toMatch(/\b(?:bg|border|ring|text)-blue-\d+/);
  });
});

describe("Template Configuration, once a template is picked", () => {
  const template: ProxmoxAlertTemplate = getAllProxmoxAlertTemplates()[0]!;

  test("explains the picked template in full", () => {
    render(
      <AlertTemplateConfiguration
        template={template}
        rollingTime={RollingTime.Past5Minutes}
        onRollingTimeChange={getJestMockFunction()}
      />,
    );

    const panel: HTMLElement = screen.getByTestId(
      "alert-template-configuration",
    );

    expect(
      within(panel).getByRole("heading", { name: "Template Configuration" }),
    ).toBeInTheDocument();
    expect(
      within(panel).getByTestId("alert-template-configuration-name"),
    ).toHaveTextContent(template.name);
    expect(
      within(panel).getByTestId("alert-template-description"),
    ).toHaveTextContent(template.description);
    expect(within(panel).getByText("Time Range")).toBeInTheDocument();
    expect(within(panel).getByText("Past 5 Minutes")).toBeInTheDocument();
  });

  test("says nothing the old panel said about settings being auto-configured", () => {
    render(
      <AlertTemplateConfiguration
        template={template}
        rollingTime={RollingTime.Past5Minutes}
        onRollingTimeChange={getJestMockFunction()}
      />,
    );

    expect(
      screen.queryByText(
        "The following settings have been auto-configured. You can adjust the time range below.",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Adjust the monitoring time range."),
    ).not.toBeInTheDocument();
  });
});

describe("summaries the pickers draw stay short", () => {
  test.each([
    ["Host", getAllHostAlertTemplates() as Array<HostAlertTemplate>],
    ["Docker", getAllDockerAlertTemplates() as Array<DockerAlertTemplate>],
    ["Podman", getAllPodmanAlertTemplates() as Array<PodmanAlertTemplate>],
    [
      "Docker Swarm",
      getAllDockerSwarmAlertTemplates() as Array<DockerSwarmAlertTemplate>,
    ],
    ["VMware", getAllVMwareAlertTemplates() as Array<VMwareAlertTemplate>],
    ["IoT", getAllIoTAlertTemplates() as Array<IoTAlertTemplate>],
  ])(
    "%s summaries fit one line of a two-column grid",
    (_name: string, templates: Array<AlertTemplatePickerTemplate>) => {
      for (const template of templates) {
        expect(template.summary.length).toBeLessThanOrEqual(80);
      }
    },
  );
});
