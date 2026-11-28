import "@testing-library/jest-dom";
import { act, cleanup, render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import React, { ReactElement } from "react";
import VMwareHealthRuleOverridesCard, {
  VMWARE_HEALTH_RULE_OVERRIDES_TABLE_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/Settings/HealthRuleOverrides";
import VMwareHealthRuleOverride from "../../../Models/DatabaseModels/VMwareHealthRuleOverride";
import VMwareVCenter from "../../../Models/DatabaseModels/VMwareVCenter";
import ObjectID from "../../../Types/ObjectID";
import { VMwareHealthRuleScope } from "../../../Types/VMware/VMwareHealthRuleOverrides";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * VMware > Settings > Health Rules > Overrides (#11469): each vCenter,
 * cluster, ESXi host or VM with rules of its own, saying what it is, where,
 * what it covers and what it changes, rule by rule in the words of the
 * cards above it; Add Override and Edit open the one dialog, and every
 * change makes the page read the rules again. ModelTable is the read
 * boundary: its props are captured and its cells drawn from them.
 */

interface CapturedColumn {
  title: string;
  getElement: (item: VMwareHealthRuleOverride) => ReactElement;
}

interface CapturedTableProps {
  id: string;
  name: string;
  singularName: string;
  isDeleteable: boolean;
  isEditable: boolean;
  isCreateable: boolean;
  createVerb: string;
  noItemsMessage: string;
  refreshToggle: string;
  query: Record<string, unknown>;
  selectMoreFields: Record<string, unknown>;
  cardProps: { title: string; description: string };
  columns: Array<CapturedColumn>;
  actionButtons: Array<{
    title: string;
    onClick: (item: VMwareHealthRuleOverride, done: () => void) => void;
  }>;
  onCreateClick: () => void;
  onItemDeleted: () => void;
}

interface CapturedModalProps {
  override?: VMwareHealthRuleOverride | undefined;
  onClose: () => void;
  onSaved: () => void;
}

let table: CapturedTableProps | null = null;
let modal: CapturedModalProps | null = null;

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps): ReactElement => {
      table = props;
      return <div data-testid="model-table" />;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/VMware/HealthRules/VMwareHealthRuleOverrideModal",
  () => {
    return {
      __esModule: true,
      default: (props: CapturedModalProps): ReactElement => {
        modal = props;
        return <div data-testid="override-modal" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/Utils/VMwareHealthRulesStore",
  () => {
    return {
      __esModule: true,
      useVMwareHealthRuleBook: () => {
        return { project: {}, overrides: [] };
      },
    };
  },
);

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string): string => {
          return key;
        },
      };
    },
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);

function override(
  fields: Partial<VMwareHealthRuleOverride>,
): VMwareHealthRuleOverride {
  const row: VMwareHealthRuleOverride = Object.assign(
    new VMwareHealthRuleOverride(),
    fields,
  );
  const vcenter: VMwareVCenter = new VMwareVCenter();
  vcenter.name = "vcsa-prod";
  row.vmwareVCenter = vcenter;
  return row;
}

function getTable(): CapturedTableProps {
  expect(table).not.toBeNull();
  return table!;
}

function cell(title: string, item: VMwareHealthRuleOverride): HTMLElement {
  const column: CapturedColumn = getTable().columns.find(
    (each: CapturedColumn): boolean => {
      return each.title === title;
    },
  )!;
  const { container } = render(column.getElement(item));
  return container;
}

beforeEach(() => {
  table = null;
  modal = null;
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the Overrides card", () => {
  test("lists the project's overrides, oldest first, to add, edit and delete", () => {
    render(<VMwareHealthRuleOverridesCard onChanged={jest.fn()} />);
    const props: CapturedTableProps = getTable();

    expect(props.id).toBe(VMWARE_HEALTH_RULE_OVERRIDES_TABLE_ID);
    expect(props.cardProps).toEqual({
      title: "Overrides",
      description:
        "Rules of their own for a vCenter, cluster, ESXi host or VM, such as a lab vCenter or a cluster meant to run hot. The most specific one wins.",
    });
    expect(props.noItemsMessage).toBe(
      "No overrides yet. Every vCenter is judged by the rules above.",
    );
    expect(props.query).toEqual({ projectId: PROJECT_ID });
    expect(props.isCreateable).toBe(true);
    expect(props.createVerb).toBe("Add");
    expect(props.isDeleteable).toBe(true);
    // An override is changed in its own dialog, never in the table's form.
    expect(props.isEditable).toBe(false);
    expect(
      props.actionButtons.map((button: { title: string }) => {
        return button.title;
      }),
    ).toEqual(["Edit"]);
    // What its cells say is read with it, its vCenter's name too.
    expect(props.selectMoreFields).toEqual(
      expect.objectContaining({
        rules: true,
        resourceName: true,
        clusterName: true,
        datacenterName: true,
        vmwareVCenter: { name: true },
      }),
    );
  });

  test("a VM's says what it is, where, in which vCenter, and what it covers", () => {
    render(<VMwareHealthRuleOverridesCard onChanged={jest.fn()} />);
    const applies: HTMLElement = cell(
      "Applies To",
      override({
        scope: VMwareHealthRuleScope.VirtualMachine,
        resourceName: "web-01",
        clusterName: "cluster-a",
        datacenterName: "DC-NORTH",
        hostName: "esx-07",
        rules: {},
      }),
    );
    expect(applies).toHaveTextContent("Virtual Machine web-01");
    expect(applies).toHaveTextContent(
      "cluster-a · DC-NORTH · vCenter vcsa-prod",
    );
    expect(applies).toHaveTextContent("This VM");
  });

  test("a cluster's names its datacenter once, and covers its hosts, their VMs and its pools", () => {
    render(<VMwareHealthRuleOverridesCard onChanged={jest.fn()} />);
    const applies: HTMLElement = cell(
      "Applies To",
      override({
        scope: VMwareHealthRuleScope.Cluster,
        resourceName: "cluster-a",
        clusterName: "cluster-a",
        datacenterName: "DC-NORTH",
        rules: {},
      }),
    );
    expect(applies).toHaveTextContent("Cluster cluster-a");
    // Not "cluster-a · DC-NORTH": a cluster is not in itself.
    expect(applies).toHaveTextContent("DC-NORTH · vCenter vcsa-prod");
    expect(applies).not.toHaveTextContent("cluster-a · DC-NORTH");
    expect(applies).toHaveTextContent(
      "The cluster, its hosts, their VMs and its resource pools",
    );
  });

  test("a whole vCenter's", () => {
    render(<VMwareHealthRuleOverridesCard onChanged={jest.fn()} />);
    const applies: HTMLElement = cell(
      "Applies To",
      override({ scope: VMwareHealthRuleScope.VCenter, rules: {} }),
    );
    expect(applies).toHaveTextContent("Whole vCenter");
    expect(applies).toHaveTextContent("vCenter vcsa-prod");
    expect(applies).toHaveTextContent("Everything in the vCenter");
  });

  test("what it changes, rule by rule, in the cards' words; a rule its kind cannot set is not listed", () => {
    render(<VMwareHealthRuleOverridesCard onChanged={jest.fn()} />);
    const changes: HTMLElement = cell(
      "Changes",
      override({
        scope: VMwareHealthRuleScope.Host,
        rules: {
          hostCpuWarningPercent: 99,
          hostEvaluationMinutes: 10,
          vmCpuReadyWarningPercent: null,
          // A host's override has no datastore rule.
          datastoreWarningPercent: 50,
        },
      }),
    );
    const cpu: Element = changes.querySelector(
      '[data-testid="vmware-health-rule-change-hostCpuWarningPercent"]',
    )!;
    expect(cpu).toHaveTextContent("Busy ESXi Hosts");
    expect(cpu).toHaveTextContent("CPU Warning Above");
    expect(cpu.textContent).toMatch(/99/);
    expect(
      changes.querySelector(
        '[data-testid="vmware-health-rule-change-hostEvaluationMinutes"]',
      )!.textContent,
    ).toMatch(/10/);
    expect(
      changes.querySelector(
        '[data-testid="vmware-health-rule-change-vmCpuReadyWarningPercent"]',
      ),
    ).toHaveTextContent("Off");
    expect(
      changes.querySelector(
        '[data-testid="vmware-health-rule-change-datastoreWarningPercent"]',
      ),
    ).toBeNull();
    expect(changes.querySelectorAll("li")).toHaveLength(3);
  });
});

describe("adding, editing and deleting", () => {
  test("Add Override opens the dialog for a new one; saving reads everything again", () => {
    const onChanged: jest.Mock = jest.fn();
    render(
      <VMwareHealthRuleOverridesCard
        onChanged={onChanged as unknown as () => void}
      />,
    );
    expect(screen.queryByTestId("override-modal")).toBeNull();

    act(() => {
      getTable().onCreateClick();
    });
    expect(screen.getByTestId("override-modal")).toBeInTheDocument();
    expect(modal!.override).toBeUndefined();

    const before: string = getTable().refreshToggle;
    act(() => {
      modal!.onSaved();
    });
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("override-modal")).toBeNull();
    // The table, and the book the dialog reads, are read again.
    expect(getTable().refreshToggle).not.toBe(before);
  });

  test("Edit opens the dialog on that override; closing it changes nothing", () => {
    const onChanged: jest.Mock = jest.fn();
    render(
      <VMwareHealthRuleOverridesCard
        onChanged={onChanged as unknown as () => void}
      />,
    );
    const item: VMwareHealthRuleOverride = override({
      scope: VMwareHealthRuleScope.Host,
      rules: { hostCpuWarningPercent: 99 },
    });
    const done: jest.Mock = jest.fn();
    act(() => {
      getTable().actionButtons[0]!.onClick(item, done as unknown as () => void);
    });
    expect(modal!.override).toBe(item);
    expect(done).toHaveBeenCalled();

    act(() => {
      modal!.onClose();
    });
    expect(screen.queryByTestId("override-modal")).toBeNull();
    expect(onChanged).not.toHaveBeenCalled();
  });

  test("deleting one gives the part back to the broader rules, and says so to the page", () => {
    const onChanged: jest.Mock = jest.fn();
    render(
      <VMwareHealthRuleOverridesCard
        onChanged={onChanged as unknown as () => void}
      />,
    );
    act(() => {
      getTable().onItemDeleted();
    });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});
