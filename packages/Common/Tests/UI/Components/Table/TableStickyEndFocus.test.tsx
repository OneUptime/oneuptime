import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";
import Table from "../../../../UI/Components/Table/Table";
import Columns from "../../../../UI/Components/Table/Types/Columns";
import FieldType from "../../../../UI/Components/Types/FieldType";
import {
  HorizontalBox,
  TABLE_STICKY_END_ATTRIBUTE,
  TABLE_STICKY_END_FOCUS_GAP_IN_PX,
  getStickyEndCellOf,
  getStickyEndScrollDelta,
  revealFromStickyEnd,
} from "../../../../UI/Components/Table/TableStickyEndFocus";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import IconProp from "../../../../Types/Icon/IconProp";
import { ButtonStyleType } from "../../../../UI/Components/Button/Button";

/*
 * A FOCUSED CELL IS NEVER UNDER THE STICKY ACTIONS COLUMN.
 *
 * A table wider than its card scrolls sideways with its Actions column
 * stuck at the card's end edge. The browser counts the room under that
 * column as in sight, so a pill, a link or a switch the keyboard moved to
 * there was left behind the column - its focus ring and words hidden
 * (#5282: a reminder rule's "Never reminds" under View and ⋯). The table
 * now scrolls the rows on until what took the focus is clear of the
 * column (TableStickyEndFocus); right to left the column is at the left.
 *
 * jsdom lays nothing out, so the boxes are handed to the elements here;
 * Chromium's half is the ModelTables offline suite ("a focused cell is
 * never under the stuck Actions column").
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("dir");
});

const GAP: number = TABLE_STICKY_END_FOCUS_GAP_IN_PX;

// The scroll box 0..600, its stuck column 480..600 (left to right).
const BOX: HorizontalBox = { left: 0, right: 600 };
const STUCK_RIGHT: HorizontalBox = { left: 480, right: 600 };
// Right to left the column is stuck at the left: 0..120.
const STUCK_LEFT: HorizontalBox = { left: 0, right: 120 };

describe("how far the rows scroll for what took the focus (getStickyEndScrollDelta)", () => {
  test("the gap left between it and the column is 12px", () => {
    expect(GAP).toBe(12);
  });

  test("clear of the column already: no scroll", () => {
    expect(
      getStickyEndScrollDelta({
        target: { left: 300, right: 400 },
        stickyEnd: STUCK_RIGHT,
        box: BOX,
        isRightToLeft: false,
      }),
    ).toBe(0);
  });

  test("ending exactly where the column starts is clear too", () => {
    expect(
      getStickyEndScrollDelta({
        target: { left: 380, right: 480 },
        stickyEnd: STUCK_RIGHT,
        box: BOX,
        isRightToLeft: false,
      }),
    ).toBe(0);
  });

  test("partly under the column: on by the overlap and the gap", () => {
    expect(
      getStickyEndScrollDelta({
        target: { left: 450, right: 520 },
        stickyEnd: STUCK_RIGHT,
        box: BOX,
        isRightToLeft: false,
      }),
    ).toBe(520 - 480 + GAP);
  });

  test("wholly under the column: on until it ends the gap short of it", () => {
    const delta: number = getStickyEndScrollDelta({
      target: { left: 500, right: 580 },
      stickyEnd: STUCK_RIGHT,
      box: BOX,
      isRightToLeft: false,
    });

    expect(delta).toBe(580 - 480 + GAP);
    // Where it lands once the rows have moved by that much.
    expect(580 - delta).toBe(480 - GAP);
  });

  test("a fraction of a pixel under is rounded up, never left a pixel under", () => {
    expect(
      getStickyEndScrollDelta({
        target: { left: 400.2, right: 480.4 },
        stickyEnd: STUCK_RIGHT,
        box: BOX,
        isRightToLeft: false,
      }),
    ).toBe(Math.ceil(0.4 + GAP));
  });

  test("wider than the room beside the column: its start at the box's start edge", () => {
    expect(
      getStickyEndScrollDelta({
        target: { left: 200, right: 760 },
        stickyEnd: STUCK_RIGHT,
        box: BOX,
        isRightToLeft: false,
      }),
    ).toBe(200);
  });

  test("wider than the room with its start cut off: back until its start is in sight", () => {
    expect(
      getStickyEndScrollDelta({
        target: { left: -10, right: 700 },
        stickyEnd: STUCK_RIGHT,
        box: BOX,
        isRightToLeft: false,
      }),
    ).toBe(-10);
  });

  test("a box that is not at the page's left: measured from the box", () => {
    expect(
      getStickyEndScrollDelta({
        target: { left: 1101, right: 1218 },
        stickyEnd: { left: 1115, right: 1247 },
        box: { left: 33, right: 1247 },
        isRightToLeft: false,
      }),
    ).toBe(1218 - 1115 + GAP);
  });

  describe("right to left (the column stuck at the left edge)", () => {
    test("clear of it: no scroll", () => {
      expect(
        getStickyEndScrollDelta({
          target: { left: 200, right: 300 },
          stickyEnd: STUCK_LEFT,
          box: BOX,
          isRightToLeft: true,
        }),
      ).toBe(0);
    });

    test("under it: back by the overlap and the gap (the rows move right)", () => {
      const delta: number = getStickyEndScrollDelta({
        target: { left: 80, right: 180 },
        stickyEnd: STUCK_LEFT,
        box: BOX,
        isRightToLeft: true,
      });

      expect(delta).toBe(-(120 - 80 + GAP));
      expect(80 - delta).toBe(120 + GAP);
    });

    test("wider than the room: its start - its right end - at the box's right edge", () => {
      expect(
        getStickyEndScrollDelta({
          target: { left: -200, right: 700 },
          stickyEnd: STUCK_LEFT,
          box: BOX,
          isRightToLeft: true,
        }),
      ).toBe(100);
    });
  });
});

type RectFunction = () => DOMRect;

function rectOf(box: HorizontalBox): RectFunction {
  return (): DOMRect => {
    return {
      left: box.left,
      right: box.right,
      width: box.right - box.left,
      top: 0,
      bottom: 40,
      height: 40,
      x: box.left,
      y: 0,
      toJSON: (): unknown => {
        return {};
      },
    } as DOMRect;
  };
}

/*
 * A table drawn by hand: a box, a header row and a body row, each with a
 * stuck Actions cell, a pill in the body row and a sort button in the
 * header's first cell.
 */
function drawTable(): {
  box: HTMLDivElement;
  pill: HTMLButtonElement;
  view: HTMLButtonElement;
  sort: HTMLButtonElement;
  stickyBody: HTMLTableCellElement;
} {
  document.body.innerHTML = `
    <div id="box">
      <table>
        <thead><tr>
          <th><button id="sort">Name</button></th>
          <th ${TABLE_STICKY_END_ATTRIBUTE}="true" id="sticky-head">Actions</th>
        </tr></thead>
        <tbody><tr>
          <td>Checkout</td>
          <td><button id="pill">Never reminds</button></td>
          <td ${TABLE_STICKY_END_ATTRIBUTE}="true" id="sticky-body"><button id="view">View</button></td>
        </tr></tbody>
      </table>
    </div>`;

  return {
    box: document.getElementById("box") as HTMLDivElement,
    pill: document.getElementById("pill") as HTMLButtonElement,
    view: document.getElementById("view") as HTMLButtonElement,
    sort: document.getElementById("sort") as HTMLButtonElement,
    stickyBody: document.getElementById("sticky-body") as HTMLTableCellElement,
  };
}

describe("the stuck cell of what took the focus (getStickyEndCellOf)", () => {
  test("a body cell's: its own row's stuck cell", () => {
    const drawn: ReturnType<typeof drawTable> = drawTable();

    expect(getStickyEndCellOf(drawn.pill)).toBe(drawn.stickyBody);
  });

  test("a header's sort button: the header row's stuck cell", () => {
    const drawn: ReturnType<typeof drawTable> = drawTable();

    expect(getStickyEndCellOf(drawn.sort)).toBe(
      document.getElementById("sticky-head"),
    );
  });

  test("the column's own View and ⋯: none, they are always in sight", () => {
    const drawn: ReturnType<typeof drawTable> = drawTable();

    expect(getStickyEndCellOf(drawn.view)).toBeNull();
    expect(getStickyEndCellOf(drawn.stickyBody)).toBeNull();
  });

  test("a row with no stuck cell, or something outside a row: none", () => {
    document.body.innerHTML = `<table><tr><td><a id="link" href="#">x</a></td></tr></table><button id="loose">x</button>`;

    expect(
      getStickyEndCellOf(document.getElementById("link") as HTMLElement),
    ).toBeNull();
    expect(
      getStickyEndCellOf(document.getElementById("loose") as HTMLElement),
    ).toBeNull();
  });
});

describe("scrolling what took the focus out from under the column (revealFromStickyEnd)", () => {
  test("a pill under the column: the rows scroll on until it ends 12px short of it", () => {
    const drawn: ReturnType<typeof drawTable> = drawTable();

    drawn.box.getBoundingClientRect = rectOf(BOX);
    drawn.stickyBody.getBoundingClientRect = rectOf(STUCK_RIGHT);
    drawn.pill.getBoundingClientRect = rectOf({ left: 500, right: 580 });
    drawn.box.scrollLeft = 40;

    expect(revealFromStickyEnd({ box: drawn.box, target: drawn.pill })).toBe(
      580 - 480 + GAP,
    );
    expect(drawn.box.scrollLeft).toBe(40 + 580 - 480 + GAP);
  });

  test("a pill in sight: the rows stay where they are", () => {
    const drawn: ReturnType<typeof drawTable> = drawTable();

    drawn.box.getBoundingClientRect = rectOf(BOX);
    drawn.stickyBody.getBoundingClientRect = rectOf(STUCK_RIGHT);
    drawn.pill.getBoundingClientRect = rectOf({ left: 200, right: 280 });
    drawn.box.scrollLeft = 40;

    expect(revealFromStickyEnd({ box: drawn.box, target: drawn.pill })).toBe(0);
    expect(drawn.box.scrollLeft).toBe(40);
  });

  test("the column's own buttons never move the rows", () => {
    const drawn: ReturnType<typeof drawTable> = drawTable();

    drawn.box.getBoundingClientRect = rectOf(BOX);
    drawn.stickyBody.getBoundingClientRect = rectOf(STUCK_RIGHT);
    drawn.view.getBoundingClientRect = rectOf({ left: 500, right: 560 });
    drawn.box.scrollLeft = 40;

    expect(revealFromStickyEnd({ box: drawn.box, target: drawn.view })).toBe(0);
    expect(drawn.box.scrollLeft).toBe(40);
  });

  test("right to left: the rows scroll back, the column being at the left", () => {
    const drawn: ReturnType<typeof drawTable> = drawTable();

    drawn.box.style.direction = "rtl";
    drawn.box.getBoundingClientRect = rectOf(BOX);
    drawn.stickyBody.getBoundingClientRect = rectOf(STUCK_LEFT);
    drawn.pill.getBoundingClientRect = rectOf({ left: 30, right: 110 });
    drawn.box.scrollLeft = -40;

    expect(revealFromStickyEnd({ box: drawn.box, target: drawn.pill })).toBe(
      -(120 - 30 + GAP),
    );
    expect(drawn.box.scrollLeft).toBe(-40 - (120 - 30 + GAP));
  });

  test("something outside the box is never scrolled for", () => {
    const drawn: ReturnType<typeof drawTable> = drawTable();
    const outside: HTMLButtonElement = document.createElement("button");

    document.body.appendChild(outside);
    drawn.box.getBoundingClientRect = rectOf(BOX);
    outside.getBoundingClientRect = rectOf({ left: 500, right: 580 });

    expect(revealFromStickyEnd({ box: drawn.box, target: outside })).toBe(0);
    expect(revealFromStickyEnd({ box: drawn.box, target: drawn.box })).toBe(0);
  });
});

/*
 * The real Table: its Actions cells say they are stuck, and the keyboard
 * moving onto a pill under them scrolls the rows - while they scroll
 * sideways, and only then.
 */
interface Row {
  name: string;
}

const ROWS: Array<Row> = [{ name: "Remind owners" }];

const COLUMNS: Columns<Row> = [
  { title: "Name", key: "name", type: FieldType.Text },
  {
    title: "Remind Owners",
    key: "name",
    type: FieldType.Element,
    getElement: (): ReactElement => {
      return (
        <button type="button" data-testid="never-reminds">
          Never reminds
        </button>
      );
    },
  },
  { title: "Actions", type: FieldType.Actions },
];

function renderTable(): void {
  render(
    <Table<Row>
      id="reminder-rules"
      data={ROWS}
      columns={COLUMNS}
      singularLabel="Rule"
      pluralLabel="Rules"
      currentPageNumber={1}
      totalItemsCount={1}
      itemsOnPage={10}
      error=""
      isLoading={false}
      onNavigateToPage={(): void => {}}
      sortOrder={SortOrder.Ascending}
      sortBy={null}
      onSortChanged={(): void => {}}
      actionButtons={[
        {
          title: "View",
          icon: IconProp.Eye,
          buttonStyleType: ButtonStyleType.NORMAL,
          onClick: (): void => {},
        },
      ]}
    />,
  );
}

/*
 * Boxes for the drawn table, by what each element is: the scroll box 600px
 * wide, the table 1200px (so the rows scroll sideways) or 500px (so they
 * fit), the stuck cells at 480..600 and the pill under them.
 */
function layOut(tableWidth: number): void {
  jest
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement): DOMRect {
      if (this.getAttribute("data-testid") === "table-scroll") {
        return rectOf(BOX)();
      }

      if (this.tagName === "TABLE") {
        return rectOf({ left: 0, right: tableWidth })();
      }

      if (this.hasAttribute(TABLE_STICKY_END_ATTRIBUTE)) {
        return rectOf(STUCK_RIGHT)();
      }

      if (this.getAttribute("data-testid") === "never-reminds") {
        return rectOf({ left: 500, right: 580 })();
      }

      return rectOf({ left: 0, right: 0 })();
    });
}

describe("the Table keeps a focused cell clear of its stuck Actions column", () => {
  test("its Actions cells, header and rows, are marked stuck; no other cell is", () => {
    renderTable();

    const stuck: Array<Element> = Array.from(
      document.querySelectorAll(`[${TABLE_STICKY_END_ATTRIBUTE}]`),
    );

    expect(
      stuck.map((cell: Element): string => {
        return cell.tagName;
      }),
    ).toEqual(["TH", "TD"]);
    for (const cell of stuck) {
      expect(cell.getAttribute(TABLE_STICKY_END_ATTRIBUTE)).toBe("true");
      expect(cell.className).toContain("sticky");
    }
  });

  test("while the rows scroll sideways, the keyboard moving onto a pill under the column scrolls the rows until it is clear", async () => {
    layOut(1200);
    renderTable();

    const box: HTMLElement = screen.getByTestId("table-scroll");

    expect(box).toHaveAttribute("data-overflowing", "true");
    box.scrollLeft = 0;

    await act(async () => {
      screen.getByTestId("never-reminds").focus();
    });

    expect(box.scrollLeft).toBe(580 - 480 + GAP);
  });

  test("while the rows fit, nothing scrolls", async () => {
    layOut(500);
    renderTable();

    const box: HTMLElement = screen.getByTestId("table-scroll");

    expect(box).toHaveAttribute("data-overflowing", "false");
    box.scrollLeft = 0;

    await act(async () => {
      screen.getByTestId("never-reminds").focus();
    });

    expect(box.scrollLeft).toBe(0);
  });

  test("the row's own View, in the stuck column, never scrolls the rows", async () => {
    layOut(1200);
    renderTable();

    const box: HTMLElement = screen.getByTestId("table-scroll");
    box.scrollLeft = 30;

    await act(async () => {
      screen.getByRole("button", { name: "View" }).focus();
    });

    expect(box.scrollLeft).toBe(30);
  });
});
