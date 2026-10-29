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
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { goTo } from "./SideMenuHarness";
import type { SpyInstance } from "jest-mock";

/*
 * SECURITY EVENTS > DETECTIONS > WATCHLISTS, and one watchlist's page.
 *
 * The list: the project's lists by name, each with what it holds, its
 * values and the rules that read it; created from the table (a name and
 * what it holds, opening the new list's page) or from a common list to
 * start with; deleted one or many at a time; edited only on a list's page,
 * which knows where its values come from.
 *
 * A list's page, the important thing first: its settings (edited there)
 * with the rules that read it, its values - added, edited, deleted and
 * imported for a list the team keeps, or the feed's, for one that follows a
 * threat intel feed - and Use It in a Rule last. Its trail names the list.
 *
 * Beside the side menu at a laptop's width the list fits in three columns;
 * below lg what Holds and Read By say folds under the name, and a value's
 * note under the value (hideBelowLargeScreen), so no row runs under its
 * buttons. A rule's form that names a list the project lacks opens the
 * list here with Create Watchlist and that name in it (?create=).
 *
 * The tables and the settings card are ModelTable and CardModelDetail
 * calls, so their props are pinned; the cells are then drawn from them.
 */

configure({ asyncUtilTimeout: 10000 });
jest.setTimeout(60000);

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

type Column = {
  field: Record<string, unknown>;
  title: string;
  type?: unknown;
  hideOnMobile?: boolean | undefined;
  hideBelowLargeScreen?: boolean | undefined;
  hideTitleOnMobile?: boolean | undefined;
  contentClassName?: string | undefined;
  disableSort?: boolean | undefined;
  getElement?: ((item: unknown) => React.ReactElement) | undefined;
  getExportValue?: ((item: unknown) => string) | undefined;
};

type CapturedTable = {
  id: string;
  singularName?: string | undefined;
  pluralName?: string | undefined;
  createVerb?: string | undefined;
  query: Record<string, unknown>;
  isDeleteable: boolean;
  isEditable?: boolean | undefined;
  isCreateable: boolean;
  isViewable?: boolean | undefined;
  viewPageRoute?: { toString: () => string } | undefined;
  bulkActions?: { buttons: Array<unknown> } | undefined;
  sortBy?: string | undefined;
  sortOrder?: unknown;
  cardProps?:
    | {
        title?: string;
        description?: string;
        buttons?: Array<{
          title: string;
          onClick?: () => void;
          disabled?: boolean;
        }>;
      }
    | undefined;
  emptyState?:
    | {
        title?: string;
        description?: string;
        icon?: unknown;
        actions?: Array<{
          title: string;
          icon?: unknown;
          disabled?: boolean | undefined;
          tooltip?: string | undefined;
          dataTestId?: string | undefined;
          onClick: () => void;
        }>;
      }
    | undefined;
  showCreateForm?: boolean | undefined;
  createInitialValues?: Record<string, unknown> | undefined;
  formFields?: Array<{
    field: Record<string, unknown>;
    customValidation?: (values: Record<string, unknown>) => string | null;
  }>;
  filters: Array<{
    field: Record<string, unknown>;
    title: string;
    filterDropdownOptions?: Array<{ label: string; value: string }>;
  }>;
  searchableFields?: Array<string> | undefined;
  selectMoreFields?: Record<string, unknown> | undefined;
  getItemName?: ((item: unknown) => string) | undefined;
  onCreateSuccess?: ((item: unknown) => Promise<unknown>) | undefined;
  onBeforeCreate?: ((item: unknown) => Promise<unknown>) | undefined;
  columns: Array<Column>;
};

const tables: Record<string, CapturedTable> = {};

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTable) => {
      tables[props.id] = props;
      return React.createElement("div", { "data-testid": props.id });
    },
  };
});

type CapturedDetail = {
  cardProps: { title: string; description?: string };
  isEditable?: boolean;
  formFields: Array<{ field: Record<string, unknown> }>;
  modelDetailProps: {
    modelId: { toString: () => string };
    fields: Array<{
      title: string;
      field: Record<string, unknown>;
      getElement?: ((item: unknown) => React.ReactElement) | undefined;
    }>;
  };
};

let detail: CapturedDetail | null = null;

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: CapturedDetail) => {
      detail = props;
      return React.createElement("div", {
        "data-testid": "security-watchlist-detail",
      });
    },
  };
});

import SecurityWatchlistsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/Watchlists";
import SecurityWatchlistViewPage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/WatchlistView";
import {
  IMPORT_VALUES,
  VALUES_TABLE_DESCRIPTION,
  VALUES_TABLE_DESCRIPTION_HASH,
  VALUES_TABLE_DESCRIPTION_IP,
  VALUE_FIELD_DESCRIPTION,
  WATCHLISTS_EMPTY_DESCRIPTION,
  WATCHLISTS_EMPTY_TITLE,
  WATCHLISTS_TABLE_DESCRIPTION,
  WATCHLISTS_TEST_IDS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Watchlists/WatchlistsCopy";
import { getWatchlistHoldsDropdownOptions } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Watchlists/WatchlistFormFields";
import {
  WATCHLIST_CREATE_PARAM,
  getWatchlistsRoute,
  readWatchlistNameToCreate,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Watchlists/WatchlistsRoute";
import { getSecurityEventsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import { RouteUtil } from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import DetectionRule from "../../../Models/DatabaseModels/DetectionRule";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Project from "../../../Models/DatabaseModels/Project";
import Reseller from "../../../Models/DatabaseModels/Reseller";
import SecurityWatchlist from "../../../Models/DatabaseModels/SecurityWatchlist";
import SecurityWatchlistItem from "../../../Models/DatabaseModels/SecurityWatchlistItem";
import Route from "../../../Types/API/Route";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import { SecurityWatchlistSource } from "../../../Types/SecurityEvent/SecurityWatchlist";
import { ModalTableBulkDefaultActions } from "../../../UI/Components/ModelTable/BaseModelTable";
import Page from "../../../UI/Components/Page/Page";
import {
  TableCellContext,
  TableFoldedColumnsContext,
} from "../../../UI/Components/Table/TableCellContext";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const WATCHLIST_ID: string = "44444444-4444-4444-8444-444444444444";
const FEED_ID: string = "55555555-5555-4555-8555-555555555555";

const LIST_TABLE: string = WATCHLISTS_TEST_IDS.table;
const VALUES_TABLE: string = WATCHLISTS_TEST_IDS.valuesTable;

function rule(id: string, name: string, list: string): DetectionRule {
  const item: DetectionRule = new DetectionRule();
  item._id = id;
  item.name = name;
  item.sigmaRuleYaml = [
    `title: ${name}`,
    "logsource:",
    "  product: okta",
    "detection:",
    "  selection:",
    `    principalUser|expand: '%${list}%'`,
    "  condition: selection",
  ].join("\n");
  return item;
}

const RULES: Array<DetectionRule> = [
  rule(
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    "VIP sign-in from a new country",
    "vip_users",
  ),
  rule("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", "VIP MFA reset", "VIP_USERS"),
  rule(
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
    "Admin from outside",
    "admin_addresses",
  ),
];

let saved: SecurityWatchlist | null = null;
let ruleReads: number = 0;

function list(data: Partial<SecurityWatchlist>): SecurityWatchlist {
  const item: SecurityWatchlist = new SecurityWatchlist();
  item._id = WATCHLIST_ID;
  item.name = "vip_users";
  item.entityType = SecurityEntityType.User;
  item.source = SecurityWatchlistSource.Values;
  item.valueCount = 3;
  Object.assign(item, data);
  return item;
}

function table(id: string): CapturedTable {
  expect(tables[id]).toBeDefined();
  return tables[id]!;
}

function columnTitles(id: string): Array<string> {
  return table(id).columns.map((column: Column): string => {
    return column.title;
  });
}

function columnTitled(id: string, title: string): Column {
  const column: Column | undefined = table(id).columns.find(
    (candidate: Column): boolean => {
      return candidate.title === title;
    },
  );

  expect(column).toBeDefined();

  return column!;
}

/*
 * A column's cell as the table draws it: in a row of a table, and - below
 * lg, where the table leaves a column out (folded) - in a row whose table
 * folds one, as TableBody tells its cells.
 */
function draw(
  id: string,
  title: string,
  item: unknown,
  options: { isFolded?: boolean } = {},
): HTMLElement {
  const column: Column = columnTitled(id, title);

  expect(column.getElement).toBeDefined();

  const { container } = render(
    <MemoryRouter>
      <TableCellContext.Provider value={true}>
        <TableFoldedColumnsContext.Provider value={Boolean(options.isFolded)}>
          {column.getElement!(item)}
        </TableFoldedColumnsContext.Provider>
      </TableCellContext.Provider>
    </MemoryRouter>,
  );

  return container;
}

function flat(element: HTMLElement): string {
  return (element.textContent || "").replace(/\s+/g, " ").trim();
}

beforeEach(() => {
  for (const key of Object.keys(tables)) {
    delete tables[key];
  }

  detail = null;
  saved = list({});
  ruleReads = 0;

  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID(WATCHLIST_ID));
  jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });

  jest.spyOn(ModelAPI, "getList").mockImplementation((async (options: {
    modelType: { new (): BaseModel };
  }) => {
    const model: BaseModel = new options.modelType();

    if (model instanceof DetectionRule) {
      ruleReads++;
      return { data: RULES, count: RULES.length, skip: 0, limit: 200 };
    }

    // The project's lists, as the starters read them: none yet.
    return { data: [], count: 0, skip: 0, limit: 200 };
  }) as never);

  jest.spyOn(ModelAPI, "getItem").mockImplementation((async () => {
    return saved;
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Security Events > Watchlists", () => {
  async function renderList(project?: Project): Promise<void> {
    await act(async () => {
      render(
        <MemoryRouter>
          <SecurityWatchlistsPage
            pageRoute={new Route("/dashboard/security-events/watchlists")}
            currentProject={project || null}
            hasPaymentMethod={true}
          />
        </MemoryRouter>,
      );
    });
  }

  test("is the project's lists by name, under its own words", async () => {
    await renderList();

    expect(table(LIST_TABLE)).toMatchObject({
      singularName: "Watchlist",
      pluralName: "Watchlists",
      query: { projectId: new ObjectID(PROJECT_ID) },
      sortBy: "name",
      sortOrder: SortOrder.Ascending,
      cardProps: {
        title: "Watchlists",
        description: WATCHLISTS_TABLE_DESCRIPTION,
      },
      emptyState: {
        title: WATCHLISTS_EMPTY_TITLE,
        description: WATCHLISTS_EMPTY_DESCRIPTION,
        icon: IconProp.QueueList,
      },
      searchableFields: ["name", "description"],
    });
    expect(columnTitles(LIST_TABLE)).toEqual(["Watchlist", "Holds", "Read By"]);
    expect(table(LIST_TABLE).getItemName!(list({ name: "vip_users" }))).toBe(
      "vip_users",
    );
  });

  test("fits beside the side menu: Holds and Read By fold under the name below lg, each column wraps at a floor that leaves room for the row's buttons", async () => {
    await renderList();

    const name: Column = columnTitled(LIST_TABLE, "Watchlist");
    const holds: Column = columnTitled(LIST_TABLE, "Holds");
    const readBy: Column = columnTitled(LIST_TABLE, "Read By");

    // The name is what a phone's card is about: no label over it, never left out.
    expect(name.hideTitleOnMobile).toBe(true);
    expect(name.hideBelowLargeScreen).toBeUndefined();
    expect(holds.hideBelowLargeScreen).toBe(true);
    expect(readBy.hideBelowLargeScreen).toBe(true);

    /*
     * 684px at 1024 beside the side menu: the check box (64), the three
     * floors and their padding, and the row's buttons - a German
     * "Anzeigen" (162) the widest - fit with room to spare.
     */
    expect(name.contentClassName).toBe("min-w-[9rem]");
    expect(holds.contentClassName).toBe("min-w-[7rem]");
    expect(readBy.contentClassName).toBe("min-w-[6rem]");
    expect(64 + (144 + 24) + (112 + 24) + (96 + 24) + 162).toBeLessThanOrEqual(
      684,
    );
  });

  test("below lg a row says what Holds and Read By said under the name, once", async () => {
    await renderList();

    const row: SecurityWatchlist = list({
      description: "Executives and their assistants.",
      valueCount: 12,
    });

    // At lg and above, the name and what it is for: the columns say the rest.
    const wide: HTMLElement = draw(LIST_TABLE, "Watchlist", row);
    expect(
      within(wide).queryByTestId(WATCHLISTS_TEST_IDS.nameFacts),
    ).toBeNull();
    expect(
      within(wide).queryByTestId(WATCHLISTS_TEST_IDS.nameReadBy),
    ).toBeNull();
    cleanup();

    const folded: HTMLElement = draw(LIST_TABLE, "Watchlist", row, {
      isFolded: true,
    });

    expect(
      flat(within(folded).getByTestId(WATCHLISTS_TEST_IDS.nameFacts)),
    ).toBe("Users · 12 values");
    expect(
      flat(within(folded).getByTestId(WATCHLISTS_TEST_IDS.nameReadBy)),
    ).toBe("Read by: VIP sign-in from a new country, VIP MFA reset");
  });

  test("Export CSV writes each column as the row reads it", async () => {
    await renderList();

    const row: SecurityWatchlist = list({ valueCount: 12 });

    expect(columnTitled(LIST_TABLE, "Watchlist").getExportValue!(row)).toBe(
      "vip_users",
    );
    expect(columnTitled(LIST_TABLE, "Holds").getExportValue!(row)).toBe(
      "Users · 12 values",
    );
    expect(columnTitled(LIST_TABLE, "Read By").getExportValue!(row)).toBe(
      "VIP sign-in from a new country, VIP MFA reset",
    );
  });

  test("opened from a rule's form with a list to create, Create Watchlist opens with its name, and the address forgets it", async () => {
    window.history.replaceState(
      null,
      "",
      `/dashboard/${PROJECT_ID}/security-events/watchlists?${WATCHLIST_CREATE_PARAM}=board_members`,
    );

    await renderList();

    expect(table(LIST_TABLE).showCreateForm).toBe(true);
    expect(table(LIST_TABLE).createInitialValues).toEqual({
      source: SecurityWatchlistSource.Values,
      name: "board_members",
    });
    expect(window.location.search).toBe("");
  });

  test("a name no rule can write is not put in the form; the page opens as it always does", async () => {
    window.history.replaceState(
      null,
      "",
      `/dashboard/${PROJECT_ID}/security-events/watchlists?${WATCHLIST_CREATE_PARAM}=1st%20list`,
    );

    await renderList();

    expect(table(LIST_TABLE).showCreateForm).toBe(false);
    expect(table(LIST_TABLE).createInitialValues).toEqual({
      source: SecurityWatchlistSource.Values,
    });
  });

  test("the address that opens Create Watchlist with a name, and the name read back", () => {
    expect(getWatchlistsRoute().toString()).toBe(
      `/dashboard/${PROJECT_ID}/security-events/watchlists`,
    );
    expect(getWatchlistsRoute("board_members").toString()).toBe(
      `/dashboard/${PROJECT_ID}/security-events/watchlists?create=board_members`,
    );
    // A name a rule cannot write is never put in the address.
    expect(getWatchlistsRoute("board members").toString()).toBe(
      `/dashboard/${PROJECT_ID}/security-events/watchlists`,
    );

    expect(readWatchlistNameToCreate(" board_members ")).toBe("board_members");
    expect(readWatchlistNameToCreate("1st_list")).toBeNull();
    expect(readWatchlistNameToCreate("vip users")).toBeNull();
    expect(readWatchlistNameToCreate("x".repeat(51))).toBeNull();
    expect(readWatchlistNameToCreate("")).toBeNull();
    expect(readWatchlistNameToCreate(null)).toBeNull();
  });

  test("a list is created and deleted here, and opened to be edited", async () => {
    await renderList();

    const captured: CapturedTable = table(LIST_TABLE);

    expect(captured.isCreateable).toBe(true);
    expect(captured.isDeleteable).toBe(true);
    expect(captured.isEditable).toBe(false);
    expect(captured.isViewable).toBe(true);
    expect(captured.bulkActions?.buttons).toEqual([
      ModalTableBulkDefaultActions.Delete,
    ]);
    expect(captured.viewPageRoute?.toString()).toBe(
      `/dashboard/${PROJECT_ID}/security-events/watchlists`,
    );
    expect(captured.showCreateForm).toBe(false);
    expect(captured.createInitialValues).toEqual({
      source: SecurityWatchlistSource.Values,
    });
    expect(
      captured.formFields!.map((field: { field: Record<string, unknown> }) => {
        return Object.keys(field.field)[0];
      }),
    ).toEqual([
      "name",
      "entityType",
      "description",
      "source",
      "threatIntelFeed",
    ]);
  });

  test("a new list opens its page, ready for its values", async () => {
    const navigate: SpyInstance<typeof Navigation.navigate> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation(() => {});

    await renderList();

    await table(LIST_TABLE).onCreateSuccess!(list({}));

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate.mock.calls[0]![0].toString()).toBe(
      `/dashboard/${PROJECT_ID}/security-events/watchlists/${WATCHLIST_ID}`,
    );
  });

  test("a new list no feed can fill keeps its own values, whatever the form hid", async () => {
    await renderList();

    const created: SecurityWatchlist = (await table(LIST_TABLE).onBeforeCreate!(
      list({
        entityType: SecurityEntityType.User,
        source: SecurityWatchlistSource.ThreatIntelFeed,
        threatIntelFeedId: new ObjectID(FEED_ID),
      }),
    )) as SecurityWatchlist;

    expect(created.source).toBe(SecurityWatchlistSource.Values);
    expect(created.threatIntelFeedId).toBeUndefined();
  });

  test("lists are filtered by what they hold", async () => {
    await renderList();

    expect(table(LIST_TABLE).filters).toEqual([
      expect.objectContaining({
        field: { entityType: true },
        title: "Holds",
        filterDropdownOptions: getWatchlistHoldsDropdownOptions(),
      }),
    ]);
  });

  test("a row: its name, what it holds with its values under it, and the rules that read it", async () => {
    await renderList();

    const row: SecurityWatchlist = list({
      description: "Executives and their assistants.",
      valueCount: 12,
    });

    expect(flat(draw(LIST_TABLE, "Watchlist", row))).toBe(
      "vip_usersExecutives and their assistants.",
    );

    const holds: HTMLElement = draw(LIST_TABLE, "Holds", row);
    expect(flat(within(holds).getByTestId(WATCHLISTS_TEST_IDS.holdsCell))).toBe(
      "Users",
    );
    expect(
      flat(within(holds).getByTestId(WATCHLISTS_TEST_IDS.valuesCell)),
    ).toBe("12 values");

    const readBy: HTMLElement = draw(LIST_TABLE, "Read By", row);
    expect(readBy).toHaveTextContent("VIP sign-in from a new country");
    expect(readBy).toHaveTextContent("VIP MFA reset");
    expect(readBy).not.toHaveTextContent("Admin from outside");

    expect(
      flat(draw(LIST_TABLE, "Read By", list({ name: "critical_hosts" }))),
    ).toBe("No rule reads it yet");

    // One read of the project's rules for every row.
    expect(ruleReads).toBe(1);
  });

  test("a list that follows a feed names the feed in its values", async () => {
    await renderList();

    const row: SecurityWatchlist = list({
      name: "c2_addresses",
      entityType: SecurityEntityType.IpAddress,
      source: SecurityWatchlistSource.ThreatIntelFeed,
      threatIntelFeedId: new ObjectID(FEED_ID),
      threatIntelFeed: { name: "Feodo Tracker C2" } as never,
    });

    expect(
      flat(
        within(draw(LIST_TABLE, "Holds", row)).getByTestId(
          WATCHLISTS_TEST_IDS.valuesCell,
        ),
      ),
    ).toBe("Follows Feodo Tracker C2");
  });

  test("the common lists to start with sit above the table", async () => {
    await renderList();

    expect(
      await screen.findByTestId(WATCHLISTS_TEST_IDS.starters),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`${WATCHLISTS_TEST_IDS.starter}-vip-users`),
    ).toBeInTheDocument();
  });

  test("a reseller's plan without telemetry says so, and lists nothing", async () => {
    const project: Project = new Project();
    project.reseller = new Reseller();
    project.reseller.enableTelemetryFeatures = false;

    await renderList(project);

    expect(
      screen.getByText(/did not include telemetry features/),
    ).toBeInTheDocument();
    expect(tables[LIST_TABLE]).toBeUndefined();
  });
});

describe("a watchlist's page", () => {
  const VIEW_PATH: string = RouteUtil.getRouteString(
    PageMap.SECURITY_EVENTS_WATCHLIST_VIEW,
  )
    .replace(":projectId", PROJECT_ID)
    .replace(":id", WATCHLIST_ID);

  async function renderView(): Promise<void> {
    goTo(VIEW_PATH);

    await act(async () => {
      render(
        <MemoryRouter>
          <Page
            title="Security Events"
            breadcrumbLinks={getSecurityEventsBreadcrumbs(VIEW_PATH)}
          >
            <SecurityWatchlistViewPage
              pageRoute={new Route(VIEW_PATH)}
              currentProject={null}
              hasPaymentMethod={true}
            />
          </Page>
        </MemoryRouter>,
      );
    });
  }

  function trail(): Array<string> {
    return Array.from(
      screen
        .getByRole("navigation", { name: "Breadcrumb" })
        .querySelectorAll("li"),
    ).map((item: HTMLLIElement): string => {
      return (item.textContent || "").trim();
    });
  }

  test("its trail names the list", async () => {
    await renderView();

    expect(trail()).toEqual([
      "Project",
      "Security Events",
      "Detections",
      "Watchlists",
      "vip_users",
    ]);
  });

  test("its settings: the name as written, what it holds, its values, the rules that read it", async () => {
    await renderView();

    expect(detail).not.toBeNull();
    expect(detail!.cardProps.title).toBe("About This List");
    expect(detail!.isEditable).toBe(true);
    expect(detail!.modelDetailProps.modelId.toString()).toBe(WATCHLIST_ID);
    /*
     * Where the values come from is what the Values field says - a count,
     * or the feed it follows - so it is not a field of its own.
     */
    expect(
      detail!.modelDetailProps.fields.map((field: { title: string }) => {
        return field.title;
      }),
    ).toEqual(["Name", "Holds", "Values", "Read By", "Description"]);

    type DetailField = CapturedDetail["modelDetailProps"]["fields"][number];

    const fieldTitled: (title: string) => DetailField = (
      title: string,
    ): DetailField => {
      return detail!.modelDetailProps.fields.find(
        (field: { title: string }): boolean => {
          return field.title === title;
        },
      )!;
    };

    const { container: name } = render(fieldTitled("Name").getElement!(saved));
    expect(within(name).getByText("vip_users")).toHaveClass("font-mono");

    const { container: count } = render(
      fieldTitled("Values").getElement!(saved),
    );
    expect(flat(count)).toBe("3 values");

    // Every rule that reads it, by name, whatever case the rule wrote.
    const { container: readers } = render(
      fieldTitled("Read By").getElement!(saved),
    );
    expect(flat(readers)).toBe("VIP sign-in from a new country, VIP MFA reset");

    // Edit changes the name and the description: what it holds was chosen once.
    expect(
      detail!.formFields.map((field: { field: Record<string, unknown> }) => {
        return Object.keys(field.field)[0];
      }),
    ).toEqual(["name", "description"]);
  });

  test("Use It in a Rule: the selection that reads it, after the values", async () => {
    await renderView();

    const snippet: HTMLElement = screen.getByTestId(
      WATCHLISTS_TEST_IDS.ruleSnippet,
    );

    expect(snippet.textContent).toContain(
      "principalUser|expand: '%vip_users%'",
    );

    // The important thing first: what the list is, its values, then how a rule reads it.
    const order: Array<string> = [
      "security-watchlist-detail",
      VALUES_TABLE,
      WATCHLISTS_TEST_IDS.ruleSnippet,
    ];
    const drawn: Array<HTMLElement> = order.map((id: string): HTMLElement => {
      return screen.getByTestId(id);
    });

    for (let index: number = 1; index < drawn.length; index++) {
      expect(
        drawn[index - 1]!.compareDocumentPosition(drawn[index]!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  test("its values: added, edited and deleted here, each with why it is on the list", async () => {
    await renderView();

    const values: CapturedTable = table(VALUES_TABLE);

    expect(values).toMatchObject({
      singularName: "Value",
      pluralName: "Values",
      createVerb: "Add",
      isCreateable: true,
      isEditable: true,
      isDeleteable: true,
      isViewable: false,
      sortBy: "value",
      searchableFields: ["value", "note"],
      createInitialValues: { securityWatchlistId: new ObjectID(WATCHLIST_ID) },
      cardProps: { title: "Values", description: VALUES_TABLE_DESCRIPTION },
    });
    expect(values.query).toEqual({
      projectId: new ObjectID(PROJECT_ID),
      securityWatchlistId: new ObjectID(WATCHLIST_ID),
    });
    expect(values.bulkActions?.buttons).toEqual([
      ModalTableBulkDefaultActions.Delete,
    ]);
    // Two columns, as a rule exception's list reads: who added it is under the note.
    expect(columnTitles(VALUES_TABLE)).toEqual(["Value", "Note"]);
    expect(values.selectMoreFields).toEqual({
      createdAt: true,
      createdByUser: { name: true, email: true },
    });

    const item: SecurityWatchlistItem = new SecurityWatchlistItem();
    item.value = "alice@example.com";
    item.note = "CFO";

    expect(
      within(draw(VALUES_TABLE, "Value", item)).getByText("alice@example.com"),
    ).toHaveClass("font-mono");
    expect(
      flat(
        within(draw(VALUES_TABLE, "Note", item)).getByTestId(
          WATCHLISTS_TEST_IDS.noteCell,
        ),
      ),
    ).toBe("CFOAdded through the API");
    // A value with no note says only who added it.
    expect(
      flat(
        within(
          draw(VALUES_TABLE, "Note", new SecurityWatchlistItem()),
        ).getByTestId(WATCHLISTS_TEST_IDS.noteCell),
      ),
    ).toBe("Added through the API");
    expect(values.getItemName!(item)).toBe("alice@example.com");
    expect(columnTitled(VALUES_TABLE, "Value").getExportValue!(item)).toBe(
      "alice@example.com",
    );
    expect(columnTitled(VALUES_TABLE, "Note").getExportValue!(item)).toBe(
      "CFO",
    );

    /*
     * Below lg the note folds under the value: beside the side menu at 768
     * the card is too narrow for both beside the row's buttons.
     */
    expect(columnTitled(VALUES_TABLE, "Value").hideTitleOnMobile).toBe(true);
    expect(columnTitled(VALUES_TABLE, "Note").hideBelowLargeScreen).toBe(true);
    expect(
      within(draw(VALUES_TABLE, "Value", item)).queryByTestId(
        WATCHLISTS_TEST_IDS.noteCell,
      ),
    ).toBeNull();
    expect(
      flat(
        within(
          draw(VALUES_TABLE, "Value", item, { isFolded: true }),
        ).getByTestId(WATCHLISTS_TEST_IDS.noteCell),
      ),
    ).toBe("CFOAdded through the API");

    // A value is checked against what the list holds, as the API checks it.
    const valueField: {
      customValidation?: (values: Record<string, unknown>) => string | null;
    } = values.formFields![0]!;
    expect(valueField.customValidation!({ value: "*" })).toBe(
      "A value of only * would match everything.",
    );
    expect(valueField.customValidation!({ value: "svc-*" })).toBeNull();

    // How a value matches, in a user list's words, over the list and in Add Value.
    expect(
      (values.formFields![0]! as unknown as { description?: string })
        .description,
    ).toBe(VALUES_TABLE_DESCRIPTION);

    // A new value is put on this list.
    const created: SecurityWatchlistItem = (await values.onBeforeCreate!(
      new SecurityWatchlistItem(),
    )) as SecurityWatchlistItem;
    expect(created.securityWatchlistId?.toString()).toBe(WATCHLIST_ID);
  });

  test("an IP address list's values are addresses, ranges and patterns", async () => {
    saved = list({
      name: "admin_addresses",
      entityType: SecurityEntityType.IpAddress,
    });

    await renderView();

    const values: CapturedTable = table(VALUES_TABLE);

    expect(values.cardProps?.description).toBe(VALUES_TABLE_DESCRIPTION_IP);
    expect(
      (values.formFields![0]! as unknown as { description?: string })
        .description,
    ).toBe(VALUES_TABLE_DESCRIPTION_IP);
    expect(
      values.formFields![0]!.customValidation!({ value: "not an address" }),
    ).toBe(
      "Enter an IP address, a range such as 10.20.0.0/16, or a pattern with *.",
    );
    expect(
      values.formFields![0]!.customValidation!({ value: "10.20.0.0/16" }),
    ).toBeNull();
  });

  test("a file hash list's values are digests: no word of * over them", async () => {
    saved = list({
      name: "known_bad_hashes",
      entityType: SecurityEntityType.FileHash,
    });

    await renderView();

    const values: CapturedTable = table(VALUES_TABLE);

    expect(values.cardProps?.description).toBe(VALUES_TABLE_DESCRIPTION_HASH);
    expect(values.cardProps?.description).not.toContain("*");
    expect(
      (values.formFields![0]! as unknown as { description?: string })
        .description,
    ).toBe(VALUES_TABLE_DESCRIPTION_HASH);
    expect(values.formFields![0]!.customValidation!({ value: "abc*" })).toBe(
      "Enter an MD5, SHA-1, SHA-256 or SHA-512 hash.",
    );
  });

  test("a host list's values say how they match without a user's example", async () => {
    saved = list({
      name: "critical_hosts",
      entityType: SecurityEntityType.Host,
    });

    await renderView();

    expect(table(VALUES_TABLE).cardProps?.description).toBe(
      VALUE_FIELD_DESCRIPTION,
    );
    expect(table(VALUES_TABLE).cardProps?.description).not.toContain("svc-*");
  });

  test("an empty list offers both ways to fill it: Add Value, and Import Values", async () => {
    await renderView();

    const actions: Array<{
      title: string;
      icon?: unknown;
      dataTestId?: string | undefined;
      onClick: () => void;
    }> = table(VALUES_TABLE).emptyState!.actions!;

    expect(
      actions.map((action: { title: string }) => {
        return action.title;
      }),
    ).toEqual([IMPORT_VALUES]);
    expect(actions[0]!.icon).toBe(IconProp.Upload);
    expect(actions[0]!.dataTestId).toBe(WATCHLISTS_TEST_IDS.importEmpty);

    await act(async () => {
      actions[0]!.onClick();
    });

    expect(
      screen.getByTestId(WATCHLISTS_TEST_IDS.importModal),
    ).toBeInTheDocument();
  });

  test("a reader who may not add values sees the empty list's Import locked, with why", async () => {
    jest.spyOn(PermissionGate, "check").mockImplementation(((
      model: unknown,
    ) => {
      return model instanceof SecurityWatchlistItem
        ? {
            isAllowed: false,
            disabledReason: "You need this permission: Edit Detection Rule.",
          }
        : { isAllowed: true };
    }) as never);

    await renderView();

    const action: {
      disabled?: boolean | undefined;
      tooltip?: string | undefined;
    } = table(VALUES_TABLE).emptyState!.actions![0]!;

    expect(action.disabled).toBe(true);
    expect(action.tooltip).toBe(
      "You need this permission: Edit Detection Rule.",
    );
  });

  test("Import Values opens the dialog", async () => {
    await renderView();

    const buttons: Array<{ title: string; onClick?: () => void }> =
      table(VALUES_TABLE).cardProps!.buttons!;

    expect(
      buttons.map((button: { title: string }) => {
        return button.title;
      }),
    ).toEqual([IMPORT_VALUES]);

    await act(async () => {
      buttons[0]!.onClick!();
    });

    expect(
      screen.getByTestId(WATCHLISTS_TEST_IDS.importModal),
    ).toBeInTheDocument();
  });

  test("a role that cannot add values is offered no import", async () => {
    jest.spyOn(PermissionGate, "check").mockImplementation(((
      model: unknown,
    ) => {
      return model instanceof SecurityWatchlistItem
        ? { isAllowed: false }
        : { isAllowed: true };
    }) as never);

    await renderView();

    expect(table(VALUES_TABLE).cardProps!.buttons).toEqual([]);
    expect(table(VALUES_TABLE).emptyState!.actions).toEqual([]);
  });

  test("a list that follows a feed shows the feed's values, never a table of its own", async () => {
    saved = list({
      name: "c2_addresses",
      entityType: SecurityEntityType.IpAddress,
      source: SecurityWatchlistSource.ThreatIntelFeed,
      threatIntelFeedId: new ObjectID(FEED_ID),
      threatIntelFeed: { name: "Feodo Tracker C2" } as never,
    });

    await renderView();

    expect(tables[VALUES_TABLE]).toBeUndefined();

    const feed: HTMLElement = screen.getByTestId(
      WATCHLISTS_TEST_IDS.feedValues,
    );

    expect(feed).toHaveTextContent(
      "This list follows Feodo Tracker C2: the feed's active indicators of the list's kind are its values, kept up to date as the feed is read.",
    );
    expect(
      within(feed).getByText("Open Threat Intel").closest("a"),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/security-events/threat-intel`,
    );

    // Its settings name the feed as its values, and Edit changes it.
    expect(
      detail!.modelDetailProps.fields.map((field: { title: string }) => {
        return field.title;
      }),
    ).toEqual(["Name", "Holds", "Values", "Read By", "Description"]);

    const values: { getElement?: (item: unknown) => React.ReactElement } =
      detail!.modelDetailProps.fields.find((field: { title: string }) => {
        return field.title === "Values";
      })!;
    const { container: feedValues } = render(values.getElement!(saved));
    expect(flat(feedValues)).toBe("Follows Feodo Tracker C2");
    expect(
      detail!.formFields.map((field: { field: Record<string, unknown> }) => {
        return Object.keys(field.field)[0];
      }),
    ).toEqual(["name", "threatIntelFeed", "description"]);
  });

  test("a list whose feed was deleted says so, and how to choose another", async () => {
    saved = list({
      name: "c2_addresses",
      entityType: SecurityEntityType.IpAddress,
      source: SecurityWatchlistSource.ThreatIntelFeed,
    });

    await renderView();

    expect(
      screen.getByTestId(WATCHLISTS_TEST_IDS.feedValues),
    ).toHaveTextContent(
      "The threat intel feed this list followed was deleted, so the list holds nothing. Choose another feed in Edit.",
    );
  });

  test("a list deleted, or not the reader's to read, says so", async () => {
    saved = null;

    await renderView();

    expect(
      screen.getByText("This watchlist was deleted, or you cannot read it."),
    ).toBeInTheDocument();
    expect(detail).toBeNull();
    // Reading it again finds nothing more: no Refresh.
    expect(screen.queryByTestId("refresh-button")).toBeNull();
  });

  test("a read that fails says why, and Refresh reads it again", async () => {
    let reads: number = 0;

    jest.spyOn(ModelAPI, "getItem").mockImplementation((async () => {
      reads++;

      if (reads === 1) {
        throw new Error("The server could not be reached. Please try again.");
      }

      return saved;
    }) as never);

    await renderView();

    expect(
      screen.getByText("The server could not be reached. Please try again."),
    ).toBeInTheDocument();
    expect(detail).toBeNull();

    await act(async () => {
      screen.getByTestId("refresh-button").click();
    });

    expect(reads).toBe(2);
    expect(detail).not.toBeNull();
    expect(screen.queryByTestId("refresh-button")).toBeNull();
  });
});
