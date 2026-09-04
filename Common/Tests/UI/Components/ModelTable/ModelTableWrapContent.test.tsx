import "@testing-library/jest-dom";
import {
  cleanup,
  configure,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React, { ReactElement } from "react";

/*
 * A real BaseModelTable mounts a card, a header and a full table before the
 * first row exists. That comfortably outruns the 1s default when the whole
 * Common suite is competing for the same box. A regression still fails, just
 * later.
 */
configure({ asyncUtilTimeout: 15000 });

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ============================================================================
 * WHY THIS FILE EXISTS - OneUptime issue #3585
 * ============================================================================
 *
 * Every desktop body <td> is `whitespace-nowrap`, and `white-space` is an
 * INHERITED CSS property, so that nowrap reaches whatever element a column's
 * `getElement` returns. On the Discovery Scans page the "Responded Hosts"
 * cell renders a 156-character server-authored sentence (RETIRE_RUN_PAYLOAD
 * in Common/Server/Services/NetworkDeviceDiscoveryScanService.ts) inside a
 * `max-w-md` div: a capped box holding one unbreakable line, so the sentence
 * painted straight over the Recurrence and Started cells beside it.
 *
 * The fix gives a column two declarative options - `wrapContent` and
 * `wrapMaxWidthClassName` - which Common/UI/Components/Table/CellClassName.ts
 * turns into `whitespace-normal break-words` on the <td> and the width cap on
 * the <td>'s content <div> (max-width is ignored on a table-cell box, so the
 * cap has to live on the child).
 *
 * The reason the tests live at the ModelTable level rather than against
 * TableRow directly: Common/UI/Components/ModelTable/BaseModelTable.tsx has
 * exactly ONE ModelTable-column to Table-column conversion, the
 * `columns.push({ ...column, ... })` inside `serializeToTableColumns`. Both
 * new fields travel on that SPREAD. Nothing names them, nothing type-checks
 * the hop, and TypeScript is perfectly happy if a future refactor replaces
 * the spread with an explicit list of copied fields - which would silently
 * reintroduce #3585, with a green TableRow unit test and nothing else to show
 * for it. These tests drive a real BaseModelTable end to end so that hop is
 * covered, and they are the only thing that would catch it.
 *
 * NOTE ON WHAT CAN BE ASSERTED: jsdom performs no layout. There is no
 * getBoundingClientRect worth reading, no computed line breaking, no overflow
 * and no column widths. Where a reader would reasonably expect "assert the
 * text does not overlap the next column", these tests assert instead the
 * exact classes and DOM structure that a browser turns into that behaviour -
 * the class strings ARE the contract here.
 * ============================================================================
 */

/*
 * BaseModelTable pulls in permissions, the current project and the i18n
 * provider. None of those are what these tests are about, so they are stubbed
 * to their permissive / no-op form and the tests focus on one thing: the
 * wrapping options surviving the trip from a ModelTable column into the
 * rendered <td>.
 */
jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: () => {
        return [];
      },
      getProjectPermissions: () => {
        return [];
      },
      getGlobalPermissions: () => {
        return [];
      },
    },
  };
});

jest.mock("../../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: () => {
        return true;
      },
      getUserId: () => {
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
        translateString: (value: string | undefined) => {
          return value;
        },
        translateValue: (value: unknown) => {
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
import Columns from "../../../../UI/Components/ModelTable/Columns";
import Filter from "../../../../UI/Components/ModelFilter/Filter";
import FieldType from "../../../../UI/Components/Types/FieldType";
import ActionButtonSchema from "../../../../UI/Components/ActionButton/ActionButtonSchema";
import { ButtonStyleType } from "../../../../UI/Components/Button/Button";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import Query from "../../../../Types/BaseDatabase/Query";
import ListResult from "../../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../../Types/JSON";

const PREFS_KEY: string = "monitors-wrap-content-table";

/*
 * The exact <td> class string every non-wrapping body cell had BEFORE the fix,
 * character for character, and still has after it. Spelled out as a literal
 * rather than imported from CellClassName.ts on purpose: importing the helper
 * would only prove the helper agrees with itself, while this literal is the
 * frozen "no column asked for anything, so nothing changed" contract that
 * roughly two hundred column declarations with no layout coverage of their
 * own are relying on.
 */
const NOWRAP_CELL_CLASS_NAME: string =
  "whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-500 sm:pl-6 align-top";

// Same, for the last rendered column, which takes the wider right padding.
const NOWRAP_LAST_CELL_CLASS_NAME: string =
  "whitespace-nowrap py-4 pl-4 pr-6 text-sm font-medium text-gray-500 sm:pl-6 align-top";

/*
 * The default cap a wrapping column gets when it names no width of its own.
 * Hard-coded rather than imported for the same reason as above: this is the
 * shipped value ("Responded Hosts" on the Discovery page relies on it), so
 * changing it should have to be a deliberate edit here too.
 */
const DEFAULT_WRAP_WIDTH_CLASS_NAME: string = "max-w-md";

const FILTERS: Array<Filter<Monitor>> = [
  { title: "Name", type: FieldType.Text, field: { name: true } },
] as unknown as Array<Filter<Monitor>>;

/*
 * One row is all these tests need - they are about the cell shell, not about
 * the values in it. Every column below declares a real Monitor field, because
 * TableRow only calls `getElement` for a column that resolved to a `key`, and
 * the key is derived from the declared field.
 */
const ROWS: Array<JSONObject> = [
  {
    _id: "monitor-1",
    name: "api-gateway",
    description:
      "Settings changed, so this scan is queued to run again. The previous run was retired.",
    monitorType: "Website",
    slug: "api-gateway",
  },
];

type MakeColumnsFunction = () => Columns<Monitor>;

/*
 * Four columns covering the whole option matrix, plus the generated Actions
 * column that BaseModelTable appends. They are deliberately in ONE table: the
 * bug report is a row where one cell wraps and its neighbours must not, so
 * "per column, not per table" is part of the contract being pinned.
 */
const makeColumns: MakeColumnsFunction = (): Columns<Monitor> => {
  const columns: Array<unknown> = [
    /*
     * The control. Declares neither option, exactly like almost every column
     * in the product, and must come out byte-identical to how it rendered
     * before the fix existed.
     */
    {
      field: { name: true },
      title: "Name",
      type: FieldType.Element,
      getElement: (): ReactElement => {
        return <span data-testid="cell-name">api-gateway</span>;
      },
    },
    /*
     * The #3585 shape: a cell holding a server-authored sentence, opting into
     * wrapping without naming a width. This is the "Responded Hosts" column
     * on App/FeatureSet/Dashboard/src/Pages/NetworkDevice/Discovery.tsx.
     */
    {
      field: { description: true },
      title: "Status Message",
      type: FieldType.Element,
      wrapContent: true,
      getElement: (): ReactElement => {
        return (
          <span data-testid="cell-status-message">
            Settings changed, so this scan is queued to run again.
          </span>
        );
      },
    },
    /*
     * A wrapping column that names its own, wider cap. This is the shape
     * ExceptionsTable.tsx's "Exception Message" column was migrated to.
     */
    {
      field: { monitorType: true },
      title: "Exception Message",
      type: FieldType.Element,
      wrapContent: true,
      wrapMaxWidthClassName: "max-w-3xl",
      getElement: (): ReactElement => {
        return <span data-testid="cell-exception-message">TypeError</span>;
      },
    },
    /*
     * The pre-existing contract: a column that only styles its content and
     * never asked to wrap. It has to pass through untouched, and must NOT
     * acquire a width cap.
     */
    {
      field: { slug: true },
      title: "Note",
      type: FieldType.Element,
      contentClassName: "text-xs text-gray-500",
      getElement: (): ReactElement => {
        return <span data-testid="cell-note">a note</span>;
      },
    },
  ];

  return columns as unknown as Columns<Monitor>;
};

/*
 * One row action, which is the cheapest way to make BaseModelTable decide it
 * needs the generated Actions column at all (see `showActionsColumn` in
 * serializeToTableColumns).
 */
const ACTION_BUTTONS: Array<ActionButtonSchema<Monitor>> = [
  {
    title: "Edit",
    buttonStyleType: ButtonStyleType.NORMAL,
    onClick: (): void => {
      return undefined;
    },
  },
] as unknown as Array<ActionButtonSchema<Monitor>>;

describe("ModelTable column wrapping options (OneUptime issue #3585)", () => {
  type MakeCallbacksFunction = (
    rows: Array<JSONObject>,
  ) => BaseTableCallbacks<Monitor>;

  /*
   * Server-free: `getList` is a plain function returning a page of rows, and
   * the model/JSON conversions are the identity, so the JSONObject rows above
   * reach `getElement` untouched.
   */
  const makeCallbacks: MakeCallbacksFunction = (
    rows: Array<JSONObject>,
  ): BaseTableCallbacks<Monitor> => {
    return {
      deleteItem: async () => {
        return undefined;
      },
      getModelFromJSON: (item: JSONObject) => {
        return item as unknown as Monitor;
      },
      getJSONFromModel: (item: Monitor) => {
        return item as unknown as JSONObject;
      },
      addSlugToSelect: (select: unknown) => {
        return select;
      },
      getList: async (data: {
        query: Query<Monitor>;
        limit: number;
        select: JSONObject;
        sort: JSONObject;
      }): Promise<ListResult<Monitor>> => {
        return {
          data: rows as unknown as Array<Monitor>,
          count: rows.length,
          skip: 0,
          limit: data.limit,
        };
      },
      toJSONArray: () => {
        return [];
      },
      updateById: async () => {
        return undefined;
      },
      showCreateEditModal: () => {
        return <></>;
      },
    } as unknown as BaseTableCallbacks<Monitor>;
  };

  type RenderTableFunction = () => ReturnType<typeof render>;

  const renderTable: RenderTableFunction = (): ReturnType<typeof render> => {
    const props: BaseModelTableProps<Monitor> = {
      modelType: Monitor,
      id: "monitors-table",
      name: "Monitors",
      userPreferencesKey: PREFS_KEY,
      cardProps: { title: "Monitors" },
      columns: makeColumns(),
      filters: FILTERS,
      isDeleteable: false,
      isCreateable: false,
      isViewable: false,
      isEditable: false,
      actionButtons: ACTION_BUTTONS,
      // This suite is about cell classes; keep the URL out of it entirely.
      disableUrlState: true,
      callbacks: makeCallbacks(ROWS),
    } as unknown as BaseModelTableProps<Monitor>;

    return render(<BaseModelTable<Monitor> {...props} />);
  };

  type WaitForRowFunction = () => Promise<void>;

  const waitForRow: WaitForRowFunction = async (): Promise<void> => {
    await waitFor(() => {
      expect(screen.queryByTestId("cell-name")).not.toBeNull();
    });
  };

  type GetContentWrapperFunction = (testId: string) => HTMLElement;

  /*
   * TableRow renders a cell as <td><div className={content}>{element}</div>,
   * so the wrapper is the marker span's direct parent. Reached that way
   * rather than by index so a column reorder cannot quietly retarget an
   * assertion.
   */
  const getContentWrapper: GetContentWrapperFunction = (
    testId: string,
  ): HTMLElement => {
    return screen.getByTestId(testId).parentElement as HTMLElement;
  };

  type GetCellFunction = (testId: string) => HTMLElement;

  const getCell: GetCellFunction = (testId: string): HTMLElement => {
    return screen.getByTestId(testId).closest("td") as HTMLElement;
  };

  beforeEach(() => {
    /*
     * BaseModelTable reads any stored column layout out of localStorage on
     * mount, and the runner shares one jsdom across files.
     */
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  describe("a column that opts into wrapping", () => {
    /*
     * The heart of #3585. `whitespace-nowrap` on the <td> is what the
     * sentence inherited; `whitespace-normal break-words` is what replaces
     * it. jsdom cannot break a line, so the class list is the assertion.
     */
    test("renders a <td> that declares whitespace-normal and break-words, never whitespace-nowrap", async () => {
      renderTable();

      await waitForRow();

      const cell: HTMLElement = getCell("cell-status-message");

      expect(cell).toHaveClass("whitespace-normal");
      expect(cell).toHaveClass("break-words");
      expect(cell).not.toHaveClass("whitespace-nowrap");

      /*
       * Pinned as a whole string, not just as three classes: the padding,
       * text and alignment utilities are what keep a wrapping cell in the
       * same visual rhythm as its neighbours, and a rewrite that produced the
       * right whitespace classes while dropping those would look fine here
       * and wrong on screen.
       */
      expect(cell.className).toBe(
        "whitespace-normal break-words py-4 pl-4 pr-3 text-sm font-medium text-gray-500 sm:pl-6 align-top",
      );
    });

    /*
     * The width cap belongs on the content <div>, never on the <td>:
     * `max-width` on a `display: table-cell` box is ignored outright, so a
     * cap that drifted onto the <td> would do nothing at all - and the
     * original bug was precisely a capped box around an unbreakable line.
     */
    test("caps the content wrapper, not the <td>, when no width is named", async () => {
      renderTable();

      await waitForRow();

      expect(getContentWrapper("cell-status-message").className).toBe(
        DEFAULT_WRAP_WIDTH_CLASS_NAME,
      );

      expect(getCell("cell-status-message").className).not.toMatch(/max-w-/);
    });

    /*
     * `wrapMaxWidthClassName` is the second of the two fields riding the
     * BaseModelTable spread, and the one ExceptionsTable.tsx depends on: its
     * "Exception Message" column was migrated from a hand-spelled
     * "max-w-3xl whitespace-normal break-words" contentClassName onto these
     * options, so if this field stops making the hop that table silently
     * loses its width cap.
     */
    test("uses wrapMaxWidthClassName on the wrapper when the column names one", async () => {
      renderTable();

      await waitForRow();

      const wrapper: HTMLElement = getContentWrapper("cell-exception-message");

      expect(wrapper.className).toBe("max-w-3xl");
      // The named width replaces the default rather than stacking with it.
      expect(wrapper).not.toHaveClass(DEFAULT_WRAP_WIDTH_CLASS_NAME);

      // ...and the cell it sits in is still a wrapping cell.
      expect(getCell("cell-exception-message")).toHaveClass(
        "whitespace-normal",
        "break-words",
      );
    });
  });

  describe("columns that opt into nothing", () => {
    /*
     * The regression that would hurt most: wrapping leaking from one column
     * onto the rest of the row. "12 Mar 2026, 4:05 pm" folding onto two lines
     * across every table in the product is a far bigger blast radius than the
     * bug being fixed, so a sibling in the SAME rendered row is asserted to
     * still be nowrap.
     */
    test("a sibling column in the same row still renders a nowrap <td>", async () => {
      renderTable();

      await waitForRow();

      const wrappingCell: HTMLElement = getCell("cell-status-message");
      const plainCell: HTMLElement = getCell("cell-name");

      // Same row - so this really is per column, not per table.
      expect(plainCell.parentElement).toBe(wrappingCell.parentElement);

      expect(plainCell.className).toBe(NOWRAP_CELL_CLASS_NAME);
    });

    /*
     * A column that declares neither option must produce the DOM it produced
     * before the options existed - down to an empty wrapper className, so
     * that not one class shifts for the columns nobody touched.
     */
    test("a column that declares neither option gets an empty content wrapper", async () => {
      renderTable();

      await waitForRow();

      expect(getContentWrapper("cell-name").className).toBe("");
    });

    /*
     * `contentClassName` predates this work and is a different thing: styling
     * for the content, with no opinion on wrapping. It has to pass through
     * untouched, and - the important half - must NOT acquire a width cap,
     * because a max-width on a still-nowrap cell is exactly the overlap
     * generator #3585 was.
     */
    test("a contentClassName-only column keeps its exact string, with no width injected", async () => {
      renderTable();

      await waitForRow();

      expect(getContentWrapper("cell-note").className).toBe(
        "text-xs text-gray-500",
      );
      expect(getContentWrapper("cell-note").className).not.toMatch(/max-w-/);

      // And the cell itself is untouched: no opt-in, no wrapping.
      expect(getCell("cell-note").className).toBe(NOWRAP_CELL_CLASS_NAME);
    });
  });

  describe("the generated Actions column", () => {
    /*
     * BaseModelTable appends the Actions column itself (the second
     * `columns.push` in serializeToTableColumns) with a title and a type and
     * nothing else. It is the one column no caller can annotate, so it is the
     * one most likely to be broken by a change to the shared cell helper: a
     * width cap here would squeeze the row's buttons, and wrapping here would
     * stack them.
     */
    test("renders a nowrap last cell and an uncapped 'flex justify-end' container", async () => {
      const { container } = renderTable();

      await waitForRow();

      const actionsContainer: HTMLElement = container.querySelector(
        "tbody div.justify-end",
      ) as HTMLElement;

      expect(actionsContainer).not.toBeNull();
      /*
       * Exactly this string: the actions container is built by appending the
       * cell's content classes to "flex justify-end", so anything the helper
       * wrongly handed a no-option column would show up here as extra
       * classes.
       */
      expect(actionsContainer.className).toBe("flex justify-end");

      const actionsCell: HTMLElement = actionsContainer.closest(
        "td",
      ) as HTMLElement;

      // Appended last, and so it takes the last column's wider right padding.
      const cells: Array<Element> = Array.from(
        (actionsCell.parentElement as HTMLElement).querySelectorAll("td"),
      );

      expect(cells[cells.length - 1]).toBe(actionsCell);
      expect(actionsCell.className).toBe(NOWRAP_LAST_CELL_CLASS_NAME);

      // Nothing inside the actions cell is width-capped either.
      expect(actionsCell.querySelector('[class*="max-w-"]')).toBeNull();
    });
  });
});
