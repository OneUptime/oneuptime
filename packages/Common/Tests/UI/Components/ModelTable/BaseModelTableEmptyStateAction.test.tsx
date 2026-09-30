import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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
 * The way forward from an empty table.
 *
 * An empty list used to say "No monitors found." with an underlined
 * "Refresh?" under it. On a project that simply has none yet that reads like
 * a failed load, and the only way on was a button in the card's header.
 * Under the table's own "No X yet." the header's create button - same
 * handler, same permission gate, same label - now appears again as the
 * primary action, where a new user is looking.
 *
 * Just as important is where it does NOT appear:
 *
 *  - under a page's own wording of its empty state, which describes a slice
 *    of the list ("Nice work! No Active Incidents so far.");
 *  - when a search or filter emptied the table - creating one is the wrong
 *    answer to a search that missed;
 *  - when nothing in the header creates anything (an import, a "Run" button);
 *  - in a table with no card, which has no header to mirror.
 */

let isMasterAdminForTest: boolean = true;

/*
 * Two different reads of the viewer's permissions, kept apart on purpose.
 * The create gate (PermissionGate.check) reads getAllPermissions; which
 * COLUMNS a viewer may read comes from getProjectPermissions. Holding the
 * second fixed at "can read monitors" keeps the table itself on screen, so
 * every test below is about the create gate alone - with no readable column
 * the table is replaced by "You are not authorized to view this table" and
 * there would be no empty state to look at.
 */
let permissionsForTest: Array<unknown> = [];
const COLUMN_READ_PERMISSIONS: Array<unknown> = ["ProjectOwner"];

jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): { permissions: Array<unknown> } => {
        return {
          permissions: COLUMN_READ_PERMISSIONS.map((permission: unknown) => {
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
} from "../../../../UI/Components/ModelTable/BaseModelTable";
import TableFilterUrlState from "../../../../UI/Utils/TableFilterUrlState";
import PermissionGate from "../../../../UI/Utils/PermissionGate";
import FieldType from "../../../../UI/Components/Types/FieldType";
import { ButtonStyleType } from "../../../../UI/Components/Button/Button";
import { CardButtonSchema } from "../../../../UI/Components/Card/Card";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import IconProp from "../../../../Types/Icon/IconProp";
import Permission from "../../../../Types/Permission";
import ListResult from "../../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../../Types/JSON";

const CTA_TEST_ID: string = "empty-table-create-button";
const TABLE_ID: string = "monitors-cta-table";
const NO_ITEMS_TEST_ID: string = `${TABLE_ID}-no-items`;

// Restated, not imported: the sentence is what a locked button tells a user.
const CREATE_DENIED_MESSAGE: string =
  "You do not have permission to create this Monitor.";

const ROWS: Array<JSONObject> = [
  { _id: "monitor-1", name: "Checkout API", description: "Payments" },
];

interface TableOptions {
  rows?: Array<JSONObject> | undefined;
  isCreateable?: boolean | undefined;
  withCard?: boolean | undefined;
  cardButtons?: Array<CardButtonSchema> | undefined;
  noItemsMessage?: string | React.ReactElement | undefined;
  initialFilterData?: JSONObject | undefined;
  createVerb?: string | undefined;
  singularName?: string | undefined;
  onCreateClick?: (() => void) | undefined;
}

let showCreateEditModalCalls: number = 0;

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
    }): Promise<ListResult<Monitor>> => {
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
            description: "All monitors",
            ...(options.cardButtons ? { buttons: options.cardButtons } : {}),
          },
        }),
    isCreateable: options.isCreateable ?? true,
    isEditable: false,
    isDeleteable: false,
    isViewable: false,
    noItemsMessage: options.noItemsMessage,
    initialFilterData: options.initialFilterData,
    createVerb: options.createVerb,
    onCreateClick: options.onCreateClick,
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

type ExpectNoCtaFunction = () => Promise<void>;

/*
 * "Not there" has to be checked after everything that could put it there
 * has had its chance: the header's effect has run once the header's own
 * button (or the absence of one) has settled.
 */
const expectNoCtaAfterSettling: ExpectNoCtaFunction =
  async (): Promise<void> => {
    await waitForEmptyTable();
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 50);
    });

    expect(screen.queryByTestId(CTA_TEST_ID)).toBeNull();
  };

beforeEach(() => {
  isMasterAdminForTest = true;
  permissionsForTest = [];
  showCreateEditModalCalls = 0;
  PermissionGate.clearPermissionPropsCache();
  window.history.replaceState(window.history.state, "", "/dashboard/monitors");
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("an empty table with a create action", () => {
  test("offers the create button under its own 'No X yet.'", async () => {
    renderTable();

    const cta: HTMLElement = await waitForCta();
    const block: HTMLElement = screen.getByTestId(NO_ITEMS_TEST_ID);

    expect(block).toHaveTextContent("No monitors yet.");
    expect(block).toContainElement(cta);
    expect(cta).toHaveTextContent("Create Monitor");
  });

  test("offers it instead of the Refresh link", async () => {
    renderTable();

    await waitForCta();

    expect(screen.queryByTestId("refresh-button")).toBeNull();
  });

  test("carries the header button's own label", async () => {
    renderTable();

    const cta: HTMLElement = await waitForCta();
    const header: HTMLElement = screen.getByTestId("card-button");

    expect(header).toHaveTextContent("Create Monitor");
    expect(cta.textContent?.trim()).toBe(header.textContent?.trim());
  });

  test("follows a table's own create verb", async () => {
    renderTable({ createVerb: "Declare", singularName: "Incident" });

    const cta: HTMLElement = await waitForCta();

    expect(cta).toHaveTextContent("Declare Incident");
  });

  /*
   * The header button is a NORMAL button; the one in the empty state is the
   * PRIMARY one, because in an empty list it is the next thing to do.
   */
  test("is the primary button, the header's stays as it was", async () => {
    renderTable();

    const cta: HTMLElement = await waitForCta();

    expect(cta.className).toContain("bg-indigo-600");
    expect(screen.getByTestId("card-button").className).not.toContain(
      "bg-indigo-600",
    );
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
    expect(screen.getByTestId("refresh-button")).toBeInTheDocument();
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
    expect(screen.getByTestId("refresh-button")).toBeInTheDocument();
  });

  test("with a gated card button disabled, the empty state's copy is disabled too", async () => {
    let clicks: number = 0;

    renderTable({
      isCreateable: false,
      cardButtons: [
        {
          title: "Create Monitor",
          buttonStyle: ButtonStyleType.NORMAL,
          icon: IconProp.Add,
          disabled: true,
          tooltip: CREATE_DENIED_MESSAGE,
          onClick: () => {
            clicks++;
          },
        },
      ],
    });

    const cta: HTMLElement = await waitForCta();

    expect(cta).toBeDisabled();

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

  test("a viewer who may create gets a live button", async () => {
    isMasterAdminForTest = false;
    permissionsForTest = [Permission.ProjectAdmin];

    renderTable();

    const cta: HTMLElement = await waitForCta();

    expect(cta).not.toBeDisabled();
  });

  /*
   * Until the permission snapshot arrives the header hides its button rather
   * than accuse a user of lacking a permission they may hold - and the empty
   * state, having nothing to mirror, keeps its Refresh link.
   */
  test("while the permission snapshot has not loaded, there is nothing to mirror", async () => {
    isMasterAdminForTest = false;
    permissionsForTest = [];

    renderTable();

    await expectNoCtaAfterSettling();
    expect(screen.getByTestId("refresh-button")).toBeInTheDocument();
  });
});

describe("where the create button stays out", () => {
  test("under a page's own sentence, which keeps its Refresh link", async () => {
    renderTable({ noItemsMessage: "Nice work! No Active Incidents so far." });

    await expectNoCtaAfterSettling();

    expect(screen.getByTestId(NO_ITEMS_TEST_ID)).toHaveTextContent(
      "Nice work! No Active Incidents so far.",
    );
    expect(screen.getByTestId("refresh-button")).toBeInTheDocument();
  });

  test("under a page's own empty-state element", async () => {
    renderTable({
      noItemsMessage: <div data-testid="custom-empty">Set up an agent.</div>,
    });

    await expectNoCtaAfterSettling();

    expect(screen.getByTestId("custom-empty")).toBeInTheDocument();
  });

  test("when a filter emptied the table", async () => {
    renderTable({ initialFilterData: { name: "nothing-matches-this" } });

    await expectNoCtaAfterSettling();

    expect(screen.getByTestId(NO_ITEMS_TEST_ID)).toHaveTextContent(
      "No monitors match your search or filters.",
    );
  });

  test("when a search emptied the table", async () => {
    TableFilterUrlState.write(TABLE_ID, "view", { search: "zzzz" });

    renderTable();

    await expectNoCtaAfterSettling();

    expect(screen.getByTestId(NO_ITEMS_TEST_ID)).toHaveTextContent(
      "No monitors match your search or filters.",
    );
  });

  test("when the table creates nothing at all", async () => {
    renderTable({ isCreateable: false });

    await expectNoCtaAfterSettling();

    expect(screen.getByTestId(NO_ITEMS_TEST_ID)).toHaveTextContent(
      "No monitors yet.",
    );
    expect(screen.getByTestId("refresh-button")).toBeInTheDocument();
  });

  test("in a table without a card, which has no header to mirror", async () => {
    renderTable({ withCard: false });

    await expectNoCtaAfterSettling();

    expect(screen.queryByTestId("card-button")).toBeNull();
    expect(screen.getByTestId("refresh-button")).toBeInTheDocument();
  });
});
