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
 * schedule - with a name to think of first. It asks three things now: the
 * range, the probe and the scan method, ICMP or SNMP, picked from two cards.
 * ICMP is picked for a new scan and needs nothing else, so Start New Scan
 * opens on one page; picking SNMP adds the credentials as a second step. The
 * name, the naming rules and the schedule fold under More fields on the
 * first step, and the button says what it does: Start Scan.
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

// The scan method's card for ICMP or SNMP (CardSelect's test ids).
function methodCard(method: "icmp" | "snmp"): HTMLElement {
  return within(dialog()).getByTestId(`card-select-option-${method}`);
}

async function pickMethod(method: "icmp" | "snmp"): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(methodCard(method));
  });
  await settle();
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
  window.history.replaceState(null, "", "/dashboard/network-devices/discovery");
});

afterEach(() => {
  cleanup();
  capturedModels = [];
});

describe("Start New Scan", () => {
  test("opens on one page with ICMP picked: no steps, no Next, Start Scan", async () => {
    await openStartScan();

    expect(methodCard("icmp")).toHaveAttribute("aria-checked", "true");
    expect(methodCard("snmp")).toHaveAttribute("aria-checked", "false");
    expect(progress()).toBeNull();
    expect(
      within(dialog()).queryByTestId("modal-footer-next-button"),
    ).toBeNull();
    expect(
      within(dialog()).getByTestId("modal-footer-submit-button"),
    ).toHaveTextContent("Start Scan");
  });

  test("asks three things: the range, the probe, and the scan method", async () => {
    await openStartScan();

    expect(
      within(dialog()).getByPlaceholderText(TARGET_PLACEHOLDER),
    ).toBeVisible();
    expect(within(dialog()).getByText("Branch Probe")).toBeVisible();

    // The two cards are one group, named by the field's label.
    const method: HTMLElement = within(dialog()).getByRole("radiogroup", {
      name: "Scan method",
    });

    expect(within(method).getAllByRole("radio")).toHaveLength(2);
    expect(within(method).getByText("ICMP (ping)")).toBeVisible();
    expect(within(method).getByText("SNMP")).toBeVisible();
    expect(
      within(dialog()).getByText("You can change this at any time."),
    ).toBeVisible();
    // The old switch and its five lines of help are gone.
    expect(within(dialog()).queryByRole("switch", { name: /SNMP/ })).toBeNull();
    expect(
      within(dialog()).queryByText(/Every scan pings each address/),
    ).toBeNull();
  });

  test("picking SNMP brings the credentials step: two steps, and Next", async () => {
    await openStartScan();

    await pickMethod("snmp");

    expect(methodCard("snmp")).toHaveAttribute("aria-checked", "true");
    expect(methodCard("icmp")).toHaveAttribute("aria-checked", "false");

    const steps: HTMLElement | null = progress();

    expect(steps).not.toBeNull();
    expect(within(steps!).getByText("Scan Target")).toBeInTheDocument();
    expect(within(steps!).getByText("SNMP Credentials")).toBeInTheDocument();
    // The schedule is no longer a step of its own.
    expect(within(steps!).queryByText("Schedule")).toBeNull();
    expect(
      within(dialog()).getByTestId("modal-footer-next-button"),
    ).toBeInTheDocument();
    expect(
      within(dialog()).queryByTestId("modal-footer-submit-button"),
    ).toBeNull();
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

  test("with SNMP, Next goes to the credentials, where the button reads Start Scan", async () => {
    await openStartScan();

    await pickMethod("snmp");

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

    await submit();

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

describe("an ICMP scan - the default - is one page", () => {
  test("an untouched form starts an ICMP scan of the range from the probe", async () => {
    await openStartScan();

    typeTarget("10.0.0.0/24");
    await submit();

    await waitFor(() => {
      expect(capturedModels).toHaveLength(1);
    });

    const model: JSONObject = capturedModels[0]!;

    expect(model["cidr"]).toBe("10.0.0.0/24");
    // Posted, not left out: the column itself defaults to SNMP.
    expect(model["isSnmpEnabled"]).toBe(false);
    expect(idOf(model["probe"])).toBe(PROBE_ID);
    // No credentials ride along on a scan that sends no SNMP.
    expect(model["snmpConfigs"] ?? null).toBeNull();
  });

  test("picking SNMP and then ICMP again drops the credentials step", async () => {
    await openStartScan();

    await pickMethod("snmp");
    expect(progress()).not.toBeNull();

    await pickMethod("icmp");

    expect(methodCard("icmp")).toHaveAttribute("aria-checked", "true");
    expect(progress()).toBeNull();
    expect(
      within(dialog()).queryByTestId("modal-footer-next-button"),
    ).toBeNull();
    expect(
      within(dialog()).getByTestId("modal-footer-submit-button"),
    ).toHaveTextContent("Start Scan");
  });

  test("picking the card already chosen changes nothing", async () => {
    await openStartScan();

    await pickMethod("icmp");

    expect(methodCard("icmp")).toHaveAttribute("aria-checked", "true");
    expect(progress()).toBeNull();
  });

  test("the cards answer to the keyboard: Enter on SNMP picks it", async () => {
    await openStartScan();

    await act(async (): Promise<void> => {
      fireEvent.keyDown(methodCard("snmp"), { key: "Enter" });
    });
    await settle();

    expect(methodCard("snmp")).toHaveAttribute("aria-checked", "true");
    expect(progress()).not.toBeNull();
  });
});

describe("an SNMP scan asks for its credentials, then starts", () => {
  test("posts the SNMP method with the credential list it was given", async () => {
    await openStartScan();

    await pickMethod("snmp");
    typeTarget("10.0.0.0/24");
    await clickNext();

    expect(
      within(dialog()).getByText("Credentials to try"),
    ).toBeInTheDocument();

    await submit();

    await waitFor(() => {
      expect(capturedModels).toHaveLength(1);
    });

    const model: JSONObject = capturedModels[0]!;

    expect(model["cidr"]).toBe("10.0.0.0/24");
    expect(model["isSnmpEnabled"]).toBe(true);
    expect(Array.isArray(model["snmpConfigs"])).toBe(true);
    expect((model["snmpConfigs"] as Array<unknown>).length).toBe(1);
  });
});
