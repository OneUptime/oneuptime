import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * An empty model table, rendered for real.
 *
 * An empty list used to say "No monitors found." with an underlined
 * "Refresh?" under it. On a project that simply has none yet that reads like
 * a failed load, said nothing about what the list was for, and the only way
 * on was a button in the card's header. Every model table now shows a real
 * empty state - the model's icon, "No X yet", what the list is for (the
 * card's description, which leaves the header meanwhile), the header's
 * create button and the table's help link - and the other reasons a table
 * can be empty each get their own: a search or filter that missed (with the
 * way to clear it), a list where empty is good news, a viewer without
 * access.
 */

let isMasterAdminForTest: boolean = true;

/*
 * Two different reads of the viewer's permissions, kept apart on purpose.
 * The create gate (PermissionGate.check) reads getAllPermissions; which
 * COLUMNS a viewer may read comes from getProjectPermissions. Holding the
 * second fixed at "can read monitors" keeps the table itself on screen, so
 * most tests below are about the create gate alone.
 */
let permissionsForTest: Array<unknown> = [];
let columnReadPermissions: Array<unknown> = ["ProjectOwner"];

jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): { permissions: Array<unknown> } => {
        return {
          permissions: columnReadPermissions.map((permission: unknown) => {
            return { permission: permission };
          }),
        };
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return isMasterAdminForTest;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../../UI/Utils/Translation", () => {
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

import BaseModelTable, {
  BaseTableCallbacks,
  ComponentProps as BaseModelTableProps,
  ShowAs,
} from "../../../../UI/Components/ModelTable/BaseModelTable";
import EmptyStateOptions from "../../../../UI/Components/ModelTable/EmptyStateOptions";
import TableFilterUrlState from "../../../../UI/Utils/TableFilterUrlState";
import PermissionGate from "../../../../UI/Utils/PermissionGate";
import Navigation from "../../../../UI/Utils/Navigation";
import FieldType from "../../../../UI/Components/Types/FieldType";
import { ButtonStyleType } from "../../../../UI/Components/Button/Button";
import { CardButtonSchema } from "../../../../UI/Components/Card/Card";
import { TableEmptyStateKind } from "../../../../UI/Components/Table/TableEmptyState";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import IconProp from "../../../../Types/Icon/IconProp";
import Permission from "../../../../Types/Permission";
import ListResult from "../../../../Types/BaseDatabase/ListResult";
import Route from "../../../../Types/API/Route";
import { JSONObject } from "../../../../Types/JSON";
import { getJestSpyOn } from "../../../Spy";

const CTA_TEST_ID: string = "empty-table-create-button";
const CLEAR_TEST_ID: string = "empty-table-clear-filters-button";
const TABLE_ID: string = "monitors-cta-table";
const NO_ITEMS_TEST_ID: string = `${TABLE_ID}-no-items`;
const CARD_DESCRIPTION: string =
  "Monitors check your websites and APIs on a schedule.";

// Restated, not imported: the sentence is what a locked button tells a user.
const CREATE_DENIED_MESSAGE: string =
  "You do not have permission to create this Monitor.";
const CREATE_NOT_ALLOWED_NOTE: string =
  "You don't have permission to create these. Ask a project admin for access.";

const ROWS: Array<JSONObject> = [
  { _id: "monitor-1", name: "Checkout API", description: "Payments" },
];

interface TableOptions {
  rows?: Array<JSONObject> | undefined;
  isCreateable?: boolean | undefined;
  withCard?: boolean | undefined;
  cardButtons?: Array<CardButtonSchema> | undefined;
  noItemsMessage?: string | React.ReactElement | undefined;
  emptyState?: EmptyStateOptions | undefined;
  initialFilterData?: JSONObject | undefined;
  createVerb?: string | undefined;
  singularName?: string | undefined;
  onCreateClick?: (() => void) | undefined;
  helpContent?: BaseModelTableProps<Monitor>["helpContent"] | undefined;
  documentationLink?: Route | undefined;
  showAs?: ShowAs | undefined;
}

let showCreateEditModalCalls: number = 0;
let fetchedQueries: Array<JSONObject> = [];

type MakePropsFunction = (
  options: TableOptions,
) => BaseModelTableProps<Monitor>;

const makeProps: MakePropsFunction = (
  options: TableOptions,
): BaseModelTableProps<Monitor> => {
  const rows: Array<JSONObject> = options.rows ?? [];

  const callbacks: BaseTableCallbacks<Monitor> = {
    deleteItem: async (): Promise<void> => {
      return undefined;
    },
    getModelFromJSON: (item: JSONObject): Monitor => {
      return item as unknown as Monitor;
    },
    getJSONFromModel: (item: Monitor): JSONObject => {
      return item as unknown as JSONObject;
    },
    addSlugToSelect: (select: unknown): unknown => {
      return select;
    },
    getList: async (data: {
      skip: number;
      limit: number;
      query: JSONObject;
    }): Promise<ListResult<Monitor>> => {
      fetchedQueries.push(data.query);

      return {
        data: rows as unknown as Array<Monitor>,
        count: rows.length,
        skip: data.skip,
        limit: data.limit,
      };
    },
    toJSONArray: (): Array<JSONObject> => {
      return [];
    },
    updateById: async (): Promise<void> => {
      return undefined;
    },
    showCreateEditModal: (): React.ReactElement => {
      showCreateEditModalCalls++;
      return <div data-testid="create-edit-modal" />;
    },
  } as unknown as BaseTableCallbacks<Monitor>;

  return {
    modelType: Monitor,
    id: TABLE_ID,
    name: "Monitors",
    singularName: options.singularName ?? "Monitor",
    pluralName: "Monitors",
    userPreferencesKey: TABLE_ID,
    urlStateKey: TABLE_ID,
    columns: [
      { field: { name: true }, title: "Name", type: FieldType.Text },
      {
        field: { description: true },
        title: "Description",
        type: FieldType.LongText,
      },
    ],
    filters: [],
    searchableFields: ["name"],
    ...(options.withCard === false
      ? {}
      : {
          cardProps: {
            title: "Monitors",
            description: CARD_DESCRIPTION,
            ...(options.cardButtons ? { buttons: options.cardButtons } : {}),
          },
        }),
    isCreateable: options.isCreateable ?? true,
    isEditable: false,
    isDeleteable: false,
    isViewable: false,
    noItemsMessage: options.noItemsMessage,
    emptyState: options.emptyState,
    initialFilterData: options.initialFilterData,
    createVerb: options.createVerb,
    onCreateClick: options.onCreateClick,
    helpContent: options.helpContent,
    documentationLink: options.documentationLink,
    showAs: options.showAs,
    callbacks: callbacks,
  } as unknown as BaseModelTableProps<Monitor>;
};

type RenderTableFunction = (
  options?: TableOptions | undefined,
) => ReturnType<typeof render>;

const renderTable: RenderTableFunction = (
  options?: TableOptions | undefined,
): ReturnType<typeof render> => {
  return render(<BaseModelTable<Monitor> {...makeProps(options || {})} />);
};

type WaitForEmptyTableFunction = () => Promise<HTMLElement>;

// The no-items block only exists once the (mocked) fetch has come back empty.
const waitForEmptyTable: WaitForEmptyTableFunction =
  async (): Promise<HTMLElement> => {
    await waitFor(() => {
      expect(screen.getByTestId(NO_ITEMS_TEST_ID)).toBeInTheDocument();
    });

    return screen.getByTestId(NO_ITEMS_TEST_ID);
  };

type WaitForCtaFunction = () => Promise<HTMLElement>;

/*
 * The header's buttons are built in an effect after the first render, so the
 * empty state can be on screen a render before its button is.
 */
const waitForCta: WaitForCtaFunction = async (): Promise<HTMLElement> => {
  await waitFor(() => {
    expect(screen.getByTestId(CTA_TEST_ID)).toBeInTheDocument();
  });

  return screen.getByTestId(CTA_TEST_ID);
};

type SettleFunction = () => Promise<void>;

/*
 * "Not there" has to be checked after everything that could put it there
 * has had its chance: the header's effect has run once the header's own
 * button (or the absence of one) has settled.
 */
const settle: SettleFunction = async (): Promise<void> => {
  await waitForEmptyTable();
  await new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, 50);
  });
};

type ExpectNoCtaFunction = () => Promise<void>;

const expectNoCtaAfterSettling: ExpectNoCtaFunction =
  async (): Promise<void> => {
    await settle();

    expect(screen.queryByTestId(CTA_TEST_ID)).toBeNull();
  };

const kindOf: (block: HTMLElement) => string | null = (
  block: HTMLElement,
): string | null => {
  return (
    block
      .querySelector("[data-empty-state-kind]")
      ?.getAttribute("data-empty-state-kind") || null
  );
};

const titleOf: (block: HTMLElement) => string = (
  block: HTMLElement,
): string => {
  return (
    block.querySelector('[data-testid="table-empty-state-title"]')
      ?.textContent || ""
  );
};

beforeEach(() => {
  isMasterAdminForTest = true;
  permissionsForTest = [];
  columnReadPermissions = ["ProjectOwner"];
  showCreateEditModalCalls = 0;
  fetchedQueries = [];
  PermissionGate.clearPermissionPropsCache();
  window.history.replaceState(window.history.state, "", "/dashboard/monitors");
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("an empty table: nothing here yet", () => {
  test("is headed by the table's own 'No X yet', with the model's icon", async () => {
    renderTable();

    const block: HTMLElement = await waitForEmptyTable();

    expect(titleOf(block)).toBe("No monitors yet");
    expect(kindOf(block)).toBe(TableEmptyStateKind.Empty);
    expect(block.querySelector("[data-icon]")).toHaveAttribute(
      "data-icon",
      new Monitor().icon as string,
    );
  });

  test("says what the list is for, in the card's words, and the header leaves them out", async () => {
    renderTable();

    const block: HTMLElement = await waitForEmptyTable();

    expect(
      within(block).getByTestId("table-empty-state-description"),
    ).toHaveTextContent(CARD_DESCRIPTION);
    // Said once, not twice a few lines apart.
    expect(screen.queryByTestId("card-description")).toBeNull();
    expect(screen.getAllByText(CARD_DESCRIPTION)).toHaveLength(1);
  });

  test("once there are rows, the card's description is back in its header", async () => {
    renderTable({ rows: ROWS });

    await waitFor(() => {
      expect(screen.getByText("Checkout API")).toBeInTheDocument();
    });

    expect(screen.getByTestId("card-description")).toHaveTextContent(
      CARD_DESCRIPTION,
    );
    expect(screen.queryByTestId(NO_ITEMS_TEST_ID)).toBeNull();
  });

  test("offers the header's create button, drawn the header's plain way", async () => {
    renderTable();

    const cta: HTMLElement = await waitForCta();
    const header: HTMLElement = screen.getByTestId("card-button");

    expect(screen.getByTestId(NO_ITEMS_TEST_ID)).toContainElement(cta);
    expect(cta).toHaveTextContent("Create Monitor");
    expect(cta.textContent?.trim()).toBe(header.textContent?.trim());
    expect(cta.className).not.toContain("bg-indigo");
    expect(cta.className).toContain("bg-white");
    expect(cta.className).toContain("border-gray-300");
  });

  test("has no Refresh? link anywhere", async () => {
    renderTable();

    await waitForCta();

    expect(screen.queryByTestId("refresh-button")).toBeNull();
    expect(screen.queryByText("Refresh?")).toBeNull();
  });

  test("has no pagination footer under it", async () => {
    renderTable();

    await waitForCta();

    expect(screen.queryByText("Rows per page")).toBeNull();
  });

  test("follows a table's own create verb", async () => {
    renderTable({ createVerb: "Declare", singularName: "Incident" });

    const cta: HTMLElement = await waitForCta();

    expect(cta).toHaveTextContent("Declare Incident");
  });

  test("opens the same create form the header button opens", async () => {
    renderTable();

    fireEvent.click(await waitForCta());

    await waitFor(() => {
      expect(screen.getByTestId("create-edit-modal")).toBeInTheDocument();
    });
    expect(showCreateEditModalCalls).toBeGreaterThan(0);
  });

  test("goes through the table's onCreateClick when it has one", async () => {
    let createClicks: number = 0;

    renderTable({
      onCreateClick: () => {
        createClicks++;
      },
    });

    fireEvent.click(await waitForCta());

    expect(createClicks).toBe(1);
    expect(screen.queryByTestId("create-edit-modal")).toBeNull();
  });

  test("disappears once there are rows", async () => {
    renderTable({ rows: ROWS });

    await waitFor(() => {
      expect(screen.getByText("Checkout API")).toBeInTheDocument();
    });

    expect(screen.queryByTestId(NO_ITEMS_TEST_ID)).toBeNull();
    expect(screen.queryByTestId(CTA_TEST_ID)).toBeNull();
  });

  test("the list layout draws it too", async () => {
    renderTable({ showAs: ShowAs.List });

    const block: HTMLElement = await waitForEmptyTable();

    expect(titleOf(block)).toBe("No monitors yet");
    await waitForCta();
  });
});

describe("a way to read more", () => {
  test("the table's help opens from the empty state", async () => {
    renderTable({
      helpContent: {
        title: "How Monitors Work",
        description: "What a monitor checks and when.",
        markdown: "# Monitors",
      },
    });

    await waitForEmptyTable();

    const help: HTMLElement = screen.getByTestId("empty-table-help-link");
    expect(help).toHaveTextContent("How Monitors Work");

    fireEvent.click(help);

    await waitFor(() => {
      expect(
        screen.getByText("What a monitor checks and when."),
      ).toBeInTheDocument();
    });
  });

  test("without help, the documentation link opens the docs in a new tab", async () => {
    const navigate: jest.SpyInstance<any, any> = getJestSpyOn(
      Navigation,
      "navigate",
    ).mockImplementation(() => {});

    renderTable({ documentationLink: new Route("/docs/monitor") });

    await waitForEmptyTable();

    const docs: HTMLElement = screen.getByTestId("empty-table-docs-link");
    expect(docs).toHaveTextContent("View Documentation");

    fireEvent.click(docs);

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(String(navigate.mock.calls[0]![0])).toBe("/docs/monitor");
    expect(navigate.mock.calls[0]![1]).toEqual({ openInNewTab: true });
  });
});

describe("a create button the page put in the card's header itself", () => {
  /*
   * Monitors, Incidents, Alerts and Scheduled Maintenance create on a page of
   * their own (or through a gated card button), with isCreateable off. Their
   * "Create" is a card button with the Add icon - and that is the one the
   * empty state has to mirror.
   */
  test.each([
    ["NORMAL", ButtonStyleType.NORMAL],
    ["PRIMARY", ButtonStyleType.PRIMARY],
  ])(
    "an Add button styled %s is mirrored, handler and all",
    async (_style: string, buttonStyle: ButtonStyleType) => {
      let clicks: number = 0;

      renderTable({
        isCreateable: false,
        cardButtons: [
          {
            title: "Create Monitor",
            buttonStyle: buttonStyle,
            icon: IconProp.Add,
            onClick: () => {
              clicks++;
            },
          },
        ],
      });

      const cta: HTMLElement = await waitForCta();

      expect(cta).toHaveTextContent("Create Monitor");
      // Plain even when the header's own is the filled primary one.
      expect(cta.className).not.toContain("bg-indigo");

      fireEvent.click(cta);

      expect(clicks).toBe(1);
    },
  );

  test("an OUTLINE Add button (an import, say) is not a create action", async () => {
    renderTable({
      isCreateable: false,
      cardButtons: [
        {
          title: "Import from CSV",
          buttonStyle: ButtonStyleType.OUTLINE,
          icon: IconProp.Add,
          onClick: () => {},
        },
      ],
    });

    await expectNoCtaAfterSettling();
    expect(screen.queryByTestId("refresh-button")).toBeNull();
  });

  test("a primary button that creates nothing (no Add icon) is not mirrored", async () => {
    renderTable({
      isCreateable: false,
      cardButtons: [
        {
          title: "Run Runbook",
          buttonStyle: ButtonStyleType.PRIMARY,
          icon: IconProp.Play,
          onClick: () => {},
        },
      ],
    });

    await expectNoCtaAfterSettling();
  });

  test("with a gated card button disabled, the empty state's copy is disabled too, and says why", async () => {
    let clicks: number = 0;

    renderTable({
      isCreateable: false,
      cardButtons: [
        {
          title: "Create Monitor",
          buttonStyle: ButtonStyleType.NORMAL,
          icon: IconProp.Add,
          disabled: true,
          tooltip: "Upgrade to create more monitors.",
          onClick: () => {
            clicks++;
          },
        },
      ],
    });

    const cta: HTMLElement = await waitForCta();

    expect(cta).toBeDisabled();
    // The page's own reason, since the viewer may create monitors.
    expect(screen.getByTestId("table-empty-state-note")).toHaveTextContent(
      "Upgrade to create more monitors.",
    );

    fireEvent.click(cta);

    expect(clicks).toBe(0);
  });
});

describe("the create button follows the header's permission gate", () => {
  test("a viewer who may not create sees it locked, not removed", async () => {
    isMasterAdminForTest = false;
    permissionsForTest = [Permission.Viewer];

    renderTable();

    const cta: HTMLElement = await waitForCta();

    expect(cta).toBeDisabled();
    expect(screen.getByTestId("card-button")).toBeDisabled();
  });

  test("and the empty state says why, in words a phone can show", async () => {
    isMasterAdminForTest = false;
    permissionsForTest = [Permission.Viewer];

    renderTable();

    await waitForCta();

    expect(screen.getByTestId("table-empty-state-note")).toHaveTextContent(
      CREATE_NOT_ALLOWED_NOTE,
    );
  });

  test("the locked button explains itself on hover", async () => {
    isMasterAdminForTest = false;
    permissionsForTest = [Permission.Viewer];

    renderTable();

    await waitForCta();

    // A disabled button takes no pointer events; its wrapper carries the hover.
    fireEvent.mouseEnter(screen.getByTestId(`${CTA_TEST_ID}-disabled-wrapper`));

    await waitFor(() => {
      expect(screen.getByRole("tooltip")).toHaveTextContent(
        CREATE_DENIED_MESSAGE,
      );
    });
  });

  test("clicking the locked button opens nothing", async () => {
    isMasterAdminForTest = false;
    permissionsForTest = [Permission.Viewer];

    renderTable();

    fireEvent.click(await waitForCta());

    expect(showCreateEditModalCalls).toBe(0);
    expect(screen.queryByTestId("create-edit-modal")).toBeNull();
  });

  test("a viewer who may create gets a live button and no note", async () => {
    isMasterAdminForTest = false;
    permissionsForTest = [Permission.ProjectAdmin];

    renderTable();

    const cta: HTMLElement = await waitForCta();

    expect(cta).not.toBeDisabled();
    expect(screen.queryByTestId("table-empty-state-note")).toBeNull();
  });

  /*
   * Until the permission snapshot arrives the header hides its button rather
   * than accuse a user of lacking a permission they may hold - and the empty
   * state, having nothing to mirror, offers none.
   */
  test("while the permission snapshot has not loaded, there is nothing to mirror", async () => {
    isMasterAdminForTest = false;
    permissionsForTest = [];

    renderTable();

    await expectNoCtaAfterSettling();
    expect(screen.queryByTestId("table-empty-state-note")).toBeNull();
    expect(screen.queryByTestId("refresh-button")).toBeNull();
  });
});

describe("a page's own words", () => {
  /*
   * PR #4162 kept the create button away from every page's own sentence,
   * because some of those describe a slice of the list. But most of them say
   * "Add one to ..." - the button is the answer. The slices now say so
   * themselves (emptyState.isAllClear), and get no button.
   */
  test("a page's own sentence heads the state, and the create button is still offered", async () => {
    renderTable({
      noItemsMessage: "No site types yet. Add one to describe your sites.",
    });

    const cta: HTMLElement = await waitForCta();
    const block: HTMLElement = screen.getByTestId(NO_ITEMS_TEST_ID);

    expect(titleOf(block)).toBe("No site types yet");
    expect(
      within(block).getByTestId("table-empty-state-description"),
    ).toHaveTextContent("Add one to describe your sites.");
    expect(block).toContainElement(cta);
    // The page's own description: the card keeps its.
    expect(screen.getByTestId("card-description")).toHaveTextContent(
      CARD_DESCRIPTION,
    );
  });

  test("a page's own element is the whole empty state, with no create button", async () => {
    renderTable({
      noItemsMessage: <div data-testid="custom-empty">Set up an agent.</div>,
    });

    await expectNoCtaAfterSettling();

    expect(screen.getByTestId("custom-empty")).toBeInTheDocument();
    expect(
      screen
        .getByTestId(NO_ITEMS_TEST_ID)
        .querySelector('[data-testid="table-empty-state"]'),
    ).toBeNull();
    expect(screen.queryByTestId("refresh-button")).toBeNull();
    expect(screen.getByTestId("card-description")).toBeInTheDocument();
  });

  test("emptyState gives the table its own title and description", async () => {
    renderTable({
      emptyState: {
        title: "Nothing measured yet",
        description: "Measurements chart how fast your team responds.",
      },
    });

    const block: HTMLElement = await waitForEmptyTable();

    expect(titleOf(block)).toBe("Nothing measured yet");
    expect(block).toHaveTextContent(
      "Measurements chart how fast your team responds.",
    );
    expect(screen.getByTestId("card-description")).toHaveTextContent(
      CARD_DESCRIPTION,
    );
  });

  test("emptyState.hideCreateButton keeps the button out", async () => {
    renderTable({ emptyState: { hideCreateButton: true } });

    await expectNoCtaAfterSettling();
    expect(titleOf(screen.getByTestId(NO_ITEMS_TEST_ID))).toBe(
      "No monitors yet",
    );
  });
});

describe("all clear: a list where empty is good news", () => {
  test("says the good news, draws it as all clear, and offers no create button", async () => {
    renderTable({
      emptyState: {
        isAllClear: true,
        title: "No active incidents",
        description: "Nice work! Every incident is resolved.",
      },
    });

    await expectNoCtaAfterSettling();

    const block: HTMLElement = screen.getByTestId(NO_ITEMS_TEST_ID);

    expect(kindOf(block)).toBe(TableEmptyStateKind.AllClear);
    expect(titleOf(block)).toBe("No active incidents");
    expect(block).toHaveTextContent("Nice work! Every incident is resolved.");
    // The list's description stays in the header.
    expect(screen.getByTestId("card-description")).toHaveTextContent(
      CARD_DESCRIPTION,
    );
  });
});

describe("nothing matches: a search or filter hid every row", () => {
  test("a filter: says so, with no create button, and the card keeps its description", async () => {
    renderTable({ initialFilterData: { name: "nothing-matches-this" } });

    await expectNoCtaAfterSettling();

    const block: HTMLElement = screen.getByTestId(NO_ITEMS_TEST_ID);

    expect(kindOf(block)).toBe(TableEmptyStateKind.Filtered);
    expect(titleOf(block)).toBe("No monitors match your search or filters");
    expect(screen.getByTestId("card-description")).toHaveTextContent(
      CARD_DESCRIPTION,
    );
  });

  test("Clear Filters clears them, and the table says what is really there", async () => {
    renderTable({ initialFilterData: { name: "nothing-matches-this" } });

    await settle();

    const clear: HTMLElement = screen.getByTestId(CLEAR_TEST_ID);
    expect(clear).toHaveTextContent("Clear Filters");

    const fetchesBefore: number = fetchedQueries.length;

    fireEvent.click(clear);

    await waitFor(() => {
      expect(titleOf(screen.getByTestId(NO_ITEMS_TEST_ID))).toBe(
        "No monitors yet",
      );
    });
    await waitForCta();

    // It fetched again, without the filter.
    expect(fetchedQueries.length).toBeGreaterThan(fetchesBefore);
    expect(
      JSON.stringify(fetchedQueries[fetchedQueries.length - 1]),
    ).not.toContain("nothing-matches-this");
  });

  test("a search: Clear Search empties the box, and the table says what is really there", async () => {
    TableFilterUrlState.write(TABLE_ID, "view", { search: "zzzz" });

    renderTable();

    await settle();

    const block: HTMLElement = screen.getByTestId(NO_ITEMS_TEST_ID);
    expect(kindOf(block)).toBe(TableEmptyStateKind.Filtered);

    const clear: HTMLElement = screen.getByTestId(CLEAR_TEST_ID);
    expect(clear).toHaveTextContent("Clear Search");

    fireEvent.click(clear);

    await waitFor(() => {
      expect(titleOf(screen.getByTestId(NO_ITEMS_TEST_ID))).toBe(
        "No monitors yet",
      );
    });
    expect(
      JSON.stringify(fetchedQueries[fetchedQueries.length - 1]),
    ).not.toContain("zzzz");
  });

  test("a search and a filter: one button clears both", async () => {
    TableFilterUrlState.write(TABLE_ID, "view", { search: "zzzz" });

    renderTable({ initialFilterData: { name: "nothing-matches-this" } });

    await settle();

    const clear: HTMLElement = screen.getByTestId(CLEAR_TEST_ID);
    expect(clear).toHaveTextContent("Clear Search and Filters");

    fireEvent.click(clear);

    await waitFor(() => {
      expect(titleOf(screen.getByTestId(NO_ITEMS_TEST_ID))).toBe(
        "No monitors yet",
      );
    });
  });

  /*
   * The regression: a yes/no filter set to "No" is stored as false, and the
   * table used to call itself unfiltered - "No monitors yet" and a Create
   * button under a list the filter had emptied.
   */
  test('a yes/no filter set to "No" is a filter too', async () => {
    renderTable({ initialFilterData: { disableActiveMonitoring: false } });

    await expectNoCtaAfterSettling();

    expect(kindOf(screen.getByTestId(NO_ITEMS_TEST_ID))).toBe(
      TableEmptyStateKind.Filtered,
    );
  });

  test("wins over a page's own sentence and over all clear", async () => {
    renderTable({
      initialFilterData: { name: "nothing-matches-this" },
      noItemsMessage: "Connect your first monitor.",
      emptyState: { isAllClear: true },
    });

    await expectNoCtaAfterSettling();

    expect(titleOf(screen.getByTestId(NO_ITEMS_TEST_ID))).toBe(
      "No monitors match your search or filters",
    );
    expect(screen.queryByText("Connect your first monitor")).toBeNull();
  });

  test("filters the page applies itself say so too, and clear through the page", async () => {
    let pageClears: number = 0;

    renderTable({
      emptyState: {
        isFiltered: true,
        onClearFilters: () => {
          pageClears++;
        },
      },
    });

    await expectNoCtaAfterSettling();

    expect(kindOf(screen.getByTestId(NO_ITEMS_TEST_ID))).toBe(
      TableEmptyStateKind.Filtered,
    );

    fireEvent.click(screen.getByTestId(CLEAR_TEST_ID));

    expect(pageClears).toBe(1);
  });
});

describe("where the create button stays out", () => {
  test("when the table creates nothing at all", async () => {
    renderTable({ isCreateable: false });

    await expectNoCtaAfterSettling();

    expect(titleOf(screen.getByTestId(NO_ITEMS_TEST_ID))).toBe(
      "No monitors yet",
    );
    expect(screen.queryByTestId("refresh-button")).toBeNull();
  });

  test("in a table without a card, which has no header to mirror", async () => {
    renderTable({ withCard: false });

    await expectNoCtaAfterSettling();

    expect(screen.queryByTestId("card-button")).toBeNull();
    expect(titleOf(screen.getByTestId(NO_ITEMS_TEST_ID))).toBe(
      "No monitors yet",
    );
  });
});

describe("a viewer who may read none of the columns", () => {
  test("is told so, and which permissions would let them in", async () => {
    isMasterAdminForTest = false;
    permissionsForTest = [Permission.Viewer];
    columnReadPermissions = [];

    renderTable();

    await waitFor(() => {
      expect(screen.getByTestId(`${TABLE_ID}-no-access`)).toBeInTheDocument();
    });

    const block: HTMLElement = screen.getByTestId(`${TABLE_ID}-no-access`);

    expect(kindOf(block)).toBe(TableEmptyStateKind.NoAccess);
    expect(titleOf(block)).toBe("You don't have access to this list");
    expect(block).toHaveTextContent(
      "Ask a project admin for one of these permissions:",
    );
    expect(screen.queryByTestId(NO_ITEMS_TEST_ID)).toBeNull();
  });
});
