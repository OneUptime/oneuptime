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
import React, { ReactElement } from "react";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { CardButtonSchema } from "../../../UI/Components/Card/Card";
import { FormType, ModelField } from "../../../UI/Components/Forms/ModelForm";
import ModelFormModal from "../../../UI/Components/ModelFormModal/ModelFormModal";
import { ComponentProps as ModelTableProps } from "../../../UI/Components/ModelTable/ModelTable";
import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The incident custom field forms, drawn for real: the page's own fields in
 * the same ModelFormModal, ModelForm and BasicForm the settings table opens,
 * with only the network, the permissions and the table around them stubbed.
 *
 * The maintainer's ask, as it appears on screen:
 *
 *   - Create shows Field Name, Field Description and Field Type, no step
 *     list, no "Map Value From", and a folded Advanced section holding Show
 *     on Create and the other incident settings;
 *   - Edit keeps every option, under the same folded Advanced, which says
 *     "Configured" because something in it is set - the mapping included;
 *   - the card's More menu opens Create Mapped Custom Field, which asks for
 *     the monitor field to copy, a name and a description, names the field
 *     after the one it copies, says which type it will have, and saves it
 *     with that field's type and options.
 */

configure({ asyncUtilTimeout: 15000 });

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const FIELD_ID: string = "33333333-3333-4333-8333-333333333333";

const REGION_OPTIONS: string = JSON.stringify([
  { label: "us-east-1", color: "#4f46e5" },
  { label: "eu-west-1" },
]);

interface MockTable {
  mode: "none" | "create" | "edit";
}

const mockTable: MockTable = { mode: "none" };

const createOrUpdateMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: ModelTableProps<IncidentCustomField>): ReactElement => {
      const fields: Array<ModelField<IncidentCustomField>> =
        props.formFields || [];

      return (
        <div>
          {/* The card's More menu, as plain buttons. */}
          {(props.cardProps?.buttons || []).map(
            (button: CardButtonSchema | ReactElement, index: number) => {
              const schema: CardButtonSchema = button as CardButtonSchema;

              return (
                <button
                  key={index}
                  type="button"
                  disabled={schema.disabled}
                  onClick={() => {
                    schema.onClick?.();
                  }}
                >
                  {schema.title}
                </button>
              );
            },
          )}

          {/* What the real table opens from Create and from a row's Edit. */}
          {mockTable.mode === "create" && (
            <ModelFormModal<IncidentCustomField>
              title="Create New Incident Custom Field"
              modelType={props.modelType}
              submitButtonText="Create Incident Custom Field"
              onClose={() => {}}
              formProps={{
                id: "create-IncidentCustomField-from",
                name: "create-IncidentCustomField-from",
                modelType: props.modelType,
                fields: fields.filter(
                  (field: ModelField<IncidentCustomField>): boolean => {
                    return !field.doNotShowWhenCreating;
                  },
                ),
                steps: props.formSteps || [],
                formType: FormType.Create,
              }}
            />
          )}

          {mockTable.mode === "edit" && (
            <ModelFormModal<IncidentCustomField>
              title="Edit Incident Custom Field"
              modelType={props.modelType}
              submitButtonText="Save Changes"
              onClose={() => {}}
              modelIdToEdit={new ObjectID(FIELD_ID)}
              formProps={{
                id: "create-IncidentCustomField-from",
                name: "create-IncidentCustomField-from",
                modelType: props.modelType,
                fields: fields.filter(
                  (field: ModelField<IncidentCustomField>): boolean => {
                    return !field.doNotShowWhenEditing;
                  },
                ),
                steps: props.formSteps || [],
                formType: FormType.Update,
              }}
            />
          )}
        </div>
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
        return {};
      },
      createOrUpdate: (...args: Array<unknown>): unknown => {
        return createOrUpdateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return [Permission.ProjectOwner];
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
        return true;
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

import IncidentCustomFields from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentCustomFields";
import MonitorCustomField from "../../../Models/DatabaseModels/MonitorCustomField";
import Route from "../../../Types/API/Route";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import {
  hasSetChip,
  setChips,
} from "../../UI/Components/FoldedSection/FoldedSectionQueries";

interface MonitorFieldRow {
  name: string;
  customFieldType: CustomFieldType;
  dropdownOptions?: string;
}

const MONITOR_FIELDS: Array<MonitorFieldRow> = [
  {
    name: "Region",
    customFieldType: CustomFieldType.Dropdown,
    dropdownOptions: REGION_OPTIONS,
  },
  { name: "Vendor", customFieldType: CustomFieldType.Text },
];

// The monitor's custom fields: all of them, or the one a query names.
function answerMonitorFields(): void {
  getListMock.mockImplementation(((data: {
    query?: { name?: string };
  }): Promise<unknown> => {
    const rows: Array<MonitorFieldRow> = MONITOR_FIELDS.filter(
      (row: MonitorFieldRow): boolean => {
        return !data.query?.name || data.query.name === row.name;
      },
    );

    return Promise.resolve({
      data: rows.map((row: MonitorFieldRow) => {
        return Object.assign(new MonitorCustomField(), row);
      }),
      count: rows.length,
      skip: 0,
      limit: rows.length,
    });
  }) as never);
}

async function renderPage(mode: MockTable["mode"]): Promise<UserEvent> {
  mockTable.mode = mode;

  await act(async (): Promise<void> => {
    render(
      <IncidentCustomFields
        pageRoute={new Route("/dashboard/project/incidents/settings")}
        currentProject={null}
        hasPaymentMethod={true}
      />,
    );
  });

  return userEvent.setup({ delay: null });
}

function dialog(name: string): HTMLElement {
  return screen.getByRole("dialog", { name });
}

function savedModel(): BaseModel {
  return (createOrUpdateMock.mock.calls[0]?.[0] as { model: BaseModel }).model;
}

function savedMiscData(): JSONObject {
  return (
    createOrUpdateMock.mock.calls[0]?.[0] as { miscDataProps: JSONObject }
  ).miscDataProps;
}

// react-select opens on a click; its options are portalled to the body.
async function pickOption(
  user: UserEvent,
  combobox: HTMLElement,
  optionText: string,
): Promise<void> {
  await user.click(combobox);
  const options: Array<HTMLElement> = await screen.findAllByText(optionText, {
    exact: true,
  });
  await user.click(options[options.length - 1]!);
}

beforeEach(() => {
  mockTable.mode = "none";
  createOrUpdateMock.mockReset().mockImplementation(((data: {
    model: BaseModel;
  }): Promise<unknown> => {
    return Promise.resolve({ data: data.model });
  }) as never);
  getItemMock.mockReset();
  getListMock.mockReset();
  answerMonitorFields();
});

afterEach(() => {
  cleanup();
});

describe("Create New Incident Custom Field", () => {
  const NAME: string = "Create New Incident Custom Field";

  test("shows the name, the description and the type, on one page", async () => {
    await renderPage("create");

    const form: HTMLElement = await waitFor(() => {
      return dialog(NAME);
    });

    expect(
      await within(form).findByRole("textbox", { name: "Field Name" }),
    ).toBeVisible();
    expect(
      within(form).getByRole("textbox", { name: /^Field Description/ }),
    ).toBeVisible();
    expect(
      within(form).getByRole("combobox", { name: "Field Type" }),
    ).toBeVisible();

    // No steps to walk, and the button creates.
    await act(async (): Promise<void> => {});
    expect(
      within(form).queryByRole("navigation", { name: "Progress" }),
    ).toBeNull();
    expect(
      within(form).getByRole("button", {
        name: "Create Incident Custom Field",
      }),
    ).toBeVisible();
    expect(within(form).queryByRole("button", { name: "Next" })).toBeNull();
  });

  test("never shows where values come from", async () => {
    await renderPage("create");

    const form: HTMLElement = await waitFor(() => {
      return dialog(NAME);
    });

    await within(form).findByRole("textbox", { name: "Field Name" });

    expect(within(form).queryByText("Map Value From")).toBeNull();
    expect(within(form).queryByText("Enter values by hand")).toBeNull();
    expect(within(form).queryByText("Field To Copy From")).toBeNull();
  });

  test("folds Show on Create and the other incident settings under Advanced", async () => {
    const user: UserEvent = await renderPage("create");

    const form: HTMLElement = await waitFor(() => {
      return dialog(NAME);
    });

    const advanced: HTMLElement = await within(form).findByRole("button", {
      name: "More fields",
    });

    expect(advanced).toHaveAttribute("aria-expanded", "false");
    expect(setChips(form)).toEqual([]);
    expect(
      within(form).getByRole("switch", {
        name: "Show on Create",
        hidden: true,
      }),
    ).not.toBeVisible();
    expect(
      within(form).getByRole("switch", {
        name: "Include in Subscriber Notifications",
        hidden: true,
      }),
    ).not.toBeVisible();

    await user.click(advanced);

    expect(advanced).toHaveAttribute("aria-expanded", "true");
    expect(
      within(form).getByRole("switch", { name: "Show on Create" }),
    ).toBeVisible();
    expect(
      within(form).getByRole("switch", {
        name: "Include in Subscriber Notifications",
      }),
    ).toBeVisible();
    // Asked only once a field is shown on create.
    expect(
      within(form).queryByRole("switch", { name: "Required on Create" }),
    ).toBeNull();

    await user.click(
      within(form).getByRole("switch", { name: "Show on Create" }),
    );

    expect(
      await within(form).findByRole("switch", { name: "Required on Create" }),
    ).toBeVisible();
    // Nothing on the Create form is about templates or mapping.
    expect(within(form).queryByText("Template Variable")).toBeNull();
  });

  test("asks for a dropdown's options right under a dropdown type", async () => {
    const user: UserEvent = await renderPage("create");

    const form: HTMLElement = await waitFor(() => {
      return dialog(NAME);
    });

    await within(form).findByRole("textbox", { name: "Field Name" });

    expect(within(form).queryByText("Dropdown Options")).toBeNull();

    await pickOption(
      user,
      within(form).getByRole("combobox", { name: "Field Type" }),
      "Dropdown (single select)",
    );

    expect(await within(form).findByText("Dropdown Options")).toBeVisible();
  });

  test("creates a field typed in by hand", async () => {
    const user: UserEvent = await renderPage("create");

    const form: HTMLElement = await waitFor(() => {
      return dialog(NAME);
    });

    fireEvent.change(
      await within(form).findByRole("textbox", { name: "Field Name" }),
      { target: { value: "Customer Tier" } },
    );

    await pickOption(
      user,
      within(form).getByRole("combobox", { name: "Field Type" }),
      "Text",
    );

    await user.click(
      within(form).getByRole("button", {
        name: "Create Incident Custom Field",
      }),
    );

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const model: BaseModel = savedModel();

    expect(model.getColumnValue("name")).toBe("Customer Tier");
    expect(model.getColumnValue("customFieldType")).toBe(CustomFieldType.Text);
    expect(model.getColumnValue("mapFromResourceType")).toBeNull();
    expect(model.getColumnValue("mapFromCustomFieldName")).toBeNull();
    // Untouched switches are saved off, as before.
    expect((model as unknown as Record<string, unknown>)["showOnCreate"]).toBe(
      false,
    );
    expect(
      (model as unknown as Record<string, unknown>)[
        "includeInSubscriberNotifications"
      ],
    ).toBe(false);
  });
});

describe("Edit Incident Custom Field", () => {
  const NAME: string = "Edit Incident Custom Field";

  beforeEach(() => {
    // The field being edited: copied from a monitor, and asked on create.
    getItemMock.mockImplementation((() => {
      return Promise.resolve(
        Object.assign(new IncidentCustomField(), {
          _id: FIELD_ID,
          name: "Vendor",
          description: "Who sold it",
          customFieldType: CustomFieldType.Text,
          mapFromResourceType: "Monitor",
          mapFromCustomFieldName: "Vendor",
          showOnCreate: true,
          isRequiredOnCreate: false,
          includeInSubscriberNotifications: false,
          variableKey: "vendor",
        }),
      );
    }) as never);
  });

  test("keeps Advanced folded, saying Configured", async () => {
    await renderPage("edit");

    const form: HTMLElement = await waitFor(() => {
      return dialog(NAME);
    });

    expect(
      await within(form).findByRole("textbox", { name: "Field Name" }),
    ).toHaveValue("Vendor");

    const advanced: HTMLElement = within(form).getByRole("button", {
      name: "More fields",
    });

    await waitFor(() => {
      expect(hasSetChip(form)).toBe(true);
    });
    expect(advanced).toHaveAttribute("aria-expanded", "false");
  });

  test("reaches every option under Advanced: the mapping, the settings and the template variable", async () => {
    const user: UserEvent = await renderPage("edit");

    const form: HTMLElement = await waitFor(() => {
      return dialog(NAME);
    });

    await within(form).findByRole("textbox", { name: "Field Name" });

    await user.click(within(form).getByRole("button", { name: "More fields" }));

    expect(within(form).getByText("Map Value From")).toBeVisible();
    expect(
      within(form).getByText("Copy from a monitor custom field"),
    ).toBeVisible();
    expect(within(form).getByText("Field To Copy From")).toBeVisible();
    // The monitor field it copies, picked.
    expect(await within(form).findByText("Vendor")).toBeVisible();
    expect(
      within(form).getByRole("switch", { name: "Show on Create" }),
    ).toBeChecked();
    expect(
      await within(form).findByTestId("custom-field-template-variable"),
    ).toHaveTextContent("{{incident.customFields.vendor}}");
  });

  test("saves the mapping it was opened with, and never the template variable", async () => {
    const user: UserEvent = await renderPage("edit");

    const form: HTMLElement = await waitFor(() => {
      return dialog(NAME);
    });

    fireEvent.change(
      await within(form).findByRole("textbox", { name: "Field Name" }),
      { target: { value: "Supplier" } },
    );

    await user.click(
      within(form).getByRole("button", { name: "Save Changes" }),
    );

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const model: BaseModel = savedModel();

    expect(model.getColumnValue("name")).toBe("Supplier");
    expect(model.getColumnValue("mapFromResourceType")).toBe("Monitor");
    expect(model.getColumnValue("mapFromCustomFieldName")).toBe("Vendor");
    expect(
      (model as unknown as Record<string, unknown>)["variableKey"],
    ).toBeUndefined();
    expect(Object.keys(savedMiscData())).not.toContain("templateVariable");
  });
});

describe("Create Mapped Custom Field", () => {
  const NAME: string = "Create Mapped Custom Field";

  async function openDialog(): Promise<{ user: UserEvent; form: HTMLElement }> {
    const user: UserEvent = await renderPage("none");

    await user.click(
      screen.getByRole("button", { name: "Create Mapped Custom Field" }),
    );

    const form: HTMLElement = await waitFor(() => {
      return dialog(NAME);
    });

    // The monitor's fields have loaded into the picker.
    await within(form).findByText("Select a monitor custom field");

    return { user, form };
  }

  test("asks for the monitor field to copy, a name and a description - nothing else", async () => {
    const { form } = await openDialog();

    expect(within(form).getByText("Monitor Field")).toBeVisible();
    expect(
      within(form).getByRole("textbox", { name: "Field Name" }),
    ).toBeVisible();
    expect(
      within(form).getByRole("textbox", { name: /^Field Description/ }),
    ).toBeVisible();

    expect(within(form).queryByRole("combobox", { name: "Field Type" })).toBe(
      null,
    );
    expect(within(form).queryByText("Map Value From")).toBeNull();
    expect(
      within(form).queryByRole("button", { name: "More fields" }),
    ).toBeNull();
    expect(
      within(form).queryByRole("navigation", { name: "Progress" }),
    ).toBeNull();
    expect(
      within(form).getByText(
        "A mapped field copies its value from a monitor custom field, so nobody has to type it in. The value is filled in from the monitor and kept up to date when it changes there.",
      ),
    ).toBeVisible();
  });

  test("offers every monitor field, each with its type", async () => {
    const { form } = await openDialog();

    fireEvent.keyDown(within(form).getByRole("combobox"), {
      key: "ArrowDown",
    });

    expect(screen.getByText("Region")).toBeInTheDocument();
    expect(screen.getByText("Dropdown (single select)")).toBeInTheDocument();
    expect(screen.getByText("Vendor")).toBeInTheDocument();
    expect(screen.getByText("Text")).toBeInTheDocument();
  });

  test("names the field after the one it copies and says its type", async () => {
    const { user, form } = await openDialog();

    await pickOption(user, within(form).getByRole("combobox"), "Region");

    await waitFor(() => {
      expect(
        within(form).getByRole("textbox", { name: "Field Name" }),
      ).toHaveValue("Region");
    });
    expect(
      within(form).getByTestId("map-from-selected-field-type"),
    ).toHaveTextContent("Field Type: Dropdown (single select)");
  });

  test("keeps a name somebody typed", async () => {
    const { user, form } = await openDialog();

    fireEvent.change(
      within(form).getByRole("textbox", { name: "Field Name" }),
      {
        target: { value: "Affected Region" },
      },
    );

    await pickOption(user, within(form).getByRole("combobox"), "Region");

    await within(form).findByTestId("map-from-selected-field-type");

    expect(
      within(form).getByRole("textbox", { name: "Field Name" }),
    ).toHaveValue("Affected Region");
  });

  test("saves the field with the copied field's type and options", async () => {
    const { user, form } = await openDialog();

    await pickOption(user, within(form).getByRole("combobox"), "Region");

    await waitFor(() => {
      expect(
        within(form).getByRole("textbox", { name: "Field Name" }),
      ).toHaveValue("Region");
    });

    await user.click(
      within(form).getByRole("button", { name: "Create Custom Field" }),
    );

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const model: BaseModel = savedModel();

    expect(model.getColumnValue("name")).toBe("Region");
    expect(model.getColumnValue("mapFromResourceType")).toBe("Monitor");
    expect(model.getColumnValue("mapFromCustomFieldName")).toBe("Region");
    expect(model.getColumnValue("customFieldType")).toBe(
      CustomFieldType.Dropdown,
    );
    expect(model.getColumnValue("dropdownOptions")).toBe(REGION_OPTIONS);

    // The dialog closes once the field is created.
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: NAME })).toBeNull();
    });
  });

  test("will not save without a field to copy", async () => {
    const { user, form } = await openDialog();

    fireEvent.change(
      within(form).getByRole("textbox", { name: "Field Name" }),
      {
        target: { value: "Region" },
      },
    );

    await user.click(
      within(form).getByRole("button", { name: "Create Custom Field" }),
    );

    expect(
      await within(form).findByText("Monitor Field is required."),
    ).toBeVisible();
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });
});
