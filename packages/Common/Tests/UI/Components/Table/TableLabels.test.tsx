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
  TABLE_LABEL_LINE_CLASS_NAME,
  TABLE_LABELS_CLASS_NAME,
  TABLE_LABELS_MORE_TEMPLATE,
  TABLE_LABELS_TEST_ID,
} from "../../../../UI/Components/Label/Labels";
import TableColumnListComponent, {
  TABLE_COLUMN_LIST_VISIBLE_COUNT,
} from "../../../../UI/Components/TableColumnList/TableColumnListComponent";
import { PluralTemplate } from "../../../../UI/Utils/TranslateTemplate";
import {
  TableCardContext,
  TableCellContext,
  useIsTableCell,
} from "../../../../UI/Components/Table/TableCellContext";
import { TABLE_EMPTY_VALUE_TEST_ID } from "../../../../UI/Components/Table/TableEmptyValue";
import {
  TABLE_CARD_LIST_ITEM_CLASS_NAME,
  TABLE_LIST_ITEM_CLASS_NAME,
} from "../../../../UI/Components/Table/TableLayout";
import {
  PILL_TEXT_CLASS_NAME,
  WRAPPING_PILL_CLASS_NAME,
  WRAPPING_PILL_TEXT_CLASS_NAME,
} from "../../../../UI/Components/Pill/Pill";
import TableBody from "../../../../UI/Components/Table/TableBody";
import Modal from "../../../../UI/Components/Modal/Modal";
import SideOver from "../../../../UI/Components/SideOver/SideOver";
import FieldType from "../../../../UI/Components/Types/FieldType";
import Label from "../../../../Models/DatabaseModels/Label";
import Color from "../../../../Types/Color";

// What a list of resources says of the ones it leaves out.
const MORE_RESOURCES: PluralTemplate = {
  one: "{{count}} more resource",
  other: "{{count}} more resources",
};

/*
 * A record's labels in a table's cell (Label/Labels.tsx), after OneUptime
 * issues #5187 and #5183: one under another, as a row's Affected Resources
 * are listed - the first three and "N more labels" for the rest, never a
 * fold of one - in natural order, numbered labels first by their numbers;
 * a long label ends in "..." on a laptop, its whole name under the pointer,
 * and runs onto a next line in a phone's card; nothing to list is a quiet
 * dash with the column's words for a screen reader. They sat side by side
 * on the row's one line, and long ones ran past the column's edge, cut off.
 * Tables draw them so by TableCellContext, which TableBody sets and a
 * dialog or side panel opened from a cell resets.
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

// The labels of the issues' screenshot, as the database joined them.
const ISSUE_LABELS: Array<string> = [
  "4.Business System=Customer Mobile App",
  "2.SubCategory=Website",
  "10.Owner=Loyalty Platform Team",
  "Claude",
  "1.Category=Application",
  "3.Item=Connectivity",
];

const ISSUE_LABELS_IN_ORDER: Array<string> = [
  "1.Category=Application",
  "2.SubCategory=Website",
  "3.Item=Connectivity",
  "4.Business System=Customer Mobile App",
  "10.Owner=Loyalty Platform Team",
  "Claude",
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

// On a phone a row is a card: a cell of one.
const inCard: InCellFunction = (element: ReactElement): ReactElement => {
  return (
    <TableCellContext.Provider value={true}>
      <TableCardContext.Provider value={true}>
        {element}
      </TableCardContext.Provider>
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
    expect(screen.queryByTestId(TABLE_LABELS_TEST_ID)).toBeNull();
  });

  test("one under another, each on a line of its own, as Affected Resources lists its resources", () => {
    render(
      inCell(<LabelsElement labels={makeLabels(ISSUE_LABELS.slice(0, 3))} />),
    );

    const list: HTMLElement = screen.getByTestId(TABLE_LABELS_TEST_ID);

    expect(list.className).toBe(TABLE_LABELS_CLASS_NAME);
    // A block of lines, never one row of pills side by side.
    expect(list).not.toHaveClass("flex");
    expect(list).not.toHaveClass("flex-nowrap");

    const items: Array<Element> = Array.from(list.children);

    expect(items).toHaveLength(3);

    for (const item of items) {
      // The list item every cell list draws, cut short at the column's end...
      expect((item as HTMLElement).className).toBe(TABLE_LIST_ITEM_CLASS_NAME);
      // ...holding one 24px line and one pill on it.
      const line: Element = item.firstElementChild as Element;
      expect((line as HTMLElement).className).toBe(TABLE_LABEL_LINE_CLASS_NAME);
      expect(line.querySelectorAll('[data-testid="pill"]')).toHaveLength(1);
    }
  });

  test("in natural order: numbered labels first by their numbers, then the rest", () => {
    const { container } = render(
      inCell(<LabelsElement labels={makeLabels(ISSUE_LABELS.slice(0, 4))} />),
    );

    // The four of the issue's screenshot: all shown, 10 after 4.
    expect(pillTexts(container)).toEqual([
      "2.SubCategory=Website",
      "4.Business System=Customer Mobile App",
      "10.Owner=Loyalty Platform Team",
      "Claude",
    ]);
  });

  test("four labels are all shown: a fold never hides a single label behind '1 more'", () => {
    const { container } = render(
      inCell(<LabelsElement labels={makeLabels(ISSUE_LABELS.slice(0, 4))} />),
    );

    expect(TABLE_COLUMN_LIST_VISIBLE_COUNT).toBe(3);
    expect(pillTexts(container)).toHaveLength(4);
    expect(screen.queryByTestId(`${TABLE_LABELS_TEST_ID}-more`)).toBeNull();
    expect(screen.queryByText(/1 more/)).toBeNull();
  });

  test("more: the first three in order, and 'N more labels' for the rest", () => {
    const { container } = render(
      inCell(<LabelsElement labels={makeLabels(ISSUE_LABELS)} />),
    );

    expect(pillTexts(container)).toEqual(ISSUE_LABELS_IN_ORDER.slice(0, 3));

    const more: HTMLElement = screen.getByTestId(
      `${TABLE_LABELS_TEST_ID}-more`,
    );

    expect(more.tagName).toBe("BUTTON");
    expect(more).toHaveAccessibleName("3 more labels");
    // One sentence for the count, in each language's plural forms.
    expect(TABLE_LABELS_MORE_TEMPLATE).toEqual({
      one: "{{count}} more label",
      other: "{{count}} more labels",
    });
    // Inside the list, under the labels it stands for.
    expect(screen.getByTestId(TABLE_LABELS_TEST_ID)).toContainElement(more);
  });

  test("'N more labels' shows every label in order, and 'Show less' folds them again", () => {
    const { container } = render(
      inCell(<LabelsElement labels={makeLabels(ISSUE_LABELS)} />),
    );

    fireEvent.click(screen.getByTestId(`${TABLE_LABELS_TEST_ID}-more`));

    expect(pillTexts(container)).toEqual(ISSUE_LABELS_IN_ORDER);
    expect(screen.queryByTestId(`${TABLE_LABELS_TEST_ID}-more`)).toBeNull();

    const less: HTMLElement = screen.getByTestId(
      `${TABLE_LABELS_TEST_ID}-less`,
    );

    expect(less).toHaveAccessibleName("Show less");

    fireEvent.click(less);

    expect(pillTexts(container)).toEqual(ISSUE_LABELS_IN_ORDER.slice(0, 3));
    expect(
      screen.getByTestId(`${TABLE_LABELS_TEST_ID}-more`),
    ).toBeInTheDocument();
    expect(screen.queryByTestId(`${TABLE_LABELS_TEST_ID}-less`)).toBeNull();
  });

  test("the order is the labels', not the order a page hands them in", () => {
    const labels: Array<Label> = makeLabels(ISSUE_LABELS);
    const { container, rerender } = render(
      inCell(<LabelsElement labels={labels} />),
    );
    const first: Array<string> = pillTexts(container);

    rerender(inCell(<LabelsElement labels={[...labels].reverse()} />));

    expect(pillTexts(container)).toEqual(first);
    // The page's own list is left as it was.
    expect(
      labels.map((label: Label): string => {
        return label.name || "";
      }),
    ).toEqual(ISSUE_LABELS);
  });

  test("a long label is cut short on a laptop, its whole name under the pointer", () => {
    const longName: string =
      "5.Escalation=Loyalty Platform Engineering, Customer Mobile App Integrations";

    render(inCell(<LabelsElement labels={makeLabels([longName])} />));

    const text: HTMLElement = screen.getByTestId("pill-text");

    expect(text.className).toBe(PILL_TEXT_CLASS_NAME);
    expect(text).toHaveClass("truncate");

    Object.defineProperty(text, "scrollWidth", { value: 480 });
    Object.defineProperty(text, "clientWidth", { value: 290 });
    fireEvent.mouseEnter(text);

    expect(text).toHaveAttribute("title", longName);
  });

  test("on a phone's card a long label runs onto a next line instead, nothing pointing to show it whole", () => {
    render(
      inCard(
        <LabelsElement
          labels={makeLabels([
            "5.Escalation=Loyalty Platform Engineering, Customer Mobile App Integrations",
            "3.Item=Connectivity",
          ])}
        />,
      ),
    );

    const list: HTMLElement = screen.getByTestId(TABLE_LABELS_TEST_ID);

    for (const item of Array.from(list.children)) {
      expect((item as HTMLElement).className).toBe(
        TABLE_CARD_LIST_ITEM_CLASS_NAME,
      );
    }

    for (const pill of screen.getAllByTestId("pill")) {
      expect(pill.className.trim()).toBe(WRAPPING_PILL_CLASS_NAME);
    }

    for (const text of screen.getAllByTestId("pill-text")) {
      expect(text.className).toBe(WRAPPING_PILL_TEXT_CLASS_NAME);
      expect(text).not.toHaveClass("truncate");
    }

    // In order there too.
    expect(pillTexts(list)).toEqual([
      "3.Item=Connectivity",
      "5.Escalation=Loyalty Platform Engineering, Customer Mobile App Integrations",
    ]);
  });

  test("on a laptop no pill wraps", () => {
    render(inCell(<LabelsElement labels={makeLabels(ISSUE_LABELS)} />));

    for (const pill of screen.getAllByTestId("pill")) {
      expect(pill.className).not.toContain(WRAPPING_PILL_CLASS_NAME);
      expect(pill).toHaveClass("rounded-full");
    }
  });

  test("the same element goes from labels to none and back without losing its hooks", () => {
    const { rerender } = render(
      inCell(<LabelsElement labels={makeLabels(ISSUE_LABELS)} />),
    );

    rerender(inCell(<LabelsElement labels={[]} />));
    expect(screen.getByTestId(TABLE_EMPTY_VALUE_TEST_ID)).toBeInTheDocument();

    rerender(inCell(<LabelsElement labels={makeLabels(ISSUE_LABELS)} />));
    expect(
      screen.getByTestId(`${TABLE_LABELS_TEST_ID}-more`),
    ).toHaveAccessibleName("3 more labels");
  });

  test("'N more labels' and 'Show less' are said in the reader's language", () => {
    const more: string = GERMAN_FILE["{{count}} more labels"] as string;
    const less: string = GERMAN_FILE["Show less"] as string;

    // In the words the German Labels column is titled in.
    expect(GERMAN_FILE["Labels"]).toBe("Beschriftungen");
    expect(more).toBe("{{count}} weitere Beschriftungen");
    expect(less).not.toBe("Show less");

    render(
      <I18nextProvider i18n={german}>
        {inCell(<LabelsElement labels={makeLabels(ISSUE_LABELS)} />)}
      </I18nextProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "3 weitere Beschriftungen" }),
    );

    expect(screen.getByRole("button", { name: less })).toBeInTheDocument();
  });

  /*
   * The count and "more labels" looked up on their own read "2 ещё меток"
   * in Russian and "2 他のラベル" in Japanese: the count belongs inside the
   * sentence, in the language's own plural form.
   */
  test.each([
    ["ru", 6, "Ещё меток: 3"],
    // Russian's "one" form takes 21 too.
    ["ru", 24, "Ещё 21 метка"],
    ["ja", 6, "ほか 3 件のラベル"],
    ["ko", 6, "레이블 3개 더"],
    ["zh-CN", 6, "另外 3 个标签"],
    ["fr", 6, "3 autres étiquettes"],
    ["da", 6, "3 etiketter mere"],
  ])(
    "in %s, %i labels fold to the sentence '%s'",
    async (code: string, count: number, sentence: string) => {
      const file: Record<string, string> = JSON.parse(
        fs.readFileSync(
          path.join(
            __dirname,
            `../../../../../App/FeatureSet/Dashboard/src/Locales/${code}.json`,
          ),
          "utf8",
        ),
      ) as Record<string, string>;
      const reader: i18n = createInstance();

      await reader.init({
        lng: code,
        fallbackLng: code,
        resources: { [code]: { translation: file } },
        interpolation: { escapeValue: false },
        keySeparator: false,
        nsSeparator: false,
      });

      const names: Array<string> = Array.from(
        { length: count },
        (_value: unknown, index: number): string => {
          return `${index + 1}. Label`;
        },
      );

      render(
        <I18nextProvider i18n={reader}>
          {inCell(<LabelsElement labels={makeLabels(names)} />)}
        </I18nextProvider>,
      );

      expect(
        screen.getByTestId(`${TABLE_LABELS_TEST_ID}-more`),
      ).toHaveAccessibleName(sentence);
    },
  );

  test("every language words the fold as a sentence of its own, with the count inside it", () => {
    const localesDirectory: string = path.join(
      __dirname,
      "../../../../../App/FeatureSet/Dashboard/src/Locales",
    );
    const readLocale: (fileName: string) => Record<string, string> = (
      fileName: string,
    ): Record<string, string> => {
      return JSON.parse(
        fs.readFileSync(path.join(localesDirectory, fileName), "utf8"),
      ) as Record<string, string>;
    };
    const english: Record<string, string> = readLocale("en.json");
    const fileNames: Array<string> = fs
      .readdirSync(localesDirectory)
      .filter((fileName: string): boolean => {
        return fileName.endsWith(".json");
      });

    expect(fileNames).toHaveLength(17);
    expect(english["{{count}} more labels"]).toBe("{{count}} more labels");
    expect(english["{{count}} more labels_one"]).toBe("{{count}} more label");

    for (const fileName of fileNames) {
      const file: Record<string, string> = readLocale(fileName);

      for (const key of [
        "{{count}} more labels",
        "{{count}} more labels_one",
      ]) {
        const sentence: string = file[key] || "";

        expect([fileName, key, sentence.includes("{{count}}")]).toEqual([
          fileName,
          key,
          true,
        ]);

        // Translated everywhere but English.
        if (fileName !== "en.json") {
          expect([fileName, key, sentence === english[key]]).toEqual([
            fileName,
            key,
            false,
          ]);
        }
      }
    }
  });

  test("a row of a real table body draws them so", () => {
    interface Row {
      labels: Array<Label>;
    }

    render(
      <table>
        <TableBody<Row>
          id="labels-body"
          data={[{ labels: makeLabels(ISSUE_LABELS) }, { labels: [] }]}
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
    const list: HTMLElement = within(rows[0]!).getByTestId(
      TABLE_LABELS_TEST_ID,
    );

    expect(pillTexts(list)).toEqual(ISSUE_LABELS_IN_ORDER.slice(0, 3));
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
          moreTemplate={MORE_RESOURCES}
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
          moreTemplate={MORE_RESOURCES}
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
          moreTemplate={MORE_RESOURCES}
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
        moreTemplate={MORE_RESOURCES}
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

  test("a record's labels in a dialog opened from a cell are the plain list again, in order", () => {
    const { baseElement } = render(
      inCell(
        <Modal title="Labels" onClose={(): void => {}}>
          <LabelsElement labels={makeLabels(ISSUE_LABELS)} />
        </Modal>,
      ),
    );

    expect(screen.queryByTestId(TABLE_LABELS_TEST_ID)).toBeNull();
    expect(screen.queryByTestId(DETAIL_LABELS_TEST_ID)).toBeNull();
    expect(
      screen.getByRole("button", { name: "3 more labels" }),
    ).toBeInTheDocument();
    expect(pillTexts(baseElement)).toEqual(ISSUE_LABELS_IN_ORDER.slice(0, 3));
  });
});
