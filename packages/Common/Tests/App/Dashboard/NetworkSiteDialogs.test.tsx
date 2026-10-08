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
} from "../../UI/Components/FoldedSection/FoldedSectionQueries";

/*
 * Adding a site, drawn for real.
 *
 * Add Site walked four steps - details, location, hierarchy, monitoring
 * defaults - before a site existed. Where a site is (its address and map
 * pin) is not something most people have to hand while setting up, so it
 * folds under More fields on the first step with the description, and the
 * site type says in its own words what it is for. Three steps are left,
 * each about one thing.
 *
 * Add Child Site walked two steps for a site whose parent is already known.
 * It asks the type and the name on one page now, with the location folded,
 * and the new site is placed under the site it was added from.
 *
 * The production pages build the forms; only the table around each is
 * replaced, by the create dialog the real table opens. Saving goes through
 * the real ModelForm with the network stubbed.
 */

let capturedModels: Array<JSONObject> = [];

const SITE_ID: string = "50000000-0000-4000-8000-000000000001";
const STORE_TYPE_ID: string = "60000000-0000-4000-8000-000000000002";

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

// The project's site types, as the type pickers offer them.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkSite/NetworkSiteFormDropdownOptions",
  () => {
    const options: Array<{ label: string; value: string }> = [
      { label: "Region", value: "60000000-0000-4000-8000-000000000001" },
      { label: "Store", value: "60000000-0000-4000-8000-000000000002" },
    ];

    return {
      __esModule: true,
      fetchNetworkSiteTypes: async (): Promise<Array<unknown>> => {
        return [];
      },
      fetchAllNetworkSiteTypeOptions: async (): Promise<Array<unknown>> => {
        return options;
      },
      fetchParentNetworkSiteTypeOptions: async (): Promise<Array<unknown>> => {
        return options;
      },
      fetchParentNetworkSiteOptions: async (): Promise<Array<unknown>> => {
        return [];
      },
      fetchChildNetworkSiteTypeOptions: async (): Promise<Array<unknown>> => {
        return [options[1]];
      },
    };
  },
);

// The facet bar, the summary strip and the tree fetch on mount.
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
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkSite/SiteSummaryCards",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkSite/SiteHierarchyTree",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

import NetworkSitesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkSite/Sites";
import NetworkSiteChildSitesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkSite/View/ChildSites";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { SITE_TYPE_FIELD_DESCRIPTION } from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkSite/SiteFormSections";

const NAME_PLACEHOLDER: string = "Unit 1042 - Springfield";
const ADDRESS_PLACEHOLDER: string = "742 Evergreen Terrace, Springfield, IL";

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

function progress(): HTMLElement | null {
  return within(dialog()).queryByRole("navigation", { name: "Progress" });
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

function typeInto(placeholder: string, value: string): void {
  fireEvent.change(within(dialog()).getByPlaceholderText(placeholder), {
    target: { value },
  });
}

async function clickNext(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(within(dialog()).getByTestId("modal-footer-next-button"));
  });
  await settle();
}

async function submitAndCapture(): Promise<JSONObject> {
  await act(async (): Promise<void> => {
    fireEvent.click(within(dialog()).getByTestId("modal-footer-submit-button"));
  });

  await waitFor(() => {
    expect(capturedModels).toHaveLength(1);
  });

  return capturedModels[0]!;
}

function idOf(value: unknown): string {
  if (value && typeof value === "object") {
    const record: Record<string, unknown> = value as Record<string, unknown>;

    if (record["_id"] || record["id"] || record["value"]) {
      return String(record["_id"] || record["id"] || record["value"]);
    }
  }

  return String(value || "");
}

async function openAddSite(): Promise<void> {
  window.history.replaceState(null, "", "/dashboard/network-sites");

  const props: PageComponentProps = {
    pageRoute: new Route("/dashboard/:projectId/network-sites"),
  } as unknown as PageComponentProps;

  render(
    <MemoryRouter>
      <NetworkSitesPage {...props} />
    </MemoryRouter>,
  );

  expect(await screen.findByText("Add New Site")).toBeInTheDocument();
  await settle();
}

async function openAddChildSite(): Promise<void> {
  window.history.replaceState(
    null,
    "",
    `/dashboard/11111111-1111-4111-8111-111111111111/network-sites/${SITE_ID}/child-sites`,
  );

  const props: PageComponentProps = {
    pageRoute: new Route("/dashboard/:projectId/network-sites/:id/child-sites"),
  } as unknown as PageComponentProps;

  render(
    <MemoryRouter>
      <NetworkSiteChildSitesPage {...props} />
    </MemoryRouter>,
  );

  expect(await screen.findByText("Add New Child Site")).toBeInTheDocument();
  await settle();
}

beforeEach(() => {
  capturedModels = [];
});

afterEach(() => {
  cleanup();
  capturedModels = [];
});

describe("Add Site", () => {
  test("walks three steps, each about one thing: the site, where it sits, and its defaults", async () => {
    await openAddSite();

    const steps: HTMLElement | null = progress();

    expect(steps).not.toBeNull();

    for (const step of ["Site Details", "Hierarchy", "Monitoring Defaults"]) {
      expect(within(steps!).getByText(step)).toBeInTheDocument();
    }

    // The address and map pin are no longer a step of their own.
    expect(within(steps!).queryByText("Location")).toBeNull();
  });

  test("asks the type and the name first, and says what the type is for", async () => {
    await openAddSite();

    expect(comboboxOf("Site Type")).toBeVisible();
    expect(
      within(dialog()).getByPlaceholderText(NAME_PLACEHOLDER),
    ).toBeVisible();
    expect(
      within(dialog()).getByText(SITE_TYPE_FIELD_DESCRIPTION),
    ).toBeVisible();
    expect(SITE_TYPE_FIELD_DESCRIPTION).toContain("a region, a store");
  });

  test("folds the description and the location under More fields, on the first step", async () => {
    await openAddSite();

    const header: HTMLElement = moreFields();

    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(listedNames(header)).toEqual([
      "Description",
      "Address",
      "Latitude",
      "Longitude",
    ]);
    expect(
      within(dialog()).getByPlaceholderText(ADDRESS_PLACEHOLDER),
    ).not.toBeVisible();
  });

  test("the location opens from the fold, on the same step", async () => {
    await openAddSite();

    fireEvent.click(moreFields());

    expect(
      within(dialog()).getByPlaceholderText(ADDRESS_PLACEHOLDER),
    ).toBeVisible();
    expect(within(dialog()).getByPlaceholderText("39.7817")).toBeVisible();
    expect(within(dialog()).getByPlaceholderText("-89.6501")).toBeVisible();
  });

  test("a site is added with only its type and name, walked straight through", async () => {
    await openAddSite();

    pick(comboboxOf("Site Type"), "Store");
    typeInto(NAME_PLACEHOLDER, "Springfield");

    await clickNext();
    expect(
      getByTextOutsideFoldedHeaders(dialog(), "Parent Site"),
    ).toBeVisible();

    await clickNext();
    expect(
      within(dialog()).getByTestId("modal-footer-submit-button"),
    ).toHaveTextContent("Add Site");

    const model: JSONObject = await submitAndCapture();

    expect(model["name"]).toBe("Springfield");
    expect(idOf(model["networkSiteType"])).toBe(STORE_TYPE_ID);
  });
});

describe("Add Child Site", () => {
  test("is one page: no step list, no Next, and the button reads Add Child Site", async () => {
    await openAddChildSite();

    expect(progress()).toBeNull();
    expect(
      within(dialog()).queryByTestId("modal-footer-next-button"),
    ).toBeNull();
    expect(
      within(dialog()).getByTestId("modal-footer-submit-button"),
    ).toHaveTextContent("Add Child Site");
  });

  test("asks the type and the name, and folds the location", async () => {
    await openAddChildSite();

    expect(comboboxOf("Site Type")).toBeVisible();
    expect(
      within(dialog()).getByPlaceholderText(NAME_PLACEHOLDER),
    ).toBeVisible();
    expect(listedNames(moreFields())).toEqual([
      "Address",
      "Latitude",
      "Longitude",
    ]);
    expect(
      within(dialog()).getByPlaceholderText(ADDRESS_PLACEHOLDER),
    ).not.toBeVisible();
  });

  test("the new site is placed under the site it was added from", async () => {
    await openAddChildSite();

    pick(comboboxOf("Site Type"), "Store");
    typeInto(NAME_PLACEHOLDER, "Springfield East");

    const model: JSONObject = await submitAndCapture();

    expect(model["name"]).toBe("Springfield East");
    expect(idOf(model["networkSiteType"])).toBe(STORE_TYPE_ID);
    expect(idOf(model["parentSiteId"])).toBe(SITE_ID);
  });

  test("an empty form asks for the type and the name, and sends nothing", async () => {
    await openAddChildSite();

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(dialog()).getByTestId("modal-footer-submit-button"),
      );
    });

    await waitFor(() => {
      expect(within(dialog()).getByText("Name is required.")).toBeVisible();
    });
    expect(within(dialog()).getByText("Site Type is required.")).toBeVisible();
    expect(capturedModels).toEqual([]);
  });
});
