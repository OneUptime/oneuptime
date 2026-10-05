import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { JSONObject } from "../../../../Types/JSON";
import Permission from "../../../../Types/Permission";

/*
 * Field.doNotRequireWhenEditing: what a new record must have, but an older
 * one may lack. A label or owner rule must add something when it is made,
 * yet a rule saved before the form asked can still be renamed or switched
 * off (Dashboard Utils/Form/ResourceRuleForm). ModelForm knows whether it
 * creates or edits - by its form type, not by anything in the values - and
 * leaves such a field optional on an Edit form.
 */

type CapturedRequest = {
  model: JSONObject;
  formType: unknown;
};

let capturedRequests: Array<CapturedRequest> = [];

jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return [Permission.ProjectOwner, Permission.User, Permission.Public];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<Permission> } => {
        return {
          globalPermissions: [
            Permission.ProjectOwner,
            Permission.User,
            Permission.Public,
          ],
        };
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

jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<null> => {
        return null;
      },
      getList: async (): Promise<JSONObject> => {
        return { data: [], count: 0, skip: 0, limit: 0 };
      },
      getCommonHeaders: (): JSONObject => {
        return {};
      },
      createOrUpdate: async (data: {
        model: JSONObject;
        formType: unknown;
      }): Promise<{ data: JSONObject }> => {
        capturedRequests.push({ model: data.model, formType: data.formType });
        return { data: data.model };
      },
    },
  };
});

import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import HostLabelRule from "../../../../Models/DatabaseModels/HostLabelRule";
import IncidentLabelRule from "../../../../Models/DatabaseModels/IncidentLabelRule";
import Label from "../../../../Models/DatabaseModels/Label";
import ObjectID from "../../../../Types/ObjectID";
import ModelForm, {
  FormType,
  ModelField,
} from "../../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";

const RULE_ID: string = "66666666-6666-4666-8666-666666666666";

const LABEL_RULE_FIELDS: Array<ModelField<HostLabelRule>> = [
  {
    field: { labelsToAdd: true },
    title: "Labels to Add",
    fieldType: FormFieldSchemaType.MultiSelectDropdown,
    dropdownModal: { type: Label, labelField: "name", valueField: "_id" },
    required: true,
    doNotRequireWhenEditing: true,
    placeholder: "Select labels",
  },
  {
    field: { name: true },
    title: "Name",
    fieldType: FormFieldSchemaType.Text,
    required: true,
    placeholder: "e.g. Add production",
  },
];

// Required while no inherit switch is on - of a new rule only.
const INHERITING_FIELDS: Array<ModelField<IncidentLabelRule>> = [
  {
    field: { labelsToAdd: true },
    title: "Labels to Add",
    fieldType: FormFieldSchemaType.MultiSelectDropdown,
    dropdownModal: { type: Label, labelField: "name", valueField: "_id" },
    required: (values: FormValues<IncidentLabelRule>): boolean => {
      return !values.inheritLabelsFromMonitors;
    },
    doNotRequireWhenEditing: true,
    placeholder: "Select labels",
  },
  {
    field: { inheritLabelsFromMonitors: true },
    title: "Inherit Labels From Monitors",
    fieldType: FormFieldSchemaType.Toggle,
    required: false,
  },
  {
    field: { name: true },
    title: "Name",
    fieldType: FormFieldSchemaType.Text,
    required: true,
    placeholder: "e.g. Add production",
  },
];

async function renderForm<TModel extends BaseModel>(
  modelType: { new (): TModel },
  fields: Array<ModelField<TModel>>,
  formType: FormType,
  initialValues: FormValues<TModel>,
): Promise<void> {
  await act(async (): Promise<void> => {
    render(
      <ModelForm<TModel>
        modelType={modelType}
        id="rule-form"
        fields={fields}
        formType={formType}
        {...(formType === FormType.Update
          ? {
              modelIdToEdit: new ObjectID(RULE_ID),
              doNotFetchExistingModel: true,
            }
          : {})}
        initialValues={initialValues}
        submitButtonText="Save"
      />,
    );
  });

  await screen.findByPlaceholderText("e.g. Add production");
}

async function save(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
  });
}

function labelText(): string {
  return (
    screen.getByText("Labels to Add").closest("label")?.textContent || ""
  ).trim();
}

afterEach(() => {
  cleanup();
  capturedRequests = [];
  jest.clearAllMocks();
});

describe("a field required of a new record only", () => {
  test("is required on a Create form", async () => {
    await renderForm(HostLabelRule, LABEL_RULE_FIELDS, FormType.Create, {
      name: "Does nothing",
    } as FormValues<HostLabelRule>);

    expect(labelText()).toBe("Labels to Add");

    await save();

    expect(
      await screen.findByText("Labels to Add is required."),
    ).toBeInTheDocument();
    expect(capturedRequests).toHaveLength(0);
  });

  test("is optional on an Edit form, which saves without it", async () => {
    await renderForm(HostLabelRule, LABEL_RULE_FIELDS, FormType.Update, {
      name: "Old rule",
    } as FormValues<HostLabelRule>);

    expect(labelText()).toBe("Labels to Add (Optional)");

    await save();

    await waitFor(() => {
      expect(capturedRequests).toHaveLength(1);
    });

    expect(screen.queryByText("Labels to Add is required.")).toBeNull();
    expect(capturedRequests[0]!.formType).toBe(FormType.Update);
    expect(capturedRequests[0]!.model["name"]).toBe("Old rule");
  });

  // The form type decides, not the values: no _id is needed to be an Edit.
  test("is optional on an Edit form whose values carry no _id", async () => {
    await renderForm(HostLabelRule, LABEL_RULE_FIELDS, FormType.Update, {
      name: "Old rule",
    } as FormValues<HostLabelRule>);

    await save();

    await waitFor(() => {
      expect(capturedRequests).toHaveLength(1);
    });
  });

  test("leaves every other field's requirement as it is on an Edit form", async () => {
    await renderForm(HostLabelRule, LABEL_RULE_FIELDS, FormType.Update, {
      name: "",
    } as FormValues<HostLabelRule>);

    await save();

    expect(await screen.findByText("Name is required.")).toBeInTheDocument();
    expect(capturedRequests).toHaveLength(0);
  });

  test("keeps a requirement that depends on the values, on a Create form", async () => {
    await renderForm(IncidentLabelRule, INHERITING_FIELDS, FormType.Create, {
      name: "Inherit monitor labels",
    } as FormValues<IncidentLabelRule>);

    await save();

    expect(
      await screen.findByText("Labels to Add is required."),
    ).toBeInTheDocument();
    expect(capturedRequests).toHaveLength(0);

    // Turning on what the rule inherits makes the labels optional.
    await act(async (): Promise<void> => {
      fireEvent.click(
        screen.getByRole("switch", { name: /Inherit Labels From Monitors/ }),
      );
    });

    expect(labelText()).toBe("Labels to Add (Optional)");

    await save();

    await waitFor(() => {
      expect(capturedRequests).toHaveLength(1);
    });

    expect(capturedRequests[0]!.model["inheritLabelsFromMonitors"]).toBe(true);
  });

  test("drops a requirement that depends on the values, on an Edit form", async () => {
    await renderForm(IncidentLabelRule, INHERITING_FIELDS, FormType.Update, {
      name: "Old rule",
      inheritLabelsFromMonitors: false,
    } as FormValues<IncidentLabelRule>);

    expect(labelText()).toBe("Labels to Add (Optional)");

    await save();

    await waitFor(() => {
      expect(capturedRequests).toHaveLength(1);
    });
  });
});
