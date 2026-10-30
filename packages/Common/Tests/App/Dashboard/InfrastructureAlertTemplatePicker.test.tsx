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
import { getAllProxmoxAlertTemplates } from "../../../Types/Monitor/ProxmoxAlertTemplates";
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
 * its name, its severity and the one line that says when it fires.
 *
 * Once a template is picked the list folds into it, the way the monitor
 * type picker folds into the type: its row with Change, its full
 * description behind Show more, and its Time Range right under it - not
 * under every other row, a phone's whole screen and more away.
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
    headings: [
      "Availability",
      "Workload",
      "Node",
      "Control Plane",
      "Storage",
      "Scheduling",
    ],
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
      "Availability",
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
    headings: [
      "Availability",
      "Cluster Health",
      "OSD",
      "Placement Groups",
      "Capacity",
    ],
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
      "Availability",
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
  ])(
    "offers only %s templates for an array of that platform",
    (system: StorageSystem) => {
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
    },
  );
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

  test("after Change, the picked row is checked, ticked and takes the tab stop", () => {
    const picked: KubernetesAlertTemplate = kubernetes.find(
      (template: KubernetesAlertTemplate): boolean => {
        return template.id === "k8s-etcd-no-leader";
      },
    )!;
    renderKubernetes(picked.id);

    // A pick folds the list; Change opens it again.
    fireEvent.click(screen.getByTestId("alert-template-change"));

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

  test("no blue that is not the product's, folded or open", () => {
    renderKubernetes("k8s-crashloopbackoff");

    const folded: string = screen.getByTestId(
      "alert-template-picker",
    ).innerHTML;

    fireEvent.click(screen.getByTestId("alert-template-change"));

    const open: string = screen.getByTestId("alert-template-picker").innerHTML;

    for (const html of [folded, open]) {
      expect(html).not.toMatch(/\b(?:bg|border|ring|text)-blue-\d+/);
    }
  });
});

/*
 * The picker as the step forms hold it: the form keeps the picked id and
 * hands in the Time Range as children.
 */
function PickerAsAForm(props: {
  templates: Array<AlertTemplatePickerTemplate>;
  onTemplateSelected: MockFunction;
  initialTemplateId?: string | undefined;
}): React.ReactElement {
  const [selectedTemplateId, setSelectedTemplateId] = React.useState<
    string | undefined
  >(props.initialTemplateId);

  return (
    <AlertTemplatePicker<AlertTemplatePickerTemplate>
      templates={props.templates}
      categories={KUBERNETES_TEMPLATE_CATEGORIES}
      selectedTemplateId={selectedTemplateId}
      onTemplateSelected={(template: AlertTemplatePickerTemplate) => {
        props.onTemplateSelected(template);
        setSelectedTemplateId(template.id);
      }}
    >
      <p data-testid="what-the-template-asks-for">Time Range goes here</p>
    </AlertTemplatePicker>
  );
}

describe("once a template is picked, the list folds into it", () => {
  const kubernetes: Array<KubernetesAlertTemplate> =
    getAllKubernetesAlertTemplates();
  const etcd: KubernetesAlertTemplate = kubernetes.find(
    (template: KubernetesAlertTemplate): boolean => {
      return template.id === "k8s-etcd-no-leader";
    },
  )!;
  const highCpu: KubernetesAlertTemplate = kubernetes.find(
    (template: KubernetesAlertTemplate): boolean => {
      return template.id === "k8s-high-cpu";
    },
  )!;

  function renderForm(
    onTemplateSelected: MockFunction = getJestMockFunction(),
    initialTemplateId?: string | undefined,
  ): void {
    render(
      <PickerAsAForm
        templates={kubernetes}
        onTemplateSelected={onTemplateSelected}
        initialTemplateId={initialTemplateId}
      />,
    );
  }

  function picked(): HTMLElement {
    return screen.getByTestId("alert-template-picked");
  }

  test("before a pick: every row, the intro, and nothing the template asks for", () => {
    renderForm();

    expect(rows()).toHaveLength(kubernetes.length);
    expect(
      screen.getByText(
        "Pick a template. It fills in the metric, thresholds and criteria below.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("alert-template-picked"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("what-the-template-asks-for"),
    ).not.toBeInTheDocument();
  });

  test("a pick folds the list: the picked template's name, severity and summary, Change, and what it asks for under it", () => {
    const onTemplateSelected: MockFunction = getJestMockFunction();
    renderForm(onTemplateSelected);

    fireEvent.click(rowOf(etcd));

    expect(onTemplateSelected).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(
      screen.queryByText(
        "Pick a template. It fills in the metric, thresholds and criteria below.",
      ),
    ).not.toBeInTheDocument();

    expect(screen.getByText("Alert Template")).toBeInTheDocument();
    expect(picked()).toHaveAttribute("data-alert-template-id", etcd.id);
    expect(
      within(picked()).getByTestId("alert-template-picked-name"),
    ).toHaveTextContent(etcd.name);
    expect(
      within(picked()).getByTestId("alert-template-picked-severity"),
    ).toHaveTextContent("Critical");
    expect(
      within(picked()).getByTestId("alert-template-picked-severity").className,
    ).toContain("bg-red-100");
    expect(
      within(picked()).getByTestId("alert-template-picked-summary"),
    ).toHaveTextContent(etcd.summary);
    expect(
      within(picked()).getByRole("button", { name: "Change" }),
    ).toBeInTheDocument();

    // What the template still asks for is right under it.
    const asksFor: HTMLElement = screen.getByTestId(
      "what-the-template-asks-for",
    );
    expect(
      picked().compareDocumentPosition(asksFor) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // No other template is left on screen.
    for (const other of kubernetes) {
      if (other.id !== etcd.id) {
        expect(screen.queryByText(other.name)).not.toBeInTheDocument();
      }
    }
  });

  test("the folded template is a group named by the template, and Change says which", () => {
    renderForm();

    fireEvent.click(rowOf(etcd));

    expect(screen.getByRole("group", { name: etcd.name })).toBeInTheDocument();
    expect(
      screen.getByTestId("alert-template-change"),
    ).toHaveAccessibleDescription(etcd.name);
  });

  test("a pick from the keyboard moves focus to Change: the row it was on is gone", () => {
    renderForm();

    const row: HTMLElement = rowOf(highCpu);

    act(() => {
      row.focus();
    });
    fireEvent.keyDown(row, { key: "Enter" });

    expect(document.activeElement).toBe(
      screen.getByTestId("alert-template-change"),
    );
  });

  test("the full description waits behind Show more", () => {
    renderForm();

    fireEvent.click(rowOf(etcd));

    expect(
      screen.queryByTestId("alert-template-description"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(etcd.description)).not.toBeInTheDocument();

    const toggle: HTMLElement = screen.getByTestId(
      "alert-template-description-toggle",
    );

    expect(toggle).toHaveTextContent("Show more");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).not.toHaveAttribute("aria-controls");

    fireEvent.click(toggle);

    const description: HTMLElement = screen.getByTestId(
      "alert-template-description",
    );

    expect(description).toHaveTextContent(etcd.description);
    expect(toggle).toHaveTextContent("Show less");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("aria-controls", description.id);

    fireEvent.click(toggle);

    expect(
      screen.queryByTestId("alert-template-description"),
    ).not.toBeInTheDocument();
    expect(toggle).toHaveTextContent("Show more");
  });

  test("a template whose description says no more than its summary has no Show more", () => {
    const plain: AlertTemplatePickerTemplate = {
      ...etcd,
      id: "plain-template",
      name: "Plain Template",
      summary: "It fires when it fires.",
      description: "  It fires when it fires.  ",
    };

    render(
      <PickerAsAForm
        templates={[plain]}
        onTemplateSelected={getJestMockFunction()}
        initialTemplateId={plain.id}
      />,
    );

    expect(picked()).toHaveTextContent("It fires when it fires.");
    expect(
      screen.queryByTestId("alert-template-description-toggle"),
    ).not.toBeInTheDocument();
  });

  test("a form that opens on a picked template (from a link) opens folded", () => {
    renderForm(getJestMockFunction(), highCpu.id);

    expect(picked()).toHaveAttribute("data-alert-template-id", highCpu.id);
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(
      screen.getByTestId("what-the-template-asks-for"),
    ).toBeInTheDocument();
  });

  test("Change opens the list again: the picked row checked and focused, the rest of the form put away", () => {
    renderForm();

    fireEvent.click(rowOf(etcd));
    fireEvent.click(screen.getByTestId("alert-template-change"));

    expect(rows()).toHaveLength(kubernetes.length);
    expect(rowOf(etcd)).toHaveAttribute("aria-checked", "true");
    expect(rowOf(etcd).tabIndex).toBe(0);
    expect(document.activeElement).toBe(rowOf(etcd));
    expect(
      screen.queryByTestId("alert-template-picked"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("what-the-template-asks-for"),
    ).not.toBeInTheDocument();
  });

  test("after Change, picking the same template only folds the list: the form is not told again, so its criteria stay as they are", () => {
    const onTemplateSelected: MockFunction = getJestMockFunction();
    renderForm(onTemplateSelected);

    fireEvent.click(rowOf(etcd));
    fireEvent.click(screen.getByTestId("alert-template-change"));
    fireEvent.click(rowOf(etcd));

    expect(onTemplateSelected).toHaveBeenCalledTimes(1);
    expect(picked()).toHaveAttribute("data-alert-template-id", etcd.id);
    expect(document.activeElement).toBe(
      screen.getByTestId("alert-template-change"),
    );
  });

  test("after Change, Enter on the picked row keeps it too", () => {
    const onTemplateSelected: MockFunction = getJestMockFunction();
    renderForm(onTemplateSelected);

    fireEvent.click(rowOf(etcd));
    fireEvent.click(screen.getByTestId("alert-template-change"));
    fireEvent.keyDown(rowOf(etcd), { key: "Enter" });

    expect(onTemplateSelected).toHaveBeenCalledTimes(1);
    expect(picked()).toBeInTheDocument();
  });

  test("after Change, Escape keeps the template already picked", () => {
    const onTemplateSelected: MockFunction = getJestMockFunction();
    renderForm(onTemplateSelected);

    fireEvent.click(rowOf(etcd));
    fireEvent.click(screen.getByTestId("alert-template-change"));
    // Looking around first: arrows move focus, they pick nothing.
    fireEvent.keyDown(rowOf(etcd), { key: "ArrowDown" });
    fireEvent.keyDown(document.activeElement as HTMLElement, {
      key: "Escape",
    });

    expect(onTemplateSelected).toHaveBeenCalledTimes(1);
    expect(picked()).toHaveAttribute("data-alert-template-id", etcd.id);
    expect(document.activeElement).toBe(
      screen.getByTestId("alert-template-change"),
    );
  });

  test("Escape before any pick leaves the list as it is", () => {
    renderForm();

    fireEvent.keyDown(rows()[0]!, { key: "Escape" });

    expect(rows()).toHaveLength(kubernetes.length);
    expect(
      screen.queryByTestId("alert-template-picked"),
    ).not.toBeInTheDocument();
  });

  test("after Change, another template is a new pick: the form is told, and the list folds into it", () => {
    const onTemplateSelected: MockFunction = getJestMockFunction();
    renderForm(onTemplateSelected);

    fireEvent.click(rowOf(etcd));
    fireEvent.click(screen.getByTestId("alert-template-change"));
    fireEvent.click(rowOf(highCpu));

    expect(
      onTemplateSelected.mock.calls.map((call: Array<unknown>): string => {
        return (call[0] as KubernetesAlertTemplate).id;
      }),
    ).toEqual([etcd.id, highCpu.id]);
    expect(picked()).toHaveAttribute("data-alert-template-id", highCpu.id);
    expect(
      within(picked()).getByTestId("alert-template-picked-severity"),
    ).toHaveTextContent("Warning");
  });

  test("a new pick starts with its description folded", () => {
    renderForm();

    fireEvent.click(rowOf(etcd));
    fireEvent.click(screen.getByTestId("alert-template-description-toggle"));
    expect(screen.getByTestId("alert-template-description")).toBeVisible();

    fireEvent.click(screen.getByTestId("alert-template-change"));
    fireEvent.click(rowOf(highCpu));

    expect(
      screen.queryByTestId("alert-template-description"),
    ).not.toBeInTheDocument();
  });

  test("a pick the list does not offer leaves the list open, nothing checked", () => {
    renderForm(getJestMockFunction(), "a-template-from-another-platform");

    expect(rows()).toHaveLength(kubernetes.length);
    for (const row of rows()) {
      expect(row).toHaveAttribute("aria-checked", "false");
    }
    expect(
      screen.queryByTestId("what-the-template-asks-for"),
    ).not.toBeInTheDocument();
  });
});

describe("the Time Range under a picked template", () => {
  test("is labelled, says in one line what it is, and shows the template's window", () => {
    render(
      <AlertTemplateConfiguration
        rollingTime={RollingTime.Past5Minutes}
        onRollingTimeChange={getJestMockFunction()}
      />,
    );

    const field: HTMLElement = screen.getByTestId(
      "alert-template-configuration",
    );

    expect(within(field).getByText("Time Range")).toBeInTheDocument();
    expect(
      within(field).getByText("How far back each check looks."),
    ).toBeInTheDocument();
    expect(within(field).getByText("Past 5 Minutes")).toBeInTheDocument();
  });

  test("is the only thing in it: no heading, no name and no description of its own", () => {
    render(
      <AlertTemplateConfiguration
        rollingTime={RollingTime.Past5Minutes}
        onRollingTimeChange={getJestMockFunction()}
      />,
    );

    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Template Configuration"),
    ).not.toBeInTheDocument();
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
