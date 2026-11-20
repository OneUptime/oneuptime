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
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import Permission from "../../../Types/Permission";
import { CardButtonSchema } from "../../../UI/Components/Card/Card";
import { ComponentProps as ModelTableProps } from "../../../UI/Components/ModelTable/ModelTable";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import PermissionGate from "../../../UI/Utils/PermissionGate";

/*
 * The Sites list offers Delete Empty Sites (#10188) in its ⋯ menu - an
 * OUTLINE button of the table, beside Import from CSV - to who may delete
 * sites, and to nobody else; pressed, it opens the dialog that lists them.
 *
 * The production page is drawn; only the table is replaced, by its card's
 * buttons as the table hands them to its ⋯ menu, and what the page fetches
 * on mount.
 */

let heldPermissions: Array<Permission> = [];
let emptySitesAsked: number = 0;

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: <TBaseModel extends BaseModel>(
      props: ModelTableProps<TBaseModel>,
    ): ReactElement => {
      return (
        <div data-testid="sites-table-menu">
          {(props.cardProps?.buttons || []).map(
            (
              item: CardButtonSchema | ReactElement,
              index: number,
            ): ReactElement => {
              if (React.isValidElement(item)) {
                return <div key={index}>{item}</div>;
              }

              const button: CardButtonSchema = item as CardButtonSchema;

              return (
                <button
                  key={button.title}
                  type="button"
                  data-style={String(button.buttonStyle)}
                  onClick={button.onClick}
                >
                  {button.title}
                </button>
              );
            },
          )}
        </div>
      );
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return [...heldPermissions, Permission.User, Permission.Public];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<Permission> } => {
        return { globalPermissions: [Permission.User, Permission.Public] };
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

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkSite/EmptySitesApi",
  () => {
    return {
      __esModule: true,
      fetchEmptySites: async (): Promise<Array<JSONObject>> => {
        emptySitesAsked++;
        return [
          { id: "10188000-0000-4000-8000-000000000001", name: "Store 0001" },
          { id: "10188000-0000-4000-8000-000000000002", name: "Store 0002" },
        ];
      },
      deleteEmptySites: async (): Promise<JSONObject> => {
        return { deletedCount: 2, keptCount: 0 };
      },
    };
  },
);

import NetworkSites from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkSite/Sites";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";

function renderPage(): void {
  const props: PageComponentProps = {
    pageRoute: new Route("/dashboard/:projectId/network-sites"),
  } as unknown as PageComponentProps;

  render(
    <MemoryRouter>
      <NetworkSites {...props} />
    </MemoryRouter>,
  );
}

function menuTitles(): Array<string> {
  return Array.from(
    screen.getByTestId("sites-table-menu").querySelectorAll("button"),
  ).map((button: HTMLButtonElement): string => {
    return button.textContent || "";
  });
}

beforeEach(() => {
  emptySitesAsked = 0;
  PermissionGate.clearPermissionPropsCache();
});

afterEach(() => {
  cleanup();
});

describe("the Sites list's menu", () => {
  test.each([
    ["a Project Owner", [Permission.ProjectOwner]],
    ["a Project Admin", [Permission.ProjectAdmin]],
    ["a role that may delete network sites", [Permission.DeleteNetworkSite]],
  ])(
    "offers %s Delete Empty Sites beside Import from CSV, in the ⋯ menu",
    (_who: string, permissions: Array<Permission>) => {
      heldPermissions = permissions;
      renderPage();

      expect(menuTitles()).toEqual(["Import from CSV", "Delete Empty Sites"]);
      // OUTLINE: the table puts it in its ⋯ menu, as it puts Import from CSV.
      expect(
        screen
          .getByRole("button", { name: "Delete Empty Sites" })
          .getAttribute("data-style"),
      ).toBe(
        screen
          .getByRole("button", { name: "Import from CSV" })
          .getAttribute("data-style"),
      );
    },
  );

  test.each([
    ["a Viewer", [Permission.Viewer]],
    [
      "a role that may read and add sites, not delete them",
      [Permission.ReadNetworkSite, Permission.CreateNetworkSite],
    ],
  ])(
    "never offers %s Delete Empty Sites",
    (_who: string, permissions: Array<Permission>) => {
      heldPermissions = permissions;
      renderPage();

      expect(menuTitles()).toEqual(["Import from CSV"]);
    },
  );

  test("pressed, it opens the dialog, which lists the empty sites", async () => {
    heldPermissions = [Permission.ProjectAdmin];
    renderPage();

    await act(async (): Promise<void> => {
      fireEvent.click(
        screen.getByRole("button", { name: "Delete Empty Sites" }),
      );
    });

    await waitFor(() => {
      expect(
        screen.getByTestId("delete-empty-sites-question"),
      ).toBeInTheDocument();
    });
    expect(emptySitesAsked).toBe(1);
    expect(screen.getByTestId("delete-empty-sites-question").textContent).toBe(
      "Are you sure you want to delete 2 empty sites? This action cannot be undone.",
    );
  });
});
