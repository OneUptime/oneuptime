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
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { JSONObject } from "../../../Types/JSON";
import Permission from "../../../Types/Permission";
import Route from "../../../Types/API/Route";
import { FormType } from "../../../UI/Components/Forms/ModelForm";
import NetworkDeviceDiscoveryScan from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";

/*
 * Editing a scan's method, in the real Edit dialog.
 *
 * Start New Scan starts on ICMP, but the Edit dialog shows a scan as it is
 * stored: an ICMP scan opens on ICMP, an SNMP scan on SNMP (with its
 * credentials one step away), and a scan stored before the method existed
 * on SNMP - the sweep it has always run. A form default only fills a value
 * that is undefined, never a stored one; these tests hold the dialog to that
 * with the real ModelFormModal, ModelForm and BasicForm, the network stubbed.
 *
 * Only the scans table is replaced, by one that hands its row actions to the
 * test: the page opens its own Edit dialog from the Edit action.
 */

configure({ asyncUtilTimeout: 15000 });

type RowAction = {
  title?: string | undefined;
  onClick?:
    | ((item: NetworkDeviceDiscoveryScan, done: () => void) => Promise<void>)
    | undefined;
};

let capturedActions: Array<RowAction> = [];
let storedScan: JSONObject = {};
let savedModels: Array<{ model: JSONObject; formType: unknown }> = [];

const SCAN_ID: string = "40000000-0000-4000-8000-000000000004";
const PROBE_ID: string = "30000000-0000-4000-8000-000000000002";

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: { actionButtons?: Array<RowAction> }): null => {
      capturedActions = props.actionButtons || [];
      return null;
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: async (): Promise<number> => {
        return 0;
      },
      getItem: async (): Promise<unknown> => {
        const ScanClass: any = (
          jest.requireActual(
            "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan",
          ) as any
        ).default;

        return Object.assign(new ScanClass(), storedScan);
      },
      getList: async (): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        return { data: [], count: 0, skip: 0, limit: 0 };
      },
      getCommonHeaders: (): JSONObject => {
        return {};
      },
      createOrUpdate: async (data: {
        model: JSONObject;
        formType: unknown;
      }): Promise<{ data: JSONObject }> => {
        savedModels.push({ model: data.model, formType: data.formType });
        return { data: data.model };
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return [Permission.ProjectOwner, Permission.User, Permission.Public];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<Permission> } => {
        return {
          globalPermissions: [
            Permission.ProjectOwner,
            Permission.User,
            Permission.Public,
          ],
        };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const ObjectIDClass: any = jest.requireActual(
          "../../../Types/ObjectID",
        ) as any;
        return new ObjectIDClass.default(
          "11111111-1111-4111-8111-111111111111",
        );
      },
    },
  };
});

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/Probe", () => {
  return {
    __esModule: true,
    default: {
      getAllProbes: async (): Promise<Array<unknown>> => {
        const ProbeClass: any = jest.requireActual(
          "../../../Models/DatabaseModels/Probe",
        ) as any;
        const probe: any = new ProbeClass.default();
        probe._id = "30000000-0000-4000-8000-000000000002";
        probe.name = "Branch Probe";
        probe.isGlobalProbe = false;
        return [probe];
      },
    },
  };
});

import DiscoveryPage from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/Discovery";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";

const SNMP_CONFIG: JSONObject = {
  id: "core-v2c",
  snmpVersion: "V2c",
  snmpCommunityString: "campus-ro",
  snmpPort: 161,
};

function storedAs(fields: JSONObject): JSONObject {
  return {
    _id: SCAN_ID,
    cidr: "10.20.30.0/24",
    probeId: PROBE_ID,
    probe: { _id: PROBE_ID, name: "Branch Probe" },
    isRecurring: false,
    isNetbiosLookupEnabled: false,
    useShortDeviceNames: false,
    ...fields,
  };
}

async function settle(): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  });
}

function dialog(): HTMLElement {
  return screen.getByTestId("modal");
}

function methodCard(method: "icmp" | "snmp"): HTMLElement {
  return within(dialog()).getByTestId(`card-select-option-${method}`);
}

function progress(): HTMLElement | null {
  return within(dialog()).queryByRole("navigation", { name: "Progress" });
}

async function openEdit(stored: JSONObject): Promise<void> {
  storedScan = stored;

  const props: PageComponentProps = {
    pageRoute: new Route("/dashboard/:projectId/network-devices/discovery"),
  } as unknown as PageComponentProps;

  render(
    <MemoryRouter>
      <DiscoveryPage {...props} />
    </MemoryRouter>,
  );

  await waitFor(() => {
    expect(capturedActions.length).toBeGreaterThan(0);
  });

  const edit: RowAction | undefined = capturedActions.find(
    (action: RowAction): boolean => {
      return action.title === "Edit";
    },
  );

  const row: NetworkDeviceDiscoveryScan = Object.assign(
    new NetworkDeviceDiscoveryScan(),
    storedAs({}),
  );

  await act(async (): Promise<void> => {
    await edit!.onClick!(row, (): void => {});
  });

  await waitFor(() => {
    expect(
      within(dialog()).getByTestId("card-select-option-icmp"),
    ).toBeInTheDocument();
  });
  await settle();
}

async function pick(method: "icmp" | "snmp"): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(methodCard(method));
  });
  await settle();
}

async function save(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(within(dialog()).getByTestId("modal-footer-submit-button"));
  });
}

async function openLastStep(): Promise<void> {
  const steps: Array<HTMLElement> = within(progress()!).getAllByRole(
    "listitem",
  );

  await act(async (): Promise<void> => {
    fireEvent.click(steps[steps.length - 1]!);
  });
  await settle();
}

beforeEach(() => {
  capturedActions = [];
  savedModels = [];
  storedScan = {};
  window.history.replaceState(null, "", "/dashboard/network-devices/discovery");
});

afterEach(() => {
  cleanup();
});

describe("the Edit dialog opens on the method the scan has", () => {
  test("an ICMP scan opens on ICMP: one page, with Save Changes on it", async () => {
    await openEdit(storedAs({ isSnmpEnabled: false }));

    expect(methodCard("icmp")).toHaveAttribute("aria-checked", "true");
    expect(methodCard("snmp")).toHaveAttribute("aria-checked", "false");
    expect(progress()).toBeNull();
    expect(
      within(dialog()).getByTestId("modal-footer-submit-button"),
    ).toHaveTextContent("Save Changes");
  });

  test("an SNMP scan opens on SNMP, its credentials a step away", async () => {
    await openEdit(
      storedAs({ isSnmpEnabled: true, snmpConfigs: [SNMP_CONFIG] }),
    );

    expect(methodCard("snmp")).toHaveAttribute("aria-checked", "true");
    expect(methodCard("icmp")).toHaveAttribute("aria-checked", "false");
    expect(progress()).not.toBeNull();
    expect(within(progress()!).getByText("SNMP Credentials")).toBeVisible();
  });

  /*
   * A scan stored before the column existed, or read without it: SNMP, the
   * sweep every scan ran then - never the form's ICMP default.
   */
  test("a scan with no method stored opens on SNMP, never on the new-scan default", async () => {
    await openEdit(storedAs({ snmpConfigs: [SNMP_CONFIG] }));

    expect(methodCard("snmp")).toHaveAttribute("aria-checked", "true");
    expect(progress()).not.toBeNull();
  });
});

describe("changing the method in the Edit dialog", () => {
  test("an SNMP scan switched to ICMP saves ICMP, and no credentials ride along", async () => {
    await openEdit(
      storedAs({ isSnmpEnabled: true, snmpConfigs: [SNMP_CONFIG] }),
    );

    await pick("icmp");

    // The credentials step leaves with the method.
    expect(progress()).toBeNull();

    await save();

    await waitFor(() => {
      expect(savedModels).toHaveLength(1);
    });

    const saved: JSONObject = savedModels[0]!.model;

    expect(savedModels[0]!.formType).toBe(FormType.Update);
    expect(saved["isSnmpEnabled"]).toBe(false);
    expect(saved["snmpConfigs"] ?? null).toBeNull();
  });

  test("an ICMP scan switched to SNMP asks for credentials, then saves SNMP with them", async () => {
    await openEdit(storedAs({ isSnmpEnabled: false }));

    await pick("snmp");

    expect(progress()).not.toBeNull();

    await openLastStep();

    expect(
      within(dialog()).getByText("Credentials to try"),
    ).toBeInTheDocument();

    await save();

    await waitFor(() => {
      expect(savedModels).toHaveLength(1);
    });

    const saved: JSONObject = savedModels[0]!.model;

    expect(saved["isSnmpEnabled"]).toBe(true);
    expect(Array.isArray(saved["snmpConfigs"])).toBe(true);
    expect((saved["snmpConfigs"] as Array<unknown>).length).toBe(1);
  });

  test("the warning says a changed method runs the scan again", async () => {
    await openEdit(storedAs({ isSnmpEnabled: false }));

    expect(dialog()).toHaveTextContent(
      "Changing the target, probe, scan method or credentials runs the scan again",
    );
    expect(dialog()).toHaveTextContent(
      "The hosts its last run found are cleared. Devices you already imported stay as they are.",
    );

    /*
     * One note, under the form and set apart from its last field: it used
     * to sit flush against More fields.
     */
    const note: HTMLElement = within(dialog()).getByTestId(
      "discovery-scan-edit-rerun-note",
    );
    expect(note).toHaveTextContent(
      "Changing the target, probe, scan method or credentials runs the scan again",
    );
    expect(note).toHaveClass("mt-6");
  });
});
