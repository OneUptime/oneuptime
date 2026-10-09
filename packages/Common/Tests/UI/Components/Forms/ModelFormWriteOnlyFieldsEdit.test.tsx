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
 * AN EDIT FORM LOADS WHAT THE USER MAY READ, AND KEEPS WHAT THEY MAY ONLY
 * WRITE.
 *
 * An LLM provider's API key and Additional Parameters are read by the
 * project's owners and admins alone, but everyone who may change the
 * provider may replace them. The GET that prefills an edit form is refused
 * outright for one column the caller may not read (SelectPermission), so the
 * form used to open on an error for those members. Now:
 *
 *   - the form loads only the fields the user may read;
 *   - a field they may write but not read starts empty, says that leaving it
 *     blank keeps what is stored, and is never required;
 *   - left blank, it is not sent, so the stored value stays; filled in, it
 *     is sent like any other field.
 */

let permissionsForTest: Array<unknown> = [];

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
import PermissionGate from "../../../../UI/Utils/PermissionGate";
import LlmProvider from "../../../../Models/DatabaseModels/LlmProvider";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";

const PROVIDER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

const KEY_HELP: string = "The key the provider issued you.";
const KEEP_HINT: string = "Leave blank to keep the stored value.";

let capturedSelect: Record<string, unknown> | null = null;
let savedModels: Array<JSONObject> = [];

function makeModelAPI(): typeof ModelAPI {
  return {
    getItem: async (data: {
      select: Record<string, unknown>;
    }): Promise<LlmProvider | null> => {
      capturedSelect = data.select;

      const provider: LlmProvider = new LlmProvider();
      provider._id = PROVIDER_ID.toString();
      provider.name = "Project provider";

      // The API answers what was asked for, and nothing else.
      if (data.select["apiKey"]) {
        provider.apiKey = "sk-stored";
      }

      return provider;
    },
    getList: async (): Promise<JSONObject> => {
      return { data: [], count: 0, skip: 0, limit: 10 };
    },
    getCommonHeaders: (): JSONObject => {
      return {};
    },
    createOrUpdate: async (data: {
      model: LlmProvider;
    }): Promise<{ data: JSONObject }> => {
      savedModels.push(LlmProvider.toJSON(data.model, LlmProvider));
      return { data: {} };
    },
  } as unknown as typeof ModelAPI;
}

const FIELDS: Array<ModelField<LlmProvider>> = [
  {
    field: { name: true },
    title: "Name",
    fieldType: FormFieldSchemaType.Text,
    required: true,
    placeholder: "My provider",
  },
  {
    field: { apiKey: true },
    title: "API Key",
    fieldType: FormFieldSchemaType.Text,
    required: true,
    placeholder: "sk-...",
    description: KEY_HELP,
  },
];

async function renderEditForm(): Promise<void> {
  await act(async (): Promise<void> => {
    render(
      <ModelForm<LlmProvider>
        modelType={LlmProvider}
        modelAPI={makeModelAPI()}
        id="llm-provider-edit-form"
        name="LLM Provider"
        fields={FIELDS}
        formType={FormType.Update}
        modelIdToEdit={PROVIDER_ID}
        submitButtonText="Save"
        onSuccess={() => {
          // not exercised
        }}
      />,
    );
  });

  await waitFor(() => {
    expect(capturedSelect).not.toBeNull();
  });

  await screen.findByPlaceholderText("My provider");
}

async function save(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
  });

  await waitFor(() => {
    expect(savedModels.length).toBe(1);
  });
}

describe("an edit form for a member who may change the provider but not read its key", () => {
  beforeEach(() => {
    capturedSelect = null;
    savedModels = [];
    permissionsForTest = [Permission.SettingsMember];
    PermissionGate.clearPermissionPropsCache();
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("loads only what the member may read", async () => {
    await renderEditForm();

    expect(capturedSelect?.["name"]).toBe(true);
    expect(capturedSelect?.["apiKey"]).toBeUndefined();
  });

  test("offers the key empty, says blank keeps the stored one, and does not require it", async () => {
    await renderEditForm();

    const keyInput: HTMLInputElement = screen.getByPlaceholderText(
      "Unchanged",
    ) as HTMLInputElement;

    expect(keyInput.value).toBe("");
    expect(screen.getByText(`${KEY_HELP} ${KEEP_HINT}`)).toBeInTheDocument();
    expect(keyInput).not.toBeRequired();
  });

  test("saving without touching the key leaves it out, so the stored one stays", async () => {
    await renderEditForm();

    fireEvent.change(screen.getByPlaceholderText("My provider"), {
      target: { value: "Renamed provider" },
    });

    await save();

    expect(savedModels[0]?.["name"]).toBe("Renamed provider");
    expect("apiKey" in (savedModels[0] || {})).toBe(false);
  });

  test("a key typed in is sent", async () => {
    await renderEditForm();

    fireEvent.change(screen.getByPlaceholderText("Unchanged"), {
      target: { value: "sk-new" },
    });

    await save();

    expect(savedModels[0]?.["apiKey"]).toBe("sk-new");
  });

  test("spaces alone are blank: the stored key stays", async () => {
    await renderEditForm();

    fireEvent.change(screen.getByPlaceholderText("Unchanged"), {
      target: { value: "   " },
    });

    await save();

    expect("apiKey" in (savedModels[0] || {})).toBe(false);
  });
});

describe("an edit form for a project owner, who may read the key", () => {
  beforeEach(() => {
    capturedSelect = null;
    savedModels = [];
    permissionsForTest = [Permission.ProjectOwner];
    PermissionGate.clearPermissionPropsCache();
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("loads the key, shows it, and says nothing about keeping it", async () => {
    await renderEditForm();

    expect(capturedSelect?.["apiKey"]).toBe(true);
    expect(
      (screen.getByPlaceholderText("sk-...") as HTMLInputElement).value,
    ).toBe("sk-stored");
    expect(screen.queryByText(new RegExp(KEEP_HINT))).toBeNull();
  });
});
