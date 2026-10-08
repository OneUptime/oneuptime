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
import {
  getByTextOutsideFoldedHeaders,
  listedNames,
  setChips,
} from "../../UI/Components/FoldedSection/FoldedSectionQueries";

/*
 * The Add Device form, drawn for real.
 *
 * "If you look at the network product, it is a little complicated to use. It
 * has so many options. It confuses people." (the maintainer) Adding a device
 * was a three-step wizard of fourteen fields. It is one page now: the
 * hostname, a name (optional - the device is named after its hostname), the
 * site and the probe, with SNMP and the rarely needed fields folded, and
 * Add Device on screen from the start.
 *
 * The production page builds the form; only the table around it is
 * replaced, by the create dialog the real table opens (ModelTable's
 * showCreateEditModal: its title and button from createVerb and
 * singularName, the create fields, the steps, onBeforeCreate). Saving goes
 * through the real ModelForm with the network stubbed, so what the page
 * SENDS is checked too.
 */

let capturedModels: Array<JSONObject> = [];

const PROBE_ID: string = "30000000-0000-4000-8000-000000000001";

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
        probe._id = "30000000-0000-4000-8000-000000000001";
        probe.name = "HQ Probe";
        probe.isGlobalProbe = false;
        return [probe];
      },
    },
  };
});

// The facet bar and the summary strip fetch on mount; not this file's subject.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/useResourceOwners",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/useResourceOwners",
    ) as Record<string, unknown>;

    return {
      ...actual,
      __esModule: true,
      default: () => {
        return {
          filterBar: null,
          emptyState: {},
          mergeFiltersIntoQuery: (
            base: Record<string, unknown> | undefined,
          ) => {
            return base || {};
          },
          hasActiveFilters: false,
          facetSelections: {},
          facetOperators: {},
          setFacetSelection: () => {},
          clearAllFacets: () => {},
          facetSaveState: {},
          restoreFacetState: () => {},
        };
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceSummaryCards",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

import NetworkDevicesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/Devices";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";

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

async function openAddDevice(): Promise<void> {
  const props: PageComponentProps = {
    pageRoute: new Route("/dashboard/:projectId/network-devices"),
  } as unknown as PageComponentProps;

  render(
    <MemoryRouter>
      <NetworkDevicesPage {...props} />
    </MemoryRouter>,
  );

  expect(await screen.findByText("Add New Device")).toBeInTheDocument();
  await settle();
}

// A folded section of the dialog, by its title as read on screen.
function foldNamed(title: string): HTMLElement {
  const header: HTMLElement | undefined = within(dialog())
    .getAllByTestId("folded-section-header")
    .find((candidate: HTMLElement): boolean => {
      return (
        within(candidate).getByTestId("folded-section-title").textContent ===
        title
      );
    });

  if (!header) {
    throw new Error(`No folded section titled "${title}" in the dialog.`);
  }

  return header;
}

// The header is the fold's own button.
function toggleFold(title: string): void {
  fireEvent.click(foldNamed(title));
}

// The dropdown of the field with this title.
function comboboxOf(title: string): HTMLElement {
  let node: HTMLElement | null = getByTextOutsideFoldedHeaders(dialog(), title);

  while (node) {
    const combobox: HTMLElement | null =
      node.querySelector<HTMLElement>('[role="combobox"]');

    if (combobox) {
      return combobox;
    }

    node = node.parentElement;
  }

  throw new Error(`No dropdown found for "${title}".`);
}

// Picks an option of a react-select, the way a pointer does.
function pick(combobox: HTMLElement, optionText: string): void {
  fireEvent.keyDown(combobox, { key: "ArrowDown" });
  const options: Array<HTMLElement> = screen.getAllByText(optionText, {
    exact: true,
  });
  const option: HTMLElement = options[options.length - 1]!;
  fireEvent.mouseDown(option);
  fireEvent.click(option);
}

async function submit(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(within(dialog()).getByTestId("modal-footer-submit-button"));
  });
}

async function submitAndCapture(): Promise<JSONObject> {
  await submit();

  await waitFor(() => {
    expect(capturedModels).toHaveLength(1);
  });

  return capturedModels[0]!;
}

function typeInto(placeholder: string, value: string): void {
  fireEvent.change(within(dialog()).getByPlaceholderText(placeholder), {
    target: { value },
  });
}

// A relation as the form sends it: the id, or the record holding it.
function idOf(value: unknown): string {
  if (value && typeof value === "object") {
    const record: Record<string, unknown> = value as Record<string, unknown>;
    return String(record["_id"] || record["id"] || record["value"] || "");
  }

  return String(value || "");
}

const HOSTNAME_PLACEHOLDER: string = "10.0.0.1 or switch-01.example.com";
const NAME_PLACEHOLDER: string = "Same as the hostname";
const COMMUNITY_PLACEHOLDER: string = "public";

beforeEach(() => {
  capturedModels = [];
  window.history.replaceState(null, "", "/dashboard/network-devices");
});

afterEach(() => {
  cleanup();
  capturedModels = [];
});

describe("the Add Device dialog is one page", () => {
  test("is titled Add New Device, and its one button reads Add Device", async () => {
    await openAddDevice();

    expect(
      within(dialog()).getByTestId("modal-footer-submit-button"),
    ).toHaveTextContent("Add Device");
  });

  test("walks no steps: no step list, no Next", async () => {
    await openAddDevice();

    expect(
      within(dialog()).queryByRole("navigation", { name: "Progress" }),
    ).toBeNull();
    expect(within(dialog()).queryByText(/^Step \d+ of \d+/)).toBeNull();
    expect(
      within(dialog()).queryByTestId("modal-footer-next-button"),
    ).toBeNull();
  });

  test("the steps it used to walk are gone", async () => {
    await openAddDevice();

    for (const stepTitle of [
      "Device Details",
      "Probe & Site",
      "SNMP (Optional)",
    ]) {
      expect(within(dialog()).queryByText(stepTitle)).toBeNull();
    }
  });

  test("shows the hostname, the name, the site and the probe on arrival", async () => {
    await openAddDevice();

    expect(
      within(dialog()).getByPlaceholderText(HOSTNAME_PLACEHOLDER),
    ).toBeVisible();
    expect(
      within(dialog()).getByPlaceholderText(NAME_PLACEHOLDER),
    ).toBeVisible();
    expect(
      within(dialog()).getByText("The IP address or hostname the probe pings."),
    ).toBeVisible();
    expect(
      within(dialog()).getByText(
        "Where the device is. A site with a default probe fills in the probe below.",
      ),
    ).toBeVisible();
    expect(comboboxOf("Probe")).toBeVisible();
  });

  test("starts on the project's only custom probe", async () => {
    await openAddDevice();

    expect(within(dialog()).getByText("HQ Probe")).toBeVisible();
  });

  test("asks for the hostname before the name", async () => {
    await openAddDevice();

    const hostname: HTMLElement =
      within(dialog()).getByPlaceholderText(HOSTNAME_PLACEHOLDER);
    const name: HTMLElement =
      within(dialog()).getByPlaceholderText(NAME_PLACEHOLDER);

    expect(
      hostname.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  // Two folds and nothing else below the four questions.
  test("folds everything else into two sections: SNMP, then More fields", async () => {
    await openAddDevice();

    expect(
      within(dialog())
        .getAllByTestId("folded-section-title")
        .map((title: HTMLElement): string => {
          return title.textContent || "";
        }),
    ).toEqual(["SNMP", "More fields"]);
  });
});

describe("the SNMP fold", () => {
  test("is folded on arrival and says what leaving it alone means", async () => {
    await openAddDevice();

    const header: HTMLElement = foldNamed("SNMP");

    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(header).toHaveTextContent(
      "Optional. Without it the device is pinged, so it gets a status and a response time. Add its SNMP community string to also see its interfaces, traffic and health.",
    );
    expect(
      within(dialog()).getByPlaceholderText(COMMUNITY_PLACEHOLDER),
    ).not.toBeVisible();
  });

  test("does not list its fields while folded: the sentence says it", async () => {
    await openAddDevice();

    expect(listedNames(foldNamed("SNMP"))).toEqual([]);
  });

  test("opens on a click to show the version, the community string, the port and the saved credentials", async () => {
    await openAddDevice();

    toggleFold("SNMP");

    expect(foldNamed("SNMP")).toHaveAttribute("aria-expanded", "true");
    expect(
      within(dialog()).getByPlaceholderText(COMMUNITY_PLACEHOLDER),
    ).toBeVisible();
    expect(within(dialog()).getByPlaceholderText("161")).toBeVisible();
    expect(comboboxOf("SNMP Version")).toBeVisible();
    expect(
      getByTextOutsideFoldedHeaders(dialog(), "SNMP Credential Profile"),
    ).toBeVisible();
  });

  test("a typed community string replaces the sentence, naming the secret but never showing it", async () => {
    await openAddDevice();

    toggleFold("SNMP");
    typeInto(COMMUNITY_PLACEHOLDER, "s3cret-community");
    toggleFold("SNMP");

    const header: HTMLElement = foldNamed("SNMP");

    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(header).not.toHaveTextContent("Without it the device is pinged");
    expect(
      setChips(header).some((chip: string): boolean => {
        return chip.startsWith("SNMP Community String");
      }),
    ).toBe(true);
    expect(header.textContent || "").not.toContain("s3cret-community");
  });

  test("stays folded when something in it is set: it never opens by itself", async () => {
    await openAddDevice();

    toggleFold("SNMP");
    typeInto(COMMUNITY_PLACEHOLDER, "public-ro");
    toggleFold("SNMP");
    await settle();

    expect(foldNamed("SNMP")).toHaveAttribute("aria-expanded", "false");
  });
});

describe("the More fields fold", () => {
  test("is folded and lists what it holds by name", async () => {
    await openAddDevice();

    const header: HTMLElement = foldNamed("More fields");

    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(listedNames(header)).toEqual([
      "Description",
      "Device Role",
      "MAC Address",
      "Also create a Ping monitor for incidents",
    ]);
  });

  test("opens on a click to the Ping monitor opt-in, off", async () => {
    await openAddDevice();

    toggleFold("More fields");

    const label: HTMLElement = getByTextOutsideFoldedHeaders(
      dialog(),
      "Also create a Ping monitor for incidents",
    );
    expect(label).toBeVisible();

    const checkbox: HTMLInputElement = within(dialog()).getByRole("checkbox", {
      name: "Also create a Ping monitor for incidents",
    }) as HTMLInputElement;

    expect(checkbox).toBeVisible();
    expect(checkbox.checked).toBe(false);
  });
});

describe("what Add Device sends", () => {
  test("a device added with only its hostname is named after it, on the default probe", async () => {
    await openAddDevice();

    typeInto(HOSTNAME_PLACEHOLDER, "10.20.30.40");

    const model: JSONObject = await submitAndCapture();

    expect(model["hostname"]).toBe("10.20.30.40");
    expect(model["name"]).toBe("10.20.30.40");
    expect(idOf(model["probe"])).toBe(PROBE_ID);
  });

  test("a hostname typed with spaces around it names the device without them", async () => {
    await openAddDevice();

    typeInto(HOSTNAME_PLACEHOLDER, "  core-sw-01.example.com  ");

    const model: JSONObject = await submitAndCapture();

    expect(model["name"]).toBe("core-sw-01.example.com");
  });

  test("a typed name is kept", async () => {
    await openAddDevice();

    typeInto(HOSTNAME_PLACEHOLDER, "10.20.30.40");
    typeInto(NAME_PLACEHOLDER, "edge-fw-01");

    const model: JSONObject = await submitAndCapture();

    expect(model["hostname"]).toBe("10.20.30.40");
    expect(model["name"]).toBe("edge-fw-01");
  });

  test("an empty form asks only for the hostname, and sends nothing", async () => {
    await openAddDevice();

    await submit();

    await waitFor(() => {
      expect(
        within(dialog()).getByText("Hostname is required."),
      ).toBeInTheDocument();
    });
    expect(within(dialog()).queryByText("Name is required.")).toBeNull();
    expect(within(dialog()).queryByText("Probe is required.")).toBeNull();
    expect(capturedModels).toEqual([]);
  });

  test("with SNMP left folded, the device is sent with no SNMP credentials: pinged only", async () => {
    await openAddDevice();

    typeInto(HOSTNAME_PLACEHOLDER, "10.20.30.40");

    const model: JSONObject = await submitAndCapture();

    expect(model["snmpCommunityString"] || "").toBe("");
    expect(model["snmpV3Username"] || "").toBe("");
    expect(idOf(model["snmpCredentialProfile"])).toBe("");
  });

  test("a community string typed under SNMP is sent with the device", async () => {
    await openAddDevice();

    typeInto(HOSTNAME_PLACEHOLDER, "10.20.30.40");
    toggleFold("SNMP");
    typeInto(COMMUNITY_PLACEHOLDER, "public-ro");

    const model: JSONObject = await submitAndCapture();

    expect(model["snmpCommunityString"]).toBe("public-ro");
  });

  /*
   * A question left unanswered inside a fold is never hidden from the person
   * who has to answer it: V3 picked with no user, folded again, and Add
   * Device opens the fold on the missing field instead of sending.
   */
  test("V3 picked with no user opens the folded SNMP section on what is missing", async () => {
    await openAddDevice();

    typeInto(HOSTNAME_PLACEHOLDER, "10.20.30.40");
    toggleFold("SNMP");
    pick(comboboxOf("SNMP Version"), "V3");
    toggleFold("SNMP");

    expect(foldNamed("SNMP")).toHaveAttribute("aria-expanded", "false");

    await submit();

    await waitFor(() => {
      expect(foldNamed("SNMP")).toHaveAttribute("aria-expanded", "true");
    });
    expect(
      within(dialog()).getByText("SNMP v3 Username is required."),
    ).toBeVisible();
    expect(capturedModels).toEqual([]);
  });
});
