import "@testing-library/jest-dom";
import { cleanup, render, waitFor } from "@testing-library/react";
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
 * A write-only column - ColumnAccessControl.read is [] while update is not
 * empty - against the real ModelForm.
 *
 * The edit form shows the fields the user may UPDATE, but the GET that
 * prefills it is refused outright by SelectPermission for one column the
 * caller may not READ: the modal used to open on an error instead of a form.
 * ModelForm now leaves every field the user may not read out of that GET (a
 * field they may write but not read starts empty, and is sent only when
 * filled in). WorkflowVariable.content is still marked doNotShowWhenEditing:
 * the value gets its own write-only door, so the edit modal never shows it.
 *
 * Both directions are pinned here: the field list ModelTable actually
 * produces for the edit modal does not ask for `content`, and neither does
 * the same form WITH the content field.
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
import ModelAPI from "../../../../UI/Utils/ModelAPI/ModelAPI";
import WorkflowVariable from "../../../../Models/DatabaseModels/WorkflowVariable";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";

let permissionsForTest: Array<unknown> = [];

const VARIABLE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

let capturedSelect: Record<string, unknown> | null = null;

function makeModelAPI(): typeof ModelAPI {
  return {
    getItem: async (data: {
      select: Record<string, unknown>;
    }): Promise<WorkflowVariable | null> => {
      capturedSelect = data.select;

      const variable: WorkflowVariable = new WorkflowVariable();
      variable._id = VARIABLE_ID.toString();
      variable.name = "AirflowToken";

      return variable;
    },
    getList: async (): Promise<{
      data: Array<WorkflowVariable>;
      count: number;
      skip: number;
      limit: number;
    }> => {
      return { data: [], count: 0, skip: 0, limit: 10 };
    },
  } as unknown as typeof ModelAPI;
}

/*
 * The four fields both variable pages declare. `content` carries
 * doNotShowWhenEditing, which ModelTable applies before ModelForm ever sees the
 * array - so the edit form is handed the first three, and the create form all
 * four. Restated here rather than imported, because the point is what reaches
 * ModelForm, not how it got there.
 */
const ALL_FIELDS: Array<ModelField<WorkflowVariable>> = [
  {
    field: { name: true },
    title: "Name",
    fieldType: FormFieldSchemaType.Text,
    required: true,
  },
  {
    field: { description: true },
    title: "Description",
    fieldType: FormFieldSchemaType.LongText,
  },
  {
    field: { isSecret: true },
    title: "Secret",
    fieldType: FormFieldSchemaType.Toggle,
  },
  {
    field: { content: true },
    title: "Content",
    fieldType: FormFieldSchemaType.LongText,
    required: true,
    doNotShowWhenEditing: true,
  },
];

function fieldsForEditModal(): Array<ModelField<WorkflowVariable>> {
  return ALL_FIELDS.filter((field: ModelField<WorkflowVariable>) => {
    return !field.doNotShowWhenEditing;
  });
}

async function renderEditForm(
  fields: Array<ModelField<WorkflowVariable>>,
): Promise<void> {
  render(
    <ModelForm<WorkflowVariable>
      modelType={WorkflowVariable}
      modelAPI={makeModelAPI()}
      id="workflow-variable-edit-form"
      name="Workflow Variable"
      fields={fields}
      formType={FormType.Update}
      modelIdToEdit={VARIABLE_ID}
      onSuccess={() => {
        // not exercised
      }}
    />,
  );

  await waitFor(() => {
    expect(capturedSelect).not.toBeNull();
  });
}

describe("the edit form's prefetch select for a write-only column", () => {
  beforeEach(() => {
    capturedSelect = null;
    permissionsForTest = [
      Permission.ProjectAdmin,
      Permission.EditWorkflowVariable,
      Permission.ReadWorkflowVariable,
    ];
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("asks only for the columns the edit form can actually show", async () => {
    await renderEditForm(fieldsForEditModal());

    expect(Object.keys(capturedSelect || {}).sort()).toEqual([
      "description",
      "isSecret",
      "name",
    ]);
  });

  /*
   * With `content` still in the field list, the form still asks only for what
   * the user may read: a column whose read list is empty would have the
   * request refused outright.
   */
  test("does not ask for content even when the field is left on the form", async () => {
    await renderEditForm(ALL_FIELDS);

    expect(Object.keys(capturedSelect || {}).sort()).toEqual([
      "description",
      "isSecret",
      "name",
    ]);
  });

  /*
   * The UPDATE list decides what the form shows, the read list what it loads.
   * Reading both back from the model keeps the two ends of that argument
   * together: content is updatable and unreadable at the same time.
   */
  test("content is updatable and unreadable at once, which is what causes it", () => {
    const variable: WorkflowVariable = new WorkflowVariable();

    expect(
      variable.getColumnAccessControlForAllColumns()["content"]?.read,
    ).toEqual([]);
    expect(
      variable.getColumnAccessControlForAllColumns()["content"]?.update.length,
    ).toBeGreaterThan(0);
  });
});
