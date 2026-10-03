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
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * onBeforeUpdate: the Update form's twin of onBeforeCreate. It is handed the
 * model about to be saved, the misc data the request carries and every value
 * the form holds, and what it returns is what is saved. An escalation rule's
 * edit dialog uses it to save a cleared name as the level's name ("Level 2")
 * and to keep the Notify picker's picks for the join rows it reconciles.
 */

type CapturedRequest = {
  model: JSONObject;
  miscDataProps: JSONObject;
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
        miscDataProps: JSONObject;
        formType: string;
      }): Promise<{ data: JSONObject }> => {
        capturedRequests.push({
          model: data.model,
          miscDataProps: { ...data.miscDataProps },
          formType: data.formType,
        });
        return { data: data.model };
      },
    },
  };
});

import OnCallDutyPolicyEscalationRule from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import ObjectID from "../../../../Types/ObjectID";
import ModelForm, {
  FormType,
  ModelField,
  ModelFormOnBeforeUpdate,
} from "../../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import ModelFormModal from "../../../../UI/Components/ModelFormModal/ModelFormModal";

const RULE_ID: string = "22222222-2222-4222-8222-222222222221";

const FIELDS: Array<ModelField<OnCallDutyPolicyEscalationRule>> = [
  {
    field: { name: true },
    title: "Name",
    fieldType: FormFieldSchemaType.Text,
    required: false,
    placeholder: "Level 2",
  },
  {
    field: { escalateAfterInMinutes: true },
    title: "Escalate after (in minutes)",
    fieldType: FormFieldSchemaType.Number,
    required: true,
    placeholder: "30",
  },
  {
    overrideField: { users: true },
    overrideFieldKey: "users",
    showEvenIfPermissionDoesNotExist: true,
    title: "Users",
    fieldType: FormFieldSchemaType.Text,
    required: false,
  },
];

const INITIAL_VALUES: FormValues<OnCallDutyPolicyEscalationRule> = {
  name: "Managers",
  escalateAfterInMinutes: 15,
  users: "user-1",
} as unknown as FormValues<OnCallDutyPolicyEscalationRule>;

interface HookCall {
  item: OnCallDutyPolicyEscalationRule;
  miscDataProps: JSONObject;
  formValues: JSONObject;
}

let hookCalls: Array<HookCall> = [];

const renameToLevelTwo: ModelFormOnBeforeUpdate<
  OnCallDutyPolicyEscalationRule
> = async (
  item: OnCallDutyPolicyEscalationRule,
  miscDataProps: JSONObject,
  formValues: JSONObject,
): Promise<OnCallDutyPolicyEscalationRule> => {
  hookCalls.push({ item, miscDataProps: { ...miscDataProps }, formValues });

  if (!item.name?.toString().trim()) {
    item.name = "Level 2";
  }

  delete miscDataProps["users"];

  return item;
};

async function clearNameAndSave(buttonText: string): Promise<void> {
  const nameInput: HTMLElement = await screen.findByPlaceholderText("Level 2");

  expect(nameInput).toHaveValue("Managers");

  fireEvent.change(nameInput, { target: { value: "" } });

  await act(async (): Promise<void> => {
    fireEvent.click(screen.getByRole("button", { name: buttonText }));
  });

  await waitFor(() => {
    expect(capturedRequests).toHaveLength(1);
  });
}

afterEach(() => {
  cleanup();
  capturedRequests = [];
  hookCalls = [];
  jest.clearAllMocks();
});

describe("ModelForm's onBeforeUpdate", () => {
  test("runs on an Update form, and what it returns is what is saved", async () => {
    await act(async (): Promise<void> => {
      render(
        <ModelForm<OnCallDutyPolicyEscalationRule>
          modelType={OnCallDutyPolicyEscalationRule}
          id="edit-rule-form"
          fields={FIELDS}
          formType={FormType.Update}
          modelIdToEdit={new ObjectID(RULE_ID)}
          doNotFetchExistingModel={true}
          initialValues={INITIAL_VALUES}
          submitButtonText="Save Changes"
          onBeforeUpdate={renameToLevelTwo}
        />,
      );
    });

    await clearNameAndSave("Save Changes");

    expect(hookCalls).toHaveLength(1);

    const call: HookCall = hookCalls[0]!;

    // The model about to be saved, with its id.
    expect(call.item).toBeInstanceOf(OnCallDutyPolicyEscalationRule);
    expect(call.item._id?.toString()).toBe(RULE_ID);
    // The misc data the request was going to carry.
    expect(call.miscDataProps).toEqual({ users: "user-1" });
    // Every value the form holds, columns or not.
    expect(call.formValues["users"]).toBe("user-1");
    expect(call.formValues["name"]).toBe("");

    const request: CapturedRequest = capturedRequests[0]!;

    expect(request.formType).toBe(FormType.Update);
    expect(request.model["name"]).toBe("Level 2");
    expect(request.model["escalateAfterInMinutes"]).toBe(15);
    // What the hook took out of the misc data is not sent.
    expect(request.miscDataProps).toEqual({});
  });

  test("does not run on a Create form", async () => {
    await act(async (): Promise<void> => {
      render(
        <ModelForm<OnCallDutyPolicyEscalationRule>
          modelType={OnCallDutyPolicyEscalationRule}
          id="create-rule-form"
          fields={FIELDS}
          formType={FormType.Create}
          initialValues={INITIAL_VALUES}
          submitButtonText="Create Rule"
          onBeforeUpdate={renameToLevelTwo}
        />,
      );
    });

    await clearNameAndSave("Create Rule");

    expect(hookCalls).toHaveLength(0);
    expect(capturedRequests[0]!.model["name"]).toBe("");
  });

  test("an Update form does not run onBeforeCreate", async () => {
    const onBeforeCreate: MockFunction = getJestMockFunction();

    onBeforeCreate.mockImplementation(
      async (
        item: OnCallDutyPolicyEscalationRule,
      ): Promise<OnCallDutyPolicyEscalationRule> => {
        return item;
      },
    );

    await act(async (): Promise<void> => {
      render(
        <ModelForm<OnCallDutyPolicyEscalationRule>
          modelType={OnCallDutyPolicyEscalationRule}
          id="edit-rule-form"
          fields={FIELDS}
          formType={FormType.Update}
          modelIdToEdit={new ObjectID(RULE_ID)}
          doNotFetchExistingModel={true}
          initialValues={INITIAL_VALUES}
          submitButtonText="Save Changes"
          onBeforeCreate={onBeforeCreate as never}
          onBeforeUpdate={renameToLevelTwo}
        />,
      );
    });

    await clearNameAndSave("Save Changes");

    expect(onBeforeCreate).not.toHaveBeenCalled();
    expect(hookCalls).toHaveLength(1);
  });
});

describe("ModelFormModal's onBeforeUpdate", () => {
  test("is handed to its form, which saves what it returns", async () => {
    const onSuccess: MockFunction = getJestMockFunction();

    await act(async (): Promise<void> => {
      render(
        <ModelFormModal<OnCallDutyPolicyEscalationRule>
          title="Edit Escalation Rule"
          modelType={OnCallDutyPolicyEscalationRule}
          modelIdToEdit={new ObjectID(RULE_ID)}
          submitButtonText="Save Changes"
          initialValues={INITIAL_VALUES}
          onBeforeUpdate={renameToLevelTwo}
          onSuccess={onSuccess as never}
          formProps={{
            id: "edit-rule-form",
            modelType: OnCallDutyPolicyEscalationRule,
            formType: FormType.Update,
            fields: FIELDS,
            doNotFetchExistingModel: true,
          }}
        />,
      );
    });

    await clearNameAndSave("Save Changes");

    expect(hookCalls).toHaveLength(1);
    expect(capturedRequests[0]!.model["name"]).toBe("Level 2");

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });

    // The modal's onSuccess sees the model as saved.
    const saved: OnCallDutyPolicyEscalationRule = onSuccess.mock
      .calls[0]![0] as OnCallDutyPolicyEscalationRule;

    expect(saved.name).toBe("Level 2");
  });
});
