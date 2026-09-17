import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import Permission, { UserPermission } from "../../../Types/Permission";

const getItemMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * compiled requires, so the mock consts are still unassigned when the
 * factories run. Dereferencing them lazily, at call time, is what works.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
    },
  };
});

const OWNER_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectOwner,
];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: () => {
        return OWNER_PERMISSIONS;
      },
      getProjectPermissions: () => {
        return {
          permissions: OWNER_PERMISSIONS.map((permission: Permission) => {
            return {
              permission,
              labelIds: [],
              _type: "UserPermission",
            } as UserPermission;
          }),
        };
      },
      getGlobalPermissions: () => {
        return { globalPermissions: OWNER_PERMISSIONS };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: () => {
        return false;
      },
    },
  };
});

import Detail, { DetailStyle } from "../../../UI/Components/Detail/Detail";
import Field from "../../../UI/Components/Detail/Field";
import FieldType from "../../../UI/Components/Types/FieldType";
import ModelDetail from "../../../UI/Components/ModelDetail/ModelDetail";
import CardModelDetail from "../../../UI/Components/ModelDetail/CardModelDetail";
import Probe from "../../../Models/DatabaseModels/Probe";
import ObjectID from "../../../Types/ObjectID";
import Route from "../../../Types/API/Route";

/*
 * DetailStyle.Compact is the dense label-over-value layout the overview
 * pages use for their right-hand details column. It is opt-in, so the other
 * styles must keep rendering exactly what they did, and it keeps the same
 * row -> [label block, value] DOM shape so code that walks from a label to
 * its value (including page tests) keeps working.
 */

const WAIT_TIMEOUT: number = 20000;

const PROBE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");

interface DetailItem {
  title?: string | undefined;
  owner?: string | undefined;
  createdAt?: Date | undefined;
  apiKey?: string | undefined;
  notes?: string | undefined;
}

const ITEM: DetailItem = {
  title: "Checkout latency",
  owner: "Payments team",
  createdAt: new Date("2026-09-14T18:01:00.000Z"),
  apiKey: "abc-123",
};

type TextFieldFunction = (
  key: keyof DetailItem,
  title: string,
  extra?: Partial<Field<DetailItem>>,
) => Field<DetailItem>;

const textField: TextFieldFunction = (
  key: keyof DetailItem,
  title: string,
  extra?: Partial<Field<DetailItem>>,
): Field<DetailItem> => {
  return {
    key: key,
    title: title,
    fieldType: FieldType.Text,
    ...extra,
  };
};

type RenderDetailFunction = (props: {
  style?: DetailStyle | undefined;
  fields?: Array<Field<DetailItem>> | undefined;
  columns?: number | undefined;
  item?: DetailItem | undefined;
  id?: string | undefined;
}) => HTMLElement;

const renderDetail: RenderDetailFunction = (props: {
  style?: DetailStyle | undefined;
  fields?: Array<Field<DetailItem>> | undefined;
  columns?: number | undefined;
  item?: DetailItem | undefined;
  id?: string | undefined;
}): HTMLElement => {
  const { container } = render(
    <Detail<DetailItem>
      id={props.id}
      item={props.item || ITEM}
      fields={
        props.fields || [
          textField("title", "Title"),
          textField("owner", "Owner"),
        ]
      }
      showDetailsInNumberOfColumns={
        props.columns === undefined ? 1 : props.columns
      }
      style={props.style}
    />,
  );

  return container.firstElementChild as HTMLElement;
};

type RowForFunction = (title: string) => HTMLElement;

// label text -> label element -> label block (div.space-y-1) -> row.
const rowFor: RowForFunction = (title: string): HTMLElement => {
  const label: HTMLElement = screen.getByText(title);
  const labelBlock: Element | null = label.closest("div.space-y-1");

  if (!labelBlock || !labelBlock.parentElement) {
    throw new Error(`No label block for "${title}"`);
  }

  return labelBlock.parentElement;
};

type ValueForFunction = (title: string) => string;

// The same walk the episode page tests use to read a field's value.
const valueFor: ValueForFunction = (title: string): string => {
  return rowFor(title).children[1]?.textContent || "";
};

afterEach(() => {
  cleanup();
});

describe("DetailStyle.Compact rows", () => {
  test("is a distinct, opt-in style", () => {
    expect(DetailStyle.Compact).toBe("compact");
    expect(Object.values(DetailStyle)).toEqual([
      "default",
      "card",
      "minimal",
      "compact",
    ]);
  });

  test("renders a small grey label over a dark value", () => {
    renderDetail({ style: DetailStyle.Compact });

    const label: HTMLElement = screen.getByText("Title")
      .parentElement as HTMLElement;

    expect(label.tagName).toBe("LABEL");
    expect(label).toHaveClass("text-xs", "font-medium", "text-gray-500");
    expect(label).not.toHaveClass("uppercase");

    const valueWrapper: HTMLElement = rowFor("Title")
      .children[1] as HTMLElement;
    expect(valueWrapper).toHaveClass("mt-1", "text-sm", "text-gray-900");
    expect(valueWrapper).not.toHaveClass("mt-3");
  });

  test("keeps the label block first and the value second in each row", () => {
    renderDetail({ style: DetailStyle.Compact });

    const row: HTMLElement = rowFor("Owner");

    expect(row.children).toHaveLength(2);
    expect(row.children[0]).toHaveClass("space-y-1");
    expect(row.children[0]).toContainElement(screen.getByText("Owner"));
    expect(valueFor("Owner")).toBe("Payments team");
    expect(valueFor("Title")).toBe("Checkout latency");
  });

  test("uses compact row spacing without the default hover chrome", () => {
    renderDetail({ style: DetailStyle.Compact });

    const row: HTMLElement = rowFor("Title");

    expect(row).toHaveClass("py-3", "min-w-0");
    expect(row).not.toHaveClass("py-5");
    expect(row.className).not.toContain("hover:");
    expect(row.className).not.toContain("border-b");
  });

  test("lets the grid size rows instead of an inline width", () => {
    renderDetail({ style: DetailStyle.Compact, columns: 2 });

    expect(rowFor("Title")).not.toHaveAttribute("style");
  });

  test("renders fields in declaration order", () => {
    const grid: HTMLElement = renderDetail({
      style: DetailStyle.Compact,
      fields: [
        textField("owner", "Owner"),
        textField("title", "Title"),
        textField("apiKey", "API key"),
      ],
    });

    const titles: Array<string> = Array.from(
      grid.querySelectorAll("label"),
    ).map((label: HTMLLabelElement) => {
      return label.textContent || "";
    });

    expect(titles).toEqual(["Owner", "Title", "API key"]);
  });
});

describe("DetailStyle.Compact container", () => {
  test("draws hairline dividers between rows in a single column", () => {
    const grid: HTMLElement = renderDetail({ style: DetailStyle.Compact });

    expect(grid).toHaveClass(
      "grid",
      "grid-cols-1",
      "sm:grid-cols-1",
      "divide-y",
      "divide-gray-100",
    );
    expect(grid).not.toHaveClass("sm:divide-y-0");
  });

  test("keeps the first and last rows flush with the card body", () => {
    renderDetail({ style: DetailStyle.Compact });

    expect(rowFor("Title").className).toContain("first:pt-0");
    expect(rowFor("Title").className).toContain("last:pb-0");
  });

  test("respects the column count and separates columns with whitespace", () => {
    const grid: HTMLElement = renderDetail({
      style: DetailStyle.Compact,
      columns: 2,
    });

    expect(grid).toHaveClass(
      "grid-cols-1",
      "sm:grid-cols-2",
      "divide-y",
      "sm:divide-y-0",
      "sm:gap-x-6",
    );
    // Cells sharing a row must line up, so no first/last padding trims.
    expect(rowFor("Title").className).not.toContain("first:pt-0");
    expect(rowFor("Owner").className).not.toContain("last:pb-0");
  });

  test("defaults to a single column when no column count is given", () => {
    const { container } = render(
      <Detail<DetailItem>
        item={ITEM}
        fields={[textField("title", "Title")]}
        style={DetailStyle.Compact}
      />,
    );

    expect(container.firstElementChild).toHaveClass(
      "sm:grid-cols-1",
      "divide-y",
    );
  });

  test("still honours colSpan on a field", () => {
    renderDetail({
      style: DetailStyle.Compact,
      columns: 2,
      fields: [
        textField("title", "Title", { colSpan: 2 }),
        textField("owner", "Owner"),
      ],
    });

    expect(rowFor("Title")).toHaveClass("sm:col-span-2");
    expect(rowFor("Owner")).toHaveClass("sm:col-span-1");
  });
});

describe("DetailStyle.Compact values", () => {
  test("shows the field placeholder for an empty value", () => {
    renderDetail({
      style: DetailStyle.Compact,
      fields: [textField("notes", "Notes", { placeholder: "No notes" })],
    });

    expect(valueFor("Notes")).toBe("No notes");
  });

  test("renders a getElement value", () => {
    renderDetail({
      style: DetailStyle.Compact,
      fields: [
        textField("owner", "Owner", {
          getElement: (item: DetailItem): ReactElement => {
            return <a href="/teams/payments">{item.owner} (link)</a>;
          },
        }),
      ],
    });

    expect(
      screen.getByRole("link", { name: "Payments team (link)" }),
    ).toBeInTheDocument();
    expect(valueFor("Owner")).toBe("Payments team (link)");
  });

  test("keeps field-type rendering such as date-times", () => {
    renderDetail({
      style: DetailStyle.Compact,
      fields: [
        {
          key: "createdAt",
          title: "Declared at",
          fieldType: FieldType.DateTime,
        },
      ],
    });

    const row: HTMLElement = rowFor("Declared at");

    expect(row.querySelector("svg")).not.toBeNull();
    expect(valueFor("Declared at")).not.toBe("");
    expect(valueFor("Declared at")).not.toBe("-");
  });

  test("keeps the copy affordance for copyable fields", () => {
    renderDetail({
      style: DetailStyle.Compact,
      fields: [textField("apiKey", "API key", { opts: { isCopyable: true } })],
    });

    const valueWrapper: HTMLElement = rowFor("API key")
      .children[1] as HTMLElement;

    expect(valueWrapper.querySelector(".group\\/copyable")).not.toBeNull();
    expect(valueWrapper).toHaveTextContent("abc-123");
  });

  test("hides fields whose showIf is false and skips key-less fields", () => {
    const grid: HTMLElement = renderDetail({
      style: DetailStyle.Compact,
      fields: [
        textField("title", "Title"),
        textField("owner", "Owner", {
          showIf: () => {
            return false;
          },
        }),
        { key: null, title: "No key" },
      ],
    });

    expect(screen.queryByText("Owner")).not.toBeInTheDocument();
    expect(screen.queryByText("No key")).not.toBeInTheDocument();
    expect(grid.children).toHaveLength(1);
  });

  test("renders a description without nesting blocks inside a paragraph", () => {
    const grid: HTMLElement = renderDetail({
      style: DetailStyle.Compact,
      fields: [
        textField("owner", "Owner", {
          description: (
            <div data-testid="rich-description">Team that owns it</div>
          ),
        }),
      ],
    });

    const description: HTMLElement = screen.getByTestId("rich-description");

    expect(description).toHaveTextContent("Team that owns it");
    expect(description.closest("p")).toBeNull();
    expect(grid.querySelector("p div")).toBeNull();
    // The description belongs to the label block, not the value.
    expect(rowFor("Owner").children[0]).toContainElement(description);
    expect(valueFor("Owner")).toBe("Payments team");
  });

  test("renders a string description next to the label", () => {
    renderDetail({
      style: DetailStyle.Compact,
      fields: [textField("owner", "Owner", { description: "Who gets paged" })],
    });

    const description: HTMLElement = screen.getByText("Who gets paged");

    expect(description).toHaveClass("text-xs", "text-gray-400");
    expect(rowFor("Owner").children[0]).toContainElement(description);
  });

  test("renders a field side link inside the label", () => {
    renderDetail({
      style: DetailStyle.Compact,
      fields: [
        textField("owner", "Owner", {
          sideLink: {
            text: "View team",
            url: new Route("/dashboard/teams"),
          },
        }),
      ],
    });

    const label: HTMLElement = screen.getByText("Owner")
      .parentElement as HTMLElement;

    expect(label).toContainElement(screen.getByText("View team"));
  });
});

describe("Other detail styles are unchanged", () => {
  test("default style keeps its roomy rows, uppercase labels and inline widths", () => {
    const grid: HTMLElement = renderDetail({ columns: 1 });

    expect(grid.className).toBe("grid grid-cols-1 gap-0 sm:grid-cols-1 w-full");

    const row: HTMLElement = rowFor("Title");
    expect(row).toHaveClass("py-5", "border-b", "border-gray-100");
    expect(row).toHaveAttribute("style", "width: 100%;");
    expect(row.children[1]).toHaveClass("mt-3", "text-gray-700");

    const label: HTMLElement = screen
      .getByText("Title")
      .closest("label") as HTMLElement;
    expect(label).toHaveClass("uppercase", "tracking-widest");
  });

  test("an explicit Default style renders the same markup as no style", () => {
    const { container: implicit } = render(
      <Detail<DetailItem>
        id="detail"
        item={ITEM}
        fields={[textField("title", "Title"), textField("owner", "Owner")]}
        showDetailsInNumberOfColumns={2}
      />,
    );
    const implicitHtml: string = implicit.innerHTML;
    cleanup();

    const { container: explicit } = render(
      <Detail<DetailItem>
        id="detail"
        item={ITEM}
        fields={[textField("title", "Title"), textField("owner", "Owner")]}
        showDetailsInNumberOfColumns={2}
        style={DetailStyle.Default}
      />,
    );

    expect(explicit.innerHTML).toBe(implicitHtml);
    expect(explicit.innerHTML).not.toContain("divide-y");
  });

  test("card style keeps its bordered cells and gap", () => {
    const grid: HTMLElement = renderDetail({ style: DetailStyle.Card });

    expect(grid).toHaveClass("gap-4");
    expect(grid).not.toHaveClass("divide-y");
    expect(rowFor("Title")).toHaveClass("rounded-xl", "border", "p-4");
  });

  test("minimal style keeps its rows", () => {
    const grid: HTMLElement = renderDetail({ style: DetailStyle.Minimal });

    expect(grid).toHaveClass("gap-0");
    expect(grid).not.toHaveClass("divide-y");
    expect(rowFor("Title")).toHaveClass("py-3", "border-b", "border-gray-50");
  });

  test("the label-to-value walk works for the default style too", () => {
    renderDetail({});

    expect(valueFor("Title")).toBe("Checkout latency");
  });
});

describe("ModelDetail and CardModelDetail forward the style", () => {
  beforeEach(() => {
    getItemMock.mockReset();

    const probe: Probe = new Probe(PROBE_ID);
    probe.name = "US East probe";
    probe.description = "Runs checks from Virginia";

    getItemMock.mockImplementation(() => {
      return Promise.resolve(probe);
    });
  });

  test("ModelDetail renders compact rows when asked", async () => {
    render(
      <ModelDetail<Probe>
        modelType={Probe}
        id="probe-detail"
        modelId={PROBE_ID}
        style={DetailStyle.Compact}
        showDetailsInNumberOfColumns={1}
        fields={[
          { field: { name: true }, title: "Name" },
          { field: { description: true }, title: "Description" },
        ]}
      />,
    );

    await screen.findByText("US East probe", {}, { timeout: WAIT_TIMEOUT });

    expect(rowFor("Name")).toHaveClass("py-3");
    expect(rowFor("Name").parentElement).toHaveClass("divide-y");
    expect(valueFor("Description")).toBe("Runs checks from Virginia");
  });

  test("ModelDetail keeps the default layout without a style", async () => {
    render(
      <ModelDetail<Probe>
        modelType={Probe}
        id="probe-detail"
        modelId={PROBE_ID}
        showDetailsInNumberOfColumns={1}
        fields={[{ field: { name: true }, title: "Name" }]}
      />,
    );

    await screen.findByText("US East probe", {}, { timeout: WAIT_TIMEOUT });

    expect(rowFor("Name")).toHaveClass("py-5");
    expect(rowFor("Name").parentElement).not.toHaveClass("divide-y");
  });

  test("CardModelDetail passes modelDetailProps.style through", async () => {
    render(
      <CardModelDetail<Probe>
        name="Probe Details"
        cardProps={{
          title: "Probe Details",
          description: "Here are more details for this probe.",
        }}
        isEditable={false}
        modelDetailProps={{
          modelType: Probe,
          id: "probe-card-detail",
          modelId: PROBE_ID,
          style: DetailStyle.Compact,
          showDetailsInNumberOfColumns: 1,
          fields: [{ field: { name: true }, title: "Name" }],
        }}
      />,
    );

    await waitFor(
      () => {
        expect(screen.getByText("US East probe")).toBeInTheDocument();
      },
      { timeout: WAIT_TIMEOUT },
    );

    expect(rowFor("Name")).toHaveClass("py-3");
    expect(rowFor("Name").parentElement).toHaveClass(
      "divide-y",
      "divide-gray-100",
    );
    expect(valueFor("Name")).toBe("US East probe");
  });
});
