import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A CREATE DIALOG NAMED FOR WHAT IT ADDS (ModelTable createFormTitle /
 * createFormSubmitButtonText).
 *
 * A custom role's Permissions card adds through two buttons - Add Role and
 * Add Permission - and both opened the table's own dialog, "Add New
 * Permission" with an "Add Permission" button, even behind Add Role. The
 * table now takes the dialog's title and button from the page when it has
 * them: "Add a Role to Incident Responder" / "Add Role". A table that names
 * neither keeps "<verb> New <singular name>", and Edit keeps "Edit <singular
 * name>" / "Save Changes" whatever the create dialog is called.
 *
 * The real ModelTable is rendered with its API layer injected, and the form
 * modal recorded rather than mounted (it fetches the row on an edit).
 */

jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return ["ProjectAdmin"];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
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

type RecordedModalProps = {
  title: string;
  submitButtonText?: string | undefined;
  onClose?: (() => void) | undefined;
};

let recordedModalProps: Array<RecordedModalProps> = [];

jest.mock("../../../../UI/Components/ModelFormModal/ModelFormModal", () => {
  return {
    __esModule: true,
    default: (props: RecordedModalProps): React.ReactElement => {
      recordedModalProps.push(props);
      return <div data-testid="model-form-modal" />;
    },
  };
});

import ModelTable from "../../../../UI/Components/ModelTable/ModelTable";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "../../../../UI/Components/Types/FieldType";
import TableFilterUrlState from "../../../../UI/Utils/TableFilterUrlState";
import PermissionGate from "../../../../UI/Utils/PermissionGate";
import ModelAPI from "../../../../UI/Utils/ModelAPI/ModelAPI";
import CustomRolePermission from "../../../../Models/DatabaseModels/CustomRolePermission";
import ListResult from "../../../../Types/BaseDatabase/ListResult";

const ROWS: Array<Record<string, string>> = [
  { _id: "0c000000-0000-4000-8000-000000000001", permission: "AlertMember" },
];

function makeModelAPI(): typeof ModelAPI {
  return {
    getList: async (data: {
      skip: number;
      limit: number;
    }): Promise<ListResult<CustomRolePermission>> => {
      return {
        data: ROWS as unknown as Array<CustomRolePermission>,
        count: ROWS.length,
        skip: data.skip,
        limit: data.limit,
      };
    },
    deleteItem: async (): Promise<void> => {
      return undefined;
    },
    updateById: async (): Promise<void> => {
      return undefined;
    },
    getItem: async (): Promise<null> => {
      return null;
    },
  } as unknown as typeof ModelAPI;
}

function renderTable(options: {
  createFormTitle?: string | undefined;
  createFormSubmitButtonText?: string | undefined;
}): void {
  render(
    <ModelTable<CustomRolePermission>
      modelType={CustomRolePermission}
      modelAPI={makeModelAPI()}
      id="custom-role-permissions-create-title"
      name="Teams > Role > Permissions"
      singularName="Permission"
      pluralName="Permissions"
      createVerb="Add"
      userPreferencesKey="custom-role-permissions-create-title"
      isCreateable={true}
      isEditable={true}
      isDeleteable={false}
      isViewable={false}
      createFormTitle={options.createFormTitle}
      createFormSubmitButtonText={options.createFormSubmitButtonText}
      cardProps={{ title: "Permissions", description: "What this role gives." }}
      filters={[]}
      columns={[
        {
          field: { permission: true },
          title: "Permission",
          type: FieldType.Text,
        },
      ]}
      formFields={[
        {
          field: { permission: true },
          title: "Permission",
          fieldType: FormFieldSchemaType.Text,
          required: true,
        },
      ]}
    />,
  );
}

function buttonsStartingWith(label: string): Array<HTMLButtonElement> {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>("button"),
  ).filter((button: HTMLButtonElement) => {
    return (button.textContent || "").trim().startsWith(label);
  });
}

async function openCreate(): Promise<RecordedModalProps> {
  await waitFor(() => {
    expect(buttonsStartingWith("Add Permission").length).toBeGreaterThan(0);
  });

  fireEvent.click(buttonsStartingWith("Add Permission")[0]!);

  await waitFor(() => {
    expect(recordedModalProps.length).toBeGreaterThan(0);
  });

  return recordedModalProps[recordedModalProps.length - 1]!;
}

async function openEdit(): Promise<RecordedModalProps> {
  await waitFor(() => {
    expect(buttonsStartingWith("Edit").length).toBeGreaterThan(0);
  });

  fireEvent.click(buttonsStartingWith("Edit")[0]!);

  await waitFor(() => {
    expect(recordedModalProps.length).toBeGreaterThan(0);
  });

  return recordedModalProps[recordedModalProps.length - 1]!;
}

describe("a table's create dialog title and button", () => {
  beforeEach(() => {
    recordedModalProps = [];
    PermissionGate.clearPermissionPropsCache();
    window.history.replaceState(
      window.history.state,
      "",
      "/dashboard/teams/roles/role",
    );
    TableFilterUrlState.resetClaimedKeys();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("are the page's own when it names them", async () => {
    renderTable({
      createFormTitle: "Add a Role to Incident Responder",
      createFormSubmitButtonText: "Add Role",
    });

    const modal: RecordedModalProps = await openCreate();

    expect(modal.title).toBe("Add a Role to Incident Responder");
    expect(modal.submitButtonText).toBe("Add Role");
  });

  test("read '<verb> New <singular name>' and '<verb> <singular name>' otherwise", async () => {
    renderTable({});

    const modal: RecordedModalProps = await openCreate();

    expect(modal.title).toBe("Add New Permission");
    expect(modal.submitButtonText).toBe("Add Permission");
  });

  test("never rename the Edit dialog", async () => {
    renderTable({
      createFormTitle: "Add a Role to Incident Responder",
      createFormSubmitButtonText: "Add Role",
    });

    const edit: RecordedModalProps = await openEdit();

    expect(edit.title).toBe("Edit Permission");
    expect(edit.submitButtonText).toBe("Save Changes");

    act(() => {
      edit.onClose?.();
    });

    recordedModalProps = [];

    // And a Create after it is named for what it adds again.
    const create: RecordedModalProps = await openCreate();

    expect(create.title).toBe("Add a Role to Incident Responder");
    expect(create.submitButtonText).toBe("Add Role");
  });
});
