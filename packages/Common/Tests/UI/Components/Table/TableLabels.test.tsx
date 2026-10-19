import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import fs from "fs";
import path from "path";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import LabelsElement, {
  DETAIL_LABELS_TEST_ID,
  TABLE_LABELS_CLASS_NAME,
  TABLE_LABELS_EXPANDED_CLASS_NAME,
  TABLE_LABELS_MORE_CLASS_NAME,
  TABLE_LABELS_TEST_ID,
  TABLE_LABELS_VISIBLE_COUNT,
} from "../../../../UI/Components/Label/Labels";
import TableColumnListComponent from "../../../../UI/Components/TableColumnList/TableColumnListComponent";
import {
  TableCellContext,
  useIsTableCell,
} from "../../../../UI/Components/Table/TableCellContext";
import { TABLE_EMPTY_VALUE_TEST_ID } from "../../../../UI/Components/Table/TableEmptyValue";
import { TABLE_LIST_ITEM_CLASS_NAME } from "../../../../UI/Components/Table/TableLayout";
import TableBody from "../../../../UI/Components/Table/TableBody";
import Modal from "../../../../UI/Components/Modal/Modal";
import SideOver from "../../../../UI/Components/SideOver/SideOver";
import FieldType from "../../../../UI/Components/Types/FieldType";
import Label from "../../../../Models/DatabaseModels/Label";
import Color from "../../../../Types/Color";

/*
 * A table cell's lists (model-table-ui): a record's labels on the row's one
 * line, the first two and "+N" (Label/Labels.tsx); any other list one item a
 * line, each cut short with an ellipsis (TableColumnListComponent); nothing
 * to list a quiet dash with the column's words for a screen reader. They
 * stacked one label a line, three lines tall, and said "No labels
 * attached." on every row. Tables draw them so by TableCellContext, which
 * TableBody sets and a dialog or side panel opened from a cell resets.
 */

const GERMAN_FILE: Record<string, string> = JSON.parse(
  fs.readFileSync(
    path.join(
      __dirname,
      "../../../../../App/FeatureSet/Dashboard/src/Locales/de.json",
    ),
    "utf8",
  ),
) as Record<string, string>;

let german: i18n;

beforeAll(async () => {
  german = createInstance();
  await german.init({
    lng: "de",
    fallbackLng: "de",
    resources: { de: { translation: GERMAN_FILE } },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(() => {
  cleanup();
});

const NAMES: Array<string> = [
  "Production",
  "Payments",
  "EU West",
  "Customer facing",
  "Database",
];

type MakeLabelsFunction = (names: Array<string>) => Array<Label>;

const makeLabels: MakeLabelsFunction = (names: Array<string>): Array<Label> => {
  return names.map((name: string, index: number): Label => {
    const label: Label = new Label();
    label._id = `21000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
    label.name = name;
    label.color = new Color("#6366f1");
    return label;
  });
};

type InCellFunction = (element: ReactElement) => ReactElement;

const inCell: InCellFunction = (element: ReactElement): ReactElement => {
  return (
    <TableCellContext.Provider value={true}>
      {element}
    </TableCellContext.Provider>
  );
};

type PillTextsFunction = (root: HTMLElement) => Array<string>;

const pillTexts: PillTextsFunction = (root: HTMLElement): Array<string> => {
  return Array.from(root.querySelectorAll('[data-testid="pill"]')).map(
    (pill: Element): string => {
      return (pill.textContent || "").trim();
    },
  );
};

describe("a record's labels in a table's cell", () => {
  test("none: a quiet dash, with the column's words for a screen reader", () => {
    render(inCell(<LabelsElement labels={[]} />));

    const value: HTMLElement = screen.getByTestId(TABLE_EMPTY_VALUE_TEST_ID);

    expect(value.querySelector(".sr-only")).toHaveTextContent(
      "No labels attached.",
    );
    // Not the words as a line of their own any more.
    expect(
      screen.queryByText("No labels attached.", { selector: "p" }),
    ).toBeNull();
  });

  test("two or fewer: every one, side by side on the row's line, no '+N'", () => {
    const { container } = render(
      inCell(<LabelsElement labels={makeLabels(NAMES.slice(0, 2))} />),
    );

    const row: HTMLElement = screen.getByTestId(TABLE_LABELS_TEST_ID);

    expect(row.className).toBe(TABLE_LABELS_CLASS_NAME);
    expect(pillTexts(container)).toEqual(["Production", "Payments"]);
    expect(screen.queryByTestId("table-labels-more")).toBeNull();
    expect(screen.queryByTestId(DETAIL_LABELS_TEST_ID)).toBeNull();
  });

  test("more: the first two and '+N', on one line that never wraps", () => {
    const { container } = render(
      inCell(<LabelsElement labels={makeLabels(NAMES)} />),
    );

    expect(TABLE_LABELS_VISIBLE_COUNT).toBe(2);
    expect(pillTexts(container)).toEqual(["Production", "Payments"]);
    expect(screen.getByTestId(TABLE_LABELS_TEST_ID)).toHaveClass("flex-nowrap");

    const more: HTMLElement = screen.getByTestId("table-labels-more");

    expect(more).toHaveTextContent("+3");
    expect(more.tagName).toBe("BUTTON");
    expect(more).toHaveAttribute("type", "button");
    expect(more).toHaveAccessibleName("Show 3 more labels");
    // The hidden ones under the pointer.
    expect(more).toHaveAttribute("title", "EU West, Customer facing, Database");
    expect(more.className).toBe(TABLE_LABELS_MORE_CLASS_NAME);
  });

  test("one more label is said in the singular", () => {
    render(inCell(<LabelsElement labels={makeLabels(NAMES.slice(0, 3))} />));

    expect(screen.getByTestId("table-labels-more")).toHaveAccessibleName(
      "Show 1 more label",
    );
  });

  test("'+N' shows them all, wrapping in the column, and 'Show less' folds them again", () => {
    const { container } = render(
      inCell(<LabelsElement labels={makeLabels(NAMES)} />),
    );

    fireEvent.click(screen.getByTestId("table-labels-more"));

    expect(pillTexts(container)).toEqual(NAMES);
    expect(screen.getByTestId(TABLE_LABELS_TEST_ID).className).toBe(
      TABLE_LABELS_EXPANDED_CLASS_NAME,
    );
    expect(screen.queryByTestId("table-labels-more")).toBeNull();

    fireEvent.click(screen.getByTestId("table-labels-less"));

    expect(pillTexts(container)).toEqual(NAMES.slice(0, 2));
    expect(screen.getByTestId("table-labels-more")).toBeInTheDocument();
    expect(screen.queryByTestId("table-labels-less")).toBeNull();
  });

  test("the same element goes from labels to none and back without losing its hooks", () => {
    const { rerender } = render(
      inCell(<LabelsElement labels={makeLabels(NAMES)} />),
    );

    rerender(inCell(<LabelsElement labels={[]} />));
    expect(screen.getByTestId(TABLE_EMPTY_VALUE_TEST_ID)).toBeInTheDocument();

    rerender(inCell(<LabelsElement labels={makeLabels(NAMES)} />));
    expect(screen.getByTestId("table-labels-more")).toHaveTextContent("+3");
  });

  test("'+N' is said in the reader's language", () => {
    const sentence: string = GERMAN_FILE[
      "Show {{count}} more labels"
    ] as string;
    const one: string = GERMAN_FILE["Show {{count}} more labels_one"] as string;

    expect(sentence).toBeTruthy();
    expect(sentence).not.toBe("Show {{count}} more labels");
    expect(one).not.toBe("Show {{count}} more label");

    render(
      <I18nextProvider i18n={german}>
        {inCell(<LabelsElement labels={makeLabels(NAMES)} />)}
      </I18nextProvider>,
    );

    expect(screen.getByTestId("table-labels-more")).toHaveAccessibleName(
      sentence.replace("{{count}}", "3"),
    );
  });

  test("a row of a real table body draws them so", () => {
    interface Row {
      labels: Array<Label>;
    }

    render(
      <table>
        <TableBody<Row>
          id="labels-body"
          data={[{ labels: makeLabels(NAMES) }, { labels: [] }]}
          columns={[
            {
              title: "Labels",
              key: "labels",
              type: FieldType.Element,
              getElement: (row: Row): ReactElement => {
                return <LabelsElement labels={row.labels} />;
              },
            },
          ]}
          selectedItems={[]}
          matchBulkSelectedItemByField={undefined}
          isMobile={false}
        />
      </table>,
    );

    const rows: Array<HTMLElement> = screen.getAllByRole("row");

    expect(
      within(rows[0]!).getByTestId(TABLE_LABELS_TEST_ID),
    ).toBeInTheDocument();
    expect(
      within(rows[1]!).getByTestId(TABLE_EMPTY_VALUE_TEST_ID),
    ).toBeInTheDocument();
  });
});

describe("a list in a table's cell", () => {
  type ResourceFunction = (name: string) => ReactElement;

  // The shape a record's link draws: icon and name in a flex row.
  const resource: ResourceFunction = (name: string): ReactElement => {
    return (
      <a href={`/monitors/${name}`}>
        <span className="flex">
          <div>
            <svg />
          </div>{" "}
          {name}
        </span>
      </a>
    );
  };

  test("each item keeps to its line and ends in an ellipsis", () => {
    render(
      inCell(
        <TableColumnListComponent<{ name: string }>
          items={[{ name: "Checkout API" }, { name: "Redis cluster" }]}
          noItemsMessage="No resources."
          getEachElement={(item: { name: string }): ReactElement => {
            return resource(item.name);
          }}
        />,
      ),
    );

    const items: Array<HTMLElement> = screen
      .getAllByRole("link")
      .map((link: HTMLElement): HTMLElement => {
        return link.parentElement as HTMLElement;
      });

    expect(items).toHaveLength(2);

    for (const item of items) {
      expect(item.className).toBe(TABLE_LIST_ITEM_CLASS_NAME);
    }
  });

  test("an item cut short shows in full under the pointer", () => {
    render(
      inCell(
        <TableColumnListComponent<{ name: string }>
          items={[
            {
              name: "Redis oneuptime-valkey-master.default.svc.cluster.local:6857",
            },
          ]}
          noItemsMessage="No resources."
          getEachElement={(item: { name: string }): ReactElement => {
            return resource(item.name);
          }}
        />,
      ),
    );

    const item: HTMLElement = screen.getByRole("link")
      .parentElement as HTMLElement;

    Object.defineProperty(item, "scrollWidth", { value: 500 });
    Object.defineProperty(item, "clientWidth", { value: 320 });
    fireEvent.mouseEnter(item);

    expect(item).toHaveAttribute(
      "title",
      "Redis oneuptime-valkey-master.default.svc.cluster.local:6857",
    );
  });

  test("nothing to list: a quiet dash with the list's words", () => {
    render(
      inCell(
        <TableColumnListComponent<{ name: string }>
          items={[]}
          noItemsMessage="No resources."
          getEachElement={(item: { name: string }): ReactElement => {
            return resource(item.name);
          }}
        />,
      ),
    );

    expect(
      screen.getByTestId(TABLE_EMPTY_VALUE_TEST_ID).querySelector(".sr-only"),
    ).toHaveTextContent("No resources.");
  });

  test("outside a table, a list is as it always was", () => {
    render(
      <TableColumnListComponent<{ name: string }>
        items={[]}
        noItemsMessage="No resources."
        getEachElement={(item: { name: string }): ReactElement => {
          return resource(item.name);
        }}
      />,
    );

    expect(screen.queryByTestId(TABLE_EMPTY_VALUE_TEST_ID)).toBeNull();
    expect(screen.getByText("No resources.").tagName).toBe("P");
  });
});

describe("what opens over a table starts afresh", () => {
  function Probe(): ReactElement {
    return (
      <span data-testid="probe">{useIsTableCell() ? "cell" : "page"}</span>
    );
  }

  test("a table's body says its cells are cells", () => {
    render(
      <table>
        <TableBody<{ _id: string }>
          id="probe-body"
          data={[{ _id: "1" }]}
          columns={[
            {
              title: "Probe",
              key: "_id",
              type: FieldType.Element,
              getElement: (): ReactElement => {
                return <Probe />;
              },
            },
          ]}
          selectedItems={[]}
          matchBulkSelectedItemByField={undefined}
          isMobile={false}
        />
      </table>,
    );

    expect(screen.getByTestId("probe")).toHaveTextContent("cell");
  });

  test("nothing outside a table is a cell", () => {
    render(<Probe />);

    expect(screen.getByTestId("probe")).toHaveTextContent("page");
  });

  test("a dialog opened from a cell", () => {
    render(
      inCell(
        <Modal title="Labels" onClose={(): void => {}}>
          <Probe />
        </Modal>,
      ),
    );

    expect(screen.getByTestId("probe")).toHaveTextContent("page");
  });

  test("a side panel opened from a cell", () => {
    render(
      inCell(
        <SideOver
          title="Labels"
          description="Every label on the record."
          onClose={(): void => {}}
        >
          <Probe />
        </SideOver>,
      ),
    );

    expect(screen.getByTestId("probe")).toHaveTextContent("page");
  });

  test("a record's labels in a dialog opened from a cell are the plain list again", () => {
    render(
      inCell(
        <Modal title="Labels" onClose={(): void => {}}>
          <LabelsElement labels={makeLabels(NAMES)} />
        </Modal>,
      ),
    );

    expect(screen.queryByTestId(TABLE_LABELS_TEST_ID)).toBeNull();
    expect(
      screen.getByRole("button", { name: "2 more labels" }),
    ).toBeInTheDocument();
  });
});
