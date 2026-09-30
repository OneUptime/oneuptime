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
 * What a create form's request carries besides the model: its misc data.
 * Through the real ModelForm and BasicForm, with only the network stubbed.
 *
 * Pinned because declaring an incident from a template depends on it
 * (IncidentCreateTemplateOwners.test.tsx): the page used to put the
 * template's owners into the form's INITIAL VALUES, where no input held them,
 * and they never reached the server. The misc data is built from the inputs
 * that have an overrideFieldKey, and onBeforeCreate is handed that same
 * object - so what it adds is what the request carries.
 */

type CapturedRequest = {
  model: JSONObject;
  miscDataProps: JSONObject;
};

let capturedRequests: Array<CapturedRequest> = [];
let receivedFormValues: Array<JSONObject> = [];

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
import ModelForm, {
  FormType,
  ModelField,
} from "../../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";

const USER_A: string = "0000000e-0000-4000-8000-000000000001";
const TEAM_A: string = "0000000b-0000-4000-8000-000000000001";

const TITLE_FIELD: ModelField<Incident> = {
  field: { title: true },
  title: "Title",
  fieldType: FormFieldSchemaType.Text,
  required: true,
  placeholder: "Incident Title",
};

async function renderForm(data: {
  initialValues?: JSONObject;
  onBeforeCreate?: (
    item: Incident,
    miscDataProps: JSONObject,
    formValues: JSONObject,
  ) => Promise<Incident>;
}): Promise<void> {
  await act(async (): Promise<void> => {
    render(
      <ModelForm<Incident>
        modelType={Incident}
        id="declare-incident-form"
        name="Declare Incident"
        fields={[TITLE_FIELD]}
        formType={FormType.Create}
        initialValues={data.initialValues}
        onBeforeCreate={async (
          item: Incident,
          miscDataProps: JSONObject,
          formValues: JSONObject,
        ): Promise<Incident> => {
          receivedFormValues.push({ ...formValues });

          if (data.onBeforeCreate) {
            return await data.onBeforeCreate(item, miscDataProps, formValues);
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

async function typeTitleAndSubmit(): Promise<void> {
  fireEvent.change(screen.getByPlaceholderText("Incident Title"), {
    target: { value: "Checkout is failing" },
  });

  await act(async (): Promise<void> => {
    fireEvent.click(screen.getByRole("button", { name: "Declare Incident" }));
  });
}

afterEach(() => {
  cleanup();
  capturedRequests = [];
  receivedFormValues = [];
});

describe("a create form's misc data", () => {
  test("an initial value no input holds never reaches the request - how template owners were lost", async () => {
    await renderForm({
      initialValues: { ownerUsers: [USER_A], ownerTeams: [TEAM_A] },
    });

    await typeTitleAndSubmit();

    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0]!.miscDataProps).toEqual({});
    expect(capturedRequests[0]!.model["ownerUsers"]).toBeUndefined();
    expect(capturedRequests[0]!.model["ownerTeams"]).toBeUndefined();
  });

  test("what onBeforeCreate adds to the misc data is what the request carries", async () => {
    await renderForm({
      onBeforeCreate: async (
        item: Incident,
        miscDataProps: JSONObject,
      ): Promise<Incident> => {
        miscDataProps["ownerUsers"] = [USER_A];
        miscDataProps["ownerTeams"] = [TEAM_A];
        return item;
      },
    });

    await typeTitleAndSubmit();

    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0]!.miscDataProps).toEqual({
      ownerUsers: [USER_A],
      ownerTeams: [TEAM_A],
    });
    expect(capturedRequests[0]!.model["title"]).toBe("Checkout is failing");
  });

  test("what onBeforeCreate takes out of the misc data is not sent", async () => {
    await renderForm({
      onBeforeCreate: async (
        item: Incident,
        miscDataProps: JSONObject,
      ): Promise<Incident> => {
        miscDataProps["ownerUsers"] = [USER_A];
        delete miscDataProps["ownerUsers"];
        return item;
      },
    });

    await typeTitleAndSubmit();

    expect(capturedRequests[0]!.miscDataProps).toEqual({});
  });

  test("onBeforeCreate runs once per submit, before the request", async () => {
    await renderForm({});

    await typeTitleAndSubmit();

    expect(receivedFormValues).toHaveLength(1);
    expect(receivedFormValues[0]!["title"]).toBe("Checkout is failing");
    expect(capturedRequests).toHaveLength(1);
  });
});
