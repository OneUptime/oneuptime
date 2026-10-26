import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import TableColumnListComponent from "../../../../UI/Components/TableColumnList/TableColumnListComponent";
import {
  TableCardContext,
  TableCellContext,
  useIsTableCard,
  useIsTableCell,
} from "../../../../UI/Components/Table/TableCellContext";
import { TABLE_EMPTY_VALUE_TEST_ID } from "../../../../UI/Components/Table/TableEmptyValue";
import {
  TABLE_CARD_LIST_ITEM_CLASS_NAME,
  TABLE_LIST_ITEM_CLASS_NAME,
  TABLE_MOBILE_FIELD_CLASS_NAME,
} from "../../../../UI/Components/Table/TableLayout";
import TableBody from "../../../../UI/Components/Table/TableBody";
import Modal from "../../../../UI/Components/Modal/Modal";
import SideOver from "../../../../UI/Components/SideOver/SideOver";
import FieldType from "../../../../UI/Components/Types/FieldType";

/*
 * A list in a row on a phone (TableBody draws each row as a card there: the
 * column names over their values).
 *
 * In a table's row each item of a list keeps to its line and ends in "..."
 * when it is wider than its column, its whole name under the pointer. A
 * card did the same, though it has no column to keep to and a phone no
 * pointer: the alerts list names an alert's monitor only in its Affected
 * Resources list (it has no Monitor column), and on a phone that list read
 * "oneuptime-test - High Node Memory Utili..." - all of the monitor anyone
 * could read. In a card an item now runs onto the next line, as the card's
 * other values do (TableCardContext, TABLE_CARD_LIST_ITEM_CLASS_NAME).
 */

afterEach(() => {
  cleanup();
});

interface Resource {
  name: string;
}

interface Row {
  _id: string;
  resources: Array<Resource>;
}

const MONITOR: string = "oneuptime-test - High Node Memory Utilization";
const CLUSTER: string = "oneuptime-test";

// The shape a record's link draws: icon and name in a flex row.
function resourceLink(resource: Resource): ReactElement {
  return (
    <a href={`/resources/${encodeURIComponent(resource.name)}`}>
      <span className="flex">
        <div>
          <svg />
        </div>{" "}
        {resource.name}
      </span>
    </a>
  );
}

function resources(...names: Array<string>): Array<Resource> {
  return names.map((name: string): Resource => {
    return { name: name };
  });
}

function resourceList(items: Array<Resource>): ReactElement {
  return (
    <TableColumnListComponent<Resource>
      items={items}
      moreTemplate={{
        one: "{{count}} more resource",
        other: "{{count}} more resources",
      }}
      noItemsMessage="No resources."
      getEachElement={resourceLink}
    />
  );
}

// A real table body of one column, "Affected Resources", on a phone or not.
function renderBody(rows: Array<Row>, isMobile: boolean): void {
  const body: ReactElement = (
    <TableBody<Row>
      id="resources-body"
      data={rows}
      columns={[
        {
          title: "Affected Resources",
          key: "resources",
          type: FieldType.Element,
          getElement: (row: Row): ReactElement => {
            return resourceList(row.resources);
          },
        },
      ]}
      selectedItems={[]}
      matchBulkSelectedItemByField={undefined}
      isMobile={isMobile}
    />
  );

  render(isMobile ? body : <table>{body}</table>);
}

function row(index: number, items: Array<Resource>): Row {
  return {
    _id: `44000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    resources: items,
  };
}

// The box each link is drawn in: the list's item.
function itemsOf(root: HTMLElement): Array<HTMLElement> {
  return within(root)
    .queryAllByRole("link")
    .map((link: HTMLElement): HTMLElement => {
      return link.parentElement as HTMLElement;
    });
}

function linkNames(root: HTMLElement): Array<string> {
  return within(root)
    .queryAllByRole("link")
    .map((link: HTMLElement): string => {
      return (link.textContent || "").trim();
    });
}

// Pretend the item is wider than its box, as a long name is in a column.
function makeCutShort(item: HTMLElement): void {
  Object.defineProperty(item, "scrollWidth", {
    value: 520,
    configurable: true,
  });
  Object.defineProperty(item, "clientWidth", {
    value: 320,
    configurable: true,
  });
}

describe("a list in a phone's card", () => {
  test("each name runs onto the next line beside its icon, never ending in an ellipsis", () => {
    renderBody([row(1, resources(MONITOR, CLUSTER))], true);

    const card: HTMLElement = document.getElementById(
      "resources-body",
    ) as HTMLElement;

    expect(linkNames(card)).toEqual([MONITOR, CLUSTER]);

    for (const item of itemsOf(card)) {
      expect(item.className).toBe(TABLE_CARD_LIST_ITEM_CLASS_NAME);
      expect(item).not.toHaveClass("truncate");
      // The link keeps its own flex row: a second line starts beside the icon.
      expect(item.querySelector("span.flex")).not.toBeNull();
    }

    expect(within(card).getByText("Affected Resources").tagName).toBe("DT");
  });

  test("no tooltip repeats a name the card already shows in full", () => {
    renderBody([row(1, resources(MONITOR))], true);

    const item: HTMLElement = itemsOf(
      document.getElementById("resources-body") as HTMLElement,
    )[0]!;

    makeCutShort(item);
    fireEvent.mouseEnter(item);

    expect(item).not.toHaveAttribute("title");
  });

  test("still the first three and 'N more', and 'Show less' folds them again", () => {
    renderBody(
      [row(1, resources(MONITOR, CLUSTER, "Checkout API", "Payments", "SLO"))],
      true,
    );

    const card: HTMLElement = document.getElementById(
      "resources-body",
    ) as HTMLElement;

    expect(linkNames(card)).toEqual([MONITOR, CLUSTER, "Checkout API"]);

    fireEvent.click(
      within(card).getByRole("button", { name: "2 more resources" }),
    );

    expect(linkNames(card)).toEqual([
      MONITOR,
      CLUSTER,
      "Checkout API",
      "Payments",
      "SLO",
    ]);

    // The ones shown after a click wrap the same way.
    for (const item of itemsOf(card)) {
      expect(item.className).toBe(TABLE_CARD_LIST_ITEM_CLASS_NAME);
    }

    fireEvent.click(within(card).getByRole("button", { name: "Show less" }));

    expect(linkNames(card)).toEqual([MONITOR, CLUSTER, "Checkout API"]);
  });

  test("nothing to list is still the quiet dash, so the card leaves the field out", () => {
    renderBody([row(1, [])], true);

    const dash: HTMLElement = screen.getByTestId(TABLE_EMPTY_VALUE_TEST_ID);

    expect(dash.querySelector(".sr-only")).toHaveTextContent("No resources.");
    // The dash alone in the field's value: the field hides itself.
    expect(dash.parentElement?.tagName).toBe("DD");
    expect(dash.parentElement?.childElementCount).toBe(1);
    expect(dash.parentElement?.parentElement?.className).toBe(
      TABLE_MOBILE_FIELD_CLASS_NAME,
    );
    expect(screen.queryByText("No resources.", { selector: "p" })).toBeNull();
  });

  test("the same list in a row of a table keeps each name to its line, its whole name under the pointer", () => {
    renderBody([row(1, resources(MONITOR, CLUSTER))], false);

    const items: Array<HTMLElement> = itemsOf(
      screen.getByRole("row") as HTMLElement,
    );

    expect(items).toHaveLength(2);

    for (const item of items) {
      expect(item.className).toBe(TABLE_LIST_ITEM_CLASS_NAME);
    }

    makeCutShort(items[0]!);
    fireEvent.mouseEnter(items[0]!);

    expect(items[0]).toHaveAttribute("title", MONITOR);
  });
});

describe("what an element can tell about a phone's card", () => {
  function Probe(): ReactElement {
    const isTableCell: boolean = useIsTableCell();
    const isTableCard: boolean = useIsTableCard();

    return (
      <span data-testid="probe">
        {isTableCard ? "card" : isTableCell ? "row" : "page"}
      </span>
    );
  }

  function renderProbeBody(
    isMobile: boolean,
    draw: () => ReactElement = (): ReactElement => {
      return <Probe />;
    },
  ): void {
    const body: ReactElement = (
      <TableBody<{ _id: string }>
        id="probe-body"
        data={[{ _id: "44000000-0000-4000-8000-000000000001" }]}
        columns={[
          {
            title: "Probe",
            key: "_id",
            type: FieldType.Element,
            getElement: draw,
          },
        ]}
        selectedItems={[]}
        matchBulkSelectedItemByField={undefined}
        isMobile={isMobile}
      />
    );

    render(isMobile ? body : <table>{body}</table>);
  }

  test("a field of a phone's card is a card's", () => {
    renderProbeBody(true);

    expect(screen.getByTestId("probe")).toHaveTextContent("card");
  });

  test("a cell of a table's row is a row's, not a card's", () => {
    renderProbeBody(false);

    expect(screen.getByTestId("probe")).toHaveTextContent("row");
  });

  test("nothing outside a table is either", () => {
    render(<Probe />);

    expect(screen.getByTestId("probe")).toHaveTextContent("page");
  });

  test("a card is only a card inside a table's cell", () => {
    render(
      <TableCardContext.Provider value={true}>
        <Probe />
      </TableCardContext.Provider>,
    );

    expect(screen.getByTestId("probe")).toHaveTextContent("page");
  });

  test("a dialog opened from a card starts afresh", () => {
    renderProbeBody(true, (): ReactElement => {
      return (
        <Modal title="Affected Resources" onClose={(): void => {}}>
          <Probe />
        </Modal>
      );
    });

    expect(screen.getByTestId("probe")).toHaveTextContent("page");
  });

  test("a side panel opened from a card starts afresh", () => {
    renderProbeBody(true, (): ReactElement => {
      return (
        <SideOver
          title="Affected Resources"
          description="Everything the alert is about."
          onClose={(): void => {}}
        >
          <Probe />
        </SideOver>
      );
    });

    expect(screen.getByTestId("probe")).toHaveTextContent("page");
  });

  test("a list in a dialog opened from a card is the plain list again", () => {
    render(
      <TableCellContext.Provider value={true}>
        <TableCardContext.Provider value={true}>
          <Modal title="Affected Resources" onClose={(): void => {}}>
            {resourceList(resources(MONITOR, CLUSTER))}
          </Modal>
        </TableCardContext.Provider>
      </TableCellContext.Provider>,
    );

    for (const item of itemsOf(screen.getByRole("dialog"))) {
      expect(item.className).toBe("");
    }
  });
});
