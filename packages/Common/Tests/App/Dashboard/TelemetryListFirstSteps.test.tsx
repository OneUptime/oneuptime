import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import Permission from "../../../Types/Permission";

/*
 * The Services and RUM Applications lists a new project opens on.
 *
 * Services are found, not made: ingest creates one for every new
 * service.name. An empty Services list said "No services yet" over a Create
 * Service button as if a service had to be made by hand first; it says now
 * where services come from, with the setup guide beside Create, and its
 * create form says what the name is matched on. The RUM list described
 * itself in resource attributes ("browser.* / device.*"), and the setup
 * guide under its empty list said the list was empty a second time.
 *
 * Each page is rendered with its table recorded, so what the page really
 * hands the table is what is tested.
 */

let modelTableCalls: Array<Record<string, unknown>> = [];
let applicationCount: number = 3;
let facetEmptyState: Record<string, unknown> | undefined = undefined;

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

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: async (): Promise<number> => {
        return applicationCount;
      },
      getList: async (): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        return { data: [], count: 0, skip: 0, limit: 50 };
      },
      getItem: async (): Promise<JSONObject> => {
        return {};
      },
      getCommonHeaders: (): JSONObject => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) => {
      modelTableCalls.push(props);
      return <div data-testid="model-table" />;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Rum/RumDocumentationCard",
  () => {
    return {
      __esModule: true,
      default: (props: { title: string; description: string }) => {
        return (
          <div data-testid="rum-guide">
            <h2>{props.title}</h2>
            <p>{props.description}</p>
          </div>
        );
      },
    };
  },
);

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
          getOwnersForResource: () => {
            return [];
          },
          isLoadingOwners: false,
          onResourcesFetched: () => {},
          filterBar: null,
          emptyState: facetEmptyState,
          mergeFiltersIntoQuery: (query: unknown) => {
            return query;
          },
          facetSaveState: undefined,
          restoreFacetState: () => {},
        };
      },
    };
  },
);

jest.mock("../../../UI/Components/BulkUpdate/BulkLabelActions", () => {
  return {
    __esModule: true,
    default: () => {
      return { bulkActions: [], modals: null };
    },
  };
});

jest.mock("../../../UI/Components/BulkUpdate/BulkOwnerActions", () => {
  return {
    __esModule: true,
    default: () => {
      return { rowActions: [], bulkActions: [], modals: null };
    },
  };
});

jest.mock("../../../UI/Components/BulkUpdate/BulkArchiveActions", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        archiveRowActions: [],
        unarchiveRowActions: [],
        archiveBulkActions: [],
      };
    },
  };
});

import ServicesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Service/Services";
import RumApplications from "../../../../App/FeatureSet/Dashboard/src/Pages/Rum/RumApplications";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import {
  SERVICE_NAME_HELP,
  SERVICES_EMPTY_DESCRIPTION,
  SET_UP_TELEMETRY_ACTION,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Service/ServiceListCopy";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import EmptyStateOptions from "../../../UI/Components/ModelTable/EmptyStateOptions";
import { TableEmptyStateAction } from "../../../UI/Components/Table/TableEmptyState";
import { ModelField } from "../../../UI/Components/Forms/ModelForm";
import { FormFieldCollapsibleSection } from "../../../UI/Components/Forms/Types/Field";
import Navigation from "../../../UI/Utils/Navigation";
import Service from "../../../Models/DatabaseModels/Service";
import { goTo, PROJECT_ID, routeFor } from "./SideMenuHarness";

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

function lastTable(): Record<string, unknown> {
  expect(modelTableCalls.length).toBeGreaterThan(0);
  return modelTableCalls[modelTableCalls.length - 1]!;
}

function fieldFor(
  fields: Array<ModelField<Service>>,
  column: string,
): ModelField<Service> {
  const field: ModelField<Service> | undefined = fields.find(
    (candidate: ModelField<Service>): boolean => {
      return Object.keys(candidate.field || {})[0] === column;
    },
  );

  expect(field).toBeDefined();

  return field as ModelField<Service>;
}

beforeEach(() => {
  modelTableCalls = [];
  applicationCount = 3;
  facetEmptyState = undefined;
  goTo(`/dashboard/${PROJECT_ID}/service`);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the Services list", () => {
  test("an empty list says where services come from, with the setup guide beside Create", () => {
    const navigate: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((): void => {});

    render(<ServicesPage {...PAGE_PROPS} />);

    const table: Record<string, unknown> = lastTable();
    const emptyState: EmptyStateOptions = table[
      "emptyState"
    ] as EmptyStateOptions;

    expect(emptyState.description).toBe(SERVICES_EMPTY_DESCRIPTION);
    expect(SERVICES_EMPTY_DESCRIPTION).toBe(
      "Services appear here once your apps send telemetry, one for each service.name.",
    );
    // Create Service stays: a service can still be made by hand.
    expect(table["isCreateable"]).toBe(true);
    expect(emptyState.hideCreateButton).toBeUndefined();

    const actions: Array<TableEmptyStateAction> = emptyState.actions || [];

    expect(
      actions.map((action: TableEmptyStateAction): string => {
        return action.title;
      }),
    ).toEqual([SET_UP_TELEMETRY_ACTION]);
    expect(SET_UP_TELEMETRY_ACTION).toBe("Set up telemetry");

    actions[0]!.onClick();

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(String(navigate.mock.calls[0]![0])).toBe(
      routeFor(PageMap.TRACES_DOCUMENTATION),
    );
  });

  test("keeps what the facet chips say about an empty list: a filtered list stays filtered", () => {
    const onClearFilters: () => void = (): void => {};
    facetEmptyState = { isFiltered: true, onClearFilters: onClearFilters };

    render(<ServicesPage {...PAGE_PROPS} />);

    const emptyState: EmptyStateOptions = lastTable()[
      "emptyState"
    ] as EmptyStateOptions;

    expect(emptyState.isFiltered).toBe(true);
    expect(emptyState.onClearFilters).toBe(onClearFilters);
  });

  test("the create form asks for the service.name, with an example", () => {
    render(<ServicesPage {...PAGE_PROPS} />);

    const fields: Array<ModelField<Service>> = lastTable()[
      "formFields"
    ] as Array<ModelField<Service>>;
    const name: ModelField<Service> = fieldFor(fields, "name");

    expect(name.required).toBe(true);
    expect(name.description).toBe(SERVICE_NAME_HELP);
    // What to type, and why: the telemetry is filed under that name.
    expect(SERVICE_NAME_HELP).toBe(
      "Use the service.name your apps send, so their telemetry shows up under this service.",
    );
    // An example, not the title said again ("Service Name").
    expect(name.placeholder).toBe("e.g., checkout-api");
  });

  test("description and labels fold together under one Advanced section", () => {
    render(<ServicesPage {...PAGE_PROPS} />);

    const fields: Array<ModelField<Service>> = lastTable()[
      "formFields"
    ] as Array<ModelField<Service>>;
    const description: ModelField<Service> = fieldFor(fields, "description");
    const labels: ModelField<Service> = fieldFor(fields, "labels");
    const section: FormFieldCollapsibleSection<Service> | undefined =
      description.collapsibleSection;

    expect(section).toBeDefined();
    expect(labels.collapsibleSection).toBe(section);
    expect(description.placeholder).toBe("What this service does");
    expect(fieldFor(fields, "name").collapsibleSection).toBeUndefined();
  });

  test("an empty description reads like every other empty cell, not a hyphen", () => {
    render(<ServicesPage {...PAGE_PROPS} />);

    const columns: Array<Record<string, unknown>> = lastTable()[
      "columns"
    ] as Array<Record<string, unknown>>;
    const description: Record<string, unknown> | undefined = columns.find(
      (column: Record<string, unknown>): boolean => {
        return (
          Object.keys((column["field"] as Record<string, unknown>) || {})[0] ===
          "description"
        );
      },
    );

    expect(description).toBeDefined();
    expect(description!["noValueMessage"]).toBeUndefined();
  });
});

describe("the RUM Applications list", () => {
  beforeEach(() => {
    goTo(`/dashboard/${PROJECT_ID}/rum`);
  });

  test("describes itself in plain words, not in resource attributes", async () => {
    render(<RumApplications {...PAGE_PROPS} />);

    await waitFor(() => {
      expect(modelTableCalls.length).toBeGreaterThan(0);
    });

    const card: { title: string; description: string } = lastTable()[
      "cardProps"
    ] as { title: string; description: string };

    expect(card.description).toBe(
      "Your web and mobile apps, as their real users see them. Each app appears here once it sends telemetry.",
    );
    expect(card.description).not.toMatch(/browser\.\*|device\.\*/);
  });

  test("a project without applications shows the guide, which does not say the list is empty again", async () => {
    applicationCount = 0;

    await act(async () => {
      render(<RumApplications {...PAGE_PROPS} />);
    });

    expect(
      await screen.findByText("Getting Started with Real User Monitoring"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Pick what you are instrumenting and follow the steps. Your app appears in the list above once its first telemetry arrives.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/No RUM applications connected yet/)).toBeNull();
  });

  test("a project with applications shows no guide under the list", async () => {
    await act(async () => {
      render(<RumApplications {...PAGE_PROPS} />);
    });

    await waitFor(() => {
      expect(modelTableCalls.length).toBeGreaterThan(0);
    });
    expect(screen.queryByTestId("rum-guide")).toBeNull();
  });
});

// The routes the actions use exist in the route table.
test("the setup guide route the Services list opens exists", () => {
  expect(routeFor(PageMap.TRACES_DOCUMENTATION)).toBe(
    new Route(`/dashboard/${PROJECT_ID}/traces/documentation`).toString(),
  );
});
