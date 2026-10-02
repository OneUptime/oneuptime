import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * "This doesn't have a colour, just like the incident severity on top. Can
 * you please add colours to incident state as well?"
 *
 * The incident template form listed its Initial Incident State as plain
 * names, under an Incident Severity with a red dot. Both are entity
 * dropdowns, and ModelForm fetches every entity dropdown's model with its
 * colour column - but the state field also fetched its list itself, to sort
 * the states in the order an incident moves through them, selecting only a
 * name and an id. That second list replaced the first, colours and all.
 *
 * These tests drive the real ModelForm, BasicForm and EntityDropdown against
 * the real IncidentTemplate and IncidentState models and pin both ends of
 * the fix:
 *
 *   - a dropdown can ask ModelForm for its order (dropdownModal.sort), so a
 *     state field needs no list of its own: it gets order AND colour;
 *   - a field that still fetches its own list keeps the colours the form
 *     already knew, whatever that list selected.
 */

let permissionsForTest: Array<unknown> = [];

jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: permissionsForTest };
      },
    },
  };
});

jest.mock("../../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
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
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

interface ListRequest {
  tableName: string;
  select: Record<string, unknown>;
  sort: Record<string, unknown>;
  limit: number;
}

let listRequests: Array<ListRequest> = [];

/*
 * What each list request answers: the rows the form's own fetch gets, and
 * - for EntityDropdown's search as the menu opens (it asks for 50 at a time)
 * - the same rows WITHOUT their colours, so a dot on screen can only have
 * come from the options the form handed the dropdown.
 */
let rowsForForm: Array<unknown> = [];
let rowsForSearch: Array<unknown> = [];

jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<null> => {
        return null;
      },
      getList: async (data: {
        modelType: { new (): { tableName: string | null } };
        select: Record<string, unknown>;
        sort: Record<string, unknown>;
        limit: number;
      }): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        listRequests.push({
          tableName: new data.modelType().tableName || "",
          select: data.select,
          sort: data.sort,
          limit: data.limit,
        });

        // Cross a task boundary, as a real request does.
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 0);
        });

        const rows: Array<unknown> =
          data.limit === 50 ? rowsForSearch : rowsForForm;

        return { data: rows, count: rows.length, skip: 0, limit: data.limit };
      },
      count: async (): Promise<number> => {
        return 0;
      },
      createOrUpdate: async (): Promise<null> => {
        return null;
      },
    },
  };
});

jest.mock("../../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (err: unknown): string => {
        return (err as { message?: string })?.message || "Server Error";
      },
    },
  };
});

import ModelForm, { FormType } from "../../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import Field from "../../../../UI/Components/Forms/Types/Field";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import { DropdownOption } from "../../../../UI/Components/Dropdown/Dropdown";
import IncidentState from "../../../../Models/DatabaseModels/IncidentState";
import IncidentTemplate from "../../../../Models/DatabaseModels/IncidentTemplate";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import Color from "../../../../Types/Color";
import Permission from "../../../../Types/Permission";
import PermissionGate from "../../../../UI/Utils/PermissionGate";

const IDENTIFIED_ID: string = "0193c0de-0000-4aaa-8bbb-000000000001";
const ACKNOWLEDGED_ID: string = "0193c0de-0000-4aaa-8bbb-000000000002";
const RESOLVED_ID: string = "0193c0de-0000-4aaa-8bbb-000000000003";

const RED: string = "#ef4444";
const AMBER: string = "#f59e0b";
const GREEN: string = "#10b981";

function state(
  id: string,
  name: string,
  order: number,
  color?: string | undefined,
): IncidentState {
  const row: IncidentState = new IncidentState();
  row._id = id;
  row.name = name;
  row.order = order;

  if (color) {
    row.color = new Color(color);
  }

  return row;
}

// The project's states in their order, as a sorted list request returns them.
function statesInOrder(withColors: boolean): Array<IncidentState> {
  return [
    state(IDENTIFIED_ID, "Identified", 1, withColors ? RED : undefined),
    state(ACKNOWLEDGED_ID, "Acknowledged", 2, withColors ? AMBER : undefined),
    state(RESOLVED_ID, "Resolved", 3, withColors ? GREEN : undefined),
  ];
}

const FIELD_TITLE: string = "Initial Incident State";

// The field is named by its label, which also says "(Optional)".
const FIELD_NAME: RegExp = /^Initial Incident State/;

function initialStateField(
  dropdownModal: NonNullable<Field<IncidentTemplate>["dropdownModal"]>,
  fetchDropdownOptions?: Field<IncidentTemplate>["fetchDropdownOptions"],
): Field<IncidentTemplate> {
  const field: Field<IncidentTemplate> = {
    field: { initialIncidentState: true },
    title: FIELD_TITLE,
    fieldType: FormFieldSchemaType.Dropdown,
    dropdownModal: dropdownModal,
    required: false,
    placeholder: "Initial State",
  };

  if (fetchDropdownOptions) {
    field.fetchDropdownOptions = fetchDropdownOptions;
  }

  return field;
}

const SORTED_BY_ORDER: NonNullable<
  Field<IncidentTemplate>["dropdownModal"]
> = {
  type: IncidentState,
  labelField: "name",
  valueField: "_id",
  sort: { order: SortOrder.Ascending },
};

const UNSORTED: NonNullable<Field<IncidentTemplate>["dropdownModal"]> = {
  type: IncidentState,
  labelField: "name",
  valueField: "_id",
};

async function renderForm(
  fields: Fields<IncidentTemplate>,
  initialValues?: Record<string, unknown> | undefined,
): Promise<void> {
  await act(async (): Promise<void> => {
    render(
      <ModelForm<IncidentTemplate>
        modelType={IncidentTemplate}
        name="Create Incident Template"
        id="create-incident-template-form"
        formType={FormType.Create}
        submitButtonText="Create"
        onSuccess={() => {}}
        fields={fields}
        initialValues={initialValues as never}
      />,
    );
  });

  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();
  });
}

function formRequestsFor(tableName: string): Array<ListRequest> {
  return listRequests.filter((request: ListRequest): boolean => {
    return request.tableName === tableName && request.limit !== 50;
  });
}

async function openMenu(): Promise<HTMLElement> {
  const input: HTMLElement = await screen.findByRole("combobox", {
    name: FIELD_NAME,
  });

  await act(async (): Promise<void> => {
    fireEvent.focus(input);
  });

  return screen.getByTestId("entity-dropdown-menu");
}

// Each option in the open menu: its name and the colour of its dot, if any.
function optionsIn(menu: HTMLElement): Array<[string, string | undefined]> {
  return within(menu)
    .getAllByRole("option")
    .map((option: HTMLElement): [string, string | undefined] => {
      const dot: HTMLElement | null = option.querySelector(
        'span[aria-hidden="true"][style]',
      );

      return [
        option.textContent?.trim() || "",
        dot ? toHex(dot.style.backgroundColor) : undefined,
      ];
    });
}

// jsdom reports inline colours as rgb(); the tests speak in hex.
function toHex(cssColor: string): string {
  const match: RegExpMatchArray | null = cssColor.match(
    /rgb\((\d+),\s*(\d+),\s*(\d+)\)/,
  );

  if (!match) {
    return cssColor;
  }

  return (
    "#" +
    [match[1], match[2], match[3]]
      .map((part: string | undefined): string => {
        return Number(part).toString(16).padStart(2, "0");
      })
      .join("")
  );
}

describe("a state dropdown in a ModelForm shows each state's colour", () => {
  beforeEach(() => {
    permissionsForTest = [Permission.ProjectOwner];
    PermissionGate.clearPermissionPropsCache();
    window.localStorage.clear();

    listRequests = [];
    rowsForForm = statesInOrder(true);
    rowsForSearch = statesInOrder(false);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("asks for the states in their order, with their colour column", async () => {
    await renderForm([initialStateField(SORTED_BY_ORDER)]);

    await waitFor(() => {
      expect(formRequestsFor("IncidentState")).toHaveLength(1);
    });

    const request: ListRequest = formRequestsFor("IncidentState")[0]!;

    expect(request.sort).toEqual({ order: SortOrder.Ascending });
    expect(request.select).toEqual(
      expect.objectContaining({
        name: true,
        _id: true,
        color: true,
        // A sorted column is selected too, or a joined list query fails.
        order: true,
      }),
    );
  });

  test("lists the states in that order, each with its colour", async () => {
    await renderForm([initialStateField(SORTED_BY_ORDER)]);

    const menu: HTMLElement = await openMenu();

    await waitFor(() => {
      expect(optionsIn(menu)).toEqual([
        ["Identified", RED],
        ["Acknowledged", AMBER],
        ["Resolved", GREEN],
      ]);
    });
  });

  test("the chosen state shows its colour while the menu is closed", async () => {
    await renderForm([initialStateField(SORTED_BY_ORDER)], {
      initialIncidentState: ACKNOWLEDGED_ID,
    });

    const chosen: HTMLElement = await screen.findByRole("button", {
      name: FIELD_NAME,
    });

    await waitFor(() => {
      const dot: HTMLElement | null = chosen.querySelector(
        'span[aria-hidden="true"][style]',
      );

      expect(dot).not.toBeNull();
      expect(toHex(dot!.style.backgroundColor)).toBe(AMBER);
    });
    expect(chosen).toHaveTextContent("Acknowledged");
  });

  test("a field that fetches its own list without colours still shows them, in its own order", async () => {
    /*
     * The form's own fetch is unsorted, so its list comes back newest first;
     * the field's list is sorted, and has names and ids only - the shape the
     * incident template form had.
     */
    rowsForForm = [...statesInOrder(true)].reverse();

    const fetchOwnList: () => Promise<Array<DropdownOption>> = async (): Promise<
      Array<DropdownOption>
    > => {
      return [
        { label: "Identified", value: IDENTIFIED_ID },
        { label: "Acknowledged", value: ACKNOWLEDGED_ID },
        { label: "Resolved", value: RESOLVED_ID },
      ];
    };

    await renderForm([initialStateField(UNSORTED, fetchOwnList)]);

    const menu: HTMLElement = await openMenu();

    await waitFor(() => {
      expect(optionsIn(menu)).toEqual([
        ["Identified", RED],
        ["Acknowledged", AMBER],
        ["Resolved", GREEN],
      ]);
    });
  });

  test("a field's own list that narrows the states keeps only those, coloured", async () => {
    const fetchOpenStates: () => Promise<
      Array<DropdownOption>
    > = async (): Promise<Array<DropdownOption>> => {
      return [
        { label: "Identified", value: IDENTIFIED_ID },
        { label: "Acknowledged", value: ACKNOWLEDGED_ID },
      ];
    };

    await renderForm([initialStateField(UNSORTED, fetchOpenStates)]);

    const menu: HTMLElement = await openMenu();

    await waitFor(() => {
      expect(optionsIn(menu)).toEqual([
        ["Identified", RED],
        ["Acknowledged", AMBER],
        // The form's search adds the rest after them, with no dot of its own.
        ["Resolved", undefined],
      ]);
    });
  });

  test("a dropdown with no sort keeps the server's default order", async () => {
    await renderForm([initialStateField(UNSORTED)]);

    await waitFor(() => {
      expect(formRequestsFor("IncidentState")).toHaveLength(1);
    });

    expect(formRequestsFor("IncidentState")[0]!.sort).toEqual({});
    expect(formRequestsFor("IncidentState")[0]!.select).toEqual(
      expect.objectContaining({ color: true }),
    );
    expect(formRequestsFor("IncidentState")[0]!.select).not.toHaveProperty(
      "order",
    );
  });
});

describe("ModelForm's dropdown cache knows a list's order", () => {
  beforeEach(() => {
    permissionsForTest = [Permission.ProjectOwner];
    PermissionGate.clearPermissionPropsCache();
    window.localStorage.clear();

    listRequests = [];
    rowsForForm = statesInOrder(true);
    rowsForSearch = statesInOrder(false);
  });

  afterEach(() => {
    cleanup();
  });

  // A page whose state field's order can be flipped, re-rendering the form.
  const Harness: React.FunctionComponent = (): React.ReactElement => {
    const [sortOrder, setSortOrder] = React.useState<SortOrder>(
      SortOrder.Ascending,
    );

    return (
      <>
        <button
          type="button"
          onClick={() => {
            setSortOrder(
              sortOrder === SortOrder.Ascending
                ? SortOrder.Descending
                : SortOrder.Ascending,
            );
          }}
        >
          Flip order
        </button>
        <ModelForm<IncidentTemplate>
          modelType={IncidentTemplate}
          name="Create Incident Template"
          id="create-incident-template-form"
          formType={FormType.Create}
          submitButtonText="Create"
          onSuccess={() => {}}
          fields={[
            initialStateField({
              ...SORTED_BY_ORDER,
              sort: { order: sortOrder },
            }),
          ]}
        />
      </>
    );
  };

  test("a list in another order is fetched again; the same order is not", async () => {
    await act(async (): Promise<void> => {
      render(<Harness />);
    });

    await waitFor(() => {
      expect(formRequestsFor("IncidentState")).toHaveLength(1);
    });

    await act(async (): Promise<void> => {
      screen.getByRole("button", { name: "Flip order" }).click();
    });

    await waitFor(() => {
      expect(formRequestsFor("IncidentState")).toHaveLength(2);
    });

    expect(formRequestsFor("IncidentState")[1]!.sort).toEqual({
      order: SortOrder.Descending,
    });

    // Back to the first order: that list is already known.
    await act(async (): Promise<void> => {
      screen.getByRole("button", { name: "Flip order" }).click();
    });

    await act(async (): Promise<void> => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 20);
      });
    });

    expect(formRequestsFor("IncidentState")).toHaveLength(2);
  });
});
