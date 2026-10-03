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
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import Permission, { UserPermission } from "../../../../Types/Permission";

const getItemMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * compiled requires, so the mock consts are still unassigned when the
 * factories run. Dereferencing them lazily, at call time, is what works.
 */
jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
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

jest.mock("../../../../UI/Utils/Permission", () => {
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

jest.mock("../../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: () => {
        return false;
      },
    },
  };
});

import Detail, { DetailStyle } from "../../../../UI/Components/Detail/Detail";
import Field from "../../../../UI/Components/Detail/Field";
import FieldType from "../../../../UI/Components/Types/FieldType";
import ModelDetail from "../../../../UI/Components/ModelDetail/ModelDetail";
import CardModelDetail from "../../../../UI/Components/ModelDetail/CardModelDetail";
import Probe from "../../../../Models/DatabaseModels/Probe";
import ObjectID from "../../../../Types/ObjectID";

/*
 * "Raw IDs move out of the main detail grids into a small copy line."
 *
 * Some thirty-five details cards led with the record's own ID: a full-width
 * UUID pill, usually the first field. Detail now takes a FieldType.ObjectID
 * field on `_id` out of the grid and puts it on one small line under the
 * other fields - pages declare it exactly as before. These hold that, every
 * way out of it (showIdAsField, other IDs, the page's own getElement), and
 * that nothing else about the grid moved.
 */

const WAIT_TIMEOUT: number = 20000;

const RECORD_ID: string = "3f2a8b1c-9d4e-4b7a-a1c2-7e5f6d8c9b0a";
const PROJECT_ID: string = "6c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
const PROBE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");

interface Item {
  _id?: string | ObjectID | undefined;
  name?: string | undefined;
  description?: string | undefined;
  projectId?: string | undefined;
}

const ITEM: Item = {
  _id: RECORD_ID,
  name: "Checkout API",
  description: "Takes the money",
  projectId: PROJECT_ID,
};

const ID_FIELD: Field<Item> = {
  key: "_id",
  title: "Status Page ID",
  fieldType: FieldType.ObjectID,
};

const NAME_FIELD: Field<Item> = { key: "name", title: "Name" };

const DESCRIPTION_FIELD: Field<Item> = {
  key: "description",
  title: "Description",
};

type WriteTextMock = ReturnType<
  typeof jest.fn<(text: string) => Promise<void>>
>;

let writeText: WriteTextMock;

beforeEach(() => {
  writeText = jest.fn<(text: string) => Promise<void>>(
    async (): Promise<void> => {},
  );
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
});

function renderDetail(props: {
  fields: Array<Field<Item>>;
  item?: Item | undefined;
  style?: DetailStyle | undefined;
  columns?: number | undefined;
  id?: string | undefined;
}): HTMLElement {
  const { container } = render(
    <Detail<Item>
      id={props.id === undefined ? "status-page-detail" : props.id}
      item={props.item || ITEM}
      fields={props.fields}
      showDetailsInNumberOfColumns={props.columns}
      style={props.style}
    />,
  );

  return container.firstElementChild as HTMLElement;
}

// The grid's rows, by their label.
function rowTitles(grid: HTMLElement): Array<string> {
  return Array.from(grid.children).map((row: Element): string => {
    return (row.querySelector("label")?.textContent || "").trim();
  });
}

describe("the record's own ID leaves the grid", () => {
  test("is drawn on the ID line under the fields, not as the first field", () => {
    const detail: HTMLElement = renderDetail({
      fields: [ID_FIELD, NAME_FIELD, DESCRIPTION_FIELD],
      columns: 2,
    });

    const grid: HTMLElement = detail.firstElementChild as HTMLElement;
    const line: HTMLElement = screen.getByTestId("detail-id-line");

    expect(grid).toHaveClass("grid", "sm:grid-cols-2");
    expect(rowTitles(grid)).toEqual(["Name", "Description"]);
    // The field's title is not drawn anywhere: the line says "ID".
    expect(screen.queryByText("Status Page ID")).toBeNull();
    expect(grid.nextElementSibling).toBe(line);
    expect(within(line).getByTestId("detail-id-value").textContent).toBe(
      RECORD_ID,
    );
    expect(grid).not.toHaveTextContent(RECORD_ID);
  });

  test("keeps the other fields in the order the page declared them", () => {
    const detail: HTMLElement = renderDetail({
      fields: [NAME_FIELD, ID_FIELD, DESCRIPTION_FIELD],
    });

    expect(rowTitles(detail.firstElementChild as HTMLElement)).toEqual([
      "Name",
      "Description",
    ]);
  });

  test("puts the detail's id on the element that holds the fields and the line", () => {
    const { container } = render(
      <Detail<Item>
        id="status-page-detail"
        item={ITEM}
        fields={[ID_FIELD, NAME_FIELD]}
      />,
    );

    const holders: NodeListOf<Element> = container.querySelectorAll(
      '[id="status-page-detail"]',
    );

    expect(holders).toHaveLength(1);
    expect(holders[0]).toContainElement(screen.getByTestId("detail-id-line"));
    expect(holders[0]).toContainElement(screen.getByText("Checkout API"));
    expect(holders[0]).toHaveClass("w-full");
    // The grid inside is not named a second time.
    expect(holders[0]!.firstElementChild).not.toHaveAttribute("id");
  });

  test("copies the whole ID from the line", async () => {
    renderDetail({ fields: [ID_FIELD, NAME_FIELD] });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Copy ID to clipboard" }),
      );
    });

    expect(writeText).toHaveBeenCalledWith(RECORD_ID);
  });

  test("reads an ObjectID on the item as well as a string", () => {
    renderDetail({
      fields: [ID_FIELD, NAME_FIELD],
      item: { ...ITEM, _id: new ObjectID(RECORD_ID) },
    });

    expect(screen.getByTestId("detail-id-value").textContent).toBe(RECORD_ID);
  });

  test("a card that only has the ID is just the line, with no divider above it", () => {
    const detail: HTMLElement = renderDetail({ fields: [ID_FIELD] });
    const line: HTMLElement = screen.getByTestId("detail-id-line");

    expect(detail.children).toHaveLength(1);
    expect(detail.firstElementChild).toBe(line);
    expect(line).not.toHaveClass("border-t");
    expect(line).not.toHaveClass("mt-4");
  });

  test("an ID declared twice is still one line", () => {
    renderDetail({
      fields: [ID_FIELD, NAME_FIELD, { ...ID_FIELD, title: "ID again" }],
    });

    expect(screen.getAllByTestId("detail-id-line")).toHaveLength(1);
    expect(screen.queryByText("ID again")).toBeNull();
  });
});

describe("the line sits in each style's rhythm", () => {
  test("compact: a hairline and the rows' own 12px either side", () => {
    renderDetail({
      fields: [NAME_FIELD, ID_FIELD],
      style: DetailStyle.Compact,
      columns: 1,
    });

    expect(screen.getByTestId("detail-id-line")).toHaveClass(
      "mt-3",
      "border-t",
      "border-gray-100",
      "pt-3",
    );
  });

  test.each([
    ["default", undefined],
    ["an explicit default", DetailStyle.Default],
    ["card", DetailStyle.Card],
    ["minimal", DetailStyle.Minimal],
  ])(
    "%s: a hairline under the fields",
    (_name: string, style?: DetailStyle) => {
      const detail: HTMLElement = renderDetail({
        fields: [NAME_FIELD, ID_FIELD],
        style,
      });

      const line: HTMLElement = screen.getByTestId("detail-id-line");

      expect(line).toHaveClass("mt-4", "border-t", "border-gray-100", "pt-3");
      expect(detail.lastElementChild).toBe(line);
    },
  );

  test("the grid keeps exactly the classes it had", () => {
    const withLine: HTMLElement = renderDetail({
      fields: [NAME_FIELD, DESCRIPTION_FIELD, ID_FIELD],
      style: DetailStyle.Compact,
      columns: 1,
    });
    const gridWithLine: string = (withLine.firstElementChild as HTMLElement)
      .className;
    cleanup();

    const withoutLine: HTMLElement = renderDetail({
      fields: [NAME_FIELD, DESCRIPTION_FIELD],
      style: DetailStyle.Compact,
      columns: 1,
    });

    expect(gridWithLine).toBe(withoutLine.className);
  });
});

describe("no line", () => {
  test("a detail without the record's ID renders exactly as before", () => {
    const grid: HTMLElement = renderDetail({
      fields: [NAME_FIELD, DESCRIPTION_FIELD],
    });

    expect(grid).toHaveAttribute("id", "status-page-detail");
    expect(grid.className).toBe("grid grid-cols-1 gap-0 sm:grid-cols-1 w-full");
    expect(screen.queryByTestId("detail-id-line")).toBeNull();
  });

  test("an item without an ID draws no line and no empty row", () => {
    const grid: HTMLElement = renderDetail({
      fields: [ID_FIELD, NAME_FIELD],
      item: { name: "Unsaved" },
    });

    expect(screen.queryByTestId("detail-id-line")).toBeNull();
    expect(screen.queryByText("Status Page ID")).toBeNull();
    expect(rowTitles(grid)).toEqual(["Name"]);
    expect(grid).toHaveAttribute("id", "status-page-detail");
  });

  test("an ID field the page hides with showIf draws no line", () => {
    renderDetail({
      fields: [
        {
          ...ID_FIELD,
          showIf: (): boolean => {
            return false;
          },
        },
        NAME_FIELD,
      ],
    });

    expect(screen.queryByTestId("detail-id-line")).toBeNull();
  });

  test("an ID field hidden on a phone draws no line on a phone", async () => {
    const originalWidth: number = window.innerWidth;

    try {
      Object.defineProperty(window, "innerWidth", {
        value: 390,
        configurable: true,
        writable: true,
      });

      renderDetail({
        fields: [{ ...ID_FIELD, hideOnMobile: true }, NAME_FIELD],
      });

      await waitFor(() => {
        expect(screen.queryByTestId("detail-id-line")).toBeNull();
      });
    } finally {
      Object.defineProperty(window, "innerWidth", {
        value: originalWidth,
        configurable: true,
        writable: true,
      });
    }
  });
});

describe("IDs that stay fields", () => {
  test("showIdAsField keeps the record's ID as a field, in its pill", async () => {
    const grid: HTMLElement = renderDetail({
      fields: [
        { ...ID_FIELD, title: "Project ID", showIdAsField: true },
        NAME_FIELD,
      ],
    });

    expect(screen.queryByTestId("detail-id-line")).toBeNull();
    expect(rowTitles(grid)).toEqual(["Project ID", "Name"]);

    const pill: HTMLElement = within(grid).getByRole("button", {
      name: RECORD_ID,
    });

    await act(async () => {
      fireEvent.click(pill);
    });

    expect(writeText).toHaveBeenCalledWith(RECORD_ID);
  });

  test("a related record's ID stays a field", () => {
    const grid: HTMLElement = renderDetail({
      fields: [
        NAME_FIELD,
        {
          key: "projectId",
          title: "Project ID",
          fieldType: FieldType.ObjectID,
        },
      ],
    });

    expect(screen.queryByTestId("detail-id-line")).toBeNull();
    expect(rowTitles(grid)).toEqual(["Name", "Project ID"]);
    expect(grid).toHaveTextContent(PROJECT_ID);
  });

  test("an _id the page draws itself stays where the page put it", () => {
    const grid: HTMLElement = renderDetail({
      fields: [
        {
          ...ID_FIELD,
          title: "Open",
          getElement: (item: Item): ReactElement => {
            return <a href={`/status-pages/${String(item._id)}`}>Open it</a>;
          },
        },
        NAME_FIELD,
      ],
    });

    expect(screen.queryByTestId("detail-id-line")).toBeNull();
    expect(rowTitles(grid)).toEqual(["Open", "Name"]);
    expect(screen.getByRole("link", { name: "Open it" })).toHaveAttribute(
      "href",
      `/status-pages/${RECORD_ID}`,
    );
  });

  test("with the record's ID on the line, another ID in the grid is left alone", () => {
    const detail: HTMLElement = renderDetail({
      fields: [
        ID_FIELD,
        NAME_FIELD,
        {
          key: "projectId",
          title: "Project ID",
          fieldType: FieldType.ObjectID,
        },
      ],
    });

    expect(rowTitles(detail.firstElementChild as HTMLElement)).toEqual([
      "Name",
      "Project ID",
    ]);
    expect(screen.getByTestId("detail-id-value").textContent).toBe(RECORD_ID);
  });
});

describe("a copyable ID field", () => {
  /*
   * The API key page marks its Project ID copyable. The pill copies on its
   * own, and the hover button the flag added was handed the rendered pill
   * instead of the ID: it copied "[object Object]".
   */
  test("has one copy control, and it copies the ID", async () => {
    const grid: HTMLElement = renderDetail({
      fields: [
        NAME_FIELD,
        {
          key: "projectId",
          title: "Project ID",
          fieldType: FieldType.ObjectID,
          opts: { isCopyable: true },
        },
      ],
    });

    expect(within(grid).queryByTestId("copy-to-clipboard-icon")).toBeNull();
    expect(within(grid).getAllByRole("button")).toHaveLength(1);

    await act(async () => {
      fireEvent.click(within(grid).getByRole("button", { name: PROJECT_ID }));
    });

    expect(writeText).toHaveBeenCalledWith(PROJECT_ID);
    expect(writeText).not.toHaveBeenCalledWith("[object Object]");
  });

  test("a copyable text field keeps its copy button", async () => {
    const grid: HTMLElement = renderDetail({
      fields: [{ ...NAME_FIELD, opts: { isCopyable: true } }],
    });

    const copy: HTMLElement = within(grid).getByRole("button", {
      name: "Copy to clipboard",
    });

    await act(async () => {
      fireEvent.click(copy);
    });

    expect(writeText).toHaveBeenCalledWith("Checkout API");
  });
});

describe("ModelDetail and CardModelDetail", () => {
  beforeEach(() => {
    getItemMock.mockReset();

    const probe: Probe = new Probe(PROBE_ID);
    probe.name = "US East probe";
    probe.description = "Runs checks from Virginia";

    getItemMock.mockImplementation(() => {
      return Promise.resolve(probe);
    });
  });

  test("ModelDetail draws a page's ID field on the line", async () => {
    render(
      <ModelDetail<Probe>
        modelType={Probe}
        id="probe-detail"
        modelId={PROBE_ID}
        showDetailsInNumberOfColumns={2}
        fields={[
          {
            field: { _id: true },
            title: "Probe ID",
            fieldType: FieldType.ObjectID,
          },
          { field: { name: true }, title: "Name" },
          { field: { description: true }, title: "Description" },
        ]}
      />,
    );

    await screen.findByText("US East probe", {}, { timeout: WAIT_TIMEOUT });

    const line: HTMLElement = screen.getByTestId("detail-id-line");

    expect(within(line).getByTestId("detail-id-value").textContent).toBe(
      PROBE_ID.toString(),
    );
    expect(screen.queryByText("Probe ID")).toBeNull();
    expect(line.parentElement).toHaveAttribute("id", "probe-detail");

    // It still asks for the ID, as it always did.
    const request: { select: Record<string, unknown> } = getItemMock.mock
      .calls[0]![0] as { select: Record<string, unknown> };
    expect(request.select["_id"]).toBe(true);
  });

  test("CardModelDetail ends its card with the line", async () => {
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
          fields: [
            {
              field: { _id: true },
              title: "Probe ID",
              fieldType: FieldType.ObjectID,
            },
            { field: { name: true }, title: "Name" },
          ],
        }}
      />,
    );

    await waitFor(
      () => {
        expect(screen.getByText("US East probe")).toBeInTheDocument();
      },
      { timeout: WAIT_TIMEOUT },
    );

    const detail: HTMLElement = document.getElementById(
      "probe-card-detail",
    ) as HTMLElement;
    const line: HTMLElement = screen.getByTestId("detail-id-line");

    expect(detail.lastElementChild).toBe(line);
    expect(line).toHaveClass("mt-3", "border-t", "pt-3");
    expect(screen.queryByText("Probe ID")).toBeNull();
  });

  test("a card that keeps the ID as a field shows the pill and no line", async () => {
    render(
      <ModelDetail<Probe>
        modelType={Probe}
        id="probe-detail"
        modelId={PROBE_ID}
        fields={[
          {
            field: { _id: true },
            title: "Probe ID",
            fieldType: FieldType.ObjectID,
            showIdAsField: true,
          },
          { field: { name: true }, title: "Name" },
        ]}
      />,
    );

    await screen.findByText("US East probe", {}, { timeout: WAIT_TIMEOUT });

    expect(screen.getByText("Probe ID")).toBeInTheDocument();
    expect(screen.queryByTestId("detail-id-line")).toBeNull();
    expect(
      screen.getByRole("button", { name: PROBE_ID.toString() }),
    ).toBeInTheDocument();
  });
});
