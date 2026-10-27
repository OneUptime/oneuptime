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
 * AN EMPTIED NUMBER BOX, ON EVERY FORM.
 *
 * The maintainer's follow-ups: "An emptied optional number field is sent as
 * an empty string, which Postgres refuses (fixed only for SLA rules)." A
 * number box hands the form "" once it is emptied, and the save failed with
 * "invalid input syntax for type integer". ModelForm, which every create
 * and edit dialog of a model goes through, now sends what the blank means
 * (Types/Database/BlankColumnValue): none for a column that may be empty,
 * on Create and Edit alike, and the column's default for one that may not.
 * The SLA rules' and the replay policy's own hooks are gone.
 */

type CapturedRequest = {
  model: JSONObject;
  formType: string;
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
      getProfilePictureRoute: (): string => {
        return "/picture";
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
        formType: string;
      }): Promise<{ data: JSONObject }> => {
        capturedRequests.push({ model: data.model, formType: data.formType });
        return { data: data.model };
      },
    },
  };
});

import IncidentSlaRule from "../../../../Models/DatabaseModels/IncidentSlaRule";
import ObjectID from "../../../../Types/ObjectID";
import ModelForm, {
  FormType,
  ModelField,
} from "../../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";

const RULE_ID: string = "66666666-6666-4666-8666-666666666666";

const FIELDS: Array<ModelField<IncidentSlaRule>> = [
  {
    field: { name: true },
    title: "Name",
    fieldType: FormFieldSchemaType.Text,
    required: true,
    dataTestId: "name",
  },
  {
    field: { responseTimeInMinutes: true },
    title: "Response Time (minutes)",
    fieldType: FormFieldSchemaType.Number,
    required: false,
    dataTestId: "response",
  },
  {
    field: { atRiskThresholdInPercentage: true },
    title: "At Risk Threshold (%)",
    fieldType: FormFieldSchemaType.Number,
    required: false,
    dataTestId: "at-risk",
  },
];

afterEach(() => {
  cleanup();
  capturedRequests = [];
});

async function renderForm(
  formType: FormType,
  initialValues: FormValues<IncidentSlaRule>,
): Promise<void> {
  await act(async (): Promise<void> => {
    render(
      <ModelForm<IncidentSlaRule>
        modelType={IncidentSlaRule}
        id="sla-rule-form"
        fields={FIELDS}
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
}

async function empty(testId: string): Promise<void> {
  const box: HTMLElement = await screen.findByTestId(testId);

  await act(async () => {
    fireEvent.change(box, { target: { value: "" } });
  });
}

async function save(): Promise<JSONObject> {
  await act(async (): Promise<void> => {
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
  });

  await waitFor(() => {
    expect(capturedRequests).toHaveLength(1);
  });

  return capturedRequests[0]!.model;
}

describe("an emptied number box is saved as what the blank means", () => {
  test("Create: a column that may be empty is sent as none, never as an empty string", async () => {
    await renderForm(FormType.Create, {
      name: "Customer SLA",
      responseTimeInMinutes: 15,
    } as FormValues<IncidentSlaRule>);

    await empty("response");
    const model: JSONObject = await save();

    expect(model["responseTimeInMinutes"]).toBeNull();
    expect(model["name"]).toBe("Customer SLA");
  });

  test("Edit: a column that may be empty is cleared", async () => {
    await renderForm(FormType.Update, {
      name: "Customer SLA",
      responseTimeInMinutes: 30,
      atRiskThresholdInPercentage: 70,
    } as FormValues<IncidentSlaRule>);

    await empty("response");
    const model: JSONObject = await save();

    expect(model["responseTimeInMinutes"]).toBeNull();
    expect(Number(model["atRiskThresholdInPercentage"])).toBe(70);
  });

  test("Edit: a column that may not be empty goes back to its default", async () => {
    await renderForm(FormType.Update, {
      name: "Customer SLA",
      atRiskThresholdInPercentage: 70,
    } as FormValues<IncidentSlaRule>);

    await empty("at-risk");
    const model: JSONObject = await save();

    // IncidentSlaRule.atRiskThresholdInPercentage: required, default 80.
    expect(model["atRiskThresholdInPercentage"]).toBe(80);
  });

  test("a number typed in is sent as the number it is", async () => {
    await renderForm(FormType.Create, {
      name: "Customer SLA",
    } as FormValues<IncidentSlaRule>);

    const box: HTMLElement = await screen.findByTestId("response");
    await act(async () => {
      fireEvent.change(box, { target: { value: "45" } });
    });
    const model: JSONObject = await save();

    expect(Number(model["responseTimeInMinutes"])).toBe(45);
  });

  test("a box left untouched sends nothing for its column", async () => {
    await renderForm(FormType.Create, {
      name: "Customer SLA",
    } as FormValues<IncidentSlaRule>);

    await screen.findByTestId("response");
    const model: JSONObject = await save();

    expect(model["responseTimeInMinutes"]).toBeUndefined();
  });
});
