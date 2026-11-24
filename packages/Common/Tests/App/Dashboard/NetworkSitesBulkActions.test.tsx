import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE SITES LIST'S BULK ACTIONS (#10188), ON THE REAL LIST.
 *
 * "After importing hundreds of sites from Meraki, I want to place them all
 * under a common parent in the hierarchy. Bulk Actions on Sites currently
 * offers only Delete and Export CSV." The list is drawn for real - the
 * table, its selection, Select All and its Bulk Actions menu - over a
 * project of 705 sites: a region with two markets and two stores, and the
 * 700 sites a Meraki import added, with no type and at the top. Only the
 * network is stood in for (an in-memory project behind ModelAPI), and the
 * dialogs, which are recorded: what each one asks and what its save
 * writes is the contract here, not the form library.
 *
 *   - Bulk Actions offers Set and Clear Parent Site, Set and Clear Default
 *     Probe, Add and Remove Labels, Add and Remove Owner, beside Delete;
 *   - Select All selects every site that matches, past the first page;
 *   - Set Parent Site moves every site selected under the one picked, the
 *     ones with no type taking the type the dialog asks for, and leaves the
 *     parent itself where it is;
 *   - Clear Parent Site asks first, counting the sites it moves;
 *   - Set and Clear Default Probe write every site's probe;
 *   - Add and Remove Labels keep each site's other labels;
 *   - Add and Remove Owner write the owner rows of every site selected;
 *   - for who may not change sites, the site actions are locked, saying
 *     why.
 */

configure({ asyncUtilTimeout: 20000 });
jest.setTimeout(120000);

type Row = Record<string, any>;

interface MockStore {
  sites: Array<Row>;
  ownerUsers: Array<Row>;
  ownerTeams: Array<Row>;
  labels: Array<Row>;
  updates: Array<{ id: string; data: Row }>;
  creates: Array<{ table: string; row: Row }>;
  deletes: Array<{ table: string; id: string }>;
}

const mockStore: MockStore = {
  sites: [],
  ownerUsers: [],
  ownerTeams: [],
  labels: [],
  updates: [],
  creates: [],
  deletes: [],
};

let mockAllPermissions: Array<string> = [];
let mockProjectPermissions: unknown = null;

interface CapturedModal {
  title: string;
  description?: unknown;
  onSubmit: (data: Record<string, unknown>) => Promise<void> | void;
  formProps: { fields: Array<Record<string, any>> };
}

const mockModals: Record<string, CapturedModal> = {};

// What the page hands its hierarchy each time it draws it.
const mockHierarchyToggles: Array<string | undefined> = [];

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SharedName/SharedNamesApi",
  () => {
    return {
      __esModule: true,
      default: {
        read: async (): Promise<{ groups: Array<Array<string>> }> => {
          return { groups: [] };
        },
      },
    };
  },
);

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return mockAllPermissions;
      },
      getProjectPermissions: (): unknown => {
        return mockProjectPermissions;
      },
      getGlobalPermissions: (): { globalPermissions: Array<string> } => {
        return { globalPermissions: [] };
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

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelListCache", () => {
  return {
    __esModule: true,
    default: {
      getList: async (): Promise<any> => {
        return { data: [], count: 0, skip: 0, limit: 0 };
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const ObjectIDClass: any = (
          jest.requireActual("../../../Types/ObjectID") as any
        ).default;
        return new ObjectIDClass("10188000-0000-4000-8000-0000000000a1");
      },
      getCurrentProject: (): null => {
        return null;
      },
      getCurrentPlan: (): null => {
        return null;
      },
    },
  };
});

/*
 * The project behind the API: its sites, their owner rows and labels. A
 * list answers its page and how many match; `_id` and the owner tables'
 * keys narrow it, as the selection's reads ask.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  const idsOf: (value: any) => Array<string> | null = (
    value: any,
  ): Array<string> | null => {
    if (value === undefined || value === null) {
      return null;
    }

    const values: Array<any> = Array.isArray(value?.values)
      ? value.values
      : Array.isArray(value)
        ? value
        : [value];

    return values.map((each: any): string => {
      return String(each?.toString?.() ?? each).toLowerCase();
    });
  };

  const matches: (row: Row, query: Row) => boolean = (
    row: Row,
    query: Row,
  ): boolean => {
    for (const key of ["_id", "networkSiteId", "userId", "teamId"]) {
      const ids: Array<string> | null = idsOf(query?.[key]);

      if (ids && !ids.includes(String(row[key]).toLowerCase())) {
        return false;
      }
    }

    return true;
  };

  const tableOf: (modelType: any) => string = (modelType: any): string => {
    return new modelType().tableName;
  };

  const rowsOf: (table: string) => Array<Row> = (table: string): Array<Row> => {
    if (table === "NetworkSite") {
      return mockStore.sites;
    }
    if (table === "NetworkSiteOwnerUser") {
      return mockStore.ownerUsers;
    }
    if (table === "NetworkSiteOwnerTeam") {
      return mockStore.ownerTeams;
    }
    if (table === "Label") {
      return mockStore.labels;
    }
    return [];
  };

  const toModel: (modelType: any, row: Row) => any = (
    modelType: any,
    row: Row,
  ): any => {
    const ObjectIDClass: any = (
      jest.requireActual("../../../Types/ObjectID") as any
    ).default;
    const LabelClass: any = (
      jest.requireActual("../../../Models/DatabaseModels/Label") as any
    ).default;
    const model: any = new modelType();

    for (const [key, value] of Object.entries(row)) {
      if (key === "labels") {
        model.labels = (value as Array<string>).map((labelId: string) => {
          const label: any = new LabelClass();
          const known: Row | undefined = mockStore.labels.find(
            (each: Row): boolean => {
              return each["_id"] === labelId;
            },
          );
          label._id = labelId;
          label.name = known?.["name"];
          return label;
        });
      } else if (key !== "_id" && key.endsWith("Id") && value) {
        model[key] = new ObjectIDClass(String(value));
      } else {
        model[key] = value;
      }
    }

    return model;
  };

  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return {};
      },
      getList: async (data: any): Promise<any> => {
        const found: Array<Row> = rowsOf(tableOf(data.modelType)).filter(
          (row: Row): boolean => {
            return matches(row, data.query || {});
          },
        );
        const skip: number = data.skip || 0;
        const limit: number = data.limit || found.length;

        return {
          data: found.slice(skip, skip + limit).map((row: Row) => {
            return toModel(data.modelType, row);
          }),
          count: found.length,
          skip: skip,
          limit: limit,
        };
      },
      count: async (data: any): Promise<number> => {
        return rowsOf(tableOf(data.modelType)).length;
      },
      getItem: async (data: any): Promise<any> => {
        const row: Row | undefined = rowsOf(tableOf(data.modelType)).find(
          (each: Row): boolean => {
            return each["_id"] === data.id.toString();
          },
        );
        return row ? toModel(data.modelType, row) : null;
      },
      updateById: async (data: any): Promise<void> => {
        const id: string = data.id.toString();
        const written: Row = {};

        for (const [key, value] of Object.entries(data.data || {})) {
          written[key] = Array.isArray(value)
            ? value.map((each: any): string => {
                return String(each?.toString?.() ?? each);
              })
            : value === null
              ? null
              : String((value as any)?.toString?.() ?? value);
        }

        mockStore.updates.push({ id: id, data: written });

        const site: Row | undefined = mockStore.sites.find(
          (each: Row): boolean => {
            return each["_id"] === id;
          },
        );

        if (site) {
          Object.assign(site, written);
        }
      },
      create: async (data: any): Promise<any> => {
        const table: string = tableOf(data.modelType);
        const row: Row = {
          _id: `10188000-0000-4000-8000-${String(
            mockStore.creates.length + 1,
          ).padStart(12, "0")}`,
        };

        for (const key of ["networkSiteId", "userId", "teamId", "projectId"]) {
          if (data.model[key]) {
            row[key] = data.model[key].toString();
          }
        }

        mockStore.creates.push({ table: table, row: row });
        rowsOf(table).push(row);
        return data.model;
      },
      deleteItem: async (data: any): Promise<void> => {
        const table: string = tableOf(data.modelType);
        const rows: Array<Row> = rowsOf(table);
        const index: number = rows.findIndex((each: Row): boolean => {
          return each["_id"] === data.id.toString();
        });

        mockStore.deletes.push({ table: table, id: data.id.toString() });

        if (index >= 0) {
          rows.splice(index, 1);
        }
      },
    },
  };
});

// What the page draws beside the list: not what these tests are about.
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
      default: (props: { refreshToggle?: string | undefined }) => {
        mockHierarchyToggles.push(props.refreshToggle);
        return null;
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
          ownersByResourceId: {},
          getOwnersForResource: () => {
            return [];
          },
          isLoadingOwners: false,
          onResourcesFetched: () => {},
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

// Each dialog, recorded by its title.
jest.mock("../../../UI/Components/FormModal/BasicFormModal", () => {
  return {
    __esModule: true,
    default: (props: CapturedModal): ReactElement => {
      mockModals[props.title] = props;
      return <div data-testid="recorded-form-modal">{props.title}</div>;
    },
  };
});

import NetworkSites from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkSite/Sites";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import {
  CLEAR_DEFAULT_PROBE_ACTION_TITLE,
  CLEAR_PARENT_SITE_ACTION_TITLE,
  IS_PICKED_PARENT_REASON,
  SET_DEFAULT_PROBE_ACTION_TITLE,
  SET_PARENT_SITE_ACTION_TITLE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkSite/BulkSiteActionWords";
import Route from "../../../Types/API/Route";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import Permission, { UserPermission } from "../../../Types/Permission";
import { BULK_CARD_SELECT_ALL_TEST_ID } from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";

const PROJECT_ID: string = "10188000-0000-4000-8000-0000000000a1";

function id(group: number, index: number): string {
  return `10188${group}00-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

const REGION_TYPE: string = id(1, 1);
const MARKET_TYPE: string = id(1, 2);
const UNIT_TYPE: string = id(1, 3);

const NORTH: string = id(2, 1);
const LEEDS: string = id(2, 2);
const YORK: string = id(2, 3);
const LEEDS_STORE: string = id(2, 4);
const YORK_STORE: string = id(2, 5);

const EDGE_PROBE: string = id(3, 1);
const BRAND_LABEL: string = id(4, 1);
const LEGACY_LABEL: string = id(4, 2);
const ALICE: string = id(5, 1);
const STORE_OPS: string = id(6, 1);

function meraki(index: number): string {
  return id(7, index);
}

// The region and its markets and stores, then 700 sites a Meraki import added.
function estate(): Array<Row> {
  const sites: Array<Row> = [
    { _id: NORTH, name: "Aaa North", networkSiteTypeId: REGION_TYPE },
    {
      _id: LEEDS,
      name: "Aab Leeds",
      networkSiteTypeId: MARKET_TYPE,
      parentSiteId: NORTH,
    },
    {
      _id: YORK,
      name: "Aac York",
      networkSiteTypeId: MARKET_TYPE,
      parentSiteId: NORTH,
      probeId: EDGE_PROBE,
    },
    {
      _id: LEEDS_STORE,
      name: "Aad Store 0660",
      networkSiteTypeId: UNIT_TYPE,
      parentSiteId: LEEDS,
      labels: [LEGACY_LABEL],
    },
    {
      _id: YORK_STORE,
      name: "Aae Store 0101",
      networkSiteTypeId: UNIT_TYPE,
      parentSiteId: YORK,
    },
  ];

  for (let index: number = 1; index <= 700; index++) {
    sites.push({
      _id: meraki(index),
      name: `Meraki ${String(index).padStart(4, "0")}`,
    });
  }

  return sites;
}

function holding(permissions: Array<Permission>): void {
  mockAllPermissions = permissions;
  mockProjectPermissions = {
    projectId: PROJECT_ID,
    permissions: permissions.map((permission: Permission): UserPermission => {
      return {
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
        scope: PermissionScope.All,
        _type: "UserPermission",
      };
    }),
    _type: "UserTenantAccessPermission",
  };
}

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

// Every row on the page, by the header checkbox, once the page is drawn.
async function selectThePage(): Promise<void> {
  await screen.findByText("Aaa North", undefined, { timeout: 20000 });

  await waitFor(() => {
    expect(
      document.querySelectorAll('input[type="checkbox"]:not([disabled])')
        .length,
    ).toBeGreaterThan(1);
  });

  fireEvent.click(
    document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[0]!,
  );
}

// Every site that matches, every page of them.
async function selectAll(): Promise<void> {
  await selectThePage();

  const button: HTMLElement = await screen.findByTestId(
    BULK_CARD_SELECT_ALL_TEST_ID,
  );

  await act(async (): Promise<void> => {
    fireEvent.click(button);
  });

  await waitFor(() => {
    expect(screen.queryByTestId(BULK_CARD_SELECT_ALL_TEST_ID)).toBeNull();
  });
}

// One site's row, ticked by its own checkbox.
async function selectRows(names: Array<string>): Promise<void> {
  for (const name of names) {
    const cell: HTMLElement = await screen.findByText(name, undefined, {
      timeout: 20000,
    });
    fireEvent.click(
      cell.closest("tr")!.querySelector('input[type="checkbox"]')!,
    );
  }
}

function menuItem(label: string): HTMLElement | undefined {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ).find((item: HTMLElement): boolean => {
    return (item.textContent || "").trim() === label;
  });
}

async function openBulkActions(): Promise<Array<string>> {
  fireEvent.click(await screen.findByText("Bulk Actions"));

  await waitFor(() => {
    expect(
      document.querySelectorAll('[role="menuitem"]').length,
    ).toBeGreaterThan(0);
  });

  return Array.from(
    document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ).map((item: HTMLElement): string => {
    return (item.textContent || "").trim();
  });
}

async function chooseAction(label: string): Promise<void> {
  await openBulkActions();

  await act(async (): Promise<void> => {
    fireEvent.click(menuItem(label)!);
  });
}

// A dialog's save, as its form hands it over.
async function submit(
  title: string,
  data: Record<string, unknown>,
): Promise<void> {
  await waitFor(() => {
    expect(mockModals[title]).toBeDefined();
  });

  await act(async (): Promise<void> => {
    await mockModals[title]!.onSubmit(data);
  });
}

// The confirm a Clear asks first, pressed.
async function confirm(): Promise<string> {
  const footer: HTMLElement = await waitFor(() => {
    const found: HTMLElement | null = document.querySelector(
      '[data-testid="modal-footer"]',
    );
    expect(found).not.toBeNull();
    return found!;
  });

  const dialogText: string =
    footer.closest('[role="dialog"]')?.textContent ||
    document.body.textContent ||
    "";

  const buttons: Array<HTMLButtonElement> = Array.from(
    footer.querySelectorAll<HTMLButtonElement>("button"),
  );
  const proceed: HTMLButtonElement = buttons[buttons.length - 1]!;

  await act(async (): Promise<void> => {
    fireEvent.click(proceed);
  });

  return dialogText;
}

function site(siteId: string): Row {
  return mockStore.sites.find((each: Row): boolean => {
    return each["_id"] === siteId;
  })!;
}

function updatedIds(): Array<string> {
  return mockStore.updates.map((update: { id: string }): string => {
    return update.id;
  });
}

beforeEach(() => {
  mockStore.sites = estate();
  mockStore.ownerUsers = [];
  mockStore.ownerTeams = [];
  mockStore.labels = [
    { _id: BRAND_LABEL, name: "Brand A" },
    { _id: LEGACY_LABEL, name: "Legacy" },
  ];
  mockStore.updates = [];
  mockStore.creates = [];
  mockStore.deletes = [];

  for (const key of Object.keys(mockModals)) {
    delete mockModals[key];
  }

  mockHierarchyToggles.length = 0;

  holding([Permission.ProjectOwner]);
  PermissionGate.clearPermissionPropsCache();
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();
  window.history.replaceState(
    window.history.state,
    "",
    `/dashboard/${PROJECT_ID}/network-sites`,
  );
});

afterEach(() => {
  cleanup();
});

describe("the Sites list's Bulk Actions, over 705 sites", () => {
  test("offer what a site is placed and set up by, beside Delete", async () => {
    renderPage();
    // A store under a market that has a default probe: every Clear applies.
    await selectRows(["Aac York"]);

    expect(await openBulkActions()).toEqual(
      expect.arrayContaining([
        SET_PARENT_SITE_ACTION_TITLE,
        CLEAR_PARENT_SITE_ACTION_TITLE,
        SET_DEFAULT_PROBE_ACTION_TITLE,
        CLEAR_DEFAULT_PROBE_ACTION_TITLE,
        "Add Labels",
        "Remove Labels",
        "Add Owner",
        "Remove Owner",
        "Delete",
      ]),
    );
  });

  test("Clear is offered only to a selection that holds something to clear", async () => {
    renderPage();
    await selectRows(["Meraki 0001"]);

    const items: Array<string> = await openBulkActions();

    expect(items).toContain(SET_PARENT_SITE_ACTION_TITLE);
    expect(items).not.toContain(CLEAR_PARENT_SITE_ACTION_TITLE);
    expect(items).not.toContain(CLEAR_DEFAULT_PROBE_ACTION_TITLE);
  });

  test("Select All, then Set Parent Site: every site moves under the one picked, the ones with no type take the type asked for, and the parent stays", async () => {
    renderPage();
    await selectAll();
    await chooseAction(SET_PARENT_SITE_ACTION_TITLE);

    // The 700 sites the import added have no type: the dialog asks for one.
    await waitFor(() => {
      expect(mockModals[SET_PARENT_SITE_ACTION_TITLE]).toBeDefined();
    });
    const fields: Array<Record<string, any>> =
      mockModals[SET_PARENT_SITE_ACTION_TITLE]!.formProps.fields;
    expect(
      fields.map((field: Record<string, any>): string => {
        return Object.keys(field["field"])[0]!;
      }),
    ).toEqual(["relationId", "networkSiteTypeId"]);
    expect(fields[1]!["required"]).toBe(true);

    render(<>{fields[1]!["description"]}</>);
    expect(
      screen.getByTestId("set-parent-site-type-description").textContent,
    ).toBe(
      "700 of these sites have no type, and a site needs one to sit under another. They get this type, and the others keep theirs.",
    );

    await submit(SET_PARENT_SITE_ACTION_TITLE, {
      relationId: NORTH,
      networkSiteTypeId: UNIT_TYPE,
    });

    await waitFor(() => {
      // 700 Meraki sites and the two stores: 705, less North, Leeds and York.
      expect(mockStore.updates.length).toBe(702);
    });

    // Every Meraki site: under North, a unit now.
    for (const index of [1, 350, 700]) {
      expect(site(meraki(index))).toMatchObject({
        parentSiteId: NORTH,
        networkSiteTypeId: UNIT_TYPE,
      });
    }

    // The markets moved; a site with a type keeps it.
    expect(
      mockStore.updates.find((update: { id: string }): boolean => {
        return update.id === LEEDS_STORE;
      })!.data,
    ).toEqual({ parentSiteId: NORTH });

    // North is the parent picked, and Leeds and York were under it already.
    expect(updatedIds()).not.toContain(NORTH);
    expect(updatedIds()).not.toContain(LEEDS);
    expect(updatedIds()).not.toContain(YORK);
    expect(site(NORTH)["parentSiteId"]).toBeUndefined();
    expect(document.body.textContent).toContain(IS_PICKED_PARENT_REASON);

    // The hierarchy above the list reads the moved sites again.
    expect(mockHierarchyToggles[0]).toBe("");
    expect(mockHierarchyToggles[mockHierarchyToggles.length - 1]).not.toBe("");
  });

  test("Clear Parent Site asks first, counting the sites it moves, and moves only them", async () => {
    renderPage();
    await selectRows(["Aaa North", "Aab Leeds", "Aad Store 0660"]);
    await chooseAction(CLEAR_PARENT_SITE_ACTION_TITLE);

    const asked: string = await confirm();
    expect(asked).toContain("Move 2 sites to the top level?");

    await waitFor(() => {
      expect(updatedIds().sort()).toEqual([LEEDS, LEEDS_STORE].sort());
    });

    for (const update of mockStore.updates) {
      expect(update.data).toEqual({ parentSiteId: null });
    }
  });

  test("Set Default Probe and Clear Default Probe write the probe of every site selected", async () => {
    renderPage();
    await selectRows(["Aab Leeds", "Aac York"]);
    await chooseAction(SET_DEFAULT_PROBE_ACTION_TITLE);
    await submit(SET_DEFAULT_PROBE_ACTION_TITLE, { relationId: EDGE_PROBE });

    // York has it already: only Leeds is written.
    await waitFor(() => {
      expect(mockStore.updates).toEqual([
        { id: LEEDS, data: { probeId: EDGE_PROBE } },
      ]);
    });

    cleanup();
    mockStore.updates = [];
    renderPage();
    await selectRows(["Aab Leeds", "Aac York", "Meraki 0001"]);
    await chooseAction(CLEAR_DEFAULT_PROBE_ACTION_TITLE);

    expect(await confirm()).toContain("Clear the default probe of 2 sites?");

    await waitFor(() => {
      expect(updatedIds().sort()).toEqual([LEEDS, YORK].sort());
    });
    expect(site(LEEDS)["probeId"]).toBeNull();
    expect(site(YORK)["probeId"]).toBeNull();
  });

  test("Select All, then Add Labels: every site gets the label and keeps the ones it had", async () => {
    renderPage();
    await selectAll();
    await chooseAction("Add Labels");
    await submit("Add Labels", { labelIds: [BRAND_LABEL] });

    await waitFor(() => {
      expect(mockStore.updates.length).toBe(705);
    });

    expect(site(meraki(700))["labels"]).toEqual([BRAND_LABEL]);
    expect([...site(LEEDS_STORE)["labels"]].sort()).toEqual(
      [BRAND_LABEL, LEGACY_LABEL].sort(),
    );
  });

  test("Remove Labels takes off only the label picked", async () => {
    mockStore.sites.find((each: Row): boolean => {
      return each["_id"] === meraki(1);
    })!["labels"] = [BRAND_LABEL, LEGACY_LABEL];

    renderPage();
    await selectRows(["Aad Store 0660", "Meraki 0001"]);
    await chooseAction("Remove Labels");
    await submit("Remove Labels", { labelIds: [LEGACY_LABEL] });

    await waitFor(() => {
      expect(mockStore.updates.length).toBe(2);
    });

    expect(site(LEEDS_STORE)["labels"]).toEqual([]);
    expect(site(meraki(1))["labels"]).toEqual([BRAND_LABEL]);
  });

  test("Select All, then Add Owner: every site is owned by the person and the team picked", async () => {
    renderPage();
    await selectAll();
    await chooseAction("Add Owner");
    await submit("Add Owner", {
      ownerUserIds: [ALICE],
      ownerTeamIds: [STORE_OPS],
    });

    await waitFor(() => {
      expect(mockStore.creates.length).toBe(1410);
    });

    const ownedByAlice: Set<string> = new Set<string>(
      mockStore.ownerUsers.map((row: Row): string => {
        return row["networkSiteId"];
      }),
    );
    expect(ownedByAlice.size).toBe(705);
    expect(
      mockStore.ownerUsers.every((row: Row): boolean => {
        return row["userId"] === ALICE && row["projectId"] === PROJECT_ID;
      }),
    ).toBe(true);
    expect(
      mockStore.ownerTeams.every((row: Row): boolean => {
        return row["teamId"] === STORE_OPS;
      }),
    ).toBe(true);
  });

  test("Remove Owner deletes the owner rows of the sites selected, and only theirs", async () => {
    mockStore.ownerUsers = [
      {
        _id: id(8, 1),
        networkSiteId: LEEDS,
        userId: ALICE,
        projectId: PROJECT_ID,
      },
      {
        _id: id(8, 2),
        networkSiteId: YORK,
        userId: ALICE,
        projectId: PROJECT_ID,
      },
    ];

    renderPage();
    await selectRows(["Aab Leeds"]);
    await chooseAction("Remove Owner");
    await submit("Remove Owner", { ownerUserIds: [ALICE] });

    await waitFor(() => {
      expect(mockStore.deletes).toEqual([
        { table: "NetworkSiteOwnerUser", id: id(8, 1) },
      ]);
    });
    expect(mockStore.ownerUsers).toHaveLength(1);
  });

  test("for who may only read sites, the site actions are locked, saying why", async () => {
    holding([Permission.Viewer]);
    PermissionGate.clearPermissionPropsCache();

    renderPage();
    await selectRows(["Aac York"]);
    await openBulkActions();

    for (const title of [
      SET_PARENT_SITE_ACTION_TITLE,
      CLEAR_PARENT_SITE_ACTION_TITLE,
      SET_DEFAULT_PROBE_ACTION_TITLE,
      CLEAR_DEFAULT_PROBE_ACTION_TITLE,
    ]) {
      const item: HTMLElement | undefined = menuItem(title);
      expect([title, Boolean(item)]).toEqual([title, true]);
      expect([title, item!.getAttribute("aria-disabled")]).toEqual([
        title,
        "true",
      ]);
    }
  });
});
