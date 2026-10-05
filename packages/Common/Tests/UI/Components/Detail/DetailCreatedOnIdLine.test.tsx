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
  cleanup,
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
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import Timezone from "../../../../Types/Timezone";

/*
 * "Can you also show created along the same lines as ID so it doesn't take
 * space up top. Please do this everywhere."
 *
 * A dozen details cards gave the record's creation time a row of its own -
 * on the monitor's Details card, a "Created" row with a clock above the
 * small ID line. Detail now takes a Date or DateTime field on createdAt (and
 * on updatedAt, where a card shows it) out of the grid and puts it on that
 * line, after the ID: "ID dafafe92… Created Sep 30 2026, 14:25 BST". Pages
 * declare the field as they always have. These hold that, every way out of
 * it, and that nothing else about the grid moved.
 */

const WAIT_TIMEOUT: number = 20000;

const RECORD_ID: string = "dafafe92-41c3-4f0e-9a8b-2c7d5e1f3a60";
const CREATED: Date = new Date("2026-09-30T13:25:13.000Z");
const UPDATED: Date = new Date("2026-10-01T08:12:47.000Z");
const PROBE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");

interface Item {
  _id?: string | undefined;
  name?: string | undefined;
  description?: string | undefined;
  monitorType?: string | undefined;
  startsAt?: Date | undefined;
  createdAt?: unknown;
  updatedAt?: unknown;
}

const MONITOR: Item = {
  _id: RECORD_ID,
  name: "oneuptime-test - Pod CPU Saturating Container Limit",
  description: "Alert when a pod is using more than 90% of its CPU limit.",
  monitorType: "Kubernetes",
  startsAt: new Date("2026-10-06T19:00:00.000Z"),
  createdAt: CREATED,
  updatedAt: UPDATED,
};

const NAME: Field<Item> = { key: "name", title: "Name" };
const DESCRIPTION: Field<Item> = { key: "description", title: "Description" };
const MONITOR_TYPE: Field<Item> = { key: "monitorType", title: "Monitor Type" };
const ID: Field<Item> = {
  key: "_id",
  title: "Monitor ID",
  fieldType: FieldType.ObjectID,
};
const CREATED_FIELD: Field<Item> = {
  key: "createdAt",
  title: "Created",
  fieldType: FieldType.DateTime,
};
const UPDATED_FIELD: Field<Item> = {
  key: "updatedAt",
  title: "Updated",
  fieldType: FieldType.DateTime,
};

let previousTimezone: Timezone | null = null;

beforeEach(() => {
  previousTimezone = OneUptimeDate.getUserTimezone();
  OneUptimeDate.setUserTimezone(Timezone.EuropeLondon);
  jest
    .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
    .mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  OneUptimeDate.setUserTimezone(previousTimezone);
  jest.restoreAllMocks();
});

function renderDetail(props: {
  fields: Array<Field<Item>>;
  item?: Item | undefined;
  style?: DetailStyle | undefined;
  columns?: number | undefined;
  showRecordLine?: boolean | undefined;
}): HTMLElement {
  const { container } = render(
    <Detail<Item>
      id="monitor-detail"
      item={props.item || MONITOR}
      fields={props.fields}
      showDetailsInNumberOfColumns={props.columns}
      style={props.style}
      showRecordLine={props.showRecordLine}
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

function recordLine(): HTMLElement {
  return screen.getByTestId("detail-record-line");
}

function pieces(): Array<string> {
  return Array.from(recordLine().children).map((child: Element): string => {
    return child.getAttribute("data-testid") || child.tagName;
  });
}

describe("Created leaves the grid for the ID line", () => {
  test("the monitor's Details card: no Created row, Created after the ID", () => {
    const detail: HTMLElement = renderDetail({
      fields: [NAME, DESCRIPTION, MONITOR_TYPE, CREATED_FIELD, ID],
      style: DetailStyle.Compact,
      columns: 1,
    });

    const grid: HTMLElement = detail.firstElementChild as HTMLElement;

    expect(rowTitles(grid)).toEqual(["Name", "Description", "Monitor Type"]);
    expect(grid.nextElementSibling).toBe(recordLine());
    expect(pieces()).toEqual(["detail-id-line", "detail-created-at"]);
    expect(
      within(recordLine()).getByTestId("detail-created-at-value"),
    ).toHaveTextContent("Sep 30 2026, 14:25 BST");
    // Nothing of it is left in the grid: no row, no clock, no date.
    expect(grid).not.toHaveTextContent("Created");
    expect(grid).not.toHaveTextContent("Sep 30 2026");
    expect(grid.querySelector("svg")).toBeNull();
  });

  test("whatever its title said, the line says Created", () => {
    renderDetail({
      fields: [NAME, { ...CREATED_FIELD, title: "Created At" }, ID],
    });

    expect(screen.queryByText("Created At")).toBeNull();
    expect(screen.getByTestId("detail-created-at-label")).toHaveTextContent(
      "Created",
    );
  });

  test("a license's 'Issued On', a date-only field on createdAt, goes too", () => {
    renderDetail({
      fields: [
        NAME,
        {
          key: "createdAt",
          title: "Issued On",
          fieldType: FieldType.Date,
          placeholder: "-",
        },
        ID,
      ],
    });

    expect(screen.queryByText("Issued On")).toBeNull();
    expect(screen.getByTestId("detail-created-at-value")).toHaveTextContent(
      "Sep 30 2026, 14:25 BST",
    );
  });

  test("declared first, as on the alert's card, it still follows the ID", () => {
    const detail: HTMLElement = renderDetail({
      fields: [{ ...CREATED_FIELD, title: "Created At" }, NAME, ID],
    });

    expect(rowTitles(detail.firstElementChild as HTMLElement)).toEqual([
      "Name",
    ]);
    expect(pieces()).toEqual(["detail-id-line", "detail-created-at"]);
  });

  test("Updated joins it, after Created", () => {
    const detail: HTMLElement = renderDetail({
      fields: [ID, NAME, DESCRIPTION, CREATED_FIELD, UPDATED_FIELD],
      columns: 2,
    });

    expect(rowTitles(detail.firstElementChild as HTMLElement)).toEqual([
      "Name",
      "Description",
    ]);
    expect(pieces()).toEqual([
      "detail-id-line",
      "detail-created-at",
      "detail-updated-at",
    ]);
    expect(screen.getByTestId("detail-updated-at-value")).toHaveTextContent(
      "Oct 01 2026, 09:12 BST",
    );
  });

  test("Updated declared before Created still comes after it", () => {
    renderDetail({ fields: [UPDATED_FIELD, NAME, CREATED_FIELD, ID] });

    expect(pieces()).toEqual([
      "detail-id-line",
      "detail-created-at",
      "detail-updated-at",
    ]);
  });

  test("other dates are the record's facts and stay rows", () => {
    const detail: HTMLElement = renderDetail({
      fields: [
        { key: "startsAt", title: "Starts At", fieldType: FieldType.DateTime },
        CREATED_FIELD,
        ID,
      ],
      style: DetailStyle.Compact,
      columns: 1,
    });

    const grid: HTMLElement = detail.firstElementChild as HTMLElement;

    expect(rowTitles(grid)).toEqual(["Starts At"]);
    expect(grid).toHaveTextContent("Oct 06 2026, 20:00 BST");
  });

  test("a time declared twice is said once", () => {
    renderDetail({
      fields: [CREATED_FIELD, NAME, { ...CREATED_FIELD, title: "Again" }, ID],
    });

    expect(screen.getAllByTestId("detail-created-at")).toHaveLength(1);
    expect(screen.queryByText("Again")).toBeNull();
  });

  test("the time is in the reader's own time zone", () => {
    OneUptimeDate.setUserTimezone(Timezone.AmericaNew_York);

    renderDetail({ fields: [NAME, CREATED_FIELD, ID] });

    expect(screen.getByTestId("detail-created-at-value")).toHaveTextContent(
      "Sep 30 2026, 09:25 EDT",
    );
  });

  test.each([
    ["an ISO string", "2026-09-30T13:25:13.000Z"],
    [
      "a JSON item's date",
      { _type: "DateTime", value: "2026-09-30T13:25:13.000Z" },
    ],
  ])("reads %s as well as a Date", (_name: string, createdAt: unknown) => {
    renderDetail({
      fields: [NAME, CREATED_FIELD, ID],
      item: { ...MONITOR, createdAt },
    });

    expect(screen.getByTestId("detail-created-at-value")).toHaveAttribute(
      "datetime",
      "2026-09-30T13:25:13.000Z",
    );
  });
});

describe("a card with Created but no ID", () => {
  test("gets a line with just Created, under the fields", () => {
    const detail: HTMLElement = renderDetail({
      fields: [NAME, DESCRIPTION, CREATED_FIELD],
      columns: 3,
    });

    expect(detail).toHaveAttribute("id", "monitor-detail");
    expect(detail).toHaveClass("w-full");
    expect(rowTitles(detail.firstElementChild as HTMLElement)).toEqual([
      "Name",
      "Description",
    ]);
    expect(pieces()).toEqual(["detail-created-at"]);
    expect(screen.queryByTestId("detail-id-line")).toBeNull();
    expect(detail.lastElementChild).toBe(recordLine());
  });

  test("whose only field is Created is just the line, with no divider above it", () => {
    const detail: HTMLElement = renderDetail({ fields: [CREATED_FIELD] });

    expect(detail.children).toHaveLength(1);
    expect(detail.firstElementChild).toBe(recordLine());
    expect(recordLine()).not.toHaveClass("border-t");
  });
});

describe("no time, no piece", () => {
  test("an item that holds no creation time draws no Created, and no empty row", () => {
    const detail: HTMLElement = renderDetail({
      fields: [NAME, { ...CREATED_FIELD, placeholder: "-" }, ID],
      item: { ...MONITOR, createdAt: undefined },
    });

    expect(rowTitles(detail.firstElementChild as HTMLElement)).toEqual([
      "Name",
    ]);
    expect(pieces()).toEqual(["detail-id-line"]);
    expect(screen.queryByText("Created")).toBeNull();
  });

  test("with no ID either, the detail is the grid, exactly as before", () => {
    const grid: HTMLElement = renderDetail({
      fields: [NAME, CREATED_FIELD],
      item: { ...MONITOR, _id: undefined, createdAt: null },
    });

    expect(grid).toHaveAttribute("id", "monitor-detail");
    expect(grid.className).toBe("grid grid-cols-1 gap-0 sm:grid-cols-1 w-full");
    expect(rowTitles(grid)).toEqual(["Name"]);
    expect(screen.queryByTestId("detail-record-line")).toBeNull();
  });

  test("a time that is no date draws nothing, never 'Invalid date'", () => {
    renderDetail({
      fields: [NAME, CREATED_FIELD, ID],
      item: { ...MONITOR, createdAt: "not a date" },
    });

    expect(screen.queryByTestId("detail-created-at")).toBeNull();
    expect(screen.queryByText(/invalid/i)).toBeNull();
  });

  test("a Created field the page hides with showIf is shown nowhere", () => {
    renderDetail({
      fields: [
        NAME,
        {
          ...CREATED_FIELD,
          showIf: (): boolean => {
            return false;
          },
        },
        ID,
      ],
    });

    expect(screen.queryByTestId("detail-created-at")).toBeNull();
  });

  test("a Created field hidden on a phone is not on a phone's line", async () => {
    const originalWidth: number = window.innerWidth;

    try {
      Object.defineProperty(window, "innerWidth", {
        value: 390,
        configurable: true,
        writable: true,
      });

      renderDetail({
        fields: [NAME, { ...CREATED_FIELD, hideOnMobile: true }, ID],
      });

      await waitFor(() => {
        expect(screen.queryByTestId("detail-created-at")).toBeNull();
      });
      expect(screen.getByTestId("detail-id-line")).toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "innerWidth", {
        value: originalWidth,
        configurable: true,
        writable: true,
      });
    }
  });
});

describe("times that stay fields", () => {
  test("a creation time the page draws itself stays where the page put it", () => {
    const detail: HTMLElement = renderDetail({
      fields: [
        NAME,
        {
          ...CREATED_FIELD,
          title: "Age",
          getElement: (): ReactElement => {
            return <span>3 days old</span>;
          },
        },
        ID,
      ],
    });

    expect(rowTitles(detail.firstElementChild as HTMLElement)).toEqual([
      "Name",
      "Age",
    ]);
    expect(screen.getByText("3 days old")).toBeInTheDocument();
    expect(pieces()).toEqual(["detail-id-line"]);
  });

  test("a createdAt typed as something else is the page's choice", () => {
    const detail: HTMLElement = renderDetail({
      fields: [
        NAME,
        { key: "createdAt", title: "Created", fieldType: FieldType.Text },
        ID,
      ],
      item: { ...MONITOR, createdAt: "the start of time" },
    });

    expect(rowTitles(detail.firstElementChild as HTMLElement)).toEqual([
      "Name",
      "Created",
    ]);
    expect(pieces()).toEqual(["detail-id-line"]);
  });

  test("a detail of values that are not a record's own keeps every field", () => {
    // A record's custom fields, which people name: one may be "createdAt".
    const grid: HTMLElement = renderDetail({
      fields: [
        { key: "createdAt", title: "createdAt", fieldType: FieldType.Date },
        { key: "_id", title: "_id", fieldType: FieldType.ObjectID },
        NAME,
      ],
      showRecordLine: false,
    });

    expect(grid).toHaveAttribute("id", "monitor-detail");
    expect(rowTitles(grid)).toEqual(["createdAt", "_id", "Name"]);
    expect(screen.queryByTestId("detail-record-line")).toBeNull();
    expect(screen.queryByTestId("detail-id-line")).toBeNull();
  });
});

describe("the line sits in each style's rhythm", () => {
  test("compact: one hairline and the rows' own 12px, over all of it", () => {
    renderDetail({
      fields: [NAME, CREATED_FIELD, ID],
      style: DetailStyle.Compact,
      columns: 1,
    });

    expect(recordLine()).toHaveClass(
      "mt-3",
      "border-t",
      "border-gray-100",
      "pt-3",
    );
    expect(screen.getByTestId("detail-id-line")).not.toHaveClass("border-t");
    expect(screen.getByTestId("detail-created-at")).not.toHaveClass("border-t");
  });

  test.each([
    ["default", undefined],
    ["card", DetailStyle.Card],
    ["minimal", DetailStyle.Minimal],
  ])(
    "%s: one hairline under the fields",
    (_name: string, style?: DetailStyle) => {
      const detail: HTMLElement = renderDetail({
        fields: [NAME, CREATED_FIELD, UPDATED_FIELD, ID],
        style,
      });

      expect(recordLine()).toHaveClass(
        "mt-4",
        "border-t",
        "border-gray-100",
        "pt-3",
      );
      expect(detail.lastElementChild).toBe(recordLine());
    },
  );
});

describe("ModelDetail and CardModelDetail", () => {
  beforeEach(() => {
    getItemMock.mockReset();

    const probe: Probe = new Probe(PROBE_ID);
    probe.name = "US East probe";
    probe.description = "Runs checks from Virginia";
    probe.createdAt = CREATED;
    probe.updatedAt = UPDATED;

    getItemMock.mockImplementation(() => {
      return Promise.resolve(probe);
    });
  });

  test("ModelDetail asks for the creation time and draws it on the line", async () => {
    render(
      <ModelDetail<Probe>
        modelType={Probe}
        id="probe-detail"
        modelId={PROBE_ID}
        fields={[
          { field: { name: true }, title: "Name" },
          {
            field: { createdAt: true },
            title: "Created At",
            fieldType: FieldType.DateTime,
          },
          {
            field: { _id: true },
            title: "Probe ID",
            fieldType: FieldType.ObjectID,
          },
        ]}
      />,
    );

    await screen.findByText("US East probe", {}, { timeout: WAIT_TIMEOUT });

    expect(pieces()).toEqual(["detail-id-line", "detail-created-at"]);
    expect(screen.getByTestId("detail-created-at-value")).toHaveTextContent(
      "Sep 30 2026, 14:25 BST",
    );
    expect(screen.queryByText("Created At")).toBeNull();
    expect(recordLine().parentElement).toHaveAttribute("id", "probe-detail");

    // It still asks for the column, as it always did.
    const request: { select: Record<string, unknown> } = getItemMock.mock
      .calls[0]![0] as { select: Record<string, unknown> };
    expect(request.select["createdAt"]).toBe(true);
  });

  test("CardModelDetail ends its card with ID, Created and Updated", async () => {
    render(
      <CardModelDetail<Probe>
        name="Probe Details"
        cardProps={{ title: "Probe Details" }}
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
            {
              field: { createdAt: true },
              title: "Created",
              fieldType: FieldType.DateTime,
            },
            {
              field: { updatedAt: true },
              title: "Updated",
              fieldType: FieldType.DateTime,
            },
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

    expect(detail.lastElementChild).toBe(recordLine());
    expect(pieces()).toEqual([
      "detail-id-line",
      "detail-created-at",
      "detail-updated-at",
    ]);
    expect(rowTitles(detail.firstElementChild as HTMLElement)).toEqual([
      "Name",
    ]);
  });
});
