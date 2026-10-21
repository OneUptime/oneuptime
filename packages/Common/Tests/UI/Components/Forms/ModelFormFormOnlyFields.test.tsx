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
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";

/*
 * A form-only field (Field.formOnly) drives the form and is never sent.
 *
 * A field registered with an overrideFieldKey writes a form value that is no
 * column, and ModelForm sends every truthy one of those as the request's misc
 * data. Some such fields exist only to fill in or edit other fields: the
 * identity provider picker that fills in an OAuth 2.0 variable's token URL,
 * and a workspace notification rule's Destination step, which edits a part
 * of the rule. Their value is the form's business, not the server's - on a
 * create form and on an edit form alike, where there is no onBeforeCreate to
 * take it out again.
 *
 * Through the real ModelForm and BasicForm, with only the network stubbed.
 */

type CapturedRequest = {
  model: JSONObject;
  miscDataProps: JSONObject;
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

const SAVED_TITLE: string = "Checkout is failing";

jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<JSONObject> => {
        return {
          _id: "00000001-0000-4000-8000-000000000001",
          title: SAVED_TITLE,
        };
      },
      getList: async (): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        return { data: [], count: 0, skip: 0, limit: 0 };
      },
      getCommonHeaders: (): JSONObject => {
        return {};
      },
      createOrUpdate: async (data: {
        model: JSONObject;
        miscDataProps: JSONObject;
      }): Promise<{ data: JSONObject }> => {
        capturedRequests.push({
          model: data.model,
          miscDataProps: { ...data.miscDataProps },
        });
        return { data: data.model };
      },
    },
  };
});

import Incident from "../../../../Models/DatabaseModels/Incident";
import ModelForm, {
  FormType,
  ModelField,
} from "../../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";

const INCIDENT_ID: ObjectID = new ObjectID(
  "00000001-0000-4000-8000-000000000001",
);

const TITLE_FIELD: ModelField<Incident> = {
  field: { title: true },
  title: "Title",
  fieldType: FormFieldSchemaType.Text,
  required: true,
  placeholder: "Incident Title",
};

// A helper input: whatever is typed into it is written into the title.
function helperField(formOnly: boolean): ModelField<Incident> {
  return {
    overrideField: { title: true },
    overrideFieldKey: "titlePrefix",
    formOnly,
    title: "Title Prefix",
    fieldType: FormFieldSchemaType.Text,
    required: false,
    placeholder: "Prefix",
    onChange: (
      value: unknown,
      currentValues: FormValues<Incident>,
      setNewFormValues: (values: FormValues<Incident>) => void,
    ): void => {
      setNewFormValues({
        ...currentValues,
        title: `${String(value)}: ${String(currentValues.title || "")}`,
      } as FormValues<Incident>);
    },
  };
}

async function renderForm(data: {
  formOnly: boolean;
  formType: FormType;
}): Promise<void> {
  await act(async (): Promise<void> => {
    render(
      <ModelForm<Incident>
        modelType={Incident}
        id="incident-form"
        name="Incident"
        fields={[TITLE_FIELD, helperField(data.formOnly)]}
        formType={data.formType}
        modelIdToEdit={
          data.formType === FormType.Update ? INCIDENT_ID : undefined
        }
        onSuccess={(): void => {
          // Not asserted on.
        }}
        submitButtonText="Save"
      />,
    );
  });
}

async function fillAndSubmit(data: { formType: FormType }): Promise<void> {
  if (data.formType === FormType.Create) {
    fireEvent.change(screen.getByPlaceholderText("Incident Title"), {
      target: { value: SAVED_TITLE },
    });
  } else {
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Incident Title")).toHaveValue(
        SAVED_TITLE,
      );
    });
  }

  fireEvent.change(screen.getByPlaceholderText("Prefix"), {
    target: { value: "SEV1" },
  });

  await act(async (): Promise<void> => {
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
  });

  await waitFor(() => {
    expect(capturedRequests).toHaveLength(1);
  });
}

afterEach(() => {
  cleanup();
  capturedRequests = [];
});

describe.each([
  ["a create form", FormType.Create],
  ["an edit form", FormType.Update],
])("on %s", (_name: string, formType: FormType) => {
  test("a form-only field's value is not sent", async () => {
    await renderForm({ formOnly: true, formType });
    await fillAndSubmit({ formType });

    expect(capturedRequests[0]!.miscDataProps).toEqual({});
  });

  // What it filled in is sent, as the field it filled in.
  test("what a form-only field filled in is sent", async () => {
    await renderForm({ formOnly: true, formType });
    await fillAndSubmit({ formType });

    expect(capturedRequests[0]!.model["title"]).toBe(`SEV1: ${SAVED_TITLE}`);
  });

  // The behaviour every other overrideFieldKey field keeps.
  test("the same field, not form-only, is sent as misc data", async () => {
    await renderForm({ formOnly: false, formType });
    await fillAndSubmit({ formType });

    expect(capturedRequests[0]!.miscDataProps).toEqual({
      titlePrefix: "SEV1",
    });
  });
});
