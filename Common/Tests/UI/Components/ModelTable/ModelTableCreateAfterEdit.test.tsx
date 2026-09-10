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
 * Creating a row after editing one on the same table.
 *
 * `currentEditableItem` is written in exactly one place - the Edit row action -
 * and was never cleared: not by the modal's onClose, and not by any of the
 * three Create entry points. `modelIdToEdit` was derived from it
 * unconditionally, so once a user had edited anything, every subsequent Create
 * on that table was handed the id of the row they had edited.
 *
 * ModelTable then branched its form-field filter on that id rather than on the
 * modal's type, so the create form quietly became an edit form: every field
 * marked `doNotShowWhenEditing` disappeared from it. Those fields are, by
 * definition, the write-only ones - a secret value, a service-account key, a
 * workflow variable's content - and they are required on create. The user got a
 * form with the one mandatory field missing and a 400 at submit naming a column
 * that was never on screen.
 *
 * It is reachable on every table that pairs isEditable with a
 * doNotShowWhenEditing field: Runbook Secrets, Monitor Secrets, the Security
 * Events connectors, Monitor > Probes, and now Workflow Variables.
 *
 * Both halves are pinned - BaseModelTable must stop handing the stale id over,
 * and ModelTable must stop treating an id as proof of an edit - because either
 * one alone closes the hole, and the next person to touch the other should not
 * be able to reopen it silently. The real ModelTable is rendered (its API layer
 * injected through the modelAPI prop, its form modal recorded) so both are
 * exercised as they actually compose, rather than restated.
 */

let isMasterAdminForTest: boolean = false;
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
        return isMasterAdminForTest;
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

type RecordedFormField = {
  title?: string | undefined;
};

type RecordedModalProps = {
  title: string;
  modelIdToEdit?: unknown;
  formProps: {
    formType: unknown;
    fields: Array<RecordedFormField>;
  };
};

let recordedModalProps: Array<RecordedModalProps> = [];

/*
 * The form modal is replaced by a recorder rather than rendered: the assertion
 * is about which fields ModelTable hands it, and the real one mounts a
 * ModelForm that fetches the row over the network on an Update.
 */
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
import { FormType } from "../../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "../../../../UI/Components/Types/FieldType";
import TableFilterUrlState from "../../../../UI/Utils/TableFilterUrlState";
import PermissionGate from "../../../../UI/Utils/PermissionGate";
import ModelAPI from "../../../../UI/Utils/ModelAPI/ModelAPI";
import RunbookSecret from "../../../../Models/DatabaseModels/RunbookSecret";
import Permission from "../../../../Types/Permission";
import ListResult from "../../../../Types/BaseDatabase/ListResult";

/*
 * RunbookSecret rather than a stand-in: it is one of the tables this bug is
 * live on today, and its `secretValue` is a genuine read: [] column, so the
 * field that vanishes here is the same field that vanishes in production.
 */
const ROWS: Array<Record<string, string>> = [
  { _id: "secret-1", name: "AirflowToken", description: "Nightly sync" },
];

const SECRET_VALUE_TITLE: string = "Secret Value";
const NAME_TITLE: string = "Name";
const EDIT_ONLY_TITLE: string = "Only When Editing";

function makeModelAPI(): typeof ModelAPI {
  return {
    getList: async (data: {
      skip: number;
      limit: number;
    }): Promise<ListResult<RunbookSecret>> => {
      return {
        data: ROWS as unknown as Array<RunbookSecret>,
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

function renderTable(): ReturnType<typeof render> {
  return render(
    <ModelTable<RunbookSecret>
      modelType={RunbookSecret}
      modelAPI={makeModelAPI()}
      id="runbook-secrets-create-after-edit"
      name="Runbook Secrets"
      singularName="Runbook Secret"
      pluralName="Runbook Secrets"
      userPreferencesKey="runbook-secrets-create-after-edit"
      isCreateable={true}
      isEditable={true}
      isDeleteable={false}
      isViewable={false}
      cardProps={{ title: "Runbook Secrets", description: "Secrets" }}
      filters={[]}
      columns={[
        {
          field: { name: true },
          title: NAME_TITLE,
          type: FieldType.Text,
        },
      ]}
      formFields={[
        {
          field: { name: true },
          title: NAME_TITLE,
          fieldType: FormFieldSchemaType.Text,
          required: true,
        },
        {
          field: { secretValue: true },
          title: SECRET_VALUE_TITLE,
          fieldType: FormFieldSchemaType.LongText,
          required: true,
          doNotShowWhenEditing: true,
        },
        {
          field: { description: true },
          title: EDIT_ONLY_TITLE,
          fieldType: FormFieldSchemaType.LongText,
          doNotShowWhenCreating: true,
        },
      ]}
    />,
  );
}

type FindButtonFunction = (label: string) => HTMLButtonElement | null;

const findButton: FindButtonFunction = (
  label: string,
): HTMLButtonElement | null => {
  const buttons: Array<HTMLButtonElement> = Array.from(
    document.querySelectorAll<HTMLButtonElement>("button"),
  );

  return (
    buttons.find((button: HTMLButtonElement) => {
      return (button.textContent || "").trim().startsWith(label);
    }) || null
  );
};

function lastModal(): RecordedModalProps {
  return recordedModalProps[
    recordedModalProps.length - 1
  ] as RecordedModalProps;
}

function fieldTitles(modal: RecordedModalProps): Array<string> {
  return modal.formProps.fields.map((field: RecordedFormField) => {
    return field.title as string;
  });
}

async function openEditAndClose(): Promise<void> {
  await waitFor(() => {
    expect(findButton("Edit")).not.toBeNull();
  });

  fireEvent.click(findButton("Edit")!);

  await waitFor(() => {
    expect(recordedModalProps.length).toBeGreaterThan(0);
  });
}

describe("Create after Edit on the same table", () => {
  beforeEach(() => {
    isMasterAdminForTest = false;
    permissionsForTest = [Permission.ProjectAdmin];
    recordedModalProps = [];
    PermissionGate.clearPermissionPropsCache();
    window.history.replaceState(
      window.history.state,
      "",
      "/dashboard/runbook-secrets",
    );
    TableFilterUrlState.resetClaimedKeys();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("an Edit opens an update form on the row, without its write-only field", async () => {
    renderTable();

    await openEditAndClose();

    const modal: RecordedModalProps = lastModal();

    expect(modal.formProps.formType).toBe(FormType.Update);
    expect(String(modal.modelIdToEdit)).toBe("secret-1");

    const titles: Array<string> = fieldTitles(modal);

    expect(titles).toContain(NAME_TITLE);
    expect(titles).toContain(EDIT_ONLY_TITLE);
    /*
     * secretValue is read: [], so leaving it on an edit form would put it in
     * the modal's prefetch select and the whole GET would be refused.
     */
    expect(titles).not.toContain(SECRET_VALUE_TITLE);
  });

  test("a Create before any Edit offers the write-only field", async () => {
    renderTable();

    await waitFor(() => {
      expect(findButton("Create Runbook Secret")).not.toBeNull();
    });

    fireEvent.click(findButton("Create Runbook Secret")!);

    await waitFor(() => {
      expect(recordedModalProps.length).toBeGreaterThan(0);
    });

    const titles: Array<string> = fieldTitles(lastModal());

    expect(titles).toContain(SECRET_VALUE_TITLE);
    expect(titles).not.toContain(EDIT_ONLY_TITLE);
  });

  /*
   * The regression. The edit is dismissed the way a user dismisses it, which is
   * exactly the path that used to leave currentEditableItem behind.
   */
  test("a Create that follows an Edit is still a create form", async () => {
    renderTable();

    await openEditAndClose();

    const editModal: RecordedModalProps = lastModal();

    expect(editModal.formProps.formType).toBe(FormType.Update);

    // Dismiss the edit modal the way the user does.
    act(() => {
      (
        editModal as unknown as { onClose?: (() => void) | undefined }
      ).onClose?.();
    });

    await waitFor(() => {
      expect(findButton("Create Runbook Secret")).not.toBeNull();
    });

    recordedModalProps = [];

    fireEvent.click(findButton("Create Runbook Secret")!);

    await waitFor(() => {
      expect(recordedModalProps.length).toBeGreaterThan(0);
    });

    const createModal: RecordedModalProps = lastModal();

    expect(createModal.formProps.formType).toBe(FormType.Create);
    /*
     * The stale id is what made the filter below treat this as an edit. It must
     * not survive the switch back to Create.
     */
    expect(createModal.modelIdToEdit).toBeUndefined();

    const titles: Array<string> = fieldTitles(createModal);

    // The required, write-only field the user would otherwise never be shown.
    expect(titles).toContain(SECRET_VALUE_TITLE);
    expect(titles).toContain(NAME_TITLE);
    expect(titles).not.toContain(EDIT_ONLY_TITLE);
  });

  /*
   * The same switch seen from the user's side. The heading is the only signal
   * on screen that says which form this is, and it comes from modalType - so a
   * create form that still says "Edit Runbook Secret" would mean the two halves
   * had gone out of step again.
   */
  test("the heading switches back to Create as well", async () => {
    renderTable();

    await openEditAndClose();

    expect(lastModal().title).toContain("Edit");

    const editModal: RecordedModalProps = lastModal();

    act(() => {
      (
        editModal as unknown as { onClose?: (() => void) | undefined }
      ).onClose?.();
    });

    await waitFor(() => {
      expect(findButton("Create Runbook Secret")).not.toBeNull();
    });

    recordedModalProps = [];
    fireEvent.click(findButton("Create Runbook Secret")!);

    await waitFor(() => {
      expect(recordedModalProps.length).toBeGreaterThan(0);
    });

    expect(lastModal().title).toContain("Create");
    expect(lastModal().title).not.toContain("Edit");
  });
});
