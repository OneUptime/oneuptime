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
 * PICKERS LEAVE ARCHIVED VALUES OUT (Common/Utils/ArchivableValues,
 * ArchivedValuePicker), in every form ModelForm draws: the form's own list
 * of a state, severity, monitor status, label or incident role, and the
 * dropdown's search as it opens, ask for the values that are not archived.
 * A value the record being edited already has is still shown - read by its
 * id, archived or not - marked Archived, so it can be kept or changed.
 *
 * The real ModelForm, BasicForm and EntityDropdown, against the real
 * IncidentTemplate and IncidentState models; only the API is answered here.
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
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  limit: number;
}

let listRequests: Array<ListRequest> = [];
let liveRows: Array<unknown> = [];
let rowsById: Array<unknown> = [];

jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<null> => {
        return null;
      },
      getList: async (data: {
        modelType: { new (): { tableName: string | null } };
        query: Record<string, unknown>;
        select: Record<string, unknown>;
        limit: number;
      }): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        listRequests.push({
          tableName: new data.modelType().tableName || "",
          query: data.query,
          select: data.select,
          limit: data.limit,
        });

        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 0);
        });

        // A read of the values a record already has, by their ids.
        const rows: Array<unknown> =
          data.query && "_id" in data.query ? rowsById : liveRows;

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
import IncidentState from "../../../../Models/DatabaseModels/IncidentState";
import IncidentTemplate from "../../../../Models/DatabaseModels/IncidentTemplate";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import Permission from "../../../../Types/Permission";
import PermissionGate from "../../../../UI/Utils/PermissionGate";

const IDENTIFIED_ID: string = "0193c0de-0000-4aaa-8bbb-000000000001";
const RESOLVED_ID: string = "0193c0de-0000-4aaa-8bbb-000000000003";
const RETIRED_ID: string = "0193c0de-0000-4aaa-8bbb-000000000009";

function state(id: string, name: string, isArchived: boolean): IncidentState {
  const row: IncidentState = new IncidentState();
  row._id = id;
  row.name = name;
  row.isArchived = isArchived;
  return row;
}

const FIELD_NAME: RegExp = /^Initial Incident State/;

const initialStateField: Field<IncidentTemplate> = {
  field: { initialIncidentState: true },
  title: "Initial Incident State",
  fieldType: FormFieldSchemaType.Dropdown,
  dropdownModal: {
    type: IncidentState,
    labelField: "name",
    valueField: "_id",
    sort: { order: SortOrder.Ascending },
  },
  required: false,
  placeholder: "Initial State",
};

async function renderForm(
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
        fields={[initialStateField]}
        initialValues={initialValues as never}
      />,
    );
  });

  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();
  });
}

function stateListRequests(): Array<ListRequest> {
  return listRequests.filter((request: ListRequest): boolean => {
    return request.tableName === "IncidentState";
  });
}

describe("a value's dropdown in a ModelForm", () => {
  beforeEach(() => {
    permissionsForTest = [Permission.ProjectOwner];
    PermissionGate.clearPermissionPropsCache();
    listRequests = [];
    liveRows = [
      state(IDENTIFIED_ID, "Identified", false),
      state(RESOLVED_ID, "Resolved", false),
    ];
    rowsById = [];
  });

  afterEach(() => {
    cleanup();
  });

  test("the form lists the values that are not archived", async () => {
    await renderForm();

    await waitFor(() => {
      expect(stateListRequests().length).toBeGreaterThan(0);
    });

    expect(stateListRequests()[0]!.query).toEqual({ isArchived: false });
  });

  test("the dropdown's own search as it opens asks for them too", async () => {
    await renderForm();

    const input: HTMLElement = await screen.findByRole("combobox", {
      name: FIELD_NAME,
    });

    await act(async (): Promise<void> => {
      fireEvent.focus(input);
    });

    const menu: HTMLElement = screen.getByTestId("entity-dropdown-menu");

    await waitFor(() => {
      expect(within(menu).getAllByRole("option").length).toBe(2);
    });

    // The form's list and the dropdown's search, as it opened.
    expect(stateListRequests().length).toBeGreaterThan(1);

    for (const request of stateListRequests()) {
      expect(request.query["isArchived"]).toBe(false);
    }
  });

  test("an archived state the template already has is shown, marked Archived", async () => {
    rowsById = [state(RETIRED_ID, "Monitoring fix", true)];

    await renderForm({ initialIncidentState: RETIRED_ID });

    await waitFor(() => {
      expect(
        screen.getByTestId("entity-dropdown-archived-tag"),
      ).toHaveTextContent("Archived");
    });

    expect(screen.getByText("Monitoring fix")).toBeInTheDocument();

    // Read by its id, with its archive switch: archived or not.
    const byId: ListRequest | undefined = stateListRequests().find(
      (request: ListRequest): boolean => {
        return "_id" in request.query;
      },
    );

    expect(byId).toBeDefined();
    expect(byId!.query["isArchived"]).toBeUndefined();
    expect(byId!.select["isArchived"]).toBe(true);
  });

  test("a live state the template has carries no tag", async () => {
    rowsById = [state(RESOLVED_ID, "Resolved", false)];

    await renderForm({ initialIncidentState: RESOLVED_ID });

    await waitFor(() => {
      expect(screen.getByText("Resolved")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("entity-dropdown-archived-tag")).toBeNull();
  });
});
