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
 * TWO FIELDS FOR ONE COLUMN, EACH SHOWN ONLY ON A CONDITION, ARE BOTH KEPT.
 *
 * ModelForm drops a second field for a column it already has - a form
 * listing a column twice by mistake draws it once. But a field whose help,
 * fold or need follows a choice made above it is written once for each
 * answer that shows it: a Twilio config's SMS numbers are required and open
 * when the account is used for SMS only, and optional and folded when it
 * makes calls too (Dashboard CallSMSConfigTable). When both carry a showIf,
 * ModelForm keeps both, and the form shows the one whose condition holds;
 * both edit the same value.
 */

type CapturedRequest = {
  model: JSONObject;
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
      }): Promise<{ data: JSONObject }> => {
        capturedRequests.push({ model: data.model });
        return { data: data.model };
      },
    },
  };
});

import ProjectCallSMSConfig from "../../../../Models/DatabaseModels/ProjectCallSMSConfig";
import ModelForm, {
  FormType,
  ModelField,
} from "../../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";

const isSmsOnly: (values: FormValues<ProjectCallSMSConfig>) => boolean = (
  values: FormValues<ProjectCallSMSConfig>,
): boolean => {
  return values.usedFor === "SMS only";
};

const ALTERNATIVES: Array<ModelField<ProjectCallSMSConfig>> = [
  {
    field: { usedFor: true },
    title: "Use This Account For",
    fieldType: FormFieldSchemaType.RadioButton,
    required: true,
    defaultValue: "Calls and SMS",
    radioButtonOptions: [
      { title: "Calls and SMS", value: "Calls and SMS" },
      { title: "SMS only", value: "SMS only" },
    ],
  },
  {
    field: { twilioSmsPhoneNumbers: true },
    title: "Twilio SMS Phone Numbers",
    description: "Required for SMS only.",
    fieldType: FormFieldSchemaType.Text,
    required: true,
    showIf: isSmsOnly,
  },
  {
    field: { twilioSmsPhoneNumbers: true },
    title: "Twilio SMS Phone Numbers",
    description: "Optional for calls and SMS.",
    fieldType: FormFieldSchemaType.Text,
    required: false,
    showIf: (values: FormValues<ProjectCallSMSConfig>): boolean => {
      return !isSmsOnly(values);
    },
  },
];

async function renderForm(
  fields: Array<ModelField<ProjectCallSMSConfig>>,
): Promise<void> {
  await act(async (): Promise<void> => {
    render(
      <ModelForm<ProjectCallSMSConfig>
        modelType={ProjectCallSMSConfig}
        id="alternatives-form"
        fields={fields}
        formType={FormType.Create}
        submitButtonText="Save"
      />,
    );
  });

  await screen.findByText("Use This Account For");
}

async function pick(answer: string): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(screen.getByRole("radio", { name: answer }));
  });
}

async function save(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
  });
}

afterEach(() => {
  cleanup();
  capturedRequests = [];
  jest.clearAllMocks();
});

describe("two fields for one column, each on a condition", () => {
  test("shows the one whose condition holds, and only that one", async () => {
    await renderForm(ALTERNATIVES);

    expect(screen.getByText("Optional for calls and SMS.")).toBeVisible();
    expect(screen.queryByText("Required for SMS only.")).toBeNull();
    expect(screen.getAllByText("Twilio SMS Phone Numbers")).toHaveLength(1);

    await pick("SMS only");

    expect(await screen.findByText("Required for SMS only.")).toBeVisible();
    expect(screen.queryByText("Optional for calls and SMS.")).toBeNull();
    expect(screen.getAllByText("Twilio SMS Phone Numbers")).toHaveLength(1);
  });

  test("each is held to its own need", async () => {
    await renderForm(ALTERNATIVES);

    // Optional while calls and SMS is picked: saves without it.
    await save();

    await waitFor(() => {
      expect(capturedRequests).toHaveLength(1);
    });

    capturedRequests = [];
    cleanup();

    await renderForm(ALTERNATIVES);
    await pick("SMS only");
    await save();

    expect(
      await screen.findByText("Twilio SMS Phone Numbers is required."),
    ).toBeVisible();
    expect(capturedRequests).toHaveLength(0);
  });

  test("both edit the one value: what is typed in one is in the other", async () => {
    await renderForm(ALTERNATIVES);

    await act(async (): Promise<void> => {
      fireEvent.change(
        screen.getByLabelText("Twilio SMS Phone Numbers", { exact: false }),
        { target: { value: "+6581234567" } },
      );
    });

    await pick("SMS only");

    expect(
      screen.getByLabelText("Twilio SMS Phone Numbers", { exact: false }),
    ).toHaveValue("+6581234567");

    await save();

    await waitFor(() => {
      expect(capturedRequests).toHaveLength(1);
    });
    expect(capturedRequests[0]!.model["twilioSmsPhoneNumbers"]).toBe(
      "+6581234567",
    );
    expect(capturedRequests[0]!.model["usedFor"]).toBe("SMS only");
  });
});

describe("a column listed twice without a condition on both", () => {
  test("is drawn once, as the first lists it", async () => {
    await renderForm([
      ALTERNATIVES[0]!,
      {
        field: { twilioSmsPhoneNumbers: true },
        title: "Twilio SMS Phone Numbers",
        description: "The first.",
        fieldType: FormFieldSchemaType.Text,
        required: false,
      },
      {
        field: { twilioSmsPhoneNumbers: true },
        title: "Twilio SMS Phone Numbers",
        description: "The second, with a condition.",
        fieldType: FormFieldSchemaType.Text,
        required: false,
        showIf: (): boolean => {
          return true;
        },
      },
    ]);

    expect(screen.getByText("The first.")).toBeVisible();
    expect(screen.queryByText("The second, with a condition.")).toBeNull();
  });
});
