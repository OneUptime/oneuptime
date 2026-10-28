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
 * AN EDIT DIALOG THAT SAYS WHICH ROW IT EDITS (ModelTable editFormTitle).
 *
 * Security Events > Settings > Response Targets lists a project's case
 * priorities, and Edit on each opened "Edit Response Target" over a blurred
 * table: with two empty fields on a project that had set no targets,
 * nothing in the dialog said which priority it was. A table may now name
 * the row in its Edit dialog's title ("Edit Targets for Critical"). A
 * table that does not, or whose title for a row is empty, keeps "Edit
 * <singular name>", and the Create dialog keeps its own title.
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
  editFormTitle?: ((item: CustomRolePermission) => string) | undefined;
}): void {
  render(
    <ModelTable<CustomRolePermission>
      modelType={CustomRolePermission}
      modelAPI={makeModelAPI()}
      id="custom-role-permissions-edit-title"
      name="Teams > Role > Permissions"
      singularName="Permission"
      pluralName="Permissions"
      createVerb="Add"
      userPreferencesKey="custom-role-permissions-edit-title"
      isCreateable={true}
      isEditable={true}
      isDeleteable={false}
      isViewable={false}
      editFormTitle={options.editFormTitle}
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

describe("a table's edit dialog title", () => {
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

  test("names the row it edits when the page says how", async () => {
    const asked: Array<string> = [];

    renderTable({
      editFormTitle: (item: CustomRolePermission): string => {
        asked.push(String(item.permission));
        return `Edit Targets for ${String(item.permission)}`;
      },
    });

    const edit: RecordedModalProps = await openEdit();

    expect(edit.title).toBe("Edit Targets for AlertMember");
    expect(edit.submitButtonText).toBe("Save Changes");
    // Asked about the row whose Edit was pressed.
    expect(asked).toContain("AlertMember");
  });

  test("reads 'Edit <singular name>' without one, or for a row it has no words for", async () => {
    renderTable({});

    let edit: RecordedModalProps = await openEdit();

    expect(edit.title).toBe("Edit Permission");

    act(() => {
      edit.onClose?.();
    });
    cleanup();
    recordedModalProps = [];
    TableFilterUrlState.resetClaimedKeys();

    renderTable({
      editFormTitle: (): string => {
        return "";
      },
    });

    edit = await openEdit();

    expect(edit.title).toBe("Edit Permission");
  });

  test("never renames the Create dialog", async () => {
    renderTable({
      editFormTitle: (item: CustomRolePermission): string => {
        return `Edit Targets for ${String(item.permission)}`;
      },
    });

    const create: RecordedModalProps = await openCreate();

    expect(create.title).toBe("Add New Permission");
    expect(create.submitButtonText).toBe("Add Permission");
  });
});
