import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
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
 * alsoReadColumns: an Update form reads what a create-time choice holds,
 * though no field of it shows or sends that choice.
 *
 * ModelTable's Edit drops every doNotShowWhenEditing field before ModelForm
 * sees the list - and with it the column, so the fields left on the form
 * that read it (showIf, required) opened as if it were unset. A secret
 * runbook variable's Edit asked for a required plain Value, which the
 * server refuses for a secret; a Power BI connection's asked for an
 * address it has none of. The same fault as Edit resource opening on the
 * monitor picker for a monitor group's row (issue #6540): an Edit form
 * opening on a choice the record did not make.
 *
 *   - the column is read into the form's values, so the form opens on it;
 *   - it is never sent: the save sends the fields' own columns alone - a
 *     Secret switch the server will not let anybody change included;
 *   - only plain columns the user may read are read: one the user may not
 *     read would refuse the whole fetch, and a relation or a file is not a
 *     value a field reads; until the permission snapshot lands, nothing more
 *     is read.
 */

jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): { permissions: Array<unknown> } => {
        return {
          permissions: permissionsForTest.map((permission: unknown) => {
            return {
              _type: "UserPermission",
              permission,
              labelIds: [],
              isBlockPermission: false,
            };
          }),
        };
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

import ModelForm, {
  FormType,
  ModelField,
} from "../../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import { getColumnsLeftOffEditForm } from "../../../../UI/Components/ModelTable/ModelTable";
import ModelAPI from "../../../../UI/Utils/ModelAPI/ModelAPI";
import RunbookVariable from "../../../../Models/DatabaseModels/RunbookVariable";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";

let permissionsForTest: Array<unknown> = [];

const VARIABLE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

let capturedSelect: Record<string, unknown> | null = null;
let capturedSaves: Array<JSONObject> = [];
let storedIsSecret: boolean = true;

function makeModelAPI(): typeof ModelAPI {
  return {
    getItem: async (data: {
      select: Record<string, unknown>;
    }): Promise<RunbookVariable | null> => {
      capturedSelect = data.select;

      // What the server returns: the columns asked for.
      const variable: RunbookVariable = new RunbookVariable();
      variable._id = VARIABLE_ID.toString();
      variable.name = "DEPLOY_KEY";
      variable.description = "Deploys the API";

      if (data.select["isSecret"]) {
        variable.isSecret = storedIsSecret;
      }

      return variable;
    },
    getList: async (): Promise<{
      data: Array<RunbookVariable>;
      count: number;
      skip: number;
      limit: number;
    }> => {
      return { data: [], count: 0, skip: 0, limit: 10 };
    },
    createOrUpdate: async (data: {
      model: JSONObject;
    }): Promise<{ data: JSONObject }> => {
      capturedSaves.push(data.model);
      return { data: data.model };
    },
  } as unknown as typeof ModelAPI;
}

function isSecretValue(values: FormValues<RunbookVariable>): boolean {
  return Boolean((values as JSONObject)["isSecret"]);
}

/*
 * The runbook variable form (RunbookVariablesTable), as ModelTable hands it
 * to ModelForm: the Secret switch and Secret Value are create-time
 * (doNotShowWhenEditing), so Create gets all of them.
 */
const ALL_FIELDS: Array<ModelField<RunbookVariable>> = [
  {
    field: { name: true },
    title: "Name",
    fieldType: FormFieldSchemaType.Text,
    required: true,
  },
  {
    field: { isSecret: true },
    title: "Secret",
    fieldType: FormFieldSchemaType.Toggle,
    required: false,
    doNotShowWhenEditing: true,
  },
  {
    field: { value: true },
    title: "Value",
    fieldType: FormFieldSchemaType.LongText,
    required: true,
    placeholder: "Value",
    showIf: (values: FormValues<RunbookVariable>): boolean => {
      return !isSecretValue(values);
    },
  },
  {
    field: { secretValue: true },
    title: "Secret Value",
    fieldType: FormFieldSchemaType.LongText,
    required: true,
    doNotShowWhenEditing: true,
    showIf: isSecretValue,
  },
  {
    field: { description: true },
    title: "Description",
    fieldType: FormFieldSchemaType.LongText,
    required: false,
    placeholder: "Description",
  },
];

function fieldsForEditModal(): Array<ModelField<RunbookVariable>> {
  return ALL_FIELDS.filter((field: ModelField<RunbookVariable>) => {
    return !field.doNotShowWhenEditing;
  });
}

async function renderEditForm(alsoReadColumns?: Array<string>): Promise<void> {
  await act(async (): Promise<void> => {
    render(
      <ModelForm<RunbookVariable>
        modelType={RunbookVariable}
        modelAPI={makeModelAPI()}
        id="runbook-variable-edit-form"
        name="Runbook Variable"
        fields={fieldsForEditModal()}
        formType={FormType.Update}
        modelIdToEdit={VARIABLE_ID}
        alsoReadColumns={alsoReadColumns}
        submitButtonText="Save Changes"
        onSuccess={() => {
          // not exercised
        }}
      />,
    );
  });

  await waitFor(() => {
    expect(capturedSelect).not.toBeNull();
  });

  await screen.findByRole("button", { name: "Save Changes" });

  await waitFor(() => {
    expect(
      (screen.getByPlaceholderText("Description") as HTMLTextAreaElement).value,
    ).toBe("Deploys the API");
  });
}

const EDITOR_PERMISSIONS: Array<Permission> = [
  Permission.ReadRunbookSecret,
  Permission.EditRunbookSecret,
];

describe("ModelForm alsoReadColumns", () => {
  beforeEach(() => {
    capturedSelect = null;
    capturedSaves = [];
    storedIsSecret = true;
    permissionsForTest = [...EDITOR_PERMISSIONS];
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("reads a column the Edit form leaves out, with the columns its fields show", async () => {
    await renderEditForm(["isSecret"]);

    expect(Object.keys(capturedSelect || {}).sort()).toEqual([
      "description",
      "isSecret",
      "name",
      "value",
    ]);
  });

  test("opens a secret variable as a secret: no plain Value to ask for", async () => {
    await renderEditForm(["isSecret"]);

    expect(screen.queryByPlaceholderText("Value")).toBeNull();
  });

  // What every Edit of a secret variable did before.
  test("without it, a secret variable opens asking for a plain Value", async () => {
    await renderEditForm(undefined);

    expect(capturedSelect?.["isSecret"]).toBeUndefined();
    expect(screen.getByPlaceholderText("Value")).toBeVisible();
  });

  test("opens a plain variable with its Value", async () => {
    storedIsSecret = false;

    await renderEditForm(["isSecret"]);

    expect(screen.getByPlaceholderText("Value")).toBeVisible();
  });

  test("saves what was changed and never what it only read", async () => {
    await renderEditForm(["isSecret"]);

    fireEvent.change(screen.getByPlaceholderText("Description"), {
      target: { value: "Deploys the API and the workers" },
    });

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    });

    await waitFor(() => {
      expect(capturedSaves).toHaveLength(1);
    });

    const saved: JSONObject = capturedSaves[0]!;

    expect(saved["description"]).toBe("Deploys the API and the workers");
    // The Secret switch cannot be changed (update: []), and was not.
    expect(saved["isSecret"]).toBeUndefined();
    expect(saved["value"]).toBeUndefined();
  });

  test("leaves out a column the user may not read, a relation, and a name that is no column", async () => {
    await renderEditForm([
      "isSecret",
      // read: [] - asking for it would refuse the whole fetch.
      "secretValue",
      "runbook",
      "runners",
      "notAColumn",
      // Already read for its field.
      "name",
    ]);

    expect(Object.keys(capturedSelect || {}).sort()).toEqual([
      "description",
      "isSecret",
      "name",
      "value",
    ]);
  });

  test("reads nothing more for a user who may not read the column", async () => {
    // Edits secrets, reads none: isSecret is not theirs to read.
    permissionsForTest = [Permission.EditRunbookSecret];

    await act(async (): Promise<void> => {
      render(
        <ModelForm<RunbookVariable>
          modelType={RunbookVariable}
          modelAPI={makeModelAPI()}
          id="runbook-variable-edit-form"
          name="Runbook Variable"
          fields={fieldsForEditModal()}
          formType={FormType.Update}
          modelIdToEdit={VARIABLE_ID}
          alsoReadColumns={["isSecret"]}
          onSuccess={() => {
            // not exercised
          }}
        />,
      );
    });

    await waitFor(() => {
      expect(capturedSelect).not.toBeNull();
    });

    expect(capturedSelect?.["isSecret"]).toBeUndefined();
  });

  test("reads nothing more before the permission snapshot lands", async () => {
    permissionsForTest = [];

    await act(async (): Promise<void> => {
      render(
        <ModelForm<RunbookVariable>
          modelType={RunbookVariable}
          modelAPI={makeModelAPI()}
          id="runbook-variable-edit-form"
          name="Runbook Variable"
          fields={fieldsForEditModal()}
          formType={FormType.Update}
          modelIdToEdit={VARIABLE_ID}
          alsoReadColumns={["isSecret"]}
          onSuccess={() => {
            // not exercised
          }}
        />,
      );
    });

    await waitFor(() => {
      expect(capturedSelect).not.toBeNull();
    });

    expect(capturedSelect?.["isSecret"]).toBeUndefined();
  });
});

/*
 * What ModelTable's Edit hands ModelForm as alsoReadColumns: the columns of
 * the fields the Edit form leaves out.
 */
describe("getColumnsLeftOffEditForm", () => {
  test("is the columns of the fields an Edit form leaves out", () => {
    expect(getColumnsLeftOffEditForm<RunbookVariable>(ALL_FIELDS)).toEqual([
      "isSecret",
      "secretValue",
    ]);
  });

  test("leaves out a column another field shows on Edit", () => {
    expect(
      getColumnsLeftOffEditForm<RunbookVariable>([
        {
          field: { value: true },
          title: "Value",
          fieldType: FormFieldSchemaType.LongText,
          doNotShowWhenEditing: true,
        },
        {
          field: { value: true },
          title: "Value",
          fieldType: FormFieldSchemaType.LongText,
        },
      ]),
    ).toEqual([]);
  });

  test("names a column once, however many fields leave it out", () => {
    expect(
      getColumnsLeftOffEditForm<RunbookVariable>([
        {
          field: { isSecret: true },
          title: "Secret",
          fieldType: FormFieldSchemaType.Toggle,
          doNotShowWhenEditing: true,
        },
        {
          field: { isSecret: true },
          title: "Secret",
          fieldType: FormFieldSchemaType.Checkbox,
          doNotShowWhenEditing: true,
        },
      ]),
    ).toEqual(["isSecret"]);
  });

  test("is empty for a form that leaves nothing out, or has no fields", () => {
    expect(
      getColumnsLeftOffEditForm<RunbookVariable>(fieldsForEditModal()),
    ).toEqual([]);
    expect(getColumnsLeftOffEditForm<RunbookVariable>([])).toEqual([]);
    expect(getColumnsLeftOffEditForm<RunbookVariable>(undefined)).toEqual([]);
  });

  test("skips a field that names no column", () => {
    expect(
      getColumnsLeftOffEditForm<RunbookVariable>([
        {
          title: "Overview",
          fieldType: FormFieldSchemaType.Text,
          doNotShowWhenEditing: true,
        } as ModelField<RunbookVariable>,
      ]),
    ).toEqual([]);
  });
});
