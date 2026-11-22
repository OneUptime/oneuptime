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
 * A SUBMIT THE PERSON CALLED BACK (#10436).
 *
 * A form's onBeforeCreate can ask the person first - a drop filter that
 * takes what monitors read asks "Create This Filter?" - and a "no" is
 * thrown as FormSubmitCancelled. Through the real ModelForm and BasicForm,
 * with only the network stubbed: nothing is sent, no error is drawn, the
 * form is left to submit again; and any other error is still said.
 */

let createCalls: number = 0;

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
      }): Promise<{ data: JSONObject }> => {
        createCalls++;
        return { data: data.model };
      },
    },
  };
});

import LogDropFilter from "../../../../Models/DatabaseModels/LogDropFilter";
import ModelForm, {
  FormType,
  ModelField,
} from "../../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormSubmitCancelled from "../../../../UI/Components/Forms/Types/FormSubmitCancelled";

const NAME_FIELD: ModelField<LogDropFilter> = {
  field: { name: true },
  title: "Name",
  fieldType: FormFieldSchemaType.Text,
  required: true,
  placeholder: "Filter Name",
};

async function renderForm(data: {
  onBeforeCreate: (item: LogDropFilter) => Promise<LogDropFilter>;
  onSuccess: () => void;
}): Promise<void> {
  await act(async (): Promise<void> => {
    render(
      <ModelForm<LogDropFilter>
        modelType={LogDropFilter}
        id="create-drop-filter-form"
        name="Create Log Drop Filter"
        fields={[NAME_FIELD]}
        formType={FormType.Create}
        onBeforeCreate={data.onBeforeCreate}
        onSuccess={data.onSuccess}
        submitButtonText="Create Log Drop Filter"
      />,
    );
  });
}

async function typeAndSubmit(): Promise<void> {
  fireEvent.change(screen.getByPlaceholderText("Filter Name"), {
    target: { value: "Debug lines" },
  });

  await act(async (): Promise<void> => {
    fireEvent.click(
      screen.getByRole("button", { name: "Create Log Drop Filter" }),
    );
  });
}

afterEach(() => {
  cleanup();
  createCalls = 0;
});

describe("a submit called back from onBeforeCreate", () => {
  test("sends nothing, says nothing went wrong, and the form can be submitted again", async () => {
    let isAnsweredNo: boolean = true;
    const onSuccess: jest.Mock = jest.fn();

    await renderForm({
      onBeforeCreate: async (item: LogDropFilter): Promise<LogDropFilter> => {
        if (isAnsweredNo) {
          throw new FormSubmitCancelled();
        }

        return item;
      },
      onSuccess,
    });

    await typeAndSubmit();

    expect(createCalls).toBe(0);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create Log Drop Filter" }),
    ).not.toBeDisabled();

    // Asked again, and told yes: it saves as ever.
    isAnsweredNo = false;
    await act(async (): Promise<void> => {
      fireEvent.click(
        screen.getByRole("button", { name: "Create Log Drop Filter" }),
      );
    });

    expect(createCalls).toBe(1);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  test("any other error from the hook is still said", async () => {
    await renderForm({
      onBeforeCreate: async (): Promise<LogDropFilter> => {
        throw new Error("This filter's query is not one OneUptime can read.");
      },
      onSuccess: jest.fn(),
    });

    await typeAndSubmit();

    expect(createCalls).toBe(0);
    expect(
      await screen.findByText(
        "This filter's query is not one OneUptime can read.",
      ),
    ).toBeInTheDocument();
  });

  test("is known however it was made", () => {
    const fromAnotherCopy: Error = new Error("called back");

    fromAnotherCopy.name = "FormSubmitCancelled";

    expect(FormSubmitCancelled.isCancelled(new FormSubmitCancelled())).toBe(
      true,
    );
    expect(FormSubmitCancelled.isCancelled(fromAnotherCopy)).toBe(true);
    expect(FormSubmitCancelled.isCancelled(new Error("x"))).toBe(false);
    expect(FormSubmitCancelled.isCancelled(undefined)).toBe(false);
  });
});
