import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React from "react";
import { JSONObject } from "../../../../Types/JSON";
import Permission from "../../../../Types/Permission";

/*
 * Custom field inputs inside a model's own create form - the Details step of
 * declaring an incident - through the real ModelForm and BasicForm, with only
 * the network stubbed.
 *
 * The contract being pinned is ModelForm's: onBeforeCreate is handed every
 * value the form submitted (its third argument), which is where the page
 * reads the custom field answers from. The request's misc data keeps only
 * truthy values, so a Number of 0 and a switch left off would never arrive
 * that way - the bug the Details step must not have.
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

jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<null> => {
        return null;
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
import CustomFieldType from "../../../../Types/CustomField/CustomFieldType";
import { CustomFieldFormDefinition } from "../../../../UI/Components/CustomFields/CustomFieldFormFields";
import {
  buildCustomFieldModelFormFields,
  getCustomFieldFormKey,
  packCustomFieldFormValues,
  removeCustomFieldFormKeys,
} from "../../../../UI/Components/CustomFields/CustomFieldModelFormFields";
import ModelForm, {
  FormType,
  ModelField,
} from "../../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";

const DURATION: CustomFieldFormDefinition = {
  name: "Estimated Duration",
  customFieldType: CustomFieldType.Number,
};

function acknowledgement(isRequired: boolean): CustomFieldFormDefinition {
  return {
    name: "Acknowledgement",
    customFieldType: CustomFieldType.Boolean,
    isRequiredOnCreate: isRequired,
  };
}

let receivedFormValues: Array<JSONObject> = [];

async function renderForm(data: {
  definitions: Array<CustomFieldFormDefinition>;
  startingCustomFields?: JSONObject;
}): Promise<void> {
  const fields: Array<ModelField<Incident>> = [
    {
      field: { title: true },
      title: "Title",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "Incident Title",
    },
    ...buildCustomFieldModelFormFields<Incident>({
      definitions: data.definitions,
      enforceRequiredOnCreate: true,
    }),
  ];

  await act(async (): Promise<void> => {
    render(
      <ModelForm<Incident>
        modelType={Incident}
        id="declare-incident-form"
        name="Declare Incident"
        fields={fields}
        formType={FormType.Create}
        onBeforeCreate={async (
          item: Incident,
          miscDataProps: JSONObject,
          formValues: JSONObject,
        ): Promise<Incident> => {
          receivedFormValues.push({ ...formValues });

          const customFields: JSONObject | undefined =
            packCustomFieldFormValues({
              definitions: data.definitions,
              formValues: formValues,
              startingCustomFields: data.startingCustomFields,
            });

          removeCustomFieldFormKeys(miscDataProps);

          if (customFields) {
            item.customFields = customFields;
          }

          return item;
        }}
        onSuccess={(): void => {
          // Not asserted on.
        }}
        submitButtonText="Declare Incident"
      />,
    );
  });
}

function typeTitle(): void {
  fireEvent.change(screen.getByPlaceholderText("Incident Title"), {
    target: { value: "Payments are failing" },
  });
}

async function submit(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(screen.getByRole("button", { name: "Declare Incident" }));
  });
}

function acknowledgementSwitch(): HTMLElement {
  return screen.getByRole("switch", { name: /Acknowledgement/ });
}

afterEach(() => {
  cleanup();
  capturedRequests = [];
  receivedFormValues = [];
});

describe("ModelForm hands onBeforeCreate the values the form submitted", () => {
  test("0 and a switch left off reach it, and are saved as custom field values", async () => {
    await renderForm({ definitions: [DURATION, acknowledgement(false)] });

    typeTitle();
    fireEvent.change(screen.getByLabelText(/Estimated Duration/), {
      target: { value: "0" },
    });

    await submit();

    expect(receivedFormValues).toHaveLength(1);
    expect(
      receivedFormValues[0]![getCustomFieldFormKey("Estimated Duration")],
    ).toBe("0");
    expect(
      receivedFormValues[0]![getCustomFieldFormKey("Acknowledgement")],
    ).toBe(false);

    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0]!.model["customFields"]).toEqual({
      "Estimated Duration": "0",
      Acknowledgement: false,
    });
  });

  test("the inputs travel in customFields only, never as misc data", async () => {
    await renderForm({ definitions: [DURATION, acknowledgement(false)] });

    typeTitle();
    fireEvent.change(screen.getByLabelText(/Estimated Duration/), {
      target: { value: "45" },
    });
    fireEvent.click(acknowledgementSwitch());

    await submit();

    expect(capturedRequests[0]!.model["customFields"]).toEqual({
      "Estimated Duration": "45",
      Acknowledgement: true,
    });
    expect(
      Object.keys(capturedRequests[0]!.miscDataProps).filter((key: string) => {
        return key.startsWith("customFields:");
      }),
    ).toEqual([]);
    // And never as a column of the field's own name.
    expect(capturedRequests[0]!.model["Estimated Duration"]).toBeUndefined();
  });

  test("the starting values are merged under the answers", async () => {
    await renderForm({
      definitions: [DURATION],
      startingCustomFields: { Category: "Network", "Estimated Duration": "30" },
    });

    typeTitle();
    fireEvent.change(screen.getByLabelText(/Estimated Duration/), {
      target: { value: "0" },
    });

    await submit();

    expect(capturedRequests[0]!.model["customFields"]).toEqual({
      Category: "Network",
      "Estimated Duration": "0",
    });
  });
});

describe("a required acknowledgement on the real form", () => {
  test("cannot be declared until it is ticked", async () => {
    await renderForm({ definitions: [acknowledgement(true)] });

    typeTitle();

    // Never touched.
    await submit();
    expect(capturedRequests).toHaveLength(0);

    // Ticked, then unticked again: the form holds false.
    fireEvent.click(acknowledgementSwitch());
    fireEvent.click(acknowledgementSwitch());
    await submit();

    expect(capturedRequests).toHaveLength(0);
    expect(
      await screen.findByText("Acknowledgement must be checked."),
    ).toBeInTheDocument();

    fireEvent.click(acknowledgementSwitch());
    await submit();

    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0]!.model["customFields"]).toEqual({
      Acknowledgement: true,
    });
  });
});
