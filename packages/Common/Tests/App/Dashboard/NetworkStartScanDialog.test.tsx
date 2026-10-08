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
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { JSONObject } from "../../../Types/JSON";
import Permission from "../../../Types/Permission";
import Route from "../../../Types/API/Route";
import { FormType, ModelField } from "../../../UI/Components/Forms/ModelForm";
import ModelFormModal from "../../../UI/Components/ModelFormModal/ModelFormModal";
import { ComponentProps as ModelTableProps } from "../../../UI/Components/ModelTable/ModelTable";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { listedNames } from "../../UI/Components/FoldedSection/FoldedSectionQueries";

/*
 * Start a scan, drawn for real.
 *
 * Discovering devices was a three-step wizard - target, credentials,
 * schedule - with a name to think of first. It is two steps now, and one
 * for a ping sweep: what to scan (the range, the probe, and whether to read
 * SNMP), then the credentials only when SNMP is on. The name, the naming
 * rules and the schedule fold under More fields on the first step, and the
 * button says what it does: Start Scan.
 *
 * The production page builds the wizard; only the table around it is
 * replaced, by the create dialog the real table opens. Saving goes through
 * the real ModelForm with the network stubbed.
 */

let capturedModels: Array<JSONObject> = [];

const PROBE_ID: string = "30000000-0000-4000-8000-000000000002";

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: <TBaseModel extends BaseModel>(
      props: ModelTableProps<TBaseModel>,
    ): ReactElement => {
      const verb: string = props.createVerb || "Create";
      const singularName: string =
        props.singularName || new props.modelType().singularName || "";

      // What the real table opens from its create button.
      return (
        <ModelFormModal<TBaseModel>
          title={`${verb} New ${singularName}`}
          name={`${props.name} > ${verb} New ${singularName}`}
          modelType={props.modelType}
          modalWidth={props.createEditModalWidth}
          initialValues={props.createInitialValues}
          submitButtonText={`${verb} ${singularName}`}
          onClose={() => {}}
          onSuccess={() => {}}
          onBeforeCreate={props.onBeforeCreate}
          formProps={{
            id: `create-${props.modelType.name}-from`,
            name: `create-${props.modelType.name}-from`,
            modelType: props.modelType,
            fields: (props.formFields || []).filter(
              (field: ModelField<TBaseModel>): boolean => {
                return !field.doNotShowWhenCreating;
              },
            ),
            steps: props.formSteps || [],
            formType: FormType.Create,
          }}
        />
      );
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
      getItem: async (): Promise<null> => {
        return null;
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
      }): Promise<{ data: JSONObject }> => {
        capturedModels.push(data.model);
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

const TARGET_PLACEHOLDER: string = "192.168.1.0/24";
const SNMP_SWITCH_NAME: string = "Check SNMP on hosts that answer";

function dialog(): HTMLElement {
  return screen.getByTestId("modal");
}

async function settle(): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  });
}

async function openStartScan(): Promise<void> {
  const props: PageComponentProps = {
    pageRoute: new Route("/dashboard/:projectId/network-devices/discovery"),
  } as unknown as PageComponentProps;

  render(
    <MemoryRouter>
      <DiscoveryPage {...props} />
    </MemoryRouter>,
  );

  expect(await screen.findByText("Start New Scan")).toBeInTheDocument();
  await settle();
}

function progress(): HTMLElement | null {
  return within(dialog()).queryByRole("navigation", { name: "Progress" });
}

function snmpSwitch(): HTMLElement {
  return within(dialog()).getByRole("switch", { name: SNMP_SWITCH_NAME });
}

function moreFields(): HTMLElement {
  const header: HTMLElement | undefined = within(dialog())
    .getAllByTestId("folded-section-header")
    .find((candidate: HTMLElement): boolean => {
      return (
        within(candidate).getByTestId("folded-section-title").textContent ===
        "More fields"
      );
    });

  if (!header) {
    throw new Error("No More fields fold in the dialog.");
  }

  return header;
}

function typeTarget(value: string): void {
  fireEvent.change(within(dialog()).getByPlaceholderText(TARGET_PLACEHOLDER), {
    target: { value },
  });
}

async function clickNext(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(within(dialog()).getByTestId("modal-footer-next-button"));
  });
  await settle();
}

async function submit(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(within(dialog()).getByTestId("modal-footer-submit-button"));
  });
}

function idOf(value: unknown): string {
  if (value && typeof value === "object") {
    const record: Record<string, unknown> = value as Record<string, unknown>;
    return String(record["_id"] || record["id"] || record["value"] || "");
  }

  return String(value || "");
}

beforeEach(() => {
  capturedModels = [];
  window.history.replaceState(
    null,
    "",
    "/dashboard/network-devices/discovery",
  );
});

afterEach(() => {
  cleanup();
  capturedModels = [];
});

describe("Start New Scan", () => {
  test("walks two steps: what to scan, then the credentials", async () => {
    await openStartScan();

    const steps: HTMLElement | null = progress();

    expect(steps).not.toBeNull();
    expect(within(steps!).getByText("Scan Target")).toBeInTheDocument();
    expect(within(steps!).getByText("SNMP Credentials")).toBeInTheDocument();
    // The schedule is no longer a step of its own.
    expect(within(steps!).queryByText("Schedule")).toBeNull();
  });

  test("asks three things first: the range, the probe, and whether to read SNMP", async () => {
    await openStartScan();

    expect(
      within(dialog()).getByPlaceholderText(TARGET_PLACEHOLDER),
    ).toBeVisible();
    expect(within(dialog()).getByText("Branch Probe")).toBeVisible();
    expect(snmpSwitch()).toHaveAttribute("aria-checked", "true");
  });

  test("starts on the project's only custom probe", async () => {
    await openStartScan();

    expect(within(dialog()).getByText("Branch Probe")).toBeVisible();
  });

  test("folds the name, the naming rules and the schedule under More fields", async () => {
    await openStartScan();

    const header: HTMLElement = moreFields();

    expect(header).toHaveAttribute("aria-expanded", "false");

    const names: Array<string> = listedNames(header);

    expect(names[0]).toBe("Name");
    expect(names).toContain("Repeat this scan");
    expect(names).toContain("Name devices by their short hostname");
    expect(
      within(dialog()).getByPlaceholderText("Router Discovery - Region 1100"),
    ).not.toBeVisible();
  });

  test("Next goes to the credentials, where the button reads Start Scan", async () => {
    await openStartScan();

    expect(
      within(dialog()).queryByTestId("modal-footer-submit-button"),
    ).toBeNull();

    typeTarget("10.0.0.0/24");
    await clickNext();

    expect(
      within(dialog()).queryByPlaceholderText(TARGET_PLACEHOLDER),
    ).toBeNull();
    expect(
      within(dialog()).getByTestId("modal-footer-submit-button"),
    ).toHaveTextContent("Start Scan");
  });

  test("an empty range is asked for on the first step, and nothing is sent", async () => {
    await openStartScan();

    await clickNext();

    await waitFor(() => {
      expect(
        within(dialog()).getByText("Scan Target is required."),
      ).toBeInTheDocument();
    });
    expect(
      within(dialog()).getByPlaceholderText(TARGET_PLACEHOLDER),
    ).toBeVisible();
    expect(capturedModels).toEqual([]);
  });
});

describe("a ping sweep (SNMP off) is one page", () => {
  test("turning SNMP off drops the credentials step: no step list, no Next", async () => {
    await openStartScan();

    fireEvent.click(snmpSwitch());
    await settle();

    expect(snmpSwitch()).toHaveAttribute("aria-checked", "false");
    expect(progress()).toBeNull();
    expect(
      within(dialog()).queryByTestId("modal-footer-next-button"),
    ).toBeNull();
    expect(
      within(dialog()).getByTestId("modal-footer-submit-button"),
    ).toHaveTextContent("Start Scan");
  });

  test("starts the sweep with the range and the probe, and SNMP off", async () => {
    await openStartScan();

    typeTarget("10.0.0.0/24");
    fireEvent.click(snmpSwitch());
    await settle();

    await submit();

    await waitFor(() => {
      expect(capturedModels).toHaveLength(1);
    });

    const model: JSONObject = capturedModels[0]!;

    expect(model["cidr"]).toBe("10.0.0.0/24");
    expect(model["isSnmpEnabled"]).toBe(false);
    expect(idOf(model["probe"])).toBe(PROBE_ID);
  });

  test("turning SNMP back on brings the credentials step back", async () => {
    await openStartScan();

    fireEvent.click(snmpSwitch());
    await settle();
    fireEvent.click(snmpSwitch());
    await settle();

    expect(progress()).not.toBeNull();
    expect(
      within(dialog()).getByTestId("modal-footer-next-button"),
    ).toBeInTheDocument();
  });
});
