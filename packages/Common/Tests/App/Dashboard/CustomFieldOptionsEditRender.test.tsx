import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import React, { ReactElement, useEffect, useState } from "react";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { FormType, ModelField } from "../../../UI/Components/Forms/ModelForm";
import ModelFormModal from "../../../UI/Components/ModelFormModal/ModelFormModal";
import { ComponentProps as ModelTableProps } from "../../../UI/Components/ModelTable/ModelTable";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4564: "When editing an existing incident custom field, there does
 * not appear to be an option to modify the list of available selections."
 *
 * That was the Edit form itself: a field's type cannot be changed once it
 * exists, so the form neither showed nor read it, and the options - shown
 * only under a dropdown type - never appeared on Edit for anyone but a master
 * admin. The table's Edit button now tells the form the field's type, and
 * the save carries the renames the edit makes.
 *
 * Drawn for real, as a PROJECT ADMIN (not a master admin, who may read
 * every column and never saw the bug): the page's own fields in the same
 * ModelFormModal, ModelForm and BasicForm the settings table opens. The
 * stand-in table does what BaseModelTable does around an edit: it runs the
 * page's onBeforeEdit on the row, and hands the page's onBeforeUpdate to the
 * form (ModelTableEditHooks pins that BaseModelTable does).
 */

configure({ asyncUtilTimeout: 15000 });

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const FIELD_ID: string = "33333333-3333-4333-8333-333333333333";

const SAVED_OPTIONS: string = JSON.stringify([
  { value: "Facility A", color: "#ef4444" },
  { value: "Facility B" },
  { value: "Facility C" },
]);

interface MockState {
  // The row the table's Edit button was pressed on.
  row: Record<string, unknown> | null;
  mode: "none" | "create" | "edit";
}

const mockState: MockState = { row: null, mode: "none" };

const createOrUpdateMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const apiPostMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: ModelTableProps<BaseModel>): ReactElement => {
      const fields: Array<ModelField<BaseModel>> = props.formFields || [];
      const [isEditOpen, setIsEditOpen] = useState<boolean>(false);

      // What BaseModelTable's Edit row action does before the form opens.
      useEffect(() => {
        if (mockState.mode !== "edit" || !mockState.row) {
          return;
        }

        const row: BaseModel = Object.assign(
          new props.modelType(),
          mockState.row,
        );

        void (props.onBeforeEdit ? props.onBeforeEdit(row) : Promise.resolve(row)).then(
          () => {
            setIsEditOpen(true);
          },
        );
      }, []);

      if (mockState.mode === "create") {
        return (
          <ModelFormModal<BaseModel>
            title="Create Custom Field"
            modelType={props.modelType}
            submitButtonText="Create Custom Field"
            onClose={() => {}}
            formProps={{
              id: "create-custom-field",
              name: "create-custom-field",
              modelType: props.modelType,
              fields: fields.filter(
                (field: ModelField<BaseModel>): boolean => {
                  return !field.doNotShowWhenCreating;
                },
              ),
              steps: props.formSteps || [],
              formType: FormType.Create,
            }}
          />
        );
      }

      if (!isEditOpen) {
        return <div data-testid="table" />;
      }

      return (
        <ModelFormModal<BaseModel>
          title="Edit Custom Field"
          modelType={props.modelType}
          submitButtonText="Save Changes"
          onClose={() => {}}
          onBeforeUpdate={props.onBeforeUpdate}
          modelIdToEdit={new ObjectID(String(mockState.row?.["_id"]))}
          formProps={{
            id: "edit-custom-field",
            name: "edit-custom-field",
            modelType: props.modelType,
            fields: fields.filter((field: ModelField<BaseModel>): boolean => {
              return !field.doNotShowWhenEditing;
            }),
            steps: props.formSteps || [],
            formType: FormType.Update,
          }}
        />
      );
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
      getCommonHeaders: (): JSONObject => {
        return { tenantid: PROJECT_ID.toString() };
      },
      createOrUpdate: (...args: Array<unknown>): unknown => {
        return createOrUpdateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>): unknown => {
        return apiPostMock(...args);
      },
      getFriendlyMessage: (error: unknown): string => {
        return String(error);
      },
    },
  };
});

// A project admin: may edit custom fields, may not write a field's type.
jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return [Permission.ProjectAdmin];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
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

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): ObjectID => {
        return PROJECT_ID;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Translation", () => {
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

import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import TeamMemberCustomField from "../../../Models/DatabaseModels/TeamMemberCustomField";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import IncidentCustomFields from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentCustomFields";
import TeamMemberCustomFields from "../../../../App/FeatureSet/Dashboard/src/Pages/Users/CustomFields";

interface PageCase {
  name: string;
  render: () => ReactElement;
  modelType: { new (): BaseModel };
  route: string;
  recordPlural: string;
}

const PAGES: Array<PageCase> = [
  {
    name: "incident custom fields",
    render: (): ReactElement => {
      return (
        <IncidentCustomFields
          pageRoute={new Route("/dashboard/project/incidents/settings")}
          currentProject={null}
          hasPaymentMethod={true}
        />
      );
    },
    modelType: IncidentCustomField,
    route: "/incident-custom-field",
    recordPlural: "incidents",
  },
  {
    name: "team member custom fields",
    render: (): ReactElement => {
      return (
        <TeamMemberCustomFields
          pageRoute={new Route("/dashboard/project/settings")}
          currentProject={null}
          hasPaymentMethod={true}
        />
      );
    },
    modelType: TeamMemberCustomField,
    route: "/team-member-custom-field",
    recordPlural: "team members",
  },
];

function answerField(data: {
  modelType: { new (): BaseModel };
  customFieldType: CustomFieldType;
  dropdownOptions?: string;
}): void {
  getItemMock.mockImplementation((() => {
    return Promise.resolve(
      Object.assign(new data.modelType(), {
        _id: FIELD_ID,
        name: "Facility",
        description: "Where it happened",
        dropdownOptions: data.dropdownOptions,
      }),
    );
  }) as never);

  mockState.row = {
    _id: FIELD_ID,
    name: "Facility",
    customFieldType: data.customFieldType,
  };
}

async function openEdit(page: PageCase): Promise<HTMLElement> {
  mockState.mode = "edit";

  await act(async (): Promise<void> => {
    render(page.render());
  });

  return await waitFor(() => {
    return screen.getByRole("dialog", { name: "Edit Custom Field" });
  });
}

function savedCall(): { model: BaseModel; miscDataProps: JSONObject } {
  return createOrUpdateMock.mock.calls[0]![0] as {
    model: BaseModel;
    miscDataProps: JSONObject;
  };
}

beforeEach(() => {
  mockState.mode = "none";
  mockState.row = null;
  PermissionGate.clearPermissionPropsCache();
  createOrUpdateMock.mockReset().mockImplementation(((data: {
    model: BaseModel;
  }): Promise<unknown> => {
    return Promise.resolve({ data: data.model });
  }) as never);
  getItemMock.mockReset();
  getListMock.mockReset().mockResolvedValue({
    data: [],
    count: 0,
    skip: 0,
    limit: 0,
  } as never);
  apiPostMock.mockReset().mockResolvedValue(
    new HTTPResponse(
      200,
      {
        values: [
          { value: "Facility A", count: 12 },
          { value: "Facility B", count: 4 },
          { value: "Old Site", count: 3 },
        ],
        copiedBy: [],
      },
      {},
    ) as never,
  );
});

afterEach(() => {
  cleanup();
});

describe.each(PAGES)("editing a saved dropdown field: $name", (page: PageCase) => {
  test("the Edit form shows the field's options to a project admin", async () => {
    answerField({
      modelType: page.modelType,
      customFieldType: CustomFieldType.Dropdown,
      dropdownOptions: SAVED_OPTIONS,
    });

    const form: HTMLElement = await openEdit(page);

    expect(await within(form).findByText("Dropdown Options")).toBeVisible();
    await waitFor(() => {
      expect(
        (within(form).getByTestId("dropdown-option-value-0") as HTMLInputElement)
          .value,
      ).toBe("Facility A");
    });
    expect(
      (within(form).getByTestId("dropdown-option-value-2") as HTMLInputElement)
        .value,
    ).toBe("Facility C");

    // The type is not offered: nobody may change it once the field exists.
    expect(within(form).queryByRole("combobox", { name: "Field Type" })).toBeNull();
  });

  test("so does a multi-select field's", async () => {
    answerField({
      modelType: page.modelType,
      customFieldType: CustomFieldType.MultiSelectDropdown,
      dropdownOptions: "One\nTwo",
    });

    const form: HTMLElement = await openEdit(page);

    expect(await within(form).findByText("Dropdown Options")).toBeVisible();
  });

  test("a field that is not a dropdown has no options to edit", async () => {
    answerField({
      modelType: page.modelType,
      customFieldType: CustomFieldType.Text,
    });

    const form: HTMLElement = await openEdit(page);

    await within(form).findByRole("textbox", { name: "Field Name" });

    expect(within(form).queryByText("Dropdown Options")).toBeNull();
  });

  test("asks how many records hold each value, and says it", async () => {
    answerField({
      modelType: page.modelType,
      customFieldType: CustomFieldType.Dropdown,
      dropdownOptions: SAVED_OPTIONS,
    });

    const form: HTMLElement = await openEdit(page);

    expect(
      await within(form).findByTestId("dropdown-option-retired-count-0"),
    ).toHaveTextContent(`3 ${page.recordPlural} have it.`);

    const request: {
      url: { toString: () => string };
      headers: JSONObject;
    } = apiPostMock.mock.calls[0]![0] as {
      url: { toString: () => string };
      headers: JSONObject;
    };

    expect(request.url.toString()).toContain(
      `${page.route}/${FIELD_ID}/option-usage`,
    );
    // The project the counts are of.
    expect(request.headers).toEqual({ tenantid: PROJECT_ID.toString() });
  });

  test("saves a renamed option with its rename, so the records holding it follow", async () => {
    answerField({
      modelType: page.modelType,
      customFieldType: CustomFieldType.Dropdown,
      dropdownOptions: SAVED_OPTIONS,
    });

    const user: UserEvent = userEvent.setup({ delay: null });
    const form: HTMLElement = await openEdit(page);

    const first: HTMLInputElement = (await within(form).findByTestId(
      "dropdown-option-value-0",
    )) as HTMLInputElement;

    await waitFor(() => {
      expect(first.value).toBe("Facility A");
    });

    fireEvent.change(first, { target: { value: "Facility Alpha" } });

    expect(
      await within(form).findByTestId("dropdown-option-renamed-0"),
    ).toHaveTextContent(
      `Renamed from "Facility A": 12 ${page.recordPlural} will show the new name.`,
    );

    await user.click(within(form).getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const saved: { model: BaseModel; miscDataProps: JSONObject } = savedCall();

    expect(JSON.parse(String(saved.model.getColumnValue("dropdownOptions")))).toEqual([
      { value: "Facility Alpha", color: "#ef4444" },
      { value: "Facility B" },
      { value: "Facility C" },
    ]);
    expect(saved.miscDataProps["renamedDropdownOptions"]).toEqual([
      { from: "Facility A", to: "Facility Alpha" },
    ]);
    // The type is never sent: nobody may write it.
    expect(
      (saved.model as unknown as Record<string, unknown>)["customFieldType"],
    ).toBeUndefined();
  });

  test("an edit that renames nothing sends no renames", async () => {
    answerField({
      modelType: page.modelType,
      customFieldType: CustomFieldType.Dropdown,
      dropdownOptions: SAVED_OPTIONS,
    });

    const user: UserEvent = userEvent.setup({ delay: null });
    const form: HTMLElement = await openEdit(page);

    await within(form).findByTestId("dropdown-option-value-0");

    await user.click(within(form).getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    expect(savedCall().miscDataProps["renamedDropdownOptions"]).toBeUndefined();
  });

  test("two options of the same name stop the save, and say which", async () => {
    answerField({
      modelType: page.modelType,
      customFieldType: CustomFieldType.Dropdown,
      dropdownOptions: SAVED_OPTIONS,
    });

    const user: UserEvent = userEvent.setup({ delay: null });
    const form: HTMLElement = await openEdit(page);

    const first: HTMLInputElement = (await within(form).findByTestId(
      "dropdown-option-value-0",
    )) as HTMLInputElement;

    await waitFor(() => {
      expect(first.value).toBe("Facility A");
    });

    fireEvent.change(first, { target: { value: "Facility B" } });

    await user.click(within(form).getByRole("button", { name: "Save Changes" }));

    expect(
      await within(form).findByText(
        'Each option needs its own name: "Facility B" is listed more than once.',
      ),
    ).toBeVisible();
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });

  test("counts that cannot be read leave the options editable", async () => {
    apiPostMock.mockReset().mockRejectedValue(new Error("down") as never);

    answerField({
      modelType: page.modelType,
      customFieldType: CustomFieldType.Dropdown,
      dropdownOptions: SAVED_OPTIONS,
    });

    const form: HTMLElement = await openEdit(page);

    const first: HTMLInputElement = (await within(form).findByTestId(
      "dropdown-option-value-0",
    )) as HTMLInputElement;

    await waitFor(() => {
      expect(first.value).toBe("Facility A");
    });

    fireEvent.change(first, { target: { value: "Facility Alpha" } });

    expect(
      await within(form).findByTestId("dropdown-option-renamed-0"),
    ).toHaveTextContent('Renamed from "Facility A".');
  });
});

describe("creating a field", () => {
  test("its options are a plain list: no counts are asked for and nothing is renamed", async () => {
    mockState.mode = "create";

    await act(async (): Promise<void> => {
      render(PAGES[0]!.render());
    });

    const form: HTMLElement = await waitFor(() => {
      return screen.getByRole("dialog", { name: "Create Custom Field" });
    });

    await within(form).findByRole("textbox", { name: "Field Name" });

    expect(apiPostMock).not.toHaveBeenCalled();
    expect(within(form).queryByText("Dropdown Options")).toBeNull();
  });
});
