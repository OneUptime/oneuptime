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
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";

/*
 * The markdown viewer has suites of its own; here it stands in as what it
 * was handed, to show where the value is drawn.
 */
jest.mock("../../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): ReactElement => {
      return React.createElement(
        "div",
        { "data-testid": "markdown-viewer" },
        props.text,
      );
    },
  };
});

import Detail, {
  DETAIL_VALUE_CLASS_NAME,
  DetailStyle,
} from "../../../../UI/Components/Detail/Detail";
import {
  DETAIL_FIELD_DESCRIPTION_CLASS_NAME,
  DETAIL_FIELD_LABEL_CLASS_NAME,
} from "../../../../UI/Components/Detail/DetailFieldLabel";
import {
  getDetailCellClassNames,
  getDetailGridClassName,
} from "../../../../UI/Components/Detail/DetailGridLayout";
import {
  EMPTY_VALUE_MARK,
  EMPTY_VALUE_TEST_ID,
} from "../../../../UI/Components/Detail/EmptyValue";
import Field from "../../../../UI/Components/Detail/Field";
import { Size } from "../../../../UI/Components/Detail/FieldLabel";
import { PLACEHOLDER_TEXT_CLASS_NAME } from "../../../../UI/Components/Detail/PlaceholderText";
import FieldType from "../../../../UI/Components/Types/FieldType";
import AlignItem from "../../../../UI/Types/AlignItem";
import Route from "../../../../Types/API/Route";
import ObjectID from "../../../../Types/ObjectID";
import Email from "../../../../Types/Email";

/*
 * A detail card's fields, as every detail card draws them (DetailStyle.
 * Default): the maintainer's "How can we make this card model detail UI a
 * lot better, more modern, cleaner, and simpler for people to use and
 * understand? ... This should apply to all card model ui".
 *
 *   - rows that line up in every column count, with one rule across the
 *     whole width between two rows, and no field sized by an inline width;
 *   - the field's name written as the card writes it, in a muted grey, with
 *     no dot, over its value in the reading colour and weight;
 *   - an empty value says so - the field's own words, or a dash read out as
 *     "Not set" - instead of leaving the name over a blank line;
 *   - long values wrap in their column; a copyable one keeps its copy
 *     button in view;
 *   - dates, amounts and minutes read as plain text.
 *
 * jsdom lays nothing out, so the layout is held here by what the browser is
 * told (the classes, which DetailGridLayout.test.ts resolves at every
 * width); the real browser measures it in packages/E2E/DetailCards.
 */

interface Item {
  _id?: string | undefined;
  name?: string | undefined;
  email?: Email | string | undefined;
  timezone?: string | undefined;
  notes?: string | undefined;
  description?: string | undefined;
  isPublic?: boolean | undefined;
  retries?: number | undefined;
  balance?: number | undefined;
  wait?: number | undefined;
  startsAt?: Date | string | undefined;
  day?: Date | string | undefined;
  region?: string | undefined;
  regions?: Array<string> | undefined;
  url?: string | undefined;
  key?: string | undefined;
  projectId?: ObjectID | undefined;
}

const LONG_URL: string =
  "https://status.acme-commerce.example/incidents/2026/checkout-latency-in-eu-west-one-and-retries-on-the-payments-gateway-callback-queue";

const ITEM: Item = {
  name: "Test User",
  email: "test@oneuptime.com",
  timezone: "GMT+1 Europe/London",
};

type TextFieldFunction = (
  key: keyof Item,
  title: string,
  extra?: Partial<Field<Item>>,
) => Field<Item>;

const textField: TextFieldFunction = (
  key: keyof Item,
  title: string,
  extra?: Partial<Field<Item>>,
): Field<Item> => {
  return { key: key, title: title, fieldType: FieldType.Text, ...extra };
};

// The screenshot's card: Name, Email and Timezone in two columns.
const SCREENSHOT_FIELDS: Array<Field<Item>> = [
  textField("name", "Name", { placeholder: "No name added" }),
  textField("email", "Email", { placeholder: "No email added" }),
  textField("timezone", "Timezone", { placeholder: "No timezone selected" }),
];

type RenderDetailFunction = (props: {
  fields: Array<Field<Item>>;
  item?: Item | undefined;
  columns?: number | undefined;
  style?: DetailStyle | undefined;
}) => HTMLElement;

const renderDetail: RenderDetailFunction = (props: {
  fields: Array<Field<Item>>;
  item?: Item | undefined;
  columns?: number | undefined;
  style?: DetailStyle | undefined;
}): HTMLElement => {
  const { container } = render(
    <Detail<Item>
      id="detail"
      item={props.item || ITEM}
      fields={props.fields}
      showDetailsInNumberOfColumns={props.columns}
      style={props.style}
    />,
  );

  return container.firstElementChild as HTMLElement;
};

// The field's own box: its name, then its value.
const fieldBox: (title: string) => HTMLElement = (
  title: string,
): HTMLElement => {
  return screen
    .getByText(title)
    .closest("[data-testid='detail-field']") as HTMLElement;
};

const valueOf: (title: string) => HTMLElement = (
  title: string,
): HTMLElement => {
  return within(fieldBox(title)).getByTestId("detail-value");
};

const cells: (grid: HTMLElement) => Array<HTMLElement> = (
  grid: HTMLElement,
): Array<HTMLElement> => {
  return Array.from(grid.children) as Array<HTMLElement>;
};

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the maintainer's screenshot: User Settings > Profile, two columns", () => {
  test("Name and Email share the first row's top; Timezone runs the second row under one rule", () => {
    const grid: HTMLElement = renderDetail({
      fields: SCREENSHOT_FIELDS,
      columns: 2,
    });

    expect(grid).toHaveAttribute("id", "detail");
    expect(grid.className).toBe(getDetailGridClassName(2));
    expect(grid.className).toBe("grid grid-cols-1 sm:grid-cols-2 w-full");

    const [name, email, timezone] = cells(grid) as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];

    // From sm up both cells of the first row: no rule, no top padding.
    expect(name).toHaveClass("pt-0");
    expect(name).not.toHaveClass("border-t");
    expect(email).toHaveClass("sm:pt-0", "sm:border-t-0");
    // On a phone Email is a row of its own, under a rule.
    expect(email).toHaveClass("border-t", "pt-4");
    // Timezone fills its row, so the rule above it runs the whole width.
    expect(timezone).toHaveClass("border-t", "pt-4", "sm:col-span-2", "pb-0");
    // A gutter after Name only.
    expect(name).toHaveClass("sm:pr-6");
    expect(email.className).not.toContain("pr-6");

    expect(
      cells(grid).map((cell: HTMLElement): string => {
        return cell.className;
      }),
    ).toEqual(getDetailCellClassNames([undefined, undefined, undefined], 2));
  });

  test("no field carries an inline width, a hover box or a negative margin", () => {
    const grid: HTMLElement = renderDetail({
      fields: SCREENSHOT_FIELDS,
      columns: 2,
    });

    for (const cell of cells(grid)) {
      expect(cell).not.toHaveAttribute("style");
      expect(cell.className).not.toMatch(/(^|\s)(hover|group-hover):/);
      expect(cell.className).not.toMatch(/(^|\s)-m[xy]?-/);
      expect(cell.className).not.toContain("rounded");
      expect(cell.className).not.toMatch(/(^|\s)(first|last):/);
    }

    expect(grid.innerHTML).not.toContain("width:");
  });

  test("the names read as the card writes them, muted, with no dot; the values in the reading colour", () => {
    renderDetail({ fields: SCREENSHOT_FIELDS, columns: 2 });

    for (const title of ["Name", "Email", "Timezone"]) {
      const label: HTMLElement = screen
        .getByText(title)
        .closest("label") as HTMLElement;

      expect(label).toHaveAttribute("data-testid", "detail-label");
      expect(label.className).toContain(DETAIL_FIELD_LABEL_CLASS_NAME);
      expect(label).toHaveClass("text-sm", "font-medium", "text-gray-500");
      expect(label).not.toHaveClass("uppercase");
      expect(label.className).not.toContain("tracking-");
      expect(label.className).not.toContain("font-semibold");
      // The dot that followed every name.
      expect(label.querySelector(".rounded-full")).toBeNull();
      expect(label.textContent).toBe(title);
    }

    expect(valueOf("Name")).toHaveClass("mt-1", "text-sm", "text-gray-900");
    expect(valueOf("Name").className).toContain(DETAIL_VALUE_CLASS_NAME);
    expect(valueOf("Name").className).not.toContain("font-medium");
    expect(valueOf("Email")).toHaveTextContent("test@oneuptime.com");
  });

  test("keeps the walk from a field's name to its value: label block, then value", () => {
    renderDetail({ fields: SCREENSHOT_FIELDS, columns: 2 });

    const labelBlock: HTMLElement = screen
      .getByText("Email")
      .closest("div.space-y-1") as HTMLElement;
    const row: HTMLElement = labelBlock.parentElement as HTMLElement;

    expect(row).toBe(fieldBox("Email"));
    expect(row.children).toHaveLength(2);
    expect(row.children[0]).toBe(labelBlock);
    expect(row.children[1]?.textContent).toBe("test@oneuptime.com");
  });
});

describe("rows in every column count", () => {
  const fields: Array<Field<Item>> = [
    textField("name", "Name"),
    textField("email", "Email"),
    textField("timezone", "Timezone"),
    textField("region", "Region"),
    textField("url", "URL"),
    textField("key", "Key"),
    textField("notes", "Notes"),
  ];

  const item: Item = {
    ...ITEM,
    region: "eu-west-1",
    url: "https://acme.example",
    key: "abc",
    notes: "Note",
  };

  test.each([1, 2, 3, 4])(
    "%i column(s): each cell's classes are its place in the rows",
    (columns: number) => {
      const grid: HTMLElement = renderDetail({
        fields: fields,
        item: item,
        columns: columns,
      });

      expect(grid.className).toBe(getDetailGridClassName(columns));
      expect(
        cells(grid).map((cell: HTMLElement): string => {
          return cell.className;
        }),
      ).toEqual(
        getDetailCellClassNames(
          fields.map(() => {
            return undefined;
          }),
          columns,
        ),
      );
    },
  );

  test("three and four columns wait for lg; between sm and lg there are two", () => {
    expect(renderDetail({ fields, item, columns: 3 }).className).toBe(
      "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 w-full",
    );
    cleanup();
    expect(renderDetail({ fields, item, columns: 4 }).className).toBe(
      "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 w-full",
    );
  });

  test("a field's colSpan is kept, and its row is filled", () => {
    const grid: HTMLElement = renderDetail({
      fields: [
        textField("name", "Name"),
        textField("notes", "Notes", { colSpan: 2 }),
        textField("region", "Region"),
      ],
      item: item,
      columns: 2,
    });

    const [name, notes, region] = cells(grid) as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];

    // Notes does not fit beside Name: Name fills the first row.
    expect(name).toHaveClass("sm:col-span-2");
    expect(notes).toHaveClass("sm:col-span-2");
    expect(region).toHaveClass("sm:col-span-2");
    expect(cells(grid)).toHaveLength(3);
  });

  test("a field without a column, a hidden one and one for phones only leave no hole in a row", () => {
    const original: number = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1280,
    });

    try {
      const grid: HTMLElement = renderDetail({
        fields: [
          textField("name", "Name"),
          { key: null, title: "No column" },
          textField("email", "Email", {
            showIf: (): boolean => {
              return false;
            },
          }),
          textField("timezone", "Timezone"),
        ],
        columns: 2,
      });

      expect(cells(grid)).toHaveLength(2);
      expect(screen.queryByText("No column")).toBeNull();
      expect(screen.queryByText("Email")).toBeNull();
      // Name and Timezone share the first row.
      expect(
        cells(grid).map((cell: HTMLElement): string => {
          return cell.className;
        }),
      ).toEqual(getDetailCellClassNames([undefined, undefined], 2));
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: original,
      });
    }
  });

  test("on a phone a hideOnMobile field leaves the rows it was in", () => {
    const original: number = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    });

    try {
      const grid: HTMLElement = renderDetail({
        fields: [
          textField("name", "Name"),
          textField("email", "Email", { hideOnMobile: true }),
          textField("timezone", "Timezone"),
        ],
        columns: 2,
      });

      expect(screen.queryByText("Email")).toBeNull();
      expect(
        cells(grid).map((cell: HTMLElement): string => {
          return cell.className;
        }),
      ).toEqual(getDetailCellClassNames([undefined, undefined], 2));
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: original,
      });
    }
  });
});

describe("a field's name", () => {
  test("a description sits under the name, in a block - never a <p> holding a <div>", () => {
    const grid: HTMLElement = renderDetail({
      fields: [
        textField("name", "Name", {
          description: <div data-testid="rich">Shown on the status page</div>,
        }),
        textField("email", "Email", { description: "Where alerts go" }),
      ],
      columns: 1,
    });

    expect(grid.querySelector("p div")).toBeNull();

    const description: HTMLElement = screen.getByText("Where alerts go");
    expect(description).toHaveAttribute("data-testid", "detail-description");
    expect(description.className).toContain(
      DETAIL_FIELD_DESCRIPTION_CLASS_NAME,
    );
    expect(description).toHaveClass("text-xs", "text-gray-500");
    // Part of the name's block, not of the value.
    expect(fieldBox("Email").children[0]?.contains(description)).toBe(true);
    expect(valueOf("Email")).toHaveTextContent("test@oneuptime.com");
    expect(screen.getByTestId("rich").closest("p")).toBeNull();
  });

  test("a side link sits beside the name; one that opens a new tab says so", () => {
    renderDetail({
      fields: [
        textField("name", "Name", {
          sideLink: {
            text: "Preview",
            url: new Route("/status-page/acme"),
            openLinkInNewTab: true,
          },
        }),
        textField("email", "Email", {
          sideLink: { text: "Change", url: new Route("/settings/email") },
        }),
      ],
      columns: 1,
    });

    const preview: HTMLElement = screen.getByRole("link", { name: "Preview" });
    expect(screen.getByText("Name").closest("label")).toContainElement(preview);
    expect(preview).toHaveAttribute("target", "_blank");
    expect(
      within(preview).getByTestId("detail-side-link-new-tab"),
    ).toBeInTheDocument();

    const change: HTMLElement = screen.getByRole("link", { name: "Change" });
    expect(change).not.toHaveAttribute("target", "_blank");
    expect(within(change).queryByTestId("detail-side-link-new-tab")).toBeNull();
  });

  test("a field's own title size replaces the name's text size", () => {
    renderDetail({
      fields: [textField("name", "Name", { fieldTitleSize: Size.Large })],
    });

    const label: HTMLElement = screen
      .getByText("Name")
      .closest("label") as HTMLElement;

    expect(label).toHaveClass("text-lg");
    expect(label).not.toHaveClass("text-sm");
  });

  test("a field aligned right keeps its name and value at the right", () => {
    renderDetail({
      fields: [textField("name", "Name", { alignItem: AlignItem.Right })],
    });

    expect(screen.getByText("Name").closest("label")).toHaveClass(
      "flex",
      "justify-end",
    );
    expect(valueOf("Name")).toHaveClass("flex", "justify-end");
  });

  test("a field with no alignment starts at the left - with a class that exists", () => {
    renderDetail({ fields: [textField("name", "Name")] });

    expect(valueOf("Name")).toHaveClass("flex", "justify-start");
    expect(valueOf("Name").className).not.toContain("justify-left");
  });
});

describe("an empty value", () => {
  test("shows the field's own words, as quiet text - not a dashed chip", () => {
    renderDetail({
      fields: SCREENSHOT_FIELDS,
      item: { name: "Test User", email: "test@oneuptime.com" },
      columns: 2,
    });

    const placeholder: HTMLElement = within(valueOf("Timezone")).getByTestId(
      "placeholder-text",
    );

    expect(placeholder).toHaveTextContent("No timezone selected");
    expect(placeholder.className).toBe(PLACEHOLDER_TEXT_CLASS_NAME);
    expect(placeholder).toHaveClass("text-gray-500");
    expect(placeholder.className).not.toContain("border-dashed");
    expect(placeholder.className).not.toContain("bg-gray-50");
  });

  test("with no words of its own, shows a dash read out as 'Not set'", () => {
    renderDetail({
      fields: [textField("notes", "Notes")],
      item: {},
    });

    const empty: HTMLElement = within(valueOf("Notes")).getByTestId(
      EMPTY_VALUE_TEST_ID,
    );

    expect(empty).toHaveTextContent(`${EMPTY_VALUE_MARK}Not set`);
    expect(within(empty).getByText(EMPTY_VALUE_MARK)).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(within(empty).getByText("Not set")).toHaveClass("sr-only");
    // The name no longer hangs over a blank line.
    expect(valueOf("Notes").textContent).not.toBe("");
  });

  test.each([
    ["null", null],
    ["undefined", undefined],
    ["an empty string", ""],
  ])("%s is empty", (_name: string, value: unknown) => {
    renderDetail({
      fields: [textField("notes", "Notes")],
      item: { notes: value as string },
    });

    expect(
      within(valueOf("Notes")).getByTestId(EMPTY_VALUE_TEST_ID),
    ).toBeInTheDocument();
  });

  test("zero is a value, drawn inside the value's box", () => {
    renderDetail({
      fields: [textField("retries", "Retries")],
      item: { retries: 0 },
    });

    expect(valueOf("Retries")).toHaveTextContent("0");
    expect(within(valueOf("Retries")).queryByTestId(EMPTY_VALUE_TEST_ID)).toBe(
      null,
    );
    expect(valueOf("Retries").firstElementChild?.textContent).toBe("0");
  });

  test("an empty date or time is a dash, or the field's words - never a bare hyphen", () => {
    renderDetail({
      fields: [
        { key: "startsAt", title: "Starts", fieldType: FieldType.DateTime },
        {
          key: "day",
          title: "Day",
          fieldType: FieldType.Date,
          placeholder: "Not scheduled",
        },
      ],
      item: {},
    });

    expect(
      within(valueOf("Starts")).getByTestId(EMPTY_VALUE_TEST_ID),
    ).toBeInTheDocument();
    expect(valueOf("Day")).toHaveTextContent("Not scheduled");
    expect(valueOf("Starts").textContent).not.toBe("-");
  });

  test("an unset dropdown is a dash, or the field's words", () => {
    renderDetail({
      fields: [
        {
          key: "region",
          title: "Region",
          fieldType: FieldType.Dropdown,
          dropdownOptions: [{ label: "EU", value: "eu" }],
        },
        {
          key: "regions",
          title: "Regions",
          fieldType: FieldType.MultiSelectDropdown,
          dropdownOptions: [{ label: "EU", value: "eu" }],
          placeholder: "No regions",
        },
      ],
      item: { regions: [] },
    });

    expect(
      within(valueOf("Region")).getByTestId(EMPTY_VALUE_TEST_ID),
    ).toBeInTheDocument();
    expect(valueOf("Regions")).toHaveTextContent("No regions");
    expect(valueOf("Region").innerHTML).not.toContain("italic");
    expect(valueOf("Regions").innerHTML).not.toContain("italic");
  });
});

describe("a long value", () => {
  test("wraps inside its column: the value and its box may shrink below their longest word", () => {
    renderDetail({
      fields: [textField("url", "Runbook"), textField("email", "Email")],
      item: {
        url: LONG_URL,
        email:
          "maximiliane.alexandra.von-hohenzollern@platform-reliability.acme-commerce.example",
      },
      columns: 2,
    });

    for (const title of ["Runbook", "Email"]) {
      const value: HTMLElement = valueOf(title);
      const content: HTMLElement = value.firstElementChild as HTMLElement;
      const text: HTMLElement = content.firstElementChild as HTMLElement;

      expect(fieldBox(title)).toHaveClass("min-w-0");
      expect(value).toHaveClass("min-w-0");
      expect(content).toHaveClass("min-w-0", "w-full");
      expect(text).toHaveClass("min-w-0", "break-words");
      expect(text.className).not.toContain("truncate");
      expect(text.className).not.toContain("whitespace-nowrap");
    }

    expect(valueOf("Runbook")).toHaveTextContent(LONG_URL);
  });
});

describe("copying a value", () => {
  let writes: Array<string> = [];

  beforeEach(() => {
    writes = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string): Promise<void> => {
          writes.push(text);
        },
      },
    });
  });

  test("the copy button is in view, not waiting for a hover, and copies the value", async () => {
    renderDetail({
      fields: [textField("key", "Key", { opts: { isCopyable: true } })],
      item: { key: "ouk_abc123" },
    });

    const copy: HTMLElement = within(valueOf("Key")).getByTestId(
      "detail-value-copy",
    );

    expect(copy.className).not.toContain("opacity-0");
    expect(copy.closest(".opacity-0")).toBeNull();

    await act(async () => {
      fireEvent.click(
        within(copy).getByRole("button", { name: "Copy to clipboard" }),
      );
    });

    expect(writes).toEqual(["ouk_abc123"]);
  });

  test("a value drawn as an element copies the record's value, never '[object Object]'", async () => {
    renderDetail({
      fields: [
        textField("url", "Runbook", {
          opts: { isCopyable: true },
          getElement: (item: Item): ReactElement => {
            return <a href={item.url}>Open the runbook</a>;
          },
        }),
      ],
      item: { url: LONG_URL },
    });

    await act(async () => {
      fireEvent.click(
        within(valueOf("Runbook")).getByRole("button", {
          name: "Copy to clipboard",
        }),
      );
    });

    expect(writes).toEqual([LONG_URL]);
  });

  test("an email object copies its address", async () => {
    renderDetail({
      fields: [textField("email", "Email", { opts: { isCopyable: true } })],
      item: { email: new Email("test@oneuptime.com") },
    });

    await act(async () => {
      fireEvent.click(
        within(valueOf("Email")).getByRole("button", {
          name: "Copy to clipboard",
        }),
      );
    });

    expect(writes).toEqual(["test@oneuptime.com"]);
  });

  test("an ID and hidden text bring their own copy control, so there is no second one", () => {
    renderDetail({
      fields: [
        {
          key: "projectId",
          title: "Project ID",
          fieldType: FieldType.ObjectID,
          opts: { isCopyable: true },
        },
        {
          key: "key",
          title: "Key",
          fieldType: FieldType.HiddenText,
          opts: { isCopyable: true },
        },
      ],
      item: {
        projectId: new ObjectID("10000000-0000-4000-8000-000000000001"),
        key: "secret",
      },
    });

    expect(screen.queryByTestId("detail-value-copy")).toBeNull();
  });

  test("an empty copyable value has nothing to copy, and no button", () => {
    renderDetail({
      fields: [textField("key", "Key", { opts: { isCopyable: true } })],
      item: {},
    });

    expect(screen.queryByTestId("detail-value-copy")).toBeNull();
    expect(
      within(valueOf("Key")).getByTestId(EMPTY_VALUE_TEST_ID),
    ).toBeInTheDocument();
  });
});

describe("values read as plain text", () => {
  test("a date and a time are <time>s in the value's weight, with no icon", () => {
    renderDetail({
      fields: [
        { key: "startsAt", title: "Starts", fieldType: FieldType.DateTime },
        { key: "day", title: "Day", fieldType: FieldType.Date },
      ],
      item: {
        startsAt: new Date("2026-10-01T08:00:00.000Z"),
        day: "2026-10-02T00:00:00.000Z",
      },
    });

    for (const title of ["Starts", "Day"]) {
      const time: HTMLElement | null = valueOf(title).querySelector("time");

      expect(time).not.toBeNull();
      expect(time!.textContent).toMatch(/2026/);
      expect(valueOf(title).querySelector("svg")).toBeNull();
      expect(valueOf(title).innerHTML).not.toContain("font-medium");
    }

    expect(valueOf("Starts").querySelector("time")).toHaveAttribute(
      "datetime",
      "2026-10-01T08:00:00.000Z",
    );
  });

  test("an amount reads '$12.50 USD' - not a green box with a coin", () => {
    renderDetail({
      fields: [
        { key: "balance", title: "Balance", fieldType: FieldType.USDCents },
      ],
      item: { balance: 1250 },
    });

    const amount: HTMLElement = within(valueOf("Balance")).getByTestId(
      "detail-usd-value",
    );

    expect(amount).toHaveTextContent("$12.50USD");
    expect(amount.innerHTML).not.toContain("emerald");
    expect(amount.querySelector("svg")).toBeNull();
    expect(amount.className).not.toContain("bg-");
  });

  test("a zero balance is $0.00, not a bare 0", () => {
    renderDetail({
      fields: [
        { key: "balance", title: "Balance", fieldType: FieldType.USDCents },
      ],
      item: { balance: 0 },
    });

    expect(
      within(valueOf("Balance")).getByTestId("detail-usd-value"),
    ).toHaveTextContent("$0.00USD");
  });

  test("minutes read '5 minutes' and '1 minute' - not a blue box with a clock", () => {
    renderDetail({
      fields: [
        { key: "wait", title: "Wait", fieldType: FieldType.Minutes },
        { key: "retries", title: "Retry", fieldType: FieldType.Minutes },
      ],
      item: { wait: 5, retries: 1 },
    });

    expect(valueOf("Wait")).toHaveTextContent("5 minutes");
    expect(valueOf("Retry")).toHaveTextContent("1 minute");
    expect(valueOf("Wait").innerHTML).not.toContain("bg-blue-50");
    expect(valueOf("Wait").querySelector("svg")).toBeNull();
  });

  test("a value the dropdown no longer offers is shown as itself", () => {
    renderDetail({
      fields: [
        {
          key: "region",
          title: "Region",
          fieldType: FieldType.Dropdown,
          dropdownOptions: [{ label: "EU", value: "eu" }],
          placeholder: "No region",
        },
      ],
      item: { region: "ap-south-1" },
    });

    expect(valueOf("Region")).toHaveTextContent("ap-south-1");
    expect(valueOf("Region")).not.toHaveTextContent("No region");
  });

  test("a yes/no value keeps its pill", () => {
    renderDetail({
      fields: [
        { key: "isPublic", title: "Public", fieldType: FieldType.Boolean },
      ],
      item: { isPublic: true },
    });

    expect(valueOf("Public")).toHaveTextContent("Yes");
  });
});

describe("rich values", () => {
  test("markdown is handed to the markdown viewer, inside the value's box", () => {
    renderDetail({
      fields: [
        {
          key: "description",
          title: "Description",
          fieldType: FieldType.Markdown,
        },
      ],
      item: { description: "Public status for **checkout**." },
    });

    const viewer: HTMLElement = screen.getByTestId("markdown-viewer");

    expect(viewer).toHaveTextContent("Public status for **checkout**.");
    expect(valueOf("Description")).toContainElement(viewer);

    /*
     * The first paragraph's space above and the last's below are trimmed, so
     * the text sits as close to its name as any other value does.
     */
    const frame: HTMLElement = screen.getByTestId("detail-markdown-value");
    expect(frame).toContainElement(viewer);
    expect(frame.className.split(" ")).toEqual([
      "[&>div>*:first-child]:mt-0",
      "[&>div>*:last-child]:mb-0",
    ]);
  });

  test("empty markdown is an empty value, not an empty viewer", () => {
    renderDetail({
      fields: [
        {
          key: "description",
          title: "Description",
          fieldType: FieldType.Markdown,
          placeholder: "No description yet.",
        },
      ],
      item: { description: "" },
    });

    expect(screen.queryByTestId("markdown-viewer")).toBeNull();
    expect(valueOf("Description")).toHaveTextContent("No description yet.");
  });

  test("a custom element is drawn as the value, under the name", () => {
    renderDetail({
      fields: [
        textField("name", "Owner", {
          getElement: (item: Item): ReactElement => {
            return <a href="/teams/payments">{item.name} (team)</a>;
          },
        }),
      ],
    });

    const link: HTMLElement = screen.getByRole("link", {
      name: "Test User (team)",
    });

    expect(valueOf("Owner")).toContainElement(link);
  });

  test("code is drawn in its block", () => {
    renderDetail({
      fields: [
        {
          key: "notes",
          title: "Custom CSS",
          fieldType: FieldType.CSS,
        },
      ],
      item: { notes: ".banner { color: red; }" },
    });

    expect(valueOf("Custom CSS")).toHaveTextContent(".banner");
  });
});

describe("the record line under the fields", () => {
  test("still ends the card, under one rule, after the last row", () => {
    const { container } = render(
      <Detail<Item>
        id="detail"
        item={{ ...ITEM, _id: "10000000-0000-4000-8000-000000000001" }}
        fields={[
          ...SCREENSHOT_FIELDS,
          { key: "_id", title: "ID", fieldType: FieldType.ObjectID },
        ]}
        showDetailsInNumberOfColumns={2}
      />,
    );

    const root: HTMLElement = container.firstElementChild as HTMLElement;
    const grid: HTMLElement = root.firstElementChild as HTMLElement;
    const line: HTMLElement = screen.getByTestId("detail-record-line");

    expect(root).toHaveAttribute("id", "detail");
    expect(grid.className).toBe(getDetailGridClassName(2));
    expect(cells(grid)).toHaveLength(3);
    expect(line).toHaveClass("mt-4", "border-t", "border-gray-100", "pt-3");
    expect(root.lastElementChild).toBe(line);
  });
});

describe("the default style is the style", () => {
  test("no style and DetailStyle.Default draw the same markup", () => {
    const { container: implicit } = render(
      <Detail<Item>
        id="detail"
        item={ITEM}
        fields={SCREENSHOT_FIELDS}
        showDetailsInNumberOfColumns={2}
      />,
    );
    const implicitHtml: string = implicit.innerHTML;
    cleanup();

    const { container: explicit } = render(
      <Detail<Item>
        id="detail"
        item={ITEM}
        fields={SCREENSHOT_FIELDS}
        showDetailsInNumberOfColumns={2}
        style={DetailStyle.Default}
      />,
    );

    expect(explicit.innerHTML).toBe(implicitHtml);
  });

  test("the card and minimal styles draw the same names and values, sized by the grid", () => {
    for (const style of [DetailStyle.Card, DetailStyle.Minimal]) {
      const grid: HTMLElement = renderDetail({
        fields: SCREENSHOT_FIELDS,
        columns: 2,
        style: style,
      });

      for (const cell of cells(grid)) {
        expect(cell).not.toHaveAttribute("style");
        expect(cell).toHaveAttribute("data-testid", "detail-field");
      }

      const label: HTMLElement = screen
        .getByText("Name")
        .closest("label") as HTMLElement;
      expect(label).not.toHaveClass("uppercase");
      expect(valueOf("Name")).toHaveTextContent("Test User");
      cleanup();
    }
  });
});
