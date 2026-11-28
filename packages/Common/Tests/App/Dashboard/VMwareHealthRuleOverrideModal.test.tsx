import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import React from "react";
import {
  chooseDropdownOption,
  listDropdownOptions,
  pickDropdownOption,
  readDropdownOptions,
} from "../../DropdownPicks";
import VMwareHealthRuleOverrideModal, {
  PART_SEARCH_PAUSE_MS,
  VMWARE_HEALTH_RULE_OVERRIDE_MODAL_TEST_ID,
  getVMwareHealthRuleOverrideRulesFromRows,
} from "../../../../App/FeatureSet/Dashboard/src/Components/VMware/HealthRules/VMwareHealthRuleOverrideModal";
import VMwareHealthRuleOverride from "../../../Models/DatabaseModels/VMwareHealthRuleOverride";
import VMwareResource from "../../../Models/DatabaseModels/VMwareResource";
import VMwareVCenter from "../../../Models/DatabaseModels/VMwareVCenter";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import Search from "../../../Types/BaseDatabase/Search";
import { VMwareResourceKind } from "../../../Types/Monitor/MonitorStepVMwareMonitor";
import ObjectID from "../../../Types/ObjectID";
import {
  VMWARE_HEALTH_RULE_OVERRIDE_THRESHOLD_ERROR,
  VMWARE_HEALTH_RULE_OVERRIDE_WAIT_ERROR,
  VMwareHealthRuleBook,
  VMwareHealthRuleScope,
  getVMwareHealthRuleBook,
} from "../../../Types/VMware/VMwareHealthRuleOverrides";
import { DEFAULT_VMWARE_HEALTH_RULES } from "../../../Types/VMware/VMwareHealthRules";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import Toast from "../../../UI/Utils/Toast";

/*
 * Add Override and Edit Override (#11469): where a vCenter's, a cluster's,
 * a host's or a VM's own health rules apply, the rules they change and what
 * each replaces, as a person makes them. Only the network is replaced
 * (ModelAPI): the dialog, its pickers and its checks are the real ones.
 */

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

jest.mock("../../../UI/Components/Icon/Icon", () => {
  return {
    __esModule: true,
    default: () => {
      return null;
    },
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const PROD: string = "20000000-0000-4000-8000-000000000001";
const LAB: string = "20000000-0000-4000-8000-000000000002";

interface ListCall {
  modelType: unknown;
  query: Record<string, unknown>;
  limit: number;
}

let listCalls: Array<ListCall> = [];
let createSpy: jest.SpiedFunction<typeof ModelAPI.create>;
let updateSpy: jest.SpiedFunction<typeof ModelAPI.updateById>;
let toastSpy: jest.SpiedFunction<typeof Toast.success>;

function vcenter(id: string, name: string): VMwareVCenter {
  const row: VMwareVCenter = new VMwareVCenter();
  row._id = id;
  row.name = name;
  return row;
}

function part(fields: Partial<VMwareResource>): VMwareResource {
  return Object.assign(new VMwareResource(), fields);
}

const PARTS: Array<VMwareResource> = [
  part({
    kind: VMwareResourceKind.Host,
    externalId: "host/DC-NORTH/esx-07",
    name: "esx-07",
    datacenterName: "DC-NORTH",
    clusterName: "cluster-a",
  }),
  part({
    kind: VMwareResourceKind.VirtualMachine,
    externalId: "vm/web-01",
    name: "web-01",
    datacenterName: "DC-NORTH",
    clusterName: "cluster-a",
    hostName: "esx-07",
  }),
  part({
    kind: VMwareResourceKind.VirtualMachine,
    externalId: "vm/db-01",
    name: "db-01",
    datacenterName: "DC-NORTH",
    clusterName: "cluster-a",
    hostName: "esx-07",
  }),
];

function listResult<T>(data: Array<T>): ListResult<T> {
  return {
    data,
    count: data.length,
    skip: 0,
    limit: data.length,
  } as unknown as ListResult<T>;
}

beforeEach(() => {
  listCalls = [];
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(ModelAPI, "getList").mockImplementation((async (
    call: ListCall,
  ) => {
    listCalls.push(call);
    if (call.modelType === VMwareVCenter) {
      return listResult([vcenter(PROD, "vcsa-prod"), vcenter(LAB, "vcsa-lab")]);
    }
    const search: unknown = call.query["name"];
    return listResult(
      PARTS.filter((row: VMwareResource): boolean => {
        return (
          row.kind === call.query["kind"] &&
          (!(search instanceof Search) || row.name!.includes(search.toString()))
        );
      }),
    );
  }) as never);
  createSpy = jest.spyOn(ModelAPI, "create").mockResolvedValue({} as never);
  updateSpy = jest.spyOn(ModelAPI, "updateById").mockResolvedValue({} as never);
  toastSpy = jest.spyOn(Toast, "success").mockImplementation(() => {
    return undefined as never;
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function renderModal(
  props: {
    override?: VMwareHealthRuleOverride;
    book?: VMwareHealthRuleBook;
  } = {},
): { onSaved: jest.Mock; onClose: jest.Mock } {
  const onSaved: jest.Mock = jest.fn();
  const onClose: jest.Mock = jest.fn();
  render(
    <VMwareHealthRuleOverrideModal
      override={props.override}
      book={props.book || getVMwareHealthRuleBook()}
      onSaved={onSaved as unknown as () => void}
      onClose={onClose as unknown as () => void}
    />,
  );
  return { onSaved, onClose };
}

function dialog(): HTMLElement {
  return screen.getByTestId(VMWARE_HEALTH_RULE_OVERRIDE_MODAL_TEST_ID);
}

/*
 * Picks a choice once it has arrived. A wait never opens a menu itself:
 * opening one changes the page, which would run the wait again at once,
 * before the read it waits for could land.
 */
async function pickVCenter(name: string): Promise<void> {
  await pickDropdownOption(screen.getByLabelText("vCenter"), name);
}

// The parts the dialog last read, once that read has landed.
async function partsRead(): Promise<void> {
  await waitFor(() => {
    expect(
      listCalls.some((call: ListCall): boolean => {
        return call.modelType === VMwareResource;
      }),
    ).toBe(true);
  });
}

function addRule(label: string | number): void {
  fireEvent.click(screen.getByTestId("vmware-health-rule-override-add-rule"));
  const pickers: Array<HTMLElement> = screen.getAllByRole("combobox", {
    name: "Choose a rule",
  });
  chooseDropdownOption(pickers[pickers.length - 1]!, label);
}

function setValue(index: number, value: string): void {
  fireEvent.change(
    screen.getByTestId(`vmware-health-rule-override-row-${index}-value`),
    { target: { value } },
  );
}

function save(name: string = "Add Override"): void {
  fireEvent.click(screen.getByRole("button", { name }));
}

function savedOverride(): VMwareHealthRuleOverride {
  expect(createSpy).toHaveBeenCalledTimes(1);
  return (
    createSpy.mock.calls[0]![0] as unknown as {
      model: VMwareHealthRuleOverride;
    }
  ).model;
}

describe("adding an override", () => {
  test("a whole vCenter's: pick it, add a rule, see what it replaces, save", async () => {
    const { onSaved } = renderModal();
    await pickVCenter("vcsa-lab");

    // A whole vCenter is the default, and has no part to pick.
    expect(screen.queryByLabelText("Which One")).toBeNull();
    expect(
      within(dialog()).getByText(
        "Add the rules this one changes. Every other rule stays as it is.",
      ),
    ).toBeVisible();

    addRule("CPU Warning Above");
    expect(within(dialog()).getByText("Busy ESXi Hosts")).toBeVisible();
    // The project's 90%, as its card says it.
    expect(within(dialog()).getByText(/^Instead of: /).textContent).toMatch(
      /^Instead of: .*90/,
    );
    setValue(0, "95");
    save();

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
    });
    const model: VMwareHealthRuleOverride = savedOverride();
    expect({
      projectId: model.projectId?.toString(),
      vmwareVCenterId: model.vmwareVCenterId?.toString(),
      scope: model.scope,
      resourceExternalId: model.resourceExternalId,
      rules: model.rules,
    }).toEqual({
      projectId: PROJECT_ID.toString(),
      vmwareVCenterId: LAB,
      scope: VMwareHealthRuleScope.VCenter,
      resourceExternalId: undefined,
      rules: { hostCpuWarningPercent: 95 },
    });
    // Where it sits is the server's to copy from the part, never sent.
    expect(model.resourceName).toBeUndefined();
    expect(model.hostName).toBeUndefined();
    expect(toastSpy).toHaveBeenCalledWith("Override saved");
  });

  test("a VM's: its VMs searched in the vCenter, a template never, the rule turned off", async () => {
    const { onSaved } = renderModal();
    await pickVCenter("vcsa-prod");
    chooseDropdownOption(
      screen.getByLabelText("Applies To"),
      "Virtual Machine",
    );

    const which: HTMLElement = screen.getByLabelText("Which One");
    await partsRead();
    const vmReads: Array<ListCall> = listCalls.filter((call: ListCall) => {
      return call.modelType === VMwareResource;
    });
    expect(vmReads[vmReads.length - 1]!.query).toEqual({
      vmwareVCenterId: new ObjectID(PROD),
      kind: VMwareResourceKind.VirtualMachine,
      isTemplate: false,
    });
    expect(vmReads[vmReads.length - 1]!.limit).toBe(50);

    // Each says where it sits, so two of one name are told apart.
    const offeredVms: string = (await listDropdownOptions(which)).join("|");
    expect(offeredVms).toContain("web-01");
    expect(offeredVms).toContain("db-01");
    expect(offeredVms).toContain("cluster-a · DC-NORTH");

    // Typing asks once it pauses, by name.
    jest.useFakeTimers();
    const before: number = listCalls.length;
    fireEvent.change(which, { target: { value: "web" } });
    await act(async () => {
      jest.advanceTimersByTime(PART_SEARCH_PAUSE_MS - 1);
    });
    expect(listCalls.length).toBe(before);
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    const searched: ListCall = listCalls[listCalls.length - 1]!;
    expect(searched.query["name"]).toBeInstanceOf(Search);
    expect((searched.query["name"] as Search<string>).toString()).toBe("web");
    jest.useRealTimers();

    await pickDropdownOption(which, /web-01/);

    // A VM's override has no host or datastore rule to choose.
    fireEvent.click(screen.getByTestId("vmware-health-rule-override-add-rule"));
    const picker: HTMLElement = screen.getAllByRole("combobox", {
      name: "Choose a rule",
    })[0]!;
    // The VM cards' rules alone, in the cards' order.
    expect(readDropdownOptions(picker)).toEqual([
      "Swapping Out: Critical Above",
      "Reading Back: Warning Above",
      "Swapped Earlier: Warning Above",
      "For At Least",
      "Ballooned: Warning Above",
      "CPU Ready: Warning Above",
      "For At Least",
    ]);
    chooseDropdownOption(picker, "CPU Ready: Warning Above");
    fireEvent.click(
      screen.getByTestId("vmware-health-rule-override-row-0-off"),
    );
    // Off: its value is not asked (the shared Input locks it read-only).
    expect(
      screen.getByTestId("vmware-health-rule-override-row-0-value"),
    ).toHaveAttribute("readonly");
    save();

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
    });
    const model: VMwareHealthRuleOverride = savedOverride();
    expect(model.scope).toBe(VMwareHealthRuleScope.VirtualMachine);
    expect(model.resourceExternalId).toBe("vm/web-01");
    expect(model.vmwareVCenterId?.toString()).toBe(PROD);
    expect(model.rules).toEqual({ vmCpuReadyWarningPercent: null });
  });

  test("what a rule replaces is the broader override's, not the project's", async () => {
    renderModal({
      book: getVMwareHealthRuleBook(DEFAULT_VMWARE_HEALTH_RULES, [
        {
          id: "cluster-a's",
          vmwareVCenterId: PROD,
          scope: VMwareHealthRuleScope.Cluster,
          resourceExternalId: "cluster/DC-NORTH/cluster-a",
          datacenterName: "DC-NORTH",
          clusterName: "cluster-a",
          hostName: null,
          rules: { hostCpuWarningPercent: 99 },
        },
      ]),
    });
    await pickVCenter("vcsa-prod");
    chooseDropdownOption(screen.getByLabelText("Applies To"), "ESXi Host");
    await pickDropdownOption(screen.getByLabelText("Which One"), /esx-07/);
    addRule("CPU Warning Above");
    expect(within(dialog()).getByText(/^Instead of: /).textContent).toContain(
      "99",
    );
  });
});

describe("what is refused before anything is sent", () => {
  test("no vCenter, no part, no rule, a row with no rule, a value missing", async () => {
    renderModal();
    save();
    expect(await screen.findByText("Choose a vCenter.")).toBeVisible();

    await pickVCenter("vcsa-prod");
    chooseDropdownOption(screen.getByLabelText("Applies To"), "ESXi Host");
    save();
    expect(
      await screen.findByText("Choose which one the rules apply to."),
    ).toBeVisible();

    chooseDropdownOption(screen.getByLabelText("Applies To"), "Whole vCenter");
    save();
    expect(
      await screen.findByText(
        "Add at least one rule, or close without saving.",
      ),
    ).toBeVisible();

    fireEvent.click(screen.getByTestId("vmware-health-rule-override-add-rule"));
    save();
    expect(
      await screen.findByText(
        "Choose a rule for every row, or remove the row.",
      ),
    ).toBeVisible();

    chooseDropdownOption(
      screen.getByRole("combobox", { name: "Choose a rule" }),
      "Memory Warning Above",
    );
    save();
    expect(
      await screen.findByText(
        "Enter a whole number for every rule, or turn it off.",
      ),
    ).toBeVisible();

    expect(createSpy).not.toHaveBeenCalled();
  });

  test("a percent above 100 and a wait past 30 minutes, in the rules' own words", async () => {
    renderModal();
    await pickVCenter("vcsa-prod");
    addRule("Memory Warning Above");
    setValue(0, "150");
    save();
    expect(
      await screen.findByText(VMWARE_HEALTH_RULE_OVERRIDE_THRESHOLD_ERROR),
    ).toBeVisible();

    // The third choice, the hosts' card's "For At Least": each card has one.
    fireEvent.click(
      screen.getByTestId("vmware-health-rule-override-row-0-remove"),
    );
    addRule(2);
    setValue(0, "45");
    save();
    expect(
      await screen.findByText(VMWARE_HEALTH_RULE_OVERRIDE_WAIT_ERROR),
    ).toBeVisible();
    expect(createSpy).not.toHaveBeenCalled();
  });

  test("a save the server refuses says why, and keeps the dialog open", async () => {
    createSpy.mockRejectedValue(
      new Error(
        "That already has rules of its own. Edit them instead of adding another.",
      ),
    );
    const { onSaved } = renderModal();
    await pickVCenter("vcsa-prod");
    addRule("CPU Warning Above");
    setValue(0, "95");
    save();
    expect(
      await screen.findByText(
        "That already has rules of its own. Edit them instead of adding another.",
      ),
    ).toBeVisible();
    expect(onSaved).not.toHaveBeenCalled();
    expect(dialog()).toBeVisible();
  });
});

describe("editing an override", () => {
  function hostOverride(): VMwareHealthRuleOverride {
    const override: VMwareHealthRuleOverride = new VMwareHealthRuleOverride();
    override._id = "30000000-0000-4000-8000-000000000001";
    override.vmwareVCenterId = new ObjectID(PROD);
    override.scope = VMwareHealthRuleScope.Host;
    override.resourceExternalId = "host/DC-NORTH/esx-07";
    override.resourceName = "esx-07";
    override.datacenterName = "DC-NORTH";
    override.clusterName = "cluster-a";
    override.hostName = "esx-07";
    override.rules = { hostCpuWarningPercent: 95, hostEvaluationMinutes: 10 };
    return override;
  }

  test("says where it applies, holds its own rules, and sends only the rules", async () => {
    const { onSaved } = renderModal({ override: hostOverride() });

    expect(
      screen.getByTestId("vmware-health-rule-override-where"),
    ).toHaveTextContent("ESXi Host esx-07");
    // Nothing about where it applies is asked again.
    expect(screen.queryByLabelText("vCenter")).toBeNull();
    expect(
      screen.getByTestId("vmware-health-rule-override-row-0-value"),
    ).toHaveValue(95);
    expect(
      screen.getByTestId("vmware-health-rule-override-row-1-value"),
    ).toHaveValue(10);

    setValue(0, "97");
    save("Save Changes");
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
    });
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        modelType: VMwareHealthRuleOverride,
        data: {
          rules: { hostCpuWarningPercent: 97, hostEvaluationMinutes: 10 },
        },
      }),
    );
    expect(createSpy).not.toHaveBeenCalled();
    expect(listCalls).toEqual([]);
  });

  test("a rule removed is inherited again", async () => {
    const { onSaved } = renderModal({ override: hostOverride() });
    fireEvent.click(
      screen.getByTestId("vmware-health-rule-override-row-1-remove"),
    );
    save("Save Changes");
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });
    expect(
      (updateSpy.mock.calls[0]![0] as unknown as { data: unknown }).data,
    ).toEqual({ rules: { hostCpuWarningPercent: 95 } });
  });

  test("what it replaces leaves its own rules out", async () => {
    const override: VMwareHealthRuleOverride = hostOverride();
    renderModal({
      override,
      book: getVMwareHealthRuleBook(DEFAULT_VMWARE_HEALTH_RULES, [
        {
          id: override._id!,
          vmwareVCenterId: PROD,
          scope: VMwareHealthRuleScope.Host,
          resourceExternalId: "host/DC-NORTH/esx-07",
          datacenterName: "DC-NORTH",
          clusterName: "cluster-a",
          hostName: "esx-07",
          rules: { hostCpuWarningPercent: 95 },
        },
      ]),
    });
    const replaced: Array<string> = within(dialog())
      .getAllByText(/^Instead of: /)
      .map((element: HTMLElement): string => {
        return element.textContent || "";
      });
    // The project's 90%, not its own 95%.
    expect(replaced[0]).toContain("90");
    expect(replaced[0]).not.toContain("95");
  });
});

describe("the rows, as the override's rules", () => {
  test("a value per rule, a threshold off as nothing", () => {
    expect(
      getVMwareHealthRuleOverrideRulesFromRows([
        { key: "hostCpuWarningPercent", value: " 95 ", isOff: false },
        { key: "vmCpuReadyWarningPercent", value: "", isOff: true },
        { key: "hostEvaluationMinutes", value: "0", isOff: false },
      ]),
    ).toEqual({
      rules: {
        hostCpuWarningPercent: 95,
        vmCpuReadyWarningPercent: null,
        hostEvaluationMinutes: 0,
      },
      error: null,
    });
  });

  test("a wait cannot be turned off: its value is still asked", () => {
    expect(
      getVMwareHealthRuleOverrideRulesFromRows([
        { key: "hostEvaluationMinutes", value: "", isOff: true },
      ]).error,
    ).toBe("Enter a whole number for every rule, or turn it off.");
  });

  test("no rows, a row with no rule, and a value that is not whole are each refused", () => {
    expect(getVMwareHealthRuleOverrideRulesFromRows([]).error).toBe(
      "Add at least one rule, or close without saving.",
    );
    expect(
      getVMwareHealthRuleOverrideRulesFromRows([
        { key: null, value: "1", isOff: false },
      ]).error,
    ).toBe("Choose a rule for every row, or remove the row.");
    for (const value of ["", "  ", "2.5", "lots"]) {
      expect(
        getVMwareHealthRuleOverrideRulesFromRows([
          { key: "hostCpuWarningPercent", value, isOff: false },
        ]).error,
      ).toBe("Enter a whole number for every rule, or turn it off.");
    }
  });
});
