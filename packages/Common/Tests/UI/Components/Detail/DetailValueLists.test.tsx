import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import BooleanValue from "../../../../UI/Components/Detail/BooleanValue";
import Detail, {
  DETAIL_VALUE_BADGE_CLASS_NAME,
  DetailStyle,
} from "../../../../UI/Components/Detail/Detail";
import {
  DETAIL_FIELD_DESCRIPTION_CLASS_NAME,
  DETAIL_FIELD_SIDE_LINK_CLASS_NAME,
} from "../../../../UI/Components/Detail/DetailFieldLabel";
import { useIsDetailValue } from "../../../../UI/Components/Detail/DetailValueContext";
import {
  EMPTY_VALUE_CLASS_NAME,
  EMPTY_VALUE_TEST_ID,
} from "../../../../UI/Components/Detail/EmptyValue";
import Field from "../../../../UI/Components/Detail/Field";
import { PLACEHOLDER_TEXT_CLASS_NAME } from "../../../../UI/Components/Detail/PlaceholderText";
import DropdownValueBadge from "../../../../UI/Components/Dropdown/DropdownValueBadge";
import Modal from "../../../../UI/Components/Modal/Modal";
import SideOver from "../../../../UI/Components/SideOver/SideOver";
import TableBody from "../../../../UI/Components/Table/TableBody";
import LabelsElement, {
  DETAIL_LABELS_CLASS_NAME,
  DETAIL_LABELS_TEST_ID,
  TABLE_LABELS_TEST_ID,
} from "../../../../UI/Components/Label/Labels";
import TableColumnListComponent from "../../../../UI/Components/TableColumnList/TableColumnListComponent";
import FieldType from "../../../../UI/Components/Types/FieldType";
import Label from "../../../../Models/DatabaseModels/Label";
import Route from "../../../../Types/API/Route";
import Color from "../../../../Types/Color";
import {
  PILL_CLASS_NAME,
  PillSize,
} from "../../../../UI/Components/Pill/Pill";

/*
 * What a page hands a detail field to draw - a record's labels, a list of
 * related records, a dropdown's choice, a yes/no - drawn as a detail card's
 * value, not as a table's cell (DetailValueContext).
 *
 * The labels were a table cell's list in a detail card too: one pill per
 * line, the first three and "N more", so the row holding them stood as tall
 * as its labels while the field beside it held one line, and labels hid
 * behind a click on the one page about the record. An empty list's "No
 * labels attached." was as dark as a value, beside empty fields that say so
 * in quiet grey. And the single pills a value can be sat on the line's
 * baseline, 2px lower than the text beside them, their row taller.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

const GERMAN_FILE: Record<string, string> = JSON.parse(
  fs.readFileSync(path.join(LOCALES_DIR, "de.json"), "utf8"),
) as Record<string, string>;

const german: i18n = createInstance();

beforeAll(async () => {
  await german.init({
    lng: "de",
    resources: {
      de: {
        translation: {
          "No labels attached.": GERMAN_FILE["No labels attached."] as string,
          "more labels": GERMAN_FILE["more labels"] as string,
        },
      },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(() => {
  cleanup();
});

const LABEL_NAMES: Array<string> = [
  "Production",
  "Customer facing",
  "EU",
  "Payments",
  "Tier 1",
  "On-call",
];

/*
 * The same labels as they are listed everywhere: in natural order
 * (Utils/LabelOrder, OneUptime issue #5183), not the order a page hands
 * them in.
 */
const LABEL_NAMES_IN_ORDER: Array<string> = [
  "Customer facing",
  "EU",
  "On-call",
  "Payments",
  "Production",
  "Tier 1",
];

type MakeLabelsFunction = (names: Array<string>) => Array<Label>;

const makeLabels: MakeLabelsFunction = (names: Array<string>): Array<Label> => {
  return names.map((name: string, index: number): Label => {
    const label: Label = new Label();
    label._id = `33333333-3333-4333-8333-33333333333${index}`;
    label.name = name;
    label.color = new Color("#4f46e5");
    return label;
  });
};

interface Item {
  name?: string | undefined;
  labels?: Array<Label> | undefined;
  severity?: string | undefined;
  owner?: string | undefined;
  isPublic?: boolean | undefined;
}

type RenderDetailFunction = (
  item: Item,
  fields: Array<Field<Item>>,
  style?: DetailStyle | undefined,
) => HTMLElement;

const renderDetail: RenderDetailFunction = (
  item: Item,
  fields: Array<Field<Item>>,
  style?: DetailStyle | undefined,
): HTMLElement => {
  const { container } = render(
    <Detail<Item>
      id="detail-value-lists"
      item={item}
      fields={fields}
      style={style}
      showDetailsInNumberOfColumns={2}
    />,
  );

  return container;
};

const labelsField: Field<Item> = {
  key: "labels",
  title: "Labels",
  fieldType: FieldType.Element,
  getElement: (item: Item): ReactElement => {
    return <LabelsElement labels={item.labels || []} />;
  },
};

const nameField: Field<Item> = {
  key: "name",
  title: "Name",
};

type FieldNamedFunction = (title: string) => HTMLElement;

const fieldNamed: FieldNamedFunction = (title: string): HTMLElement => {
  const field: HTMLElement | undefined = screen
    .getAllByTestId("detail-field")
    .find((cell: HTMLElement): boolean => {
      return (
        within(cell).queryByTestId("detail-label")?.textContent === title ||
        cell.querySelector("label")?.textContent === title
      );
    });

  if (!field) {
    throw new Error(`No field named ${title}`);
  }

  return field;
};

type PillTextsFunction = (element: HTMLElement) => Array<string>;

const pillTexts: PillTextsFunction = (element: HTMLElement): Array<string> => {
  return Array.from(element.querySelectorAll('[data-testid="pill"]')).map(
    (pill: Element): string => {
      return pill.textContent || "";
    },
  );
};

describe("a record's labels in a detail card", () => {
  test("sit side by side in one wrapping row, every one of them, with no 'N more'", () => {
    renderDetail({ name: "Checkout API", labels: makeLabels(LABEL_NAMES) }, [
      nameField,
      labelsField,
    ]);

    const value: HTMLElement = within(fieldNamed("Labels")).getByTestId(
      "detail-value",
    );
    const row: HTMLElement = within(value).getByTestId(DETAIL_LABELS_TEST_ID);

    expect(row.className).toBe(DETAIL_LABELS_CLASS_NAME);

    for (const name of ["flex", "flex-wrap", "items-center", "gap-1.5"]) {
      expect([name, row.classList.contains(name)]).toEqual([name, true]);
    }

    // The first line is a value's 24px line, so the pills sit level with it.
    expect(row).toHaveClass("min-h-6");

    // Every label, in natural order, each a pill straight in the row.
    expect(pillTexts(row)).toEqual(LABEL_NAMES_IN_ORDER);
    expect(row.children).toHaveLength(LABEL_NAMES.length);

    for (const pill of Array.from(row.children)) {
      expect((pill as HTMLElement).dataset["testid"]).toBe("pill");
      // The row spaces them: no margin of their own.
      expect((pill as HTMLElement).style.marginRight).toBe("");
    }

    // Nothing is folded away behind a button.
    expect(within(value).queryByRole("button")).toBeNull();
    expect(value).not.toHaveTextContent("more label");
  });

  test("in the overview pages' compact style too", () => {
    renderDetail(
      { name: "Checkout API", labels: makeLabels(LABEL_NAMES.slice(0, 4)) },
      [nameField, labelsField],
      DetailStyle.Compact,
    );

    const row: HTMLElement = within(fieldNamed("Labels")).getByTestId(
      DETAIL_LABELS_TEST_ID,
    );

    expect(pillTexts(row)).toEqual([
      "Customer facing",
      "EU",
      "Payments",
      "Production",
    ]);
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("a record with no labels says so as quiet text, as every empty field does", () => {
    renderDetail({ name: "Checkout API", labels: [] }, [
      nameField,
      labelsField,
    ]);

    const value: HTMLElement = within(fieldNamed("Labels")).getByTestId(
      "detail-value",
    );
    const words: HTMLElement = within(value).getByTestId("placeholder-text");

    expect(words).toHaveTextContent("No labels attached.");
    expect(words.className).toBe(PLACEHOLDER_TEXT_CLASS_NAME);
    expect(words).toHaveClass("text-gray-500");
    // Not a dark line of its own.
    expect(value.querySelector("p")).toBeNull();
    expect(within(value).queryByTestId(DETAIL_LABELS_TEST_ID)).toBeNull();
  });

  test("and says it in the reader's language", () => {
    render(
      <I18nextProvider i18n={german}>
        <Detail<Item>
          id="detail-value-lists"
          item={{ labels: [] }}
          fields={[labelsField]}
        />
      </I18nextProvider>,
    );

    const translated: string = GERMAN_FILE["No labels attached."] as string;

    expect(translated).toBeTruthy();
    expect(translated).not.toBe("No labels attached.");
    expect(screen.getByTestId("placeholder-text")).toHaveTextContent(
      translated,
    );
  });
});

/*
 * Outside a detail card's value and a table's cell (TableCellContext) - a
 * page that draws LabelsElement in a box of its own - the list is as it
 * always was. A table's own cell draws a row of labels: see
 * Table/TableLabels.test.tsx.
 */
describe("a record's labels outside a detail card and a table are left as they were", () => {
  test("one per line, the first three, then 'N more labels'", () => {
    const { container } = render(
      <LabelsElement labels={makeLabels(LABEL_NAMES)} />,
    );

    expect(screen.queryByTestId(DETAIL_LABELS_TEST_ID)).toBeNull();
    expect(pillTexts(container)).toEqual(LABEL_NAMES_IN_ORDER.slice(0, 3));
    expect(
      screen.getByRole("button", { name: "3 more labels" }),
    ).toBeInTheDocument();

    // Each pill in a block of its own, spaced by its own margin.
    for (const pill of Array.from(
      container.querySelectorAll<HTMLElement>('[data-testid="pill"]'),
    )) {
      expect(pill.parentElement).toHaveClass("my-2");
      expect(pill.style.marginRight).toBe("5px");
    }
  });

  test("no labels is the plain line it was", () => {
    const { container } = render(<LabelsElement labels={[]} />);

    const line: HTMLElement | null = container.querySelector("p");

    expect(line).not.toBeNull();
    expect(line).toHaveTextContent("No labels attached.");
    expect(screen.queryByTestId("placeholder-text")).toBeNull();
  });
});

describe("other lists in a detail card", () => {
  interface Monitor {
    name: string;
  }

  const monitors: Array<Monitor> = [
    "Checkout API",
    "Orders DB",
    "Search",
    "Cart",
    "Payments",
  ].map((name: string): Monitor => {
    return { name: name };
  });

  type ListFieldFunction = (items: Array<Monitor>) => Field<Item>;

  const listField: ListFieldFunction = (items: Array<Monitor>): Field<Item> => {
    return {
      key: "owner",
      title: "Monitors",
      fieldType: FieldType.Element,
      getElement: (): ReactElement => {
        return (
          <TableColumnListComponent<Monitor>
            items={items}
            moreText="more monitors"
            noItemsMessage="No monitors."
            getEachElement={(monitor: Monitor): ReactElement => {
              return <span data-testid="monitor">{monitor.name}</span>;
            }}
          />
        );
      },
    };
  };

  test("keep their own list - one per line, the first three and 'N more'", () => {
    renderDetail({ owner: "set" }, [listField(monitors)]);

    expect(
      screen.getAllByTestId("monitor").map((monitor: HTMLElement): string => {
        return monitor.textContent || "";
      }),
    ).toEqual(["Checkout API", "Orders DB", "Search"]);
    expect(
      screen.getByRole("button", { name: "2 more monitors" }),
    ).toBeInTheDocument();
  });

  test("but nothing to list reads as quiet text, not as a value", () => {
    renderDetail({ owner: "set" }, [listField([])]);

    const words: HTMLElement = screen.getByTestId("placeholder-text");

    expect(words).toHaveTextContent("No monitors.");
    expect(words.className).toBe(PLACEHOLDER_TEXT_CLASS_NAME);
    expect(
      within(fieldNamed("Monitors"))
        .getByTestId("detail-value")
        .querySelector("p"),
    ).toBeNull();
  });
});

describe("what an element can tell about where it is drawn", () => {
  const seen: Array<string> = [];

  const Probe: (props: { where: string }) => ReactElement = (props: {
    where: string;
  }): ReactElement => {
    const isDetailValue: boolean = useIsDetailValue();
    seen.push(`${props.where}:${isDetailValue}`);
    return <span>{props.where}</span>;
  };

  test("a field's value is a detail value; its name's description and anything outside a detail card are not", () => {
    seen.length = 0;

    render(
      <>
        <Probe where="outside" />
        <Detail<Item>
          id="detail-probe"
          item={{ name: "Checkout API" }}
          fields={[
            {
              key: "name",
              title: "Name",
              description: <Probe where="description" />,
              fieldType: FieldType.Element,
              getElement: (): ReactElement => {
                return <Probe where="value" />;
              },
            },
          ]}
        />
      </>,
    );

    expect(new Set(seen)).toEqual(
      new Set(["outside:false", "description:false", "value:true"]),
    );
  });
});

/*
 * A dialog, a side panel or a table drawn from inside a value starts again,
 * as each starts a card's surface again (CardSurface): what it draws is not
 * a detail card's value, so its labels are a table's or a form's.
 */
describe("a surface of its own drawn inside a value starts again", () => {
  type FieldDrawingFunction = (
    draw: (labels: Array<Label>) => ReactElement,
  ) => Field<Item>;

  const fieldDrawing: FieldDrawingFunction = (
    draw: (labels: Array<Label>) => ReactElement,
  ): Field<Item> => {
    return {
      key: "labels",
      title: "Labels",
      fieldType: FieldType.Element,
      getElement: (item: Item): ReactElement => {
        return draw(item.labels || []);
      },
    };
  };

  type ExpectTableListFunction = () => void;

  // A table cell's list: the first three, then "N more".
  const expectTableList: ExpectTableListFunction = (): void => {
    expect(screen.queryByTestId(DETAIL_LABELS_TEST_ID)).toBeNull();
    expect(
      screen.getByRole("button", { name: "3 more labels" }),
    ).toBeInTheDocument();
  };

  test("a dialog", () => {
    renderDetail({ labels: makeLabels(LABEL_NAMES) }, [
      fieldDrawing((labels: Array<Label>): ReactElement => {
        return (
          <Modal title="Labels" onClose={(): void => {}}>
            <LabelsElement labels={labels} />
          </Modal>
        );
      }),
    ]);

    expectTableList();
  });

  test("a side panel", () => {
    renderDetail({ labels: makeLabels(LABEL_NAMES) }, [
      fieldDrawing((labels: Array<Label>): ReactElement => {
        return (
          <SideOver
            title="Labels"
            description="Every label on the record."
            onClose={(): void => {}}
          >
            <LabelsElement labels={labels} />
          </SideOver>
        );
      }),
    ]);

    expectTableList();
  });

  test("a table's rows", () => {
    interface Row {
      labels: Array<Label>;
    }

    renderDetail({ labels: makeLabels(LABEL_NAMES) }, [
      fieldDrawing((labels: Array<Label>): ReactElement => {
        return (
          <table>
            <TableBody<Row>
              id="labels-table"
              data={[{ labels: labels }]}
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
          </table>
        );
      }),
    ]);

    /*
     * A table's rows draw a table's labels - one under another, the first
     * three and "3 more labels" - never the detail card's, even inside a
     * detail value.
     */
    expect(screen.queryByTestId(DETAIL_LABELS_TEST_ID)).toBeNull();
    expect(pillTexts(screen.getByTestId(TABLE_LABELS_TEST_ID))).toEqual(
      LABEL_NAMES_IN_ORDER.slice(0, 3),
    );
    expect(
      screen.getByRole("button", { name: "3 more labels" }),
    ).toBeInTheDocument();
  });
});

describe("values sit on the value's line, level with the values beside them", () => {
  test("an empty value's dash and its field's own words take the value's 24px line", () => {
    for (const name of ["text-sm", "leading-6"]) {
      expect([name, EMPTY_VALUE_CLASS_NAME.split(" ").includes(name)]).toEqual([
        name,
        true,
      ]);
      expect([
        name,
        PLACEHOLDER_TEXT_CLASS_NAME.split(" ").includes(name),
      ]).toEqual([name, true]);
    }

    // Top to top with the line, not centred on it.
    expect(PLACEHOLDER_TEXT_CLASS_NAME.split(" ")).toContain("align-top");

    renderDetail({}, [nameField]);

    expect(screen.getByTestId(EMPTY_VALUE_TEST_ID).className).toBe(
      EMPTY_VALUE_CLASS_NAME,
    );
  });

  test("a dropdown's choice is a badge on the value's line, top to top", () => {
    renderDetail({ severity: "high" }, [
      {
        key: "severity",
        title: "Severity",
        fieldType: FieldType.Dropdown,
        dropdownOptions: [
          { value: "high", label: "High", color: new Color("#dc2626") },
        ],
      },
    ]);

    const badge: HTMLElement = within(fieldNamed("Severity")).getByText("High");

    expect(badge).toHaveAttribute("data-dropdown-value-badge", "true");
    expect(badge).toHaveClass(DETAIL_VALUE_BADGE_CLASS_NAME);
    expect(DETAIL_VALUE_BADGE_CLASS_NAME).toBe("align-top");
  });

  test("a value the options no longer offer is that badge too", () => {
    renderDetail({ severity: "retired" }, [
      {
        key: "severity",
        title: "Severity",
        fieldType: FieldType.Dropdown,
        dropdownOptions: [{ value: "high", label: "High" }],
      },
    ]);

    expect(within(fieldNamed("Severity")).getByText("retired")).toHaveClass(
      DETAIL_VALUE_BADGE_CLASS_NAME,
    );
  });

  test("a related record is that badge too", () => {
    renderDetail({ owner: "Payments team" }, [
      {
        key: "owner",
        title: "Owner",
        fieldType: FieldType.Entity,
      },
    ]);

    expect(within(fieldNamed("Owner")).getByText("Payments team")).toHaveClass(
      DETAIL_VALUE_BADGE_CLASS_NAME,
    );
  });

  test("a badge drawn anywhere else - a table's cell - keeps its own alignment", () => {
    render(<DropdownValueBadge label="High" />);

    expect(screen.getByText("High")).not.toHaveClass("align-top");
  });

  test("a yes/no is a pill as tall as the value's line, top to top with it", () => {
    for (const value of [true, false]) {
      cleanup();
      render(<BooleanValue value={value} dataTestId="yes-no" />);

      const pill: HTMLElement = screen.getByTestId("yes-no");

      /*
       * The product's one pill (13px: 22.75px with its padding), top to top
       * on the value's 24px line, so a row holding a yes/no is no taller.
       */
      expect(pill).toHaveClass(...PILL_CLASS_NAME.split(" "), "align-top");
      expect(pill.style.fontSize).toBe(PillSize.Normal);
      expect(pill).not.toHaveClass("py-1");
    }
  });
});

describe("the compact style's small print", () => {
  test("a description reads at AA, and a side link has the default style's focus ring", () => {
    renderDetail(
      { name: "Checkout API" },
      [
        {
          key: "name",
          title: "Name",
          description: "Shown at the top of the page.",
          sideLink: {
            text: "Preview",
            url: new Route("/status-page/acme"),
          },
        },
      ],
      DetailStyle.Compact,
    );

    const description: HTMLElement = screen.getByText(
      "Shown at the top of the page.",
    );

    for (const name of DETAIL_FIELD_DESCRIPTION_CLASS_NAME.split(" ")) {
      expect([name, description.classList.contains(name)]).toEqual([
        name,
        true,
      ]);
    }
    expect(description).not.toHaveClass("text-gray-400");

    const link: HTMLElement = screen.getByRole("link", { name: "Preview" });

    expect(link.className).toContain(DETAIL_FIELD_SIDE_LINK_CLASS_NAME);
    expect(link).toHaveClass("focus-visible:ring-2");
  });
});
